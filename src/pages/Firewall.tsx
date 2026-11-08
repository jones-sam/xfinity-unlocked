import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Shield, ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react';
import { api, errorMessage } from '../api';
import {
  Badge,
  Button,
  Card,
  InlineError,
  Skeleton,
  Toggle,
  cx,
  useAsync,
  useToast,
} from '../components/ui';
import type { FirewallInfo } from '../types';

interface FwForm {
  level: string;
  blockHttp: boolean;
  blockIcmp: boolean;
  blockMulticast: boolean;
  blockPeer: boolean;
  blockIdent: boolean;
}

const V4_LEVELS = [
  { value: 'high', label: 'High', description: 'Block all unsolicited inbound traffic.', tone: 'good' },
  { value: 'medium', label: 'Medium', description: 'Block common services and probes.', tone: 'good' },
  { value: 'low', label: 'Low', description: 'Only block the most obvious attacks.', tone: 'warn' },
  { value: 'custom', label: 'Custom', description: 'Choose which services to block.', tone: 'info' },
  { value: 'none', label: 'None', description: 'No inbound filtering at all.', tone: 'bad' },
];

const V6_LEVELS = [
  { value: 'default', label: 'Default', description: 'Standard IPv6 protection.', tone: 'good' },
  { value: 'custom', label: 'Custom', description: 'Choose which services to block.', tone: 'info' },
  { value: 'none', label: 'None', description: 'No IPv6 filtering at all.', tone: 'bad' },
];

const BLOCK_FIELDS: Array<{ key: keyof Omit<FwForm, 'level'>; label: string; description: string }> = [
  { key: 'blockHttp', label: 'HTTP', description: 'Block inbound port 80.' },
  { key: 'blockIcmp', label: 'ICMP', description: 'Block ping and ICMP probes.' },
  { key: 'blockMulticast', label: 'Multicast', description: 'Block multicast traffic.' },
  { key: 'blockPeer', label: 'Peer-to-peer', description: 'Block common P2P ports.' },
  { key: 'blockIdent', label: 'IDENT', description: 'Block the ident service (port 113).' },
];

function fromInfo(info: FirewallInfo): FwForm {
  return { level: info.level, ...info.custom };
}

function levelTone(level: string): 'good' | 'warn' | 'bad' | 'info' {
  if (/high|medium|default/i.test(level)) return 'good';
  if (/none/i.test(level)) return 'bad';
  if (/custom/i.test(level)) return 'info';
  return 'warn';
}

function FirewallCard({
  version,
  info,
  onSaved,
}: {
  version: 'ipv4' | 'ipv6';
  info: FirewallInfo;
  onSaved: (next: FirewallInfo) => void;
}) {
  const toast = useToast();
  const initial = useMemo(() => fromInfo(info), [info]);
  const [form, setForm] = useState<FwForm>(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(initial);
  }, [initial]);

  const levels = version === 'ipv4' ? V4_LEVELS : V6_LEVELS;
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);
  const isCustom = form.level === 'custom';

  async function save() {
    setSaving(true);
    try {
      const next = await api.updateFirewall(version, {
        level: form.level,
        blockHttp: form.blockHttp,
        blockIcmp: form.blockIcmp,
        blockMulticast: form.blockMulticast,
        blockPeer: form.blockPeer,
        blockIdent: form.blockIdent,
      });
      onSaved(next);
      toast.success(`${version === 'ipv4' ? 'IPv4' : 'IPv6'} firewall updated.`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title={
        <span className="title-with-icon">
          {version === 'ipv4' ? <Shield size={18} /> : <ShieldCheck size={18} />}
          {version === 'ipv4' ? 'IPv4 firewall' : 'IPv6 firewall'}
        </span>
      }
      subtitle={
        version === 'ipv4'
          ? 'Controls inbound IPv4 traffic from the internet.'
          : 'Controls inbound IPv6 traffic from the internet.'
      }
      actions={<Badge tone={levelTone(form.level)}>{form.level || 'Unknown'}</Badge>}
    >
      <div className="level-grid">
        {levels.map((level) => (
          <button
            key={level.value}
            type="button"
            className={cx('level-card', form.level === level.value && 'is-selected', `level-${level.tone}`)}
            onClick={() => setForm({ ...form, level: level.value })}
          >
            <span className="level-radio" />
            <span>
              <strong>{level.label}</strong>
              <span>{level.description}</span>
            </span>
          </button>
        ))}
      </div>

      {isCustom && (
        <div className="custom-block">
          <div className="custom-block-head">
            <ShieldAlert size={15} />
            <span>Custom blocking rules</span>
          </div>
          <div className="toggle-stack">
            {BLOCK_FIELDS.map((field) => (
              <Toggle
                key={field.key}
                checked={form[field.key]}
                onChange={(value) => setForm({ ...form, [field.key]: value })}
                label={field.label}
                description={field.description}
              />
            ))}
          </div>
        </div>
      )}

      {form.level === 'none' && (
        <div className="warning-note compact">
          <ShieldOff size={16} />
          <div>
            <strong>Firewall disabled</strong>
            <p>All inbound traffic will be accepted. Only use this for temporary testing.</p>
          </div>
        </div>
      )}

      <div className="card-foot-row">
        <span className="muted small">Changes take effect immediately.</span>
        <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!dirty}>
          Save {version === 'ipv4' ? 'IPv4' : 'IPv6'} settings
        </Button>
      </div>
    </Card>
  );
}

export function FirewallPage() {
  const firewall = useAsync(() => api.firewall(), []);
  const [ipv4, setIpv4] = useState<FirewallInfo | null>(null);
  const [ipv6, setIpv6] = useState<FirewallInfo | null>(null);

  useEffect(() => {
    if (firewall.data) {
      setIpv4(firewall.data.ipv4);
      setIpv6(firewall.data.ipv6);
    }
  }, [firewall.data]);

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Inbound protection</span>
          <h2>Firewall</h2>
          <p>Set the IPv4 and IPv6 security posture for traffic arriving from the WAN.</p>
        </div>
        <Button
          variant="secondary"
          icon={<RefreshCw size={15} />}
          loading={firewall.loading}
          onClick={() => void firewall.reload(true)}
        >
          Refresh
        </Button>
      </div>

      {firewall.error && !firewall.data && <InlineError message={firewall.error} onRetry={() => void firewall.reload()} />}

      {firewall.loading && !firewall.data ? (
        <div className="grid grid-2">
          <Card>
            <Skeleton lines={8} />
          </Card>
          <Card>
            <Skeleton lines={8} />
          </Card>
        </div>
      ) : (
        <div className="grid grid-2 firewall-grid">
          {ipv4 && (
            <FirewallCard
              version="ipv4"
              info={ipv4}
              onSaved={(next) => {
                setIpv4(next);
                firewall.setData({ ipv4: next, ipv6: ipv6 ?? firewall.data!.ipv6 });
              }}
            />
          )}
          {ipv6 && (
            <FirewallCard
              version="ipv6"
              info={ipv6}
              onSaved={(next) => {
                setIpv6(next);
                firewall.setData({ ipv4: ipv4 ?? firewall.data!.ipv4, ipv6: next });
              }}
            />
          )}
        </div>
      )}

      <div className="info-note">
        <ShieldAlert size={16} />
        <span>
          This firmware exposes IPv4 levels High, Medium, Low, Custom, and None. IPv6 only supports
          None, Default, and Custom. Blocking fields apply when the level is Custom.
        </span>
      </div>
    </div>
  );
}
