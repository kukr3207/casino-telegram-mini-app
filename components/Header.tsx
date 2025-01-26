"use client";

import { useEffect, useState } from "react";

// Function to format token counts into K/M format
function formatTokenCount(count: number): string {
    if (count >= 1e6) {
        return `${(count / 1e6).toFixed(count % 1e6 === 0 ? 0 : 1)}M`;
    } else if (count >= 1e3) {
        return `${(count / 1e3).toFixed(count % 1e3 === 0 ? 0 : 1)}K`;
    }
    return count.toString();
}

export default function Header() {
    const [tokens, setTokens] = useState([
        { id: 1, image: "/images/token1.png", count: "Loading..." },
        { id: 2, image: "/images/token2.png", count: "Loading..." },
        { id: 3, image: "/images/token3.png", count: "Loading..." },
    ]);

    useEffect(() => {
        const fetchTokenCounts = async () => {
            try {
                const chatId = sessionStorage.getItem("chat_id");
                if (!chatId) {
                    console.warn("Chat ID not found in sessionStorage.");
                    return;
                }

                const response = await fetch(`/api/get-token-counts?chatId=${chatId}`);
                if (response.ok) {
                    const data = await response.json();

                    // Ensure the correct field names match the database schema
                    setTokens([
                        { id: 1, image: "/images/token1.png", count: formatTokenCount(data.casino_chips || 0) },
                        { id: 2, image: "/images/token2.png", count: formatTokenCount(data.hol_tokens || 0) },
                        { id: 3, image: "/images/token3.png", count: formatTokenCount(data.withdraw_tokens || 0) },
                    ]);
                } else {
                    console.error("Failed to fetch token counts. Response status:", response.status);
                }
            } catch (error) {
                console.error("Error fetching token counts:", error);
            }
        };

        // Fetch token counts initially and set up an interval to refresh every 60 seconds
        fetchTokenCounts();
        const interval = setInterval(fetchTokenCounts, 60000);
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
