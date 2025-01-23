"use client";

import React, { useState, useEffect } from "react";

export default function CoinFlipPage() {
  const [selectedBet, setSelectedBet] = useState<"heads" | "tails" | null>(null);
  const [betAmount, setBetAmount] = useState(10);
  const [showRules, setShowRules] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;

      // Configure Telegram Main Button
      tg.MainButton.text = "Place Bet";
      tg.MainButton.show();
      tg.MainButton.onClick(() => {
        console.log(`Placed bet on ${selectedBet} with ${betAmount} tokens`);
        tg.close(); // Close the Mini App after the action
      });

      // Adjust the theme
      const theme = tg.colorScheme; // 'dark' or 'light'
      document.body.setAttribute("data-theme", theme);

      return () => {
        tg.MainButton.hide(); // Hide MainButton when leaving the page
      };
    }
  }, [selectedBet, betAmount]);

  const handleIncreaseBet = () => setBetAmount((prev) => prev + 10);
  const handleDecreaseBet = () => setBetAmount((prev) => (prev > 10 ? prev - 10 : prev));

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center px-4 py-6 space-y-8">
      <h2 className="text-center text-xl font-bold mb-4">Coin Flip</h2>

      <div className="relative flex justify-center items-center">
        <div className="coin-container">
          <div className="coin">
            <div className="coin-side coin-front">
              <img src="/images/token1.png" alt="Heads" className="w-full h-full rounded-full" />
            </div>
            <div className="coin-side coin-back">
              <img src="/images/token2.png" alt="Tails" className="w-full h-full rounded-full" />
            </div>
          </div>
        </div>
      </div>

      <div className="w-full max-w-md bg-gray-800 p-4 rounded-lg shadow-lg">
        <h3 className="text-lg font-semibold mb-3 text-center">Bet On:</h3>
        <div className="flex justify-center gap-4">
          <button
            className={`telegram-btn w-24 ${selectedBet === "heads" ? "active" : ""}`}
            onClick={() => setSelectedBet("heads")}
          >
            Heads
          </button>
          <button
            className={`telegram-btn w-24 ${selectedBet === "tails" ? "active" : ""}`}
            onClick={() => setSelectedBet("tails")}
          >
            Tails
          </button>
        </div>
      </div>

      <div className="w-full max-w-md bg-gray-800 p-4 rounded-lg shadow-lg">
        <h3 className="text-lg font-semibold mb-3 text-center">Bet Amount:</h3>
        <div className="flex items-center justify-center gap-6">
          <button
            onClick={handleDecreaseBet}
            className="telegram-btn-secondary px-4 py-2 text-xl"
          >
            -
          </button>
          <span className="text-2xl font-bold">{betAmount}</span>
          <button
            onClick={handleIncreaseBet}
            className="telegram-btn-secondary px-4 py-2 text-xl"
          >
            +
          </button>
        </div>
      </div>

      <div className="w-full max-w-md bg-gray-800 p-4 rounded-lg shadow-lg">
        <button
          onClick={() => setShowRules(!showRules)}
          className="text-blue-400 underline w-full text-left"
        >
          {showRules ? "Hide Rules" : "Show Rules"}
        </button>
        {showRules && (
          <div className="mt-4 bg-gray-700 p-4 rounded-lg text-left text-sm">
            <p><strong>Game Rules:</strong></p>
            <ul className="list-disc pl-6">
              <li>Bet on either Heads or Tails.</li>
              <li>Winning the coin flip doubles your bet.</li>
              <li>The house has a 2% edge on every flip.</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}