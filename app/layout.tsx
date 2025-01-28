"use client";

import "../styles/base.css";
import "./globals.css";
import "../styles/header.css";
import "../styles/bottom-menu.css";
import Header from "../components/Header";
import BottomMenu from "../components/BottomMenu";
import SplashScreen from "../components/SplashScreen";
import { useEffect, useState } from "react";
import TokenProvider from "../context/TokenProvider";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [viewportHeight, setViewportHeight] = useState("100vh");
  const [isSplashVisible, setIsSplashVisible] = useState(true);

  useEffect(() => {
    console.log("Initializing Telegram WebApp...");

    const initializeTokensAndChatId = async () => {
      if (typeof window !== "undefined" && window.Telegram?.WebApp) {
        const tg = window.Telegram.WebApp;
        tg.ready();

        const height = tg.viewportHeight || window.innerHeight;
        setViewportHeight(`${height}px`);

        const initDataUnsafe = tg.initDataUnsafe;

        if (initDataUnsafe?.user) {
          const { id: chatId } = initDataUnsafe.user;

          if (chatId) {
            console.log("Received chatId from Telegram:", chatId);

            const savedChatId = sessionStorage.getItem("chat_id");
            if (!savedChatId) {
              console.log("Saving chatId to session storage...");
              sessionStorage.setItem("chat_id", chatId.toString());

              // Fetch and save token counts during splash screen
              try {
                const response = await fetch(`/api/get-token-counts?chatId=${chatId}`);
                if (response.ok) {
                  const { tokenCounts } = await response.json();
                  const tokens = [
                    { id: 1, image: "/images/token1.png", count: tokenCounts.casino_chips || 0 },
                    { id: 2, image: "/images/token2.png", count: tokenCounts.withdraw_tokens || 0 },
                    { id: 3, image: "/images/token3.png", count: tokenCounts.hol_tokens || 0 },
                  ];
                  sessionStorage.setItem("tokens", JSON.stringify(tokens));
                  console.log("Tokens initialized and saved to session storage:", tokens);
                } else {
                  console.error("Failed to fetch token counts.");
                }
              } catch (error) {
                console.error("Error fetching token counts during splash screen:", error);
              }
            } else {
              console.log("Chat ID already exists in session storage:", savedChatId);
            }
          } else {
            console.warn("No valid chatId found in Telegram initDataUnsafe.");
          }
        } else {
          console.warn("initDataUnsafe is missing or invalid.");
        }
      } else {
        console.error("Telegram WebApp is not available.");
      }
    };

    initializeTokensAndChatId();

    // Manage splash screen visibility
    const splashShown = sessionStorage.getItem("splash_shown");
    if (!splashShown) {
      const timer = setTimeout(() => {
        setIsSplashVisible(false);
        sessionStorage.setItem("splash_shown", "true");
      }, 3000);
      return () => clearTimeout(timer);
    } else {
      setIsSplashVisible(false);
    }
  }, []);

  return (
    <html lang="en">
      <head>
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
      </head>
      <body
        style={{
          height: viewportHeight,
          display: "flex",
          flexDirection: "column",
          backgroundColor: "var(--bg-color)",
          color: "var(--text-color)",
        }}
      >
        <TokenProvider>
          {isSplashVisible ? (
            <SplashScreen onFinish={() => setIsSplashVisible(false)} />
          ) : (
            <>
              <Header />
              <main style={{ flex: 1, overflowY: "auto", paddingBottom: "60px" }}>
                {children}
              </main>
              <BottomMenu />
            </>
          )}
        </TokenProvider>
      </body>
    </html>
  );
}
