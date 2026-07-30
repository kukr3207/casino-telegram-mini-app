import assert from "node:assert/strict";
import test from "node:test";

import {
  chatIdCandidates,
  chatIdFilter,
  InvalidChatIdError,
  parseChatId,
} from "../lib/validation/chat-id.ts";

test("parseChatId normalizes safe integer strings", () => {
  assert.equal(parseChatId(" 123456 "), 123456);
  assert.equal(parseChatId(-98765), -98765);
});

test("parseChatId preserves integers beyond the safe numeric range", () => {
  assert.equal(parseChatId("90071992547409930"), "90071992547409930");
});

test("parseChatId rejects absent, fractional, and zero identifiers", () => {
  for (const invalid of [null, undefined, "", "12.5", 12.5, 0, "0", "user-1"]) {
    assert.throws(() => parseChatId(invalid), InvalidChatIdError);
  }
});

test("chatIdCandidates supports historical numeric and string records", () => {
  assert.deepEqual(chatIdCandidates("123456"), [123456, "123456"]);
  assert.deepEqual(chatIdCandidates(123456), [123456, "123456"]);
  assert.deepEqual(chatIdFilter("123456"), {
    chatId: { $in: [123456, "123456"] },
  });
});

