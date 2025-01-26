import { MongoClient } from "mongodb";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get("chatId");

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

    // First, try to find the user with chatId as a string
    let user = await users.findOne({ chatId: chatId });
    console.warn("User found with string chatId:", user);

    // If not found, try to find the user with chatId as a number
    if (!user) {
      console.warn("No user found with string chatId. Trying with number...");
      user = await users.findOne({ chatId: Number(chatId) });
      console.warn("User found with number chatId:", user);
    }

    if (!user) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404 }
      );
    }

    const tokenCounts = {
      token1: user.casino_chips || 0,
      token2: user.hol_tokens || 0,
      token3: user.withdraw_tokens || 0,
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
