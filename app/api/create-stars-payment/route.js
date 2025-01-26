import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const { chatId, amount } = await req.json();

    if (!chatId || !amount) {
      return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    // Example payment URL for Telegram Stars (replace with your actual bot token and setup)
    const botToken = process.env.BOT_TOKEN;
    const paymentLink = `https://t.me/${process.env.BOT_USERNAME}?start=buy_${amount}_${chatId}`;

    // Optionally, log or store payment info in the database
    console.log(`Created payment link for Chat ID: ${chatId}, Amount: ${amount}`);

    return NextResponse.json({ paymentLink });
  } catch (error) {
    console.error("Error creating payment:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
