# dsh-self-distill

DeepSeek Harness（DSH）插件：**空闲时自动**把本机全部 DSH 会话记录解压、蒸馏、**脱敏**为个人档案与定制日程（默认输出 `C:\myself`）。

```
会话存档 (*.jsonl.zstd, 多帧 zstd)
  → 多帧解压 → JSONL 解析（过滤系统注入/自动续跑）
  → 脱敏（keys/emails/phones/ids/im）
  → 蒸馏（画像/项目/活跃规律/日程）
  → C:\myself（01-个人画像.md … 04-日程规划.md + source/ 底稿）
```

## 功能

- **空闲自动整理**：回合停止（`agent/turn-stopping`）后启动空闲计时器，会话空闲满 `idleMinutes`（默认 20 分钟）自动蒸馏一次；会话销毁（`agent/disposed`）时立即收档。全程防抖（冷却默认 60 分钟 + 无变化跳过），绝不打扰正常工作。
- **信息脱敏（默认开启）**：任何文本写入档案前经过确定性替换——
  | 类别 | 规则 | 替换为 |
  |---|---|---|
  | `keys` | `key:`/`token=`/`Authorization: Bearer`、`sk-`/`ghp_`/`AKIA`/`AIza` 等前缀、≥28 位高熵随机串 | `<REDACTED:credential>` / 保留前 4 位 |
  | `emails` | 邮箱地址 | 保留前 2 位 + `<REDACTED:email>` |
  | `phones` | 中国大陆手机号 | `<REDACTED:phone>` |
  | `ids` | GUID/UUID、32+ 位 hex（账号 id、senderId） | 保留前 4 位 + `<REDACTED:uuid>` |
  | `im` | `<dsh_im_source>` 消息来源包装 | `<REDACTED:im-source>` |
- **蒸馏产物**：`01-个人画像`（环境/沟通风格统计）、`02-项目档案`（工作区与仓库痕迹、未完成信号）、`03-活跃规律`（小时直方图、活跃窗口、空档）、`04-日程规划`（由活跃数据推导的黄金窗与每日模板）、`source/` 脱敏底稿。
- **两个工具**：`self_distill_run`（立即运行，`mode=force` 强制全量）、`self_distill_status`（查看配置与上次运行状态）。
- **零依赖**：仅用 Node 内置模块（zlib 多帧 zstd 解压需 Node ≥ 22.15）。

## 安装（DSH）

```bash
# 在 DSH 的插件命令行（或 dsh CLI 可用的环境）中：
dsh plugin --profile <你的profile> add @jfhshx/dsh-self-distill
```

包声明了 `dsh.bundle.patch`，安装时会自动把 `cordis.patch.yml` 追加到 profile 的 bundle 列表，无需手工编辑。单个 profile 临时停用：

```yaml
# 在该 profile 的 cordis.patch.yml 中
- id: self-distill
  disabled: true
```

## 配置

`~/.dsh-self-distill/config.json`（不存在则用默认值）：

```json
{
  "outDir": "C:\\myself",
  "idleMinutes": 20,
  "minIntervalMinutes": 60,
  "timezoneOffsetHours": 8,
  "keepSource": true,
  "redact": { "enabled": true, "strict": false, "categories": { "keys": true, "emails": true, "phones": true, "ids": true, "im": true } }
}
```

## CLI（手动运行）

```bash
node bin/dsh-self-distill.js              # 跑一次蒸馏
node bin/dsh-self-distill.js --force      # 强制全量（跳过冷却与变更检测）
node bin/dsh-self-distill.js --no-redact  # 关闭脱敏（仅本地自用，勿分享）
node bin/dsh-self-distill.js status       # 查看配置与状态
```

## 测试

```bash
npm test        # node --test test/
```

## 发布到 GitHub

```bash
git init
git add -A
git commit -m "feat: dsh-self-distill 空闲自动蒸馏插件"
git remote add origin https://github.com/JFHSHX/dsh-self-distill.git
git branch -M main
git push -u origin main
# 然后到 GitHub 仓库页创建 Release；发布 npm 包（可选）：
# npm publish --access public
```

## 已知限制

- 会话存档为多帧 zstd 拼接，依赖 Node ≥ 22.15 的 `zlib.zstdDecompressSync`（本插件已按魔数切帧，兼容单帧/多帧）。
- 活跃统计样本来自本机会话记录，日期越多规律越准。
- 脱敏是确定性正则替换，无法保证捕获所有自定义格式的凭证；分享档案前建议人工复核 `source/` 底稿。

## License

MIT © 2026 JFHSHX
