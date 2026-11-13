import type { CATEGORIES } from './categories.js';

export type Category = typeof CATEGORIES extends ReadonlySet<infer Value> ? Value : never;
export type Span = Readonly<{ start: number; end: number }> |
  Readonly<{ start?: never; end?: never }>;
export type RuleCandidate = Readonly<{
  source: 'rule'; category: Category; start: number; end: number;
  check: 'not_checked' | 'passed' | 'failed';
}>;
export type ModelCandidate = Readonly<
  | { source: 'model'; category: Category; score: number; start: number; end: number }
  | { source: 'model'; category: Category; score: number; start?: never; end?: never }
>;
export type Candidate = RuleCandidate | ModelCandidate;
export type Field = Readonly<{
  fieldId: string; text: string; allowedCategories: readonly Category[];
}>;
export type Detection = Readonly<{
  detected: ReadonlySet<Category>; possible: ReadonlySet<Category>;
  candidates: readonly Candidate[];
}>;
export type FieldAnalysis = Detection & Readonly<{
  fieldId: string; denied: ReadonlySet<Category>;
}>;
export type Prepared = Readonly<{ text: string }>;
// External model/recognizer outputs are deliberately opaque until interpretation.
export type ModelAdapter = Readonly<{
  ready(): unknown | Promise<unknown>;
  prepare(text: string): Prepared | Promise<Prepared>;
  infer(prepared: Prepared): unknown | Promise<unknown>;
}>;
export type Recognizer = (text: string) => unknown;
export type Readiness = () => unknown | Promise<unknown>;
export type ModelPrediction = Readonly<{
  entity_group: string; score: number; word?: string;
}> & Span;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function isLocatedSpan(span: Readonly<{ start: unknown; end: unknown }>, text: string):
  span is Readonly<{ start: number; end: number }> {
  return typeof span.start === 'number' && typeof span.end === 'number' &&
    Number.isInteger(span.start) && Number.isInteger(span.end) &&
    span.start >= 0 && span.end > span.start && span.end <= text.length;
}
