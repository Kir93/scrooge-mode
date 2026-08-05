// Shopping cart totals. Deliberately carries one real bug (see test/cart.test.js).
export function subtotal(items) {
  return items.reduce((sum, it) => sum + it.price * it.qty, 0);
}

// BUG: percent discounts are applied as a flat subtraction, so a 10% discount
// removes 10 currency units instead of 10% of the subtotal.
export function applyDiscount(total, discount) {
  if (!discount) return total;
  if (discount.type === 'percent') return total - discount.value;
  return total - discount.value;
}

export function checkout(items, discount) {
  return applyDiscount(subtotal(items), discount);
}
