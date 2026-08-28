import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { checkAmberIn } from "../src/lib/amberCheck";

const corpus = join(__dirname, "corpus");
const expected = JSON.parse(readFileSync(join(__dirname, "oracle/expected.json"), "utf8"));

describe("checkAmberIn matches the Python oracle", () => {
  const files = readdirSync(corpus).filter(f => f.endsWith(".in")).sort();
  it("corpus and oracle cover the same files", () => {
    expect(files).toEqual(Object.keys(expected).sort());
  });
  for (const f of files) {
    it(f, () => {
      const got = checkAmberIn(readFileSync(join(corpus, f), "utf8")).findings;
      expect(got).toEqual(expected[f]);
    });
  }
});
