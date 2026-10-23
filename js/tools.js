// ============================================================
//  ZOS-R · 指挥工具表
//  经费单位：人民币（元）。价格按现实量级校准。
// ============================================================

export const TOOLS = [
  {
    id: 'select', name: '查看', icon: '🔍', cost: 0, cool: 0, radius: 0,
    color: 0xffffff, kind: 'select',
    desc: '默认模式：点一个人查看他的档案；点要员（金色）可以重点跟踪',
    apply: () => 0,
  },
  // ---------------- 部署 ----------------
  {
    id: 'police', name: '警力调度', icon: '🚓', cost: 30000, cool: 6, radius: 15,
    color: 0x4d8ff0, kind: 'deploy',
    desc: '从最近的警察局派 6 人，他们真的走过去（没有瞬移）；警局空了就派不出',
    apply: (s, x, z) => {
      const r = s.dispatchPolice(x, z, 6);
      s.lastDispatch = r;
      if (!r.ok) s.budget += 30000;      // 派不出去就不收钱
      return r;
    },
  },
  {
    id: 'swat', name: '特警小队', icon: '🛡️', cost: 120000, cool: 14, radius: 15,
    color: 0x7aa7ff, kind: 'deploy',
    desc: '4 名特警：装备与训练成本高，命中 55%、80 发弹',
    apply: (s, x, z) => s.deploy('swat', x, z, 4),
  },
  {
    id: 'soldier', name: '伞兵班', icon: '🪖', cost: 600000, cool: 20, radius: 18,
    color: 0x9ecb6a, kind: 'deploy',
    desc: '运输机空投 8 名士兵（含飞行小时费）：命中 65%，最强单位',
    apply: (s, x, z) => s.deploy('soldier', x, z, 8),
  },
  // ---------------- 救援 ----------------
  {
    id: 'heli', name: '直升机撤离', icon: '🚁', cost: 380000, cool: 18, radius: 48,
    color: 0x49e0c0, kind: 'rescue',
    desc: '一架次救援直升机（燃油+机组+维护），降落 3 秒接走半径内平民',
    apply: (s, x, z) => s.helicopter(x, z),
  },
  {
    id: 'rally', name: '疏散广播', icon: '📢', cost: 24000, cool: 16, radius: 120,
    color: 0x5ee07a, kind: 'rescue',
    desc: '启用应急广播系统，引导半径内平民向集结点移动 10 秒',
    apply: (s, x, z) => s.rally(x, z, 120, 10),
  },
  {
    id: 'vaccine', name: '疫苗空投', icon: '💉', cost: 900000, cool: 30, radius: 80,
    color: 0x62d7ff, kind: 'rescue',
    desc: '空运一批抗病毒血清（研发+冷链+投放），治愈范围内所有潜伏者',
    apply: (s, x, z) => s.vaccine(x, z, 80),
  },
  // ---------------- 打击 ----------------
  {
    id: 'drone', name: '无人机打击', icon: '🎯', cost: 60000, cool: 4, radius: 18,
    color: 0xffc04a, kind: 'strike',
    desc: '一架察打一体无人机（机体折旧+一枚小型弹药），半径 18m',
    apply: (s, x, z) => s.strike(x, z, 18),
  },
  {
    id: 'strike', name: '空袭 Mk82', icon: '💣', cost: 520000, cool: 10, radius: 45,
    color: 0xff6b52, kind: 'strike',
    desc: 'A-10 出击 + 一枚 500 磅航弹（飞行小时费约 14 万/时 + 弹体）',
    apply: (s, x, z) => s.strike(x, z, 45),
  },
  {
    id: 'napalm', name: '燃烧弹', icon: '🔥', cost: 640000, cool: 16, radius: 38,
    color: 0xff8a3d, kind: 'strike',
    desc: '凝固汽油弹空投，火区持续 12 秒，丧尸进去就被烧',
    apply: (s, x, z) => s.fire(x, z, 38, 12),
  },
  // ---------------- 控制 ----------------
  {
    id: 'barricade', name: '路障封锁', icon: '🚧', cost: 45000, cool: 8, radius: 30,
    color: 0xc0c6cf, kind: 'control',
    desc: '工程车 + 警力封一段 60m 的街（真改导航栅格），丧尸绕不过去',
    apply: (s, x, z, ctx) => s.barricade(x, z, ctx.angle),
  },
  {
    id: 'siren', name: '警报诱饵', icon: '📣', cost: 18000, cool: 12, radius: 200,
    color: 0xff9ad5, kind: 'control',
    desc: '拉响防空警报（一套移动警报车），把半径 200m 内的丧尸引过来',
    apply: (s, x, z) => s.siren(x, z, 200, 10),
  },
  {
    id: 'ammo', name: '弹药补给', icon: '📦', cost: 30000, cool: 10, radius: 100,
    color: 0xf2d24a, kind: 'control',
    desc: '一批补给送到前线，给范围内警察/士兵/武装平民补满弹匣',
    apply: (s, x, z) => s.resupply(x, z, 100),
  },
];

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map(t => [t.id, t]));

// 快捷键：V = 查看；1-9 0 - = 对应其余 12 个
export const HOTKEYS = {
  KeyV: 'select',
  Digit1: 'police', Digit2: 'swat', Digit3: 'soldier',
  Digit4: 'heli', Digit5: 'rally', Digit6: 'vaccine',
  Digit7: 'drone', Digit8: 'strike', Digit9: 'napalm',
  Digit0: 'barricade', Minus: 'siren', Equal: 'ammo',
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
