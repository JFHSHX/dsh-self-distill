// 编排器：发现会话 → 解压 → 解析 → 蒸馏（含脱敏）→ 写档案 → 更新状态。
// CLI 与 DSH hooks 都通过 runDistill() 调用。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverSessions, readSessionText } from './decomp.js';
import { parseSessionText } from './parse.js';
import { generateFiles, writeFiles } from './distill.js';
import { loadConfig, loadState, saveState } from './config.js';

/**
 * 运行一次蒸馏。opts 可覆盖：outDir, sessionsDir, force, trigger, redact…
 * 返回摘要字符串（用于 CLI 输出与工具结果）。
 */
export async function runDistill(overrides = {}) {
  const cfg = loadConfig({ ...overrides, _trigger: overrides.trigger || 'manual' });
  const state = loadState();
  const started = Date.now();

  // 冷却：除 force 外，两次运行至少间隔 minIntervalMinutes
  if (!overrides.force && state.lastRunAt) {
    const elapsedMin = (started - state.lastRunAt) / 60000;
    if (elapsedMin < (cfg.minIntervalMinutes ?? 60)) {
      return `跳过：距上次运行仅 ${elapsedMin.toFixed(1)} 分钟（冷却 ${cfg.minIntervalMinutes} 分钟）。用 force=true 可强制运行。`;
    }
  }

  // 发现会话存档
  const sources = discoverSessions(cfg.sessionsDir);
  if (!sources.length) {
    return `未发现会话存档：${cfg.sessionsDir}`;
  }

  // 变更检测：文件 mtime 都没变则跳过（force 除外）
  let maxMtime = 0;
  for (const s of sources) {
    try {
      maxMtime = Math.max(maxMtime, fs.statSync(s).mtimeMs);
    } catch {
      /* ignore */
    }
  }
  const unchanged = state.maxMtime && maxMtime <= state.maxMtime;
  if (unchanged && !overrides.force) {
    return `跳过：会话记录自上次运行（${new Date(state.lastRunAt).toISOString()}）无变化。用 force=true 可强制运行。`;
  }

  // 解压 + 解析（临时目录，避免污染会话区）
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-self-distill-'));
  try {
    const parsed = [];
    let decompressFails = 0;
    for (const src of sources) {
      try {
        parsed.push(parseSessionText(readSessionText(src)));
      } catch {
        decompressFails++;
      }
    }
    if (!parsed.length) {
      return '所有会话存档解压失败（Node >= 22.15 需要 zlib.zstdDecompressSync）。';
    }

    // 蒸馏 + 写入（内部已脱敏）
    const { files, counts } = generateFiles(parsed, cfg);
    const written = writeFiles(files, cfg.outDir);

    // 更新状态
    saveState({
      lastRunAt: started,
      maxMtime,
      lastTrigger: cfg._trigger,
      lastError: null,
      lastCounts: {
        sessions: parsed.length,
        decompressFails,
        turns: parsed.reduce((a, s) => a + s.turnTimes.length, 0),
        userMsgs: parsed.reduce((a, s) => a + s.userMsgs.length, 0),
        filteredInjections: parsed.reduce((a, s) => a + s.filteredInjections, 0),
        written,
        redaction: counts.redaction
      }
    });

    const r = counts.redaction;
    const redStr = Object.entries(r).map(([k, v]) => `${k}:${v}`).join(', ') || '0';
    return [
      `蒸馏完成（触发：${cfg._trigger}）：`,
      `  会话 ${parsed.length} 个（解压失败 ${decompressFails}），活跃回合 ${parsed.reduce((a, s) => a + s.turnTimes.length, 0)}，真实用户消息 ${parsed.reduce((a, s) => a + s.userMsgs.length, 0)}（过滤注入 ${parsed.reduce((a, s) => a + s.filteredInjections, 0)} 条）`,
      `  脱敏替换：${redStr}`,
      `  已写入 ${written.length} 个文件到 ${cfg.outDir}`,
      `  耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`
    ].join('\n');
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/** 供 hooks 调用的安全封装：绝不抛出，错误记入状态。 */
export async function runDistillSafe(trigger, overrides = {}) {
  try {
    const summary = await runDistill({ trigger, ...overrides });
    return summary;
  } catch (err) {
    try {
      const state = loadState();
      state.lastError = String(err && err.message ? err.message : err);
      saveState(state);
    } catch {
      /* ignore */
    }
    return `蒸馏失败：${err && err.message ? err.message : err}`;
  }
}
