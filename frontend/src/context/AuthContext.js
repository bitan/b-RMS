import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;

const AuthContext = createContext(null);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within AuthProvider');
    return context;
};

// Axios interceptor — auto-retry once on 401 by refreshing the token
let isRefreshing = false;
let refreshQueue = [];

const processQueue = (error) => {
    refreshQueue.forEach(({ resolve, reject }) => error ? reject(error) : resolve());
    refreshQueue = [];
};

axios.interceptors.response.use(
    res => res,
    async err => {
        const original = err.config;
        // If 401 and not already retried and not the auth endpoints themselves
        if (err.response?.status === 401 && !original._retry &&
            !original.url?.includes('/auth/login') &&
            !original.url?.includes('/auth/refresh')) {
            if (isRefreshing) {
                // Queue this request until the refresh completes
                return new Promise((resolve, reject) => {
                    refreshQueue.push({ resolve, reject });
                }).then(() => axios(original)).catch(e => Promise.reject(e));
            }
            original._retry = true;
            isRefreshing = true;
            try {
                await axios.post(`${API}/auth/refresh`, {}, { withCredentials: true });
                processQueue(null);
                return axios(original);
            } catch (refreshErr) {
                processQueue(refreshErr);
                // Refresh failed — user needs to log in again
                window.location.href = '/';
                return Promise.reject(refreshErr);
            } finally {
                isRefreshing = false;
            }
        }
        return Promise.reject(err);
    }
);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const refreshTimer = useRef(null);

    const scheduleRefresh = useCallback(() => {
        // Refresh token every 45 minutes (access token expires at 60 min)
        if (refreshTimer.current) clearInterval(refreshTimer.current);
        refreshTimer.current = setInterval(async () => {
            try {
                await axios.post(`${API}/auth/refresh`, {}, { withCredentials: true });
            } catch {
                // Refresh failed — recheck auth state
                checkAuth();
            }
        }, 45 * 60 * 1000); // 45 minutes
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const checkAuth = useCallback(async () => {
        try {
            const response = await axios.get(`${API}/auth/me`, {
                withCredentials: true,
                timeout: 15000,
            });
            setUser(response.data);
            scheduleRefresh();
        } catch {
            setUser(false);
            if (refreshTimer.current) clearInterval(refreshTimer.current);
        } finally {
            setLoading(false);
        }
    }, [scheduleRefresh]);

    useEffect(() => {
        checkAuth();
        return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
    }, [checkAuth]);

    const login = async (email, password) => {
        const response = await axios.post(`${API}/auth/login`, { email, password }, { withCredentials: true });
        setUser(response.data);
        scheduleRefresh();
        return response.data;
    };

    const logout = async () => {
        if (refreshTimer.current) clearInterval(refreshTimer.current);
        await axios.post(`${API}/auth/logout`, {}, { withCredentials: true });
        setUser(false);
    };

    const register = async (data) => {
        const response = await axios.post(`${API}/auth/register`, data, { withCredentials: true });
        setUser(response.data);
        return response.data;
    };

    return (
        <AuthContext.Provider value={{ user, loading, login, logout, register, checkAuth }}>
            {children}
        </AuthContext.Provider>
    );
};
