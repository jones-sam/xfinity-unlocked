import axios from 'axios';

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

const CONTROL_PATH = '/upnp/control/WANIPConnection0';
const SERVICE = 'urn:schemas-upnp-org:service:WANIPConnection:1';
const REQUEST_TIMEOUT = 6_000;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function tag(xml: string, name: string): string {
  const match = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function soapRequest(action: string, body: string, gateway: string) {
  const url = new URL(`http://${gateway}`);
  const endpoint = `http://${url.hostname}:49154${CONTROL_PATH}`;
  return axios.post(
    endpoint,
    `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="${SERVICE}">
      ${body}
    </u:${action}>
  </s:Body>
</s:Envelope>`,
    {
      timeout: REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPAction: `"${SERVICE}#${action}"`,
      },
      validateStatus: () => true,
    },
  );
}

/**
 * The IGD's HTTP server only serves one request at a time and drops the
 * occasional connection, so retry once after a short pause.
 */
async function soap(action: string, body: string, gateway: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await soapRequest(action, body, gateway);
    } catch (error) {
      lastError = error;
      await delay(220 + attempt * 180);
    }
  }
  throw lastError;
}

export class UpnpClient {
  constructor(private readonly gateway: string) {}

  async listMappings(): Promise<UpnpMapping[]> {
    const mappings: UpnpMapping[] = [];
    for (let index = 0; index < 64; index++) {
      const response = await soap(
        'GetGenericPortMappingEntry',
        `<NewPortMappingIndex>${index}</NewPortMappingIndex>`,
        this.gateway,
      );
      const xml = String(response.data || '');
      if (response.status >= 400 || /SpecifiedArrayIndexInvalid|NoSuchEntryInArray|713/i.test(xml)) break;
      if (!/<NewExternalPort>/i.test(xml)) break;
      // Give the tiny IGD web server room to breathe before the next call.
      await delay(180);
      mappings.push({
        index,
        description: tag(xml, 'NewPortMappingDescription'),
        protocol: tag(xml, 'NewProtocol'),
        externalPort: tag(xml, 'NewExternalPort'),
        internalPort: tag(xml, 'NewInternalPort'),
        internalClient: tag(xml, 'NewInternalClient'),
        enabled: tag(xml, 'NewEnabled').toLowerCase() === '1' || tag(xml, 'NewEnabled').toLowerCase() === 'true',
        leaseDuration: tag(xml, 'NewLeaseDuration'),
        remoteHost: tag(xml, 'NewRemoteHost'),
      });
    }
    return mappings;
  }

  async deleteMapping(externalPort: string, protocol: string, remoteHost = ''): Promise<void> {
    if (!/^\d{1,5}$/.test(externalPort)) throw new Error('Invalid external port.');
    if (!/^(TCP|UDP)$/i.test(protocol)) throw new Error('Invalid protocol.');
    const response = await soap(
      'DeletePortMapping',
      `<NewRemoteHost>${escapeXml(remoteHost)}</NewRemoteHost>
       <NewExternalPort>${escapeXml(externalPort)}</NewExternalPort>
       <NewProtocol>${escapeXml(protocol.toUpperCase())}</NewProtocol>`,
      this.gateway,
    );
    const xml = String(response.data || '');
    if (response.status >= 400 || /<s:Fault>/i.test(xml)) {
      const description = tag(xml, 'errorDescription') || 'The router rejected the UPnP delete request.';
      throw new Error(description);
    }
  }
}

export function gatewayHost(gateway: string): string {
  try {
    const url = new URL(/^https?:\/\//i.test(gateway) ? gateway : `http://${gateway}`);
    return url.hostname;
  } catch {
    return gateway.split(':')[0];
  }
}
