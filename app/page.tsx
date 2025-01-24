"use client";

import { useState } from "react";
import GameSection from "../components/GameSection";
import PopupModal from "../components/PopupModal";

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
