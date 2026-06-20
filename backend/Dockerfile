# ── Stage 1: Build React frontend ────────────────────────────────────────────
FROM node:18-slim AS frontend-build

WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --silent

COPY frontend/ ./
# REACT_APP_BACKEND_URL left empty = same origin (nginx proxies /api to backend)
ENV REACT_APP_BACKEND_URL=
RUN npm run build

# ── Stage 2: Python backend ───────────────────────────────────────────────────
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy full project
COPY . /app

# Copy built React frontend into static folder served by FastAPI
COPY --from=frontend-build /frontend/build /app/frontend/build

ENV PYTHONPATH=/app

EXPOSE 8000

ENV PYTHONPATH=/app

# Explicitly run pg_server (PostgreSQL backend) — NOT backend.server (old MongoDB)
CMD ["sh", "-c", "uvicorn backend.pg_server:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
