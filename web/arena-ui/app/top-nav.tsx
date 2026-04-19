"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const baseStyle = {
  padding: "6px 14px",
  borderRadius: 999,
  fontSize: "0.82rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase" as const,
  textDecoration: "none",
  transition: "all 140ms ease",
};

function navStyle(active: boolean) {
  if (active) {
    return {
      ...baseStyle,
      color: "var(--alpha)",
      background: "rgba(25,225,255,0.08)",
      border: "1px solid rgba(25,225,255,0.22)",
      boxShadow: "inset 0 0 0 1px rgba(127, 226, 255, 0.08)",
    };
  }

  return {
    ...baseStyle,
    color: "var(--muted)",
    border: "1px solid transparent",
    opacity: 0.72,
  };
}

export function TopNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const replayActive = pathname === "/";
  const arenaActive = pathname.startsWith("/arena");
  const mapsActive = pathname.startsWith("/maps");
  const rulesActive = pathname.startsWith("/rules");
  const botsActive = pathname.startsWith("/bots");

  // preserve query params (e.g. ?token=xxx) across navigation
  const qs = searchParams.toString();
  const suffix = qs ? `?${qs}` : "";

  return (
    <nav
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        display: "flex",
        gap: 8,
        padding: "12px 28px",
        background: "rgba(6,14,24,0.88)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(118,155,196,0.14)",
      }}
    >
      <Link href={`/arena${suffix}`} style={navStyle(arenaActive)}>
        排行榜
      </Link>
      <Link href={`/maps${suffix}`} style={navStyle(mapsActive)}>
        地图
      </Link>
      <Link href={`/${suffix}`} style={navStyle(replayActive)}>
        回放
      </Link>
      <Link href={`/bots${suffix}`} style={navStyle(botsActive)}>
        数据面板
      </Link>
      <Link href={`/rules${suffix}`} style={rulesActive ? navStyle(true) : { ...navStyle(false), color: "var(--gold)", opacity: 1, border: "1px solid rgba(255,215,0,0.3)", background: "rgba(255,215,0,0.06)" }}>
        游戏说明
      </Link>
    </nav>
  );
}
