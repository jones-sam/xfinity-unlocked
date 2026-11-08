import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { URLSearchParams } from 'node:url';
import { logInfo, logRouterFailure, logRouterJson, logRouterResult } from '../log.js';

const MIN_GAP_MS = 120;
const DEFAULT_TIMEOUT = 25_000;

export class RouterError extends Error {
  code: string;
  status?: number;

  constructor(message: string, code = 'router_error', status?: number) {
    super(message);
    this.name = 'RouterError';
    this.code = code;
    this.status = status;
  }
}

interface CacheEntry {
  at: number;
  html: string;
}

export interface RouterCredentials {
  username: string;
  password: string;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalize a gateway typed by the user.  We deliberately only accept a
 * hostname/IP with an optional port; no paths, credentials or query strings.
 */
export function normalizeGateway(input: string): string {
  let raw = (input || '').trim();
  if (!raw) throw new RouterError('A gateway address is required.', 'invalid_gateway');
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RouterError('That gateway address is not valid.', 'invalid_gateway');
  }
  if (url.username || url.password) {
    throw new RouterError('Do not put credentials in the gateway address.', 'invalid_gateway');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new RouterError('Use only the gateway host, not a page path.', 'invalid_gateway');
  }
  if (!url.hostname) throw new RouterError('That gateway address is not valid.', 'invalid_gateway');
  return `${url.protocol}//${url.host}`;
}

function extractToken(html: string): string {
  const match =
    html.match(/var\s+token\s*=\s*["']([^"']+)["']/) ||
    html.match(/sessionCsrf\s*=\s*["']([^"']+)["']/) ||
    html.match(/csrfp_token\s*[=:]\s*["']([^"']+)["']/);
  return match?.[1] || '';
}

function isLoginPage(html: string): boolean {
  // The "Please Login First" string also appears in every page's i18n
  // dictionary, so only treat it as a login redirect when it is actually
  // executed by a bootstrap script. There are two variants:
  //   full pages:  alertLoc("Please Login First!"); location.href="home_loggedout.jst";
  //   AJAX calls:  alert("Please Login First!");    location.href="../index.jst";
  // Both must match, including the exclamation mark the router actually sends.
  return /(?:alertLoc|alert)\s*\(\s*["']Please Login First!?["']\s*\)[\s\S]{0,160}?location\.href\s*=\s*["'][^"']*(?:home_loggedout|index)\.jst["']/i.test(
    html,
  );
}

function responseSize(data: unknown): number {
  if (typeof data === 'string') return Buffer.byteLength(data);
  if (data == null) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(data));
  } catch {
    return 0;
  }
}

export class RouterClient {
  readonly gateway: string;
  readonly baseURL: string;
  private readonly credentials: RouterCredentials;
  private readonly jar = new CookieJar();
  private readonly http: AxiosInstance;
  private chain: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;
  private token = '';
  private cache = new Map<string, CacheEntry>();
  private loginPromise: Promise<void> | null = null;
  private loggedIn = false;
  lastUsedAt = Date.now();

  constructor(gateway: string, credentials: RouterCredentials) {
    this.gateway = gateway;
    this.baseURL = normalizeGateway(gateway);
    this.credentials = credentials;
    this.http = wrapper(
      axios.create({
        baseURL: this.baseURL,
        timeout: DEFAULT_TIMEOUT,
        maxRedirects: 0,
        validateStatus: () => true,
        jar: this.jar,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        },
      }),
    );
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const wait = MIN_GAP_MS - (Date.now() - this.lastRequestAt);
      if (wait > 0) await delay(wait);
      this.lastRequestAt = Date.now();
      return task();
    });
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async rawRequest(config: AxiosRequestConfig) {
    this.lastUsedAt = Date.now();
    const method = (config.method || 'GET').toUpperCase();
    const path = config.url || '/';
    const started = Date.now();
    try {
      const response = await this.http.request(config);
      logRouterResult(this.baseURL, method, path, response.status, Date.now() - started, responseSize(response.data));
      logRouterJson(this.baseURL, method, path, response.data);
      return response;
    } catch (error) {
      logRouterFailure(this.baseURL, method, path, Date.now() - started, error);
      const code = (error as { code?: string })?.code;
      if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
        throw new RouterError('The router did not respond in time. It may be busy; try again.', 'router_timeout', 504);
      }
      if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
        throw new RouterError(`Cannot reach the router at ${this.baseURL}.`, 'router_unreachable', 502);
      }
      throw error;
    }
  }

  private cookieHeader(url: string): string {
    try {
      return this.jar.getCookieStringSync(url);
    } catch {
      return '';
    }
  }

  private hasSessionCookie(): boolean {
    try {
      return this.jar.getCookiesSync(this.baseURL).some((cookie) => cookie.key === 'DUKSID');
    } catch {
      return false;
    }
  }

  async login(): Promise<void> {
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = this.performLogin().finally(() => {
      this.loginPromise = null;
    });
    return this.loginPromise;
  }

  private async performLogin(): Promise<void> {
    this.loggedIn = false;
    this.token = '';
    this.cache.clear();
    logInfo(`signing in to ${this.baseURL} as ${this.credentials.username}`);

    // A stale jar can make the router keep redirecting to the login page.
    await this.jar.removeAllCookies();

    const body = new URLSearchParams({
      username: this.credentials.username,
      password: this.credentials.password,
      locale: 'false',
    });

    const response = await this.enqueue(() =>
      this.rawRequest({
        method: 'POST',
        url: '/check.jst',
        data: body.toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );

    const html = typeof response.data === 'string' ? response.data : '';
    if (response.status >= 400) {
      throw new RouterError(`The router returned HTTP ${response.status} during login.`, 'login_failed', response.status);
    }
    if (/Authentication failed/i.test(html)) {
      throw new RouterError(
        'Authentication failed. Check the username and password, then try again.',
        'authentication_failed',
        401,
      );
    }

    // Some firmware responds with a page instead of a redirect.  Verify the
    // session by loading the dashboard, which also gives us the CSRF token.
    const probe = await this.enqueue(() =>
      this.rawRequest({
        method: 'GET',
        url: '/at_a_glance.jst',
        headers: this.cookieHeader(this.baseURL) ? { Cookie: this.cookieHeader(this.baseURL) } : {},
      }),
    );
    const probeHtml = typeof probe.data === 'string' ? probe.data : '';
    if (
      (probe.status >= 300 && probe.status < 400) ||
      isLoginPage(probeHtml) ||
      !/at_a_glance|Router > At a Glance|id="content"/i.test(probeHtml)
    ) {
      throw new RouterError(
        'The router rejected the sign-in. Check the username, password and gateway.',
        'authentication_failed',
        401,
      );
    }

    const token = extractToken(probeHtml);
    if (!token) {
      throw new RouterError('Signed in, but could not read a CSRF token from the router.', 'no_csrf_token');
    }
    this.token = token;
    this.loggedIn = true;
    logInfo(`signed in to ${this.baseURL}`);
    this.cache.set('/at_a_glance.jst', { at: Date.now(), html: probeHtml });
  }

  private async ensureLogin() {
    if (!this.loggedIn) await this.login();
  }

  private async fetchHtml(path: string, allowRetry = true): Promise<string> {
    await this.ensureLogin();
    const response = await this.enqueue(() =>
      this.rawRequest({
        method: 'GET',
        url: path,
        headers: this.cookieHeader(this.baseURL) ? { Cookie: this.cookieHeader(this.baseURL) } : {},
      }),
    );
    let html: string;
    if (typeof response.data === 'string') {
      html = response.data;
    } else {
      try {
        html = JSON.stringify(response.data ?? '');
      } catch {
        html = String(response.data ?? '');
      }
    }

    if (response.status >= 300 && response.status < 400) {
      if (allowRetry) {
        logInfo('router session expired; re-authenticating');
        await this.login();
        return this.fetchHtml(path, false);
      }
      throw new RouterError('The router redirected the request back to the login page.', 'session_expired', 401);
    }
    if (response.status >= 400) {
      throw new RouterError(`The router returned HTTP ${response.status}.`, 'router_http_error', response.status);
    }
    if (isLoginPage(html)) {
      if (allowRetry) {
        logInfo('router session expired; re-authenticating');
        await this.login();
        return this.fetchHtml(path, false);
      }
      throw new RouterError('The router session expired. Sign in again.', 'session_expired', 401);
    }
    if (!html.trim()) {
      throw new RouterError(`The router returned an empty page for ${path}.`, 'router_empty_response');
    }
    const token = extractToken(html);
    if (token) this.token = token;
    return html;
  }

  async getPage(path: string, ttlMs = 4_000): Promise<string> {
    const cached = this.cache.get(path);
    if (cached && Date.now() - cached.at < ttlMs) return cached.html;
    const html = await this.fetchHtml(path);
    this.cache.set(path, { at: Date.now(), html });
    if (this.cache.size > 80) {
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 20);
      oldest.forEach(([key]) => this.cache.delete(key));
    }
    return html;
  }

  async getUncached(path: string): Promise<string> {
    return this.fetchHtml(path);
  }

  async getJson<T = unknown>(path: string, ttlMs = 4_000): Promise<T> {
    const html = await this.getPage(path, ttlMs);
    const trimmed = html.trim();
    const unescaped = trimmed
      .replace(/^&quot;/, '"')
      .replace(/&quot;$/, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    try {
      return JSON.parse(unescaped) as T;
    } catch {
      throw new RouterError(`The router returned something that was not JSON for ${path}.`, 'invalid_json');
    }
  }

  async postForm(
    path: string,
    fields: Record<string, string | number | boolean>,
    timeoutMs?: number,
  ): Promise<string> {
    await this.ensureLogin();
    const attempt = async (retry: boolean): Promise<string> => {
      if (!this.token) await this.login();
      const body = new URLSearchParams();
      for (const [key, value] of Object.entries(fields)) body.set(key, String(value));
      body.set('csrfp_token', this.token);
      const response = await this.enqueue(() =>
        this.rawRequest({
          method: 'POST',
          url: path,
          data: body.toString(),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            ...(this.cookieHeader(this.baseURL) ? { Cookie: this.cookieHeader(this.baseURL) } : {}),
            Referer: `${this.baseURL}/`,
            'X-Requested-With': 'XMLHttpRequest',
          },
          ...(timeoutMs ? { timeout: timeoutMs } : {}),
        }),
      );
      let html: string;
      if (typeof response.data === 'string') {
        html = response.data;
      } else {
        try {
          html = JSON.stringify(response.data ?? '');
        } catch {
          html = String(response.data ?? '');
        }
      }
      if ((response.status >= 300 && response.status < 400) || isLoginPage(html)) {
        if (retry) {
          await this.login();
          return attempt(false);
        }
        throw new RouterError('The router session expired. Sign in again.', 'session_expired', 401);
      }
      if (response.status >= 400) {
        throw new RouterError(`The router returned HTTP ${response.status}.`, 'router_http_error', response.status);
      }
      this.invalidateWrites();
      return html;
    };
    return attempt(true);
  }

  async postJson<T = unknown>(
    path: string,
    fields: Record<string, string | number | boolean>,
    timeoutMs?: number,
  ): Promise<T> {
    const html = await this.postForm(path, fields, timeoutMs);
    const trimmed = html.trim();
    const unescaped = trimmed
      .replace(/^&quot;/, '"')
      .replace(/&quot;$/, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    try {
      return JSON.parse(unescaped) as T;
    } catch {
      return trimmed as T;
    }
  }

  async getWithHeaders(
    path: string,
    headers: Record<string, string> = {},
    timeoutMs?: number,
  ): Promise<string> {
    await this.ensureLogin();
    const attempt = async (retry: boolean): Promise<string> => {
      if (!this.token) await this.login();
      const response = await this.enqueue(() =>
        this.rawRequest({
          method: 'GET',
          url: path,
          headers: {
            ...headers,
            ...(this.cookieHeader(this.baseURL) ? { Cookie: this.cookieHeader(this.baseURL) } : {}),
          },
          ...(timeoutMs ? { timeout: timeoutMs } : {}),
        }),
      );
      const html = typeof response.data === 'string' ? response.data : '';
      if ((response.status >= 300 && response.status < 400) || isLoginPage(html)) {
        if (retry) {
          logInfo('router session expired; re-authenticating');
          await this.login();
          return attempt(false);
        }
        throw new RouterError('The router session expired. Sign in again.', 'session_expired', 401);
      }
      if (response.status >= 400) {
        throw new RouterError(`The router returned HTTP ${response.status}.`, 'router_http_error', response.status);
      }
      // Axios auto-parses JSON responses (for example the log endpoints), so
      // re-serialize them instead of returning "[object Object]".
      if (typeof response.data === 'string') return response.data;
      try {
        return JSON.stringify(response.data ?? '');
      } catch {
        return String(response.data ?? '');
      }
    };
    return attempt(true);
  }

  /**
   * Best-effort concurrent reads for port forwarding discovery.  This bypasses
   * the serialized queue, but only runs a handful of requests at a time and
   * includes its own spacing, which the router handles without throttling.
   */
  async getPagesConcurrent(paths: string[], concurrency = 3, gapMs = 70): Promise<Array<{ path: string; html: string; status: number }>> {
    await this.ensureLogin();
    const run = async (retry: boolean): Promise<Array<{ path: string; html: string; status: number }>> => {
      const results: Array<{ path: string; html: string; status: number }> = [];
      let expired = false;
      let index = 0;
      const workers = Array.from({ length: Math.min(concurrency, paths.length) }, async () => {
        while (index < paths.length) {
          const current = paths[index++];
          await delay(gapMs);
          try {
            const response = await this.rawRequest({
              method: 'GET',
              url: current,
              headers: this.cookieHeader(this.baseURL) ? { Cookie: this.cookieHeader(this.baseURL) } : {},
            });
            const html = typeof response.data === 'string' ? response.data : String(response.data || '');
            if ((response.status >= 300 && response.status < 400) || isLoginPage(html)) expired = true;
            results.push({ path: current, html, status: response.status });
          } catch {
            results.push({ path: current, html: '', status: 0 });
          }
        }
      });
      await Promise.all(workers);
      if (expired) {
        if (retry) {
          logInfo('router session expired during parallel scan; re-authenticating');
          await this.login();
          return run(false);
        }
        throw new RouterError('The router session expired during the scan. Sign in again.', 'session_expired', 401);
      }
      return results;
    };
    const results = await run(true);
    this.lastUsedAt = Date.now();
    return results;
  }

  setPassword(password: string) {
    this.credentials.password = password;
  }

  getCsrfToken(): string {
    return this.token;
  }

  isMasterWriteInProgress() {
    return !this.loggedIn;
  }

  invalidateWrites() {
    // Any successful write can change a cached page. Keep the token, clear pages.
    this.cache.clear();
  }
}

export function readableError(error: unknown): { message: string; code: string } {
  if (error instanceof RouterError) return { message: error.message, code: error.code };
  if (error instanceof Error) return { message: error.message, code: 'unknown_error' };
  return { message: 'Something went wrong talking to the router.', code: 'unknown_error' };
}
