import React from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard,
  Cpu,
  ShieldOff,
  HardDriveUpload,
  Settings,
  LogOut,
  Menu,
  X,
  HeartPulse,
} from 'lucide-react';

const Layout: React.FC = () => {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const { pathname } = useLocation();

  // One entry per section; the device type (Inverter / Charger / Hybrid) and
  // the firmware page (ESP32 / STM32 / Beta / Rollout) are switches inside.
  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Tổng quan', match: ['/'] },
    { to: '/devices', icon: Cpu, label: 'Thiết bị', match: ['/devices', '/chargers', '/hybrids'] },
    { to: '/health', icon: HeartPulse, label: 'Sức khoẻ', match: ['/health'] },
    {
      to: '/esp-firmware',
      icon: HardDriveUpload,
      label: 'Firmware',
      match: ['/esp-firmware', '/stm-firmware', '/beta-firmware', '/rollout'],
    },
    { to: '/blacklist', icon: ShieldOff, label: 'Danh sách chặn', match: ['/blacklist'] },
    { to: '/settings', icon: Settings, label: 'Cài đặt', match: ['/settings'] },
  ];
  const isActive = (match: string[]) =>
    match.some((m) => (m === '/' ? pathname === '/' : pathname.startsWith(m)));

  return (
    <div className="app-layout">
      {/* Mobile menu button */}
      <button
        className="mobile-menu-btn"
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h1>CMS Admin</h1>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={`nav-item ${isActive(item.match) ? 'active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <item.icon size={20} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="admin-info">
            <span className="admin-name">{admin?.username}</span>
            <span className="admin-role">{admin?.role}</span>
          </div>
          <button className="logout-btn" onClick={handleLogout}>
            <LogOut size={20} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="main-content">
        <Outlet />
      </main>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}
    </div>
  );
};

export default Layout;
