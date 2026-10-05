import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Send, Zap, ZapOff } from 'lucide-react';
import { getGridTie, setGridTie } from '../services/api';

/**
 * Grid-tie ("hoà lưới") of one inverter (CMS device detail).
 * Every action re-publishes the retained cmd/grid-tie, so "Gửi lại" also
 * clears a stale OFF the device holds (retained topic / NVS) while the DB
 * says ON.
 */
const GridTieCard: React.FC<{ deviceId: string }> = ({ deviceId }) => {
  const [off, setOff] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await getGridTie(deviceId);
      setOff(res.data.off);
    } catch (err) {
      console.error('Failed to load grid-tie', err);
    } finally {
      setIsLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    load();
  }, [load]);

  const apply = async (nextOff: boolean) => {
    if (isSaving) return;
    if (
      nextOff !== off &&
      !window.confirm(
        nextOff
          ? 'Tắt hoà lưới thiết bị này? Máy sẽ chạy 99.00 V / 1 W (ngừng xả) cho đến khi bật lại.'
          : 'Bật lại hoà lưới thiết bị này?',
      )
    ) {
      return;
    }
    setIsSaving(true);
    setNotice(null);
    try {
      const res = await setGridTie(deviceId, nextOff);
      setOff(res.data.off);
      setNotice(
        res.data.published
          ? {
              ok: true,
              text: `Đã gửi lệnh ${res.data.off ? 'TẮT' : 'BẬT'} hoà lưới (thiết bị offline sẽ nhận khi kết nối lại).`,
            }
          : { ok: false, text: 'Đã lưu nhưng MQTT đang mất kết nối — chưa gửi được xuống thiết bị.' },
      );
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data
        ?.message;
      setNotice({ ok: false, text: message || 'Không gửi được lệnh' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="stm-card">
      <div className="stm-card-header">
        <h3>
          {off ? <ZapOff size={18} /> : <Zap size={18} />} Hoà lưới
        </h3>
        <button className="btn-icon" onClick={load} title="Refresh" disabled={isLoading}>
          {isLoading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
        </button>
      </div>

      {off !== null && (
        <>
          <div className="stm-grid">
            <div>
              <label>Trạng thái (server)</label>
              <span style={{ fontWeight: 600, color: off ? '#cc1100' : '#05a03a' }}>
                {off ? 'TẮT hoà lưới' : 'Đang hoà lưới'}
              </span>
            </div>
          </div>

          <div className="stm-card-header" style={{ marginTop: 12, marginBottom: 0 }}>
            <span style={{ fontSize: 13, color: '#666' }}>
              Bản tin báo 99.00 / 1.00 mà server đang "hoà lưới"? Bấm Gửi lại.
            </span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => apply(off)}
                disabled={isSaving}
                title="Gửi lại trạng thái hiện tại xuống thiết bị"
              >
                {isSaving ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
                Gửi lại
              </button>
              <button
                className={`btn btn-sm ${off ? 'btn-primary' : 'btn-danger'}`}
                onClick={() => apply(!off)}
                disabled={isSaving}
              >
                {off ? 'Bật hoà lưới' : 'Tắt hoà lưới'}
              </button>
            </div>
          </div>
        </>
      )}

      {notice && <p className={`stm-note ${notice.ok ? '' : 'error'}`}>{notice.text}</p>}
    </div>
  );
};

export default GridTieCard;
