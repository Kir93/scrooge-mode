## 問題の本質

`Array.prototype.forEach` は **コールバックが返す Promise を一切待ちません**。`async` 関数は呼ばれた瞬間に Promise を返しますが、`forEach` はその戻り値を無視して捨てます。結果として「`await save(x)` を書いたから順次実行されるはず」という期待は満たされません。

```js
arr.forEach(async (x) => {
  await save(x);   // この await は「この無名関数の中」だけで効く
});
// forEach はここで即座に undefined を返して次の行へ進む
```

## 具体的に起きること

**1. 順次にならず、ほぼ並列で発火する**

`forEach` は各要素に対してコールバックを**同期的に次々呼び出す**だけです。`save(x)` の中で最初の `await` に到達した時点で制御が呼び出し側に戻り、`forEach` はすぐ次の要素のコールバックを呼びます。よって全 `save` が（前の完了を待たずに）ほぼ同時に走り出します。

```js
const arr = [1, 2, 3];
const save = (x) => new Promise(r => setTimeout(() => {
  console.log('done', x); r();
}, 100));

arr.forEach(async (x) => {
  console.log('start', x);
  await save(x);
});
// 出力: start 1, start 2, start 3, （100ms後）done 1, done 2, done 3
// → start が先に全部出る = 並列。順次なら start1→done1→start2... になるはず
```

**2. 完了を待てない（await が効かない）**

`forEach` の戻り値は `undefined` なので `await arr.forEach(...)` しても意味がありません。全保存の完了を後続処理で待つことができません。

```js
await arr.forEach(async (x) => { await save(x); });
console.log('全部終わった');  // ← まだ終わっていないのに実行される
```

**3. エラーが握り潰される（unhandled rejection）**

コールバック内で例外が出ても、`forEach` は Promise を捨てているので呼び出し側の `try/catch` で捕捉できません。`UnhandledPromiseRejection` になります。

```js
try {
  arr.forEach(async (x) => { throw new Error('boom'); });
} catch (e) {
  // ここには来ない。プロセスレベルの unhandled rejection になる
}
```

**4. 並行数が制御できない**

意図せず全件同時実行になるため、DB コネクション枯渇・レート制限・順序依存の破壊などの副作用を招きます。

## 解決方法

### 本当に「順次」実行したい場合 → `for...of` + `await`

```js
for (const x of arr) {
  await save(x);   // 1件ずつ完了を待ってから次へ
}
```

これなら順序が保証され、エラーも普通の `try/catch` で捕捉でき、ループ全体を `await` で待てます。

### 並列で良い（順序不問・高速化したい）場合 → `Promise.all` + `map`

```js
await Promise.all(arr.map((x) => save(x)));
```

ただしこれは全件同時発火なので、件数が多いときは並行数の制限が必要です。

### 並列だが同時実行数を制限したい場合

```js
// 例: p-limit ライブラリ
import pLimit from 'p-limit';
const limit = pLimit(5);
await Promise.all(arr.map((x) => limit(() => save(x))));
```

自前で書くなら `reduce` でチャンク分割したり、簡易セマフォを使います。

## まとめ

| 目的 | 正しい書き方 |
|---|---|
| 順次・順序保証 | `for...of` + `await` |
| 並列・順序不問 | `Promise.all(arr.map(...))` |
| 並列＋同時数制限 | `p-limit` 等で並行数を絞る |
| 使ってはいけない | `forEach(async ...)` |

**根本原因は「`forEach` が async 非対応（Promise を待たない／返さない）」という一点**です。順次実行が欲しいなら `for...of` に置き換えるのが最も素直で安全です。
