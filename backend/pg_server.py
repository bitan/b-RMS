"""Bar & Restaurant Management System — FastAPI + PostgreSQL backend."""
from __future__ import annotations

import asyncio
import logging
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional

import jwt
import os
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, update, delete, func, and_, or_, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .config import settings
from .database import (
    get_db, create_tables, engine,
    Branch, User, Room, Reservation, RoomCharge, Category, MenuItem,
    Ingredient, Recipe, Order, OrderItem, Shift,
    Supplier, AuditLog, HappyHour, WasteLog, RefreshToken,
    VoidRequest, SplitBill, InventoryDeduction,
)
from . import policies
from . import realtime
from .realtime import broadcast_entity_update
from .middleware import security_headers_middleware, api_rate_limit_middleware

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ── Security ────────────────────────────────────────────────────────────────
import bcrypt as _bcrypt

def hash_password(pw: str) -> str:
    return _bcrypt.hashpw(pw.encode("utf-8"), _bcrypt.gensalt(12)).decode("utf-8")

def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False

def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {"sub": user_id, "email": email, "role": role,
               "exp": datetime.now(timezone.utc) + timedelta(minutes=60), "type": "access"}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)

def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "refresh"}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)

# ── Tax constants (Ethiopia) — matches Eltrade A3 fiscal register ────────────
VAT_RATE = 0.15  # 15% VAT only — no service charge, no TOT (matches Eltrade receipt)

def calc_totals(subtotal: float, discount: float = 0) -> dict:
    after   = max(0.0, subtotal - discount)
    vat     = round(after * VAT_RATE, 2)
    total   = round(after + vat, 2)
    return {
        "subtotal":        round(after, 2),
        "service_charge":  0.0,   # not used — kept for DB column compatibility
        "vat_amount":      vat,
        "tot_amount":      0.0,   # not used — kept for DB column compatibility
        "discount_amount": round(discount, 2),
        "total_amount":    total,
    }

# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(title="Bar & Restaurant Management System")

CORS_ORIGINS = settings.frontend_url.split(",") + [
    "http://localhost:3000", "http://localhost:5173",
    "http://127.0.0.1:3000", "http://127.0.0.1:5173",
]

app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS,
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.middleware("http")(security_headers_middleware)
app.middleware("http")(api_rate_limit_middleware)

# ── Auth helpers ─────────────────────────────────────────────────────────────
_user_cache: dict = {}
_CACHE_TTL = 60

def _cache_get(token: str):
    e = _user_cache.get(token)
    if e and e[1] > time.monotonic(): return e[0]
    _user_cache.pop(token, None); return None

def _cache_set(token: str, user: dict):
    if len(_user_cache) > 500:
        oldest = sorted(_user_cache.items(), key=lambda x: x[1][1])[:100]
        for k, _ in oldest: _user_cache.pop(k, None)
    _user_cache[token] = (user, time.monotonic() + _CACHE_TTL)

def _cookie_secure() -> bool:
    return settings.frontend_url.startswith("https")

def _set_auth_cookies(response: Response, access: str, refresh: str | None = None):
    secure = _cookie_secure()
    samesite = "none" if secure else "lax"
    response.set_cookie("access_token", access, httponly=True, secure=secure,
                        samesite=samesite, max_age=3600, path="/")
    if refresh:
        response.set_cookie("refresh_token", refresh, httponly=True, secure=secure,
                            samesite=samesite, max_age=604800, path="/")

def _delete_auth_cookies(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")

async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "): token = auth[7:]
    if not token: raise HTTPException(401, "Not authenticated")
    cached = _cache_get(token)
    if cached: return cached
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        if payload.get("type") != "access": raise HTTPException(401, "Invalid token type")
        row = await db.get(User, payload["sub"])
        if not row or not row.is_active: raise HTTPException(401, "User not found or inactive")
        u = {"id": row.id, "email": row.email, "name": row.name, "role": row.role,
             "branch_id": row.branch_id or "", "force_password_change": row.force_password_change}
        _cache_set(token, u); return u
    except jwt.ExpiredSignatureError: raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:     raise HTTPException(401, "Invalid token")

async def log_audit(db, user_id: str, user_name: str, action: str,
                    entity_type: str, entity_id: str = "", details: str = "", branch_id: str = ""):
    """Write an audit log entry — safe to call from background tasks using a fresh session."""
    from .database import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as fresh_db:
            fresh_db.add(AuditLog(
                id=str(uuid.uuid4()), user_id=user_id or "", user_name=user_name or "",
                action=action or "", entity_type=entity_type or "", entity_id=entity_id or "",
                details=details or "", branch_id=branch_id or "",
            ))
            await fresh_db.commit()
    except Exception as exc:
        logger.warning("Audit log failed: %s", exc)


async def _resolve_bid(user: dict, db: AsyncSession, requested: str | None = None) -> str:
    """Resolve branch_id for any user. Owner falls back to first branch automatically."""
    if policies.is_super_admin(user):
        if requested:
            return requested
        first = (await db.execute(select(Branch).limit(1))).scalar_one_or_none()
        if first:
            return first.id
        raise HTTPException(400, "No branches found")
    bid = user.get("branch_id") or ""
    if not bid:
        raise HTTPException(400, "User is not assigned to a branch")
    return bid

def _row(obj) -> dict:
    """Convert a SQLAlchemy model instance to a plain dict."""
    d = {}
    for col in obj.__table__.columns:
        v = getattr(obj, col.name)
        if isinstance(v, datetime): v = v.isoformat()
        d[col.name] = v
    return d

# ── Pydantic models ───────────────────────────────────────────────────────────
class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserCreate(BaseModel):
    email: EmailStr; password: str; name: str; role: str = "cashier"

class EmployeeCreate(BaseModel):
    email: EmailStr; password: str; name: str; role: str; phone: str
    salary: float = 0; hire_date: str = ""; branch_id: Optional[str] = None

class EmployeeUpdate(BaseModel):
    name: Optional[str] = None; phone: Optional[str] = None; role: Optional[str] = None
    salary: Optional[float] = None; hire_date: Optional[str] = None
    password: Optional[str] = None; is_active: Optional[bool] = None

class ChangePasswordRequest(BaseModel):
    current_password: str; new_password: str

class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None; phone: Optional[str] = None

class MenuItemCreate(BaseModel):
    name: str; name_am: Optional[str] = None; category: str
    price: float; cost_price: float = 0; description: Optional[str] = None
    is_alcohol: bool = False; is_available: bool = True; prep_time: int = 10
    route_to: str = "kitchen"; deduct_on_order: bool = False; branch_id: Optional[str] = None

class MenuItemUpdate(BaseModel):
    name: Optional[str] = None; name_am: Optional[str] = None
    category: Optional[str] = None; price: Optional[float] = None
    cost_price: Optional[float] = None; description: Optional[str] = None
    is_alcohol: Optional[bool] = None; is_available: Optional[bool] = None
    prep_time: Optional[int] = None; route_to: Optional[str] = None; deduct_on_order: Optional[bool] = None

class IngredientCreate(BaseModel):
    name: str; unit: str; cost_per_unit: float = 0
    current_stock: float = 0; min_stock_level: float = 0
    supplier_id: Optional[str] = None; branch_id: Optional[str] = None

class IngredientUpdate(BaseModel):
    name: Optional[str] = None; unit: Optional[str] = None
    cost_per_unit: Optional[float] = None; current_stock: Optional[float] = None
    min_stock_level: Optional[float] = None

class RecipeCreate(BaseModel):
    menu_item_id: str; ingredients: List[dict]; instructions: Optional[str] = None; prep_time: int = 10

class RoomCreate(BaseModel):
    name: str; description: Optional[str] = None; capacity_min: int = 2; capacity_max: int = 20
    hourly_rate: Optional[float] = None; minimum_spend: float = 0
    amenities: List[str] = []; floor_plan_x: Optional[int] = None
    floor_plan_y: Optional[int] = None; branch_id: Optional[str] = None

class RoomUpdate(BaseModel):
    name: Optional[str] = None; description: Optional[str] = None
    capacity_min: Optional[int] = None; capacity_max: Optional[int] = None
    hourly_rate: Optional[float] = None; minimum_spend: Optional[float] = None
    amenities: Optional[List[str]] = None; status: Optional[str] = None

class RoomStatusUpdate(BaseModel):
    status: str

class ReservationCreate(BaseModel):
    room_id: str; customer_name: str; phone: str; email: Optional[str] = None
    party_size: int; start_datetime: str; end_datetime: str
    notes: Optional[str] = None; deposit_amount: Optional[float] = None
    deposit_paid: bool = False; deposit_method: Optional[str] = None
    minimum_spend_agreed: float = 0; special_requests: Optional[List[str]] = []

class ReservationUpdate(BaseModel):
    customer_name: Optional[str] = None; phone: Optional[str] = None
    email: Optional[str] = None; party_size: Optional[int] = None
    start_datetime: Optional[str] = None; end_datetime: Optional[str] = None
    notes: Optional[str] = None; deposit_amount: Optional[float] = None
    deposit_paid: Optional[bool] = None; deposit_method: Optional[str] = None
    status: Optional[str] = None; assigned_server_id: Optional[str] = None

class OrderItemCreate(BaseModel):
    menu_item_id: str; menu_item_name: str; quantity: int; unit_price: float
    modifiers: Optional[List[str]] = []; kitchen_note: Optional[str] = None; course: Optional[str] = None

class OrderCreate(BaseModel):
    room_id: Optional[str] = None; table_number: Optional[str] = None
    reservation_id: Optional[str] = None; order_type: str = "dine_in"
    order_source: str = "table"; items: List[OrderItemCreate]
    notes: Optional[str] = None; idempotency_key: Optional[str] = Field(default=None, max_length=64)

class OrderStatusUpdate(BaseModel):
    status: str; void_reason: Optional[str] = None

class OrderPayment(BaseModel):
    payment_method: str        # cash, card, credit, telebirr
    payment_reference: Optional[str] = None
    tip_amount: float = 0
    discount_amount: float = 0
    split_payments: Optional[List[dict]] = []

class VoidRequestCreate(BaseModel):
    order_id: str
    reason: str

class VoidRequestReview(BaseModel):
    status: str                # approved, rejected
    note: Optional[str] = None

class SplitBillCreate(BaseModel):
    order_id: str
    split_type: str            # item, even, custom
    splits: List[dict]         # [{label, amount, items?, payment_method?}]

class SplitPaymentRecord(BaseModel):
    split_bill_id: str
    split_index: int
    payment_method: str        # cash, card, telebirr
    payment_reference: Optional[str] = None

class DepositRecord(BaseModel):
    deposit_amount: float
    deposit_paid: bool = True
    deposit_method: str        # cash, card, telebirr

class ShiftClose(BaseModel):
    actual_cash: float         # physical cash counted in drawer

class SupplierCreate(BaseModel):
    name: str; email: Optional[str] = None; phone: str
    address: Optional[str] = None; contact_person: Optional[str] = None

class BranchCreate(BaseModel):
    name: str; address: Optional[str] = None; phone: Optional[str] = None; manager_name: Optional[str] = None

class CategoryCreate(BaseModel):
    name: str; description: Optional[str] = None

class HappyHourCreate(BaseModel):
    name: str; start_time: str; end_time: str
    days_of_week: List[int] = [1,2,3,4,5]; discount_percent: float
    applicable_categories: List[str] = []; branch_id: Optional[str] = None

class WasteLogCreate(BaseModel):
    ingredient_id: str; ingredient_name: str; quantity: float
    unit: str; reason: str; notes: Optional[str] = None

class ShiftAction(BaseModel):
    action: str

# ── Branch helpers ─────────────────────────────────────────────────────────────
def _resolve_branch(user: dict, requested: Optional[str] = None) -> str:
    if policies.is_super_admin(user):
        if requested: return requested
        raise HTTPException(400, "Select a branch")
    return user.get("branch_id") or (_ for _ in ()).throw(HTTPException(400, "Not assigned to a branch"))

async def _resolve_branch_for_order(user: dict, db: AsyncSession, requested: Optional[str] = None) -> str:
    if policies.is_super_admin(user):
        if requested: return requested
        row = await db.execute(select(Branch).limit(1))
        b = row.scalar_one_or_none()
        if b: return b.id
        raise HTTPException(400, "No branches found")
    return user.get("branch_id") or (_ for _ in ()).throw(HTTPException(400, "Not assigned to a branch"))

def _scope(user: dict, q):
    if policies.is_super_admin(user): return q
    return q.where(text("branch_id = :bid").bindparams(bid=user.get("branch_id") or "__none__"))

# ── Health ─────────────────────────────────────────────────────────────────────
@app.get("/health/live")
async def liveness(): return {"status": "ok"}

@app.get("/health/ready")
async def readiness(db: AsyncSession = Depends(get_db)):
    try:
        await db.execute(text("SELECT 1"))
        return {"status": "ok", "db": "postgresql"}
    except Exception as e:
        raise HTTPException(503, f"DB error: {e}")

@app.get("/api")
async def root(): return {"message": "Bar & Restaurant Management System API"}

@app.get("/api/health")
async def api_health(db: AsyncSession = Depends(get_db)):
    try:
        await db.execute(text("SELECT 1"))
        return {"status": "ok", "db": "postgresql"}
    except Exception as e:
        raise HTTPException(503, f"DB error: {e}")

# ══════════════════════════════════════════════════════════════════════════════
# AUTH
# ══════════════════════════════════════════════════════════════════════════════
@app.post("/api/auth/login")
async def login(creds: UserLogin, response: Response, request: Request, db: AsyncSession = Depends(get_db)):
    policies.rate_limiter.check(policies.rate_limit_key(request, "login"), settings.rate_limit_login_per_minute)
    row = (await db.execute(select(User).where(User.email == creds.email.lower()))).scalar_one_or_none()
    if not row or not verify_password(creds.password, row.password_hash):
        # Log failed login
        asyncio.create_task(log_audit(None, "system", "system", "login_failed", "auth",
                                       creds.email, f"Failed login from {request.client.host if request.client else 'unknown'}"))
        raise HTTPException(401, "Invalid credentials")
    if not row.is_active:
        raise HTTPException(403, "Account deactivated. Contact your manager.")
    access  = create_access_token(row.id, row.email, row.role)
    refresh = create_refresh_token(row.id)
    db.add(RefreshToken(id=str(uuid.uuid4()), token=refresh, user_id=row.id,
                        expires_at=datetime.now(timezone.utc) + timedelta(days=7)))
    await db.commit()
    _set_auth_cookies(response, access, refresh)
    asyncio.create_task(log_audit(None, row.id, row.name, "login_success", "auth",
                                   row.id, f"{row.role} logged in from {request.client.host if request.client else 'unknown'}",
                                   branch_id=row.branch_id or ""))
    return {"id": row.id, "email": row.email, "name": row.name, "role": row.role,
            "force_password_change": row.force_password_change}

@app.post("/api/auth/logout")
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    rt = request.cookies.get("refresh_token")
    if rt:
        await db.execute(update(RefreshToken).where(RefreshToken.token == rt).values(revoked=True))
        await db.commit()
    _delete_auth_cookies(response)
    return {"message": "Logged out"}

@app.get("/api/auth/me")
async def me(user=Depends(get_current_user)): return user

@app.post("/api/auth/refresh")
async def refresh_token(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    token = request.cookies.get("refresh_token")
    if not token: raise HTTPException(401, "No refresh token")
    row = (await db.execute(select(RefreshToken).where(RefreshToken.token == token,
                                                        RefreshToken.revoked == False))).scalar_one_or_none()
    if not row or row.expires_at < datetime.now(timezone.utc):
        raise HTTPException(401, "Invalid or expired refresh token")
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user = await db.get(User, payload["sub"])
        if not user: raise HTTPException(401, "User not found")
        await db.execute(update(RefreshToken).where(RefreshToken.token == token).values(revoked=True))
        new_access   = create_access_token(user.id, user.email, user.role)
        new_refresh  = create_refresh_token(user.id)
        db.add(RefreshToken(id=str(uuid.uuid4()), token=new_refresh, user_id=user.id,
                            expires_at=datetime.now(timezone.utc) + timedelta(days=7)))
        await db.commit()
        _set_auth_cookies(response, new_access, new_refresh)
        return {"message": "Token refreshed"}
    except jwt.PyJWTError: raise HTTPException(401, "Invalid token")

@app.put("/api/auth/change-password")
async def change_password(data: ChangePasswordRequest, request: Request, response: Response,
                           db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    row = await db.get(User, user["id"])
    if not row.force_password_change:
        if not verify_password(data.current_password, row.password_hash):
            raise HTTPException(400, "Current password is incorrect")
    policies.validate_password(data.new_password)
    row.password_hash = hash_password(data.new_password)
    row.force_password_change = False
    await db.execute(update(RefreshToken).where(RefreshToken.user_id == user["id"]).values(revoked=True))
    await db.commit()
    asyncio.create_task(log_audit(None, user["id"], user.get("name",""), "password_changed", "auth",
        user["id"], "User changed their own password"))
    new_access  = create_access_token(row.id, row.email, row.role)
    new_refresh = create_refresh_token(row.id)
    db.add(RefreshToken(id=str(uuid.uuid4()), token=new_refresh, user_id=row.id,
                        expires_at=datetime.now(timezone.utc) + timedelta(days=7)))
    await db.commit()
    _set_auth_cookies(response, new_access, new_refresh)
    return {"message": "Password changed"}

@app.put("/api/auth/profile")
async def update_profile(data: UpdateProfileRequest, db: AsyncSession = Depends(get_db),
                          user=Depends(get_current_user)):
    row = await db.get(User, user["id"])
    if data.name: row.name = data.name.strip()
    if data.phone is not None: row.phone = data.phone.strip()
    await db.commit()
    return {"id": row.id, "email": row.email, "name": row.name, "role": row.role}

# ── WebSocket token ────────────────────────────────────────────────────────────
@app.get("/api/realtime/token")
async def ws_token(user=Depends(get_current_user)):
    token = realtime.create_ws_access_token(user["id"], user["role"],
                                             settings.jwt_secret, settings.jwt_algorithm)
    return {"token": token, "expires_in": 300}

# ══════════════════════════════════════════════════════════════════════════════
# BRANCHES
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/branches")
async def get_branches(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    # Only owner sees all branches; manager sees only their own; others: no access
    if user["role"] not in (policies.ROLE_SUPER_ADMIN, policies.ROLE_BRANCH_ADMIN):
        raise HTTPException(403, "Access denied")
    if policies.is_super_admin(user):
        rows = (await db.execute(select(Branch))).scalars().all()
    elif user.get("branch_id"):
        rows = [(await db.get(Branch, user["branch_id"]))]
        rows = [r for r in rows if r]
    else:
        rows = []
    return [_row(r) for r in rows]

@app.post("/api/branches")
async def create_branch(data: BranchCreate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    policies.require_super_admin(user)
    b = Branch(id=str(uuid.uuid4()), **data.model_dump())
    db.add(b); await db.commit()
    return _row(b)

@app.put("/api/branches/{bid}")
async def update_branch(bid: str, data: BranchCreate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    policies.require_super_admin(user)
    b = await db.get(Branch, bid)
    if not b: raise HTTPException(404, "Branch not found")
    for k, v in data.model_dump().items():
        setattr(b, k, v)
    await db.commit(); return _row(b)

# ══════════════════════════════════════════════════════════════════════════════
# EMPLOYEES
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/employees")
async def get_employees(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in policies.EMPLOYEE_MANAGE_ROLES: raise HTTPException(403, "Access denied")
    q = select(User)
    if policies.is_super_admin(user):
        q = q.where(User.role != policies.ROLE_SUPER_ADMIN)
    else:
        q = q.where(User.branch_id == user.get("branch_id"), User.role != policies.ROLE_SUPER_ADMIN)
    rows = (await db.execute(q)).scalars().all()
    return [_row(r) for r in rows]

@app.post("/api/employees")
async def create_employee(data: EmployeeCreate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in policies.EMPLOYEE_MANAGE_ROLES: raise HTTPException(403, "Access denied")
    if not policies.can_assign_role(user, data.role): raise HTTPException(403, "Cannot assign this role")
    policies.validate_password(data.password)
    existing = (await db.execute(select(User).where(User.email == data.email.lower()))).scalar_one_or_none()
    if existing: raise HTTPException(400, "Email already exists")
    branch_id = data.branch_id if policies.is_super_admin(user) else user.get("branch_id")
    emp = User(id=str(uuid.uuid4()), email=data.email.lower(),
               password_hash=hash_password(data.password), name=data.name,
               role=data.role, phone=data.phone, salary=data.salary,
               hire_date=data.hire_date, branch_id=branch_id,
               force_password_change=True)
    db.add(emp); await db.commit()
    await broadcast_entity_update("employee", "created", {"id": emp.id, "name": emp.name, "role": emp.role})
    asyncio.create_task(log_audit(None, user["id"], user["name"], "employee_created", "employee",
        emp.id, f"Created {emp.role}: {emp.name} ({emp.email})", branch_id=emp.branch_id or ""))
    return _row(emp)

@app.put("/api/employees/{eid}")
async def update_employee(eid: str, data: EmployeeUpdate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in policies.EMPLOYEE_MANAGE_ROLES: raise HTTPException(403, "Access denied")
    emp = await db.get(User, eid)
    if not emp: raise HTTPException(404, "Employee not found")
    if data.name:     emp.name     = data.name
    if data.phone:    emp.phone    = data.phone
    if data.role:     emp.role     = data.role
    if data.salary is not None: emp.salary   = data.salary
    if data.hire_date: emp.hire_date = data.hire_date
    if data.password:
        policies.validate_password(data.password)
        emp.password_hash = hash_password(data.password)
    if data.is_active is not None: emp.is_active = data.is_active
    await db.commit()
    await broadcast_entity_update("employee", "updated", {"id": eid})
    asyncio.create_task(log_audit(None, user["id"], user["name"], "employee_updated", "employee",
        eid, f"Updated staff: {emp.name}", branch_id=emp.branch_id or ""))
    return _row(emp)

@app.delete("/api/employees/{eid}")
async def delete_employee(eid: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in policies.EMPLOYEE_MANAGE_ROLES: raise HTTPException(403, "Access denied")
    if eid == user["id"]: raise HTTPException(400, "Cannot delete yourself")
    target = await db.get(User, eid)
    name = target.name if target else eid
    branch = target.branch_id if target else ""
    await db.execute(delete(User).where(User.id == eid))
    await db.commit()
    await broadcast_entity_update("employee", "deleted", {"id": eid})
    asyncio.create_task(log_audit(None, user["id"], user["name"], "employee_deleted", "employee",
        eid, f"Deleted staff: {name}", branch_id=branch or ""))
    return {"message": "Employee deleted"}

@app.post("/api/employees/{eid}/reset-password")
async def reset_employee_password(eid: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Manager resets a staff password to a temp value and forces change on next login."""
    if user["role"] not in policies.EMPLOYEE_MANAGE_ROLES: raise HTTPException(403, "Access denied")
    emp = await db.get(User, eid)
    if not emp: raise HTTPException(404, "Employee not found")
    import secrets as _sec
    temp_pw = _sec.token_urlsafe(8)  # e.g. "xK3mPq2R"
    emp.password_hash = hash_password(temp_pw)
    emp.force_password_change = True
    await db.commit()
    asyncio.create_task(log_audit(None, user["id"], user["name"], "password_reset_by_manager", "employee",
        eid, f"Password reset for {emp.name}", branch_id=emp.branch_id or ""))
    return {"message": f"Password reset. Temp password: {temp_pw}", "temp_password": temp_pw, "force_password_change": True}

@app.put("/api/employees/{eid}/toggle-status")
async def toggle_status(eid: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in policies.EMPLOYEE_MANAGE_ROLES: raise HTTPException(403, "Access denied")
    emp = await db.get(User, eid)
    if not emp: raise HTTPException(404, "Employee not found")
    emp.is_active = not emp.is_active
    await db.commit()
    action = "employee_activated" if emp.is_active else "employee_deactivated"
    asyncio.create_task(log_audit(None, user["id"], user["name"], action, "employee",
        eid, f"{emp.name} {'activated' if emp.is_active else 'deactivated'}",
        branch_id=emp.branch_id or ""))
    return {"id": eid, "is_active": emp.is_active}

# ══════════════════════════════════════════════════════════════════════════════
# MENU ITEMS
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/menu-items")
async def get_menu_items(db: AsyncSession = Depends(get_db), user=Depends(get_current_user),
                          category: Optional[str] = None, route_to: Optional[str] = None,
                          search: Optional[str] = None, available_only: bool = False,
                          skip: int = 0, limit: int = 200):
    q = select(MenuItem)
    if not policies.is_super_admin(user): q = q.where(MenuItem.branch_id == user.get("branch_id"))
    if category:       q = q.where(MenuItem.category == category)
    if route_to:       q = q.where(MenuItem.route_to == route_to)
    if available_only: q = q.where(MenuItem.is_available == True)
    if search:
        q = q.where(or_(MenuItem.name.ilike(f"%{search}%"), MenuItem.name_am.ilike(f"%{search}%")))
    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar()
    rows  = (await db.execute(q.offset(skip).limit(limit))).scalars().all()

    # Load all recipes and ingredients once for out-of-stock detection
    menu_ids = [r.id for r in rows]
    recipes = {}
    if menu_ids:
        recipe_rows = (await db.execute(select(Recipe).where(Recipe.menu_item_id.in_(menu_ids)))).scalars().all()
        for recipe in recipe_rows:
            recipes[recipe.menu_item_id] = recipe

    # Load all ingredient stocks
    all_ingredient_ids = set()
    for recipe in recipes.values():
        for ing_spec in (recipe.ingredients or []):
            if ing_spec.get("ingredient_id"):
                all_ingredient_ids.add(ing_spec["ingredient_id"])

    ingredient_stocks = {}
    if all_ingredient_ids:
        ing_rows = (await db.execute(select(Ingredient).where(Ingredient.id.in_(all_ingredient_ids)))).scalars().all()
        for ing in ing_rows:
            ingredient_stocks[ing.id] = ing.current_stock

    # Build result with out_of_stock flag
    items_out = []
    for r in rows:
        d = _row(r)
        recipe = recipes.get(r.id)
        out_of_stock = False
        if recipe:
            for ing_spec in (recipe.ingredients or []):
                ing_id  = ing_spec.get("ingredient_id")
                qty_needed = float(ing_spec.get("quantity", 0))
                stock = ingredient_stocks.get(ing_id, 0)
                if ing_id and qty_needed > 0 and stock < qty_needed:
                    out_of_stock = True
                    break
        d["out_of_stock"] = out_of_stock
        items_out.append(d)

    return {"items": items_out, "total": total, "skip": skip, "limit": limit}

@app.post("/api/menu-items")
async def create_menu_item(data: MenuItemCreate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in policies.INVENTORY_ROLES: raise HTTPException(403, "Access denied")
    branch_id = await _resolve_bid(user, db, data.branch_id)
    m = MenuItem(id=str(uuid.uuid4()), branch_id=branch_id, **{k:v for k,v in data.model_dump().items() if k != "branch_id"})
    db.add(m); await db.commit()
    await broadcast_entity_update("menu_item", "created", {"id": m.id})
    return _row(m)

@app.get("/api/menu-items/{item_id}")
async def get_menu_item(item_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    m = await db.get(MenuItem, item_id)
    if not m: raise HTTPException(404, "Menu item not found")
    return _row(m)

@app.put("/api/menu-items/{item_id}")
async def update_menu_item(item_id: str, data: MenuItemUpdate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in policies.INVENTORY_ROLES: raise HTTPException(403, "Access denied")
    m = await db.get(MenuItem, item_id)
    if not m: raise HTTPException(404, "Menu item not found")
    for k, v in data.model_dump(exclude_none=True).items(): setattr(m, k, v)
    await db.commit()
    await broadcast_entity_update("menu_item", "updated", {"id": item_id})
    return _row(m)

@app.delete("/api/menu-items/{item_id}")
async def delete_menu_item(item_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in policies.INVENTORY_ROLES: raise HTTPException(403, "Access denied")
    await db.execute(delete(MenuItem).where(MenuItem.id == item_id))
    await db.commit()
    await broadcast_entity_update("menu_item", "deleted", {"id": item_id})
    return {"message": "Deleted"}

@app.post("/api/menu-items/{item_id}/toggle-availability")
async def toggle_menu_availability(item_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    m = await db.get(MenuItem, item_id)
    if not m: raise HTTPException(404, "Not found")
    m.is_available = not m.is_available; await db.commit()
    await broadcast_entity_update("menu_item", "updated", {"id": item_id, "is_available": m.is_available})
    asyncio.create_task(log_audit(None, user["id"], user["name"],
        "menu_item_available" if m.is_available else "menu_item_86d", "menu_item",
        item_id, f"{'Reactivated' if m.is_available else '86d'}: {m.name}",
        branch_id=m.branch_id or ""))
    return {"id": item_id, "is_available": m.is_available}

# ══════════════════════════════════════════════════════════════════════════════
# INGREDIENTS
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/ingredients")
async def get_ingredients(db: AsyncSession = Depends(get_db), user=Depends(get_current_user), search: Optional[str] = None):
    # Only management can view ingredients
    if user["role"] not in policies.INVENTORY_ROLES: raise HTTPException(403, "Access denied")
    q = select(Ingredient)
    if not policies.is_super_admin(user): q = q.where(Ingredient.branch_id == user.get("branch_id"))
    if search: q = q.where(Ingredient.name.ilike(f"%{search}%"))
    return [_row(r) for r in (await db.execute(q)).scalars().all()]

@app.post("/api/ingredients")
async def create_ingredient(data: IngredientCreate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in policies.INVENTORY_ROLES: raise HTTPException(403, "Access denied")
    branch_id = await _resolve_bid(user, db, data.branch_id)
    ing = Ingredient(id=str(uuid.uuid4()), branch_id=branch_id, **{k:v for k,v in data.model_dump().items() if k != "branch_id"})
    db.add(ing); await db.commit(); return _row(ing)

@app.put("/api/ingredients/{iid}")
async def update_ingredient(iid: str, data: IngredientUpdate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in policies.INVENTORY_ROLES: raise HTTPException(403, "Access denied")
    ing = await db.get(Ingredient, iid)
    if not ing: raise HTTPException(404, "Not found")
    for k, v in data.model_dump(exclude_none=True).items(): setattr(ing, k, v)
    await db.commit(); return _row(ing)

@app.post("/api/ingredients/{iid}/adjust-stock")
async def adjust_ingredient(iid: str, quantity: float, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in policies.INVENTORY_ROLES: raise HTTPException(403, "Access denied")
    ing = await db.get(Ingredient, iid)
    if not ing: raise HTTPException(404, "Not found")
    ing.current_stock = round(ing.current_stock + quantity, 4)
    await db.commit(); return _row(ing)

# ══════════════════════════════════════════════════════════════════════════════
# RECIPES
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/recipes")
async def get_recipes(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    return [_row(r) for r in (await db.execute(select(Recipe))).scalars().all()]

@app.post("/api/recipes")
async def create_recipe(data: RecipeCreate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in policies.INVENTORY_ROLES: raise HTTPException(403, "Access denied")
    # Upsert — if recipe exists for this menu item, update it
    existing = (await db.execute(select(Recipe).where(Recipe.menu_item_id == data.menu_item_id))).scalar_one_or_none()
    if existing:
        existing.ingredients = data.ingredients
        existing.instructions = data.instructions
        existing.prep_time = data.prep_time
        await db.commit()
        return _row(existing)
    r = Recipe(id=str(uuid.uuid4()), **data.model_dump())
    db.add(r); await db.commit(); return _row(r)

@app.get("/api/recipes/{menu_item_id}")
async def get_recipe(menu_item_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    r = (await db.execute(select(Recipe).where(Recipe.menu_item_id == menu_item_id))).scalar_one_or_none()
    if not r: raise HTTPException(404, "Recipe not found")
    return _row(r)

# ══════════════════════════════════════════════════════════════════════════════
# ROOMS
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/rooms")
async def get_rooms(db: AsyncSession = Depends(get_db), user=Depends(get_current_user), status: Optional[str] = None):
    if user["role"] not in policies.ROOM_ACCESS_ROLES: raise HTTPException(403, "Access denied")
    q = select(Room)
    if not policies.is_super_admin(user): q = q.where(Room.branch_id == user.get("branch_id"))
    if status: q = q.where(Room.occupancy_status == status)
    return [_row(r) for r in (await db.execute(q)).scalars().all()]

@app.post("/api/rooms")
async def create_room(data: RoomCreate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in policies.INVENTORY_ROLES: raise HTTPException(403, "Access denied")
    branch_id = await _resolve_bid(user, db, data.branch_id)
    rm = Room(id=str(uuid.uuid4()), branch_id=branch_id,
              **{k:v for k,v in data.model_dump().items() if k != "branch_id"})
    db.add(rm); await db.commit()
    await broadcast_entity_update("room", "created", {"id": rm.id})
    asyncio.create_task(log_audit(None, user["id"], user["name"], "room_created", "room",
        rm.id, f"Room created: {rm.name}", branch_id=branch_id))
    return _row(rm)

@app.get("/api/rooms/{rid}")
async def get_room(rid: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    r = await db.get(Room, rid)
    if not r: raise HTTPException(404, "Room not found")
    return _row(r)

@app.put("/api/rooms/{rid}")
async def update_room(rid: str, data: RoomUpdate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in policies.INVENTORY_ROLES: raise HTTPException(403, "Access denied")
    r = await db.get(Room, rid)
    if not r: raise HTTPException(404, "Room not found")
    for k, v in data.model_dump(exclude_none=True).items(): setattr(r, k, v)
    await db.commit()
    await broadcast_entity_update("room", "updated", {"id": rid})
    return _row(r)

@app.patch("/api/rooms/{rid}/status")
async def update_room_status(rid: str, data: RoomStatusUpdate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in policies.ROOM_ACCESS_ROLES: raise HTTPException(403, "Access denied")
    if data.status not in {"available", "occupied", "reserved", "dirty"}: raise HTTPException(400, "Invalid status")
    r = await db.get(Room, rid)
    if not r: raise HTTPException(404, "Room not found")
    r.occupancy_status = data.status; await db.commit()
    await broadcast_entity_update("room", "updated", {"id": rid, "occupancy_status": data.status})
    asyncio.create_task(log_audit(None, user["id"], user["name"], "room_status_changed", "room",
        rid, f"Room status → {data.status}", branch_id=r.branch_id or ""))
    return {"id": rid, "occupancy_status": data.status}

@app.delete("/api/rooms/{rid}")
async def delete_room(rid: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in policies.INVENTORY_ROLES: raise HTTPException(403, "Access denied")
    await db.execute(delete(Room).where(Room.id == rid))
    await db.commit()
    await broadcast_entity_update("room", "deleted", {"id": rid})
    return {"message": "Room deleted"}

# ══════════════════════════════════════════════════════════════════════════════
# ROOM CHARGES — fee payment for room usage
# ══════════════════════════════════════════════════════════════════════════════
class RoomChargeCreate(BaseModel):
    room_id: str
    reservation_id: Optional[str] = None
    customer_name: str
    customer_phone: Optional[str] = None
    party_size: Optional[int] = None
    start_datetime: Optional[str] = None
    end_datetime: Optional[str] = None
    hours: Optional[float] = None
    hourly_rate: Optional[float] = None
    room_fee: float
    payment_method: str = "cash"
    payment_reference: Optional[str] = None
    notes: Optional[str] = None

@app.post("/api/room-charges")
async def create_room_charge(data: RoomChargeCreate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Cashier charges a customer for room usage — separate from food/drink orders."""
    if user["role"] not in policies.PAYMENT_ROLES: raise HTTPException(403, "Only cashiers can process room charges")
    branch_id = await _resolve_bid(user, db)
    charge = RoomCharge(
        id=str(uuid.uuid4()),
        room_id=data.room_id,
        reservation_id=data.reservation_id,
        customer_name=data.customer_name,
        customer_phone=data.customer_phone,
        party_size=data.party_size,
        start_datetime=data.start_datetime,
        end_datetime=data.end_datetime,
        hours=data.hours,
        hourly_rate=data.hourly_rate,
        room_fee=data.room_fee,
        payment_method=data.payment_method,
        payment_reference=data.payment_reference,
        notes=data.notes,
        cashier_id=user["id"],
        cashier_name=user["name"],
        branch_id=branch_id,
    )
    db.add(charge)
    await db.commit()
    asyncio.create_task(log_audit(None, user["id"], user["name"], "room_charge_collected", "room",
        data.room_id, f"Room fee {data.room_fee:.2f} ETB from {data.customer_name} via {data.payment_method}",
        branch_id=branch_id))
    await broadcast_entity_update("room", "charge_collected", {"id": data.room_id, "room_fee": data.room_fee})
    return _row(charge)

@app.get("/api/room-charges")
async def get_room_charges(db: AsyncSession = Depends(get_db), user=Depends(get_current_user),
                            room_id: Optional[str] = None, date_from: Optional[str] = None,
                            date_to: Optional[str] = None, skip: int = 0, limit: int = 100):
    """Room history — all charges with customer info. Accessible to owner, manager, room_manager, cashier."""
    if user["role"] not in policies.ROOM_ACCESS_ROLES: raise HTTPException(403, "Access denied")
    q = select(RoomCharge)
    if not policies.is_super_admin(user): q = q.where(RoomCharge.branch_id == user.get("branch_id"))
    if room_id:    q = q.where(RoomCharge.room_id == room_id)
    if date_from:  q = q.where(RoomCharge.created_at >= date_from)
    if date_to:    q = q.where(RoomCharge.created_at <= date_to)
    q = q.order_by(RoomCharge.created_at.desc())
    rows = (await db.execute(q.offset(skip).limit(limit))).scalars().all()
    # Enrich with room name
    result = []
    for c in rows:
        d = _row(c)
        room = await db.get(Room, c.room_id)
        d["room_name"] = room.name if room else ""
        result.append(d)
    return result

@app.get("/api/rooms/{rid}/history")
async def get_room_history(rid: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user),
                            skip: int = 0, limit: int = 50):
    """Full history for a specific room — charges + orders linked to room."""
    if user["role"] not in policies.ROOM_ACCESS_ROLES: raise HTTPException(403, "Access denied")
    room = await db.get(Room, rid)
    if not room: raise HTTPException(404, "Room not found")
    # Room charges (fee payments)
    charges = (await db.execute(
        select(RoomCharge).where(RoomCharge.room_id == rid)
        .order_by(RoomCharge.created_at.desc()).offset(skip).limit(limit)
    )).scalars().all()
    # Past orders linked to this room
    orders = (await db.execute(
        select(Order).where(Order.room_id == rid)
        .options(selectinload(Order.items))
        .order_by(Order.created_at.desc()).offset(skip).limit(limit)
    )).scalars().all()
    return {
        "room": _row(room),
        "charges": [_row(c) for c in charges],
        "orders": [_order_to_dict(o) for o in orders],
        "total_revenue": sum(c.room_fee for c in charges) + sum(o.total_amount for o in orders if o.payment_status == "paid"),
    }

# ══════════════════════════════════════════════════════════════════════════════
# RESERVATIONS
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/reservations")
async def get_reservations(db: AsyncSession = Depends(get_db), user=Depends(get_current_user),
                            room_id: Optional[str] = None, status: Optional[str] = None, date: Optional[str] = None):
    if user["role"] not in policies.ROOM_ACCESS_ROLES: raise HTTPException(403, "Access denied")
    q = select(Reservation)
    if not policies.is_super_admin(user): q = q.where(Reservation.branch_id == user.get("branch_id"))
    if room_id: q = q.where(Reservation.room_id == room_id)
    if status:  q = q.where(Reservation.status == status)
    if date:    q = q.where(Reservation.start_datetime.like(f"{date}%"))
    q = q.order_by(Reservation.start_datetime)
    return [_row(r) for r in (await db.execute(q)).scalars().all()]

@app.post("/api/reservations")
async def create_reservation(data: ReservationCreate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    # CHANGE: Only management + room manager can create reservations
    if user["role"] not in policies.RESERVATION_MANAGE_ROLES: raise HTTPException(403, "Access denied")
    # Conflict check
    conflict = (await db.execute(
        select(Reservation).where(
            Reservation.room_id == data.room_id,
            Reservation.status.in_(["confirmed", "seated"]),
            Reservation.start_datetime < data.end_datetime,
            Reservation.end_datetime > data.start_datetime,
        )
    )).scalar_one_or_none()
    if conflict: raise HTTPException(409, "Room already booked for this time slot")
    room = await db.get(Room, data.room_id)
    if not room: raise HTTPException(404, "Room not found")
    res = Reservation(id=str(uuid.uuid4()), branch_id=room.branch_id,
                      created_by=user["id"], created_by_name=user["name"], **data.model_dump())
    db.add(res)
    room.occupancy_status = "reserved"
    await db.commit()
    await broadcast_entity_update("reservation", "created", {"id": res.id, "customer_name": res.customer_name})
    await broadcast_entity_update("room", "updated", {"id": room.id, "occupancy_status": "reserved"})
    asyncio.create_task(log_audit(None, user["id"], user["name"], "reservation_created", "reservation",
        res.id, f"{res.customer_name} | {res.phone} | {res.party_size} guests | {res.start_datetime[:10]}",
        branch_id=room.branch_id))
    return _row(res)

@app.get("/api/reservations/{rid}")
async def get_reservation(rid: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    r = await db.get(Reservation, rid)
    if not r: raise HTTPException(404, "Not found")
    return _row(r)

@app.put("/api/reservations/{rid}")
async def update_reservation(rid: str, data: ReservationUpdate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    # CHANGE: Only management + room manager can edit reservations
    if user["role"] not in policies.RESERVATION_MANAGE_ROLES: raise HTTPException(403, "Access denied")
    res = await db.get(Reservation, rid)
    if not res: raise HTTPException(404, "Not found")
    for k, v in data.model_dump(exclude_none=True).items(): setattr(res, k, v)
    if data.status == "seated":
        res.actual_start_time = datetime.now(timezone.utc).isoformat()
        room = await db.get(Room, res.room_id)
        if room: room.occupancy_status = "occupied"
        await broadcast_entity_update("room", "updated", {"id": res.room_id, "occupancy_status": "occupied"})
    elif data.status in ("completed", "cancelled", "no-show"):
        res.actual_end_time = datetime.now(timezone.utc).isoformat()
        room = await db.get(Room, res.room_id)
        if room:
            room.occupancy_status = "dirty" if data.status == "completed" else "available"
            await broadcast_entity_update("room", "updated", {"id": res.room_id, "occupancy_status": room.occupancy_status})
    await db.commit()
    await broadcast_entity_update("reservation", "updated", {"id": rid, "status": data.status})
    if data.status in ("seated", "completed", "cancelled", "no-show"):
        asyncio.create_task(log_audit(None, user["id"], user["name"],
            f"reservation_{data.status.replace('-','_')}", "reservation", rid,
            f"Reservation → {data.status} | {res.customer_name}",
            branch_id=res.branch_id))
    return _row(res)

# ══════════════════════════════════════════════════════════════════════════════
# ORDERS
# ══════════════════════════════════════════════════════════════════════════════
@app.post("/api/orders")
async def create_order(data: OrderCreate, request: Request, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in policies.ORDER_ROLES: raise HTTPException(403, "Access denied")
    # Rate limit order creation — max 30 orders per minute per user
    policies.rate_limiter.check(
        f"{user['id']}:create_order", 30, window_seconds=60
    )
    # Sanitize notes — strip dangerous content
    if data.notes:
        import re as _re
        data = data.model_copy(update={"notes": _re.sub(r'[<>"\']', '', data.notes)[:500]})
    # Owner must assign a server (notes must contain the assignment tag)
    if user["role"] == policies.ROLE_SUPER_ADMIN:
        if not data.notes or "[Owner Order" not in data.notes:
            raise HTTPException(400, "Owner orders must have an assigned server. Use the Order Ticket to select a server.")
    ikey = data.idempotency_key or request.headers.get("Idempotency-Key")
    if ikey:
        existing = (await db.execute(select(Order).where(Order.idempotency_key == ikey)
                                     .options(selectinload(Order.items)))).scalar_one_or_none()
        if existing: return _order_to_dict(existing)
    if not data.items: raise HTTPException(400, "Order must have at least one item")
    branch_id = await _resolve_branch_for_order(user, db)
    item_ids = [i.menu_item_id for i in data.items]
    menu_rows = (await db.execute(select(MenuItem).where(MenuItem.id.in_(item_ids)))).scalars().all()
    menu_map = {m.id: m for m in menu_rows}

    # ── Check for active Happy Hour ──────────────────────────────────────────
    now_dt   = datetime.now(timezone.utc)
    now_time = now_dt.strftime("%H:%M")
    now_dow  = now_dt.isoweekday()  # 1=Mon … 7=Sun
    hh_rows  = (await db.execute(select(HappyHour).where(
        HappyHour.is_active == True, HappyHour.branch_id == branch_id
    ))).scalars().all()
    active_hh = next(
        (hh for hh in hh_rows if now_dow in (hh.days_of_week or [])
         and hh.start_time <= now_time <= hh.end_time),
        None
    )
    hh_discount_pct = float(active_hh.discount_percent) / 100 if active_hh else 0.0
    hh_categories   = set(active_hh.applicable_categories or []) if active_hh else set()

    subtotal = 0.0
    order_items = []
    for i in data.items:
        m = menu_map.get(i.menu_item_id)
        if not m: raise HTTPException(404, f"Menu item not found: {i.menu_item_name}")
        if not m.is_available: raise HTTPException(400, f"{i.menu_item_name} is currently unavailable")
        # Company rule: bartender can only order bar/drink items — no food at the bar
        if user["role"] == policies.ROLE_BARTENDER and m.route_to != "bar":
            raise HTTPException(400, f"Bartenders can only order drinks. '{i.menu_item_name}' is a food item — ask a server to place this order.")
        # Apply happy hour discount if applicable
        unit_price = i.unit_price
        if active_hh and (not hh_categories or m.category in hh_categories):
            unit_price = round(unit_price * (1 - hh_discount_pct), 2)
        lt = round(unit_price * i.quantity, 2); subtotal += lt
        order_items.append(OrderItem(
            id=str(uuid.uuid4()), menu_item_id=i.menu_item_id, menu_item_name=i.menu_item_name,
            quantity=i.quantity, unit_price=unit_price, line_total=lt,
            modifiers=i.modifiers or [], kitchen_note=i.kitchen_note, course=i.course,
            route_to=m.route_to, status="pending",
        ))
    totals = calc_totals(subtotal)
    # Attach happy hour metadata to notes if active
    notes = data.notes or ""
    if active_hh:
        notes = f"[Happy Hour: {active_hh.name} {active_hh.discount_percent}% off] {notes}".strip()
    order = Order(id=str(uuid.uuid4()), branch_id=branch_id, server_id=user["id"],
                  server_name=user["name"], room_id=data.room_id, table_number=data.table_number,
                  reservation_id=data.reservation_id, order_type=data.order_type,
                  order_source=data.order_source, notes=notes, idempotency_key=ikey,
                  **totals, items=order_items)
    db.add(order)
    if data.room_id:
        room = await db.get(Room, data.room_id)
        if room: room.occupancy_status = "occupied"
        # Minimum spend check — warn in notes but don't block (cashier handles at payment)
        if room and room.minimum_spend > 0 and totals["subtotal"] < room.minimum_spend:
            order.notes = (order.notes or "") + f" [⚠️ Below minimum spend: {room.minimum_spend:.2f} ETB]"
    await db.commit()
    asyncio.create_task(broadcast_entity_update("order", "created", {
        "id": order.id, "status": "open", "room_id": data.room_id,
        "table_number": data.table_number, "server_name": user["name"],
        "total_amount": totals["total_amount"], "items_count": len(order_items),
    }))
    asyncio.create_task(log_audit(None, user["id"], user["name"], "order_created", "order",
        order.id,
        f"{len(order_items)} items · {totals['total_amount']:.2f} ETB"
        + (f" · Room" if data.room_id else f" · Table {data.table_number}" if data.table_number else ""),
        branch_id=branch_id))
    return _order_to_dict(order)

def _order_to_dict(order: Order) -> dict:
    d = _row(order)
    d["items"] = [_row(i) for i in order.items] if order.items else []
    return d

@app.get("/api/orders")
async def get_orders(db: AsyncSession = Depends(get_db), user=Depends(get_current_user),
                     status: Optional[str] = None, room_id: Optional[str] = None,
                     payment_status: Optional[str] = None,
                     limit: int = Query(default=50, ge=1, le=200),   # max 200 per page
                     skip: int = Query(default=0, ge=0),
                     start_date: Optional[str] = None, end_date: Optional[str] = None):
    q = select(Order).options(selectinload(Order.items))
    if not policies.is_super_admin(user):
        q = q.where(Order.branch_id == user.get("branch_id"))
    # CHANGE 4: Server + Bartender see ONLY their own orders
    if user["role"] in (policies.ROLE_SERVER, policies.ROLE_BARTENDER):
        q = q.where(Order.server_id == user["id"])
    if status:         q = q.where(Order.status == status)
    if payment_status: q = q.where(Order.payment_status == payment_status)
    if room_id:        q = q.where(Order.room_id == room_id)
    if start_date:     q = q.where(Order.created_at >= start_date)
    if end_date:       q = q.where(Order.created_at <= end_date)
    q = q.order_by(Order.created_at.desc()).offset(skip).limit(limit)
    return [_order_to_dict(r) for r in (await db.execute(q)).scalars().all()]

@app.get("/api/orders/kitchen")
async def kitchen_orders(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    # CHANGE 2: Only kitchen staff (and management) see kitchen display
    if user["role"] not in policies.KITCHEN_DISPLAY_ROLES: raise HTTPException(403, "Access denied")
    q = (select(Order).options(selectinload(Order.items))
         .where(Order.status.in_(["open", "sent_to_kitchen"]))
         .order_by(Order.created_at))
    if not policies.is_super_admin(user): q = q.where(Order.branch_id == user.get("branch_id"))
    orders = (await db.execute(q)).scalars().all()
    result = []
    for o in orders:
        if any(i.route_to == "kitchen" and i.status in ("pending", "preparing") for i in o.items):
            result.append(_order_to_dict(o))
    return result

@app.get("/api/orders/bar")
async def bar_orders(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    # CHANGE 2: Only bartenders (and management) see bar display
    if user["role"] not in policies.BAR_DISPLAY_ROLES: raise HTTPException(403, "Access denied")
    q = (select(Order).options(selectinload(Order.items))
         .where(Order.status.in_(["open", "sent_to_kitchen"]))
         .order_by(Order.created_at))
    if not policies.is_super_admin(user): q = q.where(Order.branch_id == user.get("branch_id"))
    orders = (await db.execute(q)).scalars().all()
    result = []
    for o in orders:
        if any(i.route_to == "bar" and i.status in ("pending", "preparing") for i in o.items):
            result.append(_order_to_dict(o))
    return result

@app.get("/api/orders/{oid}")
async def get_order(oid: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    o = (await db.execute(select(Order).where(Order.id == oid).options(selectinload(Order.items)))).scalar_one_or_none()
    if not o: raise HTTPException(404, "Order not found")
    return _order_to_dict(o)

@app.patch("/api/orders/{oid}/status")
async def update_order_status(oid: str, data: OrderStatusUpdate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    o = (await db.execute(select(Order).where(Order.id == oid).options(selectinload(Order.items)))).scalar_one_or_none()
    if not o: raise HTTPException(404, "Order not found")
    if data.status == "cancelled" and user["role"] not in policies.VOID_ROLES:
        raise HTTPException(403, "Only managers can void orders")
    o.status = data.status
    now = datetime.now(timezone.utc)
    if data.status == "sent_to_kitchen":
        for item in o.items:
            if item.status == "pending": item.status = "preparing"; item.sent_at = now
    elif data.status == "cancelled":
        o.is_voided = True; o.voided_at = now; o.void_reason = data.void_reason
        if o.room_id:
            other = (await db.execute(select(func.count(Order.id)).where(
                Order.room_id == o.room_id, Order.status.notin_(["closed","cancelled"]), Order.id != oid))).scalar()
            if other == 0:
                room = await db.get(Room, o.room_id)
                if room: room.occupancy_status = "dirty"
    await db.commit()
    await broadcast_entity_update("order", "updated", {"id": oid, "status": data.status, "room_id": o.room_id})
    # Audit log for significant status changes
    if data.status in ("sent_to_kitchen", "cancelled", "closed", "served"):
        asyncio.create_task(log_audit(None, user["id"], user["name"],
            f"order_{data.status}", "order", oid,
            f"Order status → {data.status}" + (f" | Reason: {data.void_reason}" if data.void_reason else ""),
            branch_id=o.branch_id))
    return _order_to_dict(o)

@app.patch("/api/orders/{oid}/items/{item_id}/status")
async def update_item_status(oid: str, item_id: str, status: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    o = (await db.execute(select(Order).where(Order.id == oid).options(selectinload(Order.items)))).scalar_one_or_none()
    if not o: raise HTTPException(404, "Order not found")
    now = datetime.now(timezone.utc)
    ready_item = None
    for item in o.items:
        if item.id == item_id:
            item.status = status
            if status == "ready":
                item.ready_at = now
                ready_item = item
            elif status == "served":
                item.served_at = now
    all_served = all(i.status in ("served","cancelled") for i in o.items)
    all_ready  = all(i.status in ("ready","served","cancelled") for i in o.items)
    if all_served: o.status = "served"
    elif all_ready: o.status = "ready"
    await db.commit()
    # Inventory deduction happens at payment time, not here
    await broadcast_entity_update("order", "item_ready", {
        "id": oid, "item_id": item_id, "status": status,
        "order_status": o.status,
        "menu_item_name": ready_item.menu_item_name if ready_item else "",
        "server_id": o.server_id,   # so server's UI can alert
    })
    return {"id": oid, "item_id": item_id, "status": status, "order_status": o.status}

@app.post("/api/orders/{oid}/items")
async def add_order_items(oid: str, items: List[OrderItemCreate], db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    o = (await db.execute(select(Order).where(Order.id == oid).options(selectinload(Order.items)))).scalar_one_or_none()
    if not o: raise HTTPException(404, "Not found")
    if o.status in ("closed","cancelled"): raise HTTPException(400, "Cannot add items to closed order")
    item_ids = [i.menu_item_id for i in items]
    menu_map = {m.id: m for m in (await db.execute(select(MenuItem).where(MenuItem.id.in_(item_ids)))).scalars().all()}
    added_sub = 0.0
    for i in items:
        m = menu_map.get(i.menu_item_id)
        if not m: raise HTTPException(404, f"Menu item not found: {i.menu_item_name}")
        lt = round(i.unit_price * i.quantity, 2); added_sub += lt
        o.items.append(OrderItem(id=str(uuid.uuid4()), order_id=oid,
            menu_item_id=i.menu_item_id, menu_item_name=i.menu_item_name,
            quantity=i.quantity, unit_price=i.unit_price, line_total=lt,
            modifiers=i.modifiers or [], kitchen_note=i.kitchen_note, course=i.course,
            route_to=m.route_to, status="pending"))
    totals = calc_totals(o.subtotal + added_sub, o.discount_amount)
    for k, v in totals.items(): setattr(o, k, v)
    await db.commit()
    await broadcast_entity_update("order", "updated", {"id": oid})
    return _order_to_dict(o)

@app.post("/api/orders/{oid}/pay")
async def pay_order(oid: str, data: OrderPayment, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in policies.PAYMENT_ROLES: raise HTTPException(403, "Only cashiers can process payments")
    # First load order to validate existence and voided state
    o = (await db.execute(select(Order).where(Order.id == oid).options(selectinload(Order.items)))).scalar_one_or_none()
    if not o: raise HTTPException(404, "Not found")
    if o.is_voided: raise HTTPException(400, "Cannot pay voided order")
    # Atomic optimistic lock: only update if still unpaid — prevents double payment race condition
    totals = calc_totals(o.subtotal, data.discount_amount)
    now_utc = datetime.now(timezone.utc)
    lock_result = await db.execute(
        update(Order)
        .where(Order.id == oid, Order.payment_status == "unpaid")
        .values(
            payment_status="paid",
            status="closed",
            payment_method=data.payment_method,
            payment_reference=data.payment_reference,
            tip_amount=data.tip_amount,
            split_payments=data.split_payments,
            paid_at=now_utc,
            paid_by=user["id"],
            paid_by_name=user["name"],
            discount_amount=totals["discount_amount"],
            vat_amount=totals["vat_amount"],
            total_amount=totals["total_amount"],
        )
    )
    if lock_result.rowcount == 0:
        # Either already paid by another request or does not exist
        await db.rollback()
        raise HTTPException(400, "Order already paid or payment in progress")
    # Refresh order object to reflect DB state
    await db.refresh(o)
    if o.room_id:
        other = (await db.execute(select(func.count(Order.id)).where(
            Order.room_id == o.room_id, Order.status.notin_(["closed","cancelled"]), Order.id != oid))).scalar()
        if other == 0:
            room = await db.get(Room, o.room_id)
            if room: room.occupancy_status = "dirty"
            await broadcast_entity_update("room", "updated", {"id": o.room_id, "occupancy_status": "dirty"})
    await db.commit()
    await db.refresh(o)
    # Deduct inventory for all items in this order now that payment is confirmed
    for oi in o.items:
        asyncio.create_task(_auto_deduct_ingredients(db, oi, o.branch_id))
    asyncio.create_task(log_audit(None, user["id"], user["name"], "order_paid", "order", oid,
                                   f"Paid {totals['total_amount']:.2f} ETB via {data.payment_method}",
                                   branch_id=o.branch_id))
    await broadcast_entity_update("order", "paid", {"id": oid, "total_amount": totals["total_amount"], "payment_method": data.payment_method})
    return _order_to_dict(o)

# ══════════════════════════════════════════════════════════════════════════════
# REPORTS
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/reports/floor-status")
async def floor_status(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    q = select(Room)
    if not policies.is_super_admin(user): q = q.where(Room.branch_id == user.get("branch_id"))
    rooms = (await db.execute(q)).scalars().all()
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    result = []
    for room in rooms:
        active_q = select(Order).where(Order.room_id == room.id, Order.status.notin_(["closed","cancelled"]))
        active_orders = (await db.execute(active_q.options(selectinload(Order.items)))).scalars().all()
        rev_q = select(func.sum(Order.total_amount)).where(
            Order.room_id == room.id, Order.payment_status == "paid", Order.paid_at >= today_start)
        today_rev = (await db.execute(rev_q)).scalar() or 0
        d = _row(room)
        d["active_orders"] = [{"id": o.id, "status": o.status, "total_amount": o.total_amount} for o in active_orders]
        d["active_orders_count"] = len(active_orders)
        d["today_revenue"] = float(today_rev)
        result.append(d)
    return result

@app.get("/api/reports/dashboard")
async def dashboard_stats(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday = today - timedelta(days=1)
    month_start = today.replace(day=1)
    bfilter = [] if policies.is_super_admin(user) else [Order.branch_id == user.get("branch_id")]
    rc_bfilter = [] if policies.is_super_admin(user) else [RoomCharge.branch_id == user.get("branch_id")]

    async def order_agg(start, end=None):
        q = select(func.sum(Order.total_amount), func.count(Order.id)).where(
            Order.created_at >= start,
            Order.payment_status == "paid",
            Order.is_voided == False,
            *bfilter)
        if end: q = q.where(Order.created_at < end)
        r = (await db.execute(q)).one()
        return float(r[0] or 0), int(r[1] or 0)

    async def room_charge_agg(start, end=None):
        """Sum room fee payments for a given period."""
        q = select(func.sum(RoomCharge.room_fee)).where(
            RoomCharge.created_at >= start, *rc_bfilter)
        if end: q = q.where(RoomCharge.created_at < end)
        r = (await db.execute(q)).scalar()
        return float(r or 0)

    today_rev, today_orders = await order_agg(today)
    yest_rev,  yest_orders  = await order_agg(yesterday, today)
    month_rev, month_orders = await order_agg(month_start)

    # Add room charges to revenue totals
    today_room_rev = await room_charge_agg(today)
    yest_room_rev  = await room_charge_agg(yesterday, today)
    month_room_rev = await room_charge_agg(month_start)

    today_rev  += today_room_rev
    yest_rev   += yest_room_rev
    month_rev  += month_room_rev

    room_q = select(Room)
    if not policies.is_super_admin(user): room_q = room_q.where(Room.branch_id == user.get("branch_id"))
    rooms = (await db.execute(room_q)).scalars().all()
    total_rooms    = len(rooms)
    occupied_rooms = sum(1 for r in rooms if r.occupancy_status == "occupied")
    reserved_rooms = sum(1 for r in rooms if r.occupancy_status == "reserved")

    menu_count  = (await db.execute(select(func.count(MenuItem.id)).where(*([MenuItem.branch_id == user.get("branch_id")] if not policies.is_super_admin(user) else [])))).scalar() or 0
    staff_count = (await db.execute(select(func.count(User.id)).where(*([User.branch_id == user.get("branch_id")] if not policies.is_super_admin(user) else []), User.role != policies.ROLE_SUPER_ADMIN))).scalar() or 0
    active_orders = (await db.execute(select(func.count(Order.id)).where(
        Order.status.in_(["open","sent_to_kitchen","ready","served"]), Order.payment_status == "unpaid", *bfilter))).scalar() or 0
    low_stock = (await db.execute(select(func.count(Ingredient.id)).where(
        Ingredient.current_stock <= Ingredient.min_stock_level, Ingredient.min_stock_level > 0, *([Ingredient.branch_id == user.get("branch_id")] if not policies.is_super_admin(user) else [])))).scalar() or 0

    return {
        "today_revenue": today_rev, "today_orders": today_orders,
        "today_room_charges": today_room_rev,
        "yesterday_revenue": yest_rev, "yesterday_orders": yest_orders,
        "revenue_change_pct": round(((today_rev - yest_rev) / yest_rev * 100), 1) if yest_rev > 0 else None,
        "orders_change_pct":  round(((today_orders - yest_orders) / yest_orders * 100), 1) if yest_orders > 0 else None,
        "month_revenue": month_rev, "month_orders": month_orders,
        "total_rooms": total_rooms, "occupied_rooms": occupied_rooms,
        "reserved_rooms": reserved_rooms, "available_rooms": total_rooms - occupied_rooms - reserved_rooms,
        "active_orders_count": active_orders, "total_menu_items": menu_count,
        "total_employees": staff_count, "low_stock_count": low_stock,
    }

@app.get("/api/reports/sales-by-date")
async def sales_by_date(days: int = 7, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    bfilter = [] if policies.is_super_admin(user) else [Order.branch_id == user.get("branch_id")]
    rows = (await db.execute(
        select(func.date(Order.created_at).label("date"),
               func.sum(Order.total_amount).label("revenue"),
               func.count(Order.id).label("orders"))
        .where(Order.created_at >= since, *bfilter)
        .group_by(func.date(Order.created_at))
        .order_by(func.date(Order.created_at))
    )).all()
    return [{"date": str(r.date), "revenue": float(r.revenue or 0), "orders": int(r.orders)} for r in rows]

@app.get("/api/reports/top-products")
async def top_products(limit: int = 10, days: int = 30, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    bfilter = [] if policies.is_super_admin(user) else [Order.branch_id == user.get("branch_id")]
    rows = (await db.execute(
        select(OrderItem.menu_item_id, OrderItem.menu_item_name,
               func.sum(OrderItem.quantity).label("total_quantity"),
               func.sum(OrderItem.line_total).label("total_revenue"))
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.created_at >= since, *bfilter)
        .group_by(OrderItem.menu_item_id, OrderItem.menu_item_name)
        .order_by(func.sum(OrderItem.line_total).desc())
        .limit(limit)
    )).all()
    return [{"product_id": r.menu_item_id, "product_name": r.menu_item_name,
             "total_quantity": int(r.total_quantity), "total_revenue": float(r.total_revenue or 0)} for r in rows]

@app.get("/api/reports/sales-by-category")
async def sales_by_category(days: int = 30, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    bfilter = [] if policies.is_super_admin(user) else [Order.branch_id == user.get("branch_id")]
    rows = (await db.execute(
        select(MenuItem.category,
               func.sum(OrderItem.line_total).label("revenue"),
               func.sum(OrderItem.quantity).label("quantity"))
        .join(OrderItem, OrderItem.menu_item_id == MenuItem.id)
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.created_at >= since, *bfilter)
        .group_by(MenuItem.category)
        .order_by(func.sum(OrderItem.line_total).desc())
    )).all()
    return [{"category": r.category, "revenue": float(r.revenue or 0), "quantity": int(r.quantity)} for r in rows]


@app.get("/api/reports/room-revenue")
async def room_revenue_report(days: int = 30, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Revenue breakdown per room with order count and avg spend."""
    if user["role"] not in (policies.ROLE_SUPER_ADMIN, policies.ROLE_BRANCH_ADMIN, policies.ROLE_ROOM_MANAGER):
        raise HTTPException(403, "Access denied")
    since = datetime.now(timezone.utc) - timedelta(days=days)
    bfilter = [] if policies.is_super_admin(user) else [Order.branch_id == user.get("branch_id")]
    rows = (await db.execute(
        select(
            Order.room_id,
            func.count(Order.id).label("order_count"),
            func.sum(Order.total_amount).label("revenue"),
            func.sum(Order.tip_amount).label("tips"),
            func.avg(Order.total_amount).label("avg_spend"),
        )
        .where(Order.room_id.isnot(None), Order.payment_status == "paid",
               Order.created_at >= since, *bfilter)
        .group_by(Order.room_id)
        .order_by(func.sum(Order.total_amount).desc())
    )).all()
    # Enrich with room names
    result = []
    for r in rows:
        room = await db.get(Room, r.room_id)
        result.append({
            "room_id":     r.room_id,
            "room_name":   room.name if room else r.room_id,
            "order_count": int(r.order_count),
            "revenue":     round(float(r.revenue or 0), 2),
            "tips":        round(float(r.tips or 0), 2),
            "avg_spend":   round(float(r.avg_spend or 0), 2),
        })
    return result


@app.get("/api/reports/staff-performance")
async def staff_performance_report(days: int = 30, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Per-server: order count, total sales, tips collected."""
    if user["role"] not in (policies.ROLE_SUPER_ADMIN, policies.ROLE_BRANCH_ADMIN):
        raise HTTPException(403, "Access denied")
    since = datetime.now(timezone.utc) - timedelta(days=days)
    bfilter = [] if policies.is_super_admin(user) else [Order.branch_id == user.get("branch_id")]
    rows = (await db.execute(
        select(
            Order.server_id,
            Order.server_name,
            func.count(Order.id).label("order_count"),
            func.sum(Order.total_amount).label("sales"),
            func.sum(Order.tip_amount).label("tips"),
        )
        .where(Order.payment_status == "paid", Order.created_at >= since, *bfilter)
        .group_by(Order.server_id, Order.server_name)
        .order_by(func.sum(Order.total_amount).desc())
    )).all()
    return [{"server_id": r.server_id, "server_name": r.server_name,
             "order_count": int(r.order_count), "sales": round(float(r.sales or 0), 2),
             "tips": round(float(r.tips or 0), 2)} for r in rows]

# ══════════════════════════════════════════════════════════════════════════════
# SUPPLIERS
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/suppliers")
async def get_suppliers(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in policies.INVENTORY_ROLES: raise HTTPException(403, "Access denied")
    q = select(Supplier)
    if not policies.is_super_admin(user): q = q.where(Supplier.branch_id == user.get("branch_id"))
    return [_row(r) for r in (await db.execute(q)).scalars().all()]

@app.post("/api/suppliers")
async def create_supplier(data: SupplierCreate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in policies.INVENTORY_ROLES: raise HTTPException(403, "Access denied")
    branch_id = await _resolve_bid(user, db)
    s = Supplier(id=str(uuid.uuid4()), branch_id=branch_id, **data.model_dump())
    db.add(s); await db.commit(); return _row(s)

@app.put("/api/suppliers/{sid}")
async def update_supplier(sid: str, data: SupplierCreate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in policies.INVENTORY_ROLES: raise HTTPException(403, "Access denied")
    s = await db.get(Supplier, sid)
    if not s: raise HTTPException(404, "Not found")
    for k, v in data.model_dump().items(): setattr(s, k, v)
    await db.commit(); return _row(s)

@app.delete("/api/suppliers/{sid}")
async def delete_supplier(sid: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in policies.INVENTORY_ROLES: raise HTTPException(403, "Access denied")
    await db.execute(delete(Supplier).where(Supplier.id == sid))
    await db.commit(); return {"message": "Deleted"}

# ══════════════════════════════════════════════════════════════════════════════
# CATEGORIES
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/categories")
async def get_categories(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    return [_row(r) for r in (await db.execute(select(Category))).scalars().all()]

@app.post("/api/categories")
async def create_category(data: CategoryCreate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in policies.INVENTORY_ROLES: raise HTTPException(403, "Access denied")
    c = Category(id=str(uuid.uuid4()), **data.model_dump())
    db.add(c); await db.commit(); return _row(c)

# ══════════════════════════════════════════════════════════════════════════════
# HAPPY HOURS
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/happy-hours")
async def get_happy_hours(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    q = select(HappyHour)
    if not policies.is_super_admin(user): q = q.where(HappyHour.branch_id == user.get("branch_id"))
    return [_row(r) for r in (await db.execute(q)).scalars().all()]

@app.post("/api/happy-hours")
async def create_happy_hour(data: HappyHourCreate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in policies.INVENTORY_ROLES: raise HTTPException(403, "Access denied")
    branch_id = await _resolve_bid(user, db, data.branch_id)
    hh = HappyHour(id=str(uuid.uuid4()), branch_id=branch_id, **{k:v for k,v in data.model_dump().items() if k != "branch_id"})
    db.add(hh); await db.commit(); return _row(hh)

# ══════════════════════════════════════════════════════════════════════════════
# WASTE LOG
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/waste-log")
async def get_waste_log(db: AsyncSession = Depends(get_db), user=Depends(get_current_user), limit: int = 100):
    if user["role"] not in policies.WASTE_LOG_ROLES: raise HTTPException(403, "Access denied")
    q = select(WasteLog).order_by(WasteLog.created_at.desc()).limit(limit)
    if not policies.is_super_admin(user): q = q.where(WasteLog.branch_id == user.get("branch_id"))
    return [_row(r) for r in (await db.execute(q)).scalars().all()]

@app.post("/api/waste-log")
async def log_waste(data: WasteLogCreate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    # CHANGE 3: Only kitchen, bartender, and management can log waste
    if user["role"] not in policies.WASTE_LOG_ROLES: raise HTTPException(403, "Access denied")
    w = WasteLog(id=str(uuid.uuid4()), logged_by=user["id"], logged_by_name=user["name"],
                 branch_id=user.get("branch_id") or (await _resolve_bid(user, db)), **data.model_dump())
    db.add(w)
    ing = await db.get(Ingredient, data.ingredient_id)
    if ing: ing.current_stock = max(0, ing.current_stock - abs(data.quantity))
    await db.commit()
    asyncio.create_task(log_audit(None, user["id"], user["name"], "waste_logged", "waste_log",
        w.id, f"{data.ingredient_name}: {data.quantity} {data.unit} | Reason: {data.reason}",
        branch_id=user.get("branch_id","") or ""))
    return _row(w)

# ══════════════════════════════════════════════════════════════════════════════
# SHIFTS
# ══════════════════════════════════════════════════════════════════════════════
@app.post("/api/shifts/start")
async def start_shift(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    existing = (await db.execute(select(Shift).where(Shift.user_id == user["id"], Shift.status == "open"))).scalar_one_or_none()
    if existing: raise HTTPException(400, "You already have an open shift")
    s = Shift(id=str(uuid.uuid4()), user_id=user["id"], user_name=user["name"],
              user_role=user["role"], start_time=datetime.now(timezone.utc),
              status="open", branch_id=user.get("branch_id"))
    db.add(s); await db.commit()
    asyncio.create_task(log_audit(None, user["id"], user["name"], "shift_started", "shift",
        s.id, f"{user['name']} started shift", branch_id=user.get("branch_id","") or ""))
    return _row(s)

@app.post("/api/shifts/end")
async def end_shift(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    s = (await db.execute(select(Shift).where(Shift.user_id == user["id"], Shift.status == "open"))).scalar_one_or_none()
    if not s: raise HTTPException(400, "No open shift")
    orders_q = select(Order).where(Order.server_id == user["id"], Order.created_at >= s.start_time)
    orders = (await db.execute(orders_q)).scalars().all()
    s.end_time = datetime.now(timezone.utc); s.status = "closed"
    s.total_sales = sum(o.total_amount for o in orders if o.payment_status == "paid")
    s.total_cash  = sum(o.total_amount for o in orders if o.payment_method == "cash" and o.payment_status == "paid")
    s.total_card  = sum(o.total_amount for o in orders if o.payment_method == "card" and o.payment_status == "paid")
    s.transaction_count = sum(1 for o in orders if o.payment_status == "paid")
    await db.commit()
    asyncio.create_task(log_audit(None, user["id"], user["name"], "shift_ended", "shift",
        s.id, f"Shift closed | {s.transaction_count} transactions | {s.total_sales:.2f} ETB",
        branch_id=user.get("branch_id","") or ""))
    return _row(s)

@app.get("/api/shifts/current")
async def current_shift(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    s = (await db.execute(select(Shift).where(Shift.user_id == user["id"], Shift.status == "open"))).scalar_one_or_none()
    return _row(s) if s else {"status": "none"}

@app.get("/api/shifts/history")
async def shift_history(limit: int = 20, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    q = select(Shift).order_by(Shift.created_at.desc()).limit(limit)
    # Managers see all shifts in their branch; others see only their own
    if user["role"] in (policies.ROLE_SUPER_ADMIN, policies.ROLE_BRANCH_ADMIN):
        if not policies.is_super_admin(user):
            q = q.where(Shift.branch_id == user.get("branch_id"))
    else:
        q = q.where(Shift.user_id == user["id"])
    return [_row(r) for r in (await db.execute(q)).scalars().all()]

# ══════════════════════════════════════════════════════════════════════════════
# AUDIT LOGS
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/audit-logs")
async def get_audit_logs(db: AsyncSession = Depends(get_db), user=Depends(get_current_user),
                          entity_type: Optional[str] = None, limit: int = 100):
    if user["role"] not in (policies.ROLE_SUPER_ADMIN, policies.ROLE_BRANCH_ADMIN): raise HTTPException(403, "Access denied")
    q = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)
    if not policies.is_super_admin(user): q = q.where(AuditLog.branch_id == user.get("branch_id"))
    if entity_type: q = q.where(AuditLog.entity_type == entity_type)
    return [_row(r) for r in (await db.execute(q)).scalars().all()]

# ══════════════════════════════════════════════════════════════════════════════
# WEBSOCKET
# ══════════════════════════════════════════════════════════════════════════════
@app.websocket("/ws/stock")
async def websocket_endpoint(ws: WebSocket, token: Optional[str] = Query(default=None)):
    if not token:
        await ws.close(code=4401, reason="Missing token"); return
    identity = realtime.verify_ws_access_token(token, settings.jwt_secret, settings.jwt_algorithm)
    if not identity:
        await ws.close(code=4401, reason="Invalid token"); return
    accepted = await realtime.manager.connect(ws, identity["user_id"], identity["role"])
    if not accepted:
        await ws.close(code=1013, reason="Capacity reached"); return
    realtime.manager.record_pong(ws)
    try:
        while True:
            raw = await ws.receive_text()
            realtime.manager.touch(ws)
            if raw in ("pong", '{"type":"pong"}'):
                realtime.manager.record_pong(ws)
    except WebSocketDisconnect:
        pass
    finally:
        await realtime.manager.disconnect(ws)

# ══════════════════════════════════════════════════════════════════════════════
# AUTO-DEDUCTION — deduct recipe ingredients when item marked ready
# ══════════════════════════════════════════════════════════════════════════════
async def _auto_deduct_ingredients(db: AsyncSession, order_item: OrderItem, branch_id: str):
    """Deduct recipe ingredients from stock when an item is marked ready."""
    try:
        recipe = (await db.execute(
            select(Recipe).where(Recipe.menu_item_id == order_item.menu_item_id)
        )).scalar_one_or_none()
        if not recipe or not recipe.ingredients:
            return
        for ing_spec in recipe.ingredients:
            ing_id  = ing_spec.get("ingredient_id")
            qty_per = float(ing_spec.get("quantity", 0))
            if not ing_id or qty_per <= 0:
                continue
            total_qty = round(qty_per * order_item.quantity, 4)
            ing = await db.get(Ingredient, ing_id)
            if not ing:
                continue
            ing.current_stock = max(0, ing.current_stock - total_qty)
            db.add(InventoryDeduction(
                id=str(uuid.uuid4()),
                order_id=order_item.order_id,
                order_item_id=order_item.id,
                menu_item_id=order_item.menu_item_id,
                menu_item_name=order_item.menu_item_name,
                ingredient_id=ing_id,
                ingredient_name=ing.name,
                quantity_deducted=total_qty,
                unit=ing.unit,
                branch_id=branch_id,
            ))
        await db.commit()
        logger.info("Auto-deducted ingredients for %s x%d", order_item.menu_item_name, order_item.quantity)
    except Exception as exc:
        logger.warning("Auto-deduction failed for %s: %s", order_item.menu_item_name, exc)

# ══════════════════════════════════════════════════════════════════════════════
# VOID REQUESTS (server requests → manager approves)
# ══════════════════════════════════════════════════════════════════════════════
@app.post("/api/void-requests")
async def create_void_request(data: VoidRequestCreate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Any FOH staff can request a void — manager must approve."""
    if user["role"] not in policies.ORDER_ROLES:
        raise HTTPException(403, "Access denied")
    order = (await db.execute(select(Order).where(Order.id == data.order_id)
                              .options(selectinload(Order.items)))).scalar_one_or_none()
    if not order: raise HTTPException(404, "Order not found")
    if order.is_voided: raise HTTPException(400, "Order already voided")
    if order.payment_status == "paid": raise HTTPException(400, "Cannot void a paid order")
    existing = (await db.execute(select(VoidRequest).where(
        VoidRequest.order_id == data.order_id, VoidRequest.status == "pending"
    ))).scalar_one_or_none()
    if existing: raise HTTPException(400, "A void request for this order is already pending")
    vr = VoidRequest(
        id=str(uuid.uuid4()), order_id=data.order_id,
        requested_by=user["id"], requested_by_name=user["name"],
        reason=data.reason, branch_id=order.branch_id,
    )
    db.add(vr); await db.commit()
    await broadcast_entity_update("void_request", "created", {
        "id": vr.id, "order_id": data.order_id,
        "requested_by_name": user["name"], "reason": data.reason,
    })
    return _row(vr)

@app.get("/api/void-requests")
async def get_void_requests(db: AsyncSession = Depends(get_db), user=Depends(get_current_user),
                             status: Optional[str] = "pending"):
    if user["role"] not in policies.VOID_ROLES and user["role"] not in policies.ORDER_ROLES:
        raise HTTPException(403, "Access denied")
    q = select(VoidRequest)
    if not policies.is_super_admin(user): q = q.where(VoidRequest.branch_id == user.get("branch_id"))
    # Non-managers only see their own requests
    if user["role"] not in policies.VOID_ROLES:
        q = q.where(VoidRequest.requested_by == user["id"])
    if status: q = q.where(VoidRequest.status == status)
    q = q.order_by(VoidRequest.created_at.desc())
    return [_row(r) for r in (await db.execute(q)).scalars().all()]

@app.patch("/api/void-requests/{vrid}/review")
async def review_void_request(vrid: str, data: VoidRequestReview, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Manager approves or rejects a void request."""
    if user["role"] not in policies.VOID_ROLES: raise HTTPException(403, "Only managers can approve voids")
    vr = await db.get(VoidRequest, vrid)
    if not vr: raise HTTPException(404, "Void request not found")
    if vr.status != "pending": raise HTTPException(400, f"Request is already {vr.status}")
    vr.status = data.status
    vr.reviewed_by = user["id"]
    vr.reviewed_by_name = user["name"]
    vr.reviewed_at = datetime.now(timezone.utc)
    if data.status == "approved":
        order = (await db.execute(select(Order).where(Order.id == vr.order_id)
                                  .options(selectinload(Order.items)))).scalar_one_or_none()
        if order:
            order.is_voided = True
            order.status = "cancelled"
            order.voided_at = datetime.now(timezone.utc)
            order.void_reason = vr.reason
            if order.room_id:
                other = (await db.execute(select(func.count(Order.id)).where(
                    Order.room_id == order.room_id,
                    Order.status.notin_(["closed", "cancelled"]),
                    Order.id != order.id,
                ))).scalar()
                if other == 0:
                    room = await db.get(Room, order.room_id)
                    if room: room.occupancy_status = "dirty"
    await db.commit()
    await broadcast_entity_update("void_request", "updated", {"id": vrid, "status": data.status})
    asyncio.create_task(log_audit(None, user["id"], user["name"],
                                   f"void_request_{data.status}", "void_request", vrid,
                                   f"{data.status.capitalize()} void for order {vr.order_id}",
                                   branch_id=vr.branch_id))
    return _row(vr)

# ══════════════════════════════════════════════════════════════════════════════
# SPLIT BILL
# ══════════════════════════════════════════════════════════════════════════════
@app.post("/api/split-bills")
async def create_split_bill(data: SplitBillCreate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Create a split bill for an order."""
    if user["role"] not in (policies.ORDER_ROLES | policies.PAYMENT_ROLES):
        raise HTTPException(403, "Access denied")
    order = (await db.execute(select(Order).where(Order.id == data.order_id)
                              .options(selectinload(Order.items)))).scalar_one_or_none()
    if not order: raise HTTPException(404, "Order not found")
    if order.payment_status == "paid": raise HTTPException(400, "Order already paid")
    # Mark each split as unpaid initially
    splits = []
    for i, s in enumerate(data.splits):
        splits.append({**s, "index": i, "paid": False, "paid_at": None, "payment_method": s.get("payment_method")})
    sb = SplitBill(
        id=str(uuid.uuid4()), order_id=data.order_id,
        split_type=data.split_type, splits=splits,
        total_amount=order.total_amount,
        created_by=user["id"], branch_id=order.branch_id,
    )
    db.add(sb); await db.commit()
    return _row(sb)

@app.get("/api/split-bills/{order_id}")
async def get_split_bill(order_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    sb = (await db.execute(select(SplitBill).where(SplitBill.order_id == order_id)
                           .order_by(SplitBill.created_at.desc()))).scalar_one_or_none()
    if not sb: raise HTTPException(404, "No split bill found for this order")
    return _row(sb)

@app.post("/api/split-bills/pay-split")
async def pay_split(data: SplitPaymentRecord, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Cashier records payment for one split of the bill."""
    if user["role"] not in policies.PAYMENT_ROLES: raise HTTPException(403, "Only cashiers can record payments")
    sb = await db.get(SplitBill, data.split_bill_id)
    if not sb: raise HTTPException(404, "Split bill not found")
    splits = list(sb.splits)
    if data.split_index >= len(splits): raise HTTPException(400, "Invalid split index")
    splits[data.split_index]["paid"] = True
    splits[data.split_index]["paid_at"] = datetime.now(timezone.utc).isoformat()
    splits[data.split_index]["payment_method"] = data.payment_method
    splits[data.split_index]["payment_reference"] = data.payment_reference
    sb.splits = splits
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(sb, "splits")
    all_paid = all(s.get("paid") for s in splits)
    if all_paid:
        order = (await db.execute(select(Order).where(Order.id == sb.order_id)
                                  .options(selectinload(Order.items)))).scalar_one_or_none()
        if order:
            order.payment_status = "paid"
            order.status = "closed"
            order.paid_at = datetime.now(timezone.utc)
            order.paid_by = user["id"]
            order.paid_by_name = user["name"]
            if order.room_id:
                room = await db.get(Room, order.room_id)
                if room:
                    room.occupancy_status = "dirty"
                    await broadcast_entity_update("room", "updated", {"id": order.room_id, "occupancy_status": "dirty"})
    await db.commit()
    await broadcast_entity_update("split_bill", "updated", {"id": sb.id, "all_paid": all_paid})
    return {**_row(sb), "all_paid": all_paid}

# ══════════════════════════════════════════════════════════════════════════════
# DEPOSIT RECORDING on reservations
# ══════════════════════════════════════════════════════════════════════════════
@app.post("/api/reservations/{rid}/deposit")
async def record_deposit(rid: str, data: DepositRecord, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Cashier or room manager records deposit payment for a reservation."""
    if user["role"] not in (policies.PAYMENT_ROLES | policies.RESERVATION_MANAGE_ROLES):
        raise HTTPException(403, "Access denied")
    res = await db.get(Reservation, rid)
    if not res: raise HTTPException(404, "Reservation not found")
    res.deposit_amount = data.deposit_amount
    res.deposit_paid   = data.deposit_paid
    res.deposit_method = data.deposit_method
    await db.commit()
    await broadcast_entity_update("reservation", "updated", {"id": rid, "deposit_paid": data.deposit_paid})
    return _row(res)

# ══════════════════════════════════════════════════════════════════════════════
# INVENTORY DEDUCTION LOG
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/inventory-deductions")
async def get_deductions(db: AsyncSession = Depends(get_db), user=Depends(get_current_user),
                          order_id: Optional[str] = None, limit: int = 100):
    if user["role"] not in policies.INVENTORY_ROLES: raise HTTPException(403, "Access denied")
    q = select(InventoryDeduction).order_by(InventoryDeduction.created_at.desc()).limit(limit)
    if not policies.is_super_admin(user): q = q.where(InventoryDeduction.branch_id == user.get("branch_id"))
    if order_id: q = q.where(InventoryDeduction.order_id == order_id)
    return [_row(r) for r in (await db.execute(q)).scalars().all()]

# ══════════════════════════════════════════════════════════════════════════════
# SHIFT RECONCILIATION (expected vs actual cash)
# ══════════════════════════════════════════════════════════════════════════════
@app.post("/api/shifts/close")
async def close_shift_with_reconciliation(data: ShiftClose, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Cashier closes shift with actual cash count for reconciliation."""
    s = (await db.execute(select(Shift).where(Shift.user_id == user["id"], Shift.status == "open"))).scalar_one_or_none()
    if not s: raise HTTPException(400, "No open shift")
    # Calculate expected cash from paid orders during this shift
    cash_orders = (await db.execute(
        select(func.sum(Order.total_amount)).where(
            Order.server_id == user["id"],
            Order.payment_method == "cash",
            Order.payment_status == "paid",
            Order.paid_at >= s.start_time,
        )
    )).scalar() or 0.0
    expected_cash = round(float(cash_orders), 2)
    actual_cash   = round(data.actual_cash, 2)
    discrepancy   = round(actual_cash - expected_cash, 2)
    # All orders in this shift
    all_paid = (await db.execute(
        select(Order).where(
            Order.server_id == user["id"],
            Order.payment_status == "paid",
            Order.paid_at >= s.start_time,
        )
    )).scalars().all()
    s.end_time          = datetime.now(timezone.utc)
    s.status            = "closed"
    s.total_sales       = sum(o.total_amount for o in all_paid)
    s.total_cash        = sum(o.total_amount for o in all_paid if o.payment_method == "cash")
    s.total_card        = sum(o.total_amount for o in all_paid if o.payment_method == "card")
    s.transaction_count = len(all_paid)
    # Store reconciliation data in a JSON column we'll add
    await db.commit()
    await broadcast_entity_update("shift", "closed", {
        "user_name": s.user_name, "expected_cash": expected_cash,
        "actual_cash": actual_cash, "discrepancy": discrepancy,
    })
    asyncio.create_task(log_audit(None, user["id"], user["name"], "shift_reconciled", "shift",
        s.id,
        f"Cash: expected={expected_cash:.2f} actual={actual_cash:.2f} discrepancy={discrepancy:.2f} ETB"
        + (" ⚠️ FLAG" if abs(discrepancy) > 5 else " ✓ OK"),
        branch_id=user.get("branch_id","") or ""))
    return {**_row(s), "expected_cash": expected_cash, "actual_cash": actual_cash,
            "discrepancy": discrepancy, "discrepancy_flag": abs(discrepancy) > 5}

# ══════════════════════════════════════════════════════════════════════════════
# BACKGROUND SCHEDULER — Auto-expiry & Daily Reset
# ══════════════════════════════════════════════════════════════════════════════

async def _background_scheduler():
    """Runs every minute: auto-expires rooms, daily order reset at 10:00 EAT."""
    logger.info("Background scheduler started")
    # Ethiopian time = UTC+3
    EAT_OFFSET = timedelta(hours=3)
    last_reset_date = None

    while True:
        try:
            await asyncio.sleep(60)  # check every minute
            now_utc = datetime.now(timezone.utc)
            now_eat = now_utc + EAT_OFFSET

            async with AsyncSessionLocal() as db:
                # ── A2: Auto-expire reservations past their end time ──────────
                # Reserved rooms whose end time has passed → set back to available
                expired_reservations = (await db.execute(
                    select(Reservation).where(
                        Reservation.status == "confirmed",
                        Reservation.end_datetime < now_utc.isoformat(),
                    )
                )).scalars().all()
                for res in expired_reservations:
                    res.status = "completed"
                    res.actual_end_time = now_utc.isoformat()
                    room = await db.get(Room, res.room_id)
                    if room and room.occupancy_status == "reserved":
                        room.occupancy_status = "available"
                        await broadcast_entity_update("room", "updated", {
                            "id": res.room_id, "occupancy_status": "available"
                        })
                    logger.info(f"Auto-expired reservation {res.id[:8]} for room {res.room_id[:8]}")

                if expired_reservations:
                    await db.commit()

                # ── A3: Daily order reset at 10:00 EAT ──────────────────────
                today_eat = now_eat.date()
                reset_hour = 10  # 10:00 AM Ethiopian time
                if (now_eat.hour == reset_hour and
                        now_eat.minute < 2 and  # within 2 min window
                        last_reset_date != today_eat):

                    last_reset_date = today_eat
                    logger.info(f"Daily order reset triggered at {now_eat.strftime('%H:%M')} EAT")

                    # Auto-void all unpaid orders from previous day
                    yesterday_start = (now_eat - timedelta(days=1)).replace(
                        hour=reset_hour, minute=0, second=0
                    ) - EAT_OFFSET
                    today_reset = now_eat.replace(
                        hour=reset_hour, minute=0, second=0
                    ) - EAT_OFFSET

                    stale_orders = (await db.execute(
                        select(Order).where(
                            Order.payment_status == "unpaid",
                            Order.is_voided == False,
                            Order.status.notin_(["closed", "cancelled", "served"]),  # don't void served orders
                            Order.created_at < today_reset,
                        ).options(selectinload(Order.items))
                    )).scalars().all()

                    # Extra guard: skip orders where items are actively being prepared or served
                    safe_to_void = []
                    for order in stale_orders:
                        active_items = [i for i in order.items if i.status in ("preparing", "ready", "served")]
                        if active_items:
                            logger.info(f"Skipping order {order.id[:8]} — has {len(active_items)} active items")
                            continue
                        safe_to_void.append(order)
                    stale_orders = safe_to_void

                    for order in stale_orders:
                        order.status = "cancelled"
                        order.is_voided = True
                        order.voided_at = now_utc
                        order.void_reason = "Auto-voided at daily reset (10:00 AM EAT)"
                        # Free associated room
                        if order.room_id:
                            other_active = (await db.execute(
                                select(func.count(Order.id)).where(
                                    Order.room_id == order.room_id,
                                    Order.status.notin_(["closed", "cancelled"]),
                                    Order.id != order.id,
                                )
                            )).scalar()
                            if other_active == 0:
                                room = await db.get(Room, order.room_id)
                                if room and room.occupancy_status in ("occupied",):
                                    room.occupancy_status = "dirty"
                        # Remove from kitchen/bar displays via broadcast
                        await broadcast_entity_update("order", "updated", {
                            "id": order.id, "status": "cancelled"
                        })

                    if stale_orders:
                        await db.commit()
                        logger.info(f"Daily reset: auto-voided {len(stale_orders)} unpaid orders")
                        asyncio.create_task(log_audit(None, "system", "system",
                            "daily_order_reset", "order", "",
                            f"Auto-voided {len(stale_orders)} unpaid orders at 10:00 EAT"))

        except asyncio.CancelledError:
            logger.info("Background scheduler stopped")
            break
        except Exception as exc:
            logger.warning(f"Background scheduler error: {exc}")

# ══════════════════════════════════════════════════════════════════════════════
# STARTUP / SHUTDOWN
# ══════════════════════════════════════════════════════════════════════════════
@app.on_event("startup")
async def startup():
    logger.info("Starting Bar & Restaurant — PostgreSQL backend...")
    await create_tables()
    await realtime.manager.start()
    asyncio.create_task(_seed())
    # Start background scheduler for auto-expiry and daily reset
    asyncio.create_task(_background_scheduler())

async def _seed():
    await asyncio.sleep(1)
    async with AsyncSessionLocal() as db:
        # Default branch — create only if none exists
        branch = (await db.execute(select(Branch))).scalar_one_or_none()
        if not branch:
            branch = Branch(id=str(uuid.uuid4()), name="Main Bar & Restaurant",
                            address="", phone="", manager_name="Owner")
            db.add(branch); await db.commit()
            logger.info(f"Created default branch: {branch.id}")

        # Owner account — create only if none exists
        admin_email = settings.admin_email or "owner@barrestaurant.com"
        admin_pw    = settings.admin_password or "owner123"
        owner = (await db.execute(select(User).where(User.email == admin_email))).scalar_one_or_none()
        if not owner:
            db.add(User(id=str(uuid.uuid4()), email=admin_email, password_hash=hash_password(admin_pw),
                        name="Owner", role=policies.ROLE_SUPER_ADMIN, branch_id=branch.id,
                        force_password_change=False))
            await db.commit()
            logger.info(f"Created owner account: {admin_email}")
    logger.info("Startup complete — system ready for fresh setup.")

from .database import AsyncSessionLocal

@app.on_event("shutdown")
async def shutdown():
    await realtime.manager.stop()
    await engine.dispose()
    logger.info("Shutdown complete.")

# ══════════════════════════════════════════════════════════════════════════════
# STATIC FILE SERVING — React frontend (production / Railway deployment)
# ══════════════════════════════════════════════════════════════════════════════
_FRONTEND_BUILD = os.path.join(os.path.dirname(__file__), "..", "frontend", "build")

if os.path.isdir(_FRONTEND_BUILD):
    # Serve JS/CSS/images from the React build folder
    app.mount("/static", StaticFiles(directory=os.path.join(_FRONTEND_BUILD, "static")), name="static")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_react(full_path: str):
        """Catch-all: serve index.html for any non-API route (React SPA routing)."""
        # Don't intercept API or WebSocket routes
        if full_path.startswith("api/") or full_path.startswith("ws"):
            raise HTTPException(404)
        index = os.path.join(_FRONTEND_BUILD, "index.html")
        if os.path.isfile(index):
            return FileResponse(index)
        raise HTTPException(404, "Frontend build not found")
