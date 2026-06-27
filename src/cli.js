#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import { defaultAuthPath, readSession, removeSession, writeSession } from './auth-store.js';
import { loginWithBrowser } from './browser-login.js';
import {
  SegiApiError,
  SegiClient,
  extractToken,
  isRecent,
  listItems,
  parseDurationMs,
  parseTokenValue
} from './segi.js';

const HELP = `segi

CLI for logging in to Segi with a browser SSO session, then reading Segi REST API data.

Usage:
  segi login [options]
  segi projects [options]
  segi project --project <id> [options]
  segi issues --project <id> [--status UNRESOLVED] [--limit 20] [options]
  segi issue --project <id> --issue <id> [--events] [options]
  segi events --project <id> [--limit 20] [options]
  segi event --project <id> --event <id> [options]
  segi recordings --project <id> [--limit 20] [options]
  segi recording --project <id> --recording <id> [options]
  segi triage --projects 19,20,21 [--since 60m] [--status UNRESOLVED] [options]
  segi login-google --credential <googleIdToken> [options]
  segi login-password --email <email> --password <password> [options]
  segi refresh [options]
  segi whoami [options]
  segi logout [options]

Auth:
  segi login
  SEGI_TOKEN=<accessToken> segi projects
  segi --token <accessToken> projects
  segi --tokens-json ./segi.tokens.json projects

Options:
  --base-url <url>        Segi API base URL. Default: https://segiapi.extn.ai
  --app-url <url>         Segi web app URL for browser login. Default: https://segi.extn.ai/projects
  --token <token>         Bearer token or JSON containing accessToken.
  --tokens-json <path>    File containing localStorage segi.tokens JSON.
  --session-file <path>   Cached Segi browser session file. Default: ${defaultAuthPath()}
  --auth-file <path>      Alias for --session-file.
  --no-session-file       Ignore cached browser session.
  --headless              Run browser login headless.
  --timeout <duration>    Browser login timeout. Default: 5m.
  --show-tokens           Print full tokens after login or refresh.
  --format <json|summary> Output format. Default: json
  --query key=value       Extra query parameter. Repeatable.
  --limit <n>             Query limit.
  --cursor <value>        Query cursor.
  --status <value>        Query issue status.
  --since <duration>      Recent filter for triage. Examples: 30m, 2h, 1d.
  -h, --help              Show this help.
`;

async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);

  if (!command || options.help) {
    process.stdout.write(HELP);
    return;
  }

  const sessionFile = options.sessionFile || options.authFile || defaultAuthPath();
  const token = resolveToken(options);
  const cachedSession = resolveCachedSession(options, sessionFile);
  const client = new SegiClient({
    token: token || extractToken(cachedSession),
    refreshToken: options.refreshToken || cachedSession?.refreshToken || cachedSession?.refresh_token,
    session: cachedSession,
    baseUrl: options.baseUrl,
    onTokens: (tokens) => writeSession(tokens, sessionFile)
  });
  const query = buildQuery(options);

  let payload;

  switch (command) {
    case 'login':
      payload = await loginWithBrowser({
        appUrl: options.appUrl,
        headless: Boolean(options.headless),
        timeoutMs: parseDurationMs(options.timeout || '5m'),
        browserName: options.browser
      });
      writeSession(payload, sessionFile);
      payload = redactSession(payload, options.showTokens, sessionFile);
      break;
    case 'projects':
      payload = await client.getProjects();
      break;
    case 'project':
      requireOption(options, 'project');
      payload = await client.getProject(options.project);
      break;
    case 'issues':
      requireOption(options, 'project');
      payload = await client.getIssues(options.project, query);
      break;
    case 'issue':
      requireOption(options, 'project');
      requireOption(options, 'issue');
      payload = await client.getIssue(options.project, options.issue);
      if (options.events) {
        payload = {
          issue: payload,
          events: await client.getIssueEvents(options.project, options.issue, {
            limit: options.eventsLimit || options.limit || 10
          })
        };
      }
      break;
    case 'events':
      requireOption(options, 'project');
      payload = await client.getEvents(options.project, query);
      break;
    case 'event':
      requireOption(options, 'project');
      requireOption(options, 'event');
      payload = await client.getEvent(options.project, options.event);
      break;
    case 'recordings':
      requireOption(options, 'project');
      payload = await client.listRecordings(options.project, query);
      break;
    case 'recording':
      requireOption(options, 'project');
      requireOption(options, 'recording');
      payload = await client.getRecording(options.project, options.recording);
      break;
    case 'triage':
      requireOption(options, 'projects');
      payload = await runTriage(client, options);
      break;
    case 'login-google':
      requireOption(options, 'credential');
      payload = await client.loginWithGoogleCredential(options.credential);
      payload = redactTokens(payload, options.showTokens, sessionFile);
      break;
    case 'login-password':
      requireOption(options, 'email');
      requireOption(options, 'password');
      payload = await client.loginWithPassword(options.email, options.password);
      payload = redactTokens(payload, options.showTokens, sessionFile);
      break;
    case 'refresh':
      payload = await client.refresh();
      payload = redactTokens(payload, options.showTokens, sessionFile);
      break;
    case 'whoami':
      payload = await client.getMe();
      break;
    case 'logout':
      removeSession(sessionFile);
      payload = { ok: true, sessionFile };
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }

  writeOutput(payload, options.format);
}

function parseArgs(argv) {
  const options = { query: [], format: 'json' };
  let command = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!command && !arg.startsWith('-')) {
      command = arg;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }

    if (['--events', '--no-auth-file', '--no-session-file', '--show-tokens', '--headless'].includes(arg)) {
      options[toCamel(arg.slice(2))] = true;
      continue;
    }

    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);

    const key = toCamel(arg.slice(2));
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    index += 1;

    if (key === 'query') options.query.push(next);
    else options[key] = next;
  }

  return { command, options };
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function resolveToken(options) {
  if (options.token) return parseTokenValue(options.token);

  if (options.tokensJson) {
    const raw = fs.readFileSync(options.tokensJson, 'utf8');
    return extractToken(JSON.parse(raw));
  }

  if (process.env.SEGI_TOKEN) return parseTokenValue(process.env.SEGI_TOKEN);
  if (process.env.SEGI_ACCESS_TOKEN) return parseTokenValue(process.env.SEGI_ACCESS_TOKEN);
  if (process.env.SEGI_TOKENS_JSON) {
    const raw = process.env.SEGI_TOKENS_JSON.trim();
    const maybeJson = fs.existsSync(raw) ? fs.readFileSync(raw, 'utf8') : raw;
    return extractToken(JSON.parse(maybeJson));
  }

  return '';
}

function resolveCachedSession(options, sessionFile) {
  if (options.noAuthFile || options.noSessionFile) return null;
  return readSession(sessionFile);
}

function buildQuery(options) {
  const query = {};
  for (const item of options.query || []) {
    const splitAt = item.indexOf('=');
    if (splitAt === -1) throw new Error(`Invalid --query value: ${item}`);
    query[item.slice(0, splitAt)] = item.slice(splitAt + 1);
  }

  for (const key of ['limit', 'cursor', 'status', 'environment', 'release', 'level', 'from', 'to']) {
    if (options[key] !== undefined) query[key] = options[key];
  }

  return query;
}

async function runTriage(client, options) {
  const projectIds = String(options.projects)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const sinceMs = parseDurationMs(options.since || '60m');
  const status = options.status || 'UNRESOLVED';
  const limit = options.limit || 20;
  const projects = [];

  for (const projectId of projectIds) {
    const issuesPayload = await client.getIssues(projectId, { status, limit });
    const issues = listItems(issuesPayload);
    const recentIssues = issues.filter((issue) =>
      isRecent(issue.lastSeenAt || issue.updatedAt || issue.lastEventAt, sinceMs)
    );

    projects.push({
      projectId,
      status,
      inspected: issues.length,
      recent: recentIssues.length,
      issues: recentIssues.map(summarizeIssue)
    });
  }

  return {
    source: 'segi',
    generatedAt: new Date().toISOString(),
    since: options.since || '60m',
    projects
  };
}

function summarizeIssue(issue) {
  return {
    id: issue.id,
    title: issue.title || issue.message || issue.errorClass || issue.name,
    status: issue.status,
    level: issue.level,
    count: issue.count || issue.eventCount || issue.eventsCount,
    firstSeenAt: issue.firstSeenAt,
    lastSeenAt: issue.lastSeenAt || issue.updatedAt || issue.lastEventAt,
    release: issue.release,
    url: issue.url || issue.pageUrl || issue.requestUrl,
    assignee: issue.assigneeUserId || issue.assignee?.name || issue.assignee?.email
  };
}

function redactTokens(tokens, showTokens, authFile) {
  if (showTokens) return tokens;
  return {
    ok: true,
    accessToken: tokens?.accessToken ? redact(tokens.accessToken) : undefined,
    refreshToken: tokens?.refreshToken ? redact(tokens.refreshToken) : undefined,
    needsOnboarding: tokens?.needsOnboarding,
    sessionFile: authFile || defaultAuthPath()
  };
}

function redactSession(session, showTokens, sessionFile) {
  if (showTokens) return session;
  return {
    ok: true,
    capturedAt: session.capturedAt,
    appOrigin: session.appOrigin,
    currentUrl: session.pageStorage?.url,
    cookieCount: session.cookieCount,
    accessToken: session.accessToken ? redact(session.accessToken) : undefined,
    refreshToken: session.refreshToken ? redact(session.refreshToken) : undefined,
    sessionFile
  };
}

function redact(value) {
  if (!value) return undefined;
  const text = String(value);
  if (text.length <= 12) return '***';
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function requireOption(options, key) {
  if (!options[key]) throw new Error(`Missing required option --${key.replace(/[A-Z]/g, '-$&').toLowerCase()}`);
}

function writeOutput(payload, format) {
  if (format === 'summary') {
    process.stdout.write(toSummary(payload));
    return;
  }

  if (format !== 'json') throw new Error(`Unsupported format: ${format}`);
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function toSummary(payload) {
  if (payload?.source === 'segi' && Array.isArray(payload.projects)) {
    const lines = [`Segi triage since ${payload.since}`];
    for (const project of payload.projects) {
      lines.push(`- project ${project.projectId}: ${project.recent}/${project.inspected} recent ${project.status} issues`);
      for (const issue of project.issues) {
        lines.push(`  - #${issue.id} ${issue.title || '(untitled)'} last=${issue.lastSeenAt || 'unknown'}`);
      }
    }
    return `${lines.join('\n')}\n`;
  }

  return `${JSON.stringify(payload, null, 2)}\n`;
}

main().catch((error) => {
  if (error instanceof SegiApiError) {
    const details = {
      error: error.message,
      status: error.status,
      url: error.url,
      body: error.body
    };
    process.stderr.write(`${JSON.stringify(details, null, 2)}\n`);
    process.exitCode = error.status === 401 ? 10 : 1;
    return;
  }

  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
