// ============================================================
//  ZOS-R · 程序化音频
//  全部用 WebAudio 合成，不加载任何素材（零包体、零版权）
// ============================================================

const RANGE = 950;      // 超过这个距离听不到
const MAX_VOICE = 14;   // 每帧最多同时触发多少个事件音

export class AudioEngine {
  constructor() {
    this.ok = false;
    this.muted = false;
    this.voices = 0;
    this.rr = 0;             // 累计随机
    this.listener = { x: 0, z: 0, rx: 1, rz: 0 };
    this.lastCrackle = 0;
    this.sirenNode = null;
    this.rotorNode = null;
  }

  init() {
    if (this.ok) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      this.ctx = new AC();
    } catch (e) {
      return false;
    }
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.75;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.18;

    this.bus = ctx.createGain();
    this.bus.gain.value = 1;
    this.bus.connect(this.comp);
    this.comp.connect(this.master);
    this.master.connect(ctx.destination);

    // 白噪声缓冲（所有噪声类音效共用）
    const len = Math.floor(ctx.sampleRate * 2);
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // 环境底噪（远处的城市/风）
    this.ambient = ctx.createGain();
    this.ambient.gain.value = 0.055;
    const amb = ctx.createBufferSource();
    amb.buffer = this.noiseBuf;
    amb.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 380;
    amb.connect(lp).connect(this.ambient).connect(this.bus);
    amb.start();

    // 直升机旋翼（常驻，增益随距离变化）
    this.rotorNode = this._makeRotor();
    // 警报（常驻，默认静音）
    this.sirenNode = this._makeSiren();

    this.ok = true;
    return true;
  }

  setMuted(m) {
    this.muted = m;
    if (this.ok) this.master.gain.setTargetAtTime(m ? 0 : 0.75, this.ctx.currentTime, 0.05);
  }

  // 主循环每帧调用：cs = 相机位置, right = 相机右方向
  setView(cx, cz, rx, rz) {
    this.listener.x = cx; this.listener.z = cz;
    this.listener.rx = rx; this.listener.rz = rz;
  }

  _chain(gain, pan, cut) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cut;
    g.connect(f);
    f.connect(p);
    p.connect(this.bus);
    return g;
  }

  _spatial(x, z) {
    const L = this.listener;
    const dx = x - L.x, dz = z - L.z;
    const d = Math.hypot(dx, dz);
    const k = Math.max(0, 1 - d / RANGE);
    return {
      d,
      gain: k * k,
      pan: d > 1 ? ((dx * L.rx + dz * L.rz) / d) * 0.8 : 0,
      cut: Math.max(240, Math.min(16000, 20000 / (1 + d / 55))),
    };
  }

  _noise(dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.playbackRate.value = 0.8 + Math.random() * 0.5;
    s.__dur = dur;
    return s;
  }

  // ---------- 单次音效 ----------
  play(type, x, z, vol = 1, indoor = false) {
    if (!this.ok || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const sp = this._spatial(x, z);
    if (indoor) { sp.gain *= 0.45; sp.cut = Math.min(sp.cut, 2200); }   // 隔着墙/在屋里：闷且小
    if (sp.gain < 0.004) return;
    const g = Math.min(1.6, sp.gain * vol);
    const out = this._chain(g, sp.pan, sp.cut);

    if (type === 'reload') {
      // 机械咔嗒：两下短促的高频噪声
      for (let k = 0; k < 2; k++) {
        const n = this._noise(0.05);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 2600 + k * 900; bp.Q.value = 2.2;
        const gg = ctx.createGain();
        gg.gain.setValueAtTime(0.55, t + k * 0.11);
        gg.gain.exponentialRampToValueAtTime(0.001, t + k * 0.11 + 0.05);
        n.connect(bp).connect(gg).connect(out);
        n.start(t + k * 0.11); n.stop(t + k * 0.11 + 0.06);
      }
      return;
    }
    if (type === 'shot') {
      const n = this._noise(0.12);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1500 + Math.random() * 1200; bp.Q.value = 0.7;
      const gg = ctx.createGain();
      gg.gain.setValueAtTime(0.9, t);
      gg.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
      n.connect(bp).connect(gg).connect(out);
      n.start(t); n.stop(t + 0.13);

      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(180, t);
      o.frequency.exponentialRampToValueAtTime(48, t + 0.09);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.55, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      o.connect(og).connect(out);
      o.start(t); o.stop(t + 0.12);

    } else if (type === 'hit') {
      const n = this._noise(0.06);
      const hp = ctx.createBiquadFilter();
      hp.type = 'bandpass'; hp.frequency.value = 4200; hp.Q.value = 1.4;
      const gg = ctx.createGain();
      gg.gain.setValueAtTime(0.5, t);
      gg.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      n.connect(hp).connect(gg).connect(out);
      n.start(t); n.stop(t + 0.07);

    } else if (type === 'scream') {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const base = 420 + Math.random() * 320;
      o.frequency.setValueAtTime(base, t);
      o.frequency.linearRampToValueAtTime(base * 1.9, t + 0.09);
      o.frequency.exponentialRampToValueAtTime(base * 0.55, t + 0.62);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = base * 2.2; bp.Q.value = 3.2;
      const gg = ctx.createGain();
      gg.gain.setValueAtTime(0.001, t);
      gg.gain.linearRampToValueAtTime(0.42, t + 0.05);
      gg.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
      o.connect(bp).connect(gg).connect(out);
      o.start(t); o.stop(t + 0.7);

    } else if (type === 'groan') {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const base = 78 + Math.random() * 46;
      o.frequency.setValueAtTime(base, t);
      o.frequency.linearRampToValueAtTime(base * 0.72, t + 0.85);
      const lfo = ctx.createOscillator();
      lfo.type = 'sine'; lfo.frequency.value = 4.2 + Math.random() * 2;
      const lg = ctx.createGain(); lg.gain.value = base * 0.09;
      lfo.connect(lg).connect(o.frequency);
      const bp = ctx.createBiquadFilter();
      bp.type = 'lowpass'; bp.frequency.value = 520; bp.Q.value = 4;
      const gg = ctx.createGain();
      gg.gain.setValueAtTime(0.001, t);
      gg.gain.linearRampToValueAtTime(0.3, t + 0.12);
      gg.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      o.connect(bp).connect(gg).connect(out);
      o.start(t); o.stop(t + 0.95);
      lfo.start(t); lfo.stop(t + 0.95);

    } else if (type === 'bite') {
      const n = this._noise(0.09);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.setValueAtTime(2600, t);
      lp.frequency.exponentialRampToValueAtTime(300, t + 0.09);
      const gg = ctx.createGain();
      gg.gain.setValueAtTime(0.6, t);
      gg.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      n.connect(lp).connect(gg).connect(out);
      n.start(t); n.stop(t + 0.1);

    } else if (type === 'boom') {
      const n = this._noise(1.1);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2200, t);
      lp.frequency.exponentialRampToValueAtTime(90, t + 0.9);
      const gg = ctx.createGain();
      gg.gain.setValueAtTime(1.0, t);
      gg.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
      n.connect(lp).connect(gg).connect(out);
      n.start(t); n.stop(t + 1.2);

      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(90, t);
      o.frequency.exponentialRampToValueAtTime(26, t + 0.7);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.75, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
      o.connect(og).connect(out);
      o.start(t); o.stop(t + 0.9);

    } else if (type === 'crackle') {
      const n = this._noise(0.05);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 900 + Math.random() * 2600; bp.Q.value = 2;
      const gg = ctx.createGain();
      gg.gain.setValueAtTime(0.25, t);
      gg.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      n.connect(bp).connect(gg).connect(out);
      n.start(t); n.stop(t + 0.05);
    }
  }

  // ---------- 常驻音源 ----------
  _makeRotor() {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420;
    // 17Hz 的"突突突"幅度调制
    const am = ctx.createGain();
    am.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = 'square'; lfo.frequency.value = 17;
    const lg = ctx.createGain(); lg.gain.value = 0.5;
    lfo.connect(lg).connect(am.gain);
    const out = ctx.createGain();
    out.gain.value = 0;
    n.connect(lp).connect(am).connect(out).connect(this.bus);
    n.start(); lfo.start();
    return out;
  }

  _makeSiren() {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 700;
    const lfo = ctx.createOscillator();
    lfo.type = 'triangle'; lfo.frequency.value = 1.6;
    const lg = ctx.createGain(); lg.gain.value = 220;
    lfo.connect(lg).connect(o.frequency);
    const out = ctx.createGain();
    out.gain.value = 0;
    o.connect(out).connect(this.bus);
    o.start(); lfo.start();
    return out;
  }

  // 每帧：处理事件 + 更新常驻音源
  frame(sim) {
    if (!this.ok || !sim) return;
    const t = this.ctx.currentTime;

    // ---- 一次性事件：按距离排序，只播最近的若干个 ----
    const ev = sim.audio;
    if (ev.length) {
      const L = this.listener;
      for (const e of ev) {
        const dx = e.x - L.x, dz = e.z - L.z;
        e.__d = dx * dx + dz * dz;
      }
      ev.sort((a, b) => a.__d - b.__d);
      const n = Math.min(MAX_VOICE, ev.length);
      const nav = sim.nav;
      for (let i = 0; i < n; i++) {
        const ind = !!(nav && nav.indoor && nav.indoor(ev[i].x, ev[i].z));
        this.play(ev[i].type, ev[i].x, ev[i].z, ev[i].g, ind);
      }
      ev.length = 0;
    }

    // ---- 环境呻吟：附近丧尸密度越高，补得越勤（原来只有"变丧尸/起身"才有一声）----
    if (t >= (this.groanT || 0)) {
      const L2 = this.listener;
      let picked = -1, best = 0, cnt = 0;
      for (let i = 0; i < sim.n; i++) {
        if (sim.state[i] !== 4) continue;               // ST.ZOMBIE
        const dx = sim.px[i] - L2.x, dz = sim.pz[i] - L2.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 90 * 90) continue;   // 90m：再远就是"看不见的地方在响"
        cnt++;
        if (Math.random() < 0.02) { picked = i; best = d2; }   // 随机挑一个
      }
      if (picked >= 0) {
        this.play('groan', sim.px[picked], sim.pz[picked], 0.45 + Math.random() * 0.3);
      }
      // 密度映射：0 只 → 2.6 s 一次；50 只 → 约 0.35 s 一次
      this.groanT = t + Math.max(0.35, 2.6 / (1 + cnt * 0.06));
    }

    // ---- 旋翼：跟随最近的一架 ----
    if (this.rotorNode) {
      let best = null, bd = Infinity;
      for (const h of sim.helis) {
        const dx = h.x - this.listener.x, dz = h.z - this.listener.z;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = h; }
      }
      if (best) {
        const d = Math.sqrt(bd);
        const k = Math.max(0, 1 - d / RANGE);
        const sp = this._spatial(best.x, best.z);
        this.rotorNode.gain.setTargetAtTime(0.55 * k * k, t, 0.08);
        if (this.rotorNode.__pan === undefined) this.rotorNode.__pan = true;
        // 旋翼不做左右声道跟随，避免频繁重连
      } else {
        this.rotorNode.gain.setTargetAtTime(0, t, 0.15);
      }
    }

    // ---- 警报：有 siren 效果就响 ----
    if (this.sirenNode) {
      let s = null;
      for (const e of sim.effects) if (e.type === 'siren') { s = e; break; }
      if (s) {
        const sp = this._spatial(s.x, s.z);
        this.sirenNode.gain.setTargetAtTime(0.30 * sp.gain, t, 0.1);
      } else {
        this.sirenNode.gain.setTargetAtTime(0, t, 0.2);
      }
    }

    // ---- 火区噼啪声 ----
    const fire = sim.effects.find(e => e.type === 'fire');
    const nowMs = performance.now();
    if (fire && nowMs - this.lastCrackle > 110) {
      this.lastCrackle = nowMs;
      const a = Math.random() * 6.2832, r = Math.sqrt(Math.random()) * fire.r;
      this.play('crackle', fire.x + Math.cos(a) * r, fire.z + Math.sin(a) * r, 0.7);
    }
  }
}


