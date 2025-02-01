import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
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
      lossAmount,
    } = await req.json();

    if (!chatId || !tokens || dice1 === undefined || dice2 === undefined) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400 }
      );
    }

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("casino-mini-app");

    const users = db.collection("users");
    const rolls = db.collection("dice-rolls");

    const user = await users.findOne({ chatId: chatId });

    if (!user) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404 }
      );
    }

    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          casino_chips: tokens.casino_chips,
          withdraw_tokens: tokens.withdraw_tokens,
          hol_tokens: tokens.hol_tokens,
          updatedAt: new Date(),
        },
      }
    );

    await rolls.insertOne({
      chatId,
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

    return new Response(
      JSON.stringify({
        success: true,
        newBalances: {
          casino_chips: tokens.casino_chips,
          withdraw_tokens: tokens.withdraw_tokens,
          hol_tokens: tokens.hol_tokens,
        },
      }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      { status: 500 }
    );
  }
}
