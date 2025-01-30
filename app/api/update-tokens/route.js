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

    // Convert chatId to a number if possible
    const chatIdAsNumber = parseFloat(chatId);

    // Try finding the user (search by number first)
    let user = await users.findOne({ chatId: chatIdAsNumber });

    if (!user) {
      console.warn("User not found with number chatId. Trying with string...");
      user = await users.findOne({ chatId: chatId }); // Try as string
    }

    if (!user) {
      console.error("User not found. Aborting update.");
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404 }
      );
    }

    // Fetch existing casino chips balance
    const currentCasinoChips = user.casino_chips || 0;
    const updatedCasinoChips = currentCasinoChips + tokens;

    // Update the existing record (DO NOT create a new one)
    await users.updateOne(
      { _id: user._id }, // Use `_id` to ensure correct document is updated
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
