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
import { DeviceTypeSwitch } from '../components/SectionNav';

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
  { value: 'local', label: 'Cài trên máy' },
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
      alert('Xoá thiết bị thất bại');
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
      alert('Đã gửi lệnh cập nhật firmware');
    } catch (err) {
      console.error('Failed to trigger firmware update', err);
      alert('Gửi lệnh cập nhật firmware thất bại');
    } finally {
      setIsUpdatingFirmware(false);
    }
  };

  const statCard = (
    icon: React.ReactNode,
    color: string,
    value: number | undefined,
    label: string,
    filter: '' | HybridStatusFilter,
  ) => (
    <button
      type="button"
      className={`stat-card stat-card-button ${filter !== '' && status === filter ? 'selected' : ''}`}
      onClick={() => changeStatus(status === filter ? '' : filter)}
      title={filter ? `Lọc: ${label}` : 'Bỏ lọc'}
    >
      <div className={`stat-icon ${color}`}>{icon}</div>
      <div className="stat-content">
        <span className="stat-value">{value ?? '—'}</span>
        <span className="stat-label">{label}</span>
      </div>
    </button>
  );

  const activeFilter = STATUS_OPTIONS.find((o) => o.value === status && o.value !== '');
  const openDetail = (h: CmsHybrid) => navigate(`/hybrids/${h.userId}/${h.deviceId}`);
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="page devices-page">
      <DeviceTypeSwitch subtitle="Inverter hybrid (HINVLF) — tìm kiếm, trạng thái, lỗi" />

      <div className="stats-grid hy-stats">
        {statCard(<Shuffle size={24} />, 'blue', stats?.totalDevices, 'Tổng số máy', '')}
        {statCard(<Wifi size={24} />, 'green', stats?.onlineDevices, 'Online', 'online')}
        {statCard(<WifiOff size={24} />, 'purple', stats?.offlineDevices, 'Offline', 'offline')}
        {statCard(<AlertTriangle size={24} />, 'pink', stats?.faultDevices, 'Đang lỗi', 'fault')}
        {statCard(<Lock size={24} />, 'orange', stats?.localSourceDevices, 'Cài trên máy (LOCAL)', 'local')}
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
        <button type="submit" className="btn btn-primary">
          Tìm
        </button>
      </form>

      <div className="table-container">
        <div className="hy-toolbar">
          <span className="hy-count">{hybrids ? `${hybrids.total} thiết bị` : 'Thiết bị'}</span>
          {activeFilter && (
            <button type="button" className="hy-chip" onClick={() => changeStatus('')} title="Bỏ lọc">
              {activeFilter.label}
              <X size={14} />
            </button>
          )}
        </div>
        {isLoading ? (
          <div className="loading">Đang tải…</div>
        ) : (
          <>
            <table className="data-table hy-table">
              <thead>
                <tr>
                  <th>Thiết bị</th>
                  <th>Chủ sở hữu</th>
                  <th>Trạng thái</th>
                  <th>Chế độ</th>
                  <th>Firmware</th>
                  <th className="hy-actions-col" aria-label="Thao tác" />
                </tr>
              </thead>
              <tbody>
                {hybrids?.data.map((h) => {
                  const s = h.summary;
                  const fault = fltText(s.flt);
                  return (
                    <tr
                      key={h._id}
                      className={editingId === h._id ? undefined : 'hy-row'}
                      onClick={editingId === h._id ? undefined : () => openDetail(h)}
                    >
                      <td onClick={editingId === h._id ? stop : undefined}>
                        {editingId === h._id ? (
                          <input
                            type="text"
                            value={editData.deviceName}
                            onChange={(e) => setEditData({ ...editData, deviceName: e.target.value })}
                            className="inline-edit"
                            placeholder="Tên thiết bị"
                          />
                        ) : (
                          <>
                            <div className="hy-name">{h.deviceName || h.deviceId}</div>
                            {h.deviceName && h.deviceName !== h.deviceId && (
                              <div className="hy-sub monospace">{h.deviceId}</div>
                            )}
                            {h.description && <div className="hy-sub">{h.description}</div>}
                          </>
                        )}
                      </td>
                      <td>
                        <div>{h.ownerEmail || '—'}</div>
                        <div className="hy-sub monospace" title={h.userId}>
                          {h.userId.length > 14 ? `${h.userId.slice(0, 6)}…${h.userId.slice(-6)}` : h.userId}
                        </div>
                      </td>
                      <td>
                        <span className={`status-badge ${s.online ? 'active' : 'inactive'}`}>
                          {s.online ? 'Online' : 'Offline'}
                        </span>
                        {s.online ? (
                          <div className="hy-sub">
                            {s.st ? (ST_LABEL[s.st] ?? s.st) : '—'}
                            {s.vbat ? ` · Pin ${s.vbat} V` : ''}
                          </div>
                        ) : (
                          s.lastSeenAt && (
                            <div className="hy-sub">Lần cuối {new Date(s.lastSeenAt).toLocaleString('vi-VN')}</div>
                          )
                        )}
                        {fault && (
                          <div className="hy-fault">
                            <AlertTriangle size={12} />
                            {fault}
                            {s.lock ? ' · Khoá' : ''}
                          </div>
                        )}
                      </td>
                      <td>
                        <div>{s.mode ? (MODE_LABEL[s.mode] ?? s.mode) : '—'}</div>
                        {s.src && (
                          <span
                            className={`hy-pill ${s.src === 'LOCAL' ? 'warn' : ''}`}
                            title={
                              s.src === 'LOCAL'
                                ? 'Cài đặt trên máy (LOCAL): app / CMS không đổi được cài đặt'
                                : 'Cài đặt từ app'
                            }
                          >
                            {s.src === 'LOCAL' && <Lock size={11} />}
                            {s.src === 'LOCAL' ? 'Cài trên máy' : 'Cài từ app'}
                          </span>
                        )}
                      </td>
                      <td onClick={editingId === h._id ? stop : undefined}>
                        {editingId === h._id ? (
                          <input
                            type="text"
                            value={editData.firmwareVersion}
                            onChange={(e) => setEditData({ ...editData, firmwareVersion: e.target.value })}
                            className="inline-edit"
                            placeholder="ESP x.y.z"
                          />
                        ) : (
                          <div className="hy-fw">
                            <span className="hy-fw-k">ESP</span>
                            <span>{h.firmwareVersion || '—'}</span>
                            <span className="hy-fw-k">STM</span>
                            <span>{s.stmFw || '—'}</span>
                          </div>
                        )}
                      </td>
                      <td onClick={stop}>
                        <div className="actions hy-actions">
                        {editingId === h._id ? (
                          <>
                            <button className="btn-icon success" onClick={() => saveEdit(h._id)} title="Lưu">
                              <Check size={16} />
                            </button>
                            <button className="btn-icon" onClick={() => setEditingId(null)} title="Huỷ">
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
                            <button className="btn-icon" onClick={() => setDeleteConfirm(null)} title="Huỷ">
                              <X size={16} />
                            </button>
                          </>
                        ) : firmwareUpdateConfirm === h._id ? (
                          <>
                            <button
                              className="btn-icon success"
                              onClick={() => handleFirmwareUpdate(h._id)}
                              disabled={isUpdatingFirmware}
                              title="Mở trang cập nhật firmware"
                            >
                              <Check size={16} />
                            </button>
                            <button className="btn-icon" onClick={() => setFirmwareUpdateConfirm(null)} title="Huỷ">
                              <X size={16} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="btn-icon"
                              onClick={() => openDetail(h)}
                              title="Xem chi tiết"
                            >
                              <Eye size={16} />
                            </button>
                            <button
                              className="btn-icon"
                              onClick={() => setFirmwareUpdateConfirm(h._id)}
                              title="Cập nhật firmware"
                            >
                              <Download size={16} />
                            </button>
                            <button
                              className="btn-icon"
                              onClick={() => {
                                setEditingId(h._id);
                                setEditData({ deviceName: h.deviceName, firmwareVersion: h.firmwareVersion });
                              }}
                              title="Sửa tên / phiên bản"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button className="btn-icon danger" onClick={() => setDeleteConfirm(h._id)} title="Xoá thiết bị">
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {hybrids?.data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty-state">
                      Không có thiết bị nào
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
                  Trang {hybrids.page} / {hybrids.totalPages}
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
