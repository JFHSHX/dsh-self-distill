// 端到端蒸馏测试：合成会话 → runDistill → 文件生成 + 脱敏生效 + 无真实凭证残留
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { runDistill } from '../src/runner.js';

function makeSessionDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-sessions-'));
  const ws = path.join(root, '--C-demo--', 'session-11111111-2222-3333-4444-555555555555');
  fs.mkdirSync(ws, { recursive: true });
  const lines = [
    '{"type":"session","id":"session-11111111-2222-3333-4444-555555555555","cwd":"C:\\\\demo","createdAt":1789000000000}',
    '{"type":"session/title","data":{"title":"安装工具并部署"}}',
    '{"type":"user/message","time":1789000001000,"data":{"content":[{"type":"text","text":"帮我部署 key：sk-SUPERSECRETKEY12345 到 cloudflare"}]}}',
    '{"type":"user/message","time":1789000002000,"data":{"content":[{"type":"text","text":"继续"}]}}',
    '{"type":"user/message","time":1789000003000,"data":{"content":[{"type":"text","text":"继续"}]}}',
    '{"type":"user/message","time":1789000004000,"data":{"content":[{"type":"text","text":"继续"}]}}',
    '{"type":"assistant/message","data":{"message":{"content":[{"type":"text","text":"部署任务已推进到远端，请刷新页面确认部署状态，如果失败请贴最新构建日志。"}]}}}',
    '{"type":"turn/start","time":1789000005000}',
    '{"type":"turn/start","time":1789000100000}',
    '{"type":"turn/start","time":1789000200000}'
  ].join('\n');
  // 单帧 zstd（discoverSessions 找 session.jsonl.zstd）
  fs.writeFileSync(path.join(ws, 'session.jsonl.zstd'), zlib.zstdCompressSync(Buffer.from(lines, 'utf8')));
  return root;
}

test('runDistill 端到端：生成 + 脱敏 + 未完成信号', async () => {
  const sessionsDir = makeSessionDir();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-out-'));
  const summary = await runDistill({
    sessionsDir,
    outDir,
    force: true,
    redact: { enabled: true, strict: false }
  });
  assert.ok(summary.includes('蒸馏完成'), summary);

  // 文件生成
  for (const f of ['README.md', '01-个人画像.md', '02-项目档案.md', '03-活跃规律.md', '04-日程规划.md', 'source/sessions-digest.txt']) {
    assert.ok(fs.existsSync(path.join(outDir, f)), '缺少 ' + f);
  }

  // 脱敏生效：秘密不残留，占位符存在
  const profile = fs.readFileSync(path.join(outDir, 'source/sessions-digest.txt'), 'utf8');
  assert.ok(!profile.includes('sk-SUPERSECRETKEY12345'), '凭证泄漏到档案');
  assert.ok(profile.includes('<REDACTED:'), '应包含脱敏占位符');
  assert.ok(profile.includes('帮我部署'), '真实消息应保留');
  assert.ok(!profile.includes('session-11111111-2222'), 'UUID 应被部分脱敏');

  // 未完成信号：3 条继续 → 出现在 02/04
  const proj = fs.readFileSync(path.join(outDir, '02-项目档案.md'), 'utf8');
  assert.ok(proj.includes('未完成信号'), proj);
  const sched = fs.readFileSync(path.join(outDir, '04-日程规划.md'), 'utf8');
  assert.ok(sched.includes('未完成事项'), sched);

  // 幂等：无变化时跳过
  const again = await runDistill({ sessionsDir, outDir });
  assert.ok(again.includes('跳过'), again);
});

test('runDistill 冷却与 force', async () => {
  const sessionsDir = makeSessionDir();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-out2-'));
  await runDistill({ sessionsDir, outDir, force: true, minIntervalMinutes: 60 });
  // 不带 force：受冷却限制被跳过（force 是唯一旁路）
  const blocked = await runDistill({ sessionsDir, outDir, minIntervalMinutes: 60 });
  assert.ok(blocked.includes('跳过'), blocked);
  // force 跳过冷却与变更检测，强制全量运行
  const forced = await runDistill({ sessionsDir, outDir, force: true, minIntervalMinutes: 60 });
  assert.ok(forced.includes('蒸馏完成'), forced);
});
