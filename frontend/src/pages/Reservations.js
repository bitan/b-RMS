import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useEntityUpdates } from '../hooks/useEntityUpdates';
import { toast } from 'sonner';
import { ROLES } from '../lib/roles';
import { CalendarRange, Plus, X, Clock, Users, Phone, CheckCircle2, XCircle, Edit2 } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;
const fmtETB = (n) => `${Number(n || 0).toLocaleString('en-ET', { minimumFractionDigits: 2 })} ETB`;

const STATUS_COLORS = {
    confirmed: 'bg-blue-100 text-blue-700',
    seated:    'bg-emerald-100 text-emerald-700',
    completed: 'bg-gray-100 text-gray-600',
    cancelled: 'bg-red-100 text-red-600',
    'no-show': 'bg-orange-100 text-orange-700',
};

const ReservationCard = ({ res, rooms, servers, onUpdate, canManage }) => {
    const room = rooms.find(r => r.id === res.room_id);
    const assignedServer = servers.find(s => s.id === res.assigned_server_id);
    const statusColor = STATUS_COLORS[res.status] || 'bg-gray-100 text-gray-600';
    const startDt = new Date(res.start_datetime);
    const endDt = new Date(res.end_datetime);

    return (
        <div className="card-soft p-4 space-y-3">
            <div className="flex items-start justify-between">
                <div>
                    <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{res.customer_name}</p>
                    <p className="text-xs flex items-center gap-1 mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        <Phone className="w-3 h-3" />{res.phone}
                    </p>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${statusColor}`}>{res.status}</span>
            </div>

            <div className="space-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{room?.name || res.room_id}</p>
                <p className="flex items-center gap-1"><Clock className="w-3 h-3" />
                    {startDt.toLocaleString('en-ET', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} →{' '}
                    {endDt.toLocaleString('en-ET', { hour: '2-digit', minute: '2-digit' })}
                </p>
                <p className="flex items-center gap-1"><Users className="w-3 h-3" />{res.party_size} guests</p>
                <p>
                    Deposit: {res.deposit_amount > 0 ? `${Number(res.deposit_amount).toLocaleString('en-ET')} ETB` : 'None'}
                    {res.deposit_amount > 0 && (
                        <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${res.deposit_paid ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                            {res.deposit_paid ? '✓ Paid' : '— Pending'}
                        </span>
                    )}
                </p>
                {res.minimum_spend_agreed > 0 && <p>Min spend: {Number(res.minimum_spend_agreed).toLocaleString('en-ET')} ETB</p>}
                {assignedServer && <p>Server: {assignedServer.name}</p>}
                {res.notes && <p className="italic">"{res.notes}"</p>}
            </div>

            {canManage && res.status === 'confirmed' && (
                <div className="flex gap-2 pt-1 border-t" style={{ borderColor: 'var(--border-light)' }}>
                    <button onClick={() => onUpdate(res.id, 'seated')}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl text-xs font-semibold text-white transition-all"
                        style={{ background: 'linear-gradient(135deg,#10B981,#059669)' }}>
                        <CheckCircle2 className="w-3 h-3" />Seat
                    </button>
                    <button onClick={() => onUpdate(res.id, 'no-show')}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl text-xs font-semibold text-orange-600 transition-all hover:bg-orange-50"
                        style={{ border: '1px solid #FED7AA' }}>
                        No-show
                    </button>
                    <button onClick={() => onUpdate(res.id, 'cancelled')}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl text-xs font-semibold text-red-600 transition-all hover:bg-red-50"
                        style={{ border: '1px solid #FECACA' }}>
                        <XCircle className="w-3 h-3" />Cancel
                    </button>
                </div>
            )}
            {canManage && res.status === 'seated' && (
                <button onClick={() => onUpdate(res.id, 'completed')}
                    className="w-full py-1.5 rounded-xl text-xs font-semibold text-white transition-all"
                    style={{ background: 'linear-gradient(135deg,#6366F1,#8B5CF6)' }}>
                    Mark Completed
                </button>
            )}
        </div>
    );
};

const ReservationForm = ({ rooms, onSave, onCancel, loading }) => {
    const today = new Date();
    const defaultStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 19, 0);
    const defaultEnd   = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 22, 0);
    const toLocal = (d) => {
        const s = new Date(d - d.getTimezoneOffset() * 60000);
        return s.toISOString().slice(0, 16);
    };

    const [form, setForm] = useState({
        room_id: rooms[0]?.id || '',
        customer_name: '',
        phone: '',
        email: '',
        party_size: 2,
        start_datetime: toLocal(defaultStart),
        end_datetime: toLocal(defaultEnd),
        notes: '',
        deposit_amount: '',
        deposit_paid: false,
        deposit_method: 'cash',
        minimum_spend_agreed: 0,
        special_requests: [],
    });

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!form.room_id) { toast.error('Select a room'); return; }
        if (!form.customer_name.trim()) { toast.error('Customer name is required'); return; }
        if (!form.phone.trim()) { toast.error('Phone is required'); return; }
        onSave({
            ...form,
            party_size: parseInt(form.party_size),
            deposit_amount: form.deposit_amount ? parseFloat(form.deposit_amount) : null,
            minimum_spend_agreed: parseFloat(form.minimum_spend_agreed) || 0,
            start_datetime: new Date(form.start_datetime).toISOString(),
            end_datetime: new Date(form.end_datetime).toISOString(),
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Room *</label>
                    <select value={form.room_id} onChange={e => setForm({ ...form, room_id: e.target.value })} required
                        className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:border-amber-500 transition-all"
                        style={{ background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                        <option value="">Select room…</option>
                        {rooms.map(r => <option key={r.id} value={r.id}>{r.name} ({r.occupancy_status})</option>)}
                    </select>
                </div>
                {[
                    { key: 'customer_name', label: 'Customer Name *', type: 'text', placeholder: 'Full name', required: true },
                    { key: 'phone', label: 'Phone *', type: 'tel', placeholder: '+251...', required: true },
                    { key: 'email', label: 'Email', type: 'email', placeholder: 'Optional' },
                    { key: 'party_size', label: 'Party Size', type: 'number', min: 1 },
                    { key: 'start_datetime', label: 'Start Time *', type: 'datetime-local', required: true },
                    { key: 'end_datetime', label: 'End Time *', type: 'datetime-local', required: true },
                    { key: 'deposit_amount', label: 'Deposit (ETB)', type: 'number', min: 0, step: '0.01' },
                    { key: 'minimum_spend_agreed', label: 'Agreed Min Spend (ETB)', type: 'number', min: 0, step: '0.01' },
                ].map(f => (
                    <div key={f.key}>
                        <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{f.label}</label>
                        <input type={f.type} value={form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                            placeholder={f.placeholder} required={f.required} min={f.min} step={f.step}
                            className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
                            style={{ background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                    </div>
                ))}
                <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Notes / Special Requests</label>
                    <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
                        placeholder="Cake at 8pm, balloons, etc."
                        className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all resize-none"
                        style={{ background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                </div>
                <div className="sm:col-span-2 flex items-center gap-2">
                    <input type="checkbox" id="deposit_paid" checked={form.deposit_paid}
                        onChange={e => setForm({ ...form, deposit_paid: e.target.checked })} className="w-4 h-4 rounded" />
                    <label htmlFor="deposit_paid" className="text-sm" style={{ color: 'var(--text-secondary)' }}>Deposit already paid</label>
                </div>
            </div>
            <div className="flex gap-3 pt-2">
                <button type="button" onClick={onCancel}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
                <button type="submit" disabled={loading}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}>
                    {loading ? 'Saving…' : 'Book Room'}
                </button>
            </div>
        </form>
    );
};

export const Reservations = () => {
    const { user } = useAuth();
    const [reservations, setReservations] = useState([]);
    const [rooms, setRooms]               = useState([]);
    const [servers, setServers]           = useState([]);   // for assign server dropdown
    const [loading, setLoading]           = useState(true);
    const [showForm, setShowForm]         = useState(false);
    const [saving, setSaving]             = useState(false);
    const [filterStatus, setFilterStatus] = useState('confirmed');
    const [filterDate, setFilterDate]     = useState(new Date().toISOString().slice(0, 10));

    // Deposit modal
    const [depositRes, setDepositRes]     = useState(null);
    const [depositAmt, setDepositAmt]     = useState('');
    const [depositMethod, setDepositMethod] = useState('cash');
    const [depositLoading, setDepositLoading] = useState(false);

    // Assign server modal
    const [assignRes, setAssignRes]       = useState(null);
    const [assignServerId, setAssignServerId] = useState('');
    const [assignLoading, setAssignLoading] = useState(false);

    const canManage = [ROLES.OWNER, ROLES.MANAGER, ROLES.ROOM_MANAGER].includes(user?.role);

    const fetchData = useCallback(async () => {
        try {
            const params = new URLSearchParams();
            if (filterStatus !== 'all') params.append('status', filterStatus);
            if (filterDate) params.append('date', filterDate);
            const requests = [
                axios.get(`${API}/reservations?${params}`, { withCredentials: true }),
                axios.get(`${API}/rooms`, { withCredentials: true }),
            ];
            // Fetch server list for managers to assign
            if (canManage) requests.push(axios.get(`${API}/employees`, { withCredentials: true }));
            const results = await Promise.allSettled(requests);
            if (results[0].status === 'fulfilled') setReservations(results[0].value.data);
            if (results[1].status === 'fulfilled') setRooms(results[1].value.data);
            if (canManage && results[2]?.status === 'fulfilled') {
                const allStaff = results[2].value.data;
                setServers(allStaff.filter(e => ['server', 'room_manager'].includes(e.role)));
            }
        } catch { toast.error('Failed to load reservations'); }
        finally { setLoading(false); }
    }, [filterStatus, filterDate, canManage]);

    useEffect(() => { fetchData(); }, [fetchData]);
    useEntityUpdates('reservation', () => fetchData(), { debounceMs: 300 });

    const handleUpdate = async (id, status) => {
        try {
            await axios.put(`${API}/reservations/${id}`, { status }, { withCredentials: true });
            toast.success(`Reservation ${status}`);
            fetchData();
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to update'); }
    };

    const handleSave = async (data) => {
        setSaving(true);
        try {
            await axios.post(`${API}/reservations`, data, { withCredentials: true });
            toast.success('Reservation booked');
            setShowForm(false);
            fetchData();
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to save reservation'); }
        finally { setSaving(false); }
    };

    const handleRecordDeposit = async () => {
        if (!depositAmt) { toast.error('Enter deposit amount'); return; }
        setDepositLoading(true);
        try {
            await axios.post(`${API}/reservations/${depositRes.id}/deposit`, {
                deposit_amount: parseFloat(depositAmt),
                deposit_paid: true,
                deposit_method: depositMethod,
            }, { withCredentials: true });
            toast.success('Deposit recorded');
            setDepositRes(null); setDepositAmt('');
            fetchData();
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to record deposit'); }
        finally { setDepositLoading(false); }
    };

    const handleAssignServer = async () => {
        if (!assignServerId) { toast.error('Select a server'); return; }
        setAssignLoading(true);
        try {
            await axios.put(`${API}/reservations/${assignRes.id}`,
                { assigned_server_id: assignServerId }, { withCredentials: true });
            toast.success('Server assigned');
            setAssignRes(null); setAssignServerId('');
            fetchData();
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to assign server'); }
        finally { setAssignLoading(false); }
    };

    return (
        <div className="p-6 lg:p-8 space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Reservations</h1>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{reservations.length} booking{reservations.length !== 1 ? 's' : ''}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
                        className="text-sm px-3 py-2 rounded-xl border outline-none focus:border-amber-500 transition-all"
                        style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                    <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                        className="text-sm px-3 py-2 rounded-xl border outline-none focus:border-amber-500 transition-all"
                        style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                        <option value="all">All Statuses</option>
                        <option value="confirmed">Confirmed</option>
                        <option value="seated">Seated</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                        <option value="no-show">No-show</option>
                    </select>
                    {canManage && (
                        <button onClick={() => setShowForm(true)}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white shadow-lg transition-all hover:-translate-y-0.5"
                            style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}>
                            <Plus className="w-4 h-4" />New Booking
                        </button>
                    )}
                </div>
            </div>

            {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[1,2,3].map(i => <div key={i} className="h-48 rounded-2xl animate-pulse" style={{ background: 'var(--bg-card)' }} />)}
                </div>
            ) : reservations.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 gap-3" style={{ color: 'var(--text-muted)' }}>
                    <CalendarRange className="w-12 h-12 opacity-30" />
                    <p>No reservations for this filter</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {reservations.map(res => (
                        <div key={res.id}>
                            <ReservationCard res={res} rooms={rooms} servers={servers}
                                onUpdate={handleUpdate} canManage={canManage} />
                            {/* Extra action buttons for managers */}
                            {canManage && res.status !== 'cancelled' && res.status !== 'completed' && (
                                <div className="flex gap-2 mt-2">
                                    {/* Deposit not yet paid */}
                                    {res.deposit_amount > 0 && !res.deposit_paid && (
                                        <button onClick={() => { setDepositRes(res); setDepositAmt(String(res.deposit_amount)); }}
                                            className="flex-1 py-1.5 rounded-xl text-xs font-semibold text-white transition-all"
                                            style={{ background: 'linear-gradient(135deg,#10B981,#059669)' }}>
                                            💵 Record Deposit
                                        </button>
                                    )}
                                    {/* Assign server */}
                                    <button onClick={() => { setAssignRes(res); setAssignServerId(res.assigned_server_id || ''); }}
                                        className="flex-1 py-1.5 rounded-xl text-xs font-semibold border transition-all hover:bg-amber-50"
                                        style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                                        👤 {res.assigned_server_id ? 'Change Server' : 'Assign Server'}
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {showForm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-lg rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto" style={{ background: 'var(--bg-card)' }}>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>New Reservation</h3>
                            <button onClick={() => setShowForm(false)}
                                className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" style={{ color: 'var(--text-muted)' }}>
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <ReservationForm rooms={rooms} onSave={handleSave} onCancel={() => setShowForm(false)} loading={saving} />
                    </div>
                </div>
            )}

            {/* ── Deposit Modal ── */}
            {depositRes && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-sm rounded-3xl p-6 shadow-2xl" style={{ background: 'var(--bg-card)' }}>
                        <div className="flex items-center justify-between mb-5">
                            <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>Record Deposit</h3>
                            <button onClick={() => setDepositRes(null)} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                        </div>
                        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                            Customer: <strong style={{ color: 'var(--text-primary)' }}>{depositRes.customer_name}</strong>
                        </p>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Amount (ETB)</label>
                                <input type="number" min="0" step="0.01" value={depositAmt}
                                    onChange={e => setDepositAmt(e.target.value)} autoFocus
                                    className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
                                    style={{ background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Payment Method</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {['cash','card','telebirr'].map(m => (
                                        <button key={m} onClick={() => setDepositMethod(m)}
                                            className="py-2 rounded-xl text-xs font-semibold capitalize transition-all"
                                            style={depositMethod === m
                                                ? { background: 'linear-gradient(135deg,#F59E0B,#D97706)', color: 'white' }
                                                : { background: 'var(--bg-page)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                                            {m}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button onClick={() => setDepositRes(null)}
                                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold border"
                                    style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
                                <button onClick={handleRecordDeposit} disabled={depositLoading || !depositAmt}
                                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                                    style={{ background: 'linear-gradient(135deg,#10B981,#059669)' }}>
                                    {depositLoading ? 'Saving…' : 'Confirm Deposit'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Assign Server Modal ── */}
            {assignRes && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-sm rounded-3xl p-6 shadow-2xl" style={{ background: 'var(--bg-card)' }}>
                        <div className="flex items-center justify-between mb-5">
                            <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>Assign Server</h3>
                            <button onClick={() => setAssignRes(null)} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                        </div>
                        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                            Room: <strong style={{ color: 'var(--text-primary)' }}>{rooms.find(r => r.id === assignRes.room_id)?.name}</strong> · {assignRes.customer_name}
                        </p>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Select Server</label>
                                <select value={assignServerId} onChange={e => setAssignServerId(e.target.value)}
                                    className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:border-amber-500 transition-all"
                                    style={{ background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                                    <option value="">— Unassigned —</option>
                                    {servers.map(s => (
                                        <option key={s.id} value={s.id}>{s.name} ({s.role})</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button onClick={() => setAssignRes(null)}
                                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold border"
                                    style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
                                <button onClick={handleAssignServer} disabled={assignLoading}
                                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                                    style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}>
                                    {assignLoading ? 'Saving…' : 'Assign'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
