import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { SegiClient, buildPath, extractToken, parseDurationMs, parseTokenValue } from '../src/segi.js';

test('extracts common Segi token shapes', () => {
  assert.equal(extractToken({ accessToken: 'abc' }), 'abc');
  assert.equal(extractToken({ state: { accessToken: 'nested' } }), 'nested');
  assert.equal(parseTokenValue('Bearer token-value'), 'token-value');
  assert.equal(parseTokenValue('{"accessToken":"json-token"}'), 'json-token');
});

test('builds paths with encoded query values', () => {
  assert.equal(buildPath('/api/projects/19/issues', { status: 'UNRESOLVED', q: 'a b' }), '/api/projects/19/issues?status=UNRESOLVED&q=a+b');
});

test('parses duration shortcuts', () => {
  assert.equal(parseDurationMs('30m'), 30 * 60 * 1000);
  assert.equal(parseDurationMs('2h'), 2 * 60 * 60 * 1000);
  assert.equal(parseDurationMs('1d'), 24 * 60 * 60 * 1000);
});

let server;
let baseUrl;
let lastRequest;

before(async () => {
  server = createServer((request, response) => {
    lastRequest = {
      url: request.url,
      authorization: request.headers.authorization
    };
    response.setHeader('content-type', 'application/json');
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
