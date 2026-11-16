import type { Response } from "express";
import { detectorUnavailable } from "../utilities/errorMappers.js";

export type Ready = () => unknown | Promise<unknown>;
export async function healthRouter(
  response: Response,
  ready: Ready,
): Promise<void> {
  try {
    if (await ready()) {
      response.status(200).send({ status: "ready" });
      return;
    }
  } catch {}
  response.status(503).send(detectorUnavailable());
}
