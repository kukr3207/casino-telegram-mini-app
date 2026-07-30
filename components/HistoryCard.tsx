"use client";

import { useState } from "react";

import type { GameHistoryRecord } from "../lib/domain/game-history";
import { gameHistoryLabel } from "../lib/domain/game-history";
import type { VerificationResult } from "../lib/security/fairness-verifier";

import styles from "../app/history/history.module.css";

interface HistoryCardProps {
  record: GameHistoryRecord;
  verification?: VerificationResult;
  onVerify: (record: GameHistoryRecord) => Promise<void>;
}

function compact(value: string, visible = 10): string {
  if (value.length <= visible * 2 + 1) return value;
  return `${value.slice(0, visible)}…${value.slice(-visible)}`;
}

function playedAtLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function proofPayload(record: GameHistoryRecord): Record<string, unknown> {
  if (record.game === "dice") {
    return {
      game: record.game,
      seed: record.seed,
      hash: record.hash,
      dice1: record.dice1,
      dice2: record.dice2,
    };
  }
  return {
    game: record.game,
    seed: record.seed,
    hash: record.hash,
    outcomeIndex: record.outcomeIndex,
    outcome: record.outcome,
  };
}

export default function HistoryCard({
  record,
  verification,
  onVerify,
}: HistoryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [verifying, setVerifying] = useState(false);

  const verify = async () => {
    setVerifying(true);
    try {
      await onVerify(record);
    } finally {
      setVerifying(false);
    }
  };

  const copyProof = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(proofPayload(record), null, 2));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1800);
  };

  return (
    <article className={styles.historyCard}>
      <div className={styles.cardHeading}>
        <div className={styles.gameIdentity}>
          <span className={styles.gameIcon} aria-hidden="true">
            {record.game === "dice" ? "🎲" : "🎡"}
          </span>
          <div>
            <h2>{gameHistoryLabel(record)}</h2>
            <time dateTime={record.playedAt}>{playedAtLabel(record.playedAt)}</time>
          </div>
        </div>
        <span
          className={`${styles.statusBadge} ${
            verification?.valid
              ? styles.verified
              : verification
                ? styles.invalid
                : styles.unchecked
          }`}
        >
          {verification?.valid ? "Verified" : verification ? "Mismatch" : "Unchecked"}
        </span>
      </div>

      <div className={styles.resultGrid}>
        {record.game === "dice" ? (
          <>
            <div>
              <span>First die</span>
              <strong>{record.dice1}</strong>
            </div>
            <div>
              <span>Second die</span>
              <strong>{record.dice2}</strong>
            </div>
            <div>
              <span>Total</span>
              <strong>{record.total}</strong>
            </div>
          </>
        ) : (
          <>
            <div>
              <span>Prize type</span>
              <strong>{record.outcome.type === "token" ? "Chips" : "Booster"}</strong>
            </div>
            <div>
              <span>Value</span>
              <strong>{record.outcome.value}</strong>
            </div>
            <div>
              <span>Segment</span>
              <strong>#{record.outcomeIndex + 1}</strong>
            </div>
          </>
        )}
      </div>

      <button
        type="button"
        className={styles.disclosure}
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span>Fairness proof</span>
        <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>

      {expanded && (
        <div className={styles.proofPanel}>
          <dl>
            <div>
              <dt>Seed</dt>
              <dd title={record.seed}>{compact(record.seed)}</dd>
            </div>
            <div>
              <dt>Commitment</dt>
              <dd title={record.hash}>{compact(record.hash)}</dd>
            </div>
            <div>
              <dt>Record ID</dt>
              <dd title={record.id}>{compact(record.id, 8)}</dd>
            </div>
          </dl>

          {verification && (
            <p className={verification.valid ? styles.proofSuccess : styles.proofFailure}>
              {verification.message}
            </p>
          )}

          <div className={styles.proofActions}>
            <button type="button" onClick={verify} disabled={verifying}>
              {verifying ? "Verifying…" : "Verify result"}
            </button>
            <button type="button" onClick={copyProof}>
              {copyState === "copied"
                ? "Copied"
                : copyState === "failed"
                  ? "Copy failed"
                  : "Copy proof"}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

