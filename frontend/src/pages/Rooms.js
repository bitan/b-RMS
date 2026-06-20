import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useEntityUpdates } from '../hooks/useEntityUpdates';
import { toast } from 'sonner';
import { ROLES } from '../lib/roles';
import {
    BedDouble, Plus, Edit2, Trash2, X, CheckCircle2,
    Clock, Circle, CalendarRange, Users, DollarSign, Wifi, Music, Projector,
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;

const STATUS_CONFIG = {
    available: { label: 'Available', color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
    occupied:  { label: 'Occupied',  color: 'bg-red-100 text-red-700',         dot: 'bg-red-500' },
    reserved:  { label: 'Reserved',  color: 'bg-blue-100 text-blue-700',       dot: 'bg-blue-500' },
    dirty:     { label: 'Cleaning',  color: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-500' },
};

const AMENITY_ICONS = {
    karaoke: '🎤', projector: '📽️', sound_system: '🔊', private_bar: '🍸',
    dance_floor: '💃', outdoor: '🌿', garden_view: '🌺', wifi: '📶',
};

const fmtETB = (n) => `${Number(n || 0).toLocaleString('en-ET', { minimumFractionDigits: 2 })} ETB`;

const RoomCard = ({ room, canManage, canCashier, canRoomManager, onStatusChange, onEdit, onDelete }) => {
    const st = STATUS_CONFIG[room.occupancy_status] || STATUS_CONFIG.available;
    // Determine which status options each role sees
    const statusOptions = canManage
        ? [['available','Set Available'],['occupied','Set Occupied'],['reserved','Set Reserved'],['dirty','Set Cleaning']]
        : canCashier
            ? [['available','Set Available'],['occupied','Set Occupied (After Payment)'],['dirty','Set Needs Cleaning']]
            : canRoomManager
                ? [['available','Room is Clean/Ready'],['reserved','Set Reserved'],['dirty','Set Needs Cleaning']]
                : [];
    return (
        <div className="card-soft p-5 flex flex-col gap-3">
            <div className="flex items-start justify-between">
                <div>
                    <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>{room.name}</h3>
                    {room.description && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{room.description}</p>}
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold flex items-center gap-1.5 ${st.color}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}
                </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                    <Users className="w-3.5 h-3.5" /> {room.capacity_min}–{room.capacity_max} guests
                </div>
                {room.minimum_spend > 0 && (
                    <div className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                        <DollarSign className="w-3.5 h-3.5" /> Min: {fmtETB(room.minimum_spend)}
                    </div>
                )}
                {room.hourly_rate > 0 && (
                    <div className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                        <Clock className="w-3.5 h-3.5" /> {fmtETB(room.hourly_rate)}/hr
                    </div>
                )}
            </div>

            {room.amenities?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {room.amenities.map(a => (
                        <span key={a} className="text-xs px-2 py-0.5 rounded-full"
                            style={{ background: 'var(--bg-page)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                            {AMENITY_ICONS[a] || '•'} {a.replace(/_/g, ' ')}
                        </span>
                    ))}
                </div>
            )}

            {(canManage || canCashier || canRoomManager) && statusOptions.length > 0 && (
                <div className="flex gap-2 pt-1 border-t" style={{ borderColor: 'var(--border-light)' }}>
                    <select
                        value={room.occupancy_status}
                        onChange={e => onStatusChange(room.id, e.target.value)}
                        className="flex-1 text-xs px-2 py-1.5 rounded-lg border outline-none focus:border-amber-500 transition-all"
                        style={{ background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                        {statusOptions.map(([val, label]) => (
                            <option key={val} value={val}>{label}</option>
                        ))}
                    </select>
                    {/* Edit/Delete only for full managers */}
                    {canManage && (
                        <>
                            <button onClick={() => onEdit(room)}
                                className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 transition-colors">
                                <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => onDelete(room.id)}
                                className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 transition-colors">
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

const AMENITY_OPTIONS = ['karaoke', 'projector', 'sound_system', 'private_bar', 'dance_floor', 'outdoor', 'garden_view', 'wifi'];

const RoomForm = ({ initial, onSave, onCancel, loading }) => {
    const [form, setForm] = useState(initial || {
        name: '', description: '', capacity_min: 2, capacity_max: 20,
        hourly_rate: '', minimum_spend: 0, amenities: [],
    });

    const toggleAmenity = (a) => setForm(f => ({
        ...f, amenities: f.amenities.includes(a) ? f.amenities.filter(x => x !== a) : [...f.amenities, a],
    }));

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!form.name.trim()) { toast.error('Room name is required'); return; }
        onSave({
            ...form,
            capacity_min: parseInt(form.capacity_min),
            capacity_max: parseInt(form.capacity_max),
            hourly_rate: form.hourly_rate ? parseFloat(form.hourly_rate) : null,
            minimum_spend: parseFloat(form.minimum_spend) || 0,
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Room Name *</label>
                    <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required
                        placeholder="e.g. VIP Lounge A"
                        className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
                        style={{ background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                </div>
                <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Description</label>
                    <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                        placeholder="e.g. Private room with karaoke and sound system"
                        className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
                        style={{ background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                </div>
                {[
                    { key: 'capacity_min', label: 'Min Capacity', type: 'number', min: 1 },
                    { key: 'capacity_max', label: 'Max Capacity', type: 'number', min: 1 },
                    { key: 'minimum_spend', label: 'Minimum Spend (ETB)', type: 'number', min: 0, step: '0.01' },
                    { key: 'hourly_rate', label: 'Hourly Rate (ETB)', type: 'number', min: 0, step: '0.01' },
                ].map(f => (
                    <div key={f.key}>
                        <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{f.label}</label>
                        <input type={f.type} value={form[f.key]} min={f.min} step={f.step || '1'}
                            onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                            className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
                            style={{ background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                    </div>
                ))}
                <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Amenities</label>
                    <div className="flex flex-wrap gap-2">
                        {AMENITY_OPTIONS.map(a => (
                            <button key={a} type="button" onClick={() => toggleAmenity(a)}
                                className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all ${form.amenities.includes(a) ? 'bg-amber-500 border-amber-500 text-white' : 'border-gray-200 dark:border-gray-700'}`}
                                style={!form.amenities.includes(a) ? { color: 'var(--text-secondary)', background: 'var(--bg-page)' } : {}}>
                                {AMENITY_ICONS[a] || ''} {a.replace(/_/g, ' ')}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
            <div className="flex gap-3 pt-2">
                <button type="button" onClick={onCancel}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
                <button type="submit" disabled={loading}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}>
                    {loading ? 'Saving…' : initial ? 'Update Room' : 'Add Room'}
                </button>
            </div>
        </form>
    );
};

export const Rooms = () => {
    const { user } = useAuth();
    const [rooms, setRooms] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingRoom, setEditingRoom] = useState(null);
    const [saving, setSaving] = useState(false);
    const [filterStatus, setFilterStatus] = useState('all');

    const canManage   = [ROLES.OWNER, ROLES.MANAGER].includes(user?.role);
    const canCashier  = user?.role === ROLES.CASHIER;
    const canRoomMgr  = user?.role === ROLES.ROOM_MANAGER;

    const fetchRooms = useCallback(async () => {
        try {
            const res = await axios.get(`${API}/rooms`, { withCredentials: true });
            setRooms(res.data);
        } catch { toast.error('Failed to load rooms'); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchRooms(); }, [fetchRooms]);
    useEntityUpdates('room', () => fetchRooms(), { debounceMs: 300 });

    const handleStatusChange = async (roomId, status) => {
        try {
            await axios.patch(`${API}/rooms/${roomId}/status`, { status }, { withCredentials: true });
            toast.success('Room status updated');
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to update status'); }
    };

    const handleSave = async (data) => {
        setSaving(true);
        try {
            if (editingRoom) {
                await axios.put(`${API}/rooms/${editingRoom.id}`, data, { withCredentials: true });
                toast.success('Room updated');
            } else {
                await axios.post(`${API}/rooms`, data, { withCredentials: true });
                toast.success('Room added');
            }
            setShowForm(false);
            setEditingRoom(null);
            fetchRooms();
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to save room'); }
        finally { setSaving(false); }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Delete this room?')) return;
        try {
            await axios.delete(`${API}/rooms/${id}`, { withCredentials: true });
            toast.success('Room deleted');
            fetchRooms();
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to delete room'); }
    };

    const filteredRooms = filterStatus === 'all' ? rooms : rooms.filter(r => r.occupancy_status === filterStatus);

    return (
        <div className="p-6 lg:p-8 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Rooms</h1>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {rooms.filter(r => r.occupancy_status === 'available').length} available · {rooms.filter(r => r.occupancy_status === 'occupied').length} occupied
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                        className="text-sm px-3 py-2 rounded-xl border outline-none focus:border-amber-500 transition-all"
                        style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                        <option value="all">All Rooms</option>
                        <option value="available">Available</option>
                        <option value="occupied">Occupied</option>
                        <option value="reserved">Reserved</option>
                        <option value="dirty">Cleaning</option>
                    </select>
                    {canManage && (
                        <button onClick={() => { setEditingRoom(null); setShowForm(true); }}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white shadow-lg transition-all hover:-translate-y-0.5"
                            style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}>
                            <Plus className="w-4 h-4" />Add Room
                        </button>
                    )}
                </div>
            </div>

            {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {[1,2,3,4].map(i => <div key={i} className="h-52 rounded-2xl animate-pulse" style={{ background: 'var(--bg-card)' }} />)}
                </div>
            ) : filteredRooms.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 gap-3" style={{ color: 'var(--text-muted)' }}>
                    <BedDouble className="w-12 h-12 opacity-30" />
                    <p>{filterStatus === 'all' ? 'No rooms yet — add one to get started' : `No ${filterStatus} rooms`}</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {filteredRooms.map(room => (
                        <RoomCard key={room.id} room={room}
                            canManage={canManage}
                            canCashier={canCashier}
                            canRoomManager={canRoomMgr}
                            onStatusChange={handleStatusChange}
                            onEdit={r => { setEditingRoom(r); setShowForm(true); }}
                            onDelete={handleDelete} />
                    ))}
                </div>
            )}

            {/* Form modal */}
            {showForm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-lg rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto" style={{ background: 'var(--bg-card)' }}>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
                                {editingRoom ? 'Edit Room' : 'Add Room'}
                            </h3>
                            <button onClick={() => { setShowForm(false); setEditingRoom(null); }}
                                className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" style={{ color: 'var(--text-muted)' }}>
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <RoomForm initial={editingRoom} onSave={handleSave} onCancel={() => { setShowForm(false); setEditingRoom(null); }} loading={saving} />
                    </div>
                </div>
            )}
        </div>
    );
};
