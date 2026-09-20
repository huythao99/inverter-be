import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import { getChargerDetails, triggerChargerFirmwareUpdate } from '../services/api';
import {
  ArrowLeft,
  Cpu,
  Settings,
  Activity,
  Radio,
  Wifi,
  WifiOff,
  Download,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

const MQTT_WS_URL = import.meta.env.VITE_MQTT_WS_URL || 'ws://localhost:9001';
const MQTT_USERNAME = import.meta.env.VITE_MQTT_USERNAME || '';
const MQTT_PASSWORD = import.meta.env.VITE_MQTT_PASSWORD || '';

interface ChargerDetailData {
  device: {
    _id: string;
    userId: string;
    deviceId: string;
    deviceName: string;
    firmwareVersion: string;
    updatedAt: string;
  } | null;
  data:
    | ({
        online: boolean;
        status: string;
        src?: string;
        st?: string;
        vbat?: string;
        ibat?: string;
        cfgVbat?: string;
        cfgIbat?: string;
        updatedAt?: string;
        raw?: string;
      } & Record<string, unknown>)
    | null;
  setting:
    | { value: string; vbat?: number; ibat?: number; updatedAt?: string }
    | null;
}

interface OtaStatus {
  status: string;
  progress?: number;
  message?: string;
  timestamp: string;
}

// Parse a raw STM32 frame "$TYPE,KEY=VALUE,...*CRC" into { type, ...kv }.
const parseFrame = (raw: string): Record<string, string> | null => {
  const t = raw.trim();
  if (t[0] !== '$') return null;
  const star = t.lastIndexOf('*');
  const body = star === -1 ? t.slice(1) : t.slice(1, star);
  const parts = body.split(',');
  const type = parts.shift();
  if (!type) return null;
  const out: Record<string, string> = { type, raw: t };
  for (const item of parts) {
    const eq = item.indexOf('=');
    if (eq === -1) continue;
    out[item.slice(0, eq)] = item.slice(eq + 1);
  }
  return out;
};

interface FrameEntry {
  frame: Record<string, string>;
  timestamp: string;
}

const ChargerDetail: React.FC = () => {
  const { userId, deviceId } = useParams<{ userId: string; deviceId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ChargerDetailData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'realtime' | 'data' | 'settings'>(
    'realtime',
  );

  const [isUpdatingFirmware, setIsUpdatingFirmware] = useState(false);
  const [otaStatus, setOtaStatus] = useState<OtaStatus | null>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [latestFrame, setLatestFrame] = useState<FrameEntry | null>(null);
  const [frameHistory, setFrameHistory] = useState<FrameEntry[]>([]);
  const [liveSrc, setLiveSrc] = useState<string | undefined>();
  const mqttClientRef = useRef<MqttClient | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!userId || !deviceId) return;
      try {
        const res = await getChargerDetails(userId, deviceId);
        setData(res.data);
        setLiveSrc(res.data?.data?.src);
      } catch (err: any) {
        setError(err.response?.data?.message || 'Failed to load charger details');
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [userId, deviceId]);

  useEffect(() => {
    if (!userId || !deviceId) return;

    const client = mqtt.connect(MQTT_WS_URL, {
      username: MQTT_USERNAME,
      password: MQTT_PASSWORD,
      clientId: `cms-charger-${Date.now()}`,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    });
    mqttClientRef.current = client;

    const dataTopic = `charger/${userId}/${deviceId}/data`;
    const otaTopic = `charger/${userId}/${deviceId}/ota/status`;

    client.on('connect', () => {
      setIsConnected(true);
      client.subscribe(dataTopic, { qos: 0 });
      client.subscribe(otaTopic, { qos: 1 });
    });
    client.on('disconnect', () => setIsConnected(false));
    client.on('offline', () => setIsConnected(false));
    client.on('error', () => setIsConnected(false));

    client.on('message', (topic, message) => {
      const raw = message.toString().replace(/[\x00-\x08\x0E-\x1F\x7F]/g, '');

      if (topic.endsWith('/ota/status')) {
        try {
          const p = JSON.parse(raw);
          setOtaStatus({
            status: p.status,
            progress: p.progress,
            message: p.message,
            timestamp: new Date().toISOString(),
          });
          if (p.status === 'success' || p.status === 'failed') {
            setIsUpdatingFirmware(false);
            if (p.status === 'success') {
              setTimeout(() => window.location.reload(), 2000);
            }
          }
        } catch {
          // ignore
        }
        return;
      }

      // `data` topic is a RAW STM32 frame string.
      const frame = parseFrame(raw);
      if (!frame) return;
      const entry: FrameEntry = { frame, timestamp: new Date().toISOString() };
      setLatestFrame(entry);
      setFrameHistory((prev) => [entry, ...prev].slice(0, 50));
      if (frame.type?.toUpperCase() === 'CFG' && frame.SRC) {
        setLiveSrc(frame.SRC);
      }
    });

    return () => {
      client.unsubscribe(dataTopic);
      client.unsubscribe(otaTopic);
      client.end();
    };
  }, [userId, deviceId]);

  const handleFirmwareUpdate = async () => {
    if (!data?.device?._id) return;
    const confirmed = window.confirm(
      `Trigger firmware update for ${data.device.deviceName || deviceId}?`,
    );
    if (!confirmed) return;
    setIsUpdatingFirmware(true);
    try {
      await triggerChargerFirmwareUpdate(data.device._id, '1.0.0');
      alert('Firmware update triggered. The charger will begin updating.');
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to trigger firmware update');
    } finally {
      setIsUpdatingFirmware(false);
    }
  };

  if (isLoading) return <div className="loading">Loading charger details...</div>;
  if (error) return <div className="error-state">{error}</div>;

  const online = data?.data?.online;

  return (
    <div className="page device-detail-page">
      <header className="page-header">
        <button className="btn-back" onClick={() => navigate('/chargers')}>
          <ArrowLeft size={20} />
          Back to Chargers
        </button>
        <div className="header-content">
          <h1>{data?.device?.deviceName || deviceId}</h1>
          <p className="device-info">
            <span className="monospace">{userId}</span> /{' '}
            <span className="monospace">{deviceId}</span>
            <span
              className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}
            >
              {isConnected ? <Wifi size={16} /> : <WifiOff size={16} />}
              {isConnected ? 'MQTT Live' : 'MQTT Offline'}
            </span>
          </p>
        </div>
      </header>

      {/* SRC = LOCAL warning */}
      {liveSrc === 'LOCAL' && (
        <div className="connection-warning" style={{ marginBottom: '1rem' }}>
          <AlertTriangle size={24} />
          <p>
            Nguồn đang là <b>LOCAL</b> — không điều khiển được từ xa. Hãy chọn
            "Nguồn = ESP32" trên máy sạc.
          </p>
        </div>
      )}

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
            <Radio size={18} />
            <div>
              <label>Status</label>
              <span>{online ? 'Online' : 'Offline'}</span>
            </div>
          </div>
          <div className="info-item">
            <Activity size={18} />
            <div>
              <label>Firmware</label>
              <span>{data.device.firmwareVersion}</span>
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleFirmwareUpdate}
              disabled={isUpdatingFirmware}
              title="Trigger firmware update via MQTT"
            >
              {isUpdatingFirmware ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Download size={16} />
              )}
              {isUpdatingFirmware ? 'Updating...' : 'Update'}
            </button>
          </div>
          <div className="info-item">
            <Settings size={18} />
            <div>
              <label>Source</label>
              <span>{liveSrc || data.data?.src || '—'}</span>
            </div>
          </div>

          {otaStatus && isUpdatingFirmware && (
            <div
              className="info-item ota-progress-container"
              style={{ gridColumn: '1 / -1' }}
            >
              <div className="ota-progress">
                <div className="ota-progress-header">
                  <span className="ota-status">
                    {otaStatus.status === 'installing' && 'Installing firmware...'}
                    {otaStatus.status === 'downloading' && 'Downloading...'}
                    {otaStatus.status === 'success' && 'Update successful!'}
                    {otaStatus.status === 'failed' &&
                      `Update failed: ${otaStatus.message || 'Unknown error'}`}
                  </span>
                  <span className="ota-percentage">{otaStatus.progress ?? 0}%</span>
                </div>
                <div className="ota-progress-bar">
                  <div
                    className={`ota-progress-fill ${otaStatus.status === 'failed' ? 'error' : otaStatus.status === 'success' ? 'success' : ''}`}
                    style={{ width: `${otaStatus.progress ?? 0}%` }}
                  />
                </div>
              </div>
            </div>
          )}
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
          <Activity size={18} />
          Snapshot
        </button>
        <button
          className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <Settings size={18} />
          Settings
        </button>
      </div>

      <div className="tab-content">
        {activeTab === 'realtime' && (
          <div className="content-section">
            <div className="realtime-header">
              <h3>Real-time MQTT Data</h3>
              <span
                className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}
              >
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>

            {!isConnected && (
              <div className="connection-warning">
                <WifiOff size={24} />
                <p>
                  Not connected to MQTT broker. Check broker WebSocket config
                  (port 9001).
                </p>
              </div>
            )}

            {latestFrame && (
              <div className="realtime-current">
                <h4>Latest frame ({latestFrame.frame.type})</h4>
                <p className="last-updated">
                  Received: {new Date(latestFrame.timestamp).toLocaleString()}
                </p>
                <pre className="json-viewer">
                  {JSON.stringify(latestFrame.frame, null, 2)}
                </pre>
              </div>
            )}

            {frameHistory.length > 0 && (
              <div className="realtime-history">
                <h4>History (last {frameHistory.length})</h4>
                <div className="history-list">
                  {frameHistory.map((item, i) => (
                    <div key={i} className="history-item">
                      <span className="history-time">
                        {new Date(item.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="history-capacity monospace">
                        {item.frame.type}
                        {item.frame.VBAT ? ` · VBAT=${item.frame.VBAT}` : ''}
                        {item.frame.IBAT ? ` · IBAT=${item.frame.IBAT}` : ''}
                        {item.frame.PPV ? ` · PPV=${item.frame.PPV}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!latestFrame && isConnected && (
              <p className="no-data">Waiting for data from charger...</p>
            )}
          </div>
        )}

        {activeTab === 'data' && (
          <div className="content-section">
            <h3>Latest Snapshot (backend-decoded)</h3>
            {data?.data?.updatedAt && (
              <p className="last-updated">
                Last updated: {new Date(data.data.updatedAt).toLocaleString()}
              </p>
            )}
            {data?.data ? (
              <pre className="json-viewer">
                {JSON.stringify(data.data, null, 2)}
              </pre>
            ) : (
              <p className="no-data">No snapshot yet</p>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="content-section">
            <h3>Charger Setting</h3>
            {data?.setting?.updatedAt && (
              <p className="last-updated">
                Last updated: {new Date(data.setting.updatedAt).toLocaleString()}
              </p>
            )}
            {data?.setting ? (
              <table className="data-table">
                <tbody>
                  <tr>
                    <td>Value (HHHHLLLL)</td>
                    <td className="monospace">{data.setting.value}</td>
                  </tr>
                  <tr>
                    <td>VBAT (V)</td>
                    <td>{data.setting.vbat ?? '—'}</td>
                  </tr>
                  <tr>
                    <td>IBAT (A)</td>
                    <td>{data.setting.ibat ?? '—'}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <p className="no-data">No setting yet</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChargerDetail;
