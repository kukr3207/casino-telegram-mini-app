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
  const [showMilestonePopup, setShowMilestonePopup] = useState<boolean>(false);
  const [milestonePopupMessage, setMilestonePopupMessage] = useState<string>("");

  // Milestone states – also tracking the last claimed milestone info.
  const [dailyDiceRollGamesPlayed, setDailyDiceRollGamesPlayed] = useState<number>(0);
  const [lastMilestoneClaimed, setLastMilestoneClaimed] = useState<number>(0);
  const [lastMilestoneClaimDate, setLastMilestoneClaimDate] = useState<string>("");

  const MAX_DICE_GAMES = 25; // now only 25 games max per day for milestone progress
  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    fetchUserStatus();
  }, []);

  // Fetch user status (including milestone info) from the DB.
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
        setDailyDiceRollGamesPlayed(Number(data.dailyDiceRollGamesPlayed) || 0);
        // Milestone info
        setLastMilestoneClaimed(data.lastMilestoneClaimed || 0);
        setLastMilestoneClaimDate(data.lastMilestoneClaimDate || "");
      }
    } catch (error) {
      console.error("Error fetching user status:", error);
    }
  };

  // Calculate the effective last milestone claimed.
  const effectiveLastClaimed = lastMilestoneClaimDate === today ? lastMilestoneClaimed : 0;
  // Next eligible milestone is effectiveLastClaimed + 5.
  const nextEligibleMilestone = effectiveLastClaimed + 5;
  const milestoneReward = 15; // Fixed reward per milestone claim

  // Daily Check-In Handler (unchanged)
  const handleDailyCheckIn = async () => {
    if (isDailyClaimed || isCheckinProcessing) return;
    setIsCheckinProcessing(true);
    let newStreak = streak ? streak + 1 : 1;
    if (newStreak > 15) newStreak = 1;
    const newReward = 5 + newStreak * 5;
    const chatId = sessionStorage.getItem("chat_id");
    if (!chatId) return;
    const oldBalance = casinoBalance;
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
      if (data.newBalance !== undefined) {
        setCasinoBalance(data.newBalance);
      }
      fetchUserStatus();
      const tokensAdded = data.newBalance - oldBalance;
      setDailyPopupMessage(`Daily Check-In: Old Balance: ${oldBalance}, New Balance: ${data.newBalance} (added ${tokensAdded} tokens)`);
      setShowDailyPopup(true);
    } catch (error) {
      console.error("Error during daily check-in:", error);
    } finally {
      setIsCheckinProcessing(false);
    }
  };

  // Spin Wheel Handler (unchanged)
  const handleSpin = async () => {
    if (hasSpunToday || isSpinProcessing) return;
    setIsSpinProcessing(true);
    setSpinResult(null);
    const chatId = sessionStorage.getItem("chat_id");
    if (!chatId) return;
    const oldBalance = casinoBalance;
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
      setTimeout(() => {
        setRotation((prev) => prev + additionalRotation);
      }, 50);
      setTimeout(() => {
        setIsSpinProcessing(false);
        setSpinResult(outcome);
        setHasSpunToday(true);
        let popupMsg = "";
        if (outcome.type === "token") {
          popupMsg = `Spin Result: Old Balance: ${oldBalance}, `;
          const newBalance = oldBalance + outcome.value;
          setCasinoBalance(newBalance);
          popupMsg += `New Balance: ${newBalance} (added ${outcome.value} tokens)!`;
        } else if (outcome.type === "booster") {
          popupMsg = `Spin Result: Booster won! (No token change)`;
        }
        setSpinPopupMessage(popupMsg);
        setShowSpinPopup(true);
        fetchUserStatus();
      }, 8000);
    } catch (error) {
      console.error("Error during spin:", error);
      setIsSpinProcessing(false);
    }
  };

  // Milestone Claim Handler – the claim button is only shown when enough games have been played.
  const handleClaimMilestone = async () => {
    setIsMilestoneProcessing(true);
    const chatId = sessionStorage.getItem("chat_id");
    if (!chatId) return;
    const oldBalance = casinoBalance;
    try {
      const response = await fetch("/api/claim-daily-milestone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          date: today,
          reward: milestoneReward, // 15 tokens
          milestoneThreshold: nextEligibleMilestone,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        setMilestonePopupMessage(errorData.error);
        setShowMilestonePopup(true);
        throw new Error("Milestone claim failed");
      }
      const data = await response.json();
      if (data.newBalance !== undefined) {
        setCasinoBalance(data.newBalance);
      }
      fetchUserStatus();
      const tokensAdded = data.newBalance - oldBalance;
      setMilestonePopupMessage(
        `Milestone Claim: Old Balance: ${oldBalance}, New Balance: ${data.newBalance} (added ${tokensAdded} tokens)`
      );
      setShowMilestonePopup(true);
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
        {isDailyClaimed ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h4>✅ Daily Check-In Streak (Streak: {streak}/15)</h4>
            <button className="earn-btn" disabled>
              Already Claimed
            </button>
          </div>
        ) : (
          <>
            <h4>✅ Daily Check-In Streak</h4>
            <p>Check in to earn your daily reward!</p>
            <button className="earn-btn" onClick={handleDailyCheckIn} disabled={isCheckinProcessing}>
              {isCheckinProcessing ? "Processing..." : "Claim Daily Reward"}
            </button>
          </>
        )}
      </div>

      {/* Spin Wheel Section */}
      <div className="earn-section">
        {hasSpunToday ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h4>🎡 Spin the Wheel</h4>
            <button className="earn-btn" disabled>
              Already Spun Today
            </button>
          </div>
        ) : (
          <>
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
            <button className="earn-btn" onClick={handleSpin} disabled={isSpinProcessing}>
              {isSpinProcessing ? "Processing..." : "Spin"}
            </button>
          </>
        )}
      </div>

      {/* Milestone Section */}
      <div className="earn-section milestone-section">
        <h4>Dice Roll Milestone</h4>
        <p>Games played today: {dailyDiceRollGamesPlayed}</p>
        <p>
          Next Milestone: {nextEligibleMilestone} games for {milestoneReward} tokens reward.
        </p>
        <MilestoneProgressBar current={dailyDiceRollGamesPlayed} max={MAX_DICE_GAMES} step={5} />
        {dailyDiceRollGamesPlayed >= nextEligibleMilestone ? (
          effectiveLastClaimed >= nextEligibleMilestone ? (
            <p>Milestone already claimed for this threshold.</p>
          ) : (
            <button className="earn-btn" onClick={handleClaimMilestone} disabled={isMilestoneProcessing}>
              {isMilestoneProcessing ? "Processing..." : "Claim Milestone Reward"}
            </button>
          )
        ) : (
          <p>
            Play {nextEligibleMilestone - dailyDiceRollGamesPlayed} more dice games to claim the reward.
          </p>
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

      {/* Milestone Popup */}
      {showMilestonePopup && (
        <div className="popup">
          <div className="popup-content">
            <p>{milestonePopupMessage}</p>
            <button className="earn-btn" onClick={() => setShowMilestonePopup(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
