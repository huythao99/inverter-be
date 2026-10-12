import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Loader2, RefreshCw } from 'lucide-react';
import { getRunSource } from '../services/api';
import type { RunSource, RunSourceInfo, RunValue } from '../services/api';

const SOURCE_LABEL: Record<string, string> = {
  lock: 'Khoá (blacklist)',
  gridtie: 'Tắt hoà lưới',
  share: 'Chia tải',
  schedule: 'Lịch',
  setting: 'Cài đặt',
  none: 'Chưa có giá trị',
  unlock: 'Mở khoá',
};

const SOURCE_COLOR: Record<string, string> = {
  lock: '#cc1100',
  gridtie: '#cc1100',
  share: '#7c3aed',
  schedule: '#2563eb',
  setting: '#05a03a',
  none: '#666',
};

const fmtValue = (v: RunValue | null | undefined) =>
  v ? `${v.cutoffV.toFixed(2)} V / ${Math.round(v.limitW)} W` : '—';

const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('vi-VN') : '—';

const matchLabel = (key: string) => {
  if (key.startsWith('schedule#')) return `Lịch #${key.slice(9)}`;
  return SOURCE_LABEL[key] ?? key;
};

const expectedLabel = (info: RunSourceInfo) => {
  const e = info.expected;
  if (e.source === 'schedule' && e.slot !== null) {
    const slot = info.schedule.slots.find((s) => s.index === e.slot);
    return `Lịch #${e.slot}${slot ? ` (${slot.startVn} – ${slot.endVn})` : ''}`;
  }
  if (e.source === 'share' && info.flags.share.groupName) {
    return `Chia tải — nhóm "${info.flags.share.groupName}"`;
  }
  return SOURCE_LABEL[e.source as RunSource] ?? e.source;
};

/**
 * CMS device detail: is the inverter running its schedule or its setting
 * right now? Server view (same priority as the firmware), the device's last
 * SOURCE_CHANGE report and what the STM32 really runs, plus the schedule table.
 */
const RunSourceCard: React.FC<{ deviceId: string }> = ({ deviceId }) => {
  const [info, setInfo] = useState<RunSourceInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await getRunSource(deviceId);
      setInfo(res.data);
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data
        ?.message;
      setError(message || 'Không tải được trạng thái');
    } finally {
      setIsLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    load();
  }, [load]);

  const e = info?.expected;
  const stm = info?.stm;

  return (
    <div className="stm-card">
      <div className="stm-card-header">
        <h3>
          <CalendarClock size={18} /> Đang chạy theo lịch hay cài đặt?
        </h3>
        <button className="btn-icon" onClick={load} title="Refresh" disabled={isLoading}>
          {isLoading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
        </button>
      </div>

      {error && <p className="stm-note error">{error}</p>}

      {info && e && (
        <>
          <div className="stm-grid">
            <div>
              <label>Theo server (lúc {info.nowVn} giờ VN)</label>
              <span style={{ fontWeight: 600, color: SOURCE_COLOR[e.source] ?? '#333' }}>
                {expectedLabel(info)}
              </span>
              <div style={{ fontSize: 13, color: '#666' }}>{fmtValue(e.value)}</div>
            </div>
            <div>
              <label>STM32 đang chạy (bản tin)</label>
              {stm ? (
                <>
                  <span
                    style={{
                      fontWeight: 600,
                      color:
                        stm.matchesExpected === null
                          ? '#333'
                          : stm.matchesExpected
                            ? '#05a03a'
                            : '#cc1100',
                    }}
                  >
                    {fmtValue(stm)}
                    {stm.matchesExpected === true && ' ✓ khớp'}
                    {stm.matchesExpected === false && ' ✗ không khớp'}
                  </span>
                  <div style={{ fontSize: 13, color: '#666' }}>
                    {stm.matches.length
                      ? `Trùng giá trị: ${stm.matches.map(matchLabel).join(', ')}`
                      : 'Không trùng giá trị nào'}
                    {stm.legacy && ' · bo cũ (tối đa 1200 W)'}
                  </div>
                  <div style={{ fontSize: 12, color: '#999' }}>{fmtTime(stm.at)}</div>
                </>
              ) : (
                <span>—</span>
              )}
            </div>
            <div>
              <label>Thiết bị báo lần cuối</label>
              {info.reported ? (
                <>
                  <span style={{ fontWeight: 600 }}>
                    {SOURCE_LABEL[info.reported.source] ?? info.reported.source}
                  </span>
                  <div style={{ fontSize: 13, color: '#666' }}>{info.reported.value}</div>
                  <div style={{ fontSize: 12, color: '#999' }}>{fmtTime(info.reported.at)}</div>
                </>
              ) : (
                <span>Chưa có báo cáo</span>
              )}
            </div>
            <div>
              <label>Cài đặt</label>
              <span>{fmtValue(info.setting?.value)}</span>
              <div style={{ fontSize: 12, color: '#999' }}>
                {info.setting ? `${info.setting.raw} · ${fmtTime(info.setting.updatedAt)}` : ''}
              </div>
            </div>
          </div>

          {e.note && <p className="stm-note warn">{e.note}</p>}
          {(info.flags.gridTieOff || info.flags.blacklisted || info.flags.share.enabled) && (
            <p className="stm-note">
              {info.flags.blacklisted && 'Thiết bị đang bị khoá (blacklist). '}
              {info.flags.gridTieOff && 'Đang tắt hoà lưới (ưu tiên hơn lịch và cài đặt). '}
              {info.flags.share.enabled &&
                `Đang chia tải${info.flags.share.computedW !== null ? `: ${info.flags.share.computedW} W` : ''} (ưu tiên hơn lịch và cài đặt). `}
            </p>
          )}

          <div className="table-container" style={{ marginTop: 16, boxShadow: 'none' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Bắt đầu (VN)</th>
                  <th>Kết thúc (VN)</th>
                  <th>UTC (lưu trên server)</th>
                  <th>Cắt áp</th>
                  <th>Công suất</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {info.schedule.slots.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', color: '#999' }}>
                      Không có lịch
                    </td>
                  </tr>
                )}
                {info.schedule.slots.map((s) => (
                  <tr
                    key={s.index}
                    className={s.active ? 'selected' : undefined}
                    style={s.placeholder && !s.active ? { color: '#999' } : undefined}
                  >
                    <td>{s.index}</td>
                    <td>{s.startVn || '—'}</td>
                    <td>{s.endVn || '—'}</td>
                    <td className="monospace">
                      {s.startUtc}–{s.endUtc}
                    </td>
                    <td>{s.decoded ? `${s.decoded.cutoffV.toFixed(2)} V` : '—'}</td>
                    <td>{s.decoded ? `${s.decoded.limitW} W` : '—'}</td>
                    <td>
                      {s.active ? (
                        <strong style={{ color: '#2563eb' }}>Đang khớp giờ</strong>
                      ) : s.placeholder ? (
                        'Ô trống'
                      ) : !s.decoded ? (
                        <span style={{ color: '#cc1100' }}>Giá trị lỗi: {s.value || '(trống)'}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="stm-note" style={{ color: '#999' }}>
            Thứ tự ưu tiên trên thiết bị: khoá → tắt hoà lưới → chia tải → lịch (ô đầu tiên khớp
            giờ) → cài đặt. Lịch cập nhật: {fmtTime(info.schedule.updatedAt)}. Báo cáo của thiết
            bị chỉ gửi khi đổi nguồn và tối đa 5 phút/lần, nên cột "STM32 đang chạy" là chính xác
            nhất.
          </p>
        </>
      )}
    </div>
  );
};

export default RunSourceCard;
