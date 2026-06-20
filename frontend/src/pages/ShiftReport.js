import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { ROLES } from '../lib/roles';
import {
    Clock, Play, Square, DollarSign, CreditCard,
    Banknote, CheckCircle2, AlertTriangle, X, TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;
const fmtETB = (n) => `${Number(n || 0).toLocaleString('en-ET', { minimumFractionDigits: 2 })} ETB`;

const formatTime = (isoStr) => isoStr ? new Date(isoStr).toLocaleString('en-ET') : '—';
const formatDuration = (start, end) => {
    if (!start) return '—';
    const diff = Math.floor((new Date(end || Date.now()) - new Date(start)) / 1000 / 60);
    return `${Math.floor(diff / 60)}h ${diff % 60}m`;
};

export const ShiftReport = () => {
    const { user } = useAuth();
    const isCashier = user?.role === ROLES.CASHIER;
    const isManager = [ROLES.OWNER, ROLES.MANAGER].includes(user?.role);

    const [currentShift, setCurrentShift]     = useState(null);
    const [shiftHistory, setShiftHistory]     = useState([]);
    const [loading, setLoading]               = useState(true);

    // End shift with reconciliation
    const [showEndFlow, setShowEndFlow]       = useState(false);
    const [actualCash, setActualCash]         = useState('');
    const [reconciliation, setReconciliation] = useState(null); // result after close
    const [ending, setEnding]                 = useState(false);

    const fetchData = useCallback(async () => {
        try {
            const [cur, hist] = await Promise.all([
                axios.get(`${API}/shifts/current`, { withCredentials: true }),
                axios.get(`${API}/shifts/history?limit=20`, { withCredentials: true }),
            ]);
            setCurrentShift(cur.data.status !== 'none' ? cur.data : null);
            setShiftHistory(hist.data);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleStartShift = async () => {
        try {
            const res = await axios.post(`${API}/shifts/start`, {}, { withCredentials: true });
            setCurrentShift(res.data);
            toast.success('Shift started');
            fetchData();
        } catch (e) { toast.error(e.response?.data?.detail || 'Failed to start shift'); }
    };

    // Cashier uses /shifts/close with actual cash count
    // Other roles use /shifts/end (simple)
    const handleEndShift = async () => {
        if (isCashier && actualCash === '') {
            toast.error('Enter actual cash count before closing'); return;
        }
        setEnding(true);
        try {
            let res;
            if (isCashier) {
                res = await axios.post(`${API}/shifts/close`,
                    { actual_cash: parseFloat(actualCash) || 0 }, { withCredentials: true });
                setReconciliation(res.data);
            } else {
                res = await axios.post(`${API}/shifts/end`, {}, { withCredentials: true });
            }
            setCurrentShift(null);
            setShowEndFlow(false);
            toast.success('Shift closed');
            fetchData();
        } catch (e) { toast.error(e.response?.data?.detail || 'Failed to close shift'); }
        finally { setEnding(false); }
    };

    return (
        <div className="p-6 lg:p-8 space-y-6">
            <div>
                <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Shift Management</h1>
                <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Track your work shifts and daily sales</p>
            </div>

            {/* ── Current Shift Card ── */}
            <div className="card-soft p-6">
                <div className="flex items-center gap-2 mb-5">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                        <Clock className="w-4 h-4 text-white" />
                    </div>
                    <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Current Shift</h3>
                </div>

                {currentShift ? (
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">● Active</span>
                            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Started: {formatTime(currentShift.start_time)}</span>
                            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Duration: {formatDuration(currentShift.start_time, null)}</span>
                        </div>
                        <button onClick={() => setShowEndFlow(true)}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:-translate-y-0.5"
                            style={{ background: 'linear-gradient(135deg,#EF4444,#DC2626)', boxShadow: '0 4px 14px rgba(239,68,68,0.25)' }}>
                            <Square className="w-4 h-4" />
                            End Shift & Generate Report
                        </button>
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-4 py-8">
                        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No active shift</p>
                        <button onClick={handleStartShift}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:-translate-y-0.5"
                            style={{ background: 'linear-gradient(135deg,#10B981,#059669)', boxShadow: '0 4px 14px rgba(16,185,129,0.3)' }}>
                            <Play className="w-4 h-4" />Start Shift
                        </button>
                    </div>
                )}
            </div>

            {/* ── Last Reconciliation Result ── */}
            {reconciliation && (
                <div className={`card-soft p-6 border-2 ${reconciliation.discrepancy_flag ? 'border-red-300' : 'border-emerald-300'}`}>
                    <div className="flex items-center gap-2 mb-4">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${reconciliation.discrepancy_flag ? 'bg-red-100' : 'bg-emerald-100'}`}>
                            {reconciliation.discrepancy_flag
                                ? <AlertTriangle className="w-4 h-4 text-red-600" />
                                : <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                        </div>
                        <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                            Shift Reconciliation — {reconciliation.discrepancy_flag ? '⚠️ Discrepancy Found' : '✅ Balanced'}
                        </h3>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {[
                            { label: 'Total Sales',     value: fmtETB(reconciliation.total_sales),     color: 'text-amber-600' },
                            { label: 'Cash Expected',   value: fmtETB(reconciliation.expected_cash),   color: 'text-blue-600' },
                            { label: 'Cash Counted',    value: fmtETB(reconciliation.actual_cash),     color: 'text-violet-600' },
                            { label: 'Discrepancy',     value: fmtETB(reconciliation.discrepancy),     color: reconciliation.discrepancy_flag ? 'text-red-600 font-black' : 'text-emerald-600' },
                        ].map((s, i) => (
                            <div key={i} className="rounded-xl p-3" style={{ background: 'var(--bg-page)' }}>
                                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{s.label}</p>
                                <p className={`text-sm font-bold ${s.color}`}>{s.value}</p>
                            </div>
                        ))}
                    </div>
                    {reconciliation.discrepancy_flag && (
                        <p className="text-xs mt-3 text-red-600 font-semibold">
                            ⚠️ Discrepancy &gt; 5 ETB — manager review required
                        </p>
                    )}
                    <button onClick={() => setReconciliation(null)} className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>Dismiss</button>
                </div>
            )}

            {/* ── Shift History ── */}
            <div className="card-soft overflow-hidden">
                <div className="px-6 py-4 border-b flex items-center gap-2" style={{ borderColor: 'var(--border-light)' }}>
                    <TrendingUp className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Shift History</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="data-table">
                        <thead>
                            <tr><th>Date</th><th>Staff</th><th>Duration</th><th>Transactions</th><th>Cash</th><th>Card</th><th>Total</th><th>Status</th></tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={8} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Loading…</td></tr>
                            ) : shiftHistory.length === 0 ? (
                                <tr><td colSpan={8} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>No shift history</td></tr>
                            ) : shiftHistory.map(shift => (
                                <tr key={shift.id}>
                                    <td className="text-sm" style={{ color: 'var(--text-muted)' }}>{formatTime(shift.start_time)}</td>
                                    <td className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{shift.user_name}</td>
                                    <td className="text-sm" style={{ color: 'var(--text-secondary)' }}>{formatDuration(shift.start_time, shift.end_time)}</td>
                                    <td className="text-center text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{shift.transaction_count}</td>
                                    <td><span className="flex items-center gap-1 text-sm text-emerald-600 font-medium"><Banknote className="w-3 h-3" />{fmtETB(shift.total_cash)}</span></td>
                                    <td><span className="flex items-center gap-1 text-sm text-blue-600 font-medium"><CreditCard className="w-3 h-3" />{fmtETB(shift.total_card)}</span></td>
                                    <td className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{fmtETB(shift.total_sales)}</td>
                                    <td>
                                        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${shift.status === 'open' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                                            {shift.status === 'open' ? 'Active' : 'Closed'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ── End Shift Modal (with cash reconciliation for cashier) ── */}
            {showEndFlow && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-sm rounded-3xl p-6 shadow-2xl" style={{ background: 'var(--bg-card)' }}>
                        <div className="flex items-center justify-between mb-5">
                            <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>End Shift</h3>
                            <button onClick={() => setShowEndFlow(false)} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                        </div>

                        {isCashier ? (
                            /* Cashier: count cash drawer first */
                            <div className="space-y-4">
                                <div className="p-3 rounded-2xl" style={{ background: 'var(--bg-page)', border: '1px solid var(--border-light)' }}>
                                    <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>BEFORE CLOSING</p>
                                    <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                                        Count all cash in your drawer and enter the total below. The system will compare it against expected cash sales.
                                    </p>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                                        Actual Cash in Drawer (ETB)
                                    </label>
                                    <input
                                        type="number" min="0" step="0.01"
                                        value={actualCash}
                                        onChange={e => setActualCash(e.target.value)}
                                        placeholder="e.g. 4500.00"
                                        autoFocus
                                        className="w-full px-4 py-3 text-lg font-bold rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
                                        style={{ background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                                    />
                                </div>
                                <div className="flex gap-3">
                                    <button onClick={() => setShowEndFlow(false)}
                                        className="flex-1 py-2.5 rounded-xl text-sm font-semibold border"
                                        style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                                        Cancel
                                    </button>
                                    <button onClick={handleEndShift} disabled={ending || actualCash === ''}
                                        className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition-all"
                                        style={{ background: 'linear-gradient(135deg,#EF4444,#DC2626)' }}>
                                        {ending ? 'Closing…' : 'Close & Reconcile'}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            /* Non-cashier: simple confirm */
                            <div className="space-y-4">
                                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                                    Are you sure you want to end your shift? This will calculate your shift summary.
                                </p>
                                <div className="flex gap-3">
                                    <button onClick={() => setShowEndFlow(false)}
                                        className="flex-1 py-2.5 rounded-xl text-sm font-semibold border"
                                        style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                                        Cancel
                                    </button>
                                    <button onClick={handleEndShift} disabled={ending}
                                        className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition-all"
                                        style={{ background: 'linear-gradient(135deg,#EF4444,#DC2626)' }}>
                                        {ending ? 'Ending…' : 'End Shift'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
