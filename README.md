# segi-fetch-cli

Browserless CLI for reading Segi projects, issues, events, and recordings from `https://segiapi.extn.ai`.

It is meant for agents and automations that should not depend on an authenticated Chrome session.

## Install

```bash
npm install -g @bareecorporation/segi-fetch-cli --registry=https://npm.pkg.github.com
```

Or run without installing:

```bash
npx --yes --package @bareecorporation/segi-fetch-cli --registry=https://npm.pkg.github.com segi-fetch projects
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

For SSO-heavy environments, cache Segi tokens once and let the CLI refresh them without opening Chrome:

```bash
segi-fetch login-google --credential '<google-id-token>'
segi-fetch whoami
segi-fetch triage --projects 19,20,21 --since 60m --format summary
```

The cached auth file is stored at:

```bash
~/.config/segi-fetch-cli/tokens.json
```

The Segi web app uses Google Identity Services and posts the resulting ID token to
`POST https://segiapi.extn.ai/api/auth/google`. `login-google` does the same exchange,
then stores the Segi `accessToken` and `refreshToken`. Later CLI calls refresh via
`POST /api/auth/refresh` automatically.

Password auth is also available for non-SSO accounts:

```bash
segi-fetch login-password --email you@example.com --password '...'
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

`logout` removes the cached token file:

```bash
segi-fetch logout
```

## Development

```bash
npm test
npm run check
```
