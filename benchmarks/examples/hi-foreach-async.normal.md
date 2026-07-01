# समस्या: `forEach` async callback को await नहीं करता

`Array.prototype.forEach` अपने callback की return value को **पूरी तरह अनदेखा** कर देता है। जब callback `async` होता है तो वह एक Promise return करता है — लेकिन `forEach` उस Promise को discard कर देता है और अगले element पर तुरंत चला जाता है। नतीजा: **कोई क्रमिक (sequential) व्यवहार नहीं होता।**

## अंदर वास्तव में क्या होता है

```js
arr.forEach(async (x) => {
  await save(x);
});
console.log('done');
```

1. `forEach` synchronously हर element के लिए callback को invoke करता है।
2. हर callback पहले `await save(x)` तक चलता है, वहाँ **suspend** होकर एक pending Promise return करता है।
3. `forEach` उस Promise को फेंक देता है और **बिना रुके** अगले element को call करता है।

यानी सभी `save(x)` कॉल्स लगभग एक साथ **शुरू** हो जाते हैं (concurrent/overlapping), एक-के-बाद-एक नहीं। और `console.log('done')` किसी भी save के पूरा होने से **पहले** print हो जाता है।

## इससे टूटने वाली 4 अपेक्षाएँ

| अपेक्षा | वास्तविकता |
|---|---|
| **क्रम (sequencing)** | सभी saves overlapping चलते हैं; `await` सिर्फ उसी callback को रोकता है, loop को नहीं |
| **पूरा होने का इंतज़ार** | `forEach` `undefined` लौटाता है — आप `await arr.forEach(...)` नहीं कर सकते, कब सब खत्म हुआ पता नहीं चलता |
| **error handling** | callback की rejection **unhandled promise rejection** बन जाती है; बाहर का `try/catch` उसे नहीं पकड़ता |
| **पूरा होने का क्रम** | `save` का समय अलग-अलग हो तो completion order non-deterministic |

> ध्यान दें: यदि `save` में shared state/rate-limit/DB transaction ordering मायने रखती है, तो यह concurrency data corruption या race condition तक ले जा सकती है।

## सही विकल्प

**1. क्रमिक (sequential) चाहिए → `for...of`**
```js
for (const x of arr) {
  await save(x);          // हर save पिछले के पूरा होने पर ही शुरू होता है
}
```

**2. समानांतर (parallel) पर सबका इंतज़ार चाहिए → `Promise.all` + `map`**
```js
await Promise.all(arr.map((x) => save(x)));
```
(यहाँ error भी properly propagate होती है और `try/catch` पकड़ लेता है।)

**3. Concurrency सीमित करनी हो → batching या `p-limit` जैसी lib**
```js
import pLimit from 'p-limit';
const limit = pLimit(5);
await Promise.all(arr.map((x) => limit(() => save(x))));
```

## सारांश

`forEach` "fire-and-forget" है — यह async को समझता ही नहीं। जहाँ **क्रम** चाहिए वहाँ `for...of + await`, जहाँ **समानांतर पर पूर्णता की गारंटी** चाहिए वहाँ `Promise.all(arr.map(...))` इस्तेमाल करें। `forEach` के साथ `async/await` का combination लगभग हमेशा एक bug है।