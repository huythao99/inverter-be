import React, { useEffect, useState } from 'react';
import {
  getStmFirmwareConfig,
  getStmFirmwares,
  registerStmFirmware,
  uploadStmFirmware,
  setStmFirmwareEnabled,
  deleteStmFirmware,
} from '../services/api';
import type { StmChannel, StmFirmware as StmFirmwareItem, StmProduct } from '../services/api';
import { Plus, X, Trash2, Check, Loader2, ToggleLeft, ToggleRight, Upload } from 'lucide-react';

const emptyForm = {
  product: 'inverter' as StmProduct,
  channel: 'stable' as StmChannel,
  version: '',
  binUrl: '',
  manifestUrl: '',
  notes: '',
};

type AddMode = 'upload' | 'url';

/**
 * STM32 firmware images. Either upload app.bin (+ app.json) here - the backend
 * checks it and stores it on DO Spaces at the standard path - or register a
 * file already on the firmware server (the backend downloads and checks it).
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
  const [baseUrl, setBaseUrl] = useState('');
  const [uploadEnabled, setUploadEnabled] = useState(false);
  const [mode, setMode] = useState<AddMode>('upload');
  const [binFile, setBinFile] = useState<File | null>(null);
  const [manifestFile, setManifestFile] = useState<File | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    getStmFirmwareConfig()
      .then((res) => {
        setBaseUrl(res.data.baseUrl);
        setUploadEnabled(!!res.data.uploadEnabled);
        if (!res.data.uploadEnabled) setMode('url');
      })
      .catch(() => undefined);
  }, []);

  // app.json picked: prefill the version from fw_version.
  const pickManifest = (file: File | null) => {
    setManifestFile(file);
    if (!file) return;
    file
      .text()
      .then((text) => {
        const json = JSON.parse(text.replace(/^\uFEFF/, '')) as { fw_version?: unknown };
        if (typeof json.fw_version === 'string' && !form.version.trim()) {
          setForm((f) => ({ ...f, version: json.fw_version as string }));
        }
      })
      .catch(() => undefined);
  };

  const resetForm = () => {
    setForm({ ...emptyForm, product: form.product });
    setBinFile(null);
    setManifestFile(null);
    setUploadPct(null);
  };

  // Where the backend will look when the app.bin URL is left empty.
  const defaultBinUrl =
    baseUrl && form.version.trim()
      ? `${baseUrl}/${form.product}/${form.version.trim()}/app.bin`
      : '';

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
    if (mode === 'url' && !form.version.trim()) {
      setFormError('Version is required');
      return;
    }
    if (mode === 'upload' && !binFile) {
      setFormError('Choose app.bin');
      return;
    }
    setIsSubmitting(true);
    setFormError('');
    setNotice('');
    try {
      if (mode === 'upload' && binFile) {
        setUploadPct(0);
        const res = await uploadStmFirmware(
          {
            product: form.product,
            channel: form.channel,
            version: form.version.trim() || undefined,
            notes: form.notes.trim() || undefined,
            bin: binFile,
            manifest: manifestFile ?? undefined,
          },
          setUploadPct,
        );
        setNotice(
          res.data.warning
            ? `Uploaded v${res.data.version}. Warning: ${res.data.warning}`
            : `Uploaded and registered v${res.data.version}`,
        );
      } else {
        await registerStmFirmware({
          product: form.product,
          channel: form.channel,
          version: form.version.trim(),
          binUrl: form.binUrl.trim() || undefined,
          manifestUrl: form.manifestUrl.trim() || undefined,
          notes: form.notes.trim() || undefined,
        });
      }
      resetForm();
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
      setUploadPct(null);
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
          Add firmware
        </button>
      </div>

      {showForm && (
        <div className="form-card">
          <div className="form-card-header">
            <h3>Add STM32 firmware</h3>
            <button className="btn-icon" onClick={() => setShowForm(false)}>
              <X size={18} />
            </button>
          </div>
          <form onSubmit={handleRegister} className="blacklist-form">
            <div className="tabs">
              <button
                type="button"
                className={`tab ${mode === 'upload' ? 'active' : ''}`}
                onClick={() => setMode('upload')}
                disabled={!uploadEnabled}
                title={uploadEnabled ? '' : 'Upload is not configured on the server (DO_SPACES_KEY)'}
              >
                Upload file
              </button>
              <button
                type="button"
                className={`tab ${mode === 'url' ? 'active' : ''}`}
                onClick={() => setMode('url')}
              >
                File already on server
              </button>
            </div>
            {!uploadEnabled && (
              <p className="muted">
                Upload is disabled: set DO_SPACES_KEY / DO_SPACES_SECRET in the backend .env.
              </p>
            )}
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
                  Version{' '}
                  {mode === 'url' ? (
                    <span className="required">*</span>
                  ) : (
                    <span className="optional">(from app.json if empty)</span>
                  )}
                </label>
                <input
                  type="text"
                  placeholder="3.4.1 (F303, 48V)"
                  value={form.version}
                  onChange={(e) => setForm({ ...form, version: e.target.value })}
                />
              </div>
            </div>
            {mode === 'upload' ? (
              <div className="form-row">
                <div className="form-group">
                  <label>
                    app.bin <span className="required">*</span>
                  </label>
                  <input
                    type="file"
                    accept=".bin,application/octet-stream"
                    onChange={(e) => setBinFile(e.target.files?.[0] ?? null)}
                  />
                </div>
                <div className="form-group">
                  <label>
                    app.json <span className="optional">(recommended — size/CRC32 cross-check)</span>
                  </label>
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={(e) => pickManifest(e.target.files?.[0] ?? null)}
                  />
                </div>
              </div>
            ) : (
              <>
            <div className="form-group">
              <label>
                app.bin URL{' '}
                <span className="optional">(optional — default: standard path below)</span>
              </label>
              <input
                type="url"
                placeholder={defaultBinUrl || `${baseUrl || '<firmware server>/stm'}/{product}/{version}/app.bin`}
                value={form.binUrl}
                onChange={(e) => setForm({ ...form, binUrl: e.target.value })}
              />
              <span className="muted">
                Upload app.bin (+ app.json) to{' '}
                <code>{baseUrl || '…/firmware/stm'}/{form.product}/{form.version.trim() || '<version>'}/</code>{' '}
                — same server as the ESP32 firmware.
              </span>
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
              </>
            )}
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
              {mode === 'upload' ? (
                <>
                  Stored at{' '}
                  <code>
                    {baseUrl || '…/firmware/stm'}/{form.product}/
                    {form.version.trim() || '<version>'}/app.bin
                  </code>
                  . The backend checks size, CRC32, the version inside the image and the vector
                  table first; an existing version is never overwritten.
                </>
              ) : (
                'The backend downloads app.bin and computes its size and CRC32; if an app.json sits next to it, both must match.'
              )}
            </p>
            {uploadPct !== null && (
              <div className="upload-progress">
                <div className="upload-progress-bar" style={{ width: `${uploadPct}%` }} />
                <span>{uploadPct < 100 ? `Uploading ${uploadPct}%` : 'Checking & storing…'}</span>
              </div>
            )}
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
                {isSubmitting ? (
                  <Loader2 size={16} className="spin" />
                ) : mode === 'upload' ? (
                  <Upload size={16} />
                ) : (
                  <Check size={16} />
                )}
                {isSubmitting ? 'Checking...' : mode === 'upload' ? 'Upload' : 'Register'}
              </button>
            </div>
          </form>
        </div>
      )}

      {notice && (
        <p className={`notice ${notice.includes('Warning') ? 'notice-warn' : ''}`}>
          {notice}
          <button className="btn-icon" onClick={() => setNotice('')}>
            <X size={14} />
          </button>
        </p>
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
