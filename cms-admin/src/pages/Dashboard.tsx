import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getDashboard,
  getAnalytics,
  getHealthSummary,
  getChargerDashboard,
  getHybridDashboard,
  type HealthSummary,
  type CmsHybridDashboard,
  type HealthIssue,
} from '../services/api';
import { Cpu, BatteryCharging, Shuffle, Wifi, AlertTriangle, Users, PlusCircle, RefreshCw, Zap } from 'lucide-react';
import { ISSUE_META, ISSUE_ORDER } from '../components/health-meta';
import NewDevicesChart from '../components/NewDevicesChart';

// "Tổng quan": what an operator needs at a glance — how many devices, how
// many are online, which need attention, customers, and the inverters'
// energy. Each block comes from its own endpoint; a failing one only hides
// its block.

interface DashboardStats {
  totalDevices: number;
  totalUsers: number;
  newUsersThisWeek?: number;
  todayTotalA: number; // kWh discharged (inverters, today GMT+7)
  todayTotalA2: number; // kWh taken from the grid
  devicesAddedToday: number;
  devicesAddedThisWeek: number;
}

interface AnalyticsData {
  dailyTotals: Array<{ date: string; totalA: number; totalA2: number; deviceCount: number }>;
  summary: { totalA: number; totalA2: number; averageDailyA: number; averageDailyA2: number };
}

interface ChargerDashboard {
  totalDevices: number;
  onlineDevices: number;
  offlineDevices: number;
  devicesAddedToday: number;
  devicesAddedThisWeek: number;
}

interface Data {
  stats?: DashboardStats;
  analytics?: AnalyticsData;
  health?: HealthSummary;
  charger?: ChargerDashboard;
  hybrid?: CmsHybridDashboard;
}

const nf = new Intl.NumberFormat('vi-VN');
const kwh = (v: number | undefined) =>
  v === undefined || !Number.isFinite(v)
    ? '—'
    : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: v >= 100 ? 0 : 1 }).format(v);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

function Kpi({
  icon,
  tone,
  value,
  label,
  sub,
  to,
}: {
  icon: React.ReactNode;
  tone: string;
  value: React.ReactNode;
  label: string;
  sub?: React.ReactNode;
  to?: string;
}) {
  const body = (
    <>
      <div className={`stat-icon ${tone}`}>{icon}</div>
      <div className="stat-content">
        <span className="stat-value">{value}</span>
        <span className="stat-label">{label}</span>
        {sub && <span className="ov-kpi-sub">{sub}</span>}
      </div>
    </>
  );
  return to ? (
    <Link to={to} className="stat-card ov-kpi-link">
      {body}
    </Link>
  ) : (
    <div className="stat-card">{body}</div>
  );
}

function ProductCard({
  icon,
  name,
  to,
  total,
  online,
  rows,
}: {
  icon: React.ReactNode;
  name: string;
  to: string;
  total?: number;
  online?: number;
  rows: { label: string; value: React.ReactNode; tone?: 'bad' | 'warn' }[];
}) {
  const known = total !== undefined && online !== undefined;
  const p = known ? pct(online!, total!) : 0;
  return (
    <Link to={to} className="ov-card ov-product">
      <div className="ov-product-head">
        <span className="ov-product-icon">{icon}</span>
        <span className="ov-product-name">{name}</span>
        <span className="ov-product-total">{known ? nf.format(total!) : '—'}</span>
      </div>
      <div className="ov-bar" title={known ? `${online} online / ${total}` : ''}>
        <span style={{ width: `${p}%` }} />
      </div>
      <div className="ov-product-online">
        {known ? (
          <>
            <b>{nf.format(online!)}</b> online · {nf.format(total! - online!)} offline
            <span className="ov-muted"> ({p}%)</span>
          </>
        ) : (
          <span className="ov-muted">Không tải được</span>
        )}
      </div>
      <dl className="ov-product-rows">
        {rows.map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd className={r.tone ? `ov-${r.tone}` : ''}>{r.value}</dd>
          </div>
        ))}
      </dl>
    </Link>
  );
}

/** 30 days, two bars per day: discharged (inverter output) and from the grid. */
function EnergyBars({ days }: { days: AnalyticsData['dailyTotals'] }) {
  const max = Math.max(1, ...days.map((d) => Math.max(d.totalA, d.totalA2)));
  return (
    <div className="ov-chart" role="img" aria-label="Sản lượng 30 ngày">
      {days.map((d) => (
        <div
          key={d.date}
          className="ov-chart-day"
          title={`${d.date.slice(0, 10)}\nXả pin: ${kwh(d.totalA)} kWh\nLấy lưới: ${kwh(d.totalA2)} kWh\n${d.deviceCount} thiết bị`}
        >
          <div className="ov-chart-bars">
            <span className="a" style={{ height: `${(Math.max(0, d.totalA) / max) * 100}%` }} />
            <span className="b" style={{ height: `${(Math.max(0, d.totalA2) / max) * 100}%` }} />
          </div>
          <span className="ov-chart-label">{d.date.slice(8, 10)}</span>
        </div>
      ))}
    </div>
  );
}

const Dashboard: React.FC = () => {
  const [data, setData] = useState<Data>({});
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [at, setAt] = useState<Date | null>(null);

  // Bumped by the refresh button and every 60 s: re-fetches everything.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [s, a, h, c, y] = await Promise.allSettled([
        getDashboard(),
        getAnalytics(),
        getHealthSummary(),
        getChargerDashboard(),
        getHybridDashboard(),
      ]);
      if (!alive) return;
      const ok = <T,>(r: PromiseSettledResult<{ data: T }>) =>
        r.status === 'fulfilled' ? r.value.data : undefined;
      setData({
        stats: ok<DashboardStats>(s as PromiseSettledResult<{ data: DashboardStats }>),
        analytics: ok<AnalyticsData>(a as PromiseSettledResult<{ data: AnalyticsData }>),
        health: ok<HealthSummary>(h),
        charger: ok<ChargerDashboard>(c as PromiseSettledResult<{ data: ChargerDashboard }>),
        hybrid: ok<CmsHybridDashboard>(y),
      });
      setAt(new Date());
      setIsLoading(false);
      setRefreshing(false);
    })();
    const t = setTimeout(() => setTick((x) => x + 1), 60_000);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [tick]);

  const { stats, analytics, health, charger, hybrid } = data;

  // Inverter counts: the health service knows who is online.
  const inv = {
    total: health?.total ?? stats?.totalDevices,
    online: health?.online,
  };
  const totals = useMemo(() => {
    const parts = [inv.total, charger?.totalDevices, hybrid?.totalDevices];
    const onl = [inv.online, charger?.onlineDevices, hybrid?.onlineDevices];
    const sum = (xs: (number | undefined)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);
    return {
      devices: sum(parts),
      online: sum(onl),
      attention: (health?.withProblems ?? 0) + (hybrid?.faultDevices ?? 0),
      newWeek: sum([stats?.devicesAddedThisWeek, charger?.devicesAddedThisWeek, hybrid?.devicesAddedThisWeek]),
      newToday: sum([stats?.devicesAddedToday, charger?.devicesAddedToday, hybrid?.devicesAddedToday]),
    };
  }, [inv.total, inv.online, charger, hybrid, health, stats]);

  const topIssues = useMemo(() => {
    if (!health) return [];
    return ISSUE_ORDER.filter((i) => i !== 'offline' && (health.issues[i] ?? 0) > 0)
      .map((i) => ({ issue: i as HealthIssue, count: health.issues[i] }))
      .sort((x, y) => y.count - x.count);
  }, [health]);

  const days = useMemo(() => (analytics?.dailyTotals ?? []).slice(-30), [analytics]);

  if (isLoading) return <div className="loading">Đang tải…</div>;

  const fwMax = Math.max(1, ...(health?.firmware ?? []).map((f) => f.count));

  return (
    <div className="page dashboard-page">
      <header className="page-header ov-header">
        <div>
          <h1>Tổng quan</h1>
          <p>
            Tình trạng toàn hệ thống
            {at && <span className="ov-muted"> · cập nhật {at.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>}
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => {
            setRefreshing(true);
            setTick((x) => x + 1);
          }}
          disabled={refreshing}>
          <RefreshCw size={16} className={refreshing ? 'spin' : ''} /> Làm mới
        </button>
      </header>

      <div className="stats-grid">
        <Kpi icon={<Cpu size={24} />} tone="blue" value={nf.format(totals.devices)} label="Thiết bị" sub="Inverter + bộ sạc + hybrid" />
        <Kpi
          icon={<Wifi size={24} />}
          tone="green"
          value={nf.format(totals.online)}
          label="Đang online"
          sub={`${pct(totals.online, totals.devices)}% thiết bị`}
        />
        <Kpi
          icon={<AlertTriangle size={24} />}
          tone={totals.attention > 0 ? 'red' : 'teal'}
          value={nf.format(totals.attention)}
          label="Cần xử lý"
          sub="Inverter có vấn đề + hybrid đang lỗi"
          to="/health"
        />
        <Kpi
          icon={<Users size={24} />}
          tone="purple"
          value={stats ? nf.format(stats.totalUsers) : '—'}
          label="Khách hàng"
          sub={stats?.newUsersThisWeek !== undefined ? `+${nf.format(stats.newUsersThisWeek)} trong 7 ngày` : 'Người có thiết bị'}
        />
        <Kpi
          icon={<PlusCircle size={24} />}
          tone="orange"
          value={nf.format(totals.newWeek)}
          label="Thiết bị mới (7 ngày)"
          sub={`Hôm nay: ${nf.format(totals.newToday)}`}
        />
      </div>

      <h2 className="ov-section-title">Theo loại thiết bị</h2>
      <div className="ov-products">
        <ProductCard
          icon={<Cpu size={20} />}
          name="Inverter hoà lưới"
          to="/devices"
          total={inv.total}
          online={inv.online}
          rows={[
            { label: 'Có vấn đề', value: health ? nf.format(health.withProblems) : '—', tone: health?.withProblems ? 'bad' : undefined },
            { label: 'Firmware mới nhất', value: health?.newestFirmware ?? '—' },
            { label: 'Mới 7 ngày', value: stats ? nf.format(stats.devicesAddedThisWeek) : '—' },
          ]}
        />
        <ProductCard
          icon={<BatteryCharging size={20} />}
          name="Bộ sạc MPPT"
          to="/chargers"
          total={charger?.totalDevices}
          online={charger?.onlineDevices}
          rows={[
            { label: 'Mới 7 ngày', value: charger ? nf.format(charger.devicesAddedThisWeek) : '—' },
            { label: 'Mới hôm nay', value: charger ? nf.format(charger.devicesAddedToday) : '—' },
          ]}
        />
        <ProductCard
          icon={<Shuffle size={20} />}
          name="Inverter hybrid"
          to="/hybrids"
          total={hybrid?.totalDevices}
          online={hybrid?.onlineDevices}
          rows={[
            { label: 'Đang lỗi', value: hybrid ? nf.format(hybrid.faultDevices) : '—', tone: hybrid?.faultDevices ? 'bad' : undefined },
            { label: 'Cài trên máy (LOCAL)', value: hybrid ? nf.format(hybrid.localSourceDevices) : '—', tone: hybrid?.localSourceDevices ? 'warn' : undefined },
            { label: 'Mới 7 ngày', value: hybrid ? nf.format(hybrid.devicesAddedThisWeek) : '—' },
          ]}
        />
      </div>

      <NewDevicesChart />

      {(stats || analytics) && (
        <>
          <h2 className="ov-section-title">Sản lượng inverter hoà lưới</h2>
          <div className="ov-card ov-energy">
            <div className="ov-energy-nums">
              <div>
                <span className="ov-muted">Hôm nay · xả pin (phát)</span>
                <b className="ov-a">{kwh(stats?.todayTotalA)} kWh</b>
              </div>
              <div>
                <span className="ov-muted">Hôm nay · lấy lưới</span>
                <b className="ov-b">{kwh(stats?.todayTotalA2)} kWh</b>
              </div>
              <div>
                <span className="ov-muted">30 ngày · xả pin</span>
                <b>{kwh(analytics?.summary.totalA)} kWh</b>
                <small className="ov-muted">TB {kwh(analytics?.summary.averageDailyA)} kWh/ngày</small>
              </div>
              <div>
                <span className="ov-muted">30 ngày · lấy lưới</span>
                <b>{kwh(analytics?.summary.totalA2)} kWh</b>
                <small className="ov-muted">TB {kwh(analytics?.summary.averageDailyA2)} kWh/ngày</small>
              </div>
            </div>
            {days.length > 0 && (
              <>
                <EnergyBars days={days} />
                <div className="ov-legend">
                  <span><i className="a" /> Xả pin (inverter phát)</span>
                  <span><i className="b" /> Lấy từ lưới</span>
                  <span className="ov-muted">Tổng mọi inverter, theo ngày (GMT+7)</span>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {health && (
        <div className="ov-two">
          <div className="ov-card">
            <h3 className="ov-card-title">
              <Zap size={16} /> Firmware inverter
            </h3>
            {health.firmware.slice(0, 8).map((f) => (
              <div key={f.version} className="ov-row">
                <span className="ov-row-label">
                  {f.version}
                  {f.version === health.newestFirmware && <span className="ov-tag">mới nhất</span>}
                </span>
                <span className="ov-row-bar">
                  <span style={{ width: `${(f.count / fwMax) * 100}%` }} />
                </span>
                <span className="ov-row-val">{nf.format(f.count)}</span>
              </div>
            ))}
            {health.firmware.length === 0 && <p className="ov-muted">Chưa có dữ liệu</p>}
          </div>

          <div className="ov-card">
            <h3 className="ov-card-title">
              <AlertTriangle size={16} /> Vấn đề trên inverter
            </h3>
            {topIssues.length === 0 && <p className="ov-muted">Không có vấn đề nào</p>}
            {topIssues.map(({ issue, count }) => (
              <Link key={issue} to={`/health?issue=${issue}`} className="ov-row ov-row-link" title={ISSUE_META[issue].hint}>
                <span className={`ov-row-label ov-tone-${ISSUE_META[issue].tone}`}>{ISSUE_META[issue].label}</span>
                <span className="ov-row-val">{nf.format(count)}</span>
              </Link>
            ))}
            {health.resetReasons24h.length > 0 && (
              <>
                <h4 className="ov-subtitle">Khởi động lại trong 24 giờ</h4>
                {health.resetReasons24h.slice(0, 5).map((r) => (
                  <div key={r.reason} className="ov-row">
                    <span className="ov-row-label">{r.text}</span>
                    <span className="ov-row-val">{nf.format(r.count)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
