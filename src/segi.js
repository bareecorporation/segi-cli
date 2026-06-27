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
    value?.state?.accessToken ||
    value?.state?.access_token ||
    ''
  );
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
  constructor({ token, baseUrl = DEFAULT_BASE_URL, fetchImpl = globalThis.fetch } = {}) {
    this.token = parseTokenValue(token);
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetchImpl = fetchImpl;

    if (typeof this.fetchImpl !== 'function') {
      throw new TypeError('A fetch implementation is required. Use Node.js 18.18 or newer.');
    }
  }

  async request(path, { query, method = 'GET', body } = {}) {
    if (!this.token) {
      throw new SegiApiError('Missing Segi access token. Set SEGI_TOKEN or pass --token.');
    }

    const requestPath = buildPath(path, query);
    const url = `${this.baseUrl}${requestPath}`;
    const response = await this.fetchImpl(url, {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${this.token}`,
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
