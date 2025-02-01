import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    const { chatId, tokens } = await req.json();

    if (!chatId || !tokens) {
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

    const chatIdAsNumber = parseFloat(chatId);

    let user = await users.findOne({ chatId: chatIdAsNumber });

    if (!user) {
      console.warn("User not found with number chatId. Trying with string...");
      user = await users.findOne({ chatId: chatId });
    }

    if (!user) {
      console.error("User not found. Aborting update.");
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404 }
      );
    }

    const updatedCasinoChips = tokens.casino_chips ?? user.casino_chips;
    const updatedWithdrawalTokens = tokens.withdrawal_tokens ?? user.withdrawal_tokens;
    const updatedHolTokens = tokens.hol_tokens ?? user.hol_tokens;

    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          casino_chips: updatedCasinoChips,
          withdrawal_tokens: updatedWithdrawalTokens,
          hol_tokens: updatedHolTokens,
          updatedAt: new Date(),
        },
      }
    );

    await client.close();
    console.log("Updated tokens successfully.");

    return new Response(
      JSON.stringify({
        success: true,
        newBalances: {
          casino_chips: updatedCasinoChips,
          withdrawal_tokens: updatedWithdrawalTokens,
          hol_tokens: updatedHolTokens,
        },
      }),
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
