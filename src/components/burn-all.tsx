"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createBurnInstruction,
  createCloseAccountInstruction,
  AccountLayout,
} from "@solana/spl-token";
import { useCallback, useEffect, useState } from "react";

interface TokenAccount {
  pubkey: PublicKey;
  mint: PublicKey;
  amount: bigint;
  programId: PublicKey;
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
    ): TokenAccount[] =>
      items.map((item) => {
        const data = AccountLayout.decode(item.account.data);
        return {
          pubkey: item.pubkey,
          mint: data.mint,
          amount: data.amount,
          programId,
        };
      });

    const all = [
      ...parse(splAccounts.value, TOKEN_PROGRAM_ID),
      ...parse(token2022Accounts.value, TOKEN_2022_PROGRAM_ID),
    ];

    setTokens(all);
    setSelected(new Set(all.map((t) => t.pubkey.toString())));
    setStatus(
      all.length === 0
        ? "No token accounts found."
        : `${all.length} token account${all.length > 1 ? "s" : ""} found.`
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
                token.pubkey,
                token.mint,
                publicKey,
                token.amount,
                [],
                token.programId
              )
            );
          }
          tx.add(
            createCloseAccountInstruction(
              token.pubkey,
              publicKey,
              publicKey,
              [],
              token.programId
            )
          );
        }

        setStatus(
          `Tx ${i + 1}/${batches.length} — approve in wallet...`
        );
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
      {/* Connect */}
      <WalletMultiButton />

      {publicKey && (
        <>
          {/* Scan button */}
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

          {/* Token list */}
          {tokens.length > 0 && (
            <div className="space-y-3">
              <div
                className="overflow-y-auto"
                style={{
                  maxHeight: 280,
                  border: "1px solid var(--line)",
                  borderRadius: "var(--r-xl)",
                  background: "var(--surface)",
                }}
              >
                <table
                  className="w-full"
                  style={{ borderCollapse: "collapse" }}
                >
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--line)" }}>
                      <th
                        style={{ padding: "10px 12px", width: 36 }}
                      >
                        <Checkbox
                          checked={allSelected}
                          onChange={toggleAll}
                        />
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
                        MINT
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
                    {tokens.map((t, idx) => {
                      const key = t.pubkey.toString();
                      const isSelected = selected.has(key);
                      return (
                        <tr
                          key={key}
                          onClick={() => toggleOne(key)}
                          className="cursor-pointer"
                          style={{
                            borderBottom:
                              idx < tokens.length - 1
                                ? "1px solid var(--line)"
                                : "none",
                            background: isSelected
                              ? "var(--surface-2)"
                              : "transparent",
                            transition: "background 120ms linear",
                          }}
                        >
                          <td style={{ padding: "10px 12px", width: 36 }}>
                            <Checkbox
                              checked={isSelected}
                              onChange={() => toggleOne(key)}
                            />
                          </td>
                          <td
                            className="font-mono"
                            style={{
                              padding: "10px 0",
                              fontSize: 12,
                              color: "var(--text)",
                            }}
                          >
                            {t.mint.toString().slice(0, 12)}...
                          </td>
                          <td
                            className="text-right font-mono"
                            style={{
                              padding: "10px 16px",
                              fontSize: 12,
                              color:
                                t.amount > 0n
                                  ? "var(--text-hi)"
                                  : "var(--muted)",
                              fontFeatureSettings: '"tnum"',
                            }}
                          >
                            {t.amount.toString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Selection count */}
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

              {/* Burn button */}
              <button
                onClick={burnSelected}
                disabled={loading || selected.size === 0}
                className="w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  height: 44,
                  borderRadius: "var(--r-lg)",
                  background: "var(--no-soft)",
                  color: "var(--no)",
                  border:
                    "1px solid color-mix(in oklch, var(--no) 25%, transparent)",
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

      {/* Status */}
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
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          fill="none"
          style={{ display: "block" }}
        >
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
