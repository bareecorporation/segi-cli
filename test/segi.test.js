import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import {
  SegiClient,
  buildCookieHeader,
  buildPath,
  extractToken,
  parseDurationMs,
  parseTokenValue
} from '../src/segi.js';

test('extracts common Segi token shapes', () => {
  assert.equal(extractToken({ accessToken: 'abc' }), 'abc');
  assert.equal(extractToken({ state: { accessToken: 'nested' } }), 'nested');
  assert.equal(parseTokenValue('Bearer token-value'), 'token-value');
  assert.equal(parseTokenValue('{"accessToken":"json-token"}'), 'json-token');
  assert.equal(
    extractToken({
      storageState: {
        origins: [{ origin: 'https://segi.extn.ai', localStorage: [{ name: 'segi.tokens', value: '{"accessToken":"storage-token"}' }] }]
      }
    }),
    'storage-token'
  );
});

test('builds paths with encoded query values', () => {
  assert.equal(buildPath('/api/projects/19/issues', { status: 'UNRESOLVED', q: 'a b' }), '/api/projects/19/issues?status=UNRESOLVED&q=a+b');
});

test('parses duration shortcuts', () => {
  assert.equal(parseDurationMs('30m'), 30 * 60 * 1000);
  assert.equal(parseDurationMs('2h'), 2 * 60 * 60 * 1000);
  assert.equal(parseDurationMs('1d'), 24 * 60 * 60 * 1000);
});

test('builds API cookie header from storage state', () => {
  assert.equal(
    buildCookieHeader(
      {
        cookies: [
          { name: 'session', value: 'abc', domain: '.extn.ai', path: '/', expires: -1 },
          { name: 'other', value: 'skip', domain: 'example.com', path: '/', expires: -1 }
        ]
      },
      'https://segiapi.extn.ai'
    ),
    'session=abc'
  );
});

let server;
let baseUrl;
let lastRequest;

before(async () => {
  server = createServer((request, response) => {
    lastRequest = {
      url: request.url,
      authorization: request.headers.authorization,
      cookie: request.headers.cookie
    };
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/auth/refresh') {
      response.end(JSON.stringify({ accessToken: 'refreshed-token', refreshToken: 'refresh-token' }));
      return;
    }
    response.end(JSON.stringify({ ok: true, items: [] }));
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test('client sends bearer auth and Segi issue URL', async () => {
  const client = new SegiClient({ token: 'test-token', baseUrl });
  await client.getIssues(19, { status: 'UNRESOLVED', limit: 5 });

  assert.equal(lastRequest.authorization, 'Bearer test-token');
  assert.equal(lastRequest.url, '/api/projects/19/issues?status=UNRESOLVED&limit=5');
});

test('client refreshes before request when only refresh token exists', async () => {
  const client = new SegiClient({ refreshToken: 'refresh-token', baseUrl });
  await client.getProjects();

  assert.equal(lastRequest.authorization, 'Bearer refreshed-token');
  assert.equal(lastRequest.url, '/api/projects');
});

test('client can send saved session cookies without bearer token', async () => {
  const client = new SegiClient({
    session: {
      storageState: {
        cookies: [{ name: 'session', value: 'cookie-token', domain: '127.0.0.1', path: '/', expires: -1 }]
      }
    },
    baseUrl
  });
  await client.getProjects();

  assert.equal(lastRequest.authorization, undefined);
  assert.equal(lastRequest.cookie, 'session=cookie-token');
});
