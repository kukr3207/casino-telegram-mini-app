import TelegramBot from "node-telegram-bot-api";
import { MongoClient } from "mongodb";
import { randomUUID } from "crypto";

const botToken = process.env.BOT_TOKEN;
const providerToken = process.env.PROVIDER_TOKEN;
const bot = new TelegramBot(botToken, { polling: false });

export async function POST(req) {
  try {
    const { chatId, amount, packageType, chipsBought } = await req.json();

    if (!chatId || !amount || !packageType || !chipsBought) {
      return new Response(JSON.stringify({ error: "Missing required parameters" }), { status: 400 });
    }

    const payload = randomUUID();

    // Send invoice via Telegram (Payment Modal)
    await bot.sendInvoice(
      chatId,
      `Buy ${chipsBought} Casino Chips`,
      `Get ${chipsBought} chips with the ${packageType} package.`,
      payload,
      providerToken,
      "XTR",
      [{ label: "Casino Chips", amount: amount * 100 }], // XTR uses smallest unit format
      { start_parameter: "casino_purchase" }
    );

    console.log(`Invoice sent for ${chipsBought} chips to ${chatId}`);

    // Connect to Database
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("casino-mini-app");
    const transactions = db.collection("transactions");
    const users = db.collection("users");
    const payments = db.collection("payments");

    // ✅ Store Invoice Details in `transactions` Table
    await transactions.insertOne({
      chatId,
      payload,
      amount,
      packageType,
      chipsBought,
      status: "pending", // Status is pending until payment is confirmed
      createdAt: new Date(),
    });

    console.log(`Transaction stored in DB for ${chatId}, Payload: ${payload}`);

    await client.close();

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    console.error("Error processing payment:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 });
  }
}

// ✅ Handle Successful Payment
bot.on("message", async (msg) => {
  if (msg.successful_payment) {
    const { chatId } = msg.from;
    const successfulPayment = msg.successful_payment;
    const { total_amount, invoice_payload, telegram_payment_charge_id } = successfulPayment;

    console.log("✅ Successful Payment Received:", successfulPayment);

    // Connect to Database
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("casino-mini-app");
    const transactions = db.collection("transactions");
    const users = db.collection("users");
    const payments = db.collection("payments");

    // Fetch the transaction from `transactions` table
    const transaction = await transactions.findOne({ payload: invoice_payload });

    if (!transaction) {
      console.error("❌ Transaction not found for payload:", invoice_payload);
      return;
    }

    const { chipsBought } = transaction;

    // Fetch existing user data
    const user = await users.findOne({ chatId });

    // Calculate new casino chips balance
    const newCasinoChips = (user?.casino_chips || 0) + chipsBought;

    // ✅ Update the `users` table with new casino chip count
    await users.updateOne(
      { chatId },
      {
        $set: {
          casino_chips: newCasinoChips,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    console.log(`🔄 Updated casino chips for ${chatId}: ${newCasinoChips}`);

    // ✅ Update `transactions` Table (Mark as Completed)
    await transactions.updateOne(
      { payload: invoice_payload },
      {
        $set: { status: "completed" },
      }
    );

    // ✅ Store the Payment in `payments` Table
    await payments.insertOne({
      chatId,
      transactionId: telegram_payment_charge_id,
      starsSpent: total_amount / 100, // Convert from cents
      casinoChipsReceived: chipsBought,
      status: "completed",
      createdAt: new Date(),
    });

    console.log(`💰 Payment recorded for ${chatId} (Transaction ID: ${telegram_payment_charge_id})`);

    // Close Database Connection
    await client.close();
  }
});
