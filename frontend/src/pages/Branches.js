import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Building2, Plus, Edit2, Trash2, Phone, MapPin, User, Users, X, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { useEntityUpdates } from '../hooks/useEntityUpdates';

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;
const initialBranch = { name: '', address: '', phone: '', manager_name: '' };
const inputStyle = { background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' };

const Field = ({ label, children }) => (
    <div>
        <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</label>
        {children}
    </div>
);

export const Branches = () => {
    const [branches, setBranches] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [showAssignDialog, setShowAssignDialog] = useState(false);
    const [editingBranch, setEditingBranch] = useState(null);
    const [formData, setFormData] = useState(initialBranch);
    const [branchToDelete, setBranchToDelete] = useState(null);
    const [selectedEmployee, setSelectedEmployee] = useState(null);
    const [assignBranchId, setAssignBranchId] = useState('');

    const fetchData = useCallback(async () => {
        try {
            const [br, em] = await Promise.all([
                axios.get(`${API}/branches`, { withCredentials: true }),
                axios.get(`${API}/employees`, { withCredentials: true }),
            ]);
            setBranches(br.data);
            setEmployees(em.data);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);
    useEntityUpdates(['branch', 'employee'], fetchData);

    const handleOpenModal = (branch = null) => {
        setEditingBranch(branch);
        setFormData(branch ? { name: branch.name, address: branch.address||'', phone: branch.phone||'', manager_name: branch.manager_name||'' } : initialBranch);
        setShowModal(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            if (editingBranch) {
                await axios.put(`${API}/branches/${editingBranch.id}`, formData, { withCredentials: true });
                toast.success('Branch updated');
            } else {
                await axios.post(`${API}/branches`, formData, { withCredentials: true });
                toast.success('Branch created');
            }
            setShowModal(false);
            fetchData();
        } catch (e) { toast.error(e.response?.data?.detail || 'Failed to save branch'); }
    };

    const handleDelete = async () => {
        try {
            await axios.delete(`${API}/branches/${branchToDelete.id}`, { withCredentials: true });
            toast.success('Branch deleted');
            setShowDeleteDialog(false);
            fetchData();
        } catch { toast.error('Failed to delete branch'); }
    };

    const handleAssignBranch = async () => {
        try {
            await axios.put(`${API}/employees/${selectedEmployee.id}/assign-branch`, { branch_id: assignBranchId }, { withCredentials: true });
            toast.success(`${selectedEmployee.name} assigned`);
            setShowAssignDialog(false);
            fetchData();
        } catch { toast.error('Failed to assign branch'); }
    };

    const getBranchName = (id) => branches.find(b => b.id === id)?.name || 'Unassigned';

    const gradients = ['from-violet-500 to-purple-600', 'from-blue-500 to-indigo-600', 'from-emerald-500 to-teal-600', 'from-orange-500 to-amber-500'];

    return (
        <div className="p-6 lg:p-8 space-y-6" data-testid="branches-page">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Branches</h1>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{branches.length} branches</p>
                </div>
                <button onClick={() => handleOpenModal()} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:-translate-y-0.5" style={{ background: 'linear-gradient(135deg,#7C3AED,#6D28D9)', boxShadow: '0 4px 14px rgba(124,58,237,0.35)' }} data-testid="add-branch-btn">
                    <Plus className="w-4 h-4" />Add Branch
                </button>
            </div>

            {/* Branch cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {branches.map((branch, idx) => {
                    const branchEmps = employees.filter(e => e.branch_id === branch.id);
                    return (
                        <div key={branch.id} className="card-soft p-5 hover:-translate-y-1 transition-all duration-200" data-testid={`branch-card-${branch.id}`}>
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${gradients[idx % gradients.length]} flex items-center justify-center shadow`}>
                                        <Building2 className="w-5 h-5 text-white" />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{branch.name}</h3>
                                        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'var(--purple-100,#EDE9FE)', color: 'var(--purple-700,#6D28D9)' }}>
                                            {branchEmps.length} staff
                                        </span>
                                    </div>
                                </div>
                                <div className="flex gap-1">
                                    <button onClick={() => handleOpenModal(branch)} className="p-2 rounded-xl transition-colors hover:bg-violet-50 dark:hover:bg-violet-900/30" style={{ color: 'var(--text-muted)' }}><Edit2 className="w-4 h-4" /></button>
                                    <button onClick={() => { setBranchToDelete(branch); setShowDeleteDialog(true); }} className="p-2 rounded-xl transition-colors hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                {branch.address && <div className="flex items-start gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}><MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }} />{branch.address}</div>}
                                {branch.phone && <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}><Phone className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />{branch.phone}</div>}
                                {branch.manager_name && <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}><User className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />{branch.manager_name}</div>}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Staff assignments */}
            <div className="card-soft overflow-hidden">
                <div className="flex items-center gap-2 px-6 py-4 border-b" style={{ borderColor: 'var(--border-light)' }}>
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                        <Users className="w-4 h-4 text-white" />
                    </div>
                    <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Staff Branch Assignments</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="data-table">
                        <thead><tr><th>Employee</th><th>Role</th><th>Current Branch</th><th className="text-right">Actions</th></tr></thead>
                        <tbody>
                            {employees.map(emp => (
                                <tr key={emp.id}>
                                    <td className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{emp.name}</td>
                                    <td><span className="px-2.5 py-1 rounded-full text-xs font-medium capitalize" style={{ background: 'var(--purple-100,#EDE9FE)', color: 'var(--purple-700,#6D28D9)' }}>{emp.role.replace('_',' ')}</span></td>
                                    <td><span className="px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: 'var(--bg-page)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>{getBranchName(emp.branch_id)}</span></td>
                                    <td className="text-right">
                                        <button onClick={() => { setSelectedEmployee(emp); setAssignBranchId(emp.branch_id||''); setShowAssignDialog(true); }} className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors hover:bg-violet-50 dark:hover:bg-violet-900/30" style={{ color: 'var(--purple-600,#7C3AED)' }} data-testid={`assign-branch-${emp.id}`}>Reassign</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Branch modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-md rounded-3xl p-6 shadow-2xl" style={{ background: 'var(--bg-card)' }}>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{editingBranch ? 'Edit Branch' : 'Add Branch'}</h3>
                            <button onClick={() => setShowModal(false)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800" style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                        </div>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <Field label="Branch Name"><input value={formData.name} onChange={e=>setFormData({...formData,name:e.target.value})} required className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all" style={inputStyle} data-testid="branch-name-input" /></Field>
                            <Field label="Address"><input value={formData.address} onChange={e=>setFormData({...formData,address:e.target.value})} className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all" style={inputStyle} data-testid="branch-address-input" /></Field>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Phone"><input value={formData.phone} onChange={e=>setFormData({...formData,phone:e.target.value})} className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all" style={inputStyle} data-testid="branch-phone-input" /></Field>
                                <Field label="Manager"><input value={formData.manager_name} onChange={e=>setFormData({...formData,manager_name:e.target.value})} className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all" style={inputStyle} data-testid="branch-manager-input" /></Field>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
                                <button type="submit" className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg,#7C3AED,#6D28D9)', boxShadow: '0 4px 14px rgba(124,58,237,0.35)' }} data-testid="branch-submit-btn">{editingBranch ? 'Update' : 'Create'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Assign dialog */}
            {showAssignDialog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-sm rounded-3xl p-6 shadow-2xl" style={{ background: 'var(--bg-card)' }}>
                        <h3 className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Assign Branch</h3>
                        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>Assign {selectedEmployee?.name} to a branch</p>
                        <div className="relative mb-6">
                            <select value={assignBranchId} onChange={e => setAssignBranchId(e.target.value)} className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all appearance-none" style={inputStyle} data-testid="assign-branch-select">
                                <option value="">Select branch</option>
                                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                        </div>
                        <div className="flex gap-3">
                            <button onClick={() => setShowAssignDialog(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
                            <button onClick={handleAssignBranch} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg,#7C3AED,#6D28D9)' }} data-testid="confirm-assign-btn">Assign</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete confirm */}
            {showDeleteDialog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-sm rounded-3xl p-6 shadow-2xl" style={{ background: 'var(--bg-card)' }}>
                        <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Delete Branch</h3>
                        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Delete "{branchToDelete?.name}"? This cannot be undone.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setShowDeleteDialog(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
                            <button onClick={handleDelete} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg,#EF4444,#DC2626)' }} data-testid="confirm-delete-branch-btn">Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
