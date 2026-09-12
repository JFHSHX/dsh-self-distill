// 脱敏模块测试：各类凭证、邮箱、手机号、GUID、IM 来源包装
import test from 'node:test';
import assert from 'node:assert/strict';
import { redactText, CATEGORIES } from '../src/redact.js';

test('keys: api key / token 键值对被替换', () => {
  const r = redactText('clankermux端口 key：btr-mfTCZuzKeZmgAGzNBGq636AD4KF8u5Ag 帮我添加');
  assert.ok(!r.text.includes('btr-mfTCZuzKe'), '原文凭证不应残留: ' + r.text);
  assert.ok(r.text.includes('<REDACTED:'), r.text);
  assert.ok(r.counts.keys >= 1);
});

test('keys: sk- 前缀密钥被整体替换', () => {
  const r = redactText('my key is sk-abc123DEFghijklmnopQRstu');
  assert.ok(!r.text.includes('sk-abc123DEF'), r.text);
  assert.ok(r.counts.keys >= 1);
});

test('keys: Authorization Bearer 被替换', () => {
  const r = redactText('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  assert.ok(!r.text.includes('eyJhbGci'), r.text);
});

test('emails 被部分保留并替换', () => {
  const r = redactText('联系 me.demo+tag@example.com 谢谢');
  assert.ok(!r.text.includes('@example.com'), r.text);
  assert.ok(r.counts.emails >= 1);
});

test('中国手机号被整体替换', () => {
  const r = redactText('电话 13812345678 找我');
  assert.ok(!r.text.includes('13812345678'), r.text);
  assert.ok(r.counts.phones >= 1);
});

test('GUID 部分保留（前4位）', () => {
  const r = redactText('id: 9f4de604-f468-48b2-8160-33825f0f6d7f');
  assert.ok(!r.text.includes('9f4de604-f468'), r.text);
  assert.ok(r.text.startsWith('id: 9f4d'), r.text);
  assert.ok(r.counts.ids >= 1);
});

test('dsh_im_source 包装被整体替换', () => {
  const r = redactText('<dsh_im_source>{"senderId":"539C2320687AE348079E0E3A9F75F1F4","senderName":"某昵称"}</dsh_im_source> 你好');
  assert.ok(!r.text.includes('539C2320'), r.text);
  assert.ok(!r.text.includes('某昵称'), r.text);
  assert.ok(r.counts.im >= 1);
});

test('正常文本不受影响', () => {
  const r = redactText('斐波那契数列前 10 项：1, 1, 2, 3, 5, 8, 13, 21, 34, 55');
  assert.equal(r.text, '斐波那契数列前 10 项：1, 1, 2, 3, 5, 8, 13, 21, 34, 55');
  assert.deepEqual(r.counts, {});
});

test('no-redact 时原文返回', () => {
  const r = redactText('key: sk-abcdefghijklmnop', { categories: { keys: false } });
  assert.ok(r.text.includes('sk-abcdefghijklmnop'));
});

test('类别常量完整', () => {
  assert.deepEqual(CATEGORIES, ['keys', 'emails', 'phones', 'ids', 'im']);
});
