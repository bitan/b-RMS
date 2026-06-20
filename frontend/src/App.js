import { useState, useEffect } from "react";
import "@/App.css";
import axios from "axios";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { WebSocketProvider } from "./context/WebSocketContext";
import { NotificationProvider } from "./context/NotificationContext";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { ForcePasswordChange } from "./pages/ForcePasswordChange";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ResetPassword } from "./pages/ResetPassword";
import { Dashboard } from "./pages/Dashboard";
import { POS } from "./pages/POS";
import { Inventory } from "./pages/Inventory";
import { Suppliers } from "./pages/Suppliers";
import { Employees } from "./pages/Employees";
import { Reports } from "./pages/Reports";
import { ShiftReport } from "./pages/ShiftReport";
import { AuditLog } from "./pages/AuditLog";
import { Branches } from "./pages/Branches";
import { PurchaseOrders } from "./pages/PurchaseOrders";
import { Rooms } from "./pages/Rooms";
import { Reservations } from "./pages/Reservations";
import { KitchenDisplay } from "./pages/KitchenDisplay";
import { BarDisplay } from "./pages/BarDisplay";
import { MenuItems } from "./pages/MenuItems";
import { OrderDisplay } from "./pages/OrderDisplay";
import { Toaster } from "./components/ui/sonner";
import { Loader2 } from "lucide-react";
import { ROLES } from "./lib/roles";

const getRoleDefaultPage = (role) => {
  switch (role) {
    case ROLES.OWNER:
    case ROLES.MANAGER:
      return '/';
    case ROLES.ROOM_MANAGER:
      return '/orders';      // See room orders + place new ones
    case ROLES.SERVER:
      return '/orders';      // Track own orders first
    case ROLES.BARTENDER:
      return '/bar';         // Bar display
    case ROLES.KITCHEN:
      return '/kitchen';     // Kitchen display
    case ROLES.CASHIER:
      return '/orders';      // Cashier tracks all orders + payments
    default:
      return '/';
  }
};

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, loading } = useAuth();
  const [slowLoad, setSlowLoad] = useState(false);

  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setSlowLoad(true), 3000);
    return () => clearTimeout(t);
  }, [loading]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ background: 'var(--bg-page, #F0EEFF)' }}>
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg">
          <Loader2 className="w-6 h-6 text-white animate-spin" />
        </div>
        {slowLoad && (
          <div className="text-center">
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary, #1E1B4B)' }}>Waking up the server…</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted, #9CA3AF)' }}>Free tier cold start — usually takes 30–60 seconds</p>
          </div>
        )}
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.force_password_change) return <ForcePasswordChange />;
  if (allowedRoles && !allowedRoles.includes(user.role)) return <Navigate to={getRoleDefaultPage(user.role)} replace />;
  return <Layout>{children}</Layout>;
};

const PublicRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-page, #F0EEFF)' }}>
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    );
  }

  if (user) {
    return <Navigate to={getRoleDefaultPage(user.role)} replace />;
  }

  return children;
};

function AppRoutes() {
  return (
    <Routes>
      {/* ── Public ── */}
      <Route path="/login"          element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
      <Route path="/reset-password"  element={<PublicRoute><ResetPassword /></PublicRoute>} />

      {/* ── Management (Owner + Manager) ── */}
      <Route path="/" element={
        <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.MANAGER, ROLES.ROOM_MANAGER, ROLES.SERVER, ROLES.BARTENDER, ROLES.KITCHEN, ROLES.CASHIER]}>
          <Dashboard />
        </ProtectedRoute>
      } />

      {/* ── Rooms & Reservations ── */}
      <Route path="/rooms" element={
        <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.MANAGER, ROLES.ROOM_MANAGER, ROLES.SERVER, ROLES.CASHIER]}>
          <Rooms />
        </ProtectedRoute>
      } />
      <Route path="/reservations" element={
        <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.MANAGER, ROLES.ROOM_MANAGER, ROLES.SERVER, ROLES.CASHIER]}>
          <Reservations />
        </ProtectedRoute>
      } />

      {/* ── POS / Order Ticket — CHANGE: room_manager added ── */}
      <Route path="/pos" element={
        <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.MANAGER, ROLES.ROOM_MANAGER, ROLES.SERVER, ROLES.BARTENDER, ROLES.CASHIER]}>
          <POS />
        </ProtectedRoute>
      } />

      {/* ── Kitchen Display — CHANGE: bartender removed ── */}
      <Route path="/kitchen" element={
        <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.MANAGER, ROLES.KITCHEN]}>
          <KitchenDisplay />
        </ProtectedRoute>
      } />

      {/* ── Bar Display — CHANGE: kitchen staff removed ── */}
      <Route path="/bar" element={
        <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.MANAGER, ROLES.BARTENDER]}>
          <BarDisplay />
        </ProtectedRoute>
      } />

      {/* ── Menu Management ── */}
      <Route path="/menu" element={
        <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.MANAGER]}>
          <MenuItems />
        </ProtectedRoute>
      } />

      {/* ── Inventory (Ingredients) ── */}
      <Route path="/inventory" element={
        <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.MANAGER]}>
          <Inventory />
        </ProtectedRoute>
      } />

      {/* ── Suppliers ── */}
      <Route path="/suppliers" element={
        <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.MANAGER]}>
          <Suppliers />
        </ProtectedRoute>
      } />
      <Route path="/purchase-orders" element={
        <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.MANAGER]}>
          <PurchaseOrders />
        </ProtectedRoute>
      } />

      {/* ── Order Display (Cashier + Server tracking) ── */}
      <Route path="/orders" element={
        <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER, ROLES.SERVER, ROLES.ROOM_MANAGER, ROLES.BARTENDER]}>
          <OrderDisplay />
        </ProtectedRoute>
      } />
      <Route path="/employees" element={
        <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.MANAGER]}>
          <Employees />
        </ProtectedRoute>
      } />
      <Route path="/shifts" element={
        <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER, ROLES.SERVER, ROLES.BARTENDER, ROLES.KITCHEN, ROLES.ROOM_MANAGER]}>
          <ShiftReport />
        </ProtectedRoute>
      } />

      {/* ── Reports & Admin ── */}
      <Route path="/reports" element={
        <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.MANAGER]}>
          <Reports />
        </ProtectedRoute>
      } />
      <Route path="/branches" element={
        <ProtectedRoute allowedRoles={[ROLES.OWNER]}>
          <Branches />
        </ProtectedRoute>
      } />
      <Route path="/audit-log" element={
        <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.MANAGER]}>
          <AuditLog />
        </ProtectedRoute>
      } />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// ── Axios global defaults ────────────────────────────────────────────────────
axios.defaults.timeout = 15000;
axios.interceptors.request.use((config) => {
  const url = config.url || '';
  if (url.includes('/orders') || url.includes('/upload-image') || url.includes('/purchase-orders')) {
    config.timeout = 30000;
  }
  return config;
});
axios.defaults.withCredentials = true;

// Keep-alive ping for free-tier deployments
const BACKEND = process.env.REACT_APP_BACKEND_URL || window.location.origin;
if (BACKEND.includes('railway.app') || BACKEND.includes('onrender.com')) {
  setInterval(() => {
    fetch(`${BACKEND}/health/live`).catch(() => {});
  }, 14 * 60 * 1000);
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <WebSocketProvider>
          <NotificationProvider>
            <AppRoutes />
            <Toaster position="top-right" richColors />
          </NotificationProvider>
        </WebSocketProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
