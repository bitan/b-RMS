import { useState, useCallback, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { ROLES, ROLE_LABELS,
    canViewFloor, canManageRooms, canViewReservations, canManageReservations,
    canTakeOrders, canProcessPayment, canViewKitchen, canViewBar,
    canManageMenu, canManageInventory, canManageEmployees, canViewReports,
    canViewAuditLog, canManageBranches,
} from '../lib/roles';
import {
    LayoutDashboard, UtensilsCrossed, ShoppingCart, Users, Truck,
    BarChart3, LogOut, Menu, X, Bell, Search, ChevronDown,
    Shield, Clock, ScrollText, Building2, Sun, Moon, KeyRound,
    UserCircle, ShoppingBag, BedDouble, CalendarRange, ChefHat,
    GlassWater, Package, BookOpen, Utensils, Percent, Beer,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem,
    DropdownMenuSeparator, DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;

const navItems = [
    // -- All roles --
    { path: '/',             icon: LayoutDashboard,  label: 'Dashboard',       roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.ROOM_MANAGER, ROLES.SERVER, ROLES.BARTENDER, ROLES.KITCHEN, ROLES.CASHIER] },
    // -- Rooms & Reservations --
    { path: '/rooms',        icon: BedDouble,         label: 'Rooms',           roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.ROOM_MANAGER, ROLES.CASHIER] },
    { path: '/reservations', icon: CalendarRange,     label: 'Reservations',    roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.ROOM_MANAGER, ROLES.CASHIER] },
    // -- Order flow --
    { path: '/orders',       icon: Utensils,          label: 'Order Tracker',   roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER, ROLES.SERVER, ROLES.ROOM_MANAGER, ROLES.BARTENDER] },
    { path: '/pos',          icon: ShoppingCart,      label: 'Order Ticket',    roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.ROOM_MANAGER, ROLES.SERVER, ROLES.BARTENDER, ROLES.CASHIER] },
    // -- Station displays --
    { path: '/kitchen',      icon: ChefHat,           label: 'Kitchen Display', roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.KITCHEN] },
    { path: '/bar',          icon: GlassWater,        label: 'Bar Display',     roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.BARTENDER] },
    // -- Management only --
    { path: '/menu',         icon: BookOpen,          label: 'Menu',            roles: [ROLES.OWNER, ROLES.MANAGER] },
    { path: '/inventory',    icon: Package,           label: 'Ingredients',     roles: [ROLES.OWNER, ROLES.MANAGER] },
    { path: '/suppliers',    icon: Truck,             label: 'Suppliers',       roles: [ROLES.OWNER, ROLES.MANAGER] },
    { path: '/purchase-orders', icon: ShoppingBag,   label: 'Purchase Orders', roles: [ROLES.OWNER, ROLES.MANAGER] },
    { path: '/happy-hours',  icon: Percent,           label: 'Happy Hours',     roles: [ROLES.OWNER, ROLES.MANAGER] },
    { path: '/bar-restock',  icon: Beer,              label: 'Bar Restock',     roles: [ROLES.OWNER, ROLES.MANAGER] },
    { path: '/employees',    icon: Users,             label: 'Staff',           roles: [ROLES.OWNER, ROLES.MANAGER] },
    { path: '/shifts',       icon: Clock,             label: 'Shift Report',    roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER, ROLES.SERVER, ROLES.BARTENDER, ROLES.KITCHEN, ROLES.ROOM_MANAGER] },
    { path: '/reports',      icon: BarChart3,         label: 'Reports',         roles: [ROLES.OWNER, ROLES.MANAGER] },
    { path: '/branches',     icon: Building2,         label: 'Branches',        roles: [ROLES.OWNER] },
    { path: '/audit-log',    icon: ScrollText,        label: 'Audit Log',       roles: [ROLES.OWNER, ROLES.MANAGER] },
];

const roleConfig = {
    [ROLES.OWNER]:        { label: 'Owner',              color: 'from-amber-500 to-orange-600',   badge: 'bg-amber-100 text-amber-700' },
    [ROLES.MANAGER]:      { label: 'Restaurant Manager', color: 'from-violet-600 to-purple-600',  badge: 'bg-violet-100 text-violet-700' },
    [ROLES.ROOM_MANAGER]: { label: 'Room Manager',       color: 'from-blue-500 to-indigo-600',    badge: 'bg-blue-100 text-blue-700' },
    [ROLES.SERVER]:       { label: 'Server',             color: 'from-emerald-500 to-teal-600',   badge: 'bg-emerald-100 text-emerald-700' },
    [ROLES.BARTENDER]:    { label: 'Bartender',          color: 'from-pink-500 to-rose-500',      badge: 'bg-pink-100 text-pink-700' },
    [ROLES.KITCHEN]:      { label: 'Kitchen Staff',      color: 'from-red-500 to-orange-500',     badge: 'bg-red-100 text-red-700' },
    [ROLES.CASHIER]:      { label: 'Cashier',            color: 'from-sky-500 to-blue-500',       badge: 'bg-sky-100 text-sky-700' },
};

export const Layout = ({ children }) => {
    const { user, logout, checkAuth } = useAuth();
    const { notifications, unreadCount, markAllRead } = useNotifications();
    const location = useLocation();
    const navigate = useNavigate();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [darkMode, setDarkMode] = useState(() => {
        return localStorage.getItem('br-theme') === 'dark' ||
            (!localStorage.getItem('br-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    });

    const [showChangePwd, setShowChangePwd] = useState(false);
    const [pwdForm, setPwdForm] = useState({ current: '', newPwd: '', confirm: '' });
    const [pwdLoading, setPwdLoading] = useState(false);
    const [pwdError, setPwdError] = useState('');

    const [showProfile, setShowProfile] = useState(false);
    const [profileForm, setProfileForm] = useState({ name: '', phone: '' });
    const [profileLoading, setProfileLoading] = useState(false);
    const [profileError, setProfileError] = useState('');

    // ── Void request badge (managers only) ───────────────────────────────────
    const [pendingVoidCount, setPendingVoidCount] = useState(0);
    const isManager = [ROLES.OWNER, ROLES.MANAGER].includes(user?.role);
    useEffect(() => {
        if (!isManager) return;
        const fetchVoids = async () => {
            try {
                const res = await axios.get(`${API}/void-requests?status=pending`, { withCredentials: true });
                setPendingVoidCount(res.data?.length || 0);
            } catch { /* silent */ }
        };
        fetchVoids();
        const t = setInterval(fetchVoids, 30000); // poll every 30s
        return () => clearInterval(t);
    }, [isManager]);

    const handleUpdateProfile = async (e) => {
        e.preventDefault();
        setProfileError('');
        setProfileLoading(true);
        try {
            const payload = {};
            if (profileForm.name && profileForm.name.trim()) payload.name = profileForm.name.trim();
            if (profileForm.phone !== undefined) payload.phone = profileForm.phone.trim();
            if (!payload.name && payload.phone === undefined) {
                setProfileError('Please fill in at least one field');
                setProfileLoading(false);
                return;
            }
            await axios.put(`${API}/auth/profile`, payload, { withCredentials: true });
            await checkAuth();
            setShowProfile(false);
            toast.success('Profile updated');
        } catch (err) {
            setProfileError(err.response?.data?.detail || 'Failed to update profile');
        } finally {
            setProfileLoading(false);
        }
    };

    const handleChangePassword = async (e) => {
        e.preventDefault();
        setPwdError('');
        if (pwdForm.newPwd !== pwdForm.confirm) { setPwdError('Passwords do not match'); return; }
        if (pwdForm.newPwd.length < 8) { setPwdError('Password must be at least 8 characters'); return; }
        setPwdLoading(true);
        try {
            await axios.put(`${API}/auth/change-password`, {
                current_password: pwdForm.current,
                new_password: pwdForm.newPwd,
            }, { withCredentials: true });
            setShowChangePwd(false);
            setPwdForm({ current: '', newPwd: '', confirm: '' });
            toast.success('Password changed');
        } catch (err) {
            setPwdError(err.response?.data?.detail || 'Failed to change password');
        } finally {
            setPwdLoading(false);
        }
    };

    useEffect(() => {
        const root = document.documentElement;
        if (darkMode) { root.classList.add('dark'); localStorage.setItem('br-theme', 'dark'); }
        else { root.classList.remove('dark'); localStorage.setItem('br-theme', 'light'); }
    }, [darkMode]);

    // Global search
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchLoading, setSearchLoading] = useState(false);
    const searchRef = useRef(null);
    const searchTimer = useRef(null);

    const pageShortcuts = navItems.filter(item => item.roles.includes(user?.role));

    const runSearch = useCallback(async (q) => {
        if (!q.trim()) { setSearchResults([]); return; }
        setSearchLoading(true);
        try {
            const res = await axios.get(`${API}/menu-items?search=${encodeURIComponent(q)}&limit=5`, { withCredentials: true });
            const items = (res.data?.items || []).slice(0, 5).map(m => ({
                type: 'menu', label: m.name,
                sub: `${m.category} · ${m.price} ETB`,
                action: () => navigate('/menu'),
            }));
            const pages = pageShortcuts
                .filter(p => p.label.toLowerCase().includes(q.toLowerCase()))
                .map(p => ({ type: 'page', label: p.label, sub: 'Go to page', action: () => navigate(p.path) }));
            setSearchResults([...pages, ...items]);
        } catch { setSearchResults([]); }
        finally { setSearchLoading(false); }
    }, [navigate, pageShortcuts]);

    const handleSearchChange = (e) => {
        const q = e.target.value;
        setSearchQuery(q);
        setSearchOpen(true);
        window.clearTimeout(searchTimer.current);
        if (!q.trim()) { setSearchResults([]); return; }
        searchTimer.current = window.setTimeout(() => runSearch(q), 300);
    };

    const handleSearchSelect = (result) => {
        result.action();
        setSearchQuery(''); setSearchResults([]); setSearchOpen(false);
    };

    useEffect(() => {
        const handler = (e) => {
            if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const handleLogout = async () => { await logout(); navigate('/login'); };

    const filteredNavItems = navItems.filter(item => item.roles.includes(user?.role));
    const role = roleConfig[user?.role] || roleConfig[ROLES.MANAGER];
    const initials = user?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'U';

    return (
        <div className="flex min-h-screen" style={{ background: 'var(--bg-page)' }}>

            {sidebarOpen && (
                <div className="fixed inset-0 bg-black/40 z-40 lg:hidden backdrop-blur-sm"
                    onClick={() => setSidebarOpen(false)} />
            )}

            {/* ── Sidebar ── */}
            <aside className={`sidebar ${sidebarOpen ? 'open' : ''} fixed lg:relative z-50`}>
                {/* Logo */}
                <div className="p-6 pb-4">
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${role.color} flex items-center justify-center shadow-lg`}>
                            <UtensilsCrossed className="w-5 h-5 text-white" strokeWidth={2.5} />
                        </div>
                        <div>
                            <h1 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
                                Bar & Restaurant
                            </h1>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Management System</p>
                        </div>
                    </div>
                </div>

                {/* User card */}
                <div className="mx-4 mb-4 p-3 rounded-2xl" style={{ background: 'var(--purple-50)', border: '1px solid var(--purple-100)' }}>
                    <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${role.color} flex items-center justify-center text-white text-sm font-bold shadow`}>
                            {initials}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{user?.name}</p>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${role.badge}`}>
                                {role.label}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Nav */}
                <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
                    <p className="px-4 pt-2 pb-1 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                        Menu
                    </p>
                    {filteredNavItems.map((item) => {
                        const isActive = location.pathname === item.path;
                        const Icon = item.icon;
                        return (
                            <Link key={item.path} to={item.path}
                                className={isActive ? 'nav-item-active' : 'nav-item'}
                                onClick={() => setSidebarOpen(false)}
                                data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}>
                                <Icon className="w-4.5 h-4.5 flex-shrink-0" strokeWidth={isActive ? 2.5 : 2} style={{ width: 18, height: 18 }} />
                                <span>{item.label}</span>
                            </Link>
                        );
                    })}
                </nav>

                {/* Bottom */}
                <div className="p-3 space-y-0.5 border-t" style={{ borderColor: 'var(--border-light)' }}>
                    <button onClick={() => setDarkMode(!darkMode)} className="nav-item w-full">
                        {darkMode ? <Sun style={{ width: 18, height: 18 }} strokeWidth={2} /> : <Moon style={{ width: 18, height: 18 }} strokeWidth={2} />}
                        <span>{darkMode ? 'Light Mode' : 'Dark Mode'}</span>
                    </button>
                    <button onClick={handleLogout} className="nav-item w-full text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                        <LogOut style={{ width: 18, height: 18 }} strokeWidth={2} />
                        <span>Sign Out</span>
                    </button>
                </div>
            </aside>

            {/* ── Main ── */}
            <div className="flex-1 flex flex-col min-h-screen min-w-0">

                {/* ── Header ── */}
                <header className="sticky top-0 z-40 px-4 lg:px-6 py-3"
                    style={{ background: 'var(--bg-header)', borderBottom: '1px solid var(--border-light)', boxShadow: '0 1px 8px rgba(245,158,11,0.06)' }}>
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 flex-1">
                            <button className="lg:hidden p-2 rounded-xl hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors"
                                onClick={() => setSidebarOpen(!sidebarOpen)}>
                                {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                            </button>
                            {/* Search */}
                            <div className="relative hidden md:block flex-1 max-w-sm" ref={searchRef}>
                                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                                <input type="text" placeholder="Search menu, pages…"
                                    className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border transition-all outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                                    style={{ background: 'var(--purple-50)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                                    value={searchQuery} onChange={handleSearchChange} onFocus={() => setSearchOpen(true)} />
                                {searchOpen && (searchResults.length > 0 || searchLoading || (searchQuery && searchResults.length === 0)) && (
                                    <div className="absolute top-full left-0 right-0 mt-2 rounded-2xl shadow-xl z-50 overflow-hidden"
                                        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                                        {searchLoading ? (
                                            <div className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>Searching…</div>
                                        ) : searchResults.length === 0 ? (
                                            <div className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>No results for "{searchQuery}"</div>
                                        ) : (
                                            searchResults.map((result, i) => (
                                                <button key={i} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-amber-50 dark:hover:bg-amber-900/20 text-left transition-colors"
                                                    onClick={() => handleSearchSelect(result)}>
                                                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${result.type === 'page' ? 'bg-amber-500 text-white' : 'bg-amber-100 text-amber-700'}`}>
                                                        {result.type === 'page' ? <Search className="w-3.5 h-3.5" /> : <UtensilsCrossed className="w-3.5 h-3.5" />}
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{result.label}</p>
                                                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{result.sub}</p>
                                                    </div>
                                                </button>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <button onClick={() => setDarkMode(!darkMode)}
                                className="hidden lg:flex p-2.5 rounded-xl transition-colors hover:bg-amber-50 dark:hover:bg-amber-900/30"
                                style={{ color: 'var(--text-secondary)' }}>
                                {darkMode ? <Sun style={{ width: 18, height: 18 }} /> : <Moon style={{ width: 18, height: 18 }} />}
                            </button>

                            {/* Notifications */}
                            <DropdownMenu onOpenChange={(open) => open && markAllRead()}>
                                <DropdownMenuTrigger asChild>
                                    <button className="relative p-2.5 rounded-xl transition-colors hover:bg-amber-50 dark:hover:bg-amber-900/30"
                                        style={{ color: 'var(--text-secondary)' }}>
                                        <Bell style={{ width: 18, height: 18 }} strokeWidth={2} />
                                        {unreadCount > 0 && (
                                            <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                                                {unreadCount > 9 ? '9+' : unreadCount}
                                            </span>
                                        )}
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-80 rounded-2xl p-0 overflow-hidden"
                                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                                    <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                                        <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Notifications</p>
                                    </div>
                                    {notifications.length === 0 ? (
                                        <div className="p-6 text-sm text-center" style={{ color: 'var(--text-muted)' }}>
                                            <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />No notifications yet
                                        </div>
                                    ) : (
                                        notifications.slice(0, 8).map((n) => (
                                            <DropdownMenuItem key={n.id} className="flex flex-col items-start px-4 py-3 cursor-default hover:bg-amber-50 dark:hover:bg-amber-900/20">
                                                <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{n.title}</span>
                                                <span className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{n.subtitle}</span>
                                            </DropdownMenuItem>
                                        ))
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>

                            {/* User menu */}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button className="flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-2xl transition-colors hover:bg-amber-50 dark:hover:bg-amber-900/30">
                                        <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${role.color} flex items-center justify-center text-white text-xs font-bold shadow`}>
                                            {initials}
                                        </div>
                                        <div className="hidden md:block text-left">
                                            <p className="text-sm font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>{user?.name}</p>
                                            <p className="text-xs leading-tight" style={{ color: 'var(--text-muted)' }}>{role.label}</p>
                                        </div>
                                        <ChevronDown className="w-3.5 h-3.5 hidden md:block" style={{ color: 'var(--text-muted)' }} />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-56 rounded-2xl p-1"
                                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                                    <div className="px-3 py-2 mb-1">
                                        <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{user?.email}</p>
                                    </div>
                                    <DropdownMenuSeparator style={{ background: 'var(--border)' }} />
                                    <DropdownMenuItem onClick={() => { setProfileForm({ name: user?.name || '', phone: '' }); setProfileError(''); setShowProfile(true); }}
                                        className="rounded-xl cursor-pointer mt-1 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                                        style={{ color: 'var(--text-secondary)' }}>
                                        <UserCircle className="w-4 h-4 mr-2" />Edit Profile
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => { setPwdForm({ current: '', newPwd: '', confirm: '' }); setPwdError(''); setShowChangePwd(true); }}
                                        className="rounded-xl cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-900/20"
                                        style={{ color: 'var(--text-secondary)' }}>
                                        <KeyRound className="w-4 h-4 mr-2" />Change Password
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={handleLogout}
                                        className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl cursor-pointer mt-1">
                                        <LogOut className="w-4 h-4 mr-2" />Sign Out
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                </header>

                <main className="flex-1 overflow-auto">
                    {/* ── Global void request alert for managers ── */}
                    {pendingVoidCount > 0 && (
                        <div className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:opacity-90 transition-opacity"
                            style={{ background: 'linear-gradient(135deg,#FEF2F2,#FFF7ED)', borderBottom: '1px solid #FECACA' }}
                            onClick={() => navigate('/orders')}>
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-red-500 text-white text-xs font-bold flex-shrink-0">
                                {pendingVoidCount}
                            </span>
                            <p className="text-sm font-semibold text-red-700 flex-1">
                                Void request{pendingVoidCount !== 1 ? 's' : ''} pending approval — tap to review
                            </p>
                            <span className="text-xs text-red-500">→</span>
                        </div>
                    )}
                    {children}
                </main>
            </div>

            {/* ── Edit Profile Modal ── */}
            {showProfile && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-sm rounded-3xl p-6 shadow-2xl" style={{ background: 'var(--bg-card)' }}>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Edit Profile</h3>
                            <button onClick={() => setShowProfile(false)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"><X className="w-4 h-4" /></button>
                        </div>
                        {profileError && <div className="p-3 rounded-2xl mb-4 bg-red-50 border border-red-100"><p className="text-sm text-red-600">{profileError}</p></div>}
                        <form onSubmit={handleUpdateProfile} className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Full Name</label>
                                <input type="text" value={profileForm.name} onChange={e => setProfileForm({ ...profileForm, name: e.target.value })} required
                                    className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
                                    style={{ background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Phone</label>
                                <input type="tel" value={profileForm.phone} onChange={e => setProfileForm({ ...profileForm, phone: e.target.value })} placeholder="+251..."
                                    className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
                                    style={{ background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                            </div>
                            <div className="flex gap-3 pt-1">
                                <button type="button" onClick={() => setShowProfile(false)}
                                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all"
                                    style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
                                <button type="submit" disabled={profileLoading}
                                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50"
                                    style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}>
                                    {profileLoading ? 'Saving…' : 'Save'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── Change Password Modal ── */}
            {showChangePwd && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-sm rounded-3xl p-6 shadow-2xl" style={{ background: 'var(--bg-card)' }}>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Change Password</h3>
                            <button onClick={() => setShowChangePwd(false)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"><X className="w-4 h-4" /></button>
                        </div>
                        {pwdError && <div className="p-3 rounded-2xl mb-4 bg-red-50 border border-red-100"><p className="text-sm text-red-600">{pwdError}</p></div>}
                        <form onSubmit={handleChangePassword} className="space-y-4">
                            {['current', 'newPwd', 'confirm'].map((field, i) => (
                                <div key={field}>
                                    <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                                        {field === 'current' ? 'Current Password' : field === 'newPwd' ? 'New Password' : 'Confirm New Password'}
                                    </label>
                                    <input type="password" value={pwdForm[field]} onChange={e => setPwdForm({ ...pwdForm, [field]: e.target.value })} required
                                        className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
                                        style={{ background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                                </div>
                            ))}
                            <div className="flex gap-3 pt-1">
                                <button type="button" onClick={() => setShowChangePwd(false)}
                                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all"
                                    style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
                                <button type="submit" disabled={pwdLoading}
                                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50"
                                    style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}>
                                    {pwdLoading ? 'Saving…' : 'Update'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
