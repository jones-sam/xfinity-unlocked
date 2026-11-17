# Rogers Xfinity Unlocked

## Purpose
The default interface to my Rogers router does not let you port forward since they want you to use their stupid phone app. The API has endpoints for port forwarding, but they are not accessible in the default web UI. This application offers an alternative, cleaner UI with all the same functionality plus port forwarding without having to download their app.

## Details
A local, single-user dashboard for Rogers / Xfinity RDK-B gateways (tested on the
Sercomm **SCER11BEL / XER10**, firmware **8.5.0.19**). It might work on similar routers, depending if the api endpoints behave the same.

It replaces the stock web UI with a faster React interface and adds port-forwarding management that the stock
CloudUI can hide.

The app runs on your computer, logs in to the router over your LAN, and keeps the
router credentials only in server memory. Nothing is sent to a third party.

Before sign-in, the login screen probes the gateway without credentials and shows
its brand, web UI banner, and whether it serves the RDK-B login form, alongside
the hardware and firmware this build has been verified on. The gateway's exact
model and firmware are read after sign-in under **System → Hardware / Software**.

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
| `XU_VERBOSE` | unset | Set to `1` to log router JSON response bodies |
| `XU_ALLOWED_ORIGINS` | unset | Comma-separated extra origins allowed to submit writes (for a reverse proxy) |

The sign-in page fills in the detected default gateway automatically. You can
override it with any hostname or IP address that serves the same RDK-B UI
(an optional `http://` or `https://` prefix is accepted).

### LAN access

The API listens on `127.0.0.1` by default. To use the dashboard from another
device, set `HOST=0.0.0.0` (or a specific LAN address) and open
`http://<host>:4400`. Writes are accepted when the browser's `Origin` matches the
`Host` header, so direct LAN access works without extra configuration. Behind a
reverse proxy, set `XU_ALLOWED_ORIGINS=https://dashboard.example.lan`.

Only expose this on a trusted LAN: the browser talks to the dashboard over plain
HTTP, so the router password crosses the network in the clear. Use an HTTPS
reverse proxy or an SSH tunnel (`ssh -L 4400:127.0.0.1:4400 user@host`)
otherwise.

### Running as a service

A minimal systemd unit lives at
[`deploy/xfinity-unlocked.service`](deploy/xfinity-unlocked.service). It runs
from your checkout as your own user, so no separate service account or `/opt`
copy is needed. Edit `User`, `WorkingDirectory`, and `ExecStart`, then:

```bash
npm ci && npm run build
sudo install -m 0644 deploy/xfinity-unlocked.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now xfinity-unlocked
```

Allow port 4400 from your LAN only, for example with
`sudo ufw allow from 192.168.0.0/16 to any port 4400 proto tcp`. Update with
`git pull && npm ci && npm run build && sudo systemctl restart xfinity-unlocked`.

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

Verbose mode adds the JSON body of every router response on a single line:

```bash
npm run dev:verbose
# or
XU_VERBOSE=1 npm run dev
# or, for a production-style run
npm run start:verbose
# (npm start -- --verbose is equivalent)
```

```text
[12:34:56.792] [router:json] http://10.0.0.1 GET /actionHandler/ajax_parental_reports.jst?... {"entries":[]}
```

Verbose mode is off by default. Password, passkey, token, cookie, and secret
fields are replaced with `[redacted]`; non-JSON responses are not printed.

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

## Adapting to your router

If your Rogers/Xfinity gateway runs newer firmware, or its pages and handlers
differ, give your coding agent [`ADAPTING.md`](ADAPTING.md). It is a step-by-step
playbook: capture the router's real pages, map features to pages and handlers,
update the parsers and write paths, then verify changes without disturbing
existing rules or credentials.
