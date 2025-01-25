import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGO_URI);

export async function POST(req) {
  try {
    const { chatId, firstName } = await req.json();

    if (!chatId || !firstName) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
      });
    }

    await client.connect();
    const db = client.db("house-of-luck");
    const usersCollection = db.collection("users");

    // Upsert user data (update if exists, otherwise insert)
    await usersCollection.updateOne(
      { chatId },
      { $set: { chatId, firstName, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );

    return new Response(JSON.stringify({ message: "User saved successfully" }), {
      status: 200,
    });
  } catch (error) {
    console.error("Error saving user data:", error);
    return new Response(JSON.stringify({ error: "Database error" }), { status: 500 });
  } finally {
    await client.close();
  }
}
