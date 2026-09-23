import axios from 'axios';
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const api: AxiosInstance = axios.create({
  baseURL: `${API_BASE_URL}/api/cms`,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('admin_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('admin_token');
      window.location.href = '/cms/login';
    }
    return Promise.reject(error);
  }
);

// Auth
export const login = (username: string, password: string) =>
  api.post('/login', { username, password });

export const logout = () => api.post('/logout');

export const getProfile = () => api.get('/profile');

// Dashboard
export const getDashboard = () => api.get('/dashboard');

export const getAnalytics = (params?: {
  startDate?: string;
  endDate?: string;
  userId?: string;
  deviceId?: string;
}) => api.get('/analytics', { params });

// Devices
export const getDevices = (params?: {
  page?: number;
  limit?: number;
  userId?: string;
  search?: string;
}) => api.get('/devices', { params });

export const getDevice = (id: string) => api.get(`/devices/${id}`);

export const updateDevice = (id: string, data: { deviceName?: string; firmwareVersion?: string }) =>
  api.put(`/devices/${id}`, data);

export const deleteDevice = (id: string) => api.delete(`/devices/${id}`);

export const getDeviceDetails = (userId: string, deviceId: string) =>
  api.get(`/devices/${userId}/${deviceId}/details`);

export const triggerFirmwareUpdate = (id: string, targetVersion: string) =>
  api.post(`/devices/${id}/firmware-update`, { targetVersion });

// Remote ESP32 reboot via MQTT cmd/restart (1 request per device per minute).
export const restartDevice = (id: string) => api.post(`/devices/${id}/restart`);

// Bulk (forced) firmware update: selected device _ids, or every device
// matching `search` when `all` is true. Triggers are sent in batches.
export interface BulkFirmwareJob {
  jobId: string;
  status: 'sending' | 'sent';
  createdAt: string;
  sendingFinishedAt: string | null;
  total: number;
  counts: {
    queued: number;
    sent: number;
    in_progress: number;
    success: number;
    failed: number;
  };
  failed: string[];
  noResponse: string[];
}

export const startBulkFirmwareUpdate = (body: {
  ids?: string[];
  all?: boolean;
  search?: string;
}) => api.post<BulkFirmwareJob>('/firmware-bulk-updates', body);

export const getLatestBulkFirmwareUpdate = () =>
  api.get<{ job: BulkFirmwareJob | null }>('/firmware-bulk-updates/latest');

export const getBulkFirmwareUpdate = (jobId: string) =>
  api.get<BulkFirmwareJob>(`/firmware-bulk-updates/${jobId}`);

// Users
export const getUsers = (params?: {
  page?: number;
  limit?: number;
  search?: string;
  isActive?: boolean;
}) => api.get('/users', { params });

export const getUser = (userId: string) => api.get(`/users/${userId}`);

export const updateUser = (userId: string, data: { isActive?: boolean; allowedDevices?: string[] }) =>
  api.put(`/users/${userId}`, data);

export const deleteUser = (userId: string) => api.delete(`/users/${userId}`);

// Blacklist
export const getBlacklist = () => api.get('/blacklist');

export const addToBlacklist = (data: { deviceId: string; userId?: string; reason?: string }) =>
  api.post('/blacklist', data);

export const removeFromBlacklist = (id: string) => api.delete(`/blacklist/${id}`);

export const removeDeviceFromBlacklist = (deviceId: string) =>
  api.delete(`/blacklist/device/${deviceId}`);

// Beta Firmware Devices
export const getBetaFirmwareDevices = () => api.get('/beta-firmware');

export const addBetaFirmwareDevice = (data: {
  deviceId: string;
  userId?: string;
  note?: string;
}) => api.post('/beta-firmware', data);

export const removeBetaFirmwareDevice = (id: string) =>
  api.delete(`/beta-firmware/${id}`);

export const removeBetaFirmwareByDeviceId = (deviceId: string) =>
  api.delete(`/beta-firmware/device/${deviceId}`);

// Settings
export const getSettings = () => api.get('/settings');

export const getMqttConfig = () => api.get('/mqtt-config');

// ==================== Chargers (separate firmware type) ====================
export const getChargerDashboard = () => api.get('/charger/dashboard');

export const getChargers = (params?: {
  page?: number;
  limit?: number;
  userId?: string;
  deviceId?: string;
  search?: string;
}) => api.get('/charger/devices', { params });

export const getCharger = (id: string) => api.get(`/charger/devices/${id}`);

export const getChargerDetails = (userId: string, deviceId: string) =>
  api.get(`/charger/devices/${userId}/${deviceId}/details`);

export const updateCharger = (
  id: string,
  data: { deviceName?: string; firmwareVersion?: string }
) => api.put(`/charger/devices/${id}`, data);

export const deleteCharger = (id: string) =>
  api.delete(`/charger/devices/${id}`);

export const triggerChargerFirmwareUpdate = (id: string, targetVersion: string) =>
  api.post(`/charger/devices/${id}/firmware-update`, { targetVersion });

export default api;
