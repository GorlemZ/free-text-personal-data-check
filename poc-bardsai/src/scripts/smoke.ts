import { createServer } from "node:http";
import type { RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { isRecord } from "../model/contracts.js";
import { createApp } from "../app.js";
import { bardsAiAdapterBuilder } from "../bardsai/model.js";
import { analysisServiceBuilder } from "../analysis.js";
import { pathToFileURL } from "node:url";

type DetectText = (text: string) => Promise<unknown>;

async function fiscalCodeOutcome(handler: RequestListener): Promise<
  Readonly<{
    fiscalCodeDetected: boolean;
  }>
> {
  const server = createServer(handler);
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/analyze`;
    const post = async (text: string) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: [{ fieldId: "description", text, allowedCategories: [] }],
        }),
      });
      const body = (await response.json()) as {
        readonly findings: readonly { readonly category: string }[];
        readonly code?: string;
      };
      return { status: response.status, body } as const;
    };
    const valid = await post("Codice fiscale sintetico: RSSMRA85M01H501Q.");
    const fiscalCodeDetected =
      valid.status === 200 &&
      valid.body.findings.some((x) => x.category === "IT_FISCAL_CODE");
    if (!fiscalCodeDetected) throw new Error("Fiscal-code HTTP smoke failed");
    return { fiscalCodeDetected };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export async function smoke({
  detectText,
  handler,
}: Readonly<{
  detectText: DetectText;
  handler: RequestListener;
}>) {
  const result = await detectText(
    "Contattare Ada Verdi a ada.verdi@example.com.",
  );
  const tail = await detectText(
    "Servizio digitale per consultazione. ".repeat(32) +
      "Scrivere a prova.sintetica@example.com.",
  );
  if (!Array.isArray(result) || !Array.isArray(tail))
    throw new Error("Real model smoke failed");
  const outcome = await fiscalCodeOutcome(handler);
  const labelOf = (value: unknown): unknown => {
    if (!isRecord(value)) throw new Error("Real model smoke failed");
    return value.label;
  };
  return {
    loaded: true,
    labels: result.map(labelOf),
    count: result.length,
    tailEmailDetected: tail.some((x) => labelOf(x) === "EMAIL_ADDRESS"),
    ...outcome,
    rssMiB: +(process.memoryUsage().rss / 1048576).toFixed(1),
  } as const;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const model = await bardsAiAdapterBuilder();
  const analysisService = analysisServiceBuilder({ model });
  const handler = createApp({ ready: () => true, analysisService });
  const detectText = async (text: string): Promise<unknown> =>
    model.analyzeText(text);
  console.log(JSON.stringify(await smoke({ handler, detectText })));
}
