"use client";

import React, { useState } from "react";

export default function DiceRollPage() {
  const [betType, setBetType] = useState<"sum" | "pair" | "odd-even" | "range">("sum");
  const [selectedBet, setSelectedBet] = useState<string | number | null>(null);
  const [betAmount, setBetAmount] = useState(10);
  const [showRules, setShowRules] = useState(false);

  const handleIncreaseBet = () => setBetAmount((prev) => prev + 10);
  const handleDecreaseBet = () => setBetAmount((prev) => (prev > 10 ? prev - 10 : prev));

  const renderBetOptions = () => {
    switch (betType) {
      case "sum":
        return (
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 11 }, (_, i) => i + 2).map((num) => (
              <button
                key={num}
                className={`telegram-btn ${selectedBet === num ? "active" : ""}`}
                onClick={() => setSelectedBet(num)}
              >
                {num}
              </button>
            ))}
          </div>
        );
      case "pair":
        return (
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 6 }, (_, i) => i + 1).map((num) => (
              <button
                key={num}
                className={`telegram-btn ${selectedBet === `${num}-${num}` ? "active" : ""}`}
                onClick={() => setSelectedBet(`${num}-${num}`)}
              >
                {num}-{num}
              </button>
            ))}
          </div>
        );
      case "odd-even":
        return (
          <div className="flex gap-4 justify-center">
            <button
              className={`telegram-btn ${selectedBet === "Odd" ? "active" : ""}`}
              onClick={() => setSelectedBet("Odd")}
            >
              Odd
            </button>
            <button
              className={`telegram-btn ${selectedBet === "Even" ? "active" : ""}`}
              onClick={() => setSelectedBet("Even")}
            >
              Even
            </button>
          </div>
        );
      case "range":
        return (
          <div className="flex gap-4 justify-center">
            <button
              className={`telegram-btn ${selectedBet === "2-6" ? "active" : ""}`}
              onClick={() => setSelectedBet("2-6")}
            >
              2-6
            </button>
            <button
              className={`telegram-btn ${selectedBet === "8-12" ? "active" : ""}`}
              onClick={() => setSelectedBet("8-12")}
            >
              8-12
            </button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center px-4 py-6 space-y-8">
      {/* Header */}
      <h2 className="text-center text-xl font-bold mb-4">Dice Roll</h2>

      {/* Dice Animation */}
      <div className="flex justify-center items-center">
        <div className="dice-roll-animation">
          <div className="dice">🎲</div>
          <div className="dice">🎲</div>
        </div>
      </div>

      {/* Bet Type Selection */}
      <div className="w-full max-w-md bg-gray-800 p-4 rounded-lg shadow-lg">
        <h3 className="text-lg font-semibold mb-3 text-center">Choose Your Bet:</h3>
        <div className="flex justify-center gap-4 flex-wrap">
          <button
            className={`telegram-btn-small ${betType === "sum" ? "active" : ""}`}
            onClick={() => {
              setBetType("sum");
              setSelectedBet(null);
            }}
          >
            Sum
          </button>
          <button
            className={`telegram-btn-small ${betType === "pair" ? "active" : ""}`}
            onClick={() => {
              setBetType("pair");
              setSelectedBet(null);
            }}
          >
            Pair
          </button>
          <button
            className={`telegram-btn-small ${betType === "odd-even" ? "active" : ""}`}
            onClick={() => {
              setBetType("odd-even");
              setSelectedBet(null);
            }}
          >
            Odd-Even
          </button>
          <button
            className={`telegram-btn-small ${betType === "range" ? "active" : ""}`}
            onClick={() => {
              setBetType("range");
              setSelectedBet(null);
            }}
          >
            Range
          </button>
        </div>
      </div>

      {/* Bet Options */}
      <div className="w-full max-w-md bg-gray-800 p-4 rounded-lg shadow-lg">
        <h3 className="text-lg font-semibold mb-3 text-center">Select a Bet:</h3>
        {renderBetOptions()}
      </div>

      {/* Bet Amount */}
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

      {/* Rules Section */}
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
              <li>Bet on the sum, pair, odd/even, or a range of dice rolls.</li>
              <li>Payouts vary depending on the bet type and odds.</li>
              <li>The house has a 2% edge on all bets.</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
