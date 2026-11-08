const VERBOSE =
  process.env.XU_VERBOSE === '1' ||
  process.env.XU_VERBOSE === 'true' ||
  process.argv.includes('--verbose');

const SENSITIVE_KEY = /password|passwd|passkey|psk|secret|token|credential|authorization|cookie/i;

function stamp(): string {
  return new Date().toISOString().slice(11, 23);
}

/** Whether verbose router JSON logging is enabled. */
export function isVerbose(): boolean {
  return VERBOSE;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (!value || typeof value !== 'object') return value;
  const clean: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    clean[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redact(entry);
  }
  return clean;
}

function jsonBody(data: unknown): string | null {
  if (data && typeof data === 'object') {
    try {
      return JSON.stringify(redact(data));
    } catch {
      return null;
    }
  }
  if (typeof data !== 'string') return null;
  const text = data
    .trim()
    .replace(/^&quot;/, '"')
    .replace(/&quot;$/, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  if (!/^[[{"]/.test(text)) return null;
  try {
    return JSON.stringify(redact(JSON.parse(text)));
  } catch {
    return null;
  }
}

function size(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0B';
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}KB`;
}

/** A request the browser made to this local server. */
export function logHttp(message: string): void {
  console.log(`[${stamp()}] [http]   ${message}`);
}

/** A request this server made to the router's web UI. */
export function logRouter(gateway: string, message: string): void {
  console.log(`[${stamp()}] [router] ${gateway} ${message}`);
}

/** Lifecycle notes: sign-in, session recovery, background work. */
export function logInfo(message: string): void {
  console.log(`[${stamp()}] [app]    ${message}`);
}

export function logRouterResult(
  gateway: string,
  method: string,
  path: string,
  status: number,
  ms: number,
  bytes: number,
): void {
  logRouter(gateway, `${method.toUpperCase()} ${path} -> ${status} ${ms}ms ${size(bytes)}`);
}

export function logRouterFailure(gateway: string, method: string, path: string, ms: number, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  logRouter(gateway, `${method.toUpperCase()} ${path} -> FAILED ${ms}ms (${message})`);
}

/**
 * Verbose mode only: print the JSON body of a router response on one line so
 * concurrent requests do not interleave into unreadable blocks. Password,
 * token, cookie, and secret fields are redacted.
 */
export function logRouterJson(gateway: string, method: string, path: string, data: unknown): void {
  if (!VERBOSE) return;
  const body = jsonBody(data);
  if (!body) return;
  console.log(`[${stamp()}] [router:json] ${gateway} ${method.toUpperCase()} ${path} ${body}`);
}
