import io
p = "js/units.js"
s = io.open(p, encoding="utf-8").read()

quad = '''
/** 四足动物：躯干 + 4 条腿 + 头 + 耳朵 + 尾巴，朝 +X */
function quadruped(opt) {
  const { bodyL = 0.9, bodyW = 0.34, bodyH = 0.34, legH = 0.42, headR = 0.22,
    body = C.rotten, dark = C.blood, head = null, ears = true, tail = true, stripe = null } = opt;
  const y = legH + bodyH / 2;
  const parts = [];
  // 躯干
  parts.push({ geo: BOX, color: body, pos: [0, y, 0], scale: [bodyL, bodyH, bodyW] });
  // 背部色块（老虎条纹 / 熊的毛色）
  if (stripe) {
    for (let i = -2; i <= 2; i++) {
      parts.push({ geo: BOX, color: stripe, pos: [i * bodyL * 0.16, y + bodyH * 0.45, 0],
        scale: [bodyL * 0.06, bodyH * 0.16, bodyW * 1.02] });
    }
  }
  // 四条腿
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({
        geo: BOX, color: dark,
        pos: [sx * bodyL * 0.32, legH / 2, sz * bodyW * 0.38],
        scale: [0.09, legH, 0.09],
      });
    }
  }
  // 头
  parts.push({ geo: BOX, color: head || body, pos: [bodyL * 0.56, y + bodyH * 0.1, 0],
    scale: [headR * 2.2, headR * 2.0, headR * 1.8] });
  // 口鼻
  parts.push({ geo: BOX, color: dark, pos: [bodyL * 0.56 + headR * 1.3, y + bodyH * 0.02, 0],
    scale: [headR * 0.9, headR * 0.8, headR * 1.0] });
  // 耳朵
  if (ears) {
    for (const sz of [-1, 1]) {
      parts.push({ geo: CONE, color: dark, pos: [bodyL * 0.5, y + bodyH * 0.5 + headR * 0.6, sz * headR * 0.6],
        scale: [headR * 0.7, headR * 0.9, headR * 0.7] });
    }
  }
  // 尾巴
  if (tail) {
    parts.push({ geo: CYL, color: dark, pos: [-bodyL * 0.58, y + bodyH * 0.25, 0],
      rot: [0, 0, Math.PI / 2.6], scale: [0.07, bodyL * 0.45, 0.07] });
  }
  return parts;
}

'''
s = s.replace("const CACHE = new Map();", quad + "const CACHE = new Map();")

s = s.replace("    case SP.APC: parts = apcBody(); break;",
"""    case SP.APC: parts = apcBody(); break;
    case SP.DOG: parts = quadruped({ bodyL: 0.80, bodyW: 0.30, bodyH: 0.30, legH: 0.44,
      headR: 0.19, body: [0.46, 0.32, 0.18], dark: [0.24, 0.16, 0.09], head: [0.50, 0.35, 0.20] }); break;
    case SP.CAT: parts = quadruped({ bodyL: 0.52, bodyW: 0.20, bodyH: 0.20, legH: 0.30,
      headR: 0.14, body: [0.46, 0.46, 0.50], dark: [0.24, 0.24, 0.28], head: [0.50, 0.50, 0.55] }); break;
    case SP.BEAR: parts = quadruped({ bodyL: 1.75, bodyW: 0.80, bodyH: 0.80, legH: 0.52,
      headR: 0.34, body: [0.24, 0.18, 0.13], dark: [0.13, 0.10, 0.07], head: [0.28, 0.21, 0.15] }); break;
    case SP.TIGER: parts = quadruped({ bodyL: 1.55, bodyW: 0.56, bodyH: 0.56, legH: 0.62,
      headR: 0.28, body: [0.82, 0.46, 0.12], dark: [0.14, 0.10, 0.06], head: [0.86, 0.50, 0.14],
      stripe: [0.16, 0.11, 0.07] }); break;""")

s = s.replace("""    case SP.ELITE: return 2.0;
    default: return 1.8;""",
"""    case SP.ELITE: return 2.0;
    case SP.DOG: return 1.0;
    case SP.CAT: return 0.7;
    case SP.BEAR: return 1.9;
    case SP.TIGER: return 1.5;
    default: return 1.8;""")
io.open(p, "w", encoding="utf-8").write(s)
print("units ok")
