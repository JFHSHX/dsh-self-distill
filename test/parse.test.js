// JSONL 解析测试：真实事件 schema、注入过滤
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSessionText, isInjected } from '../src/parse.js';

const fixture = [
  '{"type":"session","id":"session-abc","cwd":"C:\\\\demo","createdAt":1789000000000,"agentPreset":"minimal-v3"}',
  '{"type":"session/title","data":{"title":"测试会话"}}',
  '{"type":"user/message","time":1789000001000,"data":{"content":[{"type":"text","text":"为我安装某个工具"}],"role":"user"}}',
  '{"type":"user/message","time":1789000002000,"data":{"content":[{"type":"text","text":"<hindsight_knowledge>tools guide</hindsight_knowledge>"}]}}',
  '{"type":"user/message","time":1789000003000,"data":{"content":[{"type":"text","text":"继续 (上一步工具「read_page」已完成, 结果: ...; 不要重复执行, 直接继续)"}]}}',
  '{"type":"user/message","time":1789000004000,"data":{"content":[{"type":"text","text":"Current runtime context. This snapshot supersedes earlier snapshots."}]}}',
  '{"type":"assistant/message","data":{"message":{"content":[{"type":"text","text":"好的，我现在开始安装这个工具并完成后续所有配置步骤。这一步会先检查下载目录中的安装包是否完整，然后按顺序解压文件、写入配置、注册环境变量，最后运行自检脚本验证安装结果，并把每个步骤的输出汇报给你。如果任何一步失败我会直接定位原因并修复，不需要你重复提供上下文。"}]}}}',
  '{"type":"turn/start","time":1789000005000}',
  '{"type":"turn/start","time":1789000006000}'
].join('\n');

test('解析真实事件 schema', () => {
  const p = parseSessionText(fixture);
  assert.equal(p.header.id, 'session-abc');
  assert.equal(p.header.cwd, 'C:\\demo');
  assert.deepEqual(p.titles, ['测试会话']);
  assert.equal(p.turnTimes.length, 2);
  assert.equal(p.assistantCount, 1);
  assert.ok(p.lastAssistant.includes('开始安装'));
});

test('注入与自动续跑被过滤，真实消息保留', () => {
  const p = parseSessionText(fixture);
  const texts = p.userMsgs.map((m) => m.text);
  assert.equal(texts.length, 1);
  assert.equal(texts[0], '为我安装某个工具');
  assert.equal(p.filteredInjections, 3);
});

test('isInjected 判定', () => {
  assert.ok(isInjected('<hindsight_knowledge_refresh> reminder'));
  assert.ok(isInjected('继续 (上一步工具「pwsh」已完成)'));
  assert.ok(isInjected('Current runtime context.'));
  assert.ok(isInjected(''));
  assert.ok(!isInjected('继续'));
  assert.ok(!isInjected('帮我规划日程'));
});

test('assistant/message 文本在 data.message.content', () => {
  const p = parseSessionText('{"type":"assistant/message","data":{"message":{"content":[{"type":"text","text":"短"}]}}}');
  assert.equal(p.assistantCount, 1);
  assert.equal(p.lastAssistant, ''); // <80 字符不作为收尾摘要
});
