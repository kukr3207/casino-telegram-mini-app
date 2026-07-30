import { casinoDatabase } from "../../../lib/database/mongo";
import { addCasinoChips, readTokenBalances } from "../../../lib/domain/token-balances";
import { jsonError, jsonSuccess, readJsonObject } from "../../../lib/http/responses";
import { chatIdFilter, InvalidChatIdError } from "../../../lib/validation/chat-id";

export async function POST(req) {
  try {
    const { chatId, tokens } = await readJsonObject(req);
    
    if (!chatId || tokens === undefined) {
      return jsonError("Missing required fields", 400, "missing_fields");
    }

    const db = await casinoDatabase();
    const users = db.collection("users");
    const user = await users.findOne(chatIdFilter(chatId));

    if (!user) {
      return jsonError("User not found", 404, "user_not_found");
    }

    const balances = addCasinoChips(readTokenBalances(user), tokens);

    // Update the existing record (DO NOT create a new one)
    await users.updateOne(
      { _id: user._id }, // Use `_id` to ensure correct document is updated
      {
        $set: {
          casino_chips: balances.casino_chips,
          updatedAt: new Date(),
        },
      }
    );

    return jsonSuccess({ newBalance: balances.casino_chips });
  } catch (error) {
    if (error instanceof InvalidChatIdError || error instanceof RangeError || error instanceof TypeError) {
      return jsonError(error.message, 400, "invalid_request");
    }
    console.error("Error updating tokens:", error);
    return jsonError("Internal server error", 500, "internal_error");
  }
}
