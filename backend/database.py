"""SQLAlchemy async database layer for PostgreSQL."""
from __future__ import annotations

import os
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, mapped_column, Mapped, relationship
from sqlalchemy import (
    String, Integer, Float, Boolean, Text, DateTime, JSON,
    ForeignKey, Enum as SAEnum, Index, func, UniqueConstraint
)
from datetime import datetime, timezone
from typing import Optional, List
import enum

# ── Connection ─────────────────────────────────────────────────────────────
_raw_url = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://postgres:postgres@localhost:5432/bar_restaurant_ethiopia"
)
# Handle both plain postgresql:// and already-converted postgresql+asyncpg://
if _raw_url.startswith("postgresql+asyncpg://") or _raw_url.startswith("postgresql+psycopg"):
    DATABASE_URL = _raw_url
else:
    DATABASE_URL = _raw_url.replace("postgresql://", "postgresql+asyncpg://").replace("postgres://", "postgresql+asyncpg://")

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def create_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Safe migrations — add columns that may not exist in older deployments
        migrations = [
            "ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS deduct_on_order BOOLEAN DEFAULT FALSE",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS assigned_server_id VARCHAR(36)",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS assigned_server_name VARCHAR(200)",
            "ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS par_level FLOAT DEFAULT 0",
        ]
        for sql in migrations:
            try:
                await conn.execute(__import__('sqlalchemy').text(sql))
            except Exception:
                pass  # column already exists or table not yet created


# ── Enums ───────────────────────────────────────────────────────────────────
class UserRole(str, enum.Enum):
    owner = "owner"
    restaurant_manager = "restaurant_manager"
    room_manager = "room_manager"
    server = "server"
    bartender = "bartender"
    kitchen_staff = "kitchen_staff"
    cashier = "cashier"

class OccupancyStatus(str, enum.Enum):
    available = "available"
    occupied  = "occupied"
    reserved  = "reserved"
    dirty     = "dirty"

class RoomStatus(str, enum.Enum):
    active      = "active"
    maintenance = "maintenance"
    closed      = "closed"

class ReservationStatus(str, enum.Enum):
    confirmed = "confirmed"
    seated    = "seated"
    completed = "completed"
    cancelled = "cancelled"
    no_show   = "no-show"

class OrderStatus(str, enum.Enum):
    open             = "open"
    sent_to_kitchen  = "sent_to_kitchen"
    ready            = "ready"
    served           = "served"
    closed           = "closed"
    cancelled        = "cancelled"

class PaymentStatus(str, enum.Enum):
    unpaid = "unpaid"
    paid   = "paid"

class OrderItemStatus(str, enum.Enum):
    pending   = "pending"
    preparing = "preparing"
    ready     = "ready"
    served    = "served"
    cancelled = "cancelled"

class OrderType(str, enum.Enum):
    dine_in  = "dine_in"
    takeaway = "takeaway"
    delivery = "delivery"
    bar      = "bar"

class PaymentMethod(str, enum.Enum):
    cash   = "cash"
    card   = "card"
    credit = "credit"


# ── Models ──────────────────────────────────────────────────────────────────

class Branch(Base):
    __tablename__ = "branches"
    id         : Mapped[str] = mapped_column(String(36), primary_key=True)
    name       : Mapped[str] = mapped_column(String(200))
    address    : Mapped[Optional[str]] = mapped_column(Text)
    phone      : Mapped[Optional[str]] = mapped_column(String(30))
    manager_name: Mapped[Optional[str]] = mapped_column(String(200))
    is_active  : Mapped[bool] = mapped_column(Boolean, default=True)
    created_at : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    users      : Mapped[List["User"]]      = relationship(back_populates="branch")
    rooms      : Mapped[List["Room"]]      = relationship(back_populates="branch")
    menu_items : Mapped[List["MenuItem"]]  = relationship(back_populates="branch")
    orders     : Mapped[List["Order"]]     = relationship(back_populates="branch")


class User(Base):
    __tablename__ = "users"
    id              : Mapped[str] = mapped_column(String(36), primary_key=True)
    email           : Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash   : Mapped[str] = mapped_column(String(200))
    name            : Mapped[str] = mapped_column(String(200))
    phone           : Mapped[Optional[str]] = mapped_column(String(30))
    role            : Mapped[str] = mapped_column(String(50))
    branch_id       : Mapped[Optional[str]] = mapped_column(ForeignKey("branches.id"), nullable=True)
    salary          : Mapped[Optional[float]] = mapped_column(Float)
    hire_date       : Mapped[Optional[str]] = mapped_column(String(20))
    is_active       : Mapped[bool] = mapped_column(Boolean, default=True)
    force_password_change: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at      : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    branch   : Mapped[Optional["Branch"]] = relationship(back_populates="users")
    orders   : Mapped[List["Order"]]      = relationship(back_populates="server", foreign_keys="Order.server_id")
    shifts   : Mapped[List["Shift"]]      = relationship(back_populates="user")


class Room(Base):
    __tablename__ = "rooms"
    id               : Mapped[str] = mapped_column(String(36), primary_key=True)
    name             : Mapped[str] = mapped_column(String(200))
    description      : Mapped[Optional[str]] = mapped_column(Text)
    capacity_min     : Mapped[int] = mapped_column(Integer, default=2)
    capacity_max     : Mapped[int] = mapped_column(Integer, default=20)
    hourly_rate      : Mapped[Optional[float]] = mapped_column(Float)
    minimum_spend    : Mapped[float] = mapped_column(Float, default=0)
    amenities        : Mapped[Optional[dict]] = mapped_column(JSON, default=list)
    floor_plan_x     : Mapped[Optional[int]] = mapped_column(Integer)
    floor_plan_y     : Mapped[Optional[int]] = mapped_column(Integer)
    occupancy_status : Mapped[str] = mapped_column(String(20), default="available")
    status           : Mapped[str] = mapped_column(String(20), default="active")
    branch_id        : Mapped[str] = mapped_column(ForeignKey("branches.id"))
    created_at       : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at       : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    branch       : Mapped["Branch"]            = relationship(back_populates="rooms")
    reservations : Mapped[List["Reservation"]] = relationship(back_populates="room")
    orders       : Mapped[List["Order"]]       = relationship(back_populates="room")
    charges      : Mapped[List["RoomCharge"]]  = relationship(back_populates="room")


class RoomCharge(Base):
    """Tracks room fee payments separately from food/drink orders."""
    __tablename__ = "room_charges"
    id               : Mapped[str] = mapped_column(String(36), primary_key=True)
    room_id          : Mapped[str] = mapped_column(ForeignKey("rooms.id"))
    reservation_id   : Mapped[Optional[str]] = mapped_column(ForeignKey("reservations.id"), nullable=True)
    # Customer info (copied at time of charge for history)
    customer_name    : Mapped[str] = mapped_column(String(200))
    customer_phone   : Mapped[Optional[str]] = mapped_column(String(30))
    party_size       : Mapped[Optional[int]] = mapped_column(Integer)
    # Session details
    start_datetime   : Mapped[Optional[str]] = mapped_column(String(50))
    end_datetime     : Mapped[Optional[str]] = mapped_column(String(50))
    # Charge details
    hours            : Mapped[Optional[float]] = mapped_column(Float)
    hourly_rate      : Mapped[Optional[float]] = mapped_column(Float)
    room_fee         : Mapped[float] = mapped_column(Float, default=0)
    payment_method   : Mapped[str] = mapped_column(String(20), default="cash")
    payment_reference: Mapped[Optional[str]] = mapped_column(String(200))
    notes            : Mapped[Optional[str]] = mapped_column(Text)
    # Who processed it
    cashier_id       : Mapped[str] = mapped_column(String(36))
    cashier_name     : Mapped[str] = mapped_column(String(200))
    branch_id        : Mapped[str] = mapped_column(ForeignKey("branches.id"))
    created_at       : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    room        : Mapped["Room"]               = relationship(back_populates="charges")
    reservation : Mapped[Optional["Reservation"]] = relationship()

    __table_args__ = (Index("ix_room_charges_room", "room_id"), Index("ix_room_charges_date", "created_at"),)


class Reservation(Base):
    __tablename__ = "reservations"
    id                   : Mapped[str] = mapped_column(String(36), primary_key=True)
    room_id              : Mapped[str] = mapped_column(ForeignKey("rooms.id"))
    customer_name        : Mapped[str] = mapped_column(String(200))
    phone                : Mapped[str] = mapped_column(String(30))
    email                : Mapped[Optional[str]] = mapped_column(String(255))
    party_size           : Mapped[int] = mapped_column(Integer)
    start_datetime       : Mapped[str] = mapped_column(String(50))
    end_datetime         : Mapped[str] = mapped_column(String(50))
    status               : Mapped[str] = mapped_column(String(20), default="confirmed")
    notes                : Mapped[Optional[str]] = mapped_column(Text)
    deposit_amount       : Mapped[Optional[float]] = mapped_column(Float)
    deposit_paid         : Mapped[bool] = mapped_column(Boolean, default=False)
    deposit_method       : Mapped[Optional[str]] = mapped_column(String(20))
    minimum_spend_agreed : Mapped[float] = mapped_column(Float, default=0)
    special_requests     : Mapped[Optional[dict]] = mapped_column(JSON, default=list)
    actual_start_time    : Mapped[Optional[str]] = mapped_column(String(50))
    actual_end_time      : Mapped[Optional[str]] = mapped_column(String(50))
    assigned_server_id   : Mapped[Optional[str]] = mapped_column(ForeignKey("users.id"), nullable=True)
    branch_id            : Mapped[str] = mapped_column(ForeignKey("branches.id"))
    created_by           : Mapped[str] = mapped_column(String(36))
    created_by_name      : Mapped[str] = mapped_column(String(200))
    created_at           : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at           : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    room   : Mapped["Room"]           = relationship(back_populates="reservations")
    orders : Mapped[List["Order"]]    = relationship(back_populates="reservation")

    __table_args__ = (Index("ix_res_room_start", "room_id", "start_datetime"),)


class Category(Base):
    __tablename__ = "categories"
    id          : Mapped[str] = mapped_column(String(36), primary_key=True)
    name        : Mapped[str] = mapped_column(String(100), unique=True)
    description : Mapped[Optional[str]] = mapped_column(Text)
    created_at  : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    menu_items : Mapped[List["MenuItem"]] = relationship(back_populates="category_rel")


class MenuItem(Base):
    __tablename__ = "menu_items"
    id           : Mapped[str] = mapped_column(String(36), primary_key=True)
    name         : Mapped[str] = mapped_column(String(200))
    name_am      : Mapped[Optional[str]] = mapped_column(String(200))
    category     : Mapped[str] = mapped_column(String(100))
    category_id  : Mapped[Optional[str]] = mapped_column(ForeignKey("categories.id"), nullable=True)
    price        : Mapped[float] = mapped_column(Float)
    cost_price   : Mapped[float] = mapped_column(Float, default=0)
    description  : Mapped[Optional[str]] = mapped_column(Text)
    is_alcohol   : Mapped[bool] = mapped_column(Boolean, default=False)
    is_available : Mapped[bool] = mapped_column(Boolean, default=True)
    prep_time    : Mapped[int] = mapped_column(Integer, default=10)
    route_to     : Mapped[str] = mapped_column(String(20), default="kitchen")
    # deduct_on_order: True = pick-and-serve (beer, drinks) → deduct stock immediately on order
    #                  False = cooked/prepared items → deduct stock when marked ready
    deduct_on_order: Mapped[bool] = mapped_column(Boolean, default=False)
    branch_id    : Mapped[str] = mapped_column(ForeignKey("branches.id"))
    created_at   : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at   : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    branch       : Mapped["Branch"]       = relationship(back_populates="menu_items")
    category_rel : Mapped[Optional["Category"]] = relationship(back_populates="menu_items")
    order_items  : Mapped[List["OrderItem"]] = relationship(back_populates="menu_item")


class Ingredient(Base):
    __tablename__ = "ingredients"
    id              : Mapped[str] = mapped_column(String(36), primary_key=True)
    name            : Mapped[str] = mapped_column(String(200))
    unit            : Mapped[str] = mapped_column(String(20))
    cost_per_unit   : Mapped[float] = mapped_column(Float, default=0)
    current_stock   : Mapped[float] = mapped_column(Float, default=0)
    min_stock_level : Mapped[float] = mapped_column(Float, default=0)
    # par_level: fixed stock level to maintain at the bar (0 = not a bar item)
    par_level       : Mapped[float] = mapped_column(Float, default=0)
    supplier_id     : Mapped[Optional[str]] = mapped_column(String(36))
    branch_id       : Mapped[str] = mapped_column(ForeignKey("branches.id"))
    created_at      : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at      : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Recipe(Base):
    __tablename__ = "recipes"
    id           : Mapped[str] = mapped_column(String(36), primary_key=True)
    menu_item_id : Mapped[str] = mapped_column(ForeignKey("menu_items.id"), unique=True)
    ingredients  : Mapped[dict] = mapped_column(JSON, default=list)
    instructions : Mapped[Optional[str]] = mapped_column(Text)
    prep_time    : Mapped[int] = mapped_column(Integer, default=10)
    created_at   : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at   : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Order(Base):
    __tablename__ = "orders"
    id               : Mapped[str] = mapped_column(String(36), primary_key=True)
    branch_id        : Mapped[str] = mapped_column(ForeignKey("branches.id"))
    room_id          : Mapped[Optional[str]] = mapped_column(ForeignKey("rooms.id"), nullable=True)
    table_number     : Mapped[Optional[str]] = mapped_column(String(20))
    reservation_id   : Mapped[Optional[str]] = mapped_column(ForeignKey("reservations.id"), nullable=True)
    server_id        : Mapped[str] = mapped_column(ForeignKey("users.id"))
    server_name      : Mapped[str] = mapped_column(String(200))
    # For owner orders — the server assigned to deliver the order
    assigned_server_id   : Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    assigned_server_name : Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    order_type       : Mapped[str] = mapped_column(String(20), default="dine_in")
    order_source     : Mapped[str] = mapped_column(String(20), default="table")
    status           : Mapped[str] = mapped_column(String(30), default="open")
    payment_status   : Mapped[str] = mapped_column(String(20), default="unpaid")
    notes            : Mapped[Optional[str]] = mapped_column(Text)
    subtotal         : Mapped[float] = mapped_column(Float, default=0)
    service_charge   : Mapped[float] = mapped_column(Float, default=0)
    vat_amount       : Mapped[float] = mapped_column(Float, default=0)
    tot_amount       : Mapped[float] = mapped_column(Float, default=0)
    discount_amount  : Mapped[float] = mapped_column(Float, default=0)
    total_amount     : Mapped[float] = mapped_column(Float, default=0)
    tip_amount       : Mapped[float] = mapped_column(Float, default=0)
    payment_method   : Mapped[Optional[str]] = mapped_column(String(20))
    payment_reference: Mapped[Optional[str]] = mapped_column(String(100))
    split_payments   : Mapped[Optional[dict]] = mapped_column(JSON)
    is_voided        : Mapped[bool] = mapped_column(Boolean, default=False)
    void_reason      : Mapped[Optional[str]] = mapped_column(Text)
    voided_at        : Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    paid_at          : Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    paid_by          : Mapped[Optional[str]] = mapped_column(String(36))
    paid_by_name     : Mapped[Optional[str]] = mapped_column(String(200))
    idempotency_key  : Mapped[Optional[str]] = mapped_column(String(64), unique=True, nullable=True)
    created_at       : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at       : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    branch      : Mapped["Branch"]            = relationship(back_populates="orders")
    room        : Mapped[Optional["Room"]]    = relationship(back_populates="orders")
    server      : Mapped["User"]              = relationship(back_populates="orders", foreign_keys=[server_id])
    reservation : Mapped[Optional["Reservation"]] = relationship(back_populates="orders")
    items       : Mapped[List["OrderItem"]]   = relationship(back_populates="order", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_order_branch_status", "branch_id", "status"),
        Index("ix_order_room_status", "room_id", "status"),
    )


class OrderItem(Base):
    __tablename__ = "order_items"
    id             : Mapped[str] = mapped_column(String(36), primary_key=True)
    order_id       : Mapped[str] = mapped_column(ForeignKey("orders.id"))
    menu_item_id   : Mapped[str] = mapped_column(ForeignKey("menu_items.id"))
    menu_item_name : Mapped[str] = mapped_column(String(200))
    quantity       : Mapped[int] = mapped_column(Integer)
    unit_price     : Mapped[float] = mapped_column(Float)
    line_total     : Mapped[float] = mapped_column(Float)
    modifiers      : Mapped[Optional[dict]] = mapped_column(JSON, default=list)
    kitchen_note   : Mapped[Optional[str]] = mapped_column(Text)
    course         : Mapped[Optional[str]] = mapped_column(String(50))
    route_to       : Mapped[str] = mapped_column(String(20), default="kitchen")
    status         : Mapped[str] = mapped_column(String(20), default="pending")
    sent_at        : Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    ready_at       : Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    served_at      : Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at     : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    order     : Mapped["Order"]    = relationship(back_populates="items")
    menu_item : Mapped["MenuItem"] = relationship(back_populates="order_items")


class Shift(Base):
    __tablename__ = "shifts"
    id                : Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id           : Mapped[str] = mapped_column(ForeignKey("users.id"))
    user_name         : Mapped[str] = mapped_column(String(200))
    user_role         : Mapped[str] = mapped_column(String(50))
    start_time        : Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_time          : Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    status            : Mapped[str] = mapped_column(String(20), default="open")
    total_sales       : Mapped[float] = mapped_column(Float, default=0)
    total_cash        : Mapped[float] = mapped_column(Float, default=0)
    total_card        : Mapped[float] = mapped_column(Float, default=0)
    transaction_count : Mapped[int] = mapped_column(Integer, default=0)
    branch_id         : Mapped[Optional[str]] = mapped_column(ForeignKey("branches.id"), nullable=True)
    created_at        : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user : Mapped["User"] = relationship(back_populates="shifts")


class Supplier(Base):
    __tablename__ = "suppliers"
    id             : Mapped[str] = mapped_column(String(36), primary_key=True)
    name           : Mapped[str] = mapped_column(String(200))
    email          : Mapped[Optional[str]] = mapped_column(String(255))
    phone          : Mapped[str] = mapped_column(String(30))
    address        : Mapped[Optional[str]] = mapped_column(Text)
    contact_person : Mapped[Optional[str]] = mapped_column(String(200))
    branch_id      : Mapped[str] = mapped_column(ForeignKey("branches.id"))
    created_at     : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id          : Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id     : Mapped[str] = mapped_column(String(36))
    user_name   : Mapped[str] = mapped_column(String(200))
    action      : Mapped[str] = mapped_column(String(100))
    entity_type : Mapped[str] = mapped_column(String(50))
    entity_id   : Mapped[Optional[str]] = mapped_column(String(36))
    details     : Mapped[Optional[str]] = mapped_column(Text)
    branch_id   : Mapped[Optional[str]] = mapped_column(String(36))
    created_at  : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (Index("ix_audit_created", "created_at"),)


class HappyHour(Base):
    __tablename__ = "happy_hours"
    id                     : Mapped[str] = mapped_column(String(36), primary_key=True)
    name                   : Mapped[str] = mapped_column(String(200))
    start_time             : Mapped[str] = mapped_column(String(10))
    end_time               : Mapped[str] = mapped_column(String(10))
    days_of_week           : Mapped[dict] = mapped_column(JSON, default=list)
    discount_percent       : Mapped[float] = mapped_column(Float)
    applicable_categories  : Mapped[dict] = mapped_column(JSON, default=list)
    is_active              : Mapped[bool] = mapped_column(Boolean, default=True)
    branch_id              : Mapped[str] = mapped_column(ForeignKey("branches.id"))
    created_at             : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class WasteLog(Base):
    __tablename__ = "waste_log"
    id              : Mapped[str] = mapped_column(String(36), primary_key=True)
    ingredient_id   : Mapped[str] = mapped_column(String(36))
    ingredient_name : Mapped[str] = mapped_column(String(200))
    quantity        : Mapped[float] = mapped_column(Float)
    unit            : Mapped[str] = mapped_column(String(20))
    reason          : Mapped[str] = mapped_column(String(100))
    notes           : Mapped[Optional[str]] = mapped_column(Text)
    logged_by       : Mapped[str] = mapped_column(String(36))
    logged_by_name  : Mapped[str] = mapped_column(String(200))
    branch_id       : Mapped[str] = mapped_column(ForeignKey("branches.id"))
    created_at      : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id         : Mapped[str] = mapped_column(String(36), primary_key=True)
    token      : Mapped[str] = mapped_column(String(500), unique=True, index=True)
    user_id    : Mapped[str] = mapped_column(String(36))
    revoked    : Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at : Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


# ── Void Request (manager approval workflow) ─────────────────────────────────
class VoidRequest(Base):
    __tablename__ = "void_requests"
    id            : Mapped[str] = mapped_column(String(36), primary_key=True)
    order_id      : Mapped[str] = mapped_column(ForeignKey("orders.id"))
    requested_by  : Mapped[str] = mapped_column(String(36))
    requested_by_name: Mapped[str] = mapped_column(String(200))
    reason        : Mapped[str] = mapped_column(Text)
    status        : Mapped[str] = mapped_column(String(20), default="pending")  # pending, approved, rejected
    reviewed_by   : Mapped[Optional[str]] = mapped_column(String(36))
    reviewed_by_name: Mapped[Optional[str]] = mapped_column(String(200))
    reviewed_at   : Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    branch_id     : Mapped[str] = mapped_column(ForeignKey("branches.id"))
    created_at    : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (Index("ix_void_req_status", "status", "branch_id"),)


# ── Split Bill ────────────────────────────────────────────────────────────────
class SplitBill(Base):
    __tablename__ = "split_bills"
    id             : Mapped[str] = mapped_column(String(36), primary_key=True)
    order_id       : Mapped[str] = mapped_column(ForeignKey("orders.id"))
    split_type     : Mapped[str] = mapped_column(String(20))   # item, even, custom
    splits         : Mapped[dict] = mapped_column(JSON)        # [{label, amount, items, payment_method, paid}]
    total_amount   : Mapped[float] = mapped_column(Float)
    created_by     : Mapped[str] = mapped_column(String(36))
    branch_id      : Mapped[str] = mapped_column(ForeignKey("branches.id"))
    created_at     : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


# ── Inventory Deduction Log ───────────────────────────────────────────────────
class InventoryDeduction(Base):
    __tablename__ = "inventory_deductions"
    id              : Mapped[str] = mapped_column(String(36), primary_key=True)
    order_id        : Mapped[str] = mapped_column(ForeignKey("orders.id"))
    order_item_id   : Mapped[str] = mapped_column(String(36))
    menu_item_id    : Mapped[str] = mapped_column(String(36))
    menu_item_name  : Mapped[str] = mapped_column(String(200))
    ingredient_id   : Mapped[str] = mapped_column(String(36))
    ingredient_name : Mapped[str] = mapped_column(String(200))
    quantity_deducted: Mapped[float] = mapped_column(Float)
    unit            : Mapped[str] = mapped_column(String(20))
    branch_id       : Mapped[str] = mapped_column(ForeignKey("branches.id"))
    created_at      : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


# ── Purchase Order ────────────────────────────────────────────────────────────class PurchaseOrder(Base):
    """Tracks restocking orders placed with suppliers."""
    __tablename__ = "purchase_orders"
    id                : Mapped[str] = mapped_column(String(36), primary_key=True)
    supplier_id       : Mapped[Optional[str]] = mapped_column(ForeignKey("suppliers.id"), nullable=True)
    supplier_name     : Mapped[str] = mapped_column(String(200))
    items             : Mapped[dict] = mapped_column(JSON)   # [{ingredient_id, ingredient_name, quantity_ordered, quantity_received, unit_cost}]
    total_cost        : Mapped[float] = mapped_column(Float, default=0)
    status            : Mapped[str] = mapped_column(String(20), default="pending")  # pending, received, cancelled
    notes             : Mapped[Optional[str]] = mapped_column(Text)
    expected_delivery : Mapped[Optional[str]] = mapped_column(String(50))
    received_at       : Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    received_by       : Mapped[Optional[str]] = mapped_column(String(36))
    received_by_name  : Mapped[Optional[str]] = mapped_column(String(200))
    created_by        : Mapped[str] = mapped_column(String(36))
    created_by_name   : Mapped[str] = mapped_column(String(200))
    branch_id         : Mapped[str] = mapped_column(ForeignKey("branches.id"))
    created_at        : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (Index("ix_po_branch_status", "branch_id", "status"),)


# ── Bar Restock Log ───────────────────────────────────────────────────────────
class BarRestockLog(Base):
    """Daily bar restock settlement — tracks what was refilled and total cost."""
    __tablename__ = "bar_restock_logs"
    id              : Mapped[str] = mapped_column(String(36), primary_key=True)
    restock_date    : Mapped[str] = mapped_column(String(20))   # YYYY-MM-DD (Ethiopian date)
    items           : Mapped[dict] = mapped_column(JSON)        # [{ingredient_id, name, par_level, stock_before, qty_restocked, unit, cost_per_unit, line_cost}]
    total_cost      : Mapped[float] = mapped_column(Float, default=0)
    notes           : Mapped[Optional[str]] = mapped_column(Text)
    confirmed_by    : Mapped[str] = mapped_column(String(36))
    confirmed_by_name: Mapped[str] = mapped_column(String(200))
    branch_id       : Mapped[str] = mapped_column(ForeignKey("branches.id"))
    created_at      : Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (Index("ix_bar_restock_date", "branch_id", "restock_date"),)
