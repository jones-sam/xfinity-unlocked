export interface KeyValue {
  label: string;
  value: string;
}

export interface Section {
  title: string;
  rows: KeyValue[];
}

export interface DeviceRecord {
  id: number | null;
  name: string;
  ipv4: string;
  ipv6: string;
  linkLocalIpv6: string;
  mac: string;
  comments: string;
  connection: string;
  rssi: string;
  addressMode: 'dhcp' | 'reserved' | 'unknown';
  reservedIp: string;
  online: boolean;
  blockable: boolean;
  editForm: {
    mode: string;
    reservedIp: string;
    comments: string;
  } | null;
}

export interface FleetSummary {
  online: number;
  offline: number;
  total: number;
  wifi2: number;
  wifi5: number;
  wifi6: number;
  ethernet: number;
}

export interface DeviceListResponse {
  devices: DeviceRecord[];
  summary: FleetSummary;
}

export interface WifiSsid {
  id: number;
  name: string;
  band: string;
  mac: string;
  security: string;
}

export interface WifiRadio {
  band: string;
  ssidNumber: string;
  enabled: boolean;
  mode: string;
  transmitPower: string;
  channelAutomatic: boolean;
  channel: string;
  advanced: KeyValue[];
}

export interface WifiInfo {
  ssids: WifiSsid[];
  radios: WifiRadio[];
  wps: { enabled: boolean; method: string };
  macFilter: { mode: string; enabled: boolean };
  otherNetworks: Array<{ name: string; band: string; mac: string; security: string }>;
  publicNetworks: Array<{ name: string; band: string; mac: string; security: string }>;
}

export interface SsidEditInfo {
  id: number;
  ssidNumber: string;
  band: string;
  name: string;
  mode: string;
  security: string;
  channelAutomatic: boolean;
  channel: string;
  bandwidth: string;
  password: string;
  broadcast: boolean;
  wmm: boolean;
  enabled: boolean;
  modes: Array<{ value: string; label: string }>;
  securities: Array<{ value: string; label: string }>;
  channels: Array<{ value: string; label: string }>;
  bandwidths: Array<{ value: string; label: string }>;
}

export interface FirewallInfo {
  version: 'ipv4' | 'ipv6';
  level: string;
  custom: {
    blockHttp: boolean;
    blockIcmp: boolean;
    blockMulticast: boolean;
    blockPeer: boolean;
    blockIdent: boolean;
  };
}

export interface RemoteManagementInfo {
  http: { enabled: boolean; port: string };
  https: { enabled: boolean; port: string };
  allowType: 'any' | 'single' | 'range';
  single: { ipv4: string; ipv6: string };
  range: {
    startIpv4: string;
    endIpv4: string;
    startIpv6: string;
    endIpv6: string;
  };
  addresses: { ipv4: string; ipv6: string };
}

export interface UpnpInfo {
  enabled: boolean;
  zeroConfig: boolean;
  advertisementMinutes: number;
  ttl: number;
}

export interface UpnpMapping {
  index: number;
  description: string;
  protocol: string;
  externalPort: string;
  internalPort: string;
  internalClient: string;
  enabled: boolean;
  leaseDuration: string;
  remoteHost: string;
}

export type UpnpResponse = UpnpInfo & {
  mappings: UpnpMapping[];
  mappingsError: string;
};

export interface DmzInfo {
  enabled: boolean;
  hostIpv4: string;
  hostIpv6: string;
}

export interface TriggerRule {
  id: number | null;
  name: string;
  protocol: string;
  triggerPorts: string;
  targetPorts: string;
  active: boolean | null;
}

export interface TriggerInfo {
  enabled: boolean | null;
  rules: TriggerRule[];
}

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

export interface PortForwardInput {
  name: string;
  protocol: PfProtocol;
  internalClient: string;
  startPort: number;
  endPort: number;
}

export interface ParentalRule {
  id: number | null;
  value: string;
  when: string;
}

export interface TrustedComputer {
  id: number | null;
  name: string;
  address: string;
  trusted: boolean;
}

export interface ParentalSitesInfo {
  enabled: boolean;
  sites: ParentalRule[];
  keywords: ParentalRule[];
  trusted: TrustedComputer[];
}

export interface ManagedService {
  id: number | null;
  name: string;
  protocol: string;
  startPort: string;
  endPort: string;
  when: string;
}

export interface ManagedServicesInfo {
  enabled: boolean;
  services: ManagedService[];
  trusted: TrustedComputer[];
}

export interface LogEntry {
  time: string;
  level: string;
  description: string;
}

export interface LogsResponse {
  mode: string;
  timeframe: string;
  entries: LogEntry[];
}

export interface ReportEntry {
  time?: string;
  Des?: string;
  Count?: string | number;
  Target?: string;
  Source?: string;
  Type?: string;
  [key: string]: unknown;
}

export interface ReportsResponse {
  mode: string;
  timeframe: string;
  entries: ReportEntry[];
}

export interface SystemInfo {
  hardware: Section[];
  software: Section[];
  network: Section[];
  wireless: Section[];
  battery: Section[];
}

export interface OverviewWifiBand {
  ssid: string;
  band: string;
  status: string;
  protocols: string;
  security: string;
  clients: string;
  editId: string;
}

export interface Overview {
  ssid: string;
  passkey: string;
  home: Array<{ label: string; on: boolean }>;
  firewallLevel: string;
  quickDevices: string[];
  sections: Section[];
  local?: Section;
  wan?: Section;
  rogers?: Section;
  wifiBands: OverviewWifiBand[];
}

export interface SessionInfo {
  authenticated: boolean;
  gateway?: string;
  username?: string;
  createdAt?: number;
}

export interface GatewayInfo {
  gateway: string;
  detected: boolean;
  fallback: string;
}

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

export interface MacFilterInfo {
  ssid: number;
  mode: string;
  entries: Array<{ name: string; mac: string }>;
  available: Array<{ name: string; mac: string }>;
}
