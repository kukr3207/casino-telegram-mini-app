import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    console.log("Request received");

    const { chatId, firstName } = await req.json();
    console.log("Data parsed:", { chatId, firstName });

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

    // Update or insert the user document, initializing tokens only for new users
    await users.updateOne(
      { chatId },
      {
        $set: { firstName, updatedAt: new Date() },
        $setOnInsert: {
          createdAt: new Date(),
          casino_chips: 0, // Initialize token1
          withdraw_tokens: 0, // Initialize token2
          hol_tokens: 0, // Initialize token3
        },
      },
      { upsert: true } // Create a new document if no match is found
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
