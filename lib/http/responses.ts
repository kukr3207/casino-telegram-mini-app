export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
} as const;

/**
 * Create a JSON response with consistent headers. Undefined object properties
 * are omitted by JSON.stringify, matching the platform Response behavior.
 */
export function jsonResponse(payload: JsonValue, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS,
  });
}

export function jsonSuccess(
  data: { [key: string]: JsonValue | undefined } = {},
  status = 200,
): Response {
  return jsonResponse({ success: true, ...data }, status);
}

export function jsonError(
  message: string,
  status: number,
  code?: string,
): Response {
  const error = message.trim() || "Request failed";
  return jsonResponse(
    {
      error,
      ...(code ? { code } : {}),
    },
    status,
  );
}

export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new TypeError("Request body must contain valid JSON");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Request body must be a JSON object");
  }

  return value as Record<string, unknown>;
}

