import type { ConnectorKind } from "../types.ts";
import type { Connector } from "./base.ts";
import { ConnectorUnavailable } from "./base.ts";
import { reddit } from "./reddit.ts";
import { rss } from "./rss.ts";
import { sitemap } from "./sitemap.ts";
import { youtubeApi } from "./youtubeApi.ts";
import { youtubeFeed } from "./youtubeFeed.ts";

const unsupported: Connector = async ({ source }) => {
  throw new ConnectorUnavailable("unsupported", source.access);
};

/** Registre des connecteurs : ajouter une source = ajouter une entrée ici et dans sources.json. */
export const CONNECTORS: Record<ConnectorKind, Connector> = {
  "youtube-feed": youtubeFeed,
  "youtube-api": youtubeApi,
  rss,
  reddit,
  sitemap,
  unsupported,
};
