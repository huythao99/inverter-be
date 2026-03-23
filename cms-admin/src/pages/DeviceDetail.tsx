import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import { getDeviceDetails } from '../services/api';
import {
  ArrowLeft,
  Cpu,
  Settings,
  Calendar,
  Activity,
  Database,
  Radio,
  Wifi,
  WifiOff,
} from 'lucide-react';

// MQTT WebSocket URL (broker must have WebSocket listener enabled on port 9001)
const MQTT_WS_URL = import.meta.env.VITE_MQTT_WS_URL || 'ws://localhost:9001';
const MQTT_USERNAME = import.meta.env.VITE_MQTT_USERNAME || '';
const MQTT_PASSWORD = import.meta.env.VITE_MQTT_PASSWORD || '';

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

interface RealtimeData {
  userId: string;
  deviceId: string;
  data: {
    value: string;
    parsedValue?: any;
    totalACapacity: number;
    totalA2Capacity: number;
  };
  timestamp: string;
}

// Helper function to safely format numbers
const formatNumber = (value: unknown, decimals = 2): string => {
  if (value === null || value === undefined) return '0.00';
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(num)) return '0.00';
  return num.toFixed(decimals);
};

const DeviceDetail: React.FC = () => {
  const { userId, deviceId } = useParams<{ userId: string; deviceId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<DeviceDetailData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'realtime' | 'data' | 'settings' | 'schedule' | 'totals'>('realtime');

  // Real-time state
  const [isConnected, setIsConnected] = useState(false);
  const [realtimeData, setRealtimeData] = useState<RealtimeData | null>(null);
  const [realtimeHistory, setRealtimeHistory] = useState<RealtimeData[]>([]);
  const mqttClientRef = useRef<MqttClient | null>(null);

  // Fetch initial data
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

  // MQTT connection
  useEffect(() => {
    if (!userId || !deviceId) return;

    // Connect to MQTT broker via WebSocket
    const client = mqtt.connect(MQTT_WS_URL, {
      username: MQTT_USERNAME,
      password: MQTT_PASSWORD,
      clientId: `cms-admin-${Date.now()}`,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    });

    mqttClientRef.current = client;

    client.on('connect', () => {
      console.log('MQTT connected');
      setIsConnected(true);

      // Subscribe to device data topic
      const topic = `inverter/${userId}/${deviceId}/data`;
      client.subscribe(topic, { qos: 0 }, (err) => {
        if (err) {
          console.error('MQTT subscribe error:', err);
        } else {
          console.log(`Subscribed to ${topic}`);
        }
      });
    });

    client.on('disconnect', () => {
      console.log('MQTT disconnected');
      setIsConnected(false);
    });

    client.on('offline', () => {
      console.log('MQTT offline');
      setIsConnected(false);
    });

    client.on('error', (err) => {
      console.error('MQTT error:', err);
      setIsConnected(false);
    });

    client.on('message', (_topic, message) => {
      try {
        const messageStr = message.toString();

        // Clean control characters from the message
        const cleanedStr = messageStr.replace(/[\x00-\x1F\x7F]/g, '');

        let payload: any = null;
        let parsedValue: any = null;
        let value = cleanedStr;
        let totalACapacity = 0;
        let totalA2Capacity = 0;

        // Try to parse the message as JSON
        try {
          payload = JSON.parse(cleanedStr);
          value = payload.value || cleanedStr;
          totalACapacity = parseFloat(payload.totalACapacity) || 0;
          totalA2Capacity = parseFloat(payload.totalA2Capacity) || 0;

          // Try to parse the value field if it's a JSON string
          if (payload.value && typeof payload.value === 'string') {
            try {
              const cleanedValue = payload.value.replace(/[\x00-\x1F\x7F]/g, '');
              parsedValue = JSON.parse(cleanedValue);
            } catch {
              // Value is not JSON, keep as string
            }
          }
        } catch {
          // Message is not JSON, use raw string
          console.log('Raw MQTT message (not JSON):', cleanedStr.substring(0, 100));
        }

        const realtimeEntry: RealtimeData = {
          userId: userId!,
          deviceId: deviceId!,
          data: {
            value,
            parsedValue,
            totalACapacity,
            totalA2Capacity,
          },
          timestamp: new Date().toISOString(),
        };

        setRealtimeData(realtimeEntry);
        setRealtimeHistory((prev) => {
          const newHistory = [realtimeEntry, ...prev].slice(0, 50); // Keep last 50 messages
          return newHistory;
        });
      } catch (err) {
        console.error('Error processing MQTT message:', err);
      }
    });

    return () => {
      if (client) {
        const topic = `inverter/${userId}/${deviceId}/data`;
        client.unsubscribe(topic);
        client.end();
      }
    };
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
            <span className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
              {isConnected ? <Wifi size={16} /> : <WifiOff size={16} />}
              {isConnected ? 'MQTT Live' : 'MQTT Offline'}
            </span>
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
              <span>{formatNumber(realtimeData?.data?.totalACapacity ?? data.data?.totalACapacity)}</span>
            </div>
          </div>
          <div className="info-item">
            <Database size={18} />
            <div>
              <label>Total A2 Capacity</label>
              <span>{formatNumber(realtimeData?.data?.totalA2Capacity ?? data.data?.totalA2Capacity)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab ${activeTab === 'realtime' ? 'active' : ''}`}
          onClick={() => setActiveTab('realtime')}
        >
          <Radio size={18} />
          Real-time
          {isConnected && <span className="live-dot" />}
        </button>
        <button
          className={`tab ${activeTab === 'data' ? 'active' : ''}`}
          onClick={() => setActiveTab('data')}
        >
          <Database size={18} />
          Stored Data
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
        {activeTab === 'realtime' && (
          <div className="content-section">
            <div className="realtime-header">
              <h3>Real-time MQTT Data</h3>
              <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>

            {!isConnected && (
              <div className="connection-warning">
                <WifiOff size={24} />
                <p>Not connected to MQTT broker. Check broker WebSocket configuration (port 9001).</p>
              </div>
            )}

            {realtimeData && (
              <div className="realtime-current">
                <h4>Latest Data</h4>
                <p className="last-updated">
                  Received: {new Date(realtimeData.timestamp).toLocaleString()}
                </p>
                {renderJsonValue(realtimeData.data.parsedValue || realtimeData.data.value, 'real-time data')}
              </div>
            )}

            {realtimeHistory.length > 0 && (
              <div className="realtime-history">
                <h4>History (Last {realtimeHistory.length} messages)</h4>
                <div className="history-list">
                  {realtimeHistory.map((item, index) => (
                    <div key={index} className="history-item">
                      <span className="history-time">
                        {new Date(item.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="history-capacity">
                        A: {formatNumber(item.data.totalACapacity)} | A2: {formatNumber(item.data.totalA2Capacity)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!realtimeData && isConnected && (
              <p className="no-data">Waiting for data from device...</p>
            )}
          </div>
        )}

        {activeTab === 'data' && (
          <div className="content-section">
            <h3>Stored Device Data</h3>
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
                      <td>{formatNumber(day.totalA)}</td>
                      <td>{formatNumber(day.totalA2)}</td>
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
