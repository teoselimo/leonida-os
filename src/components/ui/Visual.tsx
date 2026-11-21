"use client";

import type { MediaRef } from "../../../collector/src/types";
import { Icon } from "./Icon";

/** Silhouette de palmier dessinée pour LEONIDA OS (aucune reprise d'illustration existante). */
export function Palm({ className, flip }: { className?: string; flip?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 120 200" aria-hidden style={flip ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M62 200c-3-46-1-92 8-128l5 1c-8 36-10 81-7 127z" />
      <path d="M71 70c-14-16-38-22-62-15 18 1 35 8 47 22-15-4-32-1-46 9 21-6 40-2 55 7z" />
      <path d="M72 70c4-20 21-36 45-40-15 10-25 23-29 38 9-12 21-18 32-18-17 7-28 18-34 31z" />
      <path d="M70 69c-4-19-17-33-36-40 11 11 18 24 20 38-8-8-18-12-28-12 15 6 26 15 33 26z" />
      <path d="M73 71c13-10 31-12 47-5-14 0-27 5-36 14 13-3 25 0 34 8-16-6-31-6-44 1z" />
    </svg>
  );
}

/**
 * Visuel éditorial : miniature YouTube autorisée (hébergée par YouTube, créditée) si elle existe ;
 * sinon une vignette de catégorie au dégradé sunset — jamais une fausse photo du jeu.
 */
export function Visual({ media, icon, color, label, size = "hero" }: { media: MediaRef | null; icon: string; color: string; label?: string; size?: "hero" | "thumb" }) {
  if (media) {
    return (
      <span className={`visual visual--${size}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={media.thumbnail} alt="" loading="lazy" decoding="async" />
        {size === "hero" && <span className="visual__credit">© {media.credit} · YouTube</span>}
      </span>
    );
  }
  return (
    <span className={`visual visual--${size} visual--art`} style={{ ["--c" as string]: color }} aria-label={label}>
      <span className="visual__sun" />
      <Palm className="visual__palm" />
      <Palm className="visual__palm visual__palm--2" flip />
      <span className="visual__glyph"><Icon name={icon} size={size === "hero" ? 34 : 20} stroke={1.8} /></span>
    </span>
  );
}
