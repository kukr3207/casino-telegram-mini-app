import { randomUUID } from "crypto";
import { MongoClient } from "mongodb";

export async function POST(req) {
  try {
    const { chatId, amount, packageType, chipsBought } = await req.json();

    console.log("Creating invoice for:", { chatId, amount, packageType, chipsBought });

    if (!chatId || !amount || !packageType || !chipsBought) {
      console.error("Missing required parameters:", { chatId, amount, packageType, chipsBought });
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
        prices: [{ label: "Casino Chips", amount: amount }],
        start_parameter: "casino_purchase",
      }),
    });

    const data = await response.json();
    console.log("Create invoice response:", data);

    if (!data.ok) {
      console.error("Failed to create invoice link:", data);
      throw new Error("Failed to create invoice link");
    }

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

    console.log("Invoice saved to database for chatId:", chatId);
    await client.close();

    return new Response(JSON.stringify({ invoiceLink: data.result }), { status: 200 });
  } catch (error) {
    console.error("Error creating invoice:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 });
  }
}
