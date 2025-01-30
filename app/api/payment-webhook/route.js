import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    const update = await req.json();
    console.log("Webhook event received:", update);

    if (update.message && update.message.successful_payment) {
      let chatId = update.message.from.id;
      const amountPaid = update.message.successful_payment.total_amount / 100;
      const invoicePayload = update.message.successful_payment.invoice_payload;

      const client = new MongoClient(process.env.MONGO_URI);
      await client.connect();
      const db = client.db("casino-mini-app");
      const transactions = db.collection("transactions");
      const payments = db.collection("payments");
      const users = db.collection("users");

      chatId = parseFloat(chatId);

      const transaction = await transactions.findOne({ payload: invoicePayload });

      if (!transaction) {
        console.error("Transaction not found for payload:", invoicePayload);
        return new Response("Transaction not found", { status: 404 });
      }

      let user = await users.findOne({ chatId });

      if (!user) {
        user = await users.findOne({ chatId: chatId.toString() });
      }

      if (!user) {
        console.error("User not found in database. Aborting update.");
        return new Response("User not found", { status: 404 });
      }

      const newCasinoChips = transaction.chipsBought;
      const updatedChips = (user.casino_chips || 0) + newCasinoChips;

      await users.updateOne(
        { _id: user._id },
        { $set: { casino_chips: updatedChips }, $currentDate: { updatedAt: true } }
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

      console.log(`✅ Payment processed successfully for chatId: ${chatId}, new chips: ${updatedChips}`);
      await client.close();

      return new Response(
        JSON.stringify({
          type: "update_tokens",
          tokens: [
            { id: 1, image: "/images/token1.png", count: updatedChips },
            { id: 2, image: "/images/token2.png", count: user.withdraw_tokens || 0 },
            { id: 3, image: "/images/token3.png", count: user.hol_tokens || 0 },
          ],
        }),
        { status: 200 }
      );
    }

    return new Response("Webhook received", { status: 200 });
  } catch (error) {
    console.error("❌ Error processing webhook:", error);
    return new Response("Internal server error", { status: 500 });
  }
}
