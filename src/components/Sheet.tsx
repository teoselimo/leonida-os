"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { project, SPRINGS, spring, tick, VelocityTracker } from "@/lib/motion";
import type { SpringHandle } from "@/lib/motion";

type Snap = "half" | "full";

/**
 * Fiche glissante iOS (V0.7) — physique, interruptible, composée par le GPU.
 *  - La fiche a une hauteur fixe ; seule sa translation verticale change (`transform`), jamais sa hauteur :
 *    aucune mise en page pendant le geste, aucun rendu React par image.
 *  - Elle suit le doigt au pixel, avec résistance élastique au-delà du plein écran.
 *  - Au lâcher, la vitesse est projetée (comme UIScrollView) pour choisir le cran : plein, mi-hauteur ou fermeture.
 *  - Un toucher pendant une animation la reprend en vol (position et vitesse conservées).
 *  - Le défilement interne cède la main à la fiche quand il est tout en haut et qu'on tire vers le bas.
 *  - Clavier iOS : la fiche passe en plein écran et se place au-dessus du clavier (visualViewport).
 * `onHeight` reçoit la hauteur visible une fois la fiche immobile (pour recentrer la carte au-dessus).
 */
export function Sheet({ children, onClose, onHeight, tall, testId, label, initial = "half" }: { children: ReactNode; onClose: () => void; onHeight?: (h: number) => void; tall?: boolean; testId?: string; label?: string; initial?: Snap }) {
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState<Snap>(initial);
  const [settled, setSettled] = useState(false);
  const [dims, setDims] = useState({ parent: 0, content: 0 });
  const [kb, setKb] = useState(0);
  const y = useRef(10_000); // translation courante (0 = plein écran)
  const anim = useRef<SpringHandle | null>(null);
  const drag = useRef<{ y0: number; t0: number; start: number; fromScroll: boolean } | null>(null);
  const vel = useRef(new VelocityTracker());
  const closing = useRef(false);

  const fullH = Math.max(0, Math.round(dims.parent * 0.93) - kb);
  const halfVisible = Math.round(Math.min(dims.content || dims.parent, dims.parent * (tall ? 0.6 : 0.56)));
  const snapY = useCallback((s: Snap | "closed") => (s === "full" ? 0 : s === "half" ? Math.max(0, fullH - halfVisible) : fullH + 40), [fullH, halfVisible]);

  const apply = (v: number) => {
    y.current = v;
    const el = root.current;
    if (!el) return;
    // résistance élastique au-dessus du plein écran
    const shown = v < 0 ? v * 0.3 : v;
    el.style.transform = `translate3d(0, ${shown}px, 0)`;
    el.style.setProperty("--progress", String(Math.max(0, Math.min(1, 1 - v / Math.max(1, fullH)))));
  };

  const animateTo = useCallback(
    (target: Snap | "closed", v0 = 0) => {
      anim.current?.cancel();
      setSettled(false);
      const to = snapY(target);
      anim.current = spring(y.current, to, v0, target === "closed" ? SPRINGS.snappy : SPRINGS.sheet, apply, () => {
        anim.current = null;
        if (target === "closed") {
          onClose();
          return;
        }
        setSettled(true);
        // la zone défilante s'arrête au bord visible de l'écran : les actions collantes (« Enregistrer »,
        // « Découverte terminée ») restent visibles à mi-hauteur. Une seule mise en page, à l'arrêt.
        if (root.current) root.current.style.paddingBottom = `${Math.max(0, to)}px`;
        onHeight?.(fullH - to);
      });
      if (target !== "closed") setSnap(target);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapY, fullH, onClose, onHeight],
  );

  const close = useCallback(
    (v0 = 0) => {
      if (closing.current) return;
      closing.current = true;
      animateTo("closed", v0);
    },
    [animateTo],
  );

  // Mesures (hauteur disponible, hauteur naturelle du contenu)
  useLayoutEffect(() => {
    const p = root.current?.parentElement;
    const c = content.current;
    if (!p || !c) return;
    const measure = () => setDims({ parent: p.clientHeight, content: c.scrollHeight + 28 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(p);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  // Entrée : depuis le bas, ressort vers mi-hauteur ; recalage si les dimensions changent
  const entered = useRef(false);
  useLayoutEffect(() => {
    if (!dims.parent || closing.current) return;
    if (!entered.current) {
      entered.current = true;
      apply(fullH + 40);
      animateTo(kb ? "full" : initial);
      return;
    }
    if (!drag.current) animateTo(kb ? "full" : snap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dims.parent, halfVisible, kb]);

  // Clavier iOS : décale la fiche au-dessus et passe en plein écran
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onVv = () => {
      const k = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKb(k > 80 ? Math.round(k) : 0);
    };
    vv.addEventListener("resize", onVv);
    return () => vv.removeEventListener("resize", onVv);
  }, []);

  useEffect(() => () => anim.current?.cancel(), []);

  // ── Geste ────────────────────────────────────────────────────────────────────
  const begin = (clientY: number, fromScroll: boolean) => {
    anim.current?.cancel(); // reprise en vol
    anim.current = null;
    setSettled(false);
    vel.current.reset();
    vel.current.add(clientY);
    drag.current = { y0: clientY, t0: performance.now(), start: y.current, fromScroll };
    root.current?.classList.add("is-dragging");
  };
  const move = (clientY: number) => {
    const d = drag.current;
    if (!d) return;
    vel.current.add(clientY);
    apply(d.start + (clientY - d.y0));
  };
  const end = (clientY: number, wasTap = false) => {
    const d = drag.current;
    drag.current = null;
    root.current?.classList.remove("is-dragging");
    if (!d) return;
    if (wasTap) {
      tick();
      animateTo(snap === "half" ? "full" : "half");
      return;
    }
    const v = vel.current.velocity();
    const landing = y.current + project(v);
    const candidates: Array<Snap | "closed"> = ["full", "half", "closed"];
    let best = candidates.reduce((a, b) => (Math.abs(snapY(b) - landing) < Math.abs(snapY(a) - landing) ? b : a));
    // un lancer franc vers le bas depuis le plein écran revient d'abord à mi-hauteur
    // (sauf si le doigt a déjà amené la fiche sous la mi-hauteur : l'intention de fermer est claire)
    if (best === "closed" && d.start < snapY("half") - 40 && y.current < snapY("half") + 40 && v < 2200) best = "half";
    void clientY;
    if (best === "closed") close(v);
    else animateTo(best, v);
  };

  const gripProps = {
    onPointerDown: (e: React.PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      begin(e.clientY, false);
    },
    onPointerMove: (e: React.PointerEvent) => drag.current && move(e.clientY),
    onPointerUp: (e: React.PointerEvent) => {
      const d = drag.current;
      end(e.clientY, !!d && Math.abs(e.clientY - d.y0) < 6 && performance.now() - d.t0 < 300);
    },
    onPointerCancel: (e: React.PointerEvent) => end(e.clientY),
  };

  // Défilement interne : en haut + tirer vers le bas → la fiche prend le relais (et le rend si on remonte)
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let startY = 0;
    let engaged = false;
    const ts = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
      engaged = false;
      if (anim.current) begin(startY, true), (engaged = true);
    };
    const tm = (e: TouchEvent) => {
      const cy = e.touches[0].clientY;
      // mi-hauteur : tout glissement vertical déplace la fiche (comme le détent « medium » d'iOS) ;
      // plein écran : défilement natif, sauf tirer vers le bas quand on est tout en haut
      const half = el.classList.contains("is-half");
      if (!engaged && (half ? Math.abs(cy - startY) > 6 : el.scrollTop <= 0 && cy - startY > 6)) {
        engaged = true;
        begin(cy, true);
      }
      if (engaged) {
        e.preventDefault();
        move(cy);
      }
    };
    const te = (e: TouchEvent) => {
      if (engaged) end(e.changedTouches[0]?.clientY ?? startY);
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

  // Échap / bouton retour clavier
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [close]);

  return (
    <div
      ref={root}
      className={`sheet glass${snap === "full" ? " is-full" : ""}`}
      style={{ height: fullH || undefined, bottom: kb, transform: "translate3d(0, 100vh, 0)" }}
      onClick={(e) => e.stopPropagation()}
      data-testid={testId ?? "sheet"}
      data-snap={snap}
      data-settled={settled ? "true" : "false"}
      role="dialog"
      aria-label={label}
    >
      <div className="sheet__grip" {...gripProps} role="button" aria-label={snap === "half" ? "Agrandir la fiche" : "Réduire la fiche"} data-testid="sheet-grip">
        <span />
      </div>
      <div className={`sheet__scroll${snap === "full" ? "" : " is-half"}`} ref={scroller}>
        <div ref={content}>{children}</div>
      </div>
    </div>
  );
}
