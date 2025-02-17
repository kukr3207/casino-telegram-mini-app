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
      {/* Face numbering: front = 1, back = 6, right = 3, left = 4, top = 2, bottom = 5 */}
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

// Returns the inline transform string to bring the desired face to the front.
function getDiceCubeTransform(value: number): string {
  switch (value) {
    case 1:
      return "rotateX(0deg) rotateY(0deg) rotateZ(0deg)"; // Front (face 1)
    case 2:
      return "rotateX(-90deg) rotateY(0deg) rotateZ(0deg)"; // Top (face 2) becomes front
    case 3:
      return "rotateY(-90deg) rotateX(0deg) rotateZ(0deg)"; // Right (face 3) becomes front
    case 4:
      return "rotateY(90deg) rotateX(0deg) rotateZ(0deg)";  // Left (face 4) becomes front
    case 5:
      return "rotateX(90deg) rotateY(0deg) rotateZ(0deg)";  // Bottom (face 5) becomes front
    case 6:
      return "rotateY(180deg) rotateX(0deg) rotateZ(0deg)"; // Back (face 6) becomes front
    default:
      return "";
  }
}

// Computes the SHA-256 hash of a given seed and returns it as a hex string.
async function computeSHA256(seed: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(seed);
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
  // const [isActionProcessing, setIsActionProcessing] = useState(false);
  const [verificationResult, setVerificationResult] = useState<string>("");

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

  const handleBetSelect = (category: string, option: string): void => {
    const existingBet = selectedBets.find(
      (bet) => bet.category === category && bet.option === option
    );
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

    // Start continuous roll (simulate dice spinning)
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

  const [isActionProcessing, setIsActionProcessing] = useState(false);
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

  // --- Verification Functions ---
  const handleVerify = async () => {
    if (!verificationSeed || !rollHash) return;
    const computedHash = await computeSHA256(verificationSeed);
    if (computedHash === rollHash) {
      setVerificationResult("Verification Successful: The hash matches!");
    } else {
      setVerificationResult("Verification Failed: The computed hash does not match.");
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
        )}
      </div>

      <div className="place-bet">
        {!hasResult && (
          <button className="place-bet-button" onClick={handleRollDice} disabled={selectedBets.length === 0 || isRolling}>
            {isRolling ? "Rolling Dice..." : "Roll Dice"}
          </button>
        )}

        {hasResult && hasWon && (
          <button className="collect-button" onClick={handleCollectRewardsClick} disabled={isActionProcessing}>
            {isActionProcessing ? "Processing..." : "Collect Rewards"}
          </button>
        )}

        {hasResult && !hasWon && (
          <button className="reset-button" onClick={handleResetClick} disabled={isActionProcessing}>
            {isActionProcessing ? "Processing..." : "Reset"}
          </button>
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

      {/* Dice Result Section */}
      {!isRolling && rollHash && verificationSeed && (
        <div className="dice-result">
          <h2>Result: {diceResult[0]} + {diceResult[1]}</h2>
          <p><strong>Fairness Proof:</strong> {rollHash}</p>
          <p><strong>Verification Seed:</strong> {verificationSeed}</p>
          <div className="verification-section">
            <button className="earn-btn" onClick={handleVerify}>Verify</button>
            {verificationResult && <p>{verificationResult}</p>}
            <div className="verification-instructions">
              <p>How to verify:</p>
              <ol>
                <li>Click "Verify" to automatically compute the SHA‑256 hash of the Verification Seed.</li>
                <li>If you prefer manual verification, copy the Verification Seed.</li>
                <li>Paste it into an online SHA‑256 calculator (e.g. <a href="https://emn178.github.io/online-tools/sha256.html" target="_blank" rel="noreferrer">this one</a>).</li>
                <li>Compare the computed hash with the Fairness Proof above.</li>
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
