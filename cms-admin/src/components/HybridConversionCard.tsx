import React, { useEffect, useState } from 'react';
import { ArrowRightLeft, Loader2, Send, X } from 'lucide-react';
import {
  cancelHybridConversion,
  getHybridConversionTarget,
  startHybridConversion,
  type HybridConversion,
} from '../services/api';

/**
 * "Chuyển sang hybrid" (inverter device detail): only the ESP32, by OTA. The
 * device gets the stable hybrid build, renames itself GTIControlN ->
 * HybridControlN and starts as a new hybrid: the owner adds it again in the
 * app (setup WiFi + home WiFi), then the old inverter entry disappears.
 */
const HybridConversionCard: React.FC<{
  id: string;
  deviceId: string;
  conversion?: HybridConversion | null;
  onChanged?: () => void;
}> = ({ id, deviceId, conversion, onChanged }) => {
  const [target, setTarget] = useState<{ version: string; size: number } | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const hybridId = /^GTIControl(\d+)$/.exec(deviceId)?.[1];

  useEffect(() => {
    getHybridConversionTarget()
      .then((r) => setTarget(r.data))
      .catch((e) => setTargetError(e?.response?.data?.message ?? 'Không lấy được firmware hybrid'));
  }, []);

  if (!hybridId) return null;
  const newId = `HybridControl${hybridId}`;

  const start = async () => {
    if (
      !window.confirm(
        `Chuyển ${deviceId} sang firmware hybrid?\n\n` +
          `• Chỉ đổi firmware ESP32 (OTA), mạch STM32 phải là mạch hybrid.\n` +
          `• Máy đổi tên thành ${newId}, mất WiFi nhà và tài khoản cũ.\n` +
          `• Khách phải thêm lại máy trên app như thiết bị mới.\n` +
          `• Không quay lại được bằng nút này.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const r = await startHybridConversion(id);
      setNotice({
        ok: true,
        text: `Đã gửi lệnh cập nhật firmware hybrid v${r.data.version}. Máy online sẽ tải ngay; khi xong nó phát WiFi ${newId}.`,
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
      await cancelHybridConversion(id);
      setNotice({ ok: true, text: 'Đã huỷ: máy sẽ nhận lại firmware inverter ở lần cập nhật sau.' });
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
          <ArrowRightLeft size={18} /> Chuyển sang hybrid
        </h3>
      </div>

      <div className="stm-grid">
        <div>
          <label>Mã mới</label>
          <span style={{ fontWeight: 600 }}>{newId}</span>
        </div>
        <div>
          <label>Firmware hybrid (stable)</label>
          <span>{target ? `v${target.version} · ${(target.size / 1024).toFixed(0)} KB` : targetError ? '—' : '…'}</span>
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
          Chỉ đổi firmware ESP32. Xong khách thêm lại máy trên app ({newId}); mục inverter cũ tự xoá.
        </span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {conversion && (
            <button className="btn btn-sm btn-secondary" onClick={cancel} disabled={busy}>
              <X size={16} /> Huỷ
            </button>
          )}
          <button
            className="btn btn-sm btn-danger"
            onClick={start}
            disabled={busy || !target}
            title={conversion ? 'Gửi lại lệnh cập nhật' : undefined}
          >
            {busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
            {conversion ? 'Gửi lại' : 'Chuyển sang hybrid'}
          </button>
        </div>
      </div>

      {notice && <p className={`stm-note ${notice.ok ? '' : 'error'}`}>{notice.text}</p>}
    </div>
  );
};

export default HybridConversionCard;
