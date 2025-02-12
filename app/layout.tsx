"use client";

import "../styles/base.css";
import "./globals.css";
import "../styles/header.css";
import "../styles/bottom-menu.css";
import Header from "../components/Header";
import BottomMenu from "../components/BottomMenu";
import SplashScreen from "../components/SplashScreen";
import { useEffect, useState } from "react";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [viewportHeight, setViewportHeight] = useState("100vh");
  const [isSplashVisible, setIsSplashVisible] = useState(true);

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
              // Store user data in the database
              await fetch(`/api/save-user-data`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chatId, firstName, username }),
              });

              // Fetch only token counts instead of full user data
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
      </body>
    </html>
  );
}