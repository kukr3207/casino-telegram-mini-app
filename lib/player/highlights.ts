import { randomUUID } from "node:crypto";
import { PlayerFeatureConflictError, PlayerFeatureValidationError, required, validDate } from "./game-reports.ts";

export interface GameHighlight {
  id: string;
  playerId: string;
  gameId: string;
  roundId: string;
  title: string;
  description?: string;
  occurredAt: Date;
  savedAt: Date;
  tags: readonly string[];
  metrics: Readonly<Record<string, number>>;
  visibility: "private" | "contacts" | "public";
  shareCode?: string;
  version: number;
}

export class GameHighlightStore {
  private readonly highlights = new Map<string, GameHighlight>();
  private readonly roundIndex = new Map<string, string>();
  private readonly shareIndex = new Map<string, string>();

  save(input: Omit<GameHighlight, "id" | "savedAt" | "shareCode" | "version">, at = new Date()): GameHighlight {
    const roundKey = `${input.playerId}:${input.gameId}:${input.roundId}`;
    const existingId = this.roundIndex.get(roundKey);
    if (existingId) return cloneHighlight(this.highlights.get(existingId)!);
    const metrics: Record<string, number> = {};
    for (const [name, value] of Object.entries(input.metrics)) {
      if (!Number.isFinite(value)) throw new PlayerFeatureValidationError(`highlight metric ${name} is invalid`);
      metrics[name] = value;
    }
    const highlight: GameHighlight = {
      ...input,
      id: randomUUID(),
      playerId: required(input.playerId, "player id"),
      gameId: required(input.gameId, "game id"),
      roundId: required(input.roundId, "round id"),
      title: required(input.title, "highlight title"),
      description: input.description?.trim() || undefined,
      occurredAt: validDate(input.occurredAt),
      savedAt: validDate(at),
      tags: normalizeTags(input.tags),
      metrics,
      version: 1,
    };
    this.highlights.set(highlight.id, highlight);
    this.roundIndex.set(roundKey, highlight.id);
    return cloneHighlight(highlight);
  }

  update(
    highlightId: string,
    expectedVersion: number,
    changes: { title?: string; description?: string; tags?: readonly string[] },
  ): GameHighlight {
    const current = this.requireVersion(highlightId, expectedVersion);
    const updated = {
      ...current,
      title: changes.title === undefined ? current.title : required(changes.title, "highlight title"),
      description: changes.description === undefined ? current.description : changes.description.trim() || undefined,
      tags: changes.tags === undefined ? current.tags : normalizeTags(changes.tags),
      version: current.version + 1,
    };
    this.highlights.set(updated.id, updated);
    return cloneHighlight(updated);
  }

  setVisibility(highlightId: string, expectedVersion: number, visibility: GameHighlight["visibility"]): GameHighlight {
    const current = this.requireVersion(highlightId, expectedVersion);
    let shareCode = current.shareCode;
    if (visibility === "public" && !shareCode) {
      shareCode = randomUUID().replace(/-/g, "").slice(0, 16);
      this.shareIndex.set(shareCode, current.id);
    } else if (visibility !== "public" && shareCode) {
      this.shareIndex.delete(shareCode);
      shareCode = undefined;
    }
    const updated = { ...current, visibility, shareCode, version: current.version + 1 };
    this.highlights.set(updated.id, updated);
    return cloneHighlight(updated);
  }

  getShared(shareCode: string): GameHighlight | undefined {
    const id = this.shareIndex.get(shareCode.trim());
    const highlight = id ? this.highlights.get(id) : undefined;
    return highlight?.visibility === "public" ? cloneHighlight(highlight) : undefined;
  }

  list(
    playerId: string,
    options: { gameId?: string; tag?: string; limit?: number; before?: Date } = {},
  ): readonly GameHighlight[] {
    const limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new PlayerFeatureValidationError("highlight limit is invalid");
    return [...this.highlights.values()]
      .filter((item) => item.playerId === playerId.trim())
      .filter((item) => !options.gameId || item.gameId === options.gameId)
      .filter((item) => !options.tag || item.tags.includes(options.tag.toLowerCase()))
      .filter((item) => !options.before || item.occurredAt < options.before)
      .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())
      .slice(0, limit)
      .map(cloneHighlight);
  }

  remove(playerId: string, highlightId: string): boolean {
    const highlight = this.highlights.get(highlightId.trim());
    if (!highlight || highlight.playerId !== playerId.trim()) return false;
    this.highlights.delete(highlight.id);
    this.roundIndex.delete(`${highlight.playerId}:${highlight.gameId}:${highlight.roundId}`);
    if (highlight.shareCode) this.shareIndex.delete(highlight.shareCode);
    return true;
  }

  private requireVersion(highlightId: string, expectedVersion: number): GameHighlight {
    const current = this.highlights.get(required(highlightId, "highlight id"));
    if (!current) throw new PlayerFeatureValidationError("highlight does not exist");
    if (current.version !== expectedVersion) throw new PlayerFeatureConflictError("highlight version does not match");
    return current;
  }
}

function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => required(tag, "highlight tag").toLowerCase()))].sort();
}

function cloneHighlight(value: GameHighlight): GameHighlight {
  return {
    ...value,
    occurredAt: new Date(value.occurredAt),
    savedAt: new Date(value.savedAt),
    tags: [...value.tags],
    metrics: { ...value.metrics },
  };
}

