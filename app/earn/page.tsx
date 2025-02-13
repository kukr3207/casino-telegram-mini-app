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
  // We'll update the rotation state so the spin animation is continuous.
  const [rotation, setRotation] = useState<number>(0);
  const [spinResult, setSpinResult] = useState<Outcome | null>(null);
  const [hasSpunToday, setHasSpunToday] = useState<boolean>(false);

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

  // New API call to fetch user status from the DB.
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
        // Update local storage with values from DB.
        if (data.dailyCheckinDate) {
          localStorage.setItem("dailyCheckinDate", data.dailyCheckinDate);
        } else {
          localStorage.removeItem("dailyCheckinDate");
        }
        localStorage.setItem("streak", data.streak);
        if (data.dailySpinDate) {
          localStorage.setItem("dailySpinDate", data.dailySpinDate);
        } else {
          localStorage.removeItem("dailySpinDate");
        }
      }
    } catch (error) {
      console.error("Error fetching user status:", error);
    }
  };

  // Daily Check-In Handler
  const handleDailyCheckIn = async () => {
    if (isDailyClaimed || isCheckinProcessing) return;
    setIsCheckinProcessing(true);
    // Calculate new streak and reward.
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
      if (!response.ok) {
        throw new Error("Daily check-in failed");
      }
      const data = await response.json();
      setIsDailyClaimed(true);
      setStreak(newStreak);
      setDailyReward(newReward);
      if (data.newBalance !== undefined) {
        setCasinoBalance(data.newBalance);
      }
      setDailyPopupMessage(`You received ${newReward} tokens for daily check-in!`);
      setShowDailyPopup(true);
      // Refresh user status.
      fetchUserStatus();
    } catch (error) {
      console.error("Error during daily check-in:", error);
    } finally {
      setIsCheckinProcessing(false);
    }
  };

  // Spin Wheel Handler
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
      const arrowTargetAngle = 0;
      const winningSegmentCenter = outcomeIndex * segmentAngle + segmentAngle / 2;
      const additionalRotation = baseRotation + (arrowTargetAngle - winningSegmentCenter);
      
      // Delay slightly to trigger the transition.
      setTimeout(() => {
        setRotation(prev => prev + additionalRotation);
      }, 50);

      // Wait 8 seconds (spin duration + extra delay) before showing popup.
      setTimeout(() => {
        setIsSpinProcessing(false);
        setSpinResult(outcome);
        setHasSpunToday(true);
        if (outcome.type === "token") {
          setSpinPopupMessage(`You won ${outcome.value} tokens!`);
        } else if (outcome.type === "booster") {
          setSpinPopupMessage(`You won a ${outcome.value}% booster for 1 hour!`);
        }
        setShowSpinPopup(true);
        fetchUserStatus();
      }, 8000);
    } catch (error) {
      console.error("Error during spin:", error);
      setIsSpinProcessing(false);
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
                  transition: "transform 5s ease-out",
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
          disabled={isSpinProcessing || hasSpunToday}
        >
          {isSpinProcessing
            ? "Processing..."
            : hasSpunToday
            ? "Already Spun Today"
            : "Spin"}
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