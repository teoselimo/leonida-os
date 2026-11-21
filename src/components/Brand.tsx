"use client";

/** Icône LEONIDA OS (dessin original : dégradé sunset, palmiers, monogramme L). Chemin relatif : fonctionne aussi en sous-dossier. */
export function BrandMark({ size = 28 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="brandmark" src={size > 60 ? "icons/icon-192.png" : "icons/icon-120.png"} width={size} height={size} alt="" aria-hidden />;
}
