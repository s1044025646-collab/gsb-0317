/**
 * 自行实现的 Manacher 算法：分别计算奇数、偶数半径数组。
 *
 * 设码点数组为 s，长度为 n。
 *
 * 奇数半径 odd[i]（中心为字符 i，半径包含中心字符）：
 *   回文区间为 [i - odd[i] + 1, i + odd[i] - 1]（左闭右闭码点下标），
 *   长度 = 2*odd[i] - 1，左闭右开区间 = [i-odd[i]+1, i+odd[i])。
 *   odd[i] >= 1。
 *
 * 偶数半径 even[i]（中心位于字符 i-1 与字符 i 之间）：
 *   回文区间为 [i - even[i], i + even[i] - 1]（左闭右闭），
 *   长度 = 2*even[i]，左闭右开区间 = [i-even[i], i+even[i])。
 *   even[i] >= 0；even[i]=0 表示该间隙无回文。
 *
 * 镜像复用：维护当前覆盖到最右侧的回文 [l, r]（r 为开边界）。
 * 当中心落在其内部时，初始半径取“镜像中心半径”和“到右边界距离”的较小者，
 * 之后只比较尚未确定的字符，从而保证总体线性 O(n)。
 */

export type Parity = "odd" | "even";

export interface ExplainRecord {
  /** 中心：奇=字符码点下标；偶=间隙下标（位于 center-1 与 center 之间）。 */
  center: number;
  parity: Parity;
  /** 本次开始扩展前已知的最右回文边界 [boundaryL, boundaryR)（偶数场景共用）。 */
  boundaryL: number;
  boundaryR: number;
  /** 镜像中心下标；中心不在已知回文内时为 -1。 */
  mirror: number;
  /** 由镜像半径与边界共同确定的初始可复用半径。 */
  initialRadius: number;
  /** 复用后实际新增的逐字符比较次数（成功 + 失败）。 */
  newComparisons: number;
  /** 新增比较中成功（相等）的次数。 */
  matched: number;
  /** 最终半径。 */
  radius: number;
}

export interface ManacherResult {
  odd: Int32Array;
  even: Int32Array;
  /** 全部非空回文出现次数（不同位置分别计数），十进制字符串。 */
  total: string;
  /** 最长回文长度。 */
  longestLength: number;
  /** 全部不同的最长区间 [start,end)，按起点、再按终点排序。 */
  longest: Array<{ start: number; end: number }>;
  /** 解释明细（可能因上限被截断）。 */
  explain: ExplainRecord[];
  /** 解释是否在上限处被截断。 */
  explainTruncated: boolean;
}

export interface RunOptions {
  /** 解释明细保留的中心数量上限；默认 200。 */
  explainCap?: number;
}

export function runManacher(s: number[], opts: RunOptions = {}): ManacherResult {
  const n = s.length;
  const cap = opts.explainCap ?? 200;
  const odd = new Int32Array(n);
  const even = new Int32Array(n);
  const explain: ExplainRecord[] = [];
  let truncated = false;

  // ---- 奇数半径 ----
  // [l, r) 为覆盖最右的奇数回文。
  let l = 0;
  let r = 0;
  for (let i = 0; i < n; i++) {
    let initial = 1;
    let mirror = -1;
    const inside = i < r;
    if (inside) {
      mirror = l + (r - 1) - i; // 关于回文中心对称的镜像下标
      initial = Math.min(odd[mirror]!, r - i);
    }
    let radius = initial;
    let matched = 0;
    while (i - radius >= 0 && i + radius < n && s[i - radius] === s[i + radius]) {
      radius++;
      matched++;
    }
    // 新增比较次数：成功 matched 次；若因不相等停下，另有 1 次失败比较。
    const failed = i - radius >= 0 && i + radius < n ? 1 : 0;
    odd[i] = radius;
    if (i + radius > r) {
      l = i - radius + 1;
      r = i + radius;
    }
    if (explain.length < cap) {
      explain.push({
        center: i,
        parity: "odd",
        boundaryL: inside ? l : i,
        boundaryR: inside ? r : i,
        mirror,
        initialRadius: initial,
        newComparisons: matched + failed,
        matched,
        radius,
      });
    } else {
      truncated = true;
    }
  }

  // ---- 偶数半径 ----
  // 间隙 i：左侧字符 i-1，右侧字符 i。覆盖最右回文仍记为 [l, r)。
  l = 0;
  r = 0;
  for (let i = 0; i < n; i++) {
    let initial = 0;
    let mirror = -1;
    // 间隙 i 落在 [l,r) 内部：其比较将从 i+initial-1 / i-initial 开始，
    // 复用条件用 i < r 表示右半边仍被覆盖。
    const inside = i < r && i > l;
    if (inside) {
      mirror = l + r - i; // 间隙 i 关于回文中心的镜像间隙
      initial = Math.min(even[mirror]!, r - i);
    }
    let radius = initial;
    let matched = 0;
    while (i - radius - 1 >= 0 && i + radius < n && s[i - radius - 1] === s[i + radius]) {
      radius++;
      matched++;
    }
    const failed = i - radius - 1 >= 0 && i + radius < n ? 1 : 0;
    even[i] = radius;
    if (i + radius > r) {
      l = i - radius;
      r = i + radius;
    }
    if (explain.length < cap) {
      explain.push({
        center: i,
        parity: "even",
        boundaryL: inside ? l : i,
        boundaryR: inside ? r : i,
        mirror,
        initialRadius: initial,
        newComparisons: matched + failed,
        matched,
        radius,
      });
    } else {
      truncated = true;
    }
  }

  // ---- 汇总 ----
  let longestLength = 0;
  let total = 0n;
  const longest: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < n; i++) {
    total += BigInt(odd[i]!);
    const lo = 2 * odd[i]! - 1;
    if (lo >= longestLength && lo > 0) {
      if (lo > longestLength) {
        longestLength = lo;
        longest.length = 0;
      }
      longest.push({ start: i - odd[i]! + 1, end: i + odd[i]! });
    }
  }
  for (let i = 0; i < n; i++) {
    total += BigInt(even[i]!);
    const le = 2 * even[i]!;
    if (le >= longestLength && le > 0) {
      if (le > longestLength) {
        longestLength = le;
        longest.length = 0;
      }
      longest.push({ start: i - even[i]!, end: i + even[i]! });
    }
  }
  longest.sort((a, b) => a.start - b.start || a.end - b.end);

  return {
    odd,
    even,
    total: total.toString(),
    longestLength,
    longest,
    explain,
    explainTruncated: truncated,
  };
}

/** 依据已构建半径回答区间 [start,end) 是否为回文。 */
export function isPalindromeInterval(
  odd: Int32Array,
  even: Int32Array,
  start: number,
  end: number
): boolean {
  const len = end - start;
  if (len === 0) return true; // 合法空区间
  if (len % 2 === 1) {
    const center = (start + end - 1) >> 1;
    return odd[center]! >= ((len + 1) >> 1);
  }
  const center = (start + end) >> 1; // 间隙中心
  return even[center]! >= len >> 1;
}
