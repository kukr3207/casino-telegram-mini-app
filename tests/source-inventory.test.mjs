import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inventory } from "../scripts/source-inventory.mjs";

test("inventory counts first-party source and ignores dependencies", async () => {
  const root = await mkdtemp(join(tmpdir(), "casino-source-"));
  await mkdir(join(root, "lib"), { recursive: true });
  await mkdir(join(root, "node_modules", "package"), { recursive: true });
  await writeFile(join(root, "lib", "feature.ts"), "// note\n\nexport const value = 1;\n");
  await writeFile(join(root, "node_modules", "package", "index.js"), "ignored();\n");
  const result = await inventory(root);
  assert.equal(result.files.length, 1);
  assert.equal(result.physical, 3);
  assert.equal(result.substantive, 1);
  assert.equal(result.comments, 1);
  assert.equal(result.blank, 1);
});

test("inventory recognizes TypeScript JSX and CSS separately", async () => {
  const root = await mkdtemp(join(tmpdir(), "casino-source-"));
  await writeFile(join(root, "view.tsx"), "export const View = () => <main />;\n");
  await writeFile(join(root, "view.css"), ".view { color: red; }\n");
  const result = await inventory(root);
  assert.deepEqual(result.files.map((file) => file.language).sort(), ["CSS", "TypeScript JSX"]);
});
