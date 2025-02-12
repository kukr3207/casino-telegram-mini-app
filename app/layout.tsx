"use client";

import "../styles/base.css";
import "./globals.css";
import "../styles/header.css";
import "../styles/bottom-menu.css";
import Header from "../components/Header";
import BottomMenu from "../components/BottomMenu";
import SplashScreen from "../components/SplashScreen";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Popup component for free chips
function FreeChipsPopup({ onAccept, processing }: { onAccept: () => void; processing: boolean }) {
  return createPortal(
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg text-center shadow-lg max-w-sm mx-4">
        <h2 className="text-2xl font-bold mb-4">🎉 Welcome to the Casino!</h2>
        <p className="mb-6">
          As a new player, you get <strong>100 free casino chips</strong>. Click "Accept" to claim them!
        </p>
        <button
          onClick={onAccept}
          disabled={processing}
          className={`${
            processing ? "bg-gray-500 cursor-not-allowed" : "bg-green-500 hover:bg-green-600"
          } text-white font-semibold py-2 px-4 rounded`}
        >
          {processing ? "Processing..." : "Accept"}
        </button>
      </div>
    </div>,
    document.body
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [viewportHeight, setViewportHeight] = useState("100vh");
  const [isSplashVisible, setIsSplashVisible] = useState(true);
  const [showFreeChipsPopup, setShowFreeChipsPopup] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);

  useEffect(() => {
    const initializeApp = async () => {
      console.log("Initializing Telegram WebApp...");

      if (typeof window !== "undefined" && window.Telegram?.WebApp) {
        const tg = window.Telegram.WebApp;
        tg.ready();

        const height = tg.viewportHeight || window.innerHeight;
        setViewportHeight(`${height}px`);

        const initDataUnsafe = tg.initDataUnsafe;

        if (initDataUnsafe?.user) {
          const { id, first_name: firstName, username } = initDataUnsafe.user;

          if (id) {
            const chatIdStr = id.toString();
            console.log("Chat ID found:", chatIdStr);
            sessionStorage.setItem("chat_id", chatIdStr);
            setChatId(chatIdStr);

            try {
              // Save user data in the database.
              const response = await fetch(`/api/save-user-data`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chatId: chatIdStr, firstName, username }),
              });

              if (response.ok) {
                console.log("New user detected. Showing free chips popup.");
                setShowFreeChipsPopup(true);
              }

              // Fetch user's token counts
              const tokenResponse = await fetch(`/api/get-token-counts?chatId=${chatIdStr}`);
              if (tokenResponse.ok) {
                const { tokenCounts } = await tokenResponse.json();

                // Store token counts in session storage
                const tokens = [
                  { id: 1, image: "/images/token1.png", count: tokenCounts?.casino_chips || 0 },
                  { id: 2, image: "/images/token2.png", count: tokenCounts?.withdraw_tokens || 0 },
                  { id: 3, image: "/images/token3.png", count: tokenCounts?.hol_tokens || 0 },
                ];
                sessionStorage.setItem("tokens", JSON.stringify(tokens));
              } else {
                console.error("Failed to fetch token counts.");
              }
            } catch (error) {
              console.error("Error fetching or storing token data:", error);
            }
          }
        }
      }

      // Hide splash screen after initialization.
      setTimeout(() => {
        setIsSplashVisible(false);
      }, 1000);
    };

    initializeApp();
  }, []);

  // Handler for accepting free tokens.
  const handleAcceptFreeChips = async () => {
    if (!chatId) return;
    setProcessing(true);

    try {
      // Update tokens in the DB by adding 100 tokens.
      const response = await fetch("/api/update-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, tokens: 100 }),
      });

      if (response.ok) {
        // Fetch the updated token counts.
        const tokenResponse = await fetch(`/api/get-token-counts?chatId=${chatId}`);
        if (tokenResponse.ok) {
          const { tokenCounts } = await tokenResponse.json();
          // Store token counts in session storage.
          const tokens = [
            { id: 1, image: "/images/token1.png", count: tokenCounts?.casino_chips || 0 },
            { id: 2, image: "/images/token2.png", count: tokenCounts?.withdraw_tokens || 0 },
            { id: 3, image: "/images/token3.png", count: tokenCounts?.hol_tokens || 0 },
          ];
          sessionStorage.setItem("tokens", JSON.stringify(tokens));
          console.log("Tokens updated in session storage:", tokens);
        } else {
          console.error("Failed to fetch updated token counts.");
        }
      } else {
        console.error("Failed to update tokens with free chips.");
      }
    } catch (error) {
      console.error("Error updating tokens:", error);
    }

    // Close the popup once everything is updated
    setProcessing(false);
    setShowFreeChipsPopup(false);
  };

  return (
    <html lang="en">
      <head>
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
      </head>
      <body style={{ height: viewportHeight, display: "flex", flexDirection: "column" }}>
        {isSplashVisible ? (
          <SplashScreen onFinish={() => setIsSplashVisible(false)} />
        ) : (
          <>
            <Header />
            <main style={{ flex: 1, overflowY: "auto", paddingBottom: "60px" }}>{children}</main>
            <BottomMenu />
          </>
        )}
        {showFreeChipsPopup && (
          <FreeChipsPopup onAccept={handleAcceptFreeChips} processing={processing} />
        )}
      </body>
    </html>
  );
}
