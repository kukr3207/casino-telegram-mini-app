import { MongoClient } from "mongodb";

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);

export async function POST(req) {
  const gameData = await req.json();

  try {
    await client.connect();
    const db = client.db("house-of-luck");
    const gamesCollection = db.collection("game_sessions");

    await gamesCollection.insertOne(gameData);

    return new Response(JSON.stringify({ message: "Game session saved" }), {
      status: 200,
    });
  } catch (err) {
    console.error("Error saving game data:", err);
    return new Response(JSON.stringify({ error: "Database error" }), {
      status: 500,
    });
  } finally {
    await client.close();
  }
}
