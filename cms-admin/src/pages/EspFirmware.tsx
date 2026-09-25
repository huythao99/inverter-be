import React, { useEffect, useState } from 'react';
import {
  activateEspFirmware,
  deleteEspFirmware,
  getEspFirmwareConfig,
  getEspFirmwares,
  uploadEspFirmware,
} from '../services/api';
import type { EspChannel, EspFirmware as EspFirmwareItem, EspFirmwareConfig } from '../services/api';
import { Check, Loader2, Plus, Trash2, Upload, X } from 'lucide-react';

const emptyForm = { version: '', notes: '', activate: '' as '' | EspChannel };

const errorText = (err: unknown, fallback: string) => {
  const message = (err as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data?.message;
  return Array.isArray(message) ? message.join(', ') : message || fallback;
};

/**
 * ESP32 inverter firmware builds. Uploading stores firmware.bin on DO Spaces
 * ({baseUrl}/{version}/firmware.bin); "Set stable" / "Set beta" picks which
 * build devices download (beta-list devices get the beta build). Until a
 * build is active on a channel, the old fixed firmware.bin / firmware-beta.bin
 * is used.
 */
const EspFirmware: React.FC = () => {
  const [items, setItems] = useState<EspFirmwareItem[]>([]);
  const [config, setConfig] = useState<EspFirmwareConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [binFile, setBinFile] = useState<File | null>(null);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchAll = async () => {
    setIsLoading(true);
    try {
      const [list, cfg] = await Promise.all([getEspFirmwares(), getEspFirmwareConfig()]);
      setItems(list.data);
      setConfig(cfg.data);
    } catch (err) {
      console.error('Failed to fetch ESP32 firmwares', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!binFile) {
      setFormError('Choose firmware.bin');
      return;
    }
    if (!/^\d+\.\d+\.\d+$/.test(form.version.trim())) {
      setFormError('Version must look like 1.0.15 (= currentFirmwareVersion of the build)');
      return;
    }
    if (config && binFile.size > config.maxBytes) {
      setFormError(`File is larger than the OTA partition (${config.maxBytes} B)`);
      return;
    }
    if (
      form.activate === 'stable' &&
      !window.confirm(
        `Make v${form.version.trim()} the STABLE firmware right after the upload?\n\nEvery device will be offered it.`,
      )
    ) {
      return;
    }
    setIsSubmitting(true);
    setFormError('');
    setNotice('');
    setUploadPct(0);
    try {
      const res = await uploadEspFirmware(
        {
          version: form.version.trim(),
          notes: form.notes.trim() || undefined,
          activate: form.activate || undefined,
          bin: binFile,
        },
        setUploadPct,
      );
      setNotice(
        res.data.warning
          ? `Uploaded v${res.data.version}. Warning: ${res.data.warning}`
          : `Uploaded v${res.data.version}${form.activate ? ` and set as ${form.activate}` : ''}`,
      );
      setForm(emptyForm);
      setBinFile(null);
      setShowForm(false);
      fetchAll();
    } catch (err) {
      setFormError(errorText(err, 'Upload failed'));
    } finally {
      setIsSubmitting(false);
      setUploadPct(null);
    }
  };

  const handleActivate = async (it: EspFirmwareItem, channel: EspChannel) => {
    const current = config?.[channel].version;
    if (
      !window.confirm(
        `Set v${it.version} as ${channel.toUpperCase()}?\n\nCurrently ${channel}: v${current ?? '?'}.` +
          (channel === 'stable'
            ? '\nAll devices (except the beta list) will be offered this build.'
            : '\nDevices on the beta list will be offered this build.'),
      )
    ) {
      return;
    }
    setBusyId(it._id);
    try {
      await activateEspFirmware(it._id, channel);
      setNotice(`v${it.version} is now ${channel}`);
      fetchAll();
    } catch (err) {
      alert(errorText(err, 'Failed to activate'));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteEspFirmware(id);
      setDeleteConfirm(null);
      fetchAll();
    } catch (err) {
      alert(errorText(err, 'Failed to delete'));
    }
  };

  const activeCard = (channel: EspChannel) => {
    const a = config?.[channel];
    return (
      <div className="esp-active-card">
        <span className="muted">{channel === 'stable' ? 'Stable (all devices)' : 'Beta (beta list)'}</span>
        <strong>{a ? `v${a.version}` : '—'}</strong>
        <span className="muted">
          {a?.source === 'default' ? 'fixed file (not uploaded here)' : 'uploaded build'}
        </span>
      </div>
    );
  };

  return (
    <div className="page esp-firmware-page">
      <div className="page-header-actions">
        <div>
          <h1>ESP32 Firmware</h1>
          <p>
            Builds of the ESP32 inverter firmware. Upload{' '}
            <code>.pio/build/esp32dev/firmware.bin</code>, then set it as beta to test on the
            beta list and as stable to release it. Devices download the build active on their
            channel.
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowForm(!showForm)}
          disabled={config ? !config.uploadEnabled : false}
          title={config && !config.uploadEnabled ? 'Upload is not configured on the server' : ''}
        >
          <Plus size={16} />
          Upload firmware
        </button>
      </div>

      {config && !config.uploadEnabled && (
        <p className="notice notice-warn">
          Upload is disabled: set DO_SPACES_KEY / DO_SPACES_SECRET in the backend .env.
        </p>
      )}

      <div className="esp-active-row">
        {activeCard('stable')}
        {activeCard('beta')}
      </div>

      {showForm && (
        <div className="form-card">
          <div className="form-card-header">
            <h3>Upload ESP32 firmware</h3>
            <button className="btn-icon" onClick={() => setShowForm(false)}>
              <X size={18} />
            </button>
          </div>
          <form onSubmit={handleUpload} className="blacklist-form">
            <div className="form-row">
              <div className="form-group">
                <label>
                  firmware.bin <span className="required">*</span>
                </label>
                <input
                  type="file"
                  accept=".bin,application/octet-stream"
                  onChange={(e) => setBinFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <div className="form-group">
                <label>
                  Version <span className="required">*</span>
                </label>
                <input
                  type="text"
                  placeholder="1.0.15"
                  value={form.version}
                  onChange={(e) => setForm({ ...form, version: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>After upload</label>
                <select
                  value={form.activate}
                  onChange={(e) =>
                    setForm({ ...form, activate: e.target.value as '' | EspChannel })
                  }
                >
                  <option value="">Just upload</option>
                  <option value="beta">Set as beta</option>
                  <option value="stable">Set as stable</option>
                </select>
              </div>
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
              Version must equal <code>currentFirmwareVersion</code> of the build (the backend
              checks the file contains it). Stored at{' '}
              <code>
                {config?.baseUrl ?? '…/firmware/esp32'}/{form.version.trim() || '<version>'}
                /firmware.bin
              </code>
              ; an existing version is never overwritten.
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
                {isSubmitting ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
                {isSubmitting ? 'Uploading...' : 'Upload'}
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

      <div className="table-container">
        {isLoading ? (
          <div className="loading">Loading ESP32 firmware...</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Channel</th>
                <th>Size</th>
                <th>SHA-256</th>
                <th>Uploaded</th>
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
                  <td>
                    {it.channels.length ? (
                      it.channels.map((c) => (
                        <span
                          key={c}
                          className={`status-badge ${c === 'stable' ? 'active' : ''}`}
                        >
                          {c}
                        </span>
                      ))
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{(it.size / 1024).toFixed(0)} KB</td>
                  <td className="monospace" title={it.sha256}>
                    {it.sha256.slice(0, 12)}…
                  </td>
                  <td className="muted">{new Date(it.createdAt).toLocaleString()}</td>
                  <td className="actions">
                    {busyId === it._id ? (
                      <Loader2 size={16} className="spin" />
                    ) : (
                      <>
                        {!it.channels.includes('beta') && (
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleActivate(it, 'beta')}
                          >
                            Set beta
                          </button>
                        )}
                        {!it.channels.includes('stable') && (
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => handleActivate(it, 'stable')}
                          >
                            Set stable
                          </button>
                        )}
                        {it.channels.length === 0 &&
                          (deleteConfirm === it._id ? (
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
                              title="Delete from the list (the file stays on Spaces)"
                            >
                              <Trash2 size={16} />
                            </button>
                          ))}
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-state">
                    No build uploaded yet — devices use the fixed firmware.bin /
                    firmware-beta.bin
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

export default EspFirmware;
