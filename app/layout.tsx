"use client";

import "../styles/base.css";
import "./globals.css";
import "../styles/header.css";
import "../styles/bottom-menu.css";
import Header from "../components/Header";
import BottomMenu from "../components/BottomMenu";
import { useEffect, useState } from "react";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [viewportHeight, setViewportHeight] = useState("100vh");

  useEffect(() => {
    if (typeof window !== "undefined" && window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;
      const height = tg.viewportHeight || window.innerHeight;
      setViewportHeight(`${height}px`);
      tg.ready();
    }

    const params = new URLSearchParams(window.location.search);
    const chatId = params.get("chat_id");
    const firstName = params.get("first_name");

    if (chatId && firstName) {
      const savedChatId = sessionStorage.getItem("chat_id");
      if (!savedChatId) {
        fetch("/api/save-user-data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, firstName }),
        })
          .then((response) => {
            if (response.ok) {
              sessionStorage.setItem("chat_id", chatId);
              console.log("User data saved.");
            } else {
              console.error("Failed to save user data.");
            }
          })
          .catch((error) => console.error("Error saving user data:", error));
      }
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
        <Header />
        <main style={{ flex: 1, overflowY: "auto", paddingBottom: "60px" }}>
          {children}
        </main>
        <BottomMenu />
      </body>
    </html>
  );
}
