import { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;

const AuthContext = createContext(null);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        checkAuth();
    }, []);

    const checkAuth = async () => {
        try {
            const response = await axios.get(`${API}/auth/me`, {
                withCredentials: true,
                timeout: 15000, // 15s timeout — handles cold start
            });
            setUser(response.data);
        } catch {
            setUser(false);
        } finally {
            setLoading(false);
        }
    };

    const login = async (email, password) => {
        const response = await axios.post(`${API}/auth/login`, { email, password }, { withCredentials: true });
        setUser(response.data);
        return response.data;
    };

    const logout = async () => {
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
