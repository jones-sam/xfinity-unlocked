import type {
  DeviceListResponse,
  DmzInfo,
  FirewallInfo,
  GatewayInfo,
  LogsResponse,
  MacFilterInfo,
  ManagedServicesInfo,
  Overview,
  ParentalSitesInfo,
  PortForwardInput,
  PortForwardState,
  RemoteManagementInfo,
  ReportsResponse,
  SessionInfo,
  SsidEditInfo,
  SystemInfo,
  TriggerInfo,
  UpnpResponse,
  WifiInfo,
} from './types';

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code = 'request_failed', status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('Accept', 'application/json');

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(
      'The local dashboard server is not reachable. Is it still running?',
      'network_error',
    );
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && path !== '/login' && path !== '/session') {
      window.dispatchEvent(new Event('xu:unauthorized'));
    }
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const nested = record.error;
    if (nested && typeof nested === 'object') {
      const error = nested as Record<string, unknown>;
      throw new ApiError(
        typeof error.message === 'string' ? error.message : 'The router rejected the request.',
        typeof error.code === 'string' ? error.code : 'request_failed',
        response.status,
      );
    }
    throw new ApiError(
      typeof payload === 'string' && payload ? payload : `Request failed with HTTP ${response.status}.`,
      'request_failed',
      response.status,
    );
  }

  return payload as T;
}

function body(value: unknown): string {
  return JSON.stringify(value);
}

export const api = {
  session: () => request<SessionInfo>('/session'),
  gateway: () => request<GatewayInfo>('/gateway'),
  login: (credentials: { username: string; password: string; gateway: string }) =>
    request<SessionInfo>('/login', { method: 'POST', body: body(credentials) }),
  logout: () => request<SessionInfo>('/logout', { method: 'POST' }),

  overview: () => request<Overview>('/overview'),
  devices: () => request<DeviceListResponse>('/devices'),
  saveDevice: (payload: {
    action: 'comments' | 'reserve' | 'unreserve';
    name: string;
    mac: string;
    comments: string;
    reservedIp?: string;
    addressMode?: string;
  }) => request<DeviceListResponse>('/devices', { method: 'POST', body: body(payload) }),

  wifi: () => request<WifiInfo>('/wifi'),
  ssid: (id: number) => request<SsidEditInfo>(`/wifi/ssid/${id}`),
  updateSsid: (id: number, payload: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/wifi/ssid/${id}`, { method: 'PUT', body: body(payload) }),
  macFilter: (id: number) => request<MacFilterInfo>(`/wifi/mac-filter/${id}`),
  updateMacFilter: (id: number, mode: string, entries: Array<{ name: string; mac: string }>) =>
    request<{ ok: boolean }>(`/wifi/mac-filter/${id}`, {
      method: 'PUT',
      body: body({ mode, entries }),
    }),

  firewall: () => request<{ ipv4: FirewallInfo; ipv6: FirewallInfo }>('/firewall'),
  updateFirewall: (version: 'ipv4' | 'ipv6', payload: Record<string, unknown>) =>
    request<FirewallInfo>(`/firewall/${version}`, { method: 'PUT', body: body(payload) }),

  remoteManagement: () => request<RemoteManagementInfo>('/remote-management'),
  updateRemoteManagement: (payload: Record<string, unknown>) =>
    request<{ ok: boolean }>('/remote-management', { method: 'PUT', body: body(payload) }),

  upnp: () => request<UpnpResponse>('/upnp'),
  updateUpnp: (payload: {
    enabled: boolean;
    zeroConfig: boolean;
    advertisementMinutes: number;
    ttl: number;
  }) => request<{ ok: boolean }>('/upnp', { method: 'PUT', body: body(payload) }),
  deleteUpnpMapping: (port: string, protocol: string, host = '') => {
    const query = new URLSearchParams({ protocol });
    if (host) query.set('host', host);
    return request<{ ok: boolean }>(
      `/upnp/mappings/${encodeURIComponent(port)}?${query.toString()}`,
      { method: 'DELETE' },
    );
  },

  dmz: () => request<DmzInfo>('/dmz'),
  updateDmz: (payload: { enabled: boolean; hostIpv4: string; hostIpv6: string }) =>
    request<DmzInfo>('/dmz', { method: 'PUT', body: body(payload) }),

  triggers: () => request<TriggerInfo>('/port-triggering'),
  addTrigger: (payload: Record<string, unknown>) =>
    request<TriggerInfo>('/port-triggering', { method: 'POST', body: body(payload) }),
  updateTrigger: (id: number, payload: Record<string, unknown>) =>
    request<TriggerInfo>(`/port-triggering/${id}`, { method: 'PUT', body: body(payload) }),
  deleteTrigger: (id: number) =>
    request<TriggerInfo>(`/port-triggering/${id}`, { method: 'DELETE' }),
  toggleTrigger: (id: number, enabled: boolean) =>
    request<TriggerInfo>(`/port-triggering/${id}/toggle`, {
      method: 'POST',
      body: body({ enabled }),
    }),
  setTriggersEnabled: (enabled: boolean) =>
    request<TriggerInfo>('/port-triggering/master', {
      method: 'POST',
      body: body({ enabled }),
    }),

  portForwarding: (force = false) =>
    request<PortForwardState>(`/port-forwarding${force ? '?force=1' : ''}`),
  addPortForward: (payload: PortForwardInput) =>
    request<{ ruleId: number | null; state: PortForwardState }>('/port-forwarding', {
      method: 'POST',
      body: body(payload),
    }),
  updatePortForward: (id: number, payload: PortForwardInput) =>
    request<{ ruleId: number; state: PortForwardState }>(`/port-forwarding/${id}`, {
      method: 'PUT',
      body: body(payload),
    }),
  deletePortForward: (id: number) =>
    request<PortForwardState>(`/port-forwarding/${id}`, { method: 'DELETE' }),
  togglePortForward: (id: number, enabled: boolean) =>
    request<PortForwardState>(`/port-forwarding/${id}/toggle`, {
      method: 'POST',
      body: body({ enabled }),
    }),
  setPortForwardingEnabled: (enabled: boolean) =>
    request<{ enabled: boolean | null }>('/port-forwarding/master', {
      method: 'POST',
      body: body({ enabled }),
    }),

  parentalSites: () => request<ParentalSitesInfo>('/parental/sites'),
  setParentalSitesEnabled: (enabled: boolean) =>
    request<ParentalSitesInfo>('/parental/sites/enabled', {
      method: 'POST',
      body: body({ enabled }),
    }),
  addParentalSite: (payload: Record<string, unknown>) =>
    request<ParentalSitesInfo>('/parental/sites', { method: 'POST', body: body(payload) }),
  deleteParentalSite: (id: string) =>
    request<ParentalSitesInfo>(`/parental/sites/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  trustSiteComputer: (payload: {
    id: number;
    trusted: boolean;
    name: string;
    address: string;
  }) =>
    request<{ ok: boolean }>('/parental/sites/trust', { method: 'POST', body: body(payload) }),

  parentalServices: () => request<ManagedServicesInfo>('/parental/services'),
  setParentalServicesEnabled: (enabled: boolean) =>
    request<ManagedServicesInfo>('/parental/services/enabled', {
      method: 'POST',
      body: body({ enabled }),
    }),
  addManagedService: (payload: Record<string, unknown>) =>
    request<ManagedServicesInfo>('/parental/services', { method: 'POST', body: body(payload) }),
  updateManagedService: (id: number, payload: Record<string, unknown>) =>
    request<ManagedServicesInfo>(`/parental/services/${id}`, {
      method: 'PUT',
      body: body(payload),
    }),
  deleteManagedService: (id: number) =>
    request<ManagedServicesInfo>(`/parental/services/${id}`, { method: 'DELETE' }),
  trustServiceComputer: (payload: {
    id: number;
    trusted: boolean;
    name: string;
    address: string;
  }) =>
    request<{ ok: boolean }>('/parental/services/trust', { method: 'POST', body: body(payload) }),

  reports: (mode: string, timeframe: string) =>
    request<ReportsResponse>(
      `/parental/reports?${new URLSearchParams({ mode, timeframe }).toString()}`,
    ),

  logs: (mode: string, timeframe: string) =>
    request<LogsResponse>(`/logs?${new URLSearchParams({ mode, timeframe }).toString()}`),

  ping: (destination: string, count = 4) =>
    request<Record<string, unknown>>('/diagnostics/ping', {
      method: 'POST',
      body: body({ destination, count }),
    }),
  ipv4Test: (destination: string, count = 4) =>
    request<Record<string, unknown>>('/diagnostics/ipv4', {
      method: 'POST',
      body: body({ destination, count }),
    }),
  ipv6Test: (destination: string, count = 4) =>
    request<Record<string, unknown>>('/diagnostics/ipv6', {
      method: 'POST',
      body: body({ destination, count }),
    }),
  traceroute: (destination: string) =>
    request<Record<string, unknown>>('/diagnostics/traceroute', {
      method: 'POST',
      body: body({ destination }),
    }),
  spectrum: () => request<unknown>('/diagnostics/spectrum'),

  system: () => request<SystemInfo>('/system'),
  reset: (mode: string, confirm?: string) =>
    request<Record<string, unknown>>('/system/reset', {
      method: 'POST',
      body: body({ mode, confirm }),
    }),
  changePassword: (oldPassword: string, newPassword: string) =>
    request<{ ok: boolean; status: string }>('/system/password', {
      method: 'POST',
      body: body({ oldPassword, newPassword }),
    }),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
