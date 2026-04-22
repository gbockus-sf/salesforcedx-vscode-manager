/**
 * Tiny hand-rolled semver-ish comparator. Handles:
 *   - `1.2.3`
 *   - `v1.2.3`
 *   - `11.0.0+35` / `1.2.3-rc.1` (build-metadata + pre-release suffixes are stripped)
 *   - Missing patch / minor (`1`, `1.2`) — treated as zero-filled.
 *
 * Returns -1 if a < b, 0 if a === b, 1 if a > b.
 *
 * No external dep. Pre-release ordering is NOT implemented (v0.1 scope); any
 * pre-release / build tag is dropped and the numeric core is compared.
 */
export const compare = (a: string, b: string): -1 | 0 | 1 => {
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
};

const parse = (raw: string): number[] => {
  if (!raw || typeof raw !== 'string') return [0];
  let v = raw.trim();
  if (v.startsWith('v') || v.startsWith('V')) v = v.slice(1);
  // Strip build metadata after `+` and pre-release after `-`.
  const plus = v.indexOf('+');
  if (plus >= 0) v = v.slice(0, plus);
  const dash = v.indexOf('-');
  if (dash >= 0) v = v.slice(0, dash);
  if (!v) return [0];
  return v.split('.').map(seg => {
    const n = parseInt(seg, 10);
    return Number.isFinite(n) ? n : 0;
  });
};
