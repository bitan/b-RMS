#!/usr/bin/env python3
"""Load test the backend API and WebSocket realtime layer."""
import argparse
import asyncio
import json
import random
import time
from urllib.parse import urljoin

import httpx
import websockets

DEFAULT_ENDPOINTS = [
    "/api/products",
    "/api/auth/me",
    "/api/realtime/token",
    "/api/categories",
    "/api/reports/dashboard",
]


class Stats:
    def __init__(self):
        self.http_requests = 0
        self.http_errors = 0
        self.http_latency = []
        self.ws_connections = 0
        self.ws_errors = 0
        self.missed_events = 0
        self.start = time.monotonic()

    def request(self, latency: float, success: bool) -> None:
        self.http_requests += 1
        self.http_latency.append(latency)
        if not success:
            self.http_errors += 1

    def ws_error(self) -> None:
        self.ws_errors += 1

    def increment_ws(self) -> None:
        self.ws_connections += 1

    def summary(self) -> dict:
        elapsed = max(1.0, time.monotonic() - self.start)
        p95 = self._percentile(95)
        return {
            "duration_seconds": elapsed,
            "http_requests": self.http_requests,
            "http_errors": self.http_errors,
            "requests_per_second": self.http_requests / elapsed,
            "p95_latency_ms": p95 * 1000 if p95 is not None else None,
            "ws_connections": self.ws_connections,
            "ws_errors": self.ws_errors,
        }

    def _percentile(self, pct: float):
        if not self.http_latency:
            return None
        sorted_latencies = sorted(self.http_latency)
        index = int(len(sorted_latencies) * pct / 100)
        return sorted_latencies[min(index, len(sorted_latencies) - 1)]


async def login(client: httpx.AsyncClient, base_url: str, email: str, password: str) -> None:
    url = urljoin(base_url, "/api/auth/login")
    response = await client.post(url, json={"email": email, "password": password})
    response.raise_for_status()


async def fetch_token(client: httpx.AsyncClient, base_url: str) -> str:
    url = urljoin(base_url, "/api/realtime/token")
    response = await client.get(url)
    response.raise_for_status()
    return response.json()["token"]


async def http_worker(client: httpx.AsyncClient, base_url: str, endpoints: list[str], stats: Stats, duration: int, delay_ms: int):
    deadline = time.monotonic() + duration
    while time.monotonic() < deadline:
        endpoint = random.choice(endpoints)
        url = urljoin(base_url, endpoint)
        start = time.monotonic()
        try:
            response = await client.get(url)
            elapsed = time.monotonic() - start
            stats.request(elapsed, response.status_code < 500)
        except Exception:
            stats.request(0.0, False)
        await asyncio.sleep(delay_ms / 1000)


async def websocket_worker(client: httpx.AsyncClient, base_url: str, stats: Stats, duration: int, worker_id: int):
    deadline = time.monotonic() + duration
    ws_base = base_url.replace("http://", "ws://").replace("https://", "wss://")
    while time.monotonic() < deadline:
        try:
            token = await fetch_token(client, base_url)
            ws_url = f"{ws_base}/ws/stock?token={token}"
            async with websockets.connect(ws_url, ping_interval=None, max_size=None) as ws:
                stats.increment_ws()
                while time.monotonic() < deadline:
                    try:
                        message = await asyncio.wait_for(ws.recv(), timeout=15)
                        if isinstance(message, bytes):
                            continue
                        data = json.loads(message)
                        if data.get("type") == "ping":
                            await ws.send(json.dumps({"type": "pong"}))
                    except asyncio.TimeoutError:
                        await ws.send(json.dumps({"type": "pong"}))
        except Exception:
            stats.ws_error()
            await asyncio.sleep(1 + random.random() * 2)


async def print_progress(stats: Stats, interval: int):
    while True:
        await asyncio.sleep(interval)
        summary = stats.summary()
        print(json.dumps(summary, indent=2))


async def main():
    parser = argparse.ArgumentParser(description="Load test the SMS backend with HTTP and WebSocket traffic.")
    parser.add_argument("--base-url", default="http://localhost:8000", help="Backend base URL")
    parser.add_argument("--email", default="admin@supermarket.com", help="Test user email")
    parser.add_argument("--password", default="admin123", help="Test user password")
    parser.add_argument("--duration", type=int, default=60, help="Duration in seconds")
    parser.add_argument("--http-workers", type=int, default=10, help="Number of concurrent HTTP workers")
    parser.add_argument("--http-delay", type=int, default=100, help="Delay between HTTP requests per worker in ms")
    parser.add_argument("--ws-workers", type=int, default=0, help="Number of WebSocket clients to open")
    parser.add_argument("--progress-interval", type=int, default=10, help="Progress output interval in seconds")
    args = parser.parse_args()

    headers = {"Accept": "application/json"}
    async with httpx.AsyncClient(base_url=args.base_url, headers=headers, follow_redirects=True) as client:
        await login(client, args.base_url, args.email, args.password)
        stats = Stats()

        worker_tasks = [asyncio.create_task(http_worker(client, args.base_url, DEFAULT_ENDPOINTS, stats, args.duration, args.http_delay)) for _ in range(args.http_workers)]
        worker_tasks += [asyncio.create_task(websocket_worker(client, args.base_url, stats, args.duration, i)) for i in range(args.ws_workers)]
        progress_task = asyncio.create_task(print_progress(stats, args.progress_interval))

        await asyncio.gather(*worker_tasks, return_exceptions=True)
        progress_task.cancel()
        await asyncio.gather(progress_task, return_exceptions=True)

        print("Final summary:")
        print(json.dumps(stats.summary(), indent=2))


if __name__ == "__main__":
    asyncio.run(main())
