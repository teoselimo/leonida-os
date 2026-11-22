"use client";

import { useId } from "react";

/**
 * Logo de marque LEONIDA (V0.11) — vectoriel, net à toute taille.
 * Une tuile aux angles continus (style iOS) en dégradé violet → rose, un monogramme « L » épais
 * et une étincelle : la marque et l'assistant, lisibles dès 24 px.
 * Aucune image matricielle (l'ancienne icône réduite à 26 px devenait illisible).
 */
export function BrandMark({ size = 28, title }: { size?: number; title?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="brandmark" width={size} height={size} viewBox="0 0 64 64" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <linearGradient id={`bm-g-${id}`} x1="8" y1="4" x2="58" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8B5CFF" />
          <stop offset="0.55" stopColor="#D946EF" />
          <stop offset="1" stopColor="#FF4D8D" />
        </linearGradient>
        <linearGradient id={`bm-h-${id}`} x1="32" y1="0" x2="32" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* tuile « squircle » : courbe continue plutôt qu'un simple rayon */}
      <path d="M32 0C51.2 0 64 4.8 64 32S51.2 64 32 64 0 59.2 0 32 12.8 0 32 0Z" fill={`url(#bm-g-${id})`} />
      <path d="M32 0C51.2 0 64 4.8 64 32H0C0 4.8 12.8 0 32 0Z" fill={`url(#bm-h-${id})`} />
      {/* monogramme */}
      <path d="M22.5 16V40Q22.5 45.5 28 45.5H42" fill="none" stroke="#fff" strokeWidth="8.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* étincelle : le copilote */}
      <path d="M43 13.5c.75 4.6 2.9 6.75 7.5 7.5-4.6.75-6.75 2.9-7.5 7.5-.75-4.6-2.9-6.75-7.5-7.5 4.6-.75 6.75-2.9 7.5-7.5Z" fill="#fff" />
    </svg>
  );
}

/** Mot-symbole discret, pour les zones de marque (barre latérale iPad, en-têtes secondaires). */
export function BrandWord({ size = 13 }: { size?: number }) {
  return (
    <span className="brandword" style={{ fontSize: size }}>
      LEONIDA<b>OS</b>
    </span>
  );
}

/**
 * Icône d'ACTION du bouton flottant : une bulle de conversation avec une étincelle.
 * Elle dit « parler au copilote », pas « logo de l'app » — la compréhension de l'action prime sur la marque.
 */
export function CopilotGlyph({ size = 26 }: { size?: number }) {
  return (
    <svg className="copilotglyph" width={size} height={size} viewBox="0 0 28 28" aria-hidden>
      <path d="M14 3.5C7.6 3.5 2.75 7.9 2.75 13.4c0 2.9 1.35 5.5 3.55 7.3l-.9 3.6c-.15.6.5 1.06 1.02.72l4.1-2.65c1.1.27 2.27.42 3.48.42 6.4 0 11.25-4.4 11.25-9.9S20.4 3.5 14 3.5Z" fill="#fff" />
      {/* étincelle : l'assistant */}
      <path d="M14.2 7.6c.4 2.55 1.75 3.9 4.3 4.3-2.55.4-3.9 1.75-4.3 4.3-.4-2.55-1.75-3.9-4.3-4.3 2.55-.4 3.9-1.75 4.3-4.3Z" fill="#B84DFF" />
    </svg>
  );
}
