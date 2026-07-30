"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import HistoryCard from "../../components/HistoryCard";
import type {
  GameHistoryRecord,
  GameKind,
  HistoryPage,
  HistorySummary,
} from "../../lib/domain/game-history";
import type { VerificationResult } from "../../lib/security/fairness-verifier";

import styles from "./history.module.css";

type Filter = GameKind | "all";

const EMPTY_SUMMARY: HistorySummary = {
  totalGames: 0,
  diceRolls: 0,
  wheelSpins: 0,
  verifiedGames: 0,
  tokenPrizes: 0,
  boosterPrizes: 0,
};

function verificationPayload(record: GameHistoryRecord): Record<string, unknown> {
  if (record.game === "dice") {
    return {
      game: "dice",
      seed: record.seed,
      hash: record.hash,
      dice1: record.dice1,
      dice2: record.dice2,
    };
  }
  return {
    game: "wheel",
    seed: record.seed,
    hash: record.hash,
    outcomeIndex: record.outcomeIndex,
    outcome: record.outcome,
  };
}

function appendUnique(
  current: readonly GameHistoryRecord[],
  incoming: readonly GameHistoryRecord[],
): GameHistoryRecord[] {
  const byId = new Map(current.map((record) => [record.id, record]));
  for (const record of incoming) byId.set(record.id, record);
  return [...byId.values()].sort(
    (left, right) => Date.parse(right.playedAt) - Date.parse(left.playedAt),
  );
}

export default function HistoryPage() {
  const [records, setRecords] = useState<GameHistoryRecord[]>([]);
  const [summary, setSummary] = useState<HistorySummary>(EMPTY_SUMMARY);
  const [filter, setFilter] = useState<Filter>("all");
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [verifications, setVerifications] = useState<
    Record<string, VerificationResult>
  >({});

  const loadHistory = useCallback(
    async (selectedFilter: Filter, before?: string) => {
      const chatId = sessionStorage.getItem("chat_id");
      if (!chatId) {
        setError("Open this page inside Telegram so your player ID is available.");
        setLoading(false);
        return;
      }

      before ? setLoadingMore(true) : setLoading(true);
      setError("");
      const params = new URLSearchParams({
        chatId,
        game: selectedFilter,
        limit: "20",
      });
      if (before) params.set("before", before);

      try {
        const response = await fetch(`/api/game-history?${params}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as HistoryPage & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Game history could not be loaded");

        setRecords((current) =>
          before ? appendUnique(current, payload.records) : payload.records,
        );
        setSummary((current) =>
          before
            ? {
                totalGames: current.totalGames + payload.summary.totalGames,
                diceRolls: current.diceRolls + payload.summary.diceRolls,
                wheelSpins: current.wheelSpins + payload.summary.wheelSpins,
                verifiedGames: current.verifiedGames + payload.summary.verifiedGames,
                tokenPrizes: current.tokenPrizes + payload.summary.tokenPrizes,
                boosterPrizes: current.boosterPrizes + payload.summary.boosterPrizes,
              }
            : payload.summary,
        );
        setNextBefore(payload.nextBefore);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Game history could not be loaded");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadHistory(filter);
  }, [filter, loadHistory]);

  const verify = async (record: GameHistoryRecord) => {
    const response = await fetch("/api/verify-game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(verificationPayload(record)),
    });
    const result = (await response.json()) as Partial<VerificationResult> & { error?: string };
    const verification: VerificationResult =
      typeof result.valid === "boolean" &&
      typeof result.code === "string" &&
      typeof result.message === "string"
        ? (result as VerificationResult)
        : {
            valid: false,
            code: "invalid_outcome",
            message: result.error || "Verification request failed.",
          };
    setVerifications((current) => ({ ...current, [record.id]: verification }));
  };

  const emptyMessage = useMemo(() => {
    if (filter === "dice") return "No saved dice rolls yet.";
    if (filter === "wheel") return "No saved wheel spins yet.";
    return "Play a dice or wheel game and its fairness proof will appear here.";
  }, [filter]);

  return (
    <section className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>Provably fair play</p>
        <h1>Game history</h1>
        <p>
          Review saved outcomes and independently verify that each result matches
          its cryptographic seed and commitment.
        </p>
      </header>

      <div className={styles.summaryGrid} aria-label="History summary">
        <div><span>Games shown</span><strong>{summary.totalGames}</strong></div>
        <div><span>Dice rolls</span><strong>{summary.diceRolls}</strong></div>
        <div><span>Wheel spins</span><strong>{summary.wheelSpins}</strong></div>
        <div><span>Verified</span><strong>{summary.verifiedGames}</strong></div>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.filters} role="group" aria-label="Filter game history">
          {(["all", "dice", "wheel"] as const).map((option) => (
            <button
              type="button"
              key={option}
              className={filter === option ? styles.activeFilter : ""}
              aria-pressed={filter === option}
              onClick={() => {
                setRecords([]);
                setSummary(EMPTY_SUMMARY);
                setNextBefore(null);
                setFilter(option);
              }}
            >
              {option === "all" ? "All games" : option === "dice" ? "Dice" : "Wheel"}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.refresh}
          onClick={() => void loadHistory(filter)}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      {error && <div className={styles.errorBanner}>{error}</div>}

      {loading ? (
        <div className={styles.emptyState}>Loading game history…</div>
      ) : records.length === 0 ? (
        <div className={styles.emptyState}>{emptyMessage}</div>
      ) : (
        <div className={styles.historyList}>
          {records.map((record) => (
            <HistoryCard
              key={record.id}
              record={record}
              verification={verifications[record.id]}
              onVerify={verify}
            />
          ))}
        </div>
      )}

      {nextBefore && (
        <button
          type="button"
          className={styles.loadMore}
          onClick={() => void loadHistory(filter, nextBefore)}
          disabled={loadingMore}
        >
          {loadingMore ? "Loading…" : "Load older games"}
        </button>
      )}
    </section>
  );
}
