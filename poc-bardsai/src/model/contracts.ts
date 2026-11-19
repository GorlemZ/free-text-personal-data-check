import type { CATEGORIES } from "./categories.js";

export type Category =
  typeof CATEGORIES extends ReadonlySet<infer Value> ? Value : never;
export type Field = Readonly<{
  fieldId: string;
  text: string;
  allowedCategories: readonly Category[];
}>;
export type Detection = Readonly<{
  detected: ReadonlySet<Category>;
}>;
export type FieldAnalysis = Detection &
  Readonly<{
    fieldId: string;
    denied: ReadonlySet<Category>;
  }>;
export type Recognizer = (text: string) => ReadonlySet<Category>;
export type Readiness = () => unknown | Promise<unknown>;
export type DecoderPrediction = Readonly<{
  label: string;
  start: number;
  end: number;
}>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
