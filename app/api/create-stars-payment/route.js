import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const { chatId, amount } = await req.json();

    if (!chatId || !amount) {
      return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    // Create the payment link for Telegram Stars
    const botToken = process.env.BOT_TOKEN; // Ensure this is set in Vercel env vars
    const botUsername = process.env.BOT_USERNAME; // Ensure this is set in Vercel env vars
    const paymentLink = `https://t.me/${botUsername}?start=buy_${amount}_${chatId}`;

    console.log(`Payment link created for Chat ID: ${chatId}, Amount: ${amount}`);

    return NextResponse.json({ paymentLink });
  } catch (error) {
    console.error("Error creating payment:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
