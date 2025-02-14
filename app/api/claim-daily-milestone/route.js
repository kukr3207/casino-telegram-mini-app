import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    const body = await req.json();
    const { chatId, date, reward, milestoneThreshold } = body;
    if (!chatId || !date || reward === undefined || !milestoneThreshold) {
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

    // Determine last claimed milestone for today:
    let lastClaimed = 0;
    if (user.lastMilestoneClaimDate === date) {
      lastClaimed = user.lastMilestoneClaimed || 0;
    }
    // Next eligible milestone is lastClaimed + 10
    if (milestoneThreshold !== lastClaimed + 10) {
      await client.close();
      return new Response(
        JSON.stringify({ error: "Milestone already claimed or invalid milestone claim", newBalance: user.casino_chips }),
        { status: 400 }
      );
    }

    const oldBalance = user.casino_chips || 0;
    const newBalance = oldBalance + reward;

    // Update the user's balance and set the new milestone claim values.
    await users.updateOne(
      { chatId: numericChatId },
      { $set: { casino_chips: newBalance, lastMilestoneClaimed: milestoneThreshold, lastMilestoneClaimDate: date } }
    );

    await client.close();
    return new Response(JSON.stringify({ newBalance }), { status: 200 });
  } catch (error) {
    console.error("Error claiming milestone:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
  }
}
