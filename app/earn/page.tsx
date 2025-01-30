"use client";

import React, { useState, useEffect } from "react";
import "../../styles/earn.css";
import { useTokenContext } from "../../context/TokenProvider"; // Import TokenProvider for session updates

export default function EarnPage() {
  const { updateTokensLocally } = useTokenContext();
  const [streak, setStreak] = useState(0);
  const [dailyReward, setDailyReward] = useState(10);
  const [lastClaimedDate, setLastClaimedDate] = useState("");
  const [isClaimed, setIsClaimed] = useState(false);
  const [casinoBalance, setCasinoBalance] = useState(0);

  const MAX_STREAK_DAYS = 30;
  const resetTime = "00:00";

  useEffect(() => {
    fetchUserTokenBalance();
    fetchStreakData();
  }, []);

  const fetchUserTokenBalance = async () => {
    const chatId = sessionStorage.getItem("chat_id");
    if (!chatId) return;

    try {
      const response = await fetch(`/api/get-token-counts?chatId=${chatId}`);
      if (response.ok) {
        const { tokenCounts } = await response.json();
        setCasinoBalance(tokenCounts.casino_chips || 0);
      }
    } catch (error) {
      console.error("Error fetching token balance:", error);
    }
  };

  const fetchStreakData = () => {
    const storedStreak = localStorage.getItem("streak");
    const storedLastClaim = localStorage.getItem("lastClaimedDate");
    const today = new Date().toISOString().split("T")[0];

    if (storedLastClaim !== today) {
      setIsClaimed(false);
    } else {
      setIsClaimed(true);
    }

    if (storedStreak) {
      setStreak(parseInt(storedStreak));
      setDailyReward(5 + parseInt(storedStreak) * 5);
    }
  };

  const handleDailyCheckIn = async () => {
    if (isClaimed) return;

    const newStreak = streak >= MAX_STREAK_DAYS ? 1 : streak + 1;
    const newReward = 5 + newStreak * 5;
    const today = new Date().toISOString().split("T")[0];

    setStreak(newStreak);
    setDailyReward(newReward);
    setLastClaimedDate(today);
    setIsClaimed(true);

    localStorage.setItem("streak", String(newStreak));
    localStorage.setItem("lastClaimedDate", today);

    await updateUserCasinoBalance(newReward);
  };

  const updateUserCasinoBalance = async (tokens: number) => {
    const chatId = sessionStorage.getItem("chat_id");
    if (!chatId) return;
  
    try {
      // Fetch the current casino chip count from the database
      const balanceResponse = await fetch(`/api/get-token-counts?chatId=${chatId}`);
      if (!balanceResponse.ok) {
        console.error("Failed to fetch current token balance.");
        return;
      }
  
      const { tokenCounts } = await balanceResponse.json();
      const currentCasinoChips = tokenCounts.casino_chips || 0;
      const updatedCasinoChips = currentCasinoChips + tokens;
  
      // Update the casino chip count in the database
      const response = await fetch("/api/update-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, tokens: tokens }), // Send only the newly earned tokens to update the DB correctly
      });
  
      if (response.ok) {
        setCasinoBalance(updatedCasinoChips);
        updateTokensLocally({
          casino_chips: updatedCasinoChips, // Store total casino chips in session storage
          hol_tokens: tokenCounts.hol_tokens || 0,
          withdraw_tokens: tokenCounts.withdraw_tokens || 0,
        });
      }
    } catch (error) {
      console.error("Error updating token balance:", error);
    }
  };
  
  

  return (
    <div className="earn-page">
      <h3 className="earn-title">Earn Free Casino Tokens 🎰</h3>

      {/* Daily Check-In Streak */}
      <div className="earn-section">
        <h4>✅ Daily Check-In Streak</h4>
        <div className="progress-container">
          <div className="progress-bar" style={{ width: `${(streak / MAX_STREAK_DAYS) * 100}%` }}>
            {streak}/30 Days
          </div>
        </div>
        <p>Claim {dailyReward} tokens today! Reset at {resetTime}.</p>
        <button className="earn-btn" onClick={handleDailyCheckIn} disabled={isClaimed}>
          {isClaimed ? "✅ Claimed" : "Claim Now"}
        </button>
      </div>
    </div>
  );
}
