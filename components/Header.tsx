"use client";

import { useEffect, useState } from "react";

export default function Header() {
  const [tokens, setTokens] = useState([
    { id: 1, image: "/images/token1.png", count: 0 },
    { id: 2, image: "/images/token2.png", count: 0 },
    { id: 3, image: "/images/token3.png", count: 0 },
  ]);

  const updateTokensFromSession = () => {
    const casinoChips = parseInt(sessionStorage.getItem("casino_chips") || "0", 10);
    const holTokens = parseInt(sessionStorage.getItem("hol_tokens") || "0", 10);
    const withdrawTokens = parseInt(sessionStorage.getItem("withdraw_tokens") || "0", 10);

    setTokens([
      { id: 1, image: "/images/token1.png", count: casinoChips },
      { id: 2, image: "/images/token2.png", count: holTokens },
      { id: 3, image: "/images/token3.png", count: withdrawTokens },
    ]);
  };

  useEffect(() => {
    updateTokensFromSession();
    const interval = setInterval(updateTokensFromSession, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="flex justify-center items-center gap-4 bg-gray-800 py-3 px-4 shadow-md">
      {tokens.map((token) => (
        <div
          key={token.id}
          className="flex items-center bg-gray-700 px-4 py-2 rounded-lg shadow-md"
        >
          <img
            src={token.image}
            alt={`Token ${token.id}`}
            className="w-6 h-6 mr-2"
          />
          <span
            className="text-yellow-400 font-semibold"
            style={{ pointerEvents: "none" }}
          >
            {token.count}
          </span>
        </div>
      ))}
    </header>
  );
}
