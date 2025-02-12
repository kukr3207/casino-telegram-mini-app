"use client";

import { useEffect, useState } from "react";
import "../../styles/wallet.css";
import Confetti from "react-confetti";

export default function WalletPage() {
  const [casinoChips, setCasinoChips] = useState("Loading...");
  const [withdrawTokens, setWithdrawTokens] = useState("Loading...");
  const [buyAmount, setBuyAmount] = useState(50);
  const [isBuying, setIsBuying] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [showConfetti, setShowConfetti] = useState(false); 
  const [processingChip, setProcessingChip] = useState<number | null>(null);

  // New state for conversion
  const [showConvertPopup, setShowConvertPopup] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [showConvertAnimation, setShowConvertAnimation] = useState(false);

  // Pricing Tiers (predefined only)
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
        setWithdrawTokens(tokenCounts.withdraw_tokens || 0);
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
        sessionStorage.setItem("tokens", JSON.stringify(event.data.tokens));
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 4000);
        setProcessingChip(null);
      }
    };

    window.addEventListener("message", handleMessage);
    fetchTokenCounts();
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleBuy = async (amount: number, packageType: string = "Tier", chipsBought: number = amount) => {
    if (amount < 50) {
      setErrorMessage("Minimum purchase amount is 50 tokens.");
      setTimeout(() => setErrorMessage(""), 4000);
      return;
    }

    setIsBuying(true);
    setProcessingChip(amount);

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

  // New conversion handler: calls our new API to convert withdrawable tokens.
  const handleConvert = async (percentage: number) => {
    setIsConverting(true);
    try {
      const chatId = sessionStorage.getItem("chat_id");
      const response = await fetch("/api/convert-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, percentage }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          // Update UI with new balances
          setCasinoChips(data.newCasinoChips);
          setWithdrawTokens(data.newWithdrawTokens);
          // Trigger a conversion animation
          setShowConvertAnimation(true);
          setTimeout(() => setShowConvertAnimation(false), 4000);
          setShowConvertPopup(false);
        }
      } else {
        const errorData = await response.json();
        setErrorMessage(errorData.error || "Conversion failed");
        setTimeout(() => setErrorMessage(""), 4000);
      }
    } catch (error) {
      console.error("Error converting tokens:", error);
    } finally {
      setIsConverting(false);
    }
  };

  return (
    <div className="wallet-page">
      {/* Confetti Animation for payment */}
      {showConfetti && (
        <>
          <Confetti
            numberOfPieces={150}
            recycle={false}
            gravity={0.3}
            initialVelocityX={{ min: 5, max: 15 }}
            initialVelocityY={{ min: -10, max: -5 }}
            colors={["#ffcc00", "#ff0066", "#00ccff", "#66ff66"]}
            wind={0}
            width={window.innerWidth}
            height={window.innerHeight}
            confettiSource={{ x: 0, y: window.innerHeight / 2, w: 10, h: 10 }}
          />
          <Confetti
            numberOfPieces={150}
            recycle={false}
            gravity={0.3}
            initialVelocityX={{ min: -15, max: -5 }}
            initialVelocityY={{ min: -10, max: -5 }}
            colors={["#ffcc00", "#ff0066", "#00ccff", "#66ff66"]}
            wind={0}
            width={window.innerWidth}
            height={window.innerHeight}
            confettiSource={{ x: window.innerWidth, y: window.innerHeight / 2, w: 10, h: 10 }}
          />
        </>
      )}

      {/* Conversion success animation */}
      {showConvertAnimation && (
        <Confetti
          numberOfPieces={100}
          recycle={false}
          gravity={0.35}
          colors={["#66ff66", "#00ccff", "#ffcc00"]}
          width={window.innerWidth}
          height={window.innerHeight}
        />
      )}

      {/* Token Descriptions Section */}
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

      {/* NEW: Conversion Section (placed directly below token descriptions) */}
      <div className="conversion-section">
        <h3>Convert Withdrawable Tokens to Casino Chips</h3>
        <p>
          You have <strong>{withdrawTokens}</strong> withdrawable tokens.
        </p>
        <button className="convert-button" onClick={() => setShowConvertPopup(true)}>
          Convert Tokens
        </button>
      </div>

      {/* Buy Casino Chips Section (predefined options only) */}
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
              {processingChip === price
                ? "Processing..."
                : `${chips} Chips ${bonus > 0 ? `+ ${bonus} Bonus` : ""} 🌟 ${price} Stars`}
            </button>
          ))}
        </div>
      </div>

      {/* Existing Withdrawal Section */}
      <div className="withdrawal">
        <h3>Withdraw Tokens</h3>
        <p>
          Withdrawable tokens can be exchanged for Stars. Each token earns <strong>1.4 Stars</strong>. A 5%
          withdrawal fee applies.
        </p>
        <button className="withdraw-button">Request Withdrawal</button>
      </div>

      {/* Popup for Conversion Options */}
      {showConvertPopup && (
        <div className="popup">
          <div className="popup-content">
            <h3>Select Conversion Percentage</h3>
            <div className="conversion-options">
              <button className="convert-option" onClick={() => handleConvert(25)} disabled={isConverting}>
                25%
              </button>
              <button className="convert-option" onClick={() => handleConvert(50)} disabled={isConverting}>
                50%
              </button>
              <button className="convert-option" onClick={() => handleConvert(75)} disabled={isConverting}>
                75%
              </button>
              <button className="convert-option" onClick={() => handleConvert(100)} disabled={isConverting}>
                100%
              </button>
            </div>
            <button className="earn-btn" onClick={() => setShowConvertPopup(false)} disabled={isConverting}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
