import React from "react";
import "../styles/popup-modal.css";

interface GameDetails {
  name: string;
  description: string;
  animationClass: string;
  route: string;
}

const gameDetails: Record<string, GameDetails> = {
  "coin-flip": {
    name: "Coin Flip",
    description: "Bet and flip the coin to test your luck!",
    animationClass: "coin-flip-animation",
    route: "/coin-flip",
  },
  "dice-roll": {
    name: "Dice Roll",
    description: "Roll the dice and see what you get!",
    animationClass: "dice-roll-animation",
    route: "/dice-roll",
  },
  "slot-machine": {
    name: "Slot Machine",
    description: "Spin the slots and win big!",
    animationClass: "slot-machine-animation",
    route: "/slot-machine",
  },
};

interface PopupModalProps {
  isVisible: boolean;
  gameId: string;
  closePopup: () => void;
}

const PopupModal: React.FC<PopupModalProps> = ({ isVisible, gameId, closePopup }) => {
  const game = gameDetails[gameId];

  if (!isVisible || !game) return null;

  return (
    <div className="popup-overlay">
      <div className="popup-content">
        <button className="close-button" onClick={closePopup}>
          ✖
        </button>
        <div className={`popup-animation ${game.animationClass}`}></div>
        <h2 className="popup-title">{game.name}</h2>
        <p className="popup-description">{game.description}</p>
        <a href={game.route} className="play-button">
          Play Game
        </a>
      </div>
    </div>
  );
};

export default PopupModal;
