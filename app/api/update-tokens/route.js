import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    const { chatId, tokens } = await req.json();
    
    if (!chatId || tokens === undefined) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400 }
      );
    }

    console.log("Updating tokens for chatId:", chatId, "Tokens:", tokens);

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("casino-mini-app");
    const users = db.collection("users");

    // Find user document (handling different chatId formats)
    let user = await users.findOne({ chatId: chatId });

    if (!user) {
      console.warn("User not found with string chatId. Trying with number format...");
      user = await users.findOne({ chatId: parseFloat(chatId) });
    }

    if (!user) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404 }
      );
    }

    // Update the user's token count
    const updatedCasinoChips = (user.casino_chips || 0) + tokens;

    await users.updateOne(
      { _id: user._id }, // Update the found document
      {
        $set: {
          casino_chips: updatedCasinoChips,
          updatedAt: new Date(),
        },
      }
    );

    await client.close();
    console.log("Updated tokens successfully.");

    return new Response(
      JSON.stringify({ success: true, newBalance: updatedCasinoChips }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Error updating tokens:", error);
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      { status: 500 }
    );
  }
}
