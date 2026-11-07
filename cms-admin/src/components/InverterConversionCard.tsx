import React, { useEffect, useState } from 'react';
import { ArrowRightLeft, Loader2, Send, X } from 'lucide-react';
import {
  cancelInverterConversion,
  getInverterConversionTarget,
  startInverterConversion,
  type InverterConversion,
} from '../services/api';

const OFFSET = 90000; // HYBRID_AS_GTI_OFFSET (backend / esp32-hybrid)

/** Inverter id the unit will run as (same rule as the backend). */
function inverterIdFor(deviceId: string, convertedFrom?: string | null): string | null {
  if (convertedFrom) return convertedFrom;
  const m = /^HybridControl(\d+)$/.exec(deviceId);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n < OFFSET ? `GTIControl${OFFSET + n}` : null;
}

/**
 * "Chuyển về inverter" (hybrid device detail): only the ESP32, by OTA. The
 * unit gets the stable inverter build and runs as GTIControl<old number> (a
 * converted inverter board) or GTIControl<90000 + N> (a hybrid flashed as
 * one). Meant for inverter power boards: on a hybrid power board the inverter
 * firmware has nothing to drive.
 */
const InverterConversionCard: React.FC<{
  id: string;
  deviceId: string;
  firmwareVersion?: string;
  convertedFrom?: string | null;
  conversion?: InverterConversion | null;
  onChanged?: () => void;
}> = ({ id, deviceId, firmwareVersion, convertedFrom, conversion, onChanged }) => {
  const [target, setTarget] = useState<{ version: string } | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const newId = inverterIdFor(deviceId, convertedFrom);

  useEffect(() => {
    getInverterConversionTarget()
      .then((r) => setTarget(r.data))
      .catch((e) => setTargetError(e?.response?.data?.message ?? 'Không lấy được firmware inverter'));
  }, []);

  if (!newId) return null;

  const start = async () => {
    if (
      !window.confirm(
        `Chuyển ${deviceId} về firmware inverter (hoà lưới)?\n\n` +
          `• Chỉ đổi firmware ESP32 (OTA). Chỉ dùng khi mạch công suất là mạch hoà lưới` +
          (convertedFrom ? '.' : ': máy này nạp hybrid từ đầu, nếu mạch là hybrid thì firmware inverter không chạy được.') +
          `\n• Máy đổi tên thành ${newId}; mục hybrid bị xoá khi máy chạy dưới tên mới.\n` +
          `• Khách thêm lại máy trên app (nếu máy chưa có WiFi nhà của firmware inverter).`,
      )
    ) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const r = await startInverterConversion(id);
      setNotice({
        ok: true,
        text: `Đã gửi lệnh: máy tải firmware inverter v${r.data.version}, xong sẽ chạy dưới tên ${newId}.`,
      });
      onChanged?.();
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setNotice({ ok: false, text: msg || 'Không gửi được lệnh' });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await cancelInverterConversion(id);
      setNotice({ ok: true, text: 'Đã huỷ chuyển đổi.' });
      onChanged?.();
    } catch {
      setNotice({ ok: false, text: 'Không huỷ được' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stm-card">
      <div className="stm-card-header">
        <h3>
          <ArrowRightLeft size={18} /> Chuyển về inverter
        </h3>
      </div>
      <div className="stm-grid">
        <div>
          <label>Mã inverter</label>
          <span style={{ fontWeight: 600 }}>{newId}</span>
        </div>
        <div>
          <label>Nguồn gốc</label>
          <span>{convertedFrom ? `Chuyển từ ${convertedFrom}` : 'Nạp hybrid từ đầu'}</span>
        </div>
        <div>
          <label>Firmware inverter (stable)</label>
          <span>{target ? `v${target.version}` : targetError ? '—' : '…'}</span>
        </div>
        <div>
          <label>Trạng thái</label>
          <span style={{ fontWeight: 600, color: conversion ? '#b26a00' : '#666' }}>
            {conversion
              ? `Đang chuyển (v${conversion.version}, từ ${new Date(conversion.requestedAt).toLocaleString('vi-VN')})`
              : 'Chưa chuyển'}
          </span>
        </div>
      </div>
      {targetError && <p className="stm-note error">{targetError}</p>}
      <div className="stm-card-header" style={{ marginTop: 12, marginBottom: 0 }}>
        <span style={{ fontSize: 13, color: '#666' }}>
          Máy cần đang online và chạy hybrid ≥ 1.3.4 (hiện tại v{firmwareVersion ?? '?'}).
        </span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {conversion && (
            <button className="btn btn-sm btn-secondary" onClick={cancel} disabled={busy}>
              <X size={16} /> Huỷ
            </button>
          )}
          <button className="btn btn-sm btn-danger" onClick={start} disabled={busy || !target}>
            {busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
            {conversion ? 'Gửi lại' : 'Chuyển về inverter'}
          </button>
        </div>
      </div>
      {notice && <p className={`stm-note ${notice.ok ? '' : 'error'}`}>{notice.text}</p>}
    </div>
  );
};

export default InverterConversionCard;
