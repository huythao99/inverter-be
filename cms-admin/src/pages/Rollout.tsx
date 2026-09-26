import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  FastForward,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Rocket,
  Send,
  XCircle,
} from 'lucide-react';
import {
  getActiveRollout,
  getEspFirmwareConfig,
  getEspFirmwares,
  getRolloutDevices,
  getRollouts,
  rolloutAction,
  startRollout,
} from '../services/api';
import type {
  EspFirmware,
  Rollout as RolloutT,
  RolloutDeviceRow,
  RolloutDeviceState,
} from '../services/api';
import { ago } from '../components/health-meta';

const STATE_META: Record<RolloutDeviceState, { label: string; tone: string }> = {
  pushed: { label: 'Command sent', tone: 'info' },
  installing: { label: 'Installing', tone: 'info' },
  updated: { label: 'Observing', tone: 'info' },
  healthy: { label: 'Healthy', tone: 'ok' },
  failed: { label: 'OTA failed', tone: 'bad' },
  rolled_back: { label: 'Rolled back', tone: 'bad' },
  unhealthy: { label: 'Unhealthy', tone: 'bad' },
  stalled: { label: 'Stalled', tone: 'warn' },
};
const STATES = Object.keys(STATE_META) as RolloutDeviceState[];

const errorText = (err: unknown, fallback: string) => {
  const message = (err as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data?.message;
  return Array.isArray(message) ? message.join(', ') : message || fallback;
};

const cmpVersion = (a: string, b: string) => {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

const StatusBadge: React.FC<{ status: RolloutT['status'] }> = ({ status }) => (
  <span className={`rollout-status rollout-${status}`}>{status}</span>
);

/** Staged (canary) rollout of the inverter ESP32 firmware. */
const Rollout: React.FC = () => {
  const [active, setActive] = useState<RolloutT | null>(null);
  const [history, setHistory] = useState<RolloutT[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<'' | 'advance' | 'abort'>('');

  const [devState, setDevState] = useState<RolloutDeviceState | ''>('');
  const [devPage, setDevPage] = useState(1);
  const [devices, setDevices] = useState<{ data: RolloutDeviceRow[]; total: number }>({
    data: [],
    total: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, h] = await Promise.all([getActiveRollout(), getRollouts()]);
      setActive(a.data.rollout);
      setHistory(h.data);
      setError('');
    } catch (err) {
      setError(errorText(err, 'Failed to load rollouts'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDevices = useCallback(async () => {
    if (!active) return;
    try {
      const r = await getRolloutDevices(active._id, {
        state: devState || undefined,
        page: devPage,
        limit: 50,
      });
      setDevices({ data: r.data.data, total: r.data.total });
    } catch {
      // Table stays as it was.
    }
  }, [active, devState, devPage]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  const act = async (action: 'pause' | 'resume' | 'advance' | 'abort' | 'push') => {
    if (!active) return;
    setBusy(action);
    setError('');
    try {
      await rolloutAction(active._id, action);
      setConfirm('');
      await load();
    } catch (err) {
      setError(errorText(err, `Failed to ${action}`));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="page rollout-page">
      <div className="page-header-actions">
        <div>
          <h1>Staged Rollout</h1>
          <p>
            Release a new inverter ESP32 build to a growing share of devices (e.g. 5% → 25% → 50%
            → 100%). Devices report back; the rollout pauses by itself when too many fail. The
            last stage makes the build stable.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={load} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          Refresh
        </button>
      </div>

      {error && <p className="notice notice-warn">{error}</p>}

      {loading && !active && history.length === 0 ? (
        <div className="loading">Loading...</div>
      ) : active ? (
        <ActiveRollout
          r={active}
          busy={busy}
          confirm={confirm}
          setConfirm={setConfirm}
          act={act}
        />
      ) : (
        <StartForm onStarted={load} />
      )}

      {active && (
        <div className="rollout-card">
          <div className="rollout-card-head">
            <h3>Devices in this rollout</h3>
          </div>
          <div className="health-chips">
            <button
              className={`health-chip ${devState === '' ? 'selected' : ''}`}
              onClick={() => {
                setDevState('');
                setDevPage(1);
              }}
            >
              All
            </button>
            {STATES.map((s) => (
              <button
                key={s}
                className={`health-chip tone-${STATE_META[s].tone} ${devState === s ? 'selected' : ''}`}
                onClick={() => {
                  setDevState(s);
                  setDevPage(1);
                }}
                disabled={!active.stats?.counts[s]}
              >
                {STATE_META[s].label}
                <b>{active.stats?.counts[s] ?? 0}</b>
              </button>
            ))}
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>State</th>
                  <th>From</th>
                  <th>Last OTA report</th>
                  <th>Detail</th>
                  <th>Changed</th>
                </tr>
              </thead>
              <tbody>
                {devices.data.map((d) => (
                  <tr key={d._id}>
                    <td>
                      <Link to={`/devices/${d.userId}/${d.deviceId}`} className="device-id">
                        {d.deviceId}
                      </Link>
                    </td>
                    <td>
                      <span className={`health-badge tone-${STATE_META[d.state].tone}`}>
                        {STATE_META[d.state].label}
                      </span>
                    </td>
                    <td>{d.fromVersion ?? '—'}</td>
                    <td>{d.otaStatus ?? '—'}</td>
                    <td className="muted">{d.reason ?? ''}</td>
                    <td className="muted">{ago(d.updatedAt)}</td>
                  </tr>
                ))}
                {devices.data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty-state">
                      No device yet. Devices appear when they get the command or start updating.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {devices.total > 50 && (
            <div className="pagination">
              <button className="btn-icon" disabled={devPage === 1} onClick={() => setDevPage(devPage - 1)}>
                <ChevronLeft size={20} />
              </button>
              <span>
                Page {devPage} of {Math.ceil(devices.total / 50)}
              </span>
              <button
                className="btn-icon"
                disabled={devPage >= Math.ceil(devices.total / 50)}
                onClick={() => setDevPage(devPage + 1)}
              >
                <ChevronRight size={20} />
              </button>
            </div>
          )}
        </div>
      )}

      {active?.events?.length ? (
        <div className="rollout-card">
          <h3>Timeline</h3>
          <ol className="rollout-events">
            {[...active.events].reverse().map((e, i) => (
              <li key={i}>
                <span className="muted">{new Date(e.at).toLocaleString()}</span>
                <span className={`rollout-event rollout-event-${e.type}`}>{e.message}</span>
                {e.by && <span className="muted"> · {e.by}</span>}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {history.filter((h) => h._id !== active?._id).length > 0 && (
        <div className="rollout-card">
          <h3>History</h3>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>From</th>
                  <th>Status</th>
                  <th>Reached</th>
                  <th>Started</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {history
                  .filter((h) => h._id !== active?._id)
                  .map((h) => (
                    <tr key={h._id}>
                      <td>{h.version}</td>
                      <td>{h.fromVersion}</td>
                      <td>
                        <StatusBadge status={h.status} />
                      </td>
                      <td>{h.percent}%</td>
                      <td className="muted">{new Date(h.createdAt).toLocaleString()}</td>
                      <td className="muted">{h.createdBy ?? '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

const ActiveRollout: React.FC<{
  r: RolloutT;
  busy: string;
  confirm: '' | 'advance' | 'abort';
  setConfirm: (c: '' | 'advance' | 'abort') => void;
  act: (a: 'pause' | 'resume' | 'advance' | 'abort' | 'push') => void;
}> = ({ r, busy, confirm, setConfirm, act }) => {
  const s = r.stats;
  const last = r.stageIndex >= r.stages.length - 1;
  const failPct = s?.failRate != null ? Math.round(s.failRate * 100) : null;
  const B = (a: string) => (busy === a ? <Loader2 size={16} className="spin" /> : null);

  return (
    <div className="rollout-card">
      <div className="rollout-card-head">
        <div>
          <h2>
            v{r.version} <span className="muted">from v{r.fromVersion}</span>
          </h2>
          <p className="muted">
            Started {new Date(r.createdAt).toLocaleString()}
            {r.createdBy ? ` by ${r.createdBy}` : ''} · stage {r.stageIndex + 1}/{r.stages.length}{' '}
            since {ago(r.stageStartedAt)}
          </p>
        </div>
        <StatusBadge status={r.status} />
      </div>

      {r.pauseReason && r.status === 'paused' && (
        <p className="notice notice-warn">{r.pauseReason}</p>
      )}

      {/* Stage track */}
      <div className="rollout-track" aria-label={`Offered to ${r.percent}% of devices`}>
        <div className="rollout-track-fill" style={{ width: `${r.percent}%` }} />
        {r.stages.map((p, i) => (
          <span
            key={p}
            className={`rollout-stop ${i <= r.stageIndex ? 'done' : ''}`}
            style={{ left: `${p}%` }}
          >
            <span>{p}%</span>
          </span>
        ))}
      </div>

      {s && (
        <div className="rollout-stats">
          <div>
            <b>{s.eligible.toLocaleString()}</b>
            <span>devices in stage</span>
          </div>
          <div>
            <b>{s.onVersion.toLocaleString()}</b>
            <span>on v{r.version}</span>
          </div>
          <div>
            <b className="text-green">{s.healthy}</b>
            <span>healthy</span>
          </div>
          <div>
            <b className={s.failures ? 'text-danger' : ''}>{s.failures}</b>
            <span>failed</span>
          </div>
          <div>
            <b>{s.pending}</b>
            <span>in progress</span>
          </div>
          <div>
            <b className={failPct !== null && failPct > r.maxFailRate * 100 ? 'text-danger' : ''}>
              {failPct === null ? '—' : `${failPct}%`}
            </b>
            <span>
              fail rate (max {Math.round(r.maxFailRate * 100)}%, ≥{r.minSamples} results)
            </span>
          </div>
        </div>
      )}

      <p className="muted rollout-rules">
        {r.autoPush ? 'Sends the update command to each new stage' : 'Offer only (users update from the app)'} ·
        healthy = sends data for {r.observeMinutes} min after updating ·{' '}
        {r.autoAdvance ? `next stage automatically after ${r.stageHours} h when healthy` : 'next stage manually'}
        {r.pendingPush && ' · update command waiting to be sent'}
      </p>

      <div className="rollout-actions">
        {r.status === 'running' ? (
          <button className="btn btn-secondary" onClick={() => act('pause')} disabled={!!busy}>
            {B('pause') ?? <Pause size={16} />} Pause
          </button>
        ) : (
          <button className="btn btn-secondary" onClick={() => act('resume')} disabled={!!busy}>
            {B('resume') ?? <Play size={16} />} Resume
          </button>
        )}
        {r.status === 'running' && (
          <button className="btn btn-secondary" onClick={() => act('push')} disabled={!!busy}>
            {B('push') ?? <Send size={16} />} Re-send command
          </button>
        )}
        {confirm === 'advance' ? (
          <>
            <button className="btn btn-primary" onClick={() => act('advance')} disabled={!!busy}>
              {B('advance') ?? <FastForward size={16} />}{' '}
              {last ? `Confirm: make v${r.version} stable` : `Confirm: go to ${r.stages[r.stageIndex + 1]}%`}
            </button>
            <button className="btn btn-secondary" onClick={() => setConfirm('')}>
              Cancel
            </button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={() => setConfirm('advance')} disabled={!!busy}>
            <FastForward size={16} />
            {last ? 'Complete (make stable)' : `Next stage (${r.stages[r.stageIndex + 1]}%)`}
          </button>
        )}
        {confirm === 'abort' ? (
          <>
            <button className="btn btn-danger" onClick={() => act('abort')} disabled={!!busy}>
              {B('abort') ?? <XCircle size={16} />} Confirm abort
            </button>
            <button className="btn btn-secondary" onClick={() => setConfirm('')}>
              Cancel
            </button>
          </>
        ) : (
          <button className="btn btn-danger" onClick={() => setConfirm('abort')} disabled={!!busy}>
            <XCircle size={16} /> Abort
          </button>
        )}
      </div>
      {confirm === 'abort' && (
        <p className="muted">
          Aborting stops offering v{r.version}. Devices already updated keep it; to bring them
          back, set an older build as stable and run a bulk update.
        </p>
      )}
    </div>
  );
};

const StartForm: React.FC<{ onStarted: () => void }> = ({ onStarted }) => {
  const [builds, setBuilds] = useState<EspFirmware[]>([]);
  const [stable, setStable] = useState('');
  const [form, setForm] = useState({
    firmwareId: '',
    stages: '5, 25, 50, 100',
    autoPush: true,
    autoAdvance: false,
    stageHours: 24,
    maxFailRate: 20,
    minSamples: 5,
    observeMinutes: 30,
  });
  const [err, setErr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([getEspFirmwares('inverter'), getEspFirmwareConfig()])
      .then(([list, cfg]) => {
        const st = cfg.data.active.inverter.stable.version;
        setStable(st);
        const newer = list.data.filter((b) => cmpVersion(b.version, st) > 0);
        setBuilds(newer);
        if (newer[0]) setForm((f) => ({ ...f, firmwareId: newer[0]._id }));
      })
      .catch(() => setErr('Failed to load firmware builds'));
  }, []);

  const stages = useMemo(
    () =>
      form.stages
        .split(/[,\s]+/)
        .map((x) => parseInt(x, 10))
        .filter((n) => n >= 1 && n <= 100),
    [form.stages]
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.firmwareId) return setErr('Pick a build');
    setSubmitting(true);
    setErr('');
    try {
      await startRollout({
        firmwareId: form.firmwareId,
        stages,
        autoPush: form.autoPush,
        autoAdvance: form.autoAdvance,
        stageHours: Number(form.stageHours),
        maxFailRate: Number(form.maxFailRate) / 100,
        minSamples: Number(form.minSamples),
        observeMinutes: Number(form.observeMinutes),
      });
      onStarted();
    } catch (error) {
      setErr(errorText(error, 'Failed to start the rollout'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="form-card">
      <div className="form-card-header">
        <h3>
          <Rocket size={18} /> Start a rollout
        </h3>
      </div>
      {builds.length === 0 ? (
        <p className="muted">
          No uploaded inverter build newer than stable v{stable || '…'}. Upload one on the{' '}
          <Link to="/esp-firmware">ESP32 Firmware</Link> page first.
        </p>
      ) : (
        <form onSubmit={submit} className="blacklist-form">
          <div className="form-row">
            <div className="form-group">
              <label>Build</label>
              <select value={form.firmwareId} onChange={(e) => setForm({ ...form, firmwareId: e.target.value })}>
                {builds.map((b) => (
                  <option key={b._id} value={b._id}>
                    v{b.version}
                    {b.channels.includes('beta') ? ' (beta)' : ''}
                    {b.notes ? ` — ${b.notes}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Stages (% of devices)</label>
              <input value={form.stages} onChange={(e) => setForm({ ...form, stages: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Pause when fail rate &gt; (%)</label>
              <input
                type="number"
                min={1}
                max={100}
                value={form.maxFailRate}
                onChange={(e) => setForm({ ...form, maxFailRate: Number(e.target.value) })}
              />
            </div>
            <div className="form-group">
              <label>…after at least (results)</label>
              <input
                type="number"
                min={1}
                value={form.minSamples}
                onChange={(e) => setForm({ ...form, minSamples: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Healthy = sends data for (min)</label>
              <input
                type="number"
                min={5}
                value={form.observeMinutes}
                onChange={(e) => setForm({ ...form, observeMinutes: Number(e.target.value) })}
              />
            </div>
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.autoPush}
                  onChange={(e) => setForm({ ...form, autoPush: e.target.checked })}
                />{' '}
                Send the update command to each stage
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.autoAdvance}
                  onChange={(e) => setForm({ ...form, autoAdvance: e.target.checked })}
                />{' '}
                Go to the next stage automatically
              </label>
            </div>
            {form.autoAdvance && (
              <div className="form-group">
                <label>…after (hours per stage)</label>
                <input
                  type="number"
                  min={1}
                  value={form.stageHours}
                  onChange={(e) => setForm({ ...form, stageHours: Number(e.target.value) })}
                />
              </div>
            )}
          </div>
          <p className="muted">
            Stable is v{stable}. Stages: {stages.join('% → ')}%{stages[stages.length - 1] !== 100 && ' → 100%'}. Devices
            keep the same bucket, so each stage only adds devices. Beta-list and legacy devices are
            left out. Without the update command, devices in the stage are only offered the
            update in the app.
          </p>
          {err && <p className="form-error">{err}</p>}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? <Loader2 size={16} className="spin" /> : <Rocket size={16} />}
              Start rollout
            </button>
          </div>
        </form>
      )}
      {err && builds.length === 0 && <p className="form-error">{err}</p>}
    </div>
  );
};

export default Rollout;
