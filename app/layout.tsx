"use client";

import "../styles/base.css";
import "./globals.css";
import "../styles/header.css";
import "../styles/bottom-menu.css";
import Header from "../components/Header";
import BottomMenu from "../components/BottomMenu";
import SplashScreen from "../components/SplashScreen";
import { useEffect, useState } from "react";
import TokenProvider from "../app/context/TokenProvider";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [viewportHeight, setViewportHeight] = useState("100vh");
  const [isSplashVisible, setIsSplashVisible] = useState(true);

  useEffect(() => {
    console.log("Initializing Telegram WebApp...");

    if (typeof window !== "undefined" && window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;
      console.log("Telegram WebApp detected.");

      // Initialize Telegram WebApp
      tg.ready();

      // Set viewport height for responsiveness
      const height = tg.viewportHeight || window.innerHeight;
      setViewportHeight(`${height}px`);

      // Extract initData from Telegram
      const initData = tg.initData;
      const initDataUnsafe = tg.initDataUnsafe;

      console.log("Raw initData:", initData);
      console.log("Parsed initDataUnsafe:", initDataUnsafe);

      // Validate initDataUnsafe
      if (initDataUnsafe?.user) {
        const { id: chatId, first_name: firstName, username } = initDataUnsafe.user;
        console.log("User details extracted:", { chatId, firstName, username });

        // Check if the user is already saved
        const savedChatId = sessionStorage.getItem("chat_id");
        if (!savedChatId) {
          console.log("Saving user data to backend...");
          fetch("/api/save-user-data", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ chatId, firstName, username, initData }),
          })
            .then((response) => {
              if (response.ok) {
                sessionStorage.setItem("chat_id", chatId.toString());
                console.log("User data saved successfully.");
              } else {
                console.error("Failed to save user data.");
              }
            })
            .catch((error) => console.error("Error saving user data:", error));
        } else {
          console.log("User data already exists in sessionStorage.");
        }
      } else {
        console.warn("initDataUnsafe does not contain user details.");
      }
    } else {
      console.error("Telegram WebApp is not available.");
    }

    // Hide the splash screen after fetching data
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
