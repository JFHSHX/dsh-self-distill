// 脱敏（redact）模块：在任何文本写入档案前运行。
// 设计原则：确定性替换、按类别计数、可配置开关、绝不抛出异常。

const CATEGORIES = ['keys', 'emails', 'phones', 'ids', 'im'];

function buildRules(opts = {}) {
  const strict = !!opts.strict;
  const cat = opts.categories || {};
  const on = (c) => cat[c] !== false;
  const rules = [];

  // --- keys: API key / token / secret 凭证 ---
  if (on('keys')) {
    // 显式键值对：api_key=... / token: ... / Authorization: Bearer xxx / password：...
    rules.push({
      category: 'keys',
      re: /((?:api[_-]?key|apikey|token|secret|password|passwd|pwd|bearer|authorization|access[_-]?key|refresh[_-]?token)\s*["']?\s*[:=：]\s*["']?)([^\s"'，。；,;)]{6,})/gi,
      keep: 1,
      tag: 'credential'
    });
    // 常见密钥前缀
    rules.push({
      category: 'keys',
      re: /\b((?:sk|pk|rk)-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|ghu_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|cf_[A-Za-z0-9_-]{20,})\b/g,
      keep: 0,
      tag: 'credential'
      });
    }
  // --- emails ---
  if (on('emails')) {
    rules.push({
      category: 'emails',
      re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
      keep: 2,
      tag: 'email'
    });
  }

  // --- phones: 中国大陆手机号 ---
  if (on('phones')) {
    rules.push({
      category: 'phones',
      re: /\b(?<!\d)1[3-9]\d{9}(?!\d)\b/g,
      keep: 0,
      tag: 'phone'
    });
  }

  // --- ids: GUID/UUID 与 32+ 位 hex（账号 id、senderId、account id 等） ---
  if (on('ids')) {
    rules.push({
      category: 'ids',
      re: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
      keep: 4,
      tag: 'uuid'
    });
    rules.push({
      category: 'ids',
      re: /\b[0-9a-fA-F]{32,64}\b/g,
      keep: 4,
      tag: 'hex-id'
    });
  }

  // --- im: IM 消息来源包装（dsh_im_source 等）---
  if (on('im')) {
    rules.push({
      category: 'im',
      re: /<dsh_im_source>\s*\{[^}]*\}\s*<\/dsh_im_source>/g,
      keep: 0,
      tag: 'im-source'
    });
    if (strict) {
      rules.push({
        category: 'im',
        re: /("sender(?:Id|Name)"\s*:\s*")[^"]*(")/g,
        keep: 1,
        tag: 'im-field'
      });
    }
  }

  // --- 高熵长随机串（keys 兜底，必须在 ids 之后运行）---
  if (on('keys')) {
    rules.push({
      category: 'keys',
      re: /\b[A-Za-z0-9+/_=-]{28,}(?=[\s"'，。；,;)\]}]|$)/g,
      keep: 4,
      tag: 'secret'
    });
  }

  return rules;
}

/**
 * 对文本做脱敏。返回 { text, counts }。
 * counts: { category: 替换次数 }
 */
export function redactText(input, opts = {}) {
  const text = String(input ?? '');
  const rules = opts._rules || buildRules(opts);
  const counts = {};
  let out = text;
  for (const rule of rules) {
    out = out.replace(rule.re, (...args) => {
      counts[rule.category] = (counts[rule.category] || 0) + 1;
      const match = args[0];
      if (rule.keep > 0) {
        const kept = match.slice(0, rule.keep);
        return kept + '…<REDACTED:' + rule.tag + '>';
      }
      return '<REDACTED:' + rule.tag + '>';
    });
  }
  return { text: out, counts };
}

/** 就地归并多个 counts 对象 */
export function mergeCounts(target, src) {
  for (const [k, v] of Object.entries(src || {})) {
    target[k] = (target[k] || 0) + v;
  }
  return target;
}

export { CATEGORIES };
