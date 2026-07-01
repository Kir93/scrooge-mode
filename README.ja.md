<p align="center">
  <img src="https://fonts.gstatic.com/s/e/notoemoji/latest/1f4b0/emoji.svg" width="120" alt="money bag" />
</p>

<h1 align="center">scrooge</h1>

<p align="center">
  <code>トークンは金 — 守銭奴のように使え</code>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.ko.md">한국어</a> · 日本語
</p>

---

> このページは best-effort の日本語ランディングです。完全な仕様・ベンチマーク・methodology は canonical な[英語 README](README.md)を参照してください。

AI コーディングエージェント向けの出力圧縮 skill。同じ答えを、より少ないトークンで返す — 圧縮するのは**出力のみ**で、reasoning・thinking・正確性には触れない。KO-first の quadrilingual(KO/EN/JA/HI)設計。日本語 register は英語規則の翻訳ではなく、韓国語の圧縮メカニズム（敬語除去・助詞ドロップ・体言止め）を日本語へ写像したもの。CJK のトークン非効率が圧縮の自然なターゲットになる。

## インストール

```bash
npx -y github:Kir93/scrooge-mode
```

詳細な setup・Claude Code plugin・Codex `skills`・トラブルシューティングは [INSTALL.md](INSTALL.md)。

## 有効化

`/scrooge ja full`（または `/scrooge ja lite`）で日本語 register を on。`/scrooge off` で解除。Claude Code の hook 上では自然言語でも動作 — 「スクルージみたいに答えて」で有効化、「スクルージやめて」で解除。

## Before / After

> データベースインデックスが読み取りを速くし書き込みを遅くする理由を説明して。

### Normal

```text
データベースのインデックスは、読み取りを高速化する一方で書き込みを遅くします。
これはインデックスが追加の検索構造を維持するためです。読み取りの場合、クエリ
プランナがインデックスのキーを探索して該当する行だけを取得できるため、テーブル
全体を走査する必要がなくなります。一方で書き込みの場合は、データ本体に加えて
インデックスも更新する必要があり、その分のオーバーヘッドが発生します。
```

### Scrooge `ja/full`

```text
インデックス = 追加の検索構造。

読み取り: planner が index キー探索 → 該当行のみ取得。selective な述語なら full table scan 回避。
書き込み: INSERT/UPDATE/DELETE が index ページ維持要 → B-tree 分割・WAL 増・cache 消費。

Trade-off: hot な selective read に index 追加; write 多テーブルへの冗長 index 回避。
```

同じ技術的判断、より少ない出力トークン。code block・エラー文字列・技術用語は原文のまま、セキュリティ警告や取り消せない操作は通常の文体を維持する。

## さらに

機能表面・ベンチマーク・メカニズム・貢献ガイドは [英語 README](README.md) と [CONTRIBUTING.md](CONTRIBUTING.md) を参照。

## ライセンス

MIT © 2026 Kir93. [LICENSE](LICENSE) 参照。
