import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getDevices,
  updateDevice,
  deleteDevice,
  triggerFirmwareUpdate,
  startBulkFirmwareUpdate,
  getLatestBulkFirmwareUpdate,
  getBulkFirmwareUpdate,
} from '../services/api';
import type { BulkFirmwareJob } from '../services/api';
import {
  Search,
  Edit2,
  Trash2,
  X,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  Download,
  Loader2,
  RefreshCw,
} from 'lucide-react';

interface Device {
  _id: string;
  userId: string;
  deviceId: string;
  deviceName: string;
  firmwareVersion: string;
  updatedAt: string;
}

interface DevicesResponse {
  data: Device[];
  total: number;
  page: number;
  totalPages: number;
}

const Devices: React.FC = () => {
  const navigate = useNavigate();
  const [devices, setDevices] = useState<DevicesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState({ deviceName: '', firmwareVersion: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [firmwareUpdateConfirm, setFirmwareUpdateConfirm] = useState<string | null>(null);
  const [isUpdatingFirmware, setIsUpdatingFirmware] = useState(false);

  // ---- Bulk (forced) firmware update ----
  // Search text the current list was loaded with ("select all" uses it, not
  // what is typed but not yet submitted).
  const [appliedSearch, setAppliedSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [isStartingBulk, setIsStartingBulk] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const [bulkJob, setBulkJob] = useState<BulkFirmwareJob | null>(null);

  const fetchDevices = async () => {
    setIsLoading(true);
    try {
      const res = await getDevices({ page, search: search || undefined, limit: 20 });
      setDevices(res.data);
      setAppliedSearch(search);
    } catch (err) {
      console.error('Failed to fetch devices', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, [page]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    clearSelection(); // a new filter means a new set of devices
    fetchDevices();
  };

  // ---- Selection ----
  const pageIds = devices?.data.map((d) => d._id) ?? [];
  const allOnPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const selectedCount = selectAllMatching
    ? devices?.total ?? 0
    : selectedIds.size;

  function clearSelection() {
    setSelectedIds(new Set());
    setSelectAllMatching(false);
  }

  const toggleOne = (id: string) => {
    setSelectAllMatching(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePage = () => {
    setSelectAllMatching(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  // ---- Bulk job ----
  const refreshBulkJob = async (jobId?: string) => {
    try {
      if (jobId) {
        const res = await getBulkFirmwareUpdate(jobId);
        setBulkJob(res.data);
      } else {
        const res = await getLatestBulkFirmwareUpdate();
        setBulkJob(res.data.job);
      }
    } catch (err) {
      console.error('Failed to load bulk firmware job', err);
    }
  };

  // Show the last job on load (survives page reloads for 24h).
  useEffect(() => {
    refreshBulkJob();
  }, []);

  // Poll while triggers are being sent or devices are still updating
  // (stop 30 min after sending finished).
  const bulkActive =
    !!bulkJob &&
    (bulkJob.status === 'sending' ||
      ((bulkJob.counts.sent > 0 || bulkJob.counts.in_progress > 0) &&
        !!bulkJob.sendingFinishedAt &&
        Date.now() - new Date(bulkJob.sendingFinishedAt).getTime() <
          30 * 60 * 1000));

  const bulkJobId = bulkJob?.jobId;
  useEffect(() => {
    if (!bulkActive || !bulkJobId) return;
    const t = setInterval(() => refreshBulkJob(bulkJobId), 5000);
    return () => clearInterval(t);
  }, [bulkActive, bulkJobId]);

  const startBulk = async () => {
    setIsStartingBulk(true);
    setBulkError('');
    try {
      const res = await startBulkFirmwareUpdate(
        selectAllMatching
          ? { all: true, search: appliedSearch || undefined }
          : { ids: Array.from(selectedIds) },
      );
      setBulkJob(res.data);
      setShowBulkConfirm(false);
      clearSelection();
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })
        ?.response?.data?.message;
      setBulkError(message || 'Failed to start the bulk update');
    } finally {
      setIsStartingBulk(false);
    }
  };

  const startEdit = (device: Device) => {
    setEditingId(device._id);
    setEditData({
      deviceName: device.deviceName,
      firmwareVersion: device.firmwareVersion,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditData({ deviceName: '', firmwareVersion: '' });
  };

  const saveEdit = async (id: string) => {
    try {
      await updateDevice(id, editData);
      setEditingId(null);
      fetchDevices();
    } catch (err) {
      console.error('Failed to update device', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDevice(id);
      setDeleteConfirm(null);
      fetchDevices();
    } catch (err) {
      console.error('Failed to delete device', err);
    }
  };

  const handleFirmwareUpdate = async (id: string) => {
    setIsUpdatingFirmware(true);
    try {
      await triggerFirmwareUpdate(id, '1.0.6');
      setFirmwareUpdateConfirm(null);
      alert('Firmware update triggered successfully');
    } catch (err) {
      console.error('Failed to trigger firmware update', err);
      alert('Failed to trigger firmware update');
    } finally {
      setIsUpdatingFirmware(false);
    }
  };

  return (
    <div className="page devices-page">
      <header className="page-header">
        <h1>Devices</h1>
        <p>Manage inverter devices</p>
      </header>

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="search-bar">
        <div className="search-input-wrapper">
          <Search size={20} />
          <input
            type="text"
            placeholder="Search by device ID, name, or user ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary">
          Search
        </button>
      </form>

      {bulkJob && (
        <BulkJobPanel
          job={bulkJob}
          active={bulkActive}
          onRefresh={() => refreshBulkJob(bulkJob.jobId)}
          onClose={() => setBulkJob(null)}
        />
      )}

      {/* Selection toolbar */}
      {selectedCount > 0 && (
        <div className="bulk-bar">
          <span>
            <strong>{selectedCount}</strong> device
            {selectedCount === 1 ? '' : 's'} selected
            {selectAllMatching && appliedSearch
              ? ` (all matching "${appliedSearch}")`
              : selectAllMatching
                ? ' (all devices)'
                : ''}
          </span>
          {allOnPageSelected &&
            !selectAllMatching &&
            devices &&
            devices.total > selectedIds.size && (
              <button
                className="link-button"
                onClick={() => setSelectAllMatching(true)}
              >
                Select all {devices.total} devices
                {appliedSearch ? ` matching "${appliedSearch}"` : ''}
              </button>
            )}
          <div className="bulk-bar-actions">
            <button className="btn btn-secondary btn-sm" onClick={clearSelection}>
              Clear
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                setBulkError('');
                setShowBulkConfirm(true);
              }}
              disabled={bulkJob?.status === 'sending'}
              title={
                bulkJob?.status === 'sending'
                  ? 'Wait for the running bulk update to finish sending'
                  : 'Force firmware update on the selected devices'
              }
            >
              <Download size={16} />
              Force update ({selectedCount})
            </button>
          </div>
        </div>
      )}

      {showBulkConfirm && (
        <div className="modal-backdrop" onClick={() => !isStartingBulk && setShowBulkConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Force firmware update</h3>
            <p>
              Send the firmware update command to <strong>{selectedCount}</strong>{' '}
              device{selectedCount === 1 ? '' : 's'}
              {selectAllMatching && appliedSearch ? ` matching "${appliedSearch}"` : ''}?
            </p>
            <ul className="modal-notes">
              <li>
                Every device re-downloads and flashes the current firmware, even if it
                is already up to date, then reboots (offline ~1 minute).
              </li>
              <li>
                Commands are sent in batches of 10 every 10 seconds
                {selectedCount > 10
                  ? ` (about ${Math.ceil(selectedCount / 10) * 10} s in total)`
                  : ''}
                .
              </li>
              <li>
                Devices that are offline right now will not receive it — run it
                again for them later.
              </li>
            </ul>
            {bulkError && <p className="error-text">{bulkError}</p>}
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowBulkConfirm(false)}
                disabled={isStartingBulk}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={startBulk}
                disabled={isStartingBulk}
              >
                {isStartingBulk ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
                {isStartingBulk ? 'Starting...' : 'Force update'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Devices Table */}
      <div className="table-container">
        {isLoading ? (
          <div className="loading">Loading devices...</div>
        ) : (
          <>
            <table className="data-table">
              <thead>
                <tr>
                  <th className="checkbox-cell">
                    <input
                      type="checkbox"
                      aria-label="Select all devices on this page"
                      checked={allOnPageSelected}
                      onChange={togglePage}
                    />
                  </th>
                  <th>Device ID</th>
                  <th>Device Name</th>
                  <th>User ID</th>
                  <th>Firmware</th>
                  <th>Last Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {devices?.data.map((device) => (
                  <tr
                    key={device._id}
                    className={
                      selectAllMatching || selectedIds.has(device._id) ? 'selected' : ''
                    }
                  >
                    <td className="checkbox-cell">
                      <input
                        type="checkbox"
                        aria-label={`Select ${device.deviceId}`}
                        checked={selectAllMatching || selectedIds.has(device._id)}
                        onChange={() => toggleOne(device._id)}
                      />
                    </td>
                    <td className="monospace">{device.deviceId}</td>
                    <td>
                      {editingId === device._id ? (
                        <input
                          type="text"
                          value={editData.deviceName}
                          onChange={(e) =>
                            setEditData({ ...editData, deviceName: e.target.value })
                          }
                          className="inline-edit"
                        />
                      ) : (
                        device.deviceName
                      )}
                    </td>
                    <td className="monospace">{device.userId}</td>
                    <td>
                      {editingId === device._id ? (
                        <input
                          type="text"
                          value={editData.firmwareVersion}
                          onChange={(e) =>
                            setEditData({ ...editData, firmwareVersion: e.target.value })
                          }
                          className="inline-edit"
                        />
                      ) : (
                        device.firmwareVersion
                      )}
                    </td>
                    <td>{new Date(device.updatedAt).toLocaleString()}</td>
                    <td className="actions">
                      {editingId === device._id ? (
                        <>
                          <button
                            className="btn-icon success"
                            onClick={() => saveEdit(device._id)}
                            title="Save"
                          >
                            <Check size={16} />
                          </button>
                          <button
                            className="btn-icon"
                            onClick={cancelEdit}
                            title="Cancel"
                          >
                            <X size={16} />
                          </button>
                        </>
                      ) : deleteConfirm === device._id ? (
                        <>
                          <button
                            className="btn-icon danger"
                            onClick={() => handleDelete(device._id)}
                            title="Confirm Delete"
                          >
                            <Check size={16} />
                          </button>
                          <button
                            className="btn-icon"
                            onClick={() => setDeleteConfirm(null)}
                            title="Cancel"
                          >
                            <X size={16} />
                          </button>
                        </>
                      ) : firmwareUpdateConfirm === device._id ? (
                        <>
                          <button
                            className="btn-icon success"
                            onClick={() => handleFirmwareUpdate(device._id)}
                            disabled={isUpdatingFirmware}
                            title="Confirm Update"
                          >
                            <Check size={16} />
                          </button>
                          <button
                            className="btn-icon"
                            onClick={() => setFirmwareUpdateConfirm(null)}
                            title="Cancel"
                          >
                            <X size={16} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="btn-icon"
                            onClick={() => navigate(`/devices/${device.userId}/${device.deviceId}`)}
                            title="View Details"
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            className="btn-icon"
                            onClick={() => setFirmwareUpdateConfirm(device._id)}
                            title="Update Firmware"
                          >
                            <Download size={16} />
                          </button>
                          <button
                            className="btn-icon"
                            onClick={() => startEdit(device)}
                            title="Edit"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            className="btn-icon danger"
                            onClick={() => setDeleteConfirm(device._id)}
                            title="Delete"
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {devices?.data.length === 0 && (
                  <tr>
                    <td colSpan={7} className="empty-state">
                      No devices found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* Pagination */}
            {devices && devices.totalPages > 1 && (
              <div className="pagination">
                <button
                  className="btn-icon"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft size={20} />
                </button>
                <span>
                  Page {devices.page} of {devices.totalPages}
                </span>
                <button
                  className="btn-icon"
                  disabled={page === devices.totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// Progress of the last bulk firmware update.
const BulkJobPanel: React.FC<{
  job: BulkFirmwareJob;
  active: boolean;
  onRefresh: () => void;
  onClose: () => void;
}> = ({ job, active, onRefresh, onClose }) => {
  const { counts, total } = job;
  const done = counts.success + counts.failed;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const [showLists, setShowLists] = useState(false);

  return (
    <div className="bulk-panel">
      <div className="bulk-panel-header">
        <div>
          <strong>Bulk firmware update</strong>{' '}
          <span className="muted">
            started {new Date(job.createdAt).toLocaleString()} ·{' '}
            {job.status === 'sending' ? 'sending commands…' : 'all commands sent'}
          </span>
        </div>
        <div className="bulk-panel-actions">
          {active && <Loader2 size={16} className="spin" />}
          <button className="btn-icon" onClick={onRefresh} title="Refresh">
            <RefreshCw size={16} />
          </button>
          <button className="btn-icon" onClick={onClose} title="Hide">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="ota-progress-bar">
        <div
          className={`ota-progress-fill ${counts.failed > 0 && done === total ? 'error' : done === total ? 'success' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="bulk-counts">
        <span>Total <strong>{total}</strong></span>
        <span>Waiting to send <strong>{counts.queued}</strong></span>
        <span>Sent, no reply <strong>{counts.sent}</strong></span>
        <span>Updating <strong>{counts.in_progress}</strong></span>
        <span className="ok">Success <strong>{counts.success}</strong></span>
        <span className="bad">Failed <strong>{counts.failed}</strong></span>
      </div>

      {(job.failed.length > 0 || job.noResponse.length > 0) && (
        <>
          <button className="link-button" onClick={() => setShowLists(!showLists)}>
            {showLists ? 'Hide' : 'Show'} failed / no-reply devices
          </button>
          {showLists && (
            <div className="bulk-lists">
              {job.failed.length > 0 && (
                <div>
                  <h4>Failed</h4>
                  <ul>
                    {job.failed.map((d) => (
                      <li key={d} className="monospace">{d}</li>
                    ))}
                  </ul>
                </div>
              )}
              {job.noResponse.length > 0 && (
                <div>
                  <h4>No reply (offline or old firmware)</h4>
                  <ul>
                    {job.noResponse.map((d) => (
                      <li key={d} className="monospace">{d}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Devices;
