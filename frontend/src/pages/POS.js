import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useEntityUpdates } from '../hooks/useEntityUpdates';
import { toast } from 'sonner';
import { canVoidOrders, ROLES } from '../lib/roles';
import {
    Search, Plus, Minus, Trash2, ShoppingCart, CreditCard, Banknote,
    Receipt, X, UtensilsCrossed, History, Clock, Check, BedDouble,
    ChefHat, GlassWater, StickyNote, Printer, Smartphone,
    Split, AlertTriangle, Bell,
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;
const fmtETB = (n) => `${Number(n || 0).toLocaleString('en-ET', { minimumFractionDigits: 2 })} ETB`;

// ── Sound alert for item ready ───────────────────────────────────────────────
function playReadyAlert() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        [880, 1100, 880].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.18);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.15);
            osc.start(ctx.currentTime + i * 0.18);
            osc.stop(ctx.currentTime + i * 0.18 + 0.15);
        });
    } catch { /* audio blocked */ }
}

// ── Receipt printer ──────────────────────────────────────────────────────────
const printBill = (order) => {
    const win = window.open('', '_blank', 'width=420,height=700');
    if (!win) { toast.error('Allow popups to print'); return; }
    const rows = (order.items || []).map(i =>
        `<tr>
          <td style="padding:4px 0;font-size:13px;">${i.menu_item_name}
            ${i.modifiers?.length ? `<br/><span style="font-size:11px;color:#888;">${i.modifiers.join(', ')}</span>` : ''}
          </td>
          <td style="text-align:center;font-size:13px;">${i.quantity}</td>
          <td style="text-align:right;font-size:13px;">${fmtETB(i.line_total)}</td>
        </tr>`
    ).join('');
    win.document.write(`<html><head><title>Bill</title><style>
body{font-family:'Courier New',monospace;width:320px;margin:0 auto;padding:20px;color:#000;}
h2{text-align:center;margin:0 0 4px;font-size:18px;}
.sub{text-align:center;font-size:11px;color:#666;margin-bottom:12px;}
.line{border-top:1px dashed #000;margin:8px 0;}
table{width:100%;border-collapse:collapse;}
th{text-align:left;font-size:11px;text-transform:uppercase;padding-bottom:4px;border-bottom:1px solid #000;}
th:nth-child(2){text-align:center;}th:last-child{text-align:right;}
.totals td{padding:3px 0;font-size:13px;}
.total-row td{font-weight:bold;font-size:15px;padding-top:6px;border-top:1px solid #000;}
.footer{text-align:center;font-size:11px;color:#666;margin-top:16px;}
.id{font-size:10px;color:#999;text-align:center;margin-top:4px;}
</style></head><body>
<h2>BAR & RESTAURANT</h2>
<p class="sub">${new Date(order.created_at).toLocaleString('en-ET')}</p>
<p class="sub">Server: ${order.server_name || ''}
  ${order.room_id ? ' | Room order' : order.table_number ? ` | Table ${order.table_number}` : ''}</p>
<div class="line"></div>
<table><thead><tr><th>Item</th><th>Qty</th><th>Amount</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="line"></div>
<table class="totals">
<tr><td>Subtotal</td><td style="text-align:right">${fmtETB(order.subtotal)}</td></tr>
<tr><td>VAT (15%)</td><td style="text-align:right">${fmtETB(order.vat_amount)}</td></tr>
${order.discount_amount > 0 ? `<tr><td>Discount</td><td style="text-align:right">-${fmtETB(order.discount_amount)}</td></tr>` : ''}
<tr class="total-row"><td>TOTAL</td><td style="text-align:right">${fmtETB(order.total_amount)}</td></tr>
</table>
<div class="line"></div>
<p class="footer">አመሰግናለሁ! Thank you!</p>
<p class="id">Order: ${(order.id || '').slice(-8).toUpperCase()}</p>
<script>window.onload=function(){window.print()}<\/script>
</body></html>`);
    win.document.close();
};

// ── Payment method button ────────────────────────────────────────────────────
const PAY_METHODS = [
    { key: 'cash',     label: 'Cash',     Icon: Banknote },
    { key: 'card',     label: 'Card',     Icon: CreditCard },
    { key: 'telebirr', label: 'Telebirr', Icon: Smartphone },
    { key: 'credit',   label: 'Credit',   Icon: Receipt },
];

export const POS = () => {
    const { user } = useAuth();
    const isManager = [ROLES.OWNER, ROLES.MANAGER].includes(user?.role);
    const isOwner   = user?.role === ROLES.OWNER;

    // Menu + room state
    const [menuItems, setMenuItems]         = useState([]);
    const [categories, setCategories]       = useState([]);
    const [rooms, setRooms]                 = useState([]);
    const [servers, setServers]             = useState([]);   // for owner to assign
    const [assignedServerId, setAssignedServerId] = useState(''); // owner assigns a server
    const [loading, setLoading]             = useState(true);

    // Cart
    const [cart, setCart]                   = useState([]);
    const [searchTerm, setSearchTerm]       = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [selectedRoom, setSelectedRoom]   = useState('');
    const [tableNumber, setTableNumber]     = useState('');
    const [orderType, setOrderType]         = useState('dine_in');
    const [mobileTab, setMobileTab]         = useState('menu');

    // Modifier modal
    const [modifierItem, setModifierItem]   = useState(null);
    const [modifierText, setModifierText]   = useState('');

    // Success
    const [showSuccess, setShowSuccess]     = useState(false);
    const [lastOrder, setLastOrder]         = useState(null);

    // History
    const [showHistory, setShowHistory]     = useState(false);
    const [orders, setOrders]               = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyFilter, setHistoryFilter] = useState('active'); // active | all | paid

    // Payment modal
    const [showPayment, setShowPayment]     = useState(false);
    const [payMethod, setPayMethod]         = useState('cash');
    const [payRef, setPayRef]               = useState('');
    const [tipAmount, setTipAmount]         = useState(0);
    const [discountAmount, setDiscountAmount] = useState(0);
    const [payingOrder, setPayingOrder]     = useState(null);
    const [payLoading, setPayLoading]       = useState(false);

    // Split bill modal
    const [showSplit, setShowSplit]         = useState(false);
    const [splitType, setSplitType]         = useState('even');
    const [splitCount, setSplitCount]       = useState(2);
    const [splitOrder, setSplitOrder]       = useState(null);
    const [splitData, setSplitData]         = useState(null);
    const [splitLoading, setSplitLoading]   = useState(false);

    // Void request
    const [showVoid, setShowVoid]           = useState(false);
    const [voidOrder, setVoidOrder]         = useState(null);
    const [voidReason, setVoidReason]       = useState('');
    const [voidLoading, setVoidLoading]     = useState(false);

    // Void approvals (manager)
    const [pendingVoids, setPendingVoids]   = useState([]);
    const [showVoidMgr, setShowVoidMgr]     = useState(false);

    // Ready alert flash
    const [flashOrderId, setFlashOrderId]   = useState(null);

    // ── Data loading ──────────────────────────────────────────────────────────
    const fetchData = useCallback(async () => {
        try {
            const requests = [
                axios.get(`${API}/menu-items?available_only=true`, { withCredentials: true }),
            ];
            const canSeeRooms = [ROLES.OWNER, ROLES.MANAGER, ROLES.ROOM_MANAGER, ROLES.SERVER, ROLES.CASHIER].includes(user?.role);
            if (canSeeRooms) {
                requests.push(axios.get(`${API}/rooms`, { withCredentials: true }));
            }
            // Owner fetches server list to assign
            if (isOwner) {
                requests.push(axios.get(`${API}/employees`, { withCredentials: true }));
            }
            const results = await Promise.allSettled(requests);
            if (results[0].status === 'fulfilled') {
                const items = results[0].value.data?.items || results[0].value.data || [];
                setMenuItems(items);
                setCategories([...new Set(items.map(i => i.category))]);
            } else {
                toast.error('Failed to load menu');
            }
            if (canSeeRooms && results[1]?.status === 'fulfilled') {
                setRooms(results[1].value.data || []);
            }
            // Load servers for owner
            if (isOwner) {
                const srvIdx = canSeeRooms ? 2 : 1;
                if (results[srvIdx]?.status === 'fulfilled') {
                    const allStaff = results[srvIdx].value.data || [];
                    setServers(allStaff.filter(e => e.role === ROLES.SERVER && e.is_active !== false));
                }
            }
        } catch { toast.error('Failed to load menu'); }
        finally { setLoading(false); }
    }, [user?.role, isOwner]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const fetchHistory = useCallback(async () => {
        setHistoryLoading(true);
        try {
            const res = await axios.get(`${API}/orders?limit=50`, { withCredentials: true });
            setOrders(res.data);
        } catch { toast.error('Failed to load order history'); }
        finally { setHistoryLoading(false); }
    }, []);

    const fetchPendingVoids = useCallback(async () => {
        if (!isManager) return;
        try {
            const res = await axios.get(`${API}/void-requests?status=pending`, { withCredentials: true });
            setPendingVoids(res.data);
        } catch { /* silent */ }
    }, [isManager]);

    useEffect(() => { if (isManager) fetchPendingVoids(); }, [fetchPendingVoids, isManager]);

    // ── WebSocket: item ready alert ───────────────────────────────────────────
    useEntityUpdates(['order'], useCallback((data) => {
        if (data.action === 'item_ready') {
            playReadyAlert();
            setFlashOrderId(data.data?.id);
            setTimeout(() => setFlashOrderId(null), 4000);
            toast.success(`🔔 ${data.data?.menu_item_name || 'Item'} is READY — deliver now!`, { duration: 8000 });
        }
        if (data.action === 'created' || data.action === 'paid') fetchHistory();
    }, [fetchHistory]));

    useEntityUpdates('void_request', useCallback(() => { fetchPendingVoids(); }, [fetchPendingVoids]));

    // ── Cart helpers ──────────────────────────────────────────────────────────
    const addToCart = (item) => {
        if (item.out_of_stock) { toast.error(`${item.name} is out of stock`); return; }
        setCart(prev => {
            const ex = prev.find(c => c.menu_item_id === item.id);
            if (ex) return prev.map(c => c.menu_item_id === item.id ? { ...c, quantity: c.quantity + 1 } : c);
            return [...prev, {
                menu_item_id: item.id, menu_item_name: item.name,
                quantity: 1, unit_price: item.price,
                modifiers: [], kitchen_note: '', course: item.route_to === 'bar' ? 'drinks' : 'main',
                route_to: item.route_to,
            }];
        });
        if (window.innerWidth < 1024) setMobileTab('order');
    };

    const updateQty = (id, delta) => setCart(prev =>
        prev.map(c => c.menu_item_id === id ? { ...c, quantity: Math.max(1, c.quantity + delta) } : c)
    );
    const removeFromCart = (id) => setCart(prev => prev.filter(c => c.menu_item_id !== id));
    const clearCart = () => {
        setCart([]); setSelectedRoom(''); setTableNumber('');
        setDiscountAmount(0); setTipAmount(0);
    };

    const addModifier = () => {
        if (!modifierText.trim()) return;
        setCart(prev => prev.map(c => c.menu_item_id === modifierItem.menu_item_id
            ? { ...c, modifiers: [...c.modifiers, modifierText.trim()] } : c));
        setModifierText(''); setModifierItem(null);
    };

    const removeModifier = (itemId, mod) => setCart(prev => prev.map(c =>
        c.menu_item_id === itemId ? { ...c, modifiers: c.modifiers.filter(m => m !== mod) } : c
    ));

    // ── Totals — matches Eltrade A3 (Subtotal + VAT 15% only) ───────────────
    const subtotal = cart.reduce((s, i) => s + i.unit_price * i.quantity, 0);
    const vat      = subtotal * 0.15;
    const total    = subtotal + vat;

    // ── Send order to kitchen/bar ─────────────────────────────────────────────
    const handleSendOrder = async () => {
        if (cart.length === 0) { toast.error('Add items first'); return; }
        // Owner must assign a server before placing an order
        if (isOwner && !assignedServerId) {
            toast.error('Please assign a server for this order before sending');
            return;
        }
        try {
            const ikey = crypto.randomUUID();
            const res = await axios.post(`${API}/orders`, {
                room_id: selectedRoom || null,
                table_number: tableNumber || null,
                order_type: orderType,
                order_source: selectedRoom ? 'room' : 'table',
                notes: isOwner && assignedServerId
                    ? `[Owner Order — assigned to server ID: ${assignedServerId}]`
                    : undefined,
                items: cart.map(i => ({
                    menu_item_id: i.menu_item_id, menu_item_name: i.menu_item_name,
                    quantity: i.quantity, unit_price: i.unit_price,
                    modifiers: i.modifiers, kitchen_note: i.kitchen_note || null, course: i.course,
                })),
                idempotency_key: ikey,
            }, { withCredentials: true, headers: { 'Idempotency-Key': ikey } });

            await axios.patch(`${API}/orders/${res.data.id}/status`,
                { status: 'sent_to_kitchen' }, { withCredentials: true });

            // If owner assigned a server — notify them via WebSocket broadcast
            if (isOwner && assignedServerId) {
                const assignedServer = servers.find(s => s.id === assignedServerId);
                const serverName = assignedServer?.name || 'assigned server';
                toast.info(`Notified ${serverName} to serve this order`);
                // The broadcast will reach the server's Order Tracker automatically
                // via WebSocket entity_update → order.created with notes showing the assignment
            }

            setLastOrder(res.data); setShowSuccess(true); clearCart();
            setAssignedServerId('');
            toast.success('Order sent to kitchen/bar!');
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to place order'); }
    };

    // ── Pay order ─────────────────────────────────────────────────────────────
    const handlePayOrder = async () => {
        if (!payingOrder) return;
        setPayLoading(true);
        try {
            await axios.post(`${API}/orders/${payingOrder.id}/pay`, {
                payment_method: payMethod,
                payment_reference: payRef || null,
                tip_amount: tipAmount || 0,
                discount_amount: discountAmount || 0,
            }, { withCredentials: true });
            toast.success('Payment recorded');
            setShowPayment(false); setPayingOrder(null);
            setPayRef(''); setTipAmount(0); setDiscountAmount(0);
            fetchHistory();
        } catch (err) { toast.error(err.response?.data?.detail || 'Payment failed'); }
        finally { setPayLoading(false); }
    };

    // ── Void request ──────────────────────────────────────────────────────────
    const handleVoidRequest = async () => {
        if (!voidOrder || !voidReason.trim()) { toast.error('Please enter a reason'); return; }
        setVoidLoading(true);
        try {
            await axios.post(`${API}/void-requests`,
                { order_id: voidOrder.id, reason: voidReason }, { withCredentials: true });
            toast.success('Void request sent to manager');
            setShowVoid(false); setVoidOrder(null); setVoidReason('');
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to send void request'); }
        finally { setVoidLoading(false); }
    };

    const handleVoidReview = async (vrid, status) => {
        try {
            await axios.patch(`${API}/void-requests/${vrid}/review`,
                { status }, { withCredentials: true });
            toast.success(`Void ${status}`);
            fetchPendingVoids(); fetchHistory();
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    };

    // ── Split bill ────────────────────────────────────────────────────────────
    const handleCreateSplit = async () => {
        if (!splitOrder) return;
        setSplitLoading(true);
        try {
            let splits = [];
            const amt = splitOrder.total_amount;
            if (splitType === 'even') {
                const each = Math.round((amt / splitCount) * 100) / 100;
                splits = Array.from({ length: splitCount }, (_, i) => ({
                    label: `Guest ${i + 1}`, amount: each, paid: false,
                }));
            } else if (splitType === 'item') {
                splits = (splitOrder.items || []).map(item => ({
                    label: `${item.menu_item_name} x${item.quantity}`,
                    amount: item.line_total, items: [item.id], paid: false,
                }));
            } else {
                splits = Array.from({ length: splitCount }, (_, i) => ({
                    label: `Part ${i + 1}`, amount: 0, paid: false,
                }));
            }
            const res = await axios.post(`${API}/split-bills`,
                { order_id: splitOrder.id, split_type: splitType, splits },
                { withCredentials: true });
            setSplitData(res.data);
            toast.success('Split bill created');
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to split bill'); }
        finally { setSplitLoading(false); }
    };

    const handlePaySplit = async (splitIndex) => {
        if (!splitData) return;
        try {
            const res = await axios.post(`${API}/split-bills/pay-split`, {
                split_bill_id: splitData.id,
                split_index: splitIndex,
                payment_method: payMethod,
            }, { withCredentials: true });
            setSplitData(res.data);
            if (res.data.all_paid) {
                toast.success('All splits paid — order closed');
                setShowSplit(false); setSplitData(null);
                fetchHistory();
            } else {
                toast.success(`Split ${splitIndex + 1} paid`);
            }
        } catch (err) { toast.error(err.response?.data?.detail || 'Payment failed'); }
    };

    // ── Bartender rule: only bar-routed items (company policy — no food at bar) ──
    const isBartender = user?.role === ROLES.BARTENDER;

    // ── Filtered items ────────────────────────────────────────────────────────
    const filtered = menuItems.filter(m => {
        const s = searchTerm.toLowerCase();
        const matchSearch = m.name.toLowerCase().includes(s) || (m.name_am && m.name_am.includes(s));
        const matchCat    = selectedCategory === 'all' || m.category === selectedCategory;
        // Bartender can only order bar items (drinks) — food goes via server/room manager
        const matchRole   = isBartender ? m.route_to === 'bar' : true;
        return matchSearch && matchCat && matchRole;
    });

    const routeIcon = (route) => route === 'bar'
        ? <GlassWater className="w-3 h-3 text-blue-500" />
        : <ChefHat className="w-3 h-3 text-orange-500" />;

    // ════════════════════════════════════════════════════════════════════════
    return (
        <div className="flex flex-col h-[calc(100vh-65px)]" style={{ background: 'var(--bg-page)' }}>

            {/* Manager void requests badge */}
            {isManager && pendingVoids.length > 0 && (
                <div className="px-4 py-2 flex items-center gap-2 cursor-pointer"
                    style={{ background: '#FEF2F2', borderBottom: '1px solid #FECACA' }}
                    onClick={() => setShowVoidMgr(true)}>
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                    <span className="text-sm font-semibold text-red-700">
                        {pendingVoids.length} void request{pendingVoids.length !== 1 ? 's' : ''} pending approval
                    </span>
                    <span className="ml-auto text-xs text-red-500">Tap to review →</span>
                </div>
            )}

            {/* Mobile tabs */}
            <div className="flex lg:hidden border-b" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-light)' }}>
                {[['menu', UtensilsCrossed, 'Menu'], ['order', ShoppingCart, 'Order']].map(([tab, Icon, label]) => (
                    <button key={tab} onClick={() => setMobileTab(tab)}
                        className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors relative"
                        style={mobileTab === tab ? { color: '#F59E0B', borderBottom: '2px solid #F59E0B' } : { color: 'var(--text-muted)', borderBottom: '2px solid transparent' }}>
                        <Icon className="w-4 h-4" />{label}
                        {tab === 'order' && cart.length > 0 && (
                            <span className="absolute top-2 right-[calc(50%-28px)] w-4 h-4 rounded-full text-white text-[10px] font-bold flex items-center justify-center bg-amber-500">{cart.length}</span>
                        )}
                    </button>
                ))}
            </div>

            <div className="flex flex-1 min-h-0">
                {/* ── Menu Panel ── */}
                <div className={`flex-1 flex flex-col min-w-0 p-4 lg:p-6 overflow-hidden ${mobileTab === 'order' ? 'hidden lg:flex' : 'flex'}`}>
                    <div className="flex flex-col gap-3 mb-4">
                        <div className="flex items-center justify-between">
                            <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                                {isBartender ? 'Bar Order Ticket' : 'Order Ticket'}
                            </h1>
                            <button onClick={() => { setShowHistory(true); fetchHistory(); }}
                                className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-all"
                                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                                <History className="w-4 h-4" />History
                            </button>
                        </div>

                        {/* Bartender drinks-only notice */}
                        {isBartender && (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold"
                                style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', color: '#3B82F6' }}>
                                <GlassWater className="w-3.5 h-3.5 flex-shrink-0" />
                                Drinks only — food orders must be placed by a server
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                            <select value={selectedRoom} onChange={e => setSelectedRoom(e.target.value)}
                                className="px-3 py-2.5 text-sm rounded-xl border outline-none focus:border-amber-500 transition-all"
                                style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                                <option value="">No Room</option>
                                {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                            </select>
                            <input value={tableNumber} onChange={e => setTableNumber(e.target.value)} placeholder="Table # (optional)"
                                className="px-3 py-2.5 text-sm rounded-xl border outline-none focus:border-amber-500 transition-all"
                                style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                        </div>

                        {/* Owner: must assign a server before sending order */}
                        {isOwner && (
                            <div className={`rounded-xl p-3 border-2 transition-all ${assignedServerId ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/10' : 'border-amber-400 bg-amber-50 dark:bg-amber-900/10'}`}>
                                <label className="block text-xs font-bold mb-1.5 uppercase tracking-wider" style={{ color: assignedServerId ? '#059669' : '#D97706' }}>
                                    {assignedServerId ? '✓ Server Assigned' : '⚠️ Assign Server (Required for Owner Orders)'}
                                </label>
                                <select value={assignedServerId} onChange={e => setAssignedServerId(e.target.value)}
                                    className="w-full px-3 py-2 text-sm rounded-lg border outline-none transition-all"
                                    style={{ background: 'white', borderColor: assignedServerId ? '#6EE7B7' : '#FCD34D', color: '#1E293B' }}>
                                    <option value="">— Select server to deliver this order —</option>
                                    {servers.map(s => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                                {assignedServerId && (
                                    <p className="text-xs mt-1.5 font-semibold text-emerald-700">
                                        {servers.find(s => s.id === assignedServerId)?.name} will be notified to pick up and deliver this order
                                    </p>
                                )}
                                {!assignedServerId && cart.length > 0 && (
                                    <p className="text-xs mt-1.5 text-amber-700">You must select a server before sending the order</p>
                                )}
                            </div>
                        )}
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                                <input type="text" placeholder="Search menu…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                                    className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
                                    style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                            </div>
                            <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}
                                className="pl-3 pr-6 py-2.5 text-sm rounded-xl border outline-none appearance-none focus:border-amber-500 transition-all"
                                style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                                <option value="all">All</option>
                                {categories.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* Menu grid */}
                    <div className="flex-1 overflow-y-auto">
                        {loading ? (
                            <div className="pos-grid">{[...Array(8)].map((_,i)=><div key={i} className="aspect-square rounded-2xl animate-pulse" style={{background:'var(--bg-card)'}} />)}</div>
                        ) : filtered.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-64 gap-3" style={{ color: 'var(--text-muted)' }}>
                                <UtensilsCrossed className="w-12 h-12 opacity-30" /><p>No items found</p>
                            </div>
                        ) : (
                            <div className="pos-grid">
                                {filtered.map(item => {
                                    const inCart = cart.find(c => c.menu_item_id === item.id);
                                    return (
                                        <button key={item.id} onClick={() => addToCart(item)}
                                            disabled={item.out_of_stock}
                                            className={`pos-item p-3 text-center relative transition-all ${item.out_of_stock ? 'opacity-40 cursor-not-allowed' : ''}`}>
                                            {item.out_of_stock && (
                                                <div className="absolute inset-0 flex items-center justify-center rounded-2xl z-10"
                                                    style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)' }}>
                                                    <span className="text-white text-xs font-bold px-2 py-1 rounded-lg"
                                                        style={{ background: 'rgba(239,68,68,0.85)' }}>Out of Stock</span>
                                                </div>
                                            )}
                                            <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-2 mx-auto text-2xl"
                                                style={{ background: item.route_to === 'bar' ? 'rgba(59,130,246,0.1)' : 'rgba(245,158,11,0.1)' }}>
                                                {item.route_to === 'bar' ? '🍸' : item.is_alcohol ? '🍺' : '🍽️'}
                                            </div>
                                            <p className="text-xs font-semibold truncate w-full" style={{ color: 'var(--text-primary)' }}>{item.name}</p>
                                            {item.name_am && <p className="text-xs truncate w-full" style={{ color: 'var(--text-muted)' }}>{item.name_am}</p>}
                                            <p className="text-sm font-bold mt-0.5 text-amber-600">{fmtETB(item.price)}</p>
                                            <div className="flex items-center justify-center gap-1 mt-0.5">
                                                {routeIcon(item.route_to)}
                                                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{item.prep_time}min</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Order Panel ── */}
                <div className={`receipt-panel flex flex-col lg:w-96 w-full ${mobileTab === 'menu' ? 'hidden lg:flex' : 'flex'}`}
                    style={{ background: 'var(--bg-card)', borderLeft: '1px solid var(--border-light)' }}>
                    <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border-light)' }}>
                        <h2 className="font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                            <ShoppingCart className="w-5 h-5 text-amber-500" />Current Order
                            {cart.length > 0 && <span className="w-5 h-5 rounded-full text-white text-xs font-bold flex items-center justify-center bg-amber-500">{cart.length}</span>}
                        </h2>
                        {cart.length > 0 && (
                            <button onClick={clearCart} className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-red-500 hover:bg-red-50 transition-colors">
                                <Trash2 className="w-3.5 h-3.5" />Clear
                            </button>
                        )}
                    </div>
                    {(selectedRoom || tableNumber) && (
                        <div className="px-4 py-2 flex items-center gap-2 text-xs border-b" style={{ borderColor: 'var(--border-light)', color: 'var(--text-muted)', background: 'var(--bg-page)' }}>
                            <BedDouble className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>{selectedRoom ? `Room: ${rooms.find(r => r.id === selectedRoom)?.name}` : `Table: ${tableNumber}`}</span>
                            {selectedRoom && (() => {
                                const room = rooms.find(r => r.id === selectedRoom);
                                const minSpend = room?.minimum_spend || 0;
                                if (minSpend <= 0) return null;
                                const belowMin = total > 0 && total < minSpend;
                                return (
                                    <span className={`ml-auto font-semibold ${belowMin ? 'text-red-500' : 'text-amber-600'}`}>
                                        {belowMin ? '⚠️ Below min spend · ' : 'Min spend: '}
                                        {fmtETB(minSpend)}
                                    </span>
                                );
                            })()}
                        </div>
                    )}

                    {/* Cart items */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-2" style={{ background: 'var(--bg-page)' }}>
                        {cart.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-48 gap-3" style={{ color: 'var(--text-muted)' }}>
                                <Receipt className="w-10 h-10 opacity-30" /><p className="text-sm">Order is empty</p>
                            </div>
                        ) : cart.map(item => (
                            <div key={item.menu_item_id} className="rounded-2xl p-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
                                <div className="flex items-start justify-between mb-2">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            {routeIcon(item.route_to)}
                                            <p className="font-semibold text-sm truncate" style={{ color: 'var(--text-primary)' }}>{item.menu_item_name}</p>
                                        </div>
                                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{fmtETB(item.unit_price)} each</p>
                                        {item.modifiers.length > 0 && (
                                            <div className="flex flex-wrap gap-1 mt-1">
                                                {item.modifiers.map(m => (
                                                    <span key={m} className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 flex items-center gap-1">
                                                        {m}<button onClick={() => removeModifier(item.menu_item_id, m)} className="hover:text-red-500"><X className="w-2.5 h-2.5" /></button>
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex gap-1 ml-2">
                                        <button onClick={() => setModifierItem(item)} className="p-1 rounded-lg text-blue-400 hover:bg-blue-50 transition-colors"><StickyNote className="w-3.5 h-3.5" /></button>
                                        <button onClick={() => removeFromCart(item.menu_item_id)} className="p-1 rounded-lg text-red-400 hover:bg-red-50 transition-colors"><X className="w-3.5 h-3.5" /></button>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => updateQty(item.menu_item_id, -1)} className="w-7 h-7 rounded-xl flex items-center justify-center transition-colors" style={{ background: 'var(--bg-page)', border: '1px solid var(--border)' }}>
                                            <Minus className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
                                        </button>
                                        <span className="w-8 text-center text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{item.quantity}</span>
                                        <button onClick={() => updateQty(item.menu_item_id, 1)} className="w-7 h-7 rounded-xl flex items-center justify-center transition-colors" style={{ background: 'var(--bg-page)', border: '1px solid var(--border)' }}>
                                            <Plus className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
                                        </button>
                                    </div>
                                    <p className="font-bold text-sm text-amber-600">{fmtETB(item.unit_price * item.quantity)}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Totals + send */}
                    <div className="p-4 space-y-2 border-t" style={{ borderColor: 'var(--border-light)' }}>
                        {[['Subtotal', subtotal], ['VAT (15%)', vat]].map(([l, v]) => (
                            <div key={l} className="flex justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
                                <span>{l}</span><span>{fmtETB(v)}</span>
                            </div>
                        ))}
                        <div className="flex justify-between text-base font-bold pt-1 border-t" style={{ borderColor: 'var(--border-light)', color: 'var(--text-primary)' }}>
                            <span>Total</span><span className="text-amber-600">{fmtETB(total)}</span>
                        </div>
                        <button onClick={handleSendOrder} disabled={cart.length === 0}
                            className="w-full py-3.5 rounded-2xl text-sm font-bold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:-translate-y-0.5"
                            style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)', boxShadow: '0 6px 20px rgba(245,158,11,0.35)' }}>
                            <ChefHat className="w-4 h-4 inline mr-2" />Send to Kitchen / Bar
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Modifier Modal ── */}
            {modifierItem && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-sm rounded-3xl p-6 shadow-2xl" style={{ background: 'var(--bg-card)' }}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Add Modifier — {modifierItem.menu_item_name}</h3>
                            <button onClick={() => setModifierItem(null)} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                        </div>
                        <div className="flex gap-2 mb-3">
                            <input value={modifierText} onChange={e => setModifierText(e.target.value)} onKeyDown={e => e.key === 'Enter' && addModifier()}
                                placeholder="e.g. No ice, Extra spicy, Well done…"
                                className="flex-1 px-4 py-2.5 text-sm rounded-xl border outline-none focus:border-amber-500 transition-all"
                                style={{ background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} autoFocus />
                            <button onClick={addModifier} className="px-4 py-2.5 rounded-xl text-sm font-bold text-white" style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}>Add</button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {['No ice', 'Extra spicy', 'Well done', 'Rare', 'No onions', 'Extra sauce', 'Medium'].map(s => (
                                <button key={s} onClick={() => setModifierText(s)}
                                    className="text-xs px-3 py-1 rounded-full border transition-all hover:border-amber-500"
                                    style={{ background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>{s}</button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Order Success Modal ── */}
            {showSuccess && lastOrder && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-sm rounded-3xl p-6 shadow-2xl text-center" style={{ background: 'var(--bg-card)' }}>
                        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                            <Check className="w-8 h-8 text-emerald-600" />
                        </div>
                        <h3 className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Order Sent!</h3>
                        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>{lastOrder.items?.length} items · {fmtETB(lastOrder.total_amount)}</p>
                        <button onClick={() => setShowSuccess(false)} className="w-full py-2.5 rounded-xl text-sm font-bold text-white" style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}>
                            New Order
                        </button>
                    </div>
                </div>
            )}

            {/* ── History Panel ── */}
            {showHistory && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-lg rounded-3xl shadow-2xl max-h-[80vh] flex flex-col" style={{ background: 'var(--bg-card)' }}>
                        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border-light)' }}>
                            <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>Order History</h3>
                            <button onClick={() => setShowHistory(false)} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                        </div>
                        {/* Filter tabs */}
                        <div className="flex gap-1 mx-4 mt-3 p-1 rounded-xl" style={{ background: 'var(--bg-page)', border: '1px solid var(--border-light)' }}>
                            {[['active','Active'],['paid','Paid'],['all','All']].map(([k,l]) => (
                                <button key={k} onClick={() => setHistoryFilter(k)}
                                    className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all"
                                    style={historyFilter === k
                                        ? { background: 'linear-gradient(135deg,#F59E0B,#D97706)', color: 'white' }
                                        : { color: 'var(--text-muted)' }}>
                                    {l}
                                </button>
                            ))}
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {historyLoading ? (
                                <div className="flex justify-center py-8"><Clock className="w-6 h-6 animate-spin" style={{ color: 'var(--text-muted)' }} /></div>
                            ) : orders.filter(o => {
                                if (historyFilter === 'active') return o.payment_status === 'unpaid' && o.status !== 'cancelled';
                                if (historyFilter === 'paid') return o.payment_status === 'paid';
                                return true; // all
                            }).map(o => (
                                <div key={o.id} className={`rounded-2xl p-4 border transition-all ${flashOrderId === o.id ? 'ring-2 ring-amber-400 bg-amber-50' : ''}`}
                                    style={{ background: 'var(--bg-page)', borderColor: 'var(--border-light)' }}>
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="font-mono text-xs font-bold" style={{ color: 'var(--text-primary)' }}>#{o.id.slice(-8).toUpperCase()}</span>
                                        <div className="flex items-center gap-2">
                                            {flashOrderId === o.id && <Bell className="w-3.5 h-3.5 text-amber-500 animate-bounce" />}
                                            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                                                o.status === 'cancelled' ? 'bg-red-100 text-red-600' :
                                                o.payment_status === 'paid' ? 'bg-emerald-100 text-emerald-700' :
                                                o.status === 'served' ? 'bg-violet-100 text-violet-700' :
                                                o.status === 'ready' ? 'bg-emerald-100 text-emerald-600' :
                                                o.status === 'sent_to_kitchen' ? 'bg-blue-100 text-blue-700' :
                                                'bg-amber-100 text-amber-700'
                                            }`}>
                                                {o.status === 'cancelled' ? 'cancelled' :
                                                 o.payment_status === 'paid' ? 'paid' :
                                                 o.status}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                                        {o.items?.length} items · {fmtETB(o.total_amount)} · {new Date(o.created_at).toLocaleTimeString('en-ET')}
                                    </div>
                                    {/* Show void reason if cancelled */}
                                    {o.status === 'cancelled' && o.void_reason && (
                                        <div className="mb-2 px-2 py-1 rounded-lg text-xs text-red-500 bg-red-50">
                                            ✗ {o.void_reason}
                                        </div>
                                    )}
                                    {/* Order item statuses */}
                                    {o.items?.some(i => i.status === 'ready') && (
                                        <div className="mb-2 p-2 rounded-xl bg-emerald-50 text-xs font-semibold text-emerald-700 flex items-center gap-1">
                                            <Bell className="w-3.5 h-3.5" />
                                            {o.items.filter(i => i.status === 'ready').map(i => i.menu_item_name).join(', ')} — READY!
                                        </div>
                                    )}
                                    {o.payment_status === 'unpaid' && o.status !== 'cancelled' && (
                                        <div className="flex gap-2 mt-2">
                                            {/* Collect Payment — only after served */}
                                            {o.status === 'served' ? (
                                                <button onClick={() => { setPayingOrder(o); setShowHistory(false); setShowPayment(true); }}
                                                    className="flex-1 py-1.5 rounded-xl text-xs font-bold text-white"
                                                    style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}>
                                                    Collect Payment
                                                </button>
                                            ) : (
                                                <div className="flex-1 py-1.5 rounded-xl text-xs text-center"
                                                    style={{ background: 'var(--bg-page)', border: '1px dashed var(--border)', color: 'var(--text-muted)' }}>
                                                    {o.status === 'open' ? 'Not sent yet' :
                                                     o.status === 'sent_to_kitchen' ? 'Preparing…' :
                                                     o.status === 'ready' ? 'Ready — mark served first' :
                                                     o.status}
                                                </div>
                                            )}
                                            <button onClick={() => { setSplitOrder(o); setShowHistory(false); setShowSplit(true); }}
                                                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all"
                                                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                                                <Split className="w-3 h-3" />Split
                                            </button>
                                            <button onClick={() => { setVoidOrder(o); setShowHistory(false); setShowVoid(true); }}
                                                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold border border-red-200 text-red-500 hover:bg-red-50 transition-all">
                                                <Trash2 className="w-3 h-3" />Void
                                            </button>
                                        </div>
                                    )}
                                    {o.payment_status === 'paid' && (
                                        <button onClick={() => printBill(o)} className="w-full mt-2 py-1.5 rounded-xl text-xs font-semibold border flex items-center justify-center gap-1 transition-all"
                                            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                                            <Printer className="w-3.5 h-3.5" />Reprint
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Payment Modal ── */}
            {showPayment && payingOrder && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-sm rounded-3xl p-6 shadow-2xl" style={{ background: 'var(--bg-card)' }}>
                        <div className="flex items-center justify-between mb-5">
                            <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>Collect Payment</h3>
                            <button onClick={() => setShowPayment(false)} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                        </div>
                        <p className="text-2xl font-bold text-amber-600 mb-4">{fmtETB(payingOrder.total_amount)}</p>
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                                {PAY_METHODS.map(({ key, label, Icon }) => (
                                    <button key={key} onClick={() => setPayMethod(key)}
                                        className="flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-semibold transition-all"
                                        style={payMethod === key ? { background: 'linear-gradient(135deg,#F59E0B,#D97706)', color: 'white' } : { background: 'var(--bg-page)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                                        <Icon className="w-4 h-4" />{label}
                                    </button>
                                ))}
                            </div>
                            {(payMethod === 'card' || payMethod === 'telebirr') && (
                                <input value={payRef} onChange={e => setPayRef(e.target.value)}
                                    placeholder={payMethod === 'telebirr' ? 'Telebirr transaction ID' : 'Card reference'}
                                    className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:border-amber-500 transition-all"
                                    style={{ background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                            )}
                            <div className="flex gap-2">
                                <div className="flex-1">
                                    <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Discount (ETB)</label>
                                    <input type="number" min="0" step="0.01" value={discountAmount} onChange={e => setDiscountAmount(parseFloat(e.target.value) || 0)}
                                        className="w-full px-3 py-2 text-sm rounded-xl border outline-none focus:border-amber-500 transition-all"
                                        style={{ background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                                </div>
                                <div className="flex-1">
                                    <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Tip (ETB)</label>
                                    <input type="number" min="0" step="0.01" value={tipAmount} onChange={e => setTipAmount(parseFloat(e.target.value) || 0)}
                                        className="w-full px-3 py-2 text-sm rounded-xl border outline-none focus:border-amber-500 transition-all"
                                        style={{ background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                                </div>
                            </div>
                            <button onClick={handlePayOrder} disabled={payLoading}
                                className="w-full py-3.5 rounded-2xl text-sm font-bold text-white transition-all disabled:opacity-50"
                                style={{ background: 'linear-gradient(135deg,#10B981,#059669)' }}>
                                {payLoading ? 'Processing…' : `Confirm · ${fmtETB(payingOrder.total_amount)}`}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Split Bill Modal ── */}
            {showSplit && splitOrder && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-md rounded-3xl p-6 shadow-2xl max-h-[85vh] overflow-y-auto" style={{ background: 'var(--bg-card)' }}>
                        <div className="flex items-center justify-between mb-5">
                            <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>Split Bill — {fmtETB(splitOrder.total_amount)}</h3>
                            <button onClick={() => { setShowSplit(false); setSplitData(null); }} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                        </div>

                        {!splitData ? (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Split Type</label>
                                    <div className="grid grid-cols-3 gap-2">
                                        {[['even','Evenly'],['item','By Item'],['custom','Custom']].map(([k,l]) => (
                                            <button key={k} onClick={() => setSplitType(k)}
                                                className="py-2 rounded-xl text-xs font-semibold transition-all"
                                                style={splitType === k ? { background: 'linear-gradient(135deg,#F59E0B,#D97706)', color: 'white' } : { background: 'var(--bg-page)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                                                {l}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                {(splitType === 'even' || splitType === 'custom') && (
                                    <div>
                                        <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Number of people</label>
                                        <input type="number" min="2" max="20" value={splitCount} onChange={e => setSplitCount(parseInt(e.target.value) || 2)}
                                            className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:border-amber-500 transition-all"
                                            style={{ background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                                        {splitType === 'even' && (
                                            <p className="text-xs mt-1 text-amber-600 font-semibold">Each pays: {fmtETB(splitOrder.total_amount / splitCount)}</p>
                                        )}
                                    </div>
                                )}
                                {splitType === 'item' && (
                                    <div className="space-y-1">
                                        {(splitOrder.items || []).map(i => (
                                            <div key={i.id} className="flex justify-between text-sm py-1 border-b" style={{ borderColor: 'var(--border-light)' }}>
                                                <span style={{ color: 'var(--text-primary)' }}>{i.menu_item_name} x{i.quantity}</span>
                                                <span className="font-semibold text-amber-600">{fmtETB(i.line_total)}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <button onClick={handleCreateSplit} disabled={splitLoading}
                                    className="w-full py-3 rounded-2xl text-sm font-bold text-white transition-all disabled:opacity-50"
                                    style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}>
                                    {splitLoading ? 'Creating…' : 'Create Split Bill'}
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <p className="text-sm font-semibold text-emerald-600 mb-3">Split bill created — collect from each guest:</p>
                                {(splitData.splits || []).map((split, i) => (
                                    <div key={i} className={`p-3 rounded-2xl border ${split.paid ? 'opacity-60' : ''}`}
                                        style={{ background: 'var(--bg-page)', borderColor: split.paid ? '#D1FAE5' : 'var(--border-light)' }}>
                                        <div className="flex items-center justify-between mb-2">
                                            <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{split.label}</p>
                                            <div className="flex items-center gap-2">
                                                <p className="font-bold text-amber-600">{fmtETB(split.amount)}</p>
                                                {split.paid && <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">✓ Paid</span>}
                                            </div>
                                        </div>
                                        {!split.paid && (
                                            <div className="flex gap-2">
                                                {PAY_METHODS.slice(0, 3).map(({ key, label }) => (
                                                    <button key={key} onClick={() => { setPayMethod(key); handlePaySplit(i); }}
                                                        className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all"
                                                        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                                                        {label}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Void Request Modal (staff) ── */}
            {showVoid && voidOrder && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-sm rounded-3xl p-6 shadow-2xl" style={{ background: 'var(--bg-card)' }}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>Request Void</h3>
                            <button onClick={() => setShowVoid(false)} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                        </div>
                        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                            Order #{voidOrder.id.slice(-8).toUpperCase()} · {fmtETB(voidOrder.total_amount)}
                        </p>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Reason *</label>
                                <textarea value={voidReason} onChange={e => setVoidReason(e.target.value)} rows={3}
                                    placeholder="e.g. Wrong item ordered, customer complaint…"
                                    className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all resize-none"
                                    style={{ background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                            </div>
                            <p className="text-xs p-2 rounded-lg bg-amber-50 text-amber-700">
                                ⚠️ This will send a void request to the manager for approval.
                            </p>
                            <div className="flex gap-3">
                                <button onClick={() => setShowVoid(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
                                <button onClick={handleVoidRequest} disabled={voidLoading || !voidReason.trim()}
                                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50 bg-red-500 hover:bg-red-600">
                                    {voidLoading ? 'Sending…' : 'Send Request'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Void Approval Modal (manager) ── */}
            {showVoidMgr && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-md rounded-3xl p-6 shadow-2xl max-h-[80vh] overflow-y-auto" style={{ background: 'var(--bg-card)' }}>
                        <div className="flex items-center justify-between mb-5">
                            <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>Void Approvals</h3>
                            <button onClick={() => setShowVoidMgr(false)} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                        </div>
                        {pendingVoids.length === 0 ? (
                            <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>No pending void requests</p>
                        ) : pendingVoids.map(vr => (
                            <div key={vr.id} className="p-4 rounded-2xl mb-3 border" style={{ background: 'var(--bg-page)', borderColor: 'var(--border-light)' }}>
                                <div className="flex items-center justify-between mb-1">
                                    <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                                        Order #{vr.order_id.slice(-8).toUpperCase()}
                                    </p>
                                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>by {vr.requested_by_name}</p>
                                </div>
                                <p className="text-xs mb-3 italic" style={{ color: 'var(--text-muted)' }}>"{vr.reason}"</p>
                                <div className="flex gap-2">
                                    <button onClick={() => handleVoidReview(vr.id, 'approved')}
                                        className="flex-1 py-2 rounded-xl text-sm font-bold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors">
                                        ✓ Approve
                                    </button>
                                    <button onClick={() => handleVoidReview(vr.id, 'rejected')}
                                        className="flex-1 py-2 rounded-xl text-sm font-bold text-white bg-red-500 hover:bg-red-600 transition-colors">
                                        ✗ Reject
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
