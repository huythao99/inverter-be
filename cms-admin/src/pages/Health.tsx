import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Cpu,
  RefreshCw,
  Search,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { getHealthDevices, getHealthSummary } from '../services/api';
import type { HealthIssue, HealthRow, HealthSummary } from '../services/api';
import { ISSUE_META, ISSUE_ORDER, ago } from '../components/health-meta';
import { IssueBadge } from '../components/IssueBadge';

const PAGE_SIZE = 50;

/**
 * Fleet health of the inverters: built from their telemetry and the trackLog
 * reports they already send (BOOT, UART_STATS, STACK_STATS, MQTT_TRANSPORT...).
 */
const Health: React.FC = () => {
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('problems');
  const [issue, setIssue] = useState<HealthIssue | ''>('');
  const [fw, setFw] = useState('');
  const [sort, setSort] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, d] = await Promise.all([
        getHealthSummary(),
        getHealthDevices({
          status: status || undefined,
          issue: issue || undefined,
          fw: fw || undefined,
          search: query || undefined,
          sort: sort || undefined,
          page,
          limit: PAGE_SIZE,
        }),
      ]);
      setSummary(s.data);
      setRows(d.data.data);
      setTotal(d.data.total);
    } catch {
      setError('Failed to load device health');
    } finally {
      setLoading(false);
    }
  }, [status, issue, fw, query, sort, page]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pickIssue = (i: HealthIssue) => {
    setIssue(issue === i ? '' : i);
    setStatus('');
    setPage(1);
  };

  return (
    <div className="page health-page">
      <div className="page-header-actions">
        <div>
          <h1>Device Health</h1>
          <p>
            Inverters with problems first. Built from telemetry and the reports devices already
            send; refreshes every minute.
            {summary && <span className="muted"> Updated {ago(summary.generatedAt)}.</span>}
          </p>
        </div>
        <button className="btn btn-secondary" onClick={load} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          Refresh
        </button>
      </div>

      {summary && (
        <>
          <div className="stats-grid">
            {[
              { k: '', label: 'Inverters', value: summary.total, icon: Cpu, cls: 'blue' },
              { k: 'online', label: 'Online', value: summary.online, icon: Wifi, cls: 'green' },
              { k: 'offline', label: 'Offline', value: summary.offline, icon: WifiOff, cls: 'orange' },
              { k: 'problems', label: 'With problems', value: summary.withProblems, icon: AlertTriangle, cls: 'red' },
            ].map((c) => (
              <button
                key={c.label}
                className={`stat-card stat-card-button ${status === c.k && !issue ? 'selected' : ''}`}
                onClick={() => {
                  setStatus(c.k);
                  setIssue('');
                  setPage(1);
                }}
              >
                <div className={`stat-icon ${c.cls}`}>
                  <c.icon size={24} />
                </div>
                <div className="stat-content">
                  <span className="stat-value">{c.value.toLocaleString()}</span>
                  <span className="stat-label">{c.label}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="health-panels">
            <div className="health-panel">
              <h3>
                <Activity size={16} /> Issues
              </h3>
              <div className="health-chips">
                {ISSUE_ORDER.map((i) => (
                  <button
                    key={i}
                    className={`health-chip tone-${ISSUE_META[i].tone} ${issue === i ? 'selected' : ''}`}
                    onClick={() => pickIssue(i)}
                    title={ISSUE_META[i].hint}
                    disabled={!summary.issues[i]}
                  >
                    {ISSUE_META[i].label}
                    <b>{summary.issues[i] ?? 0}</b>
                  </button>
                ))}
              </div>
            </div>
            <div className="health-panel">
              <h3>Firmware (stable {summary.newestFirmware})</h3>
              <div className="health-chips">
                {summary.firmware.slice(0, 10).map((f) => (
                  <button
                    key={f.version}
                    className={`health-chip ${fw === f.version ? 'selected' : ''}`}
                    onClick={() => {
                      setFw(fw === f.version ? '' : f.version);
                      setPage(1);
                    }}
                  >
                    {f.version}
                    <b>{f.count}</b>
                  </button>
                ))}
              </div>
              {summary.resetReasons24h.length > 0 && (
                <p className="muted health-reasons">
                  Last boot reason (24 h):{' '}
                  {summary.resetReasons24h.map((r) => `${r.text} ${r.count}`).join(' · ')}
                </p>
              )}
            </div>
          </div>
        </>
      )}

      <form
        className="search-bar health-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search.trim());
          setPage(1);
        }}
      >
        <div className="search-input-wrapper">
          <Search size={20} />
          <input
            type="text"
            placeholder="Device ID, name or user ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="">Most problems first</option>
          <option value="lastData">Longest offline</option>
          <option value="boots">Most reboots (24 h)</option>
        </select>
        <button type="submit" className="btn btn-primary">
          Search
        </button>
      </form>

      {(issue || fw || query) && (
        <p className="muted health-active-filters">
          Filter: {issue && ISSUE_META[issue].label} {fw && `fw ${fw}`} {query && `"${query}"`}{' '}
          <button
            className="link-button"
            onClick={() => {
              setIssue('');
              setFw('');
              setQuery('');
              setSearch('');
              setPage(1);
            }}
          >
            clear
          </button>
        </p>
      )}

      {error && <p className="notice notice-warn">{error}</p>}

      <div className="table-container">
        <table className="data-table health-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>Status</th>
              <th>Firmware</th>
              <th>Boots 24h</th>
              <th>Link</th>
              <th>Heap min</th>
              <th>STM32 UART</th>
              <th>Issues</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.userId}/${r.deviceId}`}>
                <td>
                  <Link to={`/devices/${r.userId}/${r.deviceId}`} className="device-id">
                    {r.deviceId}
                  </Link>
                  {r.deviceName && r.deviceName !== r.deviceId && (
                    <div className="muted">{r.deviceName}</div>
                  )}
                </td>
                <td>
                  <span className={`health-dot ${r.online ? 'on' : 'off'}`} />
                  {r.online ? 'Online' : 'Offline'}
                  <div className="muted">{ago(r.lastDataAt)}</div>
                </td>
                <td>
                  {r.firmwareVersion ?? '—'}
                  {r.stmFwVersion && <div className="muted">STM {r.stmFwVersion}</div>}
                </td>
                <td>
                  <span className={r.boots24h >= 3 ? 'text-danger' : ''}>{r.boots24h}</span>
                  {r.lastBoot && (
                    <div className="muted" title={new Date(r.lastBoot.at).toLocaleString()}>
                      {r.lastBoot.reasonText} · {ago(r.lastBoot.at)}
                    </div>
                  )}
                </td>
                <td>
                  {r.transport === 'plain' ? 'MQTT 1883' : r.transport === 'tls' ? 'TLS 8883' : '—'}
                  {r.rssi !== null && <div className="muted">{r.rssi} dBm</div>}
                </td>
                <td>{r.heapMin ? `${Math.round(r.heapMin / 1024)} KB` : '—'}</td>
                <td>
                  {r.uart ? (
                    <span title={r.uart.raw}>
                      ok {r.uart.ok} / bad {r.uart.bad}
                    </span>
                  ) : (
                    <span className="muted">clean</span>
                  )}
                  {r.badFrame && (
                    <div className="muted monospace health-sample" title={r.badFrame.sample}>
                      {r.badFrame.sample}
                    </div>
                  )}
                </td>
                <td>
                  <div className="health-issues">
                    {r.issues.length ? (
                      r.issues.map((i) => <IssueBadge key={i} issue={i} />)
                    ) : (
                      <span className="status-badge active">OK</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-state">
                  No device matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {loading && rows.length === 0 && <div className="loading">Loading...</div>}
      </div>

      {pages > 1 && (
        <div className="pagination">
          <button className="btn-icon" disabled={page === 1} onClick={() => setPage(page - 1)}>
            <ChevronLeft size={20} />
          </button>
          <span>
            Page {page} of {pages} · {total.toLocaleString()} devices
          </span>
          <button className="btn-icon" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            <ChevronRight size={20} />
          </button>
        </div>
      )}
    </div>
  );
};

export default Health;
