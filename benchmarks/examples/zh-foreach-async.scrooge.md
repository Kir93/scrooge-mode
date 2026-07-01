**结论: forEach 不 await callback → 无序·无法保证顺序,也无法捕获 error。**

原因:
- forEach 无视 callback 返回的 Promise。每次迭代同步调 async fn 立即返回 pending Promise → 全部 save 几乎同时启动,并发跑,非顺序。
- `await save(x)` 只在各自 callback 内串行,callback 之间无串行 → 顺序由各 save 完成时刻决定,乱序。
- forEach 不返回 Promise → 外层无法 `await` 整体完成。后续 code 在 save 未完时就跑。
- callback 内 reject → unhandled rejection,外层 try/catch 抓不到。

解决:

```js
// 顺序 save
for (const x of arr) {
  await save(x);
}
```

```js
// 并发但可等待·可捕获(不保证顺序)
await Promise.all(arr.map(x => save(x)));
```

注意: 需严格顺序 → 用 `for...of`。仅需「全部完成」不在乎顺序 → `Promise.all`。
