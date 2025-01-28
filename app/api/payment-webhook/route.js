import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    const update = await req.json();
    console.log("Webhook event received:", update);

    if (update.message && update.message.successful_payment) {
      const chatId = update.message.from.id.toString();
      const amountPaid = update.message.successful_payment.total_amount / 100;
      const invoicePayload = update.message.successful_payment.invoice_payload;

      const client = new MongoClient(process.env.MONGO_URI);
      await client.connect();
      const db = client.db("casino-mini-app");
      const transactions = db.collection("transactions");
      const payments = db.collection("payments");
      const users = db.collection("users");

      const transaction = await transactions.findOne({ payload: invoicePayload });

      if (!transaction) {
        console.error("Transaction not found for payload:", invoicePayload);
        return new Response("Transaction not found", { status: 404 });
      }

      const newCasinoChips = transaction.chipsBought;

      // Update users table
      const user = await users.findOne({ chatId });
      const updatedChips = (user?.casino_chips || 0) + newCasinoChips;

      await users.updateOne(
        { chatId },
        { $set: { casino_chips: updatedChips }, $currentDate: { updatedAt: true } },
        { upsert: true }
      );

      // Update transactions table
      await transactions.updateOne(
        { payload: invoicePayload },
        { $set: { status: "completed" } }
      );

      // Insert into payments table
      await payments.insertOne({
        chatId,
        transactionId: update.message.successful_payment.telegram_payment_charge_id,
        starsSpent: amountPaid,
        casinoChipsReceived: newCasinoChips,
        status: "completed",
        createdAt: new Date(),
      });

      console.log(`Payment processed for Chat ID: ${chatId}, new casino chips: ${updatedChips}`);
      await client.close();
    }

    return new Response("Webhook received", { status: 200 });
  } catch (error) {
    console.error("Error processing webhook:", error);
    return new Response("Internal server error", { status: 500 });
  }
}
