"use client";

import { CATEGORIES } from "@/lib/meta";
import { repo, useStore } from "@/lib/store";
import type { Recommendation } from "@/lib/types";
import { Icon } from "./ui/Icon";
import { CategoryGlyph } from "./ui/primitives";

export function RecoCard({ rec, variant = "row", active, rank }: { rec: Recommendation; variant?: "row" | "chip"; active?: boolean; rank?: number }) {
  const { focusOnMap } = useStore();
  const d = rec.discovery;
  const region = repo.regions().find((r) => r.id === d.regionId)!;
  return (
    <button
      className={`reco reco--${variant}${active ? " is-active" : ""}${rec.isFresh ? " is-fresh" : ""}`}
      onClick={() => focusOnMap(d.id)}
      data-testid={`reco-${d.id}`}
    >
      {rank !== undefined && <span className="reco__rank">{rank}</span>}
      <CategoryGlyph id={d.category} size={variant === "chip" ? 32 : 40} />
      <span className="reco__body">
        <span className="reco__title">
          {d.title}
          {rec.isFresh && <em className="newtag">Nouveau</em>}
        </span>
        <span className="reco__sub">
          <span style={{ color: CATEGORIES[d.category].color }}>{region.name}</span>
          <span className="dot" />
          {rec.reasons[0]}
        </span>
      </span>
      {variant === "row" && <Icon name="chevronRight" size={18} className="reco__chev" />}
    </button>
  );
}
