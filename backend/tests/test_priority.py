from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.models.report import Report
from app.routes import reports
from app.routes.auth import require_admin
from app.services import priority
from app.services.priority import distance_m, rank_reports

NOW = datetime(2026, 11, 20, tzinfo=timezone.utc)


def fake(id, type="other", status="pending", lat=26.85, lon=80.94, days=0):
    return SimpleNamespace(
        id=id, name=f"r{id}", type=type, status=status, latitude=lat, longitude=lon,
        created_at=NOW - timedelta(days=days), photo_url=None,
    )


def test_distance_is_about_right():
    # 0.001 degrees of latitude is about 111 metres
    assert 105 < distance_m(26.85, 80.94, 26.851, 80.94) < 117
    assert distance_m(26.85, 80.94, 26.85, 80.94) == 0


def test_serious_type_ranks_above_minor_type():
    ranked = rank_reports(
        [fake(1, "other", lat=26.80), fake(2, "missing_ramp", lat=26.90)], now=NOW
    )
    assert [r["id"] for r in ranked] == [2, 1]


def test_nearby_reports_raise_the_score():
    alone = rank_reports([fake(1, "stairs")], now=NOW)[0]["score"]
    cluster = rank_reports(
        [fake(1, "stairs"), fake(2, "other", lat=26.8501), fake(3, "other", lat=26.8502)],
        now=NOW,
    )
    first = next(r for r in cluster if r["id"] == 1)
    assert first["nearby_count"] == 2
    assert first["breakdown"]["nearby"] == 8
    assert first["score"] == alone + 8


def test_far_reports_do_not_count():
    ranked = rank_reports([fake(1), fake(2, lat=26.86)], now=NOW)
    assert all(r["nearby_count"] == 0 for r in ranked)


def test_resolved_and_rejected_are_left_out():
    ranked = rank_reports(
        [fake(1, status="resolved"), fake(2, status="rejected"), fake(3, status="verified")],
        now=NOW,
    )
    assert [r["id"] for r in ranked] == [3]


def test_resolved_report_does_not_count_as_nearby():
    ranked = rank_reports([fake(1), fake(2, status="resolved", lat=26.8501)], now=NOW)
    assert ranked[0]["nearby_count"] == 0


def test_verified_beats_pending_and_waiting_is_capped():
    ranked = rank_reports(
        [fake(1, status="pending", days=400), fake(2, status="verified", days=0, lat=26.9)],
        now=NOW,
    )
    pending = next(r for r in ranked if r["id"] == 1)
    assert pending["breakdown"]["waiting"] == 15  # capped at 30 days
    assert pending["breakdown"]["review"] == 5


def test_breakdown_adds_up_and_stays_within_100():
    many = [fake(i, "missing_ramp", "verified", lat=26.85 + i * 0.00001, days=90) for i in range(9)]
    for item in rank_reports(many, now=NOW):
        parts = item["breakdown"]
        assert round(sum(parts.values()), 1) == item["score"]
        assert item["score"] <= 100


def test_limit_is_applied():
    many = [fake(i, lat=26.8 + i * 0.01) for i in range(1, 8)]
    assert len(rank_reports(many, now=NOW, limit=3)) == 3


@pytest.fixture()
def client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
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
    app.dependency_overrides[require_admin] = lambda: "admin"
    return TestClient(app), Session


def test_endpoint_returns_ranked_items(client):
    http, Session = client
    for name, kind, lat in [("Minor", "other", 26.80), ("Ramp", "missing_ramp", 26.90)]:
        http.post("/api/reports", json=dict(
            name=name, latitude=lat, longitude=80.9, type=kind,
            description="A description that is long enough."))
    body = http.get("/api/priority").json()
    assert [item["name"] for item in body] == ["Ramp", "Minor"]
    assert set(body[0]["breakdown"]) == {"severity", "nearby", "review", "waiting"}


def test_endpoint_is_protected_by_admin_login():
    route = next(r for r in reports.router.routes if getattr(r, "path", "") == "/api/priority")
    assert require_admin in [dep.call for dep in route.dependant.dependencies]
