# segi-cli

CLI for logging in to Segi through the real browser SSO flow, saving that
session, and then reading Segi REST API data from `https://segiapi.extn.ai`.

This is meant for agents and automations that should not depend on an already
authenticated Chrome profile.

## Install

```bash
npm config set @bareecorporation:registry https://npm.pkg.github.com
npm install -g @bareecorporation/segi-cli
```

Or run without installing:

```bash
npx --yes --package @bareecorporation/segi-cli --@bareecorporation:registry=https://npm.pkg.github.com segi projects
```

If Playwright has no browser installed yet:

```bash
npx playwright install chromium
```

## Login

Run the browser SSO flow once:

```bash
segi login
```

The CLI opens `https://segi.extn.ai/login` and clicks the Google sign-in button.
Complete Google SSO in that browser window. After a Segi session is detected, the CLI saves cookies,
localStorage, sessionStorage, and any extracted Segi tokens to:

```bash
~/.config/segi-cli/session.json
```

The login browser uses a persistent profile at:

```bash
~/.config/segi-cli/browser-profile
```

That profile is separate from your normal Chrome profile, but it is reused by
later `segi login` runs so Google SSO does not start from a completely clean
browser each time.

If you need the Segi email/password form instead of Google SSO:

```bash
segi login --no-google
```

Later REST calls reuse that saved session:

```bash
segi whoami
segi triage --projects 19,20,21 --since 60m --format summary
```

You can override the session file:

```bash
segi --session-file ./segi.session.json projects
```

Token-only auth is still supported for non-interactive use:

```bash
SEGI_TOKEN='<accessToken>' segi projects
segi --token '<accessToken>' projects
segi --tokens-json ./segi.tokens.json projects
```

## Commands

```bash
segi login
segi projects
segi project --project 19
segi issues --project 19 --status UNRESOLVED --limit 20
segi issue --project 19 --issue 966 --events --events-limit 5
segi events --project 19 --limit 20
segi event --project 19 --event <eventId>
segi recordings --project 19 --limit 20
segi recording --project 19 --recording <recordingId>
```

Extra API query parameters can be passed repeatedly:

```bash
segi issues --project 19 --query status=UNRESOLVED --query release=abc123
```

## Agent Triage

For recurring Orca automation, use `triage` to inspect multiple projects in one
call:

```bash
segi triage --projects 19,20,21 --since 60m --status UNRESOLVED --limit 20 --format summary
```

Project IDs used by Baree automation:

- `19`: `reitwagen-next`
- `20`: `reitwagen-hono`
- `21`: `reitwagen-partners`

Exit code `10` means Segi returned `401 Unauthorized`. Run `segi login` again to
refresh the browser SSO session.

Do not run `segi login` from unattended automation. Scheduled jobs should report
that manual login refresh is required, then stop cleanly.

`logout` removes the cached session file:

```bash
segi logout
```

## Development

```bash
npm test
npm run check
```
