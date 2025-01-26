"use client";

import React, { useEffect, useState } from "react";
import "../styles/header.css";

interface TokenData {
  token1: number;
  token2: number;
  token3: number;
}

const Header: React.FC = () => {
  const [tokens, setTokens] = useState<TokenData | null>(null);

  useEffect(() => {
    const fetchTokenData = async () => {
      try {
        const response = await fetch("/api/fetch-tokens");
        if (response.ok) {
          const data = await response.json();
          setTokens(data);
        } else {
          console.error("Failed to fetch tokens.");
        }
      } catch (error) {
        console.error("Error fetching tokens:", error);
      }
    };

    fetchTokenData();
  }, []);

  return (
    <header>
      <div>
        <img src="/images/token1.png" alt="Token 1" />
        <span>{tokens ? tokens.token1 : "Loading..."}</span>
      </div>
      <div>
        <img src="/images/token2.png" alt="Token 2" />
        <span>{tokens ? tokens.token2 : "Loading..."}</span>
      </div>
      <div>
        <img src="/images/token3.png" alt="Token 3" />
        <span>{tokens ? tokens.token3 : "Loading..."}</span>
      </div>
    </header>
  );
};

export default Header;
