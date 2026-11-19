import { createServer } from "node:http";
import { createHandler } from "../bardsai/create-test-app.mjs";

const unavailable = process.env.CONTRACT_UNAVAILABLE === "1";
const entity = (label, text) => ({
  label,
  start: 0,
  end: Math.max(1, text.length),
});
const server = createServer(
  createHandler({
    ready: async () => {
      if (unavailable) throw Error("fixture unavailable");
      return true;
    },
    analyzeText: async (text) => {
      if (unavailable || text === "fixture:throw")
        throw Error("fixture unavailable");
      switch (text) {
        case "fixture:person":
          return [entity("PERSON_NAME", text)];
        case "fixture:person-aliases":
          return [entity("PERSON_NAME", text), entity("PERSON_NAME", text)];
        case "fixture:phone 3331234567":
          return [entity("PHONE_NUMBER", text)];
        case "fixture:extra":
          return [];
        case "fixture:extra-person":
          return [entity("PERSON_NAME", text)];
        case "fixture:unknown":
          return [entity("NATIVE_UNRECOGNIZED", text)];
        case "fixture:malformed":
          return [{ label: "PERSON_NAME", start: 1, end: 1 }];
        default:
          return [];
      }
    },
  }),
);
server.listen(Number(process.env.PORT ?? 0), "127.0.0.1", () =>
  console.log(JSON.stringify({ port: server.address().port })),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.closeAllConnections();
    server.close();
  });
