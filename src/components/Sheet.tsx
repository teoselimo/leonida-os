"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

type Snap = "half" | "full";

/**
 * Fiche glissante iOS : deux crans (mi-hauteur / plein écran), suivi du doigt,
 * fermeture par glissement rapide ou franc vers le bas, défilement interne
 * qui « passe la main » au glissement de la fiche lorsqu'il est tout en haut.
 *
 * `onHeight` reçoit la hauteur stabilisée du cran mi-hauteur (pour recentrer la carte au-dessus).
 */
export function Sheet({ children, onClose, onHeight, tall, testId }: { children: ReactNode; onClose: () => void; onHeight: (h: number) => void; tall?: boolean; testId?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState<Snap>("half");
  const [parentH, setParentH] = useState(700);
  const [contentH, setContentH] = useState(0);
  const [drag, setDrag] = useState<number | null>(null); // hauteur pendant le geste
  const [closing, setClosing] = useState(false);
  const g = useRef<{ y0: number; h0: number; t0: number; lastY: number; lastT: number; fromScroll: boolean } | null>(null);

  // Mesures : hauteur disponible et hauteur naturelle du contenu
  useLayoutEffect(() => {
    const p = root.current?.parentElement;
    const c = content.current;
    if (!p || !c) return;
    const ro = new ResizeObserver(() => {
      setParentH(p.clientHeight);
      setContentH(c.scrollHeight + 26);
    });
    ro.observe(p);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  const fullH = Math.round(parentH * 0.92);
  const halfH = Math.round(Math.min(contentH || parentH, parentH * (tall ? 0.6 : 0.56)));
  const height = closing ? 0 : drag ?? (snap === "full" ? fullH : halfH);

  useEffect(() => {
    if (halfH > 0) onHeight(halfH);
  }, [halfH, onHeight]);

  const close = () => {
    setClosing(true);
    setTimeout(onClose, 220);
  };

  const begin = (y: number, fromScroll: boolean) => {
    const h = root.current?.offsetHeight ?? height;
    g.current = { y0: y, h0: h, t0: performance.now(), lastY: y, lastT: performance.now(), fromScroll };
  };
  const move = (y: number) => {
    const s = g.current;
    if (!s) return;
    const dy = y - s.y0;
    let h = s.h0 - dy;
    if (h > fullH) h = fullH + (h - fullH) * 0.25; // résistance en haut
    setDrag(Math.max(60, h));
    s.lastY = y;
    s.lastT = performance.now();
  };
  const end = () => {
    const s = g.current;
    g.current = null;
    if (!s || drag === null) {
      setDrag(null);
      return;
    }
    const dt = Math.max(1, performance.now() - s.t0);
    const v = (s.lastY - s.y0) / dt; // px/ms, positif = vers le bas
    const h = drag;
    setDrag(null);
    if (v > 0.6 || h < halfH * 0.55) {
      if (snap === "full" && h > halfH * 0.55 && v < 1.4) setSnap("half");
      else close();
    } else if (v < -0.5 || h > (halfH + fullH) / 2) setSnap("full");
    else setSnap("half");
  };

  // Poignée : pointer events (souris, stylet, doigt)
  const gripProps = {
    onPointerDown: (e: React.PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      begin(e.clientY, false);
    },
    onPointerMove: (e: React.PointerEvent) => g.current && move(e.clientY),
    onPointerUp: (e: React.PointerEvent) => {
      const s = g.current;
      if (s && Math.abs(e.clientY - s.y0) < 6) {
        g.current = null;
        setDrag(null);
        setSnap((x) => (x === "half" ? "full" : "half")); // toucher = basculer
        return;
      }
      end();
    },
    onPointerCancel: end,
  };

  // Défilement interne : tiré vers le bas depuis le haut → la fiche suit le doigt
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let startY = 0;
    let engaged = false;
    const ts = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
      engaged = false;
    };
    const tm = (e: TouchEvent) => {
      const y = e.touches[0].clientY;
      if (!engaged && el.scrollTop <= 0 && y - startY > 8) {
        engaged = true;
        begin(startY, true);
      }
      if (engaged) {
        e.preventDefault();
        move(y);
      }
    };
    const te = () => {
      if (engaged) end();
      engaged = false;
    };
    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove", tm, { passive: false });
    el.addEventListener("touchend", te);
    el.addEventListener("touchcancel", te);
    return () => {
      el.removeEventListener("touchstart", ts);
      el.removeEventListener("touchmove", tm);
      el.removeEventListener("touchend", te);
      el.removeEventListener("touchcancel", te);
    };
  });

  return (
    <div
      ref={root}
      className={`sheet${drag !== null ? " is-dragging" : ""}${snap === "full" ? " is-full" : ""}`}
      style={{ height }}
      onClick={(e) => e.stopPropagation()}
      data-testid={testId ?? "sheet"}
      data-snap={closing ? "closed" : snap}
    >
      <div className="sheet__grip" {...gripProps} role="button" aria-label={snap === "half" ? "Agrandir la fiche" : "Réduire la fiche"} data-testid="sheet-grip">
        <span />
      </div>
      <div className="sheet__scroll" ref={scroller}>
        <div ref={content}>{children}</div>
      </div>
    </div>
  );
}
