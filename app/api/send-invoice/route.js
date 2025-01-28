import TelegramBot from "node-telegram-bot-api";
import { MongoClient } from "mongodb";
import { randomUUID } from "crypto";

const botToken = "7384344980:AAF6eFOEMZrgM-LvxP_hbSUrtjco5qasTaQ";
const providerToken = '';
const bot = new TelegramBot(botToken, { polling: false });

export async function POST(req) {
  try {
    const { chatId, amount, packageType, chipsBought } = await req.json();

    if (!chatId || !amount || !packageType || !chipsBought) {
      return new Response(JSON.stringify({ error: "Missing required parameters" }), { status: 400 });
    }

    const payload = randomUUID();

    // Send invoice
    await bot.sendInvoice(
      chatId,
      `Buy ${chipsBought} Casino Chips`,
      `Get ${chipsBought} chips with the ${packageType} package.`,
      payload,
      providerToken,
      "XTR",
      [{ label: "Casino Chips", amount: amount * 100 }],
      { start_parameter: "casino_purchase" }
    );

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("casino-mini-app");
    const transactions = db.collection("transactions");

    // Save invoice details in the database
    await transactions.insertOne({
      chatId,
      payload,
      amount,
      packageType,
      chipsBought,
      status: "pending",
      createdAt: new Date(),
    });

    await client.close();

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    console.error("Error creating invoice:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 });
  }
}
