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
  zhengzhou: { country: '中国', city: '郑州',   district: '二七' },
  nanyang:   { country: '中国', city: '南阳',   district: '卧龙' },
  zhenping:  { country: '中国', city: '南阳',   district: '镇平' },
  // 无人机航测烘焙的两座城（镇平县）：注意 id 更长，匹配时要优先于 zhenping
  zhenping_town:     { country: '中国', city: '镇平', district: '县城' },
  zhenping_tangying: { country: '中国', city: '镇平', district: '唐营村' },
  leicester: { country: '英国', city: '莱斯特', district: '' },   // 原版 2009 的那张图

  // ===== 原版手游内嵌的 5 张（买断影像，坐标未知，按影像内容命名）=====
  map01: { country: '英国', city: '考文垂', district: '' },
  map02: { country: '英国', city: '达克斯福德',     district: '' },
  map03: { country: '美国', city: '克利尔沃特', district: '' },
  map04: { country: '越南', city: '岘港', district: '' },
  map05: { country: '阿联酋', city: '迪拜', district: '' },

  // ===== 原版手游的 15 张 Google 图（坐标来自 3DS MapConfig，精确到小数点后两位）=====
  g17:     { country: '澳大利亚', city: '珀斯',       district: '' },
  g752:    { country: '日本',     city: '广岛',       district: '' },
  g11171:  { country: '美国',     city: '斯托克顿堡', district: '' },
  g13021:  { country: '美国',     city: '迈阿密',     district: '' },
  g14016:  { country: '南非',     city: '德班',       district: '' },
  g15961:  { country: '德国',     city: '基尔',       district: '' },
  g56601:  { country: '巴西',     city: '桑托斯',     district: '' },
  g66032:  { country: '巴西',     city: '萨尔瓦多',   district: '' },
  g79478:  { country: '加拿大',   city: '里贾纳',     district: '' },
  g79818:  { country: '奥地利',   city: '萨尔茨堡',   district: '' },
  g85014:  { country: '加拿大',   city: '里贾纳',     district: '东' },
  g94544:  { country: '荷兰',     city: '吕伐登',     district: '' },
  g111850: { country: '波兰',     city: '耶莱尼亚古拉', district: '' },
  g114009: { country: '菲律宾',   city: '碧瑶',       district: '' },
  g115885: { country: '美国',     city: '泽西城',     district: '' },
};

/** 取结构化信息：id 允许带后缀（比如 "berlin-v2"），按包含匹配 */
export function cityInfo(id, fallback) {
  const k = String(id || '').toLowerCase();
  // 长 key 优先：zhenping_town 必须先于 zhenping 命中
  const keys = Object.keys(CITY_INFO).sort((a, b) => b.length - a.length);
  for (const key of keys) {
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
function cityOption(id, fallback) {
  return cityFull(id, fallback);
}
