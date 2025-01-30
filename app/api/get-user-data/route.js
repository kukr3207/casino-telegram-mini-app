import { MongoClient } from "mongodb";

export async function GET(req) {
  try {
    // Get chatId from query parameters
    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get("chatId");

    if (!chatId) {
      return new Response(JSON.stringify({ error: "Missing chat ID" }), {
        status: 400,
      });
    }

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("casino-mini-app");
    const users = db.collection("users");

    // Ensure chatId is stored as a string in MongoDB
    const user = await users.findOne({ chatId: String(chatId) });

    if (!user) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
      });
    }

    // Fetch token counts
    const tokenCounts = {
      casino_chips: user.casino_chips || 0,
      withdraw_tokens: user.withdraw_tokens || 0,
      hol_tokens: user.hol_tokens || 0,
    };

    await client.close();

    return new Response(
      JSON.stringify({ tokenCounts, userDetails: user }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching user data:", error);
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      { status: 500 }
    );
  }
}
