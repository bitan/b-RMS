import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Search, Plus, Trash2, Edit2, Users, Phone, Shield, DollarSign, Calendar, X, ChevronDown, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { ROLES, ROLE_LABELS, creatableEmployeeRoles } from '../lib/roles';
import { useEntityUpdates } from '../hooks/useEntityUpdates';

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;

const roleConfig = {
    [ROLES.OWNER]:        { label: 'Owner',              gradient: 'from-amber-500 to-orange-600',   bg: 'bg-amber-100 text-amber-700' },
    [ROLES.MANAGER]:      { label: 'Restaurant Manager', gradient: 'from-violet-500 to-purple-600',  bg: 'bg-violet-100 text-violet-700' },
    [ROLES.ROOM_MANAGER]: { label: 'Room Manager',       gradient: 'from-blue-500 to-indigo-600',    bg: 'bg-blue-100 text-blue-700' },
    [ROLES.SERVER]:       { label: 'Server',             gradient: 'from-emerald-500 to-teal-600',   bg: 'bg-emerald-100 text-emerald-700' },
    [ROLES.BARTENDER]:    { label: 'Bartender',          gradient: 'from-pink-500 to-rose-500',      bg: 'bg-pink-100 text-pink-700' },
    [ROLES.KITCHEN]:      { label: 'Kitchen Staff',      gradient: 'from-red-500 to-orange-500',     bg: 'bg-red-100 text-red-700' },
    [ROLES.CASHIER]:      { label: 'Cashier',            gradient: 'from-sky-500 to-blue-500',       bg: 'bg-sky-100 text-sky-700' },
};

const initialEmployee   = { name:'', email:'', password:'', phone:'', role: ROLES.SERVER, salary:'', hire_date: new Date().toISOString().split('T')[0], branch_id: '' };
const initialEditEmployee = { name:'', phone:'', role:'', salary:'', hire_date:'', password:'' };

const inputStyle = { background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' };

const Field = ({ label, children }) => (
    <div>
        <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</label>
        {children}
    </div>
);

export const Employees = () => {
    const { user } = useAuth();
    const [employees, setEmployees] = useState([]);
    const [branches, setBranches] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedRole, setSelectedRole] = useState('all');
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [createFormData, setCreateFormData] = useState(initialEmployee);
    const [showEditModal, setShowEditModal] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState(null);
    const [editFormData, setEditFormData] = useState(initialEditEmployee);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [employeeToDelete, setEmployeeToDelete] = useState(null);

    const fetchEmployees = useCallback(async () => {
        try {
            const [empRes, branchRes] = await Promise.all([
                axios.get(`${API}/employees`, { withCredentials: true }),
                axios.get(`${API}/branches`, { withCredentials: true }),
            ]);
            setEmployees(empRes.data);
            setBranches(branchRes.data);
        } catch { toast.error('Failed to load employees'); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchEmployees(); }, [fetchEmployees]);
    useEntityUpdates('employee', fetchEmployees);

    const filtered = employees.filter(e =>
        (e.name.toLowerCase().includes(searchTerm.toLowerCase()) || e.email.toLowerCase().includes(searchTerm.toLowerCase())) &&
        (selectedRole === 'all' || e.role === selectedRole)
    );

    const handleCreate = async (ev) => {
        ev.preventDefault();
        try {
            await axios.post(`${API}/employees`, { ...createFormData, salary: parseFloat(createFormData.salary) }, { withCredentials: true });
            toast.success('Employee created');
            setShowCreateModal(false);
            fetchEmployees();
        } catch (e) { toast.error(e.response?.data?.detail || 'Failed to create employee'); }
    };

    const handleEdit = async (ev) => {
        ev.preventDefault();
        const payload = {};
        if (editFormData.name)      payload.name      = editFormData.name;
        if (editFormData.phone)     payload.phone     = editFormData.phone;
        if (editFormData.role)      payload.role      = editFormData.role;
        if (editFormData.salary)    payload.salary    = parseFloat(editFormData.salary);
        if (editFormData.hire_date) payload.hire_date = editFormData.hire_date;
        if (editFormData.password)  payload.password  = editFormData.password;
        try {
            await axios.put(`${API}/employees/${editingEmployee.id}`, payload, { withCredentials: true });
            toast.success('Employee updated');
            setShowEditModal(false);
            fetchEmployees();
        } catch (e) { toast.error(e.response?.data?.detail || 'Failed to update employee'); }
    };

    const handleDelete = async () => {
        try {
            await axios.delete(`${API}/employees/${employeeToDelete.id}`, { withCredentials: true });
            toast.success('Employee deleted');
            setShowDeleteDialog(false);
            fetchEmployees();
        } catch (e) { toast.error(e.response?.data?.detail || 'Failed to delete employee'); }
    };

    const handleToggleStatus = async (emp) => {
        const action = emp.is_active !== false ? 'deactivate' : 'activate';
        try {
            const res = await axios.put(`${API}/employees/${emp.id}/toggle-status`, {}, { withCredentials: true });
            toast.success(`Employee ${res.data.is_active ? 'activated' : 'deactivated'} successfully`);
            fetchEmployees();
        } catch (e) { toast.error(e.response?.data?.detail || `Failed to ${action} employee`); }
    };

    const handleResetPassword = async (emp) => {
        if (!window.confirm(`Reset password for ${emp.name}? A temporary password will be generated and they must change it on next login.`)) return;
        try {
            const res = await axios.post(`${API}/employees/${emp.id}/reset-password`, {}, { withCredentials: true });
            toast.success(`Password reset for ${emp.name}`, { duration: 10000 });
            // Show the temp password in an alert so manager can share it
            window.alert(`Temporary password for ${emp.name}:\n\n${res.data.temp_password}\n\nThey must change it on first login.`);
            fetchEmployees();
        } catch (e) { toast.error(e.response?.data?.detail || 'Failed to reset password'); }
    };

    const roleCounts = employees.reduce((a, e) => { a[e.role] = (a[e.role]||0)+1; return a; }, {});

    return (
        <div className="p-6 lg:p-8 space-y-6" data-testid="employees-page">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Employees</h1>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {employees.length} total · {roleCounts[ROLES.SERVER]||0} servers · {roleCounts[ROLES.BARTENDER]||0} bartenders · {roleCounts[ROLES.KITCHEN]||0} kitchen
                    </p>
                </div>
                <button onClick={() => { setCreateFormData(initialEmployee); setShowCreateModal(true); }} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:-translate-y-0.5" style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)', boxShadow: '0 4px 14px rgba(245,158,11,0.35)' }} data-testid="add-employee-btn">
                    <Plus className="w-4 h-4" />Add Staff
                </button>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                    <input type="text" placeholder="Search employees…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
                        style={inputStyle} data-testid="employee-search" />
                </div>
                <div className="relative">
                    <select value={selectedRole} onChange={e => setSelectedRole(e.target.value)}
                        className="pl-4 pr-8 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all appearance-none cursor-pointer"
                        style={inputStyle} data-testid="employee-role-filter">
                        <option value="all">All Roles</option>
                        {Object.entries(roleConfig).map(([k, v]) => (
                            <option key={k} value={k}>{v.label}</option>
                        ))}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                </div>
            </div>

            {/* Table */}
            <div className="card-soft overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="data-table">
                        <thead>
                            <tr><th>Employee</th><th>Role</th><th>Branch</th><th>Contact</th><th>Salary</th><th>Hire Date</th><th className="text-right">Actions</th></tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 ? (
                                <tr><td colSpan={6} className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
                                    <Users className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>No employees found</p>
                                </td></tr>
                            ) : filtered.map(emp => {
                                const rc = roleConfig[emp.role] || roleConfig[ROLES.CASHIER];
                                const initials = emp.name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
                                return (
                                    <tr key={emp.id} data-testid={`employee-row-${emp.id}`} style={{ opacity: emp.is_active === false ? 0.5 : 1 }}>
                                        <td>
                                            <div className="flex items-center gap-3">
                                                <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${rc.gradient} flex items-center justify-center text-white text-xs font-bold shadow flex-shrink-0`}>{initials}</div>
                                                <div>
                                                    <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{emp.name}</p>
                                                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{emp.email}</p>
                                                    {emp.is_active === false && (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-600 mt-0.5">
                                                            Inactive
                                                        </span>
                                                    )}
                                                    {emp.force_password_change && emp.is_active !== false && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 mt-0.5">
                                                            🔐 Pending password setup
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td><span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${rc.bg}`}><Shield className="w-3 h-3" />{rc.label}</span></td>
                                        <td>
                                            {emp.branch_id
                                                ? <span className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: 'var(--purple-100,#EDE9FE)', color: 'var(--purple-700,#6D28D9)' }}>
                                                    {branches.find(b => b.id === emp.branch_id)?.name || 'Unknown'}
                                                  </span>
                                                : <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: '#FEF3C7', color: '#92400E' }}>Unassigned</span>
                                            }
                                        </td>
                                        <td>{emp.phone && <span className="flex items-center gap-1 text-sm" style={{ color: 'var(--text-secondary)' }}><Phone className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />{emp.phone}</span>}</td>
                                        <td>{emp.salary ? <span className="flex items-center gap-1 text-sm font-medium" style={{ color: 'var(--text-primary)' }}><DollarSign className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />{emp.salary.toLocaleString()}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                                        <td>{emp.hire_date ? <span className="flex items-center gap-1 text-sm" style={{ color: 'var(--text-secondary)' }}><Calendar className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />{emp.hire_date}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                                        <td className="text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                <button onClick={() => { setEditingEmployee(emp); setEditFormData({ name: emp.name, phone: emp.phone||'', role: emp.role, salary: emp.salary?.toString()||'', hire_date: emp.hire_date||'', password:'' }); setShowEditModal(true); }} className="p-2 rounded-xl transition-colors hover:bg-amber-50 dark:hover:bg-amber-900/30" style={{ color: 'var(--text-muted)' }} data-testid={`edit-employee-${emp.id}`}><Edit2 className="w-4 h-4" /></button>
                                                <button onClick={() => handleResetPassword(emp)} className="p-2 rounded-xl transition-colors hover:bg-violet-50 text-violet-500 hover:text-violet-700" title="Reset Password"><KeyRound className="w-4 h-4" /></button>
                                                <button
                                                    onClick={() => handleToggleStatus(emp)}
                                                    className={`p-2 rounded-xl transition-colors text-xs font-semibold ${emp.is_active !== false ? 'hover:bg-amber-50 text-amber-500 hover:text-amber-700' : 'hover:bg-emerald-50 text-emerald-500 hover:text-emerald-700'}`}
                                                    title={emp.is_active !== false ? 'Deactivate' : 'Activate'}
                                                    data-testid={`toggle-status-${emp.id}`}
                                                >
                                                    {emp.is_active !== false ? '⏸' : '▶'}
                                                </button>
                                                <button onClick={() => { setEmployeeToDelete(emp); setShowDeleteDialog(true); }} className="p-2 rounded-xl transition-colors hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 hover:text-red-600" data-testid={`delete-employee-${emp.id}`}><Trash2 className="w-4 h-4" /></button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Create Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-md rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto" style={{ background: 'var(--bg-card)' }}>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Add Employee</h3>
                            <button onClick={() => setShowCreateModal(false)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800" style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                        </div>
                        <form onSubmit={handleCreate} className="space-y-4">
                            <Field label="Full Name"><input value={createFormData.name} onChange={e=>setCreateFormData({...createFormData,name:e.target.value})} required className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all" style={inputStyle} data-testid="employee-name-input" /></Field>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Email"><input type="email" value={createFormData.email} onChange={e=>setCreateFormData({...createFormData,email:e.target.value})} required className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all" style={inputStyle} data-testid="employee-email-input" /></Field>
                                <Field label="Password"><input type="password" value={createFormData.password} onChange={e=>setCreateFormData({...createFormData,password:e.target.value})} required className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all" style={inputStyle} data-testid="employee-password-input" /></Field>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Phone"><input value={createFormData.phone} onChange={e=>setCreateFormData({...createFormData,phone:e.target.value})} required className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all" style={inputStyle} data-testid="employee-phone-input" /></Field>
                                <Field label="Role">
                                    <div className="relative">
                                        <select value={createFormData.role} onChange={e=>setCreateFormData({...createFormData,role:e.target.value})} className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all appearance-none" style={inputStyle} data-testid="employee-role-select">
                                            {creatableEmployeeRoles(user?.role).map(r => <option key={r} value={r}>{roleConfig[r]?.label||r}</option>)}
                                        </select>
                                        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                                    </div>
                                </Field>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Salary"><input type="number" min="0" step="0.01" value={createFormData.salary} onChange={e=>setCreateFormData({...createFormData,salary:e.target.value})} required className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all" style={inputStyle} data-testid="employee-salary-input" /></Field>
                                <Field label="Hire Date"><input type="date" value={createFormData.hire_date} onChange={e=>setCreateFormData({...createFormData,hire_date:e.target.value})} required className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all" style={inputStyle} data-testid="employee-hire-date-input" /></Field>
                            </div>
                            {/* Branch selector — only shown to Super Admin */}
                            {user?.role === ROLES.OWNER && (
                                <Field label="Branch">
                                    <div className="relative">
                                        <select
                                            value={createFormData.branch_id}
                                            onChange={e => setCreateFormData({...createFormData, branch_id: e.target.value})}
                                            required={createFormData.role !== ROLES.OWNER}
                                            className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all appearance-none"
                                            style={inputStyle}
                                            data-testid="employee-branch-select"
                                        >
                                            <option value="">Select branch</option>
                                            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                        </select>
                                        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                                    </div>
                                </Field>
                            )}
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowCreateModal(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
                                <button type="submit" className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)', boxShadow: '0 4px 14px rgba(245,158,11,0.35)' }} data-testid="employee-submit-btn">Add Employee</button>
                            </div>
                            {/* Info notice about forced password change */}
                            <p className="text-xs text-center pt-1" style={{ color: 'var(--text-muted)' }}>
                                🔐 The employee will be prompted to set their own password on first login.
                            </p>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit Modal */}
            {showEditModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-md rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto" style={{ background: 'var(--bg-card)' }}>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Edit — {editingEmployee?.name}</h3>
                            <button onClick={() => setShowEditModal(false)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800" style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                        </div>
                        <form onSubmit={handleEdit} className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Full Name"><input value={editFormData.name} onChange={e=>setEditFormData({...editFormData,name:e.target.value})} className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all" style={inputStyle} data-testid="edit-employee-name-input" /></Field>
                                <Field label="Phone"><input value={editFormData.phone} onChange={e=>setEditFormData({...editFormData,phone:e.target.value})} className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all" style={inputStyle} data-testid="edit-employee-phone-input" /></Field>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Role">
                                    <div className="relative">
                                        <select value={editFormData.role} onChange={e=>setEditFormData({...editFormData,role:e.target.value})} className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all appearance-none" style={inputStyle} data-testid="edit-employee-role-select">
                                            {creatableEmployeeRoles(user?.role).map(r => <option key={r} value={r}>{roleConfig[r]?.label||r}</option>)}
                                        </select>
                                        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                                    </div>
                                </Field>
                                <Field label="Salary"><input type="number" min="0" step="0.01" value={editFormData.salary} onChange={e=>setEditFormData({...editFormData,salary:e.target.value})} className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all" style={inputStyle} data-testid="edit-employee-salary-input" /></Field>
                            </div>
                            <Field label="Hire Date"><input type="date" value={editFormData.hire_date} onChange={e=>setEditFormData({...editFormData,hire_date:e.target.value})} className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all" style={inputStyle} data-testid="edit-employee-hire-date-input" /></Field>
                            <Field label="New Password (leave blank to keep current)"><input type="password" value={editFormData.password} onChange={e=>setEditFormData({...editFormData,password:e.target.value})} placeholder="••••••••" className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all" style={inputStyle} data-testid="edit-employee-password-input" /></Field>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowEditModal(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
                                <button type="submit" className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)', boxShadow: '0 4px 14px rgba(245,158,11,0.35)' }} data-testid="edit-employee-submit-btn">Save Changes</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Delete confirm */}
            {showDeleteDialog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-sm rounded-3xl p-6 shadow-2xl" style={{ background: 'var(--bg-card)' }}>
                        <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Delete Employee</h3>
                        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Delete "{employeeToDelete?.name}"? This cannot be undone.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setShowDeleteDialog(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
                            <button onClick={handleDelete} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg,#EF4444,#DC2626)' }} data-testid="confirm-delete-employee-btn">Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
