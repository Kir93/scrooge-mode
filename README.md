# Scrooge 🪙

English | [한국어](README.ko.md)

> Tokens are money. So spend them like a miser.

🚧 **Early development.** Landed: the i18n registry, the compression registers, the multi-agent installer, the activation hook, and token-savings stats. Still in progress: publishing to npm / the Claude Code marketplace (so `claude plugin install` is not live yet — use `--dry-run` to preview) and the benchmark.

**Scrooge** aims to make AI coding agents reply in a **compressed register while keeping full technical accuracy**, cutting **output tokens** — with **Korean as a first-class language** alongside English.

## Why Scrooge — positioning is "accessibility"

Existing compression tools assume fluency in English or Classical Chinese. Scrooge treats Korean as a first-class language, so you can save tokens in your own language without that background.

## i18n architecture

The piece that exists today: a registry that maps `language × dial → rule file path` 1:1. Language rules are not hardcoded in core logic, so adding a language is two steps:

1. Author the `rules/{lang}/{lite,full}.md` rule files.
2. Add one entry to [registry.json](registry.json):

```json
{
  "ja": { "lite": "rules/ja/lite.md", "full": "rules/ja/full.md" }
}
```

## License / attribution

MIT © 2026 Kir93. See [LICENSE](LICENSE).

Inspired by [caveman](https://github.com/JuliusBrussee/caveman) (MIT, © Julius Brussee) — concept only, independently reimplemented i18n-first (no verbatim copy).
