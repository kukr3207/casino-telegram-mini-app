import { createHash } from "node:crypto";

import {
  RegulatoryConflictError,
  RegulatoryValidationError,
  regulatoryDate,
  regulatoryText,
} from "./types.ts";

export interface ScreeningSubject {
  id: string;
  kind: "person" | "organization";
  names: readonly string[];
  dateOfBirth?: string;
  countries: readonly string[];
  identifiers: Readonly<Record<string, string>>;
}

export interface ScreeningEntry {
  id: string;
  source: string;
  sourceVersion: string;
  category: "sanctions" | "pep" | "adverse_media" | "law_enforcement";
  names: readonly string[];
  countries: readonly string[];
  dateOfBirth?: string;
  identifiers: Readonly<Record<string, string>>;
  activeFrom?: string;
  activeTo?: string;
  reason: string;
  updatedAt: string;
}

export interface ScreeningMatch {
  entryId: string;
  source: string;
  category: ScreeningEntry["category"];
  score: number;
  matchedName: string;
  reasons: readonly string[];
}

export interface ScreeningResult {
  id: string;
  subjectId: string;
  screenedAt: string;
  listVersion: string;
  disposition: "clear" | "review" | "confirmed" | "false_positive";
  matches: readonly ScreeningMatch[];
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
  version: number;
}

export class RegulatoryScreeningService {
  readonly #entries = new Map<string, ScreeningEntry>();
  readonly #results = new Map<string, ScreeningResult>();
  #listVersion = "empty";

  replaceList(
    entries: readonly ScreeningEntry[],
    sourceVersion: string,
  ): { version: string; count: number } {
    const normalized = entries.map(validateEntry);
    const ids = new Set<string>();
    for (const entry of normalized) {
      if (ids.has(entry.id))
        throw new RegulatoryConflictError(
          "screening list contains duplicate ids",
        );
      ids.add(entry.id);
    }
    const version = regulatoryText(sourceVersion, "screening list version");
    this.#entries.clear();
    for (const entry of normalized) this.#entries.set(entry.id, entry);
    this.#listVersion = createHash("sha256")
      .update(
        `${version}\u0000${normalized
          .map((entry) => entry.id)
          .sort()
          .join("\u0000")}`,
      )
      .digest("hex");
    return { version: this.#listVersion, count: normalized.length };
  }

  screen(subjectInput: ScreeningSubject, at = new Date()): ScreeningResult {
    const subject = validateSubject(subjectInput);
    const matches = [...this.#entries.values()]
      .filter((entry) => !entry.activeFrom || new Date(entry.activeFrom) <= at)
      .filter((entry) => !entry.activeTo || new Date(entry.activeTo) > at)
      .map((entry) => compare(subject, entry))
      .filter((match): match is ScreeningMatch => match !== undefined)
      .sort(
        (left, right) =>
          right.score - left.score || left.entryId.localeCompare(right.entryId),
      );
    const fingerprint = createHash("sha256")
      .update(
        `${subject.id}\u0000${at.toISOString()}\u0000${this.#listVersion}`,
      )
      .digest("hex");
    const result: ScreeningResult = {
      id: `screen_${fingerprint.slice(0, 24)}`,
      subjectId: subject.id,
      screenedAt: at.toISOString(),
      listVersion: this.#listVersion,
      disposition: matches.some((match) => match.score >= 75)
        ? "review"
        : "clear",
      matches,
      version: 1,
    };
    this.#results.set(result.id, result);
    return cloneResult(result);
  }

  review(
    resultId: string,
    disposition: "confirmed" | "false_positive",
    analystId: string,
    note: string,
    expectedVersion: number,
    at = new Date(),
  ): ScreeningResult {
    const current = this.#results.get(
      regulatoryText(resultId, "screening result id"),
    );
    if (!current)
      throw new RegulatoryValidationError("screening result does not exist");
    if (current.version !== expectedVersion)
      throw new RegulatoryConflictError(
        "screening result version does not match",
      );
    if (current.disposition !== "review")
      throw new RegulatoryConflictError(
        "only screening reviews can be resolved",
      );
    const changed: ScreeningResult = {
      ...current,
      disposition,
      reviewedBy: regulatoryText(analystId, "screening analyst"),
      reviewedAt: at.toISOString(),
      reviewNote: regulatoryText(note, "screening note"),
      version: current.version + 1,
    };
    this.#results.set(changed.id, changed);
    return cloneResult(changed);
  }

  result(id: string): ScreeningResult | undefined {
    const value = this.#results.get(id.trim());
    return value ? cloneResult(value) : undefined;
  }

  history(subjectId: string): readonly ScreeningResult[] {
    const id = regulatoryText(subjectId, "subject id");
    return [...this.#results.values()]
      .filter((result) => result.subjectId === id)
      .sort((left, right) => right.screenedAt.localeCompare(left.screenedAt))
      .map(cloneResult);
  }
}

function compare(
  subject: ScreeningSubject,
  entry: ScreeningEntry,
): ScreeningMatch | undefined {
  let score = 0;
  const reasons: string[] = [];
  let matchedName = "";
  for (const subjectName of subject.names)
    for (const entryName of entry.names) {
      const similarity = nameSimilarity(subjectName, entryName);
      if (similarity > score) {
        score = similarity;
        matchedName = entryName;
      }
    }
  if (score < 45) return undefined;
  reasons.push(`name:${score}`);
  if (
    subject.dateOfBirth &&
    entry.dateOfBirth &&
    subject.dateOfBirth === entry.dateOfBirth
  ) {
    score += 15;
    reasons.push("date_of_birth");
  }
  const countries = subject.countries.filter((country) =>
    entry.countries.includes(country),
  );
  if (countries.length) {
    score += 5;
    reasons.push(`country:${countries.join(",")}`);
  }
  for (const [kind, value] of Object.entries(subject.identifiers))
    if (entry.identifiers[kind] === value) {
      score += 30;
      reasons.push(`identifier:${kind}`);
    }
  return {
    entryId: entry.id,
    source: entry.source,
    category: entry.category,
    score: Math.min(score, 100),
    matchedName,
    reasons,
  };
}

function nameSimilarity(left: string, right: string): number {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (a === b) return 70;
  const aTokens = new Set(a.split(" "));
  const bTokens = new Set(b.split(" "));
  const intersection = [...aTokens].filter((token) =>
    bTokens.has(token),
  ).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  const tokenScore = union === 0 ? 0 : Math.round((intersection / union) * 60);
  const distance = levenshtein(a, b);
  const editScore = Math.max(
    0,
    Math.round((1 - distance / Math.max(a.length, b.length, 1)) * 65),
  );
  return Math.max(tokenScore, editScore);
}

function levenshtein(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const saved = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        previous + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      previous = saved;
    }
  }
  return row[right.length];
}

function validateSubject(value: ScreeningSubject): ScreeningSubject {
  if (value.names.length === 0)
    throw new RegulatoryValidationError("screening subject needs a name");
  return {
    ...value,
    id: regulatoryText(value.id, "screening subject id"),
    names: [...new Set(value.names.map(normalizeName))],
    dateOfBirth: value.dateOfBirth
      ? regulatoryDate(value.dateOfBirth, "date of birth")
          .toISOString()
          .slice(0, 10)
      : undefined,
    countries: [
      ...new Set(
        value.countries.map((country) =>
          regulatoryText(country, "country").toUpperCase(),
        ),
      ),
    ],
    identifiers: normalizeIdentifiers(value.identifiers),
  };
}

function validateEntry(value: ScreeningEntry): ScreeningEntry {
  if (value.names.length === 0)
    throw new RegulatoryValidationError("screening entry needs a name");
  const activeFrom = value.activeFrom
    ? regulatoryDate(value.activeFrom, "entry active start").toISOString()
    : undefined;
  const activeTo = value.activeTo
    ? regulatoryDate(value.activeTo, "entry active end").toISOString()
    : undefined;
  if (activeFrom && activeTo && activeTo <= activeFrom)
    throw new RegulatoryValidationError(
      "screening entry end must follow start",
    );
  return {
    ...value,
    id: regulatoryText(value.id, "screening entry id"),
    source: regulatoryText(value.source, "screening source"),
    sourceVersion: regulatoryText(
      value.sourceVersion,
      "screening source version",
    ),
    names: [...new Set(value.names.map(normalizeName))],
    countries: [
      ...new Set(
        value.countries.map((country) =>
          regulatoryText(country, "country").toUpperCase(),
        ),
      ),
    ],
    dateOfBirth: value.dateOfBirth
      ? regulatoryDate(value.dateOfBirth, "date of birth")
          .toISOString()
          .slice(0, 10)
      : undefined,
    identifiers: normalizeIdentifiers(value.identifiers),
    activeFrom,
    activeTo,
    reason: regulatoryText(value.reason, "screening reason"),
    updatedAt: regulatoryDate(
      value.updatedAt,
      "screening update time",
    ).toISOString(),
  };
}

function normalizeName(value: string): string {
  return regulatoryText(value, "name")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}
function normalizeIdentifiers(
  values: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      regulatoryText(key, "identifier kind").toLowerCase(),
      regulatoryText(value, "identifier value").toUpperCase(),
    ]),
  );
}
function cloneResult(value: ScreeningResult): ScreeningResult {
  return {
    ...value,
    matches: value.matches.map((match) => ({
      ...match,
      reasons: [...match.reasons],
    })),
  };
}
