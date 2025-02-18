// File: app/api/spin-wheel/route.js
import crypto from "crypto";
import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
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

    // Convert chatId if necessary
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

    // Randomly select an outcome
    const randomByte = crypto.randomBytes(1)[0];
    const outcomeIndex = randomByte % outcomes.length;
    const outcome = outcomes[outcomeIndex];

    // Generate a random seed and a hash combining the seed and outcome data.
    const seed = crypto.randomBytes(32).toString("hex");
    const hash = crypto
      .createHash("sha256")
      .update(seed + JSON.stringify(outcome))
      .digest("hex");

    // If a token outcome, update token balance; if booster, store booster info.
    let newBalance = user.casino_chips || 0;
    if (outcome.type === "token") {
      newBalance += outcome.value;
    } else if (outcome.type === "booster") {
      // Insert a booster document with a 24-hour TTL.
      const boosters = db.collection("boosters");
      // Ensure a TTL index exists on 'createdAt' (expires after 86400 seconds)
      await boosters.createIndex({ createdAt: 1 }, { expireAfterSeconds: 86400 });
      await boosters.insertOne({
        chatId: numericChatId,
        boosterValue: outcome.value,
        createdAt: new Date(),
        claimed: false, // Mark as unclaimed initially
      });
    }

    // Update the user's record: set dailySpinDate and, if token, update balance.
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
