import { randomUUID } from "node:crypto";
import { SupportConflictError, SupportValidationError, required, validDate } from "./tickets.ts";

export interface KnowledgeArticle {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  locale: string;
  category: string;
  tags: readonly string[];
  status: "draft" | "published" | "retired";
  createdAt: Date;
  updatedAt: Date;
  publishedAt?: Date;
  version: number;
}

export class KnowledgeBase {
  private readonly articles = new Map<string, KnowledgeArticle>();
  private readonly slugs = new Map<string, string>();

  create(input: Pick<KnowledgeArticle, "slug" | "title" | "summary" | "body" | "locale" | "category" | "tags">, at = new Date()): KnowledgeArticle {
    const normalized = normalizeArticle({
      ...input,
      id: randomUUID(),
      status: "draft",
      createdAt: at,
      updatedAt: at,
      version: 1,
    });
    const key = slugKey(normalized.slug, normalized.locale);
    if (this.slugs.has(key)) throw new SupportConflictError("knowledge article slug already exists for locale");
    this.articles.set(normalized.id, normalized);
    this.slugs.set(key, normalized.id);
    return cloneArticle(normalized);
  }

  update(articleId: string, expectedVersion: number, changes: Partial<Pick<KnowledgeArticle, "title" | "summary" | "body" | "category" | "tags">>, at = new Date()): KnowledgeArticle {
    const current = this.requireVersion(articleId, expectedVersion);
    if (current.status === "retired") throw new SupportConflictError("retired article cannot be edited");
    const updated = normalizeArticle({ ...current, ...changes, updatedAt: at, version: current.version + 1 });
    this.articles.set(updated.id, updated);
    return cloneArticle(updated);
  }

  publish(articleId: string, expectedVersion: number, at = new Date()): KnowledgeArticle {
    const current = this.requireVersion(articleId, expectedVersion);
    if (current.status === "retired") throw new SupportConflictError("retired article cannot be published");
    const now = validDate(at);
    const updated = { ...current, status: "published" as const, publishedAt: current.publishedAt ?? now, updatedAt: now, version: current.version + 1 };
    this.articles.set(updated.id, updated);
    return cloneArticle(updated);
  }

  retire(articleId: string, expectedVersion: number, at = new Date()): KnowledgeArticle {
    const current = this.requireVersion(articleId, expectedVersion);
    const updated = { ...current, status: "retired" as const, updatedAt: validDate(at), version: current.version + 1 };
    this.articles.set(updated.id, updated);
    return cloneArticle(updated);
  }

  find(slug: string, locale: string): KnowledgeArticle | undefined {
    const localized = this.slugs.get(slugKey(slug, locale));
    const fallback = this.slugs.get(slugKey(slug, locale.split("-")[0])) ?? this.slugs.get(slugKey(slug, "en"));
    const article = this.articles.get(localized ?? fallback ?? "");
    return article?.status === "published" ? cloneArticle(article) : undefined;
  }

  search(query: string, locale: string, limit = 10): readonly KnowledgeArticle[] {
    const terms = required(query, "search query").toLowerCase().split(/\s+/);
    return [...this.articles.values()]
      .filter((article) => article.status === "published" && (article.locale === locale || article.locale === locale.split("-")[0] || article.locale === "en"))
      .map((article) => ({ article, score: scoreArticle(article, terms) }))
      .filter((result) => result.score > 0)
      .sort((left, right) => right.score - left.score || left.article.title.localeCompare(right.article.title))
      .slice(0, limit)
      .map((result) => cloneArticle(result.article));
  }

  private requireVersion(articleId: string, expectedVersion: number): KnowledgeArticle {
    const current = this.articles.get(required(articleId, "article id"));
    if (!current) throw new SupportValidationError("knowledge article does not exist");
    if (current.version !== expectedVersion) throw new SupportConflictError("knowledge article version does not match");
    return current;
  }
}

function normalizeArticle(value: KnowledgeArticle): KnowledgeArticle {
  const slug = required(value.slug, "article slug").toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new SupportValidationError("article slug is invalid");
  return {
    ...value,
    slug,
    title: required(value.title, "article title"),
    summary: required(value.summary, "article summary"),
    body: required(value.body, "article body"),
    locale: required(value.locale, "article locale"),
    category: required(value.category, "article category").toLowerCase(),
    tags: [...new Set(value.tags.map((tag) => required(tag, "article tag").toLowerCase()))].sort(),
    createdAt: validDate(value.createdAt),
    updatedAt: validDate(value.updatedAt),
  };
}

function slugKey(slug: string, locale: string): string {
  return `${slug.trim().toLowerCase()}:${locale.trim()}`;
}

function scoreArticle(article: KnowledgeArticle, terms: readonly string[]): number {
  const title = article.title.toLowerCase();
  const summary = article.summary.toLowerCase();
  const body = article.body.toLowerCase();
  return terms.reduce((score, term) => (
    score
      + (title.includes(term) ? 5 : 0)
      + (article.tags.includes(term) ? 4 : 0)
      + (summary.includes(term) ? 2 : 0)
      + (body.includes(term) ? 1 : 0)
  ), 0);
}

function cloneArticle(value: KnowledgeArticle): KnowledgeArticle {
  return {
    ...value,
    tags: [...value.tags],
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
    publishedAt: value.publishedAt ? new Date(value.publishedAt) : undefined,
  };
}

