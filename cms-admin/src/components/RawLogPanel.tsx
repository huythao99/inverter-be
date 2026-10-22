import React, { useMemo, useState } from 'react';
import { Download, Pause, Play, Trash2 } from 'lucide-react';

import type { RawLogLine } from './raw-log';

const TAG_COLOR: Record<string, string> = {
  DATA: '#16a34a',
  ACK: '#0891b2',
  FRAME: '#2563eb',
  LEGACY: '#7c3aed',
  NOFRAME: '#d97706',
  BADCRC: '#dc2626',
  LONG: '#dc2626',
  UNKNOWN: '#d97706',
  SILENT: '#dc2626',
  STATUS: '#6b7280',
};

const TAG_HELP: Record<string, string> = {
  DATA: 'Khung hợp lệ, đã gửi lên /data (app/web thấy)',
  ACK: 'STM32 xác nhận lệnh',
  FRAME: 'ESP32 gửi xuống STM32',
  LEGACY: 'ESP32 gửi khung cũ (*LOCK/*UNLOCK)',
  NOFRAME: 'Dòng không phải khung $...*XX (bị bỏ)',
  BADCRC: 'Sai CRC (bị bỏ)',
  LONG: `Dòng quá dài, không có xuống dòng (bị bỏ)`,
  UNKNOWN: 'Loại khung lạ (không gửi lên /data)',
  SILENT: 'UART im lặng',
  STATUS: 'Heartbeat của ESP32',
};

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleTimeString('vi-VN', { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
};

/**
 * Terminal-like UART log: what the STM32 sent (RX), what the ESP32 sent (TX),
 * and why a line did not reach /data. Newest on top.
 */
const RawLogPanel: React.FC<{
  lines: RawLogLine[];
  paused: boolean;
  onPause: (p: boolean) => void;
  onClear: () => void;
  deviceId: string;
}> = ({ lines, paused, onPause, onClear, deviceId }) => {
  const [filter, setFilter] = useState('');
  const [hideTlm, setHideTlm] = useState(false);
  const [hideStatus, setHideStatus] = useState(true);
  const [onlyProblems, setOnlyProblems] = useState(false);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return lines.filter((l) => {
      if (hideTlm && l.text.startsWith('$TLM')) return false;
      if (hideStatus && l.tag === 'STATUS') return false;
      if (onlyProblems && !['NOFRAME', 'BADCRC', 'LONG', 'UNKNOWN', 'SILENT'].some((t) => l.tag.startsWith(t)))
        return false;
      if (f && !`${l.dir} ${l.tag} ${l.text}`.toLowerCase().includes(f)) return false;
      return true;
    });
  }, [lines, filter, hideTlm, hideStatus, onlyProblems]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of lines) {
      const k = l.tag.split(' ')[0];
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [lines]);

  const download = () => {
    const text = [...lines]
      .reverse()
      .map((l) => `${l.at}\t${l.dir}\t${l.tag}\t${l.text}`)
      .join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deviceId}-uart-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input
          className="inline-edit"
          style={{ flex: '1 1 220px', minWidth: 160 }}
          placeholder="Lọc (vd: TLM, BADCRC, PINV=)…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="checkbox-label">
          <input type="checkbox" checked={hideTlm} onChange={(e) => setHideTlm(e.target.checked)} /> Ẩn $TLM
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={hideStatus} onChange={(e) => setHideStatus(e.target.checked)} /> Ẩn
          status
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />{' '}
          Chỉ dòng lỗi
        </label>
        <button className="btn btn-secondary btn-sm" onClick={() => onPause(!paused)}>
          {paused ? <Play size={14} /> : <Pause size={14} />}
          {paused ? 'Tiếp tục' : 'Tạm dừng'}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={download} disabled={lines.length === 0}>
          <Download size={14} /> .txt
        </button>
        <button className="btn btn-secondary btn-sm" onClick={onClear}>
          <Trash2 size={14} /> Xoá
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 12, marginBottom: 8 }}>
        {Object.entries(counts).map(([k, n]) => (
          <span key={k} title={TAG_HELP[k] ?? ''} style={{ color: TAG_COLOR[k] ?? '#374151' }}>
            {k}: <b>{n}</b>
          </span>
        ))}
        <span className="muted">
          · hiển thị {shown.length}/{lines.length}
          {paused ? ' · ĐANG TẠM DỪNG' : ''}
        </span>
      </div>

      <div
        style={{
          background: '#0f172a',
          color: '#e2e8f0',
          borderRadius: 8,
          padding: 10,
          height: 560,
          overflow: 'auto',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        {shown.length === 0 ? (
          <div style={{ color: '#94a3b8' }}>Chưa có dòng nào. Đợi thiết bị gửi, hoặc khởi động lại máy để xem $INFO / $CFG.</div>
        ) : (
          shown.slice(0, 1500).map((l) => (
            <div key={l.id} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              <span style={{ color: '#64748b' }}>{fmtTime(l.at)} </span>
              <span style={{ color: l.dir === 'TX' ? '#60a5fa' : l.dir === 'SYS' ? '#94a3b8' : '#a3e635' }}>
                {l.dir}{' '}
              </span>
              <span
                title={TAG_HELP[l.tag.split(' ')[0]] ?? ''}
                style={{ color: TAG_COLOR[l.tag.split(' ')[0]] ?? '#fbbf24', fontWeight: 600 }}
              >
                {l.tag.padEnd(7)}{' '}
              </span>
              <span>{l.text}</span>
              {l.text.length > 0 && (
                <span style={{ color: '#64748b' }}> ({l.text.length})</span>
              )}
            </div>
          ))
        )}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        RX = STM32 → ESP32, TX = ESP32 → STM32. Dòng DATA là khung hợp lệ đã lên /data (app/web thấy); các nhãn
        NOFRAME / BADCRC / LONG / UNKNOWN là dòng ESP32 nhận được nhưng không chuyển lên. Số trong ngoặc là độ dài
        dòng. /raw giới hạn 10 dòng/giây.
      </p>
    </div>
  );
};

export default RawLogPanel;
