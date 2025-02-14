import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    const body = await req.json();
    const { chatId, date, reward, milestoneThreshold } = body;
    if (!chatId || !date || reward === undefined || milestoneThreshold === undefined) {
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

    // Determine last claimed milestone for today.
    // If the stored date matches, use the stored value; otherwise treat it as 0.
    const storedDate = user.lastMilestoneClaimDate || "";
    const lastClaimed = storedDate === date ? Number(user.lastMilestoneClaimed || 0) : 0;
    const incomingThreshold = Number(milestoneThreshold);
    const expectedThreshold = lastClaimed + 5;

    console.log(
      "Milestone claim check:",
      "lastClaimed =", lastClaimed,
      "expectedThreshold =", expectedThreshold,
      "incomingThreshold =", incomingThreshold
    );

    // Reject if the incoming milestone claim isn't exactly one step ahead.
    if (incomingThreshold !== expectedThreshold) {
      await client.close();
      return new Response(
        JSON.stringify({
          error: "Milestone already claimed or invalid claim",
          newBalance: user.casino_chips
        }),
        { status: 400 }
      );
    }

    const oldBalance = Number(user.casino_chips || 0);
    const newBalance = oldBalance + reward; // reward should be 15

    // If the milestoneThreshold equals the maximum (25), reset lastMilestoneClaimed to 0.
    const updateFields =
      incomingThreshold === 25
        ? { casino_chips: newBalance, lastMilestoneClaimed: 0, lastMilestoneClaimDate: date }
        : { casino_chips: newBalance, lastMilestoneClaimed: incomingThreshold, lastMilestoneClaimDate: date };

    await users.updateOne({ chatId: numericChatId }, { $set: updateFields });
    await client.close();
    return new Response(JSON.stringify({ newBalance }), { status: 200 });
  } catch (error) {
    console.error("Error claiming milestone:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
  }
}
