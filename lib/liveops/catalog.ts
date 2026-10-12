import {
  type GameCertification,
  type GameDefinition,
  type GameLifecycle,
  type GameTranslation,
  LiveOpsConflictError,
  LiveOpsValidationError,
  liveOpsDate,
  liveOpsText,
} from "./types.ts";

export interface GameQuery {
  category?: GameDefinition["category"];
  lifecycle?: readonly GameLifecycle[];
  currency?: string;
  country?: string;
  device?: GameDefinition["devices"][number];
  tag?: string;
  provider?: string;
  text?: string;
  demoAvailable?: boolean;
}

const transitions: Readonly<Record<GameLifecycle, readonly GameLifecycle[]>> = {
  draft: ["certification", "retired"],
  certification: ["draft", "scheduled", "retired"],
  scheduled: ["certification", "live", "retired"],
  live: ["suspended", "retired"],
  suspended: ["live", "retired"],
  retired: [],
};

export class GameCatalog {
  readonly #games = new Map<string, GameDefinition>();
  readonly #bySlug = new Map<string, string>();
  readonly #certifications = new Map<string, GameCertification[]>();
  readonly #translations = new Map<string, Map<string, GameTranslation>>();

  create(value: GameDefinition): GameDefinition {
    const game = validateGame(value);
    if (this.#games.has(game.id))
      throw new LiveOpsConflictError("game id already exists");
    if (this.#bySlug.has(game.slug))
      throw new LiveOpsConflictError("game slug already exists");
    this.#games.set(game.id, game);
    this.#bySlug.set(game.slug, game.id);
    this.#certifications.set(game.id, []);
    this.#translations.set(game.id, new Map());
    return cloneGame(game);
  }

  update(
    gameId: string,
    expectedVersion: number,
    changes: Partial<
      Omit<GameDefinition, "id" | "slug" | "lifecycle" | "version">
    >,
  ): GameDefinition {
    const current = this.require(gameId);
    if (current.version !== expectedVersion)
      throw new LiveOpsConflictError("game version does not match");
    const changed = validateGame({
      ...current,
      ...changes,
      id: current.id,
      slug: current.slug,
      lifecycle: current.lifecycle,
      version: current.version + 1,
    });
    this.#games.set(changed.id, changed);
    return cloneGame(changed);
  }

  transition(
    gameId: string,
    expectedVersion: number,
    lifecycle: GameLifecycle,
    at = new Date(),
  ): GameDefinition {
    const current = this.require(gameId);
    if (current.version !== expectedVersion)
      throw new LiveOpsConflictError("game version does not match");
    if (lifecycle === current.lifecycle) return cloneGame(current);
    if (!transitions[current.lifecycle].includes(lifecycle))
      throw new LiveOpsConflictError(
        `cannot move game from ${current.lifecycle} to ${lifecycle}`,
      );
    if (lifecycle === "live" && !this.hasCurrentCertification(current.id, at))
      throw new LiveOpsConflictError("game has no current certification");
    const changed = {
      ...current,
      lifecycle,
      launchedAt:
        lifecycle === "live"
          ? (current.launchedAt ?? at.toISOString())
          : current.launchedAt,
      retiredAt: lifecycle === "retired" ? at.toISOString() : undefined,
      version: current.version + 1,
    };
    this.#games.set(changed.id, changed);
    return cloneGame(changed);
  }

  certify(value: GameCertification): GameCertification {
    const certification = validateCertification(value);
    this.require(certification.gameId);
    const items = this.#certifications.get(certification.gameId)!;
    const existing = items.find(
      (item) =>
        item.id === certification.id ||
        (item.jurisdiction === certification.jurisdiction &&
          item.certificateNumber === certification.certificateNumber),
    );
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(certification))
        throw new LiveOpsConflictError(
          "certification already exists with different data",
        );
      return cloneCertification(existing);
    }
    items.push(certification);
    return cloneCertification(certification);
  }

  revokeCertification(
    gameId: string,
    certificationId: string,
  ): GameCertification {
    const items = this.#certifications.get(gameId);
    if (!items) throw new LiveOpsValidationError("game does not exist");
    const index = items.findIndex((item) => item.id === certificationId);
    if (index < 0)
      throw new LiveOpsValidationError("certification does not exist");
    items[index] = { ...items[index], status: "revoked" };
    return cloneCertification(items[index]);
  }

  translate(value: GameTranslation): GameTranslation {
    const game = this.require(value.gameId);
    const translation = validateTranslation({ ...value, gameId: game.id });
    const translations = this.#translations.get(game.id)!;
    const current = translations.get(translation.locale);
    if (current && translation.version !== current.version + 1)
      throw new LiveOpsConflictError(
        "translation version does not follow current version",
      );
    if (!current && translation.version !== 1)
      throw new LiveOpsConflictError(
        "new translation must begin at version one",
      );
    translations.set(translation.locale, translation);
    return cloneTranslation(translation);
  }

  localized(
    gameId: string,
    locale: string,
    fallback = "en",
  ): GameTranslation | undefined {
    const translations = this.#translations.get(gameId.trim());
    const value =
      translations?.get(normalizeLocale(locale)) ??
      translations?.get(normalizeLocale(fallback));
    return value ? cloneTranslation(value) : undefined;
  }

  available(query: GameQuery = {}, at = new Date()): readonly GameDefinition[] {
    const country = query.country?.trim().toUpperCase();
    const currency = query.currency?.trim().toUpperCase();
    const text = query.text?.trim().toLocaleLowerCase();
    return [...this.#games.values()]
      .filter((game) => !query.category || game.category === query.category)
      .filter(
        (game) => !query.lifecycle || query.lifecycle.includes(game.lifecycle),
      )
      .filter((game) => !currency || game.currencies.includes(currency))
      .filter(
        (game) =>
          !country ||
          ((!game.countries.length || game.countries.includes(country)) &&
            !game.blockedCountries.includes(country)),
      )
      .filter((game) => !query.device || game.devices.includes(query.device))
      .filter(
        (game) =>
          !query.tag || game.tags.includes(query.tag.toLocaleLowerCase()),
      )
      .filter((game) => !query.provider || game.provider === query.provider)
      .filter(
        (game) =>
          query.demoAvailable === undefined ||
          game.demoAvailable === query.demoAvailable,
      )
      .filter(
        (game) =>
          !text ||
          `${game.name} ${game.tags.join(" ")} ${game.themes.join(" ")}`
            .toLocaleLowerCase()
            .includes(text),
      )
      .filter(
        (game) =>
          game.lifecycle !== "live" ||
          this.hasCurrentCertification(game.id, at),
      )
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.id.localeCompare(right.id),
      )
      .map(cloneGame);
  }

  game(gameId: string): GameDefinition | undefined {
    const value = this.#games.get(gameId.trim());
    return value ? cloneGame(value) : undefined;
  }

  certifications(gameId: string): readonly GameCertification[] {
    return (this.#certifications.get(gameId.trim()) ?? []).map(
      cloneCertification,
    );
  }

  private hasCurrentCertification(gameId: string, at: Date): boolean {
    const certifications = this.#certifications.get(gameId) ?? [];
    return certifications.some(
      (item) =>
        item.status === "valid" &&
        new Date(item.issuedAt) <= at &&
        (!item.expiresAt || new Date(item.expiresAt) > at),
    );
  }

  private require(gameId: string): GameDefinition {
    const value = this.#games.get(liveOpsText(gameId, "game id"));
    if (!value) throw new LiveOpsValidationError("game does not exist");
    return value;
  }
}

function validateGame(value: GameDefinition): GameDefinition {
  const id = liveOpsText(value.id, "game id");
  const slug = liveOpsText(value.slug, "game slug").toLocaleLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new LiveOpsValidationError("game slug is invalid");
  if (
    value.minimumStakeMinor <= 0n ||
    value.maximumStakeMinor < value.minimumStakeMinor
  )
    throw new LiveOpsValidationError("game stake limits are invalid");
  if (
    !Number.isSafeInteger(value.theoreticalReturnBasisPoints) ||
    value.theoreticalReturnBasisPoints < 0 ||
    value.theoreticalReturnBasisPoints > 10_000
  )
    throw new LiveOpsValidationError("theoretical return is invalid");
  return {
    ...value,
    id,
    slug,
    name: liveOpsText(value.name, "game name"),
    provider: liveOpsText(value.provider, "game provider"),
    currencies: normalizedList(value.currencies, true),
    countries: normalizedList(value.countries, true),
    blockedCountries: normalizedList(value.blockedCountries, true),
    devices: [...new Set(value.devices)].sort(),
    tags: normalizedList(value.tags),
    themes: normalizedList(value.themes),
    metadata: { ...value.metadata },
  };
}

function validateCertification(value: GameCertification): GameCertification {
  const issuedAt = liveOpsDate(value.issuedAt, "certificate issue date");
  const expiresAt = value.expiresAt
    ? liveOpsDate(value.expiresAt, "certificate expiry")
    : undefined;
  if (expiresAt && expiresAt <= issuedAt)
    throw new LiveOpsValidationError(
      "certificate expiry must follow issue date",
    );
  return {
    ...value,
    id: liveOpsText(value.id, "certification id"),
    gameId: liveOpsText(value.gameId, "game id"),
    jurisdiction: liveOpsText(value.jurisdiction, "jurisdiction").toUpperCase(),
    laboratory: liveOpsText(value.laboratory, "laboratory"),
    certificateNumber: liveOpsText(
      value.certificateNumber,
      "certificate number",
    ),
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt?.toISOString(),
    documents: normalizedList(value.documents),
  };
}

function validateTranslation(value: GameTranslation): GameTranslation {
  return {
    ...value,
    locale: normalizeLocale(value.locale),
    name: liveOpsText(value.name, "translated name"),
    description: liveOpsText(value.description, "translated description"),
    instructions: value.instructions.map((item) =>
      liveOpsText(item, "instruction"),
    ),
  };
}

function normalizeLocale(value: string): string {
  const locale = liveOpsText(value, "locale").replace("_", "-");
  if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(locale))
    throw new LiveOpsValidationError("locale is invalid");
  return locale;
}
function normalizedList(
  values: readonly string[],
  uppercase = false,
): string[] {
  return [
    ...new Set(
      values.map((value) => {
        const normalized = liveOpsText(value, "list item");
        return uppercase
          ? normalized.toUpperCase()
          : normalized.toLocaleLowerCase();
      }),
    ),
  ].sort();
}
function cloneGame(value: GameDefinition): GameDefinition {
  return {
    ...value,
    currencies: [...value.currencies],
    countries: [...value.countries],
    blockedCountries: [...value.blockedCountries],
    devices: [...value.devices],
    tags: [...value.tags],
    themes: [...value.themes],
    metadata: { ...value.metadata },
  };
}
function cloneCertification(value: GameCertification): GameCertification {
  return { ...value, documents: [...value.documents] };
}
function cloneTranslation(value: GameTranslation): GameTranslation {
  return { ...value, instructions: [...value.instructions] };
}
