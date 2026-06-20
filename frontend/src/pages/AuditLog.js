import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
    ScrollText, Shield, ShoppingCart, Clock, Package,
    BedDouble, CalendarRange, Users, Utensils, FlaskConical,
    Trash2, CheckCircle2, XCircle, LogIn, LogOut, KeyRound,
    AlertTriangle, Filter, RefreshCw,
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;

// ── Action config: icon + color per event type ────────────────────────────────
const ACTION_CONFIG = {
    // Auth
    login_success:          { icon: LogIn,        color: 'from-emerald-500 to-teal-500',   label: 'Login' },
    login_failed:           { icon: AlertTriangle, color: 'from-red-500 to-rose-600',      label: 'Failed Login' },
    password_changed:       { icon: KeyRound,      color: 'from-violet-500 to-purple-600', label: 'Password Changed' },
    // Orders
    order_created:          { icon: ShoppingCart,  color: 'from-amber-500 to-orange-500',  label: 'Order Created' },
    order_sent_to_kitchen:  { icon: Utensils,      color: 'from-blue-500 to-indigo-600',   label: 'Sent to Kitchen' },
    order_served:           { icon: CheckCircle2,  color: 'from-emerald-500 to-teal-600',  label: 'Order Served' },
    order_cancelled:        { icon: XCircle,       color: 'from-red-500 to-rose-600',      label: 'Order Cancelled' },
    order_closed:           { icon: CheckCircle2,  color: 'from-slate-400 to-slate-500',   label: 'Order Closed' },
    order_paid:             { icon: CheckCircle2,  color: 'from-emerald-500 to-green-600', label: 'Payment Collected' },
    // Void requests
    void_request_created:   { icon: AlertTriangle, color: 'from-orange-500 to-amber-500',  label: 'Void Requested' },
    void_request_approved:  { icon: CheckCircle2,  color: 'from-red-500 to-rose-600',      label: 'Void Approved' },
    void_request_rejected:  { icon: XCircle,       color: 'from-gray-400 to-gray-500',     label: 'Void Rejected' },
    // Rooms
    room_status_changed:    { icon: BedDouble,     color: 'from-blue-500 to-indigo-600',   label: 'Room Status' },
    // Reservations
    reservation_created:    { icon: CalendarRange,  color: 'from-violet-500 to-purple-600', label: 'Reservation Created' },
    reservation_seated:     { icon: CalendarRange,  color: 'from-emerald-500 to-teal-600',  label: 'Customer Seated' },
    reservation_completed:  { icon: CalendarRange,  color: 'from-slate-400 to-slate-500',   label: 'Reservation Completed' },
    reservation_cancelled:  { icon: CalendarRange,  color: 'from-red-400 to-rose-500',      label: 'Reservation Cancelled' },
    reservation_no_show:    { icon: CalendarRange,  color: 'from-orange-400 to-amber-500',  label: 'No-Show' },
    // Staff
    employee_created:       { icon: Users,          color: 'from-teal-500 to-emerald-600',  label: 'Staff Added' },
    employee_updated:       { icon: Users,          color: 'from-blue-400 to-indigo-500',   label: 'Staff Updated' },
    employee_deleted:       { icon: Trash2,         color: 'from-red-500 to-rose-600',      label: 'Staff Deleted' },
    employee_activated:     { icon: CheckCircle2,   color: 'from-emerald-500 to-teal-500',  label: 'Staff Activated' },
    employee_deactivated:   { icon: XCircle,        color: 'from-orange-500 to-amber-500',  label: 'Staff Deactivated' },
    // Menu
    menu_item_86d:          { icon: XCircle,        color: 'from-red-500 to-rose-600',      label: "Item 86'd" },
    menu_item_available:    { icon: CheckCircle2,   color: 'from-emerald-500 to-teal-500',  label: 'Item Reactivated' },
    // Inventory
    waste_logged:           { icon: FlaskConical,   color: 'from-orange-500 to-amber-500',  label: 'Waste Logged' },
    // Shifts
    shift_started:          { icon: Clock,          color: 'from-amber-500 to-orange-500',  label: 'Shift Started' },
    shift_ended:            { icon: Clock,          color: 'from-orange-500 to-red-500',    label: 'Shift Ended' },
    shift_reconciled:       { icon: CheckCircle2,   color: 'from-violet-500 to-purple-600', label: 'Shift Reconciled' },
    // Default
    default:                { icon: ScrollText,     color: 'from-gray-400 to-gray-500',     label: 'Event' },
};

const getConfig = (action) => ACTION_CONFIG[action] || ACTION_CONFIG.default;

const getRelativeTime = (isoStr) => {
    const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000);
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(isoStr).toLocaleDateString('en-ET');
};

const FILTERS = [
    { value: 'all',         label: 'All Events' },
    { value: 'auth',        label: '🔐 Auth' },
    { value: 'order',       label: '🍽️ Orders' },
    { value: 'void_request',label: '⚠️ Voids' },
    { value: 'reservation', label: '📅 Reservations' },
    { value: 'room',        label: '🛏️ Rooms' },
    { value: 'employee',    label: '👤 Staff' },
    { value: 'menu_item',   label: '📖 Menu' },
    { value: 'waste_log',   label: '🧪 Waste' },
    { value: 'shift',       label: '⏱️ Shifts' },
];

export const AuditLog = () => {
    const [logs, setLogs]               = useState([]);
    const [loading, setLoading]         = useState(true);
    const [entityFilter, setEntityFilter] = useState('all');
    const [limit, setLimit]             = useState(100);

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (entityFilter !== 'all') params.append('entity_type', entityFilter);
            params.append('limit', limit);
            const res = await axios.get(`${API}/audit-logs?${params}`, { withCredentials: true });
            setLogs(res.data);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }, [entityFilter, limit]);

    useEffect(() => { fetchLogs(); }, [fetchLogs]);

    // Stats
    const loginCount   = logs.filter(l => l.action === 'login_success').length;
    const failedLogins = logs.filter(l => l.action === 'login_failed').length;
    const orderEvents  = logs.filter(l => l.entity_type === 'order').length;
    const voidEvents   = logs.filter(l => l.entity_type === 'void_request').length;

    return (
        <div className="p-6 lg:p-8 space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Audit Log</h1>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {logs.length} events recorded
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    {/* Quick access to auditable actions */}
                    <a href="/pos"
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all hover:bg-red-50 text-red-600 border-red-200">
                        <AlertTriangle className="w-3.5 h-3.5" />Void Request
                    </a>
                    <a href="/inventory"
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all hover:bg-orange-50 text-orange-600 border-orange-200">
                        <FlaskConical className="w-3.5 h-3.5" />Log Waste
                    </a>
                    <button onClick={fetchLogs}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-all hover:bg-amber-50"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-card)' }}>
                        <RefreshCw className="w-4 h-4" />Refresh
                    </button>
                </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                    { label: 'Logins',       value: loginCount,   color: 'from-emerald-500 to-teal-500' },
                    { label: 'Failed Logins',value: failedLogins, color: 'from-red-500 to-rose-600',   alert: failedLogins > 3 },
                    { label: 'Order Events', value: orderEvents,  color: 'from-amber-500 to-orange-500' },
                    { label: 'Void Events',  value: voidEvents,   color: 'from-violet-500 to-purple-600', alert: voidEvents > 0 },
                ].map((s, i) => (
                    <div key={i} className={`card-soft p-4 ${s.alert ? 'ring-1 ring-red-300' : ''}`}>
                        <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{s.label}</p>
                        <p className={`text-2xl font-black bg-gradient-to-r ${s.color} bg-clip-text text-transparent`}>{s.value}</p>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div className="flex gap-2 flex-wrap">
                <Filter className="w-4 h-4 mt-2 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                {FILTERS.map(f => (
                    <button key={f.value} onClick={() => setEntityFilter(f.value)}
                        className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
                        style={entityFilter === f.value
                            ? { background: 'linear-gradient(135deg,#F59E0B,#D97706)', color: 'white' }
                            : { background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                        {f.label}
                    </button>
                ))}
            </div>

            {/* Log entries */}
            {loading ? (
                <div className="space-y-3">
                    {[1,2,3,4,5].map(i => (
                        <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ background: 'var(--bg-card)' }} />
                    ))}
                </div>
            ) : logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-3" style={{ color: 'var(--text-muted)' }}>
                    <ScrollText className="w-12 h-12 opacity-30" />
                    <p>No audit events for this filter</p>
                    <p className="text-xs opacity-60">Events are logged as actions occur in the system</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {logs.map(log => {
                        const cfg = getConfig(log.action);
                        const Icon = cfg.icon;
                        const isAlert = log.action === 'login_failed' ||
                                        log.action.includes('void_approved') ||
                                        log.action.includes('deleted') ||
                                        log.action === 'shift_reconciled';
                        return (
                            <div key={log.id}
                                className={`flex items-start gap-3 p-4 rounded-2xl border transition-all ${isAlert ? 'ring-1 ring-red-200 dark:ring-red-800' : ''}`}
                                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-light)' }}>
                                {/* Icon */}
                                <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${cfg.color} flex items-center justify-center flex-shrink-0 shadow`}>
                                    <Icon className="w-4 h-4 text-white" strokeWidth={2} />
                                </div>
                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                            {cfg.label}
                                        </p>
                                        <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                                            {getRelativeTime(log.created_at)}
                                        </span>
                                    </div>
                                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                                        <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>{log.user_name || 'System'}</span>
                                        {log.details ? ` — ${log.details}` : ''}
                                    </p>
                                    {log.entity_id && log.entity_id !== log.user_id && (
                                        <p className="text-[10px] mt-0.5 font-mono" style={{ color: 'var(--text-muted)' }}>
                                            ID: {log.entity_id.slice(-12)}
                                        </p>
                                    )}
                                </div>
                                {/* Entity type badge */}
                                <span className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 font-semibold"
                                    style={{ background: 'var(--bg-page)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                                    {log.entity_type}
                                </span>
                            </div>
                        );
                    })}
                    {/* Load more */}
                    {logs.length >= limit && (
                        <button onClick={() => setLimit(l => l + 100)}
                            className="w-full py-3 rounded-2xl text-sm font-semibold border transition-all hover:bg-amber-50"
                            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                            Load more…
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};
