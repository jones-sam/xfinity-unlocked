import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowRightLeft,
  Eye,
  EyeOff,
  Gauge,
  KeyRound,
  Laptop,
  RefreshCw,
  Shield,
  Wifi,
} from 'lucide-react';
import { api } from '../api';
import {
  Badge,
  Button,
  Card,
  CopyButton,
  EmptyState,
  InlineError,
  KeyValueList,
  Skeleton,
  StatCard,
  StatusDot,
  cx,
  useAsync,
} from '../components/ui';
import type { Section } from '../types';

function NetworkSection({ section }: { section?: Section }) {
  if (!section) {
    return <EmptyState title="No data" message="This section was not present in the router response." />;
  }
  return <KeyValueList rows={section.rows} />;
}

export function OverviewPage() {
  const overview = useAsync(() => api.overview(), []);
  const devices = useAsync(() => api.devices(), []);
  const [showPasskey, setShowPasskey] = useState(false);

  const wifiClients = useMemo(() => {
    if (!overview.data) return 0;
    return overview.data.wifiBands.reduce((total, band) => total + (Number(band.clients) || 0), 0);
  }, [overview.data]);

  const internet = overview.data?.rogers?.rows.find((row) => /^internet/i.test(row.label))?.value;
  const online = devices.data?.summary.online ?? 0;
  const total = devices.data?.summary.total ?? 0;

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">At a glance</span>
          <h2>A live view of your network</h2>
          <p>Everything the gateway reports, without the portal chrome.</p>
        </div>
        <Button
          variant="secondary"
          icon={<RefreshCw size={15} />}
          loading={overview.loading || devices.loading}
          onClick={() => {
            void overview.reload(true);
            void devices.reload(true);
          }}
        >
          Refresh
        </Button>
      </div>

      {overview.error && <InlineError message={overview.error} onRetry={() => void overview.reload()} />}

      {overview.loading && !overview.data ? (
        <div className="grid grid-3">
          {[0, 1, 2].map((index) => (
            <Card key={index}>
              <Skeleton lines={5} />
            </Card>
          ))}
        </div>
      ) : (
        overview.data && (
          <>
            <div className="overview-hero">
              <div className="hero-wifi">
                <div className="hero-wifi-top">
                  <span className="hero-icon">
                    <Wifi size={22} />
                  </span>
                  <div>
                    <span className="eyebrow">Primary Wi-Fi network</span>
                    <h3>{overview.data.ssid || 'Unnamed network'}</h3>
                  </div>
                  <Badge tone="good" dot>
                    Broadcasting
                  </Badge>
                </div>

                <div className="passkey-row">
                  <span className="passkey-label">
                    <KeyRound size={15} /> Wi-Fi password
                  </span>
                  <div className="passkey-value">
                    <code>{showPasskey ? overview.data.passkey || 'Not exposed' : '••••••••'}</code>
                    {overview.data.passkey && (
                      <>
                        <button
                          type="button"
                          className="ghost-icon"
                          onClick={() => setShowPasskey((value) => !value)}
                          aria-label={showPasskey ? 'Hide Wi-Fi password' : 'Show Wi-Fi password'}
                        >
                          {showPasskey ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                        <CopyButton value={overview.data.passkey} label="Copy" />
                      </>
                    )}
                  </div>
                </div>

                <div className="hero-actions">
                  <Link to="/port-forwarding" className="hero-link">
                    <ArrowRightLeft size={16} />
                    Manage port forwarding
                    <ArrowRight size={14} />
                  </Link>
                  <Link to="/wifi" className="hero-link">
                    <Wifi size={16} />
                    Wi-Fi settings
                    <ArrowRight size={14} />
                  </Link>
                </div>
              </div>

              <div className="hero-stats">
                <StatCard
                  label="Devices online"
                  value={
                    <>
                      {online}
                      <span className="stat-suffix">/ {total}</span>
                    </>
                  }
                  hint={`${devices.data?.summary.ethernet ?? 0} wired · ${(devices.data?.summary.wifi2 ?? 0) + (devices.data?.summary.wifi5 ?? 0) + (devices.data?.summary.wifi6 ?? 0)} wireless`}
                  icon={<Laptop size={18} />}
                  tone="good"
                />
                <StatCard
                  label="Wi-Fi clients"
                  value={wifiClients}
                  hint={overview.data.wifiBands.map((band) => `${band.band}: ${band.clients || 0}`).join(' · ')}
                  icon={<Wifi size={18} />}
                  tone="violet"
                />
                <StatCard
                  label="Firewall"
                  value={overview.data.firewallLevel || 'Unknown'}
                  hint="IPv4 security level"
                  icon={<Shield size={18} />}
                  tone={/high/i.test(overview.data.firewallLevel) ? 'good' : /low|none/i.test(overview.data.firewallLevel) ? 'warn' : 'default'}
                />
                <StatCard
                  label="Internet"
                  value={internet || 'Unknown'}
                  hint={overview.data.wan?.rows.find((row) => /WAN IP Address \(IPv4\)/i.test(row.label))?.value || 'WAN address unavailable'}
                  icon={<Gauge size={18} />}
                  tone={/active|online|up/i.test(internet || '') ? 'good' : 'default'}
                />
              </div>
            </div>

            <div className="band-grid">
              {overview.data.wifiBands.map((band) => (
                <div className="band-card" key={`${band.band}-${band.ssid}`}>
                  <div className="band-card-head">
                    <span className="band-chip">{band.band || 'Wi-Fi'}</span>
                    <StatusDot on={/active|up|enabled/i.test(band.status)} label={band.status || 'Unknown'} />
                  </div>
                  <h3>{band.ssid || overview.data?.ssid}</h3>
                  <div className="band-meta">
                    <span>{band.security || 'Security unknown'}</span>
                    <span>{band.protocols}</span>
                  </div>
                  <div className="band-foot">
                    <span>
                      <strong>{band.clients || 0}</strong> clients
                    </span>
                    {band.editId && band.editId !== '17' ? (
                      <Link to={`/wifi?edit=${band.editId}`} className="text-link">
                        Edit
                        <ArrowRight size={13} />
                      </Link>
                    ) : (
                      <span className="muted small">Read-only</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {overview.data.home.length > 0 && (
              <div className="home-status-row">
                {overview.data.home.map((item) => (
                  <div className={cx('home-status', item.on && 'is-on')} key={item.label}>
                    <span className="home-status-dot" />
                    <span>{item.label}</span>
                    <strong>{item.on ? 'On' : 'Off'}</strong>
                  </div>
                ))}
                <div className="home-status devices-status">
                  <span className="home-status-dot" />
                  <span>Connected devices</span>
                  <strong>{online} online</strong>
                </div>
              </div>
            )}

            <div className="network-grid">
              <Card title="Local network" subtitle="LAN addressing and DHCP">
                <NetworkSection section={overview.data.local} />
              </Card>
              <Card title="WAN" subtitle="Uplink addressing and status">
                <NetworkSection section={overview.data.wan} />
              </Card>
              <Card title="Rogers network" subtitle="ISP connection details">
                <NetworkSection section={overview.data.rogers} />
              </Card>
            </div>

            {overview.data.quickDevices.length > 0 && (
              <Card title="Recently active" subtitle="Devices the gateway lists on its landing page">
                <div className="chip-row">
                  {overview.data.quickDevices.map((name) => (
                    <Link to="/devices" className="device-chip" key={name}>
                      <Laptop size={14} />
                      {name}
                    </Link>
                  ))}
                </div>
              </Card>
            )}
          </>
        )
      )}

      {devices.error && !devices.data && <InlineError message={devices.error} onRetry={() => void devices.reload()} />}
    </div>
  );
}
