"use client";

import React, { useEffect } from "react";
import "../styles/splash-screen.css";

export default function SplashScreen({ onFinish }: { onFinish: () => void }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onFinish();
    }, 3000); // Show splash screen for 3 seconds

    return () => clearTimeout(timer);
  }, [onFinish]);

  return (
    <div className="splash-screen">
      <h1 className="splash-logo">Casino App</h1>
      <p className="splash-text">Loading your tokens...</p>
    </div>
  );
}
