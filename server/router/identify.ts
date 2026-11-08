import axios from 'axios';

/**
 * What a gateway will tell us before anyone signs in: its branding, the
 * login form it serves, and the web server banner.  Model and firmware are
 * only available after authentication, so they are not part of this probe.
 */
export interface GatewayIdentity {
  gateway: string;
  reachable: boolean;
  status: number;
  server: string;
  title: string;
  brand: string;
  webui: string;
  loginAction: string;
  message: string;
}

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { at: number; value: GatewayIdentity }>();

function clean(value: unknown, limit = 96): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function brandFrom(html: string, title: string): string {
  const logo =
    html
      .match(/(?:logo|brand)[_-]([a-z0-9_-]+)\.(?:png|svg|gif|jpe?g)/i)?.[1]
      ?.toLowerCase() ?? '';
  const haystack = `${logo} ${title}`.toLowerCase();
  if (/rogers/.test(haystack)) return 'Rogers';
  if (/xfinity|comcast/.test(haystack)) return 'Xfinity';
  if (/\bsky\b/.test(haystack)) return 'Sky';
  if (/shaw/.test(haystack)) return 'Shaw';
  if (/cox/.test(haystack)) return 'Cox';
  return clean(title.replace(/\s*(router|gateway|login)\s*$/i, ''), 32);
}

export async function identifyGateway(gateway: string): Promise<GatewayIdentity> {
  const cached = cache.get(gateway);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const unknown: GatewayIdentity = {
    gateway,
    reachable: false,
    status: 0,
    server: '',
    title: '',
    brand: '',
    webui: '',
    loginAction: '',
    message: 'No response from the gateway.',
  };

  let value = unknown;
  try {
    const response = await axios.get(`${gateway}/`, {
      timeout: 4000,
      responseType: 'text',
      validateStatus: () => true,
      headers: { 'User-Agent': 'xfinity-unlocked/0.1 (local dashboard)' },
    });
    const html = typeof response.data === 'string' ? response.data : String(response.data ?? '');
    const title = clean(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1], 64);
    const loginAction = clean(html.match(/<form[^>]+action=["']([^"']+)["']/i)?.[1], 64);
    const webui = /utilityFunctions\.js|name=["']username["']/i.test(html) ? 'RDK-B' : '';

    value = {
      gateway,
      reachable: true,
      status: response.status,
      server: clean(response.headers.server, 64),
      title,
      brand: brandFrom(html, title),
      webui,
      loginAction,
      message: response.status >= 400 ? `The gateway returned HTTP ${response.status}.` : '',
    };
  } catch {
    value = unknown;
  }

  cache.set(gateway, { at: Date.now(), value });
  return value;
}
