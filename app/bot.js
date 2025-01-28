const TelegramBot = require("node-telegram-bot-api");
const { MongoClient } = require("mongodb");

const bot = new TelegramBot('7384344980:AAF6eFOEMZrgM-LvxP_hbSUrtjco5qasTaQ', { polling: true });

bot.on("successful_payment", async (msg) => {
  const { chatId } = msg.from;
  const { total_amount, invoice_payload } = msg.successful_payment;

  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  const db = client.db("casino-mini-app");
  const users = db.collection("users");

  const user = await users.findOne({ chatId });

  const newCasinoChips = (user?.casino_chips || 0) + total_amount / 100;

  await users.updateOne(
    { chatId },
    { $set: { casino_chips: newCasinoChips }, $currentDate: { updatedAt: true } },
    { upsert: true }
  );

  console.log(`Payment successful for ${chatId}, updated casino chips: ${newCasinoChips}`);
});
