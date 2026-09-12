// 会话 JSONL 解析：提取会话头、标题、真实用户消息、助手收尾、活跃回合。
// 已知注入/噪声会在提取阶段过滤：
//  - <hindsight_knowledge> / <hindsight_knowledge_refresh> 工具指南注入
//  - "Current runtime context..." 运行时快照注入
//  - "The approval policy changed..." 策略变更注入
//  - "继续 (上一步工具...)" 自动续跑消息

export function parseSessionText(text) {
  const header = { id: null, cwd: null, createdAt: null, agentPreset: null };
  const titles = [];
  const userMsgs = [];
  const turnTimes = [];
  let lastAssistant = '';
  let assistantCount = 0;
  let filteredInjections = 0;

  const lines = text.split('\n');
  for (const line of lines) {
    if (!line) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    const type = j.type;
    if (type === 'session') {
      header.id = j.id ?? header.id;
      header.cwd = j.cwd ?? header.cwd;
      header.createdAt = j.createdAt ?? header.createdAt;
      header.agentPreset = j.agentPreset ?? header.agentPreset;
    } else if (type === 'session/title') {
      const t = j.title || (j.data && j.data.title) || null;
      if (t) titles.push(t);
    } else if (type === 'user/message') {
      const raw = textOf(j.data).replace(/\s+/g, ' ').trim();
      if (!raw) continue;
      if (isInjected(raw)) {
        filteredInjections++;
        continue;
      }
      userMsgs.push({ t: j.time ?? null, text: raw });
    } else if (type === 'assistant/message') {
      const raw = textOf(j.data).trim();
      assistantCount++;
      if (raw.length > 80) lastAssistant = raw;
    } else if (type === 'turn/start') {
      const t = j.time ?? j.createdAt ?? null;
      if (t) turnTimes.push(t);
    }
  }
  return { header, titles, userMsgs, lastAssistant, turnTimes, assistantCount, filteredInjections };
}

function textOf(data) {
  const m = data && (data.message ?? data);
  const c = m && m.content;
  if (!c) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map((p) => (p && p.type === 'text' && p.text) ? p.text : '').join(' ');
  }
  if (c && typeof c === 'object') return c.text || '';
  return '';
}

export function isInjected(t) {
  if (!t) return true;
  const s = t.trim();
  if (s.startsWith('<hindsight_knowledge')) return true;
  if (s.startsWith('<system')) return true;
  if (s.startsWith('This repository has a Hindsight')) return true;
  if (s.startsWith('Current runtime context')) return true;
  if (s.startsWith('The approval policy changed')) return true;
  if (s.startsWith('继续 (上一步工具')) return true;
  if (s.startsWith('AgentTeams state policy')) return true;
  if (s.startsWith('AgentTeams automatic task assignment')) return true;
  if (s.startsWith('You have joined the team')) return true;
  if (s.startsWith('Background subagent')) return true;
  if (s.startsWith('AgentTeams message from member')) return true;
  return false;
}
