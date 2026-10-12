import { randomUUID } from "node:crypto";

export type VerificationStatus = "unverified" | "pending" | "verified" | "rejected" | "expired";

export interface PlayerAddress {
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  country: string;
}

export interface PlayerProfile {
  id: string;
  telegramId: string;
  displayName: string;
  legalName?: string;
  dateOfBirth?: string;
  email?: string;
  phone?: string;
  address?: PlayerAddress;
  locale: string;
  timeZone: string;
  verificationStatus: VerificationStatus;
  verificationReason?: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface CreatePlayerProfile {
  id?: string;
  telegramId: string;
  displayName: string;
  locale?: string;
  timeZone?: string;
  createdAt?: Date;
}

export interface UpdatePlayerProfile {
  displayName?: string;
  legalName?: string;
  dateOfBirth?: string;
  email?: string;
  phone?: string;
  address?: PlayerAddress;
  locale?: string;
  timeZone?: string;
}

export class IdentityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityValidationError";
  }
}

export class IdentityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityConflictError";
  }
}

export class PlayerProfileStore {
  private readonly profiles = new Map<string, PlayerProfile>();
  private readonly byTelegram = new Map<string, string>();

  create(input: CreatePlayerProfile): PlayerProfile {
    const telegramId = requiredText(input.telegramId, "Telegram id", 128);
    if (this.byTelegram.has(telegramId)) throw new IdentityConflictError("Telegram account is already registered");
    const id = input.id ? requiredText(input.id, "player id", 128) : randomUUID();
    if (this.profiles.has(id)) throw new IdentityConflictError("player id already exists");
    const now = input.createdAt ? validDate(input.createdAt, "creation time") : new Date();
    const profile: PlayerProfile = {
      id,
      telegramId,
      displayName: requiredText(input.displayName, "display name", 100),
      locale: normalizeLocale(input.locale ?? "en"),
      timeZone: normalizeTimeZone(input.timeZone ?? "UTC"),
      verificationStatus: "unverified",
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    this.profiles.set(id, profile);
    this.byTelegram.set(telegramId, id);
    return cloneProfile(profile);
  }

  update(playerId: string, expectedVersion: number, changes: UpdatePlayerProfile, at = new Date()): PlayerProfile {
    const current = this.require(playerId);
    if (current.version !== expectedVersion) throw new IdentityConflictError("player profile was changed by another request");
    if (Object.keys(changes).length === 0) throw new IdentityValidationError("profile update is empty");
    const updated: PlayerProfile = {
      ...current,
      displayName: changes.displayName === undefined ? current.displayName : requiredText(changes.displayName, "display name", 100),
      legalName: changes.legalName === undefined ? current.legalName : requiredText(changes.legalName, "legal name", 200),
      dateOfBirth: changes.dateOfBirth === undefined ? current.dateOfBirth : normalizeBirthDate(changes.dateOfBirth),
      email: changes.email === undefined ? current.email : normalizeEmail(changes.email),
      phone: changes.phone === undefined ? current.phone : normalizePhone(changes.phone),
      address: changes.address === undefined ? current.address : normalizeAddress(changes.address),
      locale: changes.locale === undefined ? current.locale : normalizeLocale(changes.locale),
      timeZone: changes.timeZone === undefined ? current.timeZone : normalizeTimeZone(changes.timeZone),
      updatedAt: validDate(at, "update time"),
      version: current.version + 1,
    };
    if (updated.verificationStatus === "verified" && sensitiveIdentityChanged(current, updated)) {
      updated.verificationStatus = "pending";
      updated.verificationReason = "identity details changed after verification";
    }
    this.profiles.set(updated.id, updated);
    return cloneProfile(updated);
  }

  beginVerification(playerId: string, expectedVersion: number, at = new Date()): PlayerProfile {
    const current = this.requireVersion(playerId, expectedVersion);
    if (!current.legalName || !current.dateOfBirth || !current.address) {
      throw new IdentityValidationError("legal name, birth date, and address are required for verification");
    }
    return this.saveStatus(current, "pending", undefined, at);
  }

  acceptVerification(playerId: string, expectedVersion: number, at = new Date()): PlayerProfile {
    const current = this.requireVersion(playerId, expectedVersion);
    if (current.verificationStatus !== "pending") throw new IdentityConflictError("verification is not pending");
    return this.saveStatus(current, "verified", undefined, at);
  }

  rejectVerification(playerId: string, expectedVersion: number, reason: string, at = new Date()): PlayerProfile {
    const current = this.requireVersion(playerId, expectedVersion);
    if (current.verificationStatus !== "pending") throw new IdentityConflictError("verification is not pending");
    return this.saveStatus(current, "rejected", requiredText(reason, "verification reason", 500), at);
  }

  expireVerification(playerId: string, reason: string, at = new Date()): PlayerProfile {
    const current = this.require(playerId);
    if (current.verificationStatus !== "verified") return cloneProfile(current);
    return this.saveStatus(current, "expired", requiredText(reason, "expiry reason", 500), at);
  }

  get(playerId: string): PlayerProfile | undefined {
    const value = this.profiles.get(playerId.trim());
    return value ? cloneProfile(value) : undefined;
  }

  findByTelegramId(telegramId: string): PlayerProfile | undefined {
    const id = this.byTelegram.get(telegramId.trim());
    return id ? this.get(id) : undefined;
  }

  remove(playerId: string): boolean {
    const current = this.profiles.get(playerId.trim());
    if (!current) return false;
    this.profiles.delete(current.id);
    this.byTelegram.delete(current.telegramId);
    return true;
  }

  private require(playerId: string): PlayerProfile {
    const current = this.profiles.get(requiredText(playerId, "player id", 128));
    if (!current) throw new IdentityValidationError("player profile does not exist");
    return current;
  }

  private requireVersion(playerId: string, expectedVersion: number): PlayerProfile {
    const current = this.require(playerId);
    if (current.version !== expectedVersion) throw new IdentityConflictError("player profile version does not match");
    return current;
  }

  private saveStatus(current: PlayerProfile, status: VerificationStatus, reason: string | undefined, at: Date): PlayerProfile {
    const updated = {
      ...current,
      verificationStatus: status,
      verificationReason: reason,
      updatedAt: validDate(at, "verification time"),
      version: current.version + 1,
    };
    this.profiles.set(updated.id, updated);
    return cloneProfile(updated);
  }
}

export function requiredText(value: string, field: string, max: number): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new IdentityValidationError(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length > max) throw new IdentityValidationError(`${field} is too long`);
  return normalized;
}

export function validDate(value: Date, field: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new IdentityValidationError(`${field} is invalid`);
  return date;
}

function normalizeEmail(value: string): string {
  const email = requiredText(value, "email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new IdentityValidationError("email is invalid");
  return email;
}

function normalizePhone(value: string): string {
  const phone = value.replace(/[\s()-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new IdentityValidationError("phone number must use E.164 format");
  return phone;
}

function normalizeBirthDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new IdentityValidationError("birth date must use YYYY-MM-DD");
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new IdentityValidationError("birth date is invalid");
  }
  if (date >= new Date()) throw new IdentityValidationError("birth date must be in the past");
  return value;
}

function normalizeAddress(value: PlayerAddress): PlayerAddress {
  const country = requiredText(value.country, "country", 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new IdentityValidationError("country must be an ISO alpha-2 code");
  return {
    line1: requiredText(value.line1, "address line", 200),
    line2: value.line2?.trim() || undefined,
    city: requiredText(value.city, "city", 100),
    region: value.region?.trim() || undefined,
    postalCode: requiredText(value.postalCode, "postal code", 32),
    country,
  };
}

function normalizeLocale(value: string): string {
  const locale = requiredText(value, "locale", 16);
  if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(locale)) throw new IdentityValidationError("locale is invalid");
  return locale;
}

function normalizeTimeZone(value: string): string {
  const zone = requiredText(value, "time zone", 64);
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
  } catch {
    throw new IdentityValidationError("time zone is invalid");
  }
  return zone;
}

function sensitiveIdentityChanged(before: PlayerProfile, after: PlayerProfile): boolean {
  return before.legalName !== after.legalName
    || before.dateOfBirth !== after.dateOfBirth
    || JSON.stringify(before.address) !== JSON.stringify(after.address);
}

function cloneProfile(profile: PlayerProfile): PlayerProfile {
  return {
    ...profile,
    address: profile.address ? { ...profile.address } : undefined,
    createdAt: new Date(profile.createdAt),
    updatedAt: new Date(profile.updatedAt),
  };
}

