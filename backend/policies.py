"""Enforced security, performance, and reliability rules for the Bar & Restaurant API."""
from __future__ import annotations

import re
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException, Request

from .config import settings

# ── Bar & Restaurant Roles ───────────────────────────────────────────────────
ROLE_SUPER_ADMIN    = "owner"
ROLE_BRANCH_ADMIN   = "restaurant_manager"
ROLE_ROOM_MANAGER   = "room_manager"
ROLE_SERVER         = "server"
ROLE_BARTENDER      = "bartender"
ROLE_KITCHEN        = "kitchen_staff"
ROLE_CASHIER        = "cashier"
ROLE_INVENTORY      = "restaurant_manager"   # legacy alias

ALL_ROLES = {
    ROLE_SUPER_ADMIN, ROLE_BRANCH_ADMIN, ROLE_ROOM_MANAGER,
    ROLE_SERVER, ROLE_BARTENDER, ROLE_KITCHEN, ROLE_CASHIER,
}
BRANCH_STAFF_ROLES = {ROLE_SERVER, ROLE_BARTENDER, ROLE_KITCHEN, ROLE_CASHIER, ROLE_ROOM_MANAGER}

# ── Permission sets (based on finalised matrix) ───────────────────────────────

# Who can place / add-to orders (CHANGE 1: Room Manager added)
ORDER_ROLES = {ROLE_SUPER_ADMIN, ROLE_BRANCH_ADMIN, ROLE_ROOM_MANAGER,
               ROLE_SERVER, ROLE_BARTENDER, ROLE_CASHIER}

# Who can process payments
PAYMENT_ROLES = {ROLE_SUPER_ADMIN, ROLE_BRANCH_ADMIN, ROLE_CASHIER}

# Who can void / cancel orders (manager approval workflow)
VOID_ROLES = {ROLE_SUPER_ADMIN, ROLE_BRANCH_ADMIN}

# Who can manage menu / inventory
INVENTORY_ROLES = {ROLE_SUPER_ADMIN, ROLE_BRANCH_ADMIN}

# Who can manage employees
EMPLOYEE_MANAGE_ROLES = {ROLE_SUPER_ADMIN, ROLE_BRANCH_ADMIN}

# Who can view rooms and reservations (FOH staff)
ROOM_ACCESS_ROLES = {ROLE_SUPER_ADMIN, ROLE_BRANCH_ADMIN, ROLE_ROOM_MANAGER,
                     ROLE_SERVER, ROLE_CASHIER}

# Who can create / edit reservations (CHANGE: only management + room manager)
RESERVATION_MANAGE_ROLES = {ROLE_SUPER_ADMIN, ROLE_BRANCH_ADMIN, ROLE_ROOM_MANAGER}

# Kitchen Display access (CHANGE 2: Bartender removed from Kitchen, Kitchen removed from Bar)
# Each station sees only their own queue
KITCHEN_DISPLAY_ROLES = {ROLE_SUPER_ADMIN, ROLE_BRANCH_ADMIN, ROLE_KITCHEN}
BAR_DISPLAY_ROLES     = {ROLE_SUPER_ADMIN, ROLE_BRANCH_ADMIN, ROLE_BARTENDER}

# Combined for routes that serve both (legacy — used by item-status update)
KITCHEN_ACCESS_ROLES  = KITCHEN_DISPLAY_ROLES | BAR_DISPLAY_ROLES

# Who can log waste/spillage (CHANGE 3: Kitchen + Bartender, not servers)
WASTE_LOG_ROLES = {ROLE_SUPER_ADMIN, ROLE_BRANCH_ADMIN, ROLE_BARTENDER, ROLE_KITCHEN}

# Legacy alias
SALE_ROLES = ORDER_ROLES


def is_super_admin(user: dict) -> bool:
    return user.get("role") == ROLE_SUPER_ADMIN


def is_branch_admin(user: dict) -> bool:
    return user.get("role") == ROLE_BRANCH_ADMIN


def require_super_admin(user: dict) -> None:
    if not is_super_admin(user):
        raise HTTPException(status_code=403, detail="Super admin access required")


def can_assign_role(creator: dict, target_role: str) -> bool:
    if target_role not in ALL_ROLES:
        return False
    if is_super_admin(creator):
        return True
    if is_branch_admin(creator):
        return target_role in BRANCH_STAFF_ROLES
    return False


def employee_list_query(user: dict) -> dict:
    if is_super_admin(user):
        return {"role": {"$ne": ROLE_SUPER_ADMIN}}
    if is_branch_admin(user):
        branch_id = user.get("branch_id") or "__no_branch__"
        return {
            "branch_id": branch_id,
            "role": {"$in": list(BRANCH_STAFF_ROLES)},
        }
    raise HTTPException(status_code=403, detail="Access denied")


def sales_query_for_user(user: dict, base: Optional[dict] = None) -> dict:
    """Build a MongoDB query scoped to the user's branch (and server if applicable)."""
    query = apply_branch_scope(user, base)
    # Servers and bartenders only see their own orders
    if user.get("role") in (ROLE_SERVER, ROLE_BARTENDER):
        query["server_id"] = user["id"]
    elif user.get("role") == ROLE_CASHIER:
        # Cashiers see all orders in their branch (for payment processing)
        pass
    return query


def validate_environment() -> None:
    if not settings.jwt_secret or len(settings.jwt_secret) < 32:
        raise RuntimeError("JWT_SECRET must be set and at least 32 characters")

    if settings.is_production and settings.use_memory_db:
        raise RuntimeError("USE_MEMORY_DB is not allowed when APP_ENV=production")

    if settings.is_production and settings.admin_password in ("admin123", "password", "changeme"):
        raise RuntimeError("Change default ADMIN_PASSWORD before production deployment")


def validate_password(password: str) -> None:
    min_len = settings.min_password_length
    if len(password) < min_len:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {min_len} characters",
        )
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        raise HTTPException(
            status_code=400,
            detail="Password must include at least one letter and one number",
        )


def escape_regex(value: str, max_len: int = 100) -> str:
    cleaned = (value or "").strip()[:max_len]
    return re.escape(cleaned)


def apply_branch_scope(user: dict, query: Optional[dict] = None) -> dict:
    scoped = dict(query or {})
    if is_super_admin(user):
        return scoped
    branch_id = user.get("branch_id") or ""
    if not branch_id:
        scoped["branch_id"] = "__no_branch__"
    else:
        scoped["branch_id"] = branch_id
    return scoped


def assert_branch_access(user: dict, document: dict, resource: str = "resource") -> None:
    if is_super_admin(user):
        return
    doc_branch = document.get("branch_id") or ""
    user_branch = user.get("branch_id") or ""
    if doc_branch and user_branch and doc_branch != user_branch:
        raise HTTPException(status_code=403, detail=f"Access denied to this {resource}")


def resolve_branch_id(user: dict, requested_branch_id: Optional[str] = None) -> str:
    if is_super_admin(user):
        if requested_branch_id:
            return requested_branch_id
        # Super admin without a specific branch — raise a clear error
        raise HTTPException(
            status_code=400,
            detail="Please select a branch for this employee"
        )
    branch_id = user.get("branch_id") or ""
    if not branch_id:
        raise HTTPException(status_code=400, detail="User is not assigned to a branch")
    return branch_id


async def resolve_branch_id_for_sale(user: dict, db, requested_branch_id: Optional[str] = None) -> str:
    """Like resolve_branch_id but for sales — Super Admin falls back to first branch."""
    if is_super_admin(user):
        if requested_branch_id:
            return requested_branch_id
        # Super admin: fall back to first branch in DB
        first_branch = await db.branches.find_one({}, {"id": 1})
        if first_branch:
            return first_branch["id"]
        raise HTTPException(status_code=400, detail="No branches found. Create a branch first.")
    branch_id = user.get("branch_id") or ""
    if not branch_id:
        raise HTTPException(status_code=400, detail="User is not assigned to a branch")
    return branch_id


def sales_query_for_user(user: dict, base: Optional[dict] = None) -> dict:
    """Build a MongoDB query scoped to the user's branch (and server if applicable)."""
    query = apply_branch_scope(user, base)
    # Servers and bartenders only see their own orders
    if user.get("role") in (ROLE_SERVER, ROLE_BARTENDER):
        query["server_id"] = user["id"]
    elif user.get("role") == ROLE_CASHIER:
        # Cashiers see all orders in their branch (for payment processing)
        pass
    return query


def clamp_pagination(skip: int, limit: int) -> tuple[int, int]:
    safe_skip = max(0, skip)
    safe_limit = max(1, min(limit, settings.max_page_size))
    return safe_skip, safe_limit


class RateLimiter:
    """Simple in-memory sliding-window limiter (per instance)."""

    def __init__(self) -> None:
        self._events: dict[str, list[float]] = defaultdict(list)

    def check(self, key: str, limit: int, window_seconds: int = 60) -> None:
        now = time.time()
        window_start = now - window_seconds
        bucket = self._events[key]
        self._events[key] = [ts for ts in bucket if ts >= window_start]
        if len(self._events[key]) >= limit:
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Please try again later.",
            )
        self._events[key].append(now)


rate_limiter = RateLimiter()


def rate_limit_key(request: Request, suffix: str = "") -> str:
    ip = request.client.host if request.client else "unknown"
    return f"{ip}:{suffix or request.url.path}"


def audit_failed_login(email: str, ip: str) -> dict:
    return {
        "action": "login_failed",
        "email": email,
        "ip": ip,
        "at": datetime.now(timezone.utc).isoformat(),
    }
