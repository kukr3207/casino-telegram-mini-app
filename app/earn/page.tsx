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

  // Spin section states (simplified layout)
  const [isSpinning, setIsSpinning] = useState<boolean>(false);
  const [rotation, setRotation] = useState<number>(0);
  const [spinResult, setSpinResult] = useState<Outcome | null>(null);
  const [hasSpunToday, setHasSpunToday] = useState<boolean>(false);

  // Dice roll milestone states (for dice roll game only)
  const [dailyGamesPlayed, setDailyGamesPlayed] = useState<number>(0);
  const [milestoneClaimed, setMilestoneClaimed] = useState<boolean>(false);
  const [isMilestoneProcessing, setIsMilestoneProcessing] = useState<boolean>(false);

  // Processing states for buttons
  const [isCheckinProcessing, setIsCheckinProcessing] = useState<boolean>(false);
  const [isSpinProcessing, setIsSpinProcessing] = useState<boolean>(false);

  // Popup states for results
  const [showDailyPopup, setShowDailyPopup] = useState<boolean>(false);
  const [dailyPopupMessage, setDailyPopupMessage] = useState<string>("");
  const [showSpinPopup, setShowSpinPopup] = useState<boolean>(false);
  const [spinPopupMessage, setSpinPopupMessage] = useState<string>("");

  const MAX_STREAK_DAYS = 15;
  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    fetchUserStatus();
  }, []);

  // Fetch user status from DB.
  const fetchUserStatus = async () => {
    const chatId = sessionStorage.getItem("chat_id");
    if (!chatId) return;
    try {
      const response = await fetch(`/api/get-user-status?chatId=${chatId}`);
      if (response.ok) {
        const data = await response.json();
        setCasinoBalance(data.casino_chips || 0);
        const streakNum = parseInt(data.streak) || 0;
        setStreak(streakNum);
        setDailyReward(5 + streakNum * 5);
        setIsDailyClaimed(data.dailyCheckinDate === today);
        setHasSpunToday(data.dailySpinDate === today);
        setDailyGamesPlayed(data.dailyGamesPlayed || 0);
        setMilestoneClaimed(data.milestoneClaimed === true);
      }
    } catch (error) {
      console.error("Error fetching user status:", error);
    }
  };

  // Daily Check-In Handler
  const handleDailyCheckIn = async () => {
    if (isDailyClaimed || isCheckinProcessing) return;
    setIsCheckinProcessing(true);
    let newStreak = streak ? streak + 1 : 1;
    if (newStreak > MAX_STREAK_DAYS) newStreak = 1;
    const newReward = 5 + newStreak * 5;
    const chatId = sessionStorage.getItem("chat_id");
    if (!chatId) return;
    try {
      const response = await fetch("/api/daily-checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, date: today, streak: newStreak, reward: newReward }),
      });
      if (!response.ok) throw new Error("Daily check-in failed");
      const data = await response.json();
      setIsDailyClaimed(true);
      setStreak(newStreak);
      setDailyReward(newReward);
      if (data.newBalance !== undefined) setCasinoBalance(data.newBalance);
      setDailyPopupMessage(`You received ${newReward} tokens for daily check-in!`);
      setShowDailyPopup(true);
      fetchUserStatus();
    } catch (error) {
      console.error("Error during daily check-in:", error);
    } finally {
      setIsCheckinProcessing(false);
    }
  };

  // Spin Section: Minimal layout with title and button side by side.
  const handleSpin = async () => {
    if (hasSpunToday || isSpinProcessing) return;
    setIsSpinProcessing(true);
    setSpinResult(null);
    const chatId = sessionStorage.getItem("chat_id");
    if (!chatId) return;
    try {
      const response = await fetch("/api/spin-wheel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId }),
      });
      if (!response.ok) throw new Error("Failed to spin the wheel");
      const data: SpinResponse = await response.json();
      const { outcome, outcomeIndex } = data;
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
      const baseRotation = 360 * 5;
      const arrowTargetAngle = 0;
      const winningSegmentCenter = outcomeIndex * segmentAngle + segmentAngle / 2;
      const additionalRotation = baseRotation + (arrowTargetAngle - winningSegmentCenter);
      
      // Open spin popup immediately.
      setShowSpinPopup(true);
      setTimeout(() => {
        setRotation(prev => prev + additionalRotation);
      }, 50);
      setTimeout(() => {
        setIsSpinProcessing(false);
        setSpinResult(outcome);
        setHasSpunToday(true);
        if (outcome.type === "token") {
          setSpinPopupMessage(`You won ${outcome.value} tokens!`);
        } else if (outcome.type === "booster") {
          setSpinPopupMessage(`You won a ${outcome.value}% booster for 1 hour!`);
        }
        fetchUserStatus();
      }, 8000);
    } catch (error) {
      console.error("Error during spin:", error);
      setIsSpinProcessing(false);
    }
  };

  // Milestone Claim Handler: Show button only when milestone is complete.
  const handleMilestoneClaim = async () => {
    if (milestoneClaimed || dailyGamesPlayed < 5 || isMilestoneProcessing) return;
    setIsMilestoneProcessing(true);
    const chatId = sessionStorage.getItem("chat_id");
    if (!chatId) return;
    try {
      const response = await fetch("/api/claim-daily-milestone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, date: today, reward: 25 }),
      });
      if (!response.ok) throw new Error("Milestone claim failed");
      const data = await response.json();
      setMilestoneClaimed(true);
      if (data.newBalance !== undefined) setCasinoBalance(data.newBalance);
      setSpinPopupMessage("Milestone reward claimed: 25 tokens!");
      setShowSpinPopup(true);
      fetchUserStatus();
    } catch (error) {
      console.error("Error claiming milestone reward:", error);
    } finally {
      setIsMilestoneProcessing(false);
    }
  };

  // Function to return the final transform for a dice cube based on its value.
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

  // Render a simplified spin wheel (used in the spin popup)
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
    const radius = 80;
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
        <button
          className="earn-btn"
          onClick={handleDailyCheckIn}
          disabled={isCheckinProcessing || isDailyClaimed}
        >
          {isCheckinProcessing
            ? "Processing..."
            : isDailyClaimed
            ? "Already Claimed"
            : "Claim Daily Reward"}
        </button>
      </div>

      {/* Spin Section: Text and button at extremes */}
      <div className="earn-section spin-section">
        <div className="spin-container">
          <span className="spin-text">Spin to win rewards</span>
          <button className="earn-btn" onClick={handleSpin} disabled={isSpinProcessing || hasSpunToday}>
            {isSpinProcessing
              ? "Processing..."
              : hasSpunToday
              ? "Already Spun Today"
              : "Spin"}
          </button>
        </div>
      </div>

      {/* Dice Roll Milestone Section */}
      <div className="earn-section milestone-section">
        <h4>🎯 Dice Roll Milestone</h4>
        <p>Play 5 dice roll games today to claim 25 bonus tokens!</p>
        <div className="milestone-progress-bar">
          <div
            className="milestone-progress-fill"
            style={{ width: `${(dailyGamesPlayed / 5) * 100}%` }}
          ></div>
        </div>
        <p>{dailyGamesPlayed}/5</p>
        {dailyGamesPlayed >= 5 && (
          milestoneClaimed ? (
            <span className="milestone-status">Already Claimed</span>
          ) : (
            <button className="earn-btn" onClick={handleMilestoneClaim} disabled={isMilestoneProcessing}>
              {isMilestoneProcessing ? "Processing..." : "Claim Milestone Reward"}
            </button>
          )
        )}
      </div>

      {/* Popups */}
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
