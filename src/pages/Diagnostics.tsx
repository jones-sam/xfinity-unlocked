import { useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  CircleHelp,
  Globe,
  Network,
  Radio,
  RefreshCw,
  Route,
  Search,
  Timer,
} from 'lucide-react';
import { api, errorMessage } from '../api';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  useToast,
} from '../components/ui';

function valueTone(value: unknown): 'good' | 'bad' | 'warn' | 'neutral' {
  const text = String(value).toLowerCase();
  if (/error|fail|inactive|unreachable/.test(text)) return 'bad';
  if (/ok|active|success|complete/.test(text)) return 'good';
  if (/progress|requested|pending/.test(text)) return 'warn';
  return 'neutral';
}

function ResultBlock({ result }: { result: unknown }) {
  if (result === null || result === undefined) return null;
  if (typeof result === 'string') {
    return <pre className="result-pre">{result}</pre>;
  }
  if (Array.isArray(result)) {
    return (
      <ol className="result-list">
        {result.map((item, index) => (
          <li key={index}>
            <span className="result-index">{index + 1}</span>
            <span>{typeof item === 'string' ? item : JSON.stringify(item)}</span>
          </li>
        ))}
      </ol>
    );
  }
  if (typeof result === 'object') {
    return (
      <dl className="result-grid">
        {Object.entries(result as Record<string, unknown>).map(([key, value]) => (
          <div key={key} className="result-row">
            <dt>{key.replace(/_/g, ' ')}</dt>
            <dd>
              {Array.isArray(value) ? (
                <ol className="result-list compact">
                  {value.map((item, index) => (
                    <li key={index}>
                      <span className="result-index">{index + 1}</span>
                      <span>{typeof item === 'string' ? item : JSON.stringify(item)}</span>
                    </li>
                  ))}
                </ol>
              ) : typeof value === 'object' && value !== null ? (
                <code className="small">{JSON.stringify(value)}</code>
              ) : (
                <Badge tone={valueTone(value)}>{String(value ?? '—')}</Badge>
              )}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <code>{String(result)}</code>;
}

function ProbeCard({
  title,
  description,
  icon,
  run,
  placeholder,
  defaultDestination = '',
  defaultCount = '4',
  runLabel = 'Run test',
  note,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  run: (destination: string, count: number) => Promise<unknown>;
  placeholder: string;
  defaultDestination?: string;
  defaultCount?: string;
  runLabel?: string;
  note?: ReactNode;
}) {
  const [destination, setDestination] = useState(defaultDestination);
  const [count, setCount] = useState(defaultCount);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState('');
  const toast = useToast();

  async function execute() {
    if (!destination.trim()) {
      setError('Enter a destination first.');
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const response = await run(destination.trim(), Number(count));
      setResult(response);
    } catch (failure) {
      const message = errorMessage(failure);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={
        <span className="title-with-icon">
          {icon}
          {title}
        </span>
      }
      subtitle={description}
      actions={
        <Button size="sm" variant="soft" icon={<Search size={14} />} onClick={() => void execute()} loading={busy}>
          {runLabel}
        </Button>
      }
    >
      <div className="probe-form">
        <Field label="Destination">
          <Input
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            placeholder={placeholder}
            className="mono"
            onKeyDown={(event) => {
              if (event.key === 'Enter') void execute();
            }}
          />
        </Field>
        <Field label="Count">
          <Select value={count} onChange={(event) => setCount(event.target.value)}>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
          </Select>
        </Field>
      </div>

      {note && <div className="probe-note">{note}</div>}
      {error && <div className="form-error">{error}</div>}

      {busy ? (
        <Skeleton lines={3} />
      ) : result ? (
        <ResultBlock result={result} />
      ) : (
        <p className="muted small">No result yet. Run the test to query the router.</p>
      )}
    </Card>
  );
}

function SpectrumCard() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState('');
  const toast = useToast();

  async function scan() {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(await api.spectrum());
    } catch (failure) {
      const message = errorMessage(failure);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  const record = result && typeof result === 'object' ? (result as Record<string, unknown>) : null;
  const rows = Array.isArray(record?.data) ? (record.data as Array<Record<string, unknown>>) : [];
  const columns = useMemo(() => {
    const keys = new Set<string>();
    for (const row of rows.slice(0, 8)) {
      for (const key of Object.keys(row)) keys.add(key);
    }
    return [...keys];
  }, [rows]);

  return (
    <Card
      title={
        <span className="title-with-icon">
          <Radio size={18} />
          Wi-Fi spectrum analyser
        </span>
      }
      subtitle="Scan neighbouring access points and channel occupancy"
      actions={
        <Button size="sm" variant="soft" icon={<RefreshCw size={14} />} onClick={() => void scan()} loading={busy}>
          Run scan
        </Button>
      }
    >
      <div className="probe-note">
        This scan can take a few seconds. Results show nearby networks, their channels, and signal
        strength.
      </div>
      {error && <div className="form-error">{error}</div>}
      {busy ? (
        <Skeleton lines={5} />
      ) : result === null ? (
        <EmptyState
          icon={<Radio size={20} />}
          title="No scan loaded"
          message="Run the analyser to list nearby Wi-Fi networks."
        />
      ) : rows.length > 0 ? (
        <>
          {record?.status && (
            <div className="spectrum-status">
              <Badge tone={valueTone(record.status)}>{String(record.status)}</Badge>
              <span className="muted small">{rows.length} neighbouring networks found</span>
            </div>
          )}
          <div className="table-wrap">
            <table className="data-table compact-table">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index}>
                    {columns.map((column) => (
                      <td key={column} className={column === 'BSSID' ? 'mono small' : undefined}>
                        {String(row[column] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <ResultBlock result={result} />
      )}
    </Card>
  );
}

export function DiagnosticsPage() {
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Connectivity tools</span>
          <h2>Diagnostics</h2>
          <p>Ping from the router, trace a path, and inspect nearby Wi-Fi channels.</p>
        </div>
      </div>

      <div className="diagnostics-grid">
        <ProbeCard
          title="Internet connectivity"
          description="Ping from the gateway to check general internet reachability."
          icon={<Globe size={18} />}
          run={(destination, count) => api.ping(destination, count)}
          placeholder="e.g. 8.8.8.8"
          defaultDestination="8.8.8.8"
          note={
            <span>
              <CircleHelp size={13} /> Uses the gateway's IP ping diagnostic. The router accepts counts
              from 1 to 4.
            </span>
          }
        />
        <ProbeCard
          title="IPv4 connectivity"
          description="Ping an IPv4 host from the WAN interface."
          icon={<Network size={18} />}
          run={(destination, count) => api.ipv4Test(destination, count)}
          placeholder="1.1.1.1"
          defaultDestination="1.1.1.1"
        />
        <ProbeCard
          title="IPv6 connectivity"
          description="Ping an IPv6 host from the WAN interface."
          icon={<Network size={18} />}
          run={(destination, count) => api.ipv6Test(destination, count)}
          placeholder="2606:4700:4700::1111"
          defaultDestination="2606:4700:4700::1111"
        />
        <ProbeCard
          title="Traceroute"
          description="Trace the path from the gateway to an IPv4 destination."
          icon={<Route size={18} />}
          run={(destination) => api.traceroute(destination)}
          placeholder="e.g. 8.8.8.8"
          defaultDestination="8.8.8.8"
          defaultCount="1"
          runLabel="Trace"
          note={
            <span>
              <Timer size={13} /> Traceroute can run for up to a minute or longer on a long path.
            </span>
          }
        />
      </div>

      <SpectrumCard />

      <div className="info-note">
        <Activity size={16} />
        <span>
          Diagnostics run on the router itself, so they test the gateway's connection rather than this
          computer's Wi-Fi link.
        </span>
      </div>
    </div>
  );
}
