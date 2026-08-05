import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subtotal, checkout } from '../src/cart.js';

const items = [
  { sku: 'a', price: 100, qty: 2 },
  { sku: 'b', price: 50, qty: 1 },
];

test('subtotal sums price * qty', () => {
  assert.equal(subtotal(items), 250);
});

test('a 10% discount takes 10% of the subtotal', () => {
  assert.equal(checkout(items, { type: 'percent', value: 10 }), 225);
});

test('a flat discount subtracts its value', () => {
  assert.equal(checkout(items, { type: 'flat', value: 10 }), 240);
});
