import React, { useEffect, useState } from 'react';
import { getUsers, getUser, updateUser, deleteUser } from '../services/api';
import {
  Search,
  Eye,
  Trash2,
  X,
  Check,
  ChevronLeft,
  ChevronRight,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';

// Users are listed from their devices; MQTT credentials (Home Assistant
// access) are optional, so the credential fields may be null.
interface User {
  _id: string;
  userId: string;
  hasMqttAccount: boolean;
  mqttUsername: string | null;
  isActive: boolean | null;
  lastUsedAt: string | null;
  createdAt: string | null;
  lastDeviceUpdate?: string | null;
  deviceCount?: number;
}

interface UserDetail extends User {
  devices: Array<{
    _id: string;
    deviceId: string;
    deviceName: string;
    firmwareVersion: string;
  }>;
}

interface UsersResponse {
  data: User[];
  total: number;
  page: number;
  totalPages: number;
}

const Users: React.FC = () => {
  const [users, setUsers] = useState<UsersResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const res = await getUsers({ page, search: submittedSearch || undefined, limit: 20 });
      setUsers(res.data);
    } catch (err) {
      console.error('Failed to fetch users', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [page, submittedSearch]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSubmittedSearch(search.trim());
  };

  const viewUser = async (userId: string) => {
    try {
      const res = await getUser(userId);
      setSelectedUser(res.data);
    } catch (err) {
      console.error('Failed to fetch user details', err);
    }
  };

  const toggleUserStatus = async (userId: string, currentStatus: boolean) => {
    try {
      await updateUser(userId, { isActive: !currentStatus });
      fetchUsers();
      if (selectedUser?.userId === userId) {
        setSelectedUser({ ...selectedUser, isActive: !currentStatus });
      }
    } catch (err) {
      console.error('Failed to update user status', err);
    }
  };

  const handleDelete = async (userId: string) => {
    try {
      await deleteUser(userId);
      setDeleteConfirm(null);
      setSelectedUser(null);
      fetchUsers();
    } catch (err) {
      console.error('Failed to delete user', err);
    }
  };

  return (
    <div className="page users-page">
      <header className="page-header">
        <h1>Users</h1>
        <p>Users (from their devices) and their MQTT / Home Assistant access</p>
      </header>

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="search-bar">
        <div className="search-input-wrapper">
          <Search size={20} />
          <input
            type="text"
            placeholder="Search by user ID or MQTT username..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary">
          Search
        </button>
      </form>

      <div className="users-layout">
        {/* Users Table */}
        <div className="table-container">
          {isLoading ? (
            <div className="loading">Loading users...</div>
          ) : (
            <>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>User ID</th>
                    <th>Devices</th>
                    <th>Last Activity</th>
                    <th>MQTT Username</th>
                    <th>MQTT Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users?.data.map((user) => (
                    <tr
                      key={user.userId}
                      className={selectedUser?.userId === user.userId ? 'selected' : ''}
                    >
                      <td className="monospace">{user.userId}</td>
                      <td>{user.deviceCount || 0}</td>
                      <td>
                        {user.lastDeviceUpdate
                          ? new Date(user.lastDeviceUpdate).toLocaleString()
                          : '—'}
                      </td>
                      <td className="monospace">{user.mqttUsername ?? '—'}</td>
                      <td>
                        {user.hasMqttAccount ? (
                          <span className={`status-badge ${user.isActive ? 'active' : 'inactive'}`}>
                            {user.isActive ? 'Active' : 'Inactive'}
                          </span>
                        ) : (
                          <span className="muted">No account</span>
                        )}
                      </td>
                      <td className="actions">
                        {deleteConfirm === user.userId ? (
                          <>
                            <button
                              className="btn-icon danger"
                              onClick={() => handleDelete(user.userId)}
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
                              onClick={() => viewUser(user.userId)}
                              title="View Details"
                            >
                              <Eye size={16} />
                            </button>
                            {user.hasMqttAccount && (
                              <button
                                className="btn-icon"
                                onClick={() => toggleUserStatus(user.userId, !!user.isActive)}
                                title={user.isActive ? 'Deactivate MQTT' : 'Activate MQTT'}
                              >
                                {user.isActive ? (
                                  <ToggleRight size={16} className="text-green" />
                                ) : (
                                  <ToggleLeft size={16} />
                                )}
                              </button>
                            )}
                            <button
                              className="btn-icon danger"
                              onClick={() => setDeleteConfirm(user.userId)}
                              title="Delete"
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                  {users?.data.length === 0 && (
                    <tr>
                      <td colSpan={6} className="empty-state">
                        No users found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Pagination */}
              {users && users.totalPages > 1 && (
                <div className="pagination">
                  <button
                    className="btn-icon"
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <span>
                    Page {users.page} of {users.totalPages}
                  </span>
                  <button
                    className="btn-icon"
                    disabled={page === users.totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    <ChevronRight size={20} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* User Details Panel */}
        {selectedUser && (
          <div className="detail-panel">
            <div className="detail-header">
              <h3>User Details</h3>
              <button className="btn-icon" onClick={() => setSelectedUser(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="detail-content">
              <div className="detail-item">
                <label>User ID</label>
                <span className="monospace">{selectedUser.userId}</span>
              </div>
              <div className="detail-item">
                <label>MQTT Username</label>
                <span className="monospace">{selectedUser.mqttUsername ?? '—'}</span>
              </div>
              <div className="detail-item">
                <label>MQTT Status</label>
                {selectedUser.hasMqttAccount ? (
                  <span className={`status-badge ${selectedUser.isActive ? 'active' : 'inactive'}`}>
                    {selectedUser.isActive ? 'Active' : 'Inactive'}
                  </span>
                ) : (
                  <span className="muted">No MQTT account</span>
                )}
              </div>
              {selectedUser.createdAt && (
                <div className="detail-item">
                  <label>MQTT Created At</label>
                  <span>{new Date(selectedUser.createdAt).toLocaleString()}</span>
                </div>
              )}
              <div className="detail-item">
                <label>Last Used</label>
                <span>
                  {selectedUser.lastUsedAt
                    ? new Date(selectedUser.lastUsedAt).toLocaleString()
                    : 'Never'}
                </span>
              </div>

              <h4>Devices ({selectedUser.devices?.length || 0})</h4>
              {selectedUser.devices?.length > 0 ? (
                <ul className="device-list">
                  {selectedUser.devices.map((device) => (
                    <li key={device._id}>
                      <span className="device-name">{device.deviceName}</span>
                      <span className="device-id monospace">{device.deviceId}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="no-data">No devices</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Users;
