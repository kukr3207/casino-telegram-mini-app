"use client";

import React, { useState, useEffect } from "react";
import "../../styles/earn.css";

interface Outcome {
  type: "token" | "booster";
  value: number;
}

interface SpinResponse {
  outcome: Outcome;
  outcomeIndex: number;
  seed: string;
  hash: string;
}

export default function EarnPage() {
  // Daily check-in states
  const [streak, setStreak] = useState<number>(0);
  const [dailyReward, setDailyReward] = useState<number>(10);
  const [isDailyClaimed, setIsDailyClaimed] = useState<boolean>(false);
  const [casinoBalance, setCasinoBalance] = useState<number>(0);

  // Spin wheel states
  const [isSpinning, setIsSpinning] = useState<boolean>(false);
  // We add to the current rotation so that the spin is animated continuously.
  const [rotation, setRotation] = useState<number>(0);
  const [spinResult, setSpinResult] = useState<Outcome | null>(null);

  // Popup states for daily check-in and spin results
  const [showDailyPopup, setShowDailyPopup] = useState<boolean>(false);
  const [dailyPopupMessage, setDailyPopupMessage] = useState<string>("");
  const [showSpinPopup, setShowSpinPopup] = useState<boolean>(false);
  const [spinPopupMessage, setSpinPopupMessage] = useState<string>("");

  const MAX_STREAK_DAYS = 15;
  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    fetchUserTokenBalance();
    checkDailyStatus();
    checkSpinStatus();
  }, []);

  // --- Fetch Functions ---
  const fetchUserTokenBalance = async () => {
    const chatId = sessionStorage.getItem("chat_id");
    if (!chatId) return;
    try {
      const response = await fetch(`/api/get-token-counts?chatId=${chatId}`);
      if (response.ok) {
        const { tokenCounts } = await response.json();
        setCasinoBalance(tokenCounts.casino_chips || 0);
        const updatedTokens = [
          { id: 1, image: "/images/token1.png", count: tokenCounts.casino_chips || 0 },
          { id: 2, image: "/images/token2.png", count: tokenCounts.withdraw_tokens || 0 },
          { id: 3, image: "/images/token3.png", count: tokenCounts.hol_tokens || 0 },
        ];
        sessionStorage.setItem("tokens", JSON.stringify(updatedTokens));
      }
    } catch (error) {
      console.error("Error fetching token balance:", error);
    }
  };

  const checkDailyStatus = () => {
    const lastCheckIn = localStorage.getItem("dailyCheckinDate");
    const storedStreak = localStorage.getItem("streak");
    if (lastCheckIn === today) {
      setIsDailyClaimed(true);
      if (storedStreak) {
        setStreak(parseInt(storedStreak));
        setDailyReward(5 + parseInt(storedStreak) * 5);
      }
    } else {
      setIsDailyClaimed(false);
      if (storedStreak) {
        setStreak(parseInt(storedStreak));
        setDailyReward(5 + parseInt(storedStreak) * 5);
      }
    }
  };

  const checkSpinStatus = () => {
    const lastSpin = localStorage.getItem("dailySpinDate");
    if (lastSpin === today) {
      // Spin button will be disabled.
    }
  };

  // --- Event Handlers ---
  const handleDailyCheckIn = async () => {
    if (isDailyClaimed) return;
    const yesterday = new Date();
    yesterday.setDate(new Date().getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    let newStreak = 1;
    if (localStorage.getItem("dailyCheckinDate") === yesterdayStr) {
      newStreak = (parseInt(localStorage.getItem("streak") || "0") || 0) + 1;
      if (newStreak > MAX_STREAK_DAYS) {
        newStreak = 1;
      }
    } else {
      newStreak = 1;
    }
    const newReward = 5 + newStreak * 5;

    const chatId = sessionStorage.getItem("chat_id");
    if (chatId) {
      try {
        const response = await fetch("/api/daily-checkin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, date: today, streak: newStreak, reward: newReward }),
        });
        if (!response.ok) {
          throw new Error("Daily check-in failed");
        }
        const data = await response.json();

        localStorage.setItem("dailyCheckinDate", today);
        localStorage.setItem("streak", String(newStreak));
        setStreak(newStreak);
        setDailyReward(newReward);
        setIsDailyClaimed(true);

        if (data.newBalance !== undefined) {
          setCasinoBalance(data.newBalance);
        }
        setDailyPopupMessage(`You received ${newReward} tokens for daily check-in!`);
        setShowDailyPopup(true);
        fetchUserTokenBalance();
      } catch (error) {
        console.error("Error during daily check-in:", error);
      }
    }
  };

  const handleSpin = async () => {
    if (localStorage.getItem("dailySpinDate") === today) return;
    if (isSpinning) return;
    setIsSpinning(true);
    setSpinResult(null);

    const chatId = sessionStorage.getItem("chat_id");
    if (!chatId) return;

    try {
      const response = await fetch("/api/spin-wheel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId }),
      });
      if (!response.ok) {
        throw new Error("Failed to spin the wheel");
      }
      const data: SpinResponse = await response.json();
      const { outcome, outcomeIndex } = data;

      // Define outcomes (order must match backend)
      const outcomes: Outcome[] = [
        { type: "token", value: 10 },
        { type: "token", value: 25 },
        { type: "token", value: 50 },
        { type: "token", value: 100 },
        { type: "token", value: 150 },
        { type: "booster", value: 15 },
        { type: "booster", value: 25 },
        { type: "booster", value: 35 },
      ];

      const segments = outcomes.length;
      const segmentAngle = 360 / segments;
      const baseRotation = 360 * 5; // 5 full spins.
      // With the arrow on the right, we want the winning segment's center to be at 0° (to the right).
      const arrowTargetAngle = 0;
      const winningSegmentCenter = outcomeIndex * segmentAngle + segmentAngle / 2;
      const additionalRotation = baseRotation + (arrowTargetAngle - winningSegmentCenter);
      
      // Add a slight delay to force the browser to register the starting state before animating.
      setTimeout(() => {
        setRotation((prev) => prev + additionalRotation);
      }, 50);

      setTimeout(() => {
        setIsSpinning(false);
        setSpinResult(outcome);
        localStorage.setItem("dailySpinDate", today);
        if (outcome.type === "token") {
          setSpinPopupMessage(`You won ${outcome.value} tokens!`);
        } else if (outcome.type === "booster") {
          const boosterDuration = 60 * 60 * 1000; // 1 hour
          const boosterInfo = { value: outcome.value, expiresAt: Date.now() + boosterDuration };
          sessionStorage.setItem("booster", JSON.stringify(boosterInfo));
          setSpinPopupMessage(`You won a ${outcome.value}% booster for 1 hour!`);
        }
        setShowSpinPopup(true);
        fetchUserTokenBalance();
      }, 3000);
    } catch (error) {
      console.error("Error during spin:", error);
      setIsSpinning(false);
    }
  };

  // Render labels for each wheel segment.
  const renderWheelSegments = () => {
    const outcomes: Outcome[] = [
      { type: "token", value: 10 },
      { type: "token", value: 25 },
      { type: "token", value: 50 },
      { type: "token", value: 100 },
      { type: "token", value: 150 },
      { type: "booster", value: 15 },
      { type: "booster", value: 25 },
      { type: "booster", value: 35 },
    ];
    const segments = outcomes.length;
    const segmentAngle = 360 / segments;
    const radius = 80; // For label placement
    return outcomes.map((segment, index) => {
      const angle = (index * segmentAngle + segmentAngle / 2) * (Math.PI / 180);
      const x = 100 + radius * Math.cos(angle);
      const y = 100 + radius * Math.sin(angle);
      const label = segment.type === "token" ? `${segment.value}` : `${segment.value}%`;
      return (
        <div
          key={index}
          style={{
            position: "absolute",
            left: `${x}px`,
            top: `${y}px`,
            transform: "translate(-50%, -50%)",
            fontSize: "12px",
            color: "#000",
            fontWeight: "bold",
          }}
        >
          {label}
        </div>
      );
    });
  };

  return (
    <div className="earn-page">
      <h3 className="earn-title">Earn Free Casino Tokens 🎰</h3>

      {/* Daily Check-In Section */}
      <div className="earn-section">
        <h4>✅ Daily Check-In Streak</h4>
        <p>
          {isDailyClaimed
            ? `Checked in today! Streak: ${streak}/15`
            : "Check in to earn your daily reward!"}
        </p>
        <button className="earn-btn" onClick={handleDailyCheckIn} disabled={isDailyClaimed}>
          {isDailyClaimed ? "✅ Claimed" : "Claim Daily Reward"}
        </button>
      </div>

      {/* Spin Wheel Section */}
      <div className="earn-section">
        <h4>🎡 Spin the Wheel</h4>
        <div className="spin-wheel-wrapper">
          <div className="wheel-wrapper">
            <div className="wheel-container">
              <div
                className="wheel"
                style={{
                  transform: `rotate(${rotation}deg)`,
                  transition: "transform 3s ease-out",
                  position: "relative",
                  width: "100%",
                  height: "100%",
                }}
              >
                {renderWheelSegments()}
              </div>
            </div>
            <div className="arrow"></div>
          </div>
        </div>
        <button
          className="earn-btn"
          onClick={handleSpin}
          disabled={localStorage.getItem("dailySpinDate") === today || isSpinning}
        >
          {localStorage.getItem("dailySpinDate") === today ? "Already Spun Today" : "Spin"}
        </button>
      </div>

      {/* Daily Check-In Popup */}
      {showDailyPopup && (
        <div className="popup">
          <div className="popup-content">
            <p>{dailyPopupMessage}</p>
            <button className="earn-btn" onClick={() => setShowDailyPopup(false)}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* Spin Result Popup */}
      {showSpinPopup && (
        <div className="popup">
          <div className="popup-content">
            <p>{spinPopupMessage}</p>
            <button className="earn-btn" onClick={() => setShowSpinPopup(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
