// ============================================================
//  ZOS-R · 指挥工具表
//  经费单位：人民币（元）。价格按现实量级校准。
// ============================================================

export const TOOLS = [
  {
    id: 'select', name: '查看', icon: '🔍', cost: 0, cool: 0, radius: 0,
    color: 0xffffff, kind: 'select',
    desc: '默认模式：点一个人查看档案；点要员（金色）可以重点跟踪',
    apply: () => 0,
  },
  // ---------------- 调人 ----------------
  {
    id: 'police', name: '调度', icon: '🚓', cost: 0, cool: 4, radius: 15,
    color: 0x4d8ff0, kind: 'deploy',
    desc: '从最近的警察局调现有警员过去（真实的人，不凭空生成、也不补弹药）；所里没人就调不动',
    apply: (s, x, z) => {
      const r = s.dispatchPolice(x, z, 6);
      s.lastDispatch = r;
      return r;
    },
  },
  {
    id: 'soldier', name: '空降兵', icon: '🪂', cost: 600000, cool: 20, radius: 18,
    color: 0x9ecb6a, kind: 'deploy',
    desc: '运输机空投 8 名士兵，自带满弹（步枪 120 发）；弹打光了可以去警局补给',
    apply: (s, x, z) => s.deploy('soldier', x, z, 8),
  },
];
export const TOOL_BY_ID = Object.fromEntries(TOOLS.map(t => [t.id, t]));

// 快捷键：V = 查看；1-9 0 - = 对应其余 12 个
export const HOTKEYS = {
  KeyV: 'select',
  Digit1: 'police', Digit2: 'soldier',
};

// ¥ 显示：30000 -> "3万"，520000 -> "52万"，1000000 -> "100万"
export function fmtWan(v) {
  if (v <= 0) return '免费';
  if (v >= 10000) {
    const w = v / 10000;
    return (w >= 100 ? Math.round(w) : Math.round(w * 10) / 10) + '万';
  }
  return String(v);
}

export function fmtMoney(v) {
  return '¥' + Math.round(v).toLocaleString('zh-CN');
}
