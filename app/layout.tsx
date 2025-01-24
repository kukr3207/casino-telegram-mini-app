"use client";

import "./globals.css";
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
        <main style={{ flex: 1, overflowY: "auto" }}>{children}</main>
        <BottomMenu />
      </body>
    </html>
  );
}
