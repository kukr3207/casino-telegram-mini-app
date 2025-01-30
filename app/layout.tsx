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
              // Check if user exists and store user in DB if new
              await fetch(`/api/store-user-data`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chatId, firstName, username }),
              });

              // Fetch user-related data
              const response = await fetch(`/api/get-user-data?chatId=${chatId}`);
              if (response.ok) {
                const { tokenCounts, userDetails } = await response.json();

                // Store token counts in session storage
                const tokens = [
                  { id: 1, image: "/images/token1.png", count: tokenCounts.casino_chips || 0 },
                  { id: 2, image: "/images/token2.png", count: tokenCounts.withdraw_tokens || 0 },
                  { id: 3, image: "/images/token3.png", count: tokenCounts.hol_tokens || 0 },
                ];
                sessionStorage.setItem("tokens", JSON.stringify(tokens));

                // Store user details in session storage
                sessionStorage.setItem("user_details", JSON.stringify(userDetails));

                console.log("User data loaded and stored in session storage:", { tokens, userDetails });
              } else {
                console.error("Failed to fetch user data.");
              }
            } catch (error) {
              console.error("Error fetching or storing user data:", error);
            }
          }
        } else {
          console.warn("No valid chat ID found in Telegram initDataUnsafe.");
        }
      } else {
        console.error("Telegram WebApp is not available.");
      }

      // Hide splash screen after initialization
      const splashShown = sessionStorage.getItem("splash_shown");
      if (!splashShown) {
        setTimeout(() => {
          setIsSplashVisible(false);
          sessionStorage.setItem("splash_shown", "true");
        }, 3000);
      } else {
        setIsSplashVisible(false);
      }
    };

    initializeApp();
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
