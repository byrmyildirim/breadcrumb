import {
  FunctionRunResult,
  CartValidationsGenerateRunInput,
} from "../generated/api";

const NO_CHANGES: FunctionRunResult = {
  errors: [],
};

export const run = (
  input: CartValidationsGenerateRunInput
): FunctionRunResult => {
  const errors = input.cart.lines
    .filter((line) => {
      const price = parseFloat(line.cost.amountPerQuantity.amount);
      const merchandise = line.merchandise;

      // If merchandise is not a ProductVariant (e.g. Custom Product), we might skip or block. 
      // Assuming variants for now.
      if (!('product' in merchandise)) return false;

      const isGift = merchandise.product.hasAnyTag; // This boolean comes from the query

      // Block if Price is 0 AND it is NOT marked as a gift/promo
      return price <= 0.01 && !isGift;
    })
    .map((line) => ({
      localizedMessage: "Bu ürünün fiyatı hatalı (0 TL) olduğu için sipariş verilemez. Lütfen mağaza ile iletişime geçiniz.",
      target: "cart",
    }));

  if (errors.length > 0) {
    return { errors };
  }

  return NO_CHANGES;
};