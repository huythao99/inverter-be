import React, { useEffect, useState } from 'react';
import {
  getBlacklist,
  addToBlacklist,
  removeFromBlacklist,
} from '../services/api';
import { Trash2, Plus, X, ShieldOff } from 'lucide-react';

interface BlacklistEntry {
  _id: string;
  deviceId: string;
  userId?: string;
  reason?: string;
  createdAt: string;
}

const Blacklist: React.FC = () => {
  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ deviceId: '', userId: '', reason: '' });
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchBlacklist = async () => {
    setIsLoading(true);
    try {
      const res = await getBlacklist();
      setEntries(res.data);
    } catch (err) {
      console.error('Failed to fetch blacklist', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBlacklist();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.deviceId.trim()) {
      setFormError('Device ID is required');
      return;
    }
    setIsSubmitting(true);
    setFormError('');
    try {
      await addToBlacklist({
        deviceId: form.deviceId.trim(),
        userId: form.userId.trim() || undefined,
        reason: form.reason.trim() || undefined,
      });
      setForm({ deviceId: '', userId: '', reason: '' });
      setShowForm(false);
      fetchBlacklist();
    } catch (err) {
      setFormError('Failed to add device to blacklist');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await removeFromBlacklist(id);
      setDeleteConfirm(null);
      fetchBlacklist();
    } catch (err) {
      console.error('Failed to remove from blacklist', err);
    }
  };

  return (
    <div className="page blacklist-page">
      <div className="page-header-actions">
        <div>
          <h1>Blacklist Devices</h1>
          <p>Devices in this list will have their MQTT messages ignored</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          <Plus size={16} />
          Add Device
        </button>
      </div>

      {showForm && (
        <div className="form-card">
          <div className="form-card-header">
            <h3>Add to Blacklist</h3>
            <button className="btn-icon" onClick={() => { setShowForm(false); setFormError(''); }}>
              <X size={20} />
            </button>
          </div>
          <form onSubmit={handleAdd} className="blacklist-form">
            <div className="form-group">
              <label>Device ID <span className="required">*</span></label>
              <input
                type="text"
                placeholder="e.g. GTIControl1134"
                value={form.deviceId}
                onChange={(e) => setForm({ ...form, deviceId: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>User ID <span className="optional">(optional)</span></label>
              <input
                type="text"
                placeholder="Leave empty to block globally"
                value={form.userId}
                onChange={(e) => setForm({ ...form, userId: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Reason <span className="optional">(optional)</span></label>
              <input
                type="text"
                placeholder="e.g. Spam, Unauthorized device"
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </div>
            {formError && <p className="form-error">{formError}</p>}
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { setShowForm(false); setFormError(''); }}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-danger" disabled={isSubmitting}>
                <ShieldOff size={16} />
                {isSubmitting ? 'Adding...' : 'Add to Blacklist'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="table-container">
        {isLoading ? (
          <div className="loading">Loading blacklist...</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Device ID</th>
                <th>User ID</th>
                <th>Reason</th>
                <th>Added At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry._id}>
                  <td className="monospace">{entry.deviceId}</td>
                  <td className="monospace">{entry.userId || <span className="text-muted">Global</span>}</td>
                  <td>{entry.reason || <span className="text-muted">—</span>}</td>
                  <td>{new Date(entry.createdAt).toLocaleString()}</td>
                  <td className="actions">
                    {deleteConfirm === entry._id ? (
                      <>
                        <button
                          className="btn-icon danger"
                          onClick={() => handleRemove(entry._id)}
                          title="Confirm Remove"
                        >
                          <span style={{ fontSize: 12 }}>Confirm</span>
                        </button>
                        <button
                          className="btn-icon"
                          onClick={() => setDeleteConfirm(null)}
                          title="Cancel"
                        >
                          <X size={16} />
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn-icon danger"
                        onClick={() => setDeleteConfirm(entry._id)}
                        title="Remove from Blacklist"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-state">
                    No blacklisted devices
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default Blacklist;
