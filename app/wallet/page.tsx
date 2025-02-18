"use client";

import { useEffect, useState, ReactNode } from "react";
import "../../styles/wallet.css";
import Confetti from "react-confetti";

// Reusable collapsible panel component
interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

function CollapsibleSection({ title, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="collapsible-section">
      <div className="collapsible-header" onClick={() => setIsOpen(!isOpen)}>
        <h3>{title}</h3>
        <span className="collapsible-toggle">{isOpen ? "-" : "+"}</span>
      </div>
      {isOpen && <div className="collapsible-content">{children}</div>}
    </div>
  );
}

export default function WalletPage() {
  // Token balances and error/confetti states
  const [casinoChips, setCasinoChips] = useState("Loading...");
  const [withdrawTokens, setWithdrawTokens] = useState("Loading...");
  const [isBuying, setIsBuying] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [processingChip, setProcessingChip] = useState<number | null>(null);
  const [purchaseSuccessful, setPurchaseSuccessful] = useState(false);

  // Purchase confirmation data
  const [purchaseConfirmationData, setPurchaseConfirmationData] = useState<{ prevCasino: number; newCasino: number } | null>(null);
  const [prevCasino, setPrevCasino] = useState<number>(0);

  // Conversion popup state
  const [showConvertPopup, setShowConvertPopup] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [selectedPercentage, setSelectedPercentage] = useState<number | null>(null);

  // Additional popups for conversion processing and confirmation
  const [showProcessingPopup, setShowProcessingPopup] = useState(false);
  const [showConfirmationPopup, setShowConfirmationPopup] = useState(false);
  const [customBuyAmount, setCustomBuyAmount] = useState(50);
  const [confirmationData, setConfirmationData] = useState<{
    prevCasino: number;
    newCasino: number;
    prevWithdraw: number;
    newWithdraw: number;
  } | null>(null);

  // Booster state – available booster can be used only once per day.
  const [booster, setBooster] = useState<{ boosterValue: number; createdAt: string } | null>(null);
  const [boosterFlash, setBoosterFlash] = useState("");

  // Dimensions for Confetti (client-only)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Predefined buy options.
  // For bundles (1000 & 5000 chips), add baseBonus of 10%.
  const pricingTiers = [
    { chips: 50, price: 75, bundle: false },
    { chips: 100, price: 149, bundle: false },
    { chips: 500, price: 725, bundle: false },
    { chips: 1000, price: 1399, bundle: true, baseBonus: 10 },
    { chips: 5000, price: 6750, bundle: true, baseBonus: 10 },
  ];

  const fetchTokenCounts = async () => {
    if (typeof window === "undefined") return;
    const chatId = sessionStorage.getItem("chat_id");
    if (!chatId) {
      console.error("Chat ID not found in sessionStorage.");
      return;
    }
    try {
      const response = await fetch(`/api/get-token-counts?chatId=${chatId}`);
      if (response.ok) {
        const { tokenCounts } = await response.json();
        setCasinoChips(tokenCounts.casino_chips || 0);
        setWithdrawTokens(tokenCounts.withdraw_tokens || 0);
        const updatedTokens = [
          { id: 1, image: "/images/token1.png", count: tokenCounts.casino_chips || 0 },
          { id: 2, image: "/images/token2.png", count: tokenCounts.withdraw_tokens || 0 },
          { id: 3, image: "/images/token3.png", count: tokenCounts.hol_tokens || 0 },
        ];
        sessionStorage.setItem("tokens", JSON.stringify(updatedTokens));
      } else {
        console.error("Failed to fetch token counts.");
      }
    } catch (error) {
      console.error("Error fetching token counts:", error);
    }
  };

  // Booster fetching from API
  const fetchBooster = async () => {
    const chatId = sessionStorage.getItem("chat_id");
    if (!chatId) return;
    try {
      const response = await fetch(`/api/get-booster?chatId=${chatId}`);
      if (response.ok) {
        const data = await response.json();
        setBooster(data.booster || null);
      } else {
        console.error("Failed to fetch booster info");
      }
    } catch (error) {
      console.error("Error fetching booster info:", error);
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    }
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      console.log("📩 Received message:", event.data);
      if (event.data && event.data.type === "update_tokens") {
        sessionStorage.setItem("tokens", JSON.stringify(event.data.tokens));
        setProcessingChip(null);
        // Assuming event.data.tokens is an array where index 0 holds casino chips.
        const newCasino = event.data.tokens[0]?.count || 0;
        // Set purchase confirmation data using previous and new balances.
        setPurchaseConfirmationData({ prevCasino, newCasino });
        setPurchaseSuccessful(true);
        setTimeout(() => setPurchaseSuccessful(false), 4000);
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("message", handleMessage);
    }
    fetchTokenCounts();
    fetchBooster();
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("message", handleMessage);
      }
    };
  }, [prevCasino]);

  const handleBuy = async (amount: number, packageType: string = "Tier", chipsBought: number = amount) => {
    if (amount < 50) {
      setErrorMessage("Minimum purchase amount is 50 tokens.");
      setTimeout(() => setErrorMessage(""), 4000);
      return;
    }
    // Store current casino balance as previous balance before purchase.
    setPrevCasino(Number(casinoChips));
    setIsBuying(true);
    setProcessingChip(amount);
    try {
      const chatId = sessionStorage.getItem("chat_id");
      const response = await fetch(`/api/create-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, amount, packageType, chipsBought }),
      });
      if (response.ok) {
        const { invoiceLink } = await response.json();
        if (typeof window !== "undefined" && window.Telegram?.WebApp) {
          window.Telegram.WebApp.openLink(invoiceLink);
          // If a booster was available, mark it as used and show flash message.
          if (booster) {
            setBooster(null);
            setBoosterFlash("Booster applied: Extra bonus chips added (valid only today)!");
            setTimeout(() => setBoosterFlash(""), 4000);
          }
          // Instead of relying solely on update_tokens message, use a timeout as a fallback
          setTimeout(() => {
            fetchTokenCounts().then(() => {
              // Retrieve new casino balance from session storage.
              const tokens = JSON.parse(sessionStorage.getItem("tokens") || "[]");
              const newCasino = tokens[0]?.count || 0;
              setPurchaseConfirmationData({ prevCasino, newCasino });
              setPurchaseSuccessful(true);
              setTimeout(() => setPurchaseSuccessful(false), 4000);
            });
          }, 5000);
        } else {
          console.error("Telegram WebApp is not available.");
        }
      } else {
        console.error("Failed to create invoice.");
        setProcessingChip(null);
      }
    } catch (error) {
      console.error("Error handling purchase:", error);
      setProcessingChip(null);
    } finally {
      setIsBuying(false);
    }
  };

  const handleSubmitConversion = async () => {
    if (!selectedPercentage) return;
    setIsConverting(true);
    const prevCasinoConversion = Number(casinoChips);
    const prevWithdraw = Number(withdrawTokens);
    setShowConvertPopup(false);
    setShowProcessingPopup(true);
    try {
      const chatId = sessionStorage.getItem("chat_id");
      const response = await fetch(`/api/convert-tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, percentage: selectedPercentage }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setCasinoChips(data.newCasinoChips);
          setWithdrawTokens(data.newWithdrawTokens);
          const updatedTokens = [
            { id: 1, image: "/images/token1.png", count: data.newCasinoChips },
            { id: 2, image: "/images/token2.png", count: data.newWithdrawTokens },
            { id: 3, image: "/images/token3.png", count: 0 },
          ];
          sessionStorage.setItem("tokens", JSON.stringify(updatedTokens));
          setConfirmationData({
            prevCasino: prevCasinoConversion,
            newCasino: data.newCasinoChips,
            prevWithdraw,
            newWithdraw: data.newWithdrawTokens,
          });
          setTimeout(() => {
            setShowProcessingPopup(false);
            setShowConfirmationPopup(true);
          }, 1500);
          setSelectedPercentage(null);
          fetchTokenCounts();
        }
      } else {
        const errorData = await response.json();
        setErrorMessage(errorData.error || "Conversion failed");
        setTimeout(() => setErrorMessage(""), 4000);
        setShowProcessingPopup(false);
      }
    } catch (error) {
      console.error("Error converting tokens:", error);
      setShowProcessingPopup(false);
    } finally {
      setIsConverting(false);
    }
  };

  // Explicitly typed closePopup function
  const closePopup = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    if (e.target === e.currentTarget) {
      setShowConvertPopup(false);
      setSelectedPercentage(null);
    }
  };

  return (
    <div className="wallet-page">
      {purchaseSuccessful && (
        <>
          <Confetti
            numberOfPieces={150}
            recycle={false}
            gravity={0.3}
            initialVelocityX={{ min: 5, max: 15 }}
            initialVelocityY={{ min: -10, max: -5 }}
            colors={["#ffcc00", "#ff0066", "#00ccff", "#66ff66"]}
            wind={0}
            width={dimensions.width}
            height={dimensions.height}
            confettiSource={{ x: 0, y: dimensions.height / 2, w: 10, h: 10 }}
          />
          <Confetti
            numberOfPieces={150}
            recycle={false}
            gravity={0.3}
            initialVelocityX={{ min: -15, max: -5 }}
            initialVelocityY={{ min: -10, max: -5 }}
            colors={["#ffcc00", "#ff0066", "#00ccff", "#66ff66"]}
            wind={0}
            width={dimensions.width}
            height={dimensions.height}
            confettiSource={{ x: dimensions.width, y: dimensions.height / 2, w: 10, h: 10 }}
          />
        </>
      )}

      {/* Collapsible Panels */}
      <CollapsibleSection title="Booster Info" defaultOpen={true}>
        {booster ? (
          <div className="booster-banner">
            <p>
              Booster Available: Extra {booster.boosterValue || 25}% bonus chips! (Valid only today)
            </p>
          </div>
        ) : (
          <p>No active booster.</p>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Conversion">
        {Number(withdrawTokens) >= 10 ? (
          <div className="conversion-section">
            <h3>Convert Withdrawable Tokens to Casino Chips</h3>
            <p>
              You have <strong>{withdrawTokens}</strong> withdrawable tokens.
            </p>
            <div className="conversion-header">
              <img src="/images/token2.png" alt="Withdrawable Token" className="header-image" />
              <span className="conversion-arrow">&#8594; 1:1 &#8594;</span>
              <img src="/images/token1.png" alt="Casino Chip" className="header-image" />
            </div>
            <button className="convert-button" onClick={() => setShowConvertPopup(true)}>
              Convert Tokens
            </button>
          </div>
        ) : (
          <p>You need at least 10 withdrawable tokens to convert.</p>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Buy Casino Chips">
        <div className="buy-chips">
          <h3>Buy Casino Chips with Telegram Stars 🌟</h3>
          {errorMessage && <div className="error-message">{errorMessage}</div>}
          <div className="predefined-options">
            {pricingTiers.map(({ chips, price, bundle, baseBonus }, index) => {
              let extraBonus = 0;
              if (bundle) {
                // For bundles, add base bonus of 10% plus any booster bonus.
                const base = Math.floor(chips * (baseBonus as number) / 100);
                if (booster) {
                  const boosterPercentage = booster.boosterValue || 25;
                  extraBonus = Math.floor(chips * ((baseBonus as number) + boosterPercentage) / 100);
                } else {
                  extraBonus = base;
                }
              } else {
                if (booster) {
                  const boosterPercentage = booster.boosterValue || 25;
                  extraBonus = Math.floor(chips * boosterPercentage / 100);
                }
              }
              const totalChips = chips + extraBonus;
              return (
                <button
                  key={index}
                  className="buy-button"
                  onClick={() => handleBuy(price, "Tier", totalChips)}
                  disabled={isBuying && processingChip === price}
                >
                  {processingChip === price
                    ? "Processing..."
                    : `${chips} Chips${extraBonus > 0 ? ` + ${extraBonus} Bonus` : ""} 🌟 ${price} Stars`}
                </button>
              );
            })}
          </div>
          <div className="custom-buy">
            <input
              type="number"
              min="50"
              value={customBuyAmount}
              onChange={(e) => setCustomBuyAmount(Number(e.target.value))}
              placeholder="Custom amount (min 50)"
            />
            <button
              className="buy-button custom"
              onClick={() =>
                handleBuy(
                  customBuyAmount,
                  "Normal",
                  booster
                    ? Math.floor(customBuyAmount + customBuyAmount * (booster.boosterValue || 25) / 100)
                    : customBuyAmount
                )
              }
            >
              Buy
            </button>
          </div>
          {boosterFlash && <div className="booster-flash">{boosterFlash}</div>}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Withdraw Tokens">
        <div className="withdrawal">
          <h3>Withdraw Tokens</h3>
          <p>
            Withdrawable tokens can be exchanged for Stars. Each token earns <strong>1.4 Stars</strong>. A 5%
            withdrawal fee applies.
          </p>
          <button className="withdraw-button">Request Withdrawal</button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Token Info">
        <div className="description">
          <div className="description-item">
            <img src="/images/token1.png" alt="Casino Chips" />
            <div className="description-content">
              <h2>Casino Chips</h2>
              <p>Your primary gaming currency. Use these to play games.</p>
            </div>
          </div>
          <div className="description-item">
            <img src="/images/token2.png" alt="Withdrawable Tokens" />
            <div className="description-content">
              <h2>Withdrawable Tokens</h2>
              <p>Earned by winning games. Redeem them for rewards.</p>
            </div>
          </div>
          <div className="description-item">
            <img src="/images/token3.png" alt="HOL Tokens" />
            <div className="description-content">
              <h2>HOL Tokens</h2>
              <p>Your leaderboard rank and rewards in the House of Luck.</p>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* Conversion Popup */}
      {showConvertPopup && (
        <div className="popup" onClick={closePopup}>
          <div className="popup-content">
            <div
              className="popup-close"
              onClick={() => {
                setShowConvertPopup(false);
                setSelectedPercentage(null);
              }}
            >
              &#x2715;
            </div>
            <h3>Select Conversion Percentage</h3>
            <div className="conversion-options">
              <button
                className={`convert-option ${selectedPercentage === 25 ? "selected" : ""}`}
                onClick={() => setSelectedPercentage(25)}
                disabled={isConverting}
              >
                25%
              </button>
              <button
                className={`convert-option ${selectedPercentage === 50 ? "selected" : ""}`}
                onClick={() => setSelectedPercentage(50)}
                disabled={isConverting}
              >
                50%
              </button>
              <button
                className={`convert-option ${selectedPercentage === 75 ? "selected" : ""}`}
                onClick={() => setSelectedPercentage(75)}
                disabled={isConverting}
              >
                75%
              </button>
              <button
                className={`convert-option ${selectedPercentage === 100 ? "selected" : ""}`}
                onClick={() => setSelectedPercentage(100)}
                disabled={isConverting}
              >
                100%
              </button>
            </div>
            <button
              className="convert-submit"
              onClick={handleSubmitConversion}
              disabled={!selectedPercentage || isConverting}
            >
              Submit
            </button>
          </div>
        </div>
      )}

      {/* Processing Popup */}
      {showProcessingPopup && (
        <div className="popup" onClick={() => setShowProcessingPopup(false)}>
          <div className="popup-content processing-popup">
            <div className="popup-close" onClick={() => setShowProcessingPopup(false)}>
              &#x2715;
            </div>
            <h3>Processing Conversion...</h3>
            <div className="conversion-header">
              <img src="/images/token2.png" alt="Withdrawable Token" className="header-image" />
              <span className="conversion-arrow">&#8594; 1:1 &#8594;</span>
              <img src="/images/token1.png" alt="Casino Chip" className="header-image" />
            </div>
            <p>Please wait while we process your conversion.</p>
          </div>
        </div>
      )}

      {/* Confirmation Popup for Conversion */}
      {showConfirmationPopup && confirmationData && (
        <div className="popup" onClick={() => setShowConfirmationPopup(false)}>
          <div className="popup-content confirmation-popup">
            <div className="popup-close" onClick={() => setShowConfirmationPopup(false)}>
              &#x2715;
            </div>
            <h3>Conversion Successful!</h3>
            <p className="conversion-ratio">Conversion Ratio: 1:1</p>
            <p>
              Casino Chips: {confirmationData.prevCasino} → {confirmationData.newCasino}
            </p>
            <p>
              Withdrawable Tokens: {confirmationData.prevWithdraw} → {confirmationData.newWithdraw}
            </p>
          </div>
        </div>
      )}

      {/* Purchase Confirmation Popup */}
      {purchaseConfirmationData && (
        <div className="popup" onClick={() => setPurchaseConfirmationData(null)}>
          <div className="popup-content confirmation-popup">
            <div className="popup-close" onClick={() => setPurchaseConfirmationData(null)}>
              &#x2715;
            </div>
            <h3>Purchase Successful!</h3>
            <p>
              Casino Chips: {purchaseConfirmationData.prevCasino} → {purchaseConfirmationData.newCasino}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
