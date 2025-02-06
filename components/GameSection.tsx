import React from "react";
import "../styles/game-section.css";
import "../styles/animations.css";

interface GameSectionProps {
  showPopup: (gameId: string) => void;
}

const games = [
  // {
  //   id: "coin-flip",
  //   title: "Coin Flip",
  //   description: "Bet and flip a coin!",
  //   animationClass: "coin-flip-animation",
  // },
  {
    id: "dice-roll",
    title: "Dice Roll",
    description: "Roll the dice!",
    animationClass: "enhanced-dice-roll-animation", // Updated animation class
  },
  {
    id: "slot-machine",
    title: "Slot Machine",
    description: "Spin the slots!",
    animationClass: "slot-machine-animation",
  },
  {
    id: "blackjack",
    title: "blackjack",
    description: "Spin the slots!",
    animationClass: "slot-machine-animation",
  },
];

const GameSection: React.FC<GameSectionProps> = ({ showPopup }) => {
  return (
    <div className="game-section">
      {games.map((game) => (
        <div
          key={game.id}
          className="game-card"
          onClick={() => showPopup(game.id)}
        >
          <div className={`game-animation-wrapper ${game.animationClass}`}>
            {game.id === "dice-roll" && (
              <div className="dice-wrapper">
                <div className="dice dice-one">🎲</div>
                <div className="dice dice-two">🎲</div>
              </div>
            )}
          </div>
          <div className="game-info">
            <h3>{game.title}</h3>
            <p>{game.description}</p>
          </div>
          <div className="game-arrow">→</div>
        </div>
      ))}
    </div>
  );
};

export default GameSection;
