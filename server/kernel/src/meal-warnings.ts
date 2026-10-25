export const estimatedNutritionWarning = "部分营养值为估算，已保留依据。";

export function mealEstimateWarnings(items: readonly { readonly estimate: boolean }[]): string[] {
  return items.some((item) => item.estimate) ? [estimatedNutritionWarning] : [];
}
