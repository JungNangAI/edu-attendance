/* 효과음·배경음악 — 음원 파일 없이 브라우저가 직접 합성합니다(Web Audio). 저작권 걱정 없음.
   - 테마(card/apartment/star/garden)마다 다른 배경음악·효과음 음색
   - Sound.sfx('arrive'|'dept'|'milestone'|'finale'|'land'|'phone', 옵션)
   - 브라우저 정책상 처음 한 번은 사람이 눌러야 소리가 납니다("소리 켜기" 버튼) */
(function (g) {
  'use strict';
  const hz = n => 440 * Math.pow(2, (n - 69) / 12);
  const rnd = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const PENTA = [0, 2, 4, 7, 9];

  function Engine(ctx, out) {
    const E = this; E.ctx = ctx; E.theme = 'card';
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(out);
    E.bus = ctx.createGain(); E.bus.gain.value = 0.9; E.bus.connect(comp);
    // 잔향(공간감)
    const conv = ctx.createConvolver(), len = Math.floor(ctx.sampleRate * 2.4), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    conv.buffer = ir; const rv = ctx.createGain(); rv.gain.value = 0.55; conv.connect(rv); rv.connect(E.bus);
    E.bgm = ctx.createGain(); E.bgm.gain.value = 0.55; E.bgm.connect(E.bus);
    E.sfxo = ctx.createGain(); E.sfxo.gain.value = 0.9; E.sfxo.connect(E.bus);
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    const route = (node, dest, wet) => { node.connect(dest); if (wet) { const s = ctx.createGain(); s.gain.value = wet; node.connect(s); s.connect(conv); } };

    // 기본 음: 사인·삼각·톱니
    const tone = (dest, f, t, dur, o = {}) => {
      const { type = 'sine', g: gn = 0.2, a = 0.005, r = 0.15, wet = 0.2, lp = 0, det = 0, slide = 0 } = o;
      const os = ctx.createOscillator(), v = ctx.createGain(); os.type = type; os.frequency.setValueAtTime(f, t);
      if (slide) os.frequency.exponentialRampToValueAtTime(Math.max(20, f * slide), t + dur + r);
      if (det) os.detune.value = det;
      v.gain.setValueAtTime(0.0001, t); v.gain.linearRampToValueAtTime(gn, t + a); v.gain.setValueAtTime(gn, t + Math.max(a, dur)); v.gain.exponentialRampToValueAtTime(0.0001, t + dur + r);
      let n = os;
      if (lp) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; os.connect(fl); n = fl; }
      n.connect(v); route(v, dest, wet); os.start(t); os.stop(t + dur + r + 0.05);
    };
    const bell = (dest, f, t, len = 1.4, gn = 0.12, wet = 0.45) => {   // 오르골·종소리
      [[1, 1, 1], [2.76, 0.32, 0.6], [5.4, 0.14, 0.35]].forEach(([m, a, l]) => tone(dest, f * m, t, 0.004, { g: gn * a, r: len * l, wet }));
    };
    const pluck = (dest, f, t, gn = 0.14, wet = 0.15) => tone(dest, f, t, 0.01, { type: 'triangle', g: gn, r: 0.34, lp: 3200, wet });
    const nz = (dest, t, dur, o = {}) => {
      const { type = 'bandpass', f = 2000, to = 0, q = 1, g: gn = 0.2, wet = 0 } = o;
      const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, t);
      if (to) fl.frequency.exponentialRampToValueAtTime(to, t + dur);
      const v = ctx.createGain(); v.gain.setValueAtTime(0.0001, t); v.gain.linearRampToValueAtTime(gn, t + Math.min(0.01, dur / 3)); v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(fl); fl.connect(v); route(v, dest, wet); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
    };
    const kick = (dest, t, gn = 0.5) => tone(dest, 130, t, 0.02, { g: gn, r: 0.16, slide: 0.32, wet: 0 });
    const hat = (dest, t, gn = 0.08) => nz(dest, t, 0.045, { type: 'highpass', f: 7000, g: gn });
    const snare = (dest, t, gn = 0.2) => { nz(dest, t, 0.14, { f: 1900, q: 0.8, g: gn, wet: 0.1 }); tone(dest, 190, t, 0.01, { g: gn * 0.5, r: 0.09, wet: 0 }); };
    const padv = (dest, f, t, dur, gn) => [-7, 7].forEach(d => tone(dest, f, t, dur, { type: 'sawtooth', g: gn, a: 2.2, r: 2.6, lp: 900, det: d, wet: 0.5 }));
    const chordOf = (dest, notes, t, dur, o) => notes.forEach(n => tone(dest, hz(n), t, dur, o));

    /* ---------------- 배경음악: 20~30분 대기용 ----------------
       · 8마디(스타는 4마디) 구간마다 코드 진행·조(key)·멜로디 시드가 바뀌어 같은 도막이 반복되지 않는다
       · E.energy(0~1, 출석률)에 따라 층이 하나씩 쌓인다: 처음엔 반주만 → 하이햇 → 킥 → 스네어·멜로디 */
    E.energy = 0.5; E.last = {};
    const KEYS = { card: [0, 2, 5, 7, -2, 3], apartment: [0, -2, 3, 5, -5, 2], star: [0, 2, -3, 5], garden: [0, 2, 5, -2, 7, -5] };
    const sec = (th, i, len, np) => { const s = Math.floor(i / len), c = Math.floor(s / np); return { s, p: s % np, bar: i % len, key: KEYS[th][c % KEYS[th].length] }; };
    const ch = x => ({ r: parseInt(x), m: /m/.test(x) });
    const MAJ = [0, 2, 4, 5, 7, 9, 11], PEN = [0, 2, 4, 7, 9];
    const scaleRange = (root, ints, lo, hi) => { const out = []; for (let o = -36; o <= 48; o += 12) ints.forEach(x => { const n = root + o + x; if (n >= lo && n <= hi) out.push(n); }); return out.sort((p, q) => p - q); };
    const walk = (key, list, r, centre) => {   // 이전 음 근처로 한 걸음씩 걷는 멜로디
      let i = E.last[key]; if (i == null || i >= list.length) i = Math.max(0, list.findIndex(n => n >= centre));
      i = Math.max(0, Math.min(list.length - 1, i + Math.round((r() - 0.5) * 4)));
      const d = (centre - list[i]) / 12; if (r() < 0.35) i = Math.max(0, Math.min(list.length - 1, i + (d > 0.4 ? 1 : d < -0.4 ? -1 : 0)));
      E.last[key] = i; return list[i];
    };
    const CP = [['0', '7', '9m', '5'], ['0', '9m', '5', '7'], ['9m', '5', '0', '7'], ['0', '4m', '5', '7'], ['5', '0', '7', '9m'], ['0', '5', '9m', '7']];
    const JV = { m9: [3, 7, 10, 14], M9: [4, 7, 11, 14], d13: [4, 10, 14, 21], d7: [4, 7, 10], m7: [3, 7, 10] };
    const AP = [[[2, 'm9'], [7, 'd13'], [0, 'M9'], [9, 'd7']], [[5, 'M9'], [4, 'm7'], [2, 'm9'], [7, 'd13']], [[9, 'm9'], [2, 'm9'], [7, 'd13'], [0, 'M9']],
      [[0, 'M9'], [9, 'm9'], [2, 'm9'], [7, 'd13']], [[4, 'm7'], [9, 'd7'], [2, 'm9'], [7, 'd13']], [[5, 'M9'], [7, 'd13'], [4, 'm7'], [9, 'm9']]];
    const SP = [['0m', '8', '3', '10'], ['0m', '5m', '8', '7'], ['8', '3', '10', '0m'], ['0m', '3', '8', '10'], ['5m', '0m', '8', '3'], ['0m', '7m', '8', '10']];
    const GP = [['0', '7', '9m', '5', '0', '7', '5', '7'], ['0', '5', '0', '7', '9m', '5', '7', '0'], ['9m', '5', '0', '7', '9m', '5', '7', '0'], ['0', '4m', '5', '7', '0', '2m', '7', '0']];
    const RT = [[[0, 1], [1, 1], [2, 1]], [[0, 1], [1, .5], [1.5, .5], [2, 1]], [[0, .5], [.5, .5], [1, 1], [2, 1]], [[0, 2], [2, 1]], [[0, 1], [1, 2]]];
    const B = {
      card: { len: 4 * 60 / 104, fn(i, t) {   // 밝은 팝 — 처음엔 살랑살랑, 출석이 늘수록 비트가 붙는다
        const b = 60 / 104, D = E.bgm, en = E.energy, S = sec('card', i, 8, CP.length), c = ch(CP[S.p][Math.floor(S.bar / 2)]);
        const rootM = 48 + S.key + c.r, notes = [rootM + 12, rootM + 12 + (c.m ? 3 : 4), rootM + 19], r = rnd(S.s * 131 + S.bar * 17 + 5), brk = S.s % 4 === 3 && S.bar < 4;
        for (let e = 0; e < 8; e++) if (e % 2 === 0 || e === 3 || e === 7) tone(D, hz(rootM - 12 + (e === 3 || e === 7 ? 12 : 0)), t + e * b / 2, 0.16, { type: 'triangle', g: 0.15 * (0.6 + 0.4 * en), r: 0.08, lp: 700, wet: 0 });
        chordOf(D, notes, t, 4 * b, { type: 'triangle', g: 0.025, a: 0.3, r: 0.8, wet: 0.3, lp: 1800 });
        if (!brk) for (let q = 0; q < 4; q++) { const tt = t + q * b;
          if (en > 0.18) hat(D, tt + b / 2, 0.04 + 0.04 * en);
          if (en > 0.38 && q % 2 === 0) kick(D, tt, 0.28 + 0.14 * en);
          if (en > 0.52 && q % 2 === 1) snare(D, tt, 0.1 + 0.08 * en);
          if (en > 0.45 && q % 2 === 1) chordOf(D, notes, tt + b / 2, 0.12, { type: 'triangle', g: 0.04, r: 0.12, wet: 0.2 });
        }
        const list = scaleRange(60 + S.key, PEN, 66, 90), dens = 0.16 + 0.5 * en;
        for (let e = 0; e < 8; e++) if (r() < dens * (e % 2 === 0 ? 1.2 : 0.8)) pluck(D, hz(walk('card', list, r, 78)), t + e * b / 2, e === 0 ? 0.12 : 0.085, 0.25);
      } },
      apartment: { len: 4 * 60 / 80, fn(i, t) {   // 밤 도시 로파이 — 코드가 계속 바뀌는 재즈 진행
        const b = 60 / 80, D = E.bgm, en = E.energy, S = sec('apartment', i, 8, AP.length), [sm, q] = AP[S.p][Math.floor(S.bar / 2)], sw = b * 0.17;
        const rootM = 48 + S.key + sm, r = rnd(S.s * 97 + S.bar * 11 + 2);
        const v = JV[q].map(x => { let n = rootM + x; while (n < 53) n += 12; while (n > 71) n -= 12; return n; });
        const ep = (tt, dur) => v.forEach(n => { tone(D, hz(n), tt, dur, { type: 'triangle', g: 0.05, a: 0.012, r: 1.3, lp: 1500, wet: 0.35 }); tone(D, hz(n) * 2, tt, dur * 0.4, { g: 0.012, r: 0.6, wet: 0.3 }); });
        ep(t, 1.4 * b); ep(t + 2.5 * b + sw, 1.1 * b); if (r() < 0.2 + 0.4 * en) ep(t + 1.5 * b + sw, 0.6 * b);
        tone(D, hz(rootM - 12), t, b, { g: 0.24, r: 0.5, wet: 0 }); tone(D, hz(rootM - 12 + (r() < 0.5 ? 7 : 0)), t + 2.5 * b + sw, 0.6 * b, { g: 0.18, r: 0.4, wet: 0 });
        if (en > 0.3) { kick(D, t, 0.34 + 0.08 * en); if (en > 0.45) kick(D, t + 2.5 * b + sw, 0.28); }
        if (en > 0.42) [1, 3].forEach(s2 => nz(D, t + s2 * b, 0.2, { f: 2200, q: 0.7, g: 0.09, wet: 0.15 }));
        if (en > 0.2) for (let s2 = 0; s2 < 4; s2++) { hat(D, t + s2 * b, 0.035); hat(D, t + s2 * b + b / 2 + sw, 0.025); }
        const list = scaleRange(60 + S.key, [0, 2, 3, 5, 7, 9, 10], 69, 90), nl = Math.round(0.6 + 2.2 * en);
        for (let n = 0; n < nl; n++) bell(D, hz(walk('apt', list, r, 79)), t + (0.5 + r() * 3) * b, 1.6, 0.06, 0.6);
        for (let n = 0; n < 6; n++) nz(D, t + r() * 4 * b, 0.012, { type: 'highpass', f: 3500, g: 0.04 });
      } },
      star: { len: 8, fn(i, t) {   // 은하수 앰비언트 — 4마디마다 코드·조가 흘러가며 층이 쌓인다
        const D = E.bgm, en = E.energy, S = sec('star', i, 4, SP.length), c = ch(SP[S.p][S.bar]), r = rnd(S.s * 53 + S.bar * 7 + 1);
        const rootM = 45 + S.key + c.r, c4 = [rootM + 12, rootM + 12 + (c.m ? 3 : 4), rootM + 19, rootM + 24];
        c4.forEach(n => padv(D, hz(n), t, 6.4, 0.026 + 0.01 * en));
        tone(D, hz(rootM - 12), t, 7, { g: 0.15, a: 1.2, r: 1.6, wet: 0.1 });
        if (en > 0.3) [0, 2, 4, 6].forEach((bt, j) => bell(D, hz(c4[j % 4] + 12), t + bt + 0.02, 3.2, 0.03 + 0.02 * en, 0.7));
        if (en > 0.62) for (let k = 0; k < 8; k++) bell(D, hz(c4[k % 3] + 24), t + k + 0.5, 2.2, 0.02, 0.7);
        const list = scaleRange(69 + S.key, [0, 3, 5, 7, 10], 76, 100);
        for (let k = 0, n = Math.round(1.5 + 5 * en); k < n; k++) bell(D, hz(list[Math.floor(r() * list.length)]), t + r() * 7.2, 3.4, 0.035, 0.8);
        nz(D, t, 7.5, { type: 'bandpass', f: 500, to: 1400, q: 0.6, g: 0.012, wet: 0.5 });
      } },
      garden: { len: 3 * 60 / 96, fn(i, t) {   // 장미정원 오르골 왈츠 — 구간마다 새 멜로디
        const b = 60 / 96, D = E.bgm, en = E.energy, S = sec('garden', i, 8, GP.length), c = ch(GP[S.p][S.bar]), r = rnd(S.s * 71 + S.bar * 13 + 3);
        const rootM = 43 + S.key + c.r, tri = [rootM + 12, rootM + 12 + (c.m ? 3 : 4), rootM + 19];
        tone(D, hz(rootM), t, 0.32, { type: 'triangle', g: 0.19, r: 0.3, lp: 800, wet: 0.05 });
        if (en > 0.15) [1, 2].forEach(s2 => chordOf(D, tri, t + s2 * b, 0.08, { type: 'triangle', g: 0.04 + 0.01 * en, r: 0.22, wet: 0.2 }));
        if (S.bar % 2 === 0 || r() < en) {
          const list = scaleRange(67 + S.key, MAJ, 69, 95), rt = RT[Math.floor(r() * RT.length)];
          rt.forEach(([bt, d], j) => {
            let n; if (j === 0) { const ct = tri[Math.floor(r() * 3)] + 12; n = list.reduce((x, y) => Math.abs(y - ct) < Math.abs(x - ct) ? y : x); E.last.garden = list.indexOf(n); } else n = walk('garden', list, r, 82);
            bell(D, hz(n), t + bt * b, 1.5 + d * 0.4, 0.09 + 0.02 * en, 0.5);
          });
        }
      } }
    };
    /* 아파트 후반부(출석률 약 73%↑): 오리지널 신나는 댄스팝 — 4박 킥, 박수, 오프비트 신스 베이스, 콜앤리스폰스 훅(시드로 매번 새로 생성) */
    const popOn = th => th === 'apartment' && E.energy >= 0.75;
    const pop = (i, t) => {
      const b = 60 / 124, D = E.bgm, S = sec('apartment', i, 8, CP.length), c = ch(CP[S.p][Math.floor(S.bar / 2)]), r = rnd(S.s * 211 + S.bar * 19 + 9);
      const rootM = 50 + S.key + c.r, notes = [rootM + 12, rootM + 12 + (c.m ? 3 : 4), rootM + 19];
      if (!E.wasPop) { nz(D, t, 1.2, { type: 'highpass', f: 5000, g: 0.12, wet: 0.3 }); }   // 전환 크래시
      for (let q = 0; q < 4; q++) { const tt = t + q * b; kick(D, tt, 0.5); if (q % 2 === 1) { nz(D, tt, 0.09, { f: 1700, q: 0.9, g: 0.17, wet: 0.15 }); nz(D, tt + 0.05, 0.08, { f: 1500, q: 0.9, g: 0.12 }); } hat(D, tt + b / 2, 0.07); }
      [1, 0, 1, 0, 1, 1, 0, 1].forEach((x, e) => { if (x) nz(D, t + e * b / 2, 0.04, { f: 900, q: 1.2, g: 0.06 }); });   // 발 구르기·박수 패턴
      for (let e = 0; e < 8; e++) { const te = t + e * b / 2;
        if (e % 2) tone(D, hz(rootM - 12), te, 0.13, { type: 'sawtooth', g: 0.15, r: 0.06, lp: 520, wet: 0 }); else tone(D, hz(rootM - 12), te, 0.18, { type: 'triangle', g: 0.2, r: 0.08, wet: 0 });
        if (e === 0 || e === 3 || e === 6) chordOf(D, notes, te, 0.1, { type: 'sawtooth', g: 0.032, r: 0.1, lp: 2200, wet: 0.2 }); }
      const list = scaleRange(62 + S.key, PEN, 69, 93), rr = rnd(S.s * 53 + 7), base = Math.floor(list.length * (0.25 + 0.4 * rr())), st = [0, 1, 2, 1, 3, 2].map(() => Math.floor(rr() * 4) - 1);
      [0, 1, 2, 3, 4, 6].forEach((e, j) => { const k = Math.max(0, Math.min(list.length - 1, base + (S.bar % 2 ? st[5 - j] + 1 : st[j]))); tone(D, hz(list[k]), t + e * b / 2, 0.1, { type: 'square', g: 0.04, r: 0.1, lp: 2600, wet: 0.25 }); });
      if (S.bar === 7) nz(D, t, 4 * b, { f: 300, to: 6000, q: 1, g: 0.05, wet: 0.2 });   // 구간 끝 라이저
    };
    E.wasPop = false;
    E.barLen = th => popOn(th) ? 4 * 60 / 124 : (B[th] || B.card).len;
    E.bar = (th, i, t) => { if (popOn(th)) { pop(i, t); E.wasPop = true; } else { E.wasPop = false; (B[th] || B.card).fn(i, t); } };

    /* ---------------- 효과음 ---------------- */
    E.play = (kind, o = {}, t = ctx.currentTime) => {
      const D = E.sfxo, th = E.theme, base = { card: 72, apartment: 67, star: 76, garden: 79 }[th] || 72;
      if (kind === 'arrive') {   // 출석할 때마다 한 음씩 올라가는 느낌(펜타토닉)
        const k = (o.i || 0) % 10, f = hz(base + 12 * Math.floor(k / 5) + PENTA[k % 5]);
        if (th === 'apartment' && E.energy >= 0.75) { nz(D, t, 0.08, { f: 1600, q: 0.9, g: 0.14 }); nz(D, t + 0.1, 0.08, { f: 1400, q: 0.9, g: 0.12 }); }
        if (th === 'card') { nz(D, t, 0.22, { f: 500, to: 4000, g: 0.05 }); pluck(D, f, t + 0.05, 0.22, 0.2); pluck(D, f * 2, t + 0.12, 0.12, 0.2); }
        else if (th === 'apartment') { nz(D, t, 0.015, { type: 'highpass', f: 2500, g: 0.25 }); tone(D, f, t + 0.03, 0.18, { type: 'triangle', g: 0.2, r: 0.7, lp: 2400, wet: 0.35 }); tone(D, f * 1.5, t + 0.1, 0.1, { g: 0.07, r: 0.6, wet: 0.35 }); }
        else if (th === 'star') { nz(D, t, 0.4, { f: 2500, to: 9000, q: 2, g: 0.05, wet: 0.4 }); [1, 1.5, 2].forEach((m, j) => bell(D, f * m, t + 0.05 + j * 0.09, 1.8, 0.14, 0.8)); }
        else { tone(D, 560, t, 0.01, { g: 0.22, r: 0.12, slide: 0.35, wet: 0 }); bell(D, f, t + 0.06, 1.5, 0.16, 0.5); bell(D, f * 1.25, t + 0.16, 1.4, 0.1, 0.5); }
      } else if (kind === 'dept') {   // 우리 부서 전원 출석
        [0, 4, 7, 12].forEach((s, j) => (th === 'star' || th === 'garden' ? bell(D, hz(base + s), t + j * 0.11, 1.8, 0.17, 0.6) : pluck(D, hz(base + s), t + j * 0.11, 0.24, 0.3)));
        tone(D, hz(base - 12), t, 0.2, { type: 'triangle', g: 0.12, r: 0.6, wet: 0.3 });
      } else if (kind === 'milestone') {   // 50~90% 달성 팡파르 (퍼센트가 높을수록 한 음 높게)
        const bs = 60 + Math.round(((o.pct || 50) - 50) / 10);
        [0, 4, 7, 12, 16].forEach((s, j) => tone(D, hz(bs + s), t + j * 0.09, 0.12, { type: 'sawtooth', g: 0.07, r: 0.35, lp: 2600, wet: 0.3 }));
        chordOf(D, [bs, bs + 4, bs + 7, bs + 12], t + 0.5, 0.5, { type: 'sawtooth', g: 0.05, a: 0.02, r: 0.9, lp: 1800, wet: 0.4 });
        nz(D, t + 0.5, 0.3, { f: 1800, q: 0.6, g: 0.1, wet: 0.2 }); [0, 1, 2].forEach(j => bell(D, hz(bs + 24 + j * 4), t + 0.6 + j * 0.1, 1.6, 0.07, 0.8));
      } else if (kind === 'finale') {   // 전원 출석 대팡파르 + 박수
        [[0, 0], [0.22, 5], [0.44, 7]].forEach(([d, s]) => chordOf(D, [60 + s, 64 + s, 67 + s, 72 + s], t + d, 0.2, { type: 'sawtooth', g: 0.06, r: 0.3, lp: 2400, wet: 0.35 }));
        chordOf(D, [60, 64, 67, 72, 76], t + 0.9, 1.3, { type: 'sawtooth', g: 0.06, a: 0.03, r: 1.6, lp: 2000, wet: 0.5 });
        for (let n = 0; n < 40; n++) nz(D, t + 1.0 + Math.random() * 3.2, 0.05 + Math.random() * 0.05, { f: 1200 + Math.random() * 2200, q: 0.5, g: 0.1 * (1 - n / 55) });
        for (let n = 0; n < 8; n++) bell(D, hz(84 + [0, 4, 7, 12][n % 4]), t + 1 + n * 0.14, 2, 0.06, 0.8);
      } else if (kind === 'land') {   // 캐릭터 착지 통통
        tone(D, 280, t, 0.02, { g: 0.1, r: 0.2, slide: 2.2, wet: 0.1 });
      } else if (kind === 'phone') {   // 휴대폰 출석 완료 띵동
        bell(D, hz(88), t, 1.4, 0.2, 0.4); bell(D, hz(84), t + 0.2, 1.8, 0.22, 0.5);
      }
    };
  }

  /* ---------------- 실제 재생(브라우저) ---------------- */
  const Sound = {
    Engine, mode: 'both', ctx: null, eng: null, theme: 'card', unlocked: false, user: { bgm: true, sfx: true, vol: 0.55, on: false },
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
    setTheme(th) { if (this.theme === th) return; this.theme = th; if (this.eng) this.eng.theme = th; this.stopBgm(); this.refresh(); },
    startBgm() {
      if (this._timer || !this.ctx) return;
      const e = this.eng, c = this.ctx; this._bar = 0; this._next = c.currentTime + 0.2;
      e.bgm.gain.cancelScheduledValues(c.currentTime); e.bgm.gain.setValueAtTime(0.0001, c.currentTime); e.bgm.gain.linearRampToValueAtTime(0.55 * this.user.vol, c.currentTime + 2);
      this._timer = setInterval(() => { while (this._next < c.currentTime + 4) { e.bar(this.theme, this._bar++, this._next); this._next += e.barLen(this.theme); } }, 1000);
    },
    stopBgm() { clearInterval(this._timer); this._timer = 0; if (this.ctx && this.eng) { const g2 = this.eng.bgm.gain, n = this.ctx.currentTime; g2.cancelScheduledValues(n); g2.setTargetAtTime(0.0001, n, 0.2); } },
    refresh() { if (this.unlocked && this.bgmOn()) this.startBgm(); else this.stopBgm(); this.ui(); },
    sfx(kind, o) {
      try { if (g.__sfxLog) g.__sfxLog.push({ t: performance.timeOrigin + performance.now(), kind, o: o || {} }); } catch (e) {}
      if (!this.unlocked || !this.sfxOn() || document.hidden) return;
      this.eng.theme = this.theme; const now = this.ctx.currentTime;
      if (['dept', 'milestone', 'finale'].includes(kind) && this.bgmOn()) { const gg = this.eng.bgm.gain, v = 0.55 * this.user.vol; gg.cancelScheduledValues(now); gg.setTargetAtTime(v * 0.35, now, 0.03); gg.setTargetAtTime(v, now + (kind === 'finale' ? 3.8 : 1.4), 0.4); }
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
        ? `${this.mode === 'both' ? `<button type="button" data-a="bgm" class="${this.user.bgm ? 'on' : ''}" aria-pressed="${this.user.bgm}">🎵 음악</button>` : ''}<button type="button" data-a="sfx" class="${this.user.sfx ? 'on' : ''}" aria-pressed="${this.user.sfx}">🔔 효과음</button>${this.mode === 'both' ? `<input type="range" min="0" max="1" step="0.05" value="${this.user.vol}" aria-label="음악 크기">` : ''}`
        : `<button type="button" data-a="go" class="go">🔊 소리 켜기</button>`;
    }
  };
  g.Sound = Sound;
})(window);
