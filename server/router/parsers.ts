import * as cheerio from 'cheerio';

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
  range: { startIpv4: string; endIpv4: string; startIpv6: string; endIpv6: string };
  addresses: { ipv4: string; ipv6: string };
}

export interface UpnpInfo {
  enabled: boolean;
  zeroConfig: boolean;
  advertisementMinutes: number;
  ttl: number;
}

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

export interface LogEntry {
  time: string;
  level: string;
  description: string;
}

export interface SystemInfo {
  hardware: Section[];
  software: Section[];
  network: Section[];
  wireless: Section[];
  battery: Section[];
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

function clean(value: string | string[] | undefined | null): string {
  const text = Array.isArray(value) ? value[0] : value;
  return (text || '').replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();
}

function firstText($: cheerio.CheerioAPI, element: cheerio.Cheerio<any>): string {
  return clean(element.first().text());
}

function optionValue($: cheerio.CheerioAPI, select: cheerio.Cheerio<any>): string {
  if (!select.length) return '';
  const selected = select.find('option[selected]').first();
  if (selected.length) return selected.attr('value') || clean(selected.text());
  const first = select.find('option').first();
  return first.attr('value') || clean(first.text());
}

function optionLabel($: cheerio.CheerioAPI, select: cheerio.Cheerio<any>): string {
  if (!select.length) return '';
  const selected = select.find('option[selected]').first();
  if (selected.length) return clean(selected.text()) || selected.attr('value') || '';
  const first = select.find('option').first();
  return clean(first.text()) || first.attr('value') || '';
}

function isChecked($: cheerio.CheerioAPI, selector: string): boolean {
  return $(selector).filter((_, el) => $(el).attr('checked') !== undefined).length > 0;
}

function parseBool(value: string | undefined): boolean {
  return String(value || '').toLowerCase() === 'true';
}

function valueFromRow($: cheerio.CheerioAPI, row: cheerio.Cheerio<any>): string {
  const value = row.find('.value').first();
  if (value.length) {
    const text = clean(value.text());
    if (text) return text;
  }
  const input = row.find('input[type="text"], input[type="password"], input[type="number"]').first();
  if (input.length && input.attr('value')) return clean(input.attr('value'));
  const select = row.find('select').first();
  if (select.length) return optionLabel($, select);
  const img = row.find('img').first();
  if (img.length) return clean(img.attr('alt'));
  const checked = row.find('input[type="checkbox"]:checked, input[type="radio"]:checked').first();
  if (checked.length) {
    if (checked.attr('value')) return clean(checked.attr('value'));
    const label = row.find(`label[for="${checked.attr('id') || ''}"]`).first();
    if (label.length) return clean(label.text());
    return 'Enabled';
  }
  return '';
}

function labelFromRow($: cheerio.CheerioAPI, row: cheerio.Cheerio<any>): string {
  const label = row.find('.readonlyLabel').first();
  if (label.length) return clean(label.text());
  const fallback = row.find('label').first();
  return fallback.length ? clean(fallback.text()) : '';
}

export function parseSections(html: string, skipHidden = true): Section[] {
  const $ = cheerio.load(html);
  const sections: Section[] = [];
  $('#content .module').each((_, module) => {
    const el = $(module);
    if (skipHidden && el.hasClass('hidden')) return;
    const title = clean(el.find('h2, h3').first().text());
    const rows: KeyValue[] = [];
    el.find('.form-row').each((__, row) => {
      const r = $(row);
      const label = labelFromRow($, r);
      const value = valueFromRow($, r);
      if (label && value) rows.push({ label, value });
    });
    if (title || rows.length) sections.push({ title, rows });
  });
  return sections;
}

export function findSection(sections: Section[], title: string): Section | undefined {
  return sections.find((section) => clean(section.title).toLowerCase() === title.toLowerCase());
}

export function findRow(sections: Section[], title: string, label: string): string {
  const section = findSection(sections, title);
  const row = section?.rows.find((r) => r.label.toLowerCase() === label.toLowerCase());
  return row?.value || '';
}

export function parseOverview(atAGlanceHtml: string, connectionHtml: string) {
  const $ = cheerio.load(atAGlanceHtml);
  const sections = parseSections(connectionHtml);
  const ssid = clean($('#wifi-config .form-row .value').first().text()) || clean($('#wifissid').next('.value').text());
  const passkey = clean($('#wifi_passkey1').attr('value'));

  const home: Array<{ label: string; on: boolean }> = [];
  $('#home-network .form-row').each((_, row) => {
    const r = $(row);
    const label = labelFromRow($, r);
    if (!label) return;
    const alt = clean(r.find('img').attr('alt'));
    if (alt) home.push({ label, on: / on/i.test(alt) });
  });
  const firewallLevel =
    clean($('#home-network .form-row').filter((_, row) => /Firewall Security Level/i.test($(row).text())).find('.value').text()) ||
    '';

  const quickDevices: string[] = [];
  $('#internet-usage .form-row .readonlyLabel').each((_, el) => {
    const name = clean($(el).text());
    if (name) quickDevices.push(name);
  });

  const local = findSection(sections, 'Local IP Network');
  const wan = findSection(sections, 'WAN Network');
  const rogers = findSection(sections, 'Rogers Network');
  const wifiBands: Array<{
    ssid: string;
    band: string;
    status: string;
    protocols: string;
    security: string;
    clients: string;
    editId: string;
  }> = [];

  const wifiSections = sections.filter((section) => /^Private Wi-Fi Network/i.test(section.title));
  for (const section of wifiSections) {
    const bandRow = section.rows.find((row) => /Wireless Network \(Wi-Fi/i.test(row.label));
    const bandMatch = bandRow?.label.match(/Wi-Fi\s+(.+?)\)/i);
    const clientsRow = section.rows.find((row) => /No of Clients/i.test(row.label));
    const band = bandMatch?.[1] || '';
    wifiBands.push({
      ssid: clean(section.title.replace(/^Private Wi-Fi Network\s*-\s*/i, '')),
      band,
      status: bandRow?.value || '',
      protocols: section.rows.find((row) => /Supported Protocols/i.test(row.label))?.value || '',
      security: section.rows.find((row) => /^Security/i.test(row.label))?.value || '',
      clients: clientsRow?.value || '',
      editId: band.startsWith('2.4') ? '1' : band.startsWith('5') ? '2' : band.startsWith('6') ? '17' : '',
    });
  }

  return {
    ssid,
    passkey,
    home,
    firewallLevel,
    quickDevices,
    sections,
    local,
    wan,
    rogers,
    wifiBands,
  };
}

function parseDeviceInfo(cell: cheerio.Cheerio<any>): Record<string, string> {
  const info: Record<string, string> = {};
  const dl = cell.find('.device-info dl').first();
  if (!dl.length) return info;
  let current = '';
  dl.contents().each((_, node) => {
    if (node.type === 'tag' && node.name === 'dd') {
      current = clean(cheerio.load(node)('b').first().text());
    } else if (node.type === 'text') {
      const value = clean(node.data || '');
      if (current && value) {
        info[current] = value;
        current = '';
      }
    }
  });
  return info;
}

export function parseDevices(html: string): { devices: DeviceRecord[]; summary: FleetSummary } {
  const $ = cheerio.load(html);
  const devices: DeviceRecord[] = [];

  $('table.connected_dev').each((_, table) => {
    const t = $(table);
    const module = t.closest('.module');
    const online = /online/i.test(module.attr('id') || '') || /Online Devices/i.test(module.find('h2').first().text());
    t.find('tr').each((__, row) => {
      const r = $(row);
      if (r.find('th').length) return;
      const hostCell = r.find('td[headers="host-name"], td[headers="offline-device-host-name"]').first();
      if (!hostCell.length) return;
      const name = clean(hostCell.find('a.device-name').first().text());
      if (!name) return;
      const info = parseDeviceInfo(hostCell);
      const idMatch = r.find('input[id^="btn-"]').attr('id')?.match(/btn-(\d+)/);
      const id = idMatch ? Number(idMatch[1]) : null;
      const form = id !== null ? $(`#edit-device-${id}, #offline-edit-device-${id}`).first() : $();
      const modeValue = clean(form.find('input[name="ip"]:checked').val()).toLowerCase();
      const reservedIp = clean(form.find(`#staticIPAddress-${id}`).attr('value'));
      const comments = clean(form.find('textarea[name="comments"]').text());
      const addressMode: DeviceRecord['addressMode'] =
        modeValue === 'static' || modeValue === 'reserved' ? 'reserved' : modeValue === 'dhcp' ? 'dhcp' : 'unknown';
      devices.push({
        id,
        name,
        ipv4: info['IPv4 Address'] || '',
        ipv6: info['IPv6 Address'] || '',
        linkLocalIpv6: info['Local Link IPv6 Address'] || '',
        mac: info['MAC Address'] || '',
        comments,
        connection: clean(r.find('td[headers="connection-type"]').text()),
        rssi: clean(r.find('td[headers="rssi-level"]').text()),
        addressMode,
        reservedIp,
        online,
        blockable: true,
        editForm: form.length ? { mode: modeValue, reservedIp, comments } : null,
      });
    });
  });

  const summary: FleetSummary = {
    online: devices.filter((d) => d.online).length,
    offline: devices.filter((d) => !d.online).length,
    total: devices.length,
    wifi2: devices.filter((d) => /2\.4/.test(d.connection)).length,
    wifi5: devices.filter((d) => /5\s*GHz/i.test(d.connection)).length,
    wifi6: devices.filter((d) => /6\s*GHz/i.test(d.connection)).length,
    ethernet: devices.filter((d) => /ethernet/i.test(d.connection)).length,
  };
  return { devices, summary };
}

export function parseWifi(html: string): WifiInfo {
  const $ = cheerio.load(html);
  const vars: Record<string, string> = {};
  const allScripts = $('script').map((_, el) => $(el).html() || '').get().join('\n');
  for (const match of allScripts.matchAll(/var\s+([A-Za-z_][\w]*)\s*=\s*([^;\n]+);/g)) {
    vars[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }

  const ssids: WifiSsid[] = [];
  $('#private_wifi tr').each((index, row) => {
    if (index === 0) return;
    const r = $(row);
    const cells = r.find('td');
    if (cells.length < 5) return;
    const href = r.find('a').attr('href') || '';
    const idMatch = href.match(/id=(\d+)/);
    ssids.push({
      id: idMatch ? Number(idMatch[1]) : 0,
      name: clean(cells.eq(0).text()),
      band: clean(cells.eq(1).text()),
      mac: clean(cells.eq(2).text()),
      security: clean(cells.eq(3).text()),
    });
  });

  const radioEnable = new Map<string, boolean>([
    ['2.4 GHz', parseBool(vars.G_radio_enable)],
    ['5 GHz', parseBool(vars.G_radio_enable1)],
    ['6 GHz', parseBool(vars.G_radio_enable3)],
  ]);

  const radios: WifiRadio[] = [];
  $('#content .module').each((_, module) => {
    const m = $(module);
    const heading = clean(m.find('h2').first().text());
    const basicMatch = heading.match(/^([\d.]+)\s*GHz Wireless Basic Setting$/i);
    if (!basicMatch) return;
    const band = `${basicMatch[1]} GHz`;
    const ssidNumber = band.startsWith('2.4') ? '1' : band.startsWith('5') ? '2' : '17';
    const advanced: KeyValue[] = [];
    const advancedHeading = $(module).nextAll('.module').first();
    if (/Advanced Setting/i.test(clean(advancedHeading.find('h2').first().text()))) {
      advancedHeading.find('.form-row').each((__, row) => {
        const label = labelFromRow($, $(row));
        const value = valueFromRow($, $(row));
        if (label && value) advanced.push({ label, value });
      });
    }
    radios.push({
      band,
      ssidNumber,
      enabled: radioEnable.get(band) ?? true,
      mode: optionLabel($, m.find('#wireless_mode, #wireless_mode1, #wireless_mode3').first()),
      transmitPower: optionLabel($, m.find('#transmit_power, #transmit_power1, #transmit_power3').first()),
      channelAutomatic: m.find('input#channel_automatic, input#channel_automatic1, input#channel_automatic3').filter((__, el) => $(el).attr('checked') !== undefined).length > 0,
      channel: optionValue($, m.find('#channel_number, #channel_number1, #channel_number3').first()),
      advanced,
    });
  });

  const readOther = (tableId: string) => {
    const list: Array<{ name: string; band: string; mac: string; security: string }> = [];
    $(`#${tableId} tr`).each((index, row) => {
      if (index === 0) return;
      const cells = $(row).find('td');
      if (cells.length < 4) return;
      const name = clean(cells.eq(0).text());
      if (!name || name.toLowerCase() === 'null') return;
      list.push({
        name,
        band: clean(cells.eq(1).text()),
        mac: clean(cells.eq(2).text()),
        security: clean(cells.eq(3).text()),
      });
    });
    return list;
  };

  return {
    ssids,
    radios,
    wps: {
      enabled: parseBool(vars.G_wps_enabled),
      method: clean(vars.G_wps_method) || 'PushButton',
    },
    macFilter: {
      mode: optionValue($, $('#filtering_mode')) || 'allow_all',
      enabled: true,
    },
    otherNetworks: readOther('other_wifi'),
    publicNetworks: readOther('public_wifi'),
  };
}

export function parseSsidEdit(html: string, id: number): SsidEditInfo {
  const $ = cheerio.load(html);
  const allScripts = $('script').map((_, el) => $(el).html() || '').get().join('\n');
  const ssidMatch = allScripts.match(/var\s+ssid_number\s*=\s*"(\d+)"/);
  const title = clean($('#content h1').first().text());
  const bandMatch = title.match(/([\d.]+)\s*GHz/i);
  const options = (selector: string) =>
    $(selector)
      .find('option')
      .map((_, el) => ({
        value: clean($(el).attr('value')) || clean($(el).text()),
        label: clean($(el).text()),
      }))
      .get()
      .filter((option) => option.value);

  const bandwidths = $('[name^="channel_bandwidth"]')
    .map((_, el) => ({
      value: clean($(el).attr('value')),
      label: clean($(el).closest('.form-row').find('label').first().text()) || clean($(el).attr('value')),
    }))
    .get()
    .filter((option) => option.value);

  const radioSwitch = allScripts.match(
    /id:\s*"wireless-network-switch"[\s\S]{0,500}?state:\s*(true|false)\s*\?/,
  );

  return {
    id,
    ssidNumber: ssidMatch?.[1] || String(id),
    band: bandMatch?.[1] ? `${bandMatch[1]} GHz` : '',
    name: clean($('#network_name').val()),
    mode: optionValue($, $('#wireless_mode')),
    security: optionValue($, $('#security')),
    channelAutomatic: isChecked($, '#channel_automatic'),
    channel: optionValue($, $('#channel_number')),
    bandwidth: clean($('[name^="channel_bandwidth"]:checked').attr('value')),
    password: clean($('#network_password').val()),
    broadcast: isChecked($, '#broadcastSSID'),
    wmm: isChecked($, '#enableWMM'),
    enabled: radioSwitch ? radioSwitch[1] === 'true' : true,
    modes: options('#wireless_mode'),
    securities: options('#security'),
    channels: options('#channel_number'),
    bandwidths,
  };
}

export function parseFirewall(html: string, version: 'ipv4' | 'ipv6'): FirewallInfo {
  const $ = cheerio.load(html);
  const checked = $('input[name="firewall_level"]:checked').first();
  const normalizeLevel = (value: string) => {
    const v = clean(value).toLowerCase();
    if (version === 'ipv6') {
      // IPv6 firmware only supports three levels; never map "default" onto
      // the IPv4 "medium" level.
      if (v === 'custom') return 'custom';
      if (v === 'none') return 'none';
      return 'default';
    }
    if (v === 'high' || v === 'maximum') return 'high';
    if (v === 'medium' || v === 'typical') return 'medium';
    if (v === 'low' || v === 'minimum') return 'low';
    if (v === 'custom') return 'custom';
    if (v === 'none') return 'none';
    return v || 'low';
  };
  return {
    version,
    level: normalizeLevel(checked.attr('value') || ''),
    custom: {
      blockHttp: isChecked($, '#block_http'),
      blockIcmp: isChecked($, '#block_icmp'),
      blockMulticast: isChecked($, '#block_multicast'),
      blockPeer: isChecked($, '#block_peer'),
      blockIdent: isChecked($, '#block_ident'),
    },
  };
}

function fieldValue($: cheerio.CheerioAPI, selector: string): string {
  return clean($(selector).val());
}

export function parseRemoteManagement(html: string): RemoteManagementInfo {
  const $ = cheerio.load(html);
  const allScripts = $('script').map((_, el) => $(el).html() || '').get().join('\n');
  const boolVar = (name: string) => {
    const m = allScripts.match(new RegExp(`var\\s+${name}\\s*=\\s*(true|false)`));
    return m ? m[1] === 'true' : false;
  };
  const stringVar = (name: string) => {
    const m = allScripts.match(new RegExp(`var\\s+${name}\\s*=\\s*"([^"]*)"`));
    return m?.[1] || '';
  };
  const checkedAllow = $('input[name="single"]:checked').first().attr('value') || 'any';
  const joinParts = (parts: string[], separator: string) => {
    if (parts.every((part) => !part)) return '';
    return parts.join(separator);
  };
  const joinIpv4 = (prefix: string) =>
    joinParts([1, 2, 3, 4].map((n) => fieldValue($, `#${prefix}_${n}`)), '.');
  const joinIpv6 = (prefix: string) =>
    joinParts([1, 2, 3, 4, 5, 6, 7, 8].map((n) => fieldValue($, `#${prefix}_${n}`)), ':');
  return {
    http: { enabled: boolVar('HTTP'), port: stringVar('HTTPPORT') || fieldValue($, '#http') },
    https: { enabled: boolVar('HTTPS'), port: stringVar('HTTPSPORT') || fieldValue($, '#https') },
    allowType: ['any', 'single', 'range'].includes(checkedAllow) ? (checkedAllow as 'any' | 'single' | 'range') : 'any',
    single: { ipv4: joinIpv4('ip_address'), ipv6: joinIpv6('ipv6_address') },
    range: {
      startIpv4: joinIpv4('rangeip_address'),
      endIpv4: joinIpv4('endip_address'),
      startIpv6: joinIpv6('rangeipv6_address'),
      endIpv6: joinIpv6('endipv6_address'),
    },
    addresses: {
      ipv4: clean($('#content').text().match(/Remote Management Address \(IPv4\):\s*([\d.]+)/i)?.[1] || ''),
      ipv6: clean($('#content').text().match(/Remote Management Address \(IPv6\):\s*([0-9a-f:]+)/i)?.[1] || ''),
    },
  };
}

export function parseUpnp(html: string): UpnpInfo {
  const $ = cheerio.load(html);
  const allScripts = $('script').map((_, el) => $(el).html() || '').get().join('\n');
  const jsBool = (name: string) => {
    const m = allScripts.match(new RegExp(`var\\s+${name}\\s*=\\s*(true|false)`));
    return m ? m[1] === 'true' : false;
  };
  const jsNum = (name: string) => {
    const m = allScripts.match(new RegExp(`var\\s+${name}\\s*=\\s*(\\d+)`));
    return m ? Number(m[1]) : 0;
  };
  const periodVar = jsNum('jsAdPeriod');
  const periodField = Number(fieldValue($, '#period'));
  return {
    enabled: jsBool('jsEnableUPnP'),
    zeroConfig: jsBool('jsEnableZero'),
    advertisementMinutes: periodField || (periodVar ? Math.round(periodVar / 60) : 30),
    ttl: Number(fieldValue($, '#live')) || jsNum('jsTimeToLive') || 5,
  };
}

export function parseDmz(html: string): DmzInfo {
  const $ = cheerio.load(html);
  const allScripts = $('script').map((_, el) => $(el).html() || '').get().join('\n');
  const enabledMatch = allScripts.match(/var\s+jsEnableDMZ\s*=\s*(true|false)/);
  const host4Match = allScripts.match(/var\s+jsHost\s*=\s*"([^"]*)"/);
  const host6Match = allScripts.match(/var\s+jsHostv6\s*=\s*"([^"]*)"/);
  const host4 = clean(host4Match?.[1]);
  return {
    enabled: enabledMatch?.[1] === 'true',
    hostIpv4: host4 && host4 !== 'x' ? host4 : '',
    hostIpv6: clean(host6Match?.[1]) === 'x' ? '' : clean(host6Match?.[1]),
  };
}

function tableRows(
  $: cheerio.CheerioAPI,
  selector: string,
  mapper: (cells: cheerio.Cheerio<any>, row: cheerio.Cheerio<any>) => any,
): any[] {
  const rows: any[] = [];
  $(selector)
    .find('tr')
    .each((index, row) => {
      if (index === 0) return;
      const r = $(row);
      if (r.hasClass('acs-hide')) return;
      const cells = r.find('td');
      if (!cells.length) return;
      const mapped = mapper(cells, r);
      if (mapped) rows.push(mapped);
    });
  return rows;
}

export function parsePortTriggering(html: string): TriggerInfo {
  const $ = cheerio.load(html);
  const allScripts = $('script').map((_, el) => $(el).html() || '').get().join('\n');
  const stateMatch = allScripts.match(/\$\("#pt_switch"\)\.radioswitch\(\{[\s\S]{0,400}?state:\s*(true|false)\s*\?/);
  const rules = tableRows($, '#content table.data', (cells, row) => {
    const name = clean(cells.eq(0).text());
    if (!name || name.toLowerCase() === 'null') return null;
    const toggle = row.find('input[name="PortActive"]').first();
    const idFromInput = Number((toggle.attr('id') || '').replace('PortActive_', ''));
    const href = row.find('a').map((_, el) => $(el).attr('href') || '').get().join(' ');
    const idMatch = href.match(/(?:id|del)=(\d+)/);
    const id = Number.isFinite(idFromInput) && idFromInput > 0 ? idFromInput : idMatch ? Number(idMatch[1]) : null;
    const active = toggle.length ? toggle.attr('checked') !== undefined : null;
    return {
      id,
      name,
      protocol: clean(cells.eq(1).text()),
      triggerPorts: clean(cells.eq(2).text()),
      targetPorts: clean(cells.eq(3).text()),
      active,
    };
  });
  return { enabled: stateMatch ? stateMatch[1] === 'true' : null, rules };
}

function parseTrustedTable($: cheerio.CheerioAPI, selector: string): TrustedComputer[] {
  return tableRows($, selector, (cells, row) => {
    const name = clean(cells.eq(1).text());
    const address = clean(cells.eq(2).text());
    const span = row.find('span[id^="trusted_user_"]').first();
    if (!name && !address) return null;
    return {
      id: Number(span.attr('id')?.replace('trusted_user_', '') || 0) || null,
      name,
      address,
      trusted: clean(span.attr('switch-val')).toLowerCase() === 'on',
    };
  });
}

export function parseParentalSites(html: string): ParentalSitesInfo {
  const $ = cheerio.load(html);
  const scripts = $('script').map((_, el) => $(el).html() || '').get().join('\n');
  const enabled = /var\s+isManageEnabled\s*=\s*'true'/.test(scripts);
  const tables = $('#content table.data');
  const parseRuleTable = (index: number): ParentalRule[] => {
    const table = tables.eq(index);
    if (!table.length) return [];
    return tableRows($, `#content table.data:eq(${index})`, (cells, row) => {
      const value = clean(cells.eq(1).text());
      if (!value || value.toLowerCase() === 'null') return null;
      const del = row.find('a.del-btn').first();
      return {
        id: Number(clean(del.attr('id'))) || null,
        value,
        when: clean(cells.eq(2).text()),
      };
    });
  };
  // The first two data tables are blocked sites and blocked keywords. The
  // trusted table has its own id, so target it explicitly.
  const dataTables = $('table.data').filter((_, el) => !$(el).attr('id'));
  const siteTable = dataTables.eq(0);
  const keywordTable = dataTables.eq(1);
  const parsePlain = (table: cheerio.Cheerio<any>) =>
    table.find('tr').slice(1).map((_, row) => {
      const r = $(row);
      if (r.hasClass('acs-hide')) return null;
      const cells = r.find('td');
      if (!cells.length) return null;
      const value = clean(cells.eq(1).text());
      if (!value || value.toLowerCase() === 'null') return null;
      return { id: Number(clean(r.find('a.del-btn').attr('id'))) || null, value, when: clean(cells.eq(2).text()) };
    }).get().filter(Boolean) as ParentalRule[];

  return {
    enabled,
    sites: siteTable.length ? parsePlain(siteTable) : parseRuleTable(0),
    keywords: keywordTable.length ? parsePlain(keywordTable) : [],
    trusted: parseTrustedTable($, '#trusted_computers'),
  };
}

export function parseManagedServices(html: string): ManagedServicesInfo {
  const $ = cheerio.load(html);
  const scripts = $('script').map((_, el) => $(el).html() || '').get().join('\n');
  const enabledMatch = scripts.match(/jsEnableMS\s*=\s*(true|false)/);
  const services = tableRows($, '#blocked-services', (cells, row) => {
    const name = clean(cells.eq(1).text());
    if (!name || name.toLowerCase() === 'null') return null;
    const editHref = row.find('a.service_editbtn').attr('href') || '';
    const idMatch = editHref.match(/id=(\d+)/);
    return {
      id: idMatch ? Number(idMatch[1]) : null,
      name,
      protocol: clean(cells.eq(2).text()),
      startPort: clean(cells.eq(3).text()),
      endPort: clean(cells.eq(4).text()),
      when: clean(cells.eq(5).text()),
    };
  });
  return {
    enabled: enabledMatch?.[1] === 'true',
    services,
    trusted: parseTrustedTable($, '#trusted_computers'),
  };
}

export function parseLogEntries(value: unknown): LogEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry: any) => ({
    time: clean(entry.time),
    level: clean(String(entry.Level || '').replace(/\\n/g, '').replace(/\n/g, '')),
    description: clean(String(entry.Des || '').replace(/\\n/g, ' ').replace(/\n/g, ' ')),
  }));
}

export function parseSystemInfo(htmls: {
  hardware: string;
  software: string;
  network: string;
  wireless?: string;
  battery: string;
}): SystemInfo {
  return {
    hardware: parseSections(htmls.hardware),
    software: parseSections(htmls.software),
    network: parseSections(htmls.network),
    wireless: htmls.wireless ? parseSections(htmls.wireless) : [],
    battery: parseSections(htmls.battery),
  };
}
