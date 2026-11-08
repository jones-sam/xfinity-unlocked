import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  CircleHelp,
  Clock,
  Lock,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { api, errorMessage } from '../api';
import {
  Badge,
  Button,
  Card,
  ConfirmModal,
  CopyButton,
  EmptyState,
  Field,
  InlineError,
  Input,
  Modal,
  Select,
  Skeleton,
  StatusDot,
  Toggle,
  cx,
  timeAgo,
  useAsync,
  useToast,
} from '../components/ui';
import type { PfProtocol, PortForwardInput, PortForwardRule, PortForwardState } from '../types';

interface PfForm {
  name: string;
  protocol: PfProtocol;
  internalClient: string;
  startPort: string;
  endPort: string;
}

const EMPTY_FORM: PfForm = {
  name: '',
  protocol: 'TCP',
  internalClient: '',
  startPort: '',
  endPort: '',
};

export function PortForwardingPage() {
  const forwarding = useAsync(() => api.portForwarding(), []);
  const devices = useAsync(() => api.devices(), []);
  const toast = useToast();

  const [state, setState] = useState<PortForwardState | null>(null);
  const current = state ?? forwarding.data;

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PortForwardRule | null>(null);
  const [form, setForm] = useState<PfForm>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [deleting, setDeleting] = useState<PortForwardRule | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [busyRule, setBusyRule] = useState<number | null>(null);
  const [masterBusy, setMasterBusy] = useState(false);

  const rules = current?.rules ?? [];
  const enabledCount = rules.filter((rule) => rule.enabled === true).length;
  const managedCount = rules.filter((rule) => rule.managedByApp).length;

  const deviceOptions = useMemo(() => devices.data?.devices ?? [], [devices.data]);

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setModalOpen(true);
  }

  function openEdit(rule: PortForwardRule) {
    setEditing(rule);
    const start = rule.externalStart || rule.externalPorts.split('-')[0] || '';
    const end = rule.externalEnd || rule.externalPorts.split('-')[1] || start;
    setForm({
      name: rule.name,
      protocol: rule.protocol || 'TCP',
      internalClient: rule.internalClient,
      startPort: start,
      endPort: end,
    });
    setFormError('');
    setModalOpen(true);
  }

  async function saveRule() {
    setFormError('');
    const start = Number(form.startPort);
    const end = Number(form.endPort || form.startPort);
    if (!form.name.trim()) {
      setFormError('Give this port forward a name.');
      return;
    }
    if (!form.internalClient.trim()) {
      setFormError('Enter the internal client IP address.');
      return;
    }
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(form.internalClient.trim()) && !form.internalClient.includes(':')) {
      setFormError('Enter a valid IPv4 or IPv6 address.');
      return;
    }
    if (!Number.isInteger(start) || start < 1 || start > 65535) {
      setFormError('The start port must be between 1 and 65535.');
      return;
    }
    if (!Number.isInteger(end) || end < 1 || end > 65535) {
      setFormError('The end port must be between 1 and 65535.');
      return;
    }
    if (start > end) {
      setFormError('The start port must be less than or equal to the end port.');
      return;
    }

    const payload: PortForwardInput = {
      name: form.name.trim(),
      protocol: form.protocol,
      internalClient: form.internalClient.trim(),
      startPort: start,
      endPort: end,
    };

    setSaving(true);
    try {
      if (editing) {
        const result = await api.updatePortForward(editing.id, payload);
        setState(result.state);
        toast.success('Port forward updated.');
      } else {
        const result = await api.addPortForward(payload);
        setState(result.state);
        toast.success(
          result.ruleId
            ? `Port forward created as rule ${result.ruleId}.`
            : 'Port forward created. The new rule did not appear in the scan yet.',
        );
      }
      setModalOpen(false);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function toggleRule(rule: PortForwardRule, enabled: boolean) {
    setBusyRule(rule.id);
    try {
      const next = await api.togglePortForward(rule.id, enabled);
      setState(next);
      toast.success(`${rule.name || `Rule ${rule.id}`} ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusyRule(null);
    }
  }

  async function deleteRule() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      const next = await api.deletePortForward(deleting.id);
      setState(next);
      toast.success('Port forward deleted.');
      setDeleting(null);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeleteBusy(false);
    }
  }

  async function setMaster(enabled: boolean) {
    setMasterBusy(true);
    try {
      const result = await api.setPortForwardingEnabled(enabled);
      setState((previous) =>
        previous
          ? { ...previous, enabled: result.enabled, scannedAt: Date.now() }
          : previous ?? { ...(forwarding.data as PortForwardState), enabled: result.enabled },
      );
      toast.success(`Port forwarding ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setMasterBusy(false);
    }
  }

  async function refresh() {
    setState(null);
    await forwarding.reload(true);
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">NAT</span>
          <h2>Port forwarding</h2>
          <p>Create, edit, toggle, and remove port mappings with the full rule detail.</p>
        </div>
        <div className="heading-actions">
          <Button variant="secondary" icon={<RefreshCw size={15} />} loading={forwarding.loading} onClick={() => void refresh()}>
            Rescan
          </Button>
          <Button variant="primary" icon={<Plus size={16} />} onClick={openAdd}>
            Add port forward
          </Button>
        </div>
      </div>

      {forwarding.error && !current && <InlineError message={forwarding.error} onRetry={() => void forwarding.reload()} />}

      {current && (
        <>
          <div className="master-card">
            <div className="master-main">
              <span className={cx('master-icon', current.enabled ? 'is-on' : 'is-off')}>
                {current.enabled ? <Power size={20} /> : <PowerOff size={20} />}
              </span>
              <div>
                <div className="master-title-row">
                  <h3>Port forwarding service</h3>
                  <Badge tone={current.enabled === true ? 'good' : current.enabled === false ? 'bad' : 'warn'} dot>
                    {current.enabled === true ? 'Enabled' : current.enabled === false ? 'Disabled' : 'Unknown'}
                  </Badge>
                </div>
                <p>
                  {current.enabled === false
                    ? 'Rules below are saved but will not be applied until the service is enabled.'
                    : current.enabled === null
                      ? 'The gateway did not report the master switch state.'
                      : 'Incoming connections to the mapped ports reach the listed internal clients.'}
                </p>
              </div>
            </div>
            <div className="master-controls">
              <Toggle
                checked={current.enabled === true}
                disabled={masterBusy || current.enabled === null}
                onChange={(value) => void setMaster(value)}
                label={current.enabled === true ? 'Disable service' : 'Enable service'}
              />
            </div>
          </div>

          <div className="pf-stats">
            <div className="pf-stat">
              <span>Rules</span>
              <strong>{rules.length}</strong>
            </div>
            <div className="pf-stat">
              <span>Enabled</span>
              <strong>{enabledCount}</strong>
            </div>
            <div className="pf-stat">
              <span>Dashboard-managed</span>
              <strong>{managedCount}</strong>
            </div>
            <div className="pf-stat scan-stat">
              <span>
                <Clock size={13} /> Last scan
              </span>
              <strong>{timeAgo(current.scannedAt)}</strong>
              <small>
                {current.scanMs} ms · IDs 1–{current.scanLimit}
              </small>
            </div>
          </div>

          <Card padded={false}>
            {forwarding.loading && !state ? (
              <div className="card-pad">
                <Skeleton lines={7} />
              </div>
            ) : rules.length === 0 ? (
              <EmptyState
                icon={<ArrowRightLeft size={22} />}
                title="No port forwards yet"
                message="Add a rule to expose a service on your LAN to the internet."
                action={
                  <Button variant="primary" icon={<Plus size={15} />} onClick={openAdd}>
                    Add your first rule
                  </Button>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table pf-table">
                  <thead>
                    <tr>
                      <th>Service</th>
                      <th>Port(s)</th>
                      <th>Protocol</th>
                      <th>Internal client</th>
                      <th>State</th>
                      <th>Source</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((rule) => (
                      <tr key={rule.id} className={cx(rule.enabled === false && 'row-disabled')}>
                        <td>
                          <div className="cell-stack">
                            <strong>{rule.name || `Rule ${rule.id}`}</strong>
                            <span className="cell-sub">ID {rule.id}</span>
                          </div>
                        </td>
                        <td>
                          <div className="port-cell">
                            <span className="mono">{rule.externalPorts || '—'}</span>
                            <CopyButton value={rule.externalPorts} label="Copy" />
                          </div>
                        </td>
                        <td>
                          {rule.protocol ? (
                            <Badge tone="info">{rule.protocol}</Badge>
                          ) : (
                            <span className="muted" title="The router does not expose the protocol for this rule.">
                              Unknown
                            </span>
                          )}
                        </td>
                        <td>
                          {rule.internalClient ? (
                            <span className="mono">{rule.internalClient}</span>
                          ) : (
                            <span className="muted" title="The router does not expose the internal client for this rule.">
                              Unknown
                            </span>
                          )}
                        </td>
                        <td>
                          {rule.enabled === null ? (
                            <div className="unknown-state">
                              <Badge tone="warn">Unknown</Badge>
                              <div className="unknown-actions">
                                <button
                                  type="button"
                                  className="mini-action"
                                  title="Enable this rule"
                                  disabled={busyRule === rule.id}
                                  onClick={() => void toggleRule(rule, true)}
                                >
                                  <Power size={13} />
                                </button>
                                <button
                                  type="button"
                                  className="mini-action"
                                  title="Disable this rule"
                                  disabled={busyRule === rule.id}
                                  onClick={() => void toggleRule(rule, false)}
                                >
                                  <PowerOff size={13} />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <Toggle
                              checked={rule.enabled}
                              disabled={busyRule === rule.id}
                              onChange={(value) => void toggleRule(rule, value)}
                            />
                          )}
                        </td>
                        <td>
                          {rule.managedByApp ? (
                            <Badge tone="good">Dashboard</Badge>
                          ) : (
                            <Badge tone="neutral">Router</Badge>
                          )}
                        </td>
                        <td className="cell-actions">
                          <button
                            type="button"
                            className="row-action"
                            onClick={() => openEdit(rule)}
                            title="Edit rule"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            className="row-action danger"
                            onClick={() => setDeleting(rule)}
                            title="Delete rule"
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="info-note">
            <CircleHelp size={16} />
            <span>
              This firmware only reveals a rule's name and ports from its edit page. Rules created
              outside this dashboard are marked <strong>Router</strong>; protocol and internal client
              stay unknown until you edit the rule here.
            </span>
          </div>
        </>
      )}

      <Modal
        open={modalOpen}
        onClose={() => {
          if (!saving) setModalOpen(false);
        }}
        title={editing ? `Edit port forward ${editing.id}` : 'Add port forward'}
        subtitle={
          editing
            ? 'Saving replaces the rule on the router.'
            : 'Open one port or a range on the WAN side and map it to a device on your LAN.'
        }
        size="lg"
        footer={
          <>
            <Button onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void saveRule()} loading={saving}>
              {editing ? 'Save rule' : 'Create rule'}
            </Button>
          </>
        }
      >
        <div className="form-stack">
          {formError && <div className="form-error">{formError}</div>}

          {editing && !editing.detailsKnown && (
            <div className="warning-note compact">
              <ShieldAlert size={16} />
              <div>
                <strong>This rule was created elsewhere</strong>
                <p>
                  The gateway hides its protocol and internal client. Enter them below to take full
                  control of the rule.
                </p>
              </div>
            </div>
          )}

          <div className="form-grid">
            <Field label="Service name" className="span-2">
              <Input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="e.g. Game server"
                maxLength={63}
              />
            </Field>

            <Field label="Protocol">
              <Select
                value={form.protocol}
                onChange={(event) => setForm({ ...form, protocol: event.target.value as PfProtocol })}
              >
                <option value="TCP">TCP</option>
                <option value="UDP">UDP</option>
                <option value="TCP/UDP">TCP and UDP</option>
              </Select>
            </Field>

            <Field label="Internal client" hint="Pick a connected device or type an address.">
              <div className="input-with-list">
                <Input
                  value={form.internalClient}
                  onChange={(event) => setForm({ ...form, internalClient: event.target.value })}
                  placeholder="10.0.0.50"
                  className="mono"
                  list="pf-device-options"
                />
                <datalist id="pf-device-options">
                  {deviceOptions.map((device) => (
                    <option key={`${device.mac}-${device.ipv4}`} value={device.ipv4}>
                      {device.name}
                    </option>
                  ))}
                </datalist>
              </div>
            </Field>

            {deviceOptions.length > 0 && (
              <div className="device-picks span-2">
                <span className="field-label">Quick pick</span>
                <div className="chip-row">
                  {deviceOptions.slice(0, 8).map((device) => (
                    <button
                      type="button"
                      key={`${device.mac}-${device.ipv4}`}
                      className={cx('pick-chip', form.internalClient === device.ipv4 && 'is-selected')}
                      onClick={() => setForm({ ...form, internalClient: device.ipv4 })}
                      title={device.mac}
                    >
                      <span>{device.name}</span>
                      <span className="mono small">{device.ipv4}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Field label="Start port" hint="External and internal port">
              <Input
                value={form.startPort}
                onChange={(event) => setForm({ ...form, startPort: event.target.value })}
                inputMode="numeric"
                placeholder="25565"
                className="mono"
              />
            </Field>

            <Field label="End port" hint="Same as start port for a single port">
              <Input
                value={form.endPort}
                onChange={(event) => setForm({ ...form, endPort: event.target.value })}
                inputMode="numeric"
                placeholder="25565"
                className="mono"
              />
            </Field>
          </div>

          <div className="info-note compact">
            <CircleHelp size={15} />
            <span>
              This router maps the same port number on the WAN and LAN. A range such as 25565–25575
              forwards every port in that range.
            </span>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={Boolean(deleting)}
        onClose={() => (deleteBusy ? undefined : setDeleting(null))}
        onConfirm={() => void deleteRule()}
        title="Delete port forward"
        message={
          deleting
            ? `Remove “${deleting.name || `Rule ${deleting.id}`}” and its port mapping? This takes effect immediately.`
            : undefined
        }
        confirmLabel="Delete rule"
        danger
        busy={deleteBusy}
      />
    </div>
  );
}
