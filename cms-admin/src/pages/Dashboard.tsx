import React, { useEffect, useState } from 'react';
import { getDashboard, getAnalytics } from '../services/api';
import {
  Cpu,
  Users,
  Activity,
  Zap,
  TrendingUp,
  Calendar,
} from 'lucide-react';

interface DashboardStats {
  totalDevices: number;
  totalUsers: number;
  activeUsers: number;
  todayTotalA: number;
  todayTotalA2: number;
  devicesAddedToday: number;
  devicesAddedThisWeek: number;
}

interface AnalyticsData {
  dailyTotals: Array<{
    date: string;
    totalA: number;
    totalA2: number;
    deviceCount: number;
  }>;
  summary: {
    totalA: number;
    totalA2: number;
    uniqueDevices: number;
    uniqueUsers: number;
    averageDailyA: number;
    averageDailyA2: number;
  };
}

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [dashboardRes, analyticsRes] = await Promise.all([
          getDashboard(),
          getAnalytics(),
        ]);
        setStats(dashboardRes.data);
        setAnalytics(analyticsRes.data);
      } catch (err: any) {
        setError(err.response?.data?.message || 'Failed to load dashboard');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  if (isLoading) {
    return <div className="loading">Loading dashboard...</div>;
  }

  if (error) {
    return <div className="error-state">{error}</div>;
  }

  return (
    <div className="page dashboard-page">
      <header className="page-header">
        <h1>Dashboard</h1>
        <p>Overview of your inverter system</p>
      </header>

      {/* Stats Grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue">
            <Cpu size={24} />
          </div>
          <div className="stat-content">
            <span className="stat-value">{stats?.totalDevices || 0}</span>
            <span className="stat-label">Total Devices</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon green">
            <Users size={24} />
          </div>
          <div className="stat-content">
            <span className="stat-value">{stats?.totalUsers || 0}</span>
            <span className="stat-label">Total Users</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon purple">
            <Activity size={24} />
          </div>
          <div className="stat-content">
            <span className="stat-value">{stats?.activeUsers || 0}</span>
            <span className="stat-label">Active Users</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon orange">
            <Zap size={24} />
          </div>
          <div className="stat-content">
            <span className="stat-value">{stats?.todayTotalA?.toFixed(2) || '0.00'}</span>
            <span className="stat-label">Today's Total A</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon teal">
            <TrendingUp size={24} />
          </div>
          <div className="stat-content">
            <span className="stat-value">{stats?.todayTotalA2?.toFixed(2) || '0.00'}</span>
            <span className="stat-label">Today's Total A2</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon pink">
            <Calendar size={24} />
          </div>
          <div className="stat-content">
            <span className="stat-value">{stats?.devicesAddedThisWeek || 0}</span>
            <span className="stat-label">Devices This Week</span>
          </div>
        </div>
      </div>

      {/* Analytics Summary */}
      {analytics && (
        <div className="analytics-section">
          <h2>30-Day Analytics</h2>
          <div className="analytics-summary">
            <div className="summary-item">
              <span className="summary-label">Total A (30 days)</span>
              <span className="summary-value">{analytics.summary.totalA.toFixed(2)}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Total A2 (30 days)</span>
              <span className="summary-value">{analytics.summary.totalA2.toFixed(2)}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Avg Daily A</span>
              <span className="summary-value">{analytics.summary.averageDailyA.toFixed(2)}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Avg Daily A2</span>
              <span className="summary-value">{analytics.summary.averageDailyA2.toFixed(2)}</span>
            </div>
          </div>

          {/* Daily Totals Table */}
          <div className="table-container">
            <h3>Daily Totals (Last 30 Days)</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Total A</th>
                  <th>Total A2</th>
                  <th>Devices</th>
                </tr>
              </thead>
              <tbody>
                {analytics.dailyTotals.slice(-10).reverse().map((day) => (
                  <tr key={day.date}>
                    <td>{day.date}</td>
                    <td>{day.totalA.toFixed(2)}</td>
                    <td>{day.totalA2.toFixed(2)}</td>
                    <td>{day.deviceCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
