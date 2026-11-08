import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isIPv4, isIPv6 } from 'node:net';
import { RouterClient, RouterError } from './client.js';

export type PfProtocol = 'TCP' | 'UDP' | 'TCP/UDP';

export interface PortForwardRule {
  id: number;
  name: string;
  protocol: PfProtocol | null;
  externalPorts: string;
  internalPorts: string;
  externalStart: string;
  externalEnd: string;
  internalClient: string;
  enabled: boolean | null;
  managedByApp: boolean;
  detailsKnown: boolean;
}

export interface PortForwardState {
  enabled: boolean | null;
  rules: PortForwardRule[];
  scannedAt: number;
  scanMs: number;
  scanLimit: number;
}

export interface RuleInput {
  name: string;
  protocol: PfProtocol;
  internalClient: string;
  startPort: number;
  endPort: number;
}

interface RuleMeta {
  name?: string;
  protocol?: PfProtocol;
  internalClient?: string;
  startPort?: number;
  endPort?: number;
  enabled?: boolean;
  updatedAt: number;
}

type MetaStore = Record<string, Record<string, RuleMeta>>;

const DATA_DIR = process.env.XU_DATA_DIR || path.resolve(process.cwd(), '.data');
const META_FILE = path.join(DATA_DIR, 'pf-metadata.json');
const SCAN_LIMIT = Math.max(8, Math.min(128, Number(process.env.XU_PF_SCAN_MAX) || 40));
const CACHE_TTL_MS = 20_000;
const COMMON_SERVICES = new Set(['ftp', 'aim', 'http', 'pptp', 'https', 'telnet', 'ssh']);

let metaCache: MetaStore | null = null;
let metaLoad: Promise<MetaStore> | null = null;
let metaWriteChain: Promise<unknown> = Promise.resolve();

async function loadMetaStore(): Promise<MetaStore> {
  if (metaCache) return metaCache;
  if (!metaLoad) {
    metaLoad = (async () => {
      try {
        const raw = await readFile(META_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        metaCache = parsed && typeof parsed === 'object' ? (parsed as MetaStore) : {};
      } catch {
        metaCache = {};
      }
      return metaCache;
    })();
  }
  return metaLoad;
}

async function persistMetaStore(store: MetaStore): Promise<void> {
  const run = metaWriteChain.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    const temp = `${META_FILE}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(store, null, 2), 'utf8');
    await rename(temp, META_FILE);
  });
  metaWriteChain = run.catch(() => undefined);
  await run;
}

async function mutateMeta(
  gateway: string,
  mutate: (rules: Record<string, RuleMeta>) => void,
): Promise<void> {
  const store = await loadMetaStore();
  if (!store[gateway]) store[gateway] = {};
  mutate(store[gateway]);
  await persistMetaStore(store);
}

async function readMeta(gateway: string): Promise<Record<string, RuleMeta>> {
  const store = await loadMetaStore();
  return store[gateway] || {};
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&nbsp;/g, ' ');
}

function readJsString(scripts: string, name: string): string {
  const pattern = new RegExp(`var\\s+${name}\\s*=\\s*(['"])((?:\\\\.|(?!\\1)[\\s\\S])*)\\1`);
  const match = scripts.match(pattern);
  if (!match) return '';
  return decodeHtmlEntities(match[2].replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\'))
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMasterState(html: string): boolean | null {
  const match = html.match(/state:\s*(true|false)\s*\?\s*["']on["']/);
  return match ? match[1] === 'true' : null;
}

function portsLabel(start: string, end: string): string {
  if (!start && !end) return '';
  if (!start) return end;
  if (!end || start === end) return start;
  return `${start}-${end}`;
}

function normalizeRouterMessage(raw: string): string {
  let text = decodeHtmlEntities(raw.trim());
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'string') text = parsed;
    } catch {
      text = text.slice(1, -1);
    }
  }
  return text.replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function assertName(name: string): string {
  const value = name.trim();
  if (!value) throw new RouterError('Give the port forward a name.', 'invalid_input');
  if (value.length > 63) throw new RouterError('The name must be 63 characters or fewer.', 'invalid_input');
  if (/[<>&"'|]/.test(value)) {
    throw new RouterError('The name cannot contain < > & " \' or | characters.', 'invalid_input');
  }
  if (!/^[\x20-\x7e]+$/.test(value)) {
    throw new RouterError('The name must use plain printable characters.', 'invalid_input');
  }
  return value;
}

function assertPort(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new RouterError(`${label} must be between 1 and 65535.`, 'invalid_input');
  }
  return value;
}

function assertClient(value: string): string {
  const client = value.trim();
  if (!client) throw new RouterError('Enter the internal client IP address.', 'invalid_input');
  if (!isIPv4(client) && !isIPv6(client)) {
    throw new RouterError('The internal client must be a valid IPv4 or IPv6 address.', 'invalid_input');
  }
  return client;
}

function toRuleInput(input: RuleInput) {
  const name = assertName(input.name);
  const protocol = input.protocol;
  if (!['TCP', 'UDP', 'TCP/UDP'].includes(protocol)) {
    throw new RouterError('Choose TCP, UDP, or both.', 'invalid_input');
  }
  const startPort = assertPort(Number(input.startPort), 'Start port');
  const endPort = assertPort(Number(input.endPort), 'End port');
  if (startPort > endPort) {
    throw new RouterError('The start port must be less than or equal to the end port.', 'invalid_input');
  }
  const internalClient = assertClient(input.internalClient);
  return { name, protocol, startPort, endPort, internalClient };
}

export class PortForwardingService {
  private state: PortForwardState | null = null;
  private inflight: Promise<PortForwardState> | null = null;

  constructor(
    private readonly client: RouterClient,
    private readonly gateway: string,
  ) {}

  private async probeRule(id: number): Promise<PortForwardRule | null> {
    const path = `/port_forwarding_edit.jst?id=${id}`;
    const result = await this.client.getPagesConcurrent([path], 1, 0);
    const html = result[0]?.html || '';
    if (!html || !html.includes('id="portfwdedthead"')) return null;
    const scripts = html.match(/<script[\s\S]*?<\/script>/gi)?.join('\n') || html;
    const idMatch = scripts.match(/var\s+ID\s*=\s*"(\d+)"/);
    if (!idMatch || Number(idMatch[1]) !== id) return null;
    return {
      id,
      name: readJsString(scripts, 'service_name'),
      protocol: null,
      externalPorts: '',
      internalPorts: '',
      externalStart: readJsString(scripts, 'startport'),
      externalEnd: readJsString(scripts, 'endport'),
      internalClient: '',
      enabled: null,
      managedByApp: false,
      detailsKnown: false,
    };
  }

  async getState(force = false): Promise<PortForwardState> {
    if (!force && this.state && Date.now() - this.state.scannedAt < CACHE_TTL_MS) {
      return this.state;
    }
    if (this.inflight) return this.inflight;

    this.inflight = (async () => {
      const started = Date.now();
      const masterHtml = await this.client.getPage('/port_forwarding.jst', force ? 0 : 4_000);
      const masterEnabled = parseMasterState(masterHtml);

      const paths = Array.from({ length: SCAN_LIMIT }, (_, index) => `/port_forwarding_edit.jst?id=${index + 1}`);
      const pages = await this.client.getPagesConcurrent(paths, 3, 45);
      const meta = await readMeta(this.gateway);
      const rules: PortForwardRule[] = [];

      for (const page of pages) {
        if (!page.html || !page.html.includes('id="portfwdedthead"')) continue;
        const idMatch = page.path.match(/id=(\d+)/);
        if (!idMatch) continue;
        const id = Number(idMatch[1]);
        const scripts = page.html.match(/<script[\s\S]*?<\/script>/gi)?.join('\n') || page.html;
        const idVar = scripts.match(/var\s+ID\s*=\s*"(\d+)"/);
        if (!idVar || Number(idVar[1]) !== id) continue;

        const observedName = readJsString(scripts, 'service_name');
        const observedStart = readJsString(scripts, 'startport');
        const observedEnd = readJsString(scripts, 'endport');
        let stored: RuleMeta | undefined = meta[String(id)];

        // Delete stale metadata when the router instance was reused for a
        // different rule. Common service names are not exposed by the page,
        // so an empty observed name is not enough to call the metadata stale.
        if (stored) {
          if (observedName && stored.name && observedName !== stored.name) stored = undefined;
          else if (observedStart && stored.startPort && Number(observedStart) !== stored.startPort) stored = undefined;
          else if (observedEnd && stored.endPort && Number(observedEnd) !== stored.endPort) stored = undefined;
        }

        const externalStart = observedStart || (stored?.startPort != null ? String(stored.startPort) : '');
        const externalEnd = observedEnd || (stored?.endPort != null ? String(stored.endPort) : '');
        const detailsKnown = Boolean(stored?.protocol && stored?.internalClient);
        rules.push({
          id,
          name: observedName || stored?.name || '',
          protocol: stored?.protocol || null,
          externalPorts: portsLabel(externalStart, externalEnd),
          internalPorts: portsLabel(externalStart, externalEnd),
          externalStart,
          externalEnd,
          internalClient: stored?.internalClient || '',
          enabled: stored?.enabled ?? null,
          managedByApp: detailsKnown,
          detailsKnown,
        });
      }

      rules.sort((a, b) => a.id - b.id);

      // Drop metadata for rules that no longer exist, but only when every
      // probe completed. A partial scan must not discard good metadata.
      const scanComplete = pages.length === SCAN_LIMIT && pages.every((page) => page.status >= 200 && page.status < 400);
      if (scanComplete) {
        const discovered = new Set(rules.map((rule) => rule.id));
        const hasStale = Object.keys(meta).some(
          (key) => Number(key) <= SCAN_LIMIT && !discovered.has(Number(key)),
        );
        if (hasStale) {
          await mutateMeta(this.gateway, (stored) => {
            for (const key of Object.keys(stored)) {
              if (Number(key) <= SCAN_LIMIT && !discovered.has(Number(key))) delete stored[key];
            }
          });
        }
      }

      this.state = {
        enabled: masterEnabled,
        rules,
        scannedAt: Date.now(),
        scanMs: Date.now() - started,
        scanLimit: SCAN_LIMIT,
      };
      return this.state;
    })().finally(() => {
      this.inflight = null;
    });

    return this.inflight;
  }

  private async findNewRule(previousIds: Set<number>, input: ReturnType<typeof toRuleInput>): Promise<number | null> {
    const next = await this.getState(true);
    const candidates = next.rules.filter((rule) => !previousIds.has(rule.id));
    if (!candidates.length) return null;
    const exact = candidates.find(
      (rule) =>
        (!rule.name || rule.name === input.name) &&
        (!rule.externalStart || Number(rule.externalStart) === input.startPort) &&
        (!rule.externalEnd || Number(rule.externalEnd) === input.endPort),
    );
    return (exact || candidates[0]).id;
  }

  private async writeMeta(id: number, input: ReturnType<typeof toRuleInput>, enabled = true) {
    await mutateMeta(this.gateway, (rules) => {
      rules[String(id)] = {
        name: input.name,
        protocol: input.protocol,
        internalClient: input.internalClient,
        startPort: input.startPort,
        endPort: input.endPort,
        enabled,
        updatedAt: Date.now(),
      };
    });
    // Reflect the metadata in the cached scan so the API response the user
    // receives immediately after adding a rule already has full details.
    const cached = this.state?.rules.find((rule) => rule.id === id);
    if (cached) {
      cached.name = input.name;
      cached.protocol = input.protocol;
      cached.internalClient = input.internalClient;
      cached.externalStart = String(input.startPort);
      cached.externalEnd = String(input.endPort);
      cached.externalPorts = portsLabel(cached.externalStart, cached.externalEnd);
      cached.internalPorts = cached.externalPorts;
      cached.enabled = enabled;
      cached.managedByApp = true;
      cached.detailsKnown = true;
    }
  }

  async addRule(rawInput: RuleInput): Promise<{ ruleId: number | null; state: PortForwardState }> {
    const input = toRuleInput(rawInput);
    const before = this.state || (await this.getState());
    const previousIds = new Set(before.rules.map((rule) => rule.id));

    const ipv4 = isIPv4(input.internalClient) ? input.internalClient : '255.255.255.255';
    const ipv6 = isIPv6(input.internalClient) ? input.internalClient : 'x';
    const raw = await this.client.postForm('/actionHandler/ajax_port_forwarding.jst', {
      add: 'true',
      name: input.name,
      type: input.protocol,
      ip: ipv4,
      ipv6addr: ipv6,
      startport: input.startPort,
      endport: input.endPort,
    });
    const message = normalizeRouterMessage(raw);
    if (message && message !== 'Success!') {
      throw new RouterError(message, 'pf_write_failed');
    }

    const ruleId = await this.findNewRule(previousIds, input);
    if (ruleId != null) await this.writeMeta(ruleId, input, true);
    return { ruleId, state: this.state || (await this.getState(true)) };
  }

  async editRule(id: number, rawInput: RuleInput): Promise<{ ruleId: number; state: PortForwardState }> {
    if (!Number.isInteger(id) || id < 1) throw new RouterError('Invalid port forward id.', 'invalid_input');
    const input = toRuleInput(rawInput);
    const ipv4 = isIPv4(input.internalClient) ? input.internalClient : '255.255.255.255';
    const ipv6 = isIPv6(input.internalClient) ? input.internalClient : 'x';
    const raw = await this.client.postForm('/actionHandler/ajax_port_forwarding.jst', {
      edit: 'true',
      ID: id,
      name: input.name,
      type: input.protocol,
      ip: ipv4,
      ipv6addr: ipv6,
      startport: input.startPort,
      endport: input.endPort,
    });
    const message = normalizeRouterMessage(raw);
    if (message && message !== 'Success!') {
      throw new RouterError(message, 'pf_write_failed');
    }
    // Editing ports or the client does not change the rule's enabled state on
    // the router, so keep whatever this dashboard last observed.
    const existing = (await readMeta(this.gateway))[String(id)];
    await this.writeMeta(id, input, existing?.enabled ?? true);
    return { ruleId: id, state: await this.getState(true) };
  }

  async deleteRule(id: number): Promise<PortForwardState> {
    if (!Number.isInteger(id) || id < 1) throw new RouterError('Invalid port forward id.', 'invalid_input');
    await this.client.postForm('/actionHandler/ajax_port_forwarding.jst', { del: id });
    await mutateMeta(this.gateway, (rules) => {
      delete rules[String(id)];
    });
    return this.getState(true);
  }

  async toggleRule(id: number, enabled: boolean): Promise<PortForwardState> {
    if (!Number.isInteger(id) || id < 1) throw new RouterError('Invalid port forward id.', 'invalid_input');
    await this.client.postForm('/actionHandler/ajax_port_forwarding.jst', {
      active: 'true',
      isChecked: enabled ? 'true' : 'false',
      id,
    });
    await mutateMeta(this.gateway, (rules) => {
      const existing = rules[String(id)];
      rules[String(id)] = {
        ...existing,
        enabled,
        updatedAt: Date.now(),
      };
    });
    if (this.state) {
      const rule = this.state.rules.find((item) => item.id === id);
      if (rule) rule.enabled = enabled;
      this.state.scannedAt = Date.now();
    }
    return this.state || (await this.getState(true));
  }

  async setMaster(enabled: boolean): Promise<{ enabled: boolean | null }> {
    await this.client.postForm('/actionHandler/ajax_port_forwarding.jst', {
      set: 'true',
      UFWDStatus: enabled ? 'Enabled' : 'Disabled',
    });
    this.client.invalidateWrites();
    const html = await this.client.getPage('/port_forwarding.jst', 0);
    const state = parseMasterState(html);
    if (this.state) {
      this.state.enabled = state;
      this.state.scannedAt = Date.now();
    }
    return { enabled: state };
  }
}
