import { createServer } from "./support/http.mjs";
import { httpBodyTests } from "../contract/http-body-runtime.mjs";
httpBodyTests("rizzo", (record) =>
  createServer({
    detect: async (text) => {
      record(text);
      return new Set();
    },
  }),
);
