import { MongoClient } from "mongodb";

export async function GET(req) {
  try {
    // Extract chatId from the query parameters.
    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get("chatId");
    if (!chatId) {
      return new Response(
        JSON.stringify({ error: "Missing chatId" }),
        { status: 400 }
      );
    }

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("casino-mini-app");
    const users = db.collection("users");

    // Try to find the user using either a number or string form of chatId.
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

    // Query the dice-roll collection to count today's dice roll games.
    const rolls = db.collection("dice-roll");
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    
    const dailyRollCount = await rolls.countDocuments({
      chatId: numericChatId,
      seed: { $exists: true, $ne: null },
      createdAt: { $gte: startOfDay, $lte: endOfDay }
    });

    await client.close();
    // Return the user status data along with the daily dice roll games count.
    return new Response(
      JSON.stringify({
        casino_chips: user.casino_chips || 0,
        dailyCheckinDate: user.dailyCheckinDate || null,
        dailySpinDate: user.dailySpinDate || null,
        streak: user.streak || 0,
        dailyDiceRollGamesPlayed: dailyRollCount
      }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching user status:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500 }
    );
  }
}
