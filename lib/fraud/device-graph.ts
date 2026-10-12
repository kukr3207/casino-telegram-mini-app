import { createHash } from "node:crypto";

export interface DeviceObservation {
  playerId: string;
  deviceId: string;
  ipAddress: string;
  userAgent: string;
  paymentFingerprint?: string;
  observedAt: Date;
}

export interface PlayerConnection {
  playerId: string;
  score: number;
  reasons: readonly string[];
  lastObservedAt: Date;
}

export class FraudValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FraudValidationError";
  }
}

export class DeviceGraph {
  private readonly observations: DeviceObservation[] = [];

  observe(input: DeviceObservation): DeviceObservation {
    const observation = normalizeObservation(input);
    const fingerprint = observationKey(observation);
    const existing = this.observations.find((item) => observationKey(item) === fingerprint);
    if (existing) return cloneObservation(existing);
    this.observations.push(observation);
    return cloneObservation(observation);
  }

  connections(playerId: string, since?: Date): readonly PlayerConnection[] {
    const own = this.observations.filter((item) => item.playerId === playerId && (!since || item.observedAt >= since));
    const others = new Map<string, { score: number; reasons: Set<string>; last: Date }>();
    for (const observation of own) {
      for (const candidate of this.observations) {
        if (candidate.playerId === playerId || (since && candidate.observedAt < since)) continue;
        const reasons: Array<[string, number]> = [];
        if (candidate.deviceId === observation.deviceId) reasons.push(["shared_device", 60]);
        if (candidate.ipAddress === observation.ipAddress) reasons.push(["shared_ip", 15]);
        if (candidate.paymentFingerprint && candidate.paymentFingerprint === observation.paymentFingerprint) {
          reasons.push(["shared_payment_method", 80]);
        }
        if (candidate.userAgent === observation.userAgent && candidate.ipAddress === observation.ipAddress) {
          reasons.push(["matching_browser", 20]);
        }
        if (reasons.length === 0) continue;
        const entry = others.get(candidate.playerId) ?? { score: 0, reasons: new Set<string>(), last: candidate.observedAt };
        for (const [reason, value] of reasons) {
          if (!entry.reasons.has(reason)) entry.score += value;
          entry.reasons.add(reason);
        }
        if (candidate.observedAt > entry.last) entry.last = candidate.observedAt;
        others.set(candidate.playerId, entry);
      }
    }
    return [...others.entries()]
      .map(([connectedPlayerId, value]) => ({
        playerId: connectedPlayerId,
        score: Math.min(100, value.score),
        reasons: [...value.reasons].sort(),
        lastObservedAt: new Date(value.last),
      }))
      .sort((left, right) => right.score - left.score || left.playerId.localeCompare(right.playerId));
  }

  devicesForPlayer(playerId: string): readonly string[] {
    return [...new Set(this.observations.filter((item) => item.playerId === playerId).map((item) => item.deviceId))].sort();
  }

  playersForDevice(deviceId: string): readonly string[] {
    return [...new Set(this.observations.filter((item) => item.deviceId === deviceId).map((item) => item.playerId))].sort();
  }
}

function normalizeObservation(input: DeviceObservation): DeviceObservation {
  const observedAt = new Date(input.observedAt);
  if (!Number.isFinite(observedAt.getTime())) throw new FraudValidationError("observation time is invalid");
  return {
    playerId: required(input.playerId, "player id"),
    deviceId: required(input.deviceId, "device id"),
    ipAddress: required(input.ipAddress, "IP address"),
    userAgent: required(input.userAgent, "user agent"),
    paymentFingerprint: input.paymentFingerprint?.trim() || undefined,
    observedAt,
  };
}

function observationKey(input: DeviceObservation): string {
  return createHash("sha256").update([
    input.playerId,
    input.deviceId,
    input.ipAddress,
    input.userAgent,
    input.paymentFingerprint ?? "",
    input.observedAt.toISOString(),
  ].join("\0")).digest("hex");
}

function required(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new FraudValidationError(`${field} is required`);
  return value.trim();
}

function cloneObservation(input: DeviceObservation): DeviceObservation {
  return { ...input, observedAt: new Date(input.observedAt) };
}

