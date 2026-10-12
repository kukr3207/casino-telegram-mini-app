import { createHash } from "node:crypto";

import type { PartnerRegistry } from "./partners.ts";
import {
  type AttributionTouch,
  type PlayerAttribution,
  CrmConflictError,
  CrmValidationError,
  crmDate,
  crmText,
} from "./types.ts";

export interface AttributionPolicy {
  windowDays: number;
  model: "first_touch" | "last_touch" | "registration_touch";
  lockAfterFirstDeposit: boolean;
  allowedChannels: readonly string[];
  blockedReferrers: readonly string[];
}

export class AttributionService {
  readonly #touches = new Map<string, AttributionTouch>();
  readonly #byAnonymous = new Map<string, string[]>();
  readonly #byPlayer = new Map<string, string[]>();
  readonly #attributions = new Map<string, PlayerAttribution>();
  readonly partners: PartnerRegistry;
  readonly policy: AttributionPolicy;

  constructor(
    partners: PartnerRegistry,
    policy: AttributionPolicy,
  ) {
    if (!Number.isSafeInteger(policy.windowDays) || policy.windowDays < 1 || policy.windowDays > 365) throw new CrmValidationError("attribution window is invalid");
    this.partners = partners;
    this.policy = { ...policy, allowedChannels: [...policy.allowedChannels], blockedReferrers: [...policy.blockedReferrers] };
  }

  record(value: AttributionTouch): AttributionTouch {
    const touch = validateTouch(value, this.policy);
    const campaign = this.partners.campaign(touch.campaignId);
    if (!campaign || campaign.partnerId !== touch.partnerId || !campaign.enabled) throw new CrmConflictError("attribution campaign is not active");
    const existing = this.#touches.get(touch.id);
    if (existing) {
      if (touchFingerprint(existing) !== touchFingerprint(touch)) throw new CrmConflictError("attribution touch id contains different data");
      return cloneTouch(existing);
    }
    this.#touches.set(touch.id, touch);
    index(this.#byAnonymous, touch.anonymousId, touch.id);
    if (touch.playerId) index(this.#byPlayer, touch.playerId, touch.id);
    return cloneTouch(touch);
  }

  identify(anonymousId: string, playerId: string, at = new Date()): PlayerAttribution | null {
    const anonymous = crmText(anonymousId, "anonymous id"); const player = crmText(playerId, "player id");
    const existing = this.#attributions.get(player); if (existing?.locked) return cloneAttribution(existing);
    for (const touchId of this.#byAnonymous.get(anonymous) ?? []) {
      const touch = this.#touches.get(touchId)!;
      if (!touch.playerId) { const changed = { ...touch, playerId: player }; this.#touches.set(touch.id, changed); index(this.#byPlayer, player, touch.id); }
    }
    const eligible = this.eligibleTouches(player, at); if (!eligible.length) return null;
    const first = eligible[0]; const last = eligible.at(-1)!;
    const selected = this.policy.model === "first_touch" ? first : this.policy.model === "registration_touch" ? eligible.find((touch) => touch.kind === "registration") ?? last : last;
    const attribution: PlayerAttribution = { playerId: player, partnerId: selected.partnerId, campaignId: selected.campaignId, firstTouchId: first.id, lastTouchId: last.id, attributedAt: at.toISOString(), expiresAt: new Date(at.getTime() + this.policy.windowDays * 86_400_000).toISOString(), locked: existing?.locked ?? false, version: (existing?.version ?? 0) + 1 };
    this.#attributions.set(player, attribution); return cloneAttribution(attribution);
  }

  lock(playerId: string, depositTouch: AttributionTouch): PlayerAttribution | null {
    this.record(depositTouch);
    let current = this.#attributions.get(playerId) ?? this.identify(depositTouch.anonymousId, playerId, new Date(depositTouch.occurredAt));
    if (!current) return null;
    if (!this.policy.lockAfterFirstDeposit) return current;
    if (!current.locked) { current = { ...current, locked: true, version: current.version + 1 }; this.#attributions.set(playerId, current); }
    return cloneAttribution(current);
  }

  attribution(playerId: string, at = new Date()): PlayerAttribution | undefined {
    const value = this.#attributions.get(playerId.trim()); if (!value || (!value.locked && at >= new Date(value.expiresAt))) return undefined; return cloneAttribution(value);
  }

  touches(playerId: string): readonly AttributionTouch[] { return (this.#byPlayer.get(playerId.trim()) ?? []).map((id) => this.#touches.get(id)!).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map(cloneTouch); }

  private eligibleTouches(playerId: string, at: Date): AttributionTouch[] {
    const earliest = new Date(at.getTime() - this.policy.windowDays * 86_400_000);
    return this.touches(playerId).filter((touch) => new Date(touch.occurredAt) >= earliest && new Date(touch.occurredAt) <= at);
  }
}

function validateTouch(value: AttributionTouch, policy: AttributionPolicy): AttributionTouch { const channel = crmText(value.channel, "attribution channel").toLocaleLowerCase(); if (!policy.allowedChannels.includes(channel)) throw new CrmValidationError("attribution channel is not allowed"); if (value.referrer && policy.blockedReferrers.some((blocked) => value.referrer!.includes(blocked))) throw new CrmConflictError("attribution referrer is blocked"); return { ...value, id: crmText(value.id, "touch id"), anonymousId: crmText(value.anonymousId, "anonymous id"), playerId: value.playerId?.trim() || undefined, campaignId: crmText(value.campaignId, "campaign id"), partnerId: crmText(value.partnerId, "partner id"), channel, country: value.country?.toUpperCase(), occurredAt: crmDate(value.occurredAt, "touch time").toISOString(), metadata: { ...value.metadata } }; }
function touchFingerprint(value: AttributionTouch): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function index(target: Map<string, string[]>, key: string, id: string): void { const items = target.get(key) ?? []; if (!items.includes(id)) items.push(id); target.set(key, items); }
function cloneTouch(value: AttributionTouch): AttributionTouch { return { ...value, metadata: { ...value.metadata } }; }
function cloneAttribution(value: PlayerAttribution): PlayerAttribution { return { ...value }; }
