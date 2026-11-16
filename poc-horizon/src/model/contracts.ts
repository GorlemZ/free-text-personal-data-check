import type { CATEGORIES } from './categories.js';

export type Category = typeof CATEGORIES extends ReadonlySet<infer Value> ? Value : never;
export type Field = Readonly<{
  fieldId: string; text: string; allowedCategories: readonly Category[];
}>;
export type Detection = Readonly<{
  detected: ReadonlySet<Category>;
}>;
export type FieldAnalysis = Detection & Readonly<{
  fieldId: string; denied: ReadonlySet<Category>;
}>;
export type Prepared = Readonly<{ text: string }>;
// External model output remains opaque until interpretation.
export type ModelAdapter = Readonly<{
  ready(): unknown | Promise<unknown>;
  prepare(text: string): Prepared | Promise<Prepared>;
  infer(prepared: Prepared): unknown | Promise<unknown>;
}>;
export type Recognizer = (text: string) => ReadonlySet<Category>;
export type Readiness = () => unknown | Promise<unknown>;
export type ModelPrediction = Readonly<{
  entity_group: string; score: number;
}>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
