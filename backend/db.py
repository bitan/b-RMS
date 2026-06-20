import uuid
from datetime import datetime, timezone
from typing import Any, Optional
import asyncio
import functools

import bcrypt
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase, AsyncIOMotorGridFSBucket

from .config import settings

client: Optional[AsyncIOMotorClient] = None
_db: Optional[AsyncIOMotorDatabase] = None
_gridfs: Optional[AsyncIOMotorGridFSBucket] = None


def normalize_db_id(value: Any) -> Any:
    if ObjectId is not None and isinstance(value, str):
        try:
            return ObjectId(value)
        except Exception:
            return value
    return value


def hash_password(password: str) -> str:
    """Synchronous bcrypt hash — use hash_password_async in async contexts."""
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Synchronous bcrypt verify — use verify_password_async in async contexts."""
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))


async def hash_password_async(password: str) -> str:
    """Run bcrypt in a thread pool so it doesn't block the event loop."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, hash_password, password)


async def verify_password_async(plain_password: str, hashed_password: str) -> bool:
    """Run bcrypt verify in a thread pool so it doesn't block the event loop."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None,
        functools.partial(verify_password, plain_password, hashed_password)
    )


def init_db() -> AsyncIOMotorDatabase:
    global client, _db, _gridfs
    if _db is not None:
        return _db

    if settings.use_memory_db:
        from mongomock_motor import AsyncMongoMockClient
        client = AsyncMongoMockClient()
        _db = client[settings.mongodb_database]
        _gridfs = AsyncIOMotorGridFSBucket(_db, bucket_name="product_images")
        return _db

    client = AsyncIOMotorClient(
        settings.mongodb_uri,
        serverSelectionTimeoutMS=10000,  # fail fast if Atlas unreachable
        connectTimeoutMS=10000,
        socketTimeoutMS=20000,           # individual operation timeout
        heartbeatFrequencyMS=10000,      # detect dead connections faster
        maxPoolSize=settings.mongodb_max_pool_size,
        minPoolSize=settings.mongodb_min_pool_size,
    )
    _db = client[settings.mongodb_database]
    _gridfs = AsyncIOMotorGridFSBucket(_db, bucket_name="product_images")
    return _db


def get_gridfs() -> AsyncIOMotorGridFSBucket:
    if _gridfs is None:
        raise RuntimeError("GridFS has not been initialized")
    return _gridfs


def close_db() -> None:
    global client, _db, _gridfs
    if client is not None:
        client.close()
        client = None
        _db = None
        _gridfs = None


async def ensure_indexes() -> None:
    if _db is None:
        raise RuntimeError('Database has not been initialized')

    await _db.users.create_index('email', unique=True)
    await _db.products.create_index('sku', unique=True)
    await _db.products.create_index('id', unique=True)
    await _db.categories.create_index('id', unique=True)
    await _db.branches.create_index('id', unique=True)
    await _db.login_attempts.create_index('identifier', unique=True)
    await _db.refresh_tokens.create_index('token', unique=True)
    await _db.sales.create_index('id', unique=True)
    await _db.sales.create_index('idempotency_key', unique=True, sparse=True)
    await _db.sales.create_index([('created_at', -1)])
    await _db.products.create_index([('branch_id', 1), ('category', 1)])
    await _db.products.create_index([('branch_id', 1), ('sku', 1)])
    await _db.audit_logs.create_index([('created_at', -1)])
    # GridFS indexes (auto-created by Motor but explicit is safer)
    await _db["product_images.files"].create_index("filename")
    await _db["product_images.files"].create_index("metadata.product_id")
    # Purchase orders
    await _db.purchase_orders.create_index('id', unique=True)
    await _db.purchase_orders.create_index([('branch_id', 1), ('status', 1)])
    await _db.purchase_orders.create_index([('created_at', -1)])
    # Password reset tokens
    await _db.password_reset_tokens.create_index('token', unique=True)
    await _db.password_reset_tokens.create_index('user_id', unique=True)
    # TTL index: auto-delete expired tokens after 1 hour
    await _db.password_reset_tokens.create_index(
        [('expires_at', 1)],
        expireAfterSeconds=3600,
    )
    # Shifts — common queries
    await _db.shifts.create_index([('user_id', 1), ('status', 1)])
    await _db.shifts.create_index([('created_at', -1)])
    # Suppliers — branch scoped
    await _db.suppliers.create_index([('branch_id', 1)])
    # Users — branch + role queries
    await _db.users.create_index([('branch_id', 1), ('role', 1)])
    # Sales — cashier queries
    await _db.sales.create_index([('cashier_id', 1), ('created_at', -1)])
    await _db.sales.create_index([('branch_id', 1), ('created_at', -1)])
