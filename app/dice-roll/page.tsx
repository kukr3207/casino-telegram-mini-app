// "use client";

// import React, { useState, useEffect } from "react";
// import "../../styles/dice-roll.css";

// interface Bet {
//   category: string;
//   option: string;
//   amount: number;
//   isWin?: boolean;
//   winAmount?: number;
// }

// export default function DiceRollPage() {
//   const [selectedBets, setSelectedBets] = useState<Bet[]>([]);
//   const [betAmount, setBetAmount] = useState<number>(10);
//   const [isRolling, setIsRolling] = useState(false);
//   const [isDiceRolled, setIsDiceRolled] = useState(false); // New State for Fix
//   const [diceResult, setDiceResult] = useState<number[]>([1, 1]);
//   const [rollHash, setRollHash] = useState<string | null>(null);
//   const [verificationSeed, setVerificationSeed] = useState<string | null>(null);
//   const [casinoChips, setCasinoChips] = useState<number>(0);
//   const [showConfirmation, setShowConfirmation] = useState(false);
//   const [rollingDice, setRollingDice] = useState<number[]>([1, 1]);
//   const [hasResult, setHasResult] = useState(false);
//   const [showDicePopup, setShowDicePopup] = useState(false); // New for Dice Animation

//   const betOptions: Record<string, string[]> = {
//     ranges: ["Low (2-6)", "High (8-12)"],
//     exact: ["2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"],
//     pairs: ["Double 1s", "Double 2s", "Double 3s", "Double 4s", "Double 5s", "Double 6s"],
//     evenodd: ["Even", "Odd"],
//   };

//   const payoutRatios: Record<string, number> = {
//     ranges: 1.9,
//     exact: 10,
//     pairs: 15,
//     evenodd: 1.9,
//   };

//   useEffect(() => {
//     const tokens = sessionStorage.getItem("tokens");
//     if (tokens) {
//       const parsedTokens = JSON.parse(tokens);
//       setCasinoChips(parsedTokens[0]?.count || 0);
//     }
//   }, []);

//   const handleBetSelect = (category: string, option: string): void => {
//     const existingBet = selectedBets.find((bet) => bet.category === category && bet.option === option);
//     if (existingBet) {
//       setSelectedBets(selectedBets.filter((bet) => bet !== existingBet));
//     } else {
//       setSelectedBets([...selectedBets, { category, option, amount: betAmount }]);
//     }
//   };

//   const handleBetAmountChange = (amount: number, index: number): void => {
//     const updatedBets = [...selectedBets];
//     updatedBets[index].amount = amount;
//     setSelectedBets(updatedBets);
//   };

//   const handleRollDice = () => {
//     if (selectedBets.length === 0 || isRolling) return;
//     setShowConfirmation(true);
//   };

//   const confirmBet = async () => {
//     setShowConfirmation(false);
//     setShowDicePopup(true); // Show Dice Popup
//     setIsRolling(true);
//     setIsDiceRolled(false); // Reset when starting the roll

//     const totalBetAmount = selectedBets.reduce((sum, bet) => sum + bet.amount, 0);
//     if (totalBetAmount > casinoChips) {
//       alert("Insufficient balance! Adjust your bet amount.");
//       return;
//     }

//     const updatedChips = casinoChips - totalBetAmount;
//     setCasinoChips(updatedChips);
//     await updateTokens(updatedChips, 0, 0);

//     setIsRolling(true);
//     setRollingDice([1, 1]);

//     const rollingInterval = setInterval(() => {
//       setRollingDice([Math.ceil(Math.random() * 6), Math.ceil(Math.random() * 6)]);
//     }, 100);

//     try {
//       const response = await fetch("/api/dice-roll", { method: "POST" });
//       const { dice1, dice2, hash, seed } = await response.json();

//       setTimeout(() => {
//         clearInterval(rollingInterval);
//         setDiceResult([dice1, dice2]);
//         setRollHash(hash);
//         setVerificationSeed(seed);
//         highlightBets(dice1, dice2);
//         setIsRolling(false);
//         setHasResult(true);
//       }, 3000);
//     } catch (error) {
//       console.error("Error rolling dice:", error);
//       clearInterval(rollingInterval);
//       setIsRolling(false);
//     }
//   };

//   const updateTokens = async (casinoChips: number, withdrawalTokens: number, holTokens: number) => {
//     const chatId = sessionStorage.getItem("chat_id");
//     const tokens = JSON.parse(sessionStorage.getItem("tokens") || "[]");

//     tokens[0].count = casinoChips;
//     tokens[1].count += withdrawalTokens;
//     tokens[2].count += holTokens;

//     sessionStorage.setItem("tokens", JSON.stringify(tokens));

//     const betAmount = selectedBets.reduce((sum, bet) => sum + bet.amount, 0);
//     const winAmount = selectedBets.filter(bet => bet.isWin).reduce((sum, bet) => sum + (bet.winAmount || 0), 0);
//     const lossAmount = betAmount - winAmount;

//     const wonBets = selectedBets.filter(bet => bet.isWin);
//     const lostBets = selectedBets.filter(bet => !bet.isWin);

//     const payload = {
//       chatId,
//       tokens: {
//         casino_chips: tokens[0].count,
//         withdraw_tokens: tokens[1].count,
//         hol_tokens: tokens[2].count,
//       },
//       dice1: diceResult[0],
//       dice2: diceResult[1],
//       hash: rollHash,
//       seed: verificationSeed,
//       placedBets: selectedBets,
//       wonBets,
//       lostBets,
//       betAmount,
//       winAmount,
//       lossAmount,
//     };

//     const response = await fetch("/api/game-update-tokens", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify(payload),
//     });

//     if (!response.ok) {
//       console.error("Failed to update tokens", await response.json());
//     }
//   };

//   const handleCollectRewards = async () => {
//     const winnings = selectedBets
//       .filter((bet) => bet.isWin)
//       .reduce((total, bet) => total + (bet.winAmount || 0), 0);

//     const holdTokens = winnings - selectedBets.reduce((sum, bet) => sum + (bet.isWin ? bet.amount : 0), 0);

//     await updateTokens(casinoChips, winnings, holdTokens);
//     resetGame();
//   };

//   const resetGame = () => {
//     setSelectedBets([]);
//     setDiceResult([1, 1]);
//     setRollHash(null);
//     setVerificationSeed(null);
//     setHasResult(false);
//   };

//   const highlightBets = (dice1: number, dice2: number): void => {
//     const total = dice1 + dice2;
//     setSelectedBets((prevBets) =>
//       prevBets.map((bet) => {
//         const isWin = checkBetWin(bet, dice1, dice2, total);
//         const payout = payoutRatios[bet.category] || 1;
//         return {
//           ...bet,
//           isWin,
//           winAmount: isWin ? bet.amount * payout : 0,
//         };
//       })
//     );
//   };

//   const checkBetWin = (bet: Bet, dice1: number, dice2: number, total: number): boolean => {
//     switch (bet.category) {
//       case "ranges":
//         return (bet.option === "Low (2-6)" && total >= 2 && total <= 6) ||
//                (bet.option === "High (8-12)" && total >= 8 && total <= 12);
//       case "exact":
//         return total === parseInt(bet.option);
//       case "pairs":
//         return bet.option === `Double ${dice1}s` && dice1 === dice2;
//       case "evenodd":
//         return (bet.option === "Even" && total % 2 === 0) ||
//                (bet.option === "Odd" && total % 2 !== 0);
//       default:
//         return false;
//     }
//   };

//   const hasWon = selectedBets.some((bet) => bet.isWin);

//   return (
//     <div className="dice-roll-page">
//       <h3 className="dice-roll-title">Place Your Bets and Roll the Dice 🎲</h3>

//       <div className="category-options">
//         {Object.keys(betOptions).map((category) => (
//           <div key={category} className="category">
//             <h3>{category.charAt(0).toUpperCase() + category.slice(1)}</h3>
//             <div className="bet-buttons">
//               {betOptions[category].map((option) => (
//                 <button
//                   key={option}
//                   className={`bet-button ${
//                     selectedBets.some((bet) => bet.category === category && bet.option === option)
//                       ? "selected"
//                       : ""
//                   }`}
//                   onClick={() => handleBetSelect(category, option)}
//                 >
//                   {option}
//                 </button>
//               ))}
//             </div>
//             <p className="payout-ratio">Payout: {payoutRatios[category]}x</p>
//           </div>
//         ))}
//       </div>

//       <div className="selected-bets">
//         <h3>Your Bets</h3>
//         {selectedBets.length === 0 ? (
//           <p className="no-bets">No bets selected. Pick one above!</p>
//         ) : (
//           <div className="bet-list">
//             {selectedBets.map((bet, index) => (
//               <div key={`${bet.category}-${bet.option}`} className={`bet-card ${bet.isWin ? "win" : bet.isWin === false ? "lose" : ""}`}>
//                 <span className="bet-text">{bet.category} - {bet.option}</span>
//                 {bet.isWin !== undefined ? (
//                   <p>{bet.isWin ? `Won: ${bet.winAmount} tokens` : `Lost: ${bet.amount} tokens`}</p>
//                 ) : (
//                   <input
//                     type="number"
//                     min={10}
//                     value={bet.amount}
//                     className="bet-input"
//                     onChange={(e) => handleBetAmountChange(Number(e.target.value), index)}
//                   />
//                 )}
//               </div>
//             ))}
//           </div>
//         )}
//       </div>

//       <div className="place-bet">
//         {!hasResult && (
//           <button className="place-bet-button" onClick={handleRollDice} disabled={selectedBets.length === 0 || isRolling}>
//             {isRolling ? "Rolling Dice..." : "Roll Dice"}
//           </button>
//         )}

//         {hasResult && hasWon && (
//           <button className="collect-button" onClick={handleCollectRewards}>Collect Rewards</button>
//         )}

//         {hasResult && !hasWon && (
//           <button className="reset-button" onClick={resetGame}>Reset</button>
//         )}
//       </div>

//       {showConfirmation && (
//         <div className="popup-overlay">
//           <div className="popup-content">
//             <h3>Confirm Your Bet</h3>
//             <p>Total Bet: {selectedBets.reduce((sum, bet) => sum + bet.amount, 0)} Chips</p>
//             <button onClick={confirmBet} className="confirm-button">Yes, Confirm</button>
//             <button onClick={() => setShowConfirmation(false)} className="cancel-button">No, Go Back</button>
//           </div>
//         </div>
//       )}

// {showDicePopup && (
//         <div className="popup-overlay" onClick={() => setShowDicePopup(false)}>
//           <div className="dice-popup-content" onClick={(e) => e.stopPropagation()}>
//             <h3>{isRolling ? "Rolling Dice..." : isDiceRolled ? "Dice Result 🎲" : ""}</h3>
//             <div className="dice-container">
//               {(isRolling ? rollingDice : diceResult).map((value, index) => (
//                 <div key={index} className={`dice ${isRolling ? "rolling" : ""}`} data-value={value}>
//                   {[...Array(9)].map((_, i) => (
//                     <div key={i} className={`dot ${i + 1 === value ? "visible" : ""}`} />
//                   ))}
//                 </div>
//               ))}
//             </div>
//           </div>
//         </div>
//       )}

//       {!isRolling && rollHash && (
//         <div className="dice-result">
//           <h2>Result: {diceResult[0]} + {diceResult[1]}</h2>
//           <p><strong>Fairness Proof:</strong> {rollHash}</p>
//           <p><strong>Verification Seed:</strong> {verificationSeed}</p>
//         </div>
//       )}
//     </div>
//   );
// }


"use client";

import React, { useState, useEffect } from "react";
import "../../styles/dice-roll.css";

// New imports for the dice animation integration
import * as THREE from "three";
import * as CANNON from "cannon-es";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils";

// Declare the custom property on window.
declare global {
  interface Window {
    onDiceAnimationComplete?: (results: number[]) => void;
  }
}

interface Bet {
  category: string;
  option: string;
  amount: number;
  isWin?: boolean;
  winAmount?: number;
}

export default function DiceRollPage() {
  const [selectedBets, setSelectedBets] = useState<Bet[]>([]);
  const [betAmount, setBetAmount] = useState<number>(10);
  const [isRolling, setIsRolling] = useState(false);
  const [isDiceRolled, setIsDiceRolled] = useState(false); // New State for Fix
  const [diceResult, setDiceResult] = useState<number[]>([1, 1]);
  const [rollHash, setRollHash] = useState<string | null>(null);
  const [verificationSeed, setVerificationSeed] = useState<string | null>(null);
  const [casinoChips, setCasinoChips] = useState<number>(0);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [rollingDice, setRollingDice] = useState<number[]>([1, 1]);
  const [hasResult, setHasResult] = useState(false);
  const [showDicePopup, setShowDicePopup] = useState(false); // New for Dice Animation

  const betOptions: Record<string, string[]> = {
    ranges: ["Low (2-6)", "High (8-12)"],
    exact: ["2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"],
    pairs: [
      "Double 1s",
      "Double 2s",
      "Double 3s",
      "Double 4s",
      "Double 5s",
      "Double 6s",
    ],
    evenodd: ["Even", "Odd"],
  };

  const payoutRatios: Record<string, number> = {
    ranges: 1.9,
    exact: 10,
    pairs: 15,
    evenodd: 1.9,
  };

  useEffect(() => {
    const tokens = sessionStorage.getItem("tokens");
    if (tokens) {
      const parsedTokens = JSON.parse(tokens);
      setCasinoChips(parsedTokens[0]?.count || 0);
    }
  }, []);

  const handleBetSelect = (category: string, option: string): void => {
    const existingBet = selectedBets.find(
      (bet) => bet.category === category && bet.option === option
    );
    if (existingBet) {
      setSelectedBets(selectedBets.filter((bet) => bet !== existingBet));
    } else {
      setSelectedBets([...selectedBets, { category, option, amount: betAmount }]);
    }
  };

  const handleBetAmountChange = (amount: number, index: number): void => {
    const updatedBets = [...selectedBets];
    updatedBets[index].amount = amount;
    setSelectedBets(updatedBets);
  };

  const handleRollDice = () => {
    if (selectedBets.length === 0 || isRolling) return;
    setShowConfirmation(true);
  };

  const confirmBet = async () => {
    setShowConfirmation(false);
    // Show the new animation popup (canvas only)
    setShowDicePopup(true);
    setIsRolling(true);
    setIsDiceRolled(false);

    const totalBetAmount = selectedBets.reduce((sum, bet) => sum + bet.amount, 0);
    if (totalBetAmount > casinoChips) {
      alert("Insufficient balance! Adjust your bet amount.");
      return;
    }

    const updatedChips = casinoChips - totalBetAmount;
    setCasinoChips(updatedChips);
    await updateTokens(updatedChips, 0, 0);

    // Dummy rolling interval to update state (if needed)
    const rollingInterval = setInterval(() => {
      setRollingDice([Math.ceil(Math.random() * 6), Math.ceil(Math.random() * 6)]);
    }, 100);

    try {
      const response = await fetch("/api/dice-roll", { method: "POST" });
      const { dice1, dice2, hash, seed } = await response.json();

      setTimeout(() => {
        clearInterval(rollingInterval);
        setDiceResult([dice1, dice2]);
        setRollHash(hash);
        setVerificationSeed(seed);
        highlightBets(dice1, dice2);
        setIsRolling(false);
        setHasResult(true);
      }, 3000);
    } catch (error) {
      console.error("Error rolling dice:", error);
      clearInterval(rollingInterval);
      setIsRolling(false);
    }
  };

  const updateTokens = async (
    casinoChips: number,
    withdrawalTokens: number,
    holTokens: number
  ) => {
    const chatId = sessionStorage.getItem("chat_id");
    const tokens = JSON.parse(sessionStorage.getItem("tokens") || "[]");

    tokens[0].count = casinoChips;
    tokens[1].count += withdrawalTokens;
    tokens[2].count += holTokens;

    sessionStorage.setItem("tokens", JSON.stringify(tokens));

    const betAmount = selectedBets.reduce((sum, bet) => sum + bet.amount, 0);
    const winAmount = selectedBets
      .filter((bet) => bet.isWin)
      .reduce((sum, bet) => sum + (bet.winAmount || 0), 0);
    const lossAmount = betAmount - winAmount;

    const wonBets = selectedBets.filter((bet) => bet.isWin);
    const lostBets = selectedBets.filter((bet) => !bet.isWin);

    const payload = {
      chatId,
      tokens: {
        casino_chips: tokens[0].count,
        withdraw_tokens: tokens[1].count,
        hol_tokens: tokens[2].count,
      },
      dice1: diceResult[0],
      dice2: diceResult[1],
      hash: rollHash,
      seed: verificationSeed,
      placedBets: selectedBets,
      wonBets,
      lostBets,
      betAmount,
      winAmount,
      lossAmount,
    };

    const response = await fetch("/api/game-update-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error("Failed to update tokens", await response.json());
    }
  };

  const handleCollectRewards = async () => {
    const winnings = selectedBets
      .filter((bet) => bet.isWin)
      .reduce((total, bet) => total + (bet.winAmount || 0), 0);

    const holdTokens =
      winnings -
      selectedBets.reduce((sum, bet) => sum + (bet.isWin ? bet.amount : 0), 0);

    await updateTokens(casinoChips, winnings, holdTokens);
    resetGame();
  };

  const resetGame = () => {
    setSelectedBets([]);
    setDiceResult([1, 1]);
    setRollHash(null);
    setVerificationSeed(null);
    setHasResult(false);
  };

  const highlightBets = (dice1: number, dice2: number): void => {
    const total = dice1 + dice2;
    setSelectedBets((prevBets) =>
      prevBets.map((bet) => {
        const isWin = checkBetWin(bet, dice1, dice2, total);
        const payout = payoutRatios[bet.category] || 1;
        return {
          ...bet,
          isWin,
          winAmount: isWin ? bet.amount * payout : 0,
        };
      })
    );
  };

  const checkBetWin = (
    bet: Bet,
    dice1: number,
    dice2: number,
    total: number
  ): boolean => {
    switch (bet.category) {
      case "ranges":
        return (bet.option === "Low (2-6)" && total >= 2 && total <= 6) ||
               (bet.option === "High (8-12)" && total >= 8 && total <= 12);
      case "exact":
        return total === parseInt(bet.option);
      case "pairs":
        return bet.option === `Double ${dice1}s` && dice1 === dice2;
      case "evenodd":
        return (bet.option === "Even" && total % 2 === 0) ||
               (bet.option === "Odd" && total % 2 !== 0);
      default:
        return false;
    }
  };

  const hasWon = selectedBets.some((bet) => bet.isWin);

  // ============================================================================
  // NEW: UseEffect to integrate the new Three.js/Cannon-es dice roll animation.
  // The new design features larger dice that bounce and roll until physics sleep.
  // Once settled, the dice face (result) is determined and sent back.
  // ============================================================================
  useEffect(() => {
    if (!showDicePopup) return;

    // Get the canvas element in the popup.
    const canvas = document.getElementById("dice-animation-canvas") as HTMLCanvasElement;
    if (!canvas) return;

    // Local variables with explicit types.
    let renderer: THREE.WebGLRenderer;
    let scene: THREE.Scene;
    let camera: THREE.PerspectiveCamera;
    let diceMesh: THREE.Group;
    let physicsWorld: CANNON.World;
    const simParams = {
      numberOfDice: 2,
      segments: 40,
      edgeRadius: 0.07,
      notchRadius: 0.12,
      notchDepth: 0.1,
      scale: 2, // Increase dice size.
    };
    const diceArray: any[] = [];

    // Helper functions: convert Cannon-es types to Three.js types.
    const vec3FromCannon = (v: CANNON.Vec3): THREE.Vector3 =>
      new THREE.Vector3(v.x, v.y, v.z);
    const quatFromCannon = (q: CANNON.Quaternion): THREE.Quaternion =>
      new THREE.Quaternion(q.x, q.y, q.z, q.w);

    function initPhysics(): void {
      physicsWorld = new CANNON.World({
        allowSleep: true,
        gravity: new CANNON.Vec3(0, -50, 0),
      });
      // Increase restitution for more bounce.
      physicsWorld.defaultContactMaterial.restitution = 0.8;
    }

    function initScene(): void {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        canvas: canvas,
      });
      renderer.shadowMap.enabled = true;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      scene = new THREE.Scene();

      // Position the camera to frame the larger dice.
      camera = new THREE.PerspectiveCamera(
        45,
        canvas.clientWidth / canvas.clientHeight,
        0.1,
        300
      );
      camera.position.set(0, 4, 10);
      updateSceneSize();

      const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
      scene.add(ambientLight);
      const topLight = new THREE.PointLight(0xffffff, 0.8);
      topLight.position.set(10, 20, 5);
      topLight.castShadow = true;
      scene.add(topLight);

      createFloor();
      diceMesh = createDiceMesh();
      for (let i = 0; i < simParams.numberOfDice; i++) {
        const dice = createDice();
        // Scale dice to be larger.
        dice.mesh.scale.set(simParams.scale, simParams.scale, simParams.scale);
        diceArray.push(dice);
        addDiceEvents(dice);
      }

      throwDice();
      render();
    }

    function createFloor(): void {
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(1000, 1000),
        new THREE.ShadowMaterial({ opacity: 0.1 })
      );
      floor.receiveShadow = true;
      floor.position.y = -1;
      floor.quaternion.setFromAxisAngle(new THREE.Vector3(-1, 0, 0), Math.PI * 0.5);
      scene.add(floor);

      const floorBody = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: new CANNON.Plane(),
      });
      floorBody.position.copy(new CANNON.Vec3(floor.position.x, floor.position.y, floor.position.z));
      floorBody.quaternion.copy(new CANNON.Quaternion(
        floor.quaternion.x,
        floor.quaternion.y,
        floor.quaternion.z,
        floor.quaternion.w
      ));
      physicsWorld.addBody(floorBody);
    }

    function createDiceMesh(): THREE.Group {
      const boxMaterialOuter = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
      const boxMaterialInner = new THREE.MeshStandardMaterial({
        color: 0x000000,
        roughness: 0,
        metalness: 1,
        side: THREE.DoubleSide,
      });
      const meshGroup = new THREE.Group();
      const innerMesh = new THREE.Mesh(createInnerGeometry(), boxMaterialInner);
      const outerMesh = new THREE.Mesh(createBoxGeometry(), boxMaterialOuter);
      outerMesh.castShadow = true;
      meshGroup.add(innerMesh, outerMesh);
      return meshGroup;
    }

    function createBoxGeometry(): THREE.BufferGeometry {
      let boxGeometry = new THREE.BoxGeometry(
        1,
        1,
        1,
        simParams.segments,
        simParams.segments,
        simParams.segments
      );
      const origParameters = boxGeometry.parameters;
      const positionAttr = boxGeometry.attributes.position;
      const subCubeHalfSize = 0.5 - simParams.edgeRadius;

      for (let i = 0; i < positionAttr.count; i++) {
        let position = new THREE.Vector3().fromBufferAttribute(positionAttr, i);
        const subCube = new THREE.Vector3(
          Math.sign(position.x),
          Math.sign(position.y),
          Math.sign(position.z)
        ).multiplyScalar(subCubeHalfSize);
        const addition = new THREE.Vector3().subVectors(position, subCube);

        if (
          Math.abs(position.x) > subCubeHalfSize &&
          Math.abs(position.y) > subCubeHalfSize &&
          Math.abs(position.z) > subCubeHalfSize
        ) {
          addition.normalize().multiplyScalar(simParams.edgeRadius);
          position = subCube.add(addition);
        } else if (
          Math.abs(position.x) > subCubeHalfSize &&
          Math.abs(position.y) > subCubeHalfSize
        ) {
          addition.z = 0;
          addition.normalize().multiplyScalar(simParams.edgeRadius);
          position.x = subCube.x + addition.x;
          position.y = subCube.y + addition.y;
        } else if (
          Math.abs(position.x) > subCubeHalfSize &&
          Math.abs(position.z) > subCubeHalfSize
        ) {
          addition.y = 0;
          addition.normalize().multiplyScalar(simParams.edgeRadius);
          position.x = subCube.x + addition.x;
          position.z = subCube.z + addition.z;
        } else if (
          Math.abs(position.y) > subCubeHalfSize &&
          Math.abs(position.z) > subCubeHalfSize
        ) {
          addition.x = 0;
          addition.normalize().multiplyScalar(simParams.edgeRadius);
          position.y = subCube.y + addition.y;
          position.z = subCube.z + addition.z;
        }

        const notchWave = (v: number): number => {
          v = (1 / simParams.notchRadius) * v;
          v = Math.PI * Math.max(-1, Math.min(1, v));
          return simParams.notchDepth * (Math.cos(v) + 1);
        };
        const notch = (pos: number[]): number =>
          notchWave(pos[0]) * notchWave(pos[1]);

        const offset = 0.23;
        if (position.y === 0.5) {
          position.y -= notch([position.x, position.z]);
        } else if (position.x === 0.5) {
          position.x -= notch([position.y + offset, position.z + offset]);
          position.x -= notch([position.y - offset, position.z - offset]);
        } else if (position.z === 0.5) {
          position.z -= notch([position.x - offset, position.y + offset]);
          position.z -= notch([position.x, position.y]);
          position.z -= notch([position.x + offset, position.y - offset]);
        } else if (position.z === -0.5) {
          position.z += notch([position.x + offset, position.y + offset]);
          position.z += notch([position.x + offset, position.y - offset]);
          position.z += notch([position.x - offset, position.y + offset]);
          position.z += notch([position.x - offset, position.y - offset]);
        } else if (position.x === -0.5) {
          position.x += notch([position.y + offset, position.z + offset]);
          position.x += notch([position.y + offset, position.z - offset]);
          position.x += notch([position.y, position.z]);
          position.x += notch([position.y - offset, position.z + offset]);
          position.x += notch([position.y - offset, position.z - offset]);
        } else if (position.y === -0.5) {
          position.y += notch([position.x + offset, position.z + offset]);
          position.y += notch([position.x + offset, position.z]);
          position.y += notch([position.x + offset, position.z - offset]);
          position.y += notch([position.x - offset, position.z + offset]);
          position.y += notch([position.x - offset, position.z]);
          position.y += notch([position.x - offset, position.z - offset]);
        }
        positionAttr.setXYZ(i, position.x, position.y, position.z);
      }

      boxGeometry.deleteAttribute("normal");
      boxGeometry.deleteAttribute("uv");
      const mergedGeometry = BufferGeometryUtils.mergeVertices(boxGeometry);
      const newBoxGeometry = new THREE.BoxGeometry(
        (boxGeometry.parameters as any).width,
        (boxGeometry.parameters as any).height,
        (boxGeometry.parameters as any).depth,
        (boxGeometry.parameters as any).widthSegments,
        (boxGeometry.parameters as any).heightSegments,
        (boxGeometry.parameters as any).depthSegments
      );

      // Copy attributes from merged geometry to new box geometry
      newBoxGeometry.setAttribute('position', mergedGeometry.getAttribute('position'));
      newBoxGeometry.computeVertexNormals();

      boxGeometry = newBoxGeometry;

      (boxGeometry as any).parameters = origParameters;
      boxGeometry.computeVertexNormals();
      return boxGeometry;
    }

    function createInnerGeometry(): THREE.BufferGeometry {
      const baseGeometry = new THREE.PlaneGeometry(
        1 - 2 * simParams.edgeRadius,
        1 - 2 * simParams.edgeRadius
      );
      const offset = 0.48;
      return BufferGeometryUtils.mergeGeometries(
        [
          baseGeometry.clone().translate(0, 0, offset),
          baseGeometry.clone().translate(0, 0, -offset),
          baseGeometry.clone().rotateX(0.5 * Math.PI).translate(0, -offset, 0),
          baseGeometry.clone().rotateX(0.5 * Math.PI).translate(0, offset, 0),
          baseGeometry.clone().rotateY(0.5 * Math.PI).translate(-offset, 0, 0),
          baseGeometry.clone().rotateY(0.5 * Math.PI).translate(offset, 0, 0),
        ],
        false
      );
    }

    function createDice(): { mesh: THREE.Group; body: CANNON.Body } {
      const mesh = diceMesh.clone();
      scene.add(mesh);
      const body = new CANNON.Body({
        mass: 1,
        shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
        sleepTimeLimit: 0.1,
      });
      physicsWorld.addBody(body);
      return { mesh, body };
    }

    function addDiceEvents(dice: any): void {
      dice.body.addEventListener("sleep", (e: any) => {
        dice.body.allowSleep = false;
        const euler = new CANNON.Vec3();
        e.target.quaternion.toEuler(euler);
        const eps = 0.1;
        let isZero = (angle: number) => Math.abs(angle) < eps;
        let isHalfPi = (angle: number) => Math.abs(angle - 0.5 * Math.PI) < eps;
        let isMinusHalfPi = (angle: number) => Math.abs(0.5 * Math.PI + angle) < eps;
        let isPiOrMinusPi = (angle: number) =>
          Math.abs(Math.PI - angle) < eps || Math.abs(Math.PI + angle) < eps;

        if (isZero(euler.z)) {
          if (isZero(euler.x)) {
            showRollResults(1);
          } else if (isHalfPi(euler.x)) {
            showRollResults(4);
          } else if (isMinusHalfPi(euler.x)) {
            showRollResults(3);
          } else if (isPiOrMinusPi(euler.x)) {
            showRollResults(6);
          } else {
            dice.body.allowSleep = true;
          }
        } else if (isHalfPi(euler.z)) {
          showRollResults(2);
        } else if (isMinusHalfPi(euler.z)) {
          showRollResults(5);
        } else {
          dice.body.allowSleep = true;
        }
      });
    }

    function showRollResults(score: number): void {
      const scoreResult = document.getElementById("score-result");
      if (!scoreResult) return;
      if (scoreResult.innerHTML === "") {
        scoreResult.innerHTML += score;
      } else {
        scoreResult.innerHTML += ("+" + score);
      }
      if (window.onDiceAnimationComplete) {
        const results = scoreResult.innerHTML.split("+").map(Number);
        if (results.length === simParams.numberOfDice) {
          window.onDiceAnimationComplete(results);
        }
      }
    }

    function render(): void {
      physicsWorld.fixedStep();
      for (const dice of diceArray) {
        dice.mesh.position.copy(vec3FromCannon(dice.body.position));
        dice.mesh.quaternion.copy(quatFromCannon(dice.body.quaternion));
      }
      renderer.render(scene, camera);
      requestAnimationFrame(render);
    }

    function updateSceneSize(): void {
      camera.aspect = canvas.clientWidth / canvas.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    }

    function throwDice(): void {
      const scoreResult = document.getElementById("score-result");
      if (scoreResult) scoreResult.innerHTML = "";
      diceArray.forEach((d, dIdx) => {
        d.body.velocity.setZero();
        d.body.angularVelocity.setZero();
        d.body.position = new CANNON.Vec3(6, dIdx * 1.5, 0);
        d.mesh.position.copy(new THREE.Vector3(
          d.body.position.x,
          d.body.position.y,
          d.body.position.z
        ));
        d.mesh.rotation.set(
          2 * Math.PI * Math.random(),
          0,
          2 * Math.PI * Math.random()
        );
        d.body.quaternion.copy(new CANNON.Quaternion(
          d.mesh.quaternion.x,
          d.mesh.quaternion.y,
          d.mesh.quaternion.z,
          d.mesh.quaternion.w
        ));
        const force = 8 + 4 * Math.random();
        d.body.applyImpulse(
          new CANNON.Vec3(-force, force, 0),
          new CANNON.Vec3(0, 0, 0.2)
        );
        d.body.allowSleep = true;
      });
    }

    initPhysics();
    initScene();

    return () => {
      // Cleanup renderer, remove event listeners, etc.
    };
  }, [showDicePopup]);
  // End of dice animation integration useEffect
  // ============================================================================

  return (
    <div className="dice-roll-page">
      <h3 className="dice-roll-title">Place Your Bets and Roll the Dice 🎲</h3>

      <div className="category-options">
        {Object.keys(betOptions).map((category) => (
          <div key={category} className="category">
            <h3>{category.charAt(0).toUpperCase() + category.slice(1)}</h3>
            <div className="bet-buttons">
              {betOptions[category].map((option) => (
                <button
                  key={option}
                  className={`bet-button ${
                    selectedBets.some(
                      (bet) => bet.category === category && bet.option === option
                    )
                      ? "selected"
                      : ""
                  }`}
                  onClick={() => handleBetSelect(category, option)}
                >
                  {option}
                </button>
              ))}
            </div>
            <p className="payout-ratio">Payout: {payoutRatios[category]}x</p>
          </div>
        ))}
      </div>

      <div className="selected-bets">
        <h3>Your Bets</h3>
        {selectedBets.length === 0 ? (
          <p className="no-bets">No bets selected. Pick one above!</p>
        ) : (
          <div className="bet-list">
            {selectedBets.map((bet, index) => (
              <div
                key={`${bet.category}-${bet.option}`}
                className={`bet-card ${
                  bet.isWin ? "win" : bet.isWin === false ? "lose" : ""
                }`}
              >
                <span className="bet-text">
                  {bet.category} - {bet.option}
                </span>
                {bet.isWin !== undefined ? (
                  <p>
                    {bet.isWin
                      ? `Won: ${bet.winAmount} tokens`
                      : `Lost: ${bet.amount} tokens`}
                  </p>
                ) : (
                  <input
                    type="number"
                    min={10}
                    value={bet.amount}
                    className="bet-input"
                    onChange={(e) =>
                      handleBetAmountChange(Number(e.target.value), index)
                    }
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="place-bet">
        {!hasResult && (
          <button
            className="place-bet-button"
            onClick={handleRollDice}
            disabled={selectedBets.length === 0 || isRolling}
          >
            {isRolling ? "Rolling Dice..." : "Roll Dice"}
          </button>
        )}

        {hasResult && hasWon && (
          <button className="collect-button" onClick={handleCollectRewards}>
            Collect Rewards
          </button>
        )}

        {hasResult && !hasWon && (
          <button className="reset-button" onClick={resetGame}>
            Reset
          </button>
        )}
      </div>

      {showConfirmation && (
        <div className="popup-overlay">
          <div className="popup-content">
            <h3>Confirm Your Bet</h3>
            <p>
              Total Bet:{" "}
              {selectedBets.reduce((sum, bet) => sum + bet.amount, 0)} Chips
            </p>
            <button onClick={confirmBet} className="confirm-button">
              Yes, Confirm
            </button>
            <button
              onClick={() => setShowConfirmation(false)}
              className="cancel-button"
            >
              No, Go Back
            </button>
          </div>
        </div>
      )}

      {showDicePopup && (
        <div className="popup-overlay" onClick={() => setShowDicePopup(false)}>
          <div
            className="dice-popup-content"
            onClick={(e) => e.stopPropagation()}
          >
            {/* NEW: Only show the simulation canvas for the new dice design */}
            <canvas
              id="dice-animation-canvas"
              style={{ width: "100%", height: "100%" }}
            ></canvas>
          </div>
        </div>
      )}

      {!isRolling && rollHash && (
        <div className="dice-result">
          <h2>
            Result: {diceResult[0]} + {diceResult[1]}
          </h2>
          <p>
            <strong>Fairness Proof:</strong> {rollHash}
          </p>
          <p>
            <strong>Verification Seed:</strong> {verificationSeed}
          </p>
        </div>
      )}
    </div>
  );
}
