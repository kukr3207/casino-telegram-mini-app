import crypto from "crypto";
import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGO_URI;
const client = new MongoClient(MONGO_URI);
const db = client.db("casino-mini-app");
const rolls = db.collection("dice-rolls");

export async function POST(req) {
  try {
    const seed = crypto.randomBytes(32).toString("hex");
    const dice1 = (crypto.randomBytes(1)[0] % 6) + 1;
    const dice2 = (crypto.randomBytes(1)[0] % 6) + 1;
    const resultSum = dice1 + dice2;

    const hash = crypto.createHash("sha256").update(seed + resultSum).digest("hex");

    await rolls.insertOne({ hash, seed, dice1, dice2, createdAt: new Date() });

    return new Response(JSON.stringify({ dice1, dice2, hash, seed }), { status: 200 });
  } catch (error) {
    console.error("❌ Error generating roll:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 });
  }
}

export async function GET(req) {
  try {
    const lastRoll = await rolls.findOne({}, { sort: { createdAt: -1 } });

    if (!lastRoll) {
      return new Response(JSON.stringify({ error: "No roll found" }), { status: 404 });
    }

    return new Response(JSON.stringify(lastRoll), { status: 200 });
  } catch (error) {
    console.error("❌ Error fetching roll:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 });
  }
}
