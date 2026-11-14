/* 효과음·배경음악 — 음원 파일 없이 브라우저가 직접 연주합니다(Web Audio). 저작권 걱정 없음.
   - 악기: 일렉트릭 피아노(FM)·피아노·현악 합주·금관·합창·하프·첼레스타·베이스·드럼(킥·스네어·박수·하이햇·심벌·팀파니·북)
   - 분위기 5가지: pop(신나게) · epic(웅장하게) · calm(잔잔하게) · dream(몽환적으로) · waltz(왈츠)
   - 출석률(energy)에 따라 악기가 한 층씩 더해지며 고조되고, 8마디마다 코드·조·멜로디가 바뀝니다
   - Sound.sfx('arrive'|'dept'|'milestone'|'finale'|'land'|'phone', 옵션)
   - 브라우저 정책상 처음 한 번은 사람이 눌러야 소리가 납니다("소리 켜기" 버튼) */
(function (g) {
  'use strict';
  const hz = n => 440 * Math.pow(2, (n - 69) / 12);
  const rnd = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const STYLES = ['pop', 'epic', 'calm', 'dream', 'waltz'];
  const OF_THEME = { card: 'pop', apartment: 'pop', led: 'pop', train: 'pop', memo: 'calm', chalk: 'calm', forest: 'calm', garden: 'pop', star: 'dream', ocean: 'dream', lantern: 'dream', plaque: 'epic' };
  const styleOf = th => STYLES.includes(th) ? th : (OF_THEME[th] || 'pop');

  function Engine(ctx, out) {
    const E = this; E.ctx = ctx; E.theme = 'pop'; E.energy = 0.3; E.last = {};
    const SR = ctx.sampleRate;

    /* ---------- 믹서: 음악·효과음 → 잔향(방·홀) → 압축 → 출력 ---------- */
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 3.5; comp.attack.value = 0.006; comp.release.value = 0.2;
    const master = ctx.createGain(); master.gain.value = 0.9; master.connect(comp); comp.connect(out);
    E.bus = master;
    const makeIR = (sec, decay, pre, dark) => {
      const len = Math.floor(SR * sec), b = ctx.createBuffer(2, len, SR);
      for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c); let y = 0;
        for (let i = 0; i < len; i++) {
          if (i < pre * SR) { d[i] = 0; continue; }
          const x = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
          const a = 1 - dark * (i / len); y += a * (x - y); d[i] = y;   // 시간이 갈수록 높은음이 먼저 사라지는 자연스러운 잔향
        }
      }
      return b;
    };
    const mkRev = (ir, level) => { const cv = ctx.createConvolver(); cv.buffer = ir; const gn = ctx.createGain(); gn.gain.value = level; cv.connect(gn); gn.connect(master); return cv; };
    const ROOM = mkRev(makeIR(1.1, 3.2, 0.008, 0.6), 0.5);
    const HALL = mkRev(makeIR(2.6, 2.4, 0.025, 0.85), 0.62);
    E.bgm = ctx.createGain(); E.bgm.gain.value = 0.55; E.bgm.connect(master);
    E.sfxo = ctx.createGain(); E.sfxo.gain.value = 0.9; E.sfxo.connect(master);
    let REV = ROOM;   // 분위기마다 바뀜(웅장·몽환은 홀)

    const NB = ctx.createBuffer(1, SR * 2, SR), nd = NB.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    // 공용 비브라토(현악·합창이 함께 씀 — 음마다 따로 만들면 무거워짐)
    const VIB = ctx.createOscillator(); VIB.frequency.value = 5.1; VIB.start();
    const VIB7 = ctx.createGain(); VIB7.gain.value = 7; VIB.connect(VIB7);
    // 드럼·심벌은 미리 한 번 만들어 둔 소리(버퍼)를 틀기만 한다 → 가볍다
    const mkBuf = (sec, fn) => { const len = Math.floor(SR * sec), b = ctx.createBuffer(1, len, SR), d = b.getChannelData(0); fn(d, len); return b; };
    const METALF = [205.3, 304.4, 369.6, 522.7, 540, 800];
    const metal = (sec, mul, tau, hpA) => mkBuf(sec, (d, len) => {
      let prev = 0, y = 0;
      for (let i = 0; i < len; i++) {
        const tt = i / SR; let x = 0; for (const f of METALF) x += ((tt * f * mul) % 1) < 0.5 ? 1 : -1;
        x = x / 6 * 0.6 + (Math.random() * 2 - 1) * 0.4; y = hpA * (y + x - prev); prev = x;   // 고역 통과
        d[i] = y * Math.exp(-tt / tau);
      }
    });
    const BUF = {
      hat: metal(0.12, 1.4, 0.02, 0.6), ohat: metal(0.6, 1.4, 0.13, 0.6), crash: metal(3.2, 2.3, 0.75, 0.5),
      kick: mkBuf(0.6, (d, len) => { let ph = 0; for (let i = 0; i < len; i++) { const tt = i / SR, f = 46 + 109 * Math.exp(-tt / 0.035); ph += 2 * Math.PI * f / SR; d[i] = Math.sin(ph) * Math.exp(-tt / 0.13) * 0.95 + (tt < 0.004 ? (Math.random() * 2 - 1) * 0.3 * (1 - tt / 0.004) : 0); } }),
      shaker: mkBuf(0.09, (d, len) => { let p1 = 0, p2 = 0, y = 0; for (let i = 0; i < len; i++) { const tt = i / SR, x = Math.random() * 2 - 1; y = 0.55 * (y + x - p1); p1 = x; const e = tt < 0.018 ? tt / 0.018 : Math.exp(-(tt - 0.018) / 0.022); d[i] = y * e * 0.6; } }),
      clap: mkBuf(0.3, (d, len) => { let p1 = 0, y = 0, z = 0; for (let i = 0; i < len; i++) { const tt = i / SR, x = Math.random() * 2 - 1; y = 0.82 * (y + x - p1); p1 = x; z += 0.35 * (y - z); const burst = [0, 0.011, 0.022].some(b0 => tt >= b0 && tt < b0 + 0.008) ? 1 : 0; d[i] = z * (burst * 0.9 + (tt > 0.03 ? Math.exp(-(tt - 0.03) / 0.06) * 0.7 : 0)); } }),
      snare: mkBuf(0.35, (d, len) => { let prev = 0, y = 0; for (let i = 0; i < len; i++) { const tt = i / SR, x = Math.random() * 2 - 1; y = 0.75 * (y + x - prev); prev = x; d[i] = y * 0.55 * Math.exp(-tt / 0.065) + 0.4 * Math.sin(2 * Math.PI * 185 * tt) * Math.exp(-tt / 0.03) + 0.2 * Math.sin(2 * Math.PI * 330 * tt) * Math.exp(-tt / 0.02); } })
    };
    const playBuf = (D, buf, t, v, o = {}) => { const s = ctx.createBufferSource(); s.buffer = buf; if (o.rate) s.playbackRate.value = o.rate; const gn = ctx.createGain(); gn.gain.value = v; s.connect(gn); gn.connect(outlet(D, o.pan || 0, o.wet || 0)); s.start(t); };

    // 한 소리의 출구: 음량 → 좌우 위치 → (원음 + 잔향)
    // 좌우 위치는 미리 만든 5자리(왼쪽 끝~오른쪽 끝) 중 가까운 곳으로 → 음마다 패너를 만들지 않아 가볍다
    const PANS = [-0.6, -0.3, 0, 0.3, 0.6], panBus = new Map();
    const busOf = (dest, pan) => {
      const k = PANS.reduce((a, b) => Math.abs(b - pan) < Math.abs(a - pan) ? b : a), key = dest === E.bgm ? 'b' + k : dest === E.sfxo ? 's' + k : null;
      if (!key || !ctx.createStereoPanner || k === 0) return dest;
      let n = panBus.get(key); if (!n) { n = ctx.createStereoPanner(); n.pan.value = k; n.connect(dest); panBus.set(key, n); } return n;
    };
    const outlet = (dest, pan = 0, wet = 0.2, rev) => {
      const v = ctx.createGain(); v.connect(busOf(dest, pan));
      if (wet > 0) { const s = ctx.createGain(); s.gain.value = wet; v.connect(s); s.connect(rev || REV); }
      return v;
    };
    const osc = (type, f, t, stop) => { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(stop); return o; };
    const lp = (f, q = 0.7, type = 'lowpass') => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    const env = (p, t, a, peak, dec, sus, end, rel) => {   // ADSR
      p.setValueAtTime(0.0001, t); p.linearRampToValueAtTime(peak, t + a);
      if (dec > 0) p.setTargetAtTime(Math.max(0.0001, peak * sus), t + a, dec / 3);
      p.setTargetAtTime(0.0001, Math.max(t + a, end), rel / 4);
    };
    const hum = t => Math.max(0, t + (Math.random() - 0.5) * 0.012);      // 사람이 치는 듯 살짝 어긋나게
    const vel = v => v * (0.88 + Math.random() * 0.24);

    /* ---------- 악기 ---------- */
    /* 튕기고 치는 악기는 음 하나를 한 번만 계산해 소리(버퍼)로 만들어 두고 다시 쓴다 → 화면이 무거워지지 않음.
       2반음 간격으로 만들고 나머지는 재생 속도로 맞춘다 */
    const SSR = 24000, CACHE = new Map();
    const sample = (kind, n, sec, gen) => {
      const base = Math.round(n / 2) * 2, key = kind + base;
      let b = CACHE.get(key);
      if (!b) { const len = Math.floor(SSR * sec); b = ctx.createBuffer(1, len, SSR); gen(b.getChannelData(0), len, hz(base)); CACHE.set(key, b); }
      return { b, rate: Math.pow(2, (n - base) / 12) };
    };
    const TAU = 2 * Math.PI;
    const GEN = {
      piano: (d, len, f) => {   // 배음 5개(살짝 어긋남) + 해머 + 점점 어두워짐
        const P = []; for (let k = 1; k <= 5; k++) { const fk = f * k * (1 + 0.0004 * k * k); if (fk < SSR / 2.2) P.push([fk, 1 / Math.pow(k, 1.35), (2.6 - Math.min(1.8, f / 900)) / k]); }
        for (let i = 0; i < len; i++) { const t = i / SSR; let x = 0; for (const [fk, a, tau] of P) x += a * Math.sin(TAU * fk * t) * Math.exp(-t / tau); if (t < 0.01) x += (Math.random() * 2 - 1) * 0.08 * (1 - t / 0.01); d[i] = x * 0.5 * Math.min(1, t / 0.002); }
      },
      epiano: (d, len, f) => {   // 로즈: FM(따뜻한 몸통) + 금속성 '팅'
        for (let i = 0; i < len; i++) { const t = i / SSR, I = 0.25 + 1.0 * Math.exp(-t / 0.25); d[i] = (Math.sin(TAU * f * t + I * Math.sin(TAU * f * t)) * Math.exp(-t / 1.4) + (f * 7.05 < SSR / 2.2 ? 0.12 * Math.sin(TAU * f * 7.05 * t) * Math.exp(-t / 0.05) : 0)) * Math.min(1, t / 0.003); }
      },
      celesta: (d, len, f) => {
        const P = [[1, 1, 0.9], [4, 0.25, 0.25], [9.1, 0.06, 0.08]].filter(([m]) => f * m < SSR / 2.2);
        for (let i = 0; i < len; i++) { const t = i / SSR; let x = 0; for (const [m, a, l] of P) x += a * Math.sin(TAU * f * m * t) * Math.exp(-t / l); d[i] = x * Math.min(1, t / 0.002); }
      },
      harp: (d, len, f) => {
        for (let i = 0; i < len; i++) { const t = i / SSR, ph = (f * t) % 1, tri = 4 * Math.abs(ph - 0.5) - 1; d[i] = (tri * 0.8 + 0.3 * Math.sin(TAU * 2 * f * t) * Math.exp(-t / 0.3)) * Math.exp(-t / 0.55) * Math.min(1, t / 0.003); }
      },
      pluck: (d, len, f) => {   // 밝게 튕긴 뒤 빨리 둥글어지는 줄 소리
        let y = 0; for (let i = 0; i < len; i++) { const t = i / SSR, x = ((f * t) % 1) * 2 - 1 + (((f * 1.007 * t) % 1) * 2 - 1); const c = Math.min(1, (700 + 4500 * Math.exp(-t / 0.09)) * TAU / SSR); y += c * (x - y); d[i] = y * 0.5 * Math.exp(-t / 0.25) * Math.min(1, t / 0.002); }
      },
      bass: (d, len, f) => {
        let y = 0; for (let i = 0; i < len; i++) { const t = i / SSR, saw = ((f * t) % 1) * 2 - 1, c = Math.min(1, (320 + 700 * Math.exp(-t / 0.08)) * TAU / SSR); y += c * (saw - y); d[i] = (Math.sin(TAU * f * t) + 0.35 * y) * (0.6 + 0.4 * Math.exp(-t / 0.15)) * Math.exp(-t / 2.5) * Math.min(1, t / 0.004); }
      }
    };
    const SEC = { piano: 2.4, epiano: 2, celesta: 1.6, harp: 1.8, pluck: 1, bass: 3.4 };
    const playNote = (kind, D, n, t, dur, v, pan, wet, rel = 0.3) => {
      const { b, rate } = sample(kind, n, SEC[kind], GEN[kind]), s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
      const gn = ctx.createGain(), end = Math.min(t + dur, t + SEC[kind] / rate);
      gn.gain.setValueAtTime(v, t); gn.gain.setTargetAtTime(0.0001, end, rel / 4);
      s.connect(gn); gn.connect(outlet(D, pan, wet)); s.start(t); s.stop(Math.min(t + SEC[kind] / rate, end + rel + 0.05));
    };
    const epiano = (D, n, t, dur, v = 0.5, o = {}) => playNote('epiano', D, n, t, dur + 0.3, v * 0.3, o.pan || 0, o.wet == null ? 0.25 : o.wet, 0.5);
    const piano = (D, n, t, dur, v = 0.5, o = {}) => playNote('piano', D, n, t, dur + 0.15, v * 0.5, o.pan == null ? (n - 64) / 40 : o.pan, o.wet == null ? 0.22 : o.wet, 0.45);
    // 현악 합주: 톱니파 5개를 조금씩 어긋나게 + 비브라토 + 부드러운 필터 / short=스타카토
    const strBus = new Map();   // 현악은 같은 필터·좌우 퍼짐을 함께 씀
    const strIn = (D, short, wet) => {
      const key = (D === E.bgm ? 'b' : 's') + (short ? 's' : 'l') + (wet > 0.4 ? 'w' : '');
      let n = strBus.get(key); if (n) return n;
      n = ctx.createGain(); const f = lp(short ? 3400 : 2300, 0.6); n.connect(f);
      const L = outlet(D, -0.6, wet), R = outlet(D, 0.6, wet), C = outlet(D, 0, wet * 0.5); f.connect(L); f.connect(R); f.connect(C);
      strBus.set(key, n); return n;
    };
    const strings = (D, n, t, dur, v = 0.4, o = {}) => {
      const f = hz(n), short = !!o.short, a = o.a == null ? (short ? 0.012 : 0.35) : o.a, r = o.r == null ? (short ? 0.12 : 0.9) : o.r, end = t + dur, stop = end + r + 0.2;
      const amp = ctx.createGain(); env(amp.gain, t, a, v * (short ? 0.06 : 0.05), short ? 0.08 : 0, short ? 0.3 : 1, end, r); amp.connect(strIn(D, short, o.wet == null ? 0.35 : o.wet));
      (short ? [-8, 8] : [-12, 0, 11]).forEach(c => { const o2 = osc('sawtooth', f, t, stop); o2.detune.value = c + (Math.random() - 0.5) * 4; if (!short) VIB7.connect(o2.detune); o2.connect(amp); });
    };
    // 금관(호른·트럼펫): 소리가 부풀어 오르는 필터 + 살짝 아래에서 올라가는 음정
    const brass = (D, n, t, dur, v = 0.5, o = {}) => {
      const f = hz(n), end = t + dur, stop = end + 0.6, out2 = outlet(D, o.pan || 0, o.wet == null ? 0.32 : o.wet);
      const flt = lp(300, 1.2); flt.frequency.setValueAtTime(300, t); flt.frequency.linearRampToValueAtTime(700 + 3200 * v, t + 0.09); flt.frequency.setTargetAtTime(500 + 1800 * v, t + 0.12, 0.3); flt.connect(out2);
      const amp = ctx.createGain(); env(amp.gain, t, 0.045, v * 0.13, 0.4, 0.75, end, 0.35); amp.connect(flt);
      [-5, 6].forEach(c => { const o2 = osc('sawtooth', f * 0.97, t, stop); o2.frequency.exponentialRampToValueAtTime(f, t + 0.06); o2.detune.value = c; o2.connect(amp); });
    };
    // 합창 '아—': 톱니파를 모음 공명(포먼트) 필터에 통과
    const choirBus = new Map();
    const choirIn = D => {
      const key = D === E.bgm ? 'b' : 's'; let n = choirBus.get(key); if (n) return n;
      n = ctx.createGain(); const out2 = outlet(D, 0, 0.6);
      [[800, 6, 1], [1150, 8, 0.5], [2900, 10, 0.22]].forEach(([ff, q, gg]) => { const b = lp(ff, q, 'bandpass'), gn = ctx.createGain(); gn.gain.value = gg; n.connect(b); b.connect(gn); gn.connect(out2); });
      choirBus.set(key, n); return n;
    };
    const choir = (D, n, t, dur, v = 0.4) => {
      const f = hz(n), end = t + dur, stop = end + 1.2, amp = ctx.createGain(); env(amp.gain, t, 0.9, v * 0.16, 0, 1, end, 1.2); amp.connect(choirIn(D));
      [-8, 9].forEach(c => { const o2 = osc('sawtooth', f, t, stop); o2.detune.value = c; VIB7.connect(o2.detune); o2.connect(amp); });
    };
    // 하프·첼레스타·오르골·플럭·베이스 (모두 미리 만든 소리)
    const harp = (D, n, t, v = 0.4, o = {}) => playNote('harp', D, n, t, 1.8, v * 0.24, o.pan == null ? (n - 66) / 36 : o.pan, o.wet == null ? 0.4 : o.wet);
    const celesta = (D, n, t, v = 0.4, o = {}) => playNote('celesta', D, n, t, 1.6, v * 0.2, o.pan == null ? (n - 76) / 30 : o.pan, o.wet == null ? 0.5 : o.wet);
    const pluck = (D, n, t, v = 0.4, o = {}) => playNote('pluck', D, n, t, 1, v * 0.22, o.pan || 0, o.wet == null ? 0.2 : o.wet);
    const bass = (D, n, t, dur, v = 0.5, o = {}) => playNote('bass', D, n, t, dur, v * (o.bright ? 0.5 : 0.45), 0, 0.04, 0.1);
    const noise = (D, t, dur, o = {}) => {
      const { type = 'bandpass', f = 2000, to = 0, q = 0.8, v = 0.2, a = 0.002, pan = 0, wet = 0 } = o;
      const s = ctx.createBufferSource(); s.buffer = NB; s.loop = true; const fl = lp(f, q, type);
      if (to) fl.frequency.exponentialRampToValueAtTime(to, t + dur);
      const gn = ctx.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(v, t + a); gn.gain.setTargetAtTime(0.0001, t + a, Math.max(0.005, (dur - a) / 3));
      s.connect(fl); fl.connect(gn); gn.connect(outlet(D, pan, wet)); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.3);
    };
    // 드럼
    const kick = (D, t, v = 0.6) => playBuf(D, BUF.kick, t, v * 0.9);
    const snare = (D, t, v = 0.4) => playBuf(D, BUF.snare, t, v * 0.6, { wet: 0.15 });
    const clap = (D, t, v = 0.4) => playBuf(D, BUF.clap, t, v * 0.6, { wet: 0.3, pan: (Math.random() - 0.5) * 0.3 });
    const hat = (D, t, v = 0.15, open = false, pan = 0.25) => playBuf(D, open ? BUF.ohat : BUF.hat, t, v * 0.35, { pan, wet: open ? 0.15 : 0.04 });   // 808 방식 금속성 소리
    const shaker = (D, t, v = 0.1, pan = -0.3) => playBuf(D, BUF.shaker, t, v * 0.3, { pan });
    const crash = (D, t, v = 0.3) => playBuf(D, BUF.crash, t, v * 0.3, { pan: 0.15, wet: 0.3 });
    const swell = (D, t, dur, v = 0.25) => {   // 심벌이 차오르는 소리(다음 구간 직전)
      const s = ctx.createBufferSource(); s.buffer = NB; s.loop = true; const hp = lp(3500, 0.5, 'highpass'), gn = ctx.createGain();
      gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(v * 0.25, t + dur); gn.gain.setValueAtTime(0.0001, t + dur + 0.01);
      s.connect(hp); hp.connect(gn); gn.connect(outlet(D, 0, 0.4)); s.start(t); s.stop(t + dur + 0.05);
    };
    const timpani = (D, n, t, v = 0.5) => {
      const f = hz(n), out2 = outlet(D, -0.15, 0.45), amp = ctx.createGain(), o2 = osc('sine', f * 1.02, t, t + 2.5);
      o2.frequency.exponentialRampToValueAtTime(f, t + 0.15); amp.gain.setValueAtTime(0.0001, t); amp.gain.linearRampToValueAtTime(v * 0.6, t + 0.006); amp.gain.setTargetAtTime(0.0001, t + 0.01, 0.45);
      o2.connect(amp); amp.connect(out2);
      const o3 = osc('sine', f * 1.5, t, t + 1), a3 = ctx.createGain(); a3.gain.setValueAtTime(v * 0.12, t); a3.gain.setTargetAtTime(0.0001, t, 0.2); o3.connect(a3); a3.connect(out2);
      noise(D, t, 0.08, { type: 'lowpass', f: 600, v: v * 0.25, wet: 0.3 });
    };
    const tom = (D, f, t, v = 0.5, pan = 0) => {   // 북(태고)
      const out2 = outlet(D, pan, 0.35), amp = ctx.createGain(), o2 = osc('sine', f * 1.6, t, t + 0.9);
      o2.frequency.exponentialRampToValueAtTime(f, t + 0.08); amp.gain.setValueAtTime(0.0001, t); amp.gain.linearRampToValueAtTime(v * 0.75, t + 0.004); amp.gain.setTargetAtTime(0.0001, t + 0.01, 0.16);
      o2.connect(amp); amp.connect(out2); noise(D, t, 0.05, { type: 'lowpass', f: 1200, v: v * 0.3 });
    };

    /* ---------- 화성·멜로디 도구 ---------- */
    const Q = { maj: [0, 4, 7], min: [0, 3, 7], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], dom7: [0, 4, 7, 10], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14], sus4: [0, 5, 7], sus2: [0, 2, 7] };
    const voice = (root, q, lo, hi) => {   // 코드 음을 lo~hi 사이로 펼치기
      const out2 = []; for (let o = -24; o <= 36; o += 12) Q[q].forEach(x => { const n = root + x + o; if (n >= lo && n <= hi) out2.push(n); });
      return [...new Set(out2)].sort((a, b) => a - b);
    };
    const near = (list, target) => list.reduce((a, b) => Math.abs(b - target) < Math.abs(a - target) ? b : a);
    const scale = (root, ints, lo, hi) => { const s = []; for (let o = -36; o <= 48; o += 12) ints.forEach(x => { const n = root + o + x; if (n >= lo && n <= hi) s.push(n); }); return s.sort((a, b) => a - b); };
    const MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10];
    const RHY = {   // 2마디 멜로디 리듬(박 단위 [시작, 길이])
      pop: [[[0, .5], [.5, .5], [1, 1], [2.5, .5], [3, 1]], [[0, 1.5], [1.5, .5], [2, .5], [2.5, 1.5]], [[.5, .5], [1, .5], [1.5, 1], [3, .5], [3.5, .5]], [[0, .75], [.75, .75], [1.5, 1], [2.5, 1.5]]],
      epic: [[[0, 2], [2, 1], [3, 1]], [[0, 3], [3, 1]], [[0, 1.5], [1.5, .5], [2, 2]], [[0, 1], [1, 1], [2, 2]]],
      calm: [[[0, 1.5], [1.5, 1], [2.5, 1.5]], [[.5, 1], [1.5, .5], [2, 2]], [[0, 1], [1.5, 1.5], [3, 1]]],
      dream: [[[0, 2], [2, 2]], [[0, 1], [1, 3]], [[.5, 1.5], [2, 2]]],
      waltz: [[[0, 1], [1, 1], [2, 1]], [[0, 2], [2, 1]], [[0, 1.5], [1.5, .5], [2, 1]], [[0, 3]]]
    };
    // 2마디짜리 동기(모티프)를 만들어 구간 안에서 되풀이·변형 → 기억에 남는 멜로디
    const motifFor = (style, seed) => { const r = rnd(seed); const R = RHY[style]; return { a: R[Math.floor(r() * R.length)], b: R[Math.floor(r() * R.length)], steps: Array.from({ length: 8 }, () => Math.floor(r() * 5) - 2) }; };
    const melodyBar = (style, S, bar, chordRoot, q, lo, hi, scl, play, beat, t) => {
      const M = motifFor(style, S.seed), rh = bar % 2 === 0 ? M.a : M.b, r = rnd(S.seed * 7 + bar * 31);
      const tones = voice(chordRoot, q, lo, hi), sc = scale(S.root, scl, lo, hi);
      let prev = E.last[style] == null ? near(sc, (lo + hi) / 2) : E.last[style];
      rh.forEach(([st, du], j) => {
        let n;
        const strong = st % 1 === 0;
        if (strong) n = near(tones, prev + M.steps[(j + bar) % 8]);
        else { const i = Math.max(0, sc.indexOf(near(sc, prev))); n = sc[Math.max(0, Math.min(sc.length - 1, i + (r() < 0.5 ? 1 : -1)))]; }
        if (bar === 7 && j === rh.length - 1) n = near(voice(chordRoot, 'maj', lo, hi).filter(x => (x - chordRoot) % 12 === 0).concat([n]), prev);   // 구간 끝은 으뜸음 쪽으로
        prev = n; play(n, hum(t + st * beat), du * beat * 0.95, j === 0);
      });
      E.last[style] = prev;
    };
    const section = (i, len, keys, progs, seedBase) => {
      const s = Math.floor(i / len), bar = i % len, cyc = Math.floor(s / progs.length);
      return { s, bar, p: progs[s % progs.length], key: keys[(s + cyc) % keys.length], seed: s * 977 + seedBase };
    };

    /* ---------- 분위기별 작곡 ---------- */
    const B = {};
    // 신나게: 120BPM 팝 — 피아노 리듬 → 셰이커 → 킥·베이스 → 박수·하이햇 → 멜로디 → 현악·금관 + 필인
    const POP_P = [[[0, 'maj'], [7, 'maj'], [9, 'min'], [5, 'maj']], [[5, 'maj'], [7, 'maj'], [4, 'min'], [9, 'min']], [[0, 'maj'], [9, 'min'], [5, 'maj'], [7, 'maj']], [[9, 'min'], [5, 'maj'], [0, 'maj'], [7, 'sus4']]];
    B.pop = { len: 4 * 60 / 120, rev: 'room', fn(i, t) {
      const b = 60 / 120, D = E.bgm, en = E.energy, S = section(i, 8, [0, 2, 5, -2, 3], POP_P, 11); S.root = 60 + S.key;
      const [cr, q] = S.p[S.bar % 4], root = 48 + S.key + cr, brk = S.s % 4 === 3 && S.bar < 2;
      const ch = voice(root + 12, q, 57, 74);
      if (S.bar === 0 && S.s > 0 && en > 0.6) crash(D, t, 0.25 + 0.2 * en);
      // 피아노 반주
      if (en < 0.3) ch.forEach(n => piano(D, n, hum(t), 3.6 * b, vel(0.32)));
      else [0, 1.5, 2.5, 3.5].forEach((bt, k) => ch.forEach(n => piano(D, n, hum(t + bt * b), (k === 0 ? 1.2 : 0.7) * b, vel(k ? 0.32 : 0.42))));
      if (en > 0.15 && !brk) for (let e = 0; e < 8; e++) shaker(D, hum(t + e * b / 2), (e % 2 ? 0.9 : 0.6) * (0.6 + 0.4 * en));
      if (en > 0.3 && !brk) {
        [0, 2, 2.5].forEach(bt => kick(D, t + bt * b, 0.55 + 0.2 * en));
        [0, 1, 1.5, 2, 2.5, 3, 3.5].forEach((bt, k) => bass(D, root - 12 + (k === 2 || k === 5 ? 12 : 0), t + bt * b, 0.4 * b, vel(0.55), { bright: en > 0.6 }));
      }
      if (en > 0.45 && !brk) { [1, 3].forEach(bt => { clap(D, t + bt * b, 0.5); snare(D, t + bt * b, 0.25); }); for (let e = 0; e < 4; e++) hat(D, t + (e + 0.5) * b, 0.4 + 0.2 * en, e === 3); }
      if (en > 0.55) melodyBar('pop', S, S.bar, root, q, 69, 88, MAJ, (n, tt, du, acc) => { epiano(D, n, tt, du, acc ? 0.6 : 0.48, { pan: 0.15, wet: 0.3 }); if (en > 0.8) pluck(D, n + 12, tt, 0.25, { pan: -0.3 }); }, b, t);
      if (en > 0.72) { voice(root + 12, q, 60, 79).forEach(n => strings(D, n, t, 3.8 * b, 0.32)); if (S.bar % 4 === 0) voice(root + 12, q, 55, 72).forEach(n => brass(D, n, t, 0.35 * b, 0.55)); }
      if (en > 0.6 && S.bar === 7) [3, 3.25, 3.5, 3.75].forEach((bt, k) => tom(D, [190, 160, 130, 105][k], t + bt * b, 0.4, (k - 1.5) / 3));
    } };
    // 웅장하게: 84BPM 단조 — 현악 패드 → 스타카토 오스티나토 → 팀파니·호른 → 합창·북 → 금관 멜로디·심벌
    const EPIC_P = [[[0, 'min'], [8, 'maj'], [3, 'maj'], [10, 'maj']], [[0, 'min'], [5, 'min'], [8, 'maj'], [7, 'maj']], [[8, 'maj'], [10, 'maj'], [0, 'min'], [0, 'sus2']], [[0, 'min'], [10, 'maj'], [8, 'maj'], [7, 'sus4']]];
    B.epic = { len: 4 * 60 / 84, rev: 'hall', fn(i, t) {
      const b = 60 / 84, D = E.bgm, en = E.energy, S = section(i, 8, [0, -2, 3, 5, -4], EPIC_P, 23); S.root = 57 + S.key;
      const [cr, q] = S.p[S.bar % 4], root = 45 + S.key + cr;
      strings(D, root - 12, t, 3.9 * b, 0.38 + 0.15 * en, { a: 0.6, pan: -0.1 }); strings(D, root, t, 3.9 * b, 0.3, { a: 0.6 });
      voice(root + 12, q, 60, 76).forEach(n => strings(D, n, t, 3.9 * b, 0.22 + 0.12 * en, { a: 0.8, wet: 0.45 }));
      if (en < 0.35) { const p = voice(root + 24, q, 69, 86); [0, 1, 2, 3].forEach(bt => piano(D, p[bt % p.length], hum(t + bt * b), b * 1.5, vel(0.3), { wet: 0.45 })); }
      if (en > 0.2) { const os = voice(root + 12, q, 55, 72), pat = [0, 2, 1, 2, 0, 2, 1, 3]; for (let e = 0; e < 8; e++) strings(D, os[pat[e] % os.length], t + e * b / 2, b * 0.3, 0.42 + 0.2 * en, { short: true, pan: 0.2 }); }
      if (en > 0.35) { timpani(D, 33 + ((S.key + cr) % 12 + 12) % 12, t, 0.5 + 0.3 * en); if (en > 0.55) timpani(D, 33 + ((S.key + cr + 7) % 12 + 12) % 12, t + 2 * b, 0.4); voice(root + 12, q, 53, 67).forEach(n => brass(D, n, t, 3.6 * b, 0.32 + 0.15 * en, { wet: 0.45 })); }
      if (en > 0.5) { voice(root + 12, q, 62, 76).forEach(n => choir(D, n, t, 3.8 * b, 0.32 + 0.12 * en)); [[0, 95], [1.5, 95], [2, 80], [3, 110], [3.5, 110]].forEach(([bt, f]) => tom(D, f, t + bt * b, 0.5 + 0.25 * en, bt > 2 ? 0.3 : -0.3)); }
      if (en > 0.65) melodyBar('epic', S, S.bar, root, q, 64, 81, MIN, (n, tt, du) => { brass(D, n, tt, du, 0.62, { wet: 0.45 }); if (en > 0.85) brass(D, n + 12, tt, du, 0.4, { pan: 0.25 }); strings(D, n + 12, tt, du, 0.28, { a: 0.08 }); }, b, t);
      if (en > 0.6 && S.bar === 0 && S.s > 0) crash(D, t, 0.35);
      if (en > 0.45 && S.bar === 7) { swell(D, t, 4 * b, 0.6); for (let k = 0; k < 8; k++) snare(D, t + (2 + k * 0.25) * b, 0.12 + k * 0.03); }
    } };
    // 잔잔하게: 78BPM 로파이 — 로즈 피아노 7화음 → 브러시 드럼·베이스 → 첼레스타 멜로디
    const CALM_P = [[[0, 'maj7'], [9, 'min7'], [2, 'min7'], [7, 'dom7']], [[5, 'maj7'], [4, 'min7'], [2, 'min7'], [7, 'dom7']], [[0, 'maj7'], [5, 'maj7'], [4, 'min7'], [9, 'min7']]];
    B.calm = { len: 4 * 60 / 78, rev: 'room', fn(i, t) {
      const b = 60 / 78, sw = b * 0.16, D = E.bgm, en = E.energy, S = section(i, 8, [0, 5, -2, 3], CALM_P, 37); S.root = 60 + S.key;
      const [cr, q] = S.p[S.bar % 4], root = 48 + S.key + cr, ch = voice(root + 12, q, 55, 72), r = rnd(S.seed + S.bar);
      ch.forEach(n => epiano(D, n, hum(t), 1.8 * b, vel(0.42), { wet: 0.32 })); ch.forEach(n => epiano(D, n, hum(t + 2.5 * b + sw), 1.2 * b, vel(0.33), { wet: 0.32 }));
      bass(D, root - 12, t, 1.6 * b, 0.5); bass(D, root - 12 + (r() < 0.5 ? 7 : 12), t + 2.5 * b + sw, 1.2 * b, 0.42);
      if (en > 0.3) { kick(D, t, 0.38); kick(D, t + 2.5 * b + sw, 0.3); [1, 3].forEach(bt => noise(D, t + bt * b, 0.25, { f: 2600, q: 0.6, v: 0.11, wet: 0.2 })); for (let e = 0; e < 4; e++) { shaker(D, t + e * b, 0.5); shaker(D, t + e * b + b / 2 + sw, 0.35); } }
      if (en > 0.5) melodyBar('calm', S, S.bar, root, q, 72, 88, MAJ, (n, tt, du) => celesta(D, n, tt + (((tt - t) % b) > 0.4 * b ? sw : 0), 0.55), b, t);
      if (en > 0.75) voice(root + 12, q, 60, 76).forEach(n => strings(D, n, t, 3.8 * b, 0.18, { a: 1 }));
      for (let k = 0; k < 4; k++) noise(D, t + r() * 4 * b, 0.01, { type: 'highpass', f: 3500, v: 0.025 });   // 레코드판 잡음 살짝
    } };
    // 몽환적으로: 70BPM — 합창·현악 패드 → 하프 아르페지오 → 첼레스타·종 → 심장박동 같은 낮은 북
    const DREAM_P = [[[0, 'add9'], [4, 'min'], [9, 'madd9'], [5, 'add9']], [[5, 'add9'], [0, 'add9'], [7, 'sus2'], [9, 'min']], [[9, 'madd9'], [5, 'add9'], [2, 'min'], [7, 'sus4']]];
    B.dream = { len: 4 * 60 / 70, rev: 'hall', fn(i, t) {
      const b = 60 / 70, D = E.bgm, en = E.energy, S = section(i, 8, [0, 2, -3, 5], DREAM_P, 53); S.root = 64 + S.key;
      const [cr, q] = S.p[S.bar % 4], root = 48 + S.key + cr;
      voice(root + 12, q, 55, 74).forEach(n => choir(D, n, t, 3.8 * b, 0.22 + 0.12 * en));
      bass(D, root - 12, t, 3.6 * b, 0.32);
      if (en > 0.2) { const ar = voice(root + 12, q, 60, 86), pat = [0, 1, 2, 3, 4, 3, 2, 1]; for (let e = 0; e < 8; e++) harp(D, ar[pat[e] % ar.length], hum(t + e * b / 2), vel(0.32 + 0.15 * en)); }
      if (en > 0.4) voice(root + 12, q, 62, 79).forEach(n => strings(D, n, t, 3.8 * b, 0.18 + 0.1 * en, { a: 1.2, wet: 0.55 }));
      if (en > 0.5) melodyBar('dream', S, S.bar, root, q, 76, 93, MAJ, (n, tt) => celesta(D, n, tt, 0.6), b, t);
      if (en > 0.6) { tom(D, 62, t, 0.35); tom(D, 62, t + 0.45 * b, 0.25); if (en > 0.75) [2, 2.45].forEach(bt => tom(D, 62, t + bt * b, 0.3)); }
      if (S.bar === 7) swell(D, t + b, 3 * b, 0.35);
    } };
    // 왈츠: 3/4박 100BPM — 피치카토 '쿵짝짝' → 오르골 멜로디 → 현악·하프
    const WALTZ_P = [[[0, 'maj'], [7, 'maj'], [9, 'min'], [5, 'maj'], [0, 'maj'], [2, 'min'], [7, 'dom7'], [0, 'maj']], [[0, 'maj'], [5, 'maj'], [7, 'maj'], [0, 'maj'], [9, 'min'], [5, 'maj'], [7, 'dom7'], [0, 'maj']]];
    B.waltz = { len: 3 * 60 / 100, rev: 'room', fn(i, t) {
      const b = 60 / 100, D = E.bgm, en = E.energy, S = section(i, 8, [0, 5, 7, -2], WALTZ_P, 71); S.root = 67 + S.key;
      const [cr, q] = S.p[S.bar], root = 43 + S.key + cr, ch = voice(root + 12, q, 59, 72);
      bass(D, root, t, 0.7 * b, 0.45); pluck(D, root, t, 0.25, { wet: 0.25 });
      [1, 2].forEach(bt => ch.forEach(n => pluck(D, n, hum(t + bt * b), vel(0.2 + 0.08 * en), { pan: 0.25, wet: 0.3 })));
      if (S.bar % 2 === 0 || en > 0.35) melodyBar('waltz', S, S.bar, root, q, 72, 91, MAJ, (n, tt, du, acc) => { celesta(D, n, tt, acc ? 0.62 : 0.5); if (en > 0.6) epiano(D, n - 12, tt, du, 0.3, { wet: 0.35 }); }, b, t);
      if (en > 0.45) voice(root + 12, q, 55, 72).forEach(n => strings(D, n, t, 2.8 * b, 0.2 + 0.1 * en, { a: 0.5 }));
      if (en > 0.65) { const ar = voice(root + 12, q, 64, 88); ar.slice(0, 6).forEach((n, k) => harp(D, n, t + k * b / 2, 0.25)); }
      if (en > 0.5 && S.bar % 4 === 0) noise(D, t, 0.6, { type: 'highpass', f: 8000, v: 0.05, wet: 0.4 });   // 트라이앵글
    } };

    E.inst = { epiano, piano, strings, brass, choir, harp, celesta, pluck, bass, kick, snare, clap, hat, shaker, crash, swell, timpani, tom, noise };
    E.style = () => styleOf(E.theme);
    E.barLen = th => B[styleOf(th)].len;
    E.bar = (th, i, t) => { const st = styleOf(th); REV = B[st].rev === 'hall' ? HALL : ROOM; B[st].fn(i, t); };

    /* ---------- 효과음 ---------- */
    const PENTA = [0, 2, 4, 7, 9];
    E.play = (kind, o = {}, t = ctx.currentTime) => {
      const D = E.sfxo, st = E.style(), base = { pop: 72, epic: 69, calm: 72, dream: 76, waltz: 79 }[st] || 72;
      REV = B[st].rev === 'hall' ? HALL : ROOM;
      if (kind === 'arrive') {   // 출석 도장 '쾅!' + 한 사람씩 한 음 올라가는 차임
        const k = (o.i || 0) % 10, n = base + 12 * Math.floor(k / 5) + PENTA[k % 5];
        tom(D, 78, t, 0.42); noise(D, t, 0.05, { type: 'lowpass', f: 1600, v: 0.22 }); noise(D, t + 0.004, 0.03, { type: 'bandpass', f: 3200, q: 1.2, v: 0.08 });
        if (st === 'epic') { timpani(D, 45, t, 0.35); brass(D, n - 12, t + 0.08, 0.22, 0.45); }
        else if (st === 'dream') { [0, 4, 7].forEach((s, j) => harp(D, n - 12 + s, t + 0.06 + j * 0.05, 0.45)); celesta(D, n + 12, t + 0.2, 0.5); }
        else if (st === 'calm') { epiano(D, n, t + 0.07, 0.5, 0.55); epiano(D, n + 7, t + 0.12, 0.4, 0.35); }
        else if (st === 'waltz') { celesta(D, n, t + 0.07, 0.6); celesta(D, n + 4, t + 0.15, 0.45); }
        else { pluck(D, n, t + 0.06, 0.6); epiano(D, n + 12, t + 0.1, 0.25, 0.4); }
      } else if (kind === 'dept') {   // 우리 부서 전원 출석: 하프 글리산도
        [0, 2, 4, 7, 9, 12, 14, 16].forEach((s, j) => harp(D, base - 12 + s, t + j * 0.05, 0.5));
        epiano(D, base, t + 0.45, 0.8, 0.5); epiano(D, base + 4, t + 0.45, 0.8, 0.4); epiano(D, base + 7, t + 0.45, 0.8, 0.4);
      } else if (kind === 'milestone') {   // 50~90% 달성: 금관 팡파르 (높을수록 한 음 높게)
        const bs = 60 + Math.round(((o.pct || 50) - 50) / 10);
        [[0, 0, 0.16], [0.18, 0, 0.16], [0.36, 4, 0.16], [0.54, 7, 0.9]].forEach(([d, s, du]) => [0, 4, 7].forEach(x => brass(D, bs + s + x - (x ? 0 : 12), t + d, du, 0.6, { wet: 0.4 })));
        timpani(D, 36 + ((bs % 12) + 12) % 12, t + 0.54, 0.6); crash(D, t + 0.54, 0.35);
      } else if (kind === 'finale') {   // 전원 출석: 오케스트라 대팡파르 + 박수
        const R = 60;
        [[0, [0, 4, 7]], [0.3, [5, 9, 12]], [0.6, [7, 11, 14]]].forEach(([d, c]) => c.forEach(x => brass(D, R + x, t + d, 0.24, 0.62)));
        [0, 4, 7, 12, 16].forEach(x => { brass(D, R + x, t + 0.95, 2.2, 0.66, { wet: 0.5 }); strings(D, R + x + 12, t + 0.95, 2.4, 0.42, { a: 0.05 }); });
        for (let k = 0; k < 12; k++) timpani(D, 36, t + k * 0.06, 0.18 + k * 0.03); timpani(D, 36, t + 0.95, 0.8); crash(D, t + 0.95, 0.6);
        [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24].forEach((s, j) => harp(D, R + s, t + 0.95 + j * 0.035, 0.45));
        for (let n = 0; n < 60; n++) clap(D, t + 1.4 + Math.random() * 3.4, 0.22 * (1 - n / 80));
      } else if (kind === 'land') {   // 캐릭터 착지 통통
        const amp = ctx.createGain(), o2 = osc('sine', 260, t, t + 0.4); o2.frequency.exponentialRampToValueAtTime(560, t + 0.12);
        amp.gain.setValueAtTime(0.0001, t); amp.gain.linearRampToValueAtTime(0.1, t + 0.01); amp.gain.setTargetAtTime(0.0001, t + 0.02, 0.06); o2.connect(amp); amp.connect(outlet(D, 0, 0.1));
      } else if (kind === 'phone') {   // 휴대폰 출석 완료 띵동
        epiano(D, 88, t, 0.4, 0.55); epiano(D, 84, t + 0.22, 0.9, 0.6);
      }
    };
  }

  /* ---------------- 배경음악 음원(assets/music) ----------------
     분위기마다 곡 목록을 섞어 한 곡씩 이어 틀고, 같은 곡을 연달아 반복하지 않는다.
     그 분위기 곡이 다 끝나면 비슷한 분위기 곡으로 넘어간다. 음원을 못 불러오면 합성 음악으로 대신한다 */
  const MUSIC = {
    pop: ['pop_beautiful_korea', 'pop_colors_of_life', 'pop_game', 'pop_morning_kiss', 'pop_dreams'],
    calm: ['calm_how_are_you', 'calm_consolation', 'calm_traumerei', 'calm_bach_largo', 'calm_liebestraum', 'calm_piano_man'],
    epic: ['epic_city_key', 'epic_chuncheon_autumn', 'epic_bed', 'pop_dreams'],   // Dreams는 신나게·웅장하게 둘 다
    dream: ['dream_green_apple']
  };
  const NEXT = { pop: ['pop'], calm: ['calm', 'dream'], dream: ['dream', 'calm'], epic: ['epic', 'dream'] };   // 분위기가 갑자기 바뀌지 않게 비슷한 곡끼리만
  const fileStyle = th => { const st = styleOf(th); return st === 'waltz' ? 'calm' : st; };
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const MUSIC_BASE = (() => { try { const s = document.currentScript && document.currentScript.src; return s ? s.replace(/sound\.js.*$/, 'music/') : 'assets/music/'; } catch (e) { return 'assets/music/'; } })();

  /* ---------------- 실제 재생(브라우저) ---------------- */
  const Sound = {
    MUSIC, NEXT,
    Engine, STYLES, OF_THEME, styleOf, mode: 'both', ctx: null, eng: null, theme: 'pop', unlocked: false, user: { bgm: true, sfx: true, vol: 0.55, on: false },
    load() { try { const o = JSON.parse(localStorage.getItem('snd') || '{}'); this.user = { bgm: o.bgm !== false, sfx: o.sfx !== false, vol: o.vol == null ? 0.55 : o.vol, on: !!o.on }; } catch (e) {} },
    save() { try { localStorage.setItem('snd', JSON.stringify(this.user)); } catch (e) {} },
    bgmOn() { return this.mode === 'both' && this.user.bgm; },
    sfxOn() { return this.mode !== 'off' && this.user.sfx; },
    configure(mode) {
      if (!this._cfg) { this._cfg = true; this.load(); addEventListener('pointerdown', () => { if (this.user.on && !this.unlocked) this.unlock(); }, { passive: true }); addEventListener('keydown', e => { if (e.key === 'm' || e.key === 'M') this.toggleAll(); });
        document.addEventListener('visibilitychange', () => { if (!this.ctx) return; if (document.hidden) this.ctx.suspend(); else if (this.unlocked) this.ctx.resume(); }); }
      this.mode = g.parent !== g ? 'off' : (['both', 'sfx', 'off'].includes(mode) ? mode : 'both');   // 행사 만들기 미리보기에서는 소리 없음
      this.refresh();
    },
    unlock() {
      if (!this.ctx) {
        const AC = g.AudioContext || g.webkitAudioContext; if (!AC) return;
        this.ctx = new AC(); this.eng = new Engine(this.ctx, this.ctx.destination); this.eng.theme = this.theme; this.eng.energy = this.energy == null ? 0.1 : this.energy;
      }
      this.ctx.resume(); this.unlocked = true; if (!this.user.on) { this.user.on = true; this.save(); }
      this.refresh();
    },
    setEnergy(ratio) {   // 출석률(0~1) → 음악의 풍성함. 처음엔 차분하게 시작해 서서히 올라간다
      const e = Math.max(0.08, Math.min(1, 0.08 + 0.92 * ratio)); this.energy = e; if (this.eng) this.eng.energy = e;
      try { if (g.__sfxLog) g.__sfxLog.push({ t: performance.timeOrigin + performance.now(), kind: 'energy', o: { e } }); } catch (x) {}
    },
    // 화면 테마 또는 분위기(pop/epic/calm/dream/waltz)를 받는다
    setTheme(th) { if (this.theme === th) return; this.theme = th; if (this.eng) this.eng.theme = th; this.stopBgm(); this.refresh(); },
    _playlist() {
      const out = []; NEXT[fileStyle(this.theme)].forEach(g2 => shuffle(MUSIC[g2]).forEach(n => { if (!out.includes(n)) out.push(n); }));
      if (out.length > 1 && out[0] === this._last) out.push(out.shift());   // 방금 끝난 곡이 바로 다시 나오지 않게
      return out;
    },
    _playNext() {
      if (!this._playing) return;
      if (!this._queue || !this._queue.length) this._queue = this._playlist();
      const name = this._queue.shift(); this._last = name;
      if (!this._audio) {
        const a = new Audio(); a.preload = 'auto'; this._audio = a;
        const src = this.ctx.createMediaElementSource(a), fg = this.ctx.createGain(); fg.gain.value = 0.6; src.connect(fg); fg.connect(this.eng.bgm);
        a.addEventListener('ended', () => { clearTimeout(this._gap); this._gap = setTimeout(() => this._playNext(), 1200); });   // 곡 사이 1초 쉼
        a.addEventListener('error', () => {
          this._fails = (this._fails || 0) + 1;
          if (this._fails >= 3) { this._useFiles = false; this._playing = false; this.startBgm(); }   // 음원을 못 쓰면 합성 음악으로
          else { clearTimeout(this._gap); this._gap = setTimeout(() => this._playNext(), 400); }
        });
      }
      this._audio.src = MUSIC_BASE + name + '.mp3';
      const pr = this._audio.play(); if (pr && pr.then) pr.then(() => { this._fails = 0; }).catch(() => {});
    },
    nowPlaying() { return this._playing ? this._last : null; },
    startBgm() {
      if (!this.ctx) return;
      if (this._useFiles !== false && typeof Audio !== 'undefined') {
        if (this._playing) return;
        const e = this.eng, c = this.ctx; this._playing = true; this._queue = this._playlist();
        // 처음 한 번만 조그맣게 알려 준다
        if (!this._told) { this._told = true; try { g.App && g.App.toast && g.App.toast('🎵 다른 창으로 바꾸거나 최소화하면 음악이 저절로 멈추고, 돌아오면 다시 나와요'); } catch (x) {} }
        e.bgm.gain.cancelScheduledValues(c.currentTime); e.bgm.gain.setValueAtTime(0.0001, c.currentTime); e.bgm.gain.linearRampToValueAtTime(0.55 * this.user.vol, c.currentTime + 2);
        this._playNext(); return;
      }
      if (this._timer) return;
      const e = this.eng, c = this.ctx; this._bar = 0; this._next = c.currentTime + 0.2;
      e.bgm.gain.cancelScheduledValues(c.currentTime); e.bgm.gain.setValueAtTime(0.0001, c.currentTime); e.bgm.gain.linearRampToValueAtTime(0.55 * this.user.vol, c.currentTime + 2);
      this._timer = setInterval(() => { while (this._next < c.currentTime + 4) { e.bar(this.theme, this._bar++, this._next); this._next += e.barLen(this.theme); } }, 1000);
    },
    stopBgm() { clearInterval(this._timer); this._timer = 0; clearTimeout(this._gap); if (this._playing) { this._playing = false; if (this._audio) this._audio.pause(); } if (this.ctx && this.eng) { const g2 = this.eng.bgm.gain, n = this.ctx.currentTime; g2.cancelScheduledValues(n); g2.setTargetAtTime(0.0001, n, 0.2); } },
    refresh() { if (this.unlocked && this.bgmOn()) this.startBgm(); else this.stopBgm(); this.ui(); },
    sfx(kind, o) {
      try { if (g.__sfxLog) g.__sfxLog.push({ t: performance.timeOrigin + performance.now(), kind, o: o || {} }); } catch (e) {}
      if (!this.unlocked || !this.sfxOn() || document.hidden) return;
      this.eng.theme = this.theme; const now = this.ctx.currentTime;
      if (['dept', 'milestone', 'finale'].includes(kind) && this.bgmOn()) { const gg = this.eng.bgm.gain, v = 0.55 * this.user.vol; gg.cancelScheduledValues(now); gg.setTargetAtTime(v * 0.35, now, 0.03); gg.setTargetAtTime(v, now + (kind === 'finale' ? 4.5 : 1.6), 0.4); }
      this.eng.play(kind, o || {}, now + 0.02);
    },
    toggleAll() { const on = this.user.bgm || this.user.sfx; this.user.bgm = this.user.sfx = !on; this.save(); this.unlock(); },
    /* 화면 아래 가운데의 작은 소리 조절 */
    mountUi() {
      if (this._ui || g.parent !== g) return;   // 미리보기(iframe)에는 소리 조절을 달지 않는다
      const d = document.createElement('div'); d.className = 'snd'; d.id = 'snd'; document.body.appendChild(d); this._ui = d;
      d.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.a === 'go') { this.user.bgm = this.user.sfx = true; this.unlock(); this.save(); }
        if (b.dataset.a === 'bgm') { this.user.bgm = !this.user.bgm; this.save(); this.refresh(); }
        if (b.dataset.a === 'sfx') { this.user.sfx = !this.user.sfx; this.save(); this.refresh(); }
      });
      d.addEventListener('input', e => { if (e.target.type === 'range') { this.user.vol = +e.target.value; this.save(); if (this.eng) this.eng.bgm.gain.setTargetAtTime(0.55 * this.user.vol, this.ctx.currentTime, 0.1); } });
      this.ui();
    },
    ui() {
      const d = this._ui; if (!d) return;
      if (this.mode === 'off') { d.hidden = true; return; } d.hidden = false;
      d.className = 'snd' + (this.unlocked ? '' : ' locked');
      d.innerHTML = this.unlocked
        ? `${this.mode === 'both' ? `<button type="button" data-a="bgm" class="${this.user.bgm ? 'on' : ''}" aria-pressed="${this.user.bgm}" title="다른 창으로 바꾸거나 최소화하면 저절로 멈추고, 돌아오면 다시 나와요 (키보드 M: 끄기·켜기)">🎵 음악</button>` : ''}<button type="button" data-a="sfx" class="${this.user.sfx ? 'on' : ''}" aria-pressed="${this.user.sfx}">🔔 효과음</button>${this.mode === 'both' ? `<input type="range" min="0" max="1" step="0.05" value="${this.user.vol}" aria-label="음악 크기">` : ''}`
        : `<button type="button" data-a="go" class="go">🔊 소리 켜기</button>`;
    }
  };
  g.Sound = Sound;
})(window);
