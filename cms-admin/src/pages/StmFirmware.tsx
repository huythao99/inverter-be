import React, { useEffect, useState } from 'react';
import {
  getStmFirmwares,
  registerStmFirmware,
  setStmFirmwareEnabled,
  deleteStmFirmware,
} from '../services/api';
import type { StmChannel, StmFirmware as StmFirmwareItem, StmProduct } from '../services/api';
import { Plus, X, Trash2, Check, Loader2, ToggleLeft, ToggleRight } from 'lucide-react';

const emptyForm = {
  product: 'inverter' as StmProduct,
  channel: 'stable' as StmChannel,
  version: '',
  binUrl: '',
  manifestUrl: '',
  notes: '',
};

/**
 * STM32 firmware images. Files are uploaded by hand to DigitalOcean (app.bin +
 * app.json side by side); registering here downloads both and checks size,
 * CRC32 and the vector table before any device can be offered the image.
 */
const StmFirmware: React.FC = () => {
  const [items, setItems] = useState<StmFirmwareItem[]>([]);
  const [product, setProduct] = useState<StmProduct>('inverter');
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchItems = async () => {
    setIsLoading(true);
    try {
      const res = await getStmFirmwares(product);
      setItems(res.data);
    } catch (err) {
      console.error('Failed to fetch STM32 firmwares', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.version.trim() || !form.binUrl.trim()) {
      setFormError('Version and app.bin URL are required');
      return;
    }
    setIsSubmitting(true);
    setFormError('');
    try {
      await registerStmFirmware({
        product: form.product,
        channel: form.channel,
        version: form.version.trim(),
        binUrl: form.binUrl.trim(),
        manifestUrl: form.manifestUrl.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      setForm({ ...emptyForm, product: form.product });
      setShowForm(false);
      setProduct(form.product);
      fetchItems();
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string | string[] } } })
        ?.response?.data?.message;
      setFormError(
        Array.isArray(message) ? message.join(', ') : message || 'Failed to register firmware',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleEnabled = async (item: StmFirmwareItem) => {
    try {
      await setStmFirmwareEnabled(item._id, !item.enabled);
      fetchItems();
    } catch (err) {
      console.error('Failed to update firmware', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteStmFirmware(id);
      setDeleteConfirm(null);
      fetchItems();
    } catch (err) {
      console.error('Failed to delete firmware', err);
    }
  };

  return (
    <div className="page stm-firmware-page">
      <div className="page-header-actions">
        <div>
          <h1>STM32 Firmware</h1>
          <p>
            Images for the STM32 power board, flashed through the ESP32. Version format is
            major.voltage.patch — major = chip (3 = F303, 2 = G431), 2nd number = voltage
            (1 = 12V, 2 = 24V, 3 = 36V, 4 = 48V). Each device gets the newest enabled image
            with the same major and voltage as the version its STM32 reports.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          <Plus size={16} />
          Register firmware
        </button>
      </div>

      {showForm && (
        <div className="form-card">
          <div className="form-card-header">
            <h3>Register STM32 firmware</h3>
            <button className="btn-icon" onClick={() => setShowForm(false)}>
              <X size={18} />
            </button>
          </div>
          <form onSubmit={handleRegister} className="blacklist-form">
            <div className="form-row">
              <div className="form-group">
                <label>Product</label>
                <select
                  value={form.product}
                  onChange={(e) => setForm({ ...form, product: e.target.value as StmProduct })}
                >
                  <option value="inverter">Inverter (hoà lưới)</option>
                  <option value="charger">Charger (bộ sạc)</option>
                </select>
              </div>
              <div className="form-group">
                <label>Channel</label>
                <select
                  value={form.channel}
                  onChange={(e) => setForm({ ...form, channel: e.target.value as StmChannel })}
                >
                  <option value="stable">Stable (all devices)</option>
                  <option value="beta">Beta (beta list only)</option>
                </select>
              </div>
              <div className="form-group">
                <label>
                  Version <span className="required">*</span>
                </label>
                <input
                  type="text"
                  placeholder="3.4.1 (F303, 48V)"
                  value={form.version}
                  onChange={(e) => setForm({ ...form, version: e.target.value })}
                />
              </div>
            </div>
            <div className="form-group">
              <label>
                app.bin URL <span className="required">*</span>
              </label>
              <input
                type="url"
                placeholder="https://<space>.digitaloceanspaces.com/stm/inverter/1.2.0/app.bin"
                value={form.binUrl}
                onChange={(e) => setForm({ ...form, binUrl: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>
                app.json URL <span className="optional">(optional — default: next to app.bin)</span>
              </label>
              <input
                type="url"
                value={form.manifestUrl}
                onChange={(e) => setForm({ ...form, manifestUrl: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>
                Notes <span className="optional">(optional)</span>
              </label>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <p className="muted">
              The backend downloads app.bin and computes its size and CRC32; if an app.json
              sits next to it, both must match.
            </p>
            {formError && <p className="form-error">{formError}</p>}
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowForm(false)}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
                {isSubmitting ? 'Checking...' : 'Register'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="tabs">
        {(['inverter', 'charger'] as StmProduct[]).map((p) => (
          <button
            key={p}
            className={`tab ${product === p ? 'active' : ''}`}
            onClick={() => setProduct(p)}
          >
            {p === 'inverter' ? 'Inverter' : 'Charger'}
          </button>
        ))}
      </div>

      <div className="table-container">
        {isLoading ? (
          <div className="loading">Loading STM32 firmware...</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Chip</th>
                <th>Voltage</th>
                <th>Channel</th>
                <th>Size</th>
                <th>CRC32</th>
                <th>Built</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it._id}>
                  <td>
                    <a href={it.url} target="_blank" rel="noreferrer">
                      {it.version}
                    </a>
                    {it.notes && <div className="muted">{it.notes}</div>}
                  </td>
                  <td>{it.major === 3 ? 'F303' : it.major === 2 ? 'G431' : `gen ${it.major}`}</td>
                  <td>{it.voltageCode * 12}V</td>
                  <td>
                    <span className={`status-badge ${it.channel === 'stable' ? 'active' : ''}`}>
                      {it.channel}
                    </span>
                  </td>
                  <td>{(it.size / 1024).toFixed(1)} KB</td>
                  <td className="monospace">{it.crc32}</td>
                  <td className="muted">{it.built ?? '—'}</td>
                  <td>
                    <span className={`status-badge ${it.enabled ? 'active' : 'inactive'}`}>
                      {it.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className="actions">
                    <button
                      className="btn-icon"
                      onClick={() => toggleEnabled(it)}
                      title={it.enabled ? 'Disable (stop offering it)' : 'Enable'}
                    >
                      {it.enabled ? (
                        <ToggleRight size={16} className="text-green" />
                      ) : (
                        <ToggleLeft size={16} />
                      )}
                    </button>
                    {deleteConfirm === it._id ? (
                      <>
                        <button
                          className="btn-icon danger"
                          onClick={() => handleDelete(it._id)}
                          title="Confirm delete"
                        >
                          <Check size={16} />
                        </button>
                        <button className="btn-icon" onClick={() => setDeleteConfirm(null)}>
                          <X size={16} />
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn-icon danger"
                        onClick={() => setDeleteConfirm(it._id)}
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={9} className="empty-state">
                    No STM32 firmware registered for this product
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

export default StmFirmware;
