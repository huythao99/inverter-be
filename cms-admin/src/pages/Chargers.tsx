import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getChargers,
  updateCharger,
  deleteCharger,
  triggerChargerFirmwareUpdate,
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
} from 'lucide-react';

interface Charger {
  _id: string;
  userId: string;
  deviceId: string;
  deviceName: string;
  firmwareVersion: string;
  updatedAt: string;
}

interface ChargersResponse {
  data: Charger[];
  total: number;
  page: number;
  totalPages: number;
}

const Chargers: React.FC = () => {
  const navigate = useNavigate();
  const [chargers, setChargers] = useState<ChargersResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState({ deviceName: '', firmwareVersion: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [firmwareUpdateConfirm, setFirmwareUpdateConfirm] = useState<string | null>(null);
  const [isUpdatingFirmware, setIsUpdatingFirmware] = useState(false);

  const fetchChargers = async () => {
    setIsLoading(true);
    try {
      const res = await getChargers({ page, search: search || undefined, limit: 20 });
      setChargers(res.data);
    } catch (err) {
      console.error('Failed to fetch chargers', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchChargers();
  }, [page]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchChargers();
  };

  const startEdit = (charger: Charger) => {
    setEditingId(charger._id);
    setEditData({
      deviceName: charger.deviceName,
      firmwareVersion: charger.firmwareVersion,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditData({ deviceName: '', firmwareVersion: '' });
  };

  const saveEdit = async (id: string) => {
    try {
      await updateCharger(id, editData);
      setEditingId(null);
      fetchChargers();
    } catch (err) {
      console.error('Failed to update charger', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteCharger(id);
      setDeleteConfirm(null);
      fetchChargers();
    } catch (err) {
      console.error('Failed to delete charger', err);
    }
  };

  const handleFirmwareUpdate = async (id: string) => {
    setIsUpdatingFirmware(true);
    try {
      await triggerChargerFirmwareUpdate(id);
      setFirmwareUpdateConfirm(null);
      alert('Charger firmware update triggered successfully');
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
        <h1>Chargers</h1>
        <p>Manage charger devices</p>
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

      {/* Chargers Table */}
      <div className="table-container">
        {isLoading ? (
          <div className="loading">Loading chargers...</div>
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
                {chargers?.data.map((charger) => (
                  <tr key={charger._id}>
                    <td className="monospace">{charger.deviceId}</td>
                    <td>
                      {editingId === charger._id ? (
                        <input
                          type="text"
                          value={editData.deviceName}
                          onChange={(e) =>
                            setEditData({ ...editData, deviceName: e.target.value })
                          }
                          className="inline-edit"
                        />
                      ) : (
                        charger.deviceName
                      )}
                    </td>
                    <td className="monospace">{charger.userId}</td>
                    <td>
                      {editingId === charger._id ? (
                        <input
                          type="text"
                          value={editData.firmwareVersion}
                          onChange={(e) =>
                            setEditData({ ...editData, firmwareVersion: e.target.value })
                          }
                          className="inline-edit"
                        />
                      ) : (
                        charger.firmwareVersion
                      )}
                    </td>
                    <td>{new Date(charger.updatedAt).toLocaleString()}</td>
                    <td className="actions">
                      {editingId === charger._id ? (
                        <>
                          <button
                            className="btn-icon success"
                            onClick={() => saveEdit(charger._id)}
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
                      ) : deleteConfirm === charger._id ? (
                        <>
                          <button
                            className="btn-icon danger"
                            onClick={() => handleDelete(charger._id)}
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
                      ) : firmwareUpdateConfirm === charger._id ? (
                        <>
                          <button
                            className="btn-icon success"
                            onClick={() => handleFirmwareUpdate(charger._id)}
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
                            onClick={() => navigate(`/chargers/${charger.userId}/${charger.deviceId}`)}
                            title="View Details"
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            className="btn-icon"
                            onClick={() => setFirmwareUpdateConfirm(charger._id)}
                            title="Update Firmware"
                          >
                            <Download size={16} />
                          </button>
                          <button
                            className="btn-icon"
                            onClick={() => startEdit(charger)}
                            title="Edit"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            className="btn-icon danger"
                            onClick={() => setDeleteConfirm(charger._id)}
                            title="Delete"
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {chargers?.data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty-state">
                      No chargers found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* Pagination */}
            {chargers && chargers.totalPages > 1 && (
              <div className="pagination">
                <button
                  className="btn-icon"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft size={20} />
                </button>
                <span>
                  Page {chargers.page} of {chargers.totalPages}
                </span>
                <button
                  className="btn-icon"
                  disabled={page === chargers.totalPages}
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

export default Chargers;
