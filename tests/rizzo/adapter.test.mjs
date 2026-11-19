import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as api from "../../poc-rizzo/dist/adapters/transformersAdapter.js";
import { tokenizerJSON } from "./support/legacy-startup.mjs";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { sandbox, child } from "./support/sandbox.mjs";
import { modelDetectionServiceBuilder } from "../../poc-rizzo/dist/services/modelDetectionService.js";

test("explicit initialization failure never retries implicitly", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "rizzo-C-adapter-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "manifest.json"), '{"files":{}}');
  await writeFile(join(dir, "config.json"), '{"max_position_embeddings":2}');
  await writeFile(join(dir, "tokenizer.json"), tokenizerJSON);
  const failure = Error("synthetic");
  let loads = 0;
  await assert.rejects(
    api.transformersAdapterBuilder({
      directory: pathToFileURL(dir + "/"),
      manifestPath: pathToFileURL(join(dir, "manifest.json")),
      loadModel: async () => {
        loads++;
        throw failure;
      },
    }),
    (error) => error === failure,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loads, 1);
});

test("ready adapters hash artifacts before loader and use real tokenizer pipeline and Tensor at config limit", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "rizzo-C-success-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const require = createRequire(
    new URL("../../poc-rizzo/package.json", import.meta.url),
  );
  const { Tensor, env } = await import(
    new URL(
      "transformers.node.mjs",
      pathToFileURL(require.resolve("@huggingface/transformers")),
    )
  );
  const config = {
    max_position_embeddings: 2,
    id2label: { 0: "O", 1: "B-FULLNAME" },
  };
  const files = {
    "config.json": JSON.stringify(config),
    "tokenizer.json": tokenizerJSON,
    "model.onnx": "synthetic, never an ONNX session",
  };
  const manifest = { files: {} };
  for (const [name, bytes] of Object.entries(files)) {
    await writeFile(join(dir, name), bytes);
    manifest.files[name] = createHash("sha256").update(bytes).digest("hex");
  }
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest));
  let loads = 0,
    alternate = 0;
  const inputs = [];
  const options = {
    directory: pathToFileURL(dir + "/"),
    manifestPath: pathToFileURL(join(dir, "manifest.json")),
    loadModel: async (path, options) => {
      loads++;
      assert.equal(path, dir + "/");
      assert.equal(env.allowRemoteModels, false);
      assert.deepEqual(options, {
        dtype: "fp32",
        device: "cpu",
        subfolder: "",
        local_files_only: true,
        session_options: {
          intraOpNumThreads: 1,
          interOpNumThreads: 1,
        },
      });
      // All original hashes must have been consumed before this loader can tamper them.
      await writeFile(join(dir, "model.onnx"), "post-hash synthetic mutation");
      await new Promise((resolve) => setImmediate(resolve));
      return Object.assign(
        async (input) => {
          const ids = Array.from(input.input_ids.data, Number);
          inputs.push(ids);
          return {
            logits: new Tensor(
              "float32",
              Float32Array.from(ids.flatMap(() => [0, 10])),
              [1, ids.length, 2],
            ),
          };
        },
        { config },
      );
    },
  };
  const { infer } = await api.transformersAdapterBuilder(options);
  const model = modelDetectionServiceBuilder({ infer });
  assert.deepEqual([...(await model("Ada Ada"))], ["PERSON"]);
  await assert.rejects(model("Ada Ada Ada"), /TOKEN_LIMIT/);
  assert.deepEqual(inputs, [[1, 1]]);
  assert.equal(loads, 1);
  assert.equal(alternate, 0);
  // A separate instance cannot reuse a successful predecessor's cache or skip its hashes.
  await assert.rejects(
    api.transformersAdapterBuilder(options),
    /MODEL_INTEGRITY_FAILURE/,
  );
  assert.equal(loads, 1);
  await writeFile(join(dir, "model.onnx"), files["model.onnx"]);
  const another = await api.transformersAdapterBuilder(options);
  assert.notEqual(another.infer, infer);
  assert.equal(loads, 2);
});

test("importing libraries may resolve the static SDK but performs no model IO, fetch or socket creation", async (t) => {
  const { pkg, cwd } = await sandbox(t);
  const paths = (await readdir(join(pkg, "dist"), { recursive: true }))
    .filter((p) => p.endsWith(".js"))
    .sort()
    .map((p) => pathToFileURL(join(pkg, "dist", p)).href);
  const code = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs'; import promises from 'node:fs/promises';
    import http from 'node:http'; import https from 'node:https'; import net from 'node:net';
    import { registerHooks, syncBuiltinESMExports } from 'node:module';
    const calls = [];

    for (const owner of [fs, promises]) for (const name of ['readFile', 'readFileSync', 'open', 'openSync', 'stat', 'statSync', 'access', 'createReadStream']) if (typeof owner[name] === 'function') { const original = owner[name]; owner[name] = function(path, ...args) { if (/models\\/|model-manifest/.test(String(path))) { calls.push('model IO'); throw Error('FORBIDDEN_MODEL_IO'); } return original.call(this, path, ...args); }; }
    for (const owner of [http, https]) { owner.createServer = () => { calls.push('server'); throw Error('FORBIDDEN_SERVER'); }; owner.request = () => { calls.push('request'); throw Error('FORBIDDEN_REQUEST'); }; }
    net.Socket.prototype.connect = () => { calls.push('socket'); throw Error('FORBIDDEN_SOCKET'); };
    net.Server.prototype.listen = () => { calls.push('listen'); throw Error('FORBIDDEN_LISTEN'); };
    globalThis.fetch = () => { calls.push('fetch'); throw Error('FORBIDDEN_FETCH'); }; syncBuiltinESMExports();
    for (const path of ${JSON.stringify(paths.filter((path) => !path.endsWith("/index.js")))}) await import(path);
    const { transformersAdapterBuilder } = await import(${JSON.stringify(pathToFileURL(join(pkg, "dist/adapters/transformersAdapter.js")).href)});
    assert.equal(typeof transformersAdapterBuilder, 'function');
    assert.deepEqual(calls, []); console.log('TRANSITIVE_IMPORT_SAFE');
  `;
  const result = child(code, cwd);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(result.stdout, "TRANSITIVE_IMPORT_SAFE\n");
});
