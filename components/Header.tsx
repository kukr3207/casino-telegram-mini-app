"use client";

import { useTokenContext } from "../app/context/TokenProvider";

export default function Header() {
  const { tokens } = useTokenContext();

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
