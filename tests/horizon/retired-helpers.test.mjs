import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

// These helpers had no production/CLI consumers. Model-covered categories must
// not regain fallback rules through an accidentally retained compiled module.
test("retired rule helpers and decoder are absent from source and clean emit", () => {
  for (const module of [
    "fiscal-code",
    "recognizers/credit-card",
    "recognizers/phone",
    "recognizers/italian-phone",
  ]) {
    for (const [directory, extension] of [
      ["src", "ts"],
      ["dist", "js"],
    ]) {
      assert.equal(
        existsSync(
          new URL(
            `../../poc-horizon/${directory}/${module}.${extension}`,
            import.meta.url,
          ),
        ),
        false,
        `${directory}/${module}`,
      );
    }
  }
});

test("retired direct dependencies and obsolete p-limit admission are absent", () => {
  for (const [engine, retired] of [["horizon", "libphonenumber-js"]]) {
    const read = (file) =>
      JSON.parse(
        readFileSync(
          new URL(`../../poc-${engine}/${file}`, import.meta.url),
          "utf8",
        ),
      );
    const pkg = read("package.json");
    const lock = readFileSync(
      new URL("../../pnpm-lock.yaml", import.meta.url),
      "utf8",
    );
    assert.equal(pkg.dependencies[retired], undefined);
    assert.doesNotMatch(lock, new RegExp(`(?:^|/)${retired}(?:@|:)`, "m"));
    assert.equal(pkg.dependencies["p-limit"], undefined);
    assert.doesNotMatch(lock, /p-limit@6\.2\.0/);
    assert.doesNotMatch(lock, /yocto-queue@1\.2\.2/);
  }
});
