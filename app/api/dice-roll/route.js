import { casinoDatabase } from "../../../lib/database/mongo";
import { jsonError, jsonResponse, readJsonObject } from "../../../lib/http/responses";
import { rollVerifiableDice } from "../../../lib/security/fair-random";
import { parseChatId, InvalidChatIdError } from "../../../lib/validation/chat-id";

async function rollsCollection() {
  return (await casinoDatabase()).collection("dice-rolls");
}

export async function POST(req) {
  try {
    const { chatId } = await readJsonObject(req);
    const normalizedChatId = parseChatId(chatId);
    const roll = rollVerifiableDice();
    const rolls = await rollsCollection();

    await rolls.insertOne({
      chatId: normalizedChatId,
      ...roll,
      createdAt: new Date()
    });

    return jsonResponse(roll);
  } catch (error) {
    if (error instanceof InvalidChatIdError || error instanceof TypeError) {
      return jsonError(error.message, 400, "invalid_request");
    }
    console.error("❌ Error generating roll:", error);
    return jsonError("Internal server error", 500, "internal_error");
  }
}

export async function GET() {
  try {
    const rolls = await rollsCollection();
    const lastRoll = await rolls.findOne({}, { sort: { createdAt: -1 } });

    if (!lastRoll) {
      return jsonError("No roll found", 404, "roll_not_found");
    }

    return jsonResponse(JSON.parse(JSON.stringify(lastRoll)));
  } catch (error) {
    console.error("❌ Error fetching roll:", error);
    return jsonError("Internal server error", 500, "internal_error");
  }
}
