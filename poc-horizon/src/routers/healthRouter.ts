import type { RequestHandler } from "express";
import type { Readiness } from "../model/contracts.js";
import { DetectorUnavailable } from "../model/errors.js";

import { toHttpError } from "../utilities/errorMappers.js";

export function createHealthRouter(ready: Readiness): RequestHandler {
  return async (_req, res) => {
    try {
      if (!(await ready())) throw new DetectorUnavailable();
      res.status(200).send({ status: "ready" });
    } catch {
      const mapped = toHttpError(new DetectorUnavailable());
      res.status(mapped.status).send(mapped.payload);
    }
  };
}
