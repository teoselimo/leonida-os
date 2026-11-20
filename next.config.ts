import type { NextConfig } from "next";

/**
 * V0 : export statique (aucun serveur requis) pour une prévisualisation
 * hébergeable n'importe où. Les chemins d'assets sont relatifs afin que
 * l'app fonctionne aussi depuis un sous-dossier.
 * Quand l'API PostgreSQL arrivera (V1), retirer `output: "export"`
 * et ajouter les routes `src/app/api/*`.
 */
const nextConfig: NextConfig = {
  output: "export",
  assetPrefix: ".",
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
