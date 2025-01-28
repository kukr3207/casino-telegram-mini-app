import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    const update = await req.json();
    console.log("Webhook event received:", update);

    // Handle `pre_checkout_query` event
    if (update.pre_checkout_query) {
      console.log("Pre-checkout query received:", update.pre_checkout_query);

      const queryId = update.pre_checkout_query.id;
      try {
        // Approve the pre_checkout_query
        const response = await fetch(
          `https://api.telegram.org/bot7384344980:AAF6eFOEMZrgM-LvxP_hbSUrtjco5qasTaQ/answerPreCheckoutQuery`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pre_checkout_query_id: queryId,
              ok: true, // Approving the payment
            }),
          }
        );

        const data = await response.json();
        console.log("Pre-checkout query approved:", data);
      } catch (error) {
        console.error("Error approving pre-checkout query:", error);
        return new Response("Error approving pre-checkout query", { status: 500 });
      }
    }

    // Handle `successful_payment` event
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

      const user = await users.findOne({ chatId });
      const updatedChips = (user?.casino_chips || 0) + newCasinoChips;

      await users.updateOne(
        { chatId },
        { $set: { casino_chips: updatedChips }, $currentDate: { updatedAt: true } },
        { upsert: true }
      );

      await transactions.updateOne(
        { payload: invoicePayload },
        { $set: { status: "completed" } }
      );

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
