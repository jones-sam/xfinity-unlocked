import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { api, errorMessage } from '../api';
import {
  Badge,
  Button,
  Card,
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
  useAsync,
  useToast,
} from '../components/ui';
import type { MacFilterInfo, SsidEditInfo } from '../types';

const MODE_LABELS: Record<string, string> = {
  allow_all: 'Disabled',
  allow: 'Allow listed devices only',
  deny: 'Block listed devices',
};

interface SsidForm {
  name: string;
  security: string;
  password: string;
  mode: string;
  channelAutomatic: boolean;
  channel: string;
  bandwidth: string;
  broadcast: boolean;
  wmm: boolean;
  enabled: boolean;
}

function formFrom(info: SsidEditInfo): SsidForm {
  return {
    name: info.name,
    security: info.security,
    password: info.password,
    mode: info.mode,
    channelAutomatic: info.channelAutomatic,
    channel: info.channel,
    bandwidth: info.bandwidth,
    broadcast: info.broadcast,
    wmm: info.wmm,
    enabled: info.enabled,
  };
}

export function WifiPage() {
  const wifi = useAsync(() => api.wifi(), []);
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const openedFromQuery = useRef(false);

  const [editId, setEditId] = useState<number | null>(null);
  const [editInfo, setEditInfo] = useState<SsidEditInfo | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [form, setForm] = useState<SsidForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [filterSsid, setFilterSsid] = useState<number | null>(null);
  const [filterData, setFilterData] = useState<MacFilterInfo | null>(null);
  const [filterMode, setFilterMode] = useState('allow_all');
  const [filterEntries, setFilterEntries] = useState<Array<{ name: string; mac: string }>>([]);
  const [filterLoading, setFilterLoading] = useState(false);
  const [filterSaving, setFilterSaving] = useState(false);
  const [filterError, setFilterError] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualMac, setManualMac] = useState('');
  const [pickMac, setPickMac] = useState('');

  async function openSsidEditor(id: number) {
    setEditId(id);
    setEditLoading(true);
    setEditInfo(null);
    setForm(null);
    setFormError('');
    setShowPassword(false);
    try {
      const info = await api.ssid(id);
      setEditInfo(info);
      setForm(formFrom(info));
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setEditLoading(false);
    }
  }

  useEffect(() => {
    const requested = searchParams.get('edit');
    if (!requested || openedFromQuery.current) return;
    if (requested === '1' || requested === '2') {
      openedFromQuery.current = true;
      void openSsidEditor(Number(requested));
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  async function saveSsid() {
    if (!editId || !form || !editInfo) return;
    setFormError('');
    if (!form.name.trim()) {
      setFormError('Enter a network name.');
      return;
    }
    if (form.security !== 'None' && (form.password.length < 8 || form.password.length > 63)) {
      setFormError('The Wi-Fi password must be 8 to 63 characters.');
      return;
    }
    if (!form.channelAutomatic && !form.channel) {
      setFormError('Choose a channel or enable automatic selection.');
      return;
    }
    setSaving(true);
    try {
      await api.updateSsid(editId, {
        name: form.name.trim(),
        security: form.security,
        password: form.password,
        mode: form.mode,
        channelAutomatic: form.channelAutomatic,
        channel: form.channel,
        bandwidth: form.bandwidth,
        broadcast: form.broadcast,
        wmm: form.wmm,
        enabled: form.enabled,
      });
      toast.success('Wi-Fi settings sent. Radios may take up to a minute to restart.');
      setEditId(null);
      setEditInfo(null);
      setForm(null);
      void wifi.reload(true);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function openFilter(ssid: number) {
    setFilterSsid(ssid);
    setFilterData(null);
    setFilterLoading(true);
    setFilterError('');
    setManualName('');
    setManualMac('');
    setPickMac('');
    try {
      const info = await api.macFilter(ssid);
      setFilterData(info);
      setFilterMode(info.mode);
      setFilterEntries(info.entries);
    } catch (error) {
      setFilterError(errorMessage(error));
    } finally {
      setFilterLoading(false);
    }
  }

  function addManualEntry() {
    const mac = manualMac.trim().toUpperCase();
    if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) {
      setFilterError('Enter a MAC address in AA:BB:CC:DD:EE:FF format.');
      return;
    }
    if (filterEntries.some((entry) => entry.mac.toUpperCase() === mac)) {
      setFilterError('That MAC address is already in the list.');
      return;
    }
    setFilterEntries((entries) => [...entries, { name: manualName.trim() || mac, mac }]);
    setManualName('');
    setManualMac('');
    setFilterError('');
  }

  function addAvailable(mac: string) {
    const match = filterData?.available.find((entry) => entry.mac === mac);
    if (!match) return;
    setFilterEntries((entries) => [...entries, match]);
    setPickMac('');
  }

  async function saveFilter() {
    if (!filterSsid) return;
    setFilterSaving(true);
    setFilterError('');
    try {
      await api.updateMacFilter(filterSsid, filterMode, filterEntries);
      toast.success('MAC filter saved.');
      setFilterSsid(null);
      void wifi.reload(true);
    } catch (error) {
      setFilterError(errorMessage(error));
    } finally {
      setFilterSaving(false);
    }
  }

  const available = useMemo(
    () =>
      (filterData?.available ?? []).filter(
        (entry) => !filterEntries.some((existing) => existing.mac.toUpperCase() === entry.mac.toUpperCase()),
      ),
    [filterData, filterEntries],
  );

  const ssids = wifi.data?.ssids ?? [];

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Wireless</span>
          <h2>Wi-Fi networks and radios</h2>
          <p>Inspect every band, tune the two editable networks, and audit MAC filtering.</p>
        </div>
        <Button
          variant="secondary"
          icon={<RefreshCw size={15} />}
          loading={wifi.loading}
          onClick={() => void wifi.reload(true)}
        >
          Refresh
        </Button>
      </div>

      {wifi.error && !wifi.data && <InlineError message={wifi.error} onRetry={() => void wifi.reload()} />}

      <div className="warning-note">
        <Info size={17} />
        <div>
          <strong>Some controls are read-only on this firmware.</strong>
          <p>
            The Rogers admin account cannot change radio on/off or WPS state through the web UI — the
            gateway silently ignores those writes. The dashboard shows their real state but does not
            pretend to change them. The 6 GHz network is also read-only on this build.
          </p>
        </div>
      </div>

      {wifi.loading && !wifi.data ? (
        <div className="grid grid-3">
          {[0, 1, 2].map((index) => (
            <Card key={index}>
              <Skeleton lines={5} />
            </Card>
          ))}
        </div>
      ) : (
        <>
          <div className="ssid-grid">
            {ssids.map((ssid) => {
              const editable = ssid.id === 1 || ssid.id === 2;
              return (
                <div className="ssid-card" key={ssid.id}>
                  <div className="ssid-card-head">
                    <span className="ssid-band">{ssid.band || 'Wi-Fi'}</span>
                    <Badge tone={editable ? 'info' : 'neutral'}>{editable ? 'Editable' : 'Read-only'}</Badge>
                  </div>
                  <div className="ssid-card-icon">
                    <Wifi size={20} />
                  </div>
                  <h3>{ssid.name || 'Hidden network'}</h3>
                  <dl className="ssid-meta">
                    <div>
                      <dt>Security</dt>
                      <dd>{ssid.security || 'Unknown'}</dd>
                    </div>
                    <div>
                      <dt>BSSID</dt>
                      <dd className="mono small">{ssid.mac || '—'}</dd>
                    </div>
                  </dl>
                  <div className="ssid-card-foot">
                    {editable ? (
                      <Button
                        size="sm"
                        variant="soft"
                        icon={<Pencil size={14} />}
                        onClick={() => void openSsidEditor(ssid.id)}
                      >
                        Edit network
                      </Button>
                    ) : (
                      <span className="muted small">Managed by the gateway</span>
                    )}
                    {editable && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<ShieldCheck size={14} />}
                        onClick={() => void openFilter(ssid.id)}
                      >
                        MAC filter
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-3">
            {(wifi.data?.radios ?? []).map((radio) => (
              <Card
                key={radio.band}
                title={radio.band}
                subtitle={radio.enabled ? 'Radio enabled' : 'Radio disabled'}
                actions={
                  <StatusDot on={radio.enabled} label={radio.enabled ? 'On' : 'Off'} />
                }
              >
                <dl className="radio-grid">
                  <div>
                    <dt>Mode</dt>
                    <dd>{radio.mode || '—'}</dd>
                  </div>
                  <div>
                    <dt>Channel</dt>
                    <dd>
                      {radio.channel || '—'}
                      {radio.channelAutomatic ? <Badge tone="info">Auto</Badge> : <Badge tone="neutral">Manual</Badge>}
                    </dd>
                  </div>
                  <div>
                    <dt>Transmit power</dt>
                    <dd>{radio.transmitPower || '—'}</dd>
                  </div>
                </dl>
                {radio.advanced.length > 0 && (
                  <details className="advanced-details">
                    <summary>Advanced radio settings</summary>
                    <dl className="kv-list compact">
                      {radio.advanced.map((row) => (
                        <div className="kv-row" key={row.label}>
                          <dt>{row.label.replace(/:$/, '')}</dt>
                          <dd>{row.value || '—'}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                )}
              </Card>
            ))}
          </div>

          <div className="grid grid-2">
            <Card title="WPS" subtitle="Wi-Fi Protected Setup state">
              <div className="setting-line">
                <span className="setting-icon">{wifi.data?.wps.enabled ? <Wifi size={18} /> : <WifiOff size={18} />}</span>
                <div>
                  <strong>{wifi.data?.wps.enabled ? 'WPS is enabled' : 'WPS is disabled'}</strong>
                  <span className="muted">Method: {wifi.data?.wps.method || 'Unknown'}</span>
                </div>
                <Badge tone={wifi.data?.wps.enabled ? 'warn' : 'good'}>
                  {wifi.data?.wps.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
              <p className="card-note">
                WPS toggling is ignored for this admin account. State is shown for reference only.
              </p>
            </Card>

            <Card title="MAC filtering" subtitle="Access control summary">
              <div className="setting-line">
                <span className="setting-icon">
                  <ShieldCheck size={18} />
                </span>
                <div>
                  <strong>{MODE_LABELS[wifi.data?.macFilter.mode ?? 'allow_all'] || wifi.data?.macFilter.mode}</strong>
                  <span className="muted">
                    {wifi.data?.macFilter.enabled ? 'Filtering is active' : 'No MAC filter is active'}
                  </span>
                </div>
                <Badge tone={wifi.data?.macFilter.enabled ? 'info' : 'neutral'}>
                  {wifi.data?.macFilter.enabled ? 'Active' : 'Off'}
                </Badge>
              </div>
              <div className="button-row">
                <Button size="sm" variant="soft" onClick={() => void openFilter(1)}>
                  Manage 2.4 GHz
                </Button>
                <Button size="sm" variant="soft" onClick={() => void openFilter(2)}>
                  Manage 5 GHz
                </Button>
              </div>
            </Card>
          </div>

          {(wifi.data?.otherNetworks.length || wifi.data?.publicNetworks.length) ? (
            <Card title="Other networks" subtitle="Additional SSIDs broadcast by this gateway">
              <div className="table-wrap">
                <table className="data-table compact-table">
                  <thead>
                    <tr>
                      <th>Network</th>
                      <th>Band</th>
                      <th>Security</th>
                      <th>BSSID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...(wifi.data?.otherNetworks ?? []), ...(wifi.data?.publicNetworks ?? [])].map((network) => (
                      <tr key={`${network.band}-${network.mac}-${network.name}`}>
                        <td>{network.name}</td>
                        <td>{network.band}</td>
                        <td>{network.security}</td>
                        <td className="mono small">{network.mac}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </>
      )}

      <Modal
        open={editId !== null}
        onClose={() => {
          if (saving) return;
          setEditId(null);
          setEditInfo(null);
          setForm(null);
        }}
        title={editInfo ? `Edit ${editInfo.band || 'Wi-Fi'} network` : 'Loading network…'}
        subtitle={editInfo ? `SSID ${editInfo.ssidNumber}` : undefined}
        size="lg"
        footer={
          <>
            <Button
              onClick={() => {
                setEditId(null);
                setEditInfo(null);
                setForm(null);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void saveSsid()} loading={saving} disabled={!form}>
              Save network
            </Button>
          </>
        }
      >
        {editLoading ? (
          <Skeleton lines={8} />
        ) : formError && !form ? (
          <div className="form-error">{formError}</div>
        ) : (
          form &&
          editInfo && (
            <div className="form-stack">
              {formError && <div className="form-error">{formError}</div>}

              {/wpa3/i.test(editInfo.security) && (
                <div className="warning-note compact">
                  <AlertTriangle size={16} />
                  <div>
                    <strong>WPA3 warning</strong>
                    <p>
                      Some builds of this firmware silently rewrite WPA3 to WPA2 when saving through this
                      handler. Check the security mode after saving and be ready to reconnect devices.
                    </p>
                  </div>
                </div>
              )}

              <div className="form-grid">
                <Field label="Network name (SSID)" className="span-2">
                  <Input
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    maxLength={32}
                  />
                </Field>

                <Field label="Security mode">
                  <Select
                    value={form.security}
                    onChange={(event) => setForm({ ...form, security: event.target.value })}
                  >
                    {editInfo.securities.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Password" hint="8–63 characters">
                  <div className="input-with-icon">
                    <KeyRound size={16} />
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={(event) => setForm({ ...form, password: event.target.value })}
                      disabled={form.security === 'None'}
                    />
                    <button
                      type="button"
                      className="input-icon-button"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </Field>

                <Field label="Wireless mode">
                  <Select
                    value={form.mode}
                    onChange={(event) => setForm({ ...form, mode: event.target.value })}
                  >
                    {editInfo.modes.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Channel width">
                  <Select
                    value={form.bandwidth}
                    onChange={(event) => setForm({ ...form, bandwidth: event.target.value })}
                  >
                    {editInfo.bandwidths.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="form-grid">
                <div className="field">
                  <span className="field-label">Channel selection</span>
                  <div className="inline-controls">
                    <Toggle
                      checked={form.channelAutomatic}
                      onChange={(value) => setForm({ ...form, channelAutomatic: value })}
                      label="Automatic"
                    />
                    <Select
                      value={form.channel}
                      onChange={(event) => setForm({ ...form, channel: event.target.value })}
                      disabled={form.channelAutomatic}
                    >
                      {editInfo.channels.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              </div>

              <div className="toggle-stack">
                <Toggle
                  checked={form.broadcast}
                  onChange={(value) => setForm({ ...form, broadcast: value })}
                  label="Broadcast network name"
                  description="Turn off to hide the SSID from scans."
                />
                <Toggle
                  checked={form.wmm}
                  onChange={(value) => setForm({ ...form, wmm: value })}
                  label="WMM"
                  description="Wi-Fi Multimedia quality-of-service prioritization."
                />
                <Toggle
                  checked={form.enabled}
                  onChange={(value) => setForm({ ...form, enabled: value })}
                  label="Network enabled"
                  description="Disabling the SSID stops clients from joining this band."
                />
              </div>

              <div className="info-note compact">
                <Info size={15} />
                <span>
                  Saving restarts the radio for this band. Connected clients will briefly drop and then
                  reconnect.
                </span>
              </div>

              <div className="button-row">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<ShieldCheck size={14} />}
                  onClick={() => {
                    setEditId(null);
                    setEditInfo(null);
                    setForm(null);
                    void openFilter(editInfo.id);
                  }}
                >
                  Manage MAC filter for this network
                </Button>
              </div>
            </div>
          )
        )}
      </Modal>

      <Modal
        open={filterSsid !== null}
        onClose={() => {
          if (!filterSaving) setFilterSsid(null);
        }}
        title={filterSsid ? `MAC filter — ${filterSsid === 1 ? '2.4 GHz' : '5 GHz'}` : 'MAC filter'}
        subtitle="Allow or block specific client hardware addresses"
        size="lg"
        footer={
          <>
            <Button onClick={() => setFilterSsid(null)} disabled={filterSaving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void saveFilter()} loading={filterSaving} disabled={filterLoading}>
              Save filter
            </Button>
          </>
        }
      >
        {filterLoading ? (
          <Skeleton lines={6} />
        ) : (
          <div className="form-stack">
            {filterError && <div className="form-error">{filterError}</div>}

            <Field label="Filtering mode">
              <Select value={filterMode} onChange={(event) => setFilterMode(event.target.value)}>
                <option value="allow_all">Disabled — every device may join</option>
                <option value="allow">Allow only listed devices</option>
                <option value="deny">Block listed devices</option>
              </Select>
            </Field>

            <div className="filter-entry-head">
              <span>{filterEntries.length} listed device{filterEntries.length === 1 ? '' : 's'}</span>
            </div>

            {filterEntries.length === 0 ? (
              <EmptyState
                icon={<ShieldCheck size={20} />}
                title="No MAC addresses listed"
                message="Add a device below to build the filter list."
              />
            ) : (
              <ul className="filter-list">
                {filterEntries.map((entry) => (
                  <li key={entry.mac}>
                    <span className="filter-avatar">
                      <Lock size={14} />
                    </span>
                    <div>
                      <strong>{entry.name || 'Unnamed device'}</strong>
                      <span className="mono small">{entry.mac}</span>
                    </div>
                    <button
                      type="button"
                      className="ghost-icon danger"
                      onClick={() =>
                        setFilterEntries((entries) => entries.filter((item) => item.mac !== entry.mac))
                      }
                      aria-label={`Remove ${entry.mac}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="add-entry-panel">
              <h4>
                <Plus size={15} /> Add a device
              </h4>
              {available.length > 0 && (
                <div className="inline-controls">
                  <Select value={pickMac} onChange={(event) => addAvailable(event.target.value)}>
                    <option value="">Choose a connected device…</option>
                    {available.map((entry) => (
                      <option key={entry.mac} value={entry.mac}>
                        {entry.name} — {entry.mac}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              <div className="manual-entry">
                <Input
                  value={manualName}
                  onChange={(event) => setManualName(event.target.value)}
                  placeholder="Label (optional)"
                />
                <Input
                  value={manualMac}
                  onChange={(event) => setManualMac(event.target.value)}
                  placeholder="AA:BB:CC:DD:EE:FF"
                  className="mono"
                />
                <Button variant="soft" icon={<Plus size={14} />} onClick={addManualEntry}>
                  Add
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
