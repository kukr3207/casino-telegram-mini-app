export interface PlayerDailyActivity {
  playerId: string;
  date: string;
  depositsMinor: bigint;
  withdrawalsMinor: bigint;
  wagersMinor: bigint;
  winsMinor: bigint;
  sessionMinutes: number;
  sessions: number;
  lateNightMinutes: number;
  limitChanges: number;
  cancelledWithdrawals: number;
}

export interface RiskIndicator {
  code: string;
  weight: number;
  explanation: string;
}

export interface PlayerRiskTrend {
  playerId: string;
  score: number;
  level: "low" | "moderate" | "high" | "critical";
  indicators: readonly RiskIndicator[];
  evaluatedThrough: string;
}

export function evaluateResponsiblePlayRisk(history: readonly PlayerDailyActivity[]): PlayerRiskTrend {
  if (history.length === 0) throw new Error("responsible-play history is empty");
  const ordered = [...history].sort((left, right) => left.date.localeCompare(right.date));
  const playerId = ordered[0].playerId;
  if (ordered.some((day) => day.playerId !== playerId)) throw new Error("responsible-play history contains multiple players");
  const recent = ordered.slice(-7);
  const prior = ordered.slice(-14, -7);
  const indicators: RiskIndicator[] = [];
  const recentWagers = sumBigInt(recent.map((day) => day.wagersMinor));
  const priorWagers = sumBigInt(prior.map((day) => day.wagersMinor));
  if (priorWagers > 0n && recentWagers >= priorWagers * 2n) {
    indicators.push({ code: "rapid_wager_growth", weight: 25, explanation: "Seven-day wagers at least doubled" });
  }
  const totalMinutes = recent.reduce((sum, day) => sum + day.sessionMinutes, 0);
  if (totalMinutes >= 24 * 60) indicators.push({ code: "extended_play", weight: 20, explanation: "More than 24 hours played in seven days" });
  const lateNightMinutes = recent.reduce((sum, day) => sum + day.lateNightMinutes, 0);
  if (lateNightMinutes >= 6 * 60) indicators.push({ code: "late_night_play", weight: 15, explanation: "Substantial play during late-night hours" });
  const cancelledWithdrawals = recent.reduce((sum, day) => sum + day.cancelledWithdrawals, 0);
  if (cancelledWithdrawals >= 3) indicators.push({ code: "withdrawal_reversal", weight: 20, explanation: "Repeated withdrawal cancellations" });
  const limitChanges = recent.reduce((sum, day) => sum + day.limitChanges, 0);
  if (limitChanges >= 3) indicators.push({ code: "limit_pressure", weight: 15, explanation: "Repeated attempts to change limits" });
  const deposits = sumBigInt(recent.map((day) => day.depositsMinor));
  const netLoss = sumBigInt(recent.map((day) => day.wagersMinor - day.winsMinor));
  if (deposits > 0n && netLoss * 100n >= deposits * 80n) indicators.push({ code: "high_loss_ratio", weight: 25, explanation: "Net losses are high relative to deposits" });
  const score = Math.min(100, indicators.reduce((sum, indicator) => sum + indicator.weight, 0));
  const level = score >= 75 ? "critical" : score >= 50 ? "high" : score >= 25 ? "moderate" : "low";
  return { playerId, score, level, indicators, evaluatedThrough: ordered[ordered.length - 1].date };
}

function sumBigInt(values: readonly bigint[]): bigint {
  return values.reduce((sum, value) => sum + value, 0n);
}

