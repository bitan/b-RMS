import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useEntityUpdates } from '../hooks/useEntityUpdates';
import { toast } from 'sonner';
import { ROLES } from '../lib/roles';
import {
    ChefHat, GlassWater, CheckCircle2, Clock, Bell, BedDouble,
    RefreshCw, DollarSign, Utensils, AlertTriangle, X, Printer,
    Circle, ChevronDown, ChevronUp, Receipt, Send,
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;
const fmtETB = (n) => `${Number(n || 0).toLocaleString('en-ET', { minimumFractionDigits: 2 })} ETB`;

// ── Sound alert ──────────────────────────────────────────────────────────────
function playChime() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        [880, 1100, 1320].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.15);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.12);
            osc.start(ctx.currentTime + i * 0.15);
            osc.stop(ctx.currentTime + i * 0.15 + 0.12);
        });
    } catch { /* audio blocked */ }
}

// ── Status config ─────────────────────────────────────────────────────────────
const ORDER_STATUS = {
    open:            { label: 'Open',       color: 'bg-gray-100 text-gray-600',    dot: 'bg-gray-400' },
    sent_to_kitchen: { label: 'Preparing',  color: 'bg-blue-100 text-blue-700',    dot: 'bg-blue-500' },
    ready:           { label: 'Ready!',     color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
    served:          { label: 'Served',     color: 'bg-violet-100 text-violet-700', dot: 'bg-violet-500' },
    closed:          { label: 'Closed',     color: 'bg-slate-100 text-slate-500',  dot: 'bg-slate-400' },
    cancelled:       { label: 'Cancelled',  color: 'bg-red-100 text-red-500',      dot: 'bg-red-400' },
};

const ITEM_STATUS = {
    pending:   { label: 'Queued',    color: 'text-gray-400',   bg: 'bg-gray-50' },
    preparing: { label: 'Preparing', color: 'text-blue-600',   bg: 'bg-blue-50' },
    ready:     { label: 'Ready',     color: 'text-emerald-600', bg: 'bg-emerald-50' },
    served:    { label: 'Served',    color: 'text-violet-500',  bg: 'bg-violet-50' },
    cancelled: { label: 'Cancelled', color: 'text-red-400',     bg: 'bg-red-50' },
};

const elapsed = (dt) => {
    const diff = Math.floor((Date.now() - new Date(dt)) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
};

const urgentAge = (dt) => (Date.now() - new Date(dt)) > 20 * 60 * 1000; // 20 min

// ── Single Order Card ─────────────────────────────────────────────────────────
const OrderCard = ({ order, isServer, isCashier, onMarkServed, onOpenPayment, onGenerateBill, onRefresh }) => {
    const [expanded, setExpanded] = useState(true);
    const [flashReady, setFlashReady] = useState(false);
    const prevStatusRef = useRef(order.status);
    const st = ORDER_STATUS[order.status] || ORDER_STATUS.open;
    const urgent = urgentAge(order.created_at) && order.status !== 'closed' && order.status !== 'cancelled';
    const hasReadyItems = order.items?.some(i => i.status === 'ready');
    const allServed = order.items?.length > 0 && order.items.every(i => ['served','cancelled'].includes(i.status));
    const isPaid = order.payment_status === 'paid';

    // Flash when status changes to ready
    useEffect(() => {
        if (prevStatusRef.current !== order.status && order.status === 'ready') {
            setFlashReady(true);
            playChime();
            setTimeout(() => setFlashReady(false), 4000);
        }
        prevStatusRef.current = order.status;
    }, [order.status]);

    return (
        <div className={`rounded-2xl overflow-hidden border transition-all ${
            flashReady ? 'ring-2 ring-emerald-400' :
            urgent ? 'ring-1 ring-orange-300' : ''
        }`} style={{ background: 'var(--bg-card)', borderColor: 'var(--border-light)' }}>

            {/* Card header */}
            <div className={`px-4 py-3 flex items-center gap-3 cursor-pointer ${
                flashReady ? 'bg-emerald-50 dark:bg-emerald-900/20' :
                urgent ? 'bg-orange-50 dark:bg-orange-900/20' : ''
            }`}
                style={{ borderBottom: expanded ? '1px solid var(--border-light)' : 'none' }}
                onClick={() => setExpanded(v => !v)}>

                {/* Status dot */}
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${st.dot}`} />

                {/* Order info */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                            #{order.id.slice(-6).toUpperCase()}
                        </span>
                        {/* Owner order — crown badge to alert server */}
                        {order.notes?.includes('[Owner Order') && (
                            <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-amber-500 text-white">
                                👑 Owner Order
                            </span>
                        )}
                        {order.room_id && (
                            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                                <BedDouble className="w-3 h-3" />Room
                            </span>
                        )}
                        {order.table_number && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                                Table {order.table_number}
                            </span>
                        )}
                        {hasReadyItems && (
                            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold animate-pulse">
                                <Bell className="w-3 h-3" />READY
                            </span>
                        )}
                        {urgent && (
                            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
                                <AlertTriangle className="w-3 h-3" />20min+
                            </span>
                        )}
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {order.server_name} · {elapsed(order.created_at)} · {order.items?.length} items
                    </p>
                </div>

                {/* Status badge + total */}
                <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${st.color}`}>
                        {st.label}
                    </span>
                    <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                        {fmtETB(order.total_amount)}
                    </span>
                    {expanded ? <ChevronUp className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                               : <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />}
                </div>
            </div>

            {/* Expanded content */}
            {expanded && (
                <div className="p-4 space-y-4">
                    {/* Item list */}
                    <div className="space-y-2">
                        {(order.items || []).map(item => {
                            const ist = ITEM_STATUS[item.status] || ITEM_STATUS.pending;
                            return (
                                <div key={item.id} className={`flex items-center gap-3 px-3 py-2 rounded-xl ${ist.bg}`}>
                                    {/* Route icon */}
                                    {item.route_to === 'bar'
                                        ? <GlassWater className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                                        : <ChefHat className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" />}
                                    {/* Name + modifiers */}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                            <span className="text-amber-600 font-bold">{item.quantity}×</span> {item.menu_item_name}
                                        </p>
                                        {item.modifiers?.length > 0 && (
                                            <p className="text-xs text-blue-600">✎ {item.modifiers.join(' · ')}</p>
                                        )}
                                        {item.kitchen_note && (
                                            <p className="text-xs italic" style={{ color: 'var(--text-muted)' }}>"{item.kitchen_note}"</p>
                                        )}
                                    </div>
                                    {/* Status badge */}
                                    <span className={`text-xs font-semibold flex-shrink-0 ${ist.color}`}>
                                        {ist.label}
                                        {item.status === 'ready' && ' ●'}
                                    </span>
                                    {/* Server: mark served button */}
                                    {isServer && item.status === 'ready' && (
                                        <button onClick={() => onMarkServed(order.id, item.id)}
                                            className="flex-shrink-0 text-xs px-2.5 py-1 rounded-lg bg-emerald-500 text-white font-semibold hover:bg-emerald-600 transition-colors">
                                            Served ✓
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Bill summary (collapsed) */}
                    <div className="text-xs space-y-0.5 pt-2 border-t" style={{ borderColor: 'var(--border-light)' }}>
                        <div className="flex justify-between" style={{ color: 'var(--text-muted)' }}>
                            <span>Subtotal</span><span>{fmtETB(order.subtotal)}</span>
                        </div>
                        <div className="flex justify-between" style={{ color: 'var(--text-muted)' }}>
                            <span>Service + VAT + TOT</span>
                            <span>{fmtETB((order.service_charge || 0) + (order.vat_amount || 0) + (order.tot_amount || 0))}</span>
                        </div>
                        <div className="flex justify-between font-bold text-sm pt-1"
                            style={{ color: 'var(--text-primary)', borderTop: '1px dashed var(--border-light)' }}>
                            <span>Total</span>
                            <span className="text-amber-600">{fmtETB(order.total_amount)}</span>
                        </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2 pt-1">
                        {/* Server: mark all ready items as served */}
                        {isServer && hasReadyItems && (
                            <button onClick={() => {
                                    order.items.filter(i => i.status === 'ready')
                                        .forEach(i => onMarkServed(order.id, i.id));
                                }}
                                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold text-white transition-all"
                                style={{ background: 'linear-gradient(135deg,#10B981,#059669)' }}>
                                <CheckCircle2 className="w-4 h-4" />Mark All Served
                            </button>
                        )}
                        {/* Server: generate bill when all items served */}
                        {isServer && allServed && !isPaid && (
                            <button onClick={() => onGenerateBill(order)}
                                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold text-white transition-all"
                                style={{ background: 'linear-gradient(135deg,#6366F1,#8B5CF6)' }}>
                                <Receipt className="w-4 h-4" />Generate Bill
                            </button>
                        )}
                        {/* Cashier: collect payment — only after order is served */}
                        {isCashier && !isPaid && order.status !== 'cancelled' && (
                            order.status === 'served' ? (
                                <button onClick={() => onOpenPayment(order)}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold text-white transition-all"
                                    style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}>
                                    <DollarSign className="w-4 h-4" />Collect {fmtETB(order.total_amount)}
                                </button>
                            ) : (
                                <div className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold"
                                    style={{ background: 'var(--bg-page)', border: '1px dashed var(--border)', color: 'var(--text-muted)' }}>
                                    <Clock className="w-4 h-4" />
                                    Waiting for order to be served…
                                </div>
                            )
                        )}
                        {/* Paid badge */}
                        {isPaid && (
                            <div className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold bg-emerald-50 text-emerald-700">
                                <CheckCircle2 className="w-4 h-4" />Paid via {order.payment_method}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

// ── Payment Modal (inline for cashier) ───────────────────────────────────────
const PAY_METHODS = [
    { key: 'cash',     label: 'Cash',     emoji: '💵' },
    { key: 'card',     label: 'Card',     emoji: '💳' },
    { key: 'telebirr', label: 'Telebirr', emoji: '📱' },
    { key: 'credit',   label: 'Credit',   emoji: '📝' },
];

const PaymentModal = ({ order, onClose, onPaid }) => {
    const [method, setMethod]     = useState('cash');
    const [ref, setRef]           = useState('');
    const [discount, setDiscount] = useState(0);
    const [tip, setTip]           = useState(0);
    const [loading, setLoading]   = useState(false);

    const handlePay = async () => {
        setLoading(true);
        try {
            await axios.post(`${API}/orders/${order.id}/pay`, {
                payment_method: method,
                payment_reference: ref || null,
                tip_amount: tip || 0,
                discount_amount: discount || 0,
            }, { withCredentials: true });
            toast.success(`Payment recorded — ${fmtETB(order.total_amount)}`);
            onPaid();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Payment failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
            <div className="w-full max-w-sm rounded-3xl p-6 shadow-2xl" style={{ background: 'var(--bg-card)' }}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>Collect Payment</h3>
                    <button onClick={onClose} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                </div>
                <p className="text-2xl font-black text-amber-600 mb-1">{fmtETB(order.total_amount)}</p>
                <p className="text-xs mb-5" style={{ color: 'var(--text-muted)' }}>
                    Order #{order.id.slice(-6).toUpperCase()} · {order.items?.length} items
                    {order.table_number ? ` · Table ${order.table_number}` : ''}
                </p>

                {/* Payment method */}
                <div className="grid grid-cols-2 gap-2 mb-4">
                    {PAY_METHODS.map(({ key, label, emoji }) => (
                        <button key={key} onClick={() => setMethod(key)}
                            className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all"
                            style={method === key
                                ? { background: 'linear-gradient(135deg,#F59E0B,#D97706)', color: 'white' }
                                : { background: 'var(--bg-page)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                            <span>{emoji}</span>{label}
                        </button>
                    ))}
                </div>

                {(method === 'card' || method === 'telebirr') && (
                    <input value={ref} onChange={e => setRef(e.target.value)} placeholder={method === 'telebirr' ? 'Telebirr transaction ID' : 'Card reference'}
                        className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:border-amber-500 mb-3 transition-all"
                        style={{ background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                )}

                <div className="flex gap-2 mb-4">
                    <div className="flex-1">
                        <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Discount (ETB)</label>
                        <input type="number" min="0" value={discount} onChange={e => setDiscount(parseFloat(e.target.value) || 0)}
                            className="w-full px-3 py-2 text-sm rounded-xl border outline-none focus:border-amber-500 transition-all"
                            style={{ background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                    </div>
                    <div className="flex-1">
                        <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Tip (ETB)</label>
                        <input type="number" min="0" value={tip} onChange={e => setTip(parseFloat(e.target.value) || 0)}
                            className="w-full px-3 py-2 text-sm rounded-xl border outline-none focus:border-amber-500 transition-all"
                            style={{ background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                    </div>
                </div>

                <button onClick={handlePay} disabled={loading}
                    className="w-full py-3.5 rounded-2xl text-sm font-bold text-white disabled:opacity-50 transition-all hover:-translate-y-0.5"
                    style={{ background: 'linear-gradient(135deg,#10B981,#059669)', boxShadow: '0 6px 20px rgba(16,185,129,0.35)' }}>
                    {loading ? 'Processing…' : `Confirm Payment · ${fmtETB(order.total_amount)}`}
                </button>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ORDER DISPLAY PAGE
// ═══════════════════════════════════════════════════════════════════════════
export const OrderDisplay = () => {
    const { user } = useAuth();
    const isCashier  = [ROLES.CASHIER, ROLES.OWNER, ROLES.MANAGER].includes(user?.role);
    // Manager can serve directly (special occasions)
    // Owner cannot serve — must assign a server (handled in POS)
    const isServer   = [ROLES.SERVER, ROLES.ROOM_MANAGER, ROLES.BARTENDER, ROLES.MANAGER].includes(user?.role);

    const [orders, setOrders]               = useState([]);
    const [loading, setLoading]             = useState(true);
    const [lastRefresh, setLastRefresh]     = useState(new Date());
    const [filterStatus, setFilterStatus]   = useState('active');  // active | paid | all
    const [payingOrder, setPayingOrder]     = useState(null);
    const [readyCount, setReadyCount]       = useState(0);
    const prevReadyRef                      = useRef(0);

    const fetchOrders = useCallback(async () => {
        try {
            const params = new URLSearchParams();
            if (filterStatus === 'active')  params.append('payment_status', 'unpaid');
            if (filterStatus === 'paid')    params.append('payment_status', 'paid');
            params.append('limit', '50');
            const res = await axios.get(`${API}/orders?${params}`, { withCredentials: true });
            setOrders(res.data);
            setLastRefresh(new Date());
            // Check if new items became ready
            const currentReady = res.data.reduce((n, o) =>
                n + (o.items?.filter(i => i.status === 'ready').length || 0), 0);
            if (currentReady > prevReadyRef.current) playChime();
            prevReadyRef.current = currentReady;
            setReadyCount(currentReady);
        } catch { /* silent */ }
        finally { setLoading(false); }
    }, [filterStatus]);

    useEffect(() => {
        fetchOrders();
        const t = setInterval(fetchOrders, 12000); // poll every 12s
        return () => clearInterval(t);
    }, [fetchOrders]);

    // Realtime WebSocket updates
    useEntityUpdates(['order'], useCallback((data) => {
        if (['created','updated','paid','item_ready'].includes(data.action)) {
            fetchOrders();
            if (data.action === 'item_ready') {
                playChime();
                toast.success(`🔔 ${data.data?.menu_item_name || 'Item'} is READY`, { duration: 8000 });
            }
        }
    }, [fetchOrders]));

    const handleMarkServed = async (orderId, itemId) => {
        try {
            await axios.patch(`${API}/orders/${orderId}/items/${itemId}/status?status=served`,
                {}, { withCredentials: true });
            fetchOrders();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Failed to mark served');
        }
    };

    const handleGenerateBill = async (order) => {
        // Mark order as served (all items done), notify cashier via broadcast
        try {
            await axios.patch(`${API}/orders/${order.id}/status`,
                { status: 'served' }, { withCredentials: true });
            toast.success('Bill sent to cashier — awaiting payment');
            fetchOrders();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Failed to generate bill');
        }
    };

    const handlePaid = () => {
        setPayingOrder(null);
        fetchOrders();
    };

    // ── Stats ─────────────────────────────────────────────────────────────────
    const activeOrders  = orders.filter(o => o.payment_status === 'unpaid' && o.status !== 'cancelled');
    const paidOrders    = orders.filter(o => o.payment_status === 'paid');
    const readyOrders   = orders.filter(o => o.items?.some(i => i.status === 'ready'));
    const todayRevenue  = paidOrders.reduce((s, o) => s + (o.total_amount || 0), 0);

    // ── Filter & sort ─────────────────────────────────────────────────────────
    const displayOrders = orders
        .filter(o => {
            if (filterStatus === 'active') return o.payment_status === 'unpaid' && o.status !== 'cancelled';
            if (filterStatus === 'paid')   return o.payment_status === 'paid';
            return true;
        })
        .sort((a, b) => {
            // Ready items first, then by age
            const aReady = a.items?.some(i => i.status === 'ready') ? 1 : 0;
            const bReady = b.items?.some(i => i.status === 'ready') ? 1 : 0;
            if (bReady !== aReady) return bReady - aReady;
            return new Date(a.created_at) - new Date(b.created_at); // oldest first
        });

    return (
        <div className="p-4 lg:p-6 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                        {isCashier ? 'Order Tracker' : 'My Orders'}
                    </h1>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        Last updated: {lastRefresh.toLocaleTimeString('en-ET')}
                    </p>
                </div>
                <button onClick={fetchOrders} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-all hover:bg-amber-50"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-card)' }}>
                    <RefreshCw className="w-4 h-4" />Refresh
                </button>
            </div>

            {/* Stats bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                    { label: 'Active Orders',  value: activeOrders.length,  color: 'from-amber-500 to-orange-500',   show: true },
                    { label: 'Ready to Serve', value: readyCount,            color: 'from-emerald-500 to-teal-500',   show: true, pulse: readyCount > 0 },
                    { label: 'Paid Today',     value: paidOrders.length,     color: 'from-violet-500 to-purple-600',  show: isCashier },
                    { label: 'Revenue Today',  value: fmtETB(todayRevenue),  color: 'from-blue-500 to-indigo-600',   show: isCashier },
                ].filter(s => s.show).map((s, i) => (
                    <div key={i} className="card-soft p-4">
                        <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{s.label}</p>
                        <p className={`text-xl font-black bg-gradient-to-r ${s.color} bg-clip-text text-transparent ${s.pulse ? 'animate-pulse' : ''}`}>
                            {s.value}
                        </p>
                    </div>
                ))}
            </div>

            {/* Filter tabs */}
            <div className="flex gap-1 p-1 rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
                {[
                    { key: 'active', label: `Active (${activeOrders.length})` },
                    { key: 'paid',   label: `Paid (${paidOrders.length})` },
                    { key: 'all',    label: `All (${orders.length})` },
                ].map(f => (
                    <button key={f.key} onClick={() => setFilterStatus(f.key)}
                        className="flex-1 py-2 rounded-xl text-sm font-semibold transition-all"
                        style={filterStatus === f.key
                            ? { background: 'linear-gradient(135deg,#F59E0B,#D97706)', color: 'white' }
                            : { color: 'var(--text-muted)' }}>
                        {f.label}
                    </button>
                ))}
            </div>

            {/* Ready alert banner */}
            {readyCount > 0 && filterStatus !== 'paid' && (
                <div className="flex items-center gap-3 p-3 rounded-2xl animate-pulse"
                    style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)' }}>
                    <Bell className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                    <p className="text-sm font-bold text-emerald-700">
                        {readyCount} item{readyCount !== 1 ? 's' : ''} ready to serve — scroll down to deliver
                    </p>
                </div>
            )}

            {/* Order list */}
            {loading ? (
                <div className="space-y-3">
                    {[1,2,3].map(i => <div key={i} className="h-32 rounded-2xl animate-pulse" style={{ background: 'var(--bg-card)' }} />)}
                </div>
            ) : displayOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-3" style={{ color: 'var(--text-muted)' }}>
                    <Utensils className="w-12 h-12 opacity-30" />
                    <p className="text-sm">No {filterStatus === 'active' ? 'active' : filterStatus} orders</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {displayOrders.map(order => (
                        <OrderCard
                            key={order.id}
                            order={order}
                            isServer={isServer}
                            isCashier={isCashier}
                            onMarkServed={handleMarkServed}
                            onOpenPayment={(o) => setPayingOrder(o)}
                            onGenerateBill={handleGenerateBill}
                            onRefresh={fetchOrders}
                        />
                    ))}
                </div>
            )}

            {/* Payment modal */}
            {payingOrder && (
                <PaymentModal
                    order={payingOrder}
                    onClose={() => setPayingOrder(null)}
                    onPaid={handlePaid}
                />
            )}
        </div>
    );
};
