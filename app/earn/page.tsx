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

// MilestoneProgressBar Component: renders a progress bar with checkpoint dots.
interface MilestoneProgressBarProps {
  current: number;
  max: number;
  step: number;
}

function MilestoneProgressBar({ current, max, step }: MilestoneProgressBarProps) {
  const percentage = Math.min((current / max) * 100, 100);
  const milestones = [];
  for (let i = step; i <= max; i += step) {
    milestones.push(i);
  }
  return (
    <div className="milestone-progress">
      <div className="progress-container">
        <div className="progress-bar" style={{ width: `${percentage}%` }}></div>
        {milestones.map((milestone) => (
          <div
            key={milestone}
            className="checkpoint"
            style={{ left: `${(milestone / max) * 100}%` }}
          ></div>
        ))}
      </div>
      <div className="milestone-labels">
        {milestones.map((milestone) => (
          <span
            key={milestone}
            className="milestone-label"
            style={{ left: `${(milestone / max) * 100}%` }}
          >
            {milestone}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function EarnPage() {
  // Daily check-in states
  const [streak, setStreak] = useState<number>(0);
  const [dailyReward, setDailyReward] = useState<number>(10);
  const [isDailyClaimed, setIsDailyClaimed] = useState<boolean>(false);
  const [casinoBalance, setCasinoBalance] = useState<number>(0);

  // Spin wheel states
  const [isSpinning, setIsSpinning] = useState<boolean>(false);
  const [rotation, setRotation] = useState<number>(0);
  const [spinResult, setSpinResult] = useState<Outcome | null>(null);
  const [hasSpunToday, setHasSpunToday] = useState<boolean>(false);

  // Processing states for buttons
  const [isCheckinProcessing, setIsCheckinProcessing] = useState<boolean>(false);
  const [isSpinProcessing, setIsSpinProcessing] = useState<boolean>(false);
  const [isMilestoneProcessing, setIsMilestoneProcessing] = useState<boolean>(false);

  // Popup states for results
  const [showDailyPopup, setShowDailyPopup] = useState<boolean>(false);
  const [dailyPopupMessage, setDailyPopupMessage] = useState<string>("");
  const [showSpinPopup, setShowSpinPopup] = useState<boolean>(false);
  const [spinPopupMessage, setSpinPopupMessage] = useState<string>("");

  // Milestone states
  const [dailyDiceRollGamesPlayed, setDailyDiceRollGamesPlayed] = useState<number>(0);
  const [milestoneClaimed, setMilestoneClaimed] = useState<boolean>(false);
  const [milestoneClaimDate, setMilestoneClaimDate] = useState<string>("");

  const MAX_STREAK_DAYS = 15;
  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    fetchUserStatus();
  }, []);

  // Fetch user status from the DB.
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
        setDailyDiceRollGamesPlayed(data.dailyDiceRollGamesPlayed || 0);
        setMilestoneClaimed(data.milestoneClaimed === true);
        setMilestoneClaimDate(data.milestoneClaimDate || "");
        // Optionally update local storage.
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
      setTimeout(() => {
        setRotation((prev) => prev + additionalRotation);
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
        setShowSpinPopup(true);
        fetchUserStatus();
      }, 8000);
    } catch (error) {
      console.error("Error during spin:", error);
      setIsSpinProcessing(false);
    }
  };

  // Milestone Section:
  // Determine the next milestone in increments of 10, capped at 100.
  const nextMilestone =
    dailyDiceRollGamesPlayed === 0
      ? 10
      : Math.min(Math.ceil(dailyDiceRollGamesPlayed / 10) * 10, 100);
  // Reward increases by 25 tokens for every 10 games.
  const milestoneReward = (nextMilestone / 10) * 25;

  const handleClaimMilestone = async () => {
    setIsMilestoneProcessing(true);
    const chatId = sessionStorage.getItem("chat_id");
    if (!chatId) return;
    try {
      const response = await fetch("/api/claim-daily-milestone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, date: today, reward: milestoneReward }),
      });
      if (!response.ok) {
        throw new Error("Milestone claim failed");
      }
      const data = await response.json();
      if (data.newBalance !== undefined) {
        setCasinoBalance(data.newBalance);
      }
      fetchUserStatus();
    } catch (error) {
      console.error("Error claiming milestone:", error);
    } finally {
      setIsMilestoneProcessing(false);
    }
  };

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

      {/* Milestone Section */}
      <div className="earn-section milestone-section">
        <h4>Dice Roll Milestone</h4>
        {dailyDiceRollGamesPlayed >= 100 ? (
          <p className="strike">
            100 games reached! Milestone completed for today.
          </p>
        ) : (
          <div>
            <p>Games played today: {dailyDiceRollGamesPlayed}</p>
            <p>
              Next Milestone: {nextMilestone} games for {milestoneReward} tokens reward.
            </p>
            <MilestoneProgressBar current={dailyDiceRollGamesPlayed} max={100} step={10} />
            {dailyDiceRollGamesPlayed >= nextMilestone ? (
              <button
                className="earn-btn"
                onClick={handleClaimMilestone}
                disabled={isMilestoneProcessing || milestoneClaimed}
              >
                {isMilestoneProcessing
                  ? "Processing..."
                  : milestoneClaimed
                  ? "Already Claimed"
                  : "Claim Milestone Reward"}
              </button>
            ) : (
              <p>
                Play {nextMilestone - dailyDiceRollGamesPlayed} more dice games to claim the reward.
              </p>
            )}
          </div>
        )}
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
