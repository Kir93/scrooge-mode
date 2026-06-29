## 問題点

- **forEach は Promise を無視** — async コールバックの返す Promise を捨てる。`await` されない。
- **順次でなく並行** — `save(x)` が即座に全要素分発火。前の完了を待たない → 期待した直列実行にならない。
- **外側で完了待ち不可** — `forEach` は同期的に即 return。後続コードが保存完了前に走る。
- **エラー握り潰し** — コールバック内の reject が unhandled rejection 化。try/catch で外側捕捉不可。

## 解決

順次なら `for...of` + await:

```js
for (const x of arr) {
  await save(x);
}
```

並行で良く完了待ちだけ必要なら:

```js
await Promise.all(arr.map(x => save(x)));
```

注意: `for...of` = 直列(遅いが順序保証・負荷小)、`Promise.all` = 並行(速いが順序保証なし・同時負荷大)。要件で選択。
