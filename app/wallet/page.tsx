"use client";

import { useEffect, useState } from "react";
import "../../styles/wallet.css";
import Confetti from "react-confetti";

export default function WalletPage() {
  const [casinoChips, setCasinoChips] = useState("Loading...");
  const [buyAmount, setBuyAmount] = useState(50);
  const [isBuying, setIsBuying] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [showConfetti, setShowConfetti] = useState(false); // Confetti animation
  const [processingChip, setProcessingChip] = useState<number | null>(null); // Track button loading state

  // Pricing Tiers
  const pricingTiers = [
    { chips: 50, price: 75, bonus: 0 },
    { chips: 100, price: 149, bonus: 0 },
    { chips: 500, price: 725, bonus: 0 },
    { chips: 1000, price: 1399, bonus: 50 },
    { chips: 5000, price: 6750, bonus: 300 },
  ];

  const fetchTokenCounts = async () => {
    const chatId = sessionStorage.getItem("chat_id");
    if (!chatId) {
      console.error("Chat ID not found in sessionStorage.");
      return;
    }

    try {
      const response = await fetch(`/api/get-token-counts?chatId=${chatId}`);
      if (response.ok) {
        const { tokenCounts } = await response.json();
        setCasinoChips(tokenCounts.casino_chips || 0);
      } else {
        console.error("Failed to fetch token counts.");
      }
    } catch (error) {
      console.error("Error fetching token counts:", error);
    }
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      console.log("📩 Received message from webhook:", event.data);
  
      if (event.data && event.data.type === "update_tokens") {
        console.log("✅ Payment success detected. Updating UI & triggering confetti...");
  
        // ✅ Store updated tokens in session storage
        sessionStorage.setItem("tokens", JSON.stringify(event.data.tokens));
  
        // ✅ Show confetti animation
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 4000);
        setProcessingChip(null); // Reset button loading state
      }
    };
  
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);
  
  
  

  const handleBuy = async (amount: number, packageType: string = "Normal", chipsBought: number = amount) => {
    if (amount < 0) {
      setErrorMessage("Minimum purchase amount is 50 tokens.");
      setTimeout(() => setErrorMessage(""), 4000);
      return;
    }

    setIsBuying(true);
    setProcessingChip(amount); // Show loading state for clicked button

    try {
      const chatId = sessionStorage.getItem("chat_id");
      const response = await fetch(`/api/create-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, amount, packageType, chipsBought }),
      });

      if (response.ok) {
        const { invoiceLink } = await response.json();
        const tg = window.Telegram?.WebApp;
        if (tg) {
          tg.openLink(invoiceLink);
        } else {
          console.error("Telegram WebApp is not available.");
        }
      } else {
        console.error("Failed to create invoice.");
        setProcessingChip(null);
      }
    } catch (error) {
      console.error("Error handling purchase:", error);
      setProcessingChip(null);
    } finally {
      setIsBuying(false);
    }
  };

  return (
    <div className="wallet-page">
      {/* ✅ Confetti Animation AFTER successful payment confirmation */}
      {showConfetti && (
  <>
    {/* Left Side Confetti */}
    <Confetti
      numberOfPieces={150} // 150 pieces from the left
      recycle={false} // Stops after one burst
      gravity={0.3} // Slow fall
      initialVelocityX={{ min: 5, max: 15 }} // Moves toward center
      initialVelocityY={{ min: -10, max: -5 }} // Moves slightly upward
      colors={["#ffcc00", "#ff0066", "#00ccff", "#66ff66"]} // Bright colors
      wind={0} // No extra movement
      width={window.innerWidth} // Full width
      height={window.innerHeight} // Full height
      confettiSource={{ x: 0, y: window.innerHeight / 2, w: 10, h: 10 }} // From left side
      drawShape={(ctx) => {
        ctx.beginPath();
        ctx.arc(0, 0, 2, 0, 2 * Math.PI); // Small paper size
        ctx.fill();
      }}
    />

    {/* Right Side Confetti */}
    <Confetti
      numberOfPieces={150} // 150 pieces from the right
      recycle={false} // Stops after one burst
      gravity={0.3} // Slow fall
      initialVelocityX={{ min: -15, max: -5 }} // Moves toward center
      initialVelocityY={{ min: -10, max: -5 }} // Moves slightly upward
      colors={["#ffcc00", "#ff0066", "#00ccff", "#66ff66"]} // Bright colors
      wind={0} // No extra movement
      width={window.innerWidth} // Full width
      height={window.innerHeight} // Full height
      confettiSource={{ x: window.innerWidth, y: window.innerHeight / 2, w: 10, h: 10 }} // From right side
      drawShape={(ctx) => {
        ctx.beginPath();
        ctx.arc(0, 0, 2, 0, 2 * Math.PI); // Small paper size
        ctx.fill();
      }}
    />
  </>
)}


      {/* Token Descriptions */}
      <div className="description">
        <div className="description-item">
          <img src="/images/token1.png" alt="Casino Chips" />
          <div className="description-content">
            <h2>Casino Chips</h2>
            <p>Your primary gaming currency. Use these to play games.</p>
          </div>
        </div>
        <div className="description-item">
          <img src="/images/token2.png" alt="Withdrawable Tokens" />
          <div className="description-content">
            <h2>Withdrawable Tokens</h2>
            <p>Earned by winning games. Redeem them for rewards.</p>
          </div>
        </div>
        <div className="description-item">
          <img src="/images/token3.png" alt="HOL Tokens" />
          <div className="description-content">
            <h2>HOL Tokens</h2>
            <p>Your leaderboard rank and rewards in the House of Luck.</p>
          </div>
        </div>
      </div>

      {/* Buy Casino Chips Section */}
      <div className="buy-chips">
        <h3>Buy Casino Chips with Telegram Stars 🌟</h3>
        <p>1 Telegram Star = 1 Casino Chip</p>
        {errorMessage && <div className="error-message">{errorMessage}</div>}
        <div className="predefined-options">
          {pricingTiers.map(({ chips, price, bonus }) => (
            <button
              key={chips}
              className="buy-button"
              onClick={() => handleBuy(price, "Tier", chips + bonus)}
              disabled={isBuying && processingChip === price}
            >
              {processingChip === price ? "Processing..." : `${chips} Chips ${bonus > 0 ? `+ ${bonus} Bonus` : ""} 🌟 ${price} Stars`}
            </button>
          ))}
        </div>
        <div className="custom-buy">
          <input
            type="number"
            placeholder="Enter custom amount (min 50)"
            value={buyAmount}
            onChange={(e) => setBuyAmount(Number(e.target.value))}
            min="0"
          />
          <button
            className="buy-button"
            onClick={() => handleBuy(buyAmount)}
            disabled={isBuying}
          >
            {isBuying ? "Processing..." : "Buy"}
          </button>
        </div>
      </div>

      {/* Withdrawal Section */}
      <div className="withdrawal">
        <h3>Withdraw Tokens</h3>
        <p>
          Withdrawable tokens can be exchanged for Stars. Each token earns <strong>1.4 Stars</strong>. A 5%
          withdrawal fee applies.
        </p>
        <button className="withdraw-button">Request Withdrawal</button>
      </div>
    </div>
  );
}
