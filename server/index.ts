import express, { type CookieOptions, type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { gateway4async } from 'default-gateway';
import { RouterClient, RouterError, normalizeGateway, readableError } from './router/client.js';
import {
  parseDevices,
  parseDmz,
  parseFirewall,
  parseLogEntries,
  parseManagedServices,
  parseOverview,
  parseParentalSites,
  parsePortTriggering,
  parseRemoteManagement,
  parseSsidEdit,
  parseSystemInfo,
  parseUpnp,
  parseWifi,
} from './router/parsers.js';
import { PortForwardingService, type PfProtocol } from './router/pf.js';
import { UpnpClient, gatewayHost } from './router/upnp.js';
import { isVerbose, logHttp, logInfo } from './log.js';

const PORT = Number(process.env.PORT || 4400);
const HOST = process.env.HOST || '127.0.0.1';
const SESSION_COOKIE = 'xu_session';
const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
const FALLBACK_GATEWAY = process.env.XU_DEFAULT_GATEWAY || '10.0.0.1';

interface AppSession {
  id: string;
  client: RouterClient;
  pf: PortForwardingService;
  upnp: UpnpClient;
  gateway: string;
  username: string;
  createdAt: number;
  lastSeenAt: number;
}

const sessions = new Map<string, AppSession>();
let detectedGateway: { at: number; gateway: string } | null = null;

async function detectGateway(): Promise<string> {
  if (detectedGateway && Date.now() - detectedGateway.at < 60_000) return detectedGateway.gateway;
  let gateway = FALLBACK_GATEWAY;
  try {
    const result = await gateway4async();
    if (result?.gateway) gateway = result.gateway;
  } catch {
    // No default route (VPNs, containers, unusual network setups).
  }
  detectedGateway = { at: Date.now(), gateway };
  return gateway;
}

function createSession(client: RouterClient, gateway: string, username: string): AppSession {
  const session: AppSession = {
    id: randomUUID(),
    client,
    pf: new PortForwardingService(client, gateway),
    upnp: new UpnpClient(gatewayHost(gateway)),
    gateway,
    username,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
  };
  sessions.set(session.id, session);
  logInfo(`app session ${session.id.slice(0, 8)} created for ${gateway} (${username})`);
  // Keep only the newest handful of browser sessions so a forgotten tab
  // cannot hold router connections open forever.
  const ordered = [...sessions.values()].sort((a, b) => a.lastSeenAt - b.lastSeenAt);
  for (const stale of ordered.slice(0, Math.max(0, ordered.length - 5))) {
    sessions.delete(stale.id);
  }
  return session;
}

function sessionFrom(req: Request): AppSession | null {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  if (Date.now() - session.lastSeenAt > SESSION_IDLE_MS) {
    sessions.delete(sid);
    return null;
  }
  session.lastSeenAt = Date.now();
  return session;
}

const cookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  secure: false,
  path: '/',
  maxAge: SESSION_IDLE_MS,
};

function requireSession(req: Request, res: Response, next: NextFunction) {
  const session = sessionFrom(req);
  if (!session) {
    res.status(401).json({ error: { message: 'Sign in to your router first.', code: 'not_authenticated' } });
    return;
  }
  res.locals.session = session;
  next();
}

function route(handler: (req: Request, res: Response) => Promise<unknown> | unknown) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function requireString(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new RouterError(`${label} is required.`, 'invalid_input');
  return text;
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new RouterError(`${label} must be true or false.`, 'invalid_input');
  return value;
}

function portNumber(value: unknown, label: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RouterError(`${label} must be between 1 and 65535.`, 'invalid_input');
  }
  return port;
}

function stateBool(value: boolean): string {
  return value ? 'true' : 'false';
}

async function safePage(client: RouterClient, page: string): Promise<string> {
  try {
    return await client.getPage(page, 0);
  } catch (error) {
    // A page that genuinely does not exist should not blank the whole
    // response, but a dead router session must surface to the user.
    if (error instanceof RouterError && error.code === 'session_expired') throw error;
    return '';
  }
}

async function safeJson<T>(client: RouterClient, page: string, timeoutMs?: number): Promise<T | null> {
  try {
    const raw = await client.getWithHeaders(page, { Accept: 'application/json' }, timeoutMs);
    return parseRouterJson(raw) as T;
  } catch (error) {
    if (error instanceof RouterError && error.code === 'session_expired') throw error;
    return null;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The spectrum endpoint is asynchronous: poll until the scan finishes. */
async function runSpectrumScan(client: RouterClient): Promise<unknown> {
  let latest: unknown = null;
  for (let attempt = 0; attempt < 15; attempt++) {
    const raw = await client.getWithHeaders(
      '/actionHandler/ajax_wifi_spectrum_analyser.jst?wifi_spectrum_analyser=analyse',
      { csrfp_token: client.getCsrfToken(), Accept: 'application/json' },
      60_000,
    );
    latest = parseRouterJson(raw);
    const status = asRecord(latest).status;
    if (typeof status === 'string' && !/in progress/i.test(status)) return latest;
    await delay(2_000);
  }
  return latest;
}

function parseRouterJson(raw: string): unknown {
  const text = raw
    .trim()
    .replace(/^&quot;/, '"')
    .replace(/&quot;$/, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function throwRouterMessage(message: unknown, successValues: string[] = ['Success!', 'success']) {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return;
  if (successValues.some((value) => value.toLowerCase() === text.toLowerCase())) return;
  throw new RouterError(text, 'router_rejected');
}

/**
 * Managed sites and services reject every write with a generic
 * "Invalid Inputs!" while their master switch is off, so check first and
 * return an actionable message instead.
 */
async function requireManagedEnabled(client: RouterClient, kind: 'sites' | 'services') {
  const state =
    kind === 'sites'
      ? parseParentalSites(await client.getPage('/managed_sites.jst', 3_000))
      : parseManagedServices(await client.getPage('/managed_services.jst', 3_000));
  if (!state.enabled) {
    throw new RouterError(
      `Enable managed ${kind} before adding, changing, or removing rules.`,
      'managed_disabled',
    );
  }
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '512kb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    const sid = req.cookies?.[SESSION_COOKIE];
    logHttp(
      `${req.method} ${req.originalUrl} -> ${res.statusCode} ${Date.now() - started}ms${sid ? ` sid=${String(sid).slice(0, 8)}` : ''}`,
    );
  });
  next();
});
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

// Reject cross-site form posts.  Binding to localhost is not enough: another
// web page could otherwise make the browser hit the local API.
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  try {
    const hostname = new URL(origin).hostname;
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname)) {
      res.status(403).json({ error: { message: 'Cross-site requests are not allowed.', code: 'forbidden' } });
      return;
    }
  } catch {
    res.status(403).json({ error: { message: 'Invalid request origin.', code: 'forbidden' } });
    return;
  }
  next();
});

app.get(
  '/api/health',
  route(async (_req, res) => {
    res.json({ ok: true, sessions: sessions.size });
  }),
);

app.get(
  '/api/gateway',
  route(async (_req, res) => {
    const detected = await detectGateway();
    res.json({
      gateway: detected,
      detected: detected !== FALLBACK_GATEWAY || Boolean(process.env.XU_DEFAULT_GATEWAY),
      fallback: FALLBACK_GATEWAY,
    });
  }),
);

app.get(
  '/api/session',
  route(async (req, res) => {
    const session = sessionFrom(req);
    if (!session) {
      res.json({ authenticated: false });
      return;
    }
    res.json({
      authenticated: true,
      gateway: session.gateway,
      username: session.username,
      createdAt: session.createdAt,
    });
  }),
);

app.post(
  '/api/login',
  route(async (req, res) => {
    const body = asRecord(req.body);
    const username = requireString(body.username, 'Username');
    const password = typeof body.password === 'string' ? body.password : '';
    if (!password) throw new RouterError('Password is required.', 'invalid_input');
    const requested = optionalString(body.gateway) || (await detectGateway());
    const gateway = normalizeGateway(requested);

    const previous = sessionFrom(req);
    if (previous) sessions.delete(previous.id);

    const client = new RouterClient(gateway, { username, password });
    await client.login();
    const session = createSession(client, gateway, username);
    res.cookie(SESSION_COOKIE, session.id, cookieOptions);
    res.json({ authenticated: true, gateway, username });
  }),
);

app.post(
  '/api/logout',
  route(async (req, res) => {
    const session = sessionFrom(req);
    if (session) sessions.delete(session.id);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ authenticated: false });
  }),
);

// Everything below needs a live router session.
app.use('/api', requireSession);

app.get(
  '/api/overview',
  route(async (_req, res) => {
    const session = res.locals.session as AppSession;
    const [atAGlance, connection] = await Promise.all([
      session.client.getPage('/at_a_glance.jst', 4_000),
      session.client.getPage('/connection_status.jst', 4_000),
    ]);
    res.json(parseOverview(atAGlance, connection));
  }),
);

app.get(
  '/api/devices',
  route(async (_req, res) => {
    const session = res.locals.session as AppSession;
    res.json(parseDevices(await session.client.getPage('/connected_devices_computers.jst', 3_000)));
  }),
);

app.post(
  '/api/devices',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const body = asRecord(req.body);
    const name = requireString(body.name, 'Device name');
    const mac = requireString(body.mac, 'MAC address');
    const comments = optionalString(body.comments).slice(0, 63);
    const action = optionalString(body.action) || 'comments';
    const reservedIp = optionalString(body.reservedIp);
    if (!['comments', 'reserve', 'unreserve'].includes(action)) {
      throw new RouterError('Unknown device action.', 'invalid_input');
    }

    const payload: Record<string, string> = {
      Comments: comments.replace(/[\r\n]+/g, '@'),
      hostName: name,
      macAddress: mac,
      reseverd_ipAddr: reservedIp || '0.0.0.0',
    };
    if (action === 'unreserve') payload.delFlag = 'true';
    else if (action === 'comments' && optionalString(body.addressMode) === 'dhcp') {
      payload.UpdateComments = 'true';
    }
    if (action === 'reserve' && !reservedIp) {
      throw new RouterError('Enter the IP address to reserve.', 'invalid_input');
    }

    const result = await session.client.postJson<string>('/actionHandler/ajaxSet_add_device.jst', {
      DeviceInfo: JSON.stringify(payload),
    });
    throwRouterMessage(result, ['success']);
    res.json(parseDevices(await session.client.getPage('/connected_devices_computers.jst', 0)));
  }),
);

app.get(
  '/api/wifi',
  route(async (_req, res) => {
    const session = res.locals.session as AppSession;
    res.json(parseWifi(await session.client.getPage('/wireless_network_configuration.jst', 4_000)));
  }),
);

app.get(
  '/api/wifi/ssid/:id',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const id = Number(req.params.id);
    if (![1, 2, 17].includes(id)) throw new RouterError('That SSID is not managed by this firmware.', 'invalid_input');
    const html = await session.client.getPage(`/wireless_network_configuration_edit.jst?id=${id}`, 4_000);
    res.json(parseSsidEdit(html, id));
  }),
);

app.put(
  '/api/wifi/ssid/:id',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const id = Number(req.params.id);
    if (id !== 1 && id !== 2) {
      throw new RouterError(
        'This firmware only accepts Wi-Fi changes for the 2.4 GHz and 5 GHz networks.',
        'unsupported',
      );
    }
    const current = parseSsidEdit(
      await session.client.getPage(`/wireless_network_configuration_edit.jst?id=${id}`, 0),
      id,
    );
    const body = asRecord(req.body);
    const name = requireString(body.name, 'Wi-Fi network name');
    const security = optionalString(body.security) || current.security;
    const password = typeof body.password === 'string' ? body.password : current.password;
    const mode = optionalString(body.mode) || current.mode;
    const channelAutomatic =
      typeof body.channelAutomatic === 'boolean' ? body.channelAutomatic : current.channelAutomatic;
    const channel = optionalString(body.channel) || current.channel;
    const bandwidth = optionalString(body.bandwidth) || current.bandwidth;
    const broadcast = typeof body.broadcast === 'boolean' ? body.broadcast : current.broadcast;
    const wmm = typeof body.wmm === 'boolean' ? body.wmm : current.wmm;
    const enabled = typeof body.enabled === 'boolean' ? body.enabled : current.enabled;
    const passwordUpdate = body.passwordUpdate === true || password !== current.password;

    if (security !== 'None' && (password.length < 8 || password.length > 63)) {
      throw new RouterError('The Wi-Fi password must be 8 to 63 characters.', 'invalid_input');
    }
    if (!channelAutomatic && !channel) {
      throw new RouterError('Choose a Wi-Fi channel or use automatic channel selection.', 'invalid_input');
    }

    const config = {
      radio_enable: stateBool(enabled),
      network_name: name,
      wireless_mode: mode,
      security,
      channel_automatic: stateBool(channelAutomatic),
      channel_number: channel,
      network_password: password,
      broadcastSSID: stateBool(broadcast),
      channel_bandwidth: bandwidth,
      enableWMM: stateBool(wmm),
      ssid_number: String(id),
      password_update: stateBool(passwordUpdate),
      thisUser: session.username,
    };

    await session.client.postForm('/actionHandler/ajaxSet_wireless_network_configuration_edit.jst', {
      configInfo: JSON.stringify(config),
    });
    res.json({ ok: true });
  }),
);

app.get(
  '/api/wifi/mac-filter/:id',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const id = Number(req.params.id);
    if (id !== 1 && id !== 2) throw new RouterError('MAC filtering is available for SSID 1 and 2.', 'invalid_input');
    const config = encodeURIComponent(JSON.stringify({ ssid_number: String(id), target: 'mac_ssid' }));
    const raw = await session.client.getWithHeaders(
      `/actionHandler/ajaxSet_wireless_network_configuration.jst?configInfo=${config}`,
      { Accept: 'application/json' },
    );
    const parsed = asRecord(parseRouterJson(raw));
    res.json({
      ssid: id,
      mode: optionalString(parsed.filtering_mode) || 'allow_all',
      entries: Array.isArray(parsed.ft)
        ? parsed.ft
            .filter((entry) => Array.isArray(entry) && entry.length >= 2)
            .map((entry) => ({ name: optionalString(entry[0]), mac: optionalString(entry[1]) }))
        : [],
      available: Array.isArray(parsed.at)
        ? parsed.at
            .filter((entry) => Array.isArray(entry) && entry.length >= 2)
            .map((entry) => ({ name: optionalString(entry[0]), mac: optionalString(entry[1]) }))
        : [],
    });
  }),
);

app.put(
  '/api/wifi/mac-filter/:id',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const id = Number(req.params.id);
    if (id !== 1 && id !== 2) throw new RouterError('MAC filtering is available for SSID 1 and 2.', 'invalid_input');
    const body = asRecord(req.body);
    const mode = optionalString(body.mode) || 'allow_all';
    if (!['allow_all', 'allow', 'deny'].includes(mode)) {
      throw new RouterError('Unknown MAC filtering mode.', 'invalid_input');
    }
    const entries = Array.isArray(body.entries)
      ? body.entries.map((entry) => {
          const item = asRecord(entry);
          return [optionalString(item.name), optionalString(item.mac)];
        })
      : [];
    await session.client.postForm('/actionHandler/ajaxSet_wireless_network_configuration.jst', {
      configInfo: JSON.stringify({
        ssid_number: String(id),
        filtering_mode: mode,
        ft: entries,
        target: 'save_filter',
      }),
    });
    res.json({ ok: true });
  }),
);

app.get(
  '/api/firewall',
  route(async (_req, res) => {
    const session = res.locals.session as AppSession;
    const [v4, v6] = await Promise.all([
      session.client.getPage('/firewall_settings_ipv4.jst', 4_000),
      session.client.getPage('/firewall_settings_ipv6.jst', 4_000),
    ]);
    res.json({ ipv4: parseFirewall(v4, 'ipv4'), ipv6: parseFirewall(v6, 'ipv6') });
  }),
);

app.put(
  '/api/firewall/ipv4',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const body = asRecord(req.body);
    const level = optionalString(body.level).toLowerCase();
    const levels: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low', custom: 'Custom', none: 'None' };
    if (!levels[level]) throw new RouterError('Choose a valid IPv4 firewall level.', 'invalid_input');
    const block = (key: string) => (body[key] === true ? 'Enabled' : 'Disabled');
    const config = {
      firewallLevel: levels[level],
      block_http: block('blockHttp'),
      block_icmp: block('blockIcmp'),
      block_multicast: block('blockMulticast'),
      block_peer: block('blockPeer'),
      block_ident: block('blockIdent'),
    };
    await session.client.postForm('/actionHandler/ajaxSet_firewall_config.jst', {
      configInfo: JSON.stringify(config),
    });
    const html = await session.client.getPage('/firewall_settings_ipv4.jst', 0);
    res.json(parseFirewall(html, 'ipv4'));
  }),
);

app.put(
  '/api/firewall/ipv6',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const body = asRecord(req.body);
    const level = optionalString(body.level).toLowerCase();
    const levels: Record<string, string> = { none: 'None', default: 'Default', custom: 'Custom' };
    if (!levels[level]) throw new RouterError('Choose None, Default, or Custom for IPv6.', 'invalid_input');
    const block = (key: string) => stateBool(body[key] === true);
    const config = {
      firewallLevel: levels[level],
      block_http: block('blockHttp'),
      block_icmp: block('blockIcmp'),
      block_multicast: block('blockMulticast'),
      block_peer: block('blockPeer'),
      block_ident: block('blockIdent'),
    };
    await session.client.postForm('/actionHandler/ajaxSet_firewall_config_v6.jst', {
      configInfo: JSON.stringify(config),
    });
    const html = await session.client.getPage('/firewall_settings_ipv6.jst', 0);
    res.json(parseFirewall(html, 'ipv6'));
  }),
);

app.get(
  '/api/remote-management',
  route(async (_req, res) => {
    const session = res.locals.session as AppSession;
    res.json(parseRemoteManagement(await session.client.getPage('/remote_management.jst', 4_000)));
  }),
);

app.put(
  '/api/remote-management',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const body = asRecord(req.body);
    const http = asRecord(body.http);
    const https = asRecord(body.https);
    const allowType = optionalString(body.allowType) || 'any';
    if (!['any', 'single', 'range'].includes(allowType)) {
      throw new RouterError('Choose any computer, a single address, or a range.', 'invalid_input');
    }
    const httpEnabled = http.enabled === true;
    const httpsEnabled = https.enabled === true;
    const httpPort = portNumber(http.port, 'HTTP port');
    const httpsPort = portNumber(https.port, 'HTTPS port');
    if (httpPort < 1025 || httpsPort < 1025) {
      throw new RouterError('Remote management ports must be 1025 or higher.', 'invalid_input');
    }

    let startIP = 'notset';
    let endIP = 'notset';
    let startIPv6 = 'notset';
    let endIPv6 = 'notset';
    if (allowType !== 'any') {
      if (allowType === 'single') {
        const single = asRecord(body.single);
        startIP = optionalString(single.ipv4) || '255.255.255.255';
        endIP = startIP;
        startIPv6 = optionalString(single.ipv6) || 'x';
        endIPv6 = startIPv6;
      } else {
        const range = asRecord(body.range);
        startIP = optionalString(range.startIpv4) || '255.255.255.255';
        endIP = optionalString(range.endIpv4) || '255.255.255.255';
        startIPv6 = optionalString(range.startIpv6) || 'x';
        endIPv6 = optionalString(range.endIpv6) || 'x';
      }
    }

    const result = await session.client.postJson<string>('/actionHandler/ajax_remote_management.jst', {
      http: stateBool(httpEnabled),
      httpport: httpPort,
      https: stateBool(httpsEnabled),
      httpsport: httpsPort,
      allowtype: allowType === 'any' ? 'true' : 'false',
      startIP,
      endIP,
      startIPv6,
      endIPv6,
    });
    throwRouterMessage(result);
    res.json({ ok: true });
  }),
);

app.get(
  '/api/upnp',
  route(async (_req, res) => {
    const session = res.locals.session as AppSession;
    const settings = parseUpnp(await session.client.getPage('/device_discovery.jst', 4_000));
    let mappings: unknown[] = [];
    let mappingsError = '';
    if (settings.enabled) {
      try {
        mappings = await session.upnp.listMappings();
      } catch (error) {
        mappingsError = readableError(error).message;
      }
    }
    res.json({ ...settings, mappings, mappingsError });
  }),
);

app.put(
  '/api/upnp',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const body = asRecord(req.body);
    const enabled = requireBoolean(body.enabled, 'UPnP');
    const zeroConfig = requireBoolean(body.zeroConfig, 'Zero configuration');
    const period = Math.max(1, Math.min(86400, Number(body.advertisementMinutes) || 30));
    const ttl = Math.max(1, Math.min(3600, Number(body.ttl) || 5));
    await session.client.postForm('/actionHandler/ajaxSet_UPnP_configuration.jst', {
      upnpInfo: JSON.stringify({
        IsEnabledUPnP: stateBool(enabled),
        Period: String(period),
        Live: String(ttl),
        IsEnabledZero: stateBool(zeroConfig),
      }),
    });
    res.json({ ok: true });
  }),
);

app.delete(
  '/api/upnp/mappings/:port',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const port = String(req.params.port);
    const protocol = optionalString(req.query.protocol) || 'TCP';
    try {
      await session.upnp.deleteMapping(port, protocol, optionalString(req.query.host));
    } catch (error) {
      throw new RouterError(readableError(error).message, 'upnp_write_failed');
    }
    res.json({ ok: true });
  }),
);

app.get(
  '/api/dmz',
  route(async (_req, res) => {
    const session = res.locals.session as AppSession;
    res.json(parseDmz(await session.client.getPage('/dmz.jst', 4_000)));
  }),
);

app.put(
  '/api/dmz',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const body = asRecord(req.body);
    const enabled = requireBoolean(body.enabled, 'DMZ');
    const hostIpv4 = optionalString(body.hostIpv4);
    const hostIpv6 = optionalString(body.hostIpv6) || 'x';
    if (enabled && !/^\d{1,3}(\.\d{1,3}){3}$/.test(hostIpv4)) {
      throw new RouterError('Enter the IPv4 address of the DMZ host.', 'invalid_input');
    }
    await session.client.postForm('/actionHandler/ajaxSet_DMZ_configuration.jst', {
      dmzInfo: JSON.stringify({
        IsEnabledDMZ: stateBool(enabled),
        Host: enabled ? hostIpv4 : '0.0.0.0',
        hostv6: hostIpv6,
      }),
    });
    const html = await session.client.getPage('/dmz.jst', 0);
    res.json(parseDmz(html));
  }),
);

app.get(
  '/api/port-triggering',
  route(async (_req, res) => {
    const session = res.locals.session as AppSession;
    res.json(parsePortTriggering(await session.client.getPage('/port_triggering.jst', 3_000)));
  }),
);

async function triggerState(session: AppSession) {
  return parsePortTriggering(await session.client.getPage('/port_triggering.jst', 0));
}

function triggerFields(body: Record<string, unknown>) {
  const name = requireString(body.name, 'Service name');
  const protocol = optionalString(body.protocol) || 'TCP';
  if (!['TCP', 'UDP', 'TCP/UDP'].includes(protocol)) {
    throw new RouterError('Choose TCP, UDP, or both.', 'invalid_input');
  }
  const triggerStart = portNumber(body.triggerStart, 'Trigger start port');
  const triggerEnd = portNumber(body.triggerEnd, 'Trigger end port');
  const targetStart = portNumber(body.targetStart, 'Target start port');
  const targetEnd = portNumber(body.targetEnd, 'Target end port');
  if (triggerStart > triggerEnd || targetStart > targetEnd) {
    throw new RouterError('Port ranges must go from low to high.', 'invalid_input');
  }
  return { name, protocol, triggerStart, triggerEnd, targetStart, targetEnd };
}

app.post(
  '/api/port-triggering',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const input = triggerFields(asRecord(req.body));
    const result = await session.client.postJson<string>('/actionHandler/ajax_port_triggering.jst', {
      add: 'true',
      name: input.name,
      type: input.protocol,
      fsp: input.triggerStart,
      fep: input.triggerEnd,
      tsp: input.targetStart,
      tep: input.targetEnd,
    });
    throwRouterMessage(result);
    res.json(await triggerState(session));
  }),
);

app.put(
  '/api/port-triggering/:id',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new RouterError('Invalid port trigger id.', 'invalid_input');
    const input = triggerFields(asRecord(req.body));
    const result = await session.client.postJson<string>('/actionHandler/ajax_port_triggering.jst', {
      edit: 'true',
      ID: id,
      name: input.name,
      type: input.protocol,
      fsp: input.triggerStart,
      fep: input.triggerEnd,
      tsp: input.targetStart,
      tep: input.targetEnd,
    });
    throwRouterMessage(result);
    res.json(await triggerState(session));
  }),
);

app.delete(
  '/api/port-triggering/:id',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new RouterError('Invalid port trigger id.', 'invalid_input');
    await session.client.postForm('/actionHandler/ajax_port_triggering.jst', { del: id });
    res.json(await triggerState(session));
  }),
);

app.post(
  '/api/port-triggering/:id/toggle',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const id = Number(req.params.id);
    const enabled = requireBoolean(asRecord(req.body).enabled, 'Enabled');
    await session.client.postForm('/actionHandler/ajax_port_triggering.jst', {
      active: 'true',
      isChecked: stateBool(enabled),
      id,
    });
    res.json(await triggerState(session));
  }),
);

app.post(
  '/api/port-triggering/master',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const enabled = requireBoolean(asRecord(req.body).enabled, 'Port triggering');
    await session.client.postForm('/actionHandler/ajax_port_triggering.jst', {
      set: 'true',
      UPTRStatus: enabled ? 'Enabled' : 'Disabled',
    });
    res.json(await triggerState(session));
  }),
);

app.get(
  '/api/port-forwarding',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const force = req.query.force === '1' || req.query.force === 'true';
    res.json(await session.pf.getState(force));
  }),
);

app.post(
  '/api/port-forwarding',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const body = asRecord(req.body);
    res.json(
      await session.pf.addRule({
        name: requireString(body.name, 'Service name'),
        protocol: (optionalString(body.protocol) || 'TCP') as PfProtocol,
        internalClient: requireString(body.internalClient, 'Internal client'),
        startPort: portNumber(body.startPort, 'Start port'),
        endPort: portNumber(body.endPort, 'End port'),
      }),
    );
  }),
);

app.put(
  '/api/port-forwarding/:id',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const body = asRecord(req.body);
    const id = Number(req.params.id);
    res.json(
      await session.pf.editRule(id, {
        name: requireString(body.name, 'Service name'),
        protocol: (optionalString(body.protocol) || 'TCP') as PfProtocol,
        internalClient: requireString(body.internalClient, 'Internal client'),
        startPort: portNumber(body.startPort, 'Start port'),
        endPort: portNumber(body.endPort, 'End port'),
      }),
    );
  }),
);

app.delete(
  '/api/port-forwarding/:id',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const id = Number(req.params.id);
    res.json(await session.pf.deleteRule(id));
  }),
);

app.post(
  '/api/port-forwarding/:id/toggle',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const id = Number(req.params.id);
    const enabled = requireBoolean(asRecord(req.body).enabled, 'Enabled');
    res.json(await session.pf.toggleRule(id, enabled));
  }),
);

app.post(
  '/api/port-forwarding/master',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const enabled = requireBoolean(asRecord(req.body).enabled, 'Port forwarding');
    res.json(await session.pf.setMaster(enabled));
  }),
);

app.get(
  '/api/parental/sites',
  route(async (_req, res) => {
    const session = res.locals.session as AppSession;
    res.json(parseParentalSites(await session.client.getPage('/managed_sites.jst', 3_000)));
  }),
);

app.post(
  '/api/parental/sites/enabled',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const enabled = requireBoolean(asRecord(req.body).enabled, 'Managed sites');
    await session.client.postForm('/actionHandler/ajaxSet_enable_manageSite.jst', {
      Enable: JSON.stringify({ Enable: stateBool(enabled) }),
    });
    res.json(parseParentalSites(await session.client.getPage('/managed_sites.jst', 0)));
  }),
);

app.post(
  '/api/parental/sites',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const body = asRecord(req.body);
    const type = optionalString(body.type) === 'keyword' ? 'keyword' : 'site';
    const rawValue = requireString(body.value, type === 'keyword' ? 'Keyword' : 'URL');
    // The router only accepts full URLs for site rules, but the UI (like the
    // router's own help text) lets people type a bare domain.
    const value =
      type === 'site' && !/^[a-z][a-z0-9+.-]*:\/\//i.test(rawValue)
        ? `https://${rawValue}`
        : rawValue;
    const alwaysBlock = body.alwaysBlock !== false;
    await requireManagedEnabled(session.client, 'sites');
    const info: Record<string, string> = {
      [type === 'keyword' ? 'Keyword' : 'URL']: value,
      alwaysBlock: stateBool(alwaysBlock),
    };
    if (!alwaysBlock) {
      info.StartTime = optionalString(body.startTime) || '00:00';
      info.EndTime = optionalString(body.endTime) || '23:59';
      const days = Array.isArray(body.days) ? body.days.map((d) => optionalString(d)).filter(Boolean) : [];
      if (!days.length) throw new RouterError('Choose at least one day to block.', 'invalid_input');
      info.blockedDays = days.join(',');
    }
    const result = await session.client.postJson<{ status?: string }>(
      '/actionHandler/ajaxSet_add_blockedSite.jst',
      { BlockInfo: JSON.stringify(info) },
    );
    const status = asRecord(result).status;
    throwRouterMessage(status);
    res.json(parseParentalSites(await session.client.getPage('/managed_sites.jst', 0)));
  }),
);

app.delete(
  '/api/parental/sites/:id',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const id = requireString(req.params.id, 'Rule id');
    await requireManagedEnabled(session.client, 'sites');
    await session.client.postForm('/actionHandler/ajaxSet_remove_blockedSite.jst', {
      removeBlockInfo: JSON.stringify({ InstanceID: id }),
    });
    res.json(parseParentalSites(await session.client.getPage('/managed_sites.jst', 0)));
  }),
);

app.post(
  '/api/parental/sites/trust',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const body = asRecord(req.body);
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) throw new RouterError('Invalid computer id.', 'invalid_input');
    await requireManagedEnabled(session.client, 'sites');
    await session.client.postForm('/actionHandler/ajaxSet_trust_computer.jst', {
      TrustFlag: JSON.stringify({
        trustFlag: stateBool(body.trusted === true),
        HostName: optionalString(body.name),
        IPAddress: optionalString(body.address),
      }),
    });
    res.json({ ok: true });
  }),
);

app.get(
  '/api/parental/services',
  route(async (_req, res) => {
    const session = res.locals.session as AppSession;
    res.json(parseManagedServices(await session.client.getPage('/managed_services.jst', 3_000)));
  }),
);

app.post(
  '/api/parental/services/enabled',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const enabled = requireBoolean(asRecord(req.body).enabled, 'Managed services');
    const result = await session.client.postJson<{ status?: string }>('/actionHandler/ajax_managed_services.jst', {
      set: 'true',
      UMSStatus: enabled ? 'Enabled' : 'Disabled',
    });
    throwRouterMessage(asRecord(result).status, ['Enabled', 'Disabled']);
    res.json(parseManagedServices(await session.client.getPage('/managed_services.jst', 0)));
  }),
);

function serviceFields(body: Record<string, unknown>) {
  const name = requireString(body.name, 'Service name');
  const protocol = optionalString(body.protocol) || 'BOTH';
  if (!['TCP', 'UDP', 'BOTH'].includes(protocol)) {
    throw new RouterError('Choose TCP, UDP, or both.', 'invalid_input');
  }
  const startPort = portNumber(body.startPort, 'Start port');
  const endPort = portNumber(body.endPort, 'End port');
  if (startPort > endPort) throw new RouterError('The start port must be below the end port.', 'invalid_input');
  const alwaysBlock = body.alwaysBlock !== false;
  const fields: Record<string, string | number> = {
    service: name,
    protocol,
    startPort,
    endPort,
    block: stateBool(alwaysBlock),
  };
  if (!alwaysBlock) {
    fields.startTime = optionalString(body.startTime) || '00:00';
    fields.endTime = optionalString(body.endTime) || '23:59';
    const days = Array.isArray(body.days) ? body.days.map((d) => optionalString(d)).filter(Boolean) : [];
    if (!days.length) throw new RouterError('Choose at least one day to block.', 'invalid_input');
    fields.days = days.join(',');
  }
  return fields;
}

app.post(
  '/api/parental/services',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const fields = serviceFields(asRecord(req.body));
    await requireManagedEnabled(session.client, 'services');
    const result = await session.client.postJson<{ status?: string }>('/actionHandler/ajax_managed_services.jst', {
      add: 'true',
      ...fields,
    });
    throwRouterMessage(asRecord(result).status);
    res.json(parseManagedServices(await session.client.getPage('/managed_services.jst', 0)));
  }),
);

app.put(
  '/api/parental/services/:id',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new RouterError('Invalid service id.', 'invalid_input');
    const fields = serviceFields(asRecord(req.body));
    await requireManagedEnabled(session.client, 'services');
    const result = await session.client.postJson<{ status?: string }>('/actionHandler/ajax_managed_services.jst', {
      edit: 'true',
      ID: id,
      ...fields,
    });
    throwRouterMessage(asRecord(result).status);
    res.json(parseManagedServices(await session.client.getPage('/managed_services.jst', 0)));
  }),
);

app.delete(
  '/api/parental/services/:id',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new RouterError('Invalid service id.', 'invalid_input');
    await requireManagedEnabled(session.client, 'services');
    await session.client.postForm('/actionHandler/ajax_managed_services.jst', { del: id });
    res.json(parseManagedServices(await session.client.getPage('/managed_services.jst', 0)));
  }),
);

app.post(
  '/api/parental/services/trust',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const body = asRecord(req.body);
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) throw new RouterError('Invalid computer id.', 'invalid_input');
    await requireManagedEnabled(session.client, 'services');
    const result = await session.client.postJson<{ status?: string }>('/actionHandler/ajax_managed_services.jst', {
      trust_not: 'true',
      ID: id,
      status: stateBool(body.trusted === true),
    });
    throwRouterMessage(asRecord(result).status, ['Trusted', 'Not trusted']);
    res.json({ ok: true });
  }),
);

app.get(
  '/api/logs',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const mode = ['system', 'event', 'firewall'].includes(String(req.query.mode)) ? String(req.query.mode) : 'system';
    const timeframe = String(req.query.timeframe || 'Today');
    const query = new URLSearchParams({ mode, timef: timeframe });
    const raw = await session.client.getWithHeaders(
      `/actionHandler/ajax_troubleshooting_logs.jst?${query.toString()}`,
      { Accept: 'application/json' },
      90_000,
    );
    res.json({ mode, timeframe, entries: parseLogEntries(parseRouterJson(raw)) });
  }),
);

app.get(
  '/api/parental/reports',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const mode = ['all', 'site', 'service', 'device'].includes(String(req.query.mode))
      ? String(req.query.mode)
      : 'all';
    const timeframe = String(req.query.timeframe || 'Today');
    const query = new URLSearchParams({ mode, timef: timeframe });
    const raw = await session.client.getWithHeaders(
      `/actionHandler/ajax_parental_reports.jst?${query.toString()}`,
      { Accept: 'application/json' },
      150_000,
    );
    const parsed = parseRouterJson(raw);
    res.json({ mode, timeframe, entries: Array.isArray(parsed) ? parsed : [] });
  }),
);

app.post(
  '/api/diagnostics/ping',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const body = asRecord(req.body);
    const destination = requireString(body.destination, 'Destination');
    const count = Math.max(1, Math.min(4, Number(body.count) || 4));
    const raw = await session.client.postForm(
      '/actionHandler/ajax_network_diagnostic_tools.jst',
      { test_connectivity: 'true', destination_address: destination, count1: count },
      90_000,
    );
    res.json(parseRouterJson(raw));
  }),
);

app.post(
  '/api/diagnostics/ipv4',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const body = asRecord(req.body);
    const destination = requireString(body.destination, 'IPv4 address');
    const count = Math.max(1, Math.min(4, Number(body.count) || 4));
    const raw = await session.client.postForm(
      '/actionHandler/ajax_network_diagnostic_tools.jst',
      { check_ipv4: 'true', destination_ipv4: destination, count2: count },
      90_000,
    );
    res.json(parseRouterJson(raw));
  }),
);

app.post(
  '/api/diagnostics/ipv6',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const body = asRecord(req.body);
    const destination = requireString(body.destination, 'IPv6 address');
    const count = Math.max(1, Math.min(4, Number(body.count) || 4));
    const raw = await session.client.postForm(
      '/actionHandler/ajax_network_diagnostic_tools.jst',
      { check_ipv6: 'true', destination_ipv6: destination, count3: count },
      90_000,
    );
    res.json(parseRouterJson(raw));
  }),
);

app.post(
  '/api/diagnostics/traceroute',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const body = asRecord(req.body);
    const destination = requireString(body.destination, 'Destination');
    const raw = await session.client.postForm(
      '/actionHandler/ajax_network_diagnostic_tools.jst',
      { trace_ipv4: 'true', trace_ipv4_dst: destination },
      150_000,
    );
    res.json(parseRouterJson(raw));
  }),
);

app.get(
  '/api/diagnostics/spectrum',
  route(async (_req, res) => {
    const session = res.locals.session as AppSession;
    res.json(await runSpectrumScan(session.client));
  }),
);

app.get(
  '/api/system',
  route(async (_req, res) => {
    const session = res.locals.session as AppSession;
    const [hardware, software, network, wireless, battery] = await Promise.all([
      safePage(session.client, '/hardware.jst'),
      safePage(session.client, '/software.jst'),
      safePage(session.client, '/lan.jst'),
      safePage(session.client, '/wifi.jst'),
      safePage(session.client, '/battery.jst'),
    ]);
    res.json(
      parseSystemInfo({
        hardware,
        software,
        network,
        wireless,
        battery,
      }),
    );
  }),
);

app.post(
  '/api/system/reset',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const body = asRecord(req.body);
    const mode = optionalString(body.mode);
    const presets: Record<string, [string, string]> = {
      reboot: ['btn1', 'Device'],
      'wifi-module': ['btn2', 'Wifi'],
      'wifi-router': ['btn3', 'Wifi,Router'],
      'wifi-settings': ['btn4', 'Wifi'],
      factory: ['btn5', 'Router,Wifi,VoIP,Dect,MoCA'],
    };
    const preset = presets[mode];
    if (!preset) throw new RouterError('Unknown reset option.', 'invalid_input');
    if (mode === 'factory' && body.confirm !== 'FACTORY RESET') {
      throw new RouterError('Type FACTORY RESET to confirm.', 'invalid_input');
    }
    const result = await session.client.postJson<{ reboot?: boolean; wifi?: boolean }>(
      '/actionHandler/ajaxSet_Reset_Restore.jst',
      { resetInfo: JSON.stringify([preset[0], preset[1], session.username]) },
      45_000,
    );
    if (mode === 'reboot' || mode === 'factory') {
      sessions.delete(session.id);
      res.clearCookie(SESSION_COOKIE, { path: '/' });
    }
    res.json({ ok: true, ...(typeof result === 'object' && result ? result : {}) });
  }),
);

app.post(
  '/api/system/password',
  route(async (req, res) => {
    const session = res.locals.session as AppSession;
    const body = asRecord(req.body);
    const oldPassword = typeof body.oldPassword === 'string' ? body.oldPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (!/^[a-z0-9]{8,20}$/i.test(oldPassword) || !/^[a-z0-9]{8,20}$/i.test(newPassword)) {
      throw new RouterError(
        'The router requires an 8 to 20 character password using only letters and numbers.',
        'invalid_input',
      );
    }
    if (oldPassword === newPassword) {
      throw new RouterError('The new password must be different.', 'invalid_input');
    }
    const result = await session.client.postJson<{ p_status?: string }>(
      '/actionHandler/ajaxSet_wizard_step1.jst',
      {
        configInfo: JSON.stringify({
          newPassword,
          instanceNum: '3',
          oldPassword,
          ChangePassword: 'true',
        }),
      },
    );
    const status = asRecord(result).p_status;
    if (status === 'Good_PWD') {
      session.client.setPassword(newPassword);
      return res.json({ ok: true, status });
    }
    if (status === 'Default') {
      throw new RouterError('The router will not accept its default password.', 'invalid_input');
    }
    throw new RouterError('The current password is incorrect.', 'invalid_input');
  }),
);

// Static frontend (production build).
const distDir = path.resolve(process.cwd(), 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir, { index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.use((_req, res) => {
  res.status(404).json({ error: { message: 'Not found.', code: 'not_found' } });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const { message, code } = readableError(error);
  let status = 502;
  if (code === 'invalid_input' || code === 'invalid_gateway') status = 400;
  else if (code === 'authentication_failed' || code === 'session_expired') status = 401;
  else if (code === 'not_authenticated') status = 401;
  else if (code === 'unsupported') status = 422;
  else if (code === 'router_rejected' || code === 'pf_write_failed' || code === 'upnp_write_failed') status = 409;
  else if (code === 'router_timeout') status = 504;
  else if (code === 'router_unreachable' || code === 'router_empty_response') status = 502;
  else if (code === 'managed_disabled') status = 409;
  res.status(status).json({ error: { message, code } });
});

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastSeenAt > SESSION_IDLE_MS) sessions.delete(id);
  }
}, 10 * 60 * 1000).unref();

app.listen(PORT, HOST, () => {
  console.log(`Xfinity Unlocked API listening on http://${HOST}:${PORT}`);
  if (isVerbose()) logInfo('verbose router JSON logging enabled');
});
