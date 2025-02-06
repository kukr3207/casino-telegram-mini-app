"use client";

import React, { useEffect, useState } from "react";
import { gsap } from "gsap";
import "../../styles/blackjack.css";

const suits = ["♠", "♥", "♦", "♣"];
const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

const createDeck = () => {
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ suit, rank, id: `${rank}-${suit}-${Math.random()}` });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
};

export default function Blackjack() {
  const [deck, setDeck] = useState(createDeck());
  const [playerHand, setPlayerHand] = useState<any[]>([]);
  const [dealerHand, setDealerHand] = useState<any[]>([]);
  const [playerScore, setPlayerScore] = useState(0);
  const [dealerScore, setDealerScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [message, setMessage] = useState("");

  const calculateScore = (hand: any[]) => {
    let score = hand.reduce((sum, card) => sum + (parseInt(card.rank) || (card.rank === "A" ? 11 : 10)), 0);
    let aces = hand.filter((card) => card.rank === "A").length;
    while (score > 21 && aces) {
      score -= 10;
      aces--;
    }
    return score;
  };

  const dealCard = (targetHand: any[], setTargetHand: any, delay: number) => {
    const card = deck.pop();
    if (!card) return;

    setDeck([...deck]);
    setTargetHand((prevHand: any[]) => [...prevHand, card]);

    setTimeout(() => {
      const cardEl = document.getElementById(card.id);
      if (cardEl) {
        gsap.fromTo(
          cardEl,
          { x: window.innerWidth, y: 0, rotation: 90, opacity: 0 },
          { x: 0, y: 0, rotation: 0, opacity: 1, duration: 1, ease: "power2.out" }
        );
      }
    }, delay);
  };

  const startGame = () => {
    setDeck(createDeck());
    setPlayerHand([]);
    setDealerHand([]);
    setGameOver(false);
    setMessage("");

    dealCard(playerHand, setPlayerHand, 100);
    dealCard(dealerHand, setDealerHand, 500);
    dealCard(playerHand, setPlayerHand, 1000);
    dealCard(dealerHand, setDealerHand, 1500);
  };

  const hit = () => {
    dealCard(playerHand, setPlayerHand, 0);
  };

  const stand = () => {
    let score = calculateScore(dealerHand);
    while (score < 17) {
      dealCard(dealerHand, setDealerHand, 500);
      score = calculateScore(dealerHand);
    }
    setGameOver(true);
    determineWinner();
  };

  const determineWinner = () => {
    const playerTotal = calculateScore(playerHand);
    const dealerTotal = calculateScore(dealerHand);

    if (playerTotal > 21) setMessage("💥 Bust! You lose.");
    else if (dealerTotal > 21) setMessage("🎉 Dealer busts! You win!");
    else if (playerTotal > dealerTotal) setMessage("🏆 You win!");
    else if (playerTotal < dealerTotal) setMessage("❌ Dealer wins!");
    else setMessage("🤝 It's a tie!");
  };

  useEffect(() => {
    setPlayerScore(calculateScore(playerHand));
    setDealerScore(calculateScore(dealerHand));
  }, [playerHand, dealerHand]);

  return (
    <div className="blackjack-container">
      <h1 className="game-title">♠️ Blackjack ♣️</h1>

      <div className="dealer-section">
        <h2>Dealer</h2>
        <div className="card-container">
          {dealerHand.map((card) => (
            <div key={card.id} className="card" id={card.id}>
              {card.rank} {card.suit}
            </div>
          ))}
        </div>
        <p>Score: {gameOver ? dealerScore : "??"}</p>
      </div>

      <div className="player-section">
        <h2>Player</h2>
        <div className="card-container">
          {playerHand.map((card) => (
            <div key={card.id} className="card" id={card.id}>
              {card.rank} {card.suit}
            </div>
          ))}
        </div>
        <p>Score: {playerScore}</p>
      </div>

      <p className="message">{message}</p>

      <div className="controls">
        {!gameOver ? (
          <>
            <button onClick={hit}>Hit</button>
            <button onClick={stand}>Stand</button>
          </>
        ) : (
          <button onClick={startGame}>New Game</button>
        )}
      </div>
    </div>
  );
}
