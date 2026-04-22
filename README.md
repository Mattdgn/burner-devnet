# Devnet Token Burner

Burn all SPL tokens from a connected wallet on Solana **Devnet**.

## Run

```bash
pnpm install
pnpm dev
```

## What it does

1. Connect a Solana wallet (Phantom, Solflare, etc.)
2. Scan all SPL + Token-2022 accounts
3. Select tokens individually or burn all at once
4. Each token is burned then its account is closed (rent SOL recovered)

SOL is never touched — only SPL token accounts.

## Stack

Next.js 16 · TypeScript · Tailwind v4 · `@solana/wallet-adapter` · `@solana/spl-token`
