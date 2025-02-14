import { MongoClient } from "mongodb";

export async function GET(req) {
  try {
    console.log("🔍 Debug: Incoming request to get-user-status API");

    // Extract chatId from query parameters.
    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get("chatId");

    if (!chatId) {
      console.warn("⚠️ Debug: Missing chatId in request");
      return new Response(JSON.stringify({ error: "Missing chatId" }), { status: 400 });
    }

    // Convert chatId to a number (ensure it matches MongoDB's data type)
    const numericChatId = parseFloat(chatId);
    if (isNaN(numericChatId)) {
      console.warn(`⚠️ Debug: Invalid chatId format received: ${chatId}`);
      return new Response(JSON.stringify({ error: "Invalid chatId format" }), { status: 400 });
    }

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("casino-mini-app");
    const users = db.collection("users");

    console.log(`🔍 Debug: Searching user with chatId ${numericChatId}`);

    let user = await users.findOne({ chatId: numericChatId });

    if (!user) {
      console.warn(`⚠️ Debug: No user found for chatId ${numericChatId}`);
      await client.close();
      return new Response(JSON.stringify({ error: "User not found" }), { status: 404 });
    }

    console.log(`✅ Debug: Found user data for chatId ${numericChatId}`);

    // Get today's date range in UTC
    const now = new Date();
    const startOfDayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const endOfDayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));

    console.log(`🔍 Debug: Checking dice-rolls for chatId ${numericChatId} between ${startOfDayUTC.toISOString()} and ${endOfDayUTC.toISOString()}`);

    // Query dice-roll collection to count today's games
    const rolls = db.collection("dice-roll");

    // Try finding records using both Int32 and Double chatId
    const sampleRolls = await rolls.find({
      chatId: { $in: [numericChatId, Math.floor(numericChatId)] }, // Ensure both formats match
      createdAt: { $gte: startOfDayUTC, $lte: endOfDayUTC }
    })
    .limit(5)
    .toArray();

    console.log(`✅ Debug: Sample dice-roll documents found for chatId ${numericChatId}:`, sampleRolls);

    // Count total records for today
    const dailyRollCount = await rolls.countDocuments({
      chatId: { $in: [numericChatId, Math.floor(numericChatId)] }, // Ensure both formats match
      createdAt: { $gte: startOfDayUTC, $lte: endOfDayUTC }
    });

    console.log(`✅ Debug: Total dice-roll games played today for chatId ${numericChatId}: ${dailyRollCount}`);

    await client.close();
    
    return new Response(
      JSON.stringify({
        casino_chips: user.casino_chips || 0,
        dailyCheckinDate: user.dailyCheckinDate || null,
        dailySpinDate: user.dailySpinDate || null,
        streak: user.dailyCheckinStreak || 0,
        dailyDiceRollGamesPlayed: dailyRollCount
      }),
      { status: 200 }
    );
  } catch (error) {
    console.error("❌ Error fetching user status:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
  }
}
