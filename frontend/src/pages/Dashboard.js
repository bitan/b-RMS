import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import {
    BedDouble, ShoppingCart, Users, AlertTriangle,
    DollarSign, ArrowUpRight, ArrowDownRight, Minus,
    TrendingUp, BarChart3, CalendarRange, UtensilsCrossed,
    CheckCircle2, Clock, Circle, ChefHat,
} from 'lucide-react';
import { useEntityUpdates } from '../hooks/useEntityUpdates';
import { toast } from 'sonner';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { ROLES } from '../lib/roles';

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;

const fmtETB = (n) => `${Number(n || 0).toLocaleString('en-ET', { minimumFractionDigits: 2 })} ETB`;

const ChangeBadge = ({ pct }) => {
    if (pct === null || pct === undefined)
        return <p className="text-xs mt-1 flex items-center gap-1 text-gray-400"><Minus className="w-3 h-3" />No data yesterday</p>;
    const pos = pct >= 0;
    return (
        <p className={`text-xs mt-1 flex items-center gap-1 font-semibold ${pos ? 'text-emerald-600' : 'text-red-500'}`}>
            {pos ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {pos ? '+' : ''}{pct}% vs yesterday
        </p>
    );
};

const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-2xl px-4 py-3 shadow-xl text-sm" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
            <p className="font-semibold mb-1">{label}</p>
            {payload.map((p, i) => (
                <p key={i} style={{ color: p.color }}>
                    {p.name === 'revenue' ? fmtETB(p.value) : p.value} {p.name}
                </p>
            ))}
        </div>
    );
};

const OccupancyBadge = ({ status }) => {
    const map = {
        available: { color: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle2 className="w-3 h-3" />, label: 'Available' },
        occupied:  { color: 'bg-red-100 text-red-700',         icon: <Circle className="w-3 h-3 fill-current" />, label: 'Occupied' },
        reserved:  { color: 'bg-blue-100 text-blue-700',       icon: <CalendarRange className="w-3 h-3" />, label: 'Reserved' },
        dirty:     { color: 'bg-amber-100 text-amber-700',     icon: <Clock className="w-3 h-3" />, label: 'Cleaning' },
    };
    const s = map[status] || map.available;
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${s.color}`}>
            {s.icon}{s.label}
        </span>
    );
};

export const Dashboard = () => {
    const { user } = useAuth();
    const [stats, setStats] = useState(null);
    const [salesData, setSalesData] = useState([]);
    const [floorStatus, setFloorStatus] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchData = useCallback(async () => {
        try {
            const canSeeRooms = [ROLES.OWNER, ROLES.MANAGER, ROLES.ROOM_MANAGER, ROLES.SERVER, ROLES.CASHIER].includes(user?.role);
            const canSeeSales = [ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER].includes(user?.role);

            const requests = [
                axios.get(`${API}/reports/dashboard`, { withCredentials: true }),
            ];
            if (canSeeSales) requests.push(axios.get(`${API}/reports/sales-by-date?days=7`, { withCredentials: true }));
            if (canSeeRooms) requests.push(axios.get(`${API}/reports/floor-status`, { withCredentials: true }));

            const results = await Promise.allSettled(requests);
            if (results[0].status === 'fulfilled') setStats(results[0].value.data);
            if (canSeeSales && results[1]?.status === 'fulfilled') setSalesData(results[1].value.data);
            if (canSeeRooms) {
                const idx = canSeeSales ? 2 : 1;
                if (results[idx]?.status === 'fulfilled') setFloorStatus(results[idx].value.data);
            }
        } catch (error) {
            console.error('Dashboard fetch error:', error);
        } finally {
            setLoading(false);
        }
    }, [user?.role]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Refresh on order or room updates
    useEntityUpdates('order', useCallback((data) => {
        // Only refresh revenue stats when an order is actually PAID
        // Not on 'created' or 'updated' — those don't change revenue
        if (data.action === 'paid') {
            fetchData();
        }
    }, [fetchData]), { debounceMs: 300 });
    useEntityUpdates('room', useCallback(() => fetchData(), [fetchData]), { debounceMs: 300 });

    const canSeeSales  = [ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER].includes(user?.role);
    const canSeeRooms  = [ROLES.OWNER, ROLES.MANAGER, ROLES.ROOM_MANAGER, ROLES.SERVER, ROLES.CASHIER].includes(user?.role);
    const canSeeStaff  = [ROLES.OWNER, ROLES.MANAGER].includes(user?.role);

    // Kitchen and bartender — show their active orders in the station display instead of floor
    const isStationRole = [ROLES.KITCHEN, ROLES.BARTENDER].includes(user?.role);

    const statCards = [
        { title: "Today's Revenue", value: fmtETB(stats?.today_revenue), icon: DollarSign, gradient: 'from-amber-500 to-orange-500', changePct: stats?.revenue_change_pct, roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER] },
        { title: "Today's Orders",  value: stats?.today_orders || 0,     icon: ShoppingCart, gradient: 'from-violet-500 to-purple-600', changePct: stats?.orders_change_pct, roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.SERVER, ROLES.CASHIER, ROLES.BARTENDER, ROLES.KITCHEN] },
        { title: 'Active Orders',   value: stats?.active_orders_count || 0, icon: UtensilsCrossed, gradient: 'from-blue-500 to-indigo-600', roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.SERVER, ROLES.BARTENDER, ROLES.CASHIER, ROLES.KITCHEN] },
        { title: 'Available Rooms', value: stats?.available_rooms ?? '—', icon: BedDouble, gradient: 'from-emerald-500 to-teal-600', roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.ROOM_MANAGER, ROLES.SERVER, ROLES.CASHIER] },
        { title: 'Occupied Rooms',  value: stats?.occupied_rooms ?? '—',  icon: AlertTriangle, gradient: 'from-red-500 to-rose-600', alert: true, roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.ROOM_MANAGER] },
        { title: 'Staff on Duty',   value: stats?.total_employees || 0,  icon: Users, gradient: 'from-pink-500 to-rose-500', roles: [ROLES.OWNER, ROLES.MANAGER] },
    ].filter(c => c.roles.includes(user?.role));

    if (loading) {
        return (
            <div className="p-6 lg:p-8 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="h-32 rounded-2xl animate-pulse" style={{ background: 'var(--bg-card)' }} />
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 lg:p-8 space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                    Hi, {user?.name?.split(' ')[0]} 👋
                </h1>
                <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {new Date().toLocaleDateString('en-ET', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {statCards.map((card, i) => {
                    const Icon = card.icon;
                    return (
                        <div key={i} className="stat-card">
                            <div className="flex items-start justify-between">
                                <div className="flex-1">
                                    <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>{card.title}</p>
                                    <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{card.value}</p>
                                    {'changePct' in card && <ChangeBadge pct={card.changePct} />}
                                </div>
                                <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${card.gradient} flex items-center justify-center shadow-lg flex-shrink-0`}>
                                    <Icon className={`w-5 h-5 text-white ${card.alert ? 'alert-pulse' : ''}`} strokeWidth={2} />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Charts */}
            {canSeeSales && salesData.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="card-soft p-6">
                        <div className="flex items-center gap-2 mb-5">
                            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                                <TrendingUp className="w-4 h-4 text-white" />
                            </div>
                            <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Revenue — Last 7 Days (ETB)</h3>
                        </div>
                        <div className="h-56">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={salesData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
                                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={v => v.slice(5)} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Line type="monotone" dataKey="revenue" stroke="#F59E0B" strokeWidth={2.5} dot={{ fill: '#F59E0B', r: 4, strokeWidth: 0 }} activeDot={{ r: 6 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                    <div className="card-soft p-6">
                        <div className="flex items-center gap-2 mb-5">
                            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                                <BarChart3 className="w-4 h-4 text-white" />
                            </div>
                            <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Daily Orders</h3>
                        </div>
                        <div className="h-56">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={salesData} barSize={28}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
                                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={v => v.slice(5)} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Bar dataKey="orders" fill="#8B5CF6" radius={[8, 8, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>
            )}

            {/* Floor Plan — hidden for kitchen/bartender */}
            {canSeeRooms && !isStationRole && floorStatus.length > 0 && (
                <div className="card-soft overflow-hidden">
                    <div className="flex items-center gap-2 px-6 py-4 border-b" style={{ borderColor: 'var(--border-light)' }}>
                        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                            <BedDouble className="w-4 h-4 text-white" />
                        </div>
                        <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Floor Status</h3>
                        <div className="ml-auto flex items-center gap-3 text-xs">
                            {[['available','emerald'],['occupied','red'],['reserved','blue'],['dirty','amber']].map(([s,c]) => (
                                <span key={s} className="flex items-center gap-1">
                                    <span className={`w-2 h-2 rounded-full bg-${c}-500`} />
                                    <span className="capitalize" style={{ color: 'var(--text-muted)' }}>{s}</span>
                                </span>
                            ))}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 p-6">
                        {floorStatus.map((room) => (
                            <div key={room.id} className="rounded-2xl p-4 border transition-all hover:shadow-md"
                                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-light)' }}>
                                <div className="flex items-start justify-between mb-2">
                                    <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{room.name}</p>
                                    <OccupancyBadge status={room.occupancy_status} />
                                </div>
                                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                                    Capacity: {room.capacity_min}–{room.capacity_max}
                                </p>
                                {room.active_orders_count > 0 && (
                                    <p className="text-xs font-semibold text-amber-600">
                                        {room.active_orders_count} active order{room.active_orders_count !== 1 ? 's' : ''}
                                    </p>
                                )}
                                {room.today_revenue > 0 && (
                                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                                        Today: {fmtETB(room.today_revenue)}
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Station view for Kitchen & Bartender — quick access + active order count */}
            {isStationRole && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="card-soft p-6 flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg ${user?.role === ROLES.KITCHEN ? 'bg-gradient-to-br from-orange-500 to-red-600' : 'bg-gradient-to-br from-blue-500 to-cyan-500'}`}>
                                {user?.role === ROLES.KITCHEN
                                    ? <ChefHat className="w-5 h-5 text-white" />
                                    : <UtensilsCrossed className="w-5 h-5 text-white" />}
                            </div>
                            <div>
                                <p className="font-bold" style={{ color: 'var(--text-primary)' }}>
                                    {user?.role === ROLES.KITCHEN ? 'Kitchen Display' : 'Bar Display'}
                                </p>
                                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                    {stats?.active_orders_count || 0} active orders in queue
                                </p>
                            </div>
                        </div>
                        <a href={user?.role === ROLES.KITCHEN ? '/kitchen' : '/bar'}
                            className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5"
                            style={{ background: user?.role === ROLES.KITCHEN ? 'linear-gradient(135deg,#F97316,#DC2626)' : 'linear-gradient(135deg,#3B82F6,#06B6D4)' }}>
                            Open {user?.role === ROLES.KITCHEN ? 'Kitchen' : 'Bar'} Display →
                        </a>
                    </div>
                    <div className="card-soft p-6 flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg">
                                <Clock className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <p className="font-bold" style={{ color: 'var(--text-primary)' }}>My Shift</p>
                                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                    Go to Shift Report to start/end your shift
                                </p>
                            </div>
                        </div>
                        <a href="/shifts"
                            className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5"
                            style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}>
                            View Shift Report →
                        </a>
                    </div>
                </div>
            )}
        </div>
    );
};
