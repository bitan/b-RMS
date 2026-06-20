import { useEffect, useRef } from 'react';
import { useRealtime } from '../context/WebSocketContext';

/**
 * Subscribe to shared stock_update events (one WebSocket per logged-in session).
 * @param {function} onUpdate - called with the realtime payload (debounced)
 * @param {{ debounceMs?: number }} options
 */
export function useStockUpdates(onUpdate, options = {}) {
  const { subscribe, status } = useRealtime();
  const { debounceMs = 250 } = options;
  const handlerRef = useRef(onUpdate);
  handlerRef.current = onUpdate;

  useEffect(() => {
    let timer;
    const wrapped = (data) => {
      if (data?.type !== 'stock_update') return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => handlerRef.current(data), debounceMs);
    };
    return subscribe(wrapped);
  }, [subscribe, debounceMs]);

  return status;
}
