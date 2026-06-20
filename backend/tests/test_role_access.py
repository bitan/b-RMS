"""Tests for role-based access: admin, cashier, inventory_manager (store keeper)"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")

CREDS = {
    "admin": ("admin@supermarket.com", "admin123", "admin"),
    "cashier": ("cashier@supermarket.com", "cashier123", "cashier"),
    "inventory_manager": ("storekeeper@supermarket.com", "store123", "inventory_manager"),
}


def _login(email, password):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    if r.status_code == 429:
        pytest.skip(f"Locked out: {r.text}")
    return s, r


@pytest.mark.parametrize("key", list(CREDS.keys()))
def test_seeded_account_login(key):
    email, password, role = CREDS[key]
    s, r = _login(email, password)
    assert r.status_code == 200, f"{email} login failed: {r.text}"
    data = r.json()
    assert data["email"] == email
    assert data["role"] == role
    # /auth/me works
    r2 = s.get(f"{BASE_URL}/api/auth/me")
    assert r2.status_code == 200
    assert r2.json()["role"] == role


# Cashier access restrictions
class TestCashierAccess:
    @pytest.fixture
    def cashier(self):
        email, pwd, _ = CREDS["cashier"]
        s, r = _login(email, pwd)
        assert r.status_code == 200
        return s

    def test_cashier_can_view_products(self, cashier):
        # Cashier needs products for POS
        r = cashier.get(f"{BASE_URL}/api/products")
        assert r.status_code == 200

    def test_cashier_cannot_create_product(self, cashier):
        r = cashier.post(f"{BASE_URL}/api/products", json={
            "name": "X", "sku": "X1", "category": "G", "price": 1, "cost_price": 0.5, "quantity": 1
        })
        assert r.status_code == 403

    def test_cashier_cannot_create_supplier(self, cashier):
        r = cashier.post(f"{BASE_URL}/api/suppliers", json={"name": "X", "phone": "1"})
        assert r.status_code == 403

    def test_cashier_cannot_view_employees(self, cashier):
        r = cashier.get(f"{BASE_URL}/api/employees")
        assert r.status_code == 403


# Store keeper (inventory_manager) access
class TestStoreKeeperAccess:
    @pytest.fixture
    def keeper(self):
        email, pwd, _ = CREDS["inventory_manager"]
        s, r = _login(email, pwd)
        assert r.status_code == 200
        return s

    def test_keeper_can_view_products(self, keeper):
        r = keeper.get(f"{BASE_URL}/api/products")
        assert r.status_code == 200

    def test_keeper_can_create_product(self, keeper):
        import time
        sku = f"TEST_SK_{int(time.time())}"
        r = keeper.post(f"{BASE_URL}/api/products", json={
            "name": "TEST_StoreKeeperItem", "sku": sku, "category": "Groceries",
            "price": 1.99, "cost_price": 1.0, "quantity": 10, "min_stock_level": 5
        })
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        # cleanup
        keeper.delete(f"{BASE_URL}/api/products/{pid}")

    def test_keeper_can_create_supplier(self, keeper):
        import time
        r = keeper.post(f"{BASE_URL}/api/suppliers", json={
            "name": f"TEST_Sup_{int(time.time())}", "phone": "555-0001"
        })
        assert r.status_code == 200, r.text

    def test_keeper_cannot_view_employees(self, keeper):
        r = keeper.get(f"{BASE_URL}/api/employees")
        assert r.status_code == 403

    def test_keeper_cannot_delete_supplier(self, keeper):
        # Create a supplier first as admin, then attempt delete as keeper
        admin_s, _ = _login(*CREDS["admin"][:2])
        cr = admin_s.post(f"{BASE_URL}/api/suppliers", json={"name": "TEST_DelSup", "phone": "1"})
        sid = cr.json()["id"]
        r = keeper.delete(f"{BASE_URL}/api/suppliers/{sid}")
        assert r.status_code == 403
        # cleanup
        admin_s.delete(f"{BASE_URL}/api/suppliers/{sid}")
