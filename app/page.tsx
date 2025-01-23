"use client";

import React, { useState } from "react";
import GameSection from "../components/GameSection";
import PopupModal from "../components/PopupModal";

export default function Home() {
  const [popup, setPopup] = useState({
    visible: false,
    title: "",
    description: "",
    route: "",
  });

  const showPopup = (title: string, description: string, route: string) => {
    setPopup({ visible: true, title, description, route });
  };

  const closePopup = () => {
    setPopup({ visible: false, title: "", description: "", route: "" });
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {/* Game Section */}
      <main className="flex-1 p-4">
        <GameSection showPopup={showPopup} />
      </main>

      {/* Popup Modal */}
      {popup.visible && (
        <PopupModal
          title={popup.title}
          description={popup.description}
          route={popup.route}
          closePopup={closePopup}
        />
      )}
    </div>
  );
}
