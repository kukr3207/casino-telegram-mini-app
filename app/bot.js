const TelegramBot = require("node-telegram-bot-api");
const { MongoClient } = require("mongodb");
const bot = new TelegramBot('7384344980:AAF6eFOEMZrgM-LvxP_hbSUrtjco5qasTaQ', { polling: true });

bot.on("pre_checkout_query", async (query) => {
  const { id, invoice_payload } = query;

  try {
    // Approve the payment
    await bot.answerPreCheckoutQuery(id, true);
    console.log(`Approved pre_checkout_query for payload: ${invoice_payload}`);
  } catch (error) {
    console.error("Error approving pre_checkout_query:", error);
  }
});

bot.on("message", async (msg) => {
  if (msg.successful_payment) {
    const { chatId } = msg.from;
    const { total_amount, invoice_payload, telegram_payment_charge_id } = msg.successful_payment;

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("casino-mini-app");
    const transactions = db.collection("transactions");
    const users = db.collection("users");

    const transaction = await transactions.findOne({ payload: invoice_payload });
    if (!transaction) {
      console.error("Transaction not found for payload:", invoice_payload);
      return;
    }

    const newCasinoChips = (transaction.chipsBought || 0) + total_amount / 100;

    await users.updateOne(
      { chatId },
      { $set: { casino_chips: newCasinoChips }, $currentDate: { updatedAt: true } },
      { upsert: true }
    );

    await transactions.updateOne(
      { payload: invoice_payload },
      { $set: { status: "completed" } }
    );

    console.log(`Payment successful for ${chatId}, updated casino chips: ${newCasinoChips}`);
  }
});
