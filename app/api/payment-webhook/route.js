import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    const update = await req.json();
    console.log("📩 Webhook event received:", JSON.stringify(update, null, 2));

    // ✅ Handling Pre-Checkout Query (Telegram Payment Approval)
    if (update.pre_checkout_query) {
      const queryId = update.pre_checkout_query.id;
      console.log("🛒 Pre-checkout query received:", update.pre_checkout_query);

      try {
        // ✅ Approving the payment
        const response = await fetch(
          `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/answerPreCheckoutQuery`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pre_checkout_query_id: queryId,
              ok: true,
            }),
          }
        );

        const data = await response.json();
        console.log("✅ Pre-checkout query approved:", data);
      } catch (error) {
        console.error("❌ Error approving pre-checkout query:", error);
        return new Response("Error approving pre-checkout query", { status: 500 });
      }

      return new Response("Pre-checkout query approved", { status: 200 });
    }

    // ✅ Handling Successful Payment
    if (update.message?.successful_payment) {
      const chatId = Number(update.message.from.id); // Ensure chatId is a number
      const amountPaid = update.message.successful_payment.total_amount / 100;
      const invoicePayload = update.message.successful_payment.invoice_payload;

      console.log(`💰 Payment successful for Chat ID: ${chatId}, Amount: ${amountPaid} Stars`);

      // ✅ Connect to MongoDB
      const client = new MongoClient(process.env.MONGO_URI);
      await client.connect();
      const db = client.db("casino-mini-app");
      const transactions = db.collection("transactions");
      const payments = db.collection("payments");
      const users = db.collection("users");

      // ✅ Find the Transaction
      const transaction = await transactions.findOne({ payload: invoicePayload });

      if (!transaction) {
        console.error("❌ Transaction not found for payload:", invoicePayload);
        return new Response("Transaction not found", { status: 404 });
      }

      // ✅ Find User in Database
      let user = await users.findOne({ chatId });
      if (!user) user = await users.findOne({ chatId: chatId.toString() });

      if (!user) {
        console.error("❌ User not found in DB. Aborting update.");
        return new Response("User not found", { status: 404 });
      }

      // ✅ Calculate Updated Casino Chips
      const newCasinoChips = transaction.chipsBought;
      const updatedChips = (user.casino_chips || 0) + newCasinoChips;

      // ✅ Update User's Token Balance
      await users.updateOne(
        { _id: user._id },
        {
          $set: { casino_chips: updatedChips, updatedAt: new Date() },
        }
      );

      // ✅ Update Transaction Status
      await transactions.updateOne(
        { payload: invoicePayload },
        { $set: { status: "completed" } }
      );

      // ✅ Insert Payment Record
      await payments.insertOne({
        chatId,
        transactionId: update.message.successful_payment.telegram_payment_charge_id,
        starsSpent: amountPaid,
        casinoChipsReceived: newCasinoChips,
        status: "completed",
        createdAt: new Date(),
      });

      console.log(`✅ Payment processed! Updated casino chips: ${updatedChips}`);

      // ✅ Close Database Connection
      await client.close();

      // ✅ Send Response with Updated Tokens
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
    console.error("❌ Webhook error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
