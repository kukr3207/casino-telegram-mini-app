"use client";

import React from "react";
import "../styles/header.css";


const tokens = [
  { id: 1, image: "/images/token1.png", count: 1110 },
  { id: 2, image: "/images/token2.png", count: 1110 },
  { id: 3, image: "/images/token3.png", count: 1110 },
];

const Header: React.FC = () => {
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
};

export default Header;
