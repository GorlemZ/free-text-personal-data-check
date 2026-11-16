import { CATEGORY_SOURCES, isCategory } from "../model/categories.js";
import type { Detection } from "../model/contracts.js";

// Recognition and validation are local to the rule; this boundary only checks categories/ownership.
export function detectRuleCategories(raw: unknown): Detection {
  if (!(raw instanceof Set)) throw new Error("INVALID_RESULTS");
  return {
    detected: new Set(
      [...raw].filter((category) => {
        if (!isCategory(category)) throw new Error("INVALID_RULE_CATEGORY");
        return CATEGORY_SOURCES[category] === "rule";
      }),
    ),
  };
}
