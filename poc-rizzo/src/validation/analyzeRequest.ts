import { z } from "zod";
import { HTTP_LIMITS } from "../config/config.js";
import { CATEGORIES } from "../model/categories.js";
import type { Field } from "../model/contracts.js";

const CategorySchema = z.enum(CATEGORIES);
const isWellFormed = (value: string): boolean => value.isWellFormed();
const FieldSchema = z
  .object({
    fieldId: z
      .string()
      .min(1)
      .max(HTTP_LIMITS.maxFieldIdUnits)
      .refine(isWellFormed),
    text: z
      .string()
      .refine(isWellFormed)
      .refine(
        (value) =>
          value.split(/\p{White_Space}+/u).filter(Boolean).length <=
          HTTP_LIMITS.maxWords,
      ),
    allowedCategories: z.array(CategorySchema).default([]),
  })
  .strict();

const AnalyzeRequestSchema = z
  .object({
    fields: z.array(FieldSchema).min(1).max(HTTP_LIMITS.maxFields),
  })
  .strict()
  .refine(
    ({ fields }) =>
      new Set(fields.map(({ fieldId }) => fieldId)).size === fields.length,
  );

export function analyzeRequest(body: unknown): readonly Field[] | undefined {
  const parsed = AnalyzeRequestSchema.safeParse(body);
  return parsed.success ? parsed.data.fields : undefined;
}
