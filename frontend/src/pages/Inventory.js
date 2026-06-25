import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Search, Plus, Edit2, Trash2, AlertTriangle, Package, X, ChevronDown, FlaskConical } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;

const UNITS = ['kg', 'g', 'liter', 'ml', 'oz', 'piece', 'portion', 'bottle', 'can'];
const inputStyle = { background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' };

const Field = ({ label, children }) => (
    <div>
        <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</label>
        {children}
    </div>
);

const initialIngredient = { name: '', unit: 'liter', cost_per_unit: '', current_stock: '', min_stock_level: '' };

export const Inventory = () => {
    const [ingredients, setIngredients] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [formData, setFormData] = useState(initialIngredient);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [itemToDelete, setItemToDelete] = useState(null);
    const [adjustItem, setAdjustItem] = useState(null);
    const [adjustQty, setAdjustQty] = useState('');
    const [adjustLoading, setAdjustLoading] = useState(false);
    // Deduction log tab
    const [activeTab, setActiveTab] = useState('ingredients');
    const [deductions, setDeductions] = useState([]);
    const [deductLoading, setDeductLoading] = useState(false);

    const fetchData = useCallback(async () => {
        try {
            const res = await axios.get(`${API}/ingredients`, { withCredentials: true });
            setIngredients(res.data);
        } catch { toast.error('Failed to load ingredients'); }
        finally { setLoading(false); }
    }, []);

    const fetchDeductions = useCallback(async () => {
        setDeductLoading(true);
        try {
            const res = await axios.get(`${API}/inventory-deductions?limit=100`, { withCredentials: true });
            setDeductions(res.data);
        } catch { toast.error('Failed to load deduction log'); }
        finally { setDeductLoading(false); }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);
    useEffect(() => { if (activeTab === 'deductions') fetchDeductions(); }, [activeTab, fetchDeductions]);

    const filtered = ingredients.filter(i =>
        i.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const lowStock = ingredients.filter(i => i.current_stock <= i.min_stock_level && i.min_stock_level > 0);

    const handleSave = async (e) => {
        e.preventDefault();
        const payload = {
            ...formData,
            cost_per_unit: parseFloat(formData.cost_per_unit) || 0,
            current_stock: parseFloat(formData.current_stock) || 0,
            min_stock_level: parseFloat(formData.min_stock_level) || 0,
        };
        try {
            if (editingItem) {
                await axios.put(`${API}/ingredients/${editingItem.id}`, payload, { withCredentials: true });
                toast.success('Ingredient updated');
            } else {
                await axios.post(`${API}/ingredients`, payload, { withCredentials: true });
                toast.success('Ingredient added');
            }
            setShowModal(false);
            setEditingItem(null);
            fetchData();
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to save'); }
    };

    const handleAdjust = async () => {
        const qty = parseFloat(adjustQty);
        if (isNaN(qty)) { toast.error('Enter a valid number'); return; }
        setAdjustLoading(true);
        try {
            await axios.post(`${API}/ingredients/${adjustItem.id}/adjust-stock?quantity=${qty}`, {}, { withCredentials: true });
            toast.success(`Stock adjusted by ${qty > 0 ? '+' : ''}${qty} ${adjustItem.unit}`);
            setAdjustItem(null);
            setAdjustQty('');
            fetchData();
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to adjust'); }
        finally { setAdjustLoading(false); }
    };

    const handleDelete = async () => {
        try {
            await axios.delete(`${API}/ingredients/${itemToDelete.id}`, { withCredentials: true });
            toast.success('Ingredient deleted');
            setShowDeleteDialog(false);
            fetchData();
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to delete'); }
    };

    const stockStatus = (item) => {
        if (item.min_stock_level > 0 && item.current_stock <= item.min_stock_level) return 'low';
        if (item.current_stock <= 0) return 'empty';
        return 'ok';
    };

    return (
        <div className="p-6 lg:p-8 space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Inventory</h1>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {ingredients.length} ingredients · {lowStock.length > 0 ? <span className="text-red-500 font-semibold">{lowStock.length} low stock</span> : 'all stocked'}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {/* Tab switcher */}
                    <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                        {[['ingredients','📦 Stock'],['deductions','📋 Deduction Log']].map(([tab, label]) => (
                            <button key={tab} onClick={() => setActiveTab(tab)}
                                className={`px-3 py-2 text-xs font-semibold transition-all ${activeTab===tab ? 'text-white' : ''}`}
                                style={activeTab===tab ? { background:'linear-gradient(135deg,#F59E0B,#D97706)' } : { background:'var(--bg-card)', color:'var(--text-secondary)' }}>
                                {label}
                            </button>
                        ))}
                    </div>
                {activeTab === 'ingredients' && (
                <button onClick={() => { setEditingItem(null); setFormData(initialIngredient); setShowModal(true); }}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:-translate-y-0.5"
                    style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)', boxShadow: '0 4px 14px rgba(245,158,11,0.35)' }}>
                    <Plus className="w-4 h-4" />Add Ingredient
                </button>
                )}
                </div>
            </div>

            {/* Low stock alert */}
            {lowStock.length > 0 && (
                <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                    <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="font-semibold text-sm text-red-600">Low Stock Alert</p>
                        <p className="text-xs text-red-500 mt-0.5">{lowStock.map(i => `${i.name} (${i.current_stock} ${i.unit})`).join(' · ')}</p>
                    </div>
                </div>
            )}

            {/* ── INGREDIENTS TAB ── */}
            {activeTab === 'ingredients' && (<>
            {/* Search */}
            <div className="relative max-w-sm">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                <input type="text" placeholder="Search ingredients…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
                    style={inputStyle} />
            </div>

            {/* Table */}
            <div className="card-soft overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="data-table">
                        <thead>
                            <tr><th>Ingredient</th><th>Unit</th><th>Current Stock</th><th>Min Level</th><th>Cost/Unit (ETB)</th><th className="text-right">Actions</th></tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={6} className="text-center py-12" style={{ color: 'var(--text-muted)' }}>Loading…</td></tr>
                            ) : filtered.length === 0 ? (
                                <tr><td colSpan={6} className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
                                    <Package className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>No ingredients found</p>
                                </td></tr>
                            ) : filtered.map(item => {
                                const st = stockStatus(item);
                                return (
                                    <tr key={item.id}>
                                        <td>
                                            <div className="flex items-center gap-2">
                                                <FlaskConical className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                                                <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{item.name}</p>
                                            </div>
                                        </td>
                                        <td><span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{item.unit}</span></td>
                                        <td>
                                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                                                st === 'empty' ? 'bg-red-100 text-red-700' :
                                                st === 'low' ? 'bg-amber-100 text-amber-700' :
                                                'bg-emerald-100 text-emerald-700'
                                            }`}>
                                                {st === 'low' && <AlertTriangle className="w-3 h-3" />}
                                                {item.current_stock} {item.unit}
                                            </span>
                                        </td>
                                        <td><span className="text-sm" style={{ color: 'var(--text-muted)' }}>{item.min_stock_level} {item.unit}</span></td>
                                        <td><span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{Number(item.cost_per_unit).toFixed(2)}</span></td>
                                        <td className="text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                <button onClick={() => setAdjustItem(item)}
                                                    className="px-2.5 py-1 rounded-lg text-xs font-semibold hover:bg-blue-50 text-blue-500 transition-colors">±Adjust</button>
                                                <button onClick={() => { setEditingItem(item); setFormData({ name: item.name, unit: item.unit, cost_per_unit: item.cost_per_unit, current_stock: item.current_stock, min_stock_level: item.min_stock_level }); setShowModal(true); }}
                                                    className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                                                <button onClick={() => { setItemToDelete(item); setShowDeleteDialog(true); }}
                                                    className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Add/Edit Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-md rounded-3xl p-6 shadow-2xl" style={{ background: 'var(--bg-card)' }}>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{editingItem ? 'Edit Ingredient' : 'Add Ingredient'}</h3>
                            <button onClick={() => { setShowModal(false); setEditingItem(null); }} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                        </div>
                        <form onSubmit={handleSave} className="space-y-4">
                            <Field label="Ingredient Name *">
                                <input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} required placeholder="e.g. Gin, Tomatoes, Bread"
                                    className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all" style={inputStyle} />
                            </Field>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Unit">
                                    <select value={formData.unit} onChange={e => setFormData({ ...formData, unit: e.target.value })}
                                        className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:border-amber-500 transition-all" style={inputStyle}>
                                        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                                    </select>
                                </Field>
                                <Field label="Cost / Unit (ETB)">
                                    <input type="number" min="0" step="0.01" value={formData.cost_per_unit} onChange={e => setFormData({ ...formData, cost_per_unit: e.target.value })}
                                        className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all" style={inputStyle} />
                                </Field>
                                <Field label="Current Stock">
                                    <input type="number" min="0" step="0.001" value={formData.current_stock} onChange={e => setFormData({ ...formData, current_stock: e.target.value })}
                                        className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all" style={inputStyle} />
                                </Field>
                                <Field label="Min Stock Level">
                                    <input type="number" min="0" step="0.001" value={formData.min_stock_level} onChange={e => setFormData({ ...formData, min_stock_level: e.target.value })}
                                        className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all" style={inputStyle} />
                                </Field>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => { setShowModal(false); setEditingItem(null); }}
                                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold border" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
                                <button type="submit"
                                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white"
                                    style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}>
                                    {editingItem ? 'Update' : 'Add'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Stock Adjust Modal */}
            {adjustItem && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-sm rounded-3xl p-6 shadow-2xl" style={{ background: 'var(--bg-card)' }}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>Adjust — {adjustItem.name}</h3>
                            <button onClick={() => setAdjustItem(null)} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                        </div>
                        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                            Current: <strong style={{ color: 'var(--text-primary)' }}>{adjustItem.current_stock} {adjustItem.unit}</strong>
        — enter a positive number to add, negative to deduct.
                        </p>
                        <div className="flex gap-2">
                            <input type="number" step="0.001" value={adjustQty} onChange={e => setAdjustQty(e.target.value)} placeholder="e.g. +2.5 or -1"
                                className="flex-1 px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all" style={inputStyle} autoFocus />
                            <button onClick={handleAdjust} disabled={adjustLoading}
                                className="px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                                style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}>
                                {adjustLoading ? '…' : 'Apply'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete confirm */}
            {showDeleteDialog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-sm rounded-3xl p-6 shadow-2xl" style={{ background: 'var(--bg-card)' }}>
                        <h3 className="font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Delete "{itemToDelete?.name}"?</h3>
                        <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>This will permanently remove the ingredient and cannot be undone.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setShowDeleteDialog(false)}
                                className="flex-1 py-2.5 rounded-xl text-sm font-semibold border" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
                            <button onClick={handleDelete}
                                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-red-500 hover:bg-red-600 transition-colors">Delete</button>
                        </div>
                    </div>
                </div>
            )}
            </>) /* end ingredients tab */}

            {/* ── DEDUCTION LOG TAB ── */}
            {activeTab === 'deductions' && (
                <div className="space-y-3">
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Stock automatically deducted when orders are paid. Shows last 100 entries.</p>
                    {deductLoading ? (
                        <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: 'var(--bg-card)' }} />)}</div>
                    ) : deductions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-48 gap-3" style={{ color: 'var(--text-muted)' }}>
                            <FlaskConical className="w-10 h-10 opacity-30" />
                            <p>No deductions recorded yet</p>
                            <p className="text-xs opacity-60">Deductions are logged when paid orders use ingredients with recipes</p>
                        </div>
                    ) : (
                        <div className="card-soft overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="data-table">
                                    <thead>
                                        <tr><th>Date</th><th>Menu Item</th><th>Ingredient</th><th className="text-right">Qty</th><th>Unit</th><th>Order</th></tr>
                                    </thead>
                                    <tbody>
                                        {deductions.map(d => (
                                            <tr key={d.id}>
                                                <td className="text-xs" style={{ color:'var(--text-muted)' }}>{d.created_at ? new Date(d.created_at).toLocaleString('en-ET') : '—'}</td>
                                                <td className="font-medium text-sm" style={{ color:'var(--text-primary)' }}>{d.menu_item_name}</td>
                                                <td className="text-sm" style={{ color:'var(--text-secondary)' }}>{d.ingredient_name}</td>
                                                <td className="text-right font-bold text-amber-600">{d.quantity_deducted}</td>
                                                <td className="text-xs" style={{ color:'var(--text-muted)' }}>{d.unit}</td>
                                                <td className="font-mono text-xs" style={{ color:'var(--text-muted)' }}>{d.order_id ? d.order_id.slice(-8).toUpperCase() : '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
