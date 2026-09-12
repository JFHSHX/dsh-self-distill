// DSH 插件入口（挂载到宿主平面）。
// 协议：导出 { name, inject, apply }；
//  - apply(ctx) 注册 agent/session-start、agent/turn-stopping、agent/disposed 事件
//  - ctx.inject(['tools'], …) 注册分层工具（dsh 投影仅支持字符串参数）

import { runDistillSafe, runDistill } from './runner.js';
import { loadConfig, loadState } from './config.js';

export const name = 'self-distill';
export const inject = ['tools'];

export function apply(ctx) {
  const cfg = loadConfig();
  const timers = new Map(); // sessionId -> idle timeout

  const idleMs = () => Math.max(1, cfg.idleMinutes ?? 20) * 60 * 1000;

  // 会话开始：取消该会话遗留的空闲定时器
  ctx.on('agent/session-start', ({ agent }) => {
    const id = agent?.session?.header?.id;
    if (!id) return;
    const t = timers.get(id);
    if (t) {
      clearTimeout(t);
      timers.delete(id);
    }
  });

  // 回合停止（空闲时机）：安排空闲定时器；期间若再次开始回合，session-start 会取消它。
  // 定时器触发 = 会话空闲满 idleMinutes → 自动整理。
  ctx.on('agent/turn-stopping', ({ agent }) => {
    const id = agent?.session?.header?.id;
    if (!id) return;
    const prev = timers.get(id);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      timers.delete(id);
      runDistillSafe('idle').catch(() => {});
    }, idleMs());
    if (typeof t.unref === 'function') t.unref();
    timers.set(id, t);
  });

  // 会话销毁：取消定时器并立即整理一次（会话结束 = 收档时机）
  ctx.on('agent/disposed', ({ agent }) => {
    const id = agent?.session?.header?.id;
    if (id) {
      const t = timers.get(id);
      if (t) {
        clearTimeout(t);
        timers.delete(id);
      }
    }
    runDistillSafe('session-end').catch(() => {});
  });

  // 分层工具注册（字符串参数）
  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.tools.register({
      name: 'self_distill_run',
      description:
        '把本机全部 DSH 会话记录解压、蒸馏、脱敏为个人档案与日程（默认输出 C:\\myself，含 01-个人画像/02-项目档案/03-活跃规律/04-日程规划）。mode=force 跳过冷却与变更检测。',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            description: '"now"（默认，受冷却与变更检测限制）或 "force"（强制全量运行）'
          },
          out: { type: 'string', description: '可选输出目录，默认读取插件配置' }
        },
        required: []
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }]
      },
      async execute(args) {
        const force = String(args?.mode || '').toLowerCase() === 'force';
        const overrides = {};
        if (force) overrides.force = true;
        if (args?.out) overrides.outDir = String(args.out);
        return runDistillSafe(force ? 'tool-force' : 'tool', overrides);
      }
    });

    toolCtx.tools.register({
      name: 'self_distill_status',
      description: '查看 dsh-self-distill 插件的配置与上次运行状态（触发方式、文件数、脱敏计数、错误）。',
      parameters: { type: 'object', properties: {}, required: [] },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }]
      },
      async execute() {
        const c = loadConfig();
        const s = loadState();
        return [
          `dsh-self-distill 状态`,
          `  输出目录：${c.outDir}`,
          `  会话来源：${c.sessionsDir}`,
          `  空闲触发：${c.idleMinutes} 分钟`,
          `  冷却：${c.minIntervalMinutes} 分钟`,
          `  脱敏：${c.redact?.enabled ? '开启' : '关闭'}${c.redact?.strict ? '（strict）' : ''}`,
          s.lastRunAt
            ? [
                `  上次运行：${new Date(s.lastRunAt).toISOString()}（触发：${s.lastTrigger}）`,
                s.lastCounts
                  ? `  上次结果：${s.lastCounts.sessions} 会话 / ${s.lastCounts.userMsgs} 消息 / 写入 ${(s.lastCounts.written || []).length} 文件 / 脱敏 ${Object.entries(s.lastCounts.redaction || {}).map(([k, v]) => `${k}:${v}`).join(', ') || '0'}`
                  : ''
              ].filter(Boolean).join('\n')
            : '  尚未运行过',
          s.lastError ? `  上次错误：${s.lastError}` : ''
        ].filter(Boolean).join('\n');
      }
    });
  });
}

// 供测试与程序化调用的直接入口
export { runDistill, runDistillSafe, loadConfig };
