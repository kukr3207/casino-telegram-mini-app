// File: app/api/spin-wheel/route.js
import crypto from "crypto";
import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    // Expected payload: { chatId }
    const { chatId } = await req.json();

    if (!chatId) {
      return new Response(
        JSON.stringify({ error: "Missing chatId" }),
        { status: 400 }
      );
    }

    console.log("Processing spin wheel for chatId:", chatId);

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("casino-mini-app");
    const users = db.collection("users");

    // Convert chatId if needed (number or string)
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

    // Prevent multiple spins in one day
    const today = new Date().toISOString().split("T")[0];
    if (user.dailySpinDate === today) {
      await client.close();
      return new Response(
        JSON.stringify({ error: "Already spun today" }),
        { status: 400 }
      );
    }

    // Define outcomes (the order should match your front-end display)
    const outcomes = [
      { type: "token", value: 10 },
      { type: "token", value: 25 },
      { type: "token", value: 50 },
      { type: "token", value: 100 },
      { type: "token", value: 150 },
      { type: "booster", value: 15 },
      { type: "booster", value: 25 },
      { type: "booster", value: 35 },
    ];

    // Randomly select an outcome using a random byte.
    const randomByte = crypto.randomBytes(1)[0];
    const outcomeIndex = randomByte % outcomes.length;
    const outcome = outcomes[outcomeIndex];

    // Generate a random seed and hash for provable fairness.
    const seed = crypto.randomBytes(32).toString("hex");
    const hash = crypto
      .createHash("sha256")
      .update(seed + JSON.stringify(outcome))
      .digest("hex");

    // Update token balance if the outcome is a token reward.
    let newBalance = user.casino_chips || 0;
    if (outcome.type === "token") {
      newBalance += outcome.value;
    }

    // Update the user's record with today's spin date (and new token balance if applicable).
    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          casino_chips: newBalance,
          dailySpinDate: today,
          updatedAt: new Date(),
        },
      }
    );

    await client.close();
    console.log("Spin wheel processed successfully.");

    return new Response(
      JSON.stringify({ outcome, outcomeIndex, seed, hash }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Error processing spin wheel:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500 }
    );
  }
}