import React, { useCallback, useEffect, useState } from 'react';
import { Cable, Loader2, RefreshCw } from 'lucide-react';
import { getStmProtocol, setStmProtocol } from '../services/api';
import type { StmProtocolInfo, StmProtocolSetting } from '../services/api';

const SETTING_LABEL: Record<StmProtocolSetting, string> = {
  auto: 'Tự động',
  new: 'Mới',
  legacy: 'Cũ',
};
const MODE_LABEL: Record<'new' | 'legacy', string> = {
  new: 'Mới (*VVVV@PPPP#)',
  legacy: 'Cũ (handshake GPIO2/14, 8 số thô)',
};
const SRC_LABEL: Record<string, string> = {
  auto: 'tự nhận khi khởi động',
  'auto-late': 'tự nhận sau khi khởi động',
  nvs: 'theo cài đặt đã lưu',
  cms: 'theo CMS',
};

/**
 * ESP32 <-> STM32 link protocol of one inverter (CMS device detail).
 * Firmware without cmd/stm-protocol never reports, and ignores the setting.
 */
const StmProtocolCard: React.FC<{ deviceId: string }> = ({ deviceId }) => {
  const [info, setInfo] = useState<StmProtocolInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await getStmProtocol(deviceId);
      setInfo(res.data);
    } catch (err) {
      console.error('Failed to load STM protocol', err);
    } finally {
      setIsLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    load();
  }, [load]);

  const choose = async (mode: StmProtocolSetting) => {
    if (!info || mode === info.setting || isSaving) return;
    if (
      mode !== 'auto' &&
      !window.confirm(
        `Ép thiết bị dùng giao thức ${SETTING_LABEL[mode].toLowerCase()}?\n\n` +
          'Chọn sai thì STM32 không nhận lệnh (máy không chạy theo cài đặt) cho đến khi đổi lại.',
      )
    ) {
      return;
    }
    setIsSaving(true);
    setNotice(null);
    try {
      const res = await setStmProtocol(deviceId, mode);
      setInfo(res.data);
      setNotice(
        res.data.published === false
          ? { ok: false, text: 'Đã lưu nhưng MQTT đang mất kết nối — chưa gửi được xuống thiết bị.' }
          : { ok: true, text: `Đã gửi "${SETTING_LABEL[mode]}" (thiết bị offline sẽ nhận khi kết nối lại).` },
      );
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data
        ?.message;
      setNotice({ ok: false, text: message || 'Không lưu được' });
    } finally {
      setIsSaving(false);
    }
  };

  const r = info?.reported ?? null;
  // The device has not applied the CMS value yet (offline / old firmware).
  const pending = !!info && !!r && r.setting !== info.setting;

  return (
    <div className="stm-card">
      <div className="stm-card-header">
        <h3>
          <Cable size={18} /> Giao tiếp ESP32 ↔ STM32
        </h3>
        <button className="btn-icon" onClick={load} title="Refresh" disabled={isLoading}>
          {isLoading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
        </button>
      </div>

      {info && (
        <>
          <div className="stm-grid">
            <div>
              <label>Đang dùng</label>
              <span>{r ? MODE_LABEL[r.mode] : '—'}</span>
            </div>
            <div>
              <label>Tự nhận diện</label>
              <span>{r ? (r.detected === 'legacy' ? 'Bo mạch cũ' : 'Bo mạch mới') : '—'}</span>
            </div>
            <div>
              <label>Nguồn</label>
              <span>{r ? SRC_LABEL[r.src] ?? r.src : '—'}</span>
            </div>
            <div>
              <label>Báo cáo lúc</label>
              <span>{r ? new Date(r.at).toLocaleString() : 'chưa có (firmware cũ?)'}</span>
            </div>
          </div>

          <div className="stm-card-header" style={{ marginTop: 12, marginBottom: 0 }}>
            <span style={{ fontSize: 13, color: '#666' }}>Chế độ</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['auto', 'new', 'legacy'] as StmProtocolSetting[]).map((m) => (
                <button
                  key={m}
                  className={`btn btn-sm ${info.setting === m ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => choose(m)}
                  disabled={isSaving}
                >
                  {SETTING_LABEL[m]}
                </button>
              ))}
            </div>
          </div>

          {pending && (
            <p className="stm-note warn">
              Thiết bị đang báo chế độ "{SETTING_LABEL[r!.setting]}", chưa áp dụng "
              {SETTING_LABEL[info.setting]}" (đang offline hoặc chưa khởi động lại kết nối).
            </p>
          )}
          {r?.mode === 'legacy' && (
            <p className="stm-note">Chế độ cũ: không cập nhật được firmware STM32 qua mạng.</p>
          )}
        </>
      )}

      {notice && <p className={`stm-note ${notice.ok ? '' : 'error'}`}>{notice.text}</p>}
    </div>
  );
};

export default StmProtocolCard;
