import { randomUUID } from "node:crypto";
import { PlayerFeatureConflictError, PlayerFeatureValidationError, required, validDate } from "./game-reports.ts";

export interface BetPreset {
  id: string;
  playerId: string;
  game: string;
  name: string;
  stakeMinor: bigint;
  currency: string;
  configuration: Readonly<Record<string, string | number | boolean>>;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt?: Date;
  useCount: number;
  version: number;
}

export class BetPresetStore {
  private readonly presets = new Map<string, BetPreset>();

  create(
    input: Pick<BetPreset, "playerId" | "game" | "name" | "stakeMinor" | "currency" | "configuration"> & { isDefault?: boolean },
    at = new Date(),
  ): BetPreset {
    const playerId = required(input.playerId, "player id");
    const game = required(input.game, "game").toLowerCase();
    const name = required(input.name, "preset name");
    if (input.stakeMinor <= 0n) throw new PlayerFeatureValidationError("preset stake must be positive");
    const duplicate = [...this.presets.values()].find(
      (preset) => preset.playerId === playerId && preset.game === game && preset.name.toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) throw new PlayerFeatureConflictError("a preset with this name already exists for the game");
    validateConfiguration(input.configuration);
    const now = validDate(at);
    const preset: BetPreset = {
      id: randomUUID(),
      playerId,
      game,
      name,
      stakeMinor: input.stakeMinor,
      currency: required(input.currency, "currency").toUpperCase(),
      configuration: { ...input.configuration },
      isDefault: Boolean(input.isDefault),
      createdAt: now,
      updatedAt: now,
      useCount: 0,
      version: 1,
    };
    if (preset.isDefault) this.clearDefault(playerId, game);
    this.presets.set(preset.id, preset);
    return clonePreset(preset);
  }

  update(
    presetId: string,
    expectedVersion: number,
    changes: Partial<Pick<BetPreset, "name" | "stakeMinor" | "configuration">>,
    at = new Date(),
  ): BetPreset {
    const current = this.requireVersion(presetId, expectedVersion);
    if (changes.stakeMinor !== undefined && changes.stakeMinor <= 0n) {
      throw new PlayerFeatureValidationError("preset stake must be positive");
    }
    if (changes.configuration) validateConfiguration(changes.configuration);
    const name = changes.name === undefined ? current.name : required(changes.name, "preset name");
    const duplicate = [...this.presets.values()].find(
      (preset) => preset.id !== current.id
        && preset.playerId === current.playerId
        && preset.game === current.game
        && preset.name.toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) throw new PlayerFeatureConflictError("a preset with this name already exists for the game");
    const updated: BetPreset = {
      ...current,
      name,
      stakeMinor: changes.stakeMinor ?? current.stakeMinor,
      configuration: changes.configuration ? { ...changes.configuration } : current.configuration,
      updatedAt: validDate(at),
      version: current.version + 1,
    };
    this.presets.set(updated.id, updated);
    return clonePreset(updated);
  }

  makeDefault(presetId: string, expectedVersion: number, at = new Date()): BetPreset {
    const current = this.requireVersion(presetId, expectedVersion);
    if (current.isDefault) return clonePreset(current);
    this.clearDefault(current.playerId, current.game);
    const updated = { ...current, isDefault: true, updatedAt: validDate(at), version: current.version + 1 };
    this.presets.set(updated.id, updated);
    return clonePreset(updated);
  }

  use(presetId: string, playerId: string, at = new Date()): BetPreset {
    const current = this.presets.get(required(presetId, "preset id"));
    if (!current || current.playerId !== playerId.trim()) throw new PlayerFeatureValidationError("preset does not exist");
    const updated = {
      ...current,
      lastUsedAt: validDate(at),
      useCount: current.useCount + 1,
      updatedAt: validDate(at),
      version: current.version + 1,
    };
    this.presets.set(updated.id, updated);
    return clonePreset(updated);
  }

  list(playerId: string, game?: string): readonly BetPreset[] {
    return [...this.presets.values()]
      .filter((preset) => preset.playerId === playerId.trim())
      .filter((preset) => !game || preset.game === game.toLowerCase())
      .sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || right.useCount - left.useCount || left.name.localeCompare(right.name))
      .map(clonePreset);
  }

  remove(playerId: string, presetId: string): boolean {
    const preset = this.presets.get(presetId.trim());
    if (!preset || preset.playerId !== playerId.trim()) return false;
    this.presets.delete(preset.id);
    return true;
  }

  private clearDefault(playerId: string, game: string): void {
    for (const preset of this.presets.values()) {
      if (preset.playerId === playerId && preset.game === game && preset.isDefault) {
        this.presets.set(preset.id, { ...preset, isDefault: false, version: preset.version + 1 });
      }
    }
  }

  private requireVersion(presetId: string, expectedVersion: number): BetPreset {
    const current = this.presets.get(required(presetId, "preset id"));
    if (!current) throw new PlayerFeatureValidationError("preset does not exist");
    if (current.version !== expectedVersion) throw new PlayerFeatureConflictError("preset version does not match");
    return current;
  }
}

function validateConfiguration(value: Readonly<Record<string, string | number | boolean>>): void {
  if (Object.keys(value).length === 0) throw new PlayerFeatureValidationError("preset configuration is empty");
  for (const [key, item] of Object.entries(value)) {
    required(key, "configuration key");
    if (typeof item === "number" && !Number.isFinite(item)) throw new PlayerFeatureValidationError(`configuration value ${key} is invalid`);
  }
}

function clonePreset(value: BetPreset): BetPreset {
  return {
    ...value,
    configuration: { ...value.configuration },
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
    lastUsedAt: value.lastUsedAt ? new Date(value.lastUsedAt) : undefined,
  };
}

