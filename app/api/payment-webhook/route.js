import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    const { update } = await req.json();

    if (update.message && update.message.successful_payment) {
      const chatId = update.message.from.id;
      const amountPaid = update.message.successful_payment.total_amount / 100; // Convert from cents

      const client = new MongoClient(process.env.MONGO_URI);
      await client.connect();
      const db = client.db("casino-mini-app");
      const users = db.collection("users");

      // Update the user's casino chips balance
      await users.updateOne(
        { chatId: chatId.toString() },
        { $inc: { casino_chips: amountPaid } }
      );

      console.log(`Payment confirmed for Chat ID: ${chatId}, Amount: ${amountPaid}`);
      await client.close();
    }

    return new Response("Webhook received and processed", { status: 200 });
  } catch (error) {
    console.error("Error processing webhook:", error);
    return new Response("Internal server error", { status: 500 });
  }
}
