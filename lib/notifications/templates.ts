import type { NotificationCategory, NotificationContent } from "./types.ts";
import { NotificationValidationError, requiredText } from "./types.ts";

export interface NotificationTemplate {
  id: string;
  category: NotificationCategory;
  locale: string;
  subject?: string;
  text: string;
  requiredVariables: readonly string[];
  actionUrl?: string;
  version: number;
}

export class NotificationTemplateRegistry {
  private readonly templates = new Map<string, NotificationTemplate>();

  register(template: NotificationTemplate): NotificationTemplate {
    const normalized = normalizeTemplate(template);
    const key = templateKey(normalized.id, normalized.locale);
    const existing = this.templates.get(key);
    if (existing && normalized.version <= existing.version) {
      throw new NotificationValidationError("template version must increase");
    }
    this.templates.set(key, normalized);
    return cloneTemplate(normalized);
  }

  render(id: string, locale: string, variables: Readonly<Record<string, string>>): NotificationContent {
    const template = this.resolve(id, locale);
    const missing = template.requiredVariables.filter((name) => variables[name] === undefined);
    if (missing.length > 0) {
      throw new NotificationValidationError(`missing template variables: ${missing.join(", ")}`);
    }
    return {
      subject: template.subject ? interpolate(template.subject, variables) : undefined,
      text: interpolate(template.text, variables),
      actionUrl: template.actionUrl ? interpolate(template.actionUrl, variables) : undefined,
      data: { templateId: template.id, templateVersion: String(template.version), locale: template.locale },
    };
  }

  get(id: string, locale: string): NotificationTemplate | undefined {
    const found = this.templates.get(templateKey(id.trim(), locale.trim().toLowerCase()));
    return found ? cloneTemplate(found) : undefined;
  }

  private resolve(id: string, locale: string): NotificationTemplate {
    const normalizedId = requiredText(id, "template id", 128);
    const normalizedLocale = requiredText(locale, "locale", 16).toLowerCase();
    const localized = this.templates.get(templateKey(normalizedId, normalizedLocale));
    const language = normalizedLocale.split("-")[0];
    const fallback = this.templates.get(templateKey(normalizedId, language))
      ?? this.templates.get(templateKey(normalizedId, "en"));
    const template = localized ?? fallback;
    if (!template) throw new NotificationValidationError("notification template does not exist");
    return template;
  }
}

function normalizeTemplate(template: NotificationTemplate): NotificationTemplate {
  const id = requiredText(template.id, "template id", 128);
  const locale = requiredText(template.locale, "locale", 16).toLowerCase();
  const text = requiredText(template.text, "template text", 10_000);
  if (!Number.isInteger(template.version) || template.version <= 0) {
    throw new NotificationValidationError("template version must be a positive integer");
  }
  const variables = [...new Set(template.requiredVariables.map((name) => requiredText(name, "variable", 64)))];
  for (const token of extractVariables(`${template.subject ?? ""}\n${text}\n${template.actionUrl ?? ""}`)) {
    if (!variables.includes(token)) {
      throw new NotificationValidationError(`undeclared template variable: ${token}`);
    }
  }
  return {
    ...template,
    id,
    locale,
    text,
    subject: template.subject?.trim(),
    actionUrl: template.actionUrl?.trim(),
    requiredVariables: variables,
  };
}

function extractVariables(value: string): string[] {
  return [...value.matchAll(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g)].map((match) => match[1]);
}

function interpolate(value: string, variables: Readonly<Record<string, string>>): string {
  return value.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (_match, name: string) => variables[name]);
}

function templateKey(id: string, locale: string): string {
  return `${id}:${locale}`;
}

function cloneTemplate(template: NotificationTemplate): NotificationTemplate {
  return { ...template, requiredVariables: [...template.requiredVariables] };
}
