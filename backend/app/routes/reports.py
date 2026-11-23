import csv
import io
import re
import uuid
from pathlib import Path

from fastapi.responses import FileResponse, Response
from collections import Counter

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.report import Report, ReportPhoto, StatusHistory
from app.routes.auth import require_admin
from app.services.priority import rank_reports
from app.schemas.report import (
    ReportCreate,
    PriorityItem,
    ReportResponse,
    StatusHistoryResponse,
    StatusUpdate,
)

router = APIRouter(prefix="/api", tags=["Reports"])

# Where photos are stored: backend/uploads (created on first upload).
UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads"
MAX_PHOTO_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_PHOTO_SIDE = 1600  # pixels, longest side after resize
PHOTO_NAME = re.compile(r"^[0-9a-f]{32}\.jpg$")
Image.MAX_IMAGE_PIXELS = 40_000_000  # refuse decompression bombs

STATUSES = ("verified", "pending", "rejected", "resolved")

# Allowed admin moves: current status -> statuses it may change to.
ALLOWED_TRANSITIONS = {
    "pending": {"verified", "rejected"},
    "verified": {"resolved", "rejected"},
    "resolved": {"verified"},  # reopen if the barrier comes back
    "rejected": set(),
}
BARRIER_TYPES = (
    "missing_ramp",
    "blocked_path",
    "stairs",
    "broken_sidewalk",
    "inaccessible_crossing",
    "other",
)


def fetch_reports(db: Session) -> list[Report]:
    return list(
        db.scalars(select(Report).order_by(Report.created_at.desc(), Report.id.desc()))
    )


@router.get("/reports", response_model=list[ReportResponse])
def list_reports(
    status: str | None = Query(default=None),
    barrier_type: str | None = Query(default=None),
    search: str | None = Query(default=None, max_length=200),
    db: Session = Depends(get_db),
):
    statement = select(Report)

    if status is not None:
        if status not in STATUSES:
            raise HTTPException(status_code=422, detail="Invalid report status.")
        statement = statement.where(Report.status == status)

    if barrier_type is not None:
        if barrier_type not in BARRIER_TYPES:
            raise HTTPException(status_code=422, detail="Invalid barrier type.")
        statement = statement.where(Report.type == barrier_type)

    if search and search.strip():
        term = f"%{search.strip()}%"
        statement = statement.where(
            Report.name.ilike(term)
            | Report.description.ilike(term)
            | Report.type.ilike(term)
            | Report.source.ilike(term)
        )

    statement = statement.order_by(Report.created_at.desc(), Report.id.desc())
    return list(db.scalars(statement))


@router.post("/reports", response_model=ReportResponse, status_code=201)
def create_report(body: ReportCreate, db: Session = Depends(get_db)):
    report = Report(
        name=body.name,
        latitude=body.latitude,
        longitude=body.longitude,
        type=body.type,
        description=body.description,
        source=body.source,
        status="pending",
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


@router.get("/priority", response_model=list[PriorityItem])
def get_priority(
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
    admin: str = Depends(require_admin),
):
    """Active reports ranked by repair priority, with the score breakdown."""
    return rank_reports(fetch_reports(db), limit=limit)


@router.get("/stats")
def get_stats(db: Session = Depends(get_db)):
    reports = fetch_reports(db)
    status_counts = Counter(report.status for report in reports)
    type_counts = Counter(report.type for report in reports)

    return {
        "total_reports": len(reports),
        "verified_reports": status_counts["verified"],
        "pending_reports": status_counts["pending"],
        "rejected_reports": status_counts["rejected"],
        "resolved_reports": status_counts["resolved"],
        "by_status": {
            status: status_counts[status] for status in STATUSES
        },
        "by_type": {
            barrier_type: type_counts[barrier_type]
            for barrier_type in BARRIER_TYPES
        },
    }


@router.patch("/reports/{report_id}/status", response_model=ReportResponse)
def update_report_status(
    report_id: int,
    body: StatusUpdate,
    db: Session = Depends(get_db),
    admin: str = Depends(require_admin),
):
    report = db.get(Report, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found.")

    if body.status not in ALLOWED_TRANSITIONS.get(report.status, set()):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot change status from {report.status} to {body.status}.",
        )

    db.add(
        StatusHistory(
            report_id=report.id,
            from_status=report.status,
            to_status=body.status,
            changed_by=str(admin),
        )
    )
    report.status = body.status
    db.commit()
    db.refresh(report)
    return report


@router.get(
    "/reports/{report_id}/history", response_model=list[StatusHistoryResponse]
)
def get_report_history(
    report_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(require_admin),
):
    if db.get(Report, report_id) is None:
        raise HTTPException(status_code=404, detail="Report not found.")

    return list(
        db.scalars(
            select(StatusHistory)
            .where(StatusHistory.report_id == report_id)
            .order_by(StatusHistory.changed_at.desc(), StatusHistory.id.desc())
        )
    )


def clean_photo(data: bytes) -> bytes:
    """Validate the bytes really are a JPEG or PNG and re-encode as a clean JPEG.

    Re-encoding drops EXIF metadata (including GPS location and camera info),
    so a reporter's private data is not stored or published with the photo.
    """
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format not in ("JPEG", "PNG"):
                raise HTTPException(status_code=415, detail="Only JPG or PNG photos are allowed.")
            image.load()
            image = ImageOps.exif_transpose(image)  # keep the right way up

            if image.mode in ("RGBA", "LA", "P"):
                image = image.convert("RGBA")
                background = Image.new("RGB", image.size, "white")
                background.paste(image, mask=image.getchannel("A"))
                image = background
            else:
                image = image.convert("RGB")

            image.thumbnail((MAX_PHOTO_SIDE, MAX_PHOTO_SIDE))
            output = io.BytesIO()
            image.save(output, format="JPEG", quality=85, optimize=True)
            return output.getvalue()
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, ValueError):
        raise HTTPException(status_code=400, detail="The file is not a valid image.")


@router.post("/reports/{report_id}/photo", response_model=ReportResponse, status_code=201)
async def upload_report_photo(
    report_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    report = db.get(Report, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found.")
    if report.status != "pending":
        raise HTTPException(
            status_code=409, detail="Photos can only be added while a report is pending."
        )
    if report.photos:
        raise HTTPException(status_code=409, detail="This report already has a photo.")

    data = await file.read(MAX_PHOTO_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail="The file is empty.")
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="The photo is larger than 5 MB.")

    cleaned = clean_photo(data)

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.jpg"  # server-chosen name, never the user's
    (UPLOAD_DIR / filename).write_bytes(cleaned)

    db.add(ReportPhoto(report_id=report.id, filename=filename))
    db.commit()
    db.refresh(report)
    return report


@router.get("/photos/{filename}")
def get_photo(filename: str):
    if not PHOTO_NAME.fullmatch(filename):
        raise HTTPException(status_code=404, detail="Photo not found.")
    path = UPLOAD_DIR / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Photo not found.")
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "public, max-age=86400",
            "X-Content-Type-Options": "nosniff",
        },
    )


def safe_csv_text(value: object) -> str:
    """Reduce spreadsheet formula-injection risk in user-provided text."""
    text = "" if value is None else str(value)

    if text.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
        return "'" + text

    return text


@router.get("/reports/export.csv")
def export_reports_csv(
    db: Session = Depends(get_db),
    admin: str = Depends(require_admin),
):
    reports = fetch_reports(db)

    output = io.StringIO(newline="")
    writer = csv.writer(output)

    writer.writerow([
        "ID",
        "Name",
        "Barrier Type",
        "Description",
        "Latitude",
        "Longitude",
        "Status",
        "Source",
        "Created At",
    ])

    for report in reports:
        writer.writerow([
            report.id,
            safe_csv_text(report.name),
            safe_csv_text(report.type),
            safe_csv_text(report.description),
            report.latitude,
            report.longitude,
            safe_csv_text(report.status),
            safe_csv_text(report.source),
            report.created_at.isoformat() if report.created_at else "",
        ])

    csv_content = output.getvalue().encode("utf-8-sig")

    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="accesspulse-reports.csv"'
        },
    )