"use client";
import React, { useEffect, useRef } from "react";

const DiceAnimation = ({ onComplete }: { onComplete: (results: number[]) => void }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      // Insert necessary HTML elements for the dice simulation
      container.innerHTML = `
        <canvas id="canvas" style="width:100%; height:100%;"></canvas>
        <div id="score-result" style="display:none;"></div>
        <button id="roll-btn" style="display:none;"></button>
      `;
      // Set global callback for dice animation completion
      (window as any).onDiceAnimationComplete = (results: number[]) => {
        onComplete(results);
      };

      // Dynamically import the DiceSimulation code
      import("./DiceSimulation.js").catch((err) => {
        console.error("Failed to load DiceSimulation:", err);
      });
    }
    return () => {
      (window as any).onDiceAnimationComplete = null;
    };
  }, [onComplete]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
};

export default DiceAnimation;
