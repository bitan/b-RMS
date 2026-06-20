import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import axios from 'axios';
import { Loader2, UtensilsCrossed, CheckCircle, AlertCircle, KeyRound } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;

export const ResetPassword = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const token = searchParams.get('token') || '';

    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    // If no token in URL, show error immediately
    useEffect(() => {
        if (!token) setError('Invalid reset link. Please request a new one.');
    }, [token]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (newPassword !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }
        if (newPassword.length < 8) {
            setError('Password must be at least 8 characters');
            return;
        }

        setLoading(true);
        try {
            await axios.post(`${API}/auth/reset-password`, {
                token,
                new_password: newPassword,
            });
            setSuccess(true);
            // Redirect to login after 3 seconds
            setTimeout(() => navigate('/login'), 3000);
        } catch (err) {
            setError(err.response?.data?.detail || 'Failed to reset password. The link may have expired.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-6"
            style={{ background: 'var(--bg-page, #F0EEFF)' }}>
            <div className="w-full max-w-md">

                {/* Logo */}
                <div className="flex items-center gap-3 mb-8 justify-center">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg">
                        <UtensilsCrossed className="w-5 h-5 text-white" strokeWidth={2.5} />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold leading-tight" style={{ color: 'var(--text-primary, #1E1B4B)' }}>Bar & Restaurant</h1>
                        <p className="text-xs" style={{ color: 'var(--text-muted, #9CA3AF)' }}>Management System</p>
                    </div>
                </div>

                <div className="rounded-3xl p-8 shadow-xl" style={{ background: 'var(--bg-card, #ffffff)' }}>

                    {success ? (
                        /* ── Success state ── */
                        <div className="text-center">
                            <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                                <CheckCircle className="w-8 h-8 text-emerald-600" />
                            </div>
                            <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary, #1E1B4B)' }}>
                                Password Reset!
                            </h2>
                            <p className="text-sm mb-6" style={{ color: 'var(--text-muted, #9CA3AF)' }}>
                                Your password has been updated. Redirecting to login…
                            </p>
                            <Link to="/login"
                                className="inline-block px-6 py-2.5 rounded-xl text-sm font-semibold text-white"
                                style={{ background: 'linear-gradient(135deg,#7C3AED,#6D28D9)' }}>
                                Go to Login
                            </Link>
                        </div>
                    ) : (
                        /* ── Form state ── */
                        <>
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow">
                                    <KeyRound className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary, #1E1B4B)' }}>Set New Password</h2>
                                    <p className="text-xs" style={{ color: 'var(--text-muted, #9CA3AF)' }}>Choose a strong password</p>
                                </div>
                            </div>

                            {error && (
                                <div className="flex items-start gap-3 p-3 rounded-2xl mb-4 bg-red-50 border border-red-100">
                                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                                    <p className="text-sm text-red-600">{error}</p>
                                </div>
                            )}

                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div>
                                    <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider"
                                        style={{ color: 'var(--text-muted, #9CA3AF)' }}>
                                        New Password
                                    </label>
                                    <input
                                        type="password"
                                        value={newPassword}
                                        onChange={e => setNewPassword(e.target.value)}
                                        placeholder="Min. 8 characters with a number"
                                        required
                                        disabled={!token}
                                        className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all disabled:opacity-50"
                                        style={{ background: 'var(--bg-page, #F0EEFF)', borderColor: 'var(--border, #E5E7EB)', color: 'var(--text-primary, #1E1B4B)' }}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider"
                                        style={{ color: 'var(--text-muted, #9CA3AF)' }}>
                                        Confirm Password
                                    </label>
                                    <input
                                        type="password"
                                        value={confirmPassword}
                                        onChange={e => setConfirmPassword(e.target.value)}
                                        placeholder="Repeat your new password"
                                        required
                                        disabled={!token}
                                        className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all disabled:opacity-50"
                                        style={{ background: 'var(--bg-page, #F0EEFF)', borderColor: 'var(--border, #E5E7EB)', color: 'var(--text-primary, #1E1B4B)' }}
                                    />
                                </div>

                                <button
                                    type="submit"
                                    disabled={loading || !token}
                                    className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                                    style={{ background: 'linear-gradient(135deg,#7C3AED,#6D28D9)', boxShadow: '0 4px 14px rgba(124,58,237,0.35)' }}
                                >
                                    {loading ? (
                                        <span className="flex items-center justify-center gap-2">
                                            <Loader2 className="w-4 h-4 animate-spin" />Resetting…
                                        </span>
                                    ) : 'Reset Password'}
                                </button>
                            </form>

                            <p className="text-center text-xs mt-4" style={{ color: 'var(--text-muted, #9CA3AF)' }}>
                                Remember your password?{' '}
                                <Link to="/login" className="font-semibold" style={{ color: '#7C3AED' }}>Sign in</Link>
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
