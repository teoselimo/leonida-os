/**
 * Sauvegarde privée de la progression dans l'environnement Artifact (capacité `db` : sous-arbre
 * `data/users/<id>/`, invisible des autres personnes, y compris du propriétaire de l'artifact).
 * Permet de retrouver sa partie sur iPhone et iPad avec le même compte Claude.
 * Hors Artifact (GitHub Pages), indisponible : seul le stockage local du navigateur sert.
 * Ce module est le seul, avec le transport Claude, à connaître `window.claude`.
 */
type Snap = { exists: boolean; data(): Record<string, unknown> | undefined };
type DocRef = { get(): Promise<Snap>; set(d: Record<string, unknown>): Promise<void> };
type Db = { doc(path: string): DocRef };

let ref: Promise<DocRef | null> | null = null;

function claudeUse(name: string): Promise<unknown> {
  const c = typeof window !== "undefined" ? (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude : undefined;
  return c?.use ? c.use(name).catch(() => null) : Promise.resolve(null);
}

export function cloudDoc(): Promise<DocRef | null> {
  if (ref) return ref;
  ref = (async () => {
    const [db, user] = (await Promise.all([claudeUse("db"), claudeUse("user")])) as [Db | null, { id(): Promise<string | null> } | null];
    if (!db || !user) return null;
    const id = await user.id().catch(() => null);
    if (!id) return null;
    try {
      return db.doc(`data/users/${id}/progress`);
    } catch {
      return null;
    }
  })();
  return ref;
}

export interface CloudCopy<T> {
  state: T;
  savedAt: string;
}

export async function cloudLoad<T>(): Promise<CloudCopy<T> | null> {
  const d = await cloudDoc();
  if (!d) return null;
  try {
    const s = await Promise.race([d.get(), new Promise<null>((r) => setTimeout(() => r(null), 10_000))]);
    if (!s || !s.exists) return null;
    const body = s.data() as { state?: string; savedAt?: string } | undefined;
    if (!body?.state || !body.savedAt) return null;
    return { state: JSON.parse(body.state) as T, savedAt: body.savedAt };
  } catch {
    return null;
  }
}

let writing: Promise<void> = Promise.resolve();
let lastJson = "";
/** Une écriture à la fois, seulement si l'état a changé (règles de la capacité). */
export function cloudSave<T>(state: T, savedAt: string): void {
  const json = JSON.stringify(state);
  if (json === lastJson) return;
  lastJson = json;
  writing = writing.then(async () => {
    const d = await cloudDoc();
    if (!d) return;
    await d.set({ state: json, savedAt }).catch(() => undefined);
  });
}
