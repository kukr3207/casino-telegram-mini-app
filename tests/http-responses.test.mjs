import assert from "node:assert/strict";
import test from "node:test";

import {
  jsonError,
  jsonResponse,
  jsonSuccess,
  readJsonObject,
} from "../lib/http/responses.ts";

test("jsonResponse sets JSON and no-store headers", async () => {
  const response = jsonResponse({ value: 3 }, 202);
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { value: 3 });
});

test("success and error responses have stable envelopes", async () => {
  assert.deepEqual(await jsonSuccess({ balance: 10 }).json(), {
    success: true,
    balance: 10,
  });
  const failure = jsonError("User not found", 404, "user_not_found");
  assert.equal(failure.status, 404);
  assert.deepEqual(await failure.json(), {
    error: "User not found",
    code: "user_not_found",
  });
});

test("readJsonObject accepts objects and rejects arrays or malformed JSON", async () => {
  const request = new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ chatId: 123 }),
  });
  assert.deepEqual(await readJsonObject(request), { chatId: 123 });

  const arrayRequest = new Request("https://example.test", {
    method: "POST",
    body: "[]",
  });
  await assert.rejects(() => readJsonObject(arrayRequest), /JSON object/);

  const invalidRequest = new Request("https://example.test", {
    method: "POST",
    body: "not-json",
  });
  await assert.rejects(() => readJsonObject(invalidRequest), /valid JSON/);
});

