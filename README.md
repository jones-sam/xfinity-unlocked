# Xfinity Unlocked

A local, single-user dashboard for Rogers / Xfinity RDK-B gateways (tested on the
Sercomm **SCER11BEL / XER10**, firmware **8.5.0.19**). It replaces the stock web UI
with a faster React interface and adds port-forwarding management that the stock
CloudUI can hide.

The app runs on your computer, logs in to the router over your LAN, and keeps the
router credentials only in server memory. Nothing is sent to a third party.

## Features

- **Overview** — gateway, WAN/LAN addressing, connected clients, Wi-Fi summary,
  firewall level, and the router's at-a-glance sections.
- **Devices** — every known host (online and offline), DHCP lease details, RSSI,
  connection type, comments, and static IP reservations.
- **Wi-Fi** — SSIDs, radios, channels, security, WPS status, per-SSID editing, and
  MAC access filters.
- **Port forwarding** — full rule management (add, edit, delete, enable/disable)
  plus the master port-forwarding switch. Rules created outside this app are
  discovered and marked as having unknown details when the firmware hides them.
- **Firewall** — IPv4 and IPv6 levels and per-protocol blocking options.
- **Parental controls** — managed sites, blocked keywords, managed services,
  trusted computers, and activity reports.
- **Advanced** — UPnP/IGD mappings, DMZ, port triggering, and remote management.
- **Diagnostics** — ping, IPv4/IPv6 connectivity, traceroute, and Wi-Fi spectrum
  analysis.
- **Logs** — system, event, and firewall logs with selectable time ranges.
- **System** — hardware/software/firmware details, network statistics, reboot and
  factory-restore actions, and password changes.

## Requirements

- Node.js 20 or newer (developed on Node 25).
- A Rogers/Xfinity RDK-B gateway reachable at `10.0.0.1` (or another LAN address).
- Router administrator credentials. You enter these in the app; they are never
  written to disk or baked into the source.

## Getting started

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:5173>. Vite serves the React app and proxies `/api` to the
local API on `127.0.0.1:4400`.

For a production-style run:

```bash
npm run build
npm start
```

Then open <http://127.0.0.1:4400>. `npm start` serves the compiled frontend from
`dist/`.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4400` | API / production web port |
| `HOST` | `127.0.0.1` | Bind address for the server |
| `XU_DEFAULT_GATEWAY` | `10.0.0.1` | Fallback gateway if auto-detection fails |
| `XU_DATA_DIR` | `./.data` | Where port-forwarding metadata is stored |
| `XU_PF_SCAN_MAX` | `40` | Highest port-forwarding ID to probe |

The sign-in page fills in the detected default gateway automatically. You can
override it with any hostname or IP address that serves the same RDK-B UI
(an optional `http://` or `https://` prefix is accepted).

## How it works

The browser cannot talk to the router directly: the router has no JSON API and
its session cookies/CORS policy prevent cross-origin calls. This project uses a
small Express server as a same-origin proxy.

- `server/router/client.ts` — cookie jar, login/relogin, CSRF token extraction,
  request throttling, caching, and form/JSON helpers.
- `server/router/parsers.ts` — Cheerio-based parsers for every router page.
- `server/router/pf.ts` — port-forwarding discovery, writes, and the local metadata
  registry.
- `server/router/upnp.ts` — direct IGD SOAP calls for active UPnP mappings.
- `server/index.ts` — REST API, in-memory sessions, static file serving.
- `src/` — React + Vite frontend (plain CSS, `lucide-react` icons).

### Console logging

The API process logs both sides of every operation:

```text
[12:34:56.789] [http]   GET /api/port-forwarding -> 200 1234ms sid=abcd1234
[12:34:56.790] [router] http://10.0.0.1 GET /port_forwarding.jst -> 200 310ms 44.9KB
[12:34:56.791] [app]    router session expired; re-authenticating
```

- `[http]` lines show the browser's method, path, response status, duration, and
  the first eight characters of the app session id.
- `[router]` lines show the gateway, method, path, status, duration, and response
  size for every request sent to the router.
- `[app]` lines show sign-in, re-authentication, and session lifecycle events.

Passwords, cookies, CSRF tokens, and request bodies are never logged.

### Router session recovery

RDK-B firmware often expires an admin session without an HTTP error: it returns
its login page with status `200`, or an AJAX handler returns a small
`alert("Please Login First!")` script. The client detects both forms, signs in
again with the credentials held in memory, and retries the request once. Parallel
port-forwarding scans do the same for the whole batch.

If re-authentication fails, the API returns `401 session_expired` and the browser
asks for credentials instead of silently rendering empty pages. Empty router
responses are treated as errors and are not cached. Router timeouts surface as
`504 router_timeout`; unreachable gateways as `502 router_unreachable`.

### Sessions and security

- Credentials live only in the Node process for the lifetime of the session.
- The browser gets an `HttpOnly`, `SameSite=Strict` `xu_session` cookie.
- Browser sessions expire after 12 hours of inactivity; at most 5 are kept.
  Router sessions are refreshed transparently as described above.
- The server binds to `127.0.0.1` by default and rejects cross-site writes.
- Port-forwarding metadata (protocol, internal client, enabled state) is stored in
  `.data/pf-metadata.json` because the firmware does not expose those fields on
  edit pages. Delete this file to forget the app's metadata.

## Known firmware limitations

These come from the router's stock handlers, not this dashboard:

- Port-forwarding master state and the rule list are not readable while
  `CloudUIEnable=true`. Rules are discovered by probing
  `port_forwarding_edit.jst?id=N` (IDs 1–40 by default), which can take a few
  seconds.
- Edit pages expose only the service name and ports. Protocol, internal client,
  and enabled state are known only for rules created or edited through this app.
  External rules are shown as “unknown”.
- DMZ and managed-device blocking pages are gated by `CloudUIEnable`. Managed
  device blocking is therefore unavailable.
- Managed sites and services reject all add/edit/delete/trust writes with a
  generic `Invalid Inputs!` while their master switch is off. The dashboard
  checks the switch first, returns a clear `409` error, and disables the affected
  controls until the feature is enabled.
- Managed-site rules require a full URL. If you enter a bare domain such as
  `example.com`, the dashboard adds `https://` before sending it to the router.
- SSID editing works for SSIDs 1 (2.4 GHz) and 2 (5 GHz). SSID 17 (6 GHz) is
  read-only.
- Radio enable/disable and WPS writes are ignored for Rogers-branded admin
  accounts, so those controls are read-only here.
- The SSID handler has no WPA3 cases. Saving an existing WPA3 network may silently
  downgrade it to WPA2. The Wi-Fi page warns about this.
- Port-trigger add/edit on firmware 8.5.0.19 stores the service name but not the
  protocol or ports (a stock-handler bug, reproducible with the stock UI's own
  request). Rules can still be listed, enabled, and deleted.
- Diagnostic counts are limited to 1–4 by the firmware; traceroute can take over
  a minute.

## Disclaimer

This is an unofficial tool. It is not affiliated with Rogers, Comcast, Xfinity, or
Sercomm. Router firmware varies; use at your own risk and keep a backup of any
configuration you change.
