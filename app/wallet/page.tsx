"use client";

import { useEffect, useState } from "react";
import "../../styles/wallet.css";

export default function WalletPage() {
  const [casinoChips, setCasinoChips] = useState("Loading...");
  const [buyAmount, setBuyAmount] = useState(0);
  const [isBuying, setIsBuying] = useState(false);
  const predefinedAmounts = [10, 50, 100, 250, 500, 1000];

  // Fetch the user's casino chips count
  useEffect(() => {
    const fetchTokenCounts = async () => {
      try {
        const chatId = sessionStorage.getItem("chat_id");
        if (!chatId) {
          console.error("Chat ID not found in sessionStorage.");
          setCasinoChips("Error");
          return;
        }

        const response = await fetch(`/api/get-token-counts?chatId=${chatId}`);
        if (response.ok) {
          const { tokenCounts } = await response.json();
          setCasinoChips(tokenCounts.token1 || 0);
        } else {
          console.error("Failed to fetch token counts.");
          setCasinoChips("Error");
        }
      } catch (error) {
        console.error("Error fetching token counts:", error);
        setCasinoChips("Error");
      }
    };

    fetchTokenCounts();
  }, []);

  // Handle the purchase of casino chips
  const handleBuy = async (amount: number) => {
    if (amount <= 0) return;
    setIsBuying(true);
  
    try {
      const chatId = sessionStorage.getItem("chat_id");
      const tg = window.Telegram?.WebApp;
  
      if (!tg || !tg.openLink) {
        console.error("Telegram WebApp is not available or openLink is undefined.");
        alert("Telegram WebApp is required to make a purchase.");
        setIsBuying(false);
        return;
      }
  
      const response = await fetch(`/api/create-stars-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, amount }),
      });
  
      if (response.ok) {
        const { paymentLink } = await response.json();
        tg.openLink(paymentLink); // Opens the Telegram Stars payment window
      } else {
        console.error("Failed to create payment.");
        alert("Failed to initiate the purchase. Please try again.");
      }
    } catch (error) {
      console.error("Error handling purchase:", error);
      alert("An error occurred. Please try again.");
    } finally {
      setIsBuying(false);
      setBuyAmount(0); // Reset custom amount input after the purchase
    }
  };
  

  return (
    <div className="wallet-page">
      <h2 className="wallet-header">Your Casino Chips: {casinoChips}</h2>
      <div className="buy-chips">
        <h3 className="buy-title">Buy Casino Chips</h3>

        {/* Predefined Chip Purchase Options */}
        <div className="predefined-options">
          {predefinedAmounts.map((amount) => (
            <button
              key={amount}
              className={`buy-button ${isBuying ? "disabled" : ""}`}
              onClick={() => handleBuy(amount)}
              disabled={isBuying}
            >
              {isBuying ? "Processing..." : `${amount} Chips`}
            </button>
          ))}
        </div>

        {/* Custom Amount Purchase */}
        <div className="custom-buy">
          <input
            type="number"
            placeholder="Enter custom amount"
            value={buyAmount}
            onChange={(e) => setBuyAmount(Number(e.target.value))}
            className="custom-input"
          />
          <button
            className={`buy-button ${isBuying || buyAmount <= 0 ? "disabled" : ""}`}
            onClick={() => handleBuy(buyAmount)}
            disabled={isBuying || buyAmount <= 0}
          >
            {isBuying ? "Processing..." : "Buy"}
          </button>
        </div>
      </div>
    </div>
  );
}
