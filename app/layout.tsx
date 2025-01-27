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

            fetch("/api/save-user-data", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chatId }),
            })
              .then((response) => {
                if (response.ok) {
                  console.log("Chat ID saved to backend successfully.");
                } else {
                  console.error("Failed to save chat ID to backend.");
                }
              })
              .catch((error) => console.error("Error saving chat ID:", error));
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

    const timer = setTimeout(() => setIsSplashVisible(false), 3000);
    return () => clearTimeout(timer);
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
