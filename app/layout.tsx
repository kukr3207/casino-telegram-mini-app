"use client";

import "./globals.css";
import Header from "../components/Header";
import BottomMenu from "../components/BottomMenu";
import { useEffect } from "react";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window !== "undefined" && window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;
      tg.ready(); // Notify Telegram that the app is ready

      // Set dynamic theme
      const theme = tg.colorScheme; // 'dark' or 'light'
      document.body.setAttribute("data-theme", theme);

      // Optional: Log Telegram user information
      console.log("User info:", tg.initDataUnsafe?.user);
    }
  }, []);

  return (
    <html lang="en">
      <head>
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
      </head>
      <body className="bg-gray-900 text-white min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 overflow-y-auto">{children}</main>
        <BottomMenu />
      </body>
    </html>
  );
}
