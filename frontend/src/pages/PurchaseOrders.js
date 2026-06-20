import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
    Plus, X, ChevronDown, Package, Truck,
    CheckCircle2, XCircle, Clock, ShoppingBag,
    AlertTriangle, Search,
} from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;
const inputStyle = { background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' };

const statusConfig = {
    pending:   { label: 'Pending',   icon: Clock,         bg: 'bg-amber-100 text-amber-700',   dot: 'bg-amber-500' },
    received:  { label: 'Received',  icon: CheckCircle2,  bg: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
    cancelled: { label: 'Cancelled', icon: XCircle,       bg: 'bg-red-100 text-red-600',        dot: 'bg-red-500' },
};

const Field = ({ label, children }) => (
    <div>
        <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</label>
        {children}
    </div>
);

export const PurchaseOrders = () => {
    const [orders, setOrders] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');

    // Create order modal
    const [showCreate, setShowCreate] = useState(false);
    const [createForm, setCreateForm] = useState({ supplier_id: '', notes: '', expected_delivery: '' });
    const [orderItems, setOrderItems] = useState([{ product_id: '', product_name: '', quantity_ordered: 1, unit_cost: 0 }]);

    // Receive order modal
    const [showReceive, setShowReceive] = useState(false);
    const [receivingOrder, setReceivingOrder] = useState(null);
    const [receiveItems, setReceiveItems] = useState([]);
    const [receiveNotes, setReceiveNotes] = useState('');

    const fetchData = useCallback(async () => {
        try {
            const [ordersRes, suppliersRes, productsRes] = await Promise.all([
                axios.get(`${API}/purchase-orders`, { withCredentials: true }),
                axios.get(`${API}/suppliers`, { withCredentials: true }),
                axios.get(`${API}/products`, { withCredentials: true }),
            ]);
            setOrders(ordersRes.data);
            setSuppliers(suppliersRes.data);
            setProducts(productsRes.data?.items || productsRes.data || []);
        } catch { toast.error('Failed to load purchase orders'); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleAddItem = () => setOrderItems([...orderItems, { product_id: '', product_name: '', quantity_ordered: 1, unit_cost: 0 }]);
    const handleRemoveItem = (i) => setOrderItems(orderItems.filter((_, idx) => idx !== i));
    const handleItemChange = (i, field, value) => {
        const updated = [...orderItems];
        updated[i] = { ...updated[i], [field]: value };
        if (field === 'product_id') {
            const product = products.find(p => p.id === value);
            if (product) {
                updated[i].product_name = product.name;
                updated[i].unit_cost = product.cost_price || 0;
            }
        }
        setOrderItems(updated);
    };

    const handleCreate = async (e) => {
        e.preventDefault();
        const validItems = orderItems.filter(i => i.product_id && i.quantity_ordered > 0);
        if (!validItems.length) { toast.error('Add at least one item'); return; }
        try {
            await axios.post(`${API}/purchase-orders`, {
                supplier_id: createForm.supplier_id,
                items: validItems.map(i => ({ ...i, quantity_ordered: parseInt(i.quantity_ordered), unit_cost: parseFloat(i.unit_cost) })),
                notes: createForm.notes || null,
                expected_delivery: createForm.expected_delivery || null,
            }, { withCredentials: true });
            toast.success('Purchase order created');
            setShowCreate(false);
            setCreateForm({ supplier_id: '', notes: '', expected_delivery: '' });
            setOrderItems([{ product_id: '', product_name: '', quantity_ordered: 1, unit_cost: 0 }]);
            fetchData();
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to create order'); }
    };

    const openReceive = (order) => {
        setReceivingOrder(order);
        setReceiveItems(order.items.map(i => ({ product_id: i.product_id, product_name: i.product_name, quantity_ordered: i.quantity_ordered, quantity_received: i.quantity_ordered })));
        setReceiveNotes('');
        setShowReceive(true);
    };

    const handleReceive = async () => {
        try {
            await axios.put(`${API}/purchase-orders/${receivingOrder.id}/receive`, {
                items: receiveItems.map(i => ({ product_id: i.product_id, quantity_received: parseInt(i.quantity_received) })),
                notes: receiveNotes || null,
            }, { withCredentials: true });
            toast.success('Stock updated — inventory restocked');
            setShowReceive(false);
            fetchData();
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to receive order'); }
    };

    const handleCancel = async (orderId) => {
        if (!window.confirm('Cancel this purchase order?')) return;
        try {
            await axios.put(`${API}/purchase-orders/${orderId}/cancel`, {}, { withCredentials: true });
            toast.success('Order cancelled');
            fetchData();
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to cancel order'); }
    };

    const filtered = orders.filter(o => {
        const matchSearch = !searchTerm || o.supplier_name?.toLowerCase().includes(searchTerm.toLowerCase()) || o.id?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchStatus = statusFilter === 'all' || o.status === statusFilter;
        return matchSearch && matchStatus;
    });

    const totalCost = filtered.reduce((s, o) => s + (o.total_cost || 0), 0);

    return (
        <div className="p-6 lg:p-8 space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Purchase Orders</h1>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {orders.filter(o => o.status === 'pending').length} pending · ${totalCost.toFixed(2)} total value
                    </p>
                </div>
                <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:-translate-y-0.5" style={{ background: 'linear-gradient(135deg,#7C3AED,#6D28D9)', boxShadow: '0 4px 14px rgba(124,58,237,0.35)' }}>
                    <Plus className="w-4 h-4" />New Order
                </button>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                    <input type="text" placeholder="Search by supplier or order ID…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all" style={inputStyle} />
                </div>
                <div className="relative">
                    <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="pl-4 pr-8 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all appearance-none cursor-pointer" style={inputStyle}>
                        <option value="all">All Status</option>
                        <option value="pending">Pending</option>
                        <option value="received">Received</option>
                        <option value="cancelled">Cancelled</option>
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                </div>
            </div>

            {/* Orders list */}
            <div className="card-soft overflow-hidden">
                {loading ? (
                    <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3" style={{ color: 'var(--text-muted)' }}>
                        <ShoppingBag className="w-12 h-12 opacity-30" />
                        <p className="text-sm">No purchase orders yet</p>
                        <p className="text-xs opacity-60">Create an order to restock inventory from a supplier</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="data-table">
                            <thead><tr><th>Order ID</th><th>Supplier</th><th>Items</th><th>Total Cost</th><th>Expected</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
                            <tbody>
                                {filtered.map(order => {
                                    const sc = statusConfig[order.status] || statusConfig.pending;
                                    const StatusIcon = sc.icon;
                                    return (
                                        <tr key={order.id}>
                                            <td className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{order.id.slice(0, 8)}…</td>
                                            <td>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                                                        <Truck className="w-3.5 h-3.5 text-white" />
                                                    </div>
                                                    <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{order.supplier_name}</span>
                                                </div>
                                            </td>
                                            <td className="text-sm" style={{ color: 'var(--text-secondary)' }}>{order.items?.length} item{order.items?.length !== 1 ? 's' : ''}</td>
                                            <td className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>${order.total_cost?.toFixed(2)}</td>
                                            <td className="text-sm" style={{ color: 'var(--text-muted)' }}>{order.expected_delivery || '—'}</td>
                                            <td>
                                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${sc.bg}`}>
                                                    <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                                                    {sc.label}
                                                </span>
                                            </td>
                                            <td className="text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    {order.status === 'pending' && (
                                                        <>
                                                            <button onClick={() => openReceive(order)} className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition-all" style={{ background: 'linear-gradient(135deg,#10B981,#059669)' }}>
                                                                Receive Stock
                                                            </button>
                                                            <button onClick={() => handleCancel(order.id)} className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors hover:bg-red-50 text-red-500">
                                                                Cancel
                                                            </button>
                                                        </>
                                                    )}
                                                    {order.status === 'received' && (
                                                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                                            Received {order.received_at ? new Date(order.received_at).toLocaleDateString() : ''}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Create Order Modal */}
            {showCreate && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-2xl rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto" style={{ background: 'var(--bg-card)' }}>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>New Purchase Order</h3>
                            <button onClick={() => setShowCreate(false)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800" style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                        </div>
                        <form onSubmit={handleCreate} className="space-y-5">
                            <div className="grid grid-cols-2 gap-4">
                                <Field label="Supplier">
                                    <div className="relative">
                                        <select value={createForm.supplier_id} onChange={e => setCreateForm({...createForm, supplier_id: e.target.value})} required className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all appearance-none" style={inputStyle}>
                                            <option value="">Select supplier</option>
                                            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                        </select>
                                        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                                    </div>
                                </Field>
                                <Field label="Expected Delivery">
                                    <input type="date" value={createForm.expected_delivery} onChange={e => setCreateForm({...createForm, expected_delivery: e.target.value})} className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all" style={inputStyle} />
                                </Field>
                            </div>

                            {/* Order items */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Order Items</label>
                                    <button type="button" onClick={handleAddItem} className="text-xs font-semibold px-3 py-1 rounded-lg transition-colors" style={{ color: 'var(--purple-600,#7C3AED)', background: 'var(--purple-100,#EDE9FE)' }}>
                                        + Add Item
                                    </button>
                                </div>
                                <div className="space-y-2">
                                    {orderItems.map((item, i) => (
                                        <div key={i} className="grid grid-cols-12 gap-2 items-center p-3 rounded-xl" style={{ background: 'var(--bg-page)', border: '1px solid var(--border)' }}>
                                            <div className="col-span-5">
                                                <select value={item.product_id} onChange={e => handleItemChange(i, 'product_id', e.target.value)} required className="w-full px-3 py-2 text-sm rounded-lg border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all appearance-none" style={inputStyle}>
                                                    <option value="">Select product</option>
                                                    {products.map(p => <option key={p.id} value={p.id}>{p.name} (Stock: {p.quantity})</option>)}
                                                </select>
                                            </div>
                                            <div className="col-span-3">
                                                <input type="number" min="1" placeholder="Qty" value={item.quantity_ordered} onChange={e => handleItemChange(i, 'quantity_ordered', e.target.value)} required className="w-full px-3 py-2 text-sm rounded-lg border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all" style={inputStyle} />
                                            </div>
                                            <div className="col-span-3">
                                                <input type="number" min="0" step="0.01" placeholder="Unit cost" value={item.unit_cost} onChange={e => handleItemChange(i, 'unit_cost', e.target.value)} required className="w-full px-3 py-2 text-sm rounded-lg border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all" style={inputStyle} />
                                            </div>
                                            <div className="col-span-1 flex justify-center">
                                                {orderItems.length > 1 && (
                                                    <button type="button" onClick={() => handleRemoveItem(i)} className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"><X className="w-3.5 h-3.5" /></button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="text-right mt-2 text-sm font-semibold" style={{ color: 'var(--purple-600,#7C3AED)' }}>
                                    Total: ${orderItems.reduce((s, i) => s + (parseFloat(i.quantity_ordered || 0) * parseFloat(i.unit_cost || 0)), 0).toFixed(2)}
                                </div>
                            </div>

                            <Field label="Notes (Optional)">
                                <textarea value={createForm.notes} onChange={e => setCreateForm({...createForm, notes: e.target.value})} rows={2} className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all resize-none" style={inputStyle} />
                            </Field>

                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowCreate(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
                                <button type="submit" className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg,#7C3AED,#6D28D9)', boxShadow: '0 4px 14px rgba(124,58,237,0.35)' }}>Create Order</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Receive Stock Modal */}
            {showReceive && receivingOrder && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-lg rounded-3xl p-6 shadow-2xl max-h-[85vh] overflow-y-auto" style={{ background: 'var(--bg-card)' }}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Receive Stock</h3>
                            <button onClick={() => setShowReceive(false)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800" style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                        </div>
                        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                            Confirm quantities received from <strong style={{ color: 'var(--text-primary)' }}>{receivingOrder.supplier_name}</strong>. Inventory will be updated automatically.
                        </p>
                        <div className="space-y-3 mb-4">
                            {receiveItems.map((item, i) => (
                                <div key={i} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'var(--bg-page)', border: '1px solid var(--border)' }}>
                                    <div className="flex-1">
                                        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{item.product_name}</p>
                                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Ordered: {item.quantity_ordered}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Received:</label>
                                        <input
                                            type="number" min="0" max={item.quantity_ordered}
                                            value={item.quantity_received}
                                            onChange={e => {
                                                const updated = [...receiveItems];
                                                updated[i] = { ...updated[i], quantity_received: e.target.value };
                                                setReceiveItems(updated);
                                            }}
                                            className="w-20 px-3 py-1.5 text-sm rounded-lg border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all text-center"
                                            style={inputStyle}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                        <Field label="Notes (Optional)">
                            <textarea value={receiveNotes} onChange={e => setReceiveNotes(e.target.value)} rows={2} className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all resize-none mb-4" style={inputStyle} />
                        </Field>
                        <div className="flex gap-3">
                            <button onClick={() => setShowReceive(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
                            <button onClick={handleReceive} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg,#10B981,#059669)' }}>
                                Confirm & Update Stock
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
