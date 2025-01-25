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

    // Extract user data from URL parameters
    const params = new URLSearchParams(window.location.search);
    const chatId = params.get("chat_id");
    const firstName = params.get("first_name");

    // Save user data only once
    if (chatId && firstName) {
      const savedChatId = sessionStorage.getItem("chat_id");
      if (!savedChatId) {
        fetch("/save-user-data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, firstName }),
        })
          .then((response) => {
            if (response.ok) {
              sessionStorage.setItem("chat_id", chatId); // Save to session storage
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
        {/* Header Component */}
        <Header />

        {/* Main Content */}
        <main style={{ flex: 1, overflowY: "auto" }}>{children}</main>

        {/* Bottom Menu Component */}
        <BottomMenu />
      </body>
    </html>
  );
}
