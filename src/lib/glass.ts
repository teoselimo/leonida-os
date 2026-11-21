/**
 * Effets de verre (Liquid Glass) : « auto » par défaut. Si les transitions d'onglet mesurées en conditions réelles
 * perdent trop d'images (appareil ancien, mode économie d'énergie), le verre passe en version opaque, sans rien
 * demander. Le joueur peut forcer « Activés » ou « Réduits » dans Profil.
 */
export type GlassPref = "auto" | "on" | "off";
const KEY = "leonida-os/glass/v1";
const AUTO_OFF = "leonida-os/glass-auto-off/v1";

export function glassPref(): GlassPref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "on" || v === "off" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function applyGlass(pref: GlassPref = glassPref()) {
  let autoOff = false;
  try {
    autoOff = localStorage.getItem(AUTO_OFF) === "1";
  } catch {
    /* stockage indisponible */
  }
  const off = pref === "off" || (pref === "auto" && autoOff);
  if (off) document.documentElement.setAttribute("data-glass", "off");
  else document.documentElement.removeAttribute("data-glass");
}

export function setGlassPref(pref: GlassPref) {
  try {
    localStorage.setItem(KEY, pref);
    if (pref !== "auto") localStorage.removeItem(AUTO_OFF);
  } catch {
    /* stockage indisponible */
  }
  applyGlass(pref);
}

let janky = 0;
let samples = 0;
/** Échantillonne une transition (≈ 450 ms) ; après 3 transitions dont la majorité saccade, réduit le verre (mode auto). */
export function sampleTransition() {
  if (glassPref() !== "auto" || document.documentElement.hasAttribute("data-glass") || samples >= 6) return;
  const frames: number[] = [];
  const start = performance.now();
  const loop = (t: number) => {
    frames.push(t);
    if (t - start < 450) requestAnimationFrame(loop);
    else {
      const d = frames.slice(1).map((x, i) => x - frames[i]);
      const late = d.filter((x) => x > 28).length / Math.max(1, d.length);
      samples++;
      if (late > 0.3) janky++;
      if (samples >= 3 && janky >= 2) {
        try {
          localStorage.setItem(AUTO_OFF, "1");
        } catch {
          /* stockage indisponible */
        }
        applyGlass("auto");
      }
    }
  };
  requestAnimationFrame(loop);
}
