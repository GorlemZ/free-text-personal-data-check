import type { Category } from "./categories.js";
export type { Category } from "./categories.js";
export interface Field {
  readonly fieldId: string;
  readonly text: string;
  readonly allowedCategories: readonly Category[];
}
export interface Finding {
  readonly fieldId: string;
  readonly category: Category;
}
// External SDK output is deliberately unknown until the original interpretation boundary.
export interface RawInferenceResult {
  readonly output: unknown;
}
export type RawInference = (text: string) => Promise<RawInferenceResult>;
export type NormalizedDetection = ReadonlySet<Category>;
export type Detection = (
  text: string,
) => NormalizedDetection | Promise<NormalizedDetection>;
export type Analysis = (
  fields: readonly Field[],
) => readonly Finding[] | Promise<readonly Finding[]>;
