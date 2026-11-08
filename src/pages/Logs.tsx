import { useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, ScrollText, SearchX } from 'lucide-react';
import { api, errorMessage } from '../api';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  InlineError,
  SearchInput,
  Select,
  Skeleton,
  useToast,
} from '../components/ui';
import type { LogEntry } from '../types';

const MODES = [
  { value: 'system', label: 'System logs' },
  { value: 'event', label: 'Event logs' },
  { value: 'firewall', label: 'Firewall logs' },
];

const TIMEFRAMES = ['Today', 'Yesterday', 'Last week', 'Last month', 'Last 90 days'];

function levelTone(level: string): 'good' | 'bad' | 'warn' | 'info' | 'neutral' {
  const text = level.toLowerCase();
  if (/emerg|alert|crit|error|fail/.test(text)) return 'bad';
  if (/warn/.test(text)) return 'warn';
  if (/notice/.test(text)) return 'info';
  if (/info/.test(text)) return 'good';
  return 'neutral';
}

export function LogsPage() {
  const toast = useToast();
  const [mode, setMode] = useState('system');
  const [timeframe, setTimeframe] = useState('Today');
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await api.logs(mode, timeframe);
      setEntries(result.entries);
    } catch (failure) {
      const message = errorMessage(failure);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!entries) return null;
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) =>
      [entry.time, entry.level, entry.description].join(' ').toLowerCase().includes(needle),
    );
  }, [entries, query]);

  function download() {
    if (!entries) return;
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `xfinity-${mode}-${timeframe.replace(/\s+/g, '-').toLowerCase()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Troubleshooting</span>
          <h2>Logs</h2>
          <p>Pull system, event, and firewall logs for a specific time range.</p>
        </div>
        <Button
          variant="secondary"
          icon={<RefreshCw size={15} />}
          loading={loading}
          onClick={() => void load()}
        >
          Refresh
        </Button>
      </div>

      <Card>
        <div className="logs-toolbar">
          <Field label="Log type">
            <Select value={mode} onChange={(event) => setMode(event.target.value)}>
              {MODES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Time frame">
            <Select value={timeframe} onChange={(event) => setTimeframe(event.target.value)}>
              {TIMEFRAMES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="primary" onClick={() => void load()} loading={loading}>
            Show logs
          </Button>
          <div className="logs-toolbar-spacer" />
          <SearchInput value={query} onChange={setQuery} placeholder="Filter log entries…" />
          <Button
            variant="ghost"
            icon={<Download size={14} />}
            onClick={download}
            disabled={!entries || entries.length === 0}
          >
            Export
          </Button>
        </div>

        {error ? (
          <InlineError message={error} onRetry={() => void load()} />
        ) : loading ? (
          <Skeleton lines={9} />
        ) : !filtered ? (
          <EmptyState
            icon={<ScrollText size={20} />}
            title="No logs loaded"
            message="Choose a log type and time frame, then show logs."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<SearchX size={20} />}
            title={query ? 'No matching entries' : 'No log entries'}
            message={query ? 'Try a different filter.' : 'The router returned no entries for this time frame.'}
          />
        ) : (
          <>
            <div className="log-summary">
              <span>
                Showing <strong>{filtered.length}</strong> {filtered.length === 1 ? 'entry' : 'entries'}
              </span>
              <Badge tone="info">{MODES.find((option) => option.value === mode)?.label}</Badge>
              <Badge tone="neutral">{timeframe}</Badge>
            </div>
            <div className="table-wrap log-table-wrap">
              <table className="data-table log-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Level</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((entry, index) => (
                    <tr key={`${entry.time}-${index}`}>
                      <td className="mono small log-time">{entry.time || '—'}</td>
                      <td>
                        <Badge tone={levelTone(entry.level)}>{entry.level || '—'}</Badge>
                      </td>
                      <td className="log-description">{entry.description || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <div className="info-note">
        <ScrollText size={16} />
        <span>
          Logs are served by the gateway and can take a few seconds to collect for longer time ranges.
        </span>
      </div>
    </div>
  );
}
