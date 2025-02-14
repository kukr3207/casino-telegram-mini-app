import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    const { chatId, date, reward } = await req.json();
    if (!chatId || !date || !reward) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
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

    // Check if milestone already claimed for today.
    if (user.milestoneClaimed === true && user.milestoneClaimDate === date) {
      await client.close();
      return new Response(
        JSON.stringify({ error: "Milestone already claimed today" }),
        { status: 400 }
      );
    }

    // Calculate required games based on the reward.
    // For every 10 games, reward = 25 tokens.
    // Thus, requiredGames = (reward / 25) * 10.
    const requiredGames = (reward / 25) * 10;
    if ((user.dailyGamesPlayed || 0) < requiredGames) {
      await client.close();
      return new Response(
        JSON.stringify({ error: "Not enough dice roll games played for milestone" }),
        { status: 400 }
      );
    }

    const newBalance = (user.casino_chips || 0) + reward;
    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          casino_chips: newBalance,
          milestoneClaimed: true,
          milestoneClaimDate: date,
          updatedAt: new Date()
        }
      }
    );

    await client.close();
    return new Response(
      JSON.stringify({ newBalance }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Error claiming milestone reward:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500 }
    );
  }
}
