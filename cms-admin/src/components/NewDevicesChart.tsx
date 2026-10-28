import React, { useEffect, useState } from 'react';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { getNewDevicesStats, type NewDevicesBucket } from '../services/api';
import Segmented from './Segmented';

// "Thiết bị mới": trend of devices added per week (last 12) or month (last
// 12), and how much each period went up / down vs the one before (devices
// and %). Counts devices that are still registered (a deleted device no
// longer counts in the period it was added).

type Period = 'week' | 'month';
type Key = 'total' | 'inverter' | 'charger' | 'hybrid';

const SERIES: { key: Key; label: string; color: string }[] = [
  { key: 'total', label: 'Tổng', color: '#2563eb' },
  { key: 'inverter', label: 'Inverter hoà lưới', color: '#60a5fa' },
  { key: 'charger', label: 'Bộ sạc MPPT', color: '#22c55e' },
  { key: 'hybrid', label: 'Hybrid', color: '#a855f7' },
];

const nf = new Intl.NumberFormat('vi-VN');
const pf = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });

/** Change vs the previous period: devices and % (null % when it was 0). */
function change(cur: number, prev: number | undefined) {
  if (prev === undefined) return null;
  const diff = cur - prev;
  const pct = prev > 0 ? (diff / prev) * 100 : null;
  return { diff, pct };
}

function ChangeBadge({ cur, prev, big }: { cur: number; prev: number | undefined; big?: boolean }) {
  const c = change(cur, prev);
  if (!c) return <span className="nd-chg flat">—</span>;
  const tone = c.diff > 0 ? 'up' : c.diff < 0 ? 'down' : 'flat';
  const Icon = c.diff > 0 ? TrendingUp : c.diff < 0 ? TrendingDown : Minus;
  const sign = c.diff > 0 ? '+' : c.diff < 0 ? '−' : '';
  // Columns: whole %; the headline: 1 decimal.
  const fmt = big ? pf : nf;
  const pct =
    c.pct === null
      ? c.diff > 0
        ? 'mới'
        : '0%'
      : `${sign}${fmt.format(big ? Math.abs(c.pct) : Math.round(Math.abs(c.pct)))}%`;
  return (
    <span className={`nd-chg ${tone} ${big ? 'big' : ''}`}>
      {big && <Icon size={16} />}
      <b>{pct}</b>
      <span>
        {sign}
        {nf.format(Math.abs(c.diff))}
      </span>
    </span>
  );
}

const W = 1000;
const H = 220;
const PAD_Y = 16;

const NewDevicesChart: React.FC = () => {
  const [period, setPeriod] = useState<Period>('week');
  const [buckets, setBuckets] = useState<NewDevicesBucket[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState<Record<Key, boolean>>({
    total: true,
    inverter: false,
    charger: false,
    hybrid: false,
  });

  useEffect(() => {
    let alive = true;
    // One extra period: the first visible one needs a "previous" to compare.
    void getNewDevicesStats(period, 13)
      .then((r) => {
        if (!alive) return;
        setBuckets(r.data.buckets);
        setFailed(false);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [period]);

  const unit = period === 'week' ? 'tuần' : 'tháng';
  const all = buckets ?? [];
  const visible = all.slice(-12);
  const prevOf = (i: number) => all[all.length - visible.length + i - 1];
  const n = visible.length;
  const lines = SERIES.filter((s) => shown[s.key]);
  const max = Math.max(1, ...visible.flatMap((b) => lines.map((s) => b[s.key])));
  const x = (i: number) => ((i + 0.5) / Math.max(1, n)) * W; // column centres
  const y = (v: number) => H - PAD_Y - (v / max) * (H - 2 * PAD_Y);
  const pathOf = (k: Key) => visible.map((b, i) => `${i ? 'L' : 'M'}${x(i)},${y(b[k])}`).join(' ');

  const cur = visible[n - 1];
  const prev = visible[n - 2];
  const sum = visible.reduce((s, b) => s + b.total, 0);

  return (
    <div className="ov-card ov-newdev">
      <div className="ov-newdev-head">
        <div>
          <h3 className="ov-card-title" style={{ margin: 0 }}>Thiết bị mới</h3>
          <p className="ov-muted ov-newdev-sub">
            {buckets
              ? `${nf.format(sum)} thiết bị trong ${n} ${unit} · TB ${pf.format(n ? sum / n : 0)}/${unit}`
              : failed
                ? 'Không tải được'
                : 'Đang tải…'}
          </p>
        </div>
        <Segmented<Period>
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'week', label: 'Theo tuần' },
            { value: 'month', label: 'Theo tháng' },
          ]}
        />
      </div>

      {cur && (
        <div className="nd-now">
          <div>
            <span className="ov-muted">{period === 'week' ? 'Tuần này' : 'Tháng này'}</span>
            <b className="nd-now-val">{nf.format(cur.total)}</b>
          </div>
          <div>
            <span className="ov-muted">So với {period === 'week' ? 'tuần trước' : 'tháng trước'} ({prev ? nf.format(prev.total) : '—'})</span>
            <ChangeBadge cur={cur.total} prev={prev?.total} big />
          </div>
          <p className="ov-muted nd-note">
            {period === 'week' ? 'Tuần' : 'Tháng'} hiện tại chưa hết, nên thường thấp hơn kỳ trước.
          </p>
        </div>
      )}

      {n > 0 && (
        <>
          <div className="nd-chart">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
              {[0.25, 0.5, 0.75].map((f) => (
                <line key={f} x1={0} x2={W} y1={PAD_Y + f * (H - 2 * PAD_Y)} y2={PAD_Y + f * (H - 2 * PAD_Y)} className="nd-grid" />
              ))}
              {shown.total && (
                <path d={`${pathOf('total')} L${x(n - 1)},${H} L${x(0)},${H} Z`} className="nd-area" />
              )}
              {lines.map((s) => (
                <path
                  key={s.key}
                  d={pathOf(s.key)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={s.key === 'total' ? 3 : 2}
                  strokeDasharray={s.key === 'total' ? undefined : '6 4'}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            {/* Points + values as HTML so they keep their shape at any width. */}
            {visible.map((b, i) =>
              lines.map((s) => (
                <span
                  key={`${b.start}-${s.key}`}
                  className={`nd-dot ${s.key === 'total' ? 'main' : ''}`}
                  style={{ left: `${(x(i) / W) * 100}%`, top: `${(y(b[s.key]) / H) * 100}%`, borderColor: s.color }}
                  title={`${period === 'week' ? 'Tuần từ ' : 'Tháng '}${b.label} · ${s.label}: ${b[s.key]}`}
                >
                  {s.key === 'total' && <em>{nf.format(b.total)}</em>}
                </span>
              )),
            )}
          </div>

          <div className="nd-cols" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
            {visible.map((b, i) => (
              <div
                key={b.start}
                className={`nd-col ${i === n - 1 ? 'current' : ''}`}
                title={`${period === 'week' ? 'Tuần từ ' : 'Tháng '}${b.label}: ${b.total} thiết bị\nInverter ${b.inverter} · Bộ sạc ${b.charger} · Hybrid ${b.hybrid}`}
              >
                <span className="ov-chart-label">{b.label}</span>
                <ChangeBadge cur={b.total} prev={prevOf(i)?.total} />
              </div>
            ))}
          </div>
        </>
      )}

      <div className="ov-legend nd-legend">
        {SERIES.map((s) => (
          <label key={s.key}>
            <input
              type="checkbox"
              checked={shown[s.key]}
              onChange={(e) => setShown({ ...shown, [s.key]: e.target.checked })}
            />
            <i style={{ background: s.color }} /> {s.label}
          </label>
        ))}
        <span className="ov-muted">
          Mỗi cột: thay đổi so với {unit} trước (%, số thiết bị) ·{' '}
          {period === 'week' ? 'tuần bắt đầu thứ Hai' : 'theo tháng'} (GMT+7)
        </span>
      </div>
    </div>
  );
};

export default NewDevicesChart;
