import type { DiceProof, WheelProof } from "../../../lib/security/fairness-verifier";
import { verifyGameProof } from "../../../lib/security/fairness-verifier";
import { jsonError, jsonResponse, readJsonObject } from "../../../lib/http/responses";

function gameKind(value: unknown): "dice" | "wheel" {
  if (value === "dice" || value === "wheel") return value;
  throw new TypeError("game must be 'dice' or 'wheel'");
}

function diceProof(body: Record<string, unknown>): DiceProof {
  return {
    seed: String(body.seed ?? ""),
    hash: String(body.hash ?? ""),
    dice1: Number(body.dice1),
    dice2: Number(body.dice2),
  };
}

function wheelProof(body: Record<string, unknown>): WheelProof {
  return {
    seed: String(body.seed ?? ""),
    hash: String(body.hash ?? ""),
    outcomeIndex: Number(body.outcomeIndex),
    outcome: body.outcome as WheelProof["outcome"],
  };
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonObject(request);
    const game = gameKind(body.game);
    const proof = game === "dice" ? diceProof(body) : wheelProof(body);
    const result = verifyGameProof(game, proof);
    return jsonResponse({ game, ...result }, result.valid ? 200 : 422);
  } catch (error) {
    if (error instanceof TypeError) {
      return jsonError(error.message, 400, "invalid_request");
    }
    console.error("Error verifying game proof:", error);
    return jsonError("Unable to verify game proof", 500, "verification_unavailable");
  }
}

