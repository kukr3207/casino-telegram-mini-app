import { MongoClient } from "mongodb";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const { chatId } = req.query;

    if (!chatId) {
      return res.status(400).json({ error: "Missing chat ID" });
    }

    const client = new MongoClient(process.env.MONGO_URI);
    try {
      await client.connect();
      const db = client.db("casino-mini-app");
      const users = db.collection("users");

      // Fetch user data
      const user = await users.findOne({ chatId });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Fetch token counts (example logic)
      const tokenCounts = {
        casino_chips: user.casino_chips || 0,
        withdraw_tokens: user.withdraw_tokens || 0,
        hol_tokens: user.hol_tokens || 0,
      };

      res.status(200).json({ tokenCounts, userDetails: user });
    } catch (error) {
      console.error("Error fetching user data:", error);
      res.status(500).json({ error: "Internal Server Error" });
    } finally {
      await client.close();
    }
  } else {
    res.status(405).json({ error: "Method Not Allowed" });
  }
}