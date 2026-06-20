import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useEntityUpdates } from '../hooks/useEntityUpdates';
import { toast } from 'sonner';
import { ChefHat, CheckCircle2, Clock, AlertTriangle, RefreshCw, XCircle } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;

const ITEM_COLORS = {
    pending:   'border-l-amber-400',
    preparing: 'border-l-blue-400',
    ready:     'border-l-emerald-400',
    served:    'border-l-gray-300',
};

const elapsed = (created_at) => {
    const diff = Math.floor((Date.now() - new Date(created_at)) / 1000);
    if (diff < 60) return `${diff}s`;
    return `${Math.floor(diff / 60)}m ${diff % 60}s`;
};

const OrderCard = ({ order, onItemReady, onItemStatus, on86Item }) => {
    const [tick, setTick] = useState(0);
    useEffect(() => {
        const t = setInterval(() => setTick(v => v + 1), 10000);
        return () => clearInterval(t);
    }, []);

    const kitchenItems = order.items.filter(i => i.route_to === 'kitchen' && i.status !== 'served' && i.status !== 'cancelled');
    if (kitchenItems.length === 0) return null;

    const age = Math.floor((Date.now() - new Date(order.created_at)) / 60000);
    const urgent = age >= 15;

    return (
        <div className={`card-soft overflow-hidden flex flex-col ${urgent ? 'ring-2 ring-red-400' : ''}`}>
            {/* Header */}
            <div className={`px-4 py-3 flex items-center justify-between ${urgent ? 'bg-red-50 dark:bg-red-900/20' : ''}`}
                style={{ borderBottom: '1px solid var(--border-light)' }}>
                <div>
                    <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                        {order.room_id ? `Room Order` : order.table_number ? `Table ${order.table_number}` : 'Walk-in'}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{order.server_name}</p>
                </div>
                <div className="text-right">
                    <div className={`flex items-center gap-1 text-xs font-semibold ${urgent ? 'text-red-600' : ''}`}
                        style={!urgent ? { color: 'var(--text-muted)' } : {}}>
                        {urgent && <AlertTriangle className="w-3 h-3" />}
                        <Clock className="w-3 h-3" />
                        {elapsed(order.created_at)}
                    </div>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        #{order.id.slice(-6).toUpperCase()}
                    </p>
                </div>
            </div>

            {/* Items */}
            <div className="flex-1 p-4 space-y-2">
                {kitchenItems.map(item => (
                    <div key={item.id} className={`rounded-xl p-3 border-l-4 ${ITEM_COLORS[item.status] || 'border-l-gray-300'}`}
                        style={{ background: 'var(--bg-page)', borderColor: `var(--border-light)` }}>
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                                <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                                    <span className="text-amber-600 font-bold">{item.quantity}×</span> {item.menu_item_name}
                                </p>
                                {item.modifiers?.length > 0 && (
                                    <p className="text-xs mt-0.5 text-blue-600 font-medium">
                                        ✎ {item.modifiers.join(' · ')}
                                    </p>
                                )}
                                {item.kitchen_note && (
                                    <p className="text-xs mt-0.5 italic" style={{ color: 'var(--text-muted)' }}>"{item.kitchen_note}"</p>
                                )}
                                {item.course && (
                                    <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full mt-1 bg-violet-100 text-violet-700 font-medium capitalize">{item.course}</span>
                                )}
                            </div>
                            <div className="flex flex-col gap-1">
                                {item.status === 'pending' && (
                                    <button onClick={() => onItemStatus(order.id, item.id, 'preparing')}
                                        className="text-xs px-2 py-1 rounded-lg bg-blue-100 text-blue-700 font-semibold hover:bg-blue-200 transition-colors whitespace-nowrap">
                                        Start
                                    </button>
                                )}
                                {item.status === 'preparing' && (
                                    <button onClick={() => onItemReady(order.id, item.id)}
                                        className="text-xs px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 font-semibold hover:bg-emerald-200 transition-colors whitespace-nowrap">
                                        Ready ✓
                                    </button>
                                )}
                                {item.status === 'ready' && (
                                    <span className="text-xs px-2 py-1 rounded-lg bg-emerald-50 text-emerald-600 font-semibold">Ready</span>
                                )}
                                {/* 86 button — long press or dedicated button */}
                                {item.status !== 'ready' && item.status !== 'served' && (
                                    <button
                                        onClick={() => on86Item(item.menu_item_id, item.menu_item_name)}
                                        title="86 this item — mark as unavailable"
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

export const KitchenDisplay = () => {
    const [orders, setOrders]           = useState([]);
    const [loading, setLoading]         = useState(true);
    const [lastRefresh, setLastRefresh] = useState(new Date());
    const [eightySixList, setEightySixList] = useState([]);
    const [darkMode, setDarkMode]       = useState(true); // KDS defaults dark // items marked 86'd this session

    const fetchOrders = useCallback(async () => {
        try {
            const res = await axios.get(`${API}/orders/kitchen`, { withCredentials: true });
            setOrders(res.data);
            setLastRefresh(new Date());
        } catch { /* silent — KDS should never show error popups */ }
        finally { setLoading(false); }
    }, []);

    useEffect(() => {
        fetchOrders();
        const t = setInterval(fetchOrders, 15000);
        return () => clearInterval(t);
    }, [fetchOrders]);

    useEntityUpdates('order', useCallback((data) => {
        // Refresh on any order change — cancelled orders will disappear
        // since backend filters to open/sent_to_kitchen only
        fetchOrders();
    }, [fetchOrders]), { debounceMs: 300 });

    const handleItemStatus = async (orderId, itemId, status) => {
        try {
            await axios.patch(`${API}/orders/${orderId}/items/${itemId}/status?status=${status}`, {}, { withCredentials: true });
            fetchOrders();
        } catch { toast.error('Failed to update item'); }
    };

    const handleItemReady = (orderId, itemId) => handleItemStatus(orderId, itemId, 'ready');

    // 86 an item — marks it unavailable on the menu
    const handle86Item = async (menuItemId, menuItemName) => {
        if (!window.confirm(`86 "${menuItemName}"? This marks it unavailable for new orders.`)) return;
        try {
            await axios.post(`${API}/menu-items/${menuItemId}/toggle-availability`, {}, { withCredentials: true });
            setEightySixList(prev => [...prev, menuItemName]);
            toast.success(`"${menuItemName}" marked 86'd — removed from menu`);
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to 86 item'); }
    };

    const pending   = orders.filter(o => o.items.some(i => i.route_to === 'kitchen' && i.status === 'pending'));
    const preparing = orders.filter(o => o.items.some(i => i.route_to === 'kitchen' && i.status === 'preparing') && !o.items.some(i => i.route_to === 'kitchen' && i.status === 'pending'));

    return (
        <div className="min-h-screen p-4 lg:p-6"
            style={{ background: darkMode ? '#0F172A' : '#F8FAFC', color: darkMode ? 'white' : '#1E293B' }}>
            {/* KDS Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
                        <ChefHat className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h1 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-slate-800'}`}>Kitchen Display</h1>
                        <p className={`text-xs ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>{orders.length} active order{orders.length !== 1 ? 's' : ''}</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <span className={`text-xs ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Updated: {lastRefresh.toLocaleTimeString('en-ET')}</span>
                    <button onClick={() => setDarkMode(d => !d)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${darkMode ? 'bg-slate-700 text-slate-200 hover:bg-slate-600' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}>
                        {darkMode ? '☀️ Light' : '🌙 Dark'}
                    </button>
                    <button onClick={fetchOrders}
                        className={`p-2 rounded-xl transition-colors ${darkMode ? 'bg-slate-800 hover:bg-slate-700' : 'bg-white hover:bg-slate-100 border border-slate-200'}`}>
                        <RefreshCw className={`w-4 h-4 ${darkMode ? 'text-slate-400' : 'text-slate-500'}`} />
                    </button>
                </div>
            </div>

            {/* 86'd list */}
            {eightySixList.length > 0 && (
                <div className="mb-4 p-3 rounded-2xl flex items-center gap-3 flex-wrap" style={{ background: darkMode ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
                    <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                    <span className="text-xs font-semibold text-red-300">86'd this session:</span>
                    {eightySixList.map(n => (
                        <span key={n} className="text-xs px-2 py-0.5 rounded-full bg-red-800/60 text-red-200">{n}</span>
                    ))}
                </div>
            )}

            {/* Stats bar */}
            <div className="grid grid-cols-3 gap-3 mb-6">
                {[
                    { label: 'Incoming',    count: pending.length,   color: 'from-amber-500 to-orange-500' },
                    { label: 'Preparing',   count: preparing.length, color: 'from-blue-500 to-indigo-500' },
                    { label: 'Total Active',count: orders.length,    color: 'from-violet-500 to-purple-600' },
                ].map(s => (
                    <div key={s.label} className="rounded-2xl p-4" style={{ background: darkMode ? '#1E293B' : '#FFFFFF', border: darkMode ? 'none' : '1px solid #E2E8F0' }}>
                        <p className={`text-2xl font-black bg-gradient-to-r ${s.color} bg-clip-text text-transparent`}>{s.count}</p>
                        <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide mt-1">{s.label}</p>
                    </div>
                ))}
            </div>

            {loading ? (
                <div className="flex items-center justify-center h-64">
                    <RefreshCw className="w-8 h-8 animate-spin text-slate-400" />
                </div>
            ) : orders.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-500" style={{ color: darkMode ? 'rgb(100,116,139)' : 'rgb(71,85,105)' }}>
                    <CheckCircle2 className="w-16 h-16 opacity-30" />
                    <p className="text-lg font-semibold">All clear — no pending orders</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {orders.map(order => (
                        <OrderCard key={order.id} order={order} onItemReady={handleItemReady} onItemStatus={handleItemStatus} on86Item={handle86Item} />
                    ))}
                </div>
            )}
        </div>
    );
};
