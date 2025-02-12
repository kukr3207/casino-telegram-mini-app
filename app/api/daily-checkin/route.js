// File: app/api/daily-checkin/route.js
import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    // Expected payload: { chatId, date, streak, reward }
    const { chatId, date, streak, reward } = await req.json();

    if (!chatId || !date || streak === undefined || reward === undefined) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400 }
      );
    }

    console.log("Processing daily check-in for chatId:", chatId);

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("casino-mini-app");
    const users = db.collection("users");

    // Convert chatId if needed (number or string)
    const numericChatId = isNaN(chatId) ? chatId : parseFloat(chatId);
    let user = await users.findOne({ chatId: numericChatId });
    if (!user) {
      user = await users.findOne({ chatId: chatId.toString() });
    }
    if (!user) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404 }
      );
    }

    // If the user already checked in today, return an error.
    if (user.dailyCheckinDate === date) {
      await client.close();
      return new Response(
        JSON.stringify({ error: "Already checked in today" }),
        { status: 400 }
      );
    }

    const currentTokens = user.casino_chips || 0;
    const updatedTokens = currentTokens + reward;

    // Update the user's record with the new token balance, today's check-in date, and streak.
    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          casino_chips: updatedTokens,
          dailyCheckinDate: date,
          dailyCheckinStreak: streak,
          updatedAt: new Date(),
        },
      }
    );

    await client.close();
    console.log("Daily check-in updated successfully.");

    return new Response(
      JSON.stringify({ success: true, newBalance: updatedTokens }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Error processing daily check-in:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500 }
    );
  }
}
