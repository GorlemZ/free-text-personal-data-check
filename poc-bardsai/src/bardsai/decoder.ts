import { Tensor } from "@huggingface/transformers";

// TypeScript/Node port of BardsAI's official JavaScript word_re decoder:
// https://huggingface.co/spaces/bardsai/eu-pii-anonymization-demo/raw/main/pii.js
// Upstream model/demo license: Apache-2.0. Decoder behavior is kept separate
// from application category mapping and policy.
const WORD = /[^\s,;|"<>()\[\]{}*^]+/gu;
const EMAIL =
  /(?<![\p{L}\p{N}_.+-])[\p{L}\p{N}_.+-]+@[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*\.[A-Za-z]{2,}(?![\p{L}\p{N}_-])/gu;
const W = "[\\p{L}\\p{N}_]";
const URLISH = new RegExp(
  `(https?://|www\\.|${W}\\.[a-z]{2,}(?!${W})|/${W})`,
  "iu",
);
const ID_TYPES = new Set([
  "PERSON_IDENTIFIER",
  "BANK_ACCOUNT_IDENTIFIER",
  "PAYMENT_CARD",
  "ACCOUNT_IDENTIFIER",
  "DOCUMENT_IDENTIFIER",
  "VEHICLE_IDENTIFIER",
]);
const isSpace = (value: string): boolean => /\s/u.test(value);
const isDigit = (value: string): boolean => /\p{Nd}/u.test(value);
const utf8Length = (point: number): number =>
  point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;

type Offset = [number, number];
export type DecoderEntity = Readonly<{
  start: number;
  end: number;
  label: string;
  text: string;
}>;
type Tokenizer = Readonly<{
  encode(
    text: string,
    options: Readonly<{ add_special_tokens: false }>,
  ): number[];
  get_vocab(): Map<string, number> | Record<string, number>;
}>;
type Model = ((
  inputs: Readonly<Record<string, Tensor>>,
) => Promise<{ logits: { data: ArrayLike<number> } }>) & {
  config: { id2label: Record<string | number, string> };
};

export function tokenOffsets(
  text: string,
  tokens: readonly string[],
): Offset[] {
  const offsets: Offset[] = [];
  let position = 0;
  let bytesLeft = 0;
  let byteSpan: Offset = [0, 0];
  for (const token of tokens) {
    const byte = /^<0x([0-9A-Fa-f]{2})>$/.exec(token);
    if (byte) {
      if (bytesLeft === 0) {
        const point = text.codePointAt(position) ?? 0x20;
        const width = point > 0xffff ? 2 : 1;
        byteSpan = [position, position + width];
        bytesLeft = utf8Length(point);
      }
      offsets.push(byteSpan);
      bytesLeft--;
      if (bytesLeft === 0) position = byteSpan[1];
      continue;
    }
    const start = position;
    let index = 0;
    while (index < token.length && token[index] === "▁") {
      if (text[position] === " ") position++;
      index++;
    }
    const rest = token.slice(index).replaceAll("▁", " ");
    if (rest) {
      if (text.startsWith(rest, position)) position += rest.length;
      else {
        const found = text.indexOf(rest, position);
        if (found >= 0) position = found + rest.length;
      }
    }
    offsets.push(
      position > start
        ? [start, position]
        : [start, Math.min(start + 1, text.length)],
    );
  }
  return offsets;
}

function valid(
  text: string,
  start: number,
  end: number,
  type: string,
): boolean {
  const value = text.slice(start, end);
  const digits = [...value].filter(isDigit).length;
  if (type === "IDENTIFYING_LINK") return URLISH.test(value);
  if (type === "PHONE_NUMBER") return digits >= 5;
  if (ID_TYPES.has(type)) return digits >= 2;
  return true;
}
function stripped(value: string, chars: string): string {
  let start = 0,
    end = value.length;
  while (start < end && chars.includes(value[start] ?? "")) start++;
  while (end > start && chars.includes(value[end - 1] ?? "")) end--;
  return value.slice(start, end);
}

export class BardsAiDecoder {
  readonly #tokenizer: Tokenizer;
  readonly #model: Model;
  readonly #labels: readonly string[];
  readonly #types: readonly string[];
  readonly #columns: readonly number[];
  readonly #isBeginning: readonly boolean[];
  readonly #idToToken: readonly string[];
  readonly #bos: number;
  readonly #eos: number;

  constructor({
    tokenizer,
    model,
  }: Readonly<{ tokenizer: Tokenizer; model: Model }>) {
    this.#tokenizer = tokenizer;
    this.#model = model;
    const id2label = model.config.id2label;
    this.#labels = Object.keys(id2label)
      .map(Number)
      .sort((a, b) => a - b)
      .map((key) => id2label[key]);
    this.#types = [
      ...new Set(
        this.#labels
          .filter((label) => label !== "O")
          .map((label) => label.split("-").slice(1).join("-")),
      ),
    ].sort();
    const typeIndex = Object.fromEntries(
      this.#types.map((type, index) => [type, index]),
    );
    this.#columns = this.#labels.map((label) =>
      label === "O"
        ? this.#types.length
        : typeIndex[label.split("-").slice(1).join("-")],
    );
    this.#isBeginning = this.#labels.map(
      (label) => label.startsWith("B-") || label.startsWith("S-"),
    );
    const vocab = tokenizer.get_vocab();
    const entries = vocab instanceof Map ? [...vocab] : Object.entries(vocab);
    const idToToken: string[] = [];
    for (const [token, id] of entries) idToToken[id] = token;
    this.#idToToken = idToToken;
    const tokenToId = new Map(entries);
    const bos = tokenToId.get("<bos>"),
      eos = tokenToId.get("<eos>");
    if (bos === undefined || eos === undefined)
      throw new Error("Invalid tokenizer special tokens");
    this.#bos = bos;
    this.#eos = eos;
  }

  async #charProbabilities(text: string) {
    const ids = this.#tokenizer.encode(text, { add_special_tokens: false });
    const offsets = tokenOffsets(
      text,
      ids.map((id) => this.#idToToken[id] ?? ""),
    );
    const width = this.#types.length + 1,
      labelCount = this.#labels.length;
    const accumulated = new Float64Array(text.length * width),
      count = new Float64Array(text.length),
      beginningMass = new Float64Array(text.length);
    const body = 510,
      step = 382;
    for (let start = 0; ; start += step) {
      const chunk = ids.slice(start, start + body);
      const input = [this.#bos, ...chunk, this.#eos].map(BigInt);
      const shape = [1, input.length];
      const output = await this.#model({
        input_ids: new Tensor("int64", BigInt64Array.from(input), shape),
        attention_mask: new Tensor(
          "int64",
          new BigInt64Array(input.length).fill(1n),
          shape,
        ),
      });
      const logits = output.logits.data;
      if (logits.length !== input.length * labelCount)
        throw new Error("Invalid model logits");
      for (let index = 0; index < logits.length; index++)
        if (!Number.isFinite(logits[index]))
          throw new Error("Invalid model logits");
      for (let index = 0; index < chunk.length; index++) {
        const offset = offsets[start + index];
        let spanStart = offset[0];
        const spanEnd = offset[1];
        if (spanEnd <= spanStart) continue;
        while (spanStart < spanEnd - 1 && isSpace(text[spanStart] ?? ""))
          spanStart++;
        const row = (index + 1) * labelCount;
        let maximum = -Infinity;
        for (let column = 0; column < labelCount; column++)
          maximum = Math.max(maximum, logits[row + column]);
        const probabilities = new Float64Array(labelCount);
        let denominator = 0;
        for (let column = 0; column < labelCount; column++) {
          probabilities[column] = Math.exp(logits[row + column] - maximum);
          denominator += probabilities[column];
        }
        let beginning = 0;
        for (let column = 0; column < labelCount; column++) {
          const probability = probabilities[column] / denominator;
          accumulated[spanStart * width + this.#columns[column]] += probability;
          if (this.#isBeginning[column]) beginning += probability;
        }
        count[spanStart] += 1;
        beginningMass[spanStart] += beginning;
      }
      if (start + body >= ids.length) break;
    }
    return { accumulated, count, beginningMass, width };
  }

  async #wordSpans(text: string): Promise<[number, number, string][]> {
    const { accumulated, count, beginningMass, width } =
      await this.#charProbabilities(text);
    const spans: [number, number, string][] = [];
    for (const match of text.matchAll(WORD)) {
      let start = match.index,
        end = match.index + match[0].length;
      while (start < end && "([{<\"'«„".includes(text[start] ?? "")) start++;
      while (end > start && ")]}>\"'».,;:!?".includes(text[end - 1] ?? ""))
        end--;
      if (end <= start) continue;
      const totals = new Float64Array(width);
      let observations = 0,
        first = -1;
      for (let index = start; index < end; index++) {
        if ((count[index] ?? 0) <= 0) continue;
        if (first < 0) first = index;
        for (let column = 0; column < width; column++)
          totals[column] += accumulated[index * width + column];
        observations += count[index];
      }
      if (first < 0) continue;
      let winner = 0;
      for (let column = 1; column < width; column++)
        if (totals[column] / observations > totals[winner] / observations)
          winner = column;
      if (winner === this.#types.length) continue;
      const beginning = beginningMass[first] / Math.max(count[first], 1);
      const type = this.#types[winner],
        previous = spans.at(-1);
      if (
        previous &&
        previous[2] === type &&
        stripped(text.slice(previous[1], start), " ,-/.()") === "" &&
        !text.slice(previous[1], start).includes("\n\n") &&
        beginning < 0.5
      )
        previous[1] = end;
      else spans.push([start, end, type]);
    }
    return spans;
  }

  async predict(text: string): Promise<readonly DecoderEntity[]> {
    if (!text.trim()) return [];
    let spans = (await this.#wordSpans(text)).filter((span) =>
      valid(text, ...span),
    );
    const emails = [...text.matchAll(EMAIL)].map(
      (match): Offset => [match.index, match.index + match[0].length],
    );
    if (emails.length)
      spans = spans
        .filter(
          (span) =>
            !emails.some(([start, end]) => span[0] < end && start < span[1]),
        )
        .concat(emails.map(([start, end]) => [start, end, "EMAIL_ADDRESS"]));
    spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return spans.map(([start, end, label]) => ({
      start,
      end,
      label,
      text: text.slice(start, end),
    }));
  }
}
