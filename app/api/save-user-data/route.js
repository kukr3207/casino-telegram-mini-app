import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    console.log("Request received");

    const { chatId, firstName } = await req.json();
    console.log("Data parsed:", { chatId, firstName, username });

    if (!chatId || !firstName) {
      console.error("Missing required fields");
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400 }
      );
    }

    const client = new MongoClient(process.env.MONGO_URI);
    console.log("Connecting to database...");

    await client.connect();
    console.log("Connected to database");

    const db = client.db("casino-mini-app");
    const users = db.collection("users");

    await users.updateOne(
      { chatId },
      {
        $set: { firstName, username, updatedAt: new Date() },
        $setOnInsert: {
          createdAt: new Date(),
          casino_chips: 0,
          withdraw_tokens: 0,
          hol_tokens: 0,
        },
      },
      { upsert: true }
    );

    await client.close();
    console.log("Database connection closed");

    return new Response(
      JSON.stringify({ message: "User saved successfully" }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Error saving user data:", error);
    return new Response(
      JSON.stringify({ error: "Database error" }),
      { status: 500 }
    );
  }
}
