/**
 * Système de mouvement LEONIDA OS.
 * Ressorts physiques (masse 1, raideur, amortissement) intégrés image par image : une animation peut être
 * interrompue à tout instant et repartir de la position ET de la vitesse courantes (geste repris en vol).
 * N'anime que des valeurs appliquées en `transform`/`opacity` par l'appelant (composition GPU, pas de mise en page).
 */

export interface SpringConfig {
  stiffness: number;
  damping: number;
  /** Seuil d'arrêt (px et px/s). */
  precision?: number;
}

/** Préréglages proches des courbes UIKit : « smooth » sans rebond, « snappy » léger rebond, « bouncy » pour les célébrations. */
export const SPRINGS = {
  smooth: { stiffness: 260, damping: 32 },
  snappy: { stiffness: 420, damping: 36 },
  sheet: { stiffness: 330, damping: 34 },
  bouncy: { stiffness: 380, damping: 18 },
} satisfies Record<string, SpringConfig>;

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export interface SpringHandle {
  cancel: () => void;
  /** Position et vitesse courantes (pour reprendre un geste en vol). */
  value: () => number;
  velocity: () => number;
}

/**
 * Anime `from` → `to` avec une vitesse initiale `v0` (px/s). `onUpdate` est appelé à chaque image.
 * Intégration semi-implicite à pas fixe (stable même si une image est longue).
 */
export function spring(from: number, to: number, v0: number, cfg: SpringConfig, onUpdate: (x: number) => void, onDone?: () => void): SpringHandle {
  let x = from;
  let v = v0;
  let raf = 0;
  let last = 0;
  let stopped = false;
  const eps = cfg.precision ?? 0.4;
  if (prefersReducedMotion()) {
    onUpdate(to);
    queueMicrotask(() => onDone?.());
    return { cancel: () => {}, value: () => to, velocity: () => 0 };
  }
  const step = (t: number) => {
    if (stopped) return;
    if (!last) last = t;
    // jusqu'à 250 ms rattrapés : sur un appareil lent, l'animation garde sa durée réelle au lieu de traîner
    let dt = Math.min(0.25, (t - last) / 1000);
    last = t;
    // sous-pas de 4 ms : précision constante à 60 comme à 120 Hz
    while (dt > 0) {
      const h = Math.min(0.004, dt);
      const a = -cfg.stiffness * (x - to) - cfg.damping * v;
      v += a * h;
      x += v * h;
      dt -= h;
    }
    if (Math.abs(v) < eps * 10 && Math.abs(x - to) < eps) {
      x = to;
      onUpdate(x);
      stopped = true;
      onDone?.();
      return;
    }
    onUpdate(x);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return {
    cancel: () => {
      stopped = true;
      cancelAnimationFrame(raf);
    },
    value: () => x,
    velocity: () => v,
  };
}

/** Suivi de vitesse d'un geste : régression sur les 100 dernières ms (robuste aux échantillons irréguliers). */
export class VelocityTracker {
  private s: Array<{ t: number; y: number }> = [];
  add(y: number, t = performance.now()) {
    this.s.push({ t, y });
    while (this.s.length > 2 && t - this.s[0].t > 100) this.s.shift();
  }
  /** px/s, positif = vers le bas */
  velocity(): number {
    if (this.s.length < 2) return 0;
    const a = this.s[0];
    const b = this.s[this.s.length - 1];
    const dt = (b.t - a.t) / 1000;
    return dt > 0 ? (b.y - a.y) / dt : 0;
  }
  reset() {
    this.s = [];
  }
}

/** Projection de fin de geste (comme UIScrollView) : où s'arrêterait un objet lancé à cette vitesse. */
export const project = (v: number, decel = 0.998) => ((v / 1000) * decel) / (1 - decel);

/** Retour haptique léger quand le navigateur le permet (Android ; iOS l'ignore sans erreur). */
export function tick(ms = 8) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* non pris en charge */
  }
}
