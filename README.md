# segi-fetch-cli

Browserless CLI for reading Segi projects, issues, events, and recordings from `https://segiapi.extn.ai`.

It is meant for agents and automations that should not depend on an authenticated Chrome session.

## Install

```bash
npm install -g segi-fetch-cli
```

Or run without installing:

```bash
npx -y segi-fetch-cli projects
```

## Auth

The CLI uses the same bearer token that the Segi web app sends to `segiapi.extn.ai`.

```bash
export SEGI_TOKEN='<accessToken>'
segi-fetch projects
```

It also accepts a JSON file shaped like the browser `localStorage` value for `segi.tokens`:

```bash
segi-fetch --tokens-json ./segi.tokens.json projects
```

Supported token fields:

- `accessToken`
- `access_token`
- `token`
- `jwt`
- nested `state.accessToken`

## Commands

```bash
segi-fetch projects
segi-fetch project --project 19
segi-fetch issues --project 19 --status UNRESOLVED --limit 20
segi-fetch issue --project 19 --issue 966 --events --events-limit 5
segi-fetch events --project 19 --limit 20
segi-fetch event --project 19 --event <eventId>
segi-fetch recordings --project 19 --limit 20
segi-fetch recording --project 19 --recording <recordingId>
```

Extra API query parameters can be passed repeatedly:

```bash
segi-fetch issues --project 19 --query status=UNRESOLVED --query release=abc123
```

## Agent Triage

For recurring Orca automation, use `triage` to inspect multiple projects in one call:

```bash
segi-fetch triage --projects 19,20,21 --since 60m --status UNRESOLVED --limit 20 --format summary
```

Project IDs used by Baree automation:

- `19`: `reitwagen-next`
- `20`: `reitwagen-hono`
- `21`: `reitwagen-partners`

Exit code `10` means Segi returned `401 Unauthorized`, usually because `SEGI_TOKEN` is missing or expired.

## Development

```bash
npm test
npm run check
```
