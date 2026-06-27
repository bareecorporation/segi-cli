import os from 'node:os';
import path from 'node:path';
import { buildCookieHeader, extractToken, extractTokenFromStorageValue } from './segi.js';

const DEFAULT_APP_URL = 'https://segi.extn.ai/projects';
const DEFAULT_LOGIN_TIMEOUT_MS = 30 * 60 * 1000;

export async function loginWithBrowser({
  appUrl = DEFAULT_APP_URL,
  headless = false,
  timeoutMs = DEFAULT_LOGIN_TIMEOUT_MS,
  pollMs = 1000,
  browserName = 'chromium',
  browserDataDir = defaultBrowserDataDir(),
  stderr = process.stderr
} = {}) {
  const playwright = await importPlaywright();
  const browserType = playwright[browserName];
  if (!browserType) throw new Error(`Unsupported browser: ${browserName}`);

  let context;
  try {
    context = await browserType.launchPersistentContext(browserDataDir, { headless });
  } catch (error) {
    if (String(error.message || error).includes('Executable')) {
      throw new Error(
        'Playwright browser is not installed. Run `npx playwright install chromium` and retry `segi login`.'
      );
    }
    throw error;
  }

  const page = context.pages()[0] || (await context.newPage());

  try {
    stderr.write(`Opening ${appUrl}\n`);
    stderr.write(`Using browser profile ${browserDataDir}\n`);
    stderr.write('Complete Segi SSO in the browser window. This CLI will continue after it detects a session.\n');
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });

    const deadline = Date.now() + timeoutMs;
    let captured = null;

    while (Date.now() < deadline) {
      captured = await captureSession(context, page, appUrl);
      if (isAuthenticatedSession(captured)) break;
      await page.waitForTimeout(pollMs);
    }

    if (!isAuthenticatedSession(captured)) {
      throw new Error(`Timed out waiting for Segi login after ${Math.round(timeoutMs / 1000)}s.`);
    }

    return captured;
  } finally {
    await context.close();
  }
}

export function defaultBrowserDataDir() {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configHome, 'segi-cli', 'browser-profile');
}

async function importPlaywright() {
  try {
    return await import('playwright');
  } catch (error) {
    throw new Error(`Missing dependency: playwright. Install package dependencies and retry. ${error.message}`);
  }
}

async function captureSession(context, page, appUrl) {
  const storageState = await context.storageState();
  const pageStorage = await readPageStorage(page);
  const tokens = extractTokens(storageState, pageStorage);
  const appOrigin = new URL(appUrl).origin;

  return {
    capturedAt: new Date().toISOString(),
    appUrl,
    appOrigin,
    storageState,
    pageStorage,
    tokens,
    accessToken: extractToken(tokens) || extractToken(storageState),
    refreshToken: tokens.refreshToken || tokens.refresh_token || '',
    cookieCount: storageState.cookies?.length || 0,
    apiCookieCount: countCookieHeader(buildCookieHeader(storageState, 'https://segiapi.extn.ai'))
  };
}

function isAuthenticatedSession(session) {
  if (!session) return false;
  if (session.accessToken || session.refreshToken) return true;
  if (!session.apiCookieCount) return false;

  try {
    const url = new URL(session.pageStorage?.url || session.appUrl);
    return !url.pathname.startsWith('/login');
  } catch {
    return false;
  }
}

function countCookieHeader(cookieHeader) {
  if (!cookieHeader) return 0;
  return cookieHeader.split(';').filter((item) => item.trim()).length;
}

async function readPageStorage(page) {
  return page.evaluate(() => {
    const readStorage = (storage) =>
      Object.fromEntries(Array.from({ length: storage.length }, (_, index) => {
        const key = storage.key(index);
        return [key, storage.getItem(key)];
      }));

    return {
      url: window.location.href,
      origin: window.location.origin,
      localStorage: readStorage(window.localStorage),
      sessionStorage: readStorage(window.sessionStorage)
    };
  });
}

function extractTokens(storageState, pageStorage) {
  const values = [];

  for (const origin of storageState.origins || []) {
    for (const item of origin.localStorage || []) values.push(item.value);
  }

  for (const storage of [pageStorage?.localStorage, pageStorage?.sessionStorage]) {
    for (const value of Object.values(storage || {})) values.push(value);
  }

  for (const value of values) {
    const accessToken = extractTokenFromStorageValue(value);
    if (!accessToken) continue;

    const parsed = parseJson(value);
    return {
      ...(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}),
      accessToken
    };
  }

  return {};
}

function parseJson(value) {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
