const DAY_MS = 24 * 60 * 60 * 1_000;
export const MAX_DAILY_STREAK = 15;

export interface DailyCheckInAward {
  date: string;
  streak: number;
  reward: number;
}

export function utcDateKey(value: Date = new Date()): string {
  if (Number.isNaN(value.getTime())) {
    throw new RangeError("A valid date is required");
  }
  return value.toISOString().slice(0, 10);
}

function previousUtcDateKey(value: Date): string {
  return utcDateKey(new Date(value.getTime() - DAY_MS));
}

/**
 * Calculate a daily reward exclusively from stored server state. Client-sent
 * dates, streaks, and rewards are intentionally unnecessary and untrusted.
 */
export function nextDailyCheckIn(
  user: Record<string, unknown>,
  now: Date = new Date(),
): DailyCheckInAward {
  const date = utcDateKey(now);
  const previousDate = String(user.dailyCheckinDate || "");
  if (previousDate === date) {
    throw new RangeError("Already checked in today");
  }

  const previousStreak = Number(user.dailyCheckinStreak) || 0;
  const continued = previousDate === previousUtcDateKey(now);
  let streak = continued ? previousStreak + 1 : 1;
  if (streak > MAX_DAILY_STREAK) streak = 1;

  return {
    date,
    streak,
    reward: 5 + streak * 5,
  };
}

export function startOfUtcDay(value: Date = new Date()): Date {
  return new Date(`${utcDateKey(value)}T00:00:00.000Z`);
}

export function endOfUtcDay(value: Date = new Date()): Date {
  return new Date(`${utcDateKey(value)}T23:59:59.999Z`);
}

