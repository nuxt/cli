function applyDiscount(cart: string, code: string) {
  throw new Error(`Failed to apply discount code ${code} to cart ${cart}: the pricing service responded with 422 Unprocessable Entity (the code expired on 2026-09-01 and cannot be combined with items already on sale)`)
}

export default defineEventHandler((event) => {
  const cart = String(getQuery(event).cart ?? 'guest')
  console.log(`[checkout] loading cart ${cart} with options ${JSON.stringify({
    currency: 'EUR',
    locale: 'en-GB',
    include: [
      'items',
      'discounts',
      'shipping',
      'tax',
    ],
    expand: true,
  })}`)
  console.warn(`[checkout] prices for cart ${cart} were cached more than 10 minutes ago, recalculating totals against https://pricing.example.com/v2/carts/${cart}/recalculate?currency=EUR&include=tax`)
  applyDiscount(cart, 'SUMMER-2026')
})
