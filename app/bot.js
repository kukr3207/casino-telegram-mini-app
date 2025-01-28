const TelegramBot = require("node-telegram-bot-api");
const { MongoClient } = require("mongodb");

const bot = new TelegramBot("7384344980:AAF6eFOEMZrgM-LvxP_hbSUrtjco5qasTaQ", { polling: true });

bot.on("pre_checkout_query", async (query) => {
  console.log("Pre-checkout query received:", query);
  try {
    await bot.answerPreCheckoutQuery(query.id, true);
    console.log("Pre-checkout query approved for payload:", query.invoice_payload);
  } catch (error) {
    console.error("Error in pre-checkout query:", error);
  }
});

bot.on("successful_payment", async (msg) => {
  console.log("Successful payment received:", msg.successful_payment);

  const { chatId } = msg.from;
  const { total_amount, invoice_payload, telegram_payment_charge_id } = msg.successful_payment;

  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  const db = client.db("casino-mini-app");
  const transactions = db.collection("transactions");
  const payments = db.collection("payments");
  const users = db.collection("users");

  const transaction = await transactions.findOne({ payload: invoice_payload });

  if (!transaction) {
    console.error("Transaction not found for payload:", invoice_payload);
    return;
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
    { payload: invoice_payload },
    { $set: { status: "completed" } }
  );

  await payments.insertOne({
    chatId,
    transactionId: telegram_payment_charge_id,
    starsSpent: total_amount / 100,
    casinoChipsReceived: newCasinoChips,
    status: "completed",
    createdAt: new Date(),
  });

  console.log(`Payment processed for chatId: ${chatId}, new casino chips: ${updatedChips}`);
  await client.close();
});
