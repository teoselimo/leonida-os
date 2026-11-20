const P: Record<string, string> = {
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20.5 20.5 16 16",
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  map: "M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4zM9 4v13M15 6.5v13",
  radar: "M12 12 19 5M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 12h.01",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  shield: "M12 3 4.5 6v5.5c0 4.5 3.2 8.3 7.5 9.5 4.3-1.2 7.5-5 7.5-9.5V6L12 3z",
  shieldCheck: "M12 3 4.5 6v5.5c0 4.5 3.2 8.3 7.5 9.5 4.3-1.2 7.5-5 7.5-9.5V6L12 3zM8.5 12l2.5 2.5 4.5-5",
  check: "M5 12.5 10 17.5 19.5 7",
  lock: "M6.5 11V8a5.5 5.5 0 0 1 11 0v3M5 11h14v10H5z",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  gem: "M6 3h12l3 6-9 12L3 9l3-6zM3 9h18M9 3l3 18 3-18",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7l1-8z",
  car: "M5 17h14M5 17v2M19 17v2M4 13l2-5.5A2 2 0 0 1 7.9 6h8.2a2 2 0 0 1 1.9 1.5L20 13M4 13h16v4H4zM7.5 15h.01M16.5 15h.01",
  sparkle: "M12 3v4M12 17v4M3 12h4M17 12h4M12 8.5 13.5 12 12 15.5 10.5 12z",
  calendar: "M4 6h16v15H4zM4 10h16M8 3v4M16 3v4",
  chevronRight: "M9 5l7 7-7 7",
  chevronLeft: "M15 5l-7 7 7 7",
  close: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  locate: "M12 2v3M12 19v3M2 12h3M19 12h3M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeOff: "M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  gamepad: "M7 9v4M5 11h4M15 10h.01M18 12h.01M6.5 6h11A4.5 4.5 0 0 1 22 10.5v3.2a3.3 3.3 0 0 1-6 1.9L15 14H9l-1 1.6a3.3 3.3 0 0 1-6-1.9v-3.2A4.5 4.5 0 0 1 6.5 6z",
  trophy: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3",
  alert: "M12 3 2 20h20L12 3zM12 10v4M12 17h.01",
  undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  layers: "M12 3 2 8l10 5 10-5-10-5zM2 13l10 5 10-5",
  arrow: "M5 12h14M13 6l6 6-6 6",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2",
  signal: "M4 20v-4M9 20v-8M14 20V8M19 20V4",
  bookmark: "M6 3h12v18l-6-4-6 4z",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01",
  reset: "M4 4v6h6M20 20v-6h-6M5.5 15A7.5 7.5 0 0 0 19 16.5M18.5 9A7.5 7.5 0 0 0 5 7.5",
};

export function Icon({ name, size = 20, stroke = 1.8, className }: { name: string; size?: number; stroke?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={P[name] ?? P.info} />
    </svg>
  );
}
