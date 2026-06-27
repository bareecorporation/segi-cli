import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function defaultAuthPath() {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configHome, 'segi-cli', 'session.json');
}

export function readSession(filePath = defaultAuthPath()) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function writeSession(session, filePath = defaultAuthPath()) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best effort on filesystems that do not support chmod.
  }
}

export function removeSession(filePath = defaultAuthPath()) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export const readTokens = readSession;
export const writeTokens = writeSession;
export const removeTokens = removeSession;
