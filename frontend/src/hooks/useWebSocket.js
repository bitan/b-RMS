import { useEffect, useRef, useState } from 'react';

/** @deprecated Use WebSocketProvider + useStockUpdates for a single shared connection. */
const getWebSocketBaseUrl = () => {
  if (typeof window === 'undefined') return null;
  const backendUrl = process.env.REACT_APP_BACKEND_URL || window.location.origin;
  if (!backendUrl) return null;
  return backendUrl.replace(/^http/, 'ws').replace(/\/$/, '');
};

const getHttpBaseUrl = () => {
  if (typeof window === 'undefined') return null;
  const backendUrl = process.env.REACT_APP_BACKEND_URL || window.location.origin;
  if (!backendUrl) return null;
  return backendUrl.replace(/\/$/, '');
};

export function useWebSocket({
  path,
  onOpen,
  onClose,
  onMessage,
  onError,
  reconnectDelay = 3000,
  maxReconnectAttempts = 5,
}) {
  const [status, setStatus] = useState('connecting');
  const socketRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const shouldReconnect = useRef(true);
  const reconnectTimer = useRef(null);

  useEffect(() => {
    const baseUrl = getWebSocketBaseUrl();
    if (!baseUrl || !path) return;

    shouldReconnect.current = true;
    setStatus('connecting');

    const connect = async () => {
      try {
        // Fetch short-lived WS token from backend and attach to URL
        const httpBase = getHttpBaseUrl();
        let token = null;
        if (httpBase) {
          try {
            const res = await fetch(`${httpBase}/api/realtime/token`, {
              credentials: 'include',
              method: 'GET',
              headers: { 'Accept': 'application/json' },
            });
            if (res.ok) {
              const data = await res.json();
              token = data?.token;
            } else {
              console.warn('Failed to obtain realtime token', res.status);
            }
          } catch (err) {
            console.warn('Realtime token request failed', err);
          }
        }

        const url = new URL(`${baseUrl}${path}`);
        if (token) url.searchParams.set('token', token);
        const ws = new WebSocket(url.toString());
        socketRef.current = ws;

        ws.onopen = () => {
          reconnectAttempts.current = 0;
          setStatus('connected');
          onOpen?.();
        };

        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            onMessage?.(payload);
          } catch (error) {
            console.warn('WebSocket message parse failed', error);
          }
        };

        ws.onclose = () => {
          setStatus('disconnected');
          onClose?.();
          if (shouldReconnect.current && reconnectAttempts.current < maxReconnectAttempts) {
            reconnectAttempts.current += 1;
            setStatus('reconnecting');
            // exponential backoff with cap
            const backoff = Math.min(reconnectDelay * 2 ** (reconnectAttempts.current - 1), 30000);
            reconnectTimer.current = window.setTimeout(connect, backoff);
          }
        };

        ws.onerror = (event) => {
          setStatus('error');
          onError?.(event);
        };
      } catch (error) {
        setStatus('error');
        onError?.(error);
      }
    };

    connect();

    return () => {
      shouldReconnect.current = false;
      if (reconnectTimer.current) {
        window.clearTimeout(reconnectTimer.current);
      }
      socketRef.current?.close();
    };
  }, [path, reconnectDelay, maxReconnectAttempts, onOpen, onClose, onMessage, onError]);

  return status;
}
