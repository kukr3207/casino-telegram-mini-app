"use client";

import React, { useState } from "react";
import "../../styles/dice-roll.css";

export default function DiceRollPage() {
  const [selectedBet, setSelectedBet] = useState<string | null>(null);
  const [betAmount, setBetAmount] = useState(10);
  const [showRules, setShowRules] = useState(false);

  const handleIncreaseBet = () => setBetAmount((prev) => prev + 10);
  const handleDecreaseBet = () => setBetAmount((prev) => (prev > 10 ? prev - 10 : prev));

  return (
    <div className="min-h-screen">
      <div className="dice-roll-container">
        <h2>Dice Roll</h2>

        <div className="dice-roll-animation">
          <div className="dice">🎲</div>
          <div className="dice">🎲</div>
        </div>

        <div>
          <h3 className="text-xl">Choose Your Bet:</h3>
          <div className="flex justify-center gap-6">
            <button
              className={`casino-btn ${selectedBet === "sum" ? "active-glow" : ""}`}
              onClick={() => setSelectedBet("sum")}
            >
              Sum
            </button>
            <button
              className={`casino-btn ${selectedBet === "pair" ? "active-glow" : ""}`}
              onClick={() => setSelectedBet("pair")}
            >
              Pair
            </button>
            <button
              className={`casino-btn ${selectedBet === "odd-even" ? "active-glow" : ""}`}
              onClick={() => setSelectedBet("odd-even")}
            >
              Odd-Even
            </button>
          </div>
        </div>

        <div className="mt-4">
          <h3 className="text-xl">Bet Amount:</h3>
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={handleDecreaseBet}
              className="casino-btn-secondary px-4 py-2 text-2xl"
            >
              -
            </button>
            <span className="text-3xl font-extrabold">{betAmount}</span>
            <button
              onClick={handleIncreaseBet}
              className="casino-btn-secondary px-4 py-2 text-2xl"
            >
              +
            </button>
          </div>
        </div>

        <button className="casino-btn w-full mt-4">Place Bet</button>

        <div className="mt-6">
          <p
            className="rules-toggle"
            onClick={() => setShowRules(!showRules)}
          >
            Show Rules {showRules ? "▲" : "▼"}
          </p>
          {showRules && (
            <div className="rules-content">
              <p><strong>Game Rules:</strong></p>
              <ul className="list-disc pl-6">
                <li>Choose your bet type: Sum, Pair, Odd-Even.</li>
                <li>Payouts vary based on the bet type.</li>
                <li>The house has a 2% edge on all bets.</li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
