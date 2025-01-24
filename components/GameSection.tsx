import React from "react";

interface GameSectionProps {
  showPopup: (gameId: string) => void;
}

const games = [
  {
    id: "coin-flip",
    title: "Coin Flip",
    description: "Bet and flip a coin!",
    animationClass: "coin-flip-animation",
  },
  {
    id: "dice-roll",
    title: "Dice Roll",
    description: "Roll the dice!",
    animationClass: "dice-roll-animation",
  },
  {
    id: "slot-machine",
    title: "Slot Machine",
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
          <div className={`game-animation-wrapper ${game.animationClass}`}></div>
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
