import { useEffect, useRef } from 'react';
import { useRealtime } from '../context/WebSocketContext';

/**
 * Subscribe to entity_update events from the shared WebSocket.
 *
 * @param {string|string[]} entityTypes  - e.g. 'sale' or ['employee','branch']
 * @param {function}        onUpdate     - called with the full event payload
 * @param {{ debounceMs?: number }}  options
 */
export function useEntityUpdates(entityTypes, onUpdate, options = {}) {
  const { subscribe, status } = useRealtime();
  const { debounceMs = 0 } = options;
  const handlerRef = useRef(onUpdate);
  handlerRef.current = onUpdate;

  // Normalise to array once, outside the effect
  const typesArray = Array.isArray(entityTypes) ? entityTypes : [entityTypes];
  const typesKey = typesArray.join(',');

  useEffect(() => {
    let timer;
    const wrapped = (data) => {
      if (data?.type !== 'entity_update') return;
      if (!typesArray.includes(data.entity_type)) return;
      if (debounceMs > 0) {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => handlerRef.current(data), debounceMs);
      } else {
        handlerRef.current(data);
      }
    };
    return subscribe(wrapped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, debounceMs, typesKey]);

  return status;
}
