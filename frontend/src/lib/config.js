/**
 * Central backend URL configuration.
 * Uses REACT_APP_BACKEND_URL if set, otherwise falls back to the current
 * page origin — this makes same-origin deployments (Cloudflare tunnel,
 * Railway, Render) work without any env var.
 */
export const BACKEND_URL =
  process.env.REACT_APP_BACKEND_URL ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8000');

export const API = `${BACKEND_URL}/api`;
