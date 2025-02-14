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

    // Convert chatId to a number (chatId is stored as int32)
    const numericChatId = parseInt(chatId);
    if (isNaN(numericChatId)) {
      console.warn(`⚠️ Debug: Invalid chatId format received: ${chatId}`);
      return new Response(JSON.stringify({ error: "Invalid chatId format" }), { status: 400 });
    }

    console.log("🔍 Debug: MONGO_URI in use:", process.env.MONGO_URI);

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("casino-mini-app");

    // List available collections for confirmation.
    const collections = await db.listCollections().toArray();
    console.log("✅ Debug: Available collections:", collections.map(col => col.name));

    const users = db.collection("users");
    console.log(`🔍 Debug: Searching user with chatId ${numericChatId}`);
    const user = await users.findOne({ chatId: numericChatId });
    if (!user) {
      console.warn(`⚠️ Debug: No user found for chatId ${numericChatId}`);
      await client.close();
      return new Response(JSON.stringify({ error: "User not found" }), { status: 404 });
    }
    console.log(`✅ Debug: Found user data for chatId ${numericChatId}`);

    // Hard-coded date boundaries for testing (UTC boundaries for 2025-02-14)
    const startOfDayUTC = new Date("2025-02-14T00:00:00.000Z");
    const endOfDayUTC = new Date("2025-02-14T23:59:59.999Z");
    console.log("🔍 Debug: UTC range for dice-rolls:",
      "startOfDayUTC:", startOfDayUTC.toISOString(),
      "endOfDayUTC:", endOfDayUTC.toISOString()
    );

    // Query dice-roll collection for today's games using createdAt range.
    const rolls = db.collection("dice-roll");
    const dailyRollCount = await rolls.countDocuments({
      chatId: numericChatId,
      createdAt: { $gte: startOfDayUTC, $lte: endOfDayUTC }
    });
    console.log(`✅ Debug: Total dice-roll games played today for chatId ${numericChatId}: ${dailyRollCount}`);

    // Additional debug: count all dice-roll documents for the given chatId (ignoring createdAt)
    const totalRollCount = await rolls.countDocuments({ chatId: numericChatId });
    const sampleDocs = await rolls.find({ chatId: numericChatId }).limit(5).toArray();
    console.log(`✅ Debug: Total dice-roll documents for chatId ${numericChatId} (ignoring date): ${totalRollCount}`);
    console.log(`✅ Debug: Sample dice-roll documents for chatId ${numericChatId}:`, sampleDocs);

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
