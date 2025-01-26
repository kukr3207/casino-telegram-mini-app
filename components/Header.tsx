"use client";

import { useEffect, useState } from "react";


function formatTokenCount(count: number): string {
    if (count >= 1e6) {
        // Format for million (e.g., 1M, 1.1M)
        return `${(count / 1e6).toFixed(count % 1e6 === 0 ? 0 : 1)}M`;
    } else if (count >= 1e3) {
        // Format for thousand (e.g., 1K, 1.1K)
        return `${(count / 1e3).toFixed(count % 1e3 === 0 ? 0 : 1)}K`;
    }
    return count.toString(); // Return the exact number for counts < 1000
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
                if (!chatId) return;

                const response = await fetch(`/api/get-token-counts?chatId=${chatId}`);
                if (response.ok) {
                    const data = await response.json();

                    // Update the token counts dynamically
                    setTokens([
                        { id: 1, image: "/images/token1.png", count: formatTokenCount(data.token1) },
                        { id: 2, image: "/images/token2.png", count: formatTokenCount(data.token2) },
                        { id: 3, image: "/images/token3.png", count: formatTokenCount(data.token3) },
                    ]);
                } else {
                    console.error("Failed to fetch token counts.");
                }
            } catch (error) {
                console.error("Error fetching token counts:", error);
            }
        };

        fetchTokenCounts();
        const interval = setInterval(fetchTokenCounts, 60000); // Fetch every 60 seconds
        return () => clearInterval(interval); // Cleanup interval on component unmount
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
