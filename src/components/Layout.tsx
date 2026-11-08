import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Activity,
  ArrowRightLeft,
  Cpu,
  Gauge,
  LogOut,
  Menu,
  MonitorSmartphone,
  Router,
  ScrollText,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Wifi,
  X,
} from 'lucide-react';
import { useAuth } from '../auth';
import { cx } from './ui';

const NAV_GROUPS = [
  {
    label: 'Network',
    items: [
      { to: '/', label: 'Overview', icon: Gauge, end: true },
      { to: '/devices', label: 'Connected devices', icon: MonitorSmartphone },
      { to: '/wifi', label: 'Wi-Fi', icon: Wifi },
    ],
  },
  {
    label: 'Security',
    items: [
      { to: '/port-forwarding', label: 'Port forwarding', icon: ArrowRightLeft },
      { to: '/firewall', label: 'Firewall', icon: Shield },
      { to: '/parental', label: 'Parental controls', icon: ShieldCheck },
    ],
  },
  {
    label: 'Router',
    items: [
      { to: '/advanced', label: 'Advanced', icon: SlidersHorizontal },
      { to: '/diagnostics', label: 'Diagnostics', icon: Activity },
      { to: '/logs', label: 'Logs', icon: ScrollText },
      { to: '/system', label: 'System', icon: Cpu },
    ],
  },
];

const TITLES: Record<string, string> = {
  '/': 'Overview',
  '/devices': 'Connected devices',
  '/wifi': 'Wi-Fi',
  '/port-forwarding': 'Port forwarding',
  '/firewall': 'Firewall',
  '/parental': 'Parental controls',
  '/advanced': 'Advanced network',
  '/diagnostics': 'Diagnostics',
  '/logs': 'Logs',
  '/system': 'System',
};

export function Layout() {
  const { session, signOut } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const title = TITLES[location.pathname] || 'Xfinity Unlocked';

  return (
    <div className="app-shell">
      <button
        type="button"
        className={cx('sidebar-scrim', open && 'is-visible')}
        onClick={() => setOpen(false)}
        aria-label="Close navigation"
      />
      <aside className={cx('sidebar', open && 'is-open')}>
        <div className="brand">
          <div className="brand-mark">
            <Router size={22} />
          </div>
          <div className="brand-copy">
            <strong>Xfinity Unlocked</strong>
            <span>Local router console</span>
          </div>
          <button
            type="button"
            className="icon-button sidebar-close"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="nav">
          {NAV_GROUPS.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-label">{group.label}</span>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => cx('nav-item', isActive && 'is-active')}
                  >
                    <Icon size={17} />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="connection-card">
            <div className="connection-top">
              <span className="pulse-dot" />
              <strong>Connected</strong>
            </div>
            <div className="connection-meta">
              <span>{session?.gateway}</span>
              <span>Signed in as {session?.username}</span>
            </div>
          </div>
          <button type="button" className="signout" onClick={() => void signOut()}>
            <LogOut size={16} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="icon-button menu-button"
              onClick={() => setOpen(true)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            <div>
              <span className="topbar-eyebrow">Router console</span>
              <h1>{title}</h1>
            </div>
          </div>
          <div className="topbar-right">
            <span className="gateway-pill">
              <span className="pulse-dot" />
              {session?.gateway}
            </span>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
