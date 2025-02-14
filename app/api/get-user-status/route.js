import { MongoClient } from "mongodb";

export async function GET(req) {
  try {
    // Extract chatId from the query parameters
    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get("chatId");

    if (!chatId) {
      return new Response(
        JSON.stringify({ error: "Missing chatId" }),
        { status: 400 }
      );
    }

    // Convert chatId to an Int32 (MongoDB stores it as Int32)
    const numericChatId = parseInt(chatId, 10);
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

    // Find user by numeric chatId (ensuring Int32 consistency)
    let user = await users.findOne({ chatId: numericChatId });

    if (!user) {
      await client.close();
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404 }
      );
    }

    // Query the dice-roll collection to count today's dice roll games
    const rolls = db.collection("dice-roll");

    // 🔹 Step 1: Get today's UTC date range (IMPORTANT: Matches MongoDB's stored format)
    const now = new Date();
    const startOfDayUTC = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0);
    const endOfDayUTC = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999);

    console.log(`🔍 Debug: Checking dice-rolls for chatId ${numericChatId} between ${startOfDayUTC} and ${endOfDayUTC}`);

    // 🔹 Step 2: Query for today's dice rolls
    const dailyRollCount = await rolls.countDocuments({
      chatId: numericChatId, // Ensure it is treated as Int32
      createdAt: { $gte: startOfDayUTC, $lte: endOfDayUTC }
    });

    console.log(`✅ Debug: Found ${dailyRollCount} dice-roll games for chatId ${numericChatId}`);

    await client.close();

    // Return user status with the daily dice roll games count
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
    console.error("❌ Error fetching user status:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500 }
    );
  }
}
