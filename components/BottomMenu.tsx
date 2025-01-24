"use client";

import Link from "next/link";
import "../styles/bottom-menu.css";


const BottomMenu: React.FC = () => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-gray-800 shadow-md">
      <ul className="flex justify-around items-center py-3 text-white">
        <li>
          <Link href="/" className="flex flex-col items-center">
            <span>🏠</span>
            <span className="text-sm">Home</span>
          </Link>
        </li>
        <li>
          <Link href="/upgrade" className="flex flex-col items-center">
            <span>⚙️</span>
            <span className="text-sm">Upgrade</span>
          </Link>
        </li>
        <li>
          <Link href="/tasks" className="flex flex-col items-center">
            <span>📋</span>
            <span className="text-sm">Tasks</span>
          </Link>
        </li>
        <li>
          <Link href="/stats" className="flex flex-col items-center">
            <span>📊</span>
            <span className="text-sm">Stats</span>
          </Link>
        </li>
        <li>
          <Link href="/wallet" className="flex flex-col items-center">
            <span>💳</span>
            <span className="text-sm">Wallet</span>
          </Link>
        </li>
      </ul>
    </nav>
  );
};

export default BottomMenu;
