/** Merge realtime product patches into a product list by id. */
export function mergeProducts(existing, patches) {
  if (!patches?.length) return existing;
  const byId = new Map(existing.map((p) => [p.id, p]));
  for (const patch of patches) {
    if (!patch?.id) continue;
    byId.set(patch.id, { ...byId.get(patch.id), ...patch });
  }
  return Array.from(byId.values());
}
