import { BurnAll } from "@/components/burn-all";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      {/* Top nav */}
      <nav
        className="flex items-center justify-between px-12 py-5"
        style={{ borderBottom: "1px solid var(--line)" }}
      >
        <span
          className="font-mono text-xs tracking-widest"
          style={{ color: "var(--text-hi)" }}
        >
          BURNER
        </span>
        <span
          className="font-mono text-[10px] tracking-widest"
          style={{ color: "var(--muted)" }}
        >
          DEVNET
        </span>
      </nav>

      {/* Main */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-md space-y-10">
          {/* Header */}
          <div className="space-y-3">
            <div
              className="font-mono text-[11px] tracking-widest"
              style={{ color: "var(--muted)" }}
            >
              TOKEN BURNER
            </div>
            <h1
              className="text-[32px] font-light leading-tight"
              style={{
                letterSpacing: "-0.03em",
                color: "var(--text-hi)",
              }}
            >
              Burn everything (on devnet 🤓)
            </h1>
            <p
              className="text-sm leading-relaxed"
              style={{ color: "var(--text-dim)", maxWidth: "38ch" }}
            >
              Tired of having 100,000 random tokens cluttering your devnet wallet? Finally a clean burner for Solana devs.
            </p>
          </div>

          {/* Burn component */}
          <BurnAll />
        </div>
      </main>

      {/* Footer */}
      <footer
        className="flex items-center justify-between px-12 py-4 font-mono text-[11px] tracking-widest"
        style={{
          borderTop: "1px solid var(--line)",
          color: "var(--muted)",
        }}
      >
        <span>SOLANA DEVNET</span>
        <span>v1</span>
      </footer>
    </div>
  );
}
