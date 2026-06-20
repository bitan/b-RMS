import { createContext, useContext, useMemo, useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { useRealtime } from './WebSocketContext';

const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const { subscribe, status: connectionStatus } = useRealtime();

  const addNotification = useCallback((notification) => {
    setNotifications((prev) => [notification, ...prev].slice(0, 20));
    setUnreadCount((count) => count + 1);
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((notification) => ({ ...notification, read: true })));
    setUnreadCount(0);
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
    setUnreadCount(0);
  }, []);

  const formatNotification = useCallback((data) => {
    if (!data?.type) return null;

    // ── stock_update events ──────────────────────────────────
    if (data.type === 'stock_update') {
      let title = 'Stock update';
      let subtitle = 'Inventory has changed.';
      if (data.action === 'created') { title = 'New ingredient added'; subtitle = 'A new inventory item is now available.'; }
      else if (data.action === 'updated') { title = 'Ingredient updated'; subtitle = 'An ingredient was updated.'; }
      else if (data.action === 'deleted') { title = 'Ingredient removed'; subtitle = 'An inventory item was removed.'; }
      else if (data.action === 'adjusted') { title = 'Stock adjusted'; subtitle = 'Inventory quantity was manually adjusted.'; }
      if (data.low_stock) subtitle += ' ⚠️ Low stock detected.';
      return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title, subtitle, createdAt: new Date().toISOString(), read: false, data };
    }

    // ── entity_update events ─────────────────────────────────
    if (data.type === 'entity_update') {
      const entityLabels = {
        order:      { created: '🍽️ New order placed', updated: 'Order updated', paid: '💳 Order paid', deleted: 'Order cancelled' },
        room:       { created: 'Room added', updated: '🛏️ Room status changed', deleted: 'Room removed' },
        reservation:{ created: '📅 New reservation', updated: 'Reservation updated', deleted: 'Reservation cancelled' },
        menu_item:  { created: 'Menu item added', updated: 'Menu item updated', deleted: 'Menu item removed' },
        employee:   { created: 'Staff added', updated: 'Staff updated', deleted: 'Staff removed' },
        supplier:   { created: 'Supplier added', updated: 'Supplier updated', deleted: 'Supplier removed' },
        branch:     { created: 'Branch created', updated: 'Branch updated',   deleted: 'Branch removed' },
      };
      const labels = entityLabels[data.entity_type];
      if (!labels) return null;
      const title = labels[data.action] || `${data.entity_type} ${data.action}`;
      let subtitle = '';
      if (data.entity_type === 'order') {
        const d = data.data || {};
        subtitle = d.payment_method
          ? `${(d.total_amount || 0).toFixed(2)} ETB via ${d.payment_method}`
          : `${d.items_count || 0} items${d.room_id ? ' · Room' : d.table_number ? ` · Table ${d.table_number}` : ''}`;
      } else if (data.entity_type === 'room') {
        subtitle = data.data?.occupancy_status ? `Status: ${data.data.occupancy_status}` : '';
      } else if (data.entity_type === 'reservation') {
        subtitle = data.data?.customer_name || '';
      } else {
        subtitle = data.data?.name || '';
      }
      return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title, subtitle, createdAt: new Date().toISOString(), read: false, data };
    }

    return null;
  }, []);

  useEffect(() => {
    return subscribe((data) => {
      const notification = formatNotification(data);
      if (!notification) return;
      addNotification(notification);
      if (data.low_stock) {
        toast.warning('⚠️ Low ingredient stock alert');
      }
      if (data.entity_type === 'order' && data.action === 'item_ready') {
        // Sound alert + toast for the server whose item is ready
        toast.success(`🔔 ${data.data?.menu_item_name || 'Item'} is READY`, {
          duration: 8000,
          important: true,
        });
        // Play browser beep
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.frequency.value = 880;
          gain.gain.setValueAtTime(0.3, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
          osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.6);
        } catch { /* audio not available */ }
      }
      // Owner order notification — alert servers to serve the assigned order
      if (data.entity_type === 'order' && data.action === 'created') {
        const notes = data.data?.notes || '';
        if (notes.includes('[Owner Order')) {
          const location = data.data?.table_number
            ? `Table ${data.data.table_number}`
            : data.data?.room_id ? 'Room order' : '';
          toast.warning(`👑 Owner Order${location ? ' — ' + location : ''} — needs serving`, {
            duration: 12000,
          });
          // Play a distinct double-beep for owner orders
          try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            [440, 660].forEach((freq, i) => {
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.connect(gain); gain.connect(ctx.destination);
              osc.frequency.value = freq;
              gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.25);
              gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.25 + 0.2);
              osc.start(ctx.currentTime + i * 0.25);
              osc.stop(ctx.currentTime + i * 0.25 + 0.2);
            });
          } catch { /* audio not available */ }
        }
      }
    });
  }, [subscribe, formatNotification, addNotification]);

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      connectionStatus,
      addNotification,
      markAllRead,
      clearNotifications,
    }),
    [notifications, unreadCount, connectionStatus, addNotification, markAllRead, clearNotifications]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}
