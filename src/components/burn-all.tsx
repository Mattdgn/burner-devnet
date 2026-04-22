"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, Transaction } from "@solana/web3.js";
import type { Connection, AccountInfo } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  MintLayout,
  createBurnInstruction,
  createCloseAccountInstruction,
  AccountLayout,
} from "@solana/spl-token";
import { useCallback, useEffect, useState } from "react";

const METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

interface TokenAccount {
  pubkey: PublicKey;
  mint: PublicKey;
  amount: bigint;
  programId: PublicKey;
  name?: string;
  symbol?: string;
  decimals: number;
}

function getMetadataPDA(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    METADATA_PROGRAM_ID
  );
  return pda;
}

function parseMetadata(data: Buffer): { name: string; symbol: string } {
  let offset = 1 + 32 + 32; // key + update_authority + mint
  const nameLen = data.readUInt32LE(offset);
  offset += 4;
  const name = data
    .subarray(offset, offset + nameLen)
    .toString("utf8")
    .replace(/\0/g, "")
    .trim();
  offset += nameLen;
  const symbolLen = data.readUInt32LE(offset);
  offset += 4;
  const symbol = data
    .subarray(offset, offset + symbolLen)
    .toString("utf8")
    .replace(/\0/g, "")
    .trim();
  return { name, symbol };
}

function formatAmount(amount: bigint, decimals: number): string {
  if (amount === 0n) return "0";
  const str = amount.toString().padStart(decimals + 1, "0");
  const intPart = str.slice(0, str.length - decimals) || "0";
  if (decimals === 0) return intPart;
  const decPart = str.slice(str.length - decimals).replace(/0+$/, "");
  return decPart ? `${intPart}.${decPart}` : intPart;
}

async function batchFetch(
  connection: Connection,
  keys: PublicKey[]
): Promise<(AccountInfo<Buffer> | null)[]> {
  const results: (AccountInfo<Buffer> | null)[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    const batch = keys.slice(i, i + 100);
    const res = await connection.getMultipleAccountsInfo(batch);
    results.push(...res);
  }
  return results;
}

export function BurnAll() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [tokens, setTokens] = useState<TokenAccount[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const toggleOne = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === tokens.length) return new Set();
      return new Set(tokens.map((t) => t.pubkey.toString()));
    });
  }, [tokens]);

  const fetchTokens = useCallback(async () => {
    if (!publicKey) return;
    setStatus("Scanning...");
    setTokens([]);
    setSelected(new Set());

    const [splAccounts, token2022Accounts] = await Promise.all([
      connection.getTokenAccountsByOwner(publicKey, {
        programId: TOKEN_PROGRAM_ID,
      }),
      connection.getTokenAccountsByOwner(publicKey, {
        programId: TOKEN_2022_PROGRAM_ID,
      }),
    ]);

    const parse = (
      items: typeof splAccounts.value,
      programId: PublicKey
    ) =>
      items.map((item) => {
        const data = AccountLayout.decode(item.account.data);
        return {
          pubkey: item.pubkey,
          mint: data.mint,
          amount: data.amount,
          programId,
          decimals: 0,
        };
      });

    const all: TokenAccount[] = [
      ...parse(splAccounts.value, TOKEN_PROGRAM_ID),
      ...parse(token2022Accounts.value, TOKEN_2022_PROGRAM_ID),
    ];

    if (all.length === 0) {
      setStatus("No token accounts found.");
      return;
    }

    // Fetch metadata + decimals
    setStatus("Fetching metadata...");
    const uniqueMints = [...new Set(all.map((t) => t.mint.toString()))];
    const mintKeys = uniqueMints.map((m) => new PublicKey(m));
    const metaPDAs = mintKeys.map(getMetadataPDA);

    const [mintInfos, metaInfos] = await Promise.all([
      batchFetch(connection, mintKeys),
      batchFetch(connection, metaPDAs),
    ]);

    const decimalsMap = new Map<string, number>();
    const metaMap = new Map<string, { name: string; symbol: string }>();

    mintInfos.forEach((acc, i) => {
      if (acc) {
        const decoded = MintLayout.decode(acc.data);
        decimalsMap.set(uniqueMints[i], decoded.decimals);
      }
    });

    metaInfos.forEach((acc, i) => {
      if (acc) {
        try {
          metaMap.set(uniqueMints[i], parseMetadata(acc.data as Buffer));
        } catch {
          // metadata parse failed, skip
        }
      }
    });

    const enriched = all.map((t) => {
      const mintStr = t.mint.toString();
      const meta = metaMap.get(mintStr);
      return {
        ...t,
        decimals: decimalsMap.get(mintStr) ?? 0,
        name: meta?.name,
        symbol: meta?.symbol,
      };
    });

    setTokens(enriched);
    setSelected(new Set(enriched.map((t) => t.pubkey.toString())));
    setStatus(
      `${enriched.length} token account${enriched.length > 1 ? "s" : ""} found.`
    );
  }, [publicKey, connection]);

  const burnSelected = useCallback(async () => {
    if (!publicKey || selected.size === 0) return;
    setLoading(true);

    const toBurn = tokens.filter((t) => selected.has(t.pubkey.toString()));

    try {
      const batchSize = 5;
      const batches: TokenAccount[][] = [];
      for (let i = 0; i < toBurn.length; i += batchSize) {
        batches.push(toBurn.slice(i, i + batchSize));
      }

      for (let i = 0; i < batches.length; i++) {
        const tx = new Transaction();
        for (const token of batches[i]) {
          if (token.amount > 0n) {
            tx.add(
              createBurnInstruction(
                token.pubkey, token.mint, publicKey,
                token.amount, [], token.programId
              )
            );
          }
          tx.add(
            createCloseAccountInstruction(
              token.pubkey, publicKey, publicKey,
              [], token.programId
            )
          );
        }
        setStatus(`Tx ${i + 1}/${batches.length} — approve in wallet...`);
        const sig = await sendTransaction(tx, connection);
        setStatus(`Tx ${i + 1}/${batches.length} — confirming...`);
        await connection.confirmTransaction(sig, "confirmed");
      }

      setStatus(
        `Done. ${toBurn.length} account${toBurn.length > 1 ? "s" : ""} burned & closed.`
      );
      setTokens((prev) =>
        prev.filter((t) => !selected.has(t.pubkey.toString()))
      );
      setSelected(new Set());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(`Error: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [publicKey, tokens, selected, sendTransaction, connection]);

  if (!mounted) return null;

  const allSelected = tokens.length > 0 && selected.size === tokens.length;

  return (
    <div className="space-y-6">
      <WalletMultiButton />

      {publicKey && (
        <>
          <button
            onClick={fetchTokens}
            disabled={loading}
            className="w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              height: 38,
              borderRadius: "var(--r-lg)",
              border: "1px solid var(--line-2)",
              background: "transparent",
              color: "var(--text)",
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: "-0.005em",
              transition: "border-color 120ms linear",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.borderColor = "var(--muted)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.borderColor = "var(--line-2)")
            }
          >
            Scan token accounts
          </button>

          {tokens.length > 0 && (
            <div className="space-y-3">
              <div
                className="overflow-y-auto"
                style={{
                  maxHeight: 320,
                  border: "1px solid var(--line)",
                  borderRadius: "var(--r-xl)",
                  background: "var(--surface)",
                }}
              >
                <table className="w-full" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--line)" }}>
                      <th style={{ padding: "10px 12px", width: 36 }}>
                        <Checkbox checked={allSelected} onChange={toggleAll} />
                      </th>
                      <th
                        className="text-left font-normal font-mono"
                        style={{
                          padding: "10px 0",
                          fontSize: 10,
                          letterSpacing: "0.05em",
                          color: "var(--muted)",
                        }}
                      >
                        TOKEN
                      </th>
                      <th
                        className="text-right font-normal font-mono"
                        style={{
                          padding: "10px 16px",
                          fontSize: 10,
                          letterSpacing: "0.05em",
                          color: "var(--muted)",
                        }}
                      >
                        AMOUNT
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.map((t, idx) => (
                      <TokenRow
                        key={t.pubkey.toString()}
                        token={t}
                        isSelected={selected.has(t.pubkey.toString())}
                        isLast={idx === tokens.length - 1}
                        onToggle={() => toggleOne(t.pubkey.toString())}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <div
                className="flex items-center justify-between font-mono"
                style={{
                  fontSize: 11,
                  color: "var(--muted)",
                  letterSpacing: "0.02em",
                }}
              >
                <span>
                  {selected.size} / {tokens.length} selected
                </span>
                <button
                  onClick={toggleAll}
                  className="cursor-pointer"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--accent)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    letterSpacing: "0.02em",
                    padding: 0,
                  }}
                >
                  {allSelected ? "Deselect all" : "Select all"}
                </button>
              </div>

              <button
                onClick={burnSelected}
                disabled={loading || selected.size === 0}
                className="w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  height: 44,
                  borderRadius: "var(--r-lg)",
                  background: "var(--no-soft)",
                  color: "var(--no)",
                  border: "1px solid color-mix(in oklch, var(--no) 25%, transparent)",
                  fontFamily: "var(--font-sans)",
                  fontSize: 13,
                  fontWeight: 500,
                  letterSpacing: "-0.005em",
                  transition: "all 120ms linear",
                }}
                onMouseEnter={(e) => {
                  if (selected.size > 0) {
                    e.currentTarget.style.background = "var(--no)";
                    e.currentTarget.style.color = "var(--bg)";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--no-soft)";
                  e.currentTarget.style.color = "var(--no)";
                }}
              >
                {selected.size === tokens.length
                  ? "Burn all tokens"
                  : `Burn ${selected.size} token${selected.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          )}
        </>
      )}

      {status && (
        <p
          className="font-mono text-center"
          style={{
            fontSize: 11,
            letterSpacing: "0.02em",
            color: status.startsWith("Error")
              ? "var(--no)"
              : status.startsWith("Done")
                ? "var(--yes)"
                : "var(--muted)",
          }}
        >
          {status}
        </p>
      )}
    </div>
  );
}

function TokenRow({
  token,
  isSelected,
  isLast,
  onToggle,
}: {
  token: TokenAccount;
  isSelected: boolean;
  isLast: boolean;
  onToggle: () => void;
}) {
  const hasName = Boolean(token.symbol || token.name);
  return (
    <tr
      onClick={onToggle}
      className="cursor-pointer"
      style={{
        borderBottom: isLast ? "none" : "1px solid var(--line)",
        background: isSelected ? "var(--surface-2)" : "transparent",
        transition: "background 120ms linear",
      }}
    >
      <td style={{ padding: "10px 12px", width: 36 }}>
        <Checkbox checked={isSelected} onChange={onToggle} />
      </td>
      <td style={{ padding: "10px 0" }}>
        {hasName ? (
          <div>
            <span style={{ fontSize: 13, color: "var(--text-hi)" }}>
              {token.symbol || token.name}
            </span>
            <span
              className="font-mono"
              style={{
                fontSize: 10,
                color: "var(--muted)",
                marginLeft: 8,
              }}
            >
              {token.mint.toString().slice(0, 8)}...
            </span>
          </div>
        ) : (
          <span
            className="font-mono"
            style={{ fontSize: 12, color: "var(--text)" }}
          >
            {token.mint.toString().slice(0, 12)}...
          </span>
        )}
      </td>
      <td
        className="text-right font-mono"
        style={{
          padding: "10px 16px",
          fontSize: 12,
          color: token.amount > 0n ? "var(--text-hi)" : "var(--muted)",
          fontFeatureSettings: '"tnum"',
        }}
      >
        {formatAmount(token.amount, token.decimals)}
      </td>
    </tr>
  );
}

function Checkbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className="cursor-pointer flex items-center justify-center"
      style={{
        width: 14,
        height: 14,
        borderRadius: "var(--r-sm)",
        border: `1px solid ${checked ? "var(--accent)" : "var(--line-2)"}`,
        background: checked ? "var(--accent)" : "transparent",
        transition: "all 120ms linear",
      }}
    >
      {checked && (
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{ display: "block" }}>
          <path
            d="M1.5 4L3.2 5.7L6.5 2.3"
            stroke="var(--bg)"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}
