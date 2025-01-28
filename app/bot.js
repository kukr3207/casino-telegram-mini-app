const TelegramBot = require("node-telegram-bot-api");
const { randomUUID } = require("crypto");
const { createInvoiceInDatabase, createPaymentInDatabase, getInvoiceFromDatabase } = require("./database");

const BOT_TOKEN = '7384344980:AAF6eFOEMZrgM-LvxP_hbSUrtjco5qasTaQ';
const PROVIDER_TOKEN = ''; // Your Telegram Stars provider token
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log("Bot is running...");

// Command to trigger an invoice manually
bot.onText(/\/invoice/, async (msg) => {
  const chatId = msg.chat.id;
  await sendInvoice(chatId, 100, "Buy Premium Chips", "Get 100 premium casino chips!");
});

// Handle pre_checkout_query
bot.on("pre_checkout_query", async (query) => {
  const { id, invoice_payload } = query;
  console.log(`Received pre_checkout_query: ${id}, payload: ${invoice_payload}`);

  const invoice = await getInvoiceFromDatabase(invoice_payload);
  
  if (invoice) {
    // Approve the pre-checkout query
    await bot.answerPreCheckoutQuery(id, true);
  } else {
    // Reject the payment
    await bot.answerPreCheckoutQuery(id, false, { error_message: "Invalid invoice payload!" });
  }
});

// Handle successful payments
bot.on("message", async (msg) => {
  if (msg.successful_payment) {
    const successfulPayment = msg.successful_payment;
    const { total_amount, invoice_payload, telegram_payment_charge_id } = successfulPayment;

    console.log("Successful Payment Received:", successfulPayment);

    // Fetch invoice details
    const invoice = await getInvoiceFromDatabase(invoice_payload);

    if (invoice) {
      // Save the payment in the database
      await createPaymentInDatabase({
        payment_id: telegram_payment_charge_id,
        user_id: msg.from.id,
        amount: total_amount / 100, // Convert from cents
        invoice_id: invoice.id,
      });

      // Send a confirmation message
      bot.sendMessage(msg.chat.id, `✅ Payment successful! You have purchased ${invoice.product}.`);
    }
  }
});

// Function to send an invoice inside the app (not as a chat message)
async function sendInvoice(chatId, amount, product, description) {
  const payload = randomUUID();
  try {
    await bot.sendInvoice(chatId, {
      currency: "XTR", // Telegram Stars
      prices: [{ label: product, amount: amount * 100 }], // Convert to smallest units
      title: product,
      provider_token: PROVIDER_TOKEN,
      description,
      payload,
      start_parameter: "purchase",
    });

    console.log(`Invoice sent for ${product} to ${chatId}`);

    // Save invoice in the database
    await createInvoiceInDatabase({
      amount,
      product,
      payload,
      user_id: chatId,
    });
  } catch (error) {
    console.error("Error sending invoice:", error);
  }
}
