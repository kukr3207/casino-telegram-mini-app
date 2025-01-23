"use client";

import "./globals.css";
import Header from "../components/Header";
import BottomMenu from "../components/BottomMenu";
import { useEffect, useState } from "react";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [viewportHeight, setViewportHeight] = useState("100vh"); // Default for SSR

  useEffect(() => {
    if (typeof window !== "undefined" && "Telegram" in window) {
      const tg = window.Telegram.WebApp;

      // Adjust viewport height dynamically
      const height = tg.viewportHeight || window.innerHeight;
      setViewportHeight(`${height}px`);
      tg.ready(); // Notify Telegram that the app is ready
    }
  }, []);

  return (
    <html lang="en">
      <head>
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
      </head>
      <body
        style={{ "--tg-viewport-height": viewportHeight }}
        className="bg-gray-900 text-white min-h-screen flex flex-col"
      >
        <Header />
        <main className="flex-1 overflow-y-auto">{children}</main>
        <BottomMenu />
      </body>
    </html>
  );
}
