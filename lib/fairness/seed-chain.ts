import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const HEX_64 = /^[a-f0-9]{64}$/;

function sha256(value: string | Buffer): Buffer {
  return createHash("sha256").update(value).digest();
}

export function seedHash(seed: string): string {
  if (!HEX_64.test(seed)) throw new RangeError("server seed must be 64 lowercase hexadecimal characters");
  return sha256(Buffer.from(seed, "hex")).toString("hex");
}

export function combineSeeds(serverSeed: string, clientSeed: string, nonce: bigint | number | string): Buffer {
  if (!HEX_64.test(serverSeed)) throw new RangeError("server seed must be 64 lowercase hexadecimal characters");
  if (typeof clientSeed !== "string" || !clientSeed.trim() || clientSeed.length > 128) {
    throw new RangeError("client seed must contain from 1 to 128 characters");
  }
  const parsedNonce = BigInt(nonce);
  if (parsedNonce < 0n) throw new RangeError("nonce cannot be negative");
  return sha256(`${serverSeed}:${clientSeed.trim()}:${parsedNonce}`);
}

export function uniformInteger(
  serverSeed: string,
  clientSeed: string,
  nonce: bigint | number | string,
  upperExclusive: number,
  cursor = 0,
): number {
  if (!Number.isSafeInteger(upperExclusive) || upperExclusive <= 0 || upperExclusive > 0x100000000) {
    throw new RangeError("uniform upper bound is invalid");
  }
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new RangeError("uniform cursor cannot be negative");
  const limit = Math.floor(0x100000000 / upperExclusive) * upperExclusive;
  let block = Math.floor(cursor / 8);
  let offset = (cursor % 8) * 4;
  while (true) {
    const digest = sha256(Buffer.concat([
      combineSeeds(serverSeed, clientSeed, nonce),
      Buffer.from(`:${block}`),
    ]));
    while (offset <= digest.length - 4) {
      const value = digest.readUInt32BE(offset);
      offset += 4;
      if (value < limit) return value % upperExclusive;
    }
    block += 1;
    offset = 0;
  }
}

export interface SeedCommitment {
  chainId: string;
  commitment: string;
  serverSeed?: string;
  clientSeed: string;
  nextNonce: bigint;
  createdAt: string;
  revealedAt?: string;
}

export class SeedChain {
  readonly #chains = new Map<string, SeedCommitment>();
  readonly #secrets = new Map<string, string>();

  create(chainId: string, clientSeed: string, at: string | Date, serverSeed = randomBytes(32).toString("hex")): SeedCommitment {
    if (!chainId.trim()) throw new RangeError("seed chain id cannot be blank");
    const createdAt = new Date(at);
    if (Number.isNaN(createdAt.getTime())) throw new RangeError("seed chain creation time is invalid");
    const value: SeedCommitment = {
      chainId: chainId.trim(), commitment: seedHash(serverSeed), clientSeed: clientSeed.trim(),
      nextNonce: 0n, createdAt: createdAt.toISOString(),
    };
    const existing = this.#chains.get(value.chainId);
    if (existing) {
      if (existing.commitment === value.commitment && existing.clientSeed === value.clientSeed) return existing;
      throw new Error("seed chain id already exists");
    }
    this.#chains.set(value.chainId, value);
    this.#secrets.set(value.chainId, serverSeed);
    return value;
  }

  consume(chainId: string): { serverSeed: string; clientSeed: string; nonce: bigint; commitment: string } {
    const chain = this.get(chainId);
    if (chain.revealedAt) throw new Error("seed chain is already revealed");
    const serverSeed = this.#secrets.get(chainId)!;
    const result = { serverSeed, clientSeed: chain.clientSeed, nonce: chain.nextNonce, commitment: chain.commitment };
    this.#chains.set(chainId, { ...chain, nextNonce: chain.nextNonce + 1n });
    return result;
  }

  reveal(chainId: string, at: string | Date): SeedCommitment {
    const chain = this.get(chainId);
    if (chain.revealedAt) return chain;
    const revealedAt = new Date(at);
    if (Number.isNaN(revealedAt.getTime()) || revealedAt < new Date(chain.createdAt)) {
      throw new RangeError("seed reveal time is invalid");
    }
    const serverSeed = this.#secrets.get(chainId)!;
    const revealed = { ...chain, serverSeed, revealedAt: revealedAt.toISOString() };
    this.#chains.set(chainId, revealed);
    return revealed;
  }

  get(chainId: string): SeedCommitment {
    const value = this.#chains.get(chainId);
    if (!value) throw new Error("seed chain was not found");
    return value;
  }
}

export function verifySeedCommitment(commitment: string, serverSeed: string): boolean {
  if (!HEX_64.test(commitment) || !HEX_64.test(serverSeed)) return false;
  return timingSafeEqual(Buffer.from(commitment, "hex"), Buffer.from(seedHash(serverSeed), "hex"));
}
