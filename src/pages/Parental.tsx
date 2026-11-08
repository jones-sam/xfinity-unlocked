import { useMemo, useState } from 'react';
import {
  CalendarClock,
  CircleHelp,
  Globe,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldX,
  Timer,
  Trash2,
  UserCheck,
  Users,
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
  ManagedService,
  ParentalRule,
  ReportEntry,
  TrustedComputer,
} from '../types';

const DAYS = [
  { value: 'Mon', label: 'Mon' },
  { value: 'Tue', label: 'Tue' },
  { value: 'Wed', label: 'Wed' },
  { value: 'Thu', label: 'Thu' },
  { value: 'Fri', label: 'Fri' },
  { value: 'Sat', label: 'Sat' },
  { value: 'Sun', label: 'Sun' },
];

const REPORTS_TIMEFRAMES = ['Today', 'Yesterday', 'Last week', 'Last month', 'Last 90 days'];

interface SiteForm {
  value: string;
  alwaysBlock: boolean;
  startTime: string;
  endTime: string;
  days: string[];
}

const EMPTY_SITE_FORM: SiteForm = {
  value: '',
  alwaysBlock: true,
  startTime: '00:00',
  endTime: '23:59',
  days: DAYS.map((day) => day.value),
};

interface ServiceForm {
  name: string;
  protocol: string;
  startPort: string;
  endPort: string;
  alwaysBlock: boolean;
  startTime: string;
  endTime: string;
  days: string[];
}

const EMPTY_SERVICE_FORM: ServiceForm = {
  name: '',
  protocol: 'BOTH',
  startPort: '',
  endPort: '',
  alwaysBlock: true,
  startTime: '00:00',
  endTime: '23:59',
  days: DAYS.map((day) => day.value),
};

function DayPicker({ value, onChange }: { value: string[]; onChange: (days: string[]) => void }) {
  return (
    <div className="day-picker">
      {DAYS.map((day) => (
        <button
          key={day.value}
          type="button"
          className={cx('day-chip', value.includes(day.value) && 'is-selected')}
          onClick={() =>
            onChange(
              value.includes(day.value)
                ? value.filter((item) => item !== day.value)
                : [...value, day.value],
            )
          }
        >
          {day.label}
        </button>
      ))}
    </div>
  );
}

function TrustedTable({
  computers,
  onToggle,
  busyId,
  disabled,
}: {
  computers: TrustedComputer[];
  onToggle: (computer: TrustedComputer) => void;
  busyId: number | null;
  disabled?: boolean;
}) {
  if (computers.length === 0) {
    return (
      <EmptyState
        icon={<Users size={20} />}
        title="No computers reported"
        message="The gateway did not return a trusted-computer list."
      />
    );
  }
  return (
    <div className="table-wrap">
      <table className="data-table compact-table">
        <thead>
          <tr>
            <th>Computer</th>
            <th>Address</th>
            <th>Status</th>
            <th aria-label="Trust" />
          </tr>
        </thead>
        <tbody>
          {computers.map((computer) => (
            <tr key={`${computer.id}-${computer.address}`}>
              <td>
                <div className="device-name-cell compact">
                  <span className="device-avatar is-online">
                    <UserCheck size={14} />
                  </span>
                  <strong>{computer.name || 'Unnamed'}</strong>
                </div>
              </td>
              <td className="mono small">{computer.address}</td>
              <td>
                <Badge tone={computer.trusted ? 'good' : 'warn'} dot>
                  {computer.trusted ? 'Trusted' : 'Restricted'}
                </Badge>
              </td>
              <td className="cell-actions">
                <Toggle
                  checked={computer.trusted}
                  disabled={disabled || busyId === computer.id}
                  onChange={() => onToggle(computer)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RulesTable({
  rules,
  emptyTitle,
  emptyMessage,
  onDelete,
  disabled,
}: {
  rules: ParentalRule[];
  emptyTitle: string;
  emptyMessage: string;
  onDelete: (rule: ParentalRule) => void;
  disabled?: boolean;
}) {
  if (rules.length === 0) {
    return <EmptyState icon={<ShieldCheck size={20} />} title={emptyTitle} message={emptyMessage} />;
  }
  return (
    <div className="table-wrap">
      <table className="data-table compact-table">
        <thead>
          <tr>
            <th>Value</th>
            <th>When</th>
            <th aria-label="Delete" />
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => (
            <tr key={`${rule.id}-${rule.value}`}>
              <td>
                <div className="rule-value">
                  <Globe size={14} />
                  <span>{rule.value}</span>
                </div>
              </td>
              <td>
                <span className={cx('when-cell', /always/i.test(rule.when) && 'is-always')}>
                  <CalendarClock size={13} />
                  {rule.when || 'Always'}
                </span>
              </td>
              <td className="cell-actions">
                <button
                  type="button"
                  className="row-action danger"
                  onClick={() => onDelete(rule)}
                  disabled={disabled}
                  title={disabled ? 'Enable this feature to remove rules' : 'Remove'}
                >
                  <Trash2 size={15} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ParentalPage() {
  const sites = useAsync(() => api.parentalSites(), []);
  const services = useAsync(() => api.parentalServices(), []);
  const toast = useToast();
  const [tab, setTab] = useState<'sites' | 'services' | 'reports'>('sites');

  const [sitesBusy, setSitesBusy] = useState(false);
  const [servicesBusy, setServicesBusy] = useState(false);
  const [trustBusy, setTrustBusy] = useState<number | null>(null);

  const [siteModal, setSiteModal] = useState<'site' | 'keyword' | null>(null);
  const [siteForm, setSiteForm] = useState<SiteForm>(EMPTY_SITE_FORM);
  const [siteSaving, setSiteSaving] = useState(false);
  const [siteError, setSiteError] = useState('');

  const [serviceModal, setServiceModal] = useState(false);
  const [serviceEditing, setServiceEditing] = useState<ManagedService | null>(null);
  const [serviceForm, setServiceForm] = useState<ServiceForm>(EMPTY_SERVICE_FORM);
  const [serviceSaving, setServiceSaving] = useState(false);
  const [serviceError, setServiceError] = useState('');

  const [deleteSite, setDeleteSite] = useState<ParentalRule | null>(null);
  const [deleteService, setDeleteService] = useState<ManagedService | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [reportMode, setReportMode] = useState('all');
  const [reportTimeframe, setReportTimeframe] = useState('Today');
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [reportEntries, setReportEntries] = useState<ReportEntry[] | null>(null);

  const siteData = sites.data;
  const serviceData = services.data;

  function openSiteModal(type: 'site' | 'keyword') {
    setSiteForm(EMPTY_SITE_FORM);
    setSiteError('');
    setSiteModal(type);
  }

  async function saveSite() {
    if (!siteModal) return;
    setSiteError('');
    if (!siteForm.value.trim()) {
      setSiteError(siteModal === 'site' ? 'Enter a URL or domain.' : 'Enter a keyword.');
      return;
    }
    if (!siteForm.alwaysBlock && siteForm.days.length === 0) {
      setSiteError('Choose at least one day for the schedule.');
      return;
    }
    setSiteSaving(true);
    try {
      const next = await api.addParentalSite({
        type: siteModal,
        value: siteForm.value.trim(),
        alwaysBlock: siteForm.alwaysBlock,
        startTime: siteForm.startTime,
        endTime: siteForm.endTime,
        days: siteForm.days,
      });
      sites.setData(next);
      toast.success(siteModal === 'site' ? 'Site blocked.' : 'Keyword blocked.');
      setSiteModal(null);
    } catch (error) {
      setSiteError(errorMessage(error));
    } finally {
      setSiteSaving(false);
    }
  }

  function openServiceModal(service?: ManagedService) {
    if (service) {
      setServiceEditing(service);
      setServiceForm({
        name: service.name,
        protocol: service.protocol === 'TCP/UDP' ? 'BOTH' : service.protocol || 'BOTH',
        startPort: service.startPort,
        endPort: service.endPort,
        alwaysBlock: /always/i.test(service.when),
        startTime: '00:00',
        endTime: '23:59',
        days: DAYS.map((day) => day.value),
      });
    } else {
      setServiceEditing(null);
      setServiceForm(EMPTY_SERVICE_FORM);
    }
    setServiceError('');
    setServiceModal(true);
  }

  async function saveService() {
    setServiceError('');
    const start = Number(serviceForm.startPort);
    const end = Number(serviceForm.endPort);
    if (!serviceForm.name.trim()) {
      setServiceError('Give the service a name.');
      return;
    }
    if (!Number.isInteger(start) || start < 1 || start > 65535) {
      setServiceError('The start port must be between 1 and 65535.');
      return;
    }
    if (!Number.isInteger(end) || end < start || end > 65535) {
      setServiceError('The end port must be at or above the start port.');
      return;
    }
    if (!serviceForm.alwaysBlock && serviceForm.days.length === 0) {
      setServiceError('Choose at least one day for the schedule.');
      return;
    }
    setServiceSaving(true);
    try {
      const payload = {
        name: serviceForm.name.trim(),
        protocol: serviceForm.protocol,
        startPort: start,
        endPort: end,
        alwaysBlock: serviceForm.alwaysBlock,
        startTime: serviceForm.startTime,
        endTime: serviceForm.endTime,
        days: serviceForm.days,
      };
      const next = serviceEditing
        ? await api.updateManagedService(serviceEditing.id ?? 0, payload)
        : await api.addManagedService(payload);
      services.setData(next);
      toast.success(serviceEditing ? 'Managed service updated.' : 'Managed service added.');
      setServiceModal(false);
    } catch (error) {
      setServiceError(errorMessage(error));
    } finally {
      setServiceSaving(false);
    }
  }

  async function toggleSitesEnabled(enabled: boolean) {
    setSitesBusy(true);
    try {
      sites.setData(await api.setParentalSitesEnabled(enabled));
      toast.success(`Managed sites ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSitesBusy(false);
    }
  }

  async function toggleServicesEnabled(enabled: boolean) {
    setServicesBusy(true);
    try {
      services.setData(await api.setParentalServicesEnabled(enabled));
      toast.success(`Managed services ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setServicesBusy(false);
    }
  }

  async function trustComputer(computer: TrustedComputer, scope: 'sites' | 'services') {
    if (computer.id === null) return;
    setTrustBusy(computer.id);
    try {
      if (scope === 'sites') {
        await api.trustSiteComputer({
          id: computer.id,
          trusted: !computer.trusted,
          name: computer.name,
          address: computer.address,
        });
        sites.setData(await api.parentalSites());
      } else {
        await api.trustServiceComputer({
          id: computer.id,
          trusted: !computer.trusted,
          name: computer.name,
          address: computer.address,
        });
        services.setData(await api.parentalServices());
      }
      toast.success('Computer trust updated.');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setTrustBusy(null);
    }
  }

  async function confirmDelete(kind: 'site' | 'service') {
    setDeleteBusy(true);
    try {
      if (kind === 'site' && deleteSite?.id != null) {
        sites.setData(await api.deleteParentalSite(String(deleteSite.id)));
        toast.success('Rule removed.');
      } else if (kind === 'service' && deleteService?.id != null) {
        services.setData(await api.deleteManagedService(deleteService.id));
        toast.success('Managed service removed.');
      }
      setDeleteSite(null);
      setDeleteService(null);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeleteBusy(false);
    }
  }

  async function runReport() {
    setReportLoading(true);
    setReportError('');
    setReportEntries(null);
    try {
      const result = await api.reports(reportMode, reportTimeframe);
      setReportEntries(result.entries);
    } catch (error) {
      setReportError(errorMessage(error));
    } finally {
      setReportLoading(false);
    }
  }

  const reportColumns = useMemo(() => {
    if (!reportEntries || reportEntries.length === 0) return [];
    const keys = new Set<string>();
    for (const entry of reportEntries.slice(0, 20)) {
      for (const key of Object.keys(entry)) keys.add(key);
    }
    const preferred = ['time', 'Des', 'Count', 'Type', 'Source', 'Target'];
    return [...preferred.filter((key) => keys.has(key)), ...[...keys].filter((key) => !preferred.includes(key))];
  }, [reportEntries]);

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Family protection</span>
          <h2>Parental controls</h2>
          <p>Block sites and services, schedule rules, and trust specific computers.</p>
        </div>
        <Button
          variant="secondary"
          icon={<RefreshCw size={15} />}
          loading={sites.loading || services.loading}
          onClick={() => {
            void sites.reload(true);
            void services.reload(true);
          }}
        >
          Refresh
        </Button>
      </div>

      <Tabs
        tabs={[
          { id: 'sites', label: 'Managed sites', count: siteData ? siteData.sites.length + siteData.keywords.length : undefined },
          { id: 'services', label: 'Managed services', count: serviceData?.services.length },
          { id: 'reports', label: 'Reports' },
        ]}
        active={tab}
        onChange={(id) => setTab(id as typeof tab)}
      />

      {tab === 'sites' && (
        <>
          {sites.error && !siteData && <InlineError message={sites.error} onRetry={() => void sites.reload()} />}
          {sites.loading && !siteData ? (
            <Card>
              <Skeleton lines={7} />
            </Card>
          ) : (
            siteData && (
              <>
                <div className="master-card">
                  <div className="master-main">
                    <span className={cx('master-icon', siteData.enabled ? 'is-on' : 'is-off')}>
                      <ShieldCheck size={20} />
                    </span>
                    <div>
                      <div className="master-title-row">
                        <h3>Managed sites</h3>
                        <Badge tone={siteData.enabled ? 'good' : 'neutral'} dot>
                          {siteData.enabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                      </div>
                      <p>Apply blocked URLs and keywords to non-trusted computers.</p>
                    </div>
                  </div>
                  <Toggle
                    checked={siteData.enabled}
                    disabled={sitesBusy}
                    onChange={(value) => void toggleSitesEnabled(value)}
                    label="Managed sites"
                  />
                </div>

                {!siteData.enabled && (
                  <div className="info-note compact">
                    <CircleHelp size={15} />
                    <span>Enable managed sites to add or remove rules and change trusted computers.</span>
                  </div>
                )}

                <div className="grid grid-2">
                  <Card
                    title="Blocked sites"
                    subtitle="URLs and domains"
                    actions={
                      <Button
                        size="sm"
                        variant="soft"
                        icon={<Plus size={14} />}
                        onClick={() => openSiteModal('site')}
                        disabled={!siteData.enabled}
                      >
                        Add site
                      </Button>
                    }
                    padded={false}
                  >
                    <RulesTable
                      rules={siteData.sites}
                      emptyTitle="No blocked sites"
                      emptyMessage="Add a URL or domain to block it."
                      onDelete={setDeleteSite}
                      disabled={!siteData.enabled}
                    />
                  </Card>
                  <Card
                    title="Blocked keywords"
                    subtitle="Matching terms in URLs"
                    actions={
                      <Button
                        size="sm"
                        variant="soft"
                        icon={<Plus size={14} />}
                        onClick={() => openSiteModal('keyword')}
                        disabled={!siteData.enabled}
                      >
                        Add keyword
                      </Button>
                    }
                    padded={false}
                  >
                    <RulesTable
                      rules={siteData.keywords}
                      emptyTitle="No blocked keywords"
                      emptyMessage="Add a keyword to block matching URLs."
                      onDelete={setDeleteSite}
                      disabled={!siteData.enabled}
                    />
                  </Card>
                </div>

                <Card title="Trusted computers" subtitle="Trusted hosts bypass site rules" padded={false}>
                  <TrustedTable
                    computers={siteData.trusted}
                    busyId={trustBusy}
                    onToggle={(computer) => void trustComputer(computer, 'sites')}
                    disabled={!siteData.enabled}
                  />
                </Card>
              </>
            )
          )}
        </>
      )}

      {tab === 'services' && (
        <>
          {services.error && !serviceData && <InlineError message={services.error} onRetry={() => void services.reload()} />}
          {services.loading && !serviceData ? (
            <Card>
              <Skeleton lines={7} />
            </Card>
          ) : (
            serviceData && (
              <>
                <div className="master-card">
                  <div className="master-main">
                    <span className={cx('master-icon', serviceData.enabled ? 'is-on' : 'is-off')}>
                      <ShieldX size={20} />
                    </span>
                    <div>
                      <div className="master-title-row">
                        <h3>Managed services</h3>
                        <Badge tone={serviceData.enabled ? 'good' : 'neutral'} dot>
                          {serviceData.enabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                      </div>
                      <p>Block applications by protocol and port range, with optional schedules.</p>
                    </div>
                  </div>
                  <Toggle
                    checked={serviceData.enabled}
                    disabled={servicesBusy}
                    onChange={(value) => void toggleServicesEnabled(value)}
                    label="Managed services"
                  />
                </div>

                {!serviceData.enabled && (
                  <div className="info-note compact">
                    <CircleHelp size={15} />
                    <span>Enable managed services to add, edit, or remove rules and change trusted computers.</span>
                  </div>
                )}

                <Card
                  title="Blocked services"
                  subtitle="Protocol and port rules"
                  padded={false}
                  actions={
                    <Button
                      size="sm"
                      variant="soft"
                      icon={<Plus size={14} />}
                      onClick={() => openServiceModal()}
                      disabled={!serviceData.enabled}
                    >
                      Add service
                    </Button>
                  }
                >
                  {serviceData.services.length === 0 ? (
                    <EmptyState
                      icon={<ShieldX size={20} />}
                      title="No managed services"
                      message="Add a service to block it for non-trusted computers."
                    />
                  ) : (
                    <div className="table-wrap">
                      <table className="data-table compact-table">
                        <thead>
                          <tr>
                            <th>Service</th>
                            <th>Protocol</th>
                            <th>Ports</th>
                            <th>When</th>
                            <th aria-label="Actions" />
                          </tr>
                        </thead>
                        <tbody>
                          {serviceData.services.map((service) => (
                            <tr key={`${service.id}-${service.name}`}>
                              <td>
                                <strong>{service.name}</strong>
                              </td>
                              <td>
                                <Badge tone="info">{service.protocol}</Badge>
                              </td>
                              <td className="mono">
                                {service.startPort === service.endPort
                                  ? service.startPort
                                  : `${service.startPort}–${service.endPort}`}
                              </td>
                              <td>
                                <span className="when-cell">
                                  <Timer size={13} />
                                  {service.when || 'Always'}
                                </span>
                              </td>
                              <td className="cell-actions">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => openServiceModal(service)}
                                  disabled={!serviceData.enabled}
                                >
                                  Edit
                                </Button>
                                <button
                                  type="button"
                                  className="row-action danger"
                                  onClick={() => setDeleteService(service)}
                                  disabled={!serviceData.enabled}
                                  title={
                                    serviceData.enabled
                                      ? 'Delete service'
                                      : 'Enable managed services to delete rules'
                                  }
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

                <Card title="Trusted computers" subtitle="Trusted hosts bypass service rules" padded={false}>
                  <TrustedTable
                    computers={serviceData.trusted}
                    busyId={trustBusy}
                    onToggle={(computer) => void trustComputer(computer, 'services')}
                    disabled={!serviceData.enabled}
                  />
                </Card>
              </>
            )
          )}
        </>
      )}

      {tab === 'reports' && (
        <Card
          title="Internet access reports"
          subtitle="Blocked site, service, and device activity"
          actions={
            <div className="report-controls">
              <Select value={reportMode} onChange={(event) => setReportMode(event.target.value)}>
                <option value="all">All activity</option>
                <option value="site">Sites</option>
                <option value="service">Services</option>
                <option value="device">Devices</option>
              </Select>
              <Select value={reportTimeframe} onChange={(event) => setReportTimeframe(event.target.value)}>
                {REPORTS_TIMEFRAMES.map((timeframe) => (
                  <option key={timeframe} value={timeframe}>
                    {timeframe}
                  </option>
                ))}
              </Select>
              <Button variant="primary" icon={<Search size={14} />} onClick={() => void runReport()} loading={reportLoading}>
                Run report
              </Button>
            </div>
          }
        >
          <div className="info-note compact">
            <CircleHelp size={15} />
            <span>Reports are generated on the router and can take up to a minute to return.</span>
          </div>

          {reportError && <div className="form-error">{reportError}</div>}

          {reportLoading ? (
            <Skeleton lines={6} />
          ) : reportEntries === null ? (
            <EmptyState
              icon={<Search size={20} />}
              title="No report loaded"
              message="Choose a range and run the report to see blocked activity."
            />
          ) : reportEntries.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck size={20} />}
              title="Nothing was blocked"
              message="No matching entries were found for this time frame."
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table compact-table">
                <thead>
                  <tr>
                    {reportColumns.map((column) => (
                      <th key={column}>{column === 'Des' ? 'Description' : column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reportEntries.map((entry, index) => (
                    <tr key={index}>
                      {reportColumns.map((column) => (
                        <td key={column} className={column === 'time' ? 'mono small' : undefined}>
                          {String(entry[column] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Modal
        open={siteModal !== null}
        onClose={() => {
          if (!siteSaving) setSiteModal(null);
        }}
        title={siteModal === 'keyword' ? 'Block a keyword' : 'Block a site'}
        subtitle={
          siteModal === 'keyword'
            ? 'Any URL containing this term is blocked.'
            : 'Enter a domain or URL, for example example.com.'
        }
        footer={
          <>
            <Button onClick={() => setSiteModal(null)} disabled={siteSaving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void saveSite()} loading={siteSaving}>
              Block {siteModal === 'keyword' ? 'keyword' : 'site'}
            </Button>
          </>
        }
      >
        <div className="form-stack">
          {siteError && <div className="form-error">{siteError}</div>}
          <Field label={siteModal === 'keyword' ? 'Keyword' : 'URL or domain'}>
            <Input
              value={siteForm.value}
              onChange={(event) => setSiteForm({ ...siteForm, value: event.target.value })}
              placeholder={siteModal === 'keyword' ? 'example' : 'example.com'}
              autoFocus
            />
          </Field>

          <Toggle
            checked={siteForm.alwaysBlock}
            onChange={(value) => setSiteForm({ ...siteForm, alwaysBlock: value })}
            label="Block at all times"
            description="Turn off to set a daily time window and active days."
          />

          {!siteForm.alwaysBlock && (
            <div className="schedule-panel">
              <div className="form-grid">
                <Field label="Start time">
                  <Input
                    type="time"
                    value={siteForm.startTime}
                    onChange={(event) => setSiteForm({ ...siteForm, startTime: event.target.value })}
                  />
                </Field>
                <Field label="End time">
                  <Input
                    type="time"
                    value={siteForm.endTime}
                    onChange={(event) => setSiteForm({ ...siteForm, endTime: event.target.value })}
                  />
                </Field>
              </div>
              <Field label="Active days">
                <DayPicker
                  value={siteForm.days}
                  onChange={(days) => setSiteForm({ ...siteForm, days })}
                />
              </Field>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={serviceModal}
        onClose={() => {
          if (!serviceSaving) setServiceModal(false);
        }}
        title={serviceEditing ? 'Edit managed service' : 'Add managed service'}
        subtitle="Block traffic by protocol and destination port range."
        footer={
          <>
            <Button onClick={() => setServiceModal(false)} disabled={serviceSaving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void saveService()} loading={serviceSaving}>
              {serviceEditing ? 'Save service' : 'Add service'}
            </Button>
          </>
        }
      >
        <div className="form-stack">
          {serviceError && <div className="form-error">{serviceError}</div>}
          <div className="form-grid">
            <Field label="Service name" className="span-2">
              <Input
                value={serviceForm.name}
                onChange={(event) => setServiceForm({ ...serviceForm, name: event.target.value })}
                placeholder="e.g. Video games"
              />
            </Field>
            <Field label="Protocol">
              <Select
                value={serviceForm.protocol}
                onChange={(event) => setServiceForm({ ...serviceForm, protocol: event.target.value })}
              >
                <option value="BOTH">TCP and UDP</option>
                <option value="TCP">TCP</option>
                <option value="UDP">UDP</option>
              </Select>
            </Field>
            <div className="form-grid form-grid-tight">
              <Field label="Start port">
                <Input
                  value={serviceForm.startPort}
                  onChange={(event) => setServiceForm({ ...serviceForm, startPort: event.target.value })}
                  inputMode="numeric"
                  className="mono"
                />
              </Field>
              <Field label="End port">
                <Input
                  value={serviceForm.endPort}
                  onChange={(event) => setServiceForm({ ...serviceForm, endPort: event.target.value })}
                  inputMode="numeric"
                  className="mono"
                />
              </Field>
            </div>
          </div>

          <Toggle
            checked={serviceForm.alwaysBlock}
            onChange={(value) => setServiceForm({ ...serviceForm, alwaysBlock: value })}
            label="Block at all times"
            description="Turn off to set a daily window and active days."
          />

          {!serviceForm.alwaysBlock && (
            <div className="schedule-panel">
              <div className="form-grid">
                <Field label="Start time">
                  <Input
                    type="time"
                    value={serviceForm.startTime}
                    onChange={(event) => setServiceForm({ ...serviceForm, startTime: event.target.value })}
                  />
                </Field>
                <Field label="End time">
                  <Input
                    type="time"
                    value={serviceForm.endTime}
                    onChange={(event) => setServiceForm({ ...serviceForm, endTime: event.target.value })}
                  />
                </Field>
              </div>
              <Field label="Active days">
                <DayPicker
                  value={serviceForm.days}
                  onChange={(days) => setServiceForm({ ...serviceForm, days })}
                />
              </Field>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmModal
        open={Boolean(deleteSite) || Boolean(deleteService)}
        onClose={() => (deleteBusy ? undefined : (setDeleteSite(null), setDeleteService(null)))}
        onConfirm={() => void confirmDelete(deleteSite ? 'site' : 'service')}
        title="Remove rule"
        message={
          deleteSite
            ? `Remove “${deleteSite.value}” from the block list?`
            : deleteService
              ? `Remove “${deleteService.name}” from managed services?`
              : undefined
        }
        confirmLabel="Remove"
        danger
        busy={deleteBusy}
      />
    </div>
  );
}
