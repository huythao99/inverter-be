import React, { useCallback, useEffect, useState } from 'react';
import { CircuitBoard, Download, Loader2, RefreshCw } from 'lucide-react';
import { getDeviceStm, triggerStmUpdate } from '../services/api';
import type { DeviceStmInfo } from '../services/api';

export interface StmOtaLive {
  status: string;
  progress?: number;
  message?: string;
}

const STATUS_LABEL: Record<string, string> = {
  sent: 'Command sent, waiting for the device',
  starting: 'Starting',
  downloading: 'Downloading image',
  verifying: 'Verifying image',
  flashing: 'Flashing STM32',
  installing: 'Flashing STM32',
  success: 'STM32 updated',
  failed: 'Update failed',
  rescue_needed: 'STM32 stuck in bootloader — power-cycle needed',
};

const REASON_TEXT: Record<string, string> = {
  esp_firmware_too_old: 'ESP32 firmware too old for STM32 FOTA',
  version_unknown: 'STM32 has not reported its version yet',
  no_firmware: 'No STM32 image registered for this chip / voltage',
};

/** STM32 power-board firmware of one inverter (CMS device detail). */
const StmFirmwareCard: React.FC<{ deviceId: string; live: StmOtaLive | null }> = ({
  deviceId,
  live,
}) => {
  const [info, setInfo] = useState<DeviceStmInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [force, setForce] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await getDeviceStm(deviceId);
      setInfo(res.data);
    } catch (err) {
      console.error('Failed to load STM32 info', err);
    } finally {
      setIsLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    load();
  }, [load]);

  // After a successful flash the ESP32 re-reports the STM32 version.
  useEffect(() => {
    if (live?.status !== 'success') return;
    const t = setTimeout(load, 30000);
    return () => clearTimeout(t);
  }, [live?.status, load]);

  const handleUpdate = async () => {
    if (!info?.target) return;
    const ok = window.confirm(
      `Flash STM32 v${info.target.version} (${info.target.chip} ${info.target.voltage}) on this device?\n\n` +
        'The inverter stops producing power for ~40 s while the STM32 is flashed. ' +
        'Prefer a time with low output (night).',
    );
    if (!ok) return;
    setIsSending(true);
    setNotice(null);
    try {
      const res = await triggerStmUpdate(deviceId, force);
      setNotice({ ok: true, text: `Update to ${res.data.targetVersion} sent.` });
      load();
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data
        ?.message;
      setNotice({ ok: false, text: message || 'Failed to send the STM32 update' });
    } finally {
      setIsSending(false);
    }
  };

  const status = live ?? (info?.lastOta ? { ...info.lastOta } : null);
  const pct =
    status?.status === 'success' ? 100 : Math.max(0, Math.min(100, Number(status?.progress ?? 0)));
  const failed = status?.status === 'failed' || status?.status === 'rescue_needed';

  return (
    <div className="stm-card">
      <div className="stm-card-header">
        <h3>
          <CircuitBoard size={18} /> STM32 power board
        </h3>
        <button className="btn-icon" onClick={load} title="Refresh" disabled={isLoading}>
          {isLoading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
        </button>
      </div>

      {info && (
        <>
          <div className="stm-grid">
            <div>
              <label>Chip / Voltage</label>
              <span>
                {info.chip ?? '—'} / {info.voltage ?? '—'}
              </span>
            </div>
            <div>
              <label>Running</label>
              <span className="monospace">{info.version ?? info.crc32 ?? '—'}</span>
            </div>
            <div>
              <label>Target</label>
              <span className="monospace">
                {info.target ? `${info.target.version} (${info.target.channel})` : '—'}
              </span>
            </div>
            <div>
              <label>Reported</label>
              <span>{info.reportedAt ? new Date(info.reportedAt).toLocaleString() : 'never'}</span>
            </div>
          </div>

          {info.reason && (
            <p className="stm-note warn">
              {REASON_TEXT[info.reason] ?? info.reason}
              {info.reason === 'esp_firmware_too_old' && ` (needs ESP32 >= ${info.minEspVersion})`}
            </p>
          )}

          {info.target && (
            <div className="stm-card-header" style={{ marginTop: 12, marginBottom: 0 }}>
              <label className="modal-check">
                <input
                  type="checkbox"
                  checked={force}
                  onChange={(e) => setForce(e.target.checked)}
                />{' '}
                Re-flash even if up to date
              </label>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleUpdate}
                disabled={isSending || (!info.updateAvailable && !force)}
              >
                {isSending ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
                {info.updateAvailable ? `Update to ${info.target.version}` : 'Up to date'}
              </button>
            </div>
          )}
        </>
      )}

      {notice && <p className={`stm-note ${notice.ok ? '' : 'error'}`}>{notice.text}</p>}

      {status && (
        <div className="stm-progress">
          <div className="ota-progress-header">
            <span className="ota-status">
              {STATUS_LABEL[status.status] ?? status.status}
              {status.message ? ` — ${status.message}` : ''}
            </span>
            {!failed && <span className="ota-percentage">{pct}%</span>}
          </div>
          {!failed && (
            <div className="ota-progress-bar">
              <div
                className={`ota-progress-fill ${status.status === 'success' ? 'success' : ''}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default StmFirmwareCard;
