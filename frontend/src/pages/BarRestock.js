import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { RefreshCw, CheckCircle2, History, Package, AlertTriangle, X } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;
const fmtETB = (n) => `${Number(n || 0).toLocaleString('en-ET', { minimumFractionDigits: 2 })} ETB`;

export const BarRestock = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [confirming, setConfirming] = useState(false);
    const [notes, setNotes] = useState('');
    const [activeTab, setActiveTab] = useState('today'); // today | history
    const [history, setHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [showHistory, setShowHistory] = useState(null); // selected history item

    // Allow manager to adjust qty before confirming
    const [adjustments, setAdjustments] = useState({});

    const fetchRestock = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${API}/bar-restock`, { withCredentials: true });
            setData(res.data);
            // Init adjustments to qty_needed for each item
            const adj = {};
            (res.data.items || []).forEach(item => {
                adj[item.ingredient_id] = item.qty_needed;
            });
            setAdjustments(adj);
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to load restock data'); }
        finally { setLoading(false); }
    }, []);

    const fetchHistory = useCallback(async () => {
        setHistoryLoading(true);
        try {
            const res = await axios.get(`${API}/bar-restock/history`, { withCredentials: true });
            setHistory(res.data);
        } catch { toast.error('Failed to load history'); }
        finally { setHistoryLoading(false); }
    }, []);

    useEffect(() => { fetchRestock(); }, [fetchRestock]);
    useEffect(() => { if (activeTab === 'history') fetchHistory(); }, [activeTab, fetchHistory]);

    const totalCost = data?.items?.reduce((s, item) => {
        const qty = parseFloat(adjustments[item.ingredient_id] || 0);
        return s + qty * item.cost_per_unit;
    }, 0) || 0;

    const handleConfirm = async () => {
        const itemsToRestock = (data?.items || [])
            .map(item => ({
                ingredient_id: item.ingredient_id,
                qty_restocked: parseFloat(adjustments[item.ingredient_id] || 0),
            }))
            .filter(i => i.qty_restocked > 0);

        if (itemsToRestock.length === 0) {
            toast.error('No items to restock — all quantities are 0');
            return;
        }

        setConfirming(true);
        try {
            await axios.post(`${API}/bar-restock/confirm`, {
                items: itemsToRestock,
                notes: notes || null,
            }, { withCredentials: true });
            toast.success(`Bar restocked! Total: ${fmtETB(totalCost)}`);
            setNotes('');
            fetchRestock();
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to confirm restock'); }
        finally { setConfirming(false); }
    };

    return (
        <div className="p-6 lg:p-8 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Bar Restock</h1>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        Daily refill sheet — bring stock back to par level
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {/* Tab switcher */}
                    <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                        {[['today',"📋 Today's Sheet"],['history','🕐 History']].map(([tab, label]) => (
                            <button key={tab} onClick={() => setActiveTab(tab)}
                                className={`px-3 py-2 text-xs font-semibold transition-all ${activeTab===tab ? 'text-white' : ''}`}
                                style={activeTab===tab ? { background:'linear-gradient(135deg,#F59E0B,#D97706)' } : { background:'var(--bg-card)', color:'var(--text-secondary)' }}>
                                {label}
                            </button>
                        ))}
                    </div>
                    <button onClick={fetchRestock} className="p-2 rounded-xl border transition-all hover:bg-amber-50" style={{ borderColor:'var(--border)', color:'var(--text-muted)' }}>
                        <RefreshCw className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* ── TODAY'S RESTOCK SHEET ── */}
            {activeTab === 'today' && (
                <>
                {loading ? (
                    <div className="space-y-3">{[1,2,3,4].map(i => <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ background:'var(--bg-card)' }} />)}</div>
                ) : !data || data.items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-3" style={{ color:'var(--text-muted)' }}>
                        <Package className="w-12 h-12 opacity-30" />
                        <p>No bar items configured</p>
                        <p className="text-xs opacity-60">Set a Par Level on ingredients in the Inventory page to appear here</p>
                    </div>
                ) : (
                    <>
                    {/* Already confirmed banner */}
                    {data.already_confirmed && (
                        <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background:'rgba(16,185,129,0.08)', border:'1px solid rgba(16,185,129,0.2)' }}>
                            <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                            <div>
                                <p className="font-semibold text-sm text-emerald-700">Already restocked today ({data.restock_date})</p>
                                <p className="text-xs text-emerald-600">Total settled: {fmtETB(data.previous_confirmation?.total_cost || 0)} · Confirmed by {data.previous_confirmation?.confirmed_by_name}</p>
                            </div>
                        </div>
                    )}

                    {/* Date */}
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold" style={{ color:'var(--text-muted)' }}>
                            📅 Restock Date: <span style={{ color:'var(--text-primary)' }}>{data.restock_date}</span>
                        </p>
                        <p className="text-sm font-bold text-amber-600">
                            Total Refill Cost: {fmtETB(totalCost)}
                        </p>
                    </div>

                    {/* Restock table */}
                    <div className="card-soft overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Item</th>
                                        <th className="text-right">Par Level</th>
                                        <th className="text-right">Current Stock</th>
                                        <th className="text-right">Sold Today</th>
                                        <th className="text-right">Qty to Refill</th>
                                        <th className="text-right">Unit Cost</th>
                                        <th className="text-right">Line Cost</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.items.map(item => {
                                        const qty = parseFloat(adjustments[item.ingredient_id] || 0);
                                        const lineCost = qty * item.cost_per_unit;
                                        const needsRestock = item.qty_needed > 0;
                                        return (
                                            <tr key={item.ingredient_id} className={needsRestock ? '' : 'opacity-50'}>
                                                <td>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-semibold text-sm" style={{ color:'var(--text-primary)' }}>{item.name}</span>
                                                        {needsRestock && <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">needs refill</span>}
                                                    </div>
                                                    <p className="text-xs" style={{ color:'var(--text-muted)' }}>{item.unit}</p>
                                                </td>
                                                <td className="text-right font-medium" style={{ color:'var(--text-secondary)' }}>{item.par_level}</td>
                                                <td className="text-right">
                                                    <span className={`font-semibold ${item.current_stock < item.par_level ? 'text-amber-600' : 'text-emerald-600'}`}>
                                                        {item.current_stock}
                                                    </span>
                                                </td>
                                                <td className="text-right text-red-500 font-medium">{item.qty_sold_today > 0 ? `-${item.qty_sold_today}` : '—'}</td>
                                                <td className="text-right">
                                                    <input
                                                        type="number" min="0" step="0.5"
                                                        value={adjustments[item.ingredient_id] ?? item.qty_needed}
                                                        onChange={e => setAdjustments(a => ({ ...a, [item.ingredient_id]: e.target.value }))}
                                                        className="w-20 px-2 py-1 text-sm rounded-lg border outline-none focus:border-amber-500 text-right font-bold"
                                                        style={{ background:'var(--bg-page)', borderColor:'var(--border)', color: qty > 0 ? '#D97706' : 'var(--text-muted)' }}
                                                    />
                                                </td>
                                                <td className="text-right text-xs" style={{ color:'var(--text-muted)' }}>{fmtETB(item.cost_per_unit)}</td>
                                                <td className="text-right font-bold text-amber-600">{fmtETB(lineCost)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot>
                                    <tr>
                                        <td colSpan={6} className="text-right font-bold py-3 pr-4" style={{ color:'var(--text-primary)' }}>TOTAL SETTLEMENT</td>
                                        <td className="text-right font-bold text-lg text-amber-600 py-3">{fmtETB(totalCost)}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>

                    {/* Notes + Confirm */}
                    <div className="card-soft p-5 space-y-4">
                        <div>
                            <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color:'var(--text-muted)' }}>Notes (Optional)</label>
                            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Short delivery — 3 items missing"
                                className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:border-amber-500"
                                style={{ background:'var(--bg-page)', borderColor:'var(--border)', color:'var(--text-primary)' }} />
                        </div>
                        <button onClick={handleConfirm} disabled={confirming || data.already_confirmed}
                            className="w-full py-3.5 rounded-2xl text-sm font-bold text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                            style={{ background:'linear-gradient(135deg,#10B981,#059669)', boxShadow:'0 6px 20px rgba(16,185,129,0.3)' }}>
                            <CheckCircle2 className="w-4 h-4" />
                            {confirming ? 'Confirming restock…' : data.already_confirmed ? '✓ Already confirmed today' : `Confirm Restock · ${fmtETB(totalCost)}`}
                        </button>
                        {data.already_confirmed && (
                            <p className="text-xs text-center" style={{ color:'var(--text-muted)' }}>
                                You can still confirm again if a second delivery was made today
                            </p>
                        )}
                    </div>
                    </>
                )}
                </>
            )}

            {/* ── HISTORY TAB ── */}
            {activeTab === 'history' && (
                <div className="space-y-3">
                    {historyLoading ? (
                        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-20 rounded-2xl animate-pulse" style={{ background:'var(--bg-card)' }} />)}</div>
                    ) : history.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-48 gap-3" style={{ color:'var(--text-muted)' }}>
                            <History className="w-10 h-10 opacity-30" />
                            <p>No restock history yet</p>
                        </div>
                    ) : (
                        history.map(log => (
                            <div key={log.id} className="card-soft p-5 cursor-pointer hover:shadow-md transition-shadow" onClick={() => setShowHistory(showHistory?.id === log.id ? null : log)}>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="font-bold text-sm" style={{ color:'var(--text-primary)' }}>📅 {log.restock_date}</p>
                                        <p className="text-xs mt-0.5" style={{ color:'var(--text-muted)' }}>
                                            {(log.items || []).length} items · Confirmed by {log.confirmed_by_name} · {new Date(log.created_at).toLocaleTimeString('en-ET')}
                                        </p>
                                        {log.notes && <p className="text-xs mt-0.5 italic" style={{ color:'var(--text-muted)' }}>{log.notes}</p>}
                                    </div>
                                    <p className="font-bold text-lg text-emerald-600">{fmtETB(log.total_cost)}</p>
                                </div>
                                {/* Expanded items */}
                                {showHistory?.id === log.id && (
                                    <div className="mt-4 pt-4 border-t space-y-1.5" style={{ borderColor:'var(--border-light)' }}>
                                        {(log.items || []).map((item, i) => (
                                            <div key={i} className="flex items-center justify-between text-sm">
                                                <span style={{ color:'var(--text-secondary)' }}>{item.name} ({item.unit})</span>
                                                <div className="flex items-center gap-6 text-xs">
                                                    <span style={{ color:'var(--text-muted)' }}>Refilled: <strong>{item.qty_restocked}</strong></span>
                                                    <span style={{ color:'var(--text-muted)' }}>Stock: {item.stock_before} → {item.stock_after}</span>
                                                    <span className="font-semibold text-amber-600">{fmtETB(item.line_cost)}</span>
                                                </div>
                                            </div>
                                        ))}
                                        <div className="flex justify-end pt-2 border-t" style={{ borderColor:'var(--border-light)' }}>
                                            <p className="font-bold text-sm" style={{ color:'var(--text-primary)' }}>Total: {fmtETB(log.total_cost)}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};
