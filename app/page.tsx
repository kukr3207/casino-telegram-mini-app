"use client";

import { useState } from "react";
import GameSection from "../components/GameSection";
import PopupModal from "../components/PopupModal";
import "../styles/base.css";
import "../styles/game-section.css";
import "../styles/popup-modal.css";

export default function Page() {
  const [isPopupVisible, setIsPopupVisible] = useState(false);
  const [selectedGame, setSelectedGame] = useState<string>("");

  const showPopup = (gameId: string) => {
    setSelectedGame(gameId);
    setIsPopupVisible(true);
  };

  const closePopup = () => {
    setIsPopupVisible(false);
    setSelectedGame("");
  };

  return (
    <div>
      <GameSection showPopup={showPopup} />
      {isPopupVisible && (
        <PopupModal
          isVisible={isPopupVisible}
          gameId={selectedGame}
          closePopup={closePopup}
        />
      )}
    </div>
  );
}
