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

interface DiceCubeProps {
  style: React.CSSProperties;
  rolling: boolean;
}

function DiceCube({ style, rolling }: DiceCubeProps) {
  return (
    <div className={`dice-cube ${rolling ? "rolling" : ""}`} style={style}>
      <div className="face front">
        <div className="pip pip-center"></div>
      </div>
      <div className="face back">
        <div className="pip pip-top-left"></div>
        <div className="pip pip-middle-left"></div>
        <div className="pip pip-bottom-left"></div>
        <div className="pip pip-top-right"></div>
        <div className="pip pip-middle-right"></div>
        <div className="pip pip-bottom-right"></div>
      </div>
      <div className="face right">
        <div className="pip pip-top-left"></div>
        <div className="pip pip-center"></div>
        <div className="pip pip-bottom-right"></div>
      </div>
      <div className="face left">
        <div className="pip pip-top-left"></div>
        <div className="pip pip-top-right"></div>
        <div className="pip pip-bottom-left"></div>
        <div className="pip pip-bottom-right"></div>
      </div>
      <div className="face top">
        <div className="pip pip-top-left"></div>
        <div className="pip pip-bottom-right"></div>
      </div>
      <div className="face bottom">
        <div className="pip pip-top-left"></div>
        <div className="pip pip-top-right"></div>
        <div className="pip pip-bottom-left"></div>
        <div className="pip pip-bottom-right"></div>
        <div className="pip pip-center"></div>
      </div>
    </div>
  );
}

function getDiceCubeTransform(value: number): string {
  switch (value) {
    case 1:
      return "rotateX(0deg) rotateY(0deg) rotateZ(0deg)";
    case 2:
      return "rotateX(-90deg) rotateY(0deg) rotateZ(0deg)";
    case 3:
      return "rotateY(-90deg) rotateX(0deg) rotateZ(0deg)";
    case 4:
      return "rotateY(90deg) rotateX(0deg) rotateZ(0deg)";
    case 5:
      return "rotateX(90deg) rotateY(0deg) rotateZ(0deg)";
    case 6:
      return "rotateY(180deg) rotateX(0deg) rotateZ(0deg)";
    default:
      return "";
  }
}

async function computeSHA256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return hashHex;
}

export default function DiceRollPage() {
  const [selectedBets, setSelectedBets] = useState<Bet[]>([]);
  const [betAmount, setBetAmount] = useState<number>(10);
  const [isRolling, setIsRolling] = useState(false);
  const [diceResult, setDiceResult] = useState<number[]>([1, 1]);
  const [rollHash, setRollHash] = useState<string | null>(null);
  const [verificationSeed, setVerificationSeed] = useState<string | null>(null);
  const [casinoChips, setCasinoChips] = useState<number>(0);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [hasResult, setHasResult] = useState(false);
  const [showDicePopup, setShowDicePopup] = useState(false);
  const [diceCubeStyles, setDiceCubeStyles] = useState<string[]>([]);
  const [isActionProcessing, setIsActionProcessing] = useState(false);
  const [verificationResult, setVerificationResult] = useState<string>("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [draggedBetIndex, setDraggedBetIndex] = useState<number | null>(null);
  const [isOverTrash, setIsOverTrash] = useState(false);

  const initialDiceCubeStyle = "rotateX(0deg) rotateY(0deg) rotateZ(0deg)";

  useEffect(() => {
    if (showDicePopup) {
      setDiceCubeStyles([initialDiceCubeStyle, initialDiceCubeStyle]);
    }
  }, [showDicePopup]);

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

  const payoutRatios: Record<string, number> = {
    ranges: 2,
    exact: 11,
    pairs: 15,
    evenodd: 2,
  };

  const toggleCategory = (category: string) => {
    setActiveCategory(activeCategory === category ? null : category);
  };

  const handleBetSelect = (category: string, option: string): void => {
    const existingIndex = selectedBets.findIndex(
      (bet) => bet.category === category && bet.option === option
    );
    if (existingIndex > -1) {
      const updated = [...selectedBets];
      updated.splice(existingIndex, 1);
      setSelectedBets(updated);
    } else {
      setSelectedBets([...selectedBets, { category, option, amount: betAmount }]);
    }
  };

  const handleBetAmountChange = (amount: number, index: number): void => {
    const updatedBets = [...selectedBets];
    updatedBets[index].amount = amount;
    setSelectedBets(updatedBets);
  };

  const handleCancelBet = (index: number) => {
    const updatedBets = selectedBets.filter((_, i) => i !== index);
    setSelectedBets(updatedBets);
  };

  // Drag handlers for bet cards (only when result is not shown)
  const handleDragStart = (index: number, event: React.DragEvent<HTMLDivElement>) => {
    if (hasResult) return;
    event.dataTransfer.setData("text/plain", index.toString());
    setDraggedBetIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedBetIndex(null);
  };

  const handleTrashDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsOverTrash(true);
  };

  const handleTrashDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    setIsOverTrash(false);
  };

  const handleTrashDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const indexString = event.dataTransfer.getData("text/plain");
    const index = parseInt(indexString);
    if (!isNaN(index)) {
      handleCancelBet(index);
    }
    setIsOverTrash(false);
    setDraggedBetIndex(null);
  };

  const handleRollDice = () => {
    if (selectedBets.length === 0 || isRolling) return;
    setShowConfirmation(true);
  };

  const confirmBet = async () => {
    setShowConfirmation(false);
    setShowDicePopup(true);
    setIsRolling(true);

    const totalBetAmount = selectedBets.reduce((sum, bet) => sum + bet.amount, 0);
    if (totalBetAmount > casinoChips) {
      alert("Insufficient balance! Adjust your bet amount.");
      return;
    }

    const updatedChips = casinoChips - totalBetAmount;
    setCasinoChips(updatedChips);
    await updateTokens(updatedChips, 0, 0);

    const rollingInterval = setInterval(() => {
      setDiceCubeStyles([
        `rotateX(${Math.floor(Math.random() * 360)}deg) rotateY(${Math.floor(
          Math.random() * 360
        )}deg) rotateZ(${Math.floor(Math.random() * 360)}deg)`,
        `rotateX(${Math.floor(Math.random() * 360)}deg) rotateY(${Math.floor(
          Math.random() * 360
        )}deg) rotateZ(${Math.floor(Math.random() * 360)}deg)`
      ]);
    }, 100);

    try {
      const chatId = sessionStorage.getItem("chat_id");
      const response = await fetch("/api/dice-roll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId })
      });
      const { dice1, dice2, hash, seed } = await response.json();

      setTimeout(() => {
        clearInterval(rollingInterval);
        requestAnimationFrame(() => {
          setIsRolling(false);
          requestAnimationFrame(() => {
            setDiceCubeStyles([getDiceCubeTransform(dice1), getDiceCubeTransform(dice2)]);
            setDiceResult([dice1, dice2]);
            setRollHash(hash);
            setVerificationSeed(seed);
            highlightBets(dice1, dice2);
            setHasResult(true);
          });
        });
      }, 2500);
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

    const betAmountTotal = selectedBets.reduce((sum, bet) => sum + bet.amount, 0);
    const winAmount = selectedBets.filter(bet => bet.isWin).reduce((sum, bet) => sum + (bet.winAmount || 0), 0);
    const lossAmount = betAmountTotal - winAmount;

    const wonBets = selectedBets.filter(bet => bet.isWin);
    const lostBets = selectedBets.filter(bet => !bet.isWin);

    const payload = {
      chatId,
      tokens: {
        casino_chips: tokens[0].count,
        withdraw_tokens: tokens[1].count,
        hol_tokens: tokens[2].count,
      },
      dice1: diceResult[0],
      dice2: diceResult[1],
      hash: rollHash,
      seed: verificationSeed,
      placedBets: selectedBets,
      wonBets,
      lostBets,
      betAmount: betAmountTotal,
      winAmount,
      lossAmount,
    };

    const response = await fetch("/api/game-update-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error("Failed to update tokens", await response.json());
    }
  };

  const handleCollectRewardsClick = async () => {
    setIsActionProcessing(true);
    await handleCollectRewards();
    setIsActionProcessing(false);
  };

  const handleCollectRewards = async () => {
    const winnings = selectedBets
      .filter((bet) => bet.isWin)
      .reduce((total, bet) => total + (bet.winAmount || 0), 0);
    const holdTokens = winnings - selectedBets.reduce((sum, bet) => sum + (bet.isWin ? bet.amount : 0), 0);

    await updateTokens(casinoChips, winnings, holdTokens);
    resetGame();
  };

  const handleResetClick = async () => {
    setIsActionProcessing(true);
    resetGame();
    setIsActionProcessing(false);
  };

  const resetGame = () => {
    setSelectedBets([]);
    setDiceResult([1, 1]);
    setRollHash(null);
    setVerificationSeed(null);
    setHasResult(false);
    setVerificationResult("");
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
        return (bet.option === "Even" && total % 2 === 0) || (bet.option === "Odd" && total % 2 !== 0);
      default:
        return false;
    }
  };

  const hasWon = selectedBets.some((bet) => bet.isWin);

  const handleVerify = async () => {
    if (!verificationSeed || !rollHash) return;
    const total = diceResult[0] + diceResult[1];
    const verificationInput = verificationSeed.trim() + total;
    const computedHash = await computeSHA256(verificationInput);
    if (computedHash === rollHash) {
      setVerificationResult("Verification Successful: The hash matches!");
    } else {
      setVerificationResult("Verification Failed: The computed hash does not match.");
      console.log("Computed Hash:", computedHash);
      console.log("Fairness Proof:", rollHash);
    }
  };

  return (
    <div className="dice-roll-page">
      <h3 className="dice-roll-title">Place Your Bets and Roll 🎲</h3>

      {/* Category Buttons */}
      <div className="category-options">
        {Object.keys(betOptions).map((category) => (
          <button
            key={category}
            onClick={() => toggleCategory(category)}
            className="category-button"
          >
            {category.charAt(0).toUpperCase() + category.slice(1)}
            <span className="toggle-icon">{activeCategory === category ? "−" : "+"}</span>
          </button>
        ))}
      </div>
      <p className="section-description">
        Click on any section to place bets (multiple bets are allowed).
      </p>

      {/* Bet Options Section */}
      {activeCategory && (
        <div className="bet-options">
          <h4 className="bet-options-title">
            Bet Options for {activeCategory.charAt(0).toUpperCase() + activeCategory.slice(1)}
          </h4>
          <div className="bet-buttons">
            {betOptions[activeCategory].map((option) => (
              <button
                key={option}
                className={`bet-button ${
                  selectedBets.some((bet) => bet.category === activeCategory && bet.option === option)
                    ? "selected"
                    : ""
                }`}
                onClick={() => handleBetSelect(activeCategory, option)}
              >
                {option}
              </button>
            ))}
          </div>
          <p className="payout-ratio">Payout: {payoutRatios[activeCategory]}x</p>
        </div>
      )}

      {/* Selected Bets Section */}
      <div className="selected-bets">
        <h3>Your Bets</h3>
        {selectedBets.length === 0 ? (
          <p className="no-bets">No bets selected. Pick a section above!</p>
        ) : (
          <>
            <div className="bet-list">
              {selectedBets.map((bet, index) => (
                <div
                  key={`${bet.category}-${bet.option}-${index}`}
                  className={`bet-card ${bet.isWin ? "win" : bet.isWin === false ? "lose" : ""}`}
                  draggable={!hasResult}
                  onDragStart={(e) => handleDragStart(index, e)}
                  onDragEnd={handleDragEnd}
                >
                  <span className="bet-text">
                    {bet.category} - {bet.option}
                  </span>
                  {bet.isWin !== undefined ? (
                    <p>{bet.isWin ? `Won: ${bet.winAmount} tokens` : `Lost: ${bet.amount} tokens`}</p>
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
            {/* Trash Bin inside Your Bets section (only when result not shown) */}
            {!hasResult && (
              <div
                className={`trash-bin ${isOverTrash ? "over" : ""}`}
                onDragOver={handleTrashDragOver}
                onDragLeave={handleTrashDragLeave}
                onDrop={handleTrashDrop}
              >
                Drag here to delete bet
              </div>
            )}
          </>
        )}
      </div>

      {/* Action Buttons */}
      <div className="place-bet">
        {!hasResult && (
          <button
            className="full-width-button place-bet-button"
            onClick={handleRollDice}
            disabled={selectedBets.length === 0 || isRolling}
          >
            {isRolling ? "Rolling Dice..." : "Roll Dice"}
          </button>
        )}
        {hasResult && hasWon && (
          <button
            className="full-width-button collect-button"
            onClick={handleCollectRewardsClick}
            disabled={isActionProcessing}
          >
            {isActionProcessing ? "Processing..." : "Collect Rewards"}
          </button>
        )}
        {hasResult && !hasWon && (
          <button
            className="full-width-button reset-button"
            onClick={handleResetClick}
            disabled={isActionProcessing}
          >
            {isActionProcessing ? "Processing..." : "Reset"}
          </button>
        )}
      </div>

      {showConfirmation && (
        <div className="popup-overlay">
          <div className="popup-content">
            <h3>Confirm Your Bet</h3>
            <p>Total Bet: {selectedBets.reduce((sum, bet) => sum + bet.amount, 0)} Chips</p>
            <button onClick={confirmBet} className="confirm-button full-width-button">
              Yes, Confirm
            </button>
            <button onClick={() => setShowConfirmation(false)} className="cancel-button full-width-button">
              No, Go Back
            </button>
          </div>
        </div>
      )}

      {showDicePopup && (
        <div className="popup-overlay" onClick={() => setShowDicePopup(false)}>
          <div className="dice-popup-content" onClick={(e) => e.stopPropagation()}>
            <h3>Dice Result 🎲</h3>
            <div className="dice-container">
              <DiceCube style={{ transform: diceCubeStyles[0] || initialDiceCubeStyle }} rolling={isRolling} />
              <DiceCube style={{ transform: diceCubeStyles[1] || initialDiceCubeStyle }} rolling={isRolling} />
            </div>
          </div>
        </div>
      )}

      {!isRolling && rollHash && verificationSeed && (
        <div className="dice-result">
          <div className="result-container">
            <div className="result-value">
              Result: {diceResult[0]} + {diceResult[1]}
            </div>
            <div className="hash-block">
              <strong>Fairness Proof:</strong> {rollHash}
            </div>
            <div className="hash-block">
              <strong>Verification Seed:</strong> {verificationSeed}
            </div>
          </div>
          <div className="verification-section">
            <button className="earn-btn" onClick={handleVerify}>
              Verify
            </button>
            {verificationResult && <p>{verificationResult}</p>}
            <div className="verification-instructions">
              <p>Manual Verification Steps:</p>
              <ol>
                <li>Copy the Verification Seed above.</li>
                <li>Add the two dice results together.</li>
                <li>
                  Concatenate the trimmed Verification Seed with the dice total.
                </li>
                <li>Use an online SHA‑256 calculator to compute the hash.</li>
                <li>Compare the computed hash with the Fairness Proof.</li>
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
