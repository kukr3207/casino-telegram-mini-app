"use client";

import "./globals.css";
import Header from "../components/Header";
import BottomMenu from "../components/BottomMenu";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-900 text-white min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 overflow-y-auto">{children}</main>
        <BottomMenu />
      </body>
    </html>
  );
}
