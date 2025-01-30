import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    console.log("Request received for storing user");

    const { chatId, firstName, username } = await req.json();
    console.log("Data parsed:", { chatId, firstName, username });

    if (!chatId || !firstName) {
      console.error("Missing required fields");
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400 }
      );
    }

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("casino-mini-app");
    const users = db.collection("users");

    // Check if user exists
    const existingUser = await users.findOne({ chatId });

    if (!existingUser) {
      // Create new user entry
      await users.insertOne({
        chatId,
        firstName,
        username: username || null,
        createdAt: new Date(),
        updatedAt: new Date(),
        casino_chips: 0,
        withdraw_tokens: 0,
        hol_tokens: 0,
      });
      console.log("New user created in DB");
    } else {
      console.log("User already exists in DB");
    }

    await client.close();
    return new Response(
      JSON.stringify({ message: "User stored successfully" }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Error storing user data:", error);
    return new Response(
      JSON.stringify({ error: "Database error" }),
      { status: 500 }
    );
  }
}
