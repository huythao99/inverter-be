import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getHybrids,
  getHybridDashboard,
  updateHybrid,
  deleteHybrid,
  triggerHybridFirmwareUpdate,
  type CmsHybrid,
  type CmsHybridDashboard,
  type HybridStatusFilter,
} from '../services/api';
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
  Shuffle,
  Wifi,
  WifiOff,
  AlertTriangle,
  Lock,
} from 'lucide-react';
import { MODE_LABEL, ST_LABEL, fltText } from '../components/hybrid-labels';

interface HybridsResponse {
  data: CmsHybrid[];
  total: number;
  page: number;
  totalPages: number;
}

const STATUS_OPTIONS: { value: '' | HybridStatusFilter; label: string }[] = [
  { value: '', label: 'Tất cả' },
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
  { value: 'fault', label: 'Đang lỗi' },
  { value: 'local', label: 'SRC = LOCAL' },
];

const Hybrids: React.FC = () => {
  const navigate = useNavigate();
  const [hybrids, setHybrids] = useState<HybridsResponse | null>(null);
  const [stats, setStats] = useState<CmsHybridDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | HybridStatusFilter>('');
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState({ deviceName: '', firmwareVersion: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [firmwareUpdateConfirm, setFirmwareUpdateConfirm] = useState<string | null>(null);
  const [isUpdatingFirmware, setIsUpdatingFirmware] = useState(false);

  const fetchHybrids = async (p = page, st = status) => {
    setIsLoading(true);
    try {
      const res = await getHybrids({
        page: p,
        search: search.trim() || undefined,
        status: st || undefined,
        limit: 20,
      });
      setHybrids(res.data);
    } catch (err) {
      console.error('Failed to fetch hybrids', err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStats = () =>
    getHybridDashboard()
      .then((r) => setStats(r.data))
      .catch((e) => console.error('Failed to fetch hybrid stats', e));

  useEffect(() => {
    fetchHybrids(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    fetchStats();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchHybrids(1);
  };

  const changeStatus = (st: '' | HybridStatusFilter) => {
    setStatus(st);
    setPage(1);
    fetchHybrids(1, st);
  };

  const saveEdit = async (id: string) => {
    try {
      await updateHybrid(id, editData);
      setEditingId(null);
      fetchHybrids();
    } catch (err) {
      console.error('Failed to update hybrid', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteHybrid(id);
      setDeleteConfirm(null);
      fetchHybrids();
      fetchStats();
    } catch (err) {
      console.error('Failed to delete hybrid', err);
      alert('Failed to delete hybrid');
    }
  };

  // The list has no live view: send people to the detail page, where the
  // update is started and its progress shown (MQTT ota/status).
  const handleFirmwareUpdate = async (id: string) => {
    const h = hybrids?.data.find((x) => x._id === id);
    if (h) {
      setFirmwareUpdateConfirm(null);
      navigate(`/hybrids/${h.userId}/${h.deviceId}?ota=1`);
      return;
    }
    setIsUpdatingFirmware(true);
    try {
      await triggerHybridFirmwareUpdate(id);
      setFirmwareUpdateConfirm(null);
      alert('Hybrid firmware update triggered successfully');
    } catch (err) {
      console.error('Failed to trigger firmware update', err);
      alert('Failed to trigger firmware update');
    } finally {
      setIsUpdatingFirmware(false);
    }
  };

  const statCard = (
    icon: React.ReactNode,
    color: string,
    value: number | undefined,
    label: string,
    filter?: '' | HybridStatusFilter,
  ) => (
    <div
      className="stat-card"
      style={filter !== undefined ? { cursor: 'pointer', outline: status === filter ? '2px solid #3b82f6' : undefined } : undefined}
      onClick={filter !== undefined ? () => changeStatus(filter) : undefined}
    >
      <div className={`stat-icon ${color}`}>{icon}</div>
      <div className="stat-content">
        <span className="stat-value">{value ?? '—'}</span>
        <span className="stat-label">{label}</span>
      </div>
    </div>
  );

  return (
    <div className="page devices-page">
      <header className="page-header">
        <h1>Hybrids</h1>
        <p>Inverter hybrid (HINVLF) — tìm kiếm, trạng thái, lỗi</p>
      </header>

      <div className="stats-grid">
        {statCard(<Shuffle size={24} />, 'blue', stats?.totalDevices, 'Tổng số máy', '')}
        {statCard(<Wifi size={24} />, 'green', stats?.onlineDevices, 'Online', 'online')}
        {statCard(<WifiOff size={24} />, 'purple', stats?.offlineDevices, 'Offline', 'offline')}
        {statCard(<AlertTriangle size={24} />, 'pink', stats?.faultDevices, 'Đang lỗi', 'fault')}
        {statCard(<Lock size={24} />, 'orange', stats?.localSourceDevices, 'SRC = LOCAL', 'local')}
      </div>

      <form onSubmit={handleSearch} className="search-bar">
        <div className="search-input-wrapper">
          <Search size={20} />
          <input
            type="text"
            placeholder="Tìm theo HybridControl…, tên, mô tả, user ID hoặc email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          value={status}
          onChange={(e) => changeStatus(e.target.value as '' | HybridStatusFilter)}
          className="inline-edit"
          style={{ width: 'auto', minWidth: 140 }}
          aria-label="Lọc trạng thái"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary">
          Search
        </button>
      </form>

      <div className="table-container">
        {isLoading ? (
          <div className="loading">Loading hybrids...</div>
        ) : (
          <>
            {hybrids && (
              <p className="muted" style={{ margin: '0 0 8px' }}>
                {hybrids.total} máy
              </p>
            )}
            <table className="data-table">
              <thead>
                <tr>
                  <th>Device ID</th>
                  <th>Device Name</th>
                  <th>User</th>
                  <th>Trạng thái</th>
                  <th>Chế độ / SRC</th>
                  <th>Firmware</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {hybrids?.data.map((h) => {
                  const s = h.summary;
                  const fault = fltText(s.flt);
                  return (
                    <tr key={h._id}>
                      <td className="monospace">{h.deviceId}</td>
                      <td>
                        {editingId === h._id ? (
                          <input
                            type="text"
                            value={editData.deviceName}
                            onChange={(e) => setEditData({ ...editData, deviceName: e.target.value })}
                            className="inline-edit"
                          />
                        ) : (
                          <>
                            <div>{h.deviceName}</div>
                            {h.description && (
                              <div className="muted" style={{ fontSize: 12 }}>
                                {h.description}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td>
                        {h.ownerEmail && <div>{h.ownerEmail}</div>}
                        <div className="monospace" style={{ fontSize: 12, opacity: h.ownerEmail ? 0.6 : 1 }}>
                          {h.userId}
                        </div>
                      </td>
                      <td>
                        <span className={`status-badge ${s.online ? 'active' : 'inactive'}`}>
                          {s.online ? 'Online' : 'Offline'}
                        </span>
                        <div style={{ fontSize: 12, marginTop: 4 }}>
                          {s.st ? (ST_LABEL[s.st] ?? s.st) : '—'}
                          {s.vbat ? ` · ${s.vbat} V` : ''}
                        </div>
                        {fault && (
                          <div style={{ fontSize: 12, color: '#b91c1c' }}>
                            {fault}
                            {s.lock ? ' · KHÓA' : ''}
                          </div>
                        )}
                        {!s.online && s.lastSeenAt && (
                          <div className="muted" style={{ fontSize: 11 }}>
                            {new Date(s.lastSeenAt).toLocaleString()}
                          </div>
                        )}
                      </td>
                      <td>
                        <div>{s.mode ? (MODE_LABEL[s.mode] ?? s.mode) : '—'}</div>
                        <div style={{ fontSize: 12, color: s.src === 'LOCAL' ? '#c2410c' : undefined }}>
                          {s.src ?? '—'}
                        </div>
                      </td>
                      <td>
                        {editingId === h._id ? (
                          <input
                            type="text"
                            value={editData.firmwareVersion}
                            onChange={(e) => setEditData({ ...editData, firmwareVersion: e.target.value })}
                            className="inline-edit"
                          />
                        ) : (
                          <>
                            <div>ESP {h.firmwareVersion}</div>
                            {s.stmFw && (
                              <div className="muted" style={{ fontSize: 12 }}>
                                STM {s.stmFw}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="actions">
                        {editingId === h._id ? (
                          <>
                            <button className="btn-icon success" onClick={() => saveEdit(h._id)} title="Save">
                              <Check size={16} />
                            </button>
                            <button className="btn-icon" onClick={() => setEditingId(null)} title="Cancel">
                              <X size={16} />
                            </button>
                          </>
                        ) : deleteConfirm === h._id ? (
                          <>
                            <button
                              className="btn-icon danger"
                              onClick={() => handleDelete(h._id)}
                              title="Xác nhận xoá (thu hồi MQTT, xoá dữ liệu)"
                            >
                              <Check size={16} />
                            </button>
                            <button className="btn-icon" onClick={() => setDeleteConfirm(null)} title="Cancel">
                              <X size={16} />
                            </button>
                          </>
                        ) : firmwareUpdateConfirm === h._id ? (
                          <>
                            <button
                              className="btn-icon success"
                              onClick={() => handleFirmwareUpdate(h._id)}
                              disabled={isUpdatingFirmware}
                              title="Confirm Update"
                            >
                              <Check size={16} />
                            </button>
                            <button className="btn-icon" onClick={() => setFirmwareUpdateConfirm(null)} title="Cancel">
                              <X size={16} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="btn-icon"
                              onClick={() => navigate(`/hybrids/${h.userId}/${h.deviceId}`)}
                              title="View Details"
                            >
                              <Eye size={16} />
                            </button>
                            <button
                              className="btn-icon"
                              onClick={() => setFirmwareUpdateConfirm(h._id)}
                              title="Update Firmware"
                            >
                              <Download size={16} />
                            </button>
                            <button
                              className="btn-icon"
                              onClick={() => {
                                setEditingId(h._id);
                                setEditData({ deviceName: h.deviceName, firmwareVersion: h.firmwareVersion });
                              }}
                              title="Edit"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button className="btn-icon danger" onClick={() => setDeleteConfirm(h._id)} title="Delete">
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {hybrids?.data.length === 0 && (
                  <tr>
                    <td colSpan={7} className="empty-state">
                      No hybrids found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {hybrids && hybrids.totalPages > 1 && (
              <div className="pagination">
                <button className="btn-icon" disabled={page === 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft size={20} />
                </button>
                <span>
                  Page {hybrids.page} of {hybrids.totalPages}
                </span>
                <button
                  className="btn-icon"
                  disabled={page === hybrids.totalPages}
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

export default Hybrids;
