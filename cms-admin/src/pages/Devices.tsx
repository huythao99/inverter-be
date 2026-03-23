import React, { useEffect, useState } from 'react';
import { getDevices, updateDevice, deleteDevice } from '../services/api';
import {
  Search,
  Edit2,
  Trash2,
  X,
  Check,
  ChevronLeft,
  ChevronRight,
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
  const [devices, setDevices] = useState<DevicesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState({ deviceName: '', firmwareVersion: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchDevices = async () => {
    setIsLoading(true);
    try {
      const res = await getDevices({ page, search: search || undefined, limit: 20 });
      setDevices(res.data);
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
    fetchDevices();
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

      {/* Devices Table */}
      <div className="table-container">
        {isLoading ? (
          <div className="loading">Loading devices...</div>
        ) : (
          <>
            <table className="data-table">
              <thead>
                <tr>
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
                  <tr key={device._id}>
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
                      ) : (
                        <>
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
                    <td colSpan={6} className="empty-state">
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

export default Devices;
