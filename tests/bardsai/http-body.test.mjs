import { createServer } from "node:http";
import { httpBodyTests } from "../contract/http-body-runtime.mjs";
import { createHandler } from "./create-test-app.mjs";

httpBodyTests("bardsai", (observe) =>
  createServer(
    createHandler({
      ready: () => true,
      analyzeText: async (text) => {
        observe(text);
        return [];
      },
      recognize: () => new Set(),
    }),
  ),
);
