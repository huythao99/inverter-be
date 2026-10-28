import React, { useEffect, useState } from 'react';
import { getNewDevicesStats, type NewDevicesBucket } from '../services/api';
import Segmented from './Segmented';

// "Thiết bị mới": devices added per week (last 12) or month (last 12),
// stacked by product. Counts devices that are still registered (a deleted
// device no longer counts in the week it was added).

type Period = 'week' | 'month';

const SERIES: { key: 'inverter' | 'charger' | 'hybrid'; label: string; color: string }[] = [
  { key: 'inverter', label: 'Inverter hoà lưới', color: '#3b82f6' },
  { key: 'charger', label: 'Bộ sạc MPPT', color: '#22c55e' },
  { key: 'hybrid', label: 'Hybrid', color: '#a855f7' },
];

const nf = new Intl.NumberFormat('vi-VN');

const NewDevicesChart: React.FC = () => {
  const [period, setPeriod] = useState<Period>('week');
  const [buckets, setBuckets] = useState<NewDevicesBucket[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void getNewDevicesStats(period, 12)
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

  const max = Math.max(1, ...(buckets ?? []).map((b) => b.total));
  const sum = (buckets ?? []).reduce((s, b) => s + b.total, 0);
  const current = buckets?.[buckets.length - 1];
  const previous = buckets?.[buckets.length - 2];
  const unit = period === 'week' ? 'tuần' : 'tháng';

  return (
    <div className="ov-card ov-newdev">
      <div className="ov-newdev-head">
        <div>
          <h3 className="ov-card-title" style={{ margin: 0 }}>Thiết bị mới</h3>
          <p className="ov-muted ov-newdev-sub">
            {buckets
              ? `${nf.format(sum)} thiết bị trong 12 ${unit} · TB ${nf.format(Math.round((sum / buckets.length) * 10) / 10)}/${unit}`
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

      {current && (
        <div className="ov-newdev-now">
          <span>
            {unit === 'tuần' ? 'Tuần này' : 'Tháng này'}: <b>{nf.format(current.total)}</b>
          </span>
          {previous && (
            <span className="ov-muted">
              {unit === 'tuần' ? 'Tuần trước' : 'Tháng trước'}: {nf.format(previous.total)}
            </span>
          )}
        </div>
      )}

      {buckets && (
        <div className="ov-stack" role="img" aria-label={`Thiết bị mới theo ${unit}`}>
          {buckets.map((b, i) => (
            <div
              key={b.start}
              className={`ov-stack-col ${i === buckets.length - 1 ? 'current' : ''}`}
              title={`${period === 'week' ? 'Tuần từ ' : 'Tháng '}${b.label}\n${SERIES.map((s) => `${s.label}: ${b[s.key]}`).join('\n')}`}
            >
              <span className="ov-stack-total">{b.total > 0 ? nf.format(b.total) : ''}</span>
              <div className="ov-stack-bar" style={{ height: `${(b.total / max) * 100}%` }}>
                {SERIES.map((s) =>
                  b[s.key] > 0 ? (
                    <span key={s.key} style={{ flexGrow: b[s.key], background: s.color }} />
                  ) : null,
                )}
              </div>
              <span className="ov-chart-label">{b.label}</span>
            </div>
          ))}
        </div>
      )}

      <div className="ov-legend">
        {SERIES.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} /> {s.label}
          </span>
        ))}
        <span className="ov-muted">{period === 'week' ? 'Tuần bắt đầu thứ Hai (GMT+7)' : 'Theo tháng (GMT+7)'}</span>
      </div>
    </div>
  );
};

export default NewDevicesChart;
