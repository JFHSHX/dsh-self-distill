// 配置与状态：~/.dsh-self-distill/config.json + state.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function configDir() {
  return path.join(os.homedir(), '.dsh-self-distill');
}

export function defaultConfig() {
  return {
    outDir: 'C:\\myself',
    sessionsDir: path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'dsh-desktop', 'harness', 'sessions'),
    idleMinutes: 20,
    minIntervalMinutes: 60,
    timezoneOffsetHours: 8,
    keepSource: true,
    maxMessagePreview: 800,
    redact: {
      enabled: true,
      strict: false,
      categories: { keys: true, emails: true, phones: true, ids: true, im: true }
    }
  };
}

/** 加载配置：默认值 ← 配置文件 ← 覆盖对象 */
export function loadConfig(overrides = {}) {
  let fileCfg = {};
  const file = path.join(configDir(), 'config.json');
  try {
    if (fs.existsSync(file)) fileCfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    fileCfg = {};
  }
  const cfg = {
    ...defaultConfig(),
    ...fileCfg,
    ...overrides,
    redact: {
      ...defaultConfig().redact,
      ...(fileCfg.redact || {}),
      ...(overrides.redact || {}),
      categories: {
        ...defaultConfig().redact.categories,
        ...((fileCfg.redact || {}).categories || {}),
        ...((overrides.redact || {}).categories || {})
      }
    }
  };
  return cfg;
}

export function saveConfig(cfg) {
  fs.mkdirSync(configDir(), { recursive: true });
  const file = path.join(configDir(), 'config.json');
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  return file;
}

export function loadState() {
  const file = path.join(configDir(), 'state.json');
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* fallthrough */
  }
  return { lastRunAt: 0, maxMtime: 0, lastTrigger: null, lastError: null, lastCounts: null };
}

export function saveState(state) {
  fs.mkdirSync(configDir(), { recursive: true });
  const file = path.join(configDir(), 'state.json');
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf8');
  return file;
}
