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

// targetVersion omitted -> the backend uses the active stable build.
export const triggerFirmwareUpdate = (id: string, targetVersion?: string) =>
  api.post(`/devices/${id}/firmware-update`, targetVersion ? { targetVersion } : {});

// Remote ESP32 reboot via MQTT cmd/restart (1 request per device per minute).
export const restartDevice = (id: string) => api.post(`/devices/${id}/restart`);
// UART diagnostics: device streams raw STM32 lines on .../debug/uart for
// `minutes` (1..30); 0 = stop.
export const setUartDebug = (id: string, minutes: number) =>
  api.post<{ topic: string; debugTopic: string; minutes: number }>(
    `/devices/${id}/uart-debug`,
    { minutes },
  );

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
  api.get<{
    baseUrl: string;
    pathTemplate: string;
    minEspVersion: string;
    uploadEnabled: boolean;
  }>('/stm-firmwares/config');

// multipart: axios must not turn the FormData into JSON (instance default).
const multipart = (onProgress?: (pct: number) => void) => ({
  headers: { 'Content-Type': 'multipart/form-data' },
  onUploadProgress: (e: { loaded: number; total?: number }) => {
    if (onProgress && e.total) onProgress(Math.round((e.loaded * 100) / e.total));
  },
});

// Upload app.bin (+ app.json) to DO Spaces and register it.
export const uploadStmFirmware = (
  body: {
    product: StmProduct;
    channel: StmChannel;
    version?: string;
    notes?: string;
    bin: File;
    manifest?: File;
  },
  onProgress?: (pct: number) => void,
) => {
  const fd = new FormData();
  fd.append('product', body.product);
  fd.append('channel', body.channel);
  if (body.version) fd.append('version', body.version);
  if (body.notes) fd.append('notes', body.notes);
  fd.append('bin', body.bin);
  if (body.manifest) fd.append('manifest', body.manifest);
  return api.post<StmFirmware & { warning?: string | null }>(
    '/stm-firmwares/upload',
    fd,
    multipart(onProgress),
  );
};

// ---- ESP32 firmware (builds uploaded to DO Spaces) ----
export type EspChannel = 'stable' | 'beta';
export type EspProduct = 'inverter' | 'charger' | 'hybrid';

export interface EspFirmware {
  _id: string;
  product: EspProduct;
  version: string;
  url: string;
  key: string;
  size: number;
  sha256: string;
  md5: string;
  channels: EspChannel[];
  notes: string;
  createdAt: string;
}

export interface ActiveEspFirmware {
  version: string;
  url: string;
  source: 'cms' | 'default';
}

export interface EspFirmwareConfig {
  baseUrl: string;
  pathTemplate: string;
  uploadEnabled: boolean;
  maxBytes: number;
  // OTA slot size per product (charger has a bigger partition table).
  maxBytesByProduct?: Record<EspProduct, number>;
  active: Record<EspProduct, Record<EspChannel, ActiveEspFirmware>>;
}

export const getEspFirmwares = (product?: EspProduct) =>
  api.get<EspFirmware[]>('/esp-firmwares', { params: product ? { product } : undefined });

export const getEspFirmwareConfig = () => api.get<EspFirmwareConfig>('/esp-firmwares/config');

export const uploadEspFirmware = (
  body: {
    product: EspProduct;
    version: string;
    notes?: string;
    activate?: EspChannel;
    bin: File;
  },
  onProgress?: (pct: number) => void,
) => {
  const fd = new FormData();
  fd.append('product', body.product);
  fd.append('version', body.version);
  if (body.notes) fd.append('notes', body.notes);
  if (body.activate) fd.append('activate', body.activate);
  fd.append('bin', body.bin);
  return api.post<EspFirmware & { warning?: string | null }>(
    '/esp-firmwares/upload',
    fd,
    multipart(onProgress),
  );
};

export const activateEspFirmware = (id: string, channel: EspChannel) =>
  api.post<EspFirmware>(`/esp-firmwares/${id}/activate`, { channel });

export const deleteEspFirmware = (id: string) => api.delete(`/esp-firmwares/${id}`);

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

// beta -> stable releases the image to every device with that chip/voltage.
export const setStmFirmwareChannel = (id: string, channel: StmChannel) =>
  api.patch<StmFirmware>(`/stm-firmwares/${id}`, { channel });

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

// Read-only broker account for the live views, issued after admin login
// (nothing secret is baked into the CMS bundle). Fetched once per page load.
let mqttAccountPromise: Promise<{ username: string; password: string }> | null = null;
export const getMqttCredentials = () => {
  mqttAccountPromise ??= api
    .get<{ username: string; password: string }>('/mqtt-credentials')
    .then((res) => res.data)
    .catch((err) => {
      mqttAccountPromise = null; // retry next time
      throw err;
    });
  return mqttAccountPromise;
};

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

// targetVersion omitted -> the backend uses the build active for chargers.
export const triggerChargerFirmwareUpdate = (id: string, targetVersion?: string) =>
  api.post(`/charger/devices/${id}/firmware-update`, targetVersion ? { targetVersion } : {});

export default api;

// ==================== Device health ====================

export type HealthIssue =
  | 'offline'
  | 'reboot_loop'
  | 'crash'
  | 'brownout'
  | 'uart'
  | 'plain_mqtt'
  | 'mqtt_fail'
  | 'low_heap'
  | 'weak_wifi'
  | 'outdated';

export interface HealthRow {
  userId: string;
  deviceId: string;
  deviceName: string | null;
  firmwareVersion: string | null;
  stmFwVersion: string | null;
  online: boolean;
  lastDataAt: string | null;
  boots24h: number;
  lastBoot: { at: string; reason: number; reasonText: string } | null;
  transport: 'tls' | 'plain' | null;
  rssi: number | null;
  heapMin: number | null;
  uart: { at: string; ok: number; bad: number; raw: string } | null;
  badFrame: { at: string; sample: string } | null;
  mqttFails24h: number;
  issues: HealthIssue[];
}

export interface HealthSummary {
  total: number;
  online: number;
  offline: number;
  withProblems: number;
  issues: Record<HealthIssue, number>;
  firmware: { version: string; count: number }[];
  resetReasons24h: { reason: number; text: string; count: number }[];
  newestFirmware: string;
  generatedAt: string;
}

export const getHealthSummary = () => api.get<HealthSummary>('/health/summary');

export const getHealthDevices = (params: {
  status?: string;
  issue?: string;
  fw?: string;
  search?: string;
  sort?: string;
  page?: number;
  limit?: number;
}) =>
  api.get<{ data: HealthRow[]; total: number; page: number; limit: number }>(
    '/health/devices',
    { params }
  );

export const getDeviceHealth = (userId: string, deviceId: string) =>
  api.get<HealthRow | null>(`/health/devices/${userId}/${deviceId}`);

// ==================== Activity (audit log) ====================

export interface ActivityEntry {
  _id: string;
  deviceId: string;
  kind: 'inverter' | 'charger';
  action: 'settings' | 'schedule' | 'grid-tie';
  source: 'app' | 'web' | 'cms' | 'api' | 'system';
  actor: string | null;
  actorLabel: string | null;
  summary: string;
  before: string | null;
  after: string | null;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: string;
}

export const getDeviceActivity = (
  userId: string,
  deviceId: string,
  params: { kind?: 'inverter' | 'charger'; before?: string; limit?: number } = {}
) =>
  api.get<{ data: ActivityEntry[]; nextBefore: string | null }>(
    `/devices/${userId}/${deviceId}/activity`,
    { params }
  );

// ==================== ESP32 staged rollout ====================

export type RolloutStatus = 'running' | 'paused' | 'completed' | 'aborted';
export type RolloutDeviceState =
  | 'pushed'
  | 'installing'
  | 'updated'
  | 'healthy'
  | 'failed'
  | 'rolled_back'
  | 'unhealthy'
  | 'stalled';

export interface RolloutStats {
  eligible: number;
  onVersion: number;
  counts: Record<RolloutDeviceState, number>;
  healthy: number;
  failures: number;
  pending: number;
  failRate: number | null;
}

export interface Rollout {
  _id: string;
  firmwareId: string;
  version: string;
  fromVersion: string;
  stages: number[];
  stageIndex: number;
  percent: number;
  status: RolloutStatus;
  autoPush: boolean;
  autoAdvance: boolean;
  stageHours: number;
  maxFailRate: number;
  minSamples: number;
  observeMinutes: number;
  stageStartedAt: string;
  pendingPush: boolean;
  pauseReason: string | null;
  createdBy: string | null;
  events?: { at: string; type: string; message: string; by?: string | null }[];
  createdAt: string;
  updatedAt: string;
  stats?: RolloutStats;
}

export interface RolloutDeviceRow {
  _id: string;
  userId: string;
  deviceId: string;
  state: RolloutDeviceState;
  fromVersion: string | null;
  otaStatus: string | null;
  reason: string | null;
  updatedAt: string;
}

export const getActiveRollout = () =>
  api.get<{ rollout: Rollout | null }>('/esp-rollouts/active');

export const getRollouts = () => api.get<Rollout[]>('/esp-rollouts');

export const startRollout = (body: {
  firmwareId: string;
  stages?: number[];
  autoPush?: boolean;
  autoAdvance?: boolean;
  stageHours?: number;
  maxFailRate?: number;
  minSamples?: number;
  observeMinutes?: number;
}) => api.post<Rollout>('/esp-rollouts', body);

export const rolloutAction = (
  id: string,
  action: 'pause' | 'resume' | 'advance' | 'abort' | 'push'
) => api.post<Rollout>(`/esp-rollouts/${id}/${action}`);

export const getRolloutDevices = (
  id: string,
  params: { state?: string; page?: number; limit?: number } = {}
) =>
  api.get<{ data: RolloutDeviceRow[]; total: number; page: number; limit: number }>(
    `/esp-rollouts/${id}/devices`,
    { params }
  );
