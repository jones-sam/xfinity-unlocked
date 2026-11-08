function stamp(): string {
  return new Date().toISOString().slice(11, 23);
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
