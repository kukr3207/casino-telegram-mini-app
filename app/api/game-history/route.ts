import { listGameHistory } from "../../../lib/database/game-history";
import {
  parseBefore,
  parseGameFilter,
  parseHistoryLimit,
} from "../../../lib/domain/game-history";
import { jsonError, jsonResponse } from "../../../lib/http/responses";
import { InvalidChatIdError, parseChatId } from "../../../lib/validation/chat-id";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const rawChatId = url.searchParams.get("chatId");
    if (!rawChatId) {
      return jsonError("Chat ID is required", 400, "missing_chat_id");
    }

    const chatId = parseChatId(rawChatId);
    const limit = parseHistoryLimit(url.searchParams.get("limit"));
    const game = parseGameFilter(url.searchParams.get("game"));
    const before = parseBefore(url.searchParams.get("before"));
    const page = await listGameHistory(chatId, { limit, game, before });

    return jsonResponse({
      records: page.records,
      summary: page.summary,
      nextBefore: page.nextBefore,
    });
  } catch (error) {
    if (error instanceof InvalidChatIdError || error instanceof RangeError) {
      return jsonError(error.message, 400, "invalid_request");
    }
    console.error("Error loading game history:", error);
    return jsonError("Unable to load game history", 500, "history_unavailable");
  }
}

