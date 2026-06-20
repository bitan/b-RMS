from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, Query, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse, Response as RawResponse
from starlette.middleware.cors import CORSMiddleware
import os
import logging
import io
import csv
import time
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
import asyncio
import jwt
import json
import secrets
from prometheus_client import Counter, Gauge, Histogram, generate_latest, CONTENT_TYPE_LATEST
from pymongo import UpdateOne

from .config import settings
from . import db as db_module
from .db import ObjectId, normalize_db_id, hash_password, verify_password, get_gridfs, hash_password_async, verify_password_async
from . import realtime
from .realtime import (
    broadcast_stock_update,
    broadcast_entity_update,
    create_ws_access_token,
    verify_ws_access_token,
)
from . import policies
from .policies import resolve_branch_id_for_sale
from .middleware import api_rate_limit_middleware, security_headers_middleware
from .email_utils import send_password_reset_email

ROOT_DIR = Path(__file__).parent

db = None

# Monitoring metrics
REQUEST_COUNT = Counter(
    "sms_api_requests_total",
    "Total HTTP requests processed",
    ["method", "endpoint", "http_status"],
)
REQUEST_LATENCY = Histogram(
    "sms_api_request_duration_seconds",
    "HTTP request latency in seconds",
    ["method", "endpoint"],
)

WS_EVENT_BROADCASTS = Counter(
    "sms_realtime_events_broadcast_total",
    "Total realtime stock update events broadcast",
)
WS_MISSED_EVENTS_DELIVERED = Counter(
    "sms_realtime_missed_events_delivered_total",
    "Total realtime missed events delivered to reconnecting clients",
)
WS_ACTIVE_CONNECTIONS = Gauge(
    "sms_realtime_active_connections",
    "Current number of active realtime websocket connections",
)
WS_ACTIVE_CONNECTIONS.set_function(lambda: realtime.manager.connection_count)
WS_MAX_CONNECTIONS = Gauge(
    "sms_realtime_max_connections",
    "Maximum configured realtime websocket connections",
)
WS_MAX_CONNECTIONS.set(settings.max_ws_connections if hasattr(settings, 'max_ws_connections') else 0)

# Use shared DB module instead of local initialization

# JWT Config
JWT_ALGORITHM = settings.jwt_algorithm

def get_jwt_secret() -> str:
    return settings.jwt_secret


def get_cookie_secure() -> bool:
    return settings.frontend_url.startswith("https")


def set_auth_cookies(response: Response, access_token: str, refresh_token: Optional[str] = None) -> None:
    secure = get_cookie_secure()
    samesite = "none" if secure else "lax"
    # Force SameSite=None for any HTTPS tunnel/deployment URL
    # This allows cookies to work cross-origin through Cloudflare/ngrok/Railway tunnels
    if not secure:
        frontend = settings.frontend_url.lower()
        if any(x in frontend for x in ["trycloudflare.com", "ngrok", "railway.app", "onrender.com", "vercel.app"]):
            secure = True
            samesite = "none"
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=secure,
        samesite=samesite,
        max_age=3600,
        path="/"
    )
    if refresh_token is not None:
        response.set_cookie(
            key="refresh_token",
            value=refresh_token,
            httponly=True,
            secure=secure,
            samesite=samesite,
            max_age=604800,
            path="/"
        )


def delete_auth_cookies(response: Response) -> None:
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")


async def save_refresh_token(token: str, user_id: str, expires_at: datetime, request: Request) -> None:
    await db.refresh_tokens.insert_one({
        "token": token,
        "user_id": user_id,
        "created_at": datetime.now(timezone.utc),
        "expires_at": expires_at,
        "revoked": False,
        "ip": request.client.host if request.client else "unknown",
        "user_agent": request.headers.get("User-Agent", "")[:512],
    })


async def revoke_refresh_token(token: str) -> None:
    await db.refresh_tokens.update_one(
        {"token": token, "revoked": False},
        {"$set": {"revoked": True, "revoked_at": datetime.now(timezone.utc)}}
    )


async def revoke_user_refresh_tokens(user_id: str) -> int:
    result = await db.refresh_tokens.update_many(
        {"user_id": user_id, "revoked": False},
        {"$set": {"revoked": True, "revoked_at": datetime.now(timezone.utc)}}
    )
    return getattr(result, "modified_count", 0)


async def delete_refresh_token(token: str) -> None:
    await db.refresh_tokens.delete_one({"token": token})


def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=60),
        "type": "access"
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)

def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "refresh"
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)

# Create the main app
app = FastAPI()

# CORS must be registered first so it runs on ALL responses including errors
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[
        "https://supermarket-management-system-4.onrender.com",
        "https://supermarket-management-system-production-beae.up.railway.app",
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
    ],
    allow_origin_regex=r"https://.*\.(onrender\.com|up\.railway\.app|vercel\.app)",
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def metrics_middleware(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    request_latency = time.time() - start
    endpoint = request.url.path
    REQUEST_COUNT.labels(
        method=request.method,
        endpoint=endpoint,
        http_status=str(response.status_code),
    ).inc()
    REQUEST_LATENCY.labels(
        method=request.method,
        endpoint=endpoint,
    ).observe(request_latency)
    return response


app.middleware("http")(security_headers_middleware)
app.middleware("http")(api_rate_limit_middleware)

@app.get("/metrics")
async def metrics():
    return RawResponse(generate_latest(), media_type=CONTENT_TYPE_LATEST)

@app.get("/health/live")
async def liveness():
    return {"status": "ok"}

@app.get("/health/ready")
async def readiness():
    status = {"status": "ok"}
    if db is None:
        raise HTTPException(status_code=503, detail="Database client not initialized")
    try:
        await db.command("ping")
        status["mongo"] = "ok"
    except Exception as exc:
        status["mongo"] = f"error: {exc}"
        raise HTTPException(status_code=503, detail=status)
    if getattr(realtime, "_redis", None) is not None:
        try:
            await realtime._redis.ping()
            status["redis"] = "ok"
        except Exception as exc:
            status["redis"] = f"error: {exc}"
            raise HTTPException(status_code=503, detail=status)
    else:
        status["redis"] = "disabled"
    return status

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ============ MODELS ============

class UserBase(BaseModel):
    email: EmailStr
    name: str
    role: str = "cashier"

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str = "cashier"

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    role: str
    created_at: str

# ── Menu Items (replaces Products) ──────────────────────────────────────────
class MenuItemCreate(BaseModel):
    name: str
    name_am: Optional[str] = None           # Amharic name
    category: str                            # Food, Drinks, Cocktails, etc.
    price: float
    cost_price: float
    description: Optional[str] = None
    is_alcohol: bool = False
    is_available: bool = True
    prep_time: int = 10                      # minutes
    route_to: str = "kitchen"               # "kitchen" | "bar"
    branch_id: Optional[str] = None

class MenuItemUpdate(BaseModel):
    name: Optional[str] = None
    name_am: Optional[str] = None
    category: Optional[str] = None
    price: Optional[float] = None
    cost_price: Optional[float] = None
    description: Optional[str] = None
    is_alcohol: Optional[bool] = None
    is_available: Optional[bool] = None
    prep_time: Optional[int] = None
    route_to: Optional[str] = None

# ── Ingredients & Recipes ────────────────────────────────────────────────────
class IngredientCreate(BaseModel):
    name: str
    unit: str           # kg, liter, ml, oz, piece, portion
    cost_per_unit: float
    current_stock: float = 0
    min_stock_level: float = 0
    supplier_id: Optional[str] = None
    branch_id: Optional[str] = None

class IngredientUpdate(BaseModel):
    name: Optional[str] = None
    unit: Optional[str] = None
    cost_per_unit: Optional[float] = None
    current_stock: Optional[float] = None
    min_stock_level: Optional[float] = None
    supplier_id: Optional[str] = None

class RecipeItem(BaseModel):
    ingredient_id: str
    ingredient_name: str
    quantity: float
    unit: str

class RecipeCreate(BaseModel):
    menu_item_id: str
    ingredients: List[RecipeItem]
    instructions: Optional[str] = None
    prep_time: int = 10

# ── Rooms ────────────────────────────────────────────────────────────────────
class RoomCreate(BaseModel):
    name: str
    description: Optional[str] = None
    capacity_min: int = 2
    capacity_max: int = 20
    hourly_rate: Optional[float] = None
    minimum_spend: float = 0
    amenities: List[str] = []           # ["projector","karaoke","private_bar"]
    floor_plan_x: Optional[int] = None
    floor_plan_y: Optional[int] = None
    branch_id: Optional[str] = None

class RoomUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    capacity_min: Optional[int] = None
    capacity_max: Optional[int] = None
    hourly_rate: Optional[float] = None
    minimum_spend: Optional[float] = None
    amenities: Optional[List[str]] = None
    status: Optional[str] = None        # active, maintenance, closed

class RoomStatusUpdate(BaseModel):
    status: str  # available, occupied, reserved, dirty

# ── Reservations ─────────────────────────────────────────────────────────────
class ReservationCreate(BaseModel):
    room_id: str
    customer_name: str
    phone: str
    email: Optional[str] = None
    party_size: int
    start_datetime: str     # ISO 8601
    end_datetime: str
    notes: Optional[str] = None
    deposit_amount: Optional[float] = None
    deposit_paid: bool = False
    deposit_method: Optional[str] = None
    minimum_spend_agreed: float = 0
    special_requests: Optional[List[str]] = []

class ReservationUpdate(BaseModel):
    customer_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    party_size: Optional[int] = None
    start_datetime: Optional[str] = None
    end_datetime: Optional[str] = None
    notes: Optional[str] = None
    deposit_amount: Optional[float] = None
    deposit_paid: Optional[bool] = None
    deposit_method: Optional[str] = None
    special_requests: Optional[List[str]] = None
    status: Optional[str] = None       # confirmed, seated, completed, cancelled, no-show
    assigned_server_id: Optional[str] = None

# ── Orders (replaces Sales) ───────────────────────────────────────────────────
class OrderItemCreate(BaseModel):
    menu_item_id: str
    menu_item_name: str
    quantity: int
    unit_price: float
    modifiers: Optional[List[str]] = []  # ["no ice", "extra spicy", "well done"]
    kitchen_note: Optional[str] = None
    course: Optional[str] = None        # appetizer, main, dessert, drinks

class OrderCreate(BaseModel):
    room_id: Optional[str] = None
    table_number: Optional[str] = None
    reservation_id: Optional[str] = None
    order_type: str = "dine_in"         # dine_in, takeaway, delivery, bar
    order_source: str = "table"         # room, table, bar_counter
    items: List[OrderItemCreate]
    notes: Optional[str] = None
    idempotency_key: Optional[str] = Field(default=None, max_length=64)

class OrderItemStatusUpdate(BaseModel):
    item_id: str
    status: str     # pending, preparing, ready, served, cancelled

class OrderStatusUpdate(BaseModel):
    status: str     # open, sent_to_kitchen, ready, served, closed, cancelled
    void_reason: Optional[str] = None

class OrderPayment(BaseModel):
    payment_method: str     # cash, card, credit
    payment_reference: Optional[str] = None
    tip_amount: Optional[float] = 0
    split_payments: Optional[List[dict]] = []  # [{method, amount}] for split bills
    discount_amount: Optional[float] = 0

# ── Happy Hour / Pricing Rules ────────────────────────────────────────────────
class HappyHourCreate(BaseModel):
    name: str
    start_time: str     # "17:00"
    end_time: str       # "19:00"
    days_of_week: List[int] = [1,2,3,4,5]  # 1=Mon…7=Sun
    discount_percent: float
    applicable_categories: List[str] = []
    branch_id: Optional[str] = None

# ── Waste / Spillage Logging ─────────────────────────────────────────────────
class WasteLogCreate(BaseModel):
    ingredient_id: str
    ingredient_name: str
    quantity: float
    unit: str
    reason: str     # spillage, expired, damaged, training
    notes: Optional[str] = None

# ── Room Turnover ─────────────────────────────────────────────────────────────
class TurnoverCreate(BaseModel):
    room_id: str
    reservation_id: Optional[str] = None
    checklist: dict = {}    # {"clean_surfaces": True, "replace_linens": False, ...}
    notes: Optional[str] = None

# Legacy aliases for backwards compat
class ProductBase(BaseModel):
    name: str
    sku: str
    category: str
    price: float
    cost_price: float
    quantity: int
    min_stock_level: int = 10
    supplier_id: Optional[str] = None
    barcode: Optional[str] = None
    description: Optional[str] = None
    expiry_date: Optional[str] = None
    branch_id: Optional[str] = None

class ProductCreate(ProductBase):
    pass

class ProductUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    price: Optional[float] = None
    cost_price: Optional[float] = None
    quantity: Optional[int] = None
    min_stock_level: Optional[int] = None
    supplier_id: Optional[str] = None
    barcode: Optional[str] = None
    description: Optional[str] = None
    expiry_date: Optional[str] = None
    branch_id: Optional[str] = None

class SupplierBase(BaseModel):
    name: str
    email: Optional[str] = None
    phone: str
    address: Optional[str] = None
    contact_person: Optional[str] = None

class SupplierCreate(SupplierBase):
    pass


class PurchaseOrderItem(BaseModel):
    product_id: str
    product_name: str
    quantity_ordered: int
    unit_cost: float


class PurchaseOrderCreate(BaseModel):
    supplier_id: str
    items: List[PurchaseOrderItem]
    notes: Optional[str] = None
    expected_delivery: Optional[str] = None


class PurchaseOrderReceive(BaseModel):
    items: List[dict]  # [{product_id, quantity_received}]
    notes: Optional[str] = None

class EmployeeBase(BaseModel):
    name: str
    email: EmailStr
    phone: str
    role: str
    salary: float
    hire_date: str

class EmployeeCreate(EmployeeBase):
    password: str
    branch_id: Optional[str] = None  # Super Admin can specify which branch

class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    salary: Optional[float] = None
    hire_date: Optional[str] = None
    password: Optional[str] = None  # if provided, will be re-hashed
    is_active: Optional[bool] = None  # deactivate/reactivate

class SaleItemBase(BaseModel):
    product_id: str
    product_name: str
    quantity: int
    price: float
    discount: float = 0

class SaleCreate(BaseModel):
    items: List[SaleItemBase]
    payment_method: str = "cash"
    customer_name: Optional[str] = None
    discount_total: float = 0
    promo_code: Optional[str] = None
    idempotency_key: Optional[str] = Field(default=None, max_length=64)

class CategoryCreate(BaseModel):
    name: str
    description: Optional[str] = None

class PromoCodeCreate(BaseModel):
    code: str
    discount_type: str = "percentage"  # percentage or fixed
    discount_value: float
    min_purchase: float = 0
    max_uses: int = 0  # 0 = unlimited
    expiry_date: Optional[str] = None
    active: bool = True

class PromoCodeApply(BaseModel):
    code: str
    subtotal: float

class ShiftCreate(BaseModel):
    action: str  # "start" or "end"

# ============ AUDIT LOG HELPER ============

async def log_audit(
    user_id: str,
    user_name: str,
    action: str,
    entity_type: str,
    entity_id: str = "",
    details: str = "",
    branch_id: str = "",
):
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "user_name": user_name,
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "details": details,
        "branch_id": branch_id,
        "created_at": datetime.now(timezone.utc).isoformat()
    })

# ============ BRANCH MODEL ============

class BranchCreate(BaseModel):
    name: str
    address: Optional[str] = None
    phone: Optional[str] = None
    manager_name: Optional[str] = None

# ============ AUTH HELPERS ============

# Short-lived in-memory user cache keyed by JWT token
# Avoids a MongoDB round-trip on every authenticated request
# TTL = 60 s (well within the 60-min JWT expiry)
import time as _time
_user_cache: dict = {}  # token -> (user_dict, expires_at_unix)
_USER_CACHE_TTL = 60  # seconds


def _cache_get(token: str):
    entry = _user_cache.get(token)
    if entry and entry[1] > _time.monotonic():
        return entry[0]
    if entry:
        del _user_cache[token]
    return None


def _cache_set(token: str, user: dict, ttl: int = _USER_CACHE_TTL):
    # Evict oldest entries if cache grows too large
    if len(_user_cache) > 500:
        oldest = sorted(_user_cache.items(), key=lambda x: x[1][1])[:100]
        for k, _ in oldest:
            _user_cache.pop(k, None)
    _user_cache[token] = (user, _time.monotonic() + ttl)


def _cache_invalidate(token: str):
    _user_cache.pop(token, None)


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Check cache first — avoids DB hit on every request
    cached = _cache_get(token)
    if cached:
        return cached

    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": normalize_db_id(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user_dict = {
            "id": str(user["_id"]),
            "email": user["email"],
            "name": user["name"],
            "role": user["role"],
            "branch_id": user.get("branch_id", ""),
            "created_at": user.get("created_at", "").isoformat() if isinstance(user.get("created_at"), datetime) else str(user.get("created_at", ""))
        }
        _cache_set(token, user_dict)
        return user_dict
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

def require_role(allowed_roles: List[str]):
    async def role_checker(request: Request):
        user = await get_current_user(request)
        if user["role"] not in allowed_roles:
            raise HTTPException(status_code=403, detail="Access denied")
        return user
    return role_checker

# ============ AUTH ROUTES ============

@api_router.post("/auth/register")
async def register(user_data: UserCreate, response: Response, request: Request):
    policies.rate_limiter.check(
        policies.rate_limit_key(request, "register"),
        settings.rate_limit_login_per_minute,
    )
    policies.validate_password(user_data.password)
    # Lock down: only admin can create non-cashier roles
    if user_data.role not in policies.ALL_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")

    if user_data.role != policies.ROLE_CASHIER:
        try:
            current_user = await get_current_user(request)
            if not policies.can_assign_role(current_user, user_data.role):
                raise HTTPException(status_code=403, detail="Not allowed to create this role")
        except HTTPException as exc:
            if exc.status_code == 401:
                raise HTTPException(status_code=403, detail="Authentication required for this role")
            raise
    
    email = user_data.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    hashed = await hash_password_async(user_data.password)
    user_doc = {
        "email": email,
        "password_hash": hashed,
        "name": user_data.name,
        "role": user_data.role,
        "created_at": datetime.now(timezone.utc),
    }
    if user_data.role in (policies.ROLE_BRANCH_ADMIN, policies.ROLE_CASHIER, policies.ROLE_INVENTORY):
        try:
            creator = await get_current_user(request)
            user_doc["branch_id"] = policies.resolve_branch_id(creator)
        except HTTPException:
            pass
    result = await db.users.insert_one(user_doc)
    user_id = str(result.inserted_id)
    
    access_token = create_access_token(user_id, email, user_data.role)
    refresh_token = create_refresh_token(user_id)
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await save_refresh_token(refresh_token, user_id, expires_at, request)
    
    set_auth_cookies(response, access_token, refresh_token)
    return {"id": user_id, "email": email, "name": user_data.name, "role": user_data.role}

@api_router.post("/auth/login")
async def login(credentials: UserLogin, response: Response, request: Request):
    if db is None:
        raise HTTPException(status_code=503, detail="Server is starting up, please try again in a few seconds")
    email = credentials.email.lower()
    policies.rate_limiter.check(
        policies.rate_limit_key(request, "login"),
        settings.rate_limit_login_per_minute,
    )

    # Check brute force
    ip = request.client.host if request.client else "unknown"
    identifier = f"{ip}:{email}"
    attempt = await db.login_attempts.find_one({"identifier": identifier})
    if attempt and attempt.get("count", 0) >= 5:
        lockout_time = attempt.get("last_attempt", datetime.now(timezone.utc))
        if datetime.now(timezone.utc) - lockout_time < timedelta(minutes=15):
            raise HTTPException(status_code=429, detail="Too many login attempts. Try again later.")
        else:
            await db.login_attempts.delete_one({"identifier": identifier})
    
    user = await db.users.find_one({"email": email})
    if not user or not await verify_password_async(credentials.password, user.get("password_hash", "")):
        # Increment failed attempts
        await db.login_attempts.update_one(
            {"identifier": identifier},
            {"$inc": {"count": 1}, "$set": {"last_attempt": datetime.now(timezone.utc)}},
            upsert=True
        )
        try:
            await log_audit(
                "system", "system", "login_failed", "auth",
                email, f"Failed login from {ip}",
            )
        except Exception:
            pass  # Don't let audit log failure break login
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Check if account is deactivated
    if not bool(user.get("is_active", True)):
        raise HTTPException(status_code=403, detail="Your account has been deactivated. Please contact your manager.")
    
    # Clear failed attempts on success
    await db.login_attempts.delete_one({"identifier": identifier})
    
    user_id = str(user["_id"])
    access_token = create_access_token(user_id, email, user["role"])
    refresh_token = create_refresh_token(user_id)
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    try:
        await save_refresh_token(refresh_token, user_id, expires_at, request)
    except Exception as exc:
        logger.warning(f"Failed to save refresh token: {exc}")

    set_auth_cookies(response, access_token, refresh_token)

    return {
        "id": user_id,
        "email": user["email"],
        "name": user["name"],
        "role": user["role"],
        "force_password_change": bool(user.get("force_password_change", False)),
    }

@api_router.post("/auth/logout")
async def logout(response: Response, request: Request):
    token = request.cookies.get("refresh_token")
    if token:
        await revoke_refresh_token(token)
    # Invalidate user cache for this session
    access_token = request.cookies.get("access_token")
    if access_token:
        _cache_invalidate(access_token)
    delete_auth_cookies(response)
    return {"message": "Logged out successfully"}


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@api_router.put("/auth/change-password")
async def change_password(data: ChangePasswordRequest, request: Request, response: Response):
    """Allow any authenticated user to change their own password."""
    user_info = await get_current_user(request)

    # Fetch full user doc to verify current password
    user_doc = await db.users.find_one({"_id": normalize_db_id(user_info["id"])})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")

    # If force_password_change is set, skip current password verification
    # (the user was assigned a temp password by an admin and doesn't know it)
    force_change = bool(user_doc.get("force_password_change", False))
    if not force_change:
        # Normal flow: verify current password
        if data.current_password == "__force_change__":
            raise HTTPException(status_code=400, detail="Current password is required")
        if not await verify_password_async(data.current_password, user_doc["password_hash"]):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
    # else: forced change — skip current password check

    # Validate new password strength
    policies.validate_password(data.new_password)

    # Prevent reusing the same password (only check for non-forced changes)
    if not force_change and await verify_password_async(data.new_password, user_doc["password_hash"]):
        raise HTTPException(status_code=400, detail="New password must be different from current password")

    new_hash = await hash_password_async(data.new_password)
    await db.users.update_one(
        {"_id": normalize_db_id(user_info["id"])},
        {"$set": {
            "password_hash": new_hash,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "force_password_change": False,  # clear any forced-change flag
        }}
    )

    # Revoke all existing refresh tokens — force re-login on other devices
    await revoke_user_refresh_tokens(user_info["id"])

    # Issue fresh tokens for the current session
    access_token = create_access_token(user_info["id"], user_info["email"], user_info["role"])
    refresh_token = create_refresh_token(user_info["id"])
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await save_refresh_token(refresh_token, user_info["id"], expires_at, request)
    set_auth_cookies(response, access_token, refresh_token)

    await log_audit(
        user_info["id"], user_info["name"],
        "password_changed", "user", user_info["id"],
        "User changed their own password",
        branch_id=user_info.get("branch_id", ""),
    )

    return {"message": "Password changed successfully"}


class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None


# ── Forgot / Reset Password ──────────────────────────────────────────────────

class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


@api_router.post("/auth/forgot-password")
async def forgot_password(data: ForgotPasswordRequest, request: Request):
    """
    Send a password-reset link to the user's email.
    Always returns 200 to avoid leaking whether an email exists.
    """
    policies.rate_limiter.check(
        policies.rate_limit_key(request, "forgot-password"),
        5,  # max 5 requests per minute per IP
    )

    email = data.email.lower()
    user = await db.users.find_one({"email": email})

    if user:
        # Generate a secure random token
        token = secrets.token_urlsafe(48)
        expires_at = datetime.now(timezone.utc) + timedelta(
            minutes=settings.password_reset_expire_minutes
        )

        # Store token in DB (upsert — one active token per user)
        await db.password_reset_tokens.update_one(
            {"user_id": str(user["_id"])},
            {
                "$set": {
                    "token": token,
                    "email": email,
                    "user_id": str(user["_id"]),
                    "expires_at": expires_at,
                    "used": False,
                    "created_at": datetime.now(timezone.utc),
                }
            },
            upsert=True,
        )

        # Send email (best-effort — don't fail the request if email fails)
        sent = await send_password_reset_email(
            to_email=email,
            name=user.get("name", "User"),
            reset_token=token,
            frontend_url=settings.frontend_url,
        )

        if not sent:
            # Email not configured — log the reset URL so admin can share it manually
            reset_url = f"{settings.frontend_url}/reset-password?token={token}"
            logger.warning(
                "Email not configured. Password reset URL for %s: %s",
                email,
                reset_url,
            )

        await log_audit(
            str(user["_id"]), user.get("name", ""),
            "password_reset_requested", "user", str(user["_id"]),
            f"Password reset requested from {request.client.host if request.client else 'unknown'}",
        )

    # Always return the same response to prevent email enumeration
    return {"message": "If that email is registered, a reset link has been sent."}


@api_router.post("/auth/reset-password")
async def reset_password(data: ResetPasswordRequest, request: Request):
    """Validate reset token and set a new password."""
    token_doc = await db.password_reset_tokens.find_one(
        {"token": data.token, "used": False}
    )

    if not token_doc:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    expires_at = token_doc.get("expires_at")
    if expires_at and expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Reset link has expired. Please request a new one.")

    # Validate new password strength
    policies.validate_password(data.new_password)

    user_id = token_doc["user_id"]
    user = await db.users.find_one({"_id": normalize_db_id(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    new_hash = hash_password(data.new_password)
    await db.users.update_one(
        {"_id": normalize_db_id(user_id)},
        {
            "$set": {
                "password_hash": new_hash,
                "force_password_change": False,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )

    # Mark token as used
    await db.password_reset_tokens.update_one(
        {"token": data.token},
        {"$set": {"used": True, "used_at": datetime.now(timezone.utc)}},
    )

    # Revoke all existing sessions
    await revoke_user_refresh_tokens(user_id)

    await log_audit(
        user_id, user.get("name", ""),
        "password_reset_completed", "user", user_id,
        "Password reset via email link",
    )

    return {"message": "Password reset successfully. You can now log in with your new password."}


@api_router.put("/auth/profile")
async def update_profile(data: UpdateProfileRequest, request: Request):
    """Allow any authenticated user to update their own name and phone."""
    user_info = await get_current_user(request)

    update_data: dict = {}
    if data.name is not None:
        name = (data.name or "").strip()
        if len(name) < 2:
            raise HTTPException(status_code=400, detail="Name must be at least 2 characters")
        update_data["name"] = name
    if data.phone is not None:
        update_data["phone"] = (data.phone or "").strip()

    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"_id": normalize_db_id(user_info["id"])},
        {"$set": update_data}
    )

    changed_fields = [k for k in update_data.keys() if k != "updated_at"]
    await log_audit(
        user_info["id"], user_info["name"],
        "profile_updated", "user", user_info["id"],
        f"User updated their profile: {', '.join(changed_fields)}",
        branch_id=user_info.get("branch_id", ""),
    )

    # Return updated user info
    updated = await db.users.find_one({"_id": normalize_db_id(user_info["id"])})
    return {
        "id": user_info["id"],
        "email": updated["email"],
        "name": updated["name"],
        "role": updated["role"],
        "phone": updated.get("phone", ""),
        "branch_id": updated.get("branch_id", ""),
        "force_password_change": bool(updated.get("force_password_change", False)),
    }


@api_router.post("/auth/logout-all")
async def logout_all_sessions(request: Request, response: Response):
    user = await get_current_user(request)
    await revoke_user_refresh_tokens(user["id"])
    delete_auth_cookies(response)
    return {"message": "All sessions revoked"}

@api_router.get("/auth/sessions")
async def list_sessions(request: Request):
    user = await get_current_user(request)
    sessions = await db.refresh_tokens.find({"user_id": user["id"]}).to_list(100)
    serialized_sessions = []
    for session in sessions:
        created_at = session.get("created_at")
        expires_at = session.get("expires_at")
        revoked_at = session.get("revoked_at")
        serialized_sessions.append({
            "id": str(session.get("_id")),
            "created_at": created_at.isoformat() if isinstance(created_at, datetime) else str(created_at) if created_at is not None else None,
            "expires_at": expires_at.isoformat() if isinstance(expires_at, datetime) else str(expires_at) if expires_at is not None else None,
            "revoked": session.get("revoked", False),
            "revoked_at": revoked_at.isoformat() if isinstance(revoked_at, datetime) else str(revoked_at) if revoked_at is not None else None,
            "ip": session.get("ip"),
            "user_agent": session.get("user_agent"),
        })
    return serialized_sessions

@api_router.get("/auth/me")
async def get_me(request: Request):
    user = await get_current_user(request)
    # Enrich with force_password_change flag from DB
    user_doc = await db.users.find_one({"_id": normalize_db_id(user["id"])})
    user["force_password_change"] = bool(user_doc.get("force_password_change", False)) if user_doc else False
    return user

@api_router.get("/realtime/token")
async def get_realtime_token(request: Request):
    """Short-lived token for a single WebSocket connection (one per browser session)."""
    user = await get_current_user(request)
    if not get_jwt_secret():
        raise HTTPException(status_code=503, detail="JWT_SECRET is not configured")
    token = create_ws_access_token(
        user["id"],
        user["role"],
        get_jwt_secret(),
        JWT_ALGORITHM,
    )
    # Persist single-use token in Redis (best-effort)
    try:
        await realtime.store_ws_token(token, ttl=300)
    except Exception:
        logger.debug("Failed to store ws token in redis")
    return {"token": token, "expires_in": 300}

@api_router.get("/realtime/status")
async def get_realtime_status(request: Request):
    user = await get_current_user(request)
    policies.require_super_admin(user)
    return {
        "summary": realtime.manager.stats(),
        "connections": realtime.manager.list_connections(),
    }

@api_router.post("/auth/refresh")
async def refresh_token(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")

    token_doc = await db.refresh_tokens.find_one({"token": token, "revoked": False})
    if not token_doc:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    if token_doc.get("expires_at") and token_doc["expires_at"] < datetime.now(timezone.utc):
        await revoke_refresh_token(token)
        raise HTTPException(status_code=401, detail="Refresh token expired")

    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": normalize_db_id(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")

        user_id = str(user["_id"])
        await revoke_refresh_token(token)

        access_token = create_access_token(user_id, user["email"], user["role"])
        new_refresh_token = create_refresh_token(user_id)
        expires_at = datetime.now(timezone.utc) + timedelta(days=7)
        await save_refresh_token(new_refresh_token, user_id, expires_at, request)
        set_auth_cookies(response, access_token, new_refresh_token)
        return {"message": "Token refreshed"}
    except jwt.ExpiredSignatureError:
        await revoke_refresh_token(token)
        raise HTTPException(status_code=401, detail="Refresh token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# ============ PRODUCTS/INVENTORY ============

# ── Bar & Restaurant: Menu Items ─────────────────────────────────────────────

@api_router.get("/menu-items")
async def get_menu_items(
    request: Request,
    category: Optional[str] = None,
    route_to: Optional[str] = None,
    search: Optional[str] = None,
    available_only: bool = False,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=None, ge=1),
):
    user = await get_current_user(request)
    query = policies.apply_branch_scope(user, {})
    if category:
        query["category"] = category
    if route_to:
        query["route_to"] = route_to
    if available_only:
        query["is_available"] = True
    if search:
        safe = policies.escape_regex(search)
        query["$or"] = [
            {"name": {"$regex": safe, "$options": "i"}},
            {"name_am": {"$regex": safe, "$options": "i"}},
            {"category": {"$regex": safe, "$options": "i"}},
        ]
    page_limit = limit if limit is not None else settings.default_page_size
    safe_skip, safe_limit = policies.clamp_pagination(skip, page_limit)
    cursor = db.menu_items.find(query, {"_id": 0}).skip(safe_skip).limit(safe_limit)
    items = await cursor.to_list(safe_limit)
    total = await db.menu_items.count_documents(query)
    return {"items": items, "total": total, "skip": safe_skip, "limit": safe_limit}

@api_router.post("/menu-items")
async def create_menu_item(item: MenuItemCreate, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    doc = item.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["branch_id"] = policies.resolve_branch_id(user, item.branch_id)
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.menu_items.insert_one(doc)
    del doc["_id"]
    await broadcast_entity_update("menu_item", "created", doc)
    return doc

@api_router.get("/menu-items/{item_id}")
async def get_menu_item(item_id: str, request: Request):
    user = await get_current_user(request)
    item = await db.menu_items.find_one({"id": item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    return item

@api_router.put("/menu-items/{item_id}")
async def update_menu_item(item_id: str, item: MenuItemUpdate, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    existing = await db.menu_items.find_one({"id": item_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Menu item not found")
    update_data = {k: v for k, v in item.model_dump().items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.menu_items.update_one({"id": item_id}, {"$set": update_data})
    updated = await db.menu_items.find_one({"id": item_id}, {"_id": 0})
    await broadcast_entity_update("menu_item", "updated", updated)
    return updated

@api_router.delete("/menu-items/{item_id}")
async def delete_menu_item(item_id: str, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    result = await db.menu_items.delete_one({"id": item_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Menu item not found")
    await broadcast_entity_update("menu_item", "deleted", {"id": item_id})
    return {"message": "Menu item deleted"}

@api_router.post("/menu-items/{item_id}/toggle-availability")
async def toggle_menu_item_availability(item_id: str, request: Request):
    """86 an item (mark unavailable) or reactivate it — kitchen/manager action."""
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES | policies.KITCHEN_ACCESS_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    item = await db.menu_items.find_one({"id": item_id})
    if not item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    new_state = not bool(item.get("is_available", True))
    await db.menu_items.update_one({"id": item_id}, {"$set": {
        "is_available": new_state,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }})
    await broadcast_entity_update("menu_item", "updated", {"id": item_id, "is_available": new_state})
    return {"id": item_id, "is_available": new_state}

# ── Bar & Restaurant: Ingredients ────────────────────────────────────────────

@api_router.get("/ingredients")
async def get_ingredients(request: Request, search: Optional[str] = None):
    user = await get_current_user(request)
    query = policies.apply_branch_scope(user, {})
    if search:
        safe = policies.escape_regex(search)
        query["name"] = {"$regex": safe, "$options": "i"}
    items = await db.ingredients.find(query, {"_id": 0}).to_list(500)
    return items

@api_router.post("/ingredients")
async def create_ingredient(item: IngredientCreate, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    doc = item.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["branch_id"] = policies.resolve_branch_id(user, item.branch_id)
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.ingredients.insert_one(doc)
    del doc["_id"]
    return doc

@api_router.put("/ingredients/{ingredient_id}")
async def update_ingredient(ingredient_id: str, item: IngredientUpdate, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    update_data = {k: v for k, v in item.model_dump().items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.ingredients.update_one({"id": ingredient_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ingredient not found")
    return await db.ingredients.find_one({"id": ingredient_id}, {"_id": 0})

@api_router.post("/ingredients/{ingredient_id}/adjust-stock")
async def adjust_ingredient_stock(ingredient_id: str, quantity: float, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    result = await db.ingredients.update_one(
        {"id": ingredient_id},
        {"$inc": {"current_stock": quantity}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ingredient not found")
    return await db.ingredients.find_one({"id": ingredient_id}, {"_id": 0})

# ── Bar & Restaurant: Recipes ─────────────────────────────────────────────────

@api_router.get("/recipes")
async def get_recipes(request: Request):
    user = await get_current_user(request)
    recipes = await db.recipes.find({}, {"_id": 0}).to_list(500)
    return recipes

@api_router.get("/recipes/{menu_item_id}")
async def get_recipe(menu_item_id: str, request: Request):
    user = await get_current_user(request)
    recipe = await db.recipes.find_one({"menu_item_id": menu_item_id}, {"_id": 0})
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return recipe

@api_router.post("/recipes")
async def create_recipe(recipe: RecipeCreate, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    existing = await db.recipes.find_one({"menu_item_id": recipe.menu_item_id})
    if existing:
        raise HTTPException(status_code=400, detail="Recipe already exists for this menu item")
    doc = recipe.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.recipes.insert_one(doc)
    del doc["_id"]
    return doc

@api_router.put("/recipes/{recipe_id}")
async def update_recipe(recipe_id: str, recipe: RecipeCreate, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    update_data = recipe.model_dump()
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.recipes.update_one({"id": recipe_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return await db.recipes.find_one({"id": recipe_id}, {"_id": 0})

# ── Bar & Restaurant: Rooms ───────────────────────────────────────────────────

@api_router.get("/rooms")
async def get_rooms(request: Request, status: Optional[str] = None):
    user = await get_current_user(request)
    if user["role"] not in policies.ROOM_ACCESS_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    query = policies.apply_branch_scope(user, {})
    if status:
        query["occupancy_status"] = status
    rooms = await db.rooms.find(query, {"_id": 0}).to_list(100)
    return rooms

@api_router.post("/rooms")
async def create_room(room: RoomCreate, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    doc = room.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["branch_id"] = policies.resolve_branch_id(user, room.branch_id)
    doc["occupancy_status"] = "available"  # available, occupied, reserved, dirty
    doc["status"] = "active"               # active, maintenance, closed
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.rooms.insert_one(doc)
    del doc["_id"]
    await broadcast_entity_update("room", "created", doc)
    return doc

@api_router.get("/rooms/{room_id}")
async def get_room(room_id: str, request: Request):
    user = await get_current_user(request)
    room = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return room

@api_router.put("/rooms/{room_id}")
async def update_room(room_id: str, room: RoomUpdate, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    existing = await db.rooms.find_one({"id": room_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Room not found")
    update_data = {k: v for k, v in room.model_dump().items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.rooms.update_one({"id": room_id}, {"$set": update_data})
    updated = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    await broadcast_entity_update("room", "updated", updated)
    return updated

@api_router.patch("/rooms/{room_id}/status")
async def update_room_occupancy(room_id: str, body: RoomStatusUpdate, request: Request):
    """Update occupancy status: available → occupied → dirty → available."""
    user = await get_current_user(request)
    if user["role"] not in policies.ROOM_ACCESS_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    valid_statuses = {"available", "occupied", "reserved", "dirty"}
    if body.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Status must be one of {valid_statuses}")
    result = await db.rooms.update_one(
        {"id": room_id},
        {"$set": {"occupancy_status": body.status, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Room not found")
    await broadcast_entity_update("room", "updated", {"id": room_id, "occupancy_status": body.status})
    return {"id": room_id, "occupancy_status": body.status}

@api_router.delete("/rooms/{room_id}")
async def delete_room(room_id: str, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    result = await db.rooms.delete_one({"id": room_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Room not found")
    await broadcast_entity_update("room", "deleted", {"id": room_id})
    return {"message": "Room deleted"}

# ── Room Turnover ─────────────────────────────────────────────────────────────

@api_router.post("/rooms/{room_id}/turnover")
async def start_turnover(room_id: str, body: TurnoverCreate, request: Request):
    user = await get_current_user(request)
    room = await db.rooms.find_one({"id": room_id})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    doc = {
        "id": str(uuid.uuid4()),
        "room_id": room_id,
        "reservation_id": body.reservation_id,
        "cleaned_by": user["id"],
        "cleaned_by_name": user["name"],
        "start_time": datetime.now(timezone.utc).isoformat(),
        "end_time": None,
        "checklist": body.checklist,
        "notes": body.notes,
        "status": "in_progress",
        "branch_id": room.get("branch_id", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.room_turnovers.insert_one(doc)
    del doc["_id"]
    await db.rooms.update_one({"id": room_id}, {"$set": {"occupancy_status": "dirty"}})
    return doc

@api_router.patch("/rooms/{room_id}/turnover/{turnover_id}/complete")
async def complete_turnover(room_id: str, turnover_id: str, request: Request):
    user = await get_current_user(request)
    await db.room_turnovers.update_one(
        {"id": turnover_id},
        {"$set": {"status": "completed", "end_time": datetime.now(timezone.utc).isoformat()}}
    )
    await db.rooms.update_one({"id": room_id}, {"$set": {"occupancy_status": "available"}})
    await broadcast_entity_update("room", "updated", {"id": room_id, "occupancy_status": "available"})
    return {"message": "Turnover completed, room now available"}

# ── Bar & Restaurant: Reservations ───────────────────────────────────────────

@api_router.get("/reservations")
async def get_reservations(
    request: Request,
    room_id: Optional[str] = None,
    status: Optional[str] = None,
    date: Optional[str] = None,    # YYYY-MM-DD — filters by start date
):
    user = await get_current_user(request)
    if user["role"] not in policies.ROOM_ACCESS_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    query = policies.apply_branch_scope(user, {})
    if room_id:
        query["room_id"] = room_id
    if status:
        query["status"] = status
    if date:
        query["start_datetime"] = {"$regex": f"^{date}"}
    reservations = await db.reservations.find(query, {"_id": 0}).sort("start_datetime", 1).to_list(200)
    return reservations

@api_router.post("/reservations")
async def create_reservation(res: ReservationCreate, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.ROOM_ACCESS_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    # Conflict check — no overlapping confirmed/seated reservations for the same room
    conflict = await db.reservations.find_one({
        "room_id": res.room_id,
        "status": {"$in": ["confirmed", "seated"]},
        "$or": [
            {"start_datetime": {"$lt": res.end_datetime, "$gte": res.start_datetime}},
            {"end_datetime": {"$gt": res.start_datetime, "$lte": res.end_datetime}},
            {"start_datetime": {"$lte": res.start_datetime}, "end_datetime": {"$gte": res.end_datetime}},
        ]
    })
    if conflict:
        raise HTTPException(status_code=409, detail="Room already booked for this time slot")
    room = await db.rooms.find_one({"id": res.room_id})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    branch_id = room.get("branch_id", "")
    doc = res.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["status"] = "confirmed"
    doc["branch_id"] = branch_id
    doc["created_by"] = user["id"]
    doc["created_by_name"] = user["name"]
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.reservations.insert_one(doc)
    del doc["_id"]
    # Mark room as reserved
    await db.rooms.update_one({"id": res.room_id}, {"$set": {"occupancy_status": "reserved"}})
    await broadcast_entity_update("reservation", "created", doc)
    await log_audit(user["id"], user["name"], "reservation_created", "reservation", doc["id"],
                    f"{res.customer_name} — {res.start_datetime[:10]}", branch_id=branch_id)
    return doc

@api_router.get("/reservations/{reservation_id}")
async def get_reservation(reservation_id: str, request: Request):
    user = await get_current_user(request)
    res = await db.reservations.find_one({"id": reservation_id}, {"_id": 0})
    if not res:
        raise HTTPException(status_code=404, detail="Reservation not found")
    return res

@api_router.put("/reservations/{reservation_id}")
async def update_reservation(reservation_id: str, body: ReservationUpdate, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.ROOM_ACCESS_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    existing = await db.reservations.find_one({"id": reservation_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Reservation not found")
    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    # Handle seating — mark room occupied
    if body.status == "seated":
        update_data["actual_start_time"] = datetime.now(timezone.utc).isoformat()
        await db.rooms.update_one({"id": existing["room_id"]}, {"$set": {"occupancy_status": "occupied"}})
        await broadcast_entity_update("room", "updated", {"id": existing["room_id"], "occupancy_status": "occupied"})
    # Handle checkout / cancellation — free the room
    elif body.status in ("completed", "cancelled", "no-show"):
        update_data["actual_end_time"] = datetime.now(timezone.utc).isoformat()
        await db.rooms.update_one({"id": existing["room_id"]}, {"$set": {"occupancy_status": "dirty" if body.status == "completed" else "available"}})
        await broadcast_entity_update("room", "updated", {"id": existing["room_id"], "occupancy_status": "dirty"})
    await db.reservations.update_one({"id": reservation_id}, {"$set": update_data})
    updated = await db.reservations.find_one({"id": reservation_id}, {"_id": 0})
    await broadcast_entity_update("reservation", "updated", updated)
    return updated

# ── Bar & Restaurant: Orders ──────────────────────────────────────────────────

# Tax constants (Ethiopia)
VAT_RATE = 0.15
TOT_RATE = 0.02
SERVICE_CHARGE_RATE = 0.10   # 10% service charge, taxable

def _calculate_order_totals(subtotal: float, discount: float = 0) -> dict:
    """Calculate Ethiopian bar/restaurant totals with service charge + VAT + TOT."""
    after_discount = max(0, subtotal - discount)
    service_charge = round(after_discount * SERVICE_CHARGE_RATE, 2)
    taxable_base = after_discount + service_charge
    vat_amount = round(taxable_base * VAT_RATE, 2)
    tot_amount = round(taxable_base * TOT_RATE, 2)
    total = round(taxable_base + vat_amount + tot_amount, 2)
    return {
        "subtotal": round(after_discount, 2),
        "service_charge": service_charge,
        "vat_amount": vat_amount,
        "tot_amount": tot_amount,
        "discount_amount": round(discount, 2),
        "total_amount": total,
    }

@api_router.post("/orders")
async def create_order(order: OrderCreate, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.ORDER_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")

    idempotency_key = order.idempotency_key or request.headers.get("Idempotency-Key")
    if idempotency_key:
        existing = await db.orders.find_one({"idempotency_key": idempotency_key}, {"_id": 0})
        if existing:
            return existing

    if not order.items:
        raise HTTPException(status_code=400, detail="Order must have at least one item")

    branch_id = await resolve_branch_id_for_sale(user, db)

    # Fetch all menu items in one query
    item_ids = [i.menu_item_id for i in order.items]
    menu_docs = await db.menu_items.find({"id": {"$in": item_ids}}, {"_id": 0}).to_list(len(item_ids))
    menu_map = {m["id"]: m for m in menu_docs}

    order_items = []
    subtotal = 0.0
    for item in order.items:
        menu_doc = menu_map.get(item.menu_item_id)
        if not menu_doc:
            raise HTTPException(status_code=404, detail=f"Menu item not found: {item.menu_item_name}")
        if not menu_doc.get("is_available", True):
            raise HTTPException(status_code=400, detail=f"{item.menu_item_name} is currently unavailable (86'd)")
        line_total = item.unit_price * item.quantity
        subtotal += line_total
        order_items.append({
            "id": str(uuid.uuid4()),
            "menu_item_id": item.menu_item_id,
            "menu_item_name": item.menu_item_name,
            "quantity": item.quantity,
            "unit_price": item.unit_price,
            "line_total": line_total,
            "modifiers": item.modifiers or [],
            "kitchen_note": item.kitchen_note,
            "course": item.course,
            "route_to": menu_doc.get("route_to", "kitchen"),
            "status": "pending",
            "sent_at": None,
            "ready_at": None,
            "served_at": None,
        })

    totals = _calculate_order_totals(subtotal)

    order_doc = {
        "id": str(uuid.uuid4()),
        "branch_id": branch_id,
        "room_id": order.room_id,
        "table_number": order.table_number,
        "reservation_id": order.reservation_id,
        "server_id": user["id"],
        "server_name": user["name"],
        "order_type": order.order_type,
        "order_source": order.order_source,
        "status": "open",
        "payment_status": "unpaid",
        "items": order_items,
        "notes": order.notes,
        "idempotency_key": idempotency_key,
        **totals,
        "payment_method": None,
        "is_fiscal_synced": False,
        "is_voided": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    await db.orders.insert_one(order_doc)
    del order_doc["_id"]

    # If room_id present, mark room occupied
    if order.room_id:
        await db.rooms.update_one({"id": order.room_id}, {"$set": {"occupancy_status": "occupied"}})

    asyncio.create_task(_post_order_tasks(order_doc, user, branch_id))
    return order_doc

async def _post_order_tasks(order_doc: dict, user: dict, branch_id: str):
    try:
        await log_audit(user["id"], user["name"], "order_created", "order",
                        order_doc["id"], f"Order Br{branch_id[:6]} — {len(order_doc['items'])} items",
                        branch_id=branch_id)
        await broadcast_entity_update("order", "created", {
            "id": order_doc["id"],
            "status": order_doc["status"],
            "room_id": order_doc.get("room_id"),
            "table_number": order_doc.get("table_number"),
            "server_name": order_doc["server_name"],
            "total_amount": order_doc["total_amount"],
            "items_count": len(order_doc["items"]),
            "created_at": order_doc["created_at"],
        })
    except Exception as exc:
        logger.warning("Post-order background task failed: %s", exc)

@api_router.get("/orders")
async def get_orders(
    request: Request,
    status: Optional[str] = None,
    room_id: Optional[str] = None,
    payment_status: Optional[str] = None,
    limit: int = Query(default=100, le=500),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    user = await get_current_user(request)
    query = policies.sales_query_for_user(user, {})
    if status:
        query["status"] = status
    if payment_status:
        query["payment_status"] = payment_status
    if room_id:
        query["room_id"] = room_id
    if start_date:
        query["created_at"] = {"$gte": start_date}
    if end_date:
        query.setdefault("created_at", {})["$lte"] = end_date
    orders = await db.orders.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return orders

@api_router.get("/orders/kitchen")
async def get_kitchen_orders(request: Request):
    """Kitchen Display System — active orders routed to kitchen."""
    user = await get_current_user(request)
    if user["role"] not in policies.KITCHEN_ACCESS_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    query = policies.apply_branch_scope(user, {
        "status": {"$in": ["sent_to_kitchen", "open"]},
        "items": {"$elemMatch": {"route_to": "kitchen", "status": {"$in": ["pending", "preparing"]}}}
    })
    orders = await db.orders.find(query, {"_id": 0}).sort("created_at", 1).to_list(100)
    return orders

@api_router.get("/orders/bar")
async def get_bar_orders(request: Request):
    """Bar Display — active drink orders routed to bar."""
    user = await get_current_user(request)
    if user["role"] not in policies.KITCHEN_ACCESS_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    query = policies.apply_branch_scope(user, {
        "status": {"$in": ["sent_to_kitchen", "open"]},
        "items": {"$elemMatch": {"route_to": "bar", "status": {"$in": ["pending", "preparing"]}}}
    })
    orders = await db.orders.find(query, {"_id": 0}).sort("created_at", 1).to_list(100)
    return orders

@api_router.get("/orders/{order_id}")
async def get_order(order_id: str, request: Request):
    user = await get_current_user(request)
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    policies.assert_branch_access(user, order, "order")
    return order

@api_router.patch("/orders/{order_id}/status")
async def update_order_status(order_id: str, body: OrderStatusUpdate, request: Request):
    """State machine: open → sent_to_kitchen → ready → served → closed | cancelled."""
    user = await get_current_user(request)
    order = await db.orders.find_one({"id": order_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    policies.assert_branch_access(user, order, "order")

    # Void requires manager permission
    if body.status == "cancelled" and user["role"] not in policies.VOID_ROLES:
        raise HTTPException(status_code=403, detail="Only managers can void orders")

    update: dict = {
        "status": body.status,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    if body.status == "sent_to_kitchen":
        # Mark all pending items as preparing and record sent_at
        now = datetime.now(timezone.utc).isoformat()
        new_items = []
        for item in order.get("items", []):
            if item["status"] == "pending":
                item = {**item, "status": "preparing", "sent_at": now}
            new_items.append(item)
        update["items"] = new_items

    elif body.status == "cancelled":
        update["is_voided"] = True
        update["voided_at"] = datetime.now(timezone.utc).isoformat()
        update["void_reason"] = body.void_reason
        # Free the room if this was the last active order
        if order.get("room_id"):
            other_active = await db.orders.count_documents({
                "room_id": order["room_id"],
                "status": {"$nin": ["closed", "cancelled"]},
                "id": {"$ne": order_id},
            })
            if other_active == 0:
                await db.rooms.update_one({"id": order["room_id"]}, {"$set": {"occupancy_status": "dirty"}})

    await db.orders.update_one({"id": order_id}, {"$set": update})
    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    await broadcast_entity_update("order", "updated", {
        "id": order_id, "status": body.status,
        "room_id": order.get("room_id"),
        "table_number": order.get("table_number"),
    })
    return updated

@api_router.patch("/orders/{order_id}/items/{item_id}/status")
async def update_order_item_status(order_id: str, item_id: str, status: str, request: Request):
    """Kitchen/bar marks individual item as ready."""
    user = await get_current_user(request)
    if user["role"] not in policies.KITCHEN_ACCESS_ROLES | policies.ORDER_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    order = await db.orders.find_one({"id": order_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    now = datetime.now(timezone.utc).isoformat()
    new_items = []
    for item in order.get("items", []):
        if item["id"] == item_id:
            item = {**item, "status": status}
            if status == "ready":
                item["ready_at"] = now
            elif status == "served":
                item["served_at"] = now
        new_items.append(item)
    # Determine overall order status
    all_served = all(i["status"] in ("served", "cancelled") for i in new_items)
    all_ready = all(i["status"] in ("ready", "served", "cancelled") for i in new_items)
    new_order_status = "served" if all_served else ("ready" if all_ready else order["status"])
    await db.orders.update_one({"id": order_id}, {"$set": {
        "items": new_items,
        "status": new_order_status,
        "updated_at": now,
    }})
    await broadcast_entity_update("order", "updated", {"id": order_id, "status": new_order_status})
    return {"id": order_id, "item_id": item_id, "status": status, "order_status": new_order_status}

@api_router.post("/orders/{order_id}/items")
async def add_items_to_order(order_id: str, items: List[OrderItemCreate], request: Request):
    """Add more items to an existing open order (e.g. re-order round)."""
    user = await get_current_user(request)
    order = await db.orders.find_one({"id": order_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["status"] in ("closed", "cancelled"):
        raise HTTPException(status_code=400, detail="Cannot add items to a closed order")
    policies.assert_branch_access(user, order, "order")

    item_ids = [i.menu_item_id for i in items]
    menu_docs = await db.menu_items.find({"id": {"$in": item_ids}}, {"_id": 0}).to_list(len(item_ids))
    menu_map = {m["id"]: m for m in menu_docs}

    new_items = []
    added_subtotal = 0.0
    for item in items:
        menu_doc = menu_map.get(item.menu_item_id)
        if not menu_doc:
            raise HTTPException(status_code=404, detail=f"Menu item not found: {item.menu_item_name}")
        line_total = item.unit_price * item.quantity
        added_subtotal += line_total
        new_items.append({
            "id": str(uuid.uuid4()),
            "menu_item_id": item.menu_item_id,
            "menu_item_name": item.menu_item_name,
            "quantity": item.quantity,
            "unit_price": item.unit_price,
            "line_total": line_total,
            "modifiers": item.modifiers or [],
            "kitchen_note": item.kitchen_note,
            "course": item.course,
            "route_to": menu_doc.get("route_to", "kitchen"),
            "status": "pending",
            "sent_at": None, "ready_at": None, "served_at": None,
        })

    existing_items = order.get("items", [])
    all_items = existing_items + new_items
    new_subtotal = order["subtotal"] + added_subtotal
    totals = _calculate_order_totals(new_subtotal, order.get("discount_amount", 0))
    await db.orders.update_one({"id": order_id}, {"$set": {
        "items": all_items,
        **totals,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }})
    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    await broadcast_entity_update("order", "updated", {"id": order_id, "status": "open"})
    return updated

@api_router.post("/orders/{order_id}/pay")
async def pay_order(order_id: str, payment: OrderPayment, request: Request):
    """Process final payment for an order. Applies tip, generates bill."""
    user = await get_current_user(request)
    if user["role"] not in policies.PAYMENT_ROLES:
        raise HTTPException(status_code=403, detail="Only cashiers can process payments")
    order = await db.orders.find_one({"id": order_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("payment_status") == "paid":
        raise HTTPException(status_code=400, detail="Order is already paid")
    if order.get("is_voided"):
        raise HTTPException(status_code=400, detail="Cannot pay a voided order")
    policies.assert_branch_access(user, order, "order")

    now = datetime.now(timezone.utc).isoformat()
    # Recalculate with final discount
    totals = _calculate_order_totals(order["subtotal"], payment.discount_amount or 0)
    tip_amount = payment.tip_amount or 0

    await db.orders.update_one({"id": order_id}, {"$set": {
        **totals,
        "tip_amount": tip_amount,
        "payment_method": payment.payment_method,
        "payment_reference": payment.payment_reference,
        "payment_status": "paid",
        "status": "closed",
        "paid_at": now,
        "paid_by": user["id"],
        "paid_by_name": user["name"],
        "split_payments": payment.split_payments or [],
        "updated_at": now,
    }})

    # Free the room if no other open orders
    if order.get("room_id"):
        other_active = await db.orders.count_documents({
            "room_id": order["room_id"],
            "status": {"$nin": ["closed", "cancelled"]},
            "id": {"$ne": order_id},
        })
        if other_active == 0:
            await db.rooms.update_one({"id": order["room_id"]}, {"$set": {"occupancy_status": "dirty"}})
            await broadcast_entity_update("room", "updated", {"id": order["room_id"], "occupancy_status": "dirty"})

    paid_order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    await broadcast_entity_update("order", "paid", {
        "id": order_id,
        "total_amount": totals["total_amount"],
        "payment_method": payment.payment_method,
    })
    await log_audit(user["id"], user["name"], "order_paid", "order", order_id,
                    f"Paid {totals['total_amount']:.2f} ETB via {payment.payment_method}",
                    branch_id=order.get("branch_id", ""))
    return paid_order

# ── Happy Hour ────────────────────────────────────────────────────────────────

@api_router.get("/happy-hours")
async def get_happy_hours(request: Request):
    user = await get_current_user(request)
    query = policies.apply_branch_scope(user, {})
    return await db.happy_hours.find(query, {"_id": 0}).to_list(50)

@api_router.post("/happy-hours")
async def create_happy_hour(hh: HappyHourCreate, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    doc = hh.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["branch_id"] = policies.resolve_branch_id(user, hh.branch_id)
    doc["is_active"] = True
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.happy_hours.insert_one(doc)
    del doc["_id"]
    return doc

@api_router.delete("/happy-hours/{hh_id}")
async def delete_happy_hour(hh_id: str, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    result = await db.happy_hours.delete_one({"id": hh_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Happy hour rule not found")
    return {"message": "Deleted"}

# ── Waste / Spillage Log ──────────────────────────────────────────────────────

@api_router.get("/waste-log")
async def get_waste_log(request: Request, limit: int = Query(default=100, le=500)):
    user = await get_current_user(request)
    query = policies.apply_branch_scope(user, {})
    return await db.waste_log.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)

@api_router.post("/waste-log")
async def log_waste(entry: WasteLogCreate, request: Request):
    user = await get_current_user(request)
    branch_id = user.get("branch_id", "")
    doc = entry.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["logged_by"] = user["id"]
    doc["logged_by_name"] = user["name"]
    doc["branch_id"] = branch_id
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.waste_log.insert_one(doc)
    # Deduct from ingredient stock
    await db.ingredients.update_one(
        {"id": entry.ingredient_id},
        {"$inc": {"current_stock": -abs(entry.quantity)},
         "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    del doc["_id"]
    return doc

# ── Bar & Restaurant: Dashboard Reports ──────────────────────────────────────

@api_router.get("/reports/floor-status")
async def get_floor_status(request: Request):
    """Real-time overview of all rooms: occupancy, active orders, revenue today."""
    user = await get_current_user(request)
    query = policies.apply_branch_scope(user, {})
    rooms = await db.rooms.find(query, {"_id": 0}).to_list(50)
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    result = []
    for room in rooms:
        active_orders = await db.orders.find(
            {"room_id": room["id"], "status": {"$nin": ["closed", "cancelled"]}},
            {"_id": 0, "id": 1, "status": 1, "total_amount": 1, "created_at": 1}
        ).to_list(10)
        today_revenue_agg = await db.orders.aggregate([
            {"$match": {"room_id": room["id"], "payment_status": "paid", "created_at": {"$gte": today}}},
            {"$group": {"_id": None, "revenue": {"$sum": "$total_amount"}}},
        ]).to_list(1)
        result.append({
            **room,
            "active_orders": active_orders,
            "active_orders_count": len(active_orders),
            "today_revenue": today_revenue_agg[0]["revenue"] if today_revenue_agg else 0,
        })
    return result

# ============ PRODUCTS/INVENTORY ============

# ── Static routes MUST come before /{product_id} to avoid capture ──

@api_router.get("/products")
async def get_products(
    request: Request,
    category: Optional[str] = None,
    low_stock: Optional[bool] = None,
    search: Optional[str] = None,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=None, ge=1),
):
    user = await get_current_user(request)
    query = policies.apply_branch_scope(user, {})
    if category:
        query["category"] = category
    if low_stock:
        query["$expr"] = {"$lte": ["$quantity", "$min_stock_level"]}
    if search:
        safe = policies.escape_regex(search)
        query["$or"] = [
            {"name": {"$regex": safe, "$options": "i"}},
            {"sku": {"$regex": safe, "$options": "i"}},
            {"barcode": {"$regex": safe, "$options": "i"}},
        ]
    page_limit = limit if limit is not None else settings.default_page_size
    safe_skip, safe_limit = policies.clamp_pagination(skip, page_limit)
    cursor = db.products.find(query, {"_id": 0}).skip(safe_skip).limit(safe_limit)
    products = await cursor.to_list(safe_limit)
    total = await db.products.count_documents(query)
    return {"items": products, "total": total, "skip": safe_skip, "limit": safe_limit}

@api_router.post("/products")
async def create_product(product: ProductCreate, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    existing = await db.products.find_one({"sku": product.sku})
    if existing:
        raise HTTPException(status_code=400, detail="SKU already exists")
    product_doc = product.model_dump()
    product_doc["id"] = str(uuid.uuid4())
    product_doc["branch_id"] = policies.resolve_branch_id(user, product.branch_id)
    product_doc["created_at"] = datetime.now(timezone.utc).isoformat()
    product_doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.products.insert_one(product_doc)
    low_stock = product_doc["quantity"] <= product_doc.get("min_stock_level", 0)
    await broadcast_stock_update(db, [product_doc["id"]], action="created", low_stock=low_stock)
    del product_doc["_id"]
    return product_doc

@api_router.get("/products/low-stock/alerts")
async def get_low_stock_alerts(request: Request):
    user = await get_current_user(request)
    query = policies.apply_branch_scope(user, {
        "$expr": {"$lte": ["$quantity", "$min_stock_level"]},
    })
    products = await db.products.find(query, {"_id": 0}).to_list(100)
    return products

@api_router.get("/products/expiring/soon")
async def get_expiring_products(request: Request, days: int = Query(default=30, le=90)):
    await get_current_user(request)
    cutoff = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()[:10]
    today = datetime.now(timezone.utc).isoformat()[:10]
    products = await db.products.find({
        "expiry_date": {"$nin": [None, ""], "$lte": cutoff, "$gte": today}
    }, {"_id": 0}).to_list(100)
    return products

# ── Parameterised routes after all static ones ──

@api_router.get("/products/{product_id}/image")
async def get_product_image(product_id: str):
    """Stream the product image directly from GridFS."""
    product = await db.products.find_one({"id": product_id})
    if not product or not product.get("image_file_id"):
        raise HTTPException(status_code=404, detail="No image for this product")
    fs = get_gridfs()
    try:
        from bson import ObjectId as BsonObjectId
        grid_out = await fs.open_download_stream(BsonObjectId(product["image_file_id"]))
    except Exception:
        raise HTTPException(status_code=404, detail="Image not found in storage")
    content_type = grid_out.metadata.get("content_type", "image/jpeg") if grid_out.metadata else "image/jpeg"
    data = await grid_out.read()
    return RawResponse(
        content=data,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=86400", "Content-Length": str(len(data))}
    )

@api_router.get("/products/{product_id}")
async def get_product(product_id: str, request: Request):
    user = await get_current_user(request)
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    policies.assert_branch_access(user, product, "product")
    return product

@api_router.put("/products/{product_id}")
async def update_product(product_id: str, product: ProductUpdate, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    existing = await db.products.find_one({"id": product_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Product not found")
    policies.assert_branch_access(user, existing, "product")
    raw = product.model_dump()
    update_data = {}
    for k, v in raw.items():
        if v is None and k != "expiry_date":
            continue
        update_data[k] = v
    if user["role"] != policies.ROLE_SUPER_ADMIN:
        update_data.pop("branch_id", None)
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    try:
        result = await db.products.update_one({"id": product_id}, {"$set": update_data})
    except Exception as exc:
        logger.error(f"update_product DB error: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database error: {str(exc)}")
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    updated = await db.products.find_one({"id": product_id}, {"_id": 0})
    low_stock = updated and updated.get("quantity", 0) <= updated.get("min_stock_level", 0)
    await broadcast_stock_update(db, [product_id], action="updated", low_stock=low_stock)
    return updated

@api_router.delete("/products/{product_id}")
async def delete_product(product_id: str, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    existing = await db.products.find_one({"id": product_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Product not found")
    policies.assert_branch_access(user, existing, "product")
    result = await db.products.delete_one({"id": product_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    await broadcast_stock_update(db, [product_id], action="deleted")
    return {"message": "Product deleted"}

@api_router.post("/products/{product_id}/adjust-stock")
async def adjust_stock(product_id: str, quantity: int, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    result = await db.products.update_one(
        {"id": product_id},
        {"$inc": {"quantity": quantity}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    updated = await db.products.find_one({"id": product_id}, {"_id": 0})
    low_stock = updated and updated.get("quantity", 0) <= updated.get("min_stock_level", 0)
    await broadcast_stock_update(db, [product_id], action="adjusted", low_stock=low_stock)
    return updated

# ============ CATEGORIES ============

@api_router.get("/categories")
async def get_categories(request: Request):
    await get_current_user(request)
    categories = await db.categories.find({}, {"_id": 0}).to_list(100)
    return categories

@api_router.post("/categories")
async def create_category(category: CategoryCreate, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    
    category_doc = category.model_dump()
    category_doc["id"] = str(uuid.uuid4())
    category_doc["created_at"] = datetime.now(timezone.utc).isoformat()
    
    await db.categories.insert_one(category_doc)
    del category_doc["_id"]
    return category_doc

@api_router.delete("/categories/{category_id}")
async def delete_category(category_id: str, request: Request):
    user = await get_current_user(request)
    policies.require_super_admin(user)

    result = await db.categories.delete_one({"id": category_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"message": "Category deleted"}

# ============ CSV EXPORT/IMPORT ============

@api_router.get("/products/export/csv")
async def export_products_csv(request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    
    products = await db.products.find({}, {"_id": 0}).to_list(10000)
    
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=[
        "name", "sku", "category", "price", "cost_price", "quantity",
        "min_stock_level", "barcode", "description"
    ])
    writer.writeheader()
    for product in products:
        writer.writerow({
            "name": product.get("name", ""),
            "sku": product.get("sku", ""),
            "category": product.get("category", ""),
            "price": product.get("price", 0),
            "cost_price": product.get("cost_price", 0),
            "quantity": product.get("quantity", 0),
            "min_stock_level": product.get("min_stock_level", 10),
            "barcode": product.get("barcode", ""),
            "description": product.get("description", "")
        })
    
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=inventory_export.csv"}
    )

@api_router.post("/products/import/csv")
async def import_products_csv(request: Request, file: UploadFile = File(...)):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="File must be a CSV")
    
    content = await file.read()
    decoded = content.decode("utf-8")
    reader = csv.DictReader(io.StringIO(decoded))
    
    imported = 0
    updated = 0
    errors = []
    
    for row_num, row in enumerate(reader, start=2):
        try:
            name = row.get("name", "").strip()
            sku = row.get("sku", "").strip()
            if not name or not sku:
                errors.append(f"Row {row_num}: Missing name or SKU")
                continue
            
            product_data = {
                "name": name,
                "sku": sku,
                "category": row.get("category", "Groceries").strip(),
                "price": float(row.get("price", 0)),
                "cost_price": float(row.get("cost_price", 0)),
                "quantity": int(float(row.get("quantity", 0))),
                "min_stock_level": int(float(row.get("min_stock_level", 10))),
                "barcode": row.get("barcode", "").strip(),
                "description": row.get("description", "").strip(),
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
            
            existing = await db.products.find_one({"sku": sku})
            if existing:
                await db.products.update_one({"sku": sku}, {"$set": product_data})
                updated += 1
            else:
                product_data["id"] = str(uuid.uuid4())
                product_data["created_at"] = datetime.now(timezone.utc).isoformat()
                await db.products.insert_one(product_data)
                imported += 1
        except Exception as e:
            errors.append(f"Row {row_num}: {str(e)}")
    
    return {
        "imported": imported,
        "updated": updated,
        "errors": errors,
        "total_processed": imported + updated
    }

# ============ REPORTS EXPORT ============

@api_router.get("/reports/export/sales-csv")
async def export_sales_csv(
    request: Request,
    days: int = Query(default=30, le=365),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    """Export sales data as CSV — opens in Excel."""
    user = await get_current_user(request)
    if user["role"] not in (policies.ROLE_SUPER_ADMIN, policies.ROLE_BRANCH_ADMIN):
        raise HTTPException(status_code=403, detail="Access denied")

    query = policies.sales_query_for_user(user, {})
    if start_date:
        query["created_at"] = {"$gte": start_date}
    elif days:
        from_date = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        query["created_at"] = {"$gte": from_date}
    if end_date:
        query.setdefault("created_at", {})["$lte"] = end_date

    sales = await db.sales.find(query, {"_id": 0}).sort("created_at", -1).to_list(10000)

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=[
        "date", "sale_id", "cashier", "customer", "payment_method",
        "subtotal", "discount", "total", "items_count", "branch_id"
    ])
    writer.writeheader()
    for sale in sales:
        writer.writerow({
            "date": sale.get("created_at", "")[:19].replace("T", " "),
            "sale_id": sale.get("id", ""),
            "cashier": sale.get("cashier_name", ""),
            "customer": sale.get("customer_name", ""),
            "payment_method": sale.get("payment_method", ""),
            "subtotal": sale.get("subtotal", 0),
            "discount": sale.get("discount_total", 0),
            "total": sale.get("total", 0),
            "items_count": len(sale.get("items", [])),
            "branch_id": sale.get("branch_id", ""),
        })

    output.seek(0)
    filename = f"sales_export_{datetime.now(timezone.utc).strftime('%Y-%m-%d')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@api_router.get("/reports/export/sales-items-csv")
async def export_sales_items_csv(
    request: Request,
    days: int = Query(default=30, le=365),
):
    """Export individual sale line items as CSV — useful for detailed analysis."""
    user = await get_current_user(request)
    if user["role"] not in (policies.ROLE_SUPER_ADMIN, policies.ROLE_BRANCH_ADMIN):
        raise HTTPException(status_code=403, detail="Access denied")

    from_date = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    query = policies.sales_query_for_user(user, {"created_at": {"$gte": from_date}})
    sales = await db.sales.find(query, {"_id": 0}).sort("created_at", -1).to_list(10000)

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=[
        "date", "sale_id", "product_name", "quantity", "unit_price",
        "line_total", "payment_method", "cashier", "customer"
    ])
    writer.writeheader()
    for sale in sales:
        for item in sale.get("items", []):
            writer.writerow({
                "date": sale.get("created_at", "")[:19].replace("T", " "),
                "sale_id": sale.get("id", ""),
                "product_name": item.get("product_name", ""),
                "quantity": item.get("quantity", 0),
                "unit_price": item.get("price", 0),
                "line_total": item.get("price", 0) * item.get("quantity", 0),
                "payment_method": sale.get("payment_method", ""),
                "cashier": sale.get("cashier_name", ""),
                "customer": sale.get("customer_name", ""),
            })

    output.seek(0)
    filename = f"sales_items_{datetime.now(timezone.utc).strftime('%Y-%m-%d')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

# ============ SUPPLIERS ============

@api_router.get("/suppliers")
async def get_suppliers(request: Request):
    user = await get_current_user(request)
    query = policies.apply_branch_scope(user, {})
    suppliers = await db.suppliers.find(query, {"_id": 0}).to_list(100)
    return suppliers

@api_router.get("/suppliers/{supplier_id}")
async def get_supplier(supplier_id: str, request: Request):
    user = await get_current_user(request)
    supplier = await db.suppliers.find_one({"id": supplier_id}, {"_id": 0})
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    policies.assert_branch_access(user, supplier, "supplier")
    return supplier

@api_router.post("/suppliers")
async def create_supplier(supplier: SupplierCreate, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")

    supplier_doc = supplier.model_dump()
    supplier_doc["id"] = str(uuid.uuid4())
    supplier_doc["branch_id"] = policies.resolve_branch_id(user)
    supplier_doc["created_at"] = datetime.now(timezone.utc).isoformat()
    
    await db.suppliers.insert_one(supplier_doc)
    del supplier_doc["_id"]
    await broadcast_entity_update("supplier", "created", supplier_doc)
    return supplier_doc

@api_router.put("/suppliers/{supplier_id}")
async def update_supplier(supplier_id: str, supplier: SupplierCreate, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")

    existing = await db.suppliers.find_one({"id": supplier_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Supplier not found")
    policies.assert_branch_access(user, existing, "supplier")

    update_data = supplier.model_dump()
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    result = await db.suppliers.update_one({"id": supplier_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Supplier not found")
    
    updated = await db.suppliers.find_one({"id": supplier_id}, {"_id": 0})
    await broadcast_entity_update("supplier", "updated", updated or {"id": supplier_id})
    return updated
async def delete_supplier(supplier_id: str, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    existing = await db.suppliers.find_one({"id": supplier_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Supplier not found")
    policies.assert_branch_access(user, existing, "supplier")

    result = await db.suppliers.delete_one({"id": supplier_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Supplier not found")
    await broadcast_entity_update("supplier", "deleted", {"id": supplier_id})
    return {"message": "Supplier deleted"}

# ============ PURCHASE ORDERS ============

@api_router.get("/purchase-orders")
async def get_purchase_orders(request: Request, supplier_id: Optional[str] = None):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    query = policies.apply_branch_scope(user, {})
    if supplier_id:
        query["supplier_id"] = supplier_id
    orders = await db.purchase_orders.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    return orders

@api_router.post("/purchase-orders")
async def create_purchase_order(order: PurchaseOrderCreate, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")

    supplier = await db.suppliers.find_one({"id": order.supplier_id})
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    policies.assert_branch_access(user, supplier, "supplier")

    if not order.items:
        raise HTTPException(status_code=400, detail="Order must have at least one item")

    total_cost = sum(i.quantity_ordered * i.unit_cost for i in order.items)
    branch_id = policies.resolve_branch_id(user)

    order_doc = {
        "id": str(uuid.uuid4()),
        "supplier_id": order.supplier_id,
        "supplier_name": supplier.get("name", ""),
        "items": [i.model_dump() for i in order.items],
        "total_cost": total_cost,
        "status": "pending",  # pending → received → cancelled
        "notes": order.notes,
        "expected_delivery": order.expected_delivery,
        "branch_id": branch_id,
        "created_by": user["id"],
        "created_by_name": user["name"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "received_at": None,
    }
    await db.purchase_orders.insert_one(order_doc)
    del order_doc["_id"]

    await log_audit(
        user["id"], user["name"], "purchase_order_created", "purchase_order",
        order_doc["id"], f"PO created for {supplier.get('name')} — ${total_cost:.2f}",
        branch_id=branch_id,
    )
    return order_doc

@api_router.put("/purchase-orders/{order_id}/receive")
async def receive_purchase_order(order_id: str, data: PurchaseOrderReceive, request: Request):
    """Mark a purchase order as received and update inventory quantities."""
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")

    order = await db.purchase_orders.find_one({"id": order_id})
    if not order:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if order.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Order is already received or cancelled")
    policies.assert_branch_access(user, order, "purchase order")

    # Update inventory for each received item
    updated_product_ids = []
    for item in data.items:
        pid = item.get("product_id")
        qty = int(item.get("quantity_received", 0))
        if pid and qty > 0:
            result = await db.products.update_one(
                {"id": pid},
                {"$inc": {"quantity": qty}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
            )
            if result.modified_count > 0:
                updated_product_ids.append(pid)

    # Mark order as received
    await db.purchase_orders.update_one(
        {"id": order_id},
        {"$set": {
            "status": "received",
            "received_at": datetime.now(timezone.utc).isoformat(),
            "received_by": user["id"],
            "received_by_name": user["name"],
            "receive_notes": data.notes,
            "received_items": data.items,
        }}
    )

    # Broadcast stock updates
    if updated_product_ids:
        await broadcast_stock_update(db, updated_product_ids, action="adjusted", low_stock=False)

    await log_audit(
        user["id"], user["name"], "purchase_order_received", "purchase_order",
        order_id, f"PO received — {len(updated_product_ids)} products restocked",
        branch_id=order.get("branch_id", ""),
    )
    updated_order = await db.purchase_orders.find_one({"id": order_id}, {"_id": 0})
    return updated_order

@api_router.put("/purchase-orders/{order_id}/cancel")
async def cancel_purchase_order(order_id: str, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")

    order = await db.purchase_orders.find_one({"id": order_id})
    if not order:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if order.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Only pending orders can be cancelled")
    policies.assert_branch_access(user, order, "purchase order")

    await db.purchase_orders.update_one(
        {"id": order_id},
        {"$set": {"status": "cancelled", "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    await log_audit(
        user["id"], user["name"], "purchase_order_cancelled", "purchase_order",
        order_id, f"PO cancelled",
        branch_id=order.get("branch_id", ""),
    )
    return {"message": "Purchase order cancelled"}

# ============ EMPLOYEES ============

@api_router.get("/employees")
async def get_employees(request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.EMPLOYEE_MANAGE_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")

    result = []
    async for emp in db.users.find(policies.employee_list_query(user)):
        result.append({
            "id": str(emp["_id"]),
            "email": emp["email"],
            "name": emp["name"],
            "role": emp["role"],
            "phone": emp.get("phone", ""),
            "salary": emp.get("salary", 0),
            "hire_date": emp.get("hire_date", ""),
            "branch_id": emp.get("branch_id", ""),
            "force_password_change": bool(emp.get("force_password_change", False)),
            "is_active": bool(emp.get("is_active", True)),  # default True for existing accounts
            "created_at": emp.get("created_at", "").isoformat() if isinstance(emp.get("created_at"), datetime) else str(emp.get("created_at", ""))
        })
    return result

@api_router.post("/employees")
async def create_employee(employee: EmployeeCreate, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.EMPLOYEE_MANAGE_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    if not policies.can_assign_role(user, employee.role):
        raise HTTPException(status_code=403, detail="Not allowed to assign this role")
    policies.validate_password(employee.password)

    email = employee.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already exists")

    branch_id = policies.resolve_branch_id(user, getattr(employee, 'branch_id', None))
    hashed = await hash_password_async(employee.password)
    emp_doc = {
        "email": email,
        "password_hash": hashed,
        "name": employee.name,
        "role": employee.role,
        "phone": employee.phone,
        "salary": employee.salary,
        "hire_date": employee.hire_date,
        "branch_id": branch_id,
        "created_at": datetime.now(timezone.utc),
        "force_password_change": True,  # employee must set own password on first login
    }
    if policies.is_super_admin(user) and employee.role == policies.ROLE_SUPER_ADMIN:
        emp_doc.pop("branch_id", None)
    result = await db.users.insert_one(emp_doc)
    emp_id = str(result.inserted_id)
    response_doc = {
        "id": emp_id,
        "email": email,
        "name": employee.name,
        "role": employee.role,
        "phone": employee.phone,
        "salary": employee.salary,
        "hire_date": employee.hire_date,
        "branch_id": branch_id,
    }
    await broadcast_entity_update("employee", "created", response_doc)
    return response_doc

@api_router.delete("/employees/{employee_id}")
async def delete_employee(employee_id: str, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.EMPLOYEE_MANAGE_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")

    if employee_id == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    target = await db.users.find_one({"_id": normalize_db_id(employee_id)})
    if not target:
        raise HTTPException(status_code=404, detail="Employee not found")
    if policies.is_branch_admin(user):
        policies.assert_branch_access(user, target, "employee")
        if target.get("role") not in policies.BRANCH_STAFF_ROLES:
            raise HTTPException(status_code=403, detail="Cannot delete this user")

    result = await db.users.delete_one({"_id": normalize_db_id(employee_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Employee not found")
    await broadcast_entity_update("employee", "deleted", {"id": employee_id})
    return {"message": "Employee deleted"}

@api_router.put("/employees/{employee_id}")
async def update_employee(employee_id: str, employee: EmployeeUpdate, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.EMPLOYEE_MANAGE_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")

    target = await db.users.find_one({"_id": normalize_db_id(employee_id)})
    if not target:
        raise HTTPException(status_code=404, detail="Employee not found")

    # Branch admins can only edit staff in their own branch
    if policies.is_branch_admin(user):
        policies.assert_branch_access(user, target, "employee")
        if target.get("role") not in policies.BRANCH_STAFF_ROLES:
            raise HTTPException(status_code=403, detail="Cannot edit this user")

    # Validate role change if requested
    if employee.role is not None and employee.role != target.get("role"):
        if employee.role not in policies.ALL_ROLES:
            raise HTTPException(status_code=400, detail="Invalid role")
        if not policies.can_assign_role(user, employee.role):
            raise HTTPException(status_code=403, detail="Not allowed to assign this role")

    update_data: dict = {}
    if employee.name is not None:
        update_data["name"] = employee.name
    if employee.phone is not None:
        update_data["phone"] = employee.phone
    if employee.role is not None:
        update_data["role"] = employee.role
    if employee.salary is not None:
        update_data["salary"] = employee.salary
    if employee.hire_date is not None:
        update_data["hire_date"] = employee.hire_date
    if employee.password is not None:
        policies.validate_password(employee.password)
        update_data["password_hash"] = await hash_password_async(employee.password)

    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"_id": normalize_db_id(employee_id)}, {"$set": update_data})

    updated = await db.users.find_one({"_id": normalize_db_id(employee_id)})
    await log_audit(
        user["id"], user["name"], "employee_updated", "employee",
        employee_id, f"Updated employee: {updated.get('name', '')}",
        branch_id=user.get("branch_id", ""),
    )
    emp_response = {
        "id": str(updated["_id"]),
        "email": updated["email"],
        "name": updated["name"],
        "role": updated["role"],
        "phone": updated.get("phone", ""),
        "salary": updated.get("salary", 0),
        "hire_date": updated.get("hire_date", ""),
        "branch_id": updated.get("branch_id", ""),
    }
    await broadcast_entity_update("employee", "updated", emp_response)
    return emp_response


@api_router.put("/employees/{employee_id}/toggle-status")
async def toggle_employee_status(employee_id: str, request: Request):
    """Activate or deactivate an employee without deleting them."""
    user = await get_current_user(request)
    if user["role"] not in policies.EMPLOYEE_MANAGE_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")

    if employee_id == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot deactivate yourself")

    target = await db.users.find_one({"_id": normalize_db_id(employee_id)})
    if not target:
        raise HTTPException(status_code=404, detail="Employee not found")

    if policies.is_branch_admin(user):
        policies.assert_branch_access(user, target, "employee")
        if target.get("role") not in policies.BRANCH_STAFF_ROLES:
            raise HTTPException(status_code=403, detail="Cannot modify this user")

    new_status = not bool(target.get("is_active", True))
    await db.users.update_one(
        {"_id": normalize_db_id(employee_id)},
        {"$set": {"is_active": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )

    action = "activated" if new_status else "deactivated"
    await log_audit(
        user["id"], user["name"], f"employee_{action}", "employee",
        employee_id, f"Employee {target.get('name', '')} {action}",
        branch_id=user.get("branch_id", ""),
    )
    await broadcast_entity_update("employee", "updated", {
        "id": employee_id,
        "is_active": new_status,
        "name": target.get("name", ""),
    })
    return {"id": employee_id, "is_active": new_status, "message": f"Employee {action}"}


@api_router.post("/sales")
async def create_sale(sale: SaleCreate, request: Request):
    user = await get_current_user(request)
    if user["role"] not in policies.SALE_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")

    idempotency_key = sale.idempotency_key or request.headers.get("Idempotency-Key")
    if idempotency_key:
        existing_sale = await db.sales.find_one({"idempotency_key": idempotency_key}, {"_id": 0})
        if existing_sale:
            return existing_sale

    if settings.require_open_shift_for_sales and user["role"] == policies.ROLE_CASHIER:
        open_shift = await db.shifts.find_one({"user_id": user["id"], "status": "open"})
        if not open_shift:
            raise HTTPException(status_code=400, detail="Open a shift before processing sales")

    if not sale.items:
        raise HTTPException(status_code=400, detail="Sale must include at least one item")

    branch_id = await resolve_branch_id_for_sale(user, db)

    # Fetch all products in ONE query instead of N separate queries
    product_ids = [item.product_id for item in sale.items]
    products_cursor = db.products.find({"id": {"$in": product_ids}})
    products_list = await products_cursor.to_list(len(product_ids))
    products_map = {p["id"]: p for p in products_list}

    for item in sale.items:
        if item.quantity <= 0:
            raise HTTPException(status_code=400, detail="Item quantity must be positive")
        product_doc = products_map.get(item.product_id)
        if not product_doc:
            raise HTTPException(status_code=404, detail=f"Product not found: {item.product_name}")
        policies.assert_branch_access(user, product_doc, "product")
        if product_doc.get("quantity", 0) < item.quantity:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient stock for {item.product_name}",
            )

    # Calculate totals
    subtotal = sum(item.price * item.quantity - item.discount for item in sale.items)
    promo_discount = 0
    promo_code_used = None
    
    # Apply promo code if provided
    if sale.promo_code:
        promo = await db.promo_codes.find_one({"code": sale.promo_code.upper(), "active": True})
        if promo:
            # Check expiry
            if promo.get("expiry_date") and promo["expiry_date"] < datetime.now(timezone.utc).isoformat()[:10]:
                pass  # expired, skip
            elif promo.get("min_purchase", 0) > subtotal:
                pass  # below minimum
            elif promo.get("max_uses", 0) > 0 and promo.get("used_count", 0) >= promo["max_uses"]:
                pass  # max uses reached
            else:
                if promo["discount_type"] == "percentage":
                    promo_discount = subtotal * (promo["discount_value"] / 100)
                else:
                    promo_discount = min(promo["discount_value"], subtotal)
                promo_code_used = sale.promo_code.upper()
                await db.promo_codes.update_one({"code": promo_code_used}, {"$inc": {"used_count": 1}})
    
    total = subtotal - sale.discount_total - promo_discount
    if total < 0:
        total = 0
    
    sale_doc = {
        "id": str(uuid.uuid4()),
        "items": [item.model_dump() for item in sale.items],
        "subtotal": subtotal,
        "discount_total": sale.discount_total + promo_discount,
        "promo_code": promo_code_used,
        "promo_discount": promo_discount,
        "total": total,
        "payment_method": sale.payment_method,
        "customer_name": sale.customer_name,
        "cashier_id": user["id"],
        "cashier_name": user["name"],
        "branch_id": branch_id,
        "idempotency_key": idempotency_key,
        "created_at": datetime.now(timezone.utc).isoformat()
    }

    updated_product_ids = []
    try:
        # ── Atomic stock deduction + sale insert ──────────────────────────────
        # Use bulk_write for all stock updates in ONE round-trip, then insert sale.
        # This is much faster than a per-item loop inside a transaction.
        bulk_ops = [
            UpdateOne(
                {"id": item.product_id, "quantity": {"$gte": item.quantity}},
                {"$inc": {"quantity": -item.quantity}},
            )
            for item in sale.items
        ]

        async with await db_module.client.start_session() as session:
            async with session.start_transaction():
                bulk_result = await db.products.bulk_write(bulk_ops, session=session)
                if bulk_result.modified_count != len(sale.items):
                    # At least one item had insufficient stock — find which one
                    for item in sale.items:
                        p = await db.products.find_one(
                            {"id": item.product_id}, {"quantity": 1}, session=session
                        )
                        if not p or p.get("quantity", 0) < item.quantity:
                            raise HTTPException(
                                status_code=409,
                                detail=f"Insufficient stock for {item.product_name}",
                            )
                    raise HTTPException(status_code=409, detail="Insufficient stock")

                await db.sales.insert_one(sale_doc, session=session)

        updated_product_ids = [item.product_id for item in sale.items]

    except HTTPException:
        raise
    except Exception:
        raise

    del sale_doc["_id"]

    # ── Fire audit log + broadcast in background so response returns immediately ──
    async def _post_sale_tasks():
        try:
            await log_audit(
                user["id"], user["name"], "sale_created", "sale",
                sale_doc["id"], f"Sale ${total:.2f} ({len(sale.items)} items)",
                branch_id=branch_id,
            )
            updated_products = await db.products.find(
                {"id": {"$in": updated_product_ids}},
                {"id": 1, "quantity": 1, "min_stock_level": 1, "_id": 0}
            ).to_list(len(updated_product_ids))
            low_stock = any(
                p.get("quantity", 0) <= p.get("min_stock_level", 0)
                for p in updated_products
            )
            await broadcast_stock_update(
                db, updated_product_ids, action="sale",
                sale_id=sale_doc["id"], low_stock=low_stock
            )
            await broadcast_entity_update("sale", "created", {
                "id": sale_doc["id"],
                "total": total,
                "subtotal": subtotal,
                "payment_method": sale_doc["payment_method"],
                "cashier_id": user["id"],
                "cashier_name": user["name"],
                "branch_id": branch_id,
                "item_count": len(sale.items),
                "created_at": sale_doc["created_at"],
            })
        except Exception as exc:
            logger.warning("Post-sale background task failed: %s", exc)

    asyncio.create_task(_post_sale_tasks())

    return sale_doc

@api_router.get("/sales")
async def get_sales(
    request: Request,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    limit: int = Query(default=100, le=1000)
):
    user = await get_current_user(request)

    query = policies.sales_query_for_user(user, {})

    if start_date:
        query["created_at"] = {"$gte": start_date}
    if end_date:
        if "created_at" in query:
            query["created_at"]["$lte"] = end_date
        else:
            query["created_at"] = {"$lte": end_date}
    
    sales = await db.sales.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return sales

@api_router.get("/sales/{sale_id}")
async def get_sale(sale_id: str, request: Request):
    user = await get_current_user(request)
    sale = await db.sales.find_one({"id": sale_id}, {"_id": 0})
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    policies.assert_branch_access(user, sale, "sale")
    if user["role"] == policies.ROLE_CASHIER and sale.get("cashier_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    return sale

# ============ REPORTS/ANALYTICS ============

@api_router.get("/reports/dashboard")
async def get_dashboard_stats(request: Request):
    user = await get_current_user(request)

    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday = today - timedelta(days=1)
    month_start = today.replace(day=1)
    today_str = today.isoformat()
    yesterday_str = yesterday.isoformat()
    month_start_str = month_start.isoformat()

    branch_match = {}
    if not policies.is_super_admin(user):
        branch_match["branch_id"] = user.get("branch_id", "__no_branch__")
    if user.get("role") in (policies.ROLE_SERVER, policies.ROLE_BARTENDER):
        branch_match["server_id"] = user["id"]

    # Parallel counts
    product_q = policies.apply_branch_scope(user, {})
    low_stock_q = policies.apply_branch_scope(user, {
        "$expr": {"$lte": ["$current_stock", "$min_stock_level"]},
    })
    supplier_q = policies.apply_branch_scope(user, {})
    room_q = policies.apply_branch_scope(user, {})

    count_tasks = [
        db.menu_items.count_documents(policies.apply_branch_scope(user, {})),
        db.ingredients.count_documents(low_stock_q),
        db.suppliers.count_documents(supplier_q),
        db.rooms.count_documents(room_q),
        db.rooms.count_documents({**room_q, "occupancy_status": "occupied"}),
        db.rooms.count_documents({**room_q, "occupancy_status": "reserved"}),
    ]
    if user["role"] in policies.EMPLOYEE_MANAGE_ROLES:
        count_tasks.append(db.users.count_documents(policies.employee_list_query(user)))

    counts = await asyncio.gather(*count_tasks)
    total_menu_items = counts[0]
    low_stock_count = counts[1]
    total_suppliers = counts[2]
    total_rooms = counts[3]
    occupied_rooms = counts[4]
    reserved_rooms = counts[5]
    total_employees = counts[6] if len(counts) > 6 else 0

    # Orders / revenue aggregation
    sales_pipeline = [
        {"$match": {**branch_match, "created_at": {"$gte": month_start_str}}},
        {"$group": {
            "_id": {
                "period": {
                    "$cond": [
                        {"$gte": ["$created_at", today_str]}, "today",
                        {"$cond": [
                            {"$gte": ["$created_at", yesterday_str]}, "yesterday",
                            "month"
                        ]}
                    ]
                }
            },
            "revenue": {"$sum": "$total_amount"},
            "orders": {"$sum": 1},
        }},
    ]

    agg_result = await db.orders.aggregate(sales_pipeline).to_list(10)
    period_map: dict = {}
    for row in agg_result:
        period_map[row["_id"]["period"]] = row

    today_revenue = period_map.get("today", {}).get("revenue", 0)
    today_orders = period_map.get("today", {}).get("orders", 0)
    yesterday_revenue = period_map.get("yesterday", {}).get("revenue", 0)
    yesterday_orders = period_map.get("yesterday", {}).get("orders", 0)
    month_revenue = sum(r.get("revenue", 0) for r in period_map.values())
    month_orders = sum(r.get("orders", 0) for r in period_map.values())

    revenue_change_pct = (
        round(((today_revenue - yesterday_revenue) / yesterday_revenue) * 100, 1)
        if yesterday_revenue > 0 else None
    )
    orders_change_pct = (
        round(((today_orders - yesterday_orders) / yesterday_orders) * 100, 1)
        if yesterday_orders > 0 else None
    )

    # Active orders (open/preparing/served)
    active_orders_count = await db.orders.count_documents({
        **branch_match,
        "status": {"$in": ["open", "sent_to_kitchen", "ready", "served"]},
        "payment_status": "unpaid",
    })

    return {
        "total_menu_items": total_menu_items,
        "low_stock_count": low_stock_count,
        "total_suppliers": total_suppliers,
        "total_employees": total_employees,
        "total_rooms": total_rooms,
        "occupied_rooms": occupied_rooms,
        "reserved_rooms": reserved_rooms,
        "available_rooms": total_rooms - occupied_rooms - reserved_rooms,
        "active_orders_count": active_orders_count,
        "today_revenue": today_revenue,
        "today_orders": today_orders,
        "yesterday_revenue": yesterday_revenue,
        "yesterday_orders": yesterday_orders,
        "revenue_change_pct": revenue_change_pct,
        "orders_change_pct": orders_change_pct,
        "month_revenue": month_revenue,
        "month_orders": month_orders,
    }

@api_router.get("/reports/sales-by-date")
async def get_sales_by_date(
    request: Request,
    days: int = Query(default=7, le=90)
):
    user = await get_current_user(request)
    start_date = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    match = policies.sales_query_for_user(user, {"created_at": {"$gte": start_date}})
    pipeline = [
        {"$match": match},
        {"$group": {
            "_id": {"$substr": ["$created_at", 0, 10]},
            "revenue": {"$sum": "$total_amount"},
            "orders": {"$sum": 1},
        }},
        {"$project": {"_id": 0, "date": "$_id", "revenue": 1, "orders": 1}},
        {"$sort": {"date": 1}},
    ]
    return await db.orders.aggregate(pipeline).to_list(days + 5)

@api_router.get("/reports/top-products")
async def get_top_products(
    request: Request,
    limit: int = Query(default=10, le=50),
    days: int = Query(default=0, ge=0, le=365),
):
    """Top selling menu items by revenue."""
    user = await get_current_user(request)

    base_match = policies.sales_query_for_user(user, {})
    if days > 0:
        base_match["created_at"] = {"$gte": (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()}

    pipeline = [
        {"$match": base_match},
        {"$unwind": "$items"},
        {"$group": {
            "_id": "$items.menu_item_id",
            "product_name": {"$first": "$items.menu_item_name"},
            "total_quantity": {"$sum": "$items.quantity"},
            "total_revenue": {"$sum": "$items.line_total"},
        }},
        {"$project": {
            "_id": 0,
            "product_id": "$_id",
            "product_name": 1,
            "total_quantity": 1,
            "total_revenue": 1,
        }},
        {"$sort": {"total_revenue": -1}},
        {"$limit": limit},
    ]
    return await db.orders.aggregate(pipeline).to_list(limit)

@api_router.get("/reports/sales-by-category")
async def get_sales_by_category(
    request: Request,
    days: int = Query(default=0, ge=0, le=365),
):
    """Revenue breakdown by menu category."""
    user = await get_current_user(request)

    base_match = policies.sales_query_for_user(user, {})
    if days > 0:
        base_match["created_at"] = {"$gte": (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()}

    pipeline = [
        {"$match": base_match},
        {"$unwind": "$items"},
        {"$lookup": {
            "from": "menu_items",
            "localField": "items.menu_item_id",
            "foreignField": "id",
            "as": "menu_info",
            "pipeline": [{"$project": {"category": 1, "_id": 0}}],
        }},
        {"$addFields": {
            "category": {
                "$ifNull": [
                    {"$arrayElemAt": ["$menu_info.category", 0]},
                    "Uncategorized"
                ]
            }
        }},
        {"$group": {
            "_id": "$category",
            "revenue": {"$sum": "$items.line_total"},
            "quantity": {"$sum": "$items.quantity"},
        }},
        {"$project": {"_id": 0, "category": "$_id", "revenue": 1, "quantity": 1}},
        {"$sort": {"revenue": -1}},
    ]
    return await db.orders.aggregate(pipeline).to_list(50)

# ============ PROMO CODES ============

@api_router.get("/promo-codes")
async def get_promo_codes(request: Request):
    user = await get_current_user(request)
    policies.require_super_admin(user)
    codes = await db.promo_codes.find({}, {"_id": 0}).to_list(100)
    return codes

@api_router.post("/promo-codes")
async def create_promo_code(promo: PromoCodeCreate, request: Request):
    user = await get_current_user(request)
    policies.require_super_admin(user)
    
    existing = await db.promo_codes.find_one({"code": promo.code.upper()})
    if existing:
        raise HTTPException(status_code=400, detail="Promo code already exists")
    
    promo_doc = promo.model_dump()
    promo_doc["id"] = str(uuid.uuid4())
    promo_doc["code"] = promo.code.upper()
    promo_doc["used_count"] = 0
    promo_doc["created_at"] = datetime.now(timezone.utc).isoformat()
    
    await db.promo_codes.insert_one(promo_doc)
    del promo_doc["_id"]
    
    await log_audit(user["id"], user["name"], "promo_created", "promo_code", promo_doc["id"], f"Promo code: {promo.code.upper()}")
    return promo_doc

@api_router.delete("/promo-codes/{code_id}")
async def delete_promo_code(code_id: str, request: Request):
    user = await get_current_user(request)
    policies.require_super_admin(user)

    result = await db.promo_codes.delete_one({"id": code_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Promo code not found")
    return {"message": "Promo code deleted"}

@api_router.post("/promo-codes/validate")
async def validate_promo_code(data: PromoCodeApply, request: Request):
    await get_current_user(request)
    promo = await db.promo_codes.find_one({"code": data.code.upper(), "active": True})
    if not promo:
        raise HTTPException(status_code=404, detail="Invalid promo code")
    
    if promo.get("expiry_date") and promo["expiry_date"] < datetime.now(timezone.utc).isoformat()[:10]:
        raise HTTPException(status_code=400, detail="Promo code expired")
    if promo.get("min_purchase", 0) > data.subtotal:
        raise HTTPException(status_code=400, detail=f"Minimum purchase ${promo['min_purchase']:.2f} required")
    if promo.get("max_uses", 0) > 0 and promo.get("used_count", 0) >= promo["max_uses"]:
        raise HTTPException(status_code=400, detail="Promo code usage limit reached")
    
    if promo["discount_type"] == "percentage":
        discount = data.subtotal * (promo["discount_value"] / 100)
    else:
        discount = min(promo["discount_value"], data.subtotal)
    
    return {
        "valid": True,
        "code": promo["code"],
        "discount_type": promo["discount_type"],
        "discount_value": promo["discount_value"],
        "calculated_discount": discount
    }

# ============ AUDIT LOG ============

@api_router.get("/audit-logs")
async def get_audit_logs(
    request: Request,
    entity_type: Optional[str] = None,
    limit: int = Query(default=100, le=500)
):
    user = await get_current_user(request)
    if user["role"] not in (policies.ROLE_SUPER_ADMIN, policies.ROLE_BRANCH_ADMIN):
        raise HTTPException(status_code=403, detail="Access denied")

    query = policies.apply_branch_scope(user, {})
    if entity_type:
        query["entity_type"] = entity_type

    logs = await db.audit_logs.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return logs

# ============ SHIFT MANAGEMENT ============

@api_router.post("/shifts/start")
async def start_shift(request: Request):
    user = await get_current_user(request)
    
    # Check for existing open shift
    open_shift = await db.shifts.find_one({"user_id": user["id"], "status": "open"})
    if open_shift:
        raise HTTPException(status_code=400, detail="You already have an open shift")
    
    shift_doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "user_name": user["name"],
        "user_role": user["role"],
        "start_time": datetime.now(timezone.utc).isoformat(),
        "end_time": None,
        "status": "open",
        "opening_cash": 0,
        "closing_cash": 0,
        "total_sales": 0,
        "total_cash": 0,
        "total_card": 0,
        "transaction_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.shifts.insert_one(shift_doc)
    del shift_doc["_id"]
    
    await log_audit(user["id"], user["name"], "shift_started", "shift", shift_doc["id"], "Shift started")
    return shift_doc

@api_router.post("/shifts/end")
async def end_shift(request: Request):
    user = await get_current_user(request)
    
    open_shift = await db.shifts.find_one({"user_id": user["id"], "status": "open"})
    if not open_shift:
        raise HTTPException(status_code=400, detail="No open shift found")
    
    # Calculate shift sales
    shift_start = open_shift["start_time"]
    shift_sales = await db.sales.find({
        "cashier_id": user["id"],
        "created_at": {"$gte": shift_start}
    }).to_list(10000)
    
    total_sales = sum(s.get("total", 0) for s in shift_sales)
    total_cash = sum(s.get("total", 0) for s in shift_sales if s.get("payment_method") == "cash")
    total_card = sum(s.get("total", 0) for s in shift_sales if s.get("payment_method") == "card")
    transaction_count = len(shift_sales)
    
    end_time = datetime.now(timezone.utc).isoformat()
    
    await db.shifts.update_one(
        {"id": open_shift["id"]},
        {"$set": {
            "end_time": end_time,
            "status": "closed",
            "total_sales": total_sales,
            "total_cash": total_cash,
            "total_card": total_card,
            "transaction_count": transaction_count
        }}
    )
    
    shift_report = await db.shifts.find_one({"id": open_shift["id"]}, {"_id": 0})
    
    await log_audit(user["id"], user["name"], "shift_ended", "shift", open_shift["id"], f"Shift ended: ${total_sales:.2f} in {transaction_count} transactions")
    return shift_report

@api_router.get("/shifts/current")
async def get_current_shift(request: Request):
    user = await get_current_user(request)
    shift = await db.shifts.find_one({"user_id": user["id"], "status": "open"}, {"_id": 0})
    return shift or {"status": "none"}

@api_router.get("/shifts/history")
async def get_shift_history(request: Request, limit: int = Query(default=20, le=100)):
    user = await get_current_user(request)
    query = {} if user["role"] == "admin" else {"user_id": user["id"]}
    shifts = await db.shifts.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return shifts

# ============ IMAGE UPLOAD (GridFS → MongoDB) ============

@api_router.post("/products/{product_id}/upload-image")
async def upload_product_image(product_id: str, request: Request, file: UploadFile = File(...)):
    user = await get_current_user(request)
    if user["role"] not in policies.INVENTORY_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")

    product = await db.products.find_one({"id": product_id})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    allowed_types = ["image/jpeg", "image/png", "image/webp", "image/gif"]
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, WebP, GIF images allowed")

    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 5MB)")

    fs = get_gridfs()

    # Delete any existing image for this product first
    old_file_id = product.get("image_file_id")
    if old_file_id:
        try:
            from bson import ObjectId as BsonObjectId
            await fs.delete(BsonObjectId(old_file_id))
        except Exception:
            pass  # ignore if already gone

    # Upload new image to GridFS
    file_id = await fs.upload_from_stream(
        filename=f"product_{product_id}",
        source=io.BytesIO(data),
        metadata={
            "product_id": product_id,
            "content_type": file.content_type,
            "original_filename": file.filename,
        },
    )

    # Store only the file_id reference on the product document (not the image data)
    image_url = f"/api/products/{product_id}/image"
    await db.products.update_one(
        {"id": product_id},
        {"$set": {
            "image_file_id": str(file_id),
            "image_url": image_url,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }}
    )

    await broadcast_entity_update("product_image", "updated", {
        "id": product_id,
        "image_url": image_url,
    })
    return {"image_url": image_url, "message": "Image uploaded successfully"}

# ============ BRANCH MANAGEMENT ============

@api_router.get("/branches")
async def get_branches(request: Request):
    user = await get_current_user(request)
    if policies.is_super_admin(user):
        return await db.branches.find({}, {"_id": 0}).to_list(100)
    if policies.is_branch_admin(user) and user.get("branch_id"):
        branch = await db.branches.find_one({"id": user["branch_id"]}, {"_id": 0})
        return [branch] if branch else []
    raise HTTPException(status_code=403, detail="Access denied")

@api_router.post("/branches")
async def create_branch(branch: BranchCreate, request: Request):
    user = await get_current_user(request)
    policies.require_super_admin(user)
    
    branch_doc = branch.model_dump()
    branch_doc["id"] = str(uuid.uuid4())
    branch_doc["created_at"] = datetime.now(timezone.utc).isoformat()
    
    await db.branches.insert_one(branch_doc)
    del branch_doc["_id"]
    await log_audit(user["id"], user["name"], "branch_created", "branch", branch_doc["id"], f"Branch created: {branch.name}")
    await broadcast_entity_update("branch", "created", branch_doc)
    return branch_doc

@api_router.put("/branches/{branch_id}")
async def update_branch(branch_id: str, branch: BranchCreate, request: Request):
    user = await get_current_user(request)
    policies.require_super_admin(user)
    
    update_data = branch.model_dump()
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    result = await db.branches.update_one({"id": branch_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Branch not found")
    
    updated = await db.branches.find_one({"id": branch_id}, {"_id": 0})
    await broadcast_entity_update("branch", "updated", updated or {"id": branch_id})
    return updated
async def delete_branch(branch_id: str, request: Request):
    user = await get_current_user(request)
    policies.require_super_admin(user)
    
    result = await db.branches.delete_one({"id": branch_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Branch not found")
    await broadcast_entity_update("branch", "deleted", {"id": branch_id})
    return {"message": "Branch deleted"}

@api_router.put("/employees/{employee_id}/assign-branch")
async def assign_employee_to_branch(employee_id: str, request: Request):
    user = await get_current_user(request)
    policies.require_super_admin(user)

    body = await request.json()
    branch_id = body.get("branch_id")

    try:
        oid = normalize_db_id(employee_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Employee not found")

    result = await db.users.update_one(
        {"_id": oid},
        {"$set": {"branch_id": branch_id}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Employee not found")

    updated = await db.users.find_one({"_id": oid})
    await broadcast_entity_update("employee", "updated", {
        "id": employee_id,
        "branch_id": branch_id,
        "name": updated.get("name", "") if updated else "",
    })
    return {"message": "Branch assigned"}

# ============ WEBSOCKET ============

@app.websocket("/ws/stock")
async def websocket_stock(
    websocket: WebSocket,
    token: Optional[str] = Query(default=None),
    last_event_id: Optional[str] = Query(default=None),
):
    if not token:
        await websocket.close(code=4401, reason="Missing token")
        return
    if not get_jwt_secret():
        await websocket.close(code=1011, reason="Server misconfigured")
        return

    identity = verify_ws_access_token(token, get_jwt_secret(), JWT_ALGORITHM)
    if not identity:
        await websocket.close(code=4401, reason="Invalid or expired token")
        return

    # Ensure token is single-use (if Redis enabled)
    try:
        ok = await realtime.verify_and_consume_ws_token(token)
        if not ok:
            await websocket.close(code=4401, reason="Token already used or invalid")
            return
    except Exception:
        # best-effort: allow connection if Redis check fails
        pass

    remote_addr = None
    user_agent = None
    try:
        remote_addr = getattr(websocket.client, "host", None)
    except Exception:
        remote_addr = None
    try:
        user_agent = websocket.headers.get("user-agent")
    except Exception:
        user_agent = None

    accepted = await realtime.manager.connect(
        websocket,
        identity["user_id"],
        identity["role"],
        remote_addr=remote_addr,
        user_agent=user_agent,
    )
    if not accepted:
        await websocket.close(code=1013, reason="Realtime capacity reached")
        return

    missed = await realtime.deliver_missed_events(websocket, last_event_id)
    if missed:
        WS_MISSED_EVENTS_DELIVERED.inc(missed)
        logger.info("Delivered %s missed realtime events", missed)

    realtime.manager.record_pong(websocket)

    try:
        while True:
            raw = await websocket.receive_text()
            realtime.manager.touch(websocket)
            if raw in ("pong", '{"type":"pong"}'):
                realtime.manager.record_pong(websocket)
                continue
            try:
                parsed = json.loads(raw)
                if parsed.get("type") == "pong":
                    realtime.manager.record_pong(websocket)
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        await realtime.manager.disconnect(websocket)

# ============ STARTUP ============

@app.on_event("startup")
async def startup_event():
    global db
    logger.info("Starting Bar & Restaurant Management System using MongoDB...")

    if settings.is_production:
        policies.validate_environment()
    elif not settings.jwt_secret:
        logger.warning("JWT_SECRET is missing; set a strong secret before production")

    db = db_module.init_db()
    await realtime.manager.start()
    try:
        await realtime.start_redis_listener()
    except Exception:
        logger.warning("Failed to start Redis listener; continuing without Redis")

    asyncio.create_task(_init_db_background())


async def _init_db_background():
    """Initialize indexes and seed bar/restaurant data in the background after startup."""
    global db
    await asyncio.sleep(1)
    try:
        await db_module.ensure_indexes()
        # Extra indexes for bar/restaurant collections
        await db.orders.create_index([("branch_id", 1), ("status", 1)])
        await db.orders.create_index([("room_id", 1), ("status", 1)])
        await db.orders.create_index("idempotency_key", unique=True, sparse=True)
        await db.orders.create_index([("created_at", -1)])
        await db.menu_items.create_index([("branch_id", 1), ("category", 1)])
        await db.menu_items.create_index("id", unique=True)
        await db.rooms.create_index("id", unique=True)
        await db.rooms.create_index([("branch_id", 1), ("occupancy_status", 1)])
        await db.reservations.create_index([("room_id", 1), ("start_datetime", 1)])
        await db.reservations.create_index([("branch_id", 1), ("status", 1)])
        await db.ingredients.create_index("id", unique=True)
        await db.ingredients.create_index([("branch_id", 1)])
        await db.recipes.create_index("menu_item_id", unique=True)
        logger.info("MongoDB indexes ensured (bar & restaurant)")
    except Exception as exc:
        logger.error(f"Failed to ensure MongoDB indexes: {exc}")
        return

    default_branch_id = None
    branch_count = await db.branches.count_documents({})
    if branch_count == 0:
        default_branch = {
            "id": str(uuid.uuid4()),
            "name": "Main Bar & Restaurant",
            "address": "Bole Road, Addis Ababa",
            "phone": "+251911000001",
            "manager_name": "Owner",
            "tin": "0000000000",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.branches.insert_one(default_branch)
        default_branch_id = default_branch["id"]
        logger.info(f"Default branch created: Main Bar & Restaurant ({default_branch_id})")

        await db.users.update_many(
            {"branch_id": {"$exists": False}, "role": {"$ne": policies.ROLE_SUPER_ADMIN}},
            {"$set": {"branch_id": default_branch_id}},
        )
        await db.products.update_many(
            {"branch_id": {"$exists": False}},
            {"$set": {"branch_id": default_branch_id}}
        )
    else:
        first_branch = await db.branches.find_one({})
        if first_branch:
            default_branch_id = first_branch["id"]
            await db.users.update_many(
                {"branch_id": {"$exists": False}, "role": {"$ne": policies.ROLE_SUPER_ADMIN}},
                {"$set": {"branch_id": default_branch_id}},
            )
            await db.products.update_many(
                {"branch_id": {"$exists": False}},
                {"$set": {"branch_id": default_branch_id}}
            )

    # Seed admin user and default accounts
    admin_email = settings.admin_email
    admin_password = settings.admin_password
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        await db.users.insert_one({
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "name": "Admin",
            "role": "admin",
            "created_at": datetime.now(timezone.utc)
        })
        logger.info(f"Super admin user created: {admin_email}")
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {"password_hash": hash_password(admin_password)}}
        )
        logger.info(f"Admin password updated: {admin_email}")
    await db.users.update_one(
        {"email": admin_email},
        {"$unset": {"branch_id": ""}},
    )

    accounts = [
        {"email": "manager@barrestaurant.com",  "password": "manager123", "name": "Abebe Girma",   "role": policies.ROLE_BRANCH_ADMIN,  "phone": "+251911000002", "salary": 45000, "hire_date": "2024-01-01"},
        {"email": "roommanager@barrestaurant.com","password": "room123",   "name": "Tigist Haile",  "role": policies.ROLE_ROOM_MANAGER,  "phone": "+251911000003", "salary": 35000, "hire_date": "2024-02-01"},
        {"email": "server@barrestaurant.com",    "password": "server123",  "name": "Yonas Tadesse", "role": policies.ROLE_SERVER,        "phone": "+251911000004", "salary": 22000, "hire_date": "2024-03-01"},
        {"email": "bartender@barrestaurant.com", "password": "bar123",     "name": "Mekdes Alemu",  "role": policies.ROLE_BARTENDER,     "phone": "+251911000005", "salary": 28000, "hire_date": "2024-03-15"},
        {"email": "kitchen@barrestaurant.com",   "password": "kitchen123", "name": "Dawit Bekele",  "role": policies.ROLE_KITCHEN,       "phone": "+251911000006", "salary": 25000, "hire_date": "2024-04-01"},
        {"email": "cashier@barrestaurant.com",   "password": "cashier123", "name": "Sara Mengistu", "role": policies.ROLE_CASHIER,       "phone": "+251911000007", "salary": 20000, "hire_date": "2024-05-01"},
    ]
    for account in accounts:
        existing_account = await db.users.find_one({"email": account["email"]})
        if existing_account is None:
            doc = {
                "email": account["email"],
                "password_hash": hash_password(account["password"]),
                "name": account["name"],
                "role": account["role"],
                "phone": account["phone"],
                "salary": account["salary"],
                "hire_date": account["hire_date"],
                "created_at": datetime.now(timezone.utc),
            }
            if account["role"] != policies.ROLE_SUPER_ADMIN:
                doc["branch_id"] = default_branch_id
            await db.users.insert_one(doc)
            logger.info(f"{account['role']} user created: {account['email']}")
        elif not verify_password(account["password"], existing_account.get("password_hash", "")):
            await db.users.update_one(
                {"email": account["email"]},
                {"$set": {"password_hash": hash_password(account["password"])}}
            )

    # ── Seed menu categories ──────────────────────────────────────────────
    default_categories = ["Food", "Drinks", "Cocktails", "Beer & Wine", "Appetizers", "Main Course", "Desserts", "Soft Drinks"]
    for cat in default_categories:
        await db.categories.update_one(
            {"name": cat},
            {"$setOnInsert": {
                "id": str(uuid.uuid4()), "name": cat,
                "description": f"{cat} items",
                "created_at": datetime.now(timezone.utc).isoformat()
            }},
            upsert=True,
        )

    # ── Seed sample menu items ────────────────────────────────────────────
    menu_count = await db.menu_items.count_documents({})
    if menu_count == 0 and default_branch_id:
        sample_menu = [
            {"name": "Tibs (Beef)", "name_am": "ጥብስ", "category": "Main Course", "price": 180, "cost_price": 80, "is_alcohol": False, "prep_time": 20, "route_to": "kitchen", "description": "Sautéed beef with herbs and spices"},
            {"name": "Kitfo", "name_am": "ክትፎ", "category": "Main Course", "price": 220, "cost_price": 100, "is_alcohol": False, "prep_time": 15, "route_to": "kitchen", "description": "Ethiopian steak tartare"},
            {"name": "Injera Firfir", "name_am": "ፍርፍር", "category": "Main Course", "price": 120, "cost_price": 40, "is_alcohol": False, "prep_time": 10, "route_to": "kitchen", "description": "Shredded injera with berbere"},
            {"name": "Sambusa (3pc)", "name_am": "ሳምቡሳ", "category": "Appetizers", "price": 80, "cost_price": 30, "is_alcohol": False, "prep_time": 8, "route_to": "kitchen", "description": "Crispy pastry with filling"},
            {"name": "Tej", "name_am": "ጠጅ", "category": "Beer & Wine", "price": 60, "cost_price": 20, "is_alcohol": True, "prep_time": 2, "route_to": "bar", "description": "Ethiopian honey wine"},
            {"name": "St. George Beer", "name_am": "ቅዱስ ጊዮርጊስ", "category": "Beer & Wine", "price": 70, "cost_price": 35, "is_alcohol": True, "prep_time": 1, "route_to": "bar", "description": "Local Ethiopian lager"},
            {"name": "Whisky (Single)", "name_am": "ዊስኪ", "category": "Drinks", "price": 150, "cost_price": 70, "is_alcohol": True, "prep_time": 2, "route_to": "bar", "description": "Premium whisky"},
            {"name": "Mojito", "name_am": "ሞሂቶ", "category": "Cocktails", "price": 200, "cost_price": 80, "is_alcohol": True, "prep_time": 5, "route_to": "bar", "description": "Classic rum cocktail"},
            {"name": "Buna (Ethiopian Coffee)", "name_am": "ቡና", "category": "Soft Drinks", "price": 50, "cost_price": 15, "is_alcohol": False, "prep_time": 10, "route_to": "bar", "description": "Traditional Ethiopian coffee ceremony"},
            {"name": "Mango Juice", "name_am": "ማንጎ ጁስ", "category": "Soft Drinks", "price": 80, "cost_price": 30, "is_alcohol": False, "prep_time": 3, "route_to": "bar", "description": "Fresh mango juice"},
            {"name": "Tiramisu", "name_am": "ቲራሚሱ", "category": "Desserts", "price": 120, "cost_price": 50, "is_alcohol": False, "prep_time": 5, "route_to": "kitchen", "description": "Italian coffee dessert"},
        ]
        for item in sample_menu:
            await db.menu_items.insert_one({
                **item, "id": str(uuid.uuid4()),
                "is_available": True,
                "branch_id": default_branch_id,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
        logger.info(f"Seeded {len(sample_menu)} sample menu items")

    # ── Seed sample rooms ─────────────────────────────────────────────────
    room_count = await db.rooms.count_documents({})
    if room_count == 0 and default_branch_id:
        sample_rooms = [
            {"name": "VIP Lounge A", "description": "Private VIP room with karaoke", "capacity_min": 4, "capacity_max": 15, "hourly_rate": 500, "minimum_spend": 2000, "amenities": ["karaoke", "projector", "private_bar"], "floor_plan_x": 1, "floor_plan_y": 1},
            {"name": "VIP Lounge B", "description": "Intimate VIP room", "capacity_min": 2, "capacity_max": 8,  "hourly_rate": 300, "minimum_spend": 1000, "amenities": ["sound_system", "private_bar"], "floor_plan_x": 2, "floor_plan_y": 1},
            {"name": "Executive Suite", "description": "Large event room", "capacity_min": 10, "capacity_max": 40, "hourly_rate": 1000, "minimum_spend": 5000, "amenities": ["projector", "sound_system", "karaoke", "dance_floor"], "floor_plan_x": 1, "floor_plan_y": 2},
            {"name": "Garden Room", "description": "Outdoor terrace room", "capacity_min": 4, "capacity_max": 20, "hourly_rate": 400, "minimum_spend": 1500, "amenities": ["outdoor", "garden_view"], "floor_plan_x": 2, "floor_plan_y": 2},
        ]
        for room in sample_rooms:
            await db.rooms.insert_one({
                **room, "id": str(uuid.uuid4()),
                "occupancy_status": "available",
                "status": "active",
                "branch_id": default_branch_id,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
        logger.info(f"Seeded {len(sample_rooms)} sample rooms")


    memory_dir = ROOT_DIR / "memory"
    memory_dir.mkdir(parents=True, exist_ok=True)
    with open(memory_dir / "test_credentials.md", "w") as f:
        f.write(f"""# Bar & Restaurant — Test Credentials

## Owner (HQ / Super Admin)
- Email: {admin_email}
- Password: {admin_password}
- Role: owner
- Access: Full system, all branches, reports, staff management

## Restaurant Manager (Main Branch)
- Email: manager@barrestaurant.com
- Password: manager123
- Role: restaurant_manager
- Access: Menu, staff, rooms, void orders, reports

## Room Manager
- Email: roommanager@barrestaurant.com
- Password: room123
- Role: room_manager
- Access: Rooms, reservations, VIP handling

## Server
- Email: server@barrestaurant.com
- Password: server123
- Role: server
- Access: Take orders, serve, view own orders

## Bartender
- Email: bartender@barrestaurant.com
- Password: bar123
- Role: bartender
- Access: Bar display, drink orders, bar inventory

## Kitchen Staff
- Email: kitchen@barrestaurant.com
- Password: kitchen123
- Role: kitchen_staff
- Access: Kitchen Display System (KDS), 86 items, recipes

## Cashier
- Email: cashier@barrestaurant.com
- Password: cashier123
- Role: cashier
- Access: Payment processing, shift reconciliation

## Auth Endpoints
- POST /api/auth/login
- POST /api/auth/logout
- GET /api/auth/me
- POST /api/auth/refresh

## New Bar & Restaurant Endpoints
- GET/POST  /api/menu-items
- GET/POST  /api/rooms
- PATCH     /api/rooms/{{id}}/status
- GET/POST  /api/reservations
- POST/GET  /api/orders
- PATCH     /api/orders/{{id}}/status
- POST      /api/orders/{{id}}/pay
- GET       /api/orders/kitchen  (KDS)
- GET       /api/orders/bar      (Bar display)
- GET/POST  /api/ingredients
- GET/POST  /api/recipes
- GET       /api/reports/floor-status
""")
    logger.info("Test credentials written to /app/memory/test_credentials.md")
@app.on_event("shutdown")
async def shutdown_db_client():
    # Stop realtime manager and Redis listener
    try:
        await realtime.stop_redis_listener()
    except Exception:
        logger.warning("Error stopping Redis listener")
    await realtime.manager.stop()
    try:
        db_module.close_db()
        logger.info("MongoDB client closed cleanly")
    except Exception as exc:
        logger.warning(f"Failed to close database client cleanly: {exc}")

# Include the router in the main app
app.include_router(api_router)

@api_router.get("/")
async def root():
    return {"message": "Supermarket Management System API"}

# ── Serve React frontend build (same-origin deployment) ──────────────────────
import os as _os
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse as _FileResponse

_frontend_build = _os.path.join(_os.path.dirname(_os.path.dirname(__file__)), "frontend", "build")

if _os.path.isdir(_frontend_build):
    # Serve static assets
    app.mount("/static", StaticFiles(directory=_os.path.join(_frontend_build, "static")), name="static")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_react(full_path: str):
        """Catch-all: serve React app for any non-API route."""
        index = _os.path.join(_frontend_build, "index.html")
        return _FileResponse(index)
