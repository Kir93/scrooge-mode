<p align="center">
  <img src="https://fonts.gstatic.com/s/e/notoemoji/latest/1f4b0/emoji.svg" width="120" alt="money bag" />
</p>

<h1 align="center">scrooge</h1>

<p align="center">
  <code>token 就是钱 — 像守财奴一样花</code>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.ko.md">한국어</a> · <a href="README.ja.md">日本語</a> · 简体中文
</p>

---

> 这是一个 best-effort 的中文着陆页。完整规格、benchmark、methodology 请参阅 canonical 的[英文 README](README.md)。

面向 AI 编码 agent 的输出压缩 skill。同样的答案,用更少的 token 返回 — 压缩的只是**输出**,reasoning、thinking、正确性都不动。KO-first 的 pentalingual(KO/EN/JA/HI/ZH)设计。

中文 register 与 JA/HI 不同:中文是**孤立语**,没有可删的敬语形态素·格助词,所以不套用韩语机制,而是 **zh-native** 新设计 — 删礼貌层(`请`/`您`)、保守删冗余结构助词(`的`/`了`/`着`)与量词、删连接词 filler,保持简体中文正文并把英文技术词按 code-mix 保留原形。现代简洁体,不是 caveman 的文言(wenyan)。CJK 的 token 低效正好是压缩的自然目标。

## 安装

```bash
npx -y github:Kir93/scrooge-mode
```

详细 setup、Claude Code plugin、Codex `skills`、故障排查见 [INSTALL.md](INSTALL.md)。

## 启用

`/scrooge zh full`(或 `/scrooge zh lite`)启用中文 register,`/scrooge off` 解除。在 Claude Code 的 hook 上,自然语言也能触发 —「像斯克鲁奇一样回答」启用,「关闭斯克鲁奇」解除。否定句(「别像斯克鲁奇一样」)会被忽略。

## Before / After

> 解释一下数据库索引为什么加快读取、拖慢写入。

### Normal

```text
数据库索引在加快读取的同时会拖慢写入。这是因为索引维护了额外的查找结构。读取时,
查询规划器可以搜索索引键、只取回匹配的行,从而避免全表扫描。而写入时,除了数据本体
之外还需要同步更新索引,由此产生额外的开销。
```

### Scrooge `zh/full`

```text
索引 = 额外的查找结构。

读取: planner 搜索 index 键 → 只取匹配行。selective 谓词则避免 full table scan。
写入: INSERT/UPDATE/DELETE 需维护 index 页 → B-tree 分裂·WAL 增·cache 消耗。

Trade-off: hot 的 selective read 加 index; write 多的表避免冗余 index。
```

同样的技术判断,更少的输出 token。code block·error string·技术词保留原文;安全警告与不可逆操作保持正常文体。

## 更多

功能表面、benchmark、机制、贡献指南见[英文 README](README.md)与 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可

MIT © 2026 Kir93。见 [LICENSE](LICENSE)。
