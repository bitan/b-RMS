import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useEntityUpdates } from '../hooks/useEntityUpdates';
import { toast } from 'sonner';
import { GlassWater, CheckCircle2, Clock, RefreshCw, AlertTriangle, XCircle } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;

const elapsed = (created_at) => {
    const diff = Math.floor((Date.now() - new Date(created_at)) / 1000);
    if (diff < 60) return `${diff}s`;
    return `${Math.floor(diff / 60)}m ${diff % 60}s`;
};

const DrinkCard = ({ order, onItemStatus, on86Item, darkMode }) => {
    const [tick, setTick] = useState(0);
    useEffect(() => {
        const t = setInterval(() => setTick(v => v + 1), 10000);
        return () => clearInterval(t);
    }, []);

    const barItems = order.items.filter(i => i.route_to === 'bar' && i.status !== 'served' && i.status !== 'cancelled');
    if (barItems.length === 0) return null;

    const age = Math.floor((Date.now() - new Date(order.created_at)) / 60000);
    const urgent = age >= 8; // Drinks should be faster than food

    return (
        <div className={`rounded-2xl overflow-hidden flex flex-col ${urgent ? 'ring-2 ring-red-400' : ''}`}
            style={{ background: darkMode ? '#1E293B' : '#FFFFFF', border: darkMode ? '1px solid rgba(255,255,255,0.08)' : '1px solid #E2E8F0' }}>
            <div className={`px-4 py-3 flex items-center justify-between ${darkMode ? 'border-b border-slate-700' : 'border-b border-slate-200'} ${urgent ? (darkMode ? 'bg-red-900/30' : 'bg-red-50') : ''}`}>
                <div>
                    <p className={`font-bold text-sm ${darkMode ? 'text-white' : 'text-slate-800'}`}>
                        {order.room_id ? 'Room' : order.table_number ? `Table ${order.table_number}` : 'Bar Counter'}
                    </p>
                    <p className={`text-xs ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>{order.server_name}</p>
                </div>
                <div className={`flex items-center gap-1 text-xs font-semibold ${urgent ? 'text-red-400' : (darkMode ? 'text-slate-400' : 'text-slate-500')}`}>
                    {urgent && <AlertTriangle className="w-3 h-3" />}
                    <Clock className="w-3 h-3" />
                    {elapsed(order.created_at)}
                </div>
            </div>

            <div className="flex-1 p-3 space-y-2">
                {barItems.map(item => (
                    <div key={item.id} className="rounded-xl p-3 border-l-4 border-l-blue-400"
                        style={{ background: darkMode ? '#0F172A' : '#EFF6FF' }}>
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                                <p className={`font-semibold text-sm ${darkMode ? 'text-white' : 'text-slate-800'}`}>
                                    <span className="text-blue-400 font-bold">{item.quantity}×</span> {item.menu_item_name}
                                </p>
                                {item.modifiers?.length > 0 && (
                                    <p className="text-xs mt-0.5 text-cyan-500 font-medium">
                                        ✎ {item.modifiers.join(' · ')}
                                    </p>
                                )}
                            </div>
                            <div className="flex flex-col gap-1">
                                {item.status === 'pending' && (
                                    <button onClick={() => onItemStatus(order.id, item.id, 'preparing')}
                                        className="text-xs px-2 py-1 rounded-lg bg-blue-900/60 text-blue-300 font-semibold hover:bg-blue-800 transition-colors whitespace-nowrap">
                                        Pour
                                    </button>
                                )}
                                {item.status === 'preparing' && (
                                    <button onClick={() => onItemStatus(order.id, item.id, 'ready')}
                                        className="text-xs px-2 py-1 rounded-lg bg-emerald-900/60 text-emerald-300 font-semibold hover:bg-emerald-800 transition-colors whitespace-nowrap">
                                        Ready ✓
                                    </button>
                                )}
                                {item.status === 'ready' && (
                                    <span className="text-xs px-2 py-1 rounded-lg bg-emerald-900/30 text-emerald-400 font-semibold">Ready</span>
                                )}
                                {/* 86 button */}
                                {item.status !== 'ready' && item.status !== 'served' && (
                                    <button
                                        onClick={() => on86Item(item.menu_item_id, item.menu_item_name)}
                                        title="86 — out of stock"
                                        className="text-xs px-1.5 py-1 rounded-lg bg-red-900/40 text-red-400 hover:bg-red-800/60 transition-colors font-bold">
                                        86
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export const BarDisplay = () => {
    const [orders, setOrders]               = useState([]);
    const [loading, setLoading]             = useState(true);
    const [lastRefresh, setLastRefresh]     = useState(new Date());
    const [eightySixList, setEightySixList] = useState([]);
    const [darkMode, setDarkMode]           = useState(true); // Bar defaults dark

    const fetchOrders = useCallback(async () => {
        try {
            const res = await axios.get(`${API}/orders/bar`, { withCredentials: true });
            setOrders(res.data);
            setLastRefresh(new Date());
        } catch { /* silent */ }
        finally { setLoading(false); }
    }, []);

    useEffect(() => {
        fetchOrders();
        const t = setInterval(fetchOrders, 10000);
        return () => clearInterval(t);
    }, [fetchOrders]);

    useEntityUpdates('order', useCallback((data) => {
        fetchOrders();
    }, [fetchOrders]), { debounceMs: 300 });

    const handleItemStatus = async (orderId, itemId, status) => {
        try {
            await axios.patch(`${API}/orders/${orderId}/items/${itemId}/status?status=${status}`, {}, { withCredentials: true });
            fetchOrders();
        } catch { toast.error('Failed to update'); }
    };

    const handle86Item = async (menuItemId, menuItemName) => {
        if (!window.confirm(`86 "${menuItemName}"? This marks it unavailable for new orders.`)) return;
        try {
            await axios.post(`${API}/menu-items/${menuItemId}/toggle-availability`, {}, { withCredentials: true });
            setEightySixList(prev => [...prev, menuItemName]);
            toast.success(`"${menuItemName}" 86'd — removed from menu`);
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to 86 item'); }
    };

    const pendingCount   = orders.reduce((s, o) => s + o.items.filter(i => i.route_to === 'bar' && i.status === 'pending').length, 0);
    const preparingCount = orders.reduce((s, o) => s + o.items.filter(i => i.route_to === 'bar' && i.status === 'preparing').length, 0);

    return (
        <div className="min-h-screen p-4 lg:p-6" style={{ background: darkMode ? '#0A0F1E' : '#F0F9FF', color: darkMode ? 'white' : '#0F172A' }}>
            {/* Bar Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                        <GlassWater className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold" style={{ color: darkMode ? 'white' : '#0F172A' }}>Bar Display</h1>
                        <p className="text-xs" style={{ color: darkMode ? 'rgb(100,116,139)' : 'rgb(71,85,105)' }}>{orders.length} order{orders.length !== 1 ? 's' : ''} · {pendingCount + preparingCount} drinks pending</p>
                    </div>
                </div>
                <button onClick={() => setDarkMode(d => !d)} className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all" style={{ background: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)', color: darkMode ? '#CBD5E1' : '#475569' }}>
                    {darkMode ? 'Light Mode' : 'Dark Mode'}
                </button>
                <button onClick={fetchOrders} className="p-2 rounded-xl transition-colors" style={{ background: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }}>
                    <RefreshCw className="w-4 h-4 text-slate-500" />
                </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 mb-6">
                {[
                    { label: 'To Pour',  count: pendingCount,   color: 'text-amber-400' },
                    { label: 'Pouring',  count: preparingCount, color: 'text-blue-400' },
                    { label: 'Orders',   count: orders.length,  color: 'text-violet-400' },
                ].map(s => (
                    <div key={s.label} className="rounded-2xl p-4" style={{ background: darkMode ? '#1E293B' : '#FFFFFF', border: darkMode ? 'none' : '1px solid #E2E8F0' }}>
                        <p className={`text-2xl font-black ${s.color}`}>{s.count}</p>
                        <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide mt-1">{s.label}</p>
                    </div>
                ))}
            </div>

            {/* 86'd list */}
            {eightySixList.length > 0 && (
                <div className="mb-4 p-3 rounded-2xl border border-red-700/50 flex items-center gap-3 flex-wrap" style={{ background: 'rgba(239,68,68,0.1)' }}>
                    <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                    <span className="text-xs font-semibold text-red-300">86'd this session:</span>
                    {eightySixList.map(n => (
                        <span key={n} className="text-xs px-2 py-0.5 rounded-full text-red-200" style={{ background: 'rgba(239,68,68,0.2)' }}>{n}</span>
                    ))}
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center h-64">
                    <RefreshCw className="w-8 h-8 animate-spin text-slate-500" />
                </div>
            ) : orders.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-600">
                    <CheckCircle2 className="w-16 h-16 opacity-30" />
                    <p className="text-lg font-semibold">Bar is clear</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {orders.map(order => (
                        <DrinkCard key={order.id} order={order} onItemStatus={handleItemStatus} on86Item={handle86Item} darkMode={darkMode} />
                    ))}
                </div>
            )}
        </div>
    );
};
