import { MongoClient } from "mongodb";

export async function GET(req) {
  try {
    // Extract query parameters
    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get("chatId");

    if (!chatId) {
      return new Response(
        JSON.stringify({ error: "Chat ID is required" }),
        { status: 400 }
      );
    }

    console.log("Received chatId:", chatId);

    // Connect to MongoDB
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    console.log("Connected to database");

    const db = client.db("casino-mini-app");
    const users = db.collection("users");

    // Find user by chatId, converting to string for comparison
    const user = await users.findOne({ chatId: chatId.toString() });

    if (!user) {
      console.warn("User not found for chatId:", chatId);
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404 }
      );
    }

    // Extract token counts from the user document
    const tokenCounts = {
      casinoChips: user.casino_chips || 0,
      holTokens: user.hol_tokens || 0,
      withdrawTokens: user.withdraw_tokens || 0,
    };

    console.log("Token counts for user:", tokenCounts);

    await client.close();
    console.log("Database connection closed");

    return new Response(JSON.stringify(tokenCounts), {
      status: 200,
    });
  } catch (error) {
    console.error("Error fetching token counts:", error);
    return new Response(
      JSON.stringify({ error: "Database error" }),
      { status: 500 }
    );
  }
}
