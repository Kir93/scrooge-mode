# `forEach` + `async` 的问题

这段代码**不会按顺序执行**,而且外层也**无法等待**它完成。核心原因:`forEach` 完全无视回调返回的 Promise。

## 问题拆解

```js
arr.forEach(async (x) => { await save(x); })
```

`forEach` 的实现大致是这样(简化):

```js
Array.prototype.forEach = function (cb) {
  for (let i = 0; i < this.length; i++) {
    cb(this[i], i, this);  // ← 调用后直接丢弃返回值,不 await
  }
}
```

每次调用 `cb(x)` 会**立即返回一个 Promise**(async 函数总是返回 Promise),但 `forEach` 把这个 Promise 直接扔掉了。于是:

1. **不是顺序执行,而是并发触发**。循环会一口气把所有 `save(x)` 同步启动,`await` 只在各自的 async 回调内部生效,回调之间互不等待。真正的执行顺序取决于每个 `save` 何时 resolve,无法保证。

2. **外层无法等待**。`forEach` 返回 `undefined`,你没法 `await arr.forEach(...)`。后续依赖"所有 save 完成"的代码会在 save 还没结束时就跑了。

```js
await arr.forEach(async (x) => { await save(x); }); // await undefined,立刻往下走
console.log('done'); // 此时 save 大概率还没完成
```

3. **错误无法被捕获**。回调抛出的 rejection 变成游离的 Promise,外层 `try/catch` 抓不到,可能触发 `unhandledRejection`。

## 正确写法

**要真正顺序执行 → 用 `for...of` + `await`:**

```js
for (const x of arr) {
  await save(x);   // 上一个完成才开始下一个,顺序有保证
}
```

**如果顺序无所谓、只要并发且能等全部完成 → `Promise.all`:**

```js
await Promise.all(arr.map((x) => save(x)));
```

**需要并发但要限制"最多 N 个同时进行"→ 分批或用 `p-limit` 之类:**

```js
import pLimit from 'p-limit';
const limit = pLimit(5);
await Promise.all(arr.map((x) => limit(() => save(x))));
```

## 一句话总结

| 写法 | 顺序 | 可等待 | 错误可捕获 |
|------|------|--------|-----------|
| `forEach(async …)` | ❌ 并发触发 | ❌ | ❌ |
| `for...of` + `await` | ✅ 严格顺序 | ✅ | ✅ |
| `Promise.all(map)` | ❌ 并发 | ✅ | ✅ |

你想要**顺序 save**,答案就是 `for...of` + `await`。`forEach` 天生不支持 async/await 语义,不要用它做异步串行控制。
