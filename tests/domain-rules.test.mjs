import assert from "node:assert/strict";
import test from "node:test";

import {
  addCasinoChips,
  convertWithdrawTokens,
  readTokenBalances,
  requirePositiveTokenAmount,
} from "../lib/domain/token-balances.ts";
import {
  endOfUtcDay,
  nextDailyCheckIn,
  startOfUtcDay,
  utcDateKey,
} from "../lib/domain/daily-rewards.ts";

test("readTokenBalances normalizes missing and malformed stored values", () => {
  assert.deepEqual(
    readTokenBalances({ casino_chips: "12", withdraw_tokens: -5, hol_tokens: 4.9 }),
    { casino_chips: 12, withdraw_tokens: 0, hol_tokens: 4 },
  );
  assert.deepEqual(readTokenBalances(undefined), {
    casino_chips: 0,
    withdraw_tokens: 0,
    hol_tokens: 0,
  });
});

test("positive token amounts must be safe whole numbers", () => {
  assert.equal(requirePositiveTokenAmount("25"), 25);
  for (const invalid of [0, -1, 1.5, "chips", Number.POSITIVE_INFINITY]) {
    assert.throws(() => requirePositiveTokenAmount(invalid), RangeError);
  }
});

test("addCasinoChips returns a new balance without mutating the old one", () => {
  const before = { casino_chips: 10, withdraw_tokens: 3, hol_tokens: 2 };
  const after = addCasinoChips(before, 15);
  assert.deepEqual(after, { casino_chips: 25, withdraw_tokens: 3, hol_tokens: 2 });
  assert.equal(before.casino_chips, 10);
});

test("convertWithdrawTokens moves the selected floor percentage", () => {
  const before = { casino_chips: 10, withdraw_tokens: 7, hol_tokens: 2 };
  const conversion = convertWithdrawTokens(before, 50);
  assert.equal(conversion.converted, 3);
  assert.deepEqual(conversion.balances, {
    casino_chips: 13,
    withdraw_tokens: 4,
    hol_tokens: 2,
  });
});

test("convertWithdrawTokens rejects invalid or ineffective percentages", () => {
  const balances = { casino_chips: 10, withdraw_tokens: 0, hol_tokens: 2 };
  for (const invalid of [0, -10, 101, "none"]) {
    assert.throws(() => convertWithdrawTokens(balances, invalid), RangeError);
  }
  assert.throws(() => convertWithdrawTokens(balances, 50), /Insufficient/);
});

test("first daily check-in begins a streak and awards ten chips", () => {
  const now = new Date("2026-07-30T18:30:00.000Z");
  assert.deepEqual(nextDailyCheckIn({}, now), {
    date: "2026-07-30",
    streak: 1,
    reward: 10,
  });
});

test("consecutive UTC dates continue the stored streak", () => {
  const user = { dailyCheckinDate: "2026-07-29", dailyCheckinStreak: 6 };
  assert.deepEqual(nextDailyCheckIn(user, new Date("2026-07-30T00:00:00Z")), {
    date: "2026-07-30",
    streak: 7,
    reward: 40,
  });
});

test("a missed date resets the streak and duplicate claims are rejected", () => {
  const now = new Date("2026-07-30T12:00:00Z");
  assert.equal(nextDailyCheckIn({ dailyCheckinDate: "2026-07-20" }, now).streak, 1);
  assert.throws(
    () => nextDailyCheckIn({ dailyCheckinDate: "2026-07-30" }, now),
    /Already checked in/,
  );
});

test("UTC date helpers produce exact day boundaries", () => {
  const value = new Date("2026-07-30T23:59:59.123Z");
  assert.equal(utcDateKey(value), "2026-07-30");
  assert.equal(startOfUtcDay(value).toISOString(), "2026-07-30T00:00:00.000Z");
  assert.equal(endOfUtcDay(value).toISOString(), "2026-07-30T23:59:59.999Z");
});

