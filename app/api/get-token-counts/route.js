import { MongoClient } from "mongodb";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    let chatId = searchParams.get("chatId");

    if (!chatId) {
      return new Response(
        JSON.stringify({ error: "Chat ID is required" }),
        { status: 400 }
      );
    }

    console.log("Received chatId:", chatId);

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    console.log("Connected to database");

    const db = client.db("casino-mini-app");
    const users = db.collection("users");

    // Convert chatId to a number if needed
    chatId = isNaN(chatId) ? chatId : parseFloat(chatId);

    // Try finding the user (string or number chatId)
    let user = await users.findOne({ chatId });

    if (!user) {
      console.warn("User not found, retrying with alternative type...");
      user = await users.findOne({ chatId: chatId.toString() });
    }

    if (!user) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404 }
      );
    }

    const tokenCounts = {
      casino_chips: user.casino_chips || 0,
      hol_tokens: user.hol_tokens || 0,
      withdraw_tokens: user.withdraw_tokens || 0,
    };

    await client.close();
    console.log("Database connection closed");

    return new Response(
      JSON.stringify({ tokenCounts }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching token counts:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500 }
    );
  }
}