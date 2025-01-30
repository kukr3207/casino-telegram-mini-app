"use client";

import { useEffect, useState } from "react";

export default function Header() {
  const [tokens, setTokens] = useState([
    { id: 1, image: "/images/token1.png", count: 0 },
    { id: 2, image: "/images/token2.png", count: 0 },
    { id: 3, image: "/images/token3.png", count: 0 },
  ]);

  useEffect(() => {
    const updateTokensFromSession = () => {
      const storedTokens = sessionStorage.getItem("tokens");
      if (storedTokens) {
        setTokens(JSON.parse(storedTokens));
      }
    };

    updateTokensFromSession();
    const interval = setInterval(updateTokensFromSession, 1000); // Fetch tokens every 1 second

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
          <span className="text-yellow-400 font-semibold">{token.count}</span>
        </div>
      ))}
    </header>
  );
}
