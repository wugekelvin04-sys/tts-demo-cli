'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SERVICE = 'tts-demo-cli';
const FALLBACK_DIR = path.join(os.homedir(), '.tts-demo');
const FALLBACK_FILE = path.join(FALLBACK_DIR, 'credentials.json');

let keytar;
try { keytar = require('keytar'); } catch {}

function readFallback() {
  try { return JSON.parse(fs.readFileSync(FALLBACK_FILE, 'utf8')); } catch { return {}; }
}

function writeFallback(data) {
  fs.mkdirSync(FALLBACK_DIR, { recursive: true });
  fs.writeFileSync(FALLBACK_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

async function set(key, value) {
  if (keytar) {
    try {
      await keytar.setPassword(SERVICE, key, value);
      return;
    } catch (e) {
      // Keytar failed, fall through to file-based storage
    }
  }
  const data = readFallback();
  data[key] = value;
  writeFallback(data);
}

async function get(key) {
  if (keytar) {
    try {
      const result = await keytar.getPassword(SERVICE, key);
      if (result !== null) {
        return result;
      }
      // Keytar returned null, fall through to check fallback
    } catch (e) {
      // Keytar failed, fall through to file-based storage
    }
  }
  return readFallback()[key] || null;
}

module.exports = { set, get };
