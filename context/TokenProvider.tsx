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
  const [tokens, setTokens] = useState<Token[]>([]);

  // Initialize tokens from session storage
  const initializeTokens = () => {
    const cachedTokens = sessionStorage.getItem("tokens");
    if (cachedTokens) {
      setTokens(JSON.parse(cachedTokens));
    } else {
      console.warn("No tokens found in session storage during initialization.");
    }
  };

  // Update tokens in state and session storage immediately
  const updateTokensLocally = (updatedCounts: { casino_chips: number; hol_tokens: number; withdraw_tokens: number }) => {
    const updatedTokens = [
      { id: 1, image: "/images/token1.png", count: updatedCounts.casino_chips || 0 },
      { id: 2, image: "/images/token2.png", count: updatedCounts.withdraw_tokens || 0 },
      { id: 3, image: "/images/token3.png", count: updatedCounts.hol_tokens || 0 },
    ];
    setTokens(updatedTokens);
    sessionStorage.setItem("tokens", JSON.stringify(updatedTokens));
    console.log("Tokens updated locally and saved to session storage:", updatedTokens);
  };

  // Refresh tokens by fetching from the backend
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
        updateTokensLocally({
          casino_chips: tokenCounts.casino_chips || 0,
          hol_tokens: tokenCounts.hol_tokens || 0,
          withdraw_tokens: tokenCounts.withdraw_tokens || 0,
        });
        console.log("Tokens refreshed from backend and saved.");
      } else {
        console.error("Failed to refresh token counts from backend.");
      }
    } catch (error) {
      console.error("Error refreshing token counts:", error);
    }
  };

  useEffect(() => {
    initializeTokens();
  }, []);

  return (
    <TokenContext.Provider value={{ tokens, updateTokensLocally, refreshTokens }}>
      {children}
    </TokenContext.Provider>
  );
}
