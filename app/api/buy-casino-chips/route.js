import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    const { chatId, amount } = await req.json();
    if (!chatId || !amount) {
      return new Response(
        JSON.stringify({ error: "Missing chatId or amount" }),
        { status: 400 }
      );
    }

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();

    const db = client.db("casino-mini-app");
    const users = db.collection("users");

    const user = await users.findOne({ chatId });
    if (!user) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404 }
      );
    }

    const updated = await users.updateOne(
      { chatId },
      { $inc: { casino_chips: amount } }
    );

    await client.close();

    return new Response(
      JSON.stringify({ updatedCasinoChips: user.casino_chips + amount }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Error processing purchase:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500 }
    );
  }
}
