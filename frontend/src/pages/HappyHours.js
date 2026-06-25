import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Plus, Edit2, Trash2, X, Clock, Percent } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;
const inputCls = "w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all";
const inputStyle = { background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' };

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const CATEGORIES = ['Food','Drinks','Cocktails','Beer & Wine','Appetizers','Main Course','Desserts','Soft Drinks'];

const initial = { name: '', start_time: '17:00', end_time: '19:00', days_of_week: [1,2,3,4,5], discount_percent: 20, applicable_categories: [], is_active: true };

export const HappyHours = () => {
    const [hours, setHours] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const [form, setForm] = useState(initial);
    const [saving, setSaving] = useState(false);

    const fetch = useCallback(async () => {
        try {
            const res = await axios.get(`${API}/happy-hours`, { withCredentials: true });
            setHours(res.data);
        } catch { toast.error('Failed to load happy hours'); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetch(); }, [fetch]);

    const openNew = () => { setEditItem(null); setForm(initial); setShowForm(true); };
    const openEdit = (item) => { setEditItem(item); setForm({ ...item }); setShowForm(true); };

    const toggleDay = (d) => setForm(f => ({
        ...f, days_of_week: f.days_of_week.includes(d)
            ? f.days_of_week.filter(x => x !== d)
            : [...f.days_of_week, d].sort()
    }));

    const toggleCat = (c) => setForm(f => ({
        ...f, applicable_categories: f.applicable_categories.includes(c)
            ? f.applicable_categories.filter(x => x !== c)
            : [...f.applicable_categories, c]
    }));

    const handleSave = async (e) => {
        e.preventDefault();
        if (!form.name.trim()) { toast.error('Name is required'); return; }
        if (form.days_of_week.length === 0) { toast.error('Select at least one day'); return; }
        setSaving(true);
        try {
            const payload = { ...form, discount_percent: parseFloat(form.discount_percent) };
            if (editItem) {
                await axios.put(`${API}/happy-hours/${editItem.id}`, payload, { withCredentials: true });
                toast.success('Happy hour updated');
            } else {
                await axios.post(`${API}/happy-hours`, payload, { withCredentials: true });
                toast.success('Happy hour created');
            }
            setShowForm(false); fetch();
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to save'); }
        finally { setSaving(false); }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Delete this happy hour?')) return;
        try {
            await axios.delete(`${API}/happy-hours/${id}`, { withCredentials: true });
            toast.success('Deleted'); fetch();
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to delete'); }
    };

    const handleToggle = async (item) => {
        try {
            await axios.put(`${API}/happy-hours/${item.id}`, { ...item, is_active: !item.is_active }, { withCredentials: true });
            fetch();
        } catch { toast.error('Failed to toggle'); }
    };

    return (
        <div className="p-6 lg:p-8 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Happy Hours</h1>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {hours.filter(h => h.is_active).length} active schedules — discounts apply automatically in POS
                    </p>
                </div>
                <button onClick={openNew} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white shadow-lg hover:-translate-y-0.5 transition-all" style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}>
                    <Plus className="w-4 h-4" />Add Schedule
                </button>
            </div>

            {loading ? (
                <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 rounded-2xl animate-pulse" style={{ background: 'var(--bg-card)' }} />)}</div>
            ) : hours.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 gap-3" style={{ color: 'var(--text-muted)' }}>
                    <Clock className="w-12 h-12 opacity-30" />
                    <p>No happy hour schedules yet</p>
                    <p className="text-xs opacity-60">Create one to automatically apply discounts during specific hours</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {hours.map(h => (
                        <div key={h.id} className={`card-soft p-5 flex items-start justify-between gap-4 transition-all ${!h.is_active ? 'opacity-50' : ''}`}>
                            <div className="flex-1">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}>
                                        <Percent className="w-4 h-4 text-white" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{h.name}</p>
                                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                            {h.start_time} – {h.end_time} · {h.discount_percent}% off
                                        </p>
                                    </div>
                                    <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${h.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                                        {h.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    {DAYS.map((d, i) => (
                                        <span key={d} className={`text-xs px-2 py-0.5 rounded-full font-medium ${(h.days_of_week || []).includes(i+1) ? 'bg-amber-100 text-amber-700' : ''}`}
                                            style={(h.days_of_week || []).includes(i+1) ? {} : { background: 'var(--bg-page)', color: 'var(--text-muted)' }}>
                                            {d}
                                        </span>
                                    ))}
                                </div>
                                {h.applicable_categories?.length > 0 && (
                                    <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
                                        Categories: {h.applicable_categories.join(', ')}
                                    </p>
                                )}
                                {(!h.applicable_categories || h.applicable_categories.length === 0) && (
                                    <p className="text-xs mt-1.5 text-amber-600">Applies to all categories</p>
                                )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                                <button onClick={() => handleToggle(h)}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${h.is_active ? 'text-red-500 hover:bg-red-50' : 'text-emerald-600 hover:bg-emerald-50'}`}
                                    style={{ borderColor: 'var(--border)' }}>
                                    {h.is_active ? 'Deactivate' : 'Activate'}
                                </button>
                                <button onClick={() => openEdit(h)} className="p-1.5 rounded-xl hover:bg-blue-50 text-blue-500 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                                <button onClick={() => handleDelete(h.id)} className="p-1.5 rounded-xl hover:bg-red-50 text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {showForm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-lg rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto" style={{ background: 'var(--bg-card)' }}>
                        <div className="flex items-center justify-between mb-5">
                            <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>{editItem ? 'Edit Happy Hour' : 'New Happy Hour'}</h3>
                            <button onClick={() => setShowForm(false)} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                        </div>
                        <form onSubmit={handleSave} className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold mb-1 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Name *</label>
                                <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} required placeholder="e.g. Evening Happy Hour" className={inputCls} style={inputStyle} />
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold mb-1 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Start Time</label>
                                    <input type="time" value={form.start_time} onChange={e => setForm(f => ({...f, start_time: e.target.value}))} className={inputCls} style={inputStyle} />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold mb-1 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>End Time</label>
                                    <input type="time" value={form.end_time} onChange={e => setForm(f => ({...f, end_time: e.target.value}))} className={inputCls} style={inputStyle} />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold mb-1 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Discount %</label>
                                    <input type="number" min="1" max="100" value={form.discount_percent} onChange={e => setForm(f => ({...f, discount_percent: e.target.value}))} className={inputCls} style={inputStyle} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Days of Week</label>
                                <div className="flex gap-2 flex-wrap">
                                    {DAYS.map((d, i) => (
                                        <button key={d} type="button" onClick={() => toggleDay(i+1)}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${form.days_of_week.includes(i+1) ? 'text-white border-amber-500' : ''}`}
                                            style={form.days_of_week.includes(i+1) ? { background:'linear-gradient(135deg,#F59E0B,#D97706)' } : { background:'var(--bg-page)', color:'var(--text-secondary)', borderColor:'var(--border)' }}>
                                            {d}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                                    Applicable Categories <span className="normal-case font-normal">(leave empty = all categories)</span>
                                </label>
                                <div className="flex gap-2 flex-wrap">
                                    {CATEGORIES.map(c => (
                                        <button key={c} type="button" onClick={() => toggleCat(c)}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${form.applicable_categories.includes(c) ? 'text-white border-amber-500' : ''}`}
                                            style={form.applicable_categories.includes(c) ? { background:'linear-gradient(135deg,#F59E0B,#D97706)' } : { background:'var(--bg-page)', color:'var(--text-secondary)', borderColor:'var(--border)' }}>
                                            {c}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({...f, is_active: e.target.checked}))} className="w-4 h-4 rounded accent-amber-500" />
                                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Active (applies discounts in POS)</span>
                            </label>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border" style={{ borderColor:'var(--border)', color:'var(--text-secondary)' }}>Cancel</button>
                                <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50" style={{ background:'linear-gradient(135deg,#F59E0B,#D97706)' }}>
                                    {saving ? 'Saving…' : editItem ? 'Update' : 'Create'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
