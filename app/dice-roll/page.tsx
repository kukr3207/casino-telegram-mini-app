"use client";

import React, { useState, useEffect } from "react";
import "../../styles/dice-roll.css";

interface Bet {
  category: string;
  option: string;
  amount: number;
  isWin?: boolean;
  winAmount?: number;
}

export default function DiceRollPage() {
  const [selectedBets, setSelectedBets] = useState<Bet[]>([]);
  const [betAmount, setBetAmount] = useState<number>(10);
  const [isRolling, setIsRolling] = useState(false);
  const [diceResult, setDiceResult] = useState<number[]>([1, 1]);
  const [rollHash, setRollHash] = useState<string | null>(null);
  const [verificationSeed, setVerificationSeed] = useState<string | null>(null);
  const [casinoChips, setCasinoChips] = useState<number>(0);
  const [showCollectButton, setShowCollectButton] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [rollingDice, setRollingDice] = useState<number[]>([1, 1]);

  const betOptions: Record<string, string[]> = {
    ranges: ["Low (2-6)", "High (8-12)"],
    exact: ["2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"],
    pairs: ["Double 1s", "Double 2s", "Double 3s", "Double 4s", "Double 5s", "Double 6s"],
    evenodd: ["Even", "Odd"],
  };

  const payoutRatios: Record<string, number> = {
    ranges: 1.9,
    exact: 10,
    pairs: 15,
    evenodd: 1.9,
  };

  useEffect(() => {
    const tokens = sessionStorage.getItem("tokens");
    if (tokens) {
      const parsedTokens = JSON.parse(tokens);
      setCasinoChips(parsedTokens[0]?.count || 0);
    }
  }, []);

  const handleBetSelect = (category: string, option: string): void => {
    const existingBet = selectedBets.find((bet) => bet.category === category && bet.option === option);
    if (existingBet) {
      setSelectedBets(selectedBets.filter((bet) => bet !== existingBet));
    } else {
      setSelectedBets([...selectedBets, { category, option, amount: betAmount }]);
    }
  };

  const handleBetAmountChange = (amount: number, index: number): void => {
    const updatedBets = [...selectedBets];
    updatedBets[index].amount = amount;
    setSelectedBets(updatedBets);
  };

  const handleRollDice = () => {
    if (selectedBets.length === 0 || isRolling) return;
    setShowConfirmation(true);
  };

  const confirmBet = async () => {
    setShowConfirmation(false);

    const totalBetAmount = selectedBets.reduce((sum, bet) => sum + bet.amount, 0);
    if (totalBetAmount > casinoChips) {
      alert("Insufficient balance! Adjust your bet amount.");
      return;
    }

    const updatedChips = casinoChips - totalBetAmount;
    setCasinoChips(updatedChips);
    await updateTokens(updatedChips, 0, 0);

    setIsRolling(true);
    setRollingDice([1, 1]);

    const rollingInterval = setInterval(() => {
      setRollingDice([Math.ceil(Math.random() * 6), Math.ceil(Math.random() * 6)]);
    }, 100);

    try {
      const response = await fetch("/api/dice-roll", { method: "POST" });
      const { dice1, dice2, hash, seed } = await response.json();

      setTimeout(() => {
        clearInterval(rollingInterval);
        setDiceResult([dice1, dice2]);
        setRollHash(hash);
        setVerificationSeed(seed);
        highlightBets(dice1, dice2);
        setIsRolling(false);
        setShowCollectButton(true);
      }, 3000);
    } catch (error) {
      console.error("Error rolling dice:", error);
      clearInterval(rollingInterval);
      setIsRolling(false);
    }
  };

  const updateTokens = async (casinoChips: number, withdrawalTokens: number, holTokens: number) => {
    const chatId = sessionStorage.getItem("chat_id");
    const tokens = JSON.parse(sessionStorage.getItem("tokens") || "[]");

    tokens[0].count = casinoChips;
    tokens[1].count += withdrawalTokens;
    tokens[2].count += holTokens;

    sessionStorage.setItem("tokens", JSON.stringify(tokens));

    await fetch("/api/game-update-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId,
        tokens: {
          casino_chips: tokens[0].count,
          withdraw_tokens: tokens[1].count,
          hol_tokens: tokens[2].count,
        },
      }),
    });
  };

  const handleCollectRewards = async () => {
    const winnings = selectedBets
      .filter((bet) => bet.isWin)
      .reduce((total, bet) => total + (bet.winAmount || 0), 0);

    const betAmountWon = selectedBets
      .filter((bet) => bet.isWin)
      .reduce((sum, bet) => sum + bet.amount, 0);

    const holdTokens = winnings - betAmountWon;
    const withdrawTokens = winnings + betAmountWon;

    await updateTokens(casinoChips, withdrawTokens, holdTokens);

    resetGame();
  };

  const resetGame = () => {
    setSelectedBets([]);
    setDiceResult([1, 1]);
    setRollHash(null);
    setVerificationSeed(null);
    setShowCollectButton(false);
  };

  const highlightBets = (dice1: number, dice2: number): void => {
    const total = dice1 + dice2;
    setSelectedBets((prevBets) =>
      prevBets.map((bet) => {
        const isWin = checkBetWin(bet, dice1, dice2, total);
        const payout = payoutRatios[bet.category] || 1;
        return {
          ...bet,
          isWin,
          winAmount: isWin ? bet.amount * payout : 0,
        };
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
                    selectedBets.some((bet) => bet.category === category && bet.option === option)
                      ? "selected"
                      : ""
                  }`}
                  onClick={() => handleBetSelect(category, option)}
                >
                  {option}
                </button>
              ))}
            </div>
            <p className="payout-ratio">Payout: {payoutRatios[category]}x</p>
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
              <div key={`${bet.category}-${bet.option}`} className={`bet-card ${bet.isWin ? "win" : bet.isWin === false ? "lose" : ""}`}>
                <span className="bet-text">{bet.category} - {bet.option}</span>
                {bet.isWin !== undefined ? (
                  <span>{bet.isWin ? `Won: ${bet.winAmount}` : `Lost: ${bet.amount}`}</span>
                ) : (
                  <input
                    type="number"
                    min={10}
                    value={bet.amount}
                    className="bet-input"
                    onChange={(e) => handleBetAmountChange(Number(e.target.value), index)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="place-bet">
        <button className="place-bet-button" onClick={handleRollDice} disabled={selectedBets.length === 0 || isRolling}>
          {isRolling ? "Rolling Dice..." : "Roll Dice"}
        </button>
        {showCollectButton && (
          <button className="collect-button" onClick={handleCollectRewards}>Collect Rewards</button>
        )}
      </div>

      {showConfirmation && (
        <div className="popup-overlay">
          <div className="popup-content">
            <h3>Confirm Your Bet</h3>
            <p>Total Bet: {selectedBets.reduce((sum, bet) => sum + bet.amount, 0)} Chips</p>
            <button onClick={confirmBet} className="confirm-button">Yes, Confirm</button>
            <button onClick={() => setShowConfirmation(false)} className="cancel-button">No, Go Back</button>
          </div>
        </div>
      )}

      {!isRolling && rollHash && (
        <div className="dice-result">
          <h2>Result: {diceResult[0]} + {diceResult[1]}</h2>
          <p><strong>Fairness Proof:</strong> {rollHash}</p>
          <p><strong>Verification Seed:</strong> {verificationSeed}</p>
        </div>
      )}
    </div>
  );
}
