#!/usr/bin/env node
// dsh-self-distill CLI：手动运行蒸馏 / 查看状态。
// 用法：
//   dsh-self-distill [distill] [--out <dir>] [--source <dir>] [--no-redact] [--strict] [--force]
//   dsh-self-distill status

import { runDistill, runDistillSafe } from '../src/runner.js';
import { loadConfig, loadState } from '../src/config.js';

const args = process.argv.slice(2);
// 只有显式的 distill/run/status 才算命令；其余非 dash 参数是值（如 --out 的目录）
const first = args.find((a) => !a.startsWith('-'));
const cmd = ['distill', 'run', 'status'].includes(first) ? first : 'distill';

function flag(name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const v = args[i + 1];
  return v && !v.startsWith('-') ? v : true;
}

const overrides = {};
if (flag('--out')) overrides.outDir = flag('--out');
if (flag('--source')) overrides.sessionsDir = flag('--source');
if (args.includes('--no-redact')) overrides.redact = { enabled: false };
if (args.includes('--strict')) overrides.redact = { enabled: true, strict: true };
if (args.includes('--force')) overrides.force = true;

if (cmd === 'status') {
  const c = loadConfig();
  const s = loadState();
  console.log('配置:', JSON.stringify(c, null, 2));
  console.log('状态:', JSON.stringify(s, null, 2));
} else if (cmd === 'distill' || cmd === 'run') {
  const summary = await runDistillSafe('cli', overrides);
  console.log(summary);
} else {
  console.error('未知命令:', cmd, '（可用：distill | status）');
  process.exit(1);
}
