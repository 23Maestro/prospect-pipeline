export function cleanPositions(positions?: string | null): string | null {
  if (!positions) return null;
  const withoutPrefix = positions
    .replace(/^Positions?/i, '')
    .replace(/^[:\-\s]+/, '')
    .trim();
  const tokens = withoutPrefix
    .split(/\||,|\/|•/)
    .map((token) => token.replace(/^Positions?/i, '').trim())
    .filter(Boolean);
  const cleaned = tokens.length ? tokens.join(' | ') : withoutPrefix;
  return cleaned || null;
}
