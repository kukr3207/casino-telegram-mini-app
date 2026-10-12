import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { IdentityConflictError, IdentityValidationError, requiredText, validDate } from "./profiles.ts";

export interface PlayerSession {
  id: string;
  playerId: string;
  deviceId: string;
  ipAddress: string;
  userAgent: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  revokeReason?: string;
}

export interface SessionToken {
  session: PlayerSession;
  token: string;
}

interface StoredSession {
  session: PlayerSession;
  tokenDigest: Buffer;
}

export class PlayerSessionStore {
  private readonly sessions = new Map<string, StoredSession>();

  create(
    playerId: string,
    deviceId: string,
    ipAddress: string,
    userAgent: string,
    options: { at?: Date; lifetimeMs?: number } = {},
  ): SessionToken {
    const at = options.at ? validDate(options.at, "session time") : new Date();
    const lifetimeMs = options.lifetimeMs ?? 30 * 24 * 60 * 60 * 1_000;
    if (!Number.isInteger(lifetimeMs) || lifetimeMs <= 0) throw new IdentityValidationError("session lifetime must be positive");
    const token = randomBytes(32).toString("base64url");
    const session: PlayerSession = {
      id: randomUUID(),
      playerId: requiredText(playerId, "player id", 128),
      deviceId: requiredText(deviceId, "device id", 256),
      ipAddress: requiredText(ipAddress, "IP address", 128),
      userAgent: requiredText(userAgent, "user agent", 500),
      createdAt: at,
      lastSeenAt: at,
      expiresAt: new Date(at.getTime() + lifetimeMs),
    };
    this.sessions.set(session.id, { session, tokenDigest: digestToken(token) });
    return { session: cloneSession(session), token };
  }

  authenticate(sessionId: string, token: string, at = new Date()): PlayerSession {
    const stored = this.sessions.get(requiredText(sessionId, "session id", 128));
    if (!stored) throw new IdentityValidationError("session does not exist");
    const now = validDate(at, "authentication time");
    if (stored.session.revokedAt) throw new IdentityConflictError("session was revoked");
    if (stored.session.expiresAt <= now) throw new IdentityConflictError("session expired");
    const supplied = digestToken(token);
    if (!timingSafeEqual(stored.tokenDigest, supplied)) throw new IdentityValidationError("session token is invalid");
    stored.session = { ...stored.session, lastSeenAt: now };
    return cloneSession(stored.session);
  }

  rotate(sessionId: string, token: string, at = new Date()): SessionToken {
    const session = this.authenticate(sessionId, token, at);
    const replacement = randomBytes(32).toString("base64url");
    const stored = this.sessions.get(session.id)!;
    stored.tokenDigest = digestToken(replacement);
    return { session: cloneSession(stored.session), token: replacement };
  }

  revoke(sessionId: string, reason: string, at = new Date()): PlayerSession {
    const stored = this.sessions.get(requiredText(sessionId, "session id", 128));
    if (!stored) throw new IdentityValidationError("session does not exist");
    if (!stored.session.revokedAt) {
      stored.session = {
        ...stored.session,
        revokedAt: validDate(at, "revocation time"),
        revokeReason: requiredText(reason, "revocation reason", 500),
      };
    }
    return cloneSession(stored.session);
  }

  revokeAll(playerId: string, reason: string, exceptSessionId?: string, at = new Date()): number {
    let count = 0;
    for (const stored of this.sessions.values()) {
      if (stored.session.playerId !== playerId.trim() || stored.session.id === exceptSessionId || stored.session.revokedAt) continue;
      this.revoke(stored.session.id, reason, at);
      count += 1;
    }
    return count;
  }

  activeForPlayer(playerId: string, at = new Date()): readonly PlayerSession[] {
    return [...this.sessions.values()]
      .map((item) => item.session)
      .filter((session) => session.playerId === playerId.trim() && !session.revokedAt && session.expiresAt > at)
      .sort((left, right) => right.lastSeenAt.getTime() - left.lastSeenAt.getTime())
      .map(cloneSession);
  }
}

function digestToken(token: string): Buffer {
  return createHash("sha256").update(requiredText(token, "session token", 256)).digest();
}

function cloneSession(session: PlayerSession): PlayerSession {
  return {
    ...session,
    createdAt: new Date(session.createdAt),
    lastSeenAt: new Date(session.lastSeenAt),
    expiresAt: new Date(session.expiresAt),
    revokedAt: session.revokedAt ? new Date(session.revokedAt) : undefined,
  };
}

