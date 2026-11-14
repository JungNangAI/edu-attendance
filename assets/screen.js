/* 강의실 출석 화면: 테마별 보드, 2.5초마다 출석 확인, 환영 배너, 관리 도구(엑셀·새 회차·출석 취소) */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const A = window.App;
  const PREVIEW = A.query('preview') === '1';
  const eventId = A.query('e');

  let cfg = A.withDefaults({}), roster = [], byNo = new Map(), assets = {};
  let token = null, isAdmin = false;
  let sessionId = null, sessionLabel = '', lastList = [], updatedAt = null;
  let mode = 'in', lastOuts = [], outSet = new Set(), phones = {};   // 입실/퇴실, 퇴실한 사람, 연락처(관리 화면만)
  const isOutMode = () => mode === 'out';
  let displayed = [], queue = [], slots = [], theme = 'card', running = false;
  let shownCount = 0, msDone = 0;   // msDone: 이미 축하한 가장 높은 출석률(%)
  const MILESTONES = [50, 60, 70, 80, 90, 100];
  const COUNT_MS = [10, 20, 30, 50, 80, 100, 150, 200, 300, 500, 1000];   // 명단 없이 받을 때: 몇 명 돌파
  let rosterNos = new Set();           // 명단에 있는 번호
  const extraMap = new Map();          // 명단 밖에서 온 사람 (번호 → 사람)
  const rosterHere = () => displayed.filter(no => rosterNos.has(no)).length;
  const extraHere = () => displayed.concat(queue).filter(no => !rosterNos.has(no)).length;
  const pctNow = () => roster.length ? Math.floor(rosterHere() * 100 / roster.length) : 0;
  const msReached = () => roster.length ? (MILESTONES.filter(m => pctNow() >= m).pop() || 0) : (COUNT_MS.filter(m => displayed.length >= m).pop() || 0);

  /* ---------- 작은 도구 ---------- */
  function seeded(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function fitGrid(n, W, H, ar, gap) {
    let best = null;
    for (let c = 1; c <= Math.max(1, n); c++) {
      const r = Math.ceil(n / c);
      let w = (W - gap * (c - 1)) / c, h = (H - gap * (r - 1)) / r;
      if (w <= 0 || h <= 0) continue;
      if (w / h > ar) w = h * ar; else h = w / ar;
      if (!best || w * h > best.w * best.h) best = { c, r, w, h };
    }
    return best || { c: 1, r: 1, w: W, h: H };
  }
  function placeGrid(board, n, ar, gapRatio, make, inset = {}) {
    const L = inset.l || 0, R = inset.r || 0, T = inset.t || 0, B = inset.b || 0;
    const W = board.clientWidth - L - R, H = board.clientHeight - T - B, gap = Math.min(W, H) * gapRatio;
    const g = fitGrid(n, W, H, ar, gap);
    const ox = L + (W - (g.c * g.w + (g.c - 1) * gap)) / 2, oy = T + (H - (g.r * g.h + (g.r - 1) * gap)) / 2;
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / g.c), c = i % g.c;
      const s = make(i);
      Object.assign(s.style, { left: ox + c * (g.w + gap) + 'px', top: oy + r * (g.h + gap) + 'px', width: g.w + 'px', height: g.h + 'px' });
      board.appendChild(s); out.push(s);
    }
    return out;
  }
  // --n: 이름 글자 수(3~8). 새 테마는 이 수에 맞춰 이름 글자 크기를 정해 긴 이름도 잘리지 않는다
  const label = p => `<div class="dp">${A.esc(p.dept)}</div><div class="nm" style="--n:${Math.max(3, Math.min(8, [...String(p.name || '')].length))}">${A.esc(p.name)}</div>`;
  function shuffled(list, seed) {
    const rnd = seeded(seed), order = list.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    return order.map(i => list[i]);
  }

  /* ---------- 은하수 그리기 (캔버스, 한 번만) ---------- */
  function drawGalaxy(cv, W, H) {
    const dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const x = cv.getContext('2d'); x.scale(dpr, dpr);
    const r = seeded(1977);
    const gauss = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    x.fillStyle = '#02030a'; x.fillRect(0, 0, W, H);
    // 은하수 띠: 왼쪽 아래 → 오른쪽 위
    const ax = -0.1 * W, ay = 1.0 * H, bx = 1.1 * W, by = -0.05 * H;
    const len = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / len, uy = (by - ay) / len, nx = -uy, ny = ux;
    const band = Math.max(H, W * 0.5) * 0.15;
    const at = (t, off) => [ax + (bx - ax) * t + nx * off, ay + (by - ay) * t + ny * off];
    const glow = (px, py, rad, rgb, a) => {
      const g = x.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
      x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.fill();
    };
    x.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 320; i++) {   // 뿌연 빛(성운)
      const t = r(), [px, py] = at(t, gauss() * band * 0.8), core = Math.exp(-((t - 0.52) ** 2) / 0.02);
      const rgb = r() < core * 0.8 ? '255,186,130' : (r() < 0.5 ? '150,165,255' : '200,150,255');
      glow(px, py, band * (0.5 + r() * 1.3), rgb, 0.018 + r() * 0.022 + core * 0.02);
    }
    for (let i = 0; i < 14; i++) { const [px, py] = at(0.44 + r() * 0.16, gauss() * band * 0.3); glow(px, py, band * (0.8 + r()), '255,214,170', 0.05); }
    for (let i = 0; i < 9000; i++) {  // 띠 안의 잔별
      const t = r(), [px, py] = at(t, gauss() * band * 0.6), s = 0.3 + r() * r() * 1.1;
      x.fillStyle = `rgba(${r() < .2 ? '255,225,200' : r() < .4 ? '200,215,255' : '255,255,255'},${0.25 + r() * 0.6})`;
      x.fillRect(px, py, s, s);
    }
    for (let i = 0; i < 2600; i++) { const s = 0.3 + r() * r() * 1.3; x.fillStyle = `rgba(255,255,255,${0.15 + r() * 0.6})`; x.fillRect(r() * W, r() * H, s, s); }
    // 먼지띠: 띠 가운데를 따라 어둡게
    x.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 520; i++) {
      const t = r(), off = gauss() * band * 0.16 + Math.sin(t * 17) * band * 0.08, [px, py] = at(t, off);
      glow(px, py, band * (0.06 + r() * 0.22), '3,3,10', 0.18 + r() * 0.22);
    }
    x.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 700; i++) { const [px, py] = at(r(), gauss() * band * 0.5), s = 0.4 + r() * 0.8; x.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.6})`; x.fillRect(px, py, s, s); }
    for (let i = 0; i < 46; i++) {   // 밝은 별
      const px = r() * W, py = r() * H, rad = 2 + r() * 5;
      glow(px, py, rad * 3, r() < .3 ? '255,220,190' : '190,210,255', 0.35); x.fillStyle = '#fff'; x.beginPath(); x.arc(px, py, 0.6 + r() * 0.8, 0, 7); x.fill();
    }
    x.globalCompositeOperation = 'source-over';
    const v = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.6)');
    x.fillStyle = v; x.fillRect(0, 0, W, H);
  }

  /* ---------- 장미 ---------- */
  // 장미 9색 (꽃말 사진 순서): [이름, 꽃잎 바깥(밝은), 기본, 안쪽(어두운)]
  const ROSE_COLORS = [
    ['빨간색', '#ff5a6e', '#d1102b', '#6e0013'], ['핑크색', '#ffc2d6', '#f27ba6', '#a8326a'], ['주황색', '#ffb36b', '#f57c1f', '#a33f00'],
    ['노란색', '#fff3a0', '#f9cf2a', '#b27d00'], ['파란색', '#b9c6ff', '#6f86e0', '#2c3b8f'], ['하얀색', '#ffffff', '#f3efe4', '#c2b7a0'],
    ['초록색', '#d9f2a6', '#9acb55', '#4f7a1f'], ['보라색', '#e3b8ff', '#a65ad6', '#5b1f86'], ['검정색', '#7a2a3e', '#3a0d1a', '#12030a']
  ];
  const ROSES = ROSE_COLORS.map(c => c[2]);
  const roseDefs = () => `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${ROSE_COLORS.map(([, lt, base, dk], k) =>
    `<radialGradient id="rg${k}" gradientUnits="userSpaceOnUse" cx="50" cy="42" r="34"><stop offset="0" stop-color="${dk}"/><stop offset=".42" stop-color="${base}"/><stop offset="1" stop-color="${lt}"/></radialGradient>` +
    `<linearGradient id="rb${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lt}"/><stop offset=".55" stop-color="${base}"/><stop offset="1" stop-color="${dk}"/></linearGradient>`).join('')}</defs></svg>`;
  // 꽃잎 한 장 (중심에서 위로 뻗음): 길이 L, 너비 W
  const petal = (L, W) => `M0 2 C ${-W} 0 ${-W * 1.15} ${-L * .82} ${-W * .2} ${-L} Q0 ${-L * 1.06} ${W * .2} ${-L} C ${W * 1.15} ${-L * .82} ${W} 0 0 2Z`;
  function roseSvg(k) {
    const f = `url(#rg${k})`, edge = ROSE_COLORS[k][3];
    const ring = (cls, n, L, W, rot) => `<g class="ring ${cls}">${Array.from({ length: n }, (_, i) =>
      `<path d="${petal(L, W)}" transform="translate(50 42) rotate(${rot + i * 360 / n})" fill="${f}" stroke="${edge}" stroke-opacity=".45" stroke-width=".8"/>`).join('')}</g>`;
    return `<svg viewBox="0 0 100 100" aria-hidden="true">
      <path d="M50 100 C49 86 51 72 50 56" stroke="#3f8a46" stroke-width="3.2" fill="none"/>
      <path d="M50 84 C40 78 33 80 28 73 C37 70 46 75 50 82Z" fill="#4f9a52"/><path d="M50 72 C60 66 67 68 72 61 C63 59 54 63 50 70Z" fill="#5aa65c"/>
      <g transform="translate(50 46) scale(1.5) translate(-50 -42)"><g class="bud"><path d="M50 58 C39 53 40 36 50 26 C60 36 61 53 50 58Z" fill="url(#rb${k})" stroke="${edge}" stroke-opacity=".5" stroke-width=".8"/>
        <path d="M50 44 C46 40 46 34 50 30" stroke="${edge}" stroke-opacity=".45" fill="none" stroke-width=".9"/>
        <path d="M41 50 Q50 64 59 50 L56 58 Q50 62 44 58Z" fill="#4f9a52"/><path d="M50 58 Q44 46 38 44 Q44 54 50 58Z" fill="#5aa65c"/><path d="M50 58 Q56 46 62 44 Q56 54 50 58Z" fill="#5aa65c"/></g></g>
      <g transform="translate(50 40) scale(1.62) translate(-50 -42)"><g class="bloom">${ring('r3', 5, 30, 17, 0)}${ring('r2', 5, 23, 13, 36)}${ring('r1', 4, 15, 10, 15)}
        <g class="ring r0"><circle cx="50" cy="42" r="6.5" fill="${f}" stroke="${edge}" stroke-opacity=".5" stroke-width=".8"/>
        <path d="M50 42 m-4 0 a4 4 0 1 1 4 4 a2.6 2.6 0 1 1 -2.6 -2.6" stroke="${edge}" stroke-opacity=".7" stroke-width="1.1" fill="none"/></g></g></g></svg>`;
  }

  /* ---------- 글주임 무리 (10명): 옆자리 주민 + 출석 때 날아오는 손님 + 전원 출석 퍼레이드 ---------- */
  const CAST_ALL = [['main', '{n}님, 환영해요!', '환영해요!'], ['news', '{n}님, 반가운 소식!', '반가워요!'], ['chuck', '{n}님, 척척 환영!', '척척 환영!'],
    ['call', '{n}님, 반갑습니다!', '반갑습니다!'], ['meet', '{n}님, 어서 오세요!', '어서 오세요!'], ['night', '{n}님, 든든하게 환영!', '든든하게 환영!'],
    ['law', '{n}님, 대환영이에요!', '대환영이에요!'], ['fin', '{n}님, 환영 100점!', '환영 100점!'], ['welcome', '{n}님, 어서 와요!', '어서 와요!'], ['relay', '{n}님, 환영 바통 쏙!', '환영 바통 쏙!']];
  const say = (ch, name) => name ? ch.tpl.replace('{n}', name) : ch.gen;   // 이름이 있으면 그 사람에게 환영 인사
  const randName = () => { const no = displayed[Math.random() * displayed.length | 0], p = byNo.get(no); return p ? p.name : null; };
  const CAST_SPOTS = {   // sides: 놓을 쪽, spots: [아래에서 %, 너비 %(보드 너비 기준)]
    card: { sides: ['r'], spots: [[0, 19], [32, 19], [64, 19]] },
    apartment: { sides: ['l', 'r'], spots: [[1, 14], [33, 14], [65, 14]] },
    star: { sides: ['l', 'r'], spots: [[1, 14], [33, 14], [65, 14]] },
    garden: { sides: ['l', 'r'], spots: [[1, 14], [33, 14], [65, 14]] }
  };
  const FLY = { card: 'arc', apartment: 'chute', star: 'comet', garden: 'hop', lantern: 'comet', forest: 'hop', train: 'hop', ocean: 'comet' };
  const GLYPH = { card: ['★', '✦', '♥', '●'], apartment: ['✦', '★', '✧', '●'], star: ['✧', '✦', '★', '✶'], garden: ['✿', '❀', '♥', '✿'],
    lantern: ['✦', '●', '✧', '★'], forest: ['❀', '✿', '♣', '●'], ocean: ['○', '◦', '●', '✧'], plaque: ['✦', '★', '✦', '✧'] };
  let castTimers = [], castFly = 0;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  // 움직임 세기: calm(차분) / normal(보통, 기본) / wild(과하게). 주소 끝 ?motion=calm 으로 바로 바꿀 수 있다
  const MOTS = {
    calm: { fly: 0, cheer: 0, talk: 5200, swap: 0, burst: 0, parade: false, rain: false, gust: false },
    normal: { fly: 0.34, cheer: 3, talk: 4200, swap: 10000, burst: 10, parade: true, rain: false, gust: true },
    wild: { fly: 1, cheer: 99, talk: 2400, swap: 6500, burst: 18, parade: true, rain: true, gust: true }
  };
  const motion = () => { const m = new URLSearchParams(location.search).get('motion') || cfg.screen.motion; return MOTS[m] ? m : 'normal'; };
  const MOT = () => MOTS[motion()];
  const AR = {};
  function arOf(src) { if (AR[src]) return AR[src]; const im = new Image(); im.onload = () => { AR[src] = im.naturalHeight / im.naturalWidth; }; im.src = src; return 0.8; }
  function castStop() { castTimers.forEach(t => clearInterval(t)); castTimers = []; castFly = 0; }
  function castPool() {   // 행사에서 올린 캐릭터가 있으면 그것만, 없으면 글주임 10명
    if (cfg.screen.characters === false) return [];
    const cheer = cfg.screen.texts.cheer || '환영해요!';
    if (assets.char_left || assets.char_right) return [assets.char_left, assets.char_right].filter(Boolean).map(src => ({ src, tpl: '{n}님, ' + cheer, gen: cheer }));
    return CAST_ALL.map(([k, tpl, gen], i) => ({ src: `assets/defaults/${k}.png`, tpl: i === 0 && cfg.screen.texts.cheer ? '{n}님, ' + cheer : tpl, gen: i === 0 ? cheer : gen }));
  }
  function castTalk(r, ms, name) { if (r._ch) r.querySelector('.bubble').textContent = say(r._ch, name); r.classList.add('talk'); clearTimeout(r._t); r._t = setTimeout(() => r.classList.remove('talk'), ms); }
  function castSwap(layer, pool) {   // 주민이 한 명씩 다른 캐릭터로 교대
    const rs = [...layer.querySelectorAll('.res')];
    const used = new Set(rs.map(x => x.dataset.src)), free = pool.filter(c => !used.has(c.src));
    if (!rs.length || !free.length) return;
    const r = rs[Math.random() * rs.length | 0], nx = free[Math.random() * free.length | 0];
    r.classList.add('out');
    setTimeout(() => {
      r.querySelector('img').src = nx.src; r.dataset.src = nx.src; r._ch = nx;
      r.classList.remove('out'); r.classList.add('in'); castTalk(r, 2000, randName()); setTimeout(() => r.classList.remove('in'), 800);
    }, 450);
  }
  function addCast(board, th) {
    const pool = castPool(); if (!pool.length) return false;
    pool.forEach(c => arOf(c.src));
    const layer = el('div', 'cast m-' + motion()); board.appendChild(layer);
    const custom = !!(assets.char_left || assets.char_right), spec = CAST_SPOTS[th] || CAST_SPOTS.garden;
    const order = shuffled(pool, Date.now() % 9973); let k = 0;
    spec.sides.forEach(side => (custom ? spec.spots.slice(0, 1) : spec.spots).forEach(([b, w]) => {
      const ch = custom ? { src: (side === 'l' ? assets.char_left : assets.char_right) || assets.char_right || assets.char_left, tpl: pool[0].tpl, gen: pool[0].gen } : order[k % order.length];
      const r = el('div', `res ${side} mood${k++ % 4}`); r.dataset.src = ch.src;
      Object.assign(r.style, { bottom: b + '%', width: w + '%', animationDelay: '-' + (Math.random() * 2).toFixed(2) + 's', animationDuration: (1.3 + Math.random() * 1.4).toFixed(2) + 's' });
      r.innerHTML = `<span class="bubble"></span><img src="${ch.src}" alt="">`;
      r._ch = ch; r.querySelector('.bubble').textContent = ch.gen; layer.appendChild(r);
    }));
    if (!reduced()) {
      const M = MOT();
      castTimers.push(setInterval(() => { const rs = layer.querySelectorAll('.res'); if (rs.length) castTalk(rs[Math.random() * rs.length | 0], 2000, randName()); }, M.talk));
      if (!custom && M.swap) castTimers.push(setInterval(() => castSwap(layer, pool), M.swap));
    }
    return true;
  }
  function cheerChars(board, name) {   // 출석할 때마다 주민 전원이 줄줄이 점프
    const all = [...board.querySelectorAll('.res')], M = MOT();
    if (!M.cheer) { if (all.length) castTalk(all[Math.random() * all.length | 0], 2400, name); return; }   // 차분: 한 명만 이름 인사
    all.sort(() => Math.random() - .5).slice(0, M.cheer).forEach((c, i) => setTimeout(() => {
      c.classList.remove('cheer'); void c.offsetWidth; c.classList.add('cheer'); castTalk(c, 1500, name);
      clearTimeout(c._c); c._c = setTimeout(() => c.classList.remove('cheer'), 1200);
    }, i * 140));
  }
  function burst(board, cx, cy, n) {
    const layer = board.querySelector('.cast'); if (!layer || reduced()) return;
    const g = GLYPH[theme] || GLYPH.card, cols = ['#ffd43b', '#ff6b6b', '#4dabf7', '#51cf66', '#f06595', '#ffffff', '#b197fc'];
    for (let i = 0; i < n; i++) {
      const q = el('i', 'pf'); q.textContent = g[i % g.length]; q.style.color = cols[i % cols.length]; layer.appendChild(q);
      const a = Math.random() * Math.PI * 2, d = innerHeight * (0.07 + Math.random() * 0.12);
      q.animate([{ transform: `translate(${cx}px,${cy}px) scale(.3)`, opacity: 1 },
        { transform: `translate(${cx + Math.cos(a) * d}px,${cy + Math.sin(a) * d - d * 0.3}px) scale(${1 + Math.random()}) rotate(${Math.random() * 540 - 270}deg)`, opacity: 0 }],
        { duration: 800 + Math.random() * 600, easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => q.remove();
    }
  }
  const T = (x, y, r = 0, sx = 1, sy = sx) => `translate(${x}px,${y}px) rotate(${r}deg) scale(${sx},${sy})`;
  function flightFrames(style, c) {
    const { tx, ty, W, H, sz, h } = c, F = (o, t) => ({ offset: o, transform: t, easing: 'ease-in-out' });
    const hold = R => [F(.44, T(tx, ty, R, 1.12, .88)), F(.5, T(tx, ty - h * .22, R - 8, .96, 1.06)), F(.58, T(tx, ty, R + 8, 1.1, .9)),
      F(.66, T(tx, ty - h * .16, R - 6, .97, 1.04)), F(.74, T(tx, ty, R, 1.06, .94)), F(.8, T(tx, ty, R, 1))];
    if (style === 'chute') return [F(0, T(tx + sz * .9, -h * 1.8, 0, .9)), F(.1, T(tx - sz * .5, ty * .3, -16)), F(.2, T(tx + sz * .45, ty * .55, 16)),
      F(.3, T(tx - sz * .2, ty * .8, -10)), F(.38, T(tx + sz * .06, ty * .96, 5)), ...hold(0), F(.86, T(tx, ty - h * .35, 0, 1.05)), F(1, T(tx + sz * .5, -h * 2, 25, .8))];
    if (style === 'comet') return [F(0, T(W + sz, -h * 1.2, -40, .4)), F(.2, T((W + tx) / 2 + sz * .5, ty * .2, 140, .9)), F(.36, T(tx - sz * .15, ty + h * .12, 340, 1.05)),
      ...hold(360), F(.88, T(tx, ty - h * .2, 360, 1.1)), F(1, T(-sz * 1.3, H * .05, -60, .2))];
    if (style === 'hop') {
      const sx = tx < W / 2 ? -sz * 1.2 : W + sz * .2, gy = H - h * 1.05, ex = tx < W / 2 ? W + sz : -sz * 1.3, x = i => sx + (tx - sx) * i / 4;
      return [F(0, T(sx, gy)), F(.05, T(x(.5), gy - h * .5, -10)), F(.1, T(x(1), gy, 0, 1.15, .85)), F(.15, T(x(1.5), gy - h * .5, 10)), F(.2, T(x(2), gy, 0, 1.15, .85)),
        F(.25, T(x(2.5), gy - h * .5, -10)), F(.3, T(x(3), gy, 0, 1.15, .85)), F(.37, T((x(3) + tx) / 2, Math.min(ty, gy) - h * .8, 180, 1.05)),
        ...hold(360), F(.86, T(tx, ty - h * .4, 360, 1.08)), F(.93, T((tx + ex) / 2, ty - h * .6, 360)), F(1, T(ex, gy, 360, 1.1, .9))];
    }
    return [F(0, T(W, H, 0, .3)), F(.2, T((W + tx) / 2, Math.min(ty, H * .4) - h * .8, 360, 1.15)), ...hold(720), F(.86, T(tx, ty - h * .3, 720, 1.05)), F(1, T(-sz, -h, 1080, .4))];
  }
  function castArrive(slot, p) {   // 새 출석자 칸 위로 글주임이 날아와 이름을 불러준다
    const board = $('board'), layer = board.querySelector('.cast');
    if (!layer || reduced() || castFly >= 4) return;
    const M = MOT();
    if (!M.fly || (displayed.length > 1 && Math.random() > M.fly)) return;   // 보통: 첫 출석 + 3번에 1번꼴
    if (queue.length > 3 && Math.random() < 0.6) return;
    const pool = castPool(); if (!pool.length) return;
    const ch = pool[Math.random() * pool.length | 0];
    const B = board.getBoundingClientRect(), r = slot.getBoundingClientRect(), W = B.width, H = B.height;
    const sz = Math.max(48, W * 0.125), h = sz * arOf(ch.src);
    const tx = Math.max(0, Math.min(W - sz, r.left - B.left + r.width / 2 - sz / 2)), ty = Math.max(6, r.top - B.top - h + r.height * 0.2);
    const f = el('div', 'flyer'); f.style.width = sz + 'px';
    f.innerHTML = `${theme === 'apartment' ? '<i class="chute"></i>' : ''}<span class="bubble"></span><img src="${ch.src}" alt="">`;
    f.querySelector('.bubble').innerHTML = (p && p.dept ? `<small>${A.esc(p.dept)}</small>` : '') + A.esc(say(ch, p && p.name));
    layer.appendChild(f); castFly++;
    const dur = theme === 'garden' ? 4200 : 3600;
    const ch1 = f.querySelector('.chute');
    if (ch1) ch1.animate([{ opacity: 1, offset: 0 }, { opacity: 1, offset: .4 }, { opacity: 0, transform: 'translateY(40%) scale(.5)', offset: .47 }, { opacity: 0, offset: 1 }], { duration: dur, fill: 'forwards' });
    const a = f.animate(flightFrames(FLY[theme] || 'arc', { tx, ty, W, H, sz, h }), { duration: dur, fill: 'forwards' });
    setTimeout(() => { Sound.sfx('land'); f.classList.add('talk'); burst(board, tx + sz / 2, ty + h * 0.8, M.burst); }, dur * 0.44);
    setTimeout(() => f.classList.remove('talk'), dur * 0.8);
    a.onfinish = () => { f.remove(); castFly--; };
  }
  function deptStat(d) { const att = new Set(displayed); let t = 0, a = 0; roster.forEach(q => { if (q.dept === d) { t++; if (att.has(q.no)) a++; } }); return { t, a }; }
  function deptToast(d) {
    const t = el('div', 'ms-toast dept'); t.innerHTML = `<b>${A.esc(d)}</b> 전원 출석!`; document.body.appendChild(t);
    t.animate([{ transform: 'translate(-50%,-30%) scale(.3)', opacity: 0 }, { transform: 'translate(-50%,0) scale(1.12)', opacity: 1, offset: .2 }, { transform: 'translate(-50%,0) scale(1)', opacity: 1, offset: .85 }, { transform: 'translate(-50%,-20%) scale(.8)', opacity: 0 }], { duration: 3200 }).onfinish = () => t.remove();
  }
  function milestoneToast(m, tail = '% 출석 달성!') {
    const t = el('div', 'ms-toast'); t.innerHTML = tail[0] === '%' ? `<b>${m}%</b>${A.esc(tail.slice(1))}` : `<b>${m}</b>${A.esc(tail)}`; document.body.appendChild(t);
    t.animate([{ transform: 'translate(-50%,-30%) scale(.3)', opacity: 0 }, { transform: 'translate(-50%,0) scale(1.15)', opacity: 1, offset: .2 }, { transform: 'translate(-50%,0) scale(1)', opacity: 1, offset: .85 }, { transform: 'translate(-50%,-20%) scale(.8)', opacity: 0 }], { duration: 3000 }).onfinish = () => t.remove();
  }
  function castFinale(board, ratio = 1) {   // ratio: 출석률 — 퍼레이드에 나오는 캐릭터 수가 그 비율만큼   // 전원 출석: 글주임 퍼레이드 + 캐릭터 비
    const layer = board.querySelector('.cast'); if (!layer || reduced()) return;
    const pool = castPool(); if (!pool.length) return;
    const B = board.getBoundingClientRect(), W = B.width, H = B.height, sz = Math.max(60, W * 0.15), n = Math.max(1, Math.round(10 * ratio));
    const cast = shuffled(pool, Date.now() % 7919);
    for (let i = 0; i < (MOT().rain ? Math.round(16 * ratio) : 0); i++) {
      const ch = pool[Math.random() * pool.length | 0], s2 = Math.max(40, W * 0.075), h = s2 * arOf(ch.src), x = Math.random() * (W - s2), sp = Math.random() * 720 - 360;
      const f = el('div', 'flyer'); f.style.width = s2 + 'px'; f.innerHTML = `<img src="${ch.src}" alt="">`; layer.appendChild(f);
      f.animate([{ transform: T(x, -h * 1.2, 0) }, { transform: T(x + (Math.random() - .5) * 80, H + h * .2, sp) }], { duration: 2800 + Math.random() * 2200, delay: Math.random() * 1800, easing: 'cubic-bezier(.4,0,.8,.6)', fill: 'both' }).onfinish = () => f.remove();
    }
    for (let i = 0; i < n; i++) {
      const ch = cast[i % cast.length], h = sz * arOf(ch.src), base = H - h - 4 - (i % 3) * H * 0.1;
      const f = el('div', 'flyer parade'); f.style.width = sz + 'px';
      f.innerHTML = `<span class="bubble"></span><img src="${ch.src}" alt="">`; f.querySelector('.bubble').textContent = ch.gen; layer.appendChild(f);
      const K = 16, fr = [];
      for (let k = 0; k <= K; k++) fr.push({ offset: k / K, transform: T(-sz + (W + 2 * sz) * k / K, base - (k % 2 ? h * 0.45 : 0), k % 2 ? 12 : -12, k % 2 ? .96 : 1.1, k % 2 ? 1.06 : .9), easing: 'ease-out' });
      const delay = i * 380;
      f.animate(fr, { duration: 6500, delay, fill: 'both' }).onfinish = () => f.remove();
      [1600, 3800].forEach(t => setTimeout(() => { f.classList.add('talk'); setTimeout(() => f.classList.remove('talk'), 1300); }, delay + t));
    }
    cheerChars(board);
  }

  /* ---------- 테마 ---------- */
  const JN = ['#106A3A', '#9E1C84', '#0057A3'];
  const THEME_IMPL = {
    card: {   // 중랑 카드
      build(board, n) {
        const has = addCast(board, 'card');
        return placeGrid(board, n, 1.75, 0.018, i => {
          const s = el('div', 'slot'); s.style.setProperty('--cc', JN[i % 3]);
          s.innerHTML = `<div class="face front">${i + 1}</div><div class="face back"></div>`;
          return s;
        }, { r: has ? board.clientWidth * 0.2 : 0 });
      },
      fill(s, p) { s.querySelector('.back').innerHTML = `<div class="nm">${A.esc(p.name)}</div><div class="dp">${A.esc(p.dept)}</div>`; },
      cheer: cheerChars
    },
    apartment: {   // 3D 아파트: 이름 칸(창문)이 가장 커지는 배치를 골라 그린다
      build(board, n) {
        board.insertAdjacentHTML('beforeend', '<div class="sky-moon"></div><div class="city"></div><div class="ground"></div>');
        const r0 = seeded(11);
        for (let i = 0; i < 30; i++) { const t = el('i', 'sky-star'); Object.assign(t.style, { left: r0() * 100 + '%', top: r0() * 30 + '%', animationDelay: r0() * 3 + 's' }); board.appendChild(t); }
        const hasC = addCast(board, 'apartment');
        const W = board.clientWidth * (hasC ? 0.7 : 1), H = board.clientHeight, vh = innerHeight / 100;
        const gap = 0.9 * vh, pad = 1.1 * vh, bgap = W * 0.012, doorH = 3.6 * vh, DEPTH = 0.5;
        const usableH = H * (1 - 0.085) - H * 0.075;      // 땅(8.5%)과 위 여백을 뺀 높이
        let best = null;
        // 인원에 맞춰 동 수(1~3)·열·층을 골라 창문이 가장 크게 — 적으면 큰 건물 한두 동, 많으면 세 동
        for (const B of [1, 2, 3]) for (let c = 1; c <= 7; c++) for (let side = 1; side <= 12; side++) for (const extra of [1, 2]) {
          if (B === 1 && extra === 2) continue;
          const mid = side + extra, fl = B === 3 ? [side, mid, side] : B === 2 ? [side, mid] : [mid], tot = c * fl.reduce((x, y) => x + y, 0);
          if (tot < n + 1 || tot > n * 1.6 + 8) continue;
          const wwW = (W * 0.97 - B * (2 * pad + (c - 1) * gap) - (B - 1) * bgap) / (B * c + B * DEPTH);
          // 가운데 동 높이 = 위 여백 + 층들 + 문 + 옥상(창 너비 × 0.42)이 쓸 수 있는 높이 안에 들어가야 한다
          const roofK = DEPTH * 0.839;
          let wh = (usableH - pad - doorH - gap * mid) / (mid + roofK * 1.5), ww = Math.min(wwW, wh * 1.5);
          wh = Math.min(wh, ww / 0.95, (usableH - pad - doorH - gap * mid - roofK * ww) / mid);
          if (ww / wh < 0.95) continue;
          const score = Math.min(ww, wh * 1.6) * wh;          // 글자가 들어갈 넓이
          if (!best || score > best.score) best = { B, c, fl, ww, wh, score };
        }
        const { B, c, fl, ww, wh } = best || { B: 3, c: 4, fl: [3, 4, 3], ww: 60, wh: 50 };
        const D = ww * DEPTH;
        const wrap = el('div', 'bldgs'); if (hasC) { wrap.style.left = '15%'; wrap.style.right = '15%'; }
        wrap.style.setProperty('--d', D + 'px'); wrap.style.setProperty('--fh', (wh + gap) + 'px');
        wrap.style.gap = (D + bgap) + 'px'; wrap.style.paddingRight = D + 'px';
        const wins = [];
        fl.forEach((f, k) => {
          const b = el('div', 'bldg'); b.style.setProperty('--bc', JN[(B === 1 ? [1] : B === 2 ? [0, 1] : [0, 1, 2])[k]]);
          Object.assign(b.style, { gridTemplateColumns: `repeat(${c}, ${ww}px)`, gridAutoRows: `${wh}px`, gap: gap + 'px', padding: `${pad}px ${pad}px 0` });
          b.innerHTML = '<div class="top"></div><div class="side"></div><div class="shadow"></div>';
          for (let i = 0; i < f * c; i++) { const s = el('div', 'slot'); b.appendChild(s); wins.push(s); }
          const d = el('div', 'door'); d.style.height = doorH + 'px'; b.appendChild(d);
          wrap.appendChild(b);
        });
        board.appendChild(wrap);
        return shuffled(wins, 20261105).slice(0, n);
      },
      fill(s, p) { s.innerHTML = label(p); }
    },
    star: {   // 은하수
      build(board, n) {
        const cv = document.createElement('canvas'); cv.className = 'galaxy'; board.appendChild(cv);
        drawGalaxy(cv, board.clientWidth, board.clientHeight);
        const sky = el('div', 'sky'); board.appendChild(sky);
        const r0 = seeded(7);
        for (let i = 0; i < 28; i++) { const t = el('i', 'tw'); Object.assign(t.style, { left: r0() * 100 + '%', top: r0() * 100 + '%', animationDelay: (r0() * 3) + 's', transform: `scale(${0.5 + r0()})` }); sky.appendChild(t); }
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'links');
        svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path')); board.appendChild(svg);
        const rnd = seeded(20261108);
        const hasC = addCast(board, 'star'), SW = board.clientWidth * 0.15;
        const list = placeGrid(board, n, 1.3, 0.01, () => { const s = el('div', 'slot'); s.innerHTML = `<div class="star"><i></i><i></i></div><div class="lbl"></div>`; return s; }, { l: hasC ? SW : 0, r: hasC ? SW : 0 });
        const BW = board.clientWidth, BH = board.clientHeight;
        list.forEach(s => {
          const w = parseFloat(s.style.width), h = parseFloat(s.style.height);
          const px = parseFloat(s.style.left) + (rnd() - 0.5) * w * 0.35, py = parseFloat(s.style.top) + (rnd() - 0.5) * h * 0.3;
          s.style.left = Math.max(0, Math.min(BW - w, px)) + 'px'; s.style.top = Math.max(0, Math.min(BH - h, py)) + 'px';
        });
        return shuffled(list, 20261108);
      },
      fill(s, p) { s.querySelector('.lbl').innerHTML = label(p); },
      arrive(s, board, done) {
        const b = board.getBoundingClientRect(), r = s.querySelector('.star').getBoundingClientRect();
        const tx = r.left + r.width / 2 - b.left, ty = r.top + r.height / 2 - b.top;
        const sx = b.width + 40, sy = -40, ang = Math.atan2(ty - sy, tx - sx) * 180 / Math.PI;
        const sh = el('div', 'shoot'); board.appendChild(sh);
        const w = sh.offsetWidth;
        const anim = sh.animate([
          { transform: `translate(${sx - w}px, ${sy}px) rotate(${ang}deg)`, opacity: 0 },
          { opacity: 1, offset: 0.2 },
          { transform: `translate(${tx - w}px, ${ty}px) rotate(${ang}deg)`, opacity: 1 }
        ], { duration: 750, easing: 'cubic-bezier(.4,0,.6,1)' });
        anim.onfinish = () => { sh.remove(); done(); };
      },
      after(board) {
        const b = board.getBoundingClientRect();
        const pts = slots.slice(0, displayed.length).map(s => { const r = s.querySelector('.star').getBoundingClientRect(); return [r.left + r.width / 2 - b.left, r.top + r.height / 2 - b.top]; });
        let d = '';
        for (let i = 1; i < pts.length; i++) {
          let best = 0, bd = Infinity;
          for (let j = 0; j < i; j++) { const q = (pts[i][0] - pts[j][0]) ** 2 + (pts[i][1] - pts[j][1]) ** 2; if (q < bd) { bd = q; best = j; } }
          d += `M${pts[best][0].toFixed(1)} ${pts[best][1].toFixed(1)}L${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)}`;
        }
        const path = board.querySelector('svg.links path'); if (path) path.setAttribute('d', d);
      }
    },
    garden: {   // 장미축제
      build(board, n) {
        const W = board.clientWidth, H = board.clientHeight;
        // 그라데이션(장미 음영) 정의
        board.insertAdjacentHTML('beforeend', roseDefs());
        // 장미 아치
        const arch = el('div', 'arch');
        let roses = '', leaves = '';
        const rr = seeded(5);
        for (let i = 0; i <= 26; i++) {
          const t = i / 26, px = 2 * (1 - t) * t * 500 + t * t * 1000, py = (1 - t) ** 2 * 300 + 2 * (1 - t) * t * -60 + t * t * 300;
          leaves += `<ellipse cx="${px + (rr() - .5) * 30}" cy="${py + 18}" rx="16" ry="7" fill="#4f9a52" transform="rotate(${(rr() - .5) * 90} ${px} ${py + 18})"/>`;
          const ck = (i * 4) % 9, dk = ROSE_COLORS[ck][3];
          roses += `<g transform="translate(${px} ${py}) scale(${0.5 + rr() * 0.3})">${[0, 72, 144, 216, 288].map(a => `<path d="${petal(26, 15)}" transform="rotate(${a})" fill="${ROSES[ck]}" stroke="${dk}" stroke-opacity=".4"/>`).join('')}<circle r="9" fill="${dk}" opacity=".55"/><path d="M0 0 m-5 0 a5 5 0 1 1 5 5 a3 3 0 1 1 -3 -3" stroke="${dk}" stroke-width="2" fill="none"/></g>`;
        }
        arch.innerHTML = `<svg viewBox="-20 -80 1040 400" preserveAspectRatio="none"><path d="M-10 330 Q500 -90 1010 330" stroke="#3f7d3f" stroke-width="10" fill="none"/><path d="M-10 345 Q500 -70 1010 345" stroke="#56984f" stroke-width="5" fill="none"/>${leaves}${roses}</svg>`;
        board.appendChild(arch);
        board.appendChild(el('div', 'hedge'));
        const rp = seeded(9);
        for (let i = 0; i < 16; i++) {
          const p = el('i', 'petal');
          Object.assign(p.style, { left: rp() * 100 + '%', animationDuration: 9 + rp() * 8 + 's', animationDelay: -rp() * 15 + 's', background: ROSES[i % ROSES.length], transform: `scale(${0.6 + rp() * 0.8})` });
          board.appendChild(p);
        }
        // 캐릭터 (행사 만들기에서 올린 공식 캐릭터 이미지)
        const hasChar = addCast(board, 'garden');
        const inset = { t: H * 0.15, b: H * 0.05, l: hasChar ? W * 0.15 : W * 0.02, r: hasChar ? W * 0.15 : W * 0.02 };
        const list = placeGrid(board, n, 0.82, 0.004, i => {
          const k = (i * 4) % 9, s = el('div', 'slot'); s.dataset.rose = ROSE_COLORS[k][0]; s.style.zIndex = 1000 - i;   // 윗줄 이름이 아랫줄 꽃잎에 가리지 않게
          s.innerHTML = `<div class="rose">${roseSvg(k)}</div><div class="lbl"></div>`;
          return s;
        }, inset);
        const BW = board.clientWidth;
        list.forEach(sl => { const x = parseFloat(sl.style.left) / BW;
          sl.style.setProperty('--wp', (-(x * 3.2) - Math.random() * 0.8).toFixed(2) + 's'); sl.style.setProperty('--wd', (3 + Math.random() * 1.6).toFixed(2) + 's'); sl.style.setProperty('--wk', (Math.random() < .5 ? -1 : 1)); });
        board.classList.toggle('m-calm', motion() === 'calm');
        if (!reduced() && MOT().gust) { const gust = () => { board.classList.add('gust'); setTimeout(() => board.classList.remove('gust'), 2600); }; setTimeout(gust, 2500); castTimers.push(setInterval(gust, 8000)); }
        return list;
      },
      fill(s, p) { s.querySelector('.lbl').innerHTML = label(p); },
      cheer: cheerChars
    }
  };

  /* ---------- 새 테마 8종 (격자에 칸을 깔고 꾸밈만 다르게) ---------- */
  function gridBuild(th, ar, gap, make, pad = {}, deco) {
    return (board, n) => {
      if (deco) deco(board);
      const has = addCast(board, th), W = board.clientWidth, H = board.clientHeight, side = has ? 0.14 : 0;
      return placeGrid(board, n, ar, gap, make, { l: W * ((pad.l || 0.02) + side), r: W * ((pad.r || 0.02) + side), t: H * (pad.t || 0.03), b: H * (pad.b || 0.03) });
    };
  }
  const fillLbl = (s, p) => { s.querySelector('.lbl').innerHTML = label(p); };
  const pickOf = (arr, i) => arr[i % arr.length];
  const dots = (board, cls, n, seed, maxTop) => { const r = seeded(seed); for (let i = 0; i < n; i++) { const t = el('i', cls); Object.assign(t.style, { left: r() * 100 + '%', top: r() * maxTop + '%', animationDelay: r() * 3 + 's' }); board.appendChild(t); } };
  Object.assign(THEME_IMPL, {
    lantern: {   // 소원 등불: 밤하늘에 등불이 떠오른다
      build: gridBuild('lantern', 1.0, 0.02, i => { const s = el('div', 'slot'); s.style.setProperty('--dl', (-(i % 7) * 0.6) + 's'); s.innerHTML = '<div class="lan"><i class="cap"></i><div class="lbl"></div><i class="tas"></i></div>'; return s; },
        { t: 0.06, b: 0.13 }, board => { board.insertAdjacentHTML('beforeend', '<div class="l-moon"></div><div class="l-hill"></div>'); dots(board, 'sky-dot', 40, 31, 70); }),
      fill: fillLbl
    },
    forest: {   // 새싹 숲: 새싹이 나무로 자란다
      build: gridBuild('forest', 1.0, 0.016, i => { const s = el('div', 'slot'); s.style.setProperty('--tc', pickOf(['#3f9a4b', '#2f8a56', '#6aa84f', '#4c9f70', '#88b04b'], i)); s.style.setProperty('--dl', (-(i % 5) * 0.7) + 's');
        s.innerHTML = '<div class="tree"><i class="trunk"></i><div class="crown"><div class="lbl"></div></div><i class="sprout"></i></div>'; return s; },
        { t: 0.05, b: 0.07 }, board => board.insertAdjacentHTML('beforeend', '<div class="f-sun"></div><div class="f-hill a"></div><div class="f-hill b"></div>')),
      fill: fillLbl
    },
    chalk: {   // 칠판: 분필로 이름을 적는다
      build: gridBuild('chalk', 2.0, 0.02, i => { const s = el('div', 'slot'); s.style.setProperty('--ck', pickOf(['#ffffff', '#ffe98a', '#ffc2d1', '#bfe9ff', '#c9f5c0'], i)); s.innerHTML = `<div class="no">${i + 1}</div><div class="lbl"></div>`; return s; },
        { l: 0.035, r: 0.035, t: 0.06, b: 0.11 }, board => board.insertAdjacentHTML('beforeend', '<div class="c-tray"><i></i><i></i><i></i></div>')),
      fill: fillLbl
    },
    memo: {   // 메모 게시판: 색색 메모지가 붙는다
      build: gridBuild('memo', 1.12, 0.03, i => { const r = seeded(i * 7 + 3), s = el('div', 'slot'); s.style.setProperty('--mc', pickOf(['#fff3a3', '#ffd1dc', '#c8ecff', '#d4f5c4', '#ffe0b5'], i)); s.style.setProperty('--rot', ((r() - .5) * 9).toFixed(1) + 'deg');
        s.innerHTML = '<div class="note"><i class="pin"></i><div class="lbl"></div></div>'; return s; }, { l: 0.035, r: 0.035, t: 0.05, b: 0.05 }),
      fill: fillLbl
    },
    led: {   // 전광판
      build: gridBuild('led', 2.3, 0.022, i => { const s = el('div', 'slot'); s.style.setProperty('--lc', pickOf(['#ffb000', '#39ff88', '#4fd8ff', '#ff6b6b'], i)); s.innerHTML = `<div class="no">${String(i + 1).padStart(2, '0')}</div><div class="lbl"></div>`; return s; },
        { t: 0.11, b: 0.04 }, board => board.insertAdjacentHTML('beforeend', '<div class="led-top"><span>ATTENDANCE</span><span>출석 현황</span><span>LIVE ●</span></div>')),
      fill: fillLbl
    },
    train: {   // 중랑행 열차: 줄마다 열차 한 편, 창문에 불이 켜진다
      build(board, n) {
        board.insertAdjacentHTML('beforeend', '<div class="t-sun"></div><div class="t-cloud a"></div><div class="t-cloud b"></div>');
        const has = addCast(board, 'train'), W = board.clientWidth, H = board.clientHeight;
        const L = W * (has ? 0.16 : 0.03), T = H * 0.07, aw = W - 2 * L, ah = H - T - H * 0.04, gap = Math.min(aw, ah) * 0.014;
        let best = null;   // 창문이 가장 커지는 열 수
        for (let c = 1; c <= n; c++) {
          const rows = Math.ceil(n / c), w = (aw - gap * (c - 1)) / (c + 0.9), h = ah / rows / 1.95;
          if (w <= 0 || h <= 0) continue;
          const ww = Math.min(w, h * 1.7), hh = Math.min(h, ww / 1.1);
          if (!best || ww * hh > best.sc) best = { c, rows, ww, hh, sc: ww * hh };
        }
        const { c, rows, ww, hh } = best || { c: 1, rows: 1, ww: 80, hh: 60 }, rowH = ah / rows, out = [];
        for (let r = 0; r < rows; r++) {
          const cnt = Math.min(c, n - r * c), carW = cnt * ww + (cnt - 1) * gap + ww * 0.9, carH = hh * 1.55;
          const car = el('div', 'car'); car.style.setProperty('--bc', JN[r % 3]);
          Object.assign(car.style, { left: L + (aw - carW) / 2 + 'px', top: T + r * rowH + (rowH - hh * 1.9) / 2 + 'px', width: carW + 'px', height: carH + 'px',
            padding: `${hh * 0.2}px ${ww * 0.55}px 0 ${ww * 0.35}px`, gap: gap + 'px', gridTemplateColumns: `repeat(${cnt}, ${ww}px)`, gridAutoRows: hh + 'px' });
          car.innerHTML = '<i class="nose"></i><i class="wheels"></i>';
          for (let k = 0; k < cnt; k++) { const s = el('div', 'slot'); car.appendChild(s); out.push(s); }
          board.appendChild(car);
        }
        return out;
      },
      fill(s, p) { s.innerHTML = label(p); }
    },
    ocean: {   // 바닷속: 물방울이 물고기가 된다
      build: gridBuild('ocean', 1.9, 0.03, i => { const s = el('div', 'slot'); s.style.setProperty('--fc', pickOf(['#ff8a5c', '#ffd166', '#5ee0c8', '#b79cff', '#ff7aa8', '#7cc8ff'], i)); s.style.setProperty('--dl', (-(i % 6) * 0.7) + 's');
        s.innerHTML = '<i class="bub"></i><div class="fish"><i class="tail"></i><i class="eye"></i><div class="lbl"></div></div>'; return s; },
        { t: 0.05, b: 0.1 }, board => { board.insertAdjacentHTML('beforeend', '<div class="o-rays"></div><div class="o-sand"></div>');
          const r = seeded(77); for (let i = 0; i < 14; i++) { const b = el('i', 'o-bubble'); Object.assign(b.style, { left: r() * 100 + '%', animationDuration: 7 + r() * 8 + 's', animationDelay: -r() * 12 + 's', width: 0.6 + r() * 1.4 + 'vh' }); board.appendChild(b); } }),
      fill: fillLbl
    },
    plaque: {   // 금빛 명패
      build: gridBuild('plaque', 2.5, 0.03, () => { const s = el('div', 'slot'); s.innerHTML = '<div class="pl"><div class="lbl"></div></div>'; return s; },
        { l: 0.04, r: 0.04, t: 0.1, b: 0.06 }, board => board.insertAdjacentHTML('beforeend', '<div class="p-crest">✦ ✦ ✦</div>')),
      fill: fillLbl
    }
  });

  /* ---------- 보드 그리기 ---------- */
  // 칸 수: 명단 인원 + 명단 밖에서 온 사람. 명단 없이 받을 때는 넉넉히 깔고 차면 늘린다
  function totalSlots() {
    const need = Math.max(displayed.length + queue.length, 1);
    if (!roster.length) { let c = 12; while (c < need + 1) c = Math.ceil(c * 1.25 / 2) * 2; return c; }   // 12, 16, 20, 26, 34, 44, 56 …
    return Math.max(roster.length + extraHere(), need);
  }
  function buildBoard() {
    const board = $('board'); castStop();
    board.innerHTML = '';
    Sound.configure(new URLSearchParams(location.search).get('sound') || cfg.screen.sound); Sound.mountUi(); Sound.setTheme(cfg.screen.music && cfg.screen.music !== 'auto' ? cfg.screen.music : theme);   // 음악 분위기: 자동이면 테마에 맞춰
    document.body.className = document.body.className.replace(/theme-\S+/, '') + ' theme-' + theme;
    const impl = THEME_IMPL[theme] || THEME_IMPL.card;
    slots = impl.build(board, totalSlots());
    slots.forEach(s => s.addEventListener('click', () => onSlotClick(s)));
    displayed.forEach((no, i) => { const p = byNo.get(no); if (p && slots[i]) { impl.fill(slots[i], p); slots[i].classList.add('on'); slots[i].dataset.no = no; } });
    if (impl.after) impl.after(board);
    markCancelable(); markLeft();
  }
  function markCancelable() { slots.forEach(s => s.classList.toggle('cancel-ok', isAdmin && !!s.dataset.no)); }
  // 퇴실 받는 중: 퇴실한 사람 칸은 불이 꺼진다
  function markLeft() { slots.forEach(s => s.classList.toggle('gone', isOutMode() && !!s.dataset.no && outSet.has(+s.dataset.no))); }

  function setCount(n, animate) {
    const out = isOutMode();
    if (out) n = displayed.filter(no => outSet.has(no)).length;
    const all = roster.length + extraHere(), open = !roster.length && !out;   // open: 명단 없이 오는 대로 받는 중
    const total = (out ? displayed.length : all) || 1, from = shownCount; shownCount = n;
    Sound.setEnergy(roster.length ? Math.min(1, displayed.length / all) : Math.min(1, displayed.length / 30));
    $('total').textContent = out ? displayed.length : all;
    document.body.classList.toggle('no-roster', open);
    $('unit').textContent = out ? '명 퇴실' : (cfg.screen.texts.unit || '명 출석');
    const bar = $('ringBar'), C = 2 * Math.PI * 42;
    bar.style.strokeDashoffset = C * (1 - (open ? (n ? 1 : 0) : Math.min(1, n / total)));
    const b = $('count');
    if (!animate || from === n) { b.textContent = n; return; }
    const t0 = performance.now();
    (function f(t) { const k = Math.min(1, (t - t0) / 500); b.textContent = Math.round(from + (n - from) * k); if (k < 1) requestAnimationFrame(f); })(t0);
    b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
  }

  let bannerTimer = 0;
  function banner(p, done) {
    const w = $('welcome');
    w.classList.toggle('done', !!done);
    $('wDept').textContent = done ? '' : p.dept;
    $('wName').textContent = done ? cfg.screen.texts.done : p.name;
    const st = !done && p && p.dept && !p.extra ? deptStat(p.dept) : null;   // 소속감: 우리 부서 몇 명째인지
    $('wMsg').textContent = done ? '' : done === false ? ' 님 수고하셨습니다' : cfg.screen.texts.welcome + (st && st.t > 1 ? `  ·  ${p.dept} ${st.a}/${st.t}명` : '');
    w.classList.add('show');
    clearTimeout(bannerTimer); bannerTimer = setTimeout(() => w.classList.remove('show'), done ? 4200 : 2600);
  }

  function arriveNext() {
    if (!queue.length) { running = false; return; }
    running = true;
    const no = queue.shift(), p = byNo.get(no), i = displayed.length;
    displayed.push(no);
    if (i >= slots.length || totalSlots() > slots.length) { buildBoard(); }
    const s = slots[i], impl = THEME_IMPL[theme] || THEME_IMPL.card;
    const finish = () => {
      if (p) { impl.fill(s, p); s.dataset.no = no; }
      s.classList.add('on', 'fresh'); setTimeout(() => s.classList.remove('fresh'), 2000);
      if (impl.after) impl.after($('board'));
      setCount(displayed.length, true);
      markCancelable();
      if (p) banner(p);
      cheerChars($('board'), p && p.name); castArrive(s, p);
      if (!(queue.length > 6 && displayed.length % 2)) Sound.sfx('arrive', { i: displayed.length - 1 });
      if (p && p.dept && !p.extra) {   // 소속 전원 출석 이벤트
        const st = deptStat(p.dept);
        if (st.t >= 2 && st.a === st.t) setTimeout(() => { Sound.sfx('dept'); deptToast(p.dept); A.confetti({ colors: ['#106A3A', '#9E1C84', '#0057A3', '#ffd43b'], count: 70 }); }, 700);
      }
      const m = msReached();
      if (m > msDone) {   // 50·60·70·80·90% 달성 때마다 그 비율만큼의 글주임이 축하, 100%는 전원
        msDone = m;
        setTimeout(() => {
          if (!roster.length) {   // 명단 없이 받을 때: 10명, 20명… 돌파
            Sound.sfx('milestone', { pct: 60 }); milestoneToast(m, '명 돌파!'); A.confetti({ colors: [cfg.screen.accent, '#ffd43b', '#4dabf7'], count: 50 });
            if (MOT().parade) castFinale($('board'), Math.min(1, m / 100));
            return;
          }
          Sound.sfx(m >= 100 ? 'finale' : 'milestone', { pct: m });
          if (m >= 100) { banner(null, true); A.confetti({ colors: [cfg.screen.accent, '#ffd43b', '#ff6b6b', '#4dabf7', '#51cf66'] }); }
          else { milestoneToast(m); A.confetti({ colors: [cfg.screen.accent, '#ffd43b', '#4dabf7'], count: 40 }); }
          if (MOT().parade) castFinale($('board'), m / 100);
        }, 1400);
      }
      setTimeout(arriveNext, queue.length > 3 ? 450 : 1300);
    };
    if (impl.arrive && !matchMedia('(prefers-reduced-motion: reduce)').matches) impl.arrive(s, $('board'), finish); else finish();
  }

  function applyList(nos, animate) {
    const known = displayed.concat(queue);
    const prefix = known.length <= nos.length && known.every((no, i) => nos[i] === no);
    if (prefix && animate) {
      const add = nos.slice(known.length);
      if (add.length) { queue.push(...add); if (!running) arriveNext(); }
      return;
    }
    // 취소·순서 변경: 애니메이션 없이 다시 그림
    queue = []; running = false; displayed = nos.slice();
    msDone = msReached();
    buildBoard(); setCount(displayed.length, false);
  }

  /* ---------- 설정 적용 ---------- */
  function applyEvent(ev, assetMap) {
    cfg = A.withDefaults(ev.config);
    roster = ev.roster || []; byNo = new Map(roster.map(p => [p.no, p])); rosterNos = new Set(roster.map(p => p.no));
    (ev.extras || []).forEach(x => extraMap.set(x.no, { no: x.no, dept: x.dept || '', rank: '', name: x.name, extra: true }));
    extraMap.forEach((p, no) => { if (!byNo.has(no)) byNo.set(no, p); });
    assets = assetMap || {};
    theme = A.THEMES[cfg.screen.theme] ? cfg.screen.theme : 'card';
    const t = cfg.screen.texts;
    A.applyColors(document.documentElement, cfg.screen.bg, cfg.screen.accent);
    document.title = (cfg.title || '출석') + ' · 출석 화면';
    $('title').textContent = cfg.title || '출석';
    $('subtitle').textContent = cfg.subtitle || '';
    $('chip').textContent = t.chip || '출석 체크';
    $('tag1').textContent = t.tag1 || ''; $('tag2').textContent = t.tag2 || '';
    $('qrHint').textContent = qrHint();
    $('unit').textContent = t.unit || '명 출석';
    $('foot').textContent = (t.foot || '') + (cfg.org ? '   ·   ' + cfg.org : '');
    const logoSrc = assets.logo || (theme === 'card' ? (A.contrast('#ffffff', cfg.screen.accent) >= 3 ? 'assets/defaults/jungnang_slogan_white.png' : 'assets/defaults/jungnang_slogan.png') : '');
    $('logo').innerHTML = logoSrc ? `<img src="${logoSrc}" alt="${A.esc(cfg.org || '나의 자랑 우리 중랑')}">` : '';
    const bg = $('bgimg');
    bg.className = 'bgimg ' + (assets.bg && cfg.screen.bg_image !== 'off' ? (cfg.screen.bg_image === 'full' ? 'full' : 'soft') : '');
    bg.style.backgroundImage = assets.bg && cfg.screen.bg_image !== 'off' ? `url("${assets.bg}")` : '';
    refreshQr();
    modeBtn();
  }
  // QR 안내: 명단 없이 받는 행사인데 문구를 기본값 그대로 뒀으면 "이름을 고르세요" 대신 "쓰세요"
  function qrHint() {
    const h = cfg.screen.texts.qr_hint || '';
    return !roster.length && h === A.DEFAULT_CONFIG.screen.texts.qr_hint ? '휴대폰 카메라로 QR을 찍고\n부서와 이름을 쓰세요' : h;
  }
  /* QR: 보통은 그대로, '바뀌는 QR'이면 30초마다 암호를 새로 받아 다시 그린다(담당자용 화면만) */
  let qrT = 0, qrCode = null;
  async function refreshQr() {
    clearTimeout(qrT);
    const base = PREVIEW ? 'https://example.github.io/edu-attendance/join.html?e=preview' : A.links(eventId).join;
    const rot = !PREVIEW && !!(cfg.attend && cfg.attend.rotate_qr), timer = $('qrTimer');
    timer.hidden = !rot || !isAdmin;
    if (!rot) { qrCode = null; $('qr').innerHTML = A.qrSvg(base); $('qr').title = base; return; }
    $('qr').title = '';
    if (!isAdmin) { qrCode = null; $('qr').innerHTML = '<div class="qr-lock"><b>QR은 담당자용 화면에서만 보여요</b><span>바뀌는 QR을 쓰는 행사예요. 관리 링크로 연 강의실 화면을 띄워 주세요.</span></div>'; return; }
    try {
      const r = await A.rpc('get_qr', { p_id: eventId, p_token: token });
      if (r.code !== qrCode) { qrCode = r.code; $('qr').innerHTML = A.qrSvg(base + '&c=' + r.code); }
      const ms = Math.max(500, Math.min(30000, +r.ttl_ms || 30000)), bar = timer.firstElementChild;
      bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = `qrleft ${ms}ms linear forwards`;
      qrT = setTimeout(refreshQr, ms + 250);
    } catch (e) { qrT = setTimeout(refreshQr, 4000); }
  }
  let surveyN = 0;
  const modeSuffix = () => isOutMode() ? ' · 퇴실 받는 중' : mode === 'survey' ? ' · 만족도 조사 중' + (surveyN ? ` · 응답 ${surveyN}명` : '') : '';
  function setSession(s) { sessionId = s.id; sessionLabel = s.label; $('session').textContent = s.label + modeSuffix(); }
  // 입실/퇴실 받기 화면 바꾸기
  function applyMode(m) {
    mode = m === 'out' || m === 'survey' ? m : 'in';
    document.body.classList.toggle('mode-out', isOutMode()); document.body.classList.toggle('mode-survey', mode === 'survey');
    const t = cfg.screen.texts;
    $('chip').textContent = isOutMode() ? '퇴실 체크' : mode === 'survey' ? '만족도 조사' : (t.chip || '출석 체크');
    $('qrHint').textContent = isOutMode() ? '수업이 끝났어요. QR을 찍고 퇴실해 주세요' : mode === 'survey' ? '오늘 교육은 어땠나요?\nQR을 찍고 답해 주세요' : qrHint();
    if (sessionLabel) $('session').textContent = sessionLabel + modeSuffix();
    modeBtn();
    markLeft(); setCount(displayed.length, false);
  }
  // 퇴실 체크를 쓰는 행사에서만 버튼을 보인다 (퇴실 받는 중이면 되돌릴 수 있게 항상 보임)
  function modeBtn() {
    const b = $('aMode'); if (!b) return;
    b.hidden = mode === 'survey' || !(cfg.screen.checkout === 'on' || isOutMode());
    b.textContent = isOutMode() ? '입실 받기로 돌아가기' : '퇴실 받기 시작';
    const sv = $('aSurvey'); if (sv) { sv.hidden = !(cfg.survey && cfg.survey.on) && mode !== 'survey'; sv.textContent = mode === 'survey' ? '출석 받기로 돌아가기' : '만족도 받기 시작'; }
    const lo = $('aLottery'); if (lo) lo.hidden = !cfg.lottery;
  }
  // 새로 퇴실한 사람: 칸 불을 끄고 "수고하셨습니다" 배너
  let leaveQ = [], leaving = false;
  function applyOuts(outs, animate) {
    lastOuts = outs;
    const now = new Set(outs.map(x => x.no));
    const fresh = outs.map(x => x.no).filter(no => !outSet.has(no));
    outSet = now;
    if (animate && isOutMode() && fresh.length) { leaveQ.push(...fresh); if (!leaving) leaveNext(); }
    else { markLeft(); setCount(displayed.length, false); }
  }
  function leaveNext() {
    if (!leaveQ.length) { leaving = false; markLeft(); setCount(displayed.length, true); return; }
    leaving = true;
    const no = leaveQ.shift(), p = byNo.get(no), s = slots.find(x => +x.dataset.no === no);
    if (s) s.classList.add('gone');
    if (p) banner(p, false);
    setCount(displayed.length, true);
    try { Sound.sfx('phone'); } catch (e) {}
    setTimeout(leaveNext, leaveQ.length > 3 ? 400 : 1200);
  }

  /* ---------- 저장소에서 가져오기 ---------- */
  let failCount = 0, eventSig = '';
  const sigOf = r => JSON.stringify([r.ev.config, r.ev.roster, r.am]);
  async function loadEvent() {
    const ev = await A.rpc('get_event', { p_id: eventId });
    if (!ev) return null;
    const keys = (ev.assets || []).filter(k => ['logo', 'bg', 'char_left', 'char_right'].includes(k));
    const am = await A.loadAssets(eventId, keys);
    return { ev, am };
  }
  /* 몇 초마다 새 출석이 있는지 묻는다. 바뀐 게 없으면 저장소가 '같음'만 짧게 돌려줘 전송량이 아주 적다.
     한동안 아무도 안 찍으면 묻는 간격을 늘리고, 2시간 넘게 조용하면 화면을 '쉬는 중'으로 멈춘다 */
  let boardVer = null, useV2 = true, quietSince = Date.now(), resting = false, pollT = 0;
  async function fetchBoard() {
    if (useV2) {
      try { const b = await A.rpc('get_board2', { p_id: eventId, p_ver: boardVer }); if (b && b.v) boardVer = b.v; return b; }
      catch (e) { if (!A.noFn(e)) throw e; useV2 = false; }   // 업데이트 SQL 전이면 예전 방식
    }
    return A.rpc('get_board', { p_id: eventId });
  }
  function nextDelay() {
    if (failCount) return Math.min(15000, 2500 * failCount);
    if (document.hidden) return 20000;
    const q = Date.now() - quietSince;
    return q < 3 * 60e3 ? 2500 : q < 15 * 60e3 ? 5000 : 10000;
  }
  function rest() {
    resting = true; clearTimeout(qrT); try { Sound.stopBgm(); } catch (e) {}
    $('rest').hidden = false;
  }
  function wake() {
    if (!resting) return; resting = false; $('rest').hidden = true; quietSince = Date.now();
    refreshQr(); try { Sound.refresh(); } catch (e) {} clearTimeout(pollT); poll();
  }
  async function poll() {
    if (resting) return;
    try {
      const b = await fetchBoard();
      if (b && b.same) {
        failCount = 0; $('session').classList.remove('off'); $('conn').textContent = '';
        if (Date.now() - quietSince > 2 * 3600e3 && !document.hidden) { rest(); return; }
        pollT = setTimeout(poll, nextDelay()); return;
      }
      quietSince = Date.now();
      if (!b) { full('행사를 찾을 수 없습니다', '주소가 맞는지, 보관 기간(기본 10일)이 지나지 않았는지 확인해 주세요.'); return; }
      failCount = 0; $('session').classList.remove('off'); $('conn').textContent = '';
      if (updatedAt && b.updated_at !== updatedAt) {   // 설정이 바뀌었으면 다시 불러옴
        const r = await loadEvent();
        if (r && sigOf(r) !== eventSig) { applyEvent(r.ev, r.am); eventSig = sigOf(r); buildBoard(); setCount(displayed.length, false); }
      }
      updatedAt = b.updated_at;
      const nos = b.list.map(x => x.no); lastList = b.list;
      b.list.forEach(x => {   // 명단 밖에서 온 사람은 보드 자료에 부서·이름이 함께 온다
        if (x.name == null || rosterNos.has(x.no)) return;
        const p = { no: x.no, dept: x.dept || '', rank: '', name: x.name, extra: true }; extraMap.set(x.no, p); byNo.set(x.no, p);
      });
      const newMode = b.session.mode || 'in';
      if ((b.survey_n || 0) !== surveyN) { surveyN = b.survey_n || 0; if (mode === 'survey' && sessionLabel) $('session').textContent = sessionLabel + modeSuffix(); }
      if (b.session.id !== sessionId) {
        const had = sessionId !== null;
        outSet = new Set(); leaveQ = [];
        mode = newMode; setSession(b.session); applyMode(newMode);
        if (had) { $('board').classList.remove('sweep'); void $('board').offsetWidth; $('board').classList.add('sweep'); }
        queue = []; running = false; displayed = []; msDone = 0; buildBoard(); setCount(0, false);
        applyList(nos, had);
        applyOuts(b.outs || [], false);
      } else {
        if (newMode !== mode) applyMode(newMode);
        if (b.session.label !== sessionLabel) setSession(b.session);
        applyList(nos, true);
        applyOuts(b.outs || [], true);
      }
      if (isAdmin && !$('absent').hidden) renderAbsent();
    } catch (e) {
      failCount++;
      if (failCount >= 2) { $('session').classList.add('off'); $('conn').textContent = '연결이 끊겨 다시 연결하는 중…'; }
    }
    pollT = setTimeout(poll, nextDelay());
  }
  function full(title, msg) { const f = $('full'); f.hidden = false; f.innerHTML = `<div><h1>${A.esc(title)}</h1><p>${A.esc(msg)}</p></div>`; }

  /* ---------- 관리 도구 ---------- */
  async function onSlotClick(s) {
    if (!isAdmin || !s.dataset.no) return;
    const p = byNo.get(+s.dataset.no) || { name: '', dept: '' };
    if (isOutMode() && !outSet.has(+s.dataset.no)) { A.toast(`${p.name} 님은 아직 퇴실 전이에요. 입실을 취소하려면 먼저 '입실 받기로 돌아가기'를 누르세요.`); return; }
    const what = isOutMode() ? '퇴실' : '출석';
    const ok = await A.dialog({ title: what + ' 취소', message: `${p.dept} ${p.name} 님의 이번 회차 ${what}을 취소할까요?`, ok: what + ' 취소', danger: true });
    if (!ok) return;
    try { await A.rpc('cancel_attendance', { p_id: eventId, p_token: token, p_no: +s.dataset.no }); A.toast('취소했습니다'); }
    catch (e) { A.toast(e.message, 'bad'); }
  }
  let xlsxLoading = null;
  function needXlsx() {
    if (window.XLSX) return Promise.resolve();
    return xlsxLoading = xlsxLoading || new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'assets/xlsx.full.min.js'; s.onload = res; s.onerror = () => rej(new Error('엑셀 기능을 불러오지 못했습니다')); document.head.appendChild(s); });
  }
  const fileSafe = s => String(s || '출석').replace(/[\\/:*?"<>|]/g, '').trim() || '출석';
  function saveBook(rows, cols, sheetName, file) {
    const ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = cols.map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    XLSX.writeFile(wb, file);
  }
  // 엑셀용 자료: 명단 + 명단 밖에서 온 사람, 담당자 처리·같은 휴대폰 표시 (예전 저장소면 없는 칸은 빈 것으로)
  async function exportData() {
    const d = await A.rpc('export_all', { p_id: eventId, p_token: token });
    const ex = (d.extras || []).map(x => ({ no: x.no, dept: x.dept || '', rank: '', name: x.name, extra: true }));
    return { d, all: roster.concat(ex) };
  }
  const statusOf = (a, usesOut) => !a ? '' : a.at && a.out_at ? '완료' : a.at ? (usesOut ? '퇴실 없음' : '출석') : '퇴실만';
  function noteOf(a, shared) {
    if (!a) return '';
    const n = [];
    if (a.via === 'admin') n.push('담당자 입실 처리');
    if (a.out_via === 'admin') n.push('담당자 퇴실 처리');
    if (a.dev && shared.get(a.dev) > 1) n.push(`같은 휴대폰 ${shared.get(a.dev)}명`);
    return n.join(', ');
  }
  const sharedOf = rows => { const m = new Map(); rows.forEach(a => { if (a.dev) m.set(a.dev, (m.get(a.dev) || 0) + 1); }); return m; };
  async function exportNow() {
    try {
      await needXlsx();
      const { d, all } = await exportData();
      const sid = d.current || sessionId, mine = d.attendance.filter(a => a.session_id === sid), map = new Map(mine.map(a => [a.no, a]));
      const usesOut = cfg.screen.checkout === 'on' || mine.some(a => a.out_at), shared = sharedOf(mine);
      const rows = [[`${cfg.title} 출석 (${sessionLabel})`], [], ['연번', '부서명', '직위(직급)', '성명', '출석', '출석 시각', '퇴실 시각', '상태', '구분', '비고']];
      let k = 0;
      all.filter(p => !p.extra || map.has(p.no)).forEach(p => {
        const a = map.get(p.no);
        rows.push([p.extra ? (roster.length ? '추가' : '') + (++k) : p.no, p.dept, p.rank, p.name, a && a.at ? 'O' : '', a && a.at ? A.hhmm(a.at) : '', a && a.out_at ? A.hhmm(a.out_at) : '', statusOf(a, usesOut), p.extra ? '추가' : '명단', noteOf(a, shared)]);
      });
      const nIn = mine.filter(a => a.at).length, nOut = mine.filter(a => a.out_at).length, nDone = mine.filter(a => a.at && a.out_at).length;
      rows.push([], ['', '출석 인원', '', roster.length ? `${nIn}명 / 명단 ${roster.length}명` : `${nIn}명`]);
      if (k) rows.push(['', '명단 밖 출석', '', `${k}명`]);
      rows.push(['', '퇴실 인원', '', `${nOut}명`]);
      if (usesOut) rows.push(['', '입실·퇴실 완료', '', `${nDone}명`]);
      saveBook(rows, [8, 22, 14, 10, 6, 10, 10, 10, 7, 28], sessionLabel || '출석', `${fileSafe(cfg.title)}_${fileSafe(sessionLabel)}_출석.xlsx`);
    } catch (e) { A.toast(e.message, 'bad'); }
  }
  /* 미참석자: 이번 회차에 아직 입실(또는 퇴실)하지 않은 사람 (담당자 전용) */
  let abTab = 'in';
  function absentees(tab = abTab) {
    const here = new Set(lastList.map(x => x.no));
    return tab === 'out' ? [...byNo.values()].filter(p => here.has(p.no) && !outSet.has(p.no)) : roster.filter(p => !here.has(p.no));
  }
  const telOf = p => phones[p.no] || '';
  function renderAbsent() {
    const showOut = isOutMode() || outSet.size > 0;
    if (!showOut) abTab = 'in';
    const nIn = absentees('in').length, nOut = absentees('out').length;
    $('abTabs').hidden = !showOut;
    $('abTabIn').textContent = `미입실 ${nIn}`; $('abTabOut').textContent = `미퇴실 ${nOut}`;
    $('abTabIn').classList.toggle('on', abTab === 'in'); $('abTabOut').classList.toggle('on', abTab === 'out');
    const list = absentees(), groups = new Map();
    list.forEach(p => { const k = p.dept || '부서 없음'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); });
    $('abTitle').textContent = abTab === 'out' ? '퇴실 안 한 사람' : '미참석자';
    $('abN').textContent = abTab === 'out' ? `${list.length}명 / 입실 ${lastList.length}명` : `${list.length}명 / ${roster.length}명`;
    $('abList').innerHTML = list.length ? [...groups].map(([d, ps]) =>
      `<h4>${A.esc(d)} (${ps.length})</h4><ul>${ps.map(p => `<li><span>${A.esc(p.name)}${p.rank ? ' · ' + A.esc(p.rank) : ''}</span>${telOf(p) ? `<a href="tel:${A.esc(telOf(p))}">${A.esc(telOf(p))}</a>` : ''}<button type="button" class="ab-mark" data-mark="${p.no}">${abTab === 'out' ? '퇴실 처리' : '출석 처리'}</button></li>`).join('')}</ul>`).join('')
      : `<div class="ab-none">${abTab === 'out' ? '입실한 사람 모두 퇴실했습니다' : '모두 출석했습니다'}</div>`;
  }
  function toggleAbsent(show) {
    const el = $('absent'); el.hidden = show === undefined ? !el.hidden : !show;
    if (!el.hidden) { if (isOutMode()) abTab = 'out'; renderAbsent(); }
  }
  async function copyAbsent() {
    const text = absentees().map(p => [p.dept, p.rank, p.name, telOf(p)].filter(Boolean).join('\t')).join('\n');
    try { await navigator.clipboard.writeText(text); A.toast('복사했습니다', 'ok'); }
    catch (e) { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); A.toast('복사했습니다', 'ok'); }
  }
  async function exportAbsent() {
    try {
      await needXlsx();
      const list = absentees(), what = abTab === 'out' ? '미퇴실자' : '미참석자';
      const rows = [[`${cfg.title} ${what} (${sessionLabel})`], [], ['연번', '부서명', '직위(직급)', '성명', '연락처', '연락 결과']];
      list.forEach(p => rows.push([p.no, p.dept, p.rank, p.name, telOf(p), '']));
      rows.push([], ['', `${what} 인원`, '', `${list.length}명`]);
      saveBook(rows, [6, 22, 14, 10, 16, 24], what, `${fileSafe(cfg.title)}_${fileSafe(sessionLabel)}_${what}.xlsx`);
    } catch (e) { A.toast(e.message, 'bad'); }
  }
  async function toggleMode() {
    const toOut = !isOutMode();
    const ok = await A.dialog(toOut
      ? { title: '퇴실 받기 시작', message: '같은 QR을 찍으면 이제 퇴실로 기록됩니다.\n퇴실한 사람의 칸은 불이 꺼져요.', ok: '퇴실 받기 시작' }
      : { title: '입실 받기로 돌아가기', message: '같은 QR을 찍으면 다시 입실(출석)로 기록됩니다.\n지금까지의 퇴실 기록은 그대로 남아요.', ok: '입실 받기로' });
    if (!ok) return;
    try { await A.rpc('set_mode', { p_id: eventId, p_token: token, p_mode: toOut ? 'out' : 'in' }); applyMode(toOut ? 'out' : 'in'); A.toast(toOut ? '퇴실을 받고 있어요' : '입실을 받고 있어요', 'ok'); }
    catch (e) { A.toast(e.message, 'bad'); }
  }
  async function toggleSurvey() {
    const on = mode !== 'survey';
    const ok = await A.dialog(on
      ? { title: '만족도 받기 시작', message: '같은 QR을 찍으면 이제 만족도 조사가 열려요.\n이번 회차에 출석한 휴대폰만 한 번 답할 수 있어요.', ok: '만족도 받기 시작' }
      : { title: '출석 받기로 돌아가기', message: '같은 QR을 찍으면 다시 출석으로 기록됩니다.', ok: '출석 받기로' });
    if (!ok) return;
    try { await A.rpc('set_mode', { p_id: eventId, p_token: token, p_mode: on ? 'survey' : 'in' }); applyMode(on ? 'survey' : 'in'); A.toast(on ? '만족도 조사를 받고 있어요' : '출석을 받고 있어요', 'ok'); }
    catch (e) { A.toast(/잘못된 값/.test(e.message) ? '만족도 조사는 저장소 업데이트(update.sql) 뒤에 쓸 수 있어요' : e.message, 'bad'); }
  }
  /* 글주임 경품 추첨: 이번 회차 출석자 중에서. 이름이 돌다가 멈추고 '당첨' 도장이 쾅 */
  let winners = [];
  function lottery() {
    let el = $('lot');
    if (!el) {
      el = document.createElement('div'); el.className = 'lot'; el.id = 'lot';
      el.innerHTML = `<div class="lot-box"><img class="lot-cast" src="assets/defaults/geuljuim_attend.png" alt=""><h2>🎁 글주임 경품 추첨</h2><p class="lot-pool" id="lotPool"></p>
        <div class="lot-reel"><span class="lot-dept" id="lotDept">&nbsp;</span><b class="lot-name" id="lotName">?</b><span class="lot-stamp" id="lotStamp">당첨</span></div>
        <div class="lot-btns"><button type="button" class="lot-go" id="lotGo">추첨하기</button><button type="button" class="lot-x" id="lotX">닫기</button></div><p class="lot-win" id="lotWin"></p></div>`;
      document.body.appendChild(el);
      $('lotX').onclick = () => { el.hidden = true; };
      $('lotGo').onclick = spin;
    }
    el.hidden = false; poolText();
  }
  const pool = () => lastList.map(x => byNo.get(x.no)).filter(p => p && !winners.includes(p.no));
  function poolText() { $('lotPool').textContent = `이번 회차 출석자 ${lastList.length}명 중${winners.length ? ` (당첨된 ${winners.length}명 빼고)` : ''}`; $('lotWin').textContent = winners.length ? '당첨: ' + winners.map(no => (byNo.get(no) || {}).name).join(', ') : ''; }
  function spin() {
    const ps = pool(); if (!ps.length) { A.toast('추첨할 출석자가 없어요', 'bad'); return; }
    const go = $('lotGo'), stamp = $('lotStamp'); go.disabled = true; stamp.classList.remove('hit');
    const win = ps[Math.floor(Math.random() * ps.length)]; let t = 0, k = 0; const total = 3200;
    const tick = () => {
      const p = t >= total ? win : ps[(k++) % ps.length];
      $('lotName').textContent = p.name; $('lotDept').textContent = p.dept || '\u00a0';
      try { if (t < total) Sound.sfx('land'); } catch (e) {}
      if (t >= total) {
        void stamp.offsetWidth; stamp.classList.add('hit'); winners.push(win.no); poolText(); go.disabled = false; go.textContent = '한 번 더';
        try { Sound.sfx('milestone', { pct: 90 }); } catch (e) {} A.confetti({ count: 120 }); return;
      }
      const d = 50 + 380 * Math.pow(t / total, 2.4); t += d; setTimeout(tick, d);
    };
    tick();
  }
  async function exportAll() {
    try {
      await needXlsx();
      const { d, all } = await exportData();
      const ss = d.sessions, map = new Map(), shared = new Map();
      d.attendance.forEach(a => map.set(a.session_id + ':' + a.no, a));
      ss.forEach(s2 => shared.set(s2.id, sharedOf(d.attendance.filter(a => a.session_id === s2.id))));
      // 이수 기준·지각 (켠 행사만): 출석률 = 출석한 회차 ÷ 전체 회차
      const P = cfg.pass || {}, passOn = !!P.on, minPct = +P.min_pct || 80, late = /^\d{1,2}:\d{2}$/.test(P.late || '') ? P.late.padStart(5, '0') : '';
      const isLate = a => !!(late && a && a.at && A.hhmm(a.at) > late);
      const head = ['연번', '부서명', '직위(직급)', '성명', ...ss.map(s2 => `${s2.label} (${A.ymd(s2.started_at)})`), '출석 횟수',
        ...(late ? ['지각 횟수'] : []), ...(passOn ? ['출석률', `이수(${minPct}% 이상)`] : []), '구분', '비고'];
      const rows = [[`${cfg.title} 출석부`], [], head];
      let k = 0, nPass = 0;
      all.forEach(p => {
        const notes = new Set(); let nLate = 0;
        const marks = ss.map(s2 => { const a = map.get(s2.id + ':' + p.no); if (!a) return '';
          noteOf(a, shared.get(s2.id)).split(', ').filter(Boolean).forEach(n => notes.add(n));
          if (a.via === 'import') notes.add('지난 출석부에서 이어 붙임');
          if (isLate(a)) nLate++;
          return a.at ? '출석 ' + A.hhmm(a.at) + (isLate(a) ? '(지각)' : '') + (a.out_at ? ' / 퇴실 ' + A.hhmm(a.out_at) : '') : '퇴실만 ' + A.hhmm(a.out_at); });
        if (p.extra && !marks.some(Boolean)) return;
        const n = marks.filter(m => m.startsWith('출석')).length, pct = ss.length ? Math.round(n * 100 / ss.length) : 0, ok = pct >= minPct;
        if (passOn && ok) nPass++;
        rows.push([p.extra ? (roster.length ? '추가' : '') + (++k) : p.no, p.dept, p.rank, p.name, ...marks, n,
          ...(late ? [nLate] : []), ...(passOn ? [pct + '%', ok ? '이수' : '미이수'] : []), p.extra ? '추가' : '명단', [...notes].join(', ')]);
      });
      rows.push([], ['', '회차별 출석 인원', '', '', ...ss.map(s2 => d.attendance.filter(a => a.session_id === s2.id && a.at).length + '명')],
        ['', '회차별 퇴실 인원', '', '', ...ss.map(s2 => d.attendance.filter(a => a.session_id === s2.id && a.out_at).length + '명')]);
      const tot = all.filter(p => !p.extra).length, att = new Set(d.attendance.filter(a => a.at).map(a => a.no)).size;
      rows.push(['', '출석률(한 번이라도 온 사람)', '', '', tot ? `${att}명 / 명단 ${tot}명 (${Math.round(att * 100 / tot)}%)` : `${att}명`]);
      if (passOn) rows.push(['', '이수 인원', '', '', `${nPass}명`]);
      const sheets = [{ name: '출석부', rows, cols: [8, 22, 14, 10, ...ss.map(() => 26), 9, ...(late ? [9] : []), ...(passOn ? [8, 12] : []), 7, 28] }];
      sheets.push(...surveySheets(d, ss, all));
      saveBooks(sheets, `${fileSafe(cfg.title)}_출석부_전체.xlsx`);
    } catch (e) { A.toast(e.message, 'bad'); }
  }
  // 만족도 조사 결과: 요약(문항별 평균·고른 수) + 응답 하나하나
  function surveySheets(d, ss, all) {
    const rs = d.responses || [], qs = (cfg.survey && cfg.survey.questions) || [];
    if (!rs.length || !qs.length) return [];
    const sum = [[`${cfg.title} 만족도 조사 결과`], [`응답 ${rs.length}건${cfg.survey.anon ? ' · 익명' : ''}`], []];
    qs.forEach((q, i) => {
      const vals = rs.map(r => r.answers[q.id]).filter(v => v != null && v !== '' && !(Array.isArray(v) && !v.length));
      sum.push([`${i + 1}. ${q.q}`, `응답 ${vals.length}`]);
      if (q.type === 'star') {
        const avg = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
        sum.push(['', '평균', vals.length ? avg.toFixed(2) + ' / 5' : '-']);
        [5, 4, 3, 2, 1].forEach(n => sum.push(['', '★'.repeat(n), vals.filter(v => v === n).length + '명']));
      } else if (q.type === 'one' || q.type === 'multi') {
        (q.options || []).forEach(o => { const c = vals.filter(v => Array.isArray(v) ? v.includes(o) : v === o).length; sum.push(['', o, c + '명', vals.length ? Math.round(c * 100 / vals.length) + '%' : '']); });
      } else vals.forEach(v => sum.push(['', String(v)]));
      sum.push([]);
    });
    const named = rs.some(r => r.no != null), byNo = new Map(all.map(p => [p.no, p])), lab = new Map(ss.map(s2 => [s2.id, s2.label]));
    const raw = [['회차', ...(named ? ['부서명', '성명'] : []), ...qs.map((q, i) => `${i + 1}. ${q.q}`)]];
    rs.forEach(r => { const p = byNo.get(r.no) || {}; raw.push([lab.get(r.session_id) || '', ...(named ? [p.dept || '', p.name || ''] : []), ...qs.map(q => { const v = r.answers[q.id]; return Array.isArray(v) ? v.join(', ') : v ?? ''; })]); });
    return [{ name: '만족도 요약', rows: sum, cols: [40, 18, 10, 8] }, { name: '만족도 응답', rows: raw, cols: [10, ...(named ? [18, 10] : []), ...qs.map(() => 24)] }];
  }
  function saveBooks(sheets, file) {
    const wb = XLSX.utils.book_new();
    sheets.forEach(sh => { const ws = XLSX.utils.aoa_to_sheet(sh.rows); ws['!cols'] = sh.cols.map(w => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, sh.name.slice(0, 31)); });
    XLSX.writeFile(wb, file);
  }

  // 담당자가 대신 처리: 명단에 없는 사람 넣기 / 미참석자 한 사람씩 출석(퇴실) 처리
  async function addPerson() {
    const name = await A.dialog({ title: '직접 출석 처리', message: '명단에 없는 사람이나 휴대폰이 없는 사람을 담당자가 대신 출석 처리합니다.\n(명단에 있는 사람은 [미참석자]에서 처리할 수 있어요)\n\n이름을 써 주세요.', input: '', ok: '다음' });
    if (!name) return;
    const dept = await A.dialog({ title: `${name} 님의 부서(소속)`, input: '', ok: '출석 처리' });
    if (dept === null) return;
    try { await A.rpc('admin_add', { p_id: eventId, p_token: token, p_dept: dept, p_name: name }); A.toast(`${name} 님을 출석 처리했어요`, 'ok'); }
    catch (e) { A.toast(e.message, 'bad'); }
  }
  async function markPerson(no) {
    const p = byNo.get(no) || { name: '' }, out = abTab === 'out';
    try { await A.rpc('admin_mark', { p_id: eventId, p_token: token, p_no: no, p_kind: out ? 'out' : 'in' }); A.toast(`${p.name} 님을 ${out ? '퇴실' : '출석'} 처리했어요`, 'ok'); }
    catch (e) { A.toast(e.message, 'bad'); }
  }
  async function newSession() {
    const name = await A.dialog({ title: '새 회차 시작', message: '화면을 비우고 새 회차 출석을 받습니다.\n지난 회차 기록은 그대로 남아 "전체 출석부"에 나옵니다.', input: A.shortDate(), ok: '새 회차 시작' });
    if (name === null) return;
    try { await A.rpc('new_session', { p_id: eventId, p_token: token, p_label: name }); A.toast('새 회차를 시작했습니다', 'ok'); }
    catch (e) { A.toast(e.message, 'bad'); }
  }
  async function renameSession() {
    const name = await A.dialog({ title: '회차 이름 바꾸기', input: sessionLabel, ok: '바꾸기' });
    if (!name) return;
    try { await A.rpc('rename_session', { p_id: eventId, p_token: token, p_label: name }); } catch (e) { A.toast(e.message, 'bad'); }
  }
  function setupAdmin() {
    const bar = $('adminBar'), tip = $('adminTip');
    bar.hidden = false;
    let t = 0;
    const wake = () => { bar.classList.remove('idle'); tip.classList.remove('idle'); clearTimeout(t); t = setTimeout(() => { bar.classList.add('idle'); tip.classList.add('idle'); }, 3500); };
    ['mousemove', 'touchstart', 'keydown'].forEach(e => addEventListener(e, wake, { passive: true }));
    wake();
    $('aNew').onclick = newSession; $('aRename').onclick = renameSession;
    $('aXlsNow').onclick = exportNow; $('aXlsAll').onclick = exportAll;
    $('aAbsent').onclick = () => toggleAbsent(); $('abClose').onclick = () => toggleAbsent(false);
    $('abCopy').onclick = copyAbsent; $('abXls').onclick = exportAbsent;
    $('abTabIn').onclick = () => { abTab = 'in'; renderAbsent(); }; $('abTabOut').onclick = () => { abTab = 'out'; renderAbsent(); };
    $('aMode').onclick = toggleMode; modeBtn();
    $('aAdd').onclick = addPerson;
    $('abList').addEventListener('click', e => { const b = e.target.closest('[data-mark]'); if (b) { b.disabled = true; markPerson(+b.dataset.mark); } });
    A.rpc('get_phones', { p_id: eventId, p_token: token }).then(ph => { phones = ph || {}; if (!$('absent').hidden) renderAbsent(); }).catch(() => {});
    $('aFull').onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {});
    $('aEdit').onclick = () => window.open(A.links(eventId, token).admin, '_blank', 'noopener');
    const menu = $('moreMenu'), more = $('aMore');
    const closeMenu = () => { menu.hidden = true; more.setAttribute('aria-expanded', 'false'); };
    more.onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; more.setAttribute('aria-expanded', String(!menu.hidden)); };
    menu.addEventListener('click', () => setTimeout(closeMenu, 0)); addEventListener('click', e => { if (!e.target.closest('#adminBar')) closeMenu(); });
    $('aPhone').onclick = () => A.phoneOpen(eventId, token);
    $('aSurvey').onclick = toggleSurvey; $('aLottery').onclick = lottery;
    // 휴대폰으로 열었으면: 큰 화면 대신 미참석자 목록부터 보여 준다
    if (new URLSearchParams(location.search).get('phone') || matchMedia('(max-width: 760px)').matches) {
      document.body.classList.add('phone-admin'); toggleAbsent(true);
    }
    markCancelable();
  }

  $('rest').addEventListener('click', () => wake()); addEventListener('keydown', () => wake());
  let resizeT = 0;
  addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(buildBoard, 200); });

  /* ---------- 미리보기 (행사 만들기 화면 안) ---------- */
  function startPreview() {
    let loop = 0;
    // 부모(행사 만들기 화면)가 받을 때까지 준비 신호를 보낸다
    const ping = setInterval(() => parent.postMessage({ type: 'preview-ready', page: 'screen' }, location.origin), 400);
    addEventListener('message', e => {
      if (e.origin !== location.origin || !e.data || e.data.type !== 'preview') return;
      clearInterval(ping);
      const { event, assets: am } = e.data;
      const sample = (event.roster && event.roster.length ? event.roster : Array.from({ length: 24 }, (_, i) => ({ no: i + 1, dept: ['스마트정보과', '감사담당관', '일자리정책과', '행정지원과'][i % 4], rank: '', name: ['김가람', '이나래', '박다온', '최라온', '정마루', '강바다'][i % 6] })));
      applyEvent({ config: event.config, roster: sample }, am);
      setSession({ id: 'p', label: event.config.first_session || '1회차' });
      clearTimeout(loop); queue = []; running = false; displayed = []; msDone = 0;
      buildBoard(); setCount(0, false);
      const order = sample.map(p => p.no), upto = Math.max(1, Math.ceil(order.length * 0.6));
      let k = Math.min(3, upto);
      displayed = order.slice(0, k); buildBoard(); setCount(k, false);
      const step = () => { if (k < upto) { queue.push(order[k++]); if (!running) arriveNext(); loop = setTimeout(step, 1600); } else loop = setTimeout(() => { k = 0; displayed = []; buildBoard(); setCount(0, false); step(); }, 5000); };
      loop = setTimeout(step, 900);
    });
    parent.postMessage({ type: 'preview-ready', page: 'screen' }, location.origin);
  }

  /* ---------- 시작 ---------- */
  (async function start() {
    if (PREVIEW) { startPreview(); return; }
    if (!A.ready) { full('저장소 설정이 필요합니다', 'config.js에 Supabase 주소와 키를 넣어 주세요. (README 참고)'); return; }
    if (!eventId) { full('행사 주소가 없습니다', '행사 만들기를 마치면 나오는 "강의실 화면" 링크로 열어 주세요.'); return; }
    try {
      const r = await loadEvent();
      if (!r) { full('행사를 찾을 수 없습니다', '주소가 맞는지, 보관 기간(기본 10일)이 지나지 않았는지 확인해 주세요.'); return; }
      applyEvent(r.ev, r.am); eventSig = sigOf(r);
      token = A.takeToken(eventId);
      if (token) isAdmin = await A.rpc('check_admin', { p_id: eventId, p_token: token }).catch(() => false);
      if (isAdmin) setupAdmin();
      refreshQr();
      poll();
    } catch (e) { full('불러오지 못했습니다', e.message); }
  })();
})();
