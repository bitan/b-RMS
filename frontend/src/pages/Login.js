import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Loader2, UtensilsCrossed, AlertCircle } from 'lucide-react';

const formatApiErrorDetail = (detail) => {
    if (detail == null) return "Something went wrong. Please try again.";
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail))
        return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).filter(Boolean).join(" ");
    if (detail && typeof detail.msg === "string") return detail.msg;
    return String(detail);
};

export const Login = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();

    const getRoleLanding = (role) => {
        switch (role) {
            case 'cashier': return '/pos';
            case 'server': return '/pos';
            case 'bartender': return '/bar';
            case 'kitchen_staff': return '/kitchen';
            case 'room_manager': return '/rooms';
            default: return '/';
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        // Retry up to 3 times to handle Render cold starts
        let lastErr;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const userData = await login(email, password);
                navigate(getRoleLanding(userData.role));
                return;
            } catch (err) {
                lastErr = err;
                // If it's a network error (cold start), wait and retry
                if (!err.response && attempt < 2) {
                    await new Promise(r => setTimeout(r, 5000));
                    continue;
                }
                break;
            }
        }
        setError(formatApiErrorDetail(lastErr?.response?.data?.detail) || lastErr?.message || 'Connection failed. The server may be waking up — please try again in 30 seconds.');
        setLoading(false);
    };

    return (
        <div className="min-h-screen flex" style={{ background: 'var(--bg-page, #F0EEFF)' }}>

            {/* ── Left panel — form ── */}
            <div className="flex-1 flex items-center justify-center p-8 lg:p-12">
                <div className="w-full max-w-md">

                    {/* Logo */}
                    <div className="flex items-center gap-3 mb-10">
                        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg">
                            <UtensilsCrossed className="w-5 h-5 text-white" strokeWidth={2.5} />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold leading-tight" style={{ color: 'var(--text-primary, #1E1B4B)' }}>Bar & Restaurant</h1>
                            <p className="text-xs" style={{ color: 'var(--text-muted, #9CA3AF)' }}>Management System</p>
                        </div>
                    </div>

                    <h2 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary, #1E1B4B)' }}>Welcome back 👋</h2>
                    <p className="text-sm mb-8" style={{ color: 'var(--text-muted, #9CA3AF)' }}>Sign in to your account to continue</p>

                    {/* Error */}
                    {error && (
                        <div className="flex items-start gap-3 p-4 rounded-2xl mb-4 bg-red-50 border border-red-100">
                            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-red-600">{error}</p>
                        </div>
                    )}

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary, #6B7280)' }}>
                                Email Address
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="your@email.com"
                                required
                                className="w-full px-4 py-3 rounded-xl border text-sm outline-none transition-all duration-200 focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
                                style={{ background: 'white', borderColor: 'var(--border, #E5E7EB)', color: 'var(--text-primary, #1E1B4B)' }}
                                data-testid="login-email"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary, #6B7280)' }}>
                                Password
                            </label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                required
                                className="w-full px-4 py-3 rounded-xl border text-sm outline-none transition-all duration-200 focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
                                style={{ background: 'white', borderColor: 'var(--border, #E5E7EB)', color: 'var(--text-primary, #1E1B4B)' }}
                                data-testid="login-password"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                            style={{
                                background: 'linear-gradient(135deg, #7C3AED, #6D28D9)',
                                boxShadow: '0 4px 14px rgba(124,58,237,0.4)',
                            }}
                            data-testid="login-submit"
                        >
                            {loading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Signing in…
                                </span>
                            ) : 'Sign In'}
                        </button>
                    </form>

                    {/* Forgot password */}
                    <p className="text-center text-xs mt-4" style={{ color: 'var(--text-muted, #9CA3AF)' }}>
                        Forgot your password?{' '}
                        <Link to="/forgot-password" className="font-semibold" style={{ color: '#7C3AED' }}>
                            Reset it here
                        </Link>
                    </p>
                </div>
            </div>

            {/* ── Right panel — illustration ── */}
            <div className="hidden lg:flex flex-1 flex-col items-center justify-center relative overflow-hidden"
                style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 50%, #4C1D95 100%)' }}
            >
                {/* Decorative blobs */}
                <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }} />
                <div className="absolute -bottom-16 -left-16 w-72 h-72 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }} />
                <div className="absolute top-1/3 right-1/4 w-48 h-48 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }} />

                <div className="relative z-10 text-center px-16 max-w-lg">
                    {/* Icon */}
                    <div className="w-24 h-24 rounded-3xl mx-auto mb-8 flex items-center justify-center"
                        style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(12px)', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}
                    >
                        <UtensilsCrossed className="w-12 h-12 text-white" strokeWidth={1.5} />
                    </div>

                    <h2 className="text-3xl font-bold text-white mb-4 leading-tight">
                        Manage your store smarter
                    </h2>
                    <p className="text-violet-200 text-base leading-relaxed mb-10">
                        Real-time inventory, POS, employees, suppliers and analytics — all in one place.
                    </p>

                    {/* Feature pills */}
                    <div className="flex flex-wrap gap-2 justify-center">
                        {['Real-time Sync', 'Multi-branch', 'POS Ready', 'Analytics', 'Dark Mode'].map(f => (
                            <span key={f} className="px-4 py-1.5 rounded-full text-xs font-semibold text-white"
                                style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.2)' }}>
                                {f}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
