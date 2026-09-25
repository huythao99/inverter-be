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

// ---- STM32 firmware (FOTA through the ESP32) ----
export type StmProduct = 'inverter' | 'charger';
export type StmChannel = 'stable' | 'beta';

export interface StmFirmware {
  _id: string;
  product: StmProduct;
  channel: StmChannel;
  // "major.voltage.patch": 2nd number = voltage class (1=12V, 2=24V, 3=36V, 4=48V)
  version: string;
  major: number; // 3 = F303, 2 = G431
  voltageCode: number;
  url: string;
  size: number;
  crc32: string;
  appBase: string | null;
  built: string | null;
  notes: string;
  enabled: boolean;
  createdAt: string;
}

export interface StmTarget {
  id: string;
  channel: StmChannel;
  version: string;
  major: number;
  chip: string | null;
  voltageCode: number;
  voltage: string | null;
  url: string;
  size: number;
  crc32: string;
}

export interface DeviceStmInfo {
  userId?: string;
  deviceId?: string;
  version: string | null;
  major: number | null;
  chip: string | null;
  voltageCode: number | null;
  voltage: string | null;
  crc32: string | null;
  reportedAt: string | null;
  supported: boolean;
  minEspVersion: string;
  target: StmTarget | null;
  updateAvailable: boolean;
  reason: null | 'esp_firmware_too_old' | 'version_unknown' | 'no_firmware';
  lastOta: {
    status: string;
    progress?: number | null;
    message?: string | null;
    targetVersion?: string;
    source?: string;
    at: string;
  } | null;
}

export const getStmFirmwares = (product?: StmProduct) =>
  api.get<StmFirmware[]>('/stm-firmwares', { params: product ? { product } : undefined });

export const getStmFirmwareConfig = () =>
  api.get<{ baseUrl: string; pathTemplate: string; minEspVersion: string }>(
    '/stm-firmwares/config',
  );

export const registerStmFirmware = (body: {
  product: StmProduct;
  channel: StmChannel;
  version: string;
  binUrl?: string;
  manifestUrl?: string;
  notes?: string;
}) => api.post<StmFirmware>('/stm-firmwares', body);

export const setStmFirmwareEnabled = (id: string, enabled: boolean) =>
  api.patch<StmFirmware>(`/stm-firmwares/${id}`, { enabled });

export const deleteStmFirmware = (id: string) => api.delete(`/stm-firmwares/${id}`);

export const getDeviceStm = (id: string) => api.get<DeviceStmInfo>(`/devices/${id}/stm`);

export const triggerStmUpdate = (id: string, force = false) =>
  api.post<{ success: boolean; targetVersion: string; crc32: string }>(
    `/devices/${id}/stm-update`,
    { force },
  );

// Bulk (forced) firmware update: selected device _ids, or every device
// matching `search` when `all` is true. Triggers are sent in batches.
export type BulkTarget = 'esp32' | 'stm32';

export interface BulkFirmwareJob {
  jobId: string;
  target?: BulkTarget;
  status: 'sending' | 'sent';
  createdAt: string;
  sendingFinishedAt: string | null;
  total: number;
  targetVersion?: string;
  skipped?: number;
  skippedBeta?: number;
  skippedLegacy?: number;
  skippedUnsupported?: number;
  skippedNoFirmware?: number;
  counts: {
    queued: number;
    sent: number;
    in_progress: number;
    success: number;
    failed: number;
    skipped_uptodate?: number;
    skipped_beta?: number;
    skipped_legacy?: number;
    skipped_unsupported?: number;
    skipped_nofw?: number;
  };
  failed: string[];
  noResponse: string[];
}

export const startBulkFirmwareUpdate = (body: {
  ids?: string[];
  all?: boolean;
  search?: string;
  includeUpToDate?: boolean;
  includeBeta?: boolean;
  target?: BulkTarget;
}) => api.post<BulkFirmwareJob>('/firmware-bulk-updates', body);

export const getLatestBulkFirmwareUpdate = () =>
  api.get<{ job: BulkFirmwareJob | null }>('/firmware-bulk-updates/latest');

export const getBulkFirmwareUpdate = (jobId: string) =>
  api.get<BulkFirmwareJob>(`/firmware-bulk-updates/${jobId}`);

export type BulkDeviceState =
  | 'queued'
  | 'sent'
  | 'in_progress'
  | 'success'
  | 'failed'
  | 'skipped_uptodate'
  | 'skipped_beta'
  | 'skipped_legacy'
  | 'skipped_unsupported'
  | 'skipped_nofw';

export interface BulkJobDeviceRow {
  userId: string;
  deviceId: string;
  state: BulkDeviceState;
  otaStatus?: string;
  progress?: number;
  message?: string;
  version?: string;
  at?: string;
}

export interface BulkJobDevicesPage {
  jobId: string;
  state: BulkDeviceState | 'all';
  total: number;
  page: number;
  limit: number;
  data: BulkJobDeviceRow[];
}

export const getBulkFirmwareUpdateDevices = (
  jobId: string,
  params: { state?: BulkDeviceState; page?: number; limit?: number },
) =>
  api.get<BulkJobDevicesPage>(`/firmware-bulk-updates/${jobId}/devices`, {
    params,
  });

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
