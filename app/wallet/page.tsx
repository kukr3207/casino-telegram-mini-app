"use client";

import { useEffect, useState } from "react";
import "../../styles/wallet.css";

export default function WalletPage() {
  const [casinoChips, setCasinoChips] = useState("Loading...");
  const [withdrawableTokens, setWithdrawableTokens] = useState("Loading...");
  const [holTokens, setHolTokens] = useState("Loading...");
  const [buyAmount, setBuyAmount] = useState(0);
  const [isBuying, setIsBuying] = useState(false);

  const predefinedAmounts = [10, 50, 100, 250, 500, 1000];
  const bundles = [
    { amount: 1000, bonus: 50 },
    { amount: 2500, bonus: 150 },
    { amount: 5000, bonus: 500 },
  ];

  useEffect(() => {
    const fetchTokenCounts = async () => {
      try {
        const chatId = sessionStorage.getItem("chat_id");
        if (!chatId) {
          console.error("Chat ID not found in sessionStorage.");
          return;
        }

        const response = await fetch(`/api/get-token-counts?chatId=${chatId}`);
        if (response.ok) {
          const { tokenCounts } = await response.json();
          setCasinoChips(tokenCounts.token1 || 0);
          setWithdrawableTokens(tokenCounts.token2 || 0);
          setHolTokens(tokenCounts.token3 || 0);
        } else {
          console.error("Failed to fetch token counts.");
        }
      } catch (error) {
        console.error("Error fetching token counts:", error);
      }
    };

    fetchTokenCounts();
  }, []);

  const handleBuy = async (amount: number) => {
    if (amount <= 0) return;
    setIsBuying(true);
    try {
      const chatId = sessionStorage.getItem("chat_id");
      const response = await fetch(`/api/buy-casino-chips`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, amount }),
      });
      if (response.ok) {
        const data = await response.json();
        setCasinoChips(data.updatedCasinoChips);
        alert("Purchase successful!");
      } else {
        alert("Failed to buy casino chips.");
      }
    } catch (error) {
      console.error("Error buying casino chips:", error);
    } finally {
      setIsBuying(false);
    }
  };

  return (
    <div className="wallet-page">
      <section className="description">
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
      </section>

      <section className="buy-chips">
        <h2>Buy Casino Chips</h2>
        <div className="predefined-options">
          {predefinedAmounts.map((amount) => (
            <button
              key={amount}
              className="buy-button"
              onClick={() => handleBuy(amount)}
              disabled={isBuying}
            >
              {amount} Chips
            </button>
          ))}
        </div>
        <div className="custom-buy">
          <input
            type="number"
            placeholder="Enter custom amount"
            value={buyAmount}
            onChange={(e) => setBuyAmount(Number(e.target.value))}
          />
          <button
            className="buy-button"
            onClick={() => handleBuy(buyAmount)}
            disabled={isBuying || buyAmount <= 0}
          >
            Buy
          </button>
        </div>
      </section>

      <section className="bundles">
        <h2>Special Offers</h2>
        {bundles.map((bundle, index) => (
          <div key={index} className="bundle">
            <p>
              Buy {bundle.amount} Chips + {bundle.bonus} Free!
            </p>
            <button
              className="buy-button"
              onClick={() => handleBuy(bundle.amount)}
              disabled={isBuying}
            >
              Buy Now
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
