// ============================================================
//  ZOS-R · 背景音乐播放器
//   · 5 首曲子放在 assets/audio/bgm/，默认开启、随机顺序、循环播放
//   · 浏览器禁止无交互自动播放：首次点击/按键时才真正开始
//   · 右上「爆发参数 → 音乐」里有 播放/暂停、下一首、音量、当前曲名
//   · 开关与音量记在 localStorage
// ============================================================

export const TRACKS = [
  { id: 'census',    title: '清点人口',   file: 'assets/audio/bgm/bgm_census.mp3' },
  { id: 'hospital',  title: '医院，医院', file: 'assets/audio/bgm/bgm_hospital.mp3' },
  { id: 'ataxia',    title: '肢体失调',   file: 'assets/audio/bgm/bgm_ataxia.mp3' },
  { id: 'wasteland', title: '荒原旧调',   file: 'assets/audio/bgm/bgm_wasteland.mp3' },
  { id: 'zero',      title: '零时',       file: 'assets/audio/bgm/bgm_zero.mp3' },
];

const KEY_ON = 'zosr.music.on';
const KEY_VOL = 'zosr.music.vol';

let audio = null;
let order = [];            // 打乱后的曲目下标
let cursor = 0;            // order 里的位置
let enabled = true;
let volume = 0.45;
let started = false;       // 首次用户交互后置 true
let onState = null;        // UI 回调

function shuffle() {
  order = TRACKS.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [order[i], order[j]] = [order[j], order[i]];
  }
  cursor = 0;
}

function currentTrack() {
  if (!order.length) shuffle();
  return TRACKS[order[cursor % order.length]];
}

function ensureAudio() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'auto';
  audio.volume = volume;
  audio.addEventListener('ended', () => { next(); });
  audio.addEventListener('error', () => { next(); });   // 文件缺失就跳过
  return audio;
}

function emit() {
  if (onState) onState({ enabled, playing: !!(audio && !audio.paused), title: currentTrack().title, volume });
}

function playCurrent() {
  const a = ensureAudio();
  const t = currentTrack();
  if (a.src.indexOf(t.file) < 0) a.src = t.file;
  a.volume = volume;
  const pr = a.play();
  if (pr && pr.catch) pr.catch(() => { /* 还没拿到用户手势，等首次交互再放 */ });
  emit();
}

/** 首发：等第一次交互（浏览器自动播放策略） */
function armFirstGesture() {
  if (started) return;
  const go = () => {
    if (started) return;
    started = true;
    window.removeEventListener('pointerdown', go, true);
    window.removeEventListener('keydown', go, true);
    if (enabled) playCurrent();
  };
  window.addEventListener('pointerdown', go, true);
  window.addEventListener('keydown', go, true);
}

export function playCurrentTrack() {
  enabled = true;
  started = true;
  try { localStorage.setItem(KEY_ON, '1'); } catch (e) {}
  playCurrent();
}

export function initMusic(hooks) {
  onState = hooks && hooks.onState;
  try {
    const s = localStorage.getItem(KEY_ON);
    if (s === '0') enabled = false;
    const v = parseFloat(localStorage.getItem(KEY_VOL));
    if (v >= 0 && v <= 1) volume = v;
  } catch (e) { /* 隐私模式忽略 */ }
  shuffle();
  ensureAudio();
  if (enabled) armFirstGesture();
  emit();
}

export function toggleMusic() {
  enabled = !enabled;
  try { localStorage.setItem(KEY_ON, enabled ? '1' : '0'); } catch (e) {}
  const a = ensureAudio();
  if (enabled) {
    started = true;
    playCurrent();
  } else {
    a.pause();
  }
  emit();
  return enabled;
}

export function next() {
  if (!order.length) shuffle();
  cursor = (cursor + 1) % order.length;
  if (cursor === 0) shuffle();          // 一轮播完重新打乱，避免固定顺序
  const a = ensureAudio();
  a.pause();
  if (enabled) playCurrent();
  emit();
}

export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  if (audio) audio.volume = volume;
  try { localStorage.setItem(KEY_VOL, String(volume)); } catch (e) {}
  emit();
}

/** 指定播放某一首（按下标，顺序为 TRACKS 顺序） */
export function playTrack(idx) {
  const t = TRACKS[idx];
  if (!t) return;
  if (!order.length) shuffle();
  const pos = order.indexOf(idx);
  cursor = pos >= 0 ? pos : 0;
  enabled = true;
  try { localStorage.setItem(KEY_ON, '1'); } catch (e) {}
  started = true;
  const a = ensureAudio();
  a.pause();
  a.src = t.file;
  playCurrent();
}

export function musicState() {
  return { enabled, playing: !!(audio && !audio.paused), title: currentTrack().title, volume };
}
