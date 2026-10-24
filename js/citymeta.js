// ============================================================
//  城市名统一格式化
//
//  约定：**国家在前，城市在后**。
//    cityFull(id)     → 「德国 · 柏林·米特」   （带国家，用于顶栏 / 标题 / 选择器）
//    cityShort(id)    → 「柏林·米特」          （不带国家，用于正文 / 新闻）
//    cityCountry(id)  → 「德国」
//    cityNewspaper(id)→ 「柏林晨报」            （新闻报头用）
//
//  未知城市：用传入的 fallback 名字兜底，保证任何情况下都有可显示的名字。
// ============================================================

/** id → { country, city, district } */
export const CITY_INFO = {
  berlin:    { country: '德国', city: '柏林',   district: '米特' },
  tokyo:     { country: '日本', city: '东京',   district: '千代田' },
  zhengzhou: { country: '中国', city: '郑州',   district: '金水' },
  nanyang:   { country: '中国', city: '南阳',   district: '卧龙' },
  zhenping:  { country: '中国', city: '南阳',   district: '镇平' },
  leicester: { country: '英国', city: '莱斯特', district: '' },   // 原版 2009 的那张图
};

/** 取结构化信息：id 允许带后缀（比如 "berlin-v2"），按包含匹配 */
export function cityInfo(id, fallback) {
  const k = String(id || '').toLowerCase();
  for (const key of Object.keys(CITY_INFO)) {
    if (k.includes(key)) return CITY_INFO[key];
  }
  // 没登记过的城市：把 fallback 当成城市名，国家留空
  const name = String(fallback || id || '未知城市');
  return { country: '', city: name, district: '' };
}

/** 「柏林·米特」 */
export function cityShort(id, fallback) {
  const i = cityInfo(id, fallback);
  return i.district ? `${i.city}·${i.district}` : i.city;
}

/** 「德国 · 柏林·米特」（国家在前） */
export function cityFull(id, fallback, sep = ' · ') {
  const i = cityInfo(id, fallback);
  const short = i.district ? `${i.city}·${i.district}` : i.city;
  return i.country ? `${i.country}${sep}${short}` : short;
}

/** 「德国」 */
export function cityCountry(id, fallback) {
  return cityInfo(id, fallback).country || '';
}

/** 「柏林晨报」——新闻报头用城市名，后面接“晨报/晚报”等 */
export function cityNewspaper(id, fallback) {
  return `${cityInfo(id, fallback).city}晨报`;
}

/** 下拉框用：「德国 · 柏林·米特」 */
export function cityOption(id, fallback) {
  return cityFull(id, fallback);
}
