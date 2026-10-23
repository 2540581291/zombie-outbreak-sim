// ============================================================
//  城市数据统一入口（给 tools/ 下的脚本用）
//
//  烘焙产物在 data/cities/<id>/city.json（多城市重构后，不再是 data/city.json）。
//  默认读 berlin；换城市：
//      ZOS_CITY=tokyo node tools/test_nav.mjs
//  列出已有城市：data/cities/index.json
// ============================================================
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

/** 仓库根目录（tools/ 的上一级） */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 已知城市 id 列表（读 index.json，读不到就只返回 default） */
export function cityIds() {
  const idx = join(ROOT, 'data', 'cities', 'index.json');
  try {
    return JSON.parse(readFileSync(idx, 'utf8')).map((c) => c.id);
  } catch {
    return ['berlin'];
  }
}

/** 当前选中的城市 id：ZOS_CITY > 默认 berlin */
export function cityId() {
  return process.env.ZOS_CITY || 'berlin';
}

/**
 * 读入 city.json，返回解析后的对象。
 * 找不到文件时打印清晰提示并退出（避免每个脚本各自抛 ENOENT 栈）。
 */
export function loadCity(id = cityId()) {
  const p = join(ROOT, 'data', 'cities', id, 'city.json');
  if (!existsSync(p)) {
    console.error(`[city] 找不到城市数据：${p}`);
    console.error(`       先跑 pipeline/bake_pbf.py 烘焙；或指定已有城市：ZOS_CITY=<id> node ...`);
    console.error(`       现有城市：${cityIds().join(', ')}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}
