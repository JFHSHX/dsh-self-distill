// 多帧 zstd 解压测试：合成多帧存档 → 解压 → 内容拼接正确
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { decompressMultiFrame, discoverSessions, ZSTD_MAGIC } from '../src/decomp.js';

test('单帧解压', () => {
  const payload = Buffer.from('{"type":"session","id":"session-test"}\n', 'utf8');
  const frame = zlib.zstdCompressSync(payload);
  const out = decompressMultiFrame(frame);
  assert.equal(out.toString('utf8'), payload.toString('utf8'));
});

test('多帧拼接解压（DSH 会话存档格式）', () => {
  const line1 = '{"type":"session","id":"session-multi","cwd":"C:\\\\demo"}\n';
  const line2 = '{"type":"user/message","data":{"content":[{"type":"text","text":"你好"}]}}\n';
  const line3 = '{"type":"turn/start","time":1789000000000}\n';
  // 模拟 DSH：每个事件独立压缩成帧后直接拼接
  const buf = Buffer.concat([
    zlib.zstdCompressSync(Buffer.from(line1, 'utf8')),
    zlib.zstdCompressSync(Buffer.from(line2, 'utf8')),
    zlib.zstdCompressSync(Buffer.from(line3, 'utf8'))
  ]);
  assert.ok(buf.subarray(0, 4).equals(ZSTD_MAGIC));
  const out = decompressMultiFrame(buf).toString('utf8');
  assert.ok(out.includes('"session-multi"'));
  assert.ok(out.includes('你好'));
  assert.ok(out.includes('"turn/start"'));
});

test('无 zstd 帧时报错', () => {
  assert.throws(() => decompressMultiFrame(Buffer.from('plain text')), /no zstd frame/);
});

test('discoverSessions 递归发现', () => {
  const found = discoverSessions('.');
  assert.ok(Array.isArray(found));
});
