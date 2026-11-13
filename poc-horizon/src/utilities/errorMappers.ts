import { BodyTooLarge, InvalidRequest } from '../model/errors.js';

export type HttpError = Readonly<{
  status: 400 | 413 | 503;
  payload: Readonly<{ code: 'invalid_request' | 'body_too_large' | 'detector_unavailable' }>;
}>;
export function toHttpError(error: unknown): HttpError {
  if (error instanceof BodyTooLarge) return { status: 413, payload: { code: 'body_too_large' } };
  if (error instanceof InvalidRequest) return { status: 400, payload: { code: 'invalid_request' } };
  return { status: 503, payload: { code: 'detector_unavailable' } };
}
