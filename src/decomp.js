// 多帧 zstd 解压：DSH 会话存档 session.jsonl.zstd 是多个标准 zstd 帧拼接而成，
// zlib.zstdDecompressSync 只解第一帧，因此按魔数 28 b5 2f fd 切分后逐帧解压再拼接。
// 依赖 Node >= 22.15 内置的 zlib.zstdDecompressSync，零第三方依赖。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** 解压一段多帧 zstd 缓冲区（同步）。 */
export function decompressMultiFrame(buf) {
  const offs = [];
  for (let i = 0; i <= buf.length - 4; i++) {
    if (
      buf[i] === ZSTD_MAGIC[0] &&
      buf[i + 1] === ZSTD_MAGIC[1] &&
      buf[i + 2] === ZSTD_MAGIC[2] &&
      buf[i + 3] === ZSTD_MAGIC[3]
    ) {
      offs.push(i);
    }
  }
  if (offs.length === 0) throw new Error('no zstd frame found');
  const parts = [];
  for (let k = 0; k < offs.length; k++) {
    const start = offs[k];
    const end = k + 1 < offs.length ? offs[k + 1] : buf.length;
    parts.push(zlib.zstdDecompressSync(buf.subarray(start, end)));
  }
  return Buffer.concat(parts);
}

/** 递归发现目录下全部 session.jsonl.zstd，返回绝对路径数组。 */
export function discoverSessions(sessionsDir) {
  const out = [];
  (function walk(d) {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'session.jsonl.zstd') out.push(p);
    }
  })(sessionsDir);
  return out.sort();
}

/** 解压单个会话存档，返回 JSONL 文本。 */
export function readSessionText(srcPath) {
  return decompressMultiFrame(fs.readFileSync(srcPath)).toString('utf8');
}
