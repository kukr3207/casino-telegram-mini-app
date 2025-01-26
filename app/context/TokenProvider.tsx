"use client";

import React, { createContext, useContext, useState } from "react";

interface Token {
  id: number;
  image: string;
  count: number;
}

interface TokenContextType {
  tokens: Token[];
  fetchTokens: () => Promise<void>;
}

const TokenContext = createContext<TokenContextType | null>(null);

export const useTokenContext = () => {
  const context = useContext(TokenContext);
  if (!context) {
    throw new Error("useTokenContext must be used within a TokenProvider");
  }
  return context;
};

export default function TokenProvider({ children }: { children: React.ReactNode }) {
  const [tokens, setTokens] = useState<Token[]>([
    { id: 1, image: "/images/token1.png", count: 0 },
    { id: 2, image: "/images/token2.png", count: 0 },
    { id: 3, image: "/images/token3.png", count: 0 },
  ]);

  const fetchTokens = async () => {
    const chatId = sessionStorage.getItem("chat_id");
    if (!chatId) return;

    try {
      const response = await fetch(`/api/get-token-counts?chatId=${chatId}`);
      if (response.ok) {
        const { tokenCounts } = await response.json();
        setTokens([
          { id: 1, image: "/images/token1.png", count: tokenCounts.casino_chips || 0 },
          { id: 2, image: "/images/token2.png", count: tokenCounts.hol_tokens || 0 },
          { id: 3, image: "/images/token3.png", count: tokenCounts.withdraw_tokens || 0 },
        ]);
      }
    } catch (error) {
      console.error("Error fetching token counts:", error);
    }
  };

  return (
    <TokenContext.Provider value={{ tokens, fetchTokens }}>
      {children}
    </TokenContext.Provider>
  );
}
