import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGO_URI);

export async function GET(req) {
  try {
    await client.connect();
    const db = client.db("casino-mini-app");
    const users = db.collection("users");

    // Replace `chatId` with the relevant user's identifier from the session
    const chatId = "YOUR_LOGGED_IN_CHAT_ID"; 
    const user = await users.findOne({ chatId });

    if (!user) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
      });
    }

    const { token1, token2, token3 } = user;

    return new Response(JSON.stringify({ token1, token2, token3 }), {
      status: 200,
    });
  } catch (error) {
    console.error("Error fetching tokens:", error);
    return new Response(JSON.stringify({ error: "Database error" }), {
      status: 500,
    });
  } finally {
    await client.close();
  }
}
