"use client";

import React from "react";

interface PopupModalProps {
  isVisible: boolean;
  closePopup: () => void;
  gameId: string;
}

const gameDetails: { [key: string]: { title: string; description: string } } = {
  "coin-flip": { title: "Coin Flip", description: "Play and flip a coin to win!" },
  "dice-roll": { title: "Dice Roll", description: "Roll the dice and test your luck!" },
  "slot-machine": { title: "Slot Machine", description: "Spin the slots and win big!" },
};

export default function PopupModal({ isVisible, closePopup, gameId }: PopupModalProps) {
  if (!isVisible) return null;

  const game = gameDetails[gameId];

  return (
    <div className="popup-overlay">
      <div className="popup-content">
        <h2 className="text-yellow-400 text-2xl font-bold">{game.title}</h2>
        <p className="text-gray-300 my-4">{game.description}</p>
        <button
          className="play-button telegram-btn"
          onClick={() => {
            window.location.href = `/${gameId}`; // Navigate to game page
          }}
        >
          Play Now
        </button>
        <button className="close-button telegram-btn-secondary" onClick={closePopup}>
          Close
        </button>
      </div>
    </div>
  );
}
