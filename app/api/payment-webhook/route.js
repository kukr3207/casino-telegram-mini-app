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
        console.log("✅ Pre-checkout query approved:", data);
      } catch (error) {
        console.error("❌ Error approving pre-checkout query:", error);
        return new Response("Error approving pre-checkout query", { status: 500 });
      }
    }

    // Handle `successful_payment` event
    if (update.message && update.message.successful_payment) {
      let chatId = update.message.from.id; // Ensure chatId is taken correctly
      const amountPaid = update.message.successful_payment.total_amount / 100;
      const invoicePayload = update.message.successful_payment.invoice_payload;

      const client = new MongoClient(process.env.MONGO_URI);
      await client.connect();
      const db = client.db("casino-mini-app");
      const transactions = db.collection("transactions");
      const payments = db.collection("payments");
      const users = db.collection("users");

      // Ensure chatId is always treated as a number
      chatId = parseFloat(chatId);

      // Find transaction in the database
      const transaction = await transactions.findOne({ payload: invoicePayload });

      if (!transaction) {
        console.error("❌ Transaction not found for payload:", invoicePayload);
        return new Response("Transaction not found", { status: 404 });
      }

      // Fetch the existing user's chips
      let user = await users.findOne({ chatId });

      if (!user) {
        console.warn("⚠️ User not found with number chatId. Trying with string...");
        user = await users.findOne({ chatId: chatId.toString() });
      }

      if (!user) {
        console.error("❌ User not found in database. Aborting update.");
        return new Response("User not found", { status: 404 });
      }

      // Calculate the updated chips balance
      const newCasinoChips = transaction.chipsBought;
      const updatedChips = (user.casino_chips || 0) + newCasinoChips;

      // Update users table (ENSURE IT ONLY UPDATES EXISTING USER)
      await users.updateOne(
        { _id: user._id }, // Use `_id` to make sure we're updating the correct user
        { $set: { casino_chips: updatedChips }, $currentDate: { updatedAt: true } }
      );

      // Update transactions table
      await transactions.updateOne(
        { payload: invoicePayload },
        { $set: { status: "completed" } }
      );

      // Add to payments table
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

      /**  
       * ✅ **Now, update the session storage directly using JavaScript in the frontend**
       */
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
