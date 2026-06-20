"""Backend API tests for Supermarket Management System"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://supermarket-hub-15.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@supermarket.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="session")
def admin_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    if r.status_code == 429:
        # If locked out, wait or skip
        pytest.skip(f"Locked out: {r.text}")
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    assert data["email"] == ADMIN_EMAIL
    assert data["role"] == "admin"
    return s


# ===== AUTH =====
class TestAuth:
    def test_login_success(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_login_invalid(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong_pw_xyz"})
        assert r.status_code == 401

    def test_me_unauth(self):
        r = requests.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401


# ===== PRODUCTS =====
class TestProducts:
    created_product_id = None

    def test_get_products(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/products")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_product(self, admin_session):
        sku = f"TEST_SKU_{int(time.time())}"
        payload = {
            "name": "TEST_Milk",
            "sku": sku,
            "category": "Dairy",
            "price": 3.99,
            "cost_price": 2.50,
            "quantity": 100,
            "min_stock_level": 10
        }
        r = admin_session.post(f"{BASE_URL}/api/products", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["sku"] == sku
        assert data["name"] == "TEST_Milk"
        assert "id" in data
        TestProducts.created_product_id = data["id"]

        # GET to verify persistence
        r2 = admin_session.get(f"{BASE_URL}/api/products/{data['id']}")
        assert r2.status_code == 200
        assert r2.json()["sku"] == sku

    def test_low_stock_alerts(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/products/low-stock/alerts")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_delete_product(self, admin_session):
        if not TestProducts.created_product_id:
            pytest.skip("No product created")
        r = admin_session.delete(f"{BASE_URL}/api/products/{TestProducts.created_product_id}")
        assert r.status_code == 200


# ===== SUPPLIERS =====
class TestSuppliers:
    created_supplier_id = None

    def test_get_suppliers(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/suppliers")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_supplier(self, admin_session):
        payload = {"name": "TEST_Fresh_Farms", "phone": "555-1234"}
        r = admin_session.post(f"{BASE_URL}/api/suppliers", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == "TEST_Fresh_Farms"
        assert "id" in data
        TestSuppliers.created_supplier_id = data["id"]

    def test_delete_supplier(self, admin_session):
        if not TestSuppliers.created_supplier_id:
            pytest.skip("No supplier created")
        r = admin_session.delete(f"{BASE_URL}/api/suppliers/{TestSuppliers.created_supplier_id}")
        assert r.status_code == 200


# ===== EMPLOYEES =====
class TestEmployees:
    def test_get_employees(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/employees")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert any(e["email"] == ADMIN_EMAIL for e in data)


# ===== CATEGORIES =====
class TestCategories:
    def test_get_categories(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/categories")
        assert r.status_code == 200
        cats = r.json()
        assert isinstance(cats, list)
        assert len(cats) >= 1


# ===== REPORTS =====
class TestReports:
    def test_dashboard_stats(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/reports/dashboard")
        assert r.status_code == 200
        data = r.json()
        for key in ["total_products", "low_stock_count", "total_suppliers",
                    "total_employees", "today_revenue", "today_orders", "month_revenue"]:
            assert key in data

    def test_sales_by_date(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/reports/sales-by-date?days=7")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_top_products(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/reports/top-products")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_sales_by_category(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/reports/sales-by-category")
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ===== SALES =====
class TestSales:
    def test_get_sales(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/sales")
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ===== SEED DATA (24 products) =====
class TestSeedData:
    def test_products_count_at_least_24(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/products")
        assert r.status_code == 200
        products = r.json()
        # Filter to seed products by sku prefixes
        seed_prefixes = ("GRO-", "BEV-", "DAI-", "SNK-", "PER-", "HOU-")
        seed_products = [p for p in products if p.get("sku", "").startswith(seed_prefixes)]
        assert len(seed_products) >= 24, f"Expected 24 seed products, got {len(seed_products)}"

    def test_low_stock_contains_expected_items(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/products/low-stock/alerts")
        assert r.status_code == 200
        items = r.json()
        names = {p.get("name") for p in items}
        # Butter (8/15), Granola Bars (5/15), Trash Bags (3/10)
        assert "Butter 250g" in names
        assert "Granola Bars 6-pack" in names
        assert "Trash Bags 30-count" in names

    def test_dashboard_reflects_seed(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/reports/dashboard")
        assert r.status_code == 200
        data = r.json()
        assert data["total_products"] >= 24
        assert data["low_stock_count"] >= 3

    def test_barcode_search(self, admin_session):
        # GRO-001 barcode = 1000000001
        r = admin_session.get(f"{BASE_URL}/api/products?search=1000000001")
        assert r.status_code == 200
        items = r.json()
        assert any(p.get("sku") == "GRO-001" for p in items)


# ===== CSV EXPORT/IMPORT =====
class TestCSV:
    def test_export_csv(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/products/export/csv")
        assert r.status_code == 200
        ctype = r.headers.get("content-type", "")
        assert "text/csv" in ctype, f"Unexpected content-type: {ctype}"
        body = r.text
        # Header validation
        first_line = body.splitlines()[0]
        for col in ["name", "sku", "category", "price", "cost_price", "quantity", "min_stock_level", "barcode"]:
            assert col in first_line
        # Should have at least 24 data rows
        lines = [l for l in body.splitlines() if l.strip()]
        assert len(lines) >= 25  # header + 24

    def test_import_csv_create_and_update(self, admin_session):
        sku_new = f"TESTCSV_{int(time.time())}"
        csv_content = (
            "name,sku,category,price,cost_price,quantity,min_stock_level,barcode,description\n"
            f"TEST_ImportedItem,{sku_new},Groceries,9.99,5.00,50,10,9999999999,Imported via CSV\n"
        )
        files = {"file": ("upload.csv", csv_content, "text/csv")}
        # Strip JSON header for multipart
        sess = requests.Session()
        sess.cookies.update(admin_session.cookies)
        r = sess.post(f"{BASE_URL}/api/products/import/csv", files=files)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["imported"] >= 1
        assert data.get("errors") == [] or isinstance(data.get("errors"), list)

        # Verify via GET
        r2 = admin_session.get(f"{BASE_URL}/api/products?search={sku_new}")
        assert r2.status_code == 200
        items = r2.json()
        assert any(p["sku"] == sku_new for p in items)

        # Update via re-import
        csv_content2 = (
            "name,sku,category,price,cost_price,quantity,min_stock_level,barcode,description\n"
            f"TEST_ImportedItem,{sku_new},Groceries,19.99,5.00,75,10,9999999999,Updated\n"
        )
        files2 = {"file": ("upload.csv", csv_content2, "text/csv")}
        r3 = sess.post(f"{BASE_URL}/api/products/import/csv", files=files2)
        assert r3.status_code == 200, r3.text
        assert r3.json()["updated"] >= 1

        # Verify update persisted
        r4 = admin_session.get(f"{BASE_URL}/api/products?search={sku_new}")
        item = [p for p in r4.json() if p["sku"] == sku_new][0]
        assert item["price"] == 19.99
        assert item["quantity"] == 75

        # Cleanup
        admin_session.delete(f"{BASE_URL}/api/products/{item['id']}")

    def test_import_csv_rejects_non_csv(self, admin_session):
        sess = requests.Session()
        sess.cookies.update(admin_session.cookies)
        files = {"file": ("upload.txt", "not a csv", "text/plain")}
        r = sess.post(f"{BASE_URL}/api/products/import/csv", files=files)
        assert r.status_code == 400
