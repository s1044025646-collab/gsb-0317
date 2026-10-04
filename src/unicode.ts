/**
 * Unicode 码点相关工具。
 *
 * 约定：
 * - 逻辑位置（index）按 Unicode 码点计数，从 0 开始。
 * - utf16 偏移按 JavaScript 字符串的 UTF-16 码元计数。
 * - 不做任何 Unicode 归一化，也不合并组合附加符。
 */

export interface DecodedText {
  /** 原始字符串，逐字节（码元）保留。 */
  raw: string;
  /** 码点序列。 */
  points: number[];
  /** map[i] = 第 i 个码点在原字符串中的起始 UTF-16 偏移。 */
  map: number[];
  /** 每个码点占据的 UTF-16 码元数（1 或 2）。 */
  units: number[];
}

/**
 * 解码字符串为码点数组并建立到 UTF-16 偏移的映射。
 * 遇到孤立代理项（unpaired surrogate）时抛出 ErrLoneSurrogate。
 */
export function decodeText(raw: string): DecodedText {
  const points: number[] = [];
  const map: number[] = [];
  const units: number[] = [];
  for (let i = 0; i < raw.length; ) {
    const cu = raw.charCodeAt(i);
    if (cu >= 0xd800 && cu <= 0xdbff) {
      // 高代理项，必须紧跟一个低代理项
      const next = raw.charCodeAt(i + 1);
      if (next === undefined || next < 0xdc00 || next > 0xdfff) {
        const e = new Error(`检测到孤立高代理项，UTF-16 偏移 ${i}`);
        (e as Error & { code?: string }).code = "ERR_LONE_SURROGATE";
        throw e;
      }
      points.push(((cu - 0xd800) << 10) + (next - 0xdc00) + 0x10000);
      map.push(i);
      units.push(2);
      i += 2;
    } else if (cu >= 0xdc00 && cu <= 0xdfff) {
      const e = new Error(`检测到孤立低代理项，UTF-16 偏移 ${i}`);
      (e as Error & { code?: string }).code = "ERR_LONE_SURROGATE";
      throw e;
    } else {
      points.push(cu);
      map.push(i);
      units.push(1);
      i += 1;
    }
  }
  return { raw, points, map, units };
}

/** 码点区间 [start,end) 还原为原始字符串（左闭右开）。 */
export function sliceByPoints(d: DecodedText, start: number, end: number): string {
  const utfStart = d.map[start] ?? d.raw.length;
  const utfEnd = end < d.points.length ? d.map[end]! : d.raw.length;
  return d.raw.slice(utfStart, utfEnd);
}

/** 用码点数组还原字符串（与 sliceByPoints 结果应当一致）。 */
export function pointsToSubstring(points: number[], start: number, end: number): string {
  let out = "";
  for (let i = start; i < end; i++) out += String.fromCodePoint(points[i]!);
  return out;
}
