import { useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Loader2, UtensilsCrossed, Mail, CheckCircle, AlertCircle, ArrowLeft } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;

export const ForgotPassword = () => {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await axios.post(`${API}/auth/forgot-password`, { email });
            setSent(true);
        } catch (err) {
            // Rate limit or server error
            setError(err.response?.data?.detail || 'Something went wrong. Please try again.');
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

                    {sent ? (
                        /* ── Sent state ── */
                        <div className="text-center">
                            <div className="w-16 h-16 rounded-2xl bg-violet-100 flex items-center justify-center mx-auto mb-4">
                                <CheckCircle className="w-8 h-8 text-violet-600" />
                            </div>
                            <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary, #1E1B4B)' }}>
                                Check your email
                            </h2>
                            <p className="text-sm mb-2" style={{ color: 'var(--text-muted, #9CA3AF)' }}>
                                If <strong>{email}</strong> is registered, we've sent a password reset link.
                            </p>
                            <p className="text-xs mb-6" style={{ color: 'var(--text-muted, #9CA3AF)' }}>
                                The link expires in 30 minutes. Check your spam folder if you don't see it.
                            </p>
                            <div className="space-y-2">
                                <button
                                    onClick={() => { setSent(false); setEmail(''); }}
                                    className="w-full py-2.5 rounded-xl text-sm font-semibold border transition-colors hover:bg-violet-50"
                                    style={{ borderColor: 'var(--border, #E5E7EB)', color: 'var(--text-secondary, #6B7280)' }}
                                >
                                    Try a different email
                                </button>
                                <Link to="/login"
                                    className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold text-white"
                                    style={{ background: 'linear-gradient(135deg,#7C3AED,#6D28D9)' }}>
                                    <ArrowLeft className="w-4 h-4" />Back to Login
                                </Link>
                            </div>
                        </div>
                    ) : (
                        /* ── Form state ── */
                        <>
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow">
                                    <Mail className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary, #1E1B4B)' }}>Forgot Password?</h2>
                                    <p className="text-xs" style={{ color: 'var(--text-muted, #9CA3AF)' }}>We'll send a reset link to your email</p>
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
                                        Email Address
                                    </label>
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={e => setEmail(e.target.value)}
                                        placeholder="your@email.com"
                                        required
                                        className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all"
                                        style={{ background: 'var(--bg-page, #F0EEFF)', borderColor: 'var(--border, #E5E7EB)', color: 'var(--text-primary, #1E1B4B)' }}
                                    />
                                </div>

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                                    style={{ background: 'linear-gradient(135deg,#7C3AED,#6D28D9)', boxShadow: '0 4px 14px rgba(124,58,237,0.35)' }}
                                >
                                    {loading ? (
                                        <span className="flex items-center justify-center gap-2">
                                            <Loader2 className="w-4 h-4 animate-spin" />Sending…
                                        </span>
                                    ) : 'Send Reset Link'}
                                </button>
                            </form>

                            <p className="text-center text-xs mt-4" style={{ color: 'var(--text-muted, #9CA3AF)' }}>
                                <Link to="/login" className="flex items-center justify-center gap-1 font-semibold" style={{ color: '#7C3AED' }}>
                                    <ArrowLeft className="w-3 h-3" />Back to Login
                                </Link>
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
