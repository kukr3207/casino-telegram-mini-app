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
        const savedChatId = sessionStorage.getItem("chat_id");
        if (!savedChatId) {
          fetch("/api/save-user-data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId }),
          })
            .then((response) => {
              if (response.ok) {
                sessionStorage.setItem("chat_id", chatId.toString());
                console.log("Chat ID saved to session storage.");
              } else {
                console.error("Failed to save user data.");
              }
            })
            .catch(console.error);
        }
      }
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
