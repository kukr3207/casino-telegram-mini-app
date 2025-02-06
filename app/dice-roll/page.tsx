"use client";

import React, { useState, useEffect, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useTexture } from "@react-three/drei";
import { MeshStandardMaterial, Euler } from "three";
import { useSpring, a } from "@react-spring/three";
import "../../styles/dice-roll.css";

interface Bet {
  category: string;
  option: string;
  amount: number;
  isWin?: boolean;
  winAmount?: number;
}

// Returns the target rotation as a tuple so that the proper face is on top.
// Standard dice: top=1, front=2, right=3, left=4, back=5, bottom=6.
function getTargetRotation(result: number): [number, number, number] {
  switch (result) {
    case 1:
      return [0, 0, 0];
    case 2:
      return [-Math.PI / 2, 0, 0];
    case 3:
      return [0, 0, Math.PI / 2];
    case 4:
      return [0, 0, -Math.PI / 2];
    case 5:
      return [Math.PI / 2, 0, 0];
    case 6:
      return [Math.PI, 0, 0];
    default:
      return [0, 0, 0];
  }
}

interface DiceProps {
  result: number;
  rolling: boolean;
  position: [number, number, number];
}

// Define data URIs for dice textures (simple SVG images).
const dice1 =
  "data:image/svg+xml,%3Csvg%20xmlns%3D'http://www.w3.org/2000/svg'%20width%3D'100'%20height%3D'100'%3E%3Crect%20width%3D'100'%20height%3D'100'%20fill%3D'white'%20stroke%3D'black'/%3E%3Ccircle%20cx%3D'50'%20cy%3D'50'%20r%3D'10'%20fill%3D'black'/%3E%3C/svg%3E";
const dice2 =
  "data:image/svg+xml,%3Csvg%20xmlns%3D'http://www.w3.org/2000/svg'%20width%3D'100'%20height%3D'100'%3E%3Crect%20width%3D'100'%20height%3D'100'%20fill%3D'white'%20stroke%3D'black'/%3E%3Ccircle%20cx%3D'30'%20cy%3D'30'%20r%3D'10'%20fill%3D'black'/%3E%3Ccircle%20cx%3D'70'%20cy%3D'70'%20r%3D'10'%20fill%3D'black'/%3E%3C/svg%3E";
const dice3 =
  "data:image/svg+xml,%3Csvg%20xmlns%3D'http://www.w3.org/2000/svg'%20width%3D'100'%20height%3D'100'%3E%3Crect%20width%3D'100'%20height%3D'100'%20fill%3D'white'%20stroke%3D'black'/%3E%3Ccircle%20cx%3D'30'%20cy%3D'30'%20r%3D'10'%20fill%3D'black'/%3E%3Ccircle%20cx%3D'50'%20cy%3D'50'%20r%3D'10'%20fill%3D'black'/%3E%3Ccircle%20cx%3D'70'%20cy%3D'70'%20r%3D'10'%20fill%3D'black'/%3E%3C/svg%3E";
const dice4 =
  "data:image/svg+xml,%3Csvg%20xmlns%3D'http://www.w3.org/2000/svg'%20width%3D'100'%20height%3D'100'%3E%3Crect%20width%3D'100'%20height%3D'100'%20fill%3D'white'%20stroke%3D'black'/%3E%3Ccircle%20cx%3D'30'%20cy%3D'30'%20r%3D'10'%20fill%3D'black'/%3E%3Ccircle%20cx%3D'70'%20cy%3D'30'%20r%3D'10'%20fill%3D'black'/%3E%3Ccircle%20cx%3D'30'%20cy%3D'70'%20r%3D'10'%20fill%3D'black'/%3E%3Ccircle%20cx%3D'70'%20cy%3D'70'%20r%3D'10'%20fill%3D'black'/%3E%3C/svg%3E";
const dice5 =
  "data:image/svg+xml,%3Csvg%20xmlns%3D'http://www.w3.org/2000/svg'%20width%3D'100'%20height%3D'100'%3E%3Crect%20width%3D'100'%20height%3D'100'%20fill%3D'white'%20stroke%3D'black'/%3E%3Ccircle%20cx%3D'30'%20cy%3D'30'%20r%3D'10'%20fill%3D'black'/%3E%3Ccircle%20cx%3D'70'%20cy%3D'30'%20r%3D'10'%20fill%3D'black'/%3E%3Ccircle%20cx%3D'50'%20cy%3D'50'%20r%3D'10'%20fill%3D'black'/%3E%3Ccircle%20cx%3D'30'%20cy%3D'70'%20r%3D'10'%20fill%3D'black'/%3E%3Ccircle%20cx%3D'70'%20cy%3D'70'%20r%3D'10'%20fill%3D'black'/%3E%3C/svg%3E";
const dice6 =
  "data:image/svg+xml,%3Csvg%20xmlns%3D'http://www.w3.org/2000/svg'%20width%3D'100'%20height%3D'100'%3E%3Crect%20width%3D'100'%20height%3D'100'%20fill%3D'white'%20stroke%3D'black'/%3E%3Ccircle%20cx%3D'30'%20cy%3D'25'%20r%3D'10'%20fill%3D'black'/%3E%3Ccircle%20cx%3D'70'%20cy%3D'25'%20r%3D'10'%20fill%3D'black'/%3E%3Ccircle%20cx%3D'30'%20cy%3D'50'%20r%3D'10'%20fill%3D'black'/%3E%3Ccircle%20cx%3D'70'%20cy%3D'50'%20r%3D'10'%20fill%3D'black'/%3E%3Ccircle%20cx%3D'30'%20cy%3D'75'%20r%3D'10'%20fill%3D'black'/%3E%3Ccircle%20cx%3D'70'%20cy%3D'75'%20r%3D'10'%20fill%3D'black'/%3E%3C/svg%3E";

const diceTextures = [dice1, dice2, dice3, dice4, dice5, dice6];

function Dice({ result, rolling, position }: DiceProps) {
  const mesh = useRef<any>();
  const textures = useTexture(diceTextures);
  const materials = textures.map(
    (texture: any) => new MeshStandardMaterial({ map: texture })
  );

  const target = getTargetRotation(result);
  const [spring, springApi] = useSpring<{ rotation: [number, number, number] }>(() => ({
    rotation: [0, 0, 0],
  }));

  useEffect(() => {
    if (rolling) {
      const interval = setInterval(() => {
        springApi.start({
          rotation: [
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI,
          ],
        });
      }, 100);
      return () => clearInterval(interval);
    } else {
      springApi.start({ rotation: target });
    }
  }, [rolling, target, springApi]);

  return (
    <a.mesh
      ref={mesh}
      position={position}
      material={materials}
      rotation={spring.rotation.to(
        (x: number, y: number, z: number) => new Euler(x, y, z)
      ) as any}
    >
      {/* Use <boxGeometry> instead of <boxBufferGeometry> */}
      <boxGeometry args={[2, 2, 2]} />
    </a.mesh>
  );
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

    try {
      const response = await fetch("/api/dice-roll", { method: "POST" });
      const { dice1, dice2, hash, seed } = await response.json();

      setTimeout(() => {
        setDiceResult([dice1, dice2]);
        setRollHash(hash);
        setVerificationSeed(seed);
        highlightBets(dice1, dice2);
        setIsRolling(false);
        setHasResult(true);
      }, 3000);
    } catch (error) {
      console.error("Error rolling dice:", error);
      setIsRolling(false);
    }
  };

  const updateTokens = async (
    casinoChips: number,
    withdrawalTokens: number,
    holTokens: number
  ) => {
    const chatId = sessionStorage.getItem("chat_id");
    const tokens = JSON.parse(sessionStorage.getItem("tokens") || "[]");

    tokens[0].count = casinoChips;
    tokens[1].count += withdrawalTokens;
    tokens[2].count += holTokens;

    sessionStorage.setItem("tokens", JSON.stringify(tokens));

    const betAmount = selectedBets.reduce((sum, bet) => sum + bet.amount, 0);
    const winAmount = selectedBets
      .filter(bet => bet.isWin)
      .reduce((sum, bet) => sum + (bet.winAmount || 0), 0);
    const lossAmount = betAmount - winAmount;

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
            <div className="dice-canvas">
              <Canvas>
                <ambientLight intensity={0.5} />
                <directionalLight intensity={0.8} position={[10, 10, 5]} />
                <Dice result={diceResult[0]} rolling={isRolling} position={[-3, 0, 0]} />
                <Dice result={diceResult[1]} rolling={isRolling} position={[3, 0, 0]} />
                <OrbitControls enableZoom={false} enablePan={false} />
              </Canvas>
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
