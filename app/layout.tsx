"use client";

import "../styles/base.css";
import "./globals.css";
import "../styles/header.css";
import "../styles/bottom-menu.css";
import Header from "../components/Header";
import BottomMenu from "../components/BottomMenu";
import SplashScreen from "../components/SplashScreen";
import { useEffect, useState } from "react";

// Popup component: shows only an Accept button that cannot be closed until accepted.
function FreeChipsPopup({
  onAccept,
  processing,
}: {
  onAccept: () => void;
  processing: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg text-center shadow-lg max-w-sm mx-4">
        <h2 className="text-2xl font-bold mb-4">Free 100 Tokens from the House!</h2>
        <p className="mb-6">
          As a new user, you get 100 free casino chips. Please accept to claim them.
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
    </div>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [viewportHeight, setViewportHeight] = useState("100vh");
  const [isSplashVisible, setIsSplashVisible] = useState(true);
  const [showFreeChipsPopup, setShowFreeChipsPopup] = useState(false);
  const [processing, setProcessing] = useState(false);

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
          const { id: chatId, first_name: firstName, username } = initDataUnsafe.user;

          if (chatId) {
            console.log("Chat ID found:", chatId);
            sessionStorage.setItem("chat_id", chatId.toString());

            try {
              // Store user data in the database.
              // The save-user-data endpoint now returns an isNewUser flag for new users.
              const saveUserResponse = await fetch(`/api/save-user-data`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chatId, firstName, username }),
              });
              const saveUserData = await saveUserResponse.json();
              // If the API indicates a new user, show the popup.
              if (saveUserData?.isNewUser) {
                setShowFreeChipsPopup(true);
              }

              // Fetch token counts
              const tokenResponse = await fetch(`/api/get-token-counts?chatId=${chatId}`);
              if (tokenResponse.ok) {
                const { tokenCounts } = await tokenResponse.json();
                // Store token counts in session storage immediately
                const tokens = [
                  { id: 1, image: "/images/token1.png", count: tokenCounts.casino_chips || 0 },
                  { id: 2, image: "/images/token2.png", count: tokenCounts.withdraw_tokens || 0 },
                  { id: 3, image: "/images/token3.png", count: tokenCounts.hol_tokens || 0 },
                ];
                sessionStorage.setItem("tokens", JSON.stringify(tokens));
                console.log("Tokens updated in session storage:", tokens);
              } else {
                console.error("Failed to fetch token counts.");
              }
            } catch (error) {
              console.error("Error fetching or storing token data:", error);
            }
          }
        }
      }

      // Hide splash screen after initialization
      setTimeout(() => {
        setIsSplashVisible(false);
      }, 1000); // Reduced delay for faster UI update
    };

    initializeApp();
  }, []);

  // Handler for accepting free tokens:
  // When clicked, the button text changes to "Processing..." and is disabled.
  // In parallel, the update-tokens API is called; upon success, session storage is updated and the popup is closed.
  const handleAcceptFreeChips = async () => {
    const chatId = sessionStorage.getItem("chat_id");
    if (!chatId) return;
    setProcessing(true);
    try {
      const response = await fetch("/api/update-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, tokens: 100 }),
      });
      if (response.ok) {
        const data = await response.json();
        console.log("Free chips added, new balance:", data.newBalance);
        // Update session storage tokens: add 100 to casino chips (assumed token id: 1)
        const tokensFromSession = sessionStorage.getItem("tokens");
        let tokens = tokensFromSession ? JSON.parse(tokensFromSession) : [];
        if (tokens.length > 0) {
          tokens[0].count = (tokens[0].count || 0) + 100;
        }
        sessionStorage.setItem("tokens", JSON.stringify(tokens));
      } else {
        console.error("Failed to update tokens with free chips.");
      }
    } catch (error) {
      console.error("Error updating tokens:", error);
    }
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
