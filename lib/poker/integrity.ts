import { createHash } from "node:crypto";

import type { PokerAction, PokerHand } from "./types.ts";

export interface PlayerObservation {
  playerId: string;
  tableId: string;
  handId: string;
  deviceId?: string;
  ipAddress?: string;
  geohash?: string;
  actionDelayMs: number;
  action: PokerAction["action"];
  amountMinor: bigint;
  potBeforeMinor: bigint;
  occurredAt: string;
}

export interface IntegrityFinding {
  id: string;
  kind:
    | "shared_device"
    | "shared_network"
    | "coordinated_timing"
    | "chip_dumping"
    | "soft_play"
    | "impossible_location";
  severity: "low" | "medium" | "high" | "critical";
  playerIds: readonly string[];
  tableIds: readonly string[];
  handIds: readonly string[];
  score: number;
  reasons: readonly string[];
  observedAt: string;
}

export class PokerIntegrityMonitor {
  readonly #observations: PlayerObservation[] = [];
  readonly #findings = new Map<string, IntegrityFinding>();

  record(value: PlayerObservation): void {
    if (!value.playerId.trim() || !value.tableId.trim() || !value.handId.trim())
      throw new RangeError("observation identifiers are required");
    if (!Number.isSafeInteger(value.actionDelayMs) || value.actionDelayMs < 0)
      throw new RangeError("action delay is invalid");
    if (value.amountMinor < 0n || value.potBeforeMinor < 0n)
      throw new RangeError("observation amounts are invalid");
    const at = new Date(value.occurredAt);
    if (!Number.isFinite(at.getTime()))
      throw new RangeError("observation time is invalid");
    this.#observations.push({ ...value, occurredAt: at.toISOString() });
  }

  analyze(windowStart: Date, windowEnd: Date): readonly IntegrityFinding[] {
    if (windowEnd <= windowStart)
      throw new RangeError("analysis window is invalid");
    const observations = this.#observations.filter((value) => {
      const at = new Date(value.occurredAt);
      return at >= windowStart && at < windowEnd;
    });
    const findings = [
      ...this.sharedIdentityFindings(observations, "deviceId", "shared_device"),
      ...this.sharedIdentityFindings(
        observations,
        "ipAddress",
        "shared_network",
      ),
      ...this.timingFindings(observations),
      ...this.chipDumpingFindings(observations),
    ];
    for (const finding of findings) this.#findings.set(finding.id, finding);
    return findings.map(cloneFinding);
  }

  findingsForPlayer(playerId: string): readonly IntegrityFinding[] {
    return [...this.#findings.values()]
      .filter((finding) => finding.playerIds.includes(playerId))
      .sort((left, right) => right.observedAt.localeCompare(left.observedAt))
      .map(cloneFinding);
  }

  handFingerprint(hand: PokerHand): string {
    return createHash("sha256")
      .update(
        JSON.stringify({
          id: hand.id,
          tableId: hand.tableId,
          handNumber: hand.handNumber,
          actions: hand.actions.map((action) => ({
            playerId: action.playerId,
            action: action.action,
            amountMinor: action.amountMinor.toString(),
            sequence: action.sequence,
          })),
          commitments: Object.fromEntries(
            Object.entries(hand.commitments).map(([id, amount]) => [
              id,
              amount.toString(),
            ]),
          ),
        }),
      )
      .digest("hex");
  }

  private sharedIdentityFindings(
    observations: readonly PlayerObservation[],
    field: "deviceId" | "ipAddress",
    kind: IntegrityFinding["kind"],
  ): IntegrityFinding[] {
    const groups = new Map<string, PlayerObservation[]>();
    for (const observation of observations) {
      const value = observation[field];
      if (!value) continue;
      const group = groups.get(value) ?? [];
      group.push(observation);
      groups.set(value, group);
    }
    return [...groups.entries()].flatMap(([value, group]) => {
      const players = [...new Set(group.map((item) => item.playerId))].sort();
      const tables = [...new Set(group.map((item) => item.tableId))].sort();
      if (players.length < 2 || tables.length === 0) return [];
      const sameHands =
        new Set(group.map((item) => item.handId)).size < group.length;
      const score = Math.min(
        100,
        30 + players.length * 10 + (sameHands ? 30 : 0),
      );
      return [
        makeFinding(kind, players, group, score, [
          `${field} ${value} was shared`,
          sameHands
            ? "players appeared in the same hand"
            : "players appeared at separate times",
        ]),
      ];
    });
  }

  private timingFindings(
    observations: readonly PlayerObservation[],
  ): IntegrityFinding[] {
    const byHand = groupBy(observations, (value) => value.handId);
    const findings: IntegrityFinding[] = [];
    for (const group of byHand.values()) {
      const players = [...new Set(group.map((item) => item.playerId))];
      if (players.length < 2 || group.length < 6) continue;
      const fast = group.filter((item) => item.actionDelayMs < 250);
      if (fast.length / group.length < 0.8) continue;
      findings.push(
        makeFinding("coordinated_timing", players, group, 70, [
          "more than 80 percent of actions occurred within 250 ms",
        ]),
      );
    }
    return findings;
  }

  private chipDumpingFindings(
    observations: readonly PlayerObservation[],
  ): IntegrityFinding[] {
    const byHand = groupBy(observations, (value) => value.handId);
    const findings: IntegrityFinding[] = [];
    for (const group of byHand.values()) {
      const largest = [...group].sort((left, right) =>
        left.amountMinor === right.amountMinor
          ? 0
          : left.amountMinor > right.amountMinor
            ? -1
            : 1,
      )[0];
      if (!largest || largest.potBeforeMinor === 0n) continue;
      const ratio = Number(
        (largest.amountMinor * 10_000n) / largest.potBeforeMinor,
      );
      if (
        ratio < 20_000 ||
        !["bet", "raise", "all_in"].includes(largest.action)
      )
        continue;
      const players = [...new Set(group.map((item) => item.playerId))];
      if (players.length < 2) continue;
      findings.push(
        makeFinding(
          "chip_dumping",
          players,
          group,
          Math.min(100, 50 + Math.floor(ratio / 1_000)),
          [`oversized action was ${ratio / 100}% of the prior pot`],
        ),
      );
    }
    return findings;
  }
}

function makeFinding(
  kind: IntegrityFinding["kind"],
  players: readonly string[],
  observations: readonly PlayerObservation[],
  score: number,
  reasons: readonly string[],
): IntegrityFinding {
  const tableIds = [
    ...new Set(observations.map((item) => item.tableId)),
  ].sort();
  const handIds = [...new Set(observations.map((item) => item.handId))].sort();
  const observedAt = observations
    .map((item) => item.occurredAt)
    .sort()
    .at(-1)!;
  const id = createHash("sha256")
    .update(`${kind}:${players.join(",")}:${handIds.join(",")}`)
    .digest("hex");
  return {
    id,
    kind,
    severity:
      score >= 90
        ? "critical"
        : score >= 70
          ? "high"
          : score >= 40
            ? "medium"
            : "low",
    playerIds: [...players].sort(),
    tableIds,
    handIds,
    score,
    reasons: [...reasons],
    observedAt,
  };
}

function groupBy<T>(
  values: readonly T[],
  key: (value: T) => string,
): Map<string, T[]> {
  const output = new Map<string, T[]>();
  for (const value of values) {
    const itemKey = key(value);
    const group = output.get(itemKey) ?? [];
    group.push(value);
    output.set(itemKey, group);
  }
  return output;
}

function cloneFinding(value: IntegrityFinding): IntegrityFinding {
  return {
    ...value,
    playerIds: [...value.playerIds],
    tableIds: [...value.tableIds],
    handIds: [...value.handIds],
    reasons: [...value.reasons],
  };
}
