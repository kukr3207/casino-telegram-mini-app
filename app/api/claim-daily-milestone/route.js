import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    const body = await req.json();
    const { chatId, date, reward } = body;
    if (!chatId || !date || reward === undefined) {
      return new Response(JSON.stringify({ error: "Missing parameters" }), { status: 400 });
    }

    // Convert chatId to a number (assumes chatId is stored as int32)
    const numericChatId = parseInt(chatId);
    if (isNaN(numericChatId)) {
      return new Response(JSON.stringify({ error: "Invalid chatId format" }), { status: 400 });
    }

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("casino-mini-app");
    const users = db.collection("users");

    const user = await users.findOne({ chatId: numericChatId });
    if (!user) {
      await client.close();
      return new Response(JSON.stringify({ error: "User not found" }), { status: 404 });
    }

    const oldBalance = user.casino_chips || 0;
    const newBalance = oldBalance + reward;

    // Update the user's balance and mark milestone as claimed.
    await users.updateOne(
      { chatId: numericChatId },
      { $set: { casino_chips: newBalance, milestoneClaimed: true, milestoneClaimDate: date } }
    );

    await client.close();

    return new Response(JSON.stringify({ newBalance }), { status: 200 });
  } catch (error) {
    console.error("Error claiming milestone:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
  }
}
