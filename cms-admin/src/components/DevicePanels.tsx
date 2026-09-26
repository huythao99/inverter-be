import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { getDeviceActivity, getDeviceHealth } from '../services/api';
import type { ActivityEntry, HealthRow } from '../services/api';
import { IssueBadge } from './IssueBadge';
import { ago } from './health-meta';

/** Health snapshot of one inverter (same data as the Device Health page). */
export const DeviceHealthPanel: React.FC<{ userId: string; deviceId: string }> = ({
  userId,
  deviceId,
}) => {
  const [h, setH] = useState<HealthRow | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setH((await getDeviceHealth(userId, deviceId)).data);
    } catch {
      setH(null);
    } finally {
      setLoading(false);
    }
  }, [userId, deviceId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !h) return <div className="loading">Loading...</div>;
  if (!h) return <p className="no-data">No health data yet.</p>;

  const items: [string, React.ReactNode][] = [
    ['Status', `${h.online ? 'Online' : 'Offline'} · last data ${ago(h.lastDataAt)}`],
    ['Firmware', `${h.firmwareVersion ?? '—'}${h.stmFwVersion ? ` · STM ${h.stmFwVersion}` : ''}`],
    [
      'Boots (24 h)',
      `${h.boots24h}${h.lastBoot ? ` · last: ${h.lastBoot.reasonText} (${h.lastBoot.reason}) ${ago(h.lastBoot.at)}` : ''}`,
    ],
    ['MQTT', h.transport === 'plain' ? 'plain 1883 (TLS fallback)' : h.transport === 'tls' ? 'TLS 8883' : 'unknown'],
    ['MQTT resets (24 h)', h.mqttFails24h],
    ['WiFi', h.rssi !== null ? `${h.rssi} dBm` : 'not reported (older firmware)'],
    ['Heap min', h.heapMin ? `${Math.round(h.heapMin / 1024)} KB` : '—'],
    ['STM32 UART', h.uart ? `ok ${h.uart.ok} / bad ${h.uart.bad} (${ago(h.uart.at)}) — ${h.uart.raw}` : 'no errors reported'],
  ];
  if (h.badFrame) items.push(['Bad frame sample', <code key="bf">{h.badFrame.sample}</code>]);

  return (
    <div className="content-section">
      <div className="realtime-header">
        <h3>Health</h3>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>
      <div className="health-issues" style={{ marginBottom: 12 }}>
        {h.issues.length ? h.issues.map((i) => <IssueBadge key={i} issue={i} />) : (
          <span className="status-badge active">No issue</span>
        )}
      </div>
      <table className="data-table">
        <tbody>
          {items.map(([k, v]) => (
            <tr key={k}>
              <th style={{ width: 180 }}>{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const SOURCE_LABEL: Record<ActivityEntry['source'], string> = {
  app: 'App',
  web: 'Web',
  cms: 'CMS',
  api: 'API',
  system: 'System',
};

/** Settings / schedule / grid-tie change history, with IP (admins only). */
export const ActivityPanel: React.FC<{
  userId: string;
  deviceId: string;
  kind?: 'inverter' | 'charger';
}> = ({ userId, deviceId, kind = 'inverter' }) => {
  const [rows, setRows] = useState<ActivityEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (before?: string) => {
      setLoading(true);
      try {
        const r = await getDeviceActivity(userId, deviceId, { kind, before, limit: 50 });
        setRows((old) => (before ? [...old, ...r.data.data] : r.data.data));
        setNext(r.data.nextBefore);
      } catch {
        if (!before) setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [userId, deviceId, kind]
  );

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="content-section">
      <div className="realtime-header">
        <h3>Change history</h3>
        <button className="btn btn-secondary btn-sm" onClick={() => load()} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>
      {rows.length === 0 && !loading ? (
        <p className="no-data">No change recorded yet.</p>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>What</th>
                <th>Change</th>
                <th>From</th>
                <th>Who</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id}>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td>{r.action}</td>
                  <td title={`${r.before ?? ''} → ${r.after ?? ''}`}>{r.summary}</td>
                  <td title={r.userAgent ?? ''}>{SOURCE_LABEL[r.source] ?? r.source}</td>
                  <td className="muted">{r.actorLabel ?? r.actor ?? '—'}</td>
                  <td className="muted monospace">{r.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next && (
        <button className="btn btn-secondary" onClick={() => load(next)} disabled={loading} style={{ marginTop: 12 }}>
          Load more
        </button>
      )}
    </div>
  );
};
