import { MongoClient } from "mongodb";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get("chatId");
    if (!chatId) {
      return new Response(JSON.stringify({ error: "Missing chatId" }), { status: 400 });
    }
    
    // Convert chatId if necessary
    const numericChatId = isNaN(chatId) ? chatId : parseFloat(chatId);

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("casino-mini-app");
    const boosters = db.collection("boosters");

    // Query for an active booster (claimed:false)
    const booster = await boosters.findOne({ chatId: numericChatId, claimed: false });

    await client.close();
    return new Response(JSON.stringify({ booster }), { status: 200 });
  } catch (error) {
    console.error("Error fetching booster:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
  }
}
