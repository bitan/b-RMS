import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Search, Plus, Edit2, Trash2, Truck, Phone, Mail, MapPin, User, X } from 'lucide-react';
import { toast } from 'sonner';
import { useEntityUpdates } from '../hooks/useEntityUpdates';

const API = `${process.env.REACT_APP_BACKEND_URL || window.location.origin}/api`;
const initialSupplier = { name: '', email: '', phone: '', address: '', contact_person: '' };

export const Suppliers = () => {
    const [suppliers, setSuppliers] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState(null);
    const [formData, setFormData] = useState(initialSupplier);
    const [supplierToDelete, setSupplierToDelete] = useState(null);

    const fetchSuppliers = useCallback(async () => {
        try {
            const res = await axios.get(`${API}/suppliers`, { withCredentials: true });
            setSuppliers(res.data);
        } catch (e) { toast.error('Failed to load suppliers'); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchSuppliers(); }, [fetchSuppliers]);
    useEntityUpdates('supplier', fetchSuppliers);

    const filteredSuppliers = suppliers.filter(s =>
        s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.contact_person?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleOpenModal = (supplier = null) => {
        setEditingSupplier(supplier);
        setFormData(supplier ? { name: supplier.name, email: supplier.email || '', phone: supplier.phone, address: supplier.address || '', contact_person: supplier.contact_person || '' } : initialSupplier);
        setShowModal(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            if (editingSupplier) {
                await axios.put(`${API}/suppliers/${editingSupplier.id}`, formData, { withCredentials: true });
                toast.success('Supplier updated');
            } else {
                await axios.post(`${API}/suppliers`, formData, { withCredentials: true });
                toast.success('Supplier created');
            }
            setShowModal(false);
            fetchSuppliers();
        } catch (e) { toast.error(e.response?.data?.detail || 'Failed to save supplier'); }
    };

    const handleDelete = async () => {
        try {
            await axios.delete(`${API}/suppliers/${supplierToDelete.id}`, { withCredentials: true });
            toast.success('Supplier deleted');
            setShowDeleteDialog(false);
            fetchSuppliers();
        } catch { toast.error('Failed to delete supplier'); }
    };

    const Field = ({ label, children }) => (
        <div>
            <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</label>
            {children}
        </div>
    );

    const inputStyle = { background: 'var(--bg-page)', borderColor: 'var(--border)', color: 'var(--text-primary)' };

    return (
        <div className="p-6 lg:p-8 space-y-6" data-testid="suppliers-page">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Suppliers</h1>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{suppliers.length} suppliers registered</p>
                </div>
                <button onClick={() => handleOpenModal()} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:-translate-y-0.5" style={{ background: 'linear-gradient(135deg,#7C3AED,#6D28D9)', boxShadow: '0 4px 14px rgba(124,58,237,0.35)' }} data-testid="add-supplier-btn">
                    <Plus className="w-4 h-4" />Add Supplier
                </button>
            </div>

            {/* Search */}
            <div className="relative max-w-sm">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                <input type="text" placeholder="Search suppliers…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all"
                    style={inputStyle} data-testid="supplier-search" />
            </div>

            {/* Grid */}
            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[1,2,3].map(i => <div key={i} className="h-48 rounded-2xl animate-pulse" style={{ background: 'var(--bg-card)' }} />)}
                </div>
            ) : filteredSuppliers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3" style={{ color: 'var(--text-muted)' }}>
                    <Truck className="w-12 h-12 opacity-30" />
                    <p className="text-sm">No suppliers found</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredSuppliers.map(supplier => (
                        <div key={supplier.id} className="card-soft p-5 hover:-translate-y-1 transition-all duration-200" data-testid={`supplier-card-${supplier.id}`}>
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow">
                                        <Truck className="w-5 h-5 text-white" />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{supplier.name}</h3>
                                        {supplier.contact_person && (
                                            <p className="text-xs flex items-center gap-1 mt-0.5" style={{ color: 'var(--text-muted)' }}>
                                                <User className="w-3 h-3" />{supplier.contact_person}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <div className="flex gap-1">
                                    <button onClick={() => handleOpenModal(supplier)} className="p-2 rounded-xl transition-colors hover:bg-violet-50 dark:hover:bg-violet-900/30" style={{ color: 'var(--text-muted)' }} data-testid={`supplier-actions-${supplier.id}`}>
                                        <Edit2 className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => { setSupplierToDelete(supplier); setShowDeleteDialog(true); }} className="p-2 rounded-xl transition-colors hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 hover:text-red-600">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}><Phone className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />{supplier.phone}</div>
                                {supplier.email && <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}><Mail className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />{supplier.email}</div>}
                                {supplier.address && <div className="flex items-start gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}><MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }} /><span className="line-clamp-2">{supplier.address}</span></div>}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-md rounded-3xl p-6 shadow-2xl" style={{ background: 'var(--bg-card)' }}>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{editingSupplier ? 'Edit Supplier' : 'Add Supplier'}</h3>
                            <button onClick={() => setShowModal(false)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                        </div>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <Field label="Company Name">
                                <input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all" style={inputStyle} data-testid="supplier-name-input" />
                            </Field>
                            <Field label="Contact Person">
                                <input value={formData.contact_person} onChange={e => setFormData({...formData, contact_person: e.target.value})} className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all" style={inputStyle} data-testid="supplier-contact-input" />
                            </Field>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Phone">
                                    <input value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} required className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all" style={inputStyle} data-testid="supplier-phone-input" />
                                </Field>
                                <Field label="Email">
                                    <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all" style={inputStyle} data-testid="supplier-email-input" />
                                </Field>
                            </div>
                            <Field label="Address">
                                <textarea value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} rows={3} className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all resize-none" style={inputStyle} data-testid="supplier-address-input" />
                            </Field>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-colors" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
                                <button type="submit" className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:-translate-y-0.5" style={{ background: 'linear-gradient(135deg,#7C3AED,#6D28D9)', boxShadow: '0 4px 14px rgba(124,58,237,0.35)' }} data-testid="supplier-submit-btn">
                                    {editingSupplier ? 'Update' : 'Add Supplier'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Delete confirm */}
            {showDeleteDialog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-sm rounded-3xl p-6 shadow-2xl" style={{ background: 'var(--bg-card)' }}>
                        <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Delete Supplier</h3>
                        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Delete "{supplierToDelete?.name}"? This cannot be undone.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setShowDeleteDialog(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
                            <button onClick={handleDelete} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg,#EF4444,#DC2626)' }} data-testid="confirm-delete-supplier-btn">Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
