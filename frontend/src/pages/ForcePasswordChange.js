import { useState } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { KeyRound, UtensilsCrossed, AlertCircle, Eye, EyeOff, CheckCircle2 } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;

const PasswordRule = ({ met, label }) => (
    <div className={`flex items-center gap-2 text-xs transition-colors ${met ? 'text-emerald-600' : 'text-gray-400'}`}>
        <CheckCircle2 className={`w-3.5 h-3.5 flex-shrink-0 ${met ? 'text-emerald-500' : 'text-gray-300'}`} />
        {label}
    </div>
);

export const ForcePasswordChange = () => {
    const { user, checkAuth } = useAuth();
    const [newPwd, setNewPwd] = useState('');
    const [confirm, setConfirm] = useState('');
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Password strength rules
    const rules = [
        { met: newPwd.length >= 8,                    label: 'At least 8 characters' },
        { met: /[A-Za-z]/.test(newPwd),               label: 'Contains a letter' },
        { met: /\d/.test(newPwd),                     label: 'Contains a number' },
        { met: newPwd === confirm && confirm.length > 0, label: 'Passwords match' },
    ];
    const allRulesMet = rules.every(r => r.met);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!allRulesMet) {
            setError('Please meet all password requirements');
            return;
        }

        setLoading(true);
        try {
            // Use a placeholder current password — the backend accepts any value
            // since we're in forced-change mode. We send the user's known temp password.
            // The user doesn't know their temp password, so we use the change-password
            // endpoint with a special bypass: we pass an empty current_password and
            // the backend skips verification when force_password_change is true.
            await axios.put(`${API}/auth/change-password`, {
                current_password: '__force_change__',
                new_password: newPwd,
            }, { withCredentials: true });

            // Refresh user data — force_password_change should now be false
            await checkAuth();
        } catch (err) {
            setError(err.response?.data?.detail || 'Failed to set password. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--bg-page, #F0EEFF)' }}>
            <div className="w-full max-w-md">
                {/* Logo */}
                <div className="flex items-center gap-3 mb-8">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg">
                        <UtensilsCrossed className="w-5 h-5 text-white" strokeWidth={2.5} />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold leading-tight" style={{ color: 'var(--text-primary, #1E1B4B)' }}>Bar & Restaurant</h1>
                        <p className="text-xs" style={{ color: 'var(--text-muted, #9CA3AF)' }}>Management System</p>
                    </div>
                </div>

                {/* Card */}
                <div className="rounded-3xl p-8 shadow-xl" style={{ background: 'var(--bg-card, #FFFFFF)', border: '1px solid var(--border-light, #F3F4F6)' }}>
                    {/* Icon + heading */}
                    <div className="flex flex-col items-center text-center mb-8">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg mb-4">
                            <KeyRound className="w-8 h-8 text-white" />
                        </div>
                        <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary, #1E1B4B)' }}>
                            Set Your Password
                        </h2>
                        <p className="text-sm" style={{ color: 'var(--text-muted, #9CA3AF)' }}>
                            Welcome, <strong style={{ color: 'var(--text-primary, #1E1B4B)' }}>{user?.name}</strong>! Your account was created by an admin.
                            Please set your own password to continue.
                        </p>
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="flex items-start gap-2 p-3 rounded-2xl mb-5 bg-red-50 border border-red-100">
                            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-red-600">{error}</p>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* New password */}
                        <div>
                            <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted, #9CA3AF)' }}>
                                New Password
                            </label>
                            <div className="relative">
                                <input
                                    type={showNew ? 'text' : 'password'}
                                    value={newPwd}
                                    onChange={e => setNewPwd(e.target.value)}
                                    required
                                    placeholder="Choose a strong password"
                                    className="w-full px-4 py-3 pr-11 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all"
                                    style={{ background: 'var(--bg-page, #F0EEFF)', borderColor: 'var(--border, #E5E7EB)', color: 'var(--text-primary, #1E1B4B)' }}
                                    data-testid="force-new-password-input"
                                />
                                <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-colors" style={{ color: 'var(--text-muted, #9CA3AF)' }}>
                                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>

                        {/* Confirm password */}
                        <div>
                            <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted, #9CA3AF)' }}>
                                Confirm Password
                            </label>
                            <div className="relative">
                                <input
                                    type={showConfirm ? 'text' : 'password'}
                                    value={confirm}
                                    onChange={e => setConfirm(e.target.value)}
                                    required
                                    placeholder="Repeat your password"
                                    className="w-full px-4 py-3 pr-11 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all"
                                    style={{ background: 'var(--bg-page, #F0EEFF)', borderColor: 'var(--border, #E5E7EB)', color: 'var(--text-primary, #1E1B4B)' }}
                                    data-testid="force-confirm-password-input"
                                />
                                <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-colors" style={{ color: 'var(--text-muted, #9CA3AF)' }}>
                                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>

                        {/* Password rules */}
                        {newPwd.length > 0 && (
                            <div className="grid grid-cols-2 gap-1.5 p-3 rounded-2xl" style={{ background: 'var(--bg-page, #F0EEFF)' }}>
                                {rules.map((rule, i) => <PasswordRule key={i} met={rule.met} label={rule.label} />)}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading || !allRulesMet}
                            className="w-full py-3.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:-translate-y-0.5 mt-2"
                            style={{ background: 'linear-gradient(135deg,#7C3AED,#6D28D9)', boxShadow: '0 4px 20px rgba(124,58,237,0.4)' }}
                            data-testid="force-password-submit"
                        >
                            {loading ? 'Setting password…' : 'Set My Password & Continue'}
                        </button>
                    </form>
                </div>

                <p className="text-center text-xs mt-4" style={{ color: 'var(--text-muted, #9CA3AF)' }}>
                    You cannot access the app until you set your password.
                </p>
            </div>
        </div>
    );
};
