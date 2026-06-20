import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import axios from 'axios';
import { useAuth } from './AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;

const WebSocketContext = createContext(null);
const EVENT_ID_STORAGE_KEY = 'sms_last_event_id';

const getWebSocketBaseUrl = () => {
  const backendUrl = process.env.REACT_APP_BACKEND_URL || window.location.origin;
  return backendUrl.replace(/^http/, 'ws').replace(/\/$/, '');
};

const getSavedEventId = () => {
  try { return window.localStorage.getItem(EVENT_ID_STORAGE_KEY); } catch { return null; }
};

const saveEventId = (eventId) => {
  if (!eventId) return;
  try { window.localStorage.setItem(EVENT_ID_STORAGE_KEY, eventId); } catch { /* ignore */ }
};

export function WebSocketProvider({ children }) {
  const { user } = useAuth();
  const [status, setStatus] = useState('idle');
  const subscribersRef = useRef(new Set());
  const socketRef = useRef(null);
  const reconnectTimer = useRef(null);
  const reconnectAttempts = useRef(0);
  const shouldRun = useRef(false);
  const lastEventIdRef = useRef(null);
  const seenEventIdsRef = useRef(new Set());
  const seenEventQueueRef = useRef([]);
  // Track connect function ref to avoid stale closures in timers
  const connectRef = useRef(null);

  const subscribe = useCallback((handler) => {
    subscribersRef.current.add(handler);
    return () => subscribersRef.current.delete(handler);
  }, []);

  const emit = useCallback((payload) => {
    subscribersRef.current.forEach((handler) => {
      try { handler(payload); } catch (e) { console.warn('Realtime subscriber error', e); }
    });
  }, []);

  const fetchToken = useCallback(async () => {
    const { data } = await axios.get(`${API}/realtime/token`, { withCredentials: true });
    return data.token;
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) {
      window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    socketRef.current?.close();
    socketRef.current = null;
    setStatus('idle');
  }, []);

  const connect = useCallback(async () => {
    if (!shouldRun.current || !user) return;

    const baseUrl = getWebSocketBaseUrl();
    if (!baseUrl) return;

    // Don't open a second socket if one is already open/connecting
    if (socketRef.current && socketRef.current.readyState <= WebSocket.OPEN) return;

    try {
      setStatus((s) => (s === 'connected' ? 'connected' : 'connecting'));
      const token = await fetchToken();
      if (!shouldRun.current) return;

      const resumeEventId = lastEventIdRef.current || getSavedEventId();
      let wsUrl = `${baseUrl}/ws/stock?token=${encodeURIComponent(token)}`;
      if (resumeEventId) wsUrl += `&last_event_id=${encodeURIComponent(resumeEventId)}`;

      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        reconnectAttempts.current = 0;
        setStatus('connected');
        // NO forced close timer — the server sends pings every 25s to keep it alive.
        // The token is valid for 5 minutes; if the WS drops naturally it will reconnect.
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);

          // Respond to server pings immediately
          if (payload.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
            return;
          }

          // Deduplicate events
          const eventId = payload.event_id;
          if (eventId) {
            if (seenEventIdsRef.current.has(eventId)) return;
            seenEventIdsRef.current.add(eventId);
            seenEventQueueRef.current.push(eventId);
            if (seenEventQueueRef.current.length > 200) {
              seenEventIdsRef.current.delete(seenEventQueueRef.current.shift());
            }
            lastEventIdRef.current = eventId;
            saveEventId(eventId);
          }

          emit(payload);
        } catch (e) {
          console.warn('Realtime message parse failed', e);
        }
      };

      ws.onclose = (evt) => {
        socketRef.current = null;
        if (!shouldRun.current) return;

        // Token expired (4401) — get a fresh token immediately, no backoff
        if (evt.code === 4401) {
          reconnectAttempts.current = 0;
          reconnectTimer.current = window.setTimeout(
            () => connectRef.current?.(), 500
          );
          return;
        }

        setStatus('reconnecting');
        // Exponential backoff: 1s, 2s, 4s, 8s … capped at 30s
        const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 30000)
          + Math.floor(Math.random() * 500);
        reconnectAttempts.current += 1;
        reconnectTimer.current = window.setTimeout(
          () => connectRef.current?.(), delay
        );
      };

      ws.onerror = () => {
        // onclose fires right after onerror, so just mark status
        setStatus('error');
      };
    } catch {
      if (!shouldRun.current) return;
      setStatus('error');
      const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 30000)
        + Math.floor(Math.random() * 500);
      reconnectAttempts.current += 1;
      reconnectTimer.current = window.setTimeout(
        () => connectRef.current?.(), delay
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, fetchToken, emit]);

  // Keep connectRef in sync so timers always call the latest version
  useEffect(() => { connectRef.current = connect; }, [connect]);

  useEffect(() => {
    shouldRun.current = Boolean(user);
    if (!user) { disconnect(); return undefined; }
    connect();
    return () => {
      shouldRun.current = false;
      disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const value = useMemo(() => ({ status, subscribe }), [status, subscribe]);

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
}

export function useRealtime() {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error('useRealtime must be used within WebSocketProvider');
  return ctx;
}
