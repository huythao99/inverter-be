import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import mqtt from 'mqtt';
import { isAxiosError } from 'axios';
import type { MqttClient } from 'mqtt';
import {
  getHybridDetails,
  getMqttCredentials,
  setHybridRawLog,
  triggerHybridFirmwareUpdate,
  type CmsHybridDetails,
} from '../services/api';
import RawLogPanel from '../components/RawLogPanel';
import { parseRawLog, type RawLogLine } from '../components/raw-log';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Cpu,
  Download,
  Loader2,
  Radio,
  Settings,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import {
  CONFIG_LABEL,
  IST_LABEL,
  MODE_LABEL,
  NAK_LABEL,
  READONLY_LABEL,
  ST_LABEL,
  fltText,
  kwh,
} from '../components/hybrid-labels';

const MQTT_WS_URL = import.meta.env.VITE_MQTT_WS_URL || 'wss://giabao-inverter.com/mqtt';

interface OtaStatus {
  status: string;
  progress?: number;
  message?: string;
}

interface FrameEntry {
  type: string;
  items: Record<string, string>;
  raw: string;
  timestamp: string;
}

const errMessage = (err: unknown, fallback: string) =>
  (isAxiosError(err) && (err.response?.data as { message?: string } | undefined)?.message) || fallback;

// Drop control characters (UART noise) except tab / CR / LF.
const stripControl = (s: string) =>
  Array.from(s)
    .filter((c) => {
      const n = c.charCodeAt(0);
      return n === 9 || n === 10 || n === 13 || (n >= 32 && n !== 127);
    })
    .join('');

const parseFrame = (raw: string): FrameEntry | null => {
  const t = raw.trim();
  if (t[0] !== '$') return null;
  const star = t.lastIndexOf('*');
  const [type, ...rest] = (star === -1 ? t.slice(1) : t.slice(1, star)).split(',');
  if (!type) return null;
  const items: Record<string, string> = {};
  for (const it of rest) {
    const eq = it.indexOf('=');
    if (eq > 0) items[it.slice(0, eq)] = it.slice(eq + 1);
    else if (it) items[it] = '';
  }
  return { type, items, raw: t, timestamp: new Date().toISOString() };
};

// Telemetry rows: [key, label, unit]
const TLM_ROWS: [string, string, string][] = [
  ['ST', 'Hoạt động', ''],
  ['MODE', 'Chế độ', ''],
  ['IST', 'Trạng thái inverter', ''],
  ['FLT', 'Lỗi', ''],
  ['LOCK', 'Khóa', ''],
  ['RTRY', 'Tự chạy lại', '/5'],
  ['SRC', 'Cài đặt từ', ''],
  ['GRID', 'Có lưới', ''],
  ['VBAT', 'Áp pin', 'V'],
  ['PINV', 'P inverter (+xả / −sạc)', 'W'],
  ['PGRID', 'P lưới (+lấy / −đẩy)', 'W'],
  ['VOUT', 'Áp ra', 'V'],
  ['VGRID', 'Áp lưới', 'V'],
  ['F', 'Tần số', 'Hz'],
  ['T', 'Nhiệt MOSFET', '°C'],
  ['T2', 'Nhiệt biến áp', '°C'],
  ['FAN', 'Quạt', '%'],
  ['EDIS', 'Xả pin (từ lúc STM bật)', 'Wh'],
  ['ECHG', 'Sạc pin', 'Wh'],
  ['EIMP', 'Lấy lưới', 'Wh'],
  ['EEXP', 'Đẩy lưới', 'Wh'],
  ['UP', 'STM chạy được', 's'],
];

const tlmValue = (key: string, v: string | undefined) => {
  if (v === undefined || v === '') return '—';
  if (key === 'ST') return `${ST_LABEL[v] ?? v} (${v})`;
  if (key === 'MODE') return `${MODE_LABEL[v] ?? v} (${v})`;
  if (key === 'IST') return `${IST_LABEL[v] ?? v} (${v})`;
  if (key === 'FLT') return v === '0' ? 'Không' : `${fltText(v)} (${v})`;
  if (key === 'LOCK') return v === '1' ? 'ĐANG KHÓA' : 'Không';
  if (key === 'GRID') return v === '1' ? 'Có' : 'Không';
  return v;
};

const HybridDetail: React.FC = () => {
  const { userId, deviceId } = useParams<{ userId: string; deviceId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [details, setDetails] = useState<CmsHybridDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'settings' | 'energy' | 'realtime'>(
    'overview',
  );
  const [isUpdatingFirmware, setIsUpdatingFirmware] = useState(false);
  const [otaStatus, setOtaStatus] = useState<OtaStatus | null>(null);
  // Set when the CMS sent the trigger: the panel stays visible from the click
  // until success / failure, and warns when the device never answers.
  const [otaSentAt, setOtaSentAt] = useState<number | null>(null);
  const [otaTarget, setOtaTarget] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    if (otaSentAt === null) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [otaSentAt]);

  const [isConnected, setIsConnected] = useState(false);
  const [logLines, setLogLines] = useState<RawLogLine[]>([]);
  const [logPaused, setLogPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = logPaused;
  const lineIdRef = useRef(0);
  // UART debug log is off on the device unless turned on here (time-limited).
  const RAW_MINUTES = 10;
  const [rawUntil, setRawUntil] = useState<number | null>(null);
  const [rawBusy, setRawBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const rawActive = rawUntil !== null && rawUntil > now;

  useEffect(() => {
    if (rawUntil === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [rawUntil]);

  const setRawLog = async (minutes: number) => {
    if (!userId || !deviceId) return;
    setRawBusy(true);
    try {
      const res = await setHybridRawLog(userId, deviceId, minutes);
      setRawUntil(res.data.until ? new Date(res.data.until).getTime() : null);
      setNow(Date.now());
      pushLog({ dir: 'SYS', tag: 'RAWLOG', text: minutes ? `bật log UART ${minutes} phút` : 'tắt log UART' });
    } catch (err) {
      console.error('Failed to set raw log', err);
      alert('Không gửi được lệnh bật/tắt log UART');
    } finally {
      setRawBusy(false);
    }
  };

  // Leaving the page turns the log off (it would stop by itself anyway).
  const rawRef = useRef({ active: false, userId, deviceId });
  rawRef.current = { active: rawActive, userId, deviceId };
  useEffect(
    () => () => {
      const r = rawRef.current;
      if (r.active && r.userId && r.deviceId) void setHybridRawLog(r.userId, r.deviceId, 0).catch(() => {});
    },
    [],
  );

  const fmtLeft = (ms: number) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const pushLog = (l: Omit<RawLogLine, 'id' | 'at'>) => {
    if (pausedRef.current) return;
    const entry: RawLogLine = { ...l, id: ++lineIdRef.current, at: new Date().toISOString() };
    setLogLines((prev) => [entry, ...prev].slice(0, 5000));
  };
  const [liveTlm, setLiveTlm] = useState<Record<string, string> | null>(null);
  const [liveCfg, setLiveCfg] = useState<Record<string, string> | null>(null);
  const [mqttAccount, setMqttAccount] = useState<{ username: string; password: string } | null>(null);
  const clientRef = useRef<MqttClient | null>(null);

  const load = async () => {
    if (!userId || !deviceId) return;
    try {
      const res = await getHybridDetails(userId, deviceId);
      setDetails(res.data);
    } catch (err) {
      setError(errMessage(err, 'Failed to load hybrid details'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, deviceId]);

  useEffect(() => {
    getMqttCredentials()
      .then(setMqttAccount)
      .catch((err) => console.error('Failed to get MQTT credentials', err));
  }, []);

  useEffect(() => {
    if (!userId || !deviceId || !mqttAccount) return;
    const client = mqtt.connect(MQTT_WS_URL, {
      username: mqttAccount.username,
      password: mqttAccount.password,
      clientId: `cms-hybrid-${Date.now()}`,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    });
    clientRef.current = client;
    const dataTopic = `hybrid/${userId}/${deviceId}/data`;
    const otaTopic = `hybrid/${userId}/${deviceId}/ota/status`;
    const rawTopic = `hybrid/${userId}/${deviceId}/raw`;
    const statusTopic = `hybrid/${userId}/${deviceId}/status`;

    client.on('connect', () => {
      setIsConnected(true);
      client.subscribe(dataTopic, { qos: 0 });
      client.subscribe(otaTopic, { qos: 1 });
      client.subscribe(rawTopic, { qos: 0 });
      client.subscribe(statusTopic, { qos: 0 });
      pushLog({ dir: 'SYS', tag: 'MQTT', text: `subscribed ${dataTopic}, ${rawTopic}` });
    });
    client.on('disconnect', () => setIsConnected(false));
    client.on('offline', () => setIsConnected(false));
    client.on('error', () => setIsConnected(false));
    client.on('message', (topic, message) => {
      const raw = stripControl(message.toString());
      if (topic.endsWith('/ota/status')) {
        try {
          const p = JSON.parse(raw);
          setOtaStatus({ status: p.status, progress: p.progress, message: p.message });
          pushLog({
            dir: 'SYS',
            tag: 'OTA',
            text: `${p.status}${p.progress !== undefined ? ` ${p.progress}%` : ''}${p.message ? ` - ${p.message}` : ''}`,
          });
          if (p.status === 'success' || p.status === 'failed') {
            setIsUpdatingFirmware(false);
            // Device reboots into the new build: reload details (new version).
            if (p.status === 'success') setTimeout(() => load(), 15000);
          }
        } catch {
          // ignore
        }
        return;
      }
      if (topic === rawTopic) {
        pushLog(parseRawLog(raw));
        return;
      }
      if (topic === statusTopic) {
        pushLog({ dir: 'SYS', tag: 'STATUS', text: raw });
        return;
      }
      pushLog({ dir: 'RX', tag: 'DATA', text: raw });
      const f = parseFrame(raw);
      if (!f) return;
      if (f.type === 'TLM') setLiveTlm(f.items);
      if (f.type === 'CFG') setLiveCfg(f.items);
      if (f.type === 'CFG' || f.type === 'NAK') load();
    });

    return () => {
      client.unsubscribe(dataTopic);
      client.unsubscribe(otaTopic);
      client.unsubscribe(rawTopic);
      client.unsubscribe(statusTopic);
      client.end();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, deviceId, mqttAccount]);

  const handleFirmwareUpdate = async (confirmed = false) => {
    if (!details?.device?._id) return;
    if (!confirmed && !window.confirm(`Trigger firmware update for ${details.device.deviceName || deviceId}?`)) return;
    setIsUpdatingFirmware(true);
    setOtaStatus(null);
    try {
      const res = await triggerHybridFirmwareUpdate(details.device._id);
      setOtaSentAt(Date.now());
      setOtaTarget((res.data as { targetVersion?: string })?.targetVersion ?? null);
      pushLog({ dir: 'SYS', tag: 'OTA', text: `trigger sent (target ${(res.data as { targetVersion?: string })?.targetVersion ?? '?'})` });
    } catch (err) {
      alert(errMessage(err, 'Failed to trigger firmware update'));
      setIsUpdatingFirmware(false);
    }
  };

  // Opened from the Hybrids list "Update" (already confirmed there): start it
  // once the live view is subscribed, so no ota/status message is missed.
  const autoOtaDone = useRef(false);
  useEffect(() => {
    if (autoOtaDone.current || searchParams.get('ota') !== '1') return;
    if (!details?.device?._id || !isConnected) return;
    autoOtaDone.current = true;
    setSearchParams({}, { replace: true });
    handleFirmwareUpdate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details, isConnected, searchParams]);

  if (isLoading) return <div className="loading">Loading hybrid details...</div>;
  if (error) return <div className="error-state">{error}</div>;
  if (!details) return null;

  const tlm = liveTlm ?? details.data?.tlm ?? {};
  const cfg = liveCfg ?? details.data?.cfg ?? {};
  const online = liveTlm ? true : details.summary.online;
  const fault = fltText(tlm.FLT);
  const src = tlm.SRC ?? cfg.SRC;
  const nak = details.data?.lastNak;
  const pending = new Set(details.setting.pending);
  const energy = [...details.energy].reverse();
  const totals = details.energy.reduce(
    (a, d) => ({ edis: a.edis + d.edis, echg: a.echg + d.echg, eimp: a.eimp + d.eimp, eexp: a.eexp + d.eexp }),
    { edis: 0, echg: 0, eimp: 0, eexp: 0 },
  );

  return (
    <div className="page device-detail-page">
      <header className="page-header">
        <button className="btn-back" onClick={() => navigate('/hybrids')}>
          <ArrowLeft size={20} />
          Hybrid
        </button>
        <div className="header-content">
          <h1>{details.device.deviceName || deviceId}</h1>
          <p className="device-info">
            {details.device.ownerEmail && <span>{details.device.ownerEmail} · </span>}
            <span className="monospace">{userId}</span> / <span className="monospace">{deviceId}</span>
            <span className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
              {isConnected ? <Wifi size={16} /> : <WifiOff size={16} />}
              {isConnected ? 'MQTT Live' : 'MQTT Offline'}
            </span>
          </p>
        </div>
      </header>

      {fault && (
        <div className="connection-warning" style={{ marginBottom: '1rem' }}>
          <AlertTriangle size={24} />
          <p>
            <b>{fault}</b>
            {tlm.LOCK === '1'
              ? ' — máy đã KHÓA sau 5 lần tự chạy lại, người dùng cần bấm "Xóa lỗi" (FAULT_RST).'
              : ` — đang tự chạy lại (${tlm.RTRY ?? 0}/5).`}
          </p>
        </div>
      )}
      {src === 'LOCAL' && (
        <div className="connection-warning" style={{ marginBottom: '1rem' }}>
          <AlertTriangle size={24} />
          <p>
            SRC = <b>LOCAL</b>: máy không nhận cài đặt từ app. Người dùng cần chọn "Cai dat tu = APP" trên máy.
          </p>
        </div>
      )}
      {nak && (
        <div className="notice notice-warn" style={{ marginBottom: '1rem' }}>
          Máy từ chối {nak.of}
          {nak.key ? ` (${nak.key})` : ''}: <b>{NAK_LABEL[nak.err] ?? nak.err}</b> —{' '}
          {new Date(nak.at).toLocaleString()}
        </div>
      )}

      <div className="info-card">
        <div className="info-item">
          <Cpu size={18} />
          <div>
            <label>Device ID</label>
            <span className="monospace">{details.device.deviceId}</span>
          </div>
        </div>
        <div className="info-item">
          <Radio size={18} />
          <div>
            <label>Status</label>
            <span>
              {online ? 'Online' : 'Offline'}
              {!online && details.summary.lastSeenAt
                ? ` (${new Date(details.summary.lastSeenAt).toLocaleString()})`
                : ''}
            </span>
          </div>
        </div>
        <div className="info-item">
          <Activity size={18} />
          <div>
            <label>ESP32 firmware</label>
            <span>{details.device.firmwareVersion}</span>
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => handleFirmwareUpdate()}
            disabled={isUpdatingFirmware}
            title="Trigger firmware update via MQTT"
          >
            {isUpdatingFirmware ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
            {isUpdatingFirmware ? 'Updating...' : 'Update'}
          </button>
        </div>
        <div className="info-item">
          <Zap size={18} />
          <div>
            <label>STM32</label>
            <span>
              {details.data?.info?.FW ?? '—'}
              {details.data?.info?.HW ? ` · ${details.data.info.HW}` : ''}
            </span>
          </div>
        </div>

        {otaSentAt !== null && (
          <div className="info-item ota-progress-container" style={{ gridColumn: '1 / -1' }}>
            <div className="ota-progress" style={{ width: '100%' }}>
              <div className="ota-progress-header">
                <span className="ota-status">
                  {!otaStatus
                    ? `Đã gửi lệnh cập nhật${otaTarget ? ` lên ${otaTarget}` : ''} — chờ thiết bị phản hồi (${Math.round((nowTick - otaSentAt) / 1000)} s)…`
                    : otaStatus.status === 'success'
                      ? 'Cập nhật thành công, thiết bị đang khởi động lại'
                      : otaStatus.status === 'failed'
                        ? `Cập nhật thất bại: ${otaStatus.message || 'không rõ lỗi'}`
                        : `${otaStatus.status === 'downloading' ? 'Đang tải' : otaStatus.status === 'installing' ? 'Đang cài' : otaStatus.status === 'starting' ? 'Bắt đầu' : otaStatus.status}${otaStatus.message ? ` — ${otaStatus.message}` : ''}`}
                </span>
                <span className="ota-percentage">{otaStatus?.progress ?? 0}%</span>
              </div>
              <div className="ota-progress-bar">
                <div
                  className={`ota-progress-fill ${otaStatus?.status === 'failed' ? 'error' : otaStatus?.status === 'success' ? 'success' : ''}`}
                  style={{ width: `${otaStatus?.status === 'success' ? 100 : (otaStatus?.progress ?? 0)}%` }}
                />
              </div>
              {!otaStatus && nowTick - otaSentAt > 30000 && (
                <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  Thiết bị chưa phản hồi sau 30 s. Kiểm tra: máy có Online không (heartbeat ở tab Raw UART), có đang
                  chạy firmware hybrid có MQTT không (sketch cầu nối / firmware khác sẽ không nhận lệnh). Lệnh được giữ
                  trên broker 10 phút, máy kết nối lại trong thời gian đó vẫn sẽ cập nhật.
                </p>
              )}
              {(otaStatus?.status === 'failed' || otaStatus?.status === 'success') && (
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ marginTop: 6 }}
                  onClick={() => {
                    setOtaSentAt(null);
                    setOtaStatus(null);
                  }}
                >
                  Đóng
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="tabs">
        <button className={`tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
          <Activity size={18} />
          Tổng quan
        </button>
        <button className={`tab ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
          <Settings size={18} />
          Cài đặt
          {pending.size > 0 && <span className="status-badge inactive" style={{ marginLeft: 6 }}>{pending.size}</span>}
        </button>
        <button className={`tab ${activeTab === 'energy' ? 'active' : ''}`} onClick={() => setActiveTab('energy')}>
          <BarChart3 size={18} />
          Điện năng
        </button>
        <button className={`tab ${activeTab === 'realtime' ? 'active' : ''}`} onClick={() => setActiveTab('realtime')}>
          <Radio size={18} />
          Raw UART
          {isConnected && <span className="live-dot" />}
        </button>
      </div>

      <div className="tab-content">
        {activeTab === 'overview' && (
          <div className="content-section">
            <h3>Telemetry ($TLM)</h3>
            <p className="last-updated">
              {liveTlm
                ? 'Live'
                : details.data?.tlmAt
                  ? `Last: ${new Date(details.data.tlmAt).toLocaleString()}`
                  : 'Chưa có dữ liệu'}
            </p>
            <table className="data-table">
              <tbody>
                {TLM_ROWS.map(([k, label, unit]) => (
                  <tr key={k}>
                    <td>{label}</td>
                    <td className="monospace">
                      {tlmValue(k, tlm[k])}
                      {tlm[k] !== undefined && unit && !['ST', 'MODE', 'IST', 'FLT', 'LOCK', 'GRID'].includes(k)
                        ? ` ${unit}`
                        : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="content-section">
            <h3>Cấu hình</h3>
            <p className="last-updated">
              Server lưu: {details.setting.updatedAt ? new Date(details.setting.updatedAt).toLocaleString() : 'chưa đặt'}
              {' · '}SET gửi xuống: <span className="monospace">{details.setting.set || '(trống)'}</span>
            </p>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tham số</th>
                  <th>Server (người dùng đặt)</th>
                  <th>Máy đang chạy ($CFG)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(CONFIG_LABEL).map(([k, [label, unit]]) => {
                  const want = details.setting.config[k];
                  const have = cfg[k];
                  const fmt = (v: string | number | undefined) =>
                    v === undefined || v === ''
                      ? '—'
                      : k === 'MODE'
                        ? `${MODE_LABEL[String(v)] ?? v} (${v})`
                        : `${v} ${unit}`;
                  return (
                    <tr key={k}>
                      <td>
                        {label} <span className="monospace muted">{k}</span>
                      </td>
                      <td>{fmt(want)}</td>
                      <td>{fmt(have)}</td>
                      <td>
                        {pending.has(k) && <span className="status-badge inactive">chờ áp dụng</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <h3 style={{ marginTop: 24 }}>Thông số máy (chỉ đọc)</h3>
            <table className="data-table">
              <tbody>
                {Object.entries(READONLY_LABEL).map(([k, [label, unit]]) => (
                  <tr key={k}>
                    <td>
                      {label} <span className="monospace muted">{k}</span>
                    </td>
                    <td>{cfg[k] !== undefined ? `${cfg[k]} ${unit}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'energy' && (
          <div className="content-section">
            <h3>Điện năng 30 ngày (kWh)</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Xả pin</th>
                  <th>Sạc pin</th>
                  <th>Lấy lưới</th>
                  <th>Đẩy lưới</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <b>Tổng</b>
                  </td>
                  <td><b>{kwh(totals.edis)}</b></td>
                  <td><b>{kwh(totals.echg)}</b></td>
                  <td><b>{kwh(totals.eimp)}</b></td>
                  <td><b>{kwh(totals.eexp)}</b></td>
                </tr>
                {energy.map((d) => (
                  <tr key={d.day}>
                    <td className="monospace">{d.day}</td>
                    <td>{kwh(d.edis)}</td>
                    <td>{kwh(d.echg)}</td>
                    <td>{kwh(d.eimp)}</td>
                    <td>{kwh(d.eexp)}</td>
                  </tr>
                ))}
                {energy.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty-state">
                      Chưa có số liệu
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'realtime' && (
          <div className="content-section">
            <div className="realtime-header">
              <h3>Bản tin UART (raw)</h3>
              <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div className="rawlog-control">
              {rawActive ? (
                <>
                  <span className="rawlog-on">● Log UART đang bật · còn {fmtLeft((rawUntil ?? 0) - now)}</span>
                  <button className="btn btn-secondary btn-sm" disabled={rawBusy} onClick={() => setRawLog(RAW_MINUTES)}>
                    Gia hạn {RAW_MINUTES} phút
                  </button>
                  <button className="btn btn-secondary btn-sm" disabled={rawBusy} onClick={() => setRawLog(0)}>
                    Tắt
                  </button>
                </>
              ) : (
                <>
                  <span className="muted">
                    Log UART đang tắt: chỉ thấy bản tin hợp lệ (DATA). Bật để xem khung gửi/nhận, lỗi CRC, dòng bị bỏ.
                  </span>
                  <button className="btn btn-primary btn-sm" disabled={rawBusy} onClick={() => setRawLog(RAW_MINUTES)}>
                    Bật log UART {RAW_MINUTES} phút
                  </button>
                </>
              )}
            </div>
            {!isConnected && (
              <div className="connection-warning">
                <WifiOff size={24} />
                <p>Not connected to MQTT broker.</p>
              </div>
            )}
            <RawLogPanel
              lines={logLines}
              paused={logPaused}
              onPause={setLogPaused}
              onClear={() => setLogLines([])}
              deviceId={deviceId ?? ''}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default HybridDetail;
