"""Real-time WebSocket layer sized for ~50 concurrent users per instance."""
from __future__ import annotations

import asyncio
import json
import logging
import secrets
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Coroutine
from typing import Any, Optional

import jwt
from fastapi import WebSocket
from prometheus_client import Counter, Gauge

try:
    import redis.asyncio as aioredis
except Exception:
    aioredis = None

from .config import settings

logger = logging.getLogger(__name__)

PRODUCT_PROJECTION = {
    "_id": 0,
    "id": 1,
    "name": 1,
    "sku": 1,
    "quantity": 1,
    "min_stock_level": 1,
    "price": 1,
    "category": 1,
    "barcode": 1,
    "image_url": 1,
}


@dataclass
class ClientConnection:
    websocket: WebSocket
    user_id: str
    role: str
    remote_addr: Optional[str] = None
    user_agent: Optional[str] = None
    connected_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_activity_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_pong_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class RealtimeManager:
    """In-process connection hub. One browser session should use one WebSocket."""

    def __init__(self, max_connections: int, heartbeat_interval: float):
        self.max_connections = max_connections
        self.heartbeat_interval = heartbeat_interval
        self._connections: dict[int, ClientConnection] = {}
        self._lock = asyncio.Lock()
        self._heartbeat_task: Optional[asyncio.Task] = None

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    def stats(self) -> dict[str, Any]:
        return {
            "active_connections": self.connection_count,
            "max_connections": self.max_connections,
            "heartbeat_interval_seconds": self.heartbeat_interval,
        }

    async def start(self) -> None:
        if self._heartbeat_task is None or self._heartbeat_task.done():
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def stop(self) -> None:
        if self._heartbeat_task and not self._heartbeat_task.done():
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
        self._heartbeat_task = None

    async def connect(self, websocket: WebSocket, user_id: str, role: str, remote_addr: Optional[str] = None, user_agent: Optional[str] = None) -> bool:
        async with self._lock:
            if len(self._connections) >= self.max_connections:
                return False
            await websocket.accept()
            self._connections[id(websocket)] = ClientConnection(
                websocket=websocket,
                user_id=user_id,
                role=role,
                remote_addr=remote_addr,
                user_agent=user_agent,
            )
        return True

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.pop(id(websocket), None)

    def record_pong(self, websocket: WebSocket) -> None:
        conn = self._connections.get(id(websocket))
        if conn:
            now = datetime.now(timezone.utc)
            conn.last_pong_at = now
            conn.last_activity_at = now

    def touch(self, websocket: WebSocket) -> None:
        conn = self._connections.get(id(websocket))
        if conn:
            conn.last_activity_at = datetime.now(timezone.utc)

    async def _send(self, websocket: WebSocket, message: dict) -> bool:
        try:
            await websocket.send_text(json.dumps(message))
            self.touch(websocket)
            return True
        except Exception:
            await self.disconnect(websocket)
            return False

    async def broadcast(self, message: dict) -> int:
        async with self._lock:
            clients = list(self._connections.values())
        if not clients:
            return 0
        results = await asyncio.gather(
            *(self._send(c.websocket, message) for c in clients),
            return_exceptions=True,
        )
        return sum(1 for r in results if r is True)

    def list_connections(self) -> list[dict[str, Any]]:
        with_connections = []
        for conn in self._connections.values():
            with_connections.append({
                "user_id": conn.user_id,
                "role": conn.role,
                "remote_addr": conn.remote_addr,
                "user_agent": conn.user_agent,
                "connected_at": conn.connected_at.isoformat(),
                "last_activity_at": conn.last_activity_at.isoformat(),
                "last_pong_at": conn.last_pong_at.isoformat(),
            })
        return with_connections

    async def _heartbeat_loop(self) -> None:
        stale_after = self.heartbeat_interval * 2.5
        while True:
            try:
                await asyncio.sleep(self.heartbeat_interval)
                now = datetime.now(timezone.utc)
                async with self._lock:
                    clients = list(self._connections.values())

                for client in clients:
                    age = (now - client.last_pong_at).total_seconds()
                    if age > stale_after:
                        try:
                            await client.websocket.close(code=1001, reason="Heartbeat timeout")
                        except Exception:
                            pass
                        await self.disconnect(client.websocket)
                        continue
                    await self._send(client.websocket, {"type": "ping", "ts": now.isoformat()})
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.warning("Heartbeat loop error: %s", exc)


def create_ws_access_token(user_id: str, role: str, jwt_secret: str, algorithm: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "type": "ws",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
    }
    return jwt.encode(payload, jwt_secret, algorithm=algorithm)


def verify_ws_access_token(token: str, jwt_secret: str, algorithm: str) -> Optional[dict[str, str]]:
    try:
        payload = jwt.decode(token, jwt_secret, algorithms=[algorithm])
        if payload.get("type") != "ws":
            return None
        return {"user_id": payload["sub"], "role": payload.get("role", "")}
    except jwt.PyJWTError:
        return None


manager = RealtimeManager(
    max_connections=settings.max_ws_connections,
    heartbeat_interval=float(settings.ws_heartbeat_seconds),
)

EVENT_BROADCASTS = Counter(
    "sms_realtime_broadcasts_total",
    "Total realtime broadcast attempts",
)
EVENT_LOG_SIZE = Gauge(
    "sms_realtime_event_log_size",
    "Current number of events stored in the realtime event log",
)

# Redis pub/sub (optional). Messages published to this channel will be delivered
# to all instances that are subscribed.
_redis: Optional[aioredis.Redis] = None if aioredis is not None else None
_pubsub_task: Optional[asyncio.Task] = None
_instance_id = secrets.token_hex(8)
_channel = getattr(settings, "redis_channel", "realtime:stock_updates")
_event_log_key = getattr(settings, "redis_event_log_key", "realtime:event_log")
_event_log: deque[dict[str, Any]] = deque(maxlen=settings.realtime_event_log_size)


async def append_event_log(payload: dict[str, Any]) -> dict[str, Any]:
    payload["event_id"] = str(uuid.uuid4())
    payload["created_at"] = datetime.now(timezone.utc).isoformat()
    serialized = json.dumps(payload)
    if _redis is not None:
        try:
            await _redis.rpush(_event_log_key, serialized)
            await _redis.ltrim(_event_log_key, -settings.realtime_event_log_size, -1)
        except Exception:
            logger.debug("Failed to append realtime event to redis log")
    _event_log.append(payload.copy())
    return payload


async def get_event_log() -> list[dict[str, Any]]:
    if _redis is not None:
        try:
            raw_items = await _redis.lrange(_event_log_key, 0, -1)
            events: list[dict[str, Any]] = []
            for item in raw_items:
                if isinstance(item, bytes):
                    item = item.decode("utf-8")
                events.append(json.loads(item))
            return events
        except Exception:
            logger.debug("Failed to read realtime event log from redis")
    return list(_event_log)


async def get_events_since(last_event_id: Optional[str], limit: int = 100) -> list[dict[str, Any]]:
    events = await get_event_log()
    if not last_event_id:
        return events[-limit:]
    for index, event in enumerate(events):
        if event.get("event_id") == last_event_id:
            return events[index + 1 : index + 1 + limit]
    return events[-limit:]


async def deliver_missed_events(websocket: WebSocket, last_event_id: Optional[str]) -> int:
    missed = await get_events_since(last_event_id, limit=settings.realtime_event_log_size)
    if not missed:
        return 0
    delivered = 0
    for event in missed:
        try:
            await websocket.send_text(json.dumps(event))
            delivered += 1
        except Exception:
            break
    return delivered


async def broadcast_stock_update(
    db: Any,
    product_ids: list[str],
    *,
    action: str = "updated",
    sale_id: str | None = None,
    low_stock: bool = False,
) -> int:
    if not product_ids:
        return 0

    products: list[dict] = []
    if db is not None:
        # Try menu_items first (bar & restaurant), fall back to products (legacy)
        products = await db.menu_items.find(
            {"id": {"$in": product_ids}},
            {"_id": 0, "id": 1, "name": 1, "category": 1, "price": 1, "is_available": 1},
        ).to_list(len(product_ids))
        if not products:
            products = await db.products.find(
                {"id": {"$in": product_ids}},
                PRODUCT_PROJECTION,
            ).to_list(len(product_ids))

    payload: dict[str, Any] = {
        "type": "stock_update",
        "action": action,
        "product_ids": product_ids,
        "products": products,
        "low_stock": low_stock,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    if sale_id:
        payload["sale_id"] = sale_id

    payload = await append_event_log(payload)
    EVENT_LOG_SIZE.set(len(_event_log))
    # Include origin so subscribers avoid echoing back to origin instance
    payload["origin"] = _instance_id

    # Publish to Redis for other instances
    if _redis is not None:
        try:
            await _redis.publish(_channel, json.dumps(payload))
        except Exception:
            logger.debug("Redis publish failed - continuing with local broadcast")

    EVENT_BROADCASTS.inc()
    # Always broadcast locally for low latency
    delivered = await manager.broadcast(payload)
    logger.debug(
        "stock_update %s -> %s clients (%s products)",
        action,
        delivered,
        len(products),
    )
    return delivered


async def broadcast_entity_update(
    entity_type: str,
    action: str,
    data: dict[str, Any],
) -> int:
    """Broadcast a non-stock entity change (employee, supplier, branch, sale).

    entity_type: 'employee' | 'supplier' | 'branch' | 'sale'
    action:      'created' | 'updated' | 'deleted'
    data:        serialisable dict of the affected entity (no _id field)
    """
    payload: dict[str, Any] = {
        "type": "entity_update",
        "entity_type": entity_type,
        "action": action,
        "data": data,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    payload = await append_event_log(payload)
    EVENT_LOG_SIZE.set(len(_event_log))
    payload["origin"] = _instance_id

    if _redis is not None:
        try:
            await _redis.publish(_channel, json.dumps(payload))
        except Exception:
            logger.debug("Redis publish failed for entity_update - continuing with local broadcast")

    EVENT_BROADCASTS.inc()
    delivered = await manager.broadcast(payload)
    logger.debug("entity_update %s %s -> %s clients", entity_type, action, delivered)
    return delivered


async def _redis_listener(pubsub: aioredis.client.PubSub) -> None:
    try:
        async for msg in pubsub.listen():
            try:
                if msg is None:
                    continue
                if msg.get("type") != "message":
                    continue
                data = msg.get("data")
                if isinstance(data, bytes):
                    data = data.decode("utf-8")
                payload = json.loads(data)
                # ignore our own messages
                if payload.get("origin") == _instance_id:
                    continue
                # deliver to local clients
                await manager.broadcast(payload)
            except Exception:
                logger.exception("Error handling pubsub message")
    except asyncio.CancelledError:
        pass


async def start_redis_listener() -> None:
    global _redis, _pubsub_task
    if aioredis is None:
        logger.info("redis.asyncio not available; skipping redis listener")
        return
    if _redis is None:
        _redis = aioredis.from_url(getattr(settings, "redis_url", "redis://localhost:6379"))
    pubsub = _redis.pubsub()
    await pubsub.subscribe(_channel)
    _pubsub_task = asyncio.create_task(_redis_listener(pubsub))


async def stop_redis_listener() -> None:
    global _redis, _pubsub_task
    if _pubsub_task:
        _pubsub_task.cancel()
        try:
            await _pubsub_task
        except asyncio.CancelledError:
            pass
        _pubsub_task = None
    if _redis is not None:
        try:
            await _redis.close()
        except Exception:
            pass
        _redis = None


async def store_ws_token(token: str, ttl: int = 300) -> None:
    """Store a short-lived, single-use WS token in Redis (best-effort).

    If Redis is not available this is a no-op and tokens are allowed.
    """
    if aioredis is None or _redis is None:
        return
    try:
        await _redis.set(f"ws:token:{token}", "1", ex=ttl)
    except Exception:
        logger.debug("Failed to persist ws token to redis")


async def verify_and_consume_ws_token(token: str) -> bool:
    """Return True if token is present and consume it (delete) to prevent replay.

    If Redis is unavailable, return True to maintain compatibility.
    """
    if aioredis is None or _redis is None:
        return True
    try:
        key = f"ws:token:{token}"
        # Use GETDEL if available (Redis >=6.2), else GET then DEL
        val = await _redis.execute_command("GETDEL", key)
        if val:
            return True
        # fallback
        val = await _redis.get(key)
        if not val:
            return False
        await _redis.delete(key)
        return True
    except Exception:
        logger.debug("Failed to verify/consume ws token; allowing connection")
        return True
