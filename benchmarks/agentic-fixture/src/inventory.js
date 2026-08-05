export function inStock(inventory, sku) {
  return (inventory[sku] || 0) > 0;
}

export function reserve(inventory, sku, qty) {
  if (!inStock(inventory, sku)) throw new Error(`out of stock: ${sku}`);
  inventory[sku] -= qty;
  return inventory[sku];
}
