"use client";

import React, { useState, useEffect } from "react";
import "../../styles/dice-roll.css";

interface Bet {
  category: string;
  option: string;
  amount: number;
  isWin?: boolean;
}

export default function DiceRollPage() {
  const [selectedBets, setSelectedBets] = useState<Bet[]>([]);
  const [betAmount, setBetAmount] = useState<number>(10);
  const [isRolling, setIsRolling] = useState(false);
  const [diceResult, setDiceResult] = useState<number[]>([1, 1]);
  const [rollHash, setRollHash] = useState<string | null>(null);
  const [verificationSeed, setVerificationSeed] = useState<string | null>(null);
  const [casinoChips, setCasinoChips] = useState<number>(0);
  const [showPopup, setShowPopup] = useState(false); // Popup control

  useEffect(() => {
    const tokens = sessionStorage.getItem("tokens");
    if (tokens) {
      const parsedTokens = JSON.parse(tokens);
      setCasinoChips(parsedTokens[0]?.count || 0);
    }
  }, []);

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

  const handleBetSelect = (category: string, option: string): void => {
    const existingBet = selectedBets.find((bet: Bet) => bet.category === category && bet.option === option);
    if (existingBet) {
      setSelectedBets(selectedBets.filter((bet: Bet) => bet !== existingBet));
    } else {
      setSelectedBets([...selectedBets, { category, option, amount: betAmount }]);
    }
  };

  const handleBetAmountChange = (amount: number, index: number): void => {
    const updatedBets = [...selectedBets];
    updatedBets[index].amount = amount;
    setSelectedBets(updatedBets);
  };

  const handleRollDice = async () => {
    if (selectedBets.length === 0 || isRolling) return;

    const totalBetAmount = selectedBets.reduce((sum, bet) => sum + bet.amount, 0);
    if (totalBetAmount > casinoChips) {
      alert("Insufficient balance! Adjust your bet amount.");
      return;
    }

    setIsRolling(true);
    setShowPopup(true); // Show dice roll popup

    try {
      const response = await fetch("/api/dice-roll", { method: "POST" });
      const { dice1, dice2, hash, seed } = await response.json();

      setRollHash(hash);
      setVerificationSeed(seed);
      setDiceResult([dice1, dice2]);

      setTimeout(() => {
        highlightBets(dice1, dice2);
        setIsRolling(false);
      }, 3000); // Stop animation after 3 seconds
    } catch (error) {
      console.error("Error rolling dice:", error);
      setIsRolling(false);
    }
  };

  const highlightBets = (dice1: number, dice2: number): void => {
    const total = dice1 + dice2;
    setSelectedBets((prevBets) =>
      prevBets.map((bet: Bet) => {
        const isWin = checkBetWin(bet, dice1, dice2, total);
        return { ...bet, isWin };
      })
    );
  };

  const checkBetWin = (bet: Bet, dice1: number, dice2: number, total: number): boolean => {
    switch (bet.category) {
      case "ranges":
        return (bet.option === "Low (2-6)" && total >= 2 && total <= 6) ||
               (bet.option === "High (8-12)" && total >= 8 && total <= 12);
      case "exact":
        return total === parseInt(bet.option);
      case "pairs":
        return bet.option === `Double ${dice1}s` && dice1 === dice2;
      case "evenodd":
        return (bet.option === "Even" && total % 2 === 0) ||
               (bet.option === "Odd" && total % 2 !== 0);
      default:
        return false;
    }
  };

  return (
    <div className="dice-roll-page">
      <h3 className="dice-roll-title">Place Your Bets and Roll the Dice 🎲</h3>

      <div className="category-options">
        {Object.keys(betOptions).map((category) => (
          <div key={category} className="category">
            <h3>{category.charAt(0).toUpperCase() + category.slice(1)}</h3>
            <div className="bet-buttons">
              {betOptions[category].map((option) => (
                <button
                  key={option}
                  className={`bet-button ${
                    selectedBets.some((bet: Bet) => bet.category === category && bet.option === option)
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

      <div className="selected-bets">
        <h3>Your Bets</h3>
        {selectedBets.length === 0 ? (
          <p className="no-bets">No bets selected. Pick one above!</p>
        ) : (
          <div className="bet-list">
            {selectedBets.map((bet, index) => (
              <div key={`${bet.category}-${bet.option}`} className={`bet-card ${bet.isWin === true ? "win" : bet.isWin === false ? "lose" : ""}`}>
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

      <div className="place-bet">
        <button className="place-bet-button" onClick={handleRollDice} disabled={selectedBets.length === 0 || isRolling}>
          {isRolling ? "Rolling Dice..." : "Roll Dice"}
        </button>
      </div>

      {!isRolling && rollHash && (
        <div className="dice-result">
          <h2>Result: {diceResult[0]} + {diceResult[1]}</h2>
          <p><strong>Fairness Proof:</strong> {rollHash}</p>
          <p><strong>Verification Seed:</strong> {verificationSeed}</p>
        </div>
      )}

      {showPopup && (
        <div className="popup-overlay" onClick={() => setShowPopup(false)}>
          <div className="popup-content">
            {!isRolling ? (
              <h2>🎲 Result: {diceResult[0]} + {diceResult[1]}</h2>
            ) : (
              <div className="popup-dice-container">
                <div className="dice rolling" data-value="1"></div>
                <div className="dice rolling" data-value="1"></div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
