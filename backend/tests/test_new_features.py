"""Backend tests for NEW features: promo codes, shifts, audit log, expiring products, locked-down register."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://supermarket-hub-15.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@supermarket.com"
ADMIN_PASSWORD = "admin123"
CASHIER_EMAIL = "cashier@supermarket.com"
CASHIER_PASSWORD = "cashier123"


def _login(email, password):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    if r.status_code == 429:
        pytest.skip(f"Rate limited: {r.text}")
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="session")
def admin_session():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="session")
def cashier_session():
    return _login(CASHIER_EMAIL, CASHIER_PASSWORD)


# ===== PROMO CODES =====
class TestPromoCodes:
    def test_get_promo_codes_seeded(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/promo-codes")
        assert r.status_code == 200, r.text
        codes = r.json()
        assert isinstance(codes, list)
        code_names = {c["code"] for c in codes}
        for expected in ["WELCOME10", "SAVE5", "SUPER20"]:
            assert expected in code_names, f"Missing seeded promo: {expected}. Got: {code_names}"

    def test_validate_welcome10_percentage(self, admin_session):
        r = admin_session.post(f"{BASE_URL}/api/promo-codes/validate",
                               json={"code": "WELCOME10", "subtotal": 50})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["valid"] is True
        assert data["code"] == "WELCOME10"
        assert data["discount_type"] == "percentage"
        assert data["discount_value"] == 10
        assert abs(data["calculated_discount"] - 5.0) < 0.01  # 10% of 50

    def test_validate_save5_fixed(self, admin_session):
        r = admin_session.post(f"{BASE_URL}/api/promo-codes/validate",
                               json={"code": "SAVE5", "subtotal": 30})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["valid"] is True
        assert data["discount_type"] == "fixed"
        assert abs(data["calculated_discount"] - 5.0) < 0.01

    def test_validate_super20_expired_or_min(self, admin_session):
        # SUPER20 was seeded with expiry 2026-03-31 (now expired) and min $50.
        # Either expired or min-purchase rejection is acceptable - both are 400.
        r = admin_session.post(f"{BASE_URL}/api/promo-codes/validate",
                               json={"code": "SUPER20", "subtotal": 20})
        assert r.status_code == 400
        body = r.text.lower()
        assert ("expired" in body) or ("minimum" in body) or ("min" in body), body

    def test_validate_invalid_code(self, admin_session):
        r = admin_session.post(f"{BASE_URL}/api/promo-codes/validate",
                               json={"code": "NONEXISTENT_XYZ", "subtotal": 100})
        assert r.status_code == 404

    def test_validate_case_insensitive(self, admin_session):
        r = admin_session.post(f"{BASE_URL}/api/promo-codes/validate",
                               json={"code": "welcome10", "subtotal": 50})
        assert r.status_code == 200
        assert r.json()["code"] == "WELCOME10"

    def test_cashier_cannot_list_promo_codes(self, cashier_session):
        # GET requires admin
        r = cashier_session.get(f"{BASE_URL}/api/promo-codes")
        assert r.status_code == 403


# ===== SHIFT MANAGEMENT =====
class TestShifts:
    def test_shift_start_and_end_cycle(self, cashier_session):
        # Ensure no open shift first (end any open)
        cur = cashier_session.get(f"{BASE_URL}/api/shifts/current").json()
        if cur.get("status") == "open":
            cashier_session.post(f"{BASE_URL}/api/shifts/end")

        # Start shift
        r = cashier_session.post(f"{BASE_URL}/api/shifts/start")
        assert r.status_code == 200, r.text
        shift = r.json()
        assert shift["status"] == "open"
        assert "id" in shift
        assert shift["user_role"] == "cashier"

        # Current shift reflects open
        r2 = cashier_session.get(f"{BASE_URL}/api/shifts/current")
        assert r2.status_code == 200
        assert r2.json()["status"] == "open"

        # Can't start another
        r3 = cashier_session.post(f"{BASE_URL}/api/shifts/start")
        assert r3.status_code == 400

        # End shift
        r4 = cashier_session.post(f"{BASE_URL}/api/shifts/end")
        assert r4.status_code == 200, r4.text
        report = r4.json()
        assert report["status"] == "closed"
        assert "total_sales" in report
        assert "transaction_count" in report
        assert "end_time" in report and report["end_time"]

        # Current is none again
        r5 = cashier_session.get(f"{BASE_URL}/api/shifts/current")
        assert r5.json().get("status") in ("none", None)

    def test_end_without_open_shift_fails(self, cashier_session):
        # Make sure closed
        cur = cashier_session.get(f"{BASE_URL}/api/shifts/current").json()
        if cur.get("status") == "open":
            cashier_session.post(f"{BASE_URL}/api/shifts/end")
        r = cashier_session.post(f"{BASE_URL}/api/shifts/end")
        assert r.status_code == 400

    def test_shift_history(self, cashier_session):
        r = cashier_session.get(f"{BASE_URL}/api/shifts/history")
        assert r.status_code == 200
        history = r.json()
        assert isinstance(history, list)
        # Should have at least our recently closed shift
        assert len(history) >= 1


# ===== AUDIT LOG =====
class TestAuditLog:
    def test_get_audit_logs_admin(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/audit-logs")
        assert r.status_code == 200
        logs = r.json()
        assert isinstance(logs, list)
        assert len(logs) >= 1
        # Validate structure
        first = logs[0]
        for key in ["action", "entity_type", "user_name", "created_at"]:
            assert key in first, f"Missing key {key} in audit log entry"

    def test_audit_filter_by_entity_type(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/audit-logs?entity_type=shift")
        assert r.status_code == 200
        logs = r.json()
        # All returned should be shift entity
        for entry in logs:
            assert entry["entity_type"] == "shift"

    def test_cashier_cannot_view_audit_logs(self, cashier_session):
        r = cashier_session.get(f"{BASE_URL}/api/audit-logs")
        assert r.status_code == 403


# ===== EXPIRING PRODUCTS =====
class TestExpiring:
    def test_expiring_soon_returns_list(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/products/expiring/soon?days=90")
        assert r.status_code == 200, r.text
        products = r.json()
        assert isinstance(products, list)
        # Validate items have expiry_date set (if any are returned)
        for p in products:
            assert p.get("expiry_date")


# ===== LOCKED DOWN /auth/register =====
class TestLockedRegister:
    def test_register_admin_without_auth_returns_403(self):
        # Use a clean session (no cookies)
        s = requests.Session()
        ts = int(time.time())
        payload = {
            "email": f"TEST_evil_admin_{ts}@x.com",
            "password": "Hax12345",
            "name": "Evil Admin",
            "role": "admin"
        }
        r = s.post(f"{BASE_URL}/api/auth/register", json=payload)
        assert r.status_code == 403, f"Expected 403 for unauthenticated admin register, got {r.status_code}: {r.text}"

    def test_register_inventory_manager_without_auth_returns_403(self):
        s = requests.Session()
        ts = int(time.time())
        payload = {
            "email": f"TEST_evil_sk_{ts}@x.com",
            "password": "Hax12345",
            "name": "Evil SK",
            "role": "inventory_manager"
        }
        r = s.post(f"{BASE_URL}/api/auth/register", json=payload)
        assert r.status_code == 403

    def test_register_cashier_self_signup_allowed(self):
        s = requests.Session()
        ts = int(time.time())
        email = f"TEST_self_cashier_{ts}@x.com"
        payload = {
            "email": email,
            "password": "Pass1234",
            "name": "Self Cashier",
            "role": "cashier"
        }
        r = s.post(f"{BASE_URL}/api/auth/register", json=payload)
        # Allowed for cashier role (no admin auth required)
        assert r.status_code in (200, 201), r.text

    def test_register_invalid_role_400(self):
        s = requests.Session()
        ts = int(time.time())
        r = s.post(f"{BASE_URL}/api/auth/register", json={
            "email": f"TEST_invalid_{ts}@x.com", "password": "Pass1234",
            "name": "X", "role": "superuser"
        })
        assert r.status_code == 400
