"use client";

import React from "react";

interface GameSectionProps {
  showPopup: (title: string, description: string, route: string) => void;
}

const GameSection: React.FC<GameSectionProps> = ({ showPopup }) => {
  const games = [
    {
      name: "Coin Flip",
      description: "Bet and flip a coin!",
      animationClass: "coin-flip-animation",
      route: "/coin-flip",
    },
    {
      name: "Dice Roll",
      description: "Roll the dice!",
      animationClass: "dice-roll-animation",
      route: "/dice-roll",
    },
    {
      name: "Slot Machine",
      description: "Spin the slots!",
      animationClass: "slot-machine-animation",
      route: "/slot-machine",
    },
  ];

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      {games.map((game, index) => (
        <div
          key={index}
          onClick={() => showPopup(game.name, game.description, game.route)}
          className="flex items-center justify-between p-4 bg-gray-800 rounded-lg shadow-md hover:bg-gray-700 cursor-pointer"
        >
          <div className="flex items-center gap-4">
            {/* Animation Section */}
            {game.name === "Coin Flip" && (
              <div className="w-12 h-12 relative coin-flip-animation">
                <div className="coin">
                  <div className="front">
                    <img src="/images/token1.png" alt="Heads" />
                  </div>
                  <div className="back">
                    <img src="/images/token2.png" alt="Tails" />
                  </div>
                </div>
              </div>
            )}
            {game.name === "Dice Roll" && (
              <div className="w-12 h-12 dice-roll-animation">
                <div className="dice">🎲</div>
                <div className="dice">🎲</div>
              </div>
            )}
            {game.name === "Slot Machine" && (
              <div className="w-12 h-12 slot-machine-animation">
                <div className="reel">🍒</div>
                <div className="reel">🍋</div>
                <div className="reel">🔔</div>
              </div>
            )}

            {/* Game Info */}
            <div>
              <h3 className="text-lg font-semibold text-yellow-400">{game.name}</h3>
              <p className="text-sm text-gray-300">{game.description}</p>
            </div>
          </div>
          <span className="text-gray-400">→</span>
        </div>
      ))}
    </div>
  );
};

export default GameSection;
