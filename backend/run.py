"""Production ASGI entry — single worker required for in-process WebSocket broadcasts."""
import os
import uvicorn

if __name__ == "__main__":
    app_env = os.environ.get("APP_ENV", "production")
    reload = app_env == "development"

    uvicorn.run(
        "backend.pg_server:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8000")),
        workers=1,           # Must stay 1 — WebSocket broadcast uses in-process state
        reload=reload,       # Auto-reload only in development
        ws_ping_interval=20,
        ws_ping_timeout=20,
        timeout_keep_alive=30,
        limit_concurrency=200,
        access_log=True,
    )
