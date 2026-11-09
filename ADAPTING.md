# Adapting this dashboard to your Rogers/Xfinity router

**How to use this file (for the human):** give this file to your coding agent, or
tell it: *“Read `ADAPTING.md` and follow it to make this dashboard work with my
router.”* Fill in the intake answers in §1 first if you can.

**For the agent:** you are adapting an existing, working local dashboard
(`xfinity-unlocked`) to a different Rogers/Xfinity RDK-B gateway or a newer
firmware. The goal is feature parity on the new device — not a rewrite. Prefer
evidence from the actual router over assumptions from this document. When the
router disagrees with the code, the router is right.

---

## 0. Non-negotiables

1. **Never hardcode or commit credentials.** No passwords, session cookies, CSRF
   tokens, SSIDs, or personal identifiers in source, tests, fixtures, commit
   messages, or logs. Ask the human to type credentials into the app.
2. **Read before write.** Verify every read path first. Only then test writes,
   one at a time, on objects you created or can restore.
3. **Preserve the human’s router state.** Do not delete existing port-forward
   rules, disable the port-forwarding master switch, change Wi-Fi security,
   reboot, or factory-reset without explicit permission. If a test rule is
   needed, create a temporary high port and delete it in the same session,
   verifying the final state afterwards.
4. **Keep the architecture.** Express proxy on `127.0.0.1`, React + Vite
   frontend, server-side parsing with Cheerio, credentials only in server
   memory. Do not move router calls into the browser and do not add a cloud
   service.
5. **No silent failure.** If a feature cannot be supported on this firmware,
   surface a clear read-only/unsupported state in the UI and document it. Do not
   return fake data or swallow errors.
6. **Minimal, reversible changes.** Prefer adding a fallback or a label alias
   over replacing a working path. Keep API response shapes stable so the
   frontend does not need to churn.
7. **Stop and ask** before anything destructive, before changing auth flow in a
   way that could lock the human out, and before committing if you found
   credentials or personal data in the working tree.

---

## 1. Intake — ask the human first

Ask these, and wait for answers before write testing:

1. Gateway address (default `10.0.0.1`) and whether it is HTTP or HTTPS.
2. Router make/model and firmware version (stock UI → **System → Hardware /
   Software**; or the label on the device).
3. Which features they actually use, so you can prioritize.
4. Existing port-forward rules, DMZ entries, reserved IPs, or parental rules
   that must not be touched.
5. Permission to create and delete one temporary port-forward rule, and to test
   reversible writes (firewall level, UPnP on/off).
6. Do they want a branch/PR, or a direct commit?

Do **not** ask them to paste the router password into chat. They should enter it
in the dashboard login form. If a throwaway script is needed, read credentials
from environment variables at runtime.

---

## 2. Baseline the current build

```bash
git switch -c adapt/<router-model-or-firmware>
npm install
npm run check          # must pass before you change anything
npm run build
npm run dev            # API 127.0.0.1:4400, web 127.0.0.1:5173
```

Sign in through the UI and visit **every** page. Record, per page, whether it
loads, shows data, shows empty values, or errors. This is your regression
baseline. Keep the notes outside the repo (e.g. `/tmp/xu-adapt/notes.md`).

Useful signals:

- Terminal logs show `[http]`, `[router]`, and `[app]` lines for every request.
- `npm run dev:verbose` adds router JSON bodies with secrets redacted. Use it
  when a handler returns JSON.
- `XU_PF_SCAN_MAX` raises the port-forward discovery window (default 40, clamped
  8–128).
- `XU_DATA_DIR` moves `.data/pf-metadata.json` if you do not want to disturb the
  human’s metadata.

---

## 3. Capture ground truth from the router

Do not guess at markup or field names. Save the real pages.

Create a throwaway script **outside the repo**, for example
`/tmp/xu-adapt/capture.ts`. Import the repo’s client so cookies, CSRF and
re-login are handled for you:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { RouterClient } from '/absolute/path/to/repo/server/router/client.js';

const gateway = process.env.XU_GATEWAY!;
const client = new RouterClient(gateway, {
  username: process.env.XU_USER!,
  password: process.env.XU_PASS!,
});

await mkdir('/tmp/xu-adapt/pages', { recursive: true });

// Save the signed-out login page with a plain fetch (no session needed):
const loginHtml = await fetch(`${gateway}/`).then((response) => response.text());
await writeFile('/tmp/xu-adapt/pages/login.html', loginHtml);

await client.login();

const pages = [
  '/at_a_glance.jst',
  '/connection_status.jst',
  '/lan.jst',
  '/wifi.jst',
  '/wireless_network_configuration.jst',
  '/connected_devices_computers.jst',
  '/firewall_settings_ipv4.jst',
  '/firewall_settings_ipv6.jst',
  '/managed_sites.jst',
  '/managed_services.jst',
  '/managed_devices.jst',
  '/parental_reports.jst',
  '/port_forwarding.jst',
  '/port_triggering.jst',
  '/remote_management.jst',
  '/dmz.jst',
  '/device_discovery.jst',
  '/troubleshooting_logs.jst',
  '/network_diagnostic_tools.jst',
  '/wifi_spectrum_analyzer.jst',
  '/hardware.jst',
  '/software.jst',
  '/restore_reboot.jst',
];

for (const path of pages) {
  try {
    const html = await client.getPage(path, 0); // 0 = bypass cache
    const name = path.replace(/^\//, '').replace(/[^\w.-]+/g, '_');
    await writeFile(`/tmp/xu-adapt/pages/${name}.html`, html);
    console.log(path, html.length);
  } catch (error) {
    console.log(path, 'ERROR', (error as Error).message);
  }
}
```

Run it with credentials supplied only at runtime:

```bash
XU_GATEWAY=http://10.0.0.1 XU_USER=admin XU_PASS='…' \
  npx tsx /tmp/xu-adapt/capture.ts
```

Then:

- **Locate the stock login page** (`/`) and save it too — it is what
  `server/router/identify.ts` fingerprints. The capture script above does this
  with a signed-out `fetch`, because `RouterClient` signs in automatically.
- **Do not run the capture script against the WAN address.** LAN only.
- Test an **invalid** port-forward edit id (for example `?id=999`) and the valid
  id you know exists; record both byte sizes and the distinguishing markers.
- When a page is hidden behind `CloudUIEnable` (empty content, app-download
  marketing text), capture the handler URL from the page’s JS, not the page
  body.
- Confirm captured files are outside the repo: `git status --short` must not
  list them.

If a page 404s, grep the router’s own HTML/JS for replacements before assuming
the feature is gone:

```bash
grep -RhoE "(actionHandler/)?[A-Za-z0-9_./-]+\.(jst|php|json)" /tmp/xu-adapt/pages | sort -u
grep -RhoE "actionHandler/[A-Za-z0-9_.-]+" /tmp/xu-adapt/pages | sort -u
```

The stock UI’s browser devtools network tab is also valid evidence if the human
can reach the stock UI. Copy the **request shape** (path, form field names,
response text), never the session cookie or password.

---

## 4. Build the endpoint map

Fill this in for the target firmware. Put the result in your notes, and keep it
current in `README.md` if it differs structurally from the reference build.

| Feature | Stock page(s) | Write handler | Parser | Dashboard route | Result |
| --- | --- | --- | --- | --- | --- |
| Overview | `/at_a_glance.jst`, `/connection_status.jst` | — | `parseOverview` | `/api/overview` | |
| Devices | `/connected_devices_computers.jst` | `/actionHandler/ajaxSet_add_device.jst` | `parseDevices` | `/api/devices` | |
| Wi-Fi | `/wifi.jst`, `/wireless_network_configuration.jst` | `/actionHandler/ajaxSet_wireless_network_configuration*.jst` | `parseWifi`, `parseSsidEdit` | `/api/wifi` | |
| Firewall | `/firewall_settings_ipv4.jst`, `/firewall_settings_ipv6.jst` | `/actionHandler/ajaxSet_firewall_config*.jst` | `parseFirewall` | `/api/firewall` | |
| Port forwarding | `/port_forwarding.jst`, `/port_forwarding_edit.jst?id=N` | `/actionHandler/ajax_port_forwarding.jst` | `pf.ts` | `/api/port-forwarding` | |
| Port triggering | `/port_triggering.jst` | `/actionHandler/ajax_port_triggering.jst` | `parsePortTriggering` | `/api/port-triggering` | |
| Parental | `/managed_sites.jst`, `/managed_services.jst` | `/actionHandler/ajaxSet_*.jst` | `parseParentalSites`, `parseManagedServices` | `/api/parental/*` | |
| UPnP | `/device_discovery.jst` | `/actionHandler/ajaxSet_UPnP_configuration.jst` | `parseUpnp` | `/api/upnp` | |
| DMZ | `/dmz.jst` | `/actionHandler/ajaxSet_DMZ_configuration.jst` | `parseDmz` | `/api/dmz` | |
| Remote mgmt | `/remote_management.jst` | `/actionHandler/ajax_remote_management.jst` | `parseRemoteManagement` | `/api/remote-management` | |
| Logs | `/troubleshooting_logs.jst` | `/actionHandler/ajax_troubleshooting_logs.jst` | `parseLogEntries` | `/api/logs` | |
| Diagnostics | `/network_diagnostic_tools.jst` | `/actionHandler/ajax_network_diagnostic_tools.jst` | — | `/api/diagnostics/*` | |
| System | `/hardware.jst`, `/software.jst`, `/battery.jst` | `/actionHandler/ajaxSet_Reset_Restore.jst` | `parseSystemInfo` | `/api/system` | |

For each row, record the exact **markers** the code depends on: section titles,
row labels, table ids, hidden inputs, `var` names, response strings
(`Success!`, `Invalid Inputs!`, `alert(...)`).

---

## 5. Diagnose the breakage before changing code

| Symptom | Likely cause | Fix in |
| --- | --- | --- |
| Page loads, fields blank or zero | Renamed section/row labels or changed table markup | `server/router/parsers.ts` |
| API 500 `router_http_error` | Page or handler path renamed/removed | path maps in `server/index.ts`, `pf.ts` |
| Login succeeds, then every request bounces to login | New login-page marker, login form action/fields, or CSRF variable | `client.ts` (`isLoginPage`, `performLogin`, `extractToken`) |
| Write returns `Invalid Inputs!` or a different success string | Form field names/values changed, prerequisite switch off, or response text changed | `server/index.ts`, `pf.ts` (`normalizeRouterMessage`) |
| Port-forward list empty | Edit-page validity markers changed, IDs moved outside 1–40, or CloudUI gating changed | `pf.ts` (`probeRule`, `SCAN_LIMIT`) |
| Port-forward add succeeds but dashboard cannot identify the new rule | Discovery marker changed or new ID is above the scan window | `pf.ts` (`findNewRule`, `SCAN_LIMIT`) |
| Master switch shows unknown | `#pf_switch` / `UFWDStatus` markup changed | `pf.ts` (`parseMasterState`, `setMaster`) |
| Login screen shows “Unverified” for a good router | Login page title/logo/form markers changed | `server/router/identify.ts` |
| 401 `session_expired` after idling | Router now expires differently or re-login flow changed | `client.ts` (`isLoginPage`, `fetchHtml`, `postForm`, `getPagesConcurrent`) |
| Diagnostics time out | Handler response format or polling changed | `server/index.ts`, `parsers.ts` |

Parser guidance: most pages are parsed generically by `parseSections()` and
queried by **English** section titles and row labels (`findSection`, `findRow`).
If the router serves a different locale, switch its UI language to English
first; otherwise update the label sets deliberately. Do not switch to brittle
nth-child selectors when a label lookup still works.

---

## 6. Implement the adaptation

Work feature by feature, read-only first, and keep the following invariants.

### Client and auth (`server/router/client.ts`)

- `performLogin()` posts `username`, `password`, `locale=false` to
  `/check.jst`; update only if the real form action/fields changed.
- `isLoginPage()` must match the new expiry response. Keep it specific: the
  string “Please Login First” also exists in translation dictionaries, so match
  the executed `alert`/`alertLoc` plus redirect, as the current code does.
- Preserve one transparent re-auth + retry in `fetchHtml`, `postForm`,
  `getWithHeaders`, and whole-batch retry in `getPagesConcurrent`.
- Preserve request throttling, the in-memory cookie jar, 4s read cache, timeout
  classification (`router_timeout` 504, `router_unreachable` 502), and empty-page
  rejection.
- If a new CSRF token name appears, add it to `extractToken()` rather than
  replacing the existing patterns.

### Read pages and parsers (`server/index.ts`, `server/router/parsers.ts`)

- Add fallbacks for renamed paths (try both) instead of deleting the old path if
  both firmware families exist.
- Keep parsing server-side and keep response shapes stable. If a new field is
  needed, add it as optional.
- When a page is genuinely unavailable, return a typed, user-visible
  unsupported state; do not fabricate defaults.

### Writes

- Match the exact field names, value casing, and booleans from the captured
  stock request. RDK-B handlers are strict about names like `isChecked`,
  `UFWDStatus`, `ID`, and about `true`/`false` strings.
- Keep the `invalidateWrites()` / master-write-in-progress behavior around the
  port-forward master switch.
- Handle both response styles: plain text (`Success!`) and an
  `alert("...")` script. Extend `normalizeRouterMessage()` when the text changes.
- Never add a write path that cannot be undone from the dashboard.

### Port-forward discovery (`server/router/pf.ts`)

- The stock list is often hidden by `CloudUIEnable`, so discovery probes
  `/port_forwarding_edit.jst?id=N`. A valid id returns an edit page containing
  `id="portfwdedthead"` and `var ID="N"`; an invalid id returns the add page.
- If the new firmware changes those markers, update `probeRule()` and keep the
  “compare before/after id sets” logic in `findNewRule()`.
- Raise `XU_PF_SCAN_MAX` only with evidence about the real id range. Ids are
  TR-181 instance numbers, not a fixed contiguous list; new ids may skip numbers
  previously used. Never assume `max + 1`.
- Keep `.data/pf-metadata.json` semantics: it stores details the firmware hides
  (protocol, client, enabled). Do not move it into the repo.

### Pre-login identity (`server/router/identify.ts`)

- Keep the probe credential-free, short-timeout, and cached (~15s).
- Update `brandFrom()` when branding moves from logo filename/title to another
  marker.
- The compatibility card must say “verified on” only for builds actually
  verified; otherwise show the detected values and an unverified state.

### Frontend (`src/`)

- Keep React, the existing component structure, plain CSS, and `lucide-react`.
- Update `src/types.ts` and `src/api.ts` only as needed; keep optional fields
  optional.
- Do not add a UI control for an operation the firmware rejects. Show a
  read-only state with a short explanation instead.
- If you verify a new model/firmware combination, update
  `VERIFIED_ROUTER` in `src/pages/Login.tsx` and the “tested on” line in
  `README.md`, and add the known quirks to the README. Do not claim verification
  you did not perform.

### Documentation

- Update `README.md` “Details”, “Known firmware limitations”, and the config
  table when behavior differs.
- Keep `ADAPTING.md` accurate if you discover a better adaptation workflow.

---

## 7. Verify

### Read-only checks

```bash
curl -s http://127.0.0.1:4400/api/health
curl -s http://127.0.0.1:4400/api/identify?gateway=10.0.0.1
# With a signed-in cookie jar, check every GET route:
# /api/overview /api/devices /api/wifi /api/firewall /api/port-forwarding
# /api/port-triggering /api/parental/sites /api/parental/services /api/upnp
# /api/dmz /api/remote-management /api/logs /api/system /api/diagnostics/spectrum
```

For each: HTTP 200, expected JSON shape, no empty arrays caused by a parser
miss, and no login-page HTML leaking through as data.

### Write checks (only with permission)

- Port forwarding: create a temporary rule on a high port, confirm it appears
  with the right id, edit it, toggle it, delete it. Afterwards confirm existing
  rules are untouched and the master switch is still **enabled**.
- Firewall / UPnP / DMZ: record the original value, change it, restore it.
- Wi-Fi: prefer read-only verification. Do not change SSID, password, security,
  or radio state without explicit permission.
- Never test reboot or factory restore on someone else’s router unless they ask
  you to.

### Session expiry

```ts
// In a throwaway script, after login:
(client as any).jar.removeAllCookies();
const html = await client.getPage('/at_a_glance.jst', 0);
// Must return the page, not a login page: the client should re-auth and retry.
```

### Build and production smoke test

```bash
npm run check
npm run build
npm start        # open http://127.0.0.1:4400, sign in, click every page
```

Confirm the browser console is clean, the server logs show expected
`[router]` lines, and no secrets appear in either.

---

## 8. Hygiene before committing

```bash
git status --short
git diff --stat
git diff            # review every line
```

- Captured pages, notes, screenshots, `.data/`, `dist/`, logs, and scratch
  scripts must **not** be staged. They belong in `/tmp` or are gitignored.
- Scan the tree and history for credentials and personal data:

```bash
# Tracked files and full history
git grep -n -I -E 'password\s*[:=]\s*["'"'"'][^"'"'"']+' -- . || true
git rev-list --all | while read c; do git grep -n -I 'KNOWN_SECRET' "$c"; done

# Everything in the working directory, including ignored files
grep -rIn --exclude-dir=node_modules --exclude-dir=.git 'KNOWN_SECRET' .

git status --ignored --short
```

- Re-check that no router password, Wi-Fi password, serial number, public IP, or
  personal hostname appears in the diff or commit message.
- Write a focused commit message that names the firmware/model and what was
  adapted. Do not push unless asked.

---

## 9. Report back

Use this template:

```markdown
## Router
- Model / firmware:
- Gateway:
- Stock UI quirks observed:

## What broke
- Feature → symptom → evidence (page/handler/marker)

## What changed
- File → change → why

## Verified
- Read endpoints:
- Writes (and how state was restored):
- Session expiry:
- npm run check / build / production smoke:

## Not verified / unsupported
- …

## Safety confirmation
- Existing port-forward rules untouched:
- Port-forward master switch still enabled:
- No credentials or personal data added to the repo:
```

### Definition of done

- [ ] Every page loads with real data, or shows a clear unsupported/read-only state.
- [ ] Every write was tested on a reversible object, and the original state was restored.
- [ ] Existing port-forward rules and the master switch were verified unchanged.
- [ ] Session expiry recovers without a manual re-login.
- [ ] `npm run check`, `npm run build`, and a production smoke test pass.
- [ ] No credentials, cookies, serial numbers, or personal identifiers in the tree, history, or commit message.
- [ ] `README.md` states the verified model/firmware and any new limitations.
- [ ] The report lists what remains unverified.

---

## Appendix A — reference build facts

These describe the build this playbook was written against. Treat them as
hypotheses for the new router, not laws.

- Reference: Sercomm **SCER11BEL / Rogers XER10**, firmware **8.5.0.19**.
- Login: `POST /check.jst` with `username`, `password`, `locale=false`; session
  cookie `DUKSID`; CSRF exposed as `var token = "…"`, `sessionCsrf = "…"`, or
  `csrfp_token`; AJAX writes also send `csrfp_token`.
- Stock pages are `.jst`; writes are `actionHandler/ajax*.jst` form posts.
- `CloudUIEnable=true` hides the port-forward list and DMZ/managed-device
  pages, but the underlying handlers still work.
- Port-forward ids are `Device.NAT.PortMapping.{i}` instances. Allocation is
  “next counter value, skipping occupied ids”; ids are not contiguous and can
  exceed 9. Discovery scans 1–40 by default.
- Managed sites/services reject writes while their master switch is off; the
  dashboard returns `409 managed_disabled` before attempting them.
- Rogers-branded admin accounts ignore radio on/off and WPS writes over the web
  UI; the dashboard shows them read-only.
- SSID 17 (6 GHz) is read-only; the SSID handler has no WPA3 case and can
  silently downgrade to WPA2.
- Port-trigger add/edit on 8.5.0.19 stores the name but not protocol/ports.
- Per-device byte counters are not exposed locally; do not invent a usage page.

## Appendix B — commands worth remembering

```bash
# Dev with router JSON logging (restart required after changing the flag)
XU_VERBOSE=1 npm run dev

# Widen port-forward discovery
XU_PF_SCAN_MAX=80 npm run dev

# Keep a separate metadata store while experimenting
XU_DATA_DIR=/tmp/xu-adapt/data npm run dev

# Type-check only
npm run check
```
