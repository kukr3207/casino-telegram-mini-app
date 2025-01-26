import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    const { update } = await req.json();

    if (update.message && update.message.successful_payment) {
      const chatId = update.message.from.id.toString();
      const amountPaid = update.message.successful_payment.total_amount / 100;

      const client = new MongoClient(process.env.MONGO_URI); // Ensure MONGO_URI is set
      await client.connect();
      const db = client.db("casino-mini-app");
      const users = db.collection("users");

      // Increment the user's casino chips balance
      await users.updateOne(
        { chatId },
        { $inc: { casino_chips: amountPaid } },
        { upsert: true }
      );

      console.log(`Payment confirmed for Chat ID: ${chatId}, Amount Paid: ${amountPaid}`);
      await client.close();
    }

    return new Response("Webhook received", { status: 200 });
  } catch (error) {
    console.error("Error processing webhook:", error);
    return new Response("Internal server error", { status: 500 });
  }
}
