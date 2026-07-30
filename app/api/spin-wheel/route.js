import { casinoDatabase } from "../../../lib/database/mongo";
import { recordWheelSpin } from "../../../lib/database/game-history";
import { WHEEL_OUTCOMES } from "../../../lib/domain/wheel-outcomes";
import { jsonError, jsonResponse, readJsonObject } from "../../../lib/http/responses";
import { selectVerifiableOutcome } from "../../../lib/security/fair-random";
import { chatIdFilter, InvalidChatIdError, parseChatId } from "../../../lib/validation/chat-id";

export async function POST(req) {
  try {
    const { chatId } = await readJsonObject(req);
    if (!chatId) {
      return jsonError("Missing chatId", 400, "missing_chat_id");
    }

    const db = await casinoDatabase();
    const users = db.collection("users");
    const normalizedChatId = parseChatId(chatId);
    const user = await users.findOne(chatIdFilter(chatId));
    if (!user) {
      return jsonError("User not found", 404, "user_not_found");
    }

    // Prevent multiple spins in one day
    const today = new Date().toISOString().split("T")[0];
    if (user.dailySpinDate === today) {
      return jsonError("Already spun today", 400, "already_spun");
    }

    // Define outcomes (the order should match your front-end display)
    const selection = selectVerifiableOutcome(WHEEL_OUTCOMES);
    const { outcome } = selection;

    // If a token outcome, update token balance; if booster, store booster info.
    let newBalance = user.casino_chips || 0;
    if (outcome.type === "token") {
      newBalance += outcome.value;
    } else if (outcome.type === "booster") {
      // Insert a booster document with a 24-hour TTL.
      const boosters = db.collection("boosters");
      // Ensure a TTL index exists on 'createdAt' (expires after 86400 seconds)
      await boosters.createIndex({ createdAt: 1 }, { expireAfterSeconds: 86400 });
      await boosters.insertOne({
        chatId: normalizedChatId,
        boosterValue: outcome.value,
        createdAt: new Date(),
        claimed: false, // Mark as unclaimed initially
      });
    }

    // Update the user's record: set dailySpinDate and, if token, update balance.
    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          casino_chips: newBalance,
          dailySpinDate: today,
          updatedAt: new Date(),
        },
      }
    );

    await recordWheelSpin(normalizedChatId, selection);

    return jsonResponse(selection);
  } catch (error) {
    if (error instanceof InvalidChatIdError || error instanceof TypeError) {
      return jsonError(error.message, 400, "invalid_request");
    }
    console.error("Error processing spin wheel:", error);
    return jsonError("Internal server error", 500, "internal_error");
  }
}
