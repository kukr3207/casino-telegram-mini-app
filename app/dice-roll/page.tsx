"use client";

import React, { useState } from "react";
import "../../styles/dice-roll.css";

export default function DiceRollPage() {
  const [selectedBets, setSelectedBets] = useState<{ category: string; option: string; amount: number }[]>([]);
  const [betAmount, setBetAmount] = useState<number>(10);
  const [isRolling, setIsRolling] = useState(false);
  const [rollResult, setRollResult] = useState<number | null>(null);

  const betOptions: Record<string, string[]> = {
    ranges: ["Low (2-6)", "High (8-12)"],
    exact: ["2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"],
    pairs: ["Double 1s", "Double 2s", "Double 3s", "Double 4s", "Double 5s", "Double 6s"],
    evenodd: ["Even", "Odd"],
  };

  const payoutRatios: Record<string, string> = {
    ranges: "1.95x",
    exact: "5x",
    pairs: "25x",
    evenodd: "1.95x",
  };

  const handleBetSelect = (category: string, option: string) => {
    const existingBet = selectedBets.find((bet) => bet.category === category && bet.option === option);
    if (existingBet) {
      // Remove bet if it's already selected
      setSelectedBets(selectedBets.filter((bet) => bet !== existingBet));
    } else {
      // Add a new bet
      setSelectedBets([...selectedBets, { category, option, amount: betAmount }]);
    }
  };

  const handleBetAmountChange = (amount: number, index: number) => {
    const updatedBets = [...selectedBets];
    updatedBets[index].amount = amount;
    setSelectedBets(updatedBets);
  };

  const handlePlaceBet = () => {
    if (selectedBets.length === 0 || isRolling) return;

    setIsRolling(true);
    setTimeout(() => {
      const diceRoll = Math.floor(Math.random() * 11) + 2; // Simulate dice roll (2-12)
      setRollResult(diceRoll);
      setIsRolling(false);
    }, 2000); // Simulate rolling delay
  };

  return (
    <div className="dice-roll-page">
      {/* Bet Category Buttons */}
      <div className="category-options">
        {Object.keys(betOptions).map((category) => (
          <div key={category} className="category">
            <h3>{category.charAt(0).toUpperCase() + category.slice(1)}</h3>
            <div className="bet-buttons">
              {betOptions[category].map((option) => (
                <button
                  key={option}
                  className={`bet-button ${selectedBets.find((bet) => bet.category === category && bet.option === option) ? "selected" : ""}`}
                  onClick={() => handleBetSelect(category, option)}
                >
                  {option}
                </button>
              ))}
            </div>
            <p className="payout-ratio">Payout: {payoutRatios[category]}</p>
          </div>
        ))}
      </div>

      {/* Selected Bets */}
      <div className="selected-bets">
        <h3>Your Bets</h3>
        {selectedBets.length === 0 && <p>No bets selected. Pick one above!</p>}
        {selectedBets.map((bet, index) => (
          <div key={`${bet.category}-${bet.option}`} className="bet-item">
            <span>{bet.category} - {bet.option}</span>
            <input
              type="number"
              min={10}
              value={bet.amount}
              onChange={(e) => handleBetAmountChange(Number(e.target.value), index)}
            />
          </div>
        ))}
      </div>

      {/* Place Bet Button */}
      <div className="place-bet">
        <button
          className="place-bet-button"
          onClick={handlePlaceBet}
          disabled={selectedBets.length === 0 || isRolling}
        >
          {isRolling ? "Rolling Dice..." : "Place Bet"}
        </button>
      </div>

      {/* Dice Roll Result */}
      {rollResult !== null && (
        <div className="dice-result">
          <h2>Dice Result: {rollResult}</h2>
          <p>
            {selectedBets.some((bet) => bet.option.includes(rollResult.toString()))
              ? "You won! 🎉"
              : "Better luck next time!"}
          </p>
        </div>
      )}
    </div>
  );
}
