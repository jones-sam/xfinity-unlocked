import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BatteryCharging,
  Cpu,
  HardDrive,
  Info,
  KeyRound,
  Lock,
  Network,
  Power,
  RefreshCw,
  RotateCcw,
  Router,
  ShieldAlert,
  Wifi,
  Wrench,
} from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import {
  Badge,
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  Field,
  InlineError,
  Input,
  KeyValueList,
  Modal,
  Skeleton,
  Tabs,
  useAsync,
  useToast,
} from '../components/ui';
import type { Section } from '../types';

const SECTION_TABS = [
  { id: 'hardware', label: 'Hardware', icon: HardDrive },
  { id: 'software', label: 'Software', icon: Cpu },
  { id: 'network', label: 'Network', icon: Network },
  { id: 'wireless', label: 'Wireless', icon: Wifi },
  { id: 'battery', label: 'Battery', icon: BatteryCharging },
];

type ResetMode = 'reboot' | 'wifi-module' | 'wifi-router' | 'wifi-settings' | 'factory';

const RESET_ACTIONS: Array<{
  mode: ResetMode;
  title: string;
  description: string;
  danger?: boolean;
}> = [
  {
    mode: 'reboot',
    title: 'Reboot gateway',
    description: 'Restart the router. Internet and Wi-Fi drop for a few minutes.',
  },
  {
    mode: 'wifi-module',
    title: 'Restart Wi-Fi module',
    description: 'Restart the wireless radios without rebooting the whole gateway.',
  },
  {
    mode: 'wifi-router',
    title: 'Restart Wi-Fi router',
    description: 'Restart the wireless subsystem and routing services together.',
  },
  {
    mode: 'wifi-settings',
    title: 'Restore Wi-Fi settings',
    description: 'Reset Wi-Fi names, passwords, and radio settings to provider defaults.',
    danger: true,
  },
  {
    mode: 'factory',
    title: 'Factory reset',
    description: 'Erase all settings and return the gateway to its factory state. This cannot be undone.',
    danger: true,
  },
];

function SectionGrid({ sections }: { sections: Section[] }) {
  if (sections.length === 0) {
    return (
      <EmptyState
        icon={<Info size={20} />}
        title="No data available"
        message="The gateway did not return this section on this firmware."
      />
    );
  }
  return (
    <div className="system-grid">
      {sections.map((section) => (
        <Card key={section.title} title={section.title}>
          <KeyValueList rows={section.rows} columns={section.rows.length > 6 ? 1 : 2} />
        </Card>
      ))}
    </div>
  );
}

export function SystemPage() {
  const system = useAsync(() => api.system(), []);
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState('hardware');

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  const [resetTarget, setResetTarget] = useState<ResetMode | null>(null);
  const [factoryConfirm, setFactoryConfirm] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  const sections = useMemo(() => {
    if (!system.data) return [];
    return system.data[tab as keyof typeof system.data] ?? [];
  }, [system.data, tab]);

  const identity = useMemo(() => {
    const hardware = system.data?.hardware[0]?.rows ?? [];
    const find = (label: string) => hardware.find((row) => row.label.toLowerCase().startsWith(label.toLowerCase()))?.value;
    return {
      model: find('Model'),
      vendor: find('Vendor'),
      serial: find('Serial Number'),
      revision: find('Hardware Revision'),
    };
  }, [system.data]);

  async function changePassword() {
    setPasswordError('');
    if (!/^[a-z0-9]{8,20}$/i.test(oldPassword)) {
      setPasswordError('The current password must be 8–20 letters and numbers.');
      return;
    }
    if (!/^[a-z0-9]{8,20}$/i.test(newPassword)) {
      setPasswordError('The new password must be 8–20 letters and numbers.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('The new passwords do not match.');
      return;
    }
    if (oldPassword === newPassword) {
      setPasswordError('The new password must be different from the current password.');
      return;
    }
    setPasswordBusy(true);
    try {
      await api.changePassword(oldPassword, newPassword);
      toast.success('Router password changed. Use the new password next time you sign in.');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      setPasswordError(errorMessage(error));
    } finally {
      setPasswordBusy(false);
    }
  }

  async function runReset() {
    if (!resetTarget) return;
    if (resetTarget === 'factory' && factoryConfirm !== 'FACTORY RESET') {
      toast.error('Type FACTORY RESET exactly to confirm.');
      return;
    }
    setResetBusy(true);
    try {
      await api.reset(resetTarget, resetTarget === 'factory' ? factoryConfirm : undefined);
      setResetTarget(null);
      if (resetTarget === 'reboot' || resetTarget === 'factory') {
        toast.info('The gateway is restarting. Sign in again once it is back online.');
        await signOut();
        window.setTimeout(() => navigate('/login', { replace: true }), 1200);
      } else if (resetTarget === 'wifi-settings') {
        toast.success('Wi-Fi settings restored to defaults.');
        void system.reload(true);
      } else {
        toast.success('Wi-Fi restart requested.');
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setResetBusy(false);
    }
  }

  const activeReset = RESET_ACTIONS.find((action) => action.mode === resetTarget);

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Gateway</span>
          <h2>System</h2>
          <p>Hardware, firmware, network identity, password, and reset controls.</p>
        </div>
        <Button
          variant="secondary"
          icon={<RefreshCw size={15} />}
          loading={system.loading}
          onClick={() => void system.reload(true)}
        >
          Refresh
        </Button>
      </div>

      {system.error && !system.data && <InlineError message={system.error} onRetry={() => void system.reload()} />}

      {identity.model && (
        <div className="identity-card">
          <div className="identity-icon">
            <Router size={24} />
          </div>
          <div className="identity-main">
            <span className="eyebrow">Gateway identity</span>
            <h3>
              {identity.vendor} {identity.model}
            </h3>
            <p>
              Hardware revision {identity.revision || 'unknown'} · Serial {identity.serial || 'unavailable'}
            </p>
          </div>
          <Badge tone="good" dot>
            Online
          </Badge>
        </div>
      )}

      <Card padded={false}>
        <div className="table-toolbar">
          <Tabs
            tabs={SECTION_TABS.map((section) => {
              const Icon = section.icon;
              return {
                id: section.id,
                label: (
                  <span className="title-with-icon">
                    <Icon size={14} />
                    {section.label}
                  </span>
                ),
              };
            })}
            active={tab}
            onChange={setTab}
          />
        </div>
        <div className="card-pad">
          {system.loading && !system.data ? <Skeleton lines={8} /> : <SectionGrid sections={sections} />}
        </div>
      </Card>

      <div className="grid grid-2">
        <Card
          title={
            <span className="title-with-icon">
              <KeyRound size={18} />
              Admin password
            </span>
          }
          subtitle="Change the password used to sign in to the gateway"
        >
          <div className="form-stack">
            {passwordError && <div className="form-error">{passwordError}</div>}
            <Field label="Current password">
              <div className="input-with-icon">
                <Lock size={16} />
                <Input
                  type="password"
                  value={oldPassword}
                  onChange={(event) => setOldPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </div>
            </Field>
            <Field label="New password" hint="8–20 characters, letters and numbers only.">
              <div className="input-with-icon">
                <KeyRound size={16} />
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </Field>
            <Field label="Confirm new password">
              <div className="input-with-icon">
                <KeyRound size={16} />
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </Field>
            <div className="card-foot-row">
              <span className="muted small">The dashboard updates its in-memory session automatically.</span>
              <Button variant="primary" onClick={() => void changePassword()} loading={passwordBusy}>
                Change password
              </Button>
            </div>
          </div>
        </Card>

        <Card
          title={
            <span className="title-with-icon">
              <Power size={18} />
              Restart and reset
            </span>
          }
          subtitle="These actions interrupt connectivity"
        >
          <div className="reset-list">
            {RESET_ACTIONS.map((action) => {
              const Icon =
                action.mode === 'factory'
                  ? ShieldAlert
                  : action.mode === 'reboot'
                    ? RotateCcw
                    : action.mode === 'wifi-settings'
                      ? Wrench
                      : Wifi;
              return (
                <div className={action.danger ? 'reset-row danger' : 'reset-row'} key={action.mode}>
                  <span className="reset-icon">
                    <Icon size={16} />
                  </span>
                  <div>
                    <strong>{action.title}</strong>
                    <span>{action.description}</span>
                  </div>
                  <Button
                    size="sm"
                    variant={action.danger ? 'danger' : 'soft'}
                    onClick={() => {
                      setFactoryConfirm('');
                      setResetTarget(action.mode);
                    }}
                  >
                    {action.danger ? 'Reset' : 'Restart'}
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <ConfirmModal
        open={Boolean(resetTarget)}
        onClose={() => (resetBusy ? undefined : setResetTarget(null))}
        onConfirm={() => void runReset()}
        title={activeReset?.title || 'Confirm restart'}
        message={activeReset?.description}
        confirmLabel={resetTarget === 'factory' ? 'Factory reset gateway' : 'Confirm'}
        danger={Boolean(activeReset?.danger)}
        busy={resetBusy}
      >
        {resetTarget === 'factory' && (
          <Field label='Type "FACTORY RESET" to confirm'>
            <Input
              value={factoryConfirm}
              onChange={(event) => setFactoryConfirm(event.target.value)}
              placeholder="FACTORY RESET"
              className="mono"
            />
          </Field>
        )}
      </ConfirmModal>

      <div className="info-note">
        <Info size={16} />
        <span>
          A factory reset wipes your Wi-Fi names, passwords, port forwards, and all other settings. Use
          it only as a last resort.
        </span>
      </div>
    </div>
  );
}
