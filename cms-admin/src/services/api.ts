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
      window.location.href = '/login';
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

// Settings
export const getSettings = () => api.get('/settings');

export const getMqttConfig = () => api.get('/mqtt-config');

export default api;
