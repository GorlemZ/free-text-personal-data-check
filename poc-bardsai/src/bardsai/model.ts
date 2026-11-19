import {
  AutoModelForTokenClassification,
  AutoTokenizer,
  env,
} from "@huggingface/transformers";
import { MODEL_CONFIG } from "../config/config.js";
import { BardsAiDecoder } from "./decoder.js";
export type BardsAiModel = Readonly<{
  analyzeText(text: string): Promise<unknown>;
}>;

export const MODEL_ID = MODEL_CONFIG.modelId;
export const MODEL_REVISION = MODEL_CONFIG.revision;

export async function bardsAiAdapterBuilder({
  tokenBudget = MODEL_CONFIG.tokenBudget,
  loadTokenizer = () =>
    AutoTokenizer.from_pretrained(MODEL_ID, MODEL_CONFIG.tokenizerOptions),
  loadModel = () =>
    AutoModelForTokenClassification.from_pretrained(
      MODEL_ID,
      MODEL_CONFIG.options,
    ),
}: Readonly<{
  tokenBudget?: number;
  loadTokenizer?: () => Promise<unknown>;
  loadModel?: () => Promise<unknown>;
}> = {}): Promise<BardsAiModel> {
  if (
    !Number.isSafeInteger(tokenBudget) ||
    tokenBudget <= 0 ||
    tokenBudget > MODEL_CONFIG.tokenBudget
  )
    throw new TypeError("INVALID_TOKEN_BUDGET");
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = MODEL_CONFIG.root;
  env.useBrowserCache = false;
  const [rawTokenizer, model] = await Promise.all([
    loadTokenizer(),
    loadModel(),
  ]);
  const tokenizer = rawTokenizer as ConstructorParameters<
    typeof BardsAiDecoder
  >[0]["tokenizer"];
  const decoder = new BardsAiDecoder({
    tokenizer,
    model: model as ConstructorParameters<typeof BardsAiDecoder>[0]["model"],
  });
  return {
    async analyzeText(text: string): Promise<unknown> {
      if (
        tokenizer.encode(text, { add_special_tokens: false }).length >
        tokenBudget
      )
        throw new Error("TOKEN_BUDGET_EXCEEDED");
      return decoder.predict(text);
    },
  };
}
