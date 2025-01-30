"use client";

import { useEffect, useState } from "react";
import "../../styles/wallet.css";

export default function WalletPage() {
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

        // Update session storage with new values
        const updatedTokens = [
          { id: 1, image: "/images/token1.png", count: tokenCounts.casino_chips || 0 },
          { id: 2, image: "/images/token2.png", count: tokenCounts.withdraw_tokens || 0 },
          { id: 3, image: "/images/token3.png", count: tokenCounts.hol_tokens || 0 },
        ];
        sessionStorage.setItem("tokens", JSON.stringify(updatedTokens));
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
    if (amount < 0) {
      setErrorMessage("Minimum purchase amount is 50 tokens.");
      setTimeout(() => setErrorMessage(""), 4000);
      return;
    }

    setIsBuying(true);
    try {
      const chatId = sessionStorage.getItem("chat_id");
      
      // Fetch current token count
      const balanceResponse = await fetch(`/api/get-token-counts?chatId=${chatId}`);
      if (!balanceResponse.ok) {
        console.error("Failed to fetch current token balance.");
        return;
      }
      const { tokenCounts } = await balanceResponse.json();
      const currentCasinoChips = tokenCounts.casino_chips || 0;
      const updatedCasinoChips = currentCasinoChips + chipsBought;

      // Update DB with new total token count
      await fetch(`/api/update-tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, tokens: updatedCasinoChips }),
      });

      // Update session storage
      const updatedTokens = [
        { id: 1, image: "/images/token1.png", count: updatedCasinoChips },
        { id: 2, image: "/images/token2.png", count: tokenCounts.withdraw_tokens || 0 },
        { id: 3, image: "/images/token3.png", count: tokenCounts.hol_tokens || 0 },
      ];
      sessionStorage.setItem("tokens", JSON.stringify(updatedTokens));
      
      // Fetch updated token balance to reflect immediately
      await fetchTokenCounts();
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
            min="0"
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