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

    // Convert chatId to a number since it's stored as a Double in MongoDB.
    const numericChatId = parseFloat(chatId);
    if (isNaN(numericChatId)) {
      return new Response(
        JSON.stringify({ error: "Invalid chatId format" }),
        { status: 400 }
      );
    }

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("casino-mini-app");
    const users = db.collection("users");

    // Find user by numeric chatId (Double in MongoDB)
    let user = await users.findOne({ chatId: numericChatId });

    if (!user) {
      await client.close();
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404 }
      );
    }

    // Query the dice-roll collection to count today's dice roll games.
    const rolls = db.collection("dice-roll");

    // Get today's date range in UTC
    const now = new Date();
    const startOfDayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const endOfDayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));

    console.log(`Debug: Checking dice-rolls for chatId ${numericChatId} between ${startOfDayUTC} and ${endOfDayUTC}`);

    // Query for today's dice rolls matching the chatId and seed presence
    const dailyRollCount = await rolls.countDocuments({
      chatId: numericChatId, // Now explicitly matching against a Double chatId
      seed: { $exists: true, $ne: null }, // Ensures only valid game records
      createdAt: { $gte: startOfDayUTC, $lte: endOfDayUTC }
    });

    console.log(`Debug: Found ${dailyRollCount} dice-roll games for chatId ${numericChatId}`);

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
