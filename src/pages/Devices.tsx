import { useMemo, useState } from 'react';
import {
  CircleHelp,
  Laptop,
  Pencil,
  RefreshCw,
  SearchX,
  Smartphone,
  Wifi,
} from 'lucide-react';
import { api, errorMessage } from '../api';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  InlineError,
  Modal,
  SearchInput,
  Skeleton,
  StatCard,
  Tabs,
  Textarea,
  cx,
  useAsync,
  useToast,
} from '../components/ui';
import type { DeviceRecord } from '../types';

type Filter = 'all' | 'online' | 'offline';

export function DevicesPage() {
  const devices = useAsync(() => api.devices(), []);
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<DeviceRecord | null>(null);
  const [mode, setMode] = useState<'dhcp' | 'reserved'>('dhcp');
  const [reservedIp, setReservedIp] = useState('');
  const [comments, setComments] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const summary = devices.data?.summary;
  const list = devices.data?.devices ?? [];

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return list.filter((device) => {
      if (filter === 'online' && !device.online) return false;
      if (filter === 'offline' && device.online) return false;
      if (!needle) return true;
      return [device.name, device.ipv4, device.ipv6, device.mac, device.comments, device.connection]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [list, filter, query]);

  function openEditor(device: DeviceRecord) {
    setEditing(device);
    setMode(device.addressMode === 'reserved' ? 'reserved' : 'dhcp');
    setReservedIp(device.reservedIp || device.ipv4 || '');
    setComments(device.comments || '');
    setFormError('');
  }

  async function saveDevice() {
    if (!editing) return;
    setFormError('');
    if (mode === 'reserved' && !/^\d{1,3}(\.\d{1,3}){3}$/.test(reservedIp.trim())) {
      setFormError('Enter a valid IPv4 address to reserve.');
      return;
    }
    const action =
      mode === 'reserved' ? 'reserve' : editing.addressMode === 'reserved' ? 'unreserve' : 'comments';
    setSaving(true);
    try {
      const next = await api.saveDevice({
        action,
        name: editing.name,
        mac: editing.mac,
        comments: comments.trim(),
        reservedIp: mode === 'reserved' ? reservedIp.trim() : undefined,
        addressMode: editing.addressMode,
      });
      devices.setData(next);
      toast.success(
        action === 'reserve'
          ? 'Address reservation saved.'
          : action === 'unreserve'
            ? 'Reservation removed.'
            : 'Device comments updated.',
      );
      setEditing(null);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Clients</span>
          <h2>Connected devices</h2>
          <p>Every host the gateway knows about, including offline reservations.</p>
        </div>
        <Button
          variant="secondary"
          icon={<RefreshCw size={15} />}
          loading={devices.loading}
          onClick={() => void devices.reload(true)}
        >
          Refresh
        </Button>
      </div>

      {devices.error && !devices.data && <InlineError message={devices.error} onRetry={() => void devices.reload()} />}

      {summary && (
        <div className="grid grid-4">
          <StatCard label="Online" value={summary.online} hint={`${summary.total} known hosts`} icon={<Wifi size={18} />} tone="good" />
          <StatCard label="Offline" value={summary.offline} hint="Still holding a lease or reservation" icon={<Laptop size={18} />} />
          <StatCard
            label="Wireless"
            value={summary.wifi2 + summary.wifi5 + summary.wifi6}
            hint={`${summary.wifi2} on 2.4 · ${summary.wifi5} on 5 · ${summary.wifi6} on 6 GHz`}
            icon={<Smartphone size={18} />}
            tone="violet"
          />
          <StatCard label="Wired" value={summary.ethernet} hint="Ethernet connections" icon={<Laptop size={18} />} />
        </div>
      )}

      <Card padded={false}>
        <div className="table-toolbar">
          <Tabs
            tabs={[
              { id: 'all', label: 'All', count: summary?.total },
              { id: 'online', label: 'Online', count: summary?.online },
              { id: 'offline', label: 'Offline', count: summary?.offline },
            ]}
            active={filter}
            onChange={(id) => setFilter(id as Filter)}
          />
          <SearchInput value={query} onChange={setQuery} placeholder="Search name, IP, MAC…" />
        </div>

        {devices.loading && !devices.data ? (
          <div className="card-pad">
            <Skeleton lines={8} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={query ? <SearchX size={22} /> : <Laptop size={22} />}
            title={query ? 'No matching devices' : 'No devices in this view'}
            message={query ? 'Try a different name, address, or MAC.' : 'The gateway has not reported any hosts here.'}
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table devices-table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Status</th>
                  <th>IPv4</th>
                  <th>Connection</th>
                  <th>Addressing</th>
                  <th>MAC</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((device) => (
                  <tr key={`${device.mac}-${device.id}`}>
                    <td>
                      <div className="device-name-cell">
                        <span className={cx('device-avatar', device.online ? 'is-online' : 'is-offline')}>
                          {/iphone|android|phone|mobile|watch/i.test(device.name) ? (
                            <Smartphone size={16} />
                          ) : (
                            <Laptop size={16} />
                          )}
                        </span>
                        <div>
                          <strong>{device.name || 'Unnamed device'}</strong>
                          {device.comments && <span className="cell-sub">{device.comments}</span>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <Badge tone={device.online ? 'good' : 'neutral'} dot>
                        {device.online ? 'Online' : 'Offline'}
                      </Badge>
                    </td>
                    <td className="mono">{device.ipv4 || '—'}</td>
                    <td>
                      <div className="cell-stack">
                        <span>{device.connection || '—'}</span>
                        {device.rssi && <span className="cell-sub">RSSI {device.rssi}</span>}
                      </div>
                    </td>
                    <td>
                      <div className="cell-stack">
                        <Badge tone={device.addressMode === 'reserved' ? 'info' : device.addressMode === 'dhcp' ? 'neutral' : 'warn'}>
                          {device.addressMode === 'reserved' ? 'Reserved' : device.addressMode === 'dhcp' ? 'DHCP' : 'Unknown'}
                        </Badge>
                        {device.reservedIp && <span className="cell-sub mono">{device.reservedIp}</span>}
                      </div>
                    </td>
                    <td className="mono small">{device.mac || '—'}</td>
                    <td className="cell-actions">
                      <button
                        type="button"
                        className="row-action"
                        onClick={() => openEditor(device)}
                        disabled={!device.editForm}
                        title={device.editForm ? 'Edit device' : 'This device cannot be edited on this firmware'}
                      >
                        <Pencil size={15} />
                        <span>Edit</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!devices.loading && list.some((device) => !device.blockable) && (
        <div className="info-note">
          <CircleHelp size={16} />
          <span>
            Device blocking on this firmware is controlled by the Xfinity app. This dashboard can edit
            comments and DHCP reservations, but not pause individual devices.
          </span>
        </div>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.name || 'Edit device'}
        subtitle={editing ? `${editing.mac} · ${editing.online ? 'Online' : 'Offline'}` : undefined}
        footer={
          <>
            <Button onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void saveDevice()} loading={saving}>
              Save device
            </Button>
          </>
        }
      >
        {editing && (
          <div className="form-stack">
            {formError && <div className="form-error">{formError}</div>}

            <div className="detail-grid">
              <div>
                <span>IPv4</span>
                <strong className="mono">{editing.ipv4 || '—'}</strong>
              </div>
              <div>
                <span>IPv6</span>
                <strong className="mono small">{editing.ipv6 || '—'}</strong>
              </div>
              <div>
                <span>Link-local</span>
                <strong className="mono small">{editing.linkLocalIpv6 || '—'}</strong>
              </div>
              <div>
                <span>Connection</span>
                <strong>{editing.connection || '—'}</strong>
              </div>
            </div>

            <div className="choice-grid">
              <label className={cx('choice-card', mode === 'dhcp' && 'is-selected')}>
                <input
                  type="radio"
                  name="addressing"
                  checked={mode === 'dhcp'}
                  onChange={() => setMode('dhcp')}
                />
                <div>
                  <strong>DHCP lease</strong>
                  <span>The router assigns the address automatically.</span>
                </div>
              </label>
              <label className={cx('choice-card', mode === 'reserved' && 'is-selected')}>
                <input
                  type="radio"
                  name="addressing"
                  checked={mode === 'reserved'}
                  onChange={() => setMode('reserved')}
                />
                <div>
                  <strong>Reserved address</strong>
                  <span>Keep this device on a fixed IP.</span>
                </div>
              </label>
            </div>

            {mode === 'reserved' && (
              <Field label="Reserved IPv4 address" hint="Must be inside the LAN subnet and outside the DHCP pool conflicts.">
                <Input
                  value={reservedIp}
                  onChange={(event) => setReservedIp(event.target.value)}
                  placeholder="10.0.0.50"
                  className="mono"
                />
              </Field>
            )}

            <Field label="Comments" hint="Shown in the device list. Line breaks are flattened by the router.">
              <Textarea
                value={comments}
                onChange={(event) => setComments(event.target.value)}
                rows={3}
                maxLength={63}
                placeholder="e.g. Living room TV"
              />
            </Field>

            <div className="info-note compact">
              <CircleHelp size={15} />
              <span>
                The router applies host changes immediately. Devices may renew their lease the next time
                they reconnect.
              </span>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
