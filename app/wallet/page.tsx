"use client";

import { useEffect, useState } from "react";
import { useTokenContext } from "../../context/TokenProvider";
import "../../styles/wallet.css";

export default function WalletPage() {
  const { updateTokensLocally } = useTokenContext();
  const [casinoChips, setCasinoChips] = useState("Loading...");
  const [buyAmount, setBuyAmount] = useState(50); // Minimum value set to 50
  const [isBuying, setIsBuying] = useState(false);
  const [errorMessage, setErrorMessage] = useState(""); // Warning message

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
        updateTokensLocally({
          casino_chips: tokenCounts.casino_chips || 0,
          hol_tokens: tokenCounts.hol_tokens || 0,
          withdraw_tokens: tokenCounts.withdraw_tokens || 0,
        });
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
              disabled={isBuying}
            >
              {chips} Chips {bonus > 0 && `+ ${bonus} Bonus`} 🌟 {price} Stars
            </button>
          ))}
        </div>
        <div className="custom-buy">
          <input
            type="number"
            placeholder="Enter custom amount (min 50)"
            value={buyAmount}
            onChange={(e) => setBuyAmount(Number(e.target.value))}
            min="50"
          />
          <button
            className="buy-button"
            onClick={() => handleBuy(buyAmount)}
            disabled={isBuying}
          >
            Buy
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
