"""HTTP middleware for security headers and global rate limits."""
from __future__ import annotations

import json

from fastapi import Request
from starlette.responses import Response, JSONResponse

from .config import settings
from .policies import rate_limit_key, rate_limiter

REQUEST_COUNT = 0

# Origins allowed for CORS — kept in sync with server.py
_CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Idempotency-Key",
}


def _add_cors(response: Response, origin: str | None) -> Response:
    """Add CORS headers to any response."""
    if origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
    else:
        response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS, PATCH"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With, Idempotency-Key"
    return response


async def security_headers_middleware(request: Request, call_next) -> Response:
    # Always handle OPTIONS preflight immediately with CORS headers
    if request.method == "OPTIONS":
        origin = request.headers.get("origin", "*")
        response = Response(status_code=200)
        _add_cors(response, origin)
        response.headers["Access-Control-Max-Age"] = "86400"
        return response

    response = await call_next(request)
    origin = request.headers.get("origin")
    if origin:
        _add_cors(response, origin)

    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-XSS-Protection", "1; mode=block")
    if settings.is_production:
        response.headers.setdefault(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains",
        )
    return response


async def api_rate_limit_middleware(request: Request, call_next) -> Response:
    path = request.url.path
    if request.method == "OPTIONS":
        return await call_next(request)
    if path.startswith("/api/"):
        if path in ("/api/auth/login", "/api/auth/register"):
            return await call_next(request)
        try:
            rate_limiter.check(
                rate_limit_key(request),
                settings.rate_limit_api_per_minute,
                window_seconds=60,
            )
        except Exception as exc:
            origin = request.headers.get("origin")
            response = JSONResponse(
                status_code=429,
                content={"detail": str(exc)},
            )
            _add_cors(response, origin)
            return response
    return await call_next(request)
