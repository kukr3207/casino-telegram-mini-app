// File: app/api/convert-tokens/route.js
import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    const { chatId, percentage } = await req.json();
    if (!chatId || !percentage) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400 }
      );
    }

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("casino-mini-app");
    const users = db.collection("users");

    // Convert chatId to proper type
    const numericChatId = isNaN(chatId) ? chatId : parseFloat(chatId);
    let user = await users.findOne({ chatId: numericChatId });
    if (!user) {
      user = await users.findOne({ chatId: chatId.toString() });
    }
    if (!user) {
      await client.close();
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404 }
      );
    }

    // Calculate conversion amount based on percentage
    const currentWithdraw = user.withdraw_tokens || 0;
    const convertAmount = Math.floor(currentWithdraw * (percentage / 100));
    if (convertAmount <= 0) {
      await client.close();
      return new Response(
        JSON.stringify({ error: "Insufficient withdrawable tokens" }),
        { status: 400 }
      );
    }

    // Update: subtract from withdraw_tokens and add to casino_chips (1:1 conversion)
    const currentCasino = user.casino_chips || 0;
    const newCasino = currentCasino + convertAmount;
    const newWithdraw = currentWithdraw - convertAmount;

    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          casino_chips: newCasino,
          withdraw_tokens: newWithdraw,
          updatedAt: new Date(),
        },
      }
    );

    await client.close();

    return new Response(
      JSON.stringify({
        success: true,
        newCasinoChips: newCasino,
        newWithdrawTokens: newWithdraw,
      }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Error converting tokens:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500 }
    );
  }
}
