समस्या: `forEach` callback के return Promise को अनदेखा करता → await नहीं करता। हर iteration async callback को fire-and-forget करता, तुरंत अगले पर जाता → सारे `save()` लगभग एक साथ शुरू। concurrent, sequential नहीं।

परिणाम:
- क्रम भंग: save order·निर्भरता (पिछला save अगले को प्रभावित करे) टूटता।
- `forEach` तुरंत return → बाहर से `await` असंभव, completion track नहीं। बाद का code अधूरे save पर चलता।
- कोई `save` reject हो → unhandled promise rejection, try/catch पकड़ नहीं पाता।

समाधान:

क्रमिक (sequential) चाहिए:
```js
for (const x of arr) { await save(x); }
```

क्रम अनावश्यक, बस सब पूर्ण होने का इंतज़ार:
```js
await Promise.all(arr.map(x => save(x)));
```

ध्यान: `map`+`await` वाला Promise.all concurrent चलाता, क्रम गारंटी नहीं — केवल तब जब save एक-दूसरे पर निर्भर न हों।