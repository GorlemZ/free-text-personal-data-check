// Legacy test API only: compose the real production listener and field-policy boundary.
import http from 'node:http';
import { createApp } from '../../../poc-rizzo/dist/app.js';
import { analysisServiceBuilder } from '../../../poc-rizzo/dist/services/analysisService.js';
export const analyzeFields = (fields, detect) => analysisServiceBuilder({ modelDetectionService: detect, ruleDetectionService: () => new Set() })(fields);
export function createServer({ detect, ready = () => true }) {
  return http.createServer(createApp({ analysisService: fields => analyzeFields(fields, detect), ready }));
}
