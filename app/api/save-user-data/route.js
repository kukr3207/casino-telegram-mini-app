import { MongoClient } from "mongodb";

export default async function handler(req, res) {
  if (req.method === "POST") {
    const { chatId, firstName, username } = req.body;

    if (!chatId || !firstName || !username) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const client = new MongoClient(process.env.MONGO_URI);
    try {
      await client.connect();
      const db = client.db("casino-mini-app");
      const users = db.collection("users");

      // Check if user already exists
      const existingUser = await users.findOne({ chatId });
      if (!existingUser) {
        // Insert new user
        await users.insertOne({
          chatId,
          firstName,
          username,
          createdAt: new Date(),
          updatedAt: new Date(),
          casino_chips: 0,
          withdraw_tokens: 0,
          hol_tokens: 0,
        });
      }

      res.status(200).json({ success: true });
    } catch (error) {
      console.error("Error storing user data:", error);
      res.status(500).json({ error: "Internal Server Error" });
    } finally {
      await client.close();
    }
  } else {
    res.status(405).json({ error: "Method Not Allowed" });
  }
}