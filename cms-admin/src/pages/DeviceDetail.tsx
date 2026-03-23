import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getDeviceDetails } from '../services/api';
import {
  ArrowLeft,
  Cpu,
  Settings,
  Calendar,
  Activity,
  Database,
} from 'lucide-react';

interface DeviceDetailData {
  device: {
    _id: string;
    userId: string;
    deviceId: string;
    deviceName: string;
    firmwareVersion: string;
    updatedAt: string;
  } | null;
  data: {
    value: string;
    parsedValue?: any;
    totalACapacity: number;
    totalA2Capacity: number;
    updatedAt: string;
  } | null;
  settings: {
    value: string;
    parsedValue?: any;
    updatedAt: string;
  } | null;
  schedule: {
    schedule: string;
    parsedSchedule?: any;
    updatedAt: string;
  } | null;
  dailyTotals: Array<{
    date: string;
    totalA: number;
    totalA2: number;
  }>;
}

const DeviceDetail: React.FC = () => {
  const { userId, deviceId } = useParams<{ userId: string; deviceId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<DeviceDetailData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'data' | 'settings' | 'schedule' | 'totals'>('data');

  useEffect(() => {
    const fetchData = async () => {
      if (!userId || !deviceId) return;

      try {
        const res = await getDeviceDetails(userId, deviceId);
        setData(res.data);
      } catch (err: any) {
        setError(err.response?.data?.message || 'Failed to load device details');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [userId, deviceId]);

  if (isLoading) {
    return <div className="loading">Loading device details...</div>;
  }

  if (error) {
    return <div className="error-state">{error}</div>;
  }

  const renderJsonValue = (value: any, title: string) => {
    if (!value) return <p className="no-data">No {title} available</p>;

    return (
      <pre className="json-viewer">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  };

  return (
    <div className="page device-detail-page">
      <header className="page-header">
        <button className="btn-back" onClick={() => navigate('/devices')}>
          <ArrowLeft size={20} />
          Back to Devices
        </button>
        <div className="header-content">
          <h1>{data?.device?.deviceName || deviceId}</h1>
          <p className="device-info">
            <span className="monospace">{userId}</span> / <span className="monospace">{deviceId}</span>
          </p>
        </div>
      </header>

      {/* Device Info Card */}
      {data?.device && (
        <div className="info-card">
          <div className="info-item">
            <Cpu size={18} />
            <div>
              <label>Device ID</label>
              <span className="monospace">{data.device.deviceId}</span>
            </div>
          </div>
          <div className="info-item">
            <Activity size={18} />
            <div>
              <label>Firmware</label>
              <span>{data.device.firmwareVersion}</span>
            </div>
          </div>
          <div className="info-item">
            <Database size={18} />
            <div>
              <label>Total A Capacity</label>
              <span>{data.data?.totalACapacity?.toFixed(2) || '0.00'}</span>
            </div>
          </div>
          <div className="info-item">
            <Database size={18} />
            <div>
              <label>Total A2 Capacity</label>
              <span>{data.data?.totalA2Capacity?.toFixed(2) || '0.00'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab ${activeTab === 'data' ? 'active' : ''}`}
          onClick={() => setActiveTab('data')}
        >
          <Database size={18} />
          Data
        </button>
        <button
          className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <Settings size={18} />
          Settings
        </button>
        <button
          className={`tab ${activeTab === 'schedule' ? 'active' : ''}`}
          onClick={() => setActiveTab('schedule')}
        >
          <Calendar size={18} />
          Schedule
        </button>
        <button
          className={`tab ${activeTab === 'totals' ? 'active' : ''}`}
          onClick={() => setActiveTab('totals')}
        >
          <Activity size={18} />
          Daily Totals
        </button>
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {activeTab === 'data' && (
          <div className="content-section">
            <h3>Device Data</h3>
            {data?.data?.updatedAt && (
              <p className="last-updated">
                Last updated: {new Date(data.data.updatedAt).toLocaleString()}
              </p>
            )}
            {renderJsonValue(data?.data?.parsedValue || data?.data?.value, 'data')}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="content-section">
            <h3>Device Settings</h3>
            {data?.settings?.updatedAt && (
              <p className="last-updated">
                Last updated: {new Date(data.settings.updatedAt).toLocaleString()}
              </p>
            )}
            {renderJsonValue(data?.settings?.parsedValue || data?.settings?.value, 'settings')}
          </div>
        )}

        {activeTab === 'schedule' && (
          <div className="content-section">
            <h3>Device Schedule</h3>
            {data?.schedule?.updatedAt && (
              <p className="last-updated">
                Last updated: {new Date(data.schedule.updatedAt).toLocaleString()}
              </p>
            )}
            {renderJsonValue(data?.schedule?.parsedSchedule || data?.schedule?.schedule, 'schedule')}
          </div>
        )}

        {activeTab === 'totals' && (
          <div className="content-section">
            <h3>Daily Totals (Last 30 Days)</h3>
            {data?.dailyTotals && data.dailyTotals.length > 0 ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Total A</th>
                    <th>Total A2</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dailyTotals.map((day, index) => (
                    <tr key={index}>
                      <td>{new Date(day.date).toLocaleDateString()}</td>
                      <td>{day.totalA.toFixed(2)}</td>
                      <td>{day.totalA2.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="no-data">No daily totals available</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DeviceDetail;
