import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { BookOpen, Plus, Edit2, Trash2, X, Search, ChefHat, GlassWater, FlaskConical, Minus } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;
const fmtETB = (n) => `${Number(n || 0).toLocaleString('en-ET', { minimumFractionDigits: 2 })} ETB`;

const CATEGORIES = ['Food', 'Drinks', 'Cocktails', 'Beer & Wine', 'Appetizers', 'Main Course', 'Desserts', 'Soft Drinks'];

const inputCls = "w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all";
const inputStyle = { background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' };

// ── Menu Item Form ────────────────────────────────────────────────────────────
const MenuForm = ({ initial, initialRecipe, onSave, onCancel, loading, ingredients }) => {
    const [form, setForm] = useState(initial || {
        name: '', name_am: '', category: 'Main Course', price: '', cost_price: '',
        description: '', is_alcohol: false, is_available: true, prep_time: 10, route_to: 'kitchen',
    });

    // Recipe lines: [{ ingredient_id, ingredient_name, quantity, unit }]
    const [recipeLines, setRecipeLines] = useState(
        initialRecipe?.ingredients?.map(r => ({
            ingredient_id: r.ingredient_id,
            ingredient_name: r.ingredient_name || '',
            quantity: r.quantity,
            unit: r.unit || '',
        })) || []
    );

    const f = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

    const addLine = () => setRecipeLines(prev => [...prev, { ingredient_id: '', ingredient_name: '', quantity: 1, unit: '' }]);

    const removeLine = (idx) => setRecipeLines(prev => prev.filter((_, i) => i !== idx));

    const updateLine = (idx, field, value) => {
        setRecipeLines(prev => prev.map((l, i) => {
            if (i !== idx) return l;
            if (field === 'ingredient_id') {
                const ing = ingredients.find(x => x.id === value);
                return { ...l, ingredient_id: value, ingredient_name: ing?.name || '', unit: ing?.unit || '' };
            }
            return { ...l, [field]: value };
        }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!form.name.trim()) { toast.error('Name is required'); return; }
        if (!form.price || parseFloat(form.price) <= 0) { toast.error('Price must be greater than 0'); return; }
        // Validate recipe lines
        for (const line of recipeLines) {
            if (!line.ingredient_id) { toast.error('Select an ingredient for each recipe line'); return; }
            if (!line.quantity || parseFloat(line.quantity) <= 0) { toast.error('Quantity must be greater than 0'); return; }
        }
        onSave(
            { ...form, price: parseFloat(form.price), cost_price: parseFloat(form.cost_price) || 0, prep_time: parseInt(form.prep_time) || 10 },
            recipeLines
        );
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            {/* ── Basic Info ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Name (English) *</label>
                    <input value={form.name} onChange={e => f('name', e.target.value)} required placeholder="e.g. St. George Beer"
                        className={inputCls} style={inputStyle} />
                </div>
                <div>
                    <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Name (Amharic)</label>
                    <input value={form.name_am} onChange={e => f('name_am', e.target.value)} placeholder="e.g. ጊዮርጊስ ቢራ"
                        className={inputCls} style={inputStyle} />
                </div>
                <div>
                    <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Category</label>
                    <select value={form.category} onChange={e => f('category', e.target.value)}
                        className={inputCls} style={inputStyle}>
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Route To</label>
                    <select value={form.route_to} onChange={e => f('route_to', e.target.value)}
                        className={inputCls} style={inputStyle}>
                        <option value="kitchen">🍳 Kitchen</option>
                        <option value="bar">🍸 Bar</option>
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Price (ETB) *</label>
                    <input type="number" min="0" step="0.01" value={form.price} onChange={e => f('price', e.target.value)} required
                        className={inputCls} style={inputStyle} />
                </div>
                <div>
                    <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Cost Price (ETB)</label>
                    <input type="number" min="0" step="0.01" value={form.cost_price} onChange={e => f('cost_price', e.target.value)}
                        className={inputCls} style={inputStyle} />
                </div>
                <div>
                    <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Prep Time (min)</label>
                    <input type="number" min="1" value={form.prep_time} onChange={e => f('prep_time', e.target.value)}
                        className={inputCls} style={inputStyle} />
                </div>
                <div>
                    <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Description</label>
                    <input value={form.description} onChange={e => f('description', e.target.value)}
                        className={inputCls} style={inputStyle} />
                </div>
                <div className="sm:col-span-2 flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={form.is_alcohol} onChange={e => f('is_alcohol', e.target.checked)} className="w-4 h-4 rounded" />
                        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>🍺 Contains alcohol</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={form.is_available} onChange={e => f('is_available', e.target.checked)} className="w-4 h-4 rounded" />
                        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Available</span>
                    </label>
                </div>
            </div>

            {/* ── Ingredients / Recipe ── */}
            <div className="rounded-2xl p-4 border" style={{ borderColor: 'var(--border)', background: 'var(--bg-page)' }}>
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <FlaskConical className="w-4 h-4 text-amber-500" />
                        <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Ingredients Used</span>
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.1)', color: '#D97706' }}>
                            Stock deducted on payment
                        </span>
                    </div>
                    <button type="button" onClick={addLine}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-white"
                        style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}>
                        <Plus className="w-3.5 h-3.5" /> Add Ingredient
                    </button>
                </div>

                {recipeLines.length === 0 ? (
                    <p className="text-xs text-center py-3" style={{ color: 'var(--text-muted)' }}>
                        No ingredients added — inventory will not be deducted when this item is sold
                    </p>
                ) : (
                    <div className="space-y-2">
                        {/* Header */}
                        <div className="grid grid-cols-12 gap-2 px-1">
                            <span className="col-span-6 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Ingredient</span>
                            <span className="col-span-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Qty</span>
                            <span className="col-span-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Unit</span>
                        </div>
                        {recipeLines.map((line, idx) => (
                            <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                                <div className="col-span-6">
                                    <select
                                        value={line.ingredient_id}
                                        onChange={e => updateLine(idx, 'ingredient_id', e.target.value)}
                                        className="w-full px-3 py-2 text-sm rounded-xl border outline-none focus:border-amber-500 transition-all"
                                        style={inputStyle}>
                                        <option value="">— Select ingredient —</option>
                                        {ingredients.map(ing => (
                                            <option key={ing.id} value={ing.id}>
                                                {ing.name} ({ing.unit}) — {ing.current_stock} in stock
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="col-span-3">
                                    <input
                                        type="number" min="0.01" step="0.01"
                                        value={line.quantity}
                                        onChange={e => updateLine(idx, 'quantity', e.target.value)}
                                        className="w-full px-3 py-2 text-sm rounded-xl border outline-none focus:border-amber-500 transition-all"
                                        style={inputStyle} />
                                </div>
                                <div className="col-span-2 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                                    {line.unit || '—'}
                                </div>
                                <div className="col-span-1 flex justify-end">
                                    <button type="button" onClick={() => removeLine(idx)}
                                        className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors">
                                        <Minus className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex gap-3 pt-1">
                <button type="button" onClick={onCancel}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
                <button type="submit" disabled={loading}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}>
                    {loading ? 'Saving…' : initial ? 'Update Item' : 'Add Item'}
                </button>
            </div>
        </form>
    );
};

// ── Main Component ────────────────────────────────────────────────────────────
export const MenuItems = () => {
    const [items, setItems] = useState([]);
    const [ingredients, setIngredients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filterCat, setFilterCat] = useState('all');
    const [showForm, setShowForm] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [editingRecipe, setEditingRecipe] = useState(null);
    const [saving, setSaving] = useState(false);

    const fetchItems = useCallback(async () => {
        try {
            const res = await axios.get(`${API}/menu-items`, { withCredentials: true });
            setItems(res.data?.items || res.data || []);
        } catch { toast.error('Failed to load menu'); }
        finally { setLoading(false); }
    }, []);

    const fetchIngredients = useCallback(async () => {
        try {
            const res = await axios.get(`${API}/ingredients`, { withCredentials: true });
            setIngredients(res.data || []);
        } catch { /* ingredients may not be accessible for all roles */ }
    }, []);

    useEffect(() => { fetchItems(); fetchIngredients(); }, [fetchItems, fetchIngredients]);

    const openEdit = async (item) => {
        setEditingItem(item);
        // Load existing recipe for this item
        try {
            const res = await axios.get(`${API}/recipes/${item.id}`, { withCredentials: true });
            setEditingRecipe(res.data);
        } catch {
            setEditingRecipe(null); // no recipe yet — that's fine
        }
        setShowForm(true);
    };

    const handleSave = async (data, recipeLines) => {
        setSaving(true);
        try {
            let savedItem;
            if (editingItem) {
                const res = await axios.put(`${API}/menu-items/${editingItem.id}`, data, { withCredentials: true });
                savedItem = res.data;
                toast.success('Menu item updated');
            } else {
                const res = await axios.post(`${API}/menu-items`, data, { withCredentials: true });
                savedItem = res.data;
                toast.success('Menu item added');
            }
            // Save recipe if ingredients were added
            if (recipeLines.length > 0 && savedItem?.id) {
                const recipePayload = {
                    menu_item_id: savedItem.id,
                    ingredients: recipeLines.map(l => ({
                        ingredient_id: l.ingredient_id,
                        ingredient_name: l.ingredient_name,
                        quantity: parseFloat(l.quantity),
                        unit: l.unit,
                    })),
                    instructions: '',
                    prep_time: data.prep_time || 10,
                };
                try {
                    await axios.post(`${API}/recipes`, recipePayload, { withCredentials: true });
                } catch (recipeErr) {
                    // Recipe endpoint may use PUT if already exists
                    toast.warning('Item saved but recipe could not be updated');
                }
            }
            setShowForm(false); setEditingItem(null); setEditingRecipe(null);
            fetchItems();
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to save'); }
        finally { setSaving(false); }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Delete this menu item?')) return;
        try {
            await axios.delete(`${API}/menu-items/${id}`, { withCredentials: true });
            toast.success('Deleted'); fetchItems();
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to delete'); }
    };

    const handle86 = async (id) => {
        try {
            const res = await axios.post(`${API}/menu-items/${id}/toggle-availability`, {}, { withCredentials: true });
            toast.success(res.data.is_available ? 'Item reactivated' : "Item 86'd (unavailable)");
            fetchItems();
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to update'); }
    };

    const filtered = items.filter(i => {
        const ms = search.toLowerCase();
        return (filterCat === 'all' || i.category === filterCat) &&
            (i.name.toLowerCase().includes(ms) || (i.name_am && i.name_am.includes(ms)));
    });

    const categories = [...new Set(items.map(i => i.category))];

    return (
        <div className="p-6 lg:p-8 space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Menu</h1>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {items.filter(i => i.is_available).length} available · {items.filter(i => !i.is_available).length} 86'd
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
                            className="pl-9 pr-4 py-2 text-sm rounded-xl border outline-none focus:border-amber-500 transition-all"
                            style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                    </div>
                    <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
                        className="text-sm px-3 py-2 rounded-xl border outline-none focus:border-amber-500 transition-all"
                        style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                        <option value="all">All Categories</option>
                        {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button onClick={() => { setEditingItem(null); setEditingRecipe(null); setShowForm(true); }}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white shadow-lg transition-all hover:-translate-y-0.5"
                        style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}>
                        <Plus className="w-4 h-4" />Add Item
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {[1,2,3,4,5,6].map(i => <div key={i} className="h-36 rounded-2xl animate-pulse" style={{ background: 'var(--bg-card)' }} />)}
                </div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 gap-3" style={{ color: 'var(--text-muted)' }}>
                    <BookOpen className="w-12 h-12 opacity-30" />
                    <p>No menu items found</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {filtered.map(item => (
                        <div key={item.id} className={`card-soft p-4 flex flex-col gap-3 ${!item.is_available ? 'opacity-60' : ''}`}>
                            <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        {item.route_to === 'bar' ? <GlassWater className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" /> : <ChefHat className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" />}
                                        <p className="font-bold text-sm truncate" style={{ color: 'var(--text-primary)' }}>{item.name}</p>
                                    </div>
                                    {item.name_am && <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{item.name_am}</p>}
                                </div>
                                {!item.is_available && (
                                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-semibold flex-shrink-0">86'd</span>
                                )}
                            </div>
                            <div className="flex items-center justify-between text-xs">
                                <span className="px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-page)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                                    {item.category}
                                </span>
                                <div className="text-right">
                                    <p className="font-bold text-amber-600">{fmtETB(item.price)}</p>
                                    <p style={{ color: 'var(--text-muted)' }}>{item.prep_time}min · {item.is_alcohol ? '🍺' : '🍽️'}</p>
                                </div>
                            </div>
                            <div className="flex gap-1.5 pt-1 border-t" style={{ borderColor: 'var(--border-light)' }}>
                                <button onClick={() => handle86(item.id)}
                                    className={`flex-1 py-1.5 rounded-xl text-xs font-semibold transition-colors ${item.is_available ? 'hover:bg-red-50 text-red-500' : 'hover:bg-emerald-50 text-emerald-600'}`}>
                                    {item.is_available ? '86 Item' : 'Reactivate'}
                                </button>
                                <button onClick={() => openEdit(item)}
                                    className="p-1.5 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 transition-colors">
                                    <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => handleDelete(item.id)}
                                    className="p-1.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 transition-colors">
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {showForm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-2xl rounded-3xl p-6 shadow-2xl max-h-[92vh] overflow-y-auto" style={{ background: 'var(--bg-card)' }}>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
                                {editingItem ? 'Edit Menu Item' : 'Add Menu Item'}
                            </h3>
                            <button onClick={() => { setShowForm(false); setEditingItem(null); setEditingRecipe(null); }}
                                className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" style={{ color: 'var(--text-muted)' }}>
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <MenuForm
                            initial={editingItem}
                            initialRecipe={editingRecipe}
                            onSave={handleSave}
                            onCancel={() => { setShowForm(false); setEditingItem(null); setEditingRecipe(null); }}
                            loading={saving}
                            ingredients={ingredients}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};
