import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    const { chatId, firstName, username } = await req.json();

    if (!chatId || !firstName) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
      });
    }

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("casino-mini-app");
    const users = db.collection("users");

    // Check if the user exists
    const existingUser = await users.findOne({ chatId });

    let isNewUser = false;
    if (!existingUser) {
      // Insert new user if they do not exist
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
      isNewUser = true;
      console.log(`New user created in DB: ${chatId}`);
    } else {
      console.log(`User already exists: ${chatId}`);
    }

    await client.close();
    return new Response(JSON.stringify({ success: true, isNewUser }), { status: 200 });
  } catch (error) {
    console.error("Error storing user data:", error);
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      { status: 500 }
    );
  }
}
