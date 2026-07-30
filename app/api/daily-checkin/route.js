import { casinoDatabase } from "../../../lib/database/mongo";
import { nextDailyCheckIn } from "../../../lib/domain/daily-rewards";
import { addCasinoChips, readTokenBalances } from "../../../lib/domain/token-balances";
import { jsonError, jsonSuccess, readJsonObject } from "../../../lib/http/responses";
import { chatIdFilter, InvalidChatIdError } from "../../../lib/validation/chat-id";

export async function POST(req) {
  try {
    const { chatId } = await readJsonObject(req);

    if (!chatId) {
      return jsonError("Missing chatId", 400, "missing_chat_id");
    }

    const db = await casinoDatabase();
    const users = db.collection("users");
    const user = await users.findOne(chatIdFilter(chatId));
    if (!user) {
      return jsonError("User not found", 404, "user_not_found");
    }

    const award = nextDailyCheckIn(user);
    const balances = addCasinoChips(readTokenBalances(user), award.reward);

    // Update the user's record with the new token balance, today's check-in date, and streak.
    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          casino_chips: balances.casino_chips,
          dailyCheckinDate: award.date,
          dailyCheckinStreak: award.streak,
          updatedAt: new Date(),
        },
      }
    );

    return jsonSuccess({
      newBalance: balances.casino_chips,
      reward: award.reward,
      streak: award.streak,
      date: award.date,
    });
  } catch (error) {
    if (error instanceof InvalidChatIdError || error instanceof RangeError || error instanceof TypeError) {
      return jsonError(error.message, 400, "invalid_request");
    }
    console.error("Error processing daily check-in:", error);
    return jsonError("Internal server error", 500, "internal_error");
  }
}
