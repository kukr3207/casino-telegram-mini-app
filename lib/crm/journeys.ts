import { randomUUID } from "node:crypto";

import {
  type JourneyDefinition,
  type JourneyEnrollment,
  type JourneyStep,
  CrmConflictError,
  CrmValidationError,
  crmDate,
  crmText,
} from "./types.ts";

export interface DueJourneyStep {
  enrollmentId: string;
  journeyId: string;
  playerId: string;
  step: JourneyStep;
  dueAt: string;
}

export class JourneyService {
  readonly #journeys = new Map<string, JourneyDefinition>();
  readonly #enrollments = new Map<string, JourneyEnrollment>();
  readonly #activeByPlayerJourney = new Map<string, string>();
  readonly #events = new Set<string>();

  create(value: JourneyDefinition): JourneyDefinition { const journey = validateJourney(value); if (this.#journeys.has(journey.id)) throw new CrmConflictError("journey id already exists"); this.#journeys.set(journey.id, journey); return cloneJourney(journey); }
  update(journeyId: string, expectedVersion: number, changes: Partial<Omit<JourneyDefinition, "id" | "version">>): JourneyDefinition { const current = this.requireJourney(journeyId); if (current.version !== expectedVersion) throw new CrmConflictError("journey version does not match"); const changed = validateJourney({ ...current, ...changes, id: current.id, version: current.version + 1 }); this.#journeys.set(changed.id, changed); return cloneJourney(changed); }

  enroll(journeyId: string, playerId: string, attributes: Readonly<Record<string, string>>, at = new Date()): JourneyEnrollment | null {
    const journey = this.requireJourney(journeyId); if (!journey.enabled || !eligible(journey, attributes)) return null;
    const key = `${journey.id}:${crmText(playerId, "player id")}`; const activeId = this.#activeByPlayerJourney.get(key); if (activeId) { const active = this.#enrollments.get(activeId)!; if (active.status === "active") return cloneEnrollment(active); }
    const first = journey.steps[0]; const enrollment: JourneyEnrollment = { id: randomUUID(), journeyId: journey.id, playerId, status: "active", enrolledAt: at.toISOString(), nextStepIndex: 0, nextRunAt: new Date(at.getTime() + first.delayMinutes * 60_000).toISOString(), completedStepIds: [], version: 1 };
    this.#enrollments.set(enrollment.id, enrollment); this.#activeByPlayerJourney.set(key, enrollment.id); return cloneEnrollment(enrollment);
  }

  due(at = new Date(), limit = 100): readonly DueJourneyStep[] { if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new CrmValidationError("journey due limit is invalid"); return [...this.#enrollments.values()].filter((item) => item.status === "active" && item.nextRunAt && new Date(item.nextRunAt) <= at).sort((a, b) => a.nextRunAt!.localeCompare(b.nextRunAt!)).slice(0, limit).map((enrollment) => ({ enrollmentId: enrollment.id, journeyId: enrollment.journeyId, playerId: enrollment.playerId, step: { ...this.requireJourney(enrollment.journeyId).steps[enrollment.nextStepIndex], stopOnEvents: [...this.requireJourney(enrollment.journeyId).steps[enrollment.nextStepIndex].stopOnEvents] }, dueAt: enrollment.nextRunAt! })); }

  completeStep(enrollmentId: string, expectedVersion: number, stepId: string, at = new Date()): JourneyEnrollment { const item = this.requireEnrollment(enrollmentId); if (item.version !== expectedVersion) throw new CrmConflictError("journey enrollment version does not match"); if (item.status !== "active") return cloneEnrollment(item); const journey = this.requireJourney(item.journeyId); const step = journey.steps[item.nextStepIndex]; if (step.id !== stepId) throw new CrmConflictError("journey step is not next"); const completedStepIds = [...item.completedStepIds, step.id]; const nextIndex = item.nextStepIndex + 1; const completed = nextIndex >= journey.steps.length; const changed = { ...item, status: completed ? "completed" as const : "active" as const, nextStepIndex: nextIndex, nextRunAt: completed ? undefined : new Date(at.getTime() + journey.steps[nextIndex].delayMinutes * 60_000).toISOString(), completedStepIds, version: item.version + 1 }; this.#enrollments.set(changed.id, changed); return cloneEnrollment(changed); }

  recordPlayerEvent(eventId: string, playerId: string, event: string, at = new Date()): readonly JourneyEnrollment[] { const id = crmText(eventId, "event id"); if (this.#events.has(id)) return []; this.#events.add(id); const stopped: JourneyEnrollment[] = []; for (const [enrollmentId, item] of this.#enrollments) { if (item.playerId !== playerId || item.status !== "active") continue; const journey = this.requireJourney(item.journeyId); const current = journey.steps[item.nextStepIndex]; if (!current.stopOnEvents.includes(event)) continue; const changed = { ...item, status: "stopped" as const, stopReason: event, nextRunAt: undefined, version: item.version + 1 }; this.#enrollments.set(enrollmentId, changed); stopped.push(cloneEnrollment(changed)); } void at; return stopped; }
  cancel(enrollmentId: string, expectedVersion: number, reason: string): JourneyEnrollment { const item = this.requireEnrollment(enrollmentId); if (item.version !== expectedVersion) throw new CrmConflictError("journey enrollment version does not match"); if (item.status !== "active") return cloneEnrollment(item); const changed = { ...item, status: "cancelled" as const, stopReason: crmText(reason, "cancellation reason"), nextRunAt: undefined, version: item.version + 1 }; this.#enrollments.set(changed.id, changed); return cloneEnrollment(changed); }
  enrollment(id: string): JourneyEnrollment | undefined { const value = this.#enrollments.get(id.trim()); return value ? cloneEnrollment(value) : undefined; }
  private requireJourney(id: string): JourneyDefinition { const value = this.#journeys.get(crmText(id, "journey id")); if (!value) throw new CrmValidationError("journey does not exist"); return value; }
  private requireEnrollment(id: string): JourneyEnrollment { const value = this.#enrollments.get(crmText(id, "enrollment id")); if (!value) throw new CrmValidationError("journey enrollment does not exist"); return value; }
}

function validateJourney(value: JourneyDefinition): JourneyDefinition { if (!value.steps.length) throw new CrmValidationError("journey requires steps"); const ids = new Set<string>(); const steps = value.steps.map((step) => { if (ids.has(step.id)) throw new CrmValidationError("journey step ids must be unique"); ids.add(step.id); if (!Number.isSafeInteger(step.delayMinutes) || step.delayMinutes < 0) throw new CrmValidationError("journey step delay is invalid"); return { ...step, id: crmText(step.id, "step id"), templateId: crmText(step.templateId, "template id"), stopOnEvents: [...new Set(step.stopOnEvents.map((item) => crmText(item, "stop event")))].sort() }; }); return { ...value, id: crmText(value.id, "journey id"), name: crmText(value.name, "journey name"), segmentConditions: Object.fromEntries(Object.entries(value.segmentConditions).map(([key, values]) => [crmText(key, "segment attribute"), [...new Set(values.map((item) => crmText(item, "segment value")))]])), steps }; }
function eligible(journey: JourneyDefinition, attributes: Readonly<Record<string, string>>): boolean { return Object.entries(journey.segmentConditions).every(([key, values]) => values.includes(attributes[key])); }
function cloneJourney(value: JourneyDefinition): JourneyDefinition { return { ...value, segmentConditions: Object.fromEntries(Object.entries(value.segmentConditions).map(([key, values]) => [key, [...values]])), steps: value.steps.map((step) => ({ ...step, stopOnEvents: [...step.stopOnEvents] })) }; }
function cloneEnrollment(value: JourneyEnrollment): JourneyEnrollment { return { ...value, completedStepIds: [...value.completedStepIds] }; }
