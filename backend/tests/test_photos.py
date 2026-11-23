import io

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.routes import reports

REPORT = dict(
    name="Broken ramp",
    latitude=26.85,
    longitude=80.94,
    type="missing_ramp",
    description="The ramp is broken near the gate.",
)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(reports, "UPLOAD_DIR", tmp_path / "uploads")
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    def override():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(reports.router)
    app.dependency_overrides[get_db] = override
    return TestClient(app)


def make_image(fmt="PNG", size=(80, 60), exif=None):
    buffer = io.BytesIO()
    image = Image.new("RGB", size, "red")
    kwargs = {"exif": exif} if exif else {}
    image.save(buffer, format=fmt, **kwargs)
    return buffer.getvalue()


def new_report(client):
    return client.post("/api/reports", json=REPORT).json()["id"]


def upload(client, report_id, data, name="photo.png", mime="image/png"):
    return client.post(
        f"/api/reports/{report_id}/photo", files={"file": (name, data, mime)}
    )


def test_valid_photo_is_saved_and_served(client):
    rid = new_report(client)
    response = upload(client, rid, make_image())
    assert response.status_code == 201
    url = response.json()["photo_url"]
    assert url.startswith("/api/photos/") and url.endswith(".jpg")

    photo = client.get(url)
    assert photo.status_code == 200
    assert photo.headers["content-type"] == "image/jpeg"
    assert client.get(f"/api/reports").json()[0]["photo_url"] == url


def test_report_without_photo_has_no_url(client):
    rid = new_report(client)
    assert client.get("/api/reports").json()[0]["photo_url"] is None


def test_fake_image_is_rejected(client):
    rid = new_report(client)
    response = upload(client, rid, b"this is not an image", name="x.png")
    assert response.status_code == 400


def test_wrong_format_is_rejected(client):
    rid = new_report(client)
    response = upload(client, rid, make_image("GIF"), name="x.gif", mime="image/gif")
    assert response.status_code == 415


def test_too_large_is_rejected(client):
    rid = new_report(client)
    response = upload(client, rid, b"0" * (reports.MAX_PHOTO_BYTES + 10))
    assert response.status_code == 413


def test_gps_metadata_is_removed(client):
    exif = Image.Exif()
    exif[0x010F] = "SecretCameraMaker"
    rid = new_report(client)
    response = upload(client, rid, make_image("JPEG", exif=exif.tobytes()), "a.jpg", "image/jpeg")
    stored = client.get(response.json()["photo_url"]).content
    assert b"SecretCameraMaker" not in stored
    assert not Image.open(io.BytesIO(stored)).getexif()


def test_only_one_photo_per_report(client):
    rid = new_report(client)
    assert upload(client, rid, make_image()).status_code == 201
    assert upload(client, rid, make_image()).status_code == 409


def test_unknown_report_is_404(client):
    assert upload(client, 999, make_image()).status_code == 404


def test_photo_cannot_be_added_after_review(client):
    rid = new_report(client)
    reports_app = client.app
    # force the report out of "pending"
    from app.models.report import Report
    db = next(reports_app.dependency_overrides[get_db]())
    db.get(Report, rid).status = "verified"
    db.commit()
    assert upload(client, rid, make_image()).status_code == 409


@pytest.mark.parametrize("name", ["../secret.jpg", "abc.jpg", "x.png", "..%2Fetc%2Fpasswd"])
def test_photo_route_rejects_bad_names(client, name):
    assert client.get(f"/api/photos/{name}").status_code == 404
