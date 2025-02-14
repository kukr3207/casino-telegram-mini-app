import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    console.log("Incoming request to game-update-tokens API");

    // ✅ Read the request body ONCE
    const {
      chatId,
      tokens,
      dice1,
      dice2,
      hash,
      seed,
      placedBets,
      wonBets,
      lostBets,
      betAmount,
      winAmount,
      lossAmount
    } = await req.json();

    if (!chatId || !tokens || dice1 === undefined || dice2 === undefined) {
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
    const rolls = db.collection("dice-rolls");

    // Parse chatId to a number (double)
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
    const updatedWithdrawalTokens = tokens.withdraw_tokens ?? user.withdraw_tokens;
    const updatedHolTokens = tokens.hol_tokens ?? user.hol_tokens;

    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          casino_chips: updatedCasinoChips,
          withdraw_tokens: updatedWithdrawalTokens,
          hol_tokens: updatedHolTokens,
          updatedAt: new Date(),
        },
      }
    );

    // ✅ Store Game Data in dice-rolls Collection with chatId as a number (double)
    await rolls.insertOne({
      chatId: chatIdAsNumber,
      dice1,
      dice2,
      verificationHash: hash,
      verificationSeed: seed,
      placedBets,
      wonBets,
      lostBets,
      betAmount,
      winAmount,
      lossAmount,
      gameTimestamp: new Date(),
    });

    await client.close();
    console.log("Updated tokens and stored game data successfully.");

    return new Response(
      JSON.stringify({
        success: true,
        newBalances: {
          casino_chips: updatedCasinoChips,
          withdraw_tokens: updatedWithdrawalTokens,
          hol_tokens: updatedHolTokens,
        },
      }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Error updating tokens or storing game data:", error);
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      { status: 500 }
    );
  }
}
