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
    fetchTokenCounts();
  }, []);

  const handleBuy = async (amount: number, packageType: string = "Normal", chipsBought: number = amount) => {
    if (amount < 50) {
      setErrorMessage("Minimum purchase amount is 50 tokens.");
      setTimeout(() => setErrorMessage(""), 4000);
      return;
    }

    setIsBuying(true);
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

        // Listen for successful payment from the webhook
        window.addEventListener("message", (event) => {
          if (event.data.type === "update_tokens") {
            setShowConfetti(true); // Show confetti on successful payment
            setTimeout(() => setShowConfetti(false), 4000); // Hide after 4s
          }
        });
      } else {
        console.error("Failed to create invoice.");
      }
    } catch (error) {
      console.error("Error handling purchase:", error);
    } finally {
      setIsBuying(false);
    }
  };

  return (
    <div className="wallet-page">
      {showConfetti && <Confetti numberOfPieces={200} />} {/* Confetti Animation on success */}

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
              disabled={isBuying}
            >
              {isBuying ? "Processing..." : `${chips} Chips ${bonus > 0 ? `+ ${bonus} Bonus` : ""} 🌟 ${price} Stars`}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
