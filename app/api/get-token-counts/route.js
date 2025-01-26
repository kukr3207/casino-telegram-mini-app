import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGO_URI);

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const chatId = url.searchParams.get("chatId"); // Retrieve `chatId` from query params

    if (!chatId) {
      return new Response(JSON.stringify({ error: "Chat ID is required" }), {
        status: 400,
      });
    }

    await client.connect();
    const db = client.db("casino-mini-app");
    const users = db.collection("users");

    const user = await users.findOne({ chatId });

    if (!user) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
      });
    }

    const { token1, token2, token3 } = user;

    return new Response(
      JSON.stringify({
        token1: token1 || 0,
        token2: token2 || 0,
        token3: token3 || 0,
      }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching tokens:", error);
    return new Response(JSON.stringify({ error: "Database error" }), {
      status: 500,
    });
  } finally {
    await client.close();
  }
}
