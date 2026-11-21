import type { Metadata, Viewport } from "next";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/space-grotesk/latin-500.css";
import "@fontsource/space-grotesk/latin-700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "LEONIDA OS — copilote GTA VI",
  description: "Copilote non officiel pour GTA VI : carte de Leonida, voitures cachées, veille sourcée et LEONIDA AI.",
  appleWebApp: { capable: true, title: "Leonida OS", statusBarStyle: "black-translucent" },
  manifest: "./manifest.webmanifest",
  icons: {
    icon: [{ url: "./favicon.svg", type: "image/svg+xml" }, { url: "./icons/favicon-32.png", sizes: "32x32" }],
    apple: [{ url: "./icons/icon-180.png", sizes: "180x180" }, { url: "./icons/icon-167.png", sizes: "167x167" }, { url: "./icons/icon-152.png", sizes: "152x152" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0814",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
