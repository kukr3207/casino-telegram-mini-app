import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    const { chatId, tokens } = await req.json();
    if (!chatId) {
      return new Response(JSON.stringify({ error: "Chat ID is required" }), { status: 400 });
    }

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("casino-mini-app");
    const users = db.collection("users");

    await users.updateOne(
      { chatId },
      { $inc: { casino_chips: tokens } },
      { upsert: true }
    );

    await client.close();
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    console.error("Error updating casino chips:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
  }
}
