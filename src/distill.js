// 蒸馏与生成：把解析出的会话数据聚合成统计，并生成 5 份 Markdown 档案。
// 所有文本在写入前必须经过 redact（脱敏）。

import fs from 'node:fs';
import path from 'node:path';
import { redactText, mergeCounts } from './redact.js';

// ---------- 统计聚合 ----------

/** 按小时的活跃直方图与逐日明细（turn/start 时间，按配置时区偏移换算）。 */
export function activityStats(sessions, tzOffsetHours = 8) {
  const byHour = new Array(24).fill(0);
  const byDate = {};
  let total = 0;
  for (const s of sessions) {
    for (const t of s.turnTimes) {
      const d = new Date(t + tzOffsetHours * 3600 * 1000);
      const iso = d.toISOString();
      const hour = parseInt(iso.slice(11, 13), 10);
      const date = iso.slice(0, 10);
      byHour[hour]++;
      total++;
      byDate[date] = byDate[date] || new Array(24).fill(0);
      byDate[date][hour]++;
    }
  }
  return { byHour, byDate, total };
}

/** 交互总量与沟通风格统计。 */
export function styleStats(sessions) {
  let msgs = 0;
  let chars = 0;
  let continues = 0;
  const kw = {};
  const KWS = [
    'cloudflare', 'github', 'mcp', 'dsh', 'deepseek', 'clankermux', '部署', '插件',
    '安装', '报错', '日志', '仓库', '前端', 'qq', 'b站', 'bilibili', '模型', 'api'
  ];
  for (const s of sessions) {
    for (const m of s.userMsgs) {
      msgs++;
      chars += m.text.length;
      if (/^(继续|继续，|继续!|继续\.|go on|continue)$/i.test(m.text.trim())) continues++;
      const lower = m.text.toLowerCase();
      for (const k of KWS) {
        if (lower.includes(k)) kw[k] = (kw[k] || 0) + 1;
      }
    }
  }
  const topKw = Object.entries(kw).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return { msgs, chars, continues, topKw, avgLen: msgs ? Math.round(chars / msgs) : 0 };
}

/** 按工作区聚合项目痕迹。 */
export function projectStats(sessions) {
  const byWs = {};
  for (const s of sessions) {
    const ws = s.header.cwd || '(unknown)';
    byWs[ws] = byWs[ws] || { cwd: ws, count: 0, titles: [], first: Infinity, last: 0, msgs: 0, continues: 0, lastAssistant: '' };
    const g = byWs[ws];
    g.count++;
    g.msgs += s.userMsgs.length;
    for (const m of s.userMsgs) if (/^继续/i.test(m.text.trim())) g.continues++;
    for (const t of s.titles) if (t && !g.titles.includes(t)) g.titles.push(t);
    if (s.header.createdAt) {
      g.first = Math.min(g.first, s.header.createdAt);
      g.last = Math.max(g.last, s.header.createdAt);
    }
    if (s.lastAssistant) g.lastAssistant = s.lastAssistant;
  }
  const fmt = (t) => (t && t !== Infinity ? new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10) : '?');
  return Object.values(byWs)
    .map((g) => ({ ...g, first: fmt(g.first), last: fmt(g.last), firstRaw: g.first }))
    .sort((a, b) => (b.firstRaw === Infinity ? -1 : b.firstRaw) - (a.firstRaw === Infinity ? -1 : a.firstRaw));
}

/** 未完成信号：续跑占比高的会话视为长任务未收束。 */
export function pendingSignals(sessions) {
  const out = [];
  for (const s of sessions) {
    const cont = s.userMsgs.filter((m) => /^继续/i.test(m.text.trim())).length;
    if (cont >= 3 && s.userMsgs.length >= 3) {
      out.push({
        id: (s.header.id || '').slice(0, 13),
        cwd: s.header.cwd,
        title: s.titles[0] || s.userMsgs[0]?.text?.slice(0, 60) || '(无标题)',
        continues: cont,
        total: s.userMsgs.length
      });
    }
  }
  return out.sort((a, b) => b.continues - a.continues).slice(0, 8);
}

/** 从消息中提取 github 仓库痕迹。 */
export function repoSignals(sessions) {
  const repos = {};
  const re = /https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g;
  for (const s of sessions) {
    for (const m of s.userMsgs) {
      let match;
      while ((match = re.exec(m.text))) {
        const repo = match[1].replace(/[).,，。；]+$/, '');
        repos[repo] = repos[repo] || { repo, mentions: 0 };
        repos[repo].mentions++;
      }
    }
  }
  return Object.values(repos).sort((a, b) => b.mentions - a.mentions).slice(0, 10);
}

// ---------- 峰谷分析（用于日程） ----------

export function peakWindows(byHour) {
  const windows = [];
  for (let h = 0; h < 24; h++) {
    if (byHour[h] > 0) {
      const last = windows[windows.length - 1];
      if (last && last.end === h - 1) {
        last.end = h;
        last.total += byHour[h];
      } else {
        windows.push({ start: h, end: h, total: byHour[h] });
      }
    }
  }
  const dead = [];
  for (let h = 0; h < 24; h++) {
    const last = dead[dead.length - 1];
    if (byHour[h] === 0) {
      if (last && last.end === h - 1) last.end = h;
      else dead.push({ start: h, end: h });
    }
  }
  return { windows: windows.sort((a, b) => b.total - a.total), dead };
}

function hh(h) {
  return String(h).padStart(2, '0') + ':00';
}

// ---------- Markdown 生成 ----------

const H = (s) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '<', '>': '>', '&': '&' }[c]));

export function generateFiles(parsed, cfg) {
  const tz = cfg.timezoneOffsetHours ?? 8;
  const act = activityStats(parsed, tz);
  const style = styleStats(parsed);
  const projects = projectStats(parsed);
  const pending = pendingSignals(parsed);
  const repos = repoSignals(parsed);
  const peaks = peakWindows(act.byHour);
  const counts = { redaction: {} };

  const R = (text) => {
    if (!cfg.redact?.enabled) return { text: String(text ?? ''), counts: {} };
    return redactText(text, cfg.redact);
  };
  const RW = (text) => {
    const r = R(text);
    mergeCounts(counts.redaction, r.counts);
    return r.text;
  };

  const now = new Date(Date.now() + tz * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
  const files = {};

  // README 索引
  files['README.md'] = RW(
    [
      '# 个人信息蒸馏档案',
      '',
      `> 由 dsh-self-distill 插件自动生成于 ${now}（触发方式：${H(cfg._trigger || 'manual')}）。`,
      '> 数据来源：本机全部 DSH 会话记录（' + parsed.length + ' 个会话，' + act.total + ' 个活跃回合），',
      '> 经多帧 zstd 解压 → JSONL 解析 → **脱敏** → 蒸馏而成。敏感凭证一律替换为 <REDACTED:*> 占位符。',
      '',
      '| 文件 | 内容 |',
      '|---|---|',
      '| `01-个人画像.md` | 环境、偏好、沟通风格统计 |',
      '| `02-项目档案.md` | 工作区/仓库清单与未完成信号 |',
      '| `03-活跃规律.md` | 交互时段数据与作息分析 |',
      '| `04-日程规划.md` | 基于活跃数据的定制日程 |',
      '| `source/` | 脱敏后的蒸馏底稿（可追溯） |',
      ''
    ].join('\n')
  );

  // 01 个人画像
  const osName = process.platform === 'win32' ? 'Windows' : process.platform;
  const kwLine = style.topKw.map(([k, v]) => `${k}(${v})`).join('、') || '（无显著关键词）';
  files['01-个人画像.md'] = RW(
    [
      '# 01 · 个人画像',
      '',
      `> 蒸馏自 ${style.msgs} 条真实用户消息（注入噪声已过滤 ${parsed.reduce((a, s) => a + s.filteredInjections, 0)} 条）。`,
      '',
      '## 环境',
      '',
      `- 操作系统：${osName}（DSH 桌面版）`,
      `- 会话时区偏移：UTC+${tz}`,
      `- 工作区数：${projects.length}`,
      `- 活跃回合：${act.total}`,
      '',
      '## 沟通风格',
      '',
      `- 平均消息长度：${style.avgLen} 字符`,
      `- “继续”类续跑指令：${style.continues} 次（任务式、长任务推进型使用习惯）`,
      `- 高频关键词：${kwLine}`,
      '',
      '## 给 AI 的使用说明',
      '',
      '1. 任务式输入 + “继续”推进长任务——上下文要自己接住，不要反问已给过的信息。',
      '2. 报错直接甩日志——期待定位修复而不是复述问题。',
      '3. 长任务过夜前让 AI 写下《下一步》，下次会话先读档案再继续。',
      ''
    ].join('\n')
  );

  // 02 项目档案
  const projLines = projects.map((g) => {
    const t = g.titles.slice(0, 4).map(H).join(' | ') || '(无标题)';
    return `- \`${H(g.cwd)}\` — ${g.count} 会话（${g.first} → ${g.last}，${g.msgs} 条消息，续跑 ${g.continues}）标题：${t}`;
  });
  const repoLines = repos.map((r) => `- ${H(r.repo)}（提及 ${r.mentions} 次）`);
  const pendLines = pending.map((p) => `- \`${H(p.cwd)}\`《${H(p.title)}》— 续跑 ${p.continues}/${p.total}，疑似未收束`);
  files['02-项目档案.md'] = RW(
    [
      '# 02 · 项目档案',
      '',
      '## 工作区痕迹',
      '',
      ...(projLines.length ? projLines : ['（无）']),
      '',
      '## GitHub 仓库痕迹',
      '',
      ...(repoLines.length ? repoLines : ['（无）']),
      '',
      '## 未完成信号（续跑密集 = 长任务未收尾）',
      '',
      ...(pendLines.length ? pendLines : ['（无显著未完成信号）']),
      ''
    ].join('\n')
  );

  // 03 活跃规律
  const histLines = act.byHour
    .map((v, h) => `${hh(h)}  ${'#'.repeat(Math.min(v, 60))} ${v}`)
    .join('\n');
  const dayLines = Object.keys(act.byDate)
    .sort()
    .map((d) => {
      const hrs = act.byDate[d].map((v, h) => (v ? `${h}时:${v}` : null)).filter(Boolean);
      return `- ${d}  ${hrs.join(', ')}`;
    })
    .join('\n');
  const winLines = peaks.windows
    .slice(0, 6)
    .map((w) => `- ${hh(w.start)}–${hh(w.end + 1)}：${w.total} 回合${w.total === Math.max(...peaks.windows.map((x) => x.total)) ? '（最高峰）' : ''}`);
  const deadLines = peaks.dead.map((w) => `${hh(w.start)}–${hh(w.end + 1)}`).join('、');
  files['03-活跃规律.md'] = RW(
    [
      '# 03 · 活跃规律',
      '',
      `> 数据：${act.total} 个活跃回合。按时区 UTC+${tz} 统计。`,
      '',
      '## 一天中的交互分布',
      '',
      '```',
      histLines,
      '```',
      '',
      '## 连续活跃窗口（按总量排序）',
      '',
      ...(winLines.length ? winLines : ['（无）']),
      '',
      `## 空档（零交互时段）`,
      '',
      deadLines || '（无）',
      '',
      '## 逐日明细',
      '',
      ...(dayLines ? [dayLines] : ['（无）']),
      ''
    ].join('\n')
  );

  // 04 日程规划
  const topWin = peaks.windows[0];
  const eveningWin =
    peaks.windows
      .filter((w) => w.end >= 17 && w.end <= 22)
      .sort((a, b) => b.total - a.total)[0] || topWin;
  const morningWin =
    peaks.windows
      .filter((w) => w.end >= 6 && w.end <= 12)
      .sort((a, b) => b.total - a.total)[0] || null;
  const g = (w) => (w ? `${hh(w.start)}–${hh(Math.min(w.end + 1, 24))}` : '（无数据）');
  files['04-日程规划.md'] = RW(
    [
      '# 04 · 日程规划（自动生成）',
      '',
      `> 基于真实活跃数据定制。黄金窗 = 你历史上最稳定的深度工作时段。`,
      '',
      '## 核心结论',
      '',
      `- 最高峰：${g(topWin)}（${topWin ? topWin.total : 0} 回合）`,
      `- 晚间黄金窗：${g(eveningWin)}——保住它，深度工作放这里`,
      morningWin ? `- 上午次高峰：${g(morningWin)}——适合验收与轻量段` : '- 上午无显著高峰',
      `- 空档：${deadLines}——不要把工作排进空档前的深夜`,
      '',
      '## 每日模板',
      '',
      '| 时间 | 安排 |',
      '|---|---|',
      `| ${g(eveningWin).split('–')[0]}–结束 | 深度工作（黄金窗）：代码、构建修复、架构决策 |`,
      `| ${eveningWin ? hh(Math.min(eveningWin.end + 1, 24)) : '21:00'} | 硬停止线：提交推送、写《下一步》、离线 |`,
      morningWin
        ? `| ${g(morningWin).split('–')[0]}–结束 | 轻量段：验收夜间结果、读信息，不开新工程 |`
        : '| 上午 | 轻量段：验收与杂项 |',
      '| 深夜空档 | 休息——历史上你在此零交互，别破坏 |',
      '',
      '## 未完成事项（来自会话信号）',
      '',
      ...(pendLines.length ? pendLines : ['（无待收束任务）']),
      '',
      '## 作息红线',
      '',
      '1. 黄金窗优先：把最高产的时段留给最难的工作。',
      '2. 空档保护：深夜空档是天然休息区，通宵仅限救火。',
      '3. “继续”不跨夜：长任务过夜前先写《下一步》。',
      ''
    ].join('\n')
  );

  // source/ 脱敏底稿
  const src = [];
  for (const s of parsed) {
    const lines = ['='.repeat(70), `SESSION ${H(s.header.id || '?')}  cwd: ${H(s.header.cwd)}  started: ${s.header.createdAt ? new Date(s.header.createdAt).toISOString().slice(0, 16) : '?'}`];
    if (s.titles.length) lines.push(`TITLES: ${s.titles.map(H).join(' | ')}`);
    for (const m of s.userMsgs) {
      const t = m.t ? new Date(m.t).toISOString().slice(5, 16).replace('T', ' ') : '??';
      lines.push(`[${t}] USER: ${m.text.slice(0, cfg.maxMessagePreview ?? 800)}`);
    }
    if (s.lastAssistant) lines.push(`LAST ASSISTANT: ${s.lastAssistant.slice(0, 500)}`);
    src.push(lines.join('\n'));
  }
  files['source/sessions-digest.txt'] = RW(src.join('\n\n'));

  return { files, counts };
}

/** 把生成的文件写入输出目录（全部内容已脱敏）。 */
export function writeFiles(files, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(outDir, 'source'), { recursive: true });
  const written = [];
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf8');
    written.push(rel);
  }
  return written;
}
