const TelegramBot = require('node-telegram-bot-api');

// Replace with your bot token
const BOT_TOKEN = '7384344980:AAF6eFOEMZrgM-LvxP_hbSUrtjco5qasTaQ';

// Web App URL
const WEB_APP_URL = 'https://casino-telegram-mini-app.vercel.app/';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Handle the /start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  // Send a Web App button
  bot.sendMessage(chatId, 'Welcome to the House Of Luck!', {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: 'Open House Of Luck App',
            web_app: { url: WEB_APP_URL }, // Open the web app
          },
        ],
      ],
    },
  });
});

console.log('Bot is running...');

// Serverless function handler
export default async function handler(req, res) {
    initBot(); // Initialize the bot if not already running
    res.status(200).json({ status: "Bot is running" });
  }