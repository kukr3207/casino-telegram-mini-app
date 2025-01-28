"use client";

import React, { useState } from "react";
import "../../styles/dice-roll.css";

export default function DiceRollPage() {
  const [selectedBets, setSelectedBets] = useState<{ category: string; option: string; amount: number }[]>([]);
  const [betAmount, setBetAmount] = useState<number>(10);
  const [isRolling, setIsRolling] = useState(false);
  const [diceResult, setDiceResult] = useState<number[]>([1, 1]); // Default dice values

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
      setSelectedBets(selectedBets.filter((bet) => bet !== existingBet));
    } else {
      setSelectedBets([...selectedBets, { category, option, amount: betAmount }]);
    }
  };

  const handleBetAmountChange = (amount: number, index: number) => {
    const updatedBets = [...selectedBets];
    updatedBets[index].amount = amount;
    setSelectedBets(updatedBets);
  };

  const handleRollDice = () => {
    if (selectedBets.length === 0 || isRolling) return;

    setIsRolling(true);
    setTimeout(() => {
      const dice1 = Math.floor(Math.random() * 6) + 1;
      const dice2 = Math.floor(Math.random() * 6) + 1;
      setDiceResult([dice1, dice2]);

      setIsRolling(false);
    }, 2000);
  };

  return (
    <div className="dice-roll-page">
      <h3 className="dice-roll-title">Place Your Bets and Roll the Dice 🎲</h3>

      {/* Bet Categories */}
      <div className="category-options">
        {Object.keys(betOptions).map((category) => (
          <div key={category} className="category">
            <h3>{category.charAt(0).toUpperCase() + category.slice(1)}</h3>
            <div className="bet-buttons">
              {betOptions[category].map((option) => (
                <button
                  key={option}
                  className={`bet-button ${
                    selectedBets.find((bet) => bet.category === category && bet.option === option)
                      ? "selected"
                      : ""
                  }`}
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
        {selectedBets.length === 0 ? (
          <p className="no-bets">No bets selected. Pick one above!</p>
        ) : (
          <div className="bet-list">
            {selectedBets.map((bet, index) => (
              <div key={`${bet.category}-${bet.option}`} className="bet-card">
                <span className="bet-text">{bet.category} - {bet.option}</span>
                <input
                  type="number"
                  min={10}
                  value={bet.amount}
                  className="bet-input"
                  onChange={(e) => handleBetAmountChange(Number(e.target.value), index)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dice Animation */}
      <div className="dice-container">
        <div className={`dice ${isRolling ? "rolling" : ""}`} data-value={diceResult[0]}>
          <div className="dot-container"></div>
        </div>
        <div className={`dice ${isRolling ? "rolling" : ""}`} data-value={diceResult[1]}>
          <div className="dot-container"></div>
        </div>
      </div>

      {/* Place Bet Button */}
      <div className="place-bet">
        <button className="place-bet-button" onClick={handleRollDice} disabled={selectedBets.length === 0 || isRolling}>
          {isRolling ? "Rolling Dice..." : "Roll Dice"}
        </button>
      </div>

      {/* Dice Roll Result */}
      {!isRolling && (
        <div className="dice-result">
          <h2>Result: {diceResult[0] + diceResult[1]}</h2>
        </div>
      )}
    </div>
  );
}
