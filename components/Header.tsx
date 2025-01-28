"use client";

import { useTokenContext } from "../context/TokenProvider";
import { useEffect, useState } from "react";

export default function Header() {
  const { tokens } = useTokenContext();
  const [cachedTokens, setCachedTokens] = useState(tokens);

  useEffect(() => {
    const updateTokensFromStorage = () => {
      const sessionTokens = sessionStorage.getItem("tokens");
      if (sessionTokens) {
        setCachedTokens(JSON.parse(sessionTokens));
      }
    };

    updateTokensFromStorage();

    const interval = setInterval(updateTokensFromStorage, 1000); // Poll session storage every second
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="flex justify-center items-center gap-4 bg-gray-800 py-3 px-4 shadow-md">
      {cachedTokens.map((token) => (
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
