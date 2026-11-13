export const invalidRequest = () => ({ code: 'invalid_request' as const });
export const bodyTooLarge = () => ({ code: 'body_too_large' as const });
export const detectorUnavailable = () => ({ code: 'detector_unavailable' as const });
export const notFound = () => ({ code: 'not_found' as const });
