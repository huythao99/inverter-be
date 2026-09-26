import { useEffect, useMemo, useRef, useState } from 'react';
import type { MqttClient } from 'mqtt';
import { Terminal, Play, Square, Download, Trash2, Pause } from 'lucide-react';
import { setUartDebug } from '../services/api';

// UART diagnostics (ESP32 cmd/uart-debug). The device streams every raw line
// it receives from the STM32 on inverter/{uid}/{id}/debug/uart:
//   {"debug":"on","minutes":5,"fw":"1.0.19","baud":9600,"expected_fields":12}
//   {"n":1,"k":"a|r|l|c","t":"*|n|r|0|?","len":63,"f":"<raw line>","dropped":0}
//   {"debug":"off","lines":312,"dropped":0}
// k: a = accepted (published on /data), r = rejected, l = too long,
//    c = debug line held to be merged (STM32 test build compatibility).

type Kind = 'a' | 'r' | 'l' | 'c';
interface UartLine {
  at: number;
  n: number;
  k: Kind;
  t: string;
  len: number;
  f: string;
  dropped?: number;
}

const KIND_LABEL: Record<Kind, string> = {
  a: 'Hợp lệ',
  r: 'Bị loại',
  l: 'Quá dài',
  c: 'Gộp',
};
const TERM_LABEL: Record<string, string> = { '*': '*', n: '\\n', r: '\\r', '0': '\\0', '?': '—' };
const MAX_LINES = 1000;
// No "debug on" marker within this long after the command -> device didn't answer.
const START_TIMEOUT_MS = 20000;

interface Props {
  deviceDbId: string;
  userId: string;
  deviceId: string;
  client: MqttClient | null;
  isConnected: boolean;
}

type State = 'off' | 'starting' | 'on';

export default function UartDebugPanel({ deviceDbId, userId, deviceId, client, isConnected }: Props) {
  const topic = `inverter/${userId}/${deviceId}/debug/uart`;
  const [minutes, setMinutes] = useState(5);
  const [state, setState] = useState<State>('off');
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [info, setInfo] = useState<{ fw?: string; baud?: number; expected?: number } | null>(null);
  const [lines, setLines] = useState<UartLine[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | Kind>('all');
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const startTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  pausedRef.current = paused;

  // Subscribe to the debug topic while this panel exists (lines keep
  // arriving even when another tab is shown).
  useEffect(() => {
    if (!client || !isConnected) return;
    client.subscribe(topic, { qos: 0 });

    const onMessage = (t: string, payload: Uint8Array) => {
      if (t !== topic) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(new TextDecoder().decode(payload));
      } catch {
        return;
      }
      if (msg.debug === 'on') {
        if (startTimer.current) clearTimeout(startTimer.current);
        const mins = Number(msg.minutes) || 0;
        setState('on');
        setEndsAt(Date.now() + mins * 60000);
        setInfo({
          fw: msg.fw as string | undefined,
          baud: msg.baud as number | undefined,
          expected: msg.expected_fields as number | undefined,
        });
        setSummary(null);
        setNotice(null);
        return;
      }
      if (msg.debug === 'off') {
        setState('off');
        setEndsAt(null);
        setSummary(`Đã tắt: ${msg.lines ?? 0} dòng, ${msg.dropped ?? 0} dòng bị bỏ (vượt 10 dòng/giây).`);
        return;
      }
      if (typeof msg.n !== 'number' || pausedRef.current) return;
      const line: UartLine = {
        at: Date.now(),
        n: msg.n,
        k: (['a', 'r', 'l', 'c'].includes(msg.k as string) ? msg.k : 'r') as Kind,
        t: String(msg.t ?? '?'),
        len: Number(msg.len) || 0,
        f: String(msg.f ?? ''),
        dropped: typeof msg.dropped === 'number' ? msg.dropped : undefined,
      };
      setLines((prev) => {
        const next = prev.length >= MAX_LINES ? prev.slice(prev.length - MAX_LINES + 1) : prev.slice();
        next.push(line);
        return next;
      });
    };

    client.on('message', onMessage);
    return () => {
      client.removeListener('message', onMessage);
      client.unsubscribe(topic);
    };
  }, [client, isConnected, topic]);

  // Countdown while active.
  useEffect(() => {
    if (state !== 'on') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state]);

  // Keep the newest line in view (unless the user scrolled up).
  useEffect(() => {
    const el = listRef.current;
    if (!el || paused) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [lines, paused]);

  useEffect(() => () => {
    if (startTimer.current) clearTimeout(startTimer.current);
  }, []);

  const start = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await setUartDebug(deviceDbId, minutes);
      setState('starting');
      if (startTimer.current) clearTimeout(startTimer.current);
      startTimer.current = setTimeout(() => {
        setState((s) => {
          if (s === 'starting') {
            setNotice({
              ok: false,
              text:
                'Thiết bị không phản hồi. Kiểm tra thiết bị đang online và chạy firmware có hỗ trợ chẩn đoán UART (từ 1.0.19).',
            });
            return 'off';
          }
          return s;
        });
      }, START_TIMEOUT_MS);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setNotice({ ok: false, text: e.response?.data?.message || 'Không gửi được lệnh bật chẩn đoán.' });
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await setUartDebug(deviceDbId, 0);
      if (startTimer.current) clearTimeout(startTimer.current);
      if (state === 'starting') setState('off');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setNotice({ ok: false, text: e.response?.data?.message || 'Không gửi được lệnh tắt.' });
    } finally {
      setBusy(false);
    }
  };

  const counts = useMemo(() => {
    const c = { a: 0, r: 0, l: 0, c: 0 } as Record<Kind, number>;
    for (const l of lines) c[l.k]++;
    return c;
  }, [lines]);

  const shown = filter === 'all' ? lines : lines.filter((l) => l.k === filter);
  const lastDropped = lines.length ? lines[lines.length - 1].dropped : undefined;

  const download = () => {
    const header = `# ${deviceId} UART debug ${new Date().toISOString()}\n# time\tn\tkind\tterm\tlen\tline\n`;
    const body = lines
      .map((l) => `${new Date(l.at).toISOString()}\t${l.n}\t${l.k}\t${l.t}\t${l.len}\t${l.f}`)
      .join('\n');
    const blob = new Blob([header + body + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deviceId}-uart-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const remaining = endsAt ? Math.max(0, Math.round((endsAt - now) / 1000)) : 0;

  return (
    <div className="content-section">
      <div className="stm-card">
        <div className="stm-card-header">
          <h3>
            <Terminal size={18} /> Chẩn đoán UART (STM32 → ESP32)
          </h3>
          <span className={`uart-state uart-state-${state}`}>
            {state === 'on'
              ? `Đang ghi · còn ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
              : state === 'starting'
                ? 'Đang chờ thiết bị…'
                : 'Tắt'}
          </span>
        </div>

        <p className="uart-help">
          Thiết bị gửi lên mọi dòng thô nhận từ STM32 (cả dòng hợp lệ lẫn bị loại) trong thời gian đã chọn, rồi tự
          tắt. Dùng khi thiết bị online nhưng không có dữ liệu (log <code>UART_STATS</code> có <code>ok=0</code>).
        </p>

        <div className="uart-controls">
          <label>
            Thời gian
            <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} disabled={state !== 'off'}>
              {[1, 2, 5, 10, 30].map((m) => (
                <option key={m} value={m}>
                  {m} phút
                </option>
              ))}
            </select>
          </label>
          {state === 'off' ? (
            <button className="btn btn-primary" onClick={start} disabled={busy || !isConnected}>
              <Play size={16} /> Bắt đầu
            </button>
          ) : (
            <button className="btn btn-danger" onClick={stop} disabled={busy}>
              <Square size={16} /> Dừng
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => setPaused((p) => !p)} disabled={!lines.length && !paused}>
            <Pause size={16} /> {paused ? 'Tiếp tục hiển thị' : 'Tạm dừng hiển thị'}
          </button>
          <button className="btn btn-secondary" onClick={download} disabled={!lines.length}>
            <Download size={16} /> Tải .txt
          </button>
          <button className="btn btn-secondary" onClick={() => setLines([])} disabled={!lines.length}>
            <Trash2 size={16} /> Xoá
          </button>
        </div>

        {!isConnected && <p className="stm-note warn">Chưa kết nối MQTT – không nhận được dữ liệu chẩn đoán.</p>}
        {notice && <p className={`stm-note ${notice.ok ? '' : 'error'}`}>{notice.text}</p>}
        {summary && <p className="stm-note">{summary}</p>}
        {info && (
          <p className="uart-info">
            Firmware ESP32 <b>{info.fw ?? '?'}</b> · baud {info.baud ?? '?'} · số trường đang chờ{' '}
            <b>{info.expected ? info.expected : 'chưa xác định (chưa nhận được khung hợp lệ nào)'}</b>
          </p>
        )}

        <div className="uart-filters">
          {(['all', 'a', 'r', 'l', 'c'] as const).map((k) => (
            <button
              key={k}
              className={`uart-chip ${filter === k ? 'active' : ''} ${k !== 'all' ? `k-${k}` : ''}`}
              onClick={() => setFilter(k)}
            >
              {k === 'all' ? `Tất cả (${lines.length})` : `${KIND_LABEL[k]} (${counts[k]})`}
            </button>
          ))}
          {lastDropped ? <span className="uart-dropped">{lastDropped} dòng bị bỏ</span> : null}
        </div>

        <div className="uart-log" ref={listRef}>
          {shown.length === 0 ? (
            <div className="uart-empty">
              {state === 'off' ? 'Bấm "Bắt đầu" để ghi các dòng UART.' : 'Đang chờ dữ liệu từ thiết bị…'}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Giờ</th>
                  <th>#</th>
                  <th>Loại</th>
                  <th>Kết thúc</th>
                  <th>Dài</th>
                  <th>Nội dung</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={`${l.at}-${l.n}`}>
                    <td className="mono">{new Date(l.at).toLocaleTimeString('vi-VN')}</td>
                    <td className="mono">{l.n}</td>
                    <td>
                      <span className={`uart-kind k-${l.k}`}>{KIND_LABEL[l.k]}</span>
                    </td>
                    <td className="mono">{TERM_LABEL[l.t] ?? l.t}</td>
                    <td className="mono">{l.len}</td>
                    <td className="mono uart-line">{l.f}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
