import React, { useEffect, useState } from 'react';
import {
  getBetaFirmwareDevices,
  addBetaFirmwareDevice,
  removeBetaFirmwareDevice,
} from '../services/api';
import { Trash2, Plus, X, FlaskConical } from 'lucide-react';

interface BetaFirmwareEntry {
  _id: string;
  deviceId: string;
  userId?: string;
  note?: string;
  createdAt: string;
}

const BetaFirmware: React.FC = () => {
  const [entries, setEntries] = useState<BetaFirmwareEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ deviceId: '', userId: '', note: '' });
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchEntries = async () => {
    setIsLoading(true);
    try {
      const res = await getBetaFirmwareDevices();
      setEntries(res.data);
    } catch (err) {
      console.error('Failed to fetch beta firmware devices', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchEntries();
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
      await addBetaFirmwareDevice({
        deviceId: form.deviceId.trim(),
        userId: form.userId.trim() || undefined,
        note: form.note.trim() || undefined,
      });
      setForm({ deviceId: '', userId: '', note: '' });
      setShowForm(false);
      fetchEntries();
    } catch (err) {
      setFormError('Failed to add device');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await removeBetaFirmwareDevice(id);
      setDeleteConfirm(null);
      fetchEntries();
    } catch (err) {
      console.error('Failed to remove beta firmware device', err);
    }
  };

  return (
    <div className="page beta-firmware-page">
      <div className="page-header-actions">
        <div>
          <h1>Beta Firmware Devices</h1>
          <p>Devices in this list will download the beta firmware build</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowForm(!showForm)}
        >
          <Plus size={16} />
          Add Device
        </button>
      </div>

      {showForm && (
        <div className="form-card">
          <div className="form-card-header">
            <h3>Add Beta Device</h3>
            <button
              className="btn-icon"
              onClick={() => {
                setShowForm(false);
                setFormError('');
              }}
            >
              <X size={20} />
            </button>
          </div>
          <form onSubmit={handleAdd} className="blacklist-form">
            <div className="form-group">
              <label>
                Device ID <span className="required">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. GTIControl1349"
                value={form.deviceId}
                onChange={(e) =>
                  setForm({ ...form, deviceId: e.target.value })
                }
              />
            </div>
            <div className="form-group">
              <label>
                User ID <span className="optional">(optional)</span>
              </label>
              <input
                type="text"
                placeholder="Leave empty to enable for all users"
                value={form.userId}
                onChange={(e) => setForm({ ...form, userId: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>
                Note <span className="optional">(optional)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Field test unit"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </div>
            {formError && <p className="form-error">{formError}</p>}
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setShowForm(false);
                  setFormError('');
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSubmitting}
              >
                <FlaskConical size={16} />
                {isSubmitting ? 'Adding...' : 'Add Device'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="table-container">
        {isLoading ? (
          <div className="loading">Loading beta firmware devices...</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Device ID</th>
                <th>User ID</th>
                <th>Note</th>
                <th>Added At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry._id}>
                  <td className="monospace">{entry.deviceId}</td>
                  <td className="monospace">
                    {entry.userId || (
                      <span className="text-muted">All users</span>
                    )}
                  </td>
                  <td>{entry.note || <span className="text-muted">—</span>}</td>
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
                        title="Remove from beta list"
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
                    No beta firmware devices
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

export default BetaFirmware;
