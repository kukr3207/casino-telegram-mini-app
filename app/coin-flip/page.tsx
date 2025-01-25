"use client";

import React, { useState, useEffect } from "react";
import "../../styles/coin-flip.css";

export default function CoinFlipPage() {
  const [selectedBet, setSelectedBet] = useState<"heads" | "tails" | null>(null);
  const [betAmount, setBetAmount] = useState(10);
  const [showRules, setShowRules] = useState(false);

  const handleIncreaseBet = () => setBetAmount((prev) => prev + 10);
  const handleDecreaseBet = () => setBetAmount((prev) => (prev > 10 ? prev - 10 : prev));

//   useEffect(() => {
//     if (typeof window !== "undefined" && window.Telegram?.WebApp) {
//       const tg = window.Telegram.WebApp;

//       // Configure Telegram Main Button
//       tg.MainButton.text = "Place Bet";
//       tg.MainButton.show();
//       tg.MainButton.onClick(() => {
//         console.log(`Placed bet: ${selectedBet}, Amount: ${betAmount}`);
//         tg.close();
//       });

//       return () => {
//         tg.MainButton.hide();
//       };
//     }
//   }, [selectedBet, betAmount]);

  return (
    <div className="min-h-screen">
      <div className="coin-flip-container">
        <h2>Coin Flip</h2>
        <div className="coin-flip-animation">
          <div className="coin">
            <div className="coin-front"></div>
            <div className="coin-back"></div>
          </div>
        </div>

        <div>
          <h3 className="text-xl">Bet On:</h3>
          <div>
            <button
              className={`casino-btn ${selectedBet === "heads" ? "active-glow" : ""}`}
              onClick={() => setSelectedBet("heads")}
            >
              Heads
            </button>
            <button
              className={`casino-btn ${selectedBet === "tails" ? "active-glow" : ""}`}
              onClick={() => setSelectedBet("tails")}
            >
              Tails
            </button>
          </div>
        </div>

        <div>
          <h3 className="text-xl">Bet Amount:</h3>
          <div className="bet-amount-wrapper">
            <button
              onClick={handleDecreaseBet}
              className="casino-btn-secondary"
            >
              -
            </button>
            <span>{betAmount}</span>
            <button
              onClick={handleIncreaseBet}
              className="casino-btn-secondary"
            >
              +
            </button>
          </div>
        </div>

        <button className="casino-btn">Place Bet</button>

        <p
          className="rules-toggle"
          onClick={() => setShowRules(!showRules)}
        >
          Show Rules {showRules ? "▲" : "▼"}
        </p>
        {showRules && (
          <div className="rules-content">
            <p><strong>Game Rules:</strong></p>
            <ul>
              <li>Bet on either Heads or Tails.</li>
              <li>Payouts are 1:1 for a correct guess.</li>
              <li>The house has a 2% edge on all bets.</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
