"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

interface Token {
  id: number;
  image: string;
  count: number;
}

interface TokenContextType {
  tokens: Token[];
  updateTokensLocally: (updatedCounts: { casino_chips: number; hol_tokens: number; withdraw_tokens: number }) => void;
  refreshTokens: () => Promise<void>;
}

const TokenContext = createContext<TokenContextType | null>(null);

export const useTokenContext = () => {
  const context = useContext(TokenContext);
  if (!context) throw new Error("useTokenContext must be used within TokenProvider");
  return context;
};

export default function TokenProvider({ children }: { children: React.ReactNode }) {
  const [tokens, setTokens] = useState<Token[]>([
    { id: 1, image: "/images/token1.png", count: 0 },
    { id: 2, image: "/images/token2.png", count: 0 },
    { id: 3, image: "/images/token3.png", count: 0 },
  ]);

  const refreshTokens = async () => {
    const chatId = sessionStorage.getItem("chat_id");
    if (!chatId) {
      console.error("Chat ID not found in session storage.");
      return;
    }

    try {
      const response = await fetch(`/api/get-token-counts?chatId=${chatId}`);
      if (response.ok) {
        const { tokenCounts } = await response.json();
        const updatedTokens = [
          { id: 1, image: "/images/token1.png", count: tokenCounts.casino_chips || 0 },
          { id: 2, image: "/images/token2.png", count: tokenCounts.withdraw_tokens || 0 },
          { id: 3, image: "/images/token3.png", count: tokenCounts.hol_tokens || 0 },
        ];
        setTokens(updatedTokens);
        sessionStorage.setItem("tokens", JSON.stringify(updatedTokens));
        console.log("Tokens refreshed and saved to session storage:", updatedTokens);
      } else {
        console.error("Failed to refresh token counts.");
      }
    } catch (error) {
      console.error("Error refreshing token counts:", error);
    }
  };

  useEffect(() => {
    refreshTokens(); // 🔹 Automatically refresh tokens on component mount
  }, []);

  return (
    <TokenContext.Provider value={{ tokens, updateTokensLocally: refreshTokens, refreshTokens }}>
      {children}
    </TokenContext.Provider>
  );
}
