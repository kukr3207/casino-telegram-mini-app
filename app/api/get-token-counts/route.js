import { casinoDatabase } from "../../../lib/database/mongo";
import { readTokenBalances } from "../../../lib/domain/token-balances";
import { jsonError, jsonResponse } from "../../../lib/http/responses";
import { chatIdFilter, InvalidChatIdError } from "../../../lib/validation/chat-id";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get("chatId");

    if (!chatId) {
      return jsonError("Chat ID is required", 400, "missing_chat_id");
    }

    const db = await casinoDatabase();
    const users = db.collection("users");
    const user = await users.findOne(chatIdFilter(chatId));

    if (!user) {
      return jsonError("User not found", 404, "user_not_found");
    }

    return jsonResponse({ tokenCounts: readTokenBalances(user) });
  } catch (error) {
    if (error instanceof InvalidChatIdError) {
      return jsonError(error.message, 400, "invalid_chat_id");
    }
    console.error("Error fetching token counts:", error);
    return jsonError("Internal server error", 500, "internal_error");
  }
}
