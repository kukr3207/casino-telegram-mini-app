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
    
    // Use upsert so that if dailyDiceRollGamesPlayed does not exist, it gets created.
    const result = await users.findOneAndUpdate(
      { _id: user._id },
      { $inc: { dailyDiceRollGamesPlayed: 1 }, $set: { updatedAt: new Date() } },
      { returnDocument: "after", upsert: true }
    );
    
    await client.close();
    return new Response(
      JSON.stringify({ 
        message: "Dice roll counter incremented",
        dailyDiceRollGamesPlayed: result.value.dailyDiceRollGamesPlayed 
      }),
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