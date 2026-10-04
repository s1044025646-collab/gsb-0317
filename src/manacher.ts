export interface ExplainRecord {
  kind: "odd" | "even";
  center: number;
  mirror: number | null;
  initialRadius: number;
  newComparisons: number;
  rightBefore: number;
  rightAfter: number;
}

export interface ManacherResult {
  d1: number[];
  d2: number[];
  explains: ExplainRecord[];
}

export function manacher(s: string[], explainLimit: number): ManacherResult {
  const n = s.length;
  const d1 = new Array<number>(n).fill(0);
  const d2 = new Array<number>(n).fill(0);
  const explains: ExplainRecord[] = [];
  const collect = () => explains.length < explainLimit;

  let l = 0, r = -1;
  for (let i = 0; i < n; i++) {
    const mirror = i > r ? null : l + r - i;
    let k = i > r ? 1 : Math.min(d1[mirror!], r - i + 1);
    const initial = k;
    let cmp = 0;
    while (i - k >= 0 && i + k < n && s[i - k] === s[i + k]) { k++; cmp++; }
    d1[i] = k;
    const rightAfter = Math.max(r, i + k - 1);
    if (collect()) explains.push({ kind: "odd", center: i, mirror, initialRadius: initial, newComparisons: cmp, rightBefore: r, rightAfter });
    if (i + k - 1 > r) { l = i - k + 1; r = i + k - 1; }
  }

  l = 0; r = -1;
  for (let i = 0; i < n; i++) {
    const mirror = i > r ? null : l + r - i + 1;
    let k = i > r ? 0 : Math.min(d2[mirror!], r - i + 1);
    const initial = k;
    let cmp = 0;
    while (i - k - 1 >= 0 && i + k < n && s[i - k - 1] === s[i + k]) { k++; cmp++; }
    d2[i] = k;
    const rightAfter = Math.max(r, i + k - 1);
    if (collect()) explains.push({ kind: "even", center: i, mirror, initialRadius: initial, newComparisons: cmp, rightBefore: r, rightAfter });
    if (i + k - 1 > r) { l = i - k; r = i + k - 1; }
  }

  return { d1, d2, explains };
}

export interface LongestResult {
  length: number;
  intervals: Array<[number, number]>;
}

export function longestPalindromes(d1: number[], d2: number[]): LongestResult {
  const n = d1.length;
  let best = 0;
  const intervals: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const oddLen = 2 * d1[i] - 1;
    if (oddLen > best) { best = oddLen; intervals.length = 0; intervals.push([i - d1[i] + 1, i + d1[i]]); }
    else if (oddLen === best) intervals.push([i - d1[i] + 1, i + d1[i]]);
    const evenLen = 2 * d2[i];
    if (evenLen > best) { best = evenLen; intervals.length = 0; intervals.push([i - d2[i], i + d2[i]]); }
    else if (evenLen === best && evenLen > 0) intervals.push([i - d2[i], i + d2[i]]);
  }
  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { length: best, intervals };
}

export function totalPalindromeCount(d1: number[], d2: number[]): bigint {
  let total = 0n;
  for (const v of d1) total += BigInt(v);
  for (const v of d2) total += BigInt(v);
  return total;
}

export function isPalindromeRange(d1: number[], d2: number[], a: number, b: number): boolean {
  const len = b - a;
  if (len <= 0) return true;
  if (len % 2 === 1) {
    const c = (a + b - 1) / 2;
    return d1[c] >= (len + 1) / 2;
  }
  const c = (a + b) / 2;
  return d2[c] >= len / 2;
}
