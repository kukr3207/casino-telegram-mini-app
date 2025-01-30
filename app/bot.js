const TelegramBot = require("node-telegram-bot-api");

const bot = new TelegramBot("7384344980:AAF6eFOEMZrgM-LvxP_hbSUrtjco5qasTaQ", { polling: true });

bot.on("pre_checkout_query", async (query) => {
  console.log("🛒 Pre-checkout query received:", query);
  try {
    await bot.answerPreCheckoutQuery(query.id, true);
    console.log("✅ Pre-checkout query approved for payload:", query.invoice_payload);
  } catch (error) {
    console.error("❌ Error approving pre-checkout query:", error);
  }
});

bot.on("successful_payment", async (msg) => {
  console.log("✅ Successful payment received:", msg.successful_payment);

  let chatId = Number(msg.from.id);
  const { total_amount, invoice_payload, telegram_payment_charge_id } = msg.successful_payment;

  bot.sendMessage(
    chatId,
    `✅ Payment of ${total_amount / 100} Stars was successful! Your tokens will be updated soon.`
  );

  console.log("✅ Payment confirmation message sent.");
});

console.log("🚀 Telegram bot is running...");
