const DEFAULT_BASE_URL = 'https://segiapi.extn.ai';

export class SegiApiError extends Error {
  constructor(message, { status, statusText, body, url } = {}) {
    super(message);
    this.name = 'SegiApiError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
    this.url = url;
  }
}

export function normalizeBaseUrl(value = DEFAULT_BASE_URL) {
  return String(value).replace(/\/+$/, '');
}

export function parseTokenValue(raw) {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('Bearer ')) return trimmed.slice('Bearer '.length).trim();

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      return extractToken(parsed);
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

export function extractToken(value) {
  if (!value) return '';
  if (typeof value === 'string') return parseTokenValue(value);

  return (
    value.accessToken ||
    value.access_token ||
    value.token ||
    value.jwt ||
    value?.tokens?.accessToken ||
    value?.tokens?.access_token ||
    value?.tokens?.token ||
    value?.tokens?.jwt ||
    value?.session?.accessToken ||
    value?.session?.access_token ||
    value?.state?.accessToken ||
    value?.state?.access_token ||
    extractTokenFromStorageState(value.storageState) ||
    ''
  );
}

export function extractTokenFromStorageState(storageState) {
  for (const origin of storageState?.origins || []) {
    for (const item of origin.localStorage || []) {
      const token = extractTokenFromStorageValue(item.value);
      if (token) return token;
    }
  }
  return '';
}

export function extractTokenFromStorageValue(value) {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('Bearer ')) return parseTokenValue(trimmed);
  if (looksLikeJwt(trimmed)) return trimmed;
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return '';

  try {
    return extractToken(JSON.parse(trimmed));
  } catch {
    return '';
  }
}

function looksLikeJwt(value) {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

export function buildCookieHeader(storageState, requestUrl = DEFAULT_BASE_URL) {
  const cookies = storageState?.cookies || storageState?.session?.cookies || storageState?.cookies;
  if (!Array.isArray(cookies) || cookies.length === 0) return '';

  const url = new URL(requestUrl);
  const nowSeconds = Math.floor(Date.now() / 1000);
  return cookies
    .filter((cookie) => cookie?.name && cookie.value !== undefined)
    .filter((cookie) => !cookie.expires || cookie.expires < 0 || cookie.expires > nowSeconds)
    .filter((cookie) => cookieMatchesHost(cookie, url.hostname))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

function cookieMatchesHost(cookie, hostname) {
  const domain = String(cookie.domain || '').replace(/^\./, '');
  if (!domain) return true;
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function buildPath(path, query = {}) {
  const url = new URL(path.startsWith('/') ? `https://placeholder${path}` : `https://placeholder/${path}`);

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  return `${url.pathname}${url.search}`;
}

export class SegiClient {
  constructor({ token, refreshToken, session, baseUrl = DEFAULT_BASE_URL, fetchImpl = globalThis.fetch, onTokens } = {}) {
    this.session = session || null;
    this.token = parseTokenValue(token || extractToken(session));
    this.refreshToken = parseTokenValue(
      refreshToken ||
        session?.refreshToken ||
        session?.refresh_token ||
        session?.tokens?.refreshToken ||
        session?.tokens?.refresh_token ||
        ''
    );
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.cookieHeader = buildCookieHeader(session?.storageState || session, this.baseUrl);
    this.fetchImpl = fetchImpl;
    this.onTokens = onTokens;

    if (typeof this.fetchImpl !== 'function') {
      throw new TypeError('A fetch implementation is required. Use Node.js 18.18 or newer.');
    }
  }

  async request(path, { query, method = 'GET', body } = {}) {
    if (!this.token && this.refreshToken) {
      await this.refresh();
    }

    if (!this.token && !this.cookieHeader) {
      throw new SegiApiError('Missing Segi session. Run `segi login`, set SEGI_TOKEN, or pass --token.');
    }

    const requestPath = buildPath(path, query);
    const url = `${this.baseUrl}${requestPath}`;
    let response = await this.fetchImpl(url, {
      method,
      headers: this.requestHeaders(body),
      body: body ? JSON.stringify(body) : undefined
    });

    if (response.status === 401 && this.refreshToken) {
      await this.refresh();
      response = await this.fetchImpl(url, {
        method,
        headers: this.requestHeaders(body),
        body: body ? JSON.stringify(body) : undefined
      });
    }

    const text = await response.text();
    const data = parseJson(text);

    if (!response.ok) {
      const message =
        (data && typeof data === 'object' && (data.message || data.error)) ||
        `${response.status} ${response.statusText}`;
      throw new SegiApiError(String(message), {
        status: response.status,
        statusText: response.statusText,
        body: data ?? text,
        url
      });
    }

    return data ?? text;
  }

  async loginWithGoogleCredential(credential) {
    const tokens = await this.publicRequest('/api/auth/google', {
      method: 'POST',
      body: { credential }
    });
    this.setTokens(tokens);
    return tokens;
  }

  async loginWithPassword(email, password) {
    const tokens = await this.publicRequest('/api/auth/login', {
      method: 'POST',
      body: { email, password }
    });
    this.setTokens(tokens);
    return tokens;
  }

  async refresh() {
    if (!this.refreshToken) {
      throw new SegiApiError('Missing Segi refresh token.');
    }

    const tokens = await this.publicRequest('/api/auth/refresh', {
      method: 'POST',
      body: { refreshToken: this.refreshToken }
    });
    this.setTokens(tokens);
    return tokens;
  }

  async publicRequest(path, { method = 'GET', body } = {}) {
    const url = `${this.baseUrl}${buildPath(path)}`;
    const response = await this.fetchImpl(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const text = await response.text();
    const data = parseJson(text);

    if (!response.ok) {
      const message =
        (data && typeof data === 'object' && (data.message || data.error)) ||
        `${response.status} ${response.statusText}`;
      throw new SegiApiError(String(message), {
        status: response.status,
        statusText: response.statusText,
        body: data ?? text,
        url
      });
    }

    return data ?? text;
  }

  setTokens(tokens) {
    this.token = parseTokenValue(tokens?.accessToken || tokens?.access_token || tokens?.token || '');
    this.refreshToken = parseTokenValue(tokens?.refreshToken || tokens?.refresh_token || this.refreshToken || '');
    this.onTokens?.({
      ...(this.session || {}),
      tokens,
      ...tokens,
      accessToken: this.token,
      refreshToken: this.refreshToken
    });
  }

  requestHeaders(body) {
    return {
      accept: 'application/json',
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      ...(this.cookieHeader ? { cookie: this.cookieHeader } : {}),
      ...(body ? { 'content-type': 'application/json' } : {})
    };
  }

  getMe() {
    return this.request('/api/me');
  }

  getProjects() {
    return this.request('/api/projects');
  }

  getProject(projectId) {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}`);
  }

  getIssues(projectId, query) {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/issues`, { query });
  }

  getIssue(projectId, issueId) {
    return this.request(
      `/api/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(issueId)}`
    );
  }

  getIssueEvents(projectId, issueId, query) {
    return this.request(
      `/api/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(issueId)}/events`,
      { query }
    );
  }

  getEvents(projectId, query) {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/events`, { query });
  }

  getEvent(projectId, eventId) {
    return this.request(
      `/api/projects/${encodeURIComponent(projectId)}/events/${encodeURIComponent(eventId)}`
    );
  }

  listRecordings(projectId, query) {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/recordings`, { query });
  }

  getRecording(projectId, recordingId) {
    return this.request(
      `/api/projects/${encodeURIComponent(projectId)}/recordings/${encodeURIComponent(recordingId)}`
    );
  }
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function listItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

export function isRecent(value, sinceMs, now = Date.now()) {
  if (!value || !sinceMs) return true;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && now - time <= sinceMs;
}

export function parseDurationMs(value) {
  if (!value) return undefined;
  const match = String(value).trim().match(/^(\d+)(m|h|d)?$/i);
  if (!match) throw new Error(`Invalid duration: ${value}`);
  const amount = Number(match[1]);
  const unit = (match[2] || 'm').toLowerCase();
  if (unit === 'm') return amount * 60 * 1000;
  if (unit === 'h') return amount * 60 * 60 * 1000;
  return amount * 24 * 60 * 60 * 1000;
}
