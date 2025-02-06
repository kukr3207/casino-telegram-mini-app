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

// A realistic 3D dice cube with dotted faces
interface DiceCubeProps {
  style: React.CSSProperties;
  rolling: boolean;
}
function DiceCube({ style, rolling }: DiceCubeProps) {
  return (
    <div className={`dice-cube ${rolling ? "rolling" : ""}`} style={style}>
      {/* Face numbering: front = 1, back = 6, right = 3, left = 4, top = 2, bottom = 5 */}
      <div className="face front">
        {/* Face 1: single pip in center */}
        <div className="pip pip-center"></div>
      </div>
      <div className="face back">
        {/* Face 6: two columns of three pips */}
        <div className="pip pip-top-left"></div>
        <div className="pip pip-middle-left"></div>
        <div className="pip pip-bottom-left"></div>
        <div className="pip pip-top-right"></div>
        <div className="pip pip-middle-right"></div>
        <div className="pip pip-bottom-right"></div>
      </div>
      <div className="face right">
        {/* Face 3: pips at top-left, center, bottom-right */}
        <div className="pip pip-top-left"></div>
        <div className="pip pip-center"></div>
        <div className="pip pip-bottom-right"></div>
      </div>
      <div className="face left">
        {/* Face 4: pips at top-left, top-right, bottom-left, bottom-right */}
        <div className="pip pip-top-left"></div>
        <div className="pip pip-top-right"></div>
        <div className="pip pip-bottom-left"></div>
        <div className="pip pip-bottom-right"></div>
      </div>
      <div className="face top">
        {/* Face 2: pips at top-left and bottom-right */}
        <div className="pip pip-top-left"></div>
        <div className="pip pip-bottom-right"></div>
      </div>
      <div className="face bottom">
        {/* Face 5: four corner pips and one in center */}
        <div className="pip pip-top-left"></div>
        <div className="pip pip-top-right"></div>
        <div className="pip pip-bottom-left"></div>
        <div className="pip pip-bottom-right"></div>
        <div className="pip pip-center"></div>
      </div>
    </div>
  );
}

// Mapping function to compute the final transform so that the correct face is on top.
// (These values are chosen by trial to give distinct rotations. Adjust as needed.)
function getDiceCubeTransform(value: number): string {
  switch (value) {
    case 1:
      return "rotateX(-90deg) rotateY(0deg) rotateZ(0deg)";
    case 2:
      return "rotateX(0deg) rotateY(0deg) rotateZ(0deg)";
    case 3:
      return "rotateX(0deg) rotateY(0deg) rotateZ(90deg)";
    case 4:
      return "rotateX(0deg) rotateY(0deg) rotateZ(-90deg)";
    case 5:
      return "rotateX(180deg) rotateY(0deg) rotateZ(0deg)";
    case 6:
      return "rotateX(90deg) rotateY(0deg) rotateZ(0deg)";
    default:
      return "";
  }
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

  // Holds the inline transform for each dice cube (final orientation when result arrives)
  const [diceCubeStyles, setDiceCubeStyles] = useState<string[]>([]);

  // Initial style (the cube is already on the table)
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

    // Start continuous realistic roll (the dice cubes have the "rolling" class).
    try {
      const response = await fetch("/api/dice-roll", { method: "POST" });
      const { dice1, dice2, hash, seed } = await response.json();

      // After a continuous roll (animation runs for a couple of seconds), stop the rolling
      setTimeout(() => {
        // Set each cube’s inline style so that the correct face is on top.
        setDiceCubeStyles([getDiceCubeTransform(dice1), getDiceCubeTransform(dice2)]);
        setDiceResult([dice1, dice2]);
        setRollHash(hash);
        setVerificationSeed(seed);
        highlightBets(dice1, dice2);
        setIsRolling(false);
        setHasResult(true);
      }, 2500); // Adjust the duration (in ms) as needed for a realistic roll
    } catch (error) {
      console.error("Error rolling dice:", error);
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

    const betAmount = selectedBets.reduce((sum, bet) => sum + bet.amount, 0);
    const winAmount = selectedBets
      .filter((bet) => bet.isWin)
      .reduce((sum, bet) => sum + (bet.winAmount || 0), 0);
    const lossAmount = betAmount - winAmount;

    const wonBets = selectedBets.filter((bet) => bet.isWin);
    const lostBets = selectedBets.filter((bet) => !bet.isWin);

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
      betAmount,
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

  const handleCollectRewards = async () => {
    const winnings = selectedBets
      .filter((bet) => bet.isWin)
      .reduce((total, bet) => total + (bet.winAmount || 0), 0);

    const holdTokens =
      winnings - selectedBets.reduce((sum, bet) => sum + (bet.isWin ? bet.amount : 0), 0);

    await updateTokens(casinoChips, winnings, holdTokens);
    resetGame();
  };

  const resetGame = () => {
    setSelectedBets([]);
    setDiceResult([1, 1]);
    setRollHash(null);
    setVerificationSeed(null);
    setHasResult(false);
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
        return (
          (bet.option === "Low (2-6)" && total >= 2 && total <= 6) ||
          (bet.option === "High (8-12)" && total >= 8 && total <= 12)
        );
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
              <div
                key={`${bet.category}-${bet.option}`}
                className={`bet-card ${bet.isWin ? "win" : bet.isWin === false ? "lose" : ""}`}
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
        )}
      </div>

      <div className="place-bet">
        {!hasResult && (
          <button className="place-bet-button" onClick={handleRollDice} disabled={selectedBets.length === 0 || isRolling}>
            {isRolling ? "Rolling Dice..." : "Roll Dice"}
          </button>
        )}

        {hasResult && hasWon && (
          <button className="collect-button" onClick={handleCollectRewards}>
            Collect Rewards
          </button>
        )}

        {hasResult && !hasWon && (
          <button className="reset-button" onClick={resetGame}>
            Reset
          </button>
        )}
      </div>

      {showConfirmation && (
        <div className="popup-overlay">
          <div className="popup-content">
            <h3>Confirm Your Bet</h3>
            <p>Total Bet: {selectedBets.reduce((sum, bet) => sum + bet.amount, 0)} Chips</p>
            <button onClick={confirmBet} className="confirm-button">
              Yes, Confirm
            </button>
            <button onClick={() => setShowConfirmation(false)} className="cancel-button">
              No, Go Back
            </button>
          </div>
        </div>
      )}

      {showDicePopup && (
        <div className="popup-overlay" onClick={() => setShowDicePopup(false)}>
          <div className="dice-popup-content" onClick={(e) => e.stopPropagation()}>
            <h3>{isRolling ? "Rolling Dice..." : "Dice Result 🎲"}</h3>
            <div className="dice-container">
              <DiceCube
                style={{ transform: diceCubeStyles[0] || initialDiceCubeStyle }}
                rolling={isRolling}
              />
              <DiceCube
                style={{ transform: diceCubeStyles[1] || initialDiceCubeStyle }}
                rolling={isRolling}
              />
            </div>
          </div>
        </div>
      )}

      {!isRolling && rollHash && (
        <div className="dice-result">
          <h2>
            Result: {diceResult[0]} + {diceResult[1]}
          </h2>
          <p>
            <strong>Fairness Proof:</strong> {rollHash}
          </p>
          <p>
            <strong>Verification Seed:</strong> {verificationSeed}
          </p>
        </div>
      )}
    </div>
  );
}
