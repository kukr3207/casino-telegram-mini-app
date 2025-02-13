import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    const { chatId } = await req.json();
    if (!chatId) {
      return new Response(
        JSON.stringify({ error: "Missing chatId" }),
        { status: 400 }
      );
    }
    
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("casino-mini-app");
    const users = db.collection("users");
    
    const numericChatId = isNaN(chatId) ? chatId : parseFloat(chatId);
    let user = await users.findOne({ chatId: numericChatId });
    if (!user) {
      user = await users.findOne({ chatId: chatId.toString() });
    }
    if (!user) {
      await client.close();
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404 }
      );
    }
    
    await users.updateOne(
      { _id: user._id },
      { $inc: { dailyGamesPlayed: 1 }, $set: { updatedAt: new Date() } }
    );
    
    await client.close();
    return new Response(
      JSON.stringify({ message: "Counter incremented" }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Error incrementing dice roll counter:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500 }
    );
  }
}
