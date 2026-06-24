import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
    TrendingUp, ShoppingCart, DollarSign, Package,
    Calendar, ArrowUpRight, BarChart3, Download, FileText,
    BedDouble, UtensilsCrossed, Users,
} from 'lucide-react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell
} from 'recharts';
import { toast } from 'sonner';
import { useEntityUpdates } from '../hooks/useEntityUpdates';

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;
const COLORS = ['#F59E0B', '#6366F1', '#10B981', '#EF4444', '#8B5CF6', '#06B6D4'];
const fmtETB = (n) => `${Number(n || 0).toLocaleString('en-ET', { minimumFractionDigits: 2 })} ETB`;

const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-2xl px-4 py-3 shadow-xl text-sm" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
            <p className="font-semibold mb-1">{label}</p>
            {payload.map((p, i) => (
                <p key={i} style={{ color: p.color || '#F59E0B' }}>
                    {typeof p.value === 'number' && p.name === 'revenue' ? fmtETB(p.value) : p.value} {p.name}
                </p>
            ))}
        </div>
    );
};

export const Reports = () => {
    const [stats, setStats]               = useState(null);
    const [salesByDate, setSalesByDate]   = useState([]);
    const [topProducts, setTopProducts]   = useState([]);
    const [salesByCategory, setSalesByCategory] = useState([]);
    const [roomRevenue, setRoomRevenue]   = useState([]);
    const [staffPerf, setStaffPerf]       = useState([]);
    const [dateRange, setDateRange]       = useState('7');
    const [loading, setLoading]           = useState(true);
    // Daily report
    const [activeTab, setActiveTab]       = useState('overview'); // overview | daily
    const [dailyDate, setDailyDate]       = useState(new Date().toISOString().slice(0,10));
    const [dailyReport, setDailyReport]   = useState(null);
    const [dailyLoading, setDailyLoading] = useState(false);

    const fetchReportData = useCallback(async () => {
        setLoading(true);
        try {
            const [statsRes, salesRes, topRes, categoryRes, roomRes, staffRes] = await Promise.all([
                axios.get(`${API}/reports/dashboard`, { withCredentials: true }),
                axios.get(`${API}/reports/sales-by-date?days=${dateRange}`, { withCredentials: true }),
                axios.get(`${API}/reports/top-products?limit=10&days=${dateRange}`, { withCredentials: true }),
                axios.get(`${API}/reports/sales-by-category?days=${dateRange}`, { withCredentials: true }),
                axios.get(`${API}/reports/room-revenue?days=${dateRange}`, { withCredentials: true }),
                axios.get(`${API}/reports/staff-performance?days=${dateRange}`, { withCredentials: true }),
            ]);
            setStats(statsRes.data);
            setSalesByDate(salesRes.data);
            setTopProducts(topRes.data);
            setSalesByCategory(categoryRes.data);
            setRoomRevenue(roomRes.data);
            setStaffPerf(staffRes.data);
        } catch (error) {
            console.error('Error fetching reports:', error);
            toast.error('Failed to load reports');
        } finally {
            setLoading(false);
        }
    }, [dateRange]);

    useEffect(() => { fetchReportData(); }, [fetchReportData]);

    useEntityUpdates('order', useCallback((data) => {
        if (data.action === 'paid') fetchReportData();
    }, [fetchReportData]), { debounceMs: 500 });

    const fetchDailyReport = useCallback(async (date) => {
        setDailyLoading(true);
        try {
            const res = await axios.get(`${API}/reports/daily?date=${date}`, { withCredentials: true });
            setDailyReport(res.data);
        } catch (err) { toast.error(err.response?.data?.detail || 'Failed to load daily report'); }
        finally { setDailyLoading(false); }
    }, []);

    useEffect(() => {
        if (activeTab === 'daily') fetchDailyReport(dailyDate);
    }, [activeTab, dailyDate, fetchDailyReport]);

    const handleExportCSV = async (type = 'sales') => {
        try {
            const endpoint = type === 'items'
                ? `${API}/reports/export/sales-items-csv?days=${dateRange}`
                : `${API}/reports/export/sales-csv?days=${dateRange}`;
            const res = await axios.get(endpoint, { withCredentials: true, responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement('a');
            a.href = url;
            a.setAttribute('download', type === 'items' ? `order_items_${dateRange}days.csv` : `orders_${dateRange}days.csv`);
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
            toast.success('Export downloaded');
        } catch { toast.error('Export failed'); }
    };

    const handlePrintReport = () => {
        window.print();
    };

    const totalRevenue = salesByDate.reduce((s, d) => s + d.revenue, 0);
    const totalOrders = salesByDate.reduce((s, d) => s + d.orders, 0);
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    const summaryCards = [
        { title: 'Period Revenue', value: `${fmtETB(totalRevenue)}`, sub: `Last ${dateRange} days`, icon: DollarSign, gradient: 'from-violet-500 to-purple-600' },
        { title: 'Total Orders',   value: totalOrders,                   sub: `Last ${dateRange} days`, icon: ShoppingCart, gradient: 'from-blue-500 to-indigo-600' },
        { title: 'Avg Order Value',value: `${fmtETB(avgOrderValue)}`,sub: 'Per transaction',        icon: TrendingUp,   gradient: 'from-emerald-500 to-teal-600' },
        { title: 'Monthly Revenue',value: `${fmtETB(stats?.month_revenue||0)}`, sub: `${stats?.month_orders||0} orders this month`, icon: BarChart3, gradient: 'from-orange-500 to-amber-500' },
    ];

    const EmptyChart = ({ icon: Icon, msg }) => (
        <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: 'var(--text-muted)' }}>
            <Icon className="w-8 h-8 opacity-30" />
            <p className="text-sm">{msg}</p>
            <p className="text-xs opacity-60">Complete a sale in POS to see data</p>
        </div>
    );

    if (loading) {
        return (
            <div className="p-6 lg:p-8 space-y-6">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {[1,2,3,4].map(i => <div key={i} className="h-28 rounded-2xl animate-pulse" style={{ background: 'var(--bg-card)' }} />)}
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {[1,2,3,4].map(i => <div key={i} className="h-72 rounded-2xl animate-pulse" style={{ background: 'var(--bg-card)' }} />)}
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 lg:p-8 space-y-6" data-testid="reports-page">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Reports</h1>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Analytics & daily summaries</p>
                </div>
                {/* Tab switcher */}
                <div className="flex items-center gap-2">
                    <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                        {[['overview','📊 Overview'],['daily','📋 Daily Report']].map(([tab, label]) => (
                            <button key={tab} onClick={() => setActiveTab(tab)}
                                className={`px-4 py-2 text-sm font-semibold transition-all ${activeTab===tab ? 'text-white' : ''}`}
                                style={activeTab===tab ? { background:'linear-gradient(135deg,#F59E0B,#D97706)', color:'white' } : { background:'var(--bg-card)', color:'var(--text-secondary)' }}>
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── DAILY REPORT TAB ── */}
            {activeTab === 'daily' && (
                <div className="space-y-5">
                    {/* Date picker */}
                    <div className="flex items-center gap-3">
                        <input type="date" value={dailyDate} onChange={e => setDailyDate(e.target.value)}
                            className="px-4 py-2.5 text-sm rounded-xl border outline-none focus:border-amber-500"
                            style={{ background:'var(--bg-card)', borderColor:'var(--border)', color:'var(--text-primary)' }} />
                        <button onClick={() => fetchDailyReport(dailyDate)}
                            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white"
                            style={{ background:'linear-gradient(135deg,#F59E0B,#D97706)' }}>
                            Load Report
                        </button>
                        <button onClick={() => window.print()}
                            className="px-4 py-2.5 rounded-xl text-sm font-semibold border"
                            style={{ borderColor:'var(--border)', color:'var(--text-secondary)', background:'var(--bg-card)' }}>
                            🖨️ Print
                        </button>
                    </div>

                    {dailyLoading ? (
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            {[1,2,3,4].map(i => <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ background:'var(--bg-card)' }} />)}
                        </div>
                    ) : dailyReport ? (
                        <div className="space-y-5">
                            <p className="text-xs font-semibold" style={{ color:'var(--text-muted)' }}>Report for: {dailyReport.report_date}</p>

                            {/* Summary cards */}
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                {[
                                    { label:'Total Revenue', value: fmtETB(dailyReport.summary.total_revenue), sub:`Food: ${fmtETB(dailyReport.summary.food_drink_revenue)} · Room: ${fmtETB(dailyReport.summary.room_revenue)}`, color:'from-amber-500 to-orange-500' },
                                    { label:'Paid Orders', value: dailyReport.summary.paid_orders, sub:`${dailyReport.summary.voided_orders} voided`, color:'from-emerald-500 to-teal-500' },
                                    { label:'VAT Collected', value: fmtETB(dailyReport.summary.total_vat), sub:`Discounts: ${fmtETB(dailyReport.summary.total_discounts)}`, color:'from-blue-500 to-indigo-500' },
                                    { label:'Avg Order Value', value: fmtETB(dailyReport.summary.avg_order_value), sub:`${dailyReport.summary.total_orders} total orders`, color:'from-violet-500 to-purple-600' },
                                ].map((c,i) => (
                                    <div key={i} className="card-soft p-4">
                                        <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${c.color} flex items-center justify-center mb-2`}>
                                            <DollarSign className="w-4 h-4 text-white" />
                                        </div>
                                        <p className="text-xl font-bold" style={{ color:'var(--text-primary)' }}>{c.value}</p>
                                        <p className="text-xs font-semibold" style={{ color:'var(--text-muted)' }}>{c.label}</p>
                                        <p className="text-xs mt-0.5" style={{ color:'var(--text-muted)' }}>{c.sub}</p>
                                    </div>
                                ))}
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                                {/* Payment methods */}
                                <div className="card-soft p-5">
                                    <h3 className="font-bold text-sm mb-3" style={{ color:'var(--text-primary)' }}>💳 Payment Methods</h3>
                                    <div className="space-y-2">
                                        {dailyReport.payment_methods.map(p => (
                                            <div key={p.method} className="flex items-center justify-between">
                                                <span className="text-sm capitalize" style={{ color:'var(--text-secondary)' }}>{p.method}</span>
                                                <span className="font-bold text-sm text-amber-600">{fmtETB(p.amount)}</span>
                                            </div>
                                        ))}
                                        {dailyReport.payment_methods.length === 0 && <p className="text-xs" style={{ color:'var(--text-muted)' }}>No payments today</p>}
                                    </div>
                                </div>

                                {/* Hourly breakdown */}
                                <div className="card-soft p-5">
                                    <h3 className="font-bold text-sm mb-3" style={{ color:'var(--text-primary)' }}>⏰ Hourly Breakdown</h3>
                                    {dailyReport.hourly_breakdown.length > 0 ? (
                                        <div className="h-40">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={dailyReport.hourly_breakdown}>
                                                    <XAxis dataKey="hour" tick={{ fontSize:10 }} />
                                                    <YAxis tick={{ fontSize:10 }} />
                                                    <Tooltip formatter={(v) => fmtETB(v)} />
                                                    <Bar dataKey="revenue" fill="#F59E0B" radius={[4,4,0,0]} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    ) : <p className="text-xs" style={{ color:'var(--text-muted)' }}>No data</p>}
                                </div>

                                {/* Top items sold */}
                                <div className="card-soft p-5">
                                    <h3 className="font-bold text-sm mb-3" style={{ color:'var(--text-primary)' }}>🍽️ Top Items Sold</h3>
                                    <div className="overflow-x-auto">
                                        <table className="data-table">
                                            <thead><tr><th>Item</th><th className="text-center">Qty</th><th className="text-right">Revenue</th></tr></thead>
                                            <tbody>
                                                {dailyReport.top_items.slice(0,10).map((item,i) => (
                                                    <tr key={i}>
                                                        <td>{item.name}</td>
                                                        <td className="text-center font-bold">{item.quantity}</td>
                                                        <td className="text-right text-amber-600 font-semibold">{fmtETB(item.revenue)}</td>
                                                    </tr>
                                                ))}
                                                {dailyReport.top_items.length === 0 && <tr><td colSpan={3} className="text-center text-xs" style={{ color:'var(--text-muted)' }}>No items sold</td></tr>}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* Staff performance */}
                                <div className="card-soft p-5">
                                    <h3 className="font-bold text-sm mb-3" style={{ color:'var(--text-primary)' }}>👤 Staff Performance</h3>
                                    <div className="overflow-x-auto">
                                        <table className="data-table">
                                            <thead><tr><th>Staff</th><th className="text-center">Orders</th><th className="text-center">Items</th><th className="text-right">Revenue</th></tr></thead>
                                            <tbody>
                                                {dailyReport.staff_performance.map((s,i) => (
                                                    <tr key={i}>
                                                        <td>{s.server_name}</td>
                                                        <td className="text-center">{s.orders}</td>
                                                        <td className="text-center">{s.items}</td>
                                                        <td className="text-right text-amber-600 font-semibold">{fmtETB(s.revenue)}</td>
                                                    </tr>
                                                ))}
                                                {dailyReport.staff_performance.length === 0 && <tr><td colSpan={4} className="text-center text-xs" style={{ color:'var(--text-muted)' }}>No staff data</td></tr>}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>

                            {/* Room charges */}
                            {dailyReport.room_charges.length > 0 && (
                                <div className="card-soft p-5">
                                    <h3 className="font-bold text-sm mb-3" style={{ color:'var(--text-primary)' }}>🏠 Room Charges ({dailyReport.room_charges.length})</h3>
                                    <div className="overflow-x-auto">
                                        <table className="data-table">
                                            <thead><tr><th>Customer</th><th>Phone</th><th className="text-center">Party</th><th>Method</th><th className="text-right">Fee</th></tr></thead>
                                            <tbody>
                                                {dailyReport.room_charges.map((c,i) => (
                                                    <tr key={i}>
                                                        <td>{c.customer_name}</td>
                                                        <td>{c.customer_phone || '—'}</td>
                                                        <td className="text-center">{c.party_size || '—'}</td>
                                                        <td className="capitalize">{c.payment_method}</td>
                                                        <td className="text-right text-emerald-600 font-semibold">{fmtETB(c.room_fee)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Voided orders */}
                            {dailyReport.voided_details.length > 0 && (
                                <div className="card-soft p-5">
                                    <h3 className="font-bold text-sm mb-3 text-red-500">🚫 Voided Orders ({dailyReport.voided_details.length})</h3>
                                    <div className="space-y-2">
                                        {dailyReport.voided_details.map((v,i) => (
                                            <div key={i} className="flex items-center justify-between text-sm rounded-xl px-3 py-2" style={{ background:'var(--bg-page)' }}>
                                                <span style={{ color:'var(--text-secondary)' }}>#{v.id.slice(-6).toUpperCase()} · {v.server}</span>
                                                <span className="text-red-500 font-semibold">{fmtETB(v.total)} · {v.reason || 'No reason'}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-48 gap-3" style={{ color:'var(--text-muted)' }}>
                            <FileText className="w-12 h-12 opacity-30" />
                            <p>Select a date and click Load Report</p>
                        </div>
                    )}
                </div>
            )}

            {/* ── OVERVIEW TAB ── */}
            {activeTab === 'overview' && (
            <div className="space-y-6">
                {/* Export & date range toolbar */}
                <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => handleExportCSV('sales')} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-colors hover:bg-amber-50 dark:hover:bg-amber-900/20" style={{ borderColor:'var(--border)', color:'var(--text-secondary)', background:'var(--bg-card)' }}>
                        <Download className="w-4 h-4" />Sales CSV
                    </button>
                    <button onClick={() => handleExportCSV('items')} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-colors hover:bg-amber-50 dark:hover:bg-amber-900/20" style={{ borderColor:'var(--border)', color:'var(--text-secondary)', background:'var(--bg-card)' }}>
                        <FileText className="w-4 h-4" />Items CSV
                    </button>
                    <button onClick={handlePrintReport} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-colors hover:bg-amber-50 dark:hover:bg-amber-900/20" style={{ borderColor:'var(--border)', color:'var(--text-secondary)', background:'var(--bg-card)' }}>
                        <FileText className="w-4 h-4" />Print PDF
                    </button>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-2xl" style={{ background:'var(--bg-card)', border:'1px solid var(--border)' }}>
                        <Calendar className="w-4 h-4" style={{ color:'var(--text-muted)' }} />
                        <select value={dateRange} onChange={e => setDateRange(e.target.value)} className="text-sm font-medium bg-transparent outline-none cursor-pointer" style={{ color:'var(--text-primary)' }} data-testid="date-range-select">
                            <option value="7">Last 7 Days</option>
                            <option value="14">Last 14 Days</option>
                            <option value="30">Last 30 Days</option>
                            <option value="90">Last 90 Days</option>
                        </select>
                    </div>
                </div>

                {/* Summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {summaryCards.map((card, i) => {
                    const Icon = card.icon;
                    return (
                        <div key={i} className="stat-card">
                            <div className="flex items-start justify-between">
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>{card.title}</p>
                                    <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{card.value}</p>
                                    <p className="text-xs mt-1 flex items-center gap-1 text-violet-500 font-medium">
                                        <ArrowUpRight className="w-3 h-3" />{card.sub}
                                    </p>
                                </div>
                                <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${card.gradient} flex items-center justify-center shadow-lg`}>
                                    <Icon className="w-5 h-5 text-white" strokeWidth={2} />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Charts row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card-soft p-6">
                    <div className="flex items-center gap-2 mb-5">
                        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                            <TrendingUp className="w-4 h-4 text-white" />
                        </div>
                        <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Revenue Trend</h3>
                    </div>
                    <div className="h-64">
                        {salesByDate.length === 0 ? <EmptyChart icon={TrendingUp} msg="No sales data yet" /> : (
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={salesByDate}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
                                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={v => v.slice(5)} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Line type="monotone" dataKey="revenue" stroke="#7C3AED" strokeWidth={2.5} dot={{ fill: '#7C3AED', r: 4, strokeWidth: 0 }} activeDot={{ r: 6 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                <div className="card-soft p-6">
                    <div className="flex items-center gap-2 mb-5">
                        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                            <BarChart3 className="w-4 h-4 text-white" />
                        </div>
                        <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Daily Orders</h3>
                    </div>
                    <div className="h-64">
                        {salesByDate.length === 0 ? <EmptyChart icon={ShoppingCart} msg="No orders yet" /> : (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={salesByDate} barSize={24}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
                                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={v => v.slice(5)} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Bar dataKey="orders" fill="#6366F1" radius={[8, 8, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
            </div>

            {/* Charts row 2 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card-soft p-6">
                    <div className="flex items-center gap-2 mb-5">
                        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                            <Package className="w-4 h-4 text-white" />
                        </div>
                        <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Sales by Category</h3>
                    </div>
                    <div className="h-64">
                        {salesByCategory.length === 0 ? <EmptyChart icon={Package} msg="No category data yet" /> : (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={salesByCategory} cx="50%" cy="50%" outerRadius={90} innerRadius={40}
                                        dataKey="revenue" nameKey="category"
                                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                        labelLine={false}
                                    >
                                        {salesByCategory.map((_, index) => (
                                            <Cell key={index} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip formatter={v => [`${Number(v).toLocaleString("en-ET",{minimumFractionDigits:2})} ETB`, 'Revenue']} contentStyle={{ borderRadius: 16, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
                                </PieChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                <div className="card-soft p-6">
                    <div className="flex items-center gap-2 mb-5">
                        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
                            <TrendingUp className="w-4 h-4 text-white" />
                        </div>
                        <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Top Selling Products</h3>
                    </div>
                    {topProducts.length === 0 ? (
                        <EmptyChart icon={Package} msg="No product sales yet" />
                    ) : (
                        <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                            {topProducts.map((product, index) => (
                                <div key={product.product_id} className="flex items-center gap-3 p-3 rounded-xl transition-colors hover:bg-amber-50 dark:hover:bg-amber-900/20">
                                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                                        {index + 1}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{product.product_name}</p>
                                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{product.total_quantity} units sold</p>
                                    </div>
                                    <span className="text-sm font-bold" style={{ color: 'var(--warning, #F59E0B)' }}>
                                        ${product.total_revenue.toLocaleString("en-ET",{minimumFractionDigits:2})} ETB
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Room Revenue ── */}
            {roomRevenue.length > 0 && (
                <div className="card-soft overflow-hidden">
                    <div className="flex items-center gap-2 px-6 py-4 border-b" style={{ borderColor: 'var(--border-light)' }}>
                        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                            <BedDouble className="w-4 h-4 text-white" />
                        </div>
                        <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                            Room Revenue — Last {dateRange} Days
                        </h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="data-table">
                            <thead>
                                <tr><th>Room</th><th className="text-center">Orders</th><th className="text-right">Tips</th><th className="text-right">Avg Spend</th><th className="text-right">Total Revenue</th></tr>
                            </thead>
                            <tbody>
                                {roomRevenue.map((r, i) => (
                                    <tr key={r.room_id}>
                                        <td className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{r.room_name}</td>
                                        <td className="text-center text-sm" style={{ color: 'var(--text-secondary)' }}>{r.order_count}</td>
                                        <td className="text-right text-sm" style={{ color: 'var(--text-secondary)' }}>{r.tips.toLocaleString('en-ET', { minimumFractionDigits: 2 })} ETB</td>
                                        <td className="text-right text-sm" style={{ color: 'var(--text-secondary)' }}>{r.avg_spend.toLocaleString('en-ET', { minimumFractionDigits: 2 })} ETB</td>
                                        <td className="text-right font-bold text-sm text-amber-600">{r.revenue.toLocaleString('en-ET', { minimumFractionDigits: 2 })} ETB</td>
                                    </tr>
                                ))}
                                <tr style={{ borderTop: '2px solid var(--border-light)', fontWeight: 'bold' }}>
                                    <td style={{ color: 'var(--text-primary)' }}>TOTAL</td>
                                    <td className="text-center" style={{ color: 'var(--text-primary)' }}>{roomRevenue.reduce((s, r) => s + r.order_count, 0)}</td>
                                    <td className="text-right" style={{ color: 'var(--text-primary)' }}>{roomRevenue.reduce((s, r) => s + r.tips, 0).toLocaleString('en-ET', { minimumFractionDigits: 2 })} ETB</td>
                                    <td></td>
                                    <td className="text-right text-amber-600">{roomRevenue.reduce((s, r) => s + r.revenue, 0).toLocaleString('en-ET', { minimumFractionDigits: 2 })} ETB</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── Staff Performance ── */}
            {staffPerf.length > 0 && (
                <div className="card-soft overflow-hidden">
                    <div className="flex items-center gap-2 px-6 py-4 border-b" style={{ borderColor: 'var(--border-light)' }}>
                        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-pink-500 to-rose-500 flex items-center justify-center">
                            <Users className="w-4 h-4 text-white" />
                        </div>
                        <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                            Staff Performance — Last {dateRange} Days
                        </h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="data-table">
                            <thead>
                                <tr><th>Staff</th><th className="text-center">Orders</th><th className="text-right">Tips</th><th className="text-right">Total Sales</th></tr>
                            </thead>
                            <tbody>
                                {staffPerf.map((s, i) => (
                                    <tr key={s.server_id}>
                                        <td className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{s.server_name}</td>
                                        <td className="text-center text-sm" style={{ color: 'var(--text-secondary)' }}>{s.order_count}</td>
                                        <td className="text-right text-sm" style={{ color: 'var(--text-secondary)' }}>{s.tips.toLocaleString('en-ET', { minimumFractionDigits: 2 })} ETB</td>
                                        <td className="text-right font-bold text-sm text-amber-600">{s.sales.toLocaleString('en-ET', { minimumFractionDigits: 2 })} ETB</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
        )} {/* end overview tab */}
        </div>
    );
};
