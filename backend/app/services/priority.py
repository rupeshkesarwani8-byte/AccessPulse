"""Repair priority score.

Each active report (pending or verified) gets a score from 0 to 100 made of
four parts, so anyone can see why a barrier is ranked where it is:

  severity  up to 50   how much this barrier type blocks movement
  nearby    up to 20   other active reports within 100 m (4 points each, max 5)
  review    up to 15   verified 15, pending 5
  waiting   up to 15   days since it was reported, 30 days or more gives 15

The severity weights are our own judgement for the prototype. They are not an
official standard and can be changed in SEVERITY below.
"""

from datetime import datetime, timezone
from math import asin, cos, radians, sin, sqrt

SEVERITY = {
    "inaccessible_crossing": 5,
    "missing_ramp": 5,
    "blocked_path": 4,
    "stairs": 4,
    "broken_sidewalk": 3,
    "other": 2,
}
MAX_SEVERITY = 5

ACTIVE_STATUSES = ("pending", "verified")
NEARBY_RADIUS_M = 100
NEARBY_POINTS_EACH = 4
NEARBY_CAP = 5
REVIEW_POINTS = {"verified": 15, "pending": 5}
WAITING_FULL_DAYS = 30

POINTS_SEVERITY = 50
POINTS_NEARBY = NEARBY_POINTS_EACH * NEARBY_CAP  # 20
POINTS_WAITING = 15


def distance_m(lat1, lon1, lat2, lon2) -> float:
    """Straight line distance on the ground, in metres (haversine)."""
    p1, p2 = radians(lat1), radians(lat2)
    a = sin((p2 - p1) / 2) ** 2 + cos(p1) * cos(p2) * sin(radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371000 * asin(sqrt(a))


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def rank_reports(reports, now: datetime | None = None, limit: int = 10) -> list[dict]:
    """Return the active reports with the highest repair priority first."""
    now = _utc(now) if now else datetime.now(timezone.utc)
    active = [r for r in reports if r.status in ACTIVE_STATUSES]
    ranked = []

    for report in active:
        nearby_count = sum(
            1
            for other in active
            if other.id != report.id
            and distance_m(report.latitude, report.longitude, other.latitude, other.longitude)
            <= NEARBY_RADIUS_M
        )
        days = max((now - _utc(report.created_at)).total_seconds() / 86400, 0)

        severity = round(
            SEVERITY.get(report.type, 2) / MAX_SEVERITY * POINTS_SEVERITY, 1
        )
        nearby = min(nearby_count, NEARBY_CAP) * NEARBY_POINTS_EACH
        review = REVIEW_POINTS[report.status]
        waiting = round(min(days, WAITING_FULL_DAYS) / WAITING_FULL_DAYS * POINTS_WAITING, 1)

        ranked.append(
            {
                "id": report.id,
                "name": report.name,
                "type": report.type,
                "status": report.status,
                "latitude": report.latitude,
                "longitude": report.longitude,
                "photo_url": report.photo_url,
                "nearby_count": nearby_count,
                "days_waiting": round(days, 1),
                "score": round(severity + nearby + review + waiting, 1),
                "breakdown": {
                    "severity": severity,
                    "nearby": nearby,
                    "review": review,
                    "waiting": waiting,
                },
            }
        )

    ranked.sort(key=lambda item: (-item["score"], item["id"]))
    return ranked[:limit]
