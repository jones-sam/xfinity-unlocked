import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  CircleHelp,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Wifi,
} from 'lucide-react';
import { api, errorMessage } from '../api';
import {
  Badge,
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  Field,
  InlineError,
  Input,
  Modal,
  Select,
  Skeleton,
  Tabs,
  Toggle,
  cx,
  useAsync,
  useToast,
} from '../components/ui';
import type {
  DmzInfo,
  RemoteManagementInfo,
  TriggerInfo,
  TriggerRule,
  UpnpMapping,
  UpnpResponse,
} from '../types';

type AdvancedTab = 'triggers' | 'upnp' | 'dmz' | 'remote';

/* ------------------------------------------------------------------ */
/* Port triggering                                                     */
/* ------------------------------------------------------------------ */

interface TriggerForm {
  name: string;
  protocol: string;
  triggerStart: string;
  triggerEnd: string;
  targetStart: string;
  targetEnd: string;
}

const EMPTY_TRIGGER: TriggerForm = {
  name: '',
  protocol: 'TCP',
  triggerStart: '',
  triggerEnd: '',
  targetStart: '',
  targetEnd: '',
};

function splitRange(value: string): [string, string] {
  const parts = value.split(/[~-]/).map((part) => part.trim());
  return [parts[0] || '', parts[1] || parts[0] || ''];
}

function TriggersPanel() {
  const triggers = useAsync(() => api.triggers(), []);
  const toast = useToast();
  const [state, setState] = useState<TriggerInfo | null>(null);
  const current = state ?? triggers.data;
  const [masterBusy, setMasterBusy] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TriggerRule | null>(null);
  const [form, setForm] = useState<TriggerForm>(EMPTY_TRIGGER);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<TriggerRule | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_TRIGGER);
    setFormError('');
    setModalOpen(true);
  }

  function openEdit(rule: TriggerRule) {
    const [tStart, tEnd] = splitRange(rule.triggerPorts);
    const [gStart, gEnd] = splitRange(rule.targetPorts);
    setEditing(rule);
    setForm({
      name: rule.name,
      protocol: rule.protocol || 'TCP',
      triggerStart: tStart,
      triggerEnd: tEnd,
      targetStart: gStart,
      targetEnd: gEnd,
    });
    setFormError('');
    setModalOpen(true);
  }

  async function save() {
    setFormError('');
    const values = [form.triggerStart, form.triggerEnd, form.targetStart, form.targetEnd].map(Number);
    if (!form.name.trim()) {
      setFormError('Give this trigger a name.');
      return;
    }
    if (values.some((value) => !Number.isInteger(value) || value < 1 || value > 65535)) {
      setFormError('All ports must be between 1 and 65535.');
      return;
    }
    if (values[0] > values[1] || values[2] > values[3]) {
      setFormError('Port ranges must go from low to high.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        protocol: form.protocol,
        triggerStart: values[0],
        triggerEnd: values[1],
        targetStart: values[2],
        targetEnd: values[3],
      };
      const next = editing
        ? await api.updateTrigger(editing.id ?? 0, payload)
        : await api.addTrigger(payload);
      setState(next);
      toast.success(editing ? 'Port trigger updated.' : 'Port trigger added.');
      setModalOpen(false);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function toggleMaster(enabled: boolean) {
    setMasterBusy(true);
    try {
      setState(await api.setTriggersEnabled(enabled));
      toast.success(`Port triggering ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setMasterBusy(false);
    }
  }

  async function toggleRule(rule: TriggerRule, enabled: boolean) {
    if (rule.id === null) return;
    setBusyId(rule.id);
    try {
      setState(await api.toggleTrigger(rule.id, enabled));
      toast.success(`Trigger ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function remove() {
    if (!deleting?.id) return;
    setDeleteBusy(true);
    try {
      setState(await api.deleteTrigger(deleting.id));
      toast.success('Port trigger deleted.');
      setDeleting(null);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeleteBusy(false);
    }
  }

  const rules = current?.rules ?? [];

  return (
    <div className="panel-stack">
      {triggers.error && !current && <InlineError message={triggers.error} onRetry={() => void triggers.reload()} />}

      {current && (
        <>
          <div className="master-card">
            <div className="master-main">
              <span className={cx('master-icon', current.enabled ? 'is-on' : 'is-off')}>
                <ArrowRightLeft size={20} />
              </span>
              <div>
                <div className="master-title-row">
                  <h3>Port triggering</h3>
                  <Badge tone={current.enabled === true ? 'good' : current.enabled === false ? 'neutral' : 'warn'} dot>
                    {current.enabled === true ? 'Enabled' : current.enabled === false ? 'Disabled' : 'Unknown'}
                  </Badge>
                </div>
                <p>Open target ports temporarily when an outbound trigger port is used.</p>
              </div>
            </div>
            <Toggle
              checked={current.enabled === true}
              disabled={masterBusy || current.enabled === null}
              onChange={(value) => void toggleMaster(value)}
              label={current.enabled === true ? 'Disable triggering' : 'Enable triggering'}
            />
          </div>

          <div className="probe-note">
            Firmware 8.5.0.19 saves the service name but drops the protocol and port values written
            by the stock port-triggering handler, in both the stock UI and this dashboard. Listing,
            deleting, and enabling rules still work, but port-trigger rules cannot be configured
            reliably on this firmware.
          </div>

          <Card
            title="Trigger rules"
            subtitle="Outbound triggers open inbound target ports for the requesting host"
            padded={false}
            actions={
              <Button size="sm" variant="soft" icon={<Plus size={14} />} onClick={openAdd}>
                Add trigger
              </Button>
            }
          >
            {rules.length === 0 ? (
              <EmptyState
                icon={<ArrowRightLeft size={20} />}
                title="No port triggers"
                message="Add a trigger to let a client request temporary inbound access."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table compact-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Protocol</th>
                      <th>Trigger ports</th>
                      <th>Target ports</th>
                      <th>Active</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((rule) => (
                      <tr key={`${rule.id}-${rule.name}`}>
                        <td>
                          <strong>{rule.name}</strong>
                        </td>
                        <td>
                          <Badge tone="info">{rule.protocol}</Badge>
                        </td>
                        <td className="mono">{rule.triggerPorts}</td>
                        <td className="mono">{rule.targetPorts}</td>
                        <td>
                          {rule.active === null ? (
                            <Badge tone="warn">Unknown</Badge>
                          ) : (
                            <Toggle
                              checked={rule.active}
                              disabled={busyId === rule.id}
                              onChange={(value) => void toggleRule(rule, value)}
                            />
                          )}
                        </td>
                        <td className="cell-actions">
                          <button type="button" className="row-action" onClick={() => openEdit(rule)} title="Edit">
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            className="row-action danger"
                            onClick={() => setDeleting(rule)}
                            title="Delete"
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
        </>
      )}

      <Modal
        open={modalOpen}
        onClose={() => {
          if (!saving) setModalOpen(false);
        }}
        title={editing ? 'Edit port trigger' : 'Add port trigger'}
        subtitle="When a LAN client uses a trigger port, the router opens the target ports back to it."
        footer={
          <>
            <Button onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void save()} loading={saving}>
              {editing ? 'Save trigger' : 'Add trigger'}
            </Button>
          </>
        }
      >
        <div className="form-stack">
          {formError && <div className="form-error">{formError}</div>}
          <div className="form-grid">
            <Field label="Service name" className="span-2">
              <Input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="e.g. Game voice chat"
              />
            </Field>
            <Field label="Protocol">
              <Select
                value={form.protocol}
                onChange={(event) => setForm({ ...form, protocol: event.target.value })}
              >
                <option value="TCP">TCP</option>
                <option value="UDP">UDP</option>
                <option value="TCP/UDP">TCP and UDP</option>
              </Select>
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Trigger start port">
              <Input
                value={form.triggerStart}
                onChange={(event) => setForm({ ...form, triggerStart: event.target.value })}
                inputMode="numeric"
                className="mono"
              />
            </Field>
            <Field label="Trigger end port">
              <Input
                value={form.triggerEnd}
                onChange={(event) => setForm({ ...form, triggerEnd: event.target.value })}
                inputMode="numeric"
                className="mono"
              />
            </Field>
            <Field label="Target start port">
              <Input
                value={form.targetStart}
                onChange={(event) => setForm({ ...form, targetStart: event.target.value })}
                inputMode="numeric"
                className="mono"
              />
            </Field>
            <Field label="Target end port">
              <Input
                value={form.targetEnd}
                onChange={(event) => setForm({ ...form, targetEnd: event.target.value })}
                inputMode="numeric"
                className="mono"
              />
            </Field>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={Boolean(deleting)}
        onClose={() => (deleteBusy ? undefined : setDeleting(null))}
        onConfirm={() => void remove()}
        title="Delete port trigger"
        message={deleting ? `Remove “${deleting.name}”?` : undefined}
        confirmLabel="Delete trigger"
        danger
        busy={deleteBusy}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* UPnP                                                                */
/* ------------------------------------------------------------------ */

function UpnpPanel() {
  const upnp = useAsync(() => api.upnp(), []);
  const toast = useToast();
  const [data, setData] = useState<UpnpResponse | null>(null);
  const current = data ?? upnp.data;
  const [enabled, setEnabled] = useState(false);
  const [zeroConfig, setZeroConfig] = useState(false);
  const [minutes, setMinutes] = useState('30');
  const [ttl, setTtl] = useState('5');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<UpnpMapping | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (!upnp.data) return;
    setEnabled(upnp.data.enabled);
    setZeroConfig(upnp.data.zeroConfig);
    setMinutes(String(upnp.data.advertisementMinutes || 30));
    setTtl(String(upnp.data.ttl || 5));
  }, [upnp.data]);

  async function save() {
    setSaving(true);
    try {
      await api.updateUpnp({
        enabled,
        zeroConfig,
        advertisementMinutes: Number(minutes) || 30,
        ttl: Number(ttl) || 5,
      });
      toast.success('UPnP settings saved.');
      await upnp.reload(true);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function removeMapping() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.deleteUpnpMapping(deleting.externalPort, deleting.protocol, deleting.remoteHost);
      toast.success('UPnP mapping removed.');
      setDeleting(null);
      await upnp.reload(true);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="panel-stack">
      {upnp.error && !current && <InlineError message={upnp.error} onRetry={() => void upnp.reload()} />}
      {upnp.loading && !current ? (
        <Card>
          <Skeleton lines={7} />
        </Card>
      ) : (
        current && (
          <>
            <div className="warning-note">
              <AlertTriangle size={17} />
              <div>
                <strong>UPnP lets devices open ports without asking you.</strong>
                <p>
                  Keep it disabled unless a game console or app needs automatic port mapping. The
                  mappings below are live leases from UPnP clients.
                </p>
              </div>
            </div>

            <Card title="UPnP settings" subtitle="IGD discovery and lease behaviour">
              <div className="toggle-stack">
                <Toggle
                  checked={enabled}
                  onChange={setEnabled}
                  label="Enable UPnP / IGD"
                  description="Allow LAN clients to discover the gateway and request port mappings."
                />
                <Toggle
                  checked={zeroConfig}
                  onChange={setZeroConfig}
                  label="Zero-configuration networking"
                  description="Advertise services on the LAN using mDNS/DNS-SD."
                />
              </div>
              <div className="form-grid">
                <Field label="Advertisement period" hint="Minutes between IGD announcements (1–86400).">
                  <Input
                    value={minutes}
                    onChange={(event) => setMinutes(event.target.value)}
                    inputMode="numeric"
                    className="mono"
                  />
                </Field>
                <Field label="Time to live" hint="Lease TTL in hops (1–3600).">
                  <Input
                    value={ttl}
                    onChange={(event) => setTtl(event.target.value)}
                    inputMode="numeric"
                    className="mono"
                  />
                </Field>
              </div>
              <div className="card-foot-row">
                <span className="muted small">Changing UPnP restarts the IGD service.</span>
                <Button variant="primary" onClick={() => void save()} loading={saving}>
                  Save UPnP settings
                </Button>
              </div>
            </Card>

            <Card
              title="Active UPnP mappings"
              subtitle="Live port mappings requested by LAN clients"
              padded={false}
              actions={
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<RefreshCw size={14} />}
                  onClick={() => void upnp.reload(true)}
                >
                  Refresh
                </Button>
              }
            >
              {current.mappingsError ? (
                <div className="card-pad">
                  <div className="form-error">{current.mappingsError}</div>
                </div>
              ) : !current.enabled ? (
                <EmptyState
                  icon={<Wifi size={20} />}
                  title="UPnP is disabled"
                  message="Enable UPnP to see live mappings requested by devices."
                />
              ) : current.mappings.length === 0 ? (
                <EmptyState
                  icon={<Wifi size={20} />}
                  title="No active mappings"
                  message="No device currently holds a UPnP port mapping."
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table compact-table">
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th>Protocol</th>
                        <th>External</th>
                        <th>Internal</th>
                        <th>Client</th>
                        <th>Lease</th>
                        <th aria-label="Delete" />
                      </tr>
                    </thead>
                    <tbody>
                      {current.mappings.map((mapping) => (
                        <tr key={`${mapping.index}-${mapping.protocol}-${mapping.externalPort}`}>
                          <td>{mapping.description || '—'}</td>
                          <td>
                            <Badge tone="info">{mapping.protocol}</Badge>
                          </td>
                          <td className="mono">{mapping.externalPort}</td>
                          <td className="mono">{mapping.internalPort}</td>
                          <td className="mono">{mapping.internalClient}</td>
                          <td className="small">
                            {mapping.leaseDuration === '0' ? 'Permanent' : `${mapping.leaseDuration}s`}
                          </td>
                          <td className="cell-actions">
                            <button
                              type="button"
                              className="row-action danger"
                              onClick={() => setDeleting(mapping)}
                              title="Remove mapping"
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
          </>
        )
      )}

      <ConfirmModal
        open={Boolean(deleting)}
        onClose={() => (deleteBusy ? undefined : setDeleting(null))}
        onConfirm={() => void removeMapping()}
        title="Remove UPnP mapping"
        message={
          deleting
            ? `Remove ${deleting.protocol} port ${deleting.externalPort} for ${deleting.internalClient}?`
            : undefined
        }
        confirmLabel="Remove mapping"
        danger
        busy={deleteBusy}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* DMZ                                                                 */
/* ------------------------------------------------------------------ */

function DmzPanel() {
  const dmz = useAsync(() => api.dmz(), []);
  const toast = useToast();
  const [data, setData] = useState<DmzInfo | null>(null);
  const current = data ?? dmz.data;
  const [enabled, setEnabled] = useState(false);
  const [hostIpv4, setHostIpv4] = useState('');
  const [hostIpv6, setHostIpv6] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!dmz.data) return;
    setEnabled(dmz.data.enabled);
    setHostIpv4(dmz.data.hostIpv4);
    setHostIpv6(dmz.data.hostIpv6);
  }, [dmz.data]);

  async function save() {
    if (enabled && !/^\d{1,3}(\.\d{1,3}){3}$/.test(hostIpv4.trim())) {
      toast.error('Enter a valid IPv4 address for the DMZ host.');
      return;
    }
    setSaving(true);
    try {
      const next = await api.updateDmz({
        enabled,
        hostIpv4: hostIpv4.trim(),
        hostIpv6: hostIpv6.trim(),
      });
      setData(next);
      toast.success('DMZ settings saved.');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel-stack">
      {dmz.error && !current && <InlineError message={dmz.error} onRetry={() => void dmz.reload()} />}
      {dmz.loading && !current ? (
        <Card>
          <Skeleton lines={6} />
        </Card>
      ) : (
        current && (
          <>
            <div className="warning-note">
              <AlertTriangle size={17} />
              <div>
                <strong>DMZ exposes one host to the internet.</strong>
                <p>
                  All unsolicited traffic is forwarded to the DMZ host, bypassing port forwarding and
                  most firewall rules. Use a device you can fully secure.
                </p>
              </div>
            </div>

            <Card
              title="DMZ host"
              subtitle="Forward unmatched inbound traffic to one device"
              actions={<Badge tone={enabled ? 'warn' : 'neutral'}>{enabled ? 'Enabled' : 'Disabled'}</Badge>}
            >
              <Toggle
                checked={enabled}
                onChange={setEnabled}
                label="Enable DMZ"
                description="Only one host can be in the DMZ at a time."
              />
              <div className="form-grid">
                <Field label="DMZ host IPv4 address">
                  <Input
                    value={hostIpv4}
                    onChange={(event) => setHostIpv4(event.target.value)}
                    placeholder="10.0.0.50"
                    className="mono"
                    disabled={!enabled}
                  />
                </Field>
                <Field label="DMZ host IPv6 address" hint="Optional. Leave blank if unused.">
                  <Input
                    value={hostIpv6}
                    onChange={(event) => setHostIpv6(event.target.value)}
                    placeholder="2607:…"
                    className="mono"
                    disabled={!enabled}
                  />
                </Field>
              </div>
              <div className="card-foot-row">
                <span className="muted small">Disabling DMZ uses 0.0.0.0 as the host.</span>
                <Button variant="primary" onClick={() => void save()} loading={saving}>
                  Save DMZ settings
                </Button>
              </div>
            </Card>
          </>
        )
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Remote management                                                   */
/* ------------------------------------------------------------------ */

interface RemoteForm {
  httpEnabled: boolean;
  httpPort: string;
  httpsEnabled: boolean;
  httpsPort: string;
  allowType: 'any' | 'single' | 'range';
  singleIpv4: string;
  singleIpv6: string;
  rangeStartIpv4: string;
  rangeEndIpv4: string;
  rangeStartIpv6: string;
  rangeEndIpv6: string;
}

function remoteForm(info: RemoteManagementInfo): RemoteForm {
  return {
    httpEnabled: info.http.enabled,
    httpPort: info.http.port || '8080',
    httpsEnabled: info.https.enabled,
    httpsPort: info.https.port || '8181',
    allowType: info.allowType,
    singleIpv4: info.single.ipv4,
    singleIpv6: info.single.ipv6,
    rangeStartIpv4: info.range.startIpv4,
    rangeEndIpv4: info.range.endIpv4,
    rangeStartIpv6: info.range.startIpv6,
    rangeEndIpv6: info.range.endIpv6,
  };
}

function RemotePanel() {
  const remote = useAsync(() => api.remoteManagement(), []);
  const toast = useToast();
  const [form, setForm] = useState<RemoteForm | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (remote.data) setForm(remoteForm(remote.data));
  }, [remote.data]);

  const exposed = Boolean(form?.httpEnabled || form?.httpsEnabled);

  async function save() {
    if (!form) return;
    const httpPort = Number(form.httpPort);
    const httpsPort = Number(form.httpsPort);
    if (!Number.isInteger(httpPort) || httpPort < 1025 || httpPort > 65535) {
      toast.error('The HTTP port must be between 1025 and 65535.');
      return;
    }
    if (!Number.isInteger(httpsPort) || httpsPort < 1025 || httpsPort > 65535) {
      toast.error('The HTTPS port must be between 1025 and 65535.');
      return;
    }
    setSaving(true);
    try {
      await api.updateRemoteManagement({
        http: { enabled: form.httpEnabled, port: httpPort },
        https: { enabled: form.httpsEnabled, port: httpsPort },
        allowType: form.allowType,
        single: { ipv4: form.singleIpv4, ipv6: form.singleIpv6 },
        range: {
          startIpv4: form.rangeStartIpv4,
          endIpv4: form.rangeEndIpv4,
          startIpv6: form.rangeStartIpv6,
          endIpv6: form.rangeEndIpv6,
        },
      });
      toast.success('Remote management settings saved.');
      await remote.reload(true);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel-stack">
      {remote.error && !remote.data && <InlineError message={remote.error} onRetry={() => void remote.reload()} />}
      {remote.loading && !remote.data ? (
        <Card>
          <Skeleton lines={8} />
        </Card>
      ) : (
        form &&
        remote.data && (
          <>
            <div className={cx('warning-note', exposed && 'danger')}>
              <Lock size={17} />
              <div>
                <strong>Remote management exposes the router login page to the internet.</strong>
                <p>
                  Only the admin password protects it. Restrict access to known addresses and use HTTPS
                  whenever possible.
                </p>
              </div>
            </div>

            <Card title="Remote access" subtitle="Manage the gateway from outside your LAN">
              <div className="toggle-stack">
                <Toggle
                  checked={form.httpEnabled}
                  onChange={(value) => setForm({ ...form, httpEnabled: value })}
                  label="HTTP remote management"
                  description="Unencrypted. Not recommended."
                />
                <Toggle
                  checked={form.httpsEnabled}
                  onChange={(value) => setForm({ ...form, httpsEnabled: value })}
                  label="HTTPS remote management"
                  description="Encrypted access to the admin interface."
                />
              </div>

              <div className="form-grid">
                <Field label="HTTP port" hint="1025–65535">
                  <Input
                    value={form.httpPort}
                    onChange={(event) => setForm({ ...form, httpPort: event.target.value })}
                    inputMode="numeric"
                    className="mono"
                    disabled={!form.httpEnabled}
                  />
                </Field>
                <Field label="HTTPS port" hint="1025–65535">
                  <Input
                    value={form.httpsPort}
                    onChange={(event) => setForm({ ...form, httpsPort: event.target.value })}
                    inputMode="numeric"
                    className="mono"
                    disabled={!form.httpsEnabled}
                  />
                </Field>
              </div>

              <div className="field">
                <span className="field-label">Allowed addresses</span>
                <div className="level-grid three">
                  {(['any', 'single', 'range'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      className={cx('level-card', form.allowType === type && 'is-selected')}
                      onClick={() => setForm({ ...form, allowType: type })}
                    >
                      <span className="level-radio" />
                      <span>
                        <strong>
                          {type === 'any' ? 'Any address' : type === 'single' ? 'Single address' : 'Address range'}
                        </strong>
                        <span>
                          {type === 'any'
                            ? 'Anyone on the internet may reach the login page.'
                            : type === 'single'
                              ? 'Only one IPv4 or IPv6 address.'
                              : 'A contiguous IPv4 or IPv6 range.'}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {form.allowType === 'single' && (
                <div className="form-grid">
                  <Field label="Allowed IPv4 address">
                    <Input
                      value={form.singleIpv4}
                      onChange={(event) => setForm({ ...form, singleIpv4: event.target.value })}
                      placeholder="203.0.113.10"
                      className="mono"
                    />
                  </Field>
                  <Field label="Allowed IPv6 address" hint="Optional.">
                    <Input
                      value={form.singleIpv6}
                      onChange={(event) => setForm({ ...form, singleIpv6: event.target.value })}
                      placeholder="2001:db8::1"
                      className="mono"
                    />
                  </Field>
                </div>
              )}

              {form.allowType === 'range' && (
                <div className="form-grid">
                  <Field label="Range start IPv4">
                    <Input
                      value={form.rangeStartIpv4}
                      onChange={(event) => setForm({ ...form, rangeStartIpv4: event.target.value })}
                      placeholder="203.0.113.10"
                      className="mono"
                    />
                  </Field>
                  <Field label="Range end IPv4">
                    <Input
                      value={form.rangeEndIpv4}
                      onChange={(event) => setForm({ ...form, rangeEndIpv4: event.target.value })}
                      placeholder="203.0.113.20"
                      className="mono"
                    />
                  </Field>
                  <Field label="Range start IPv6">
                    <Input
                      value={form.rangeStartIpv6}
                      onChange={(event) => setForm({ ...form, rangeStartIpv6: event.target.value })}
                      placeholder="2001:db8::1"
                      className="mono"
                    />
                  </Field>
                  <Field label="Range end IPv6">
                    <Input
                      value={form.rangeEndIpv6}
                      onChange={(event) => setForm({ ...form, rangeEndIpv6: event.target.value })}
                      placeholder="2001:db8::20"
                      className="mono"
                    />
                  </Field>
                </div>
              )}

              <div className="detail-grid">
                <div>
                  <span>Remote IPv4 address</span>
                  <strong className="mono">{remote.data.addresses.ipv4 || 'Not available'}</strong>
                </div>
                <div>
                  <span>Remote IPv6 address</span>
                  <strong className="mono small">{remote.data.addresses.ipv6 || 'Not available'}</strong>
                </div>
              </div>

              <div className="card-foot-row">
                <span className="muted small">The router may briefly restart its web server.</span>
                <Button variant="primary" onClick={() => void save()} loading={saving}>
                  Save remote access
                </Button>
              </div>
            </Card>
          </>
        )
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function AdvancedPage() {
  const [tab, setTab] = useState<AdvancedTab>('triggers');

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Gateway features</span>
          <h2>Advanced network</h2>
          <p>Trigger ports, UPnP, DMZ, and remote management in one place.</p>
        </div>
      </div>

      <Tabs
        tabs={[
          { id: 'triggers', label: 'Port triggering' },
          { id: 'upnp', label: 'UPnP' },
          { id: 'dmz', label: 'DMZ' },
          { id: 'remote', label: 'Remote management' },
        ]}
        active={tab}
        onChange={(id) => setTab(id as AdvancedTab)}
      />

      {tab === 'triggers' && <TriggersPanel />}
      {tab === 'upnp' && <UpnpPanel />}
      {tab === 'dmz' && <DmzPanel />}
      {tab === 'remote' && <RemotePanel />}
    </div>
  );
}
