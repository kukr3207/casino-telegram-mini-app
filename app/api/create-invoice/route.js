import { randomUUID } from "crypto";
import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    const { chatId, amount, packageType, chipsBought } = await req.json();

    if (!chatId || !amount || !packageType || !chipsBought) {
      return new Response(JSON.stringify({ error: "Missing required parameters" }), { status: 400 });
    }

    const payload = randomUUID();

    const response = await fetch(`https://api.telegram.org/bot7384344980:AAF6eFOEMZrgM-LvxP_hbSUrtjco5qasTaQ/createInvoiceLink`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `Buy ${chipsBought} Casino Chips`,
        description: `Get ${chipsBought} chips with the ${packageType} package.`,
        payload,
        provider_token: '',
        currency: "XTR",
        prices: [{ label: "Casino Chips", amount: amount * 100 }], // Smallest units for XTR
        start_parameter: "casino_purchase",
      }),
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error("Failed to create invoice link");
    }

    // Save the invoice details in the transactions table
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("casino-mini-app");
    const transactions = db.collection("transactions");

    await transactions.insertOne({
      chatId,
      payload,
      amount,
      packageType,
      chipsBought,
      invoiceLink: data.result,
      status: "pending",
      createdAt: new Date(),
    });

    await client.close();

    return new Response(JSON.stringify({ invoiceLink: data.result }), { status: 200 });
  } catch (error) {
    console.error("Error creating invoice:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 });
  }
}
