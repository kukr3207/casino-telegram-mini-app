"use client";

import { useEffect, useState } from "react";
import { useTokenContext } from "../../context/TokenProvider";
import "../../styles/wallet.css";

export default function WalletPage() {
  const { updateTokensLocally } = useTokenContext();
  const [casinoChips, setCasinoChips] = useState("Loading...");
  const [buyAmount, setBuyAmount] = useState(0);
  const [isBuying, setIsBuying] = useState(false);
  const predefinedAmounts = [50, 100, 250, 500, 1000];

  useEffect(() => {
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

    fetchTokenCounts();
  }, []);

  const handleBuy = async (amount: number, packageType: string = "Normal", chipsBought: number = amount) => {
    setIsBuying(true);
    try {
      const chatId = sessionStorage.getItem("chat_id");
      const response = await fetch(`/api/send-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, amount, packageType, chipsBought }),
      });

      if (response.ok) {
        const { payload } = await response.json();

        // Telegram WebApp Payment Simulation
        const tg = window.Telegram.WebApp;
        if (tg) {
          tg.sendData(payload); // You can use this to trigger server-side payment simulation
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
        <div className="predefined-options">
          {predefinedAmounts.map((amount) => (
            <button
              key={amount}
              className="buy-button"
              onClick={() => handleBuy(amount)}
              disabled={isBuying}
            >
              Buy {amount} 🌟
            </button>
          ))}
        </div>
        <div className="custom-buy">
          <input
            type="number"
            placeholder="Enter custom amount (min 10)"
            value={buyAmount}
            onChange={(e) => setBuyAmount(Number(e.target.value))}
            min="10"
          />
          <button
            className="buy-button"
            onClick={() => handleBuy(buyAmount)}
            disabled={isBuying || buyAmount < 10}
          >
            Buy
          </button>
        </div>
      </div>

      {/* Special Offers Section */}
      <div className="bundles">
        <h3>Special Offers</h3>
        <div className="bundle">
          <p>Buy 1000 Chips + 50 Free!</p>
          <button
            className="buy-button"
            onClick={() => handleBuy(1000, "Bundle", 1050)}
            disabled={isBuying}
          >
            Buy Now
          </button>
        </div>
        <div className="bundle">
          <p>Buy 5000 Chips + 300 Free!</p>
          <button
            className="buy-button"
            onClick={() => handleBuy(5000, "Bundle", 5300)}
            disabled={isBuying}
          >
            Buy Now
          </button>
        </div>
      </div>
    </div>
  );
}
