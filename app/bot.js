const TelegramBot = require("node-telegram-bot-api");
const { MongoClient } = require("mongodb");

const bot = new TelegramBot("7384344980:AAF6eFOEMZrgM-LvxP_hbSUrtjco5qasTaQ", { polling: true });

bot.on("pre_checkout_query", async (query) => {
  console.log("Pre-checkout query received:", query);
  try {
    await bot.answerPreCheckoutQuery(query.id, true);
    console.log("Pre-checkout query approved for payload:", query.invoice_payload);
  } catch (error) {
    console.error("Error approving pre-checkout query:", error);
  }
});

bot.on("successful_payment", async (msg) => {
  console.log("Successful payment received:", msg.successful_payment);

  let chatId = msg.from.id; // Ensure chatId is taken correctly
  const { total_amount, invoice_payload, telegram_payment_charge_id } = msg.successful_payment;

  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  const db = client.db("casino-mini-app");
  const transactions = db.collection("transactions");
  const payments = db.collection("payments");
  const users = db.collection("users");

  // Ensure chatId is always treated as a number
  chatId = parseFloat(chatId);

  // Find transaction in the database
  const transaction = await transactions.findOne({ payload: invoice_payload });
  if (!transaction) {
    console.error("Transaction not found for payload:", invoice_payload);
    return;
  }

  // Fetch the existing user's chips
  let user = await users.findOne({ chatId });

  if (!user) {
    console.warn("User not found with number chatId. Trying with string...");
    user = await users.findOne({ chatId: chatId.toString() });
  }

  if (!user) {
    console.error("User not found in database. Aborting update.");
    return;
  }

  // Calculate the updated chips balance
  const newCasinoChips = transaction.chipsBought;
  const updatedChips = (user.casino_chips || 0) + newCasinoChips;

  // Update users table (ENSURE IT ONLY UPDATES EXISTING USER)
  await users.updateOne(
    { _id: user._id }, // Use `_id` to make sure we're updating the correct user
    { $set: { casino_chips: updatedChips }, $currentDate: { updatedAt: true } }
  );

  // Update transactions table
  await transactions.updateOne(
    { payload: invoice_payload },
    { $set: { status: "completed" } }
  );

  // Add to payments table
  await payments.insertOne({
    chatId,
    transactionId: telegram_payment_charge_id,
    starsSpent: total_amount / 100,
    casinoChipsReceived: newCasinoChips,
    status: "completed",
    createdAt: new Date(),
  });

  console.log(`✅ Payment processed successfully for chatId: ${chatId}, new chips: ${updatedChips}`);

  await client.close();

  /**  
   * ✅ **Now, update the session storage directly using JavaScript in the frontend**
   */
  bot.sendMessage(
    chatId,
    JSON.stringify({
      type: "update_tokens",
      tokens: [
        { id: 1, image: "/images/token1.png", count: updatedChips },
        { id: 2, image: "/images/token2.png", count: user.withdraw_tokens || 0 },
        { id: 3, image: "/images/token3.png", count: user.hol_tokens || 0 },
      ],
    })
  );
});
