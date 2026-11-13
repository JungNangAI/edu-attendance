/* 공통 기능: 저장소(Supabase) 호출, 기본 설정, 색, 이미지 줄이기, QR, 알림창, 축하 효과 */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG || {};

  /* ---------- 기본 설정 ---------- */
  const DEFAULT_CONFIG = {
    title: '', subtitle: '', org: '', first_session: '1회차', block_duplicate: true,
    // 출석 방식: walkin 명단에 없는 사람도 받기 / one_phone 한 휴대폰 한 사람 / rotate_qr 30초마다 바뀌는 QR / depts 직접 쓸 때 보여 줄 부서 목록
    attend: { walkin: false, one_phone: false, rotate_qr: false, depts: [] },
    screen: {
      theme: 'card', bg: '#f5f6fa', accent: '#212b46', bg_image: 'soft', characters: true, motion: 'normal', sound: 'both', checkout: 'off',
      texts: {
        chip: '출석 체크', qr_hint: '휴대폰 카메라로 QR을 찍고\n내 이름을 고르세요', welcome: '님 환영합니다',
        unit: '명 출석', foot: '제출하면 몇 초 안에 화면에 이름이 나옵니다.', tag1: '', tag2: '', done: '모두 출석했습니다!', cheer: '환영해요!'
      }
    },
    join: { title: '출석 체크', ok_title: '출석됐습니다', ok_hint: '화면에서 내 이름을 확인하세요' },
    cert: {
      enabled: false, title: '위촉장', body: '위 사람을 ○○로 위촉합니다.', issuer: '',
      date_mode: 'issue', date: '',
      fields: [{ key: 'dept', label: '부서명' }, { key: 'rank', label: '직급' }, { key: 'name', label: '성명' }],
      only_attendees: false, button: '위촉장 받기', border: 'gold', seal: 'auto',
      template: { noTitle: false, dy: { info: 0, body: 0, date: 0, sign: 0 } }
    }
  };
  // 테마별 기본 색과 이름
  const THEMES = {
    card:      { label: '중랑 카드',  desc: '중랑구 머리띠·3색 띠, 카드가 뒤집히며 켜짐', bg: '#f5f6fa', accent: '#212b46' },
    apartment: { label: '3D 아파트',  desc: '노을 속 입체 아파트에 불이 켜짐', bg: '#ffd43b', accent: '#222b45' },
    star:      { label: '은하수',     desc: '은하수에 별똥별이 날아와 별이 빛남', bg: '#04060f', accent: '#cfe3ff' },
    garden:    { label: '장미축제',   desc: '장미가 피고 캐릭터가 반겨 줌', bg: '#fff0f3', accent: '#c2185b' },
    lantern:   { label: '소원 등불',  desc: '밤하늘에 등불이 하나씩 떠오름', bg: '#101a3a', accent: '#ffcf7a' },
    forest:    { label: '새싹 숲',    desc: '새싹이 나무로 자라 숲이 됨', bg: '#f1f8e9', accent: '#2e6b34' },
    chalk:     { label: '칠판',       desc: '분필로 이름을 또박또박 적음', bg: '#f4efe6', accent: '#2f4f3e' },
    memo:      { label: '메모 게시판', desc: '색색 메모지가 하나씩 붙음', bg: '#f7f1e3', accent: '#8a5a2b' },
    led:       { label: '전광판',     desc: '경기장 전광판에 이름이 켜짐', bg: '#0d0f14', accent: '#ffb000' },
    train:     { label: '중랑행 열차', desc: '열차 창문마다 불이 켜지고 출발', bg: '#eaf4fb', accent: '#0057a3' },
    ocean:     { label: '바닷속',     desc: '물방울이 물고기가 되어 헤엄침', bg: '#062a4f', accent: '#7fe0ff' },
    plaque:    { label: '금빛 명패',  desc: '위촉식에 어울리는 금빛 명패', bg: '#161a2e', accent: '#e3c06a' }
  };
  const PALETTES = [
    ['#f5f6fa', '#212b46', '중랑 남색'], ['#eef2f7', '#1f3a5f', '남색'], ['#ffd43b', '#222b45', '노랑·남색'], ['#0f1838', '#ffd66b', '밤하늘'],
    ['#f3f8ec', '#2f6b3a', '초록'], ['#fdf0f4', '#9e1c84', '보라'], ['#fff4e6', '#c4501b', '주황'],
    ['#eaf4fb', '#0057a3', '파랑'], ['#1b1d22', '#7fe3c4', '어두운 민트']
  ];

  function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }
  function merge(base, over) {
    const out = Array.isArray(base) ? base.slice() : { ...base };
    if (!isObj(over)) return out;
    for (const k of Object.keys(over)) {
      out[k] = isObj(base[k]) && isObj(over[k]) ? merge(base[k], over[k]) : over[k];
    }
    return out;
  }
  const withDefaults = c => merge(DEFAULT_CONFIG, c || {});

  /* ---------- 저장소 호출 ---------- */
  class RpcError extends Error {}
  async function rpc(fn, args) {
    if (!CFG.supabaseUrl || !CFG.supabaseKey) throw new RpcError('저장소(Supabase) 설정이 아직 없습니다. config.js를 확인해 주세요.');
    const key = CFG.supabaseKey;
    const headers = { 'Content-Type': 'application/json', apikey: key };
    if (/^eyJ/.test(key)) headers.Authorization = 'Bearer ' + key;  // 예전 anon 키(JWT)는 둘 다 보냄
    let res;
    try {
      res = await fetch(CFG.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/' + fn, { method: 'POST', headers, body: JSON.stringify(args || {}) });
    } catch (e) { throw new RpcError('인터넷 연결을 확인해 주세요.'); }
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!res.ok) throw new RpcError((data && data.message) || ('저장소 오류 (' + res.status + ')'));
    return data;
  }

  /* ---------- 주소 ---------- */
  const query = name => new URLSearchParams(location.search).get(name);
  const hashParam = name => new URLSearchParams(location.hash.replace(/^#/, '')).get(name);
  function siteBase() { return location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, ''); }
  const links = (id, token) => ({
    join: siteBase() + 'join.html?e=' + id,
    screen: siteBase() + 'screen.html?e=' + id,
    screenAdmin: siteBase() + 'screen.html?e=' + id + '#k=' + token,
    admin: siteBase() + 'admin.html?e=' + id + '#k=' + token,
    cert: siteBase() + 'cert.html?e=' + id
  });
  // 관리 열쇠: 주소 #k= 로 받으면 이 탭에 기억하고 주소창에서는 지운다(화면에 띄워도 안 보이게)
  function takeToken(id) {
    const k = hashParam('k');
    const store = 'k:' + id;
    if (k) {
      try { sessionStorage.setItem(store, k); } catch (e) {}
      history.replaceState(null, '', location.pathname + location.search);
      return k;
    }
    try { return sessionStorage.getItem(store) || myEvents().find(x => x.id === id)?.token || null; } catch (e) { return null; }
  }

  /* ---------- 휴대폰 출석표: 이 브라우저만 아는 무작위 값 (한 휴대폰 한 사람, 입실·퇴실 짝 맞추기) ---------- */
  let memDevice = null;
  function deviceId() {
    try { const v = localStorage.getItem('att-device'); if (v && v.length >= 16) return v; } catch (e) {}
    if (!memDevice) { const a = new Uint8Array(16); crypto.getRandomValues(a); memDevice = [...a].map(b => b.toString(16).padStart(2, '0')).join(''); }
    try { localStorage.setItem('att-device', memDevice); } catch (e) {}
    return memDevice;
  }

  /* ---------- 이 브라우저에서 만든 행사 목록 ---------- */
  function myEvents() { try { return JSON.parse(localStorage.getItem('my-events') || '[]'); } catch (e) { return []; } }
  function rememberEvent(ev) {
    try {
      const list = myEvents().filter(x => x.id !== ev.id);
      list.unshift({ id: ev.id, token: ev.token, title: ev.title, at: Date.now() });
      localStorage.setItem('my-events', JSON.stringify(list.slice(0, 50)));
    } catch (e) {}
  }
  function forgetEvent(id) { try { localStorage.setItem('my-events', JSON.stringify(myEvents().filter(x => x.id !== id))); } catch (e) {} }

  /* ---------- 글자·시간 ---------- */
  // 받침에 맞는 조사: josa('위촉장', '이', '가') → '위촉장이'
  const josa = (w, a, b) => { const c = String(w || '').trim().slice(-1).charCodeAt(0); const has = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 > 0 : false; return String(w || '') + (has ? a : b); };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tz = { timeZone: 'Asia/Seoul' };
  const hhmm = iso => new Date(iso).toLocaleTimeString('ko-KR', { ...tz, hour: '2-digit', minute: '2-digit', hour12: false });
  const ymd = iso => { const d = new Date(iso); return d.toLocaleDateString('ko-KR', { ...tz, year: 'numeric', month: 'numeric', day: 'numeric' }); };
  const shortDate = (d = new Date()) => {
    const p = new Intl.DateTimeFormat('ko-KR', { ...tz, month: 'numeric', day: 'numeric', weekday: 'short' }).formatToParts(d);
    const g = t => p.find(x => x.type === t)?.value;
    return `${g('month')}. ${g('day')}.(${g('weekday')})`;
  };

  /* ---------- 색 ---------- */
  function hexRgb(h) { h = String(h || '').replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); const n = parseInt(h, 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function lum(h) { return hexRgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0); }
  function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function mix(a, b, t) { const p = hexRgb(a), q = hexRgb(b); return '#' + p.map((v, i) => Math.round(v + (q[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
  // 바탕색·강조색 두 개로 나머지 색을 만든다
  function applyColors(el, bg, accent) {
    const dark = lum(bg) < 0.25;
    const ink = contrast(accent, bg) >= 3 ? accent : (dark ? '#f4f6fb' : '#1b2133');
    const onAccent = contrast('#ffffff', accent) >= contrast('#111111', accent) ? '#ffffff' : '#111111';
    const s = el.style;
    s.setProperty('--bg', bg); s.setProperty('--accent', accent); s.setProperty('--ink', ink);
    s.setProperty('--on-accent', onAccent);
    s.setProperty('--text', dark ? '#f4f6fb' : '#1b2133');
    s.setProperty('--muted', dark ? mix('#f4f6fb', bg, 0.35) : mix('#1b2133', bg, 0.4));
    s.setProperty('--soft', mix(bg, accent, dark ? 0.18 : 0.1));
    s.setProperty('--line', mix(bg, accent, dark ? 0.35 : 0.25));
    s.setProperty('--panel', dark ? mix(bg, '#ffffff', 0.07) : '#ffffff');
    el.classList.toggle('is-dark', dark);
  }

  /* ---------- 이미지 ---------- */
  const IMAGE_LIMITS = {
    logo: 900, bg: 1920, char_left: 700, char_right: 700, cert_mark: 1000, cert_seal: 600, cert_slogan: 1000, cert_template: 1754
  };
  function loadImage(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('이미지를 읽지 못했습니다')); i.src = src; });
  }
  function fileToDataUrl(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  }
  // 올린 이미지를 줄여 data URL로. 투명한 부분이 있으면 PNG, 없으면 JPEG
  async function shrinkImage(file, key) {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('PNG나 JPG 이미지만 올릴 수 있습니다');
    const img = await loadImage(await fileToDataUrl(file));
    const max = IMAGE_LIMITS[key] || 1200;
    let w = img.naturalWidth, h = img.naturalHeight;
    if (key === 'cert_template') { w = 1240; h = 1754; }
    else { const k = Math.min(1, max / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k); }
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0, w, h);
    let alpha = false;
    if (key !== 'cert_template' && key !== 'bg') {
      const d = x.getImageData(0, 0, w, h).data;
      for (let i = 3; i < d.length; i += 16) if (d[i] < 250) { alpha = true; break; }
    }
    let url = alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.84);
    if (url.length > 2800000) url = c.toDataURL('image/jpeg', 0.7);
    return url;
  }
  async function fetchAsDataUrl(path) {
    const r = await fetch(path); const b = await r.blob();
    return await new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(b); });
  }
  async function loadAssets(id, keys) {
    const out = {};
    await Promise.all(keys.map(async k => { try { const d = await rpc('get_asset', { p_id: id, p_key: k }); if (d) out[k] = d; } catch (e) {} }));
    return out;
  }

  /* ---------- QR ---------- */
  function qrCanvas(text, px = 640, margin = 2) {
    const q = window.qrcode(0, 'M'); q.addData(text); q.make();
    const n = q.getModuleCount(), cell = Math.floor(px / (n + margin * 2)), size = cell * (n + margin * 2);
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, size, size); x.fillStyle = '#111';
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (q.isDark(r, col)) x.fillRect((col + margin) * cell, (r + margin) * cell, cell, cell);
    return c;
  }
  function qrSvg(text) {
    const q = window.qrcode(0, 'M'); q.addData(text); q.make();
    const n = q.getModuleCount(); let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return `<svg viewBox="-1 -1 ${n + 2} ${n + 2}" shape-rendering="crispEdges" role="img" aria-label="출석 QR 코드"><rect x="-1" y="-1" width="${n + 2}" height="${n + 2}" fill="#fff"/><path d="${d}" fill="#111"/></svg>`;
  }
  function download(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }

  /* ---------- 알림·확인 창 (브라우저 기본 alert 대신) ---------- */
  function toast(msg, kind = '') {
    let t = document.getElementById('app-toast');
    if (!t) { t = document.createElement('div'); t.id = 'app-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.className = 'show ' + kind;
    clearTimeout(toast._t); toast._t = setTimeout(() => t.className = '', 2800);
  }
  function dialog({ title, message = '', ok = '확인', cancel = '취소', input = null, danger = false }) {
    return new Promise(resolve => {
      const wrap = document.createElement('div'); wrap.className = 'app-modal';
      wrap.innerHTML = `<div class="app-modal-box" role="dialog" aria-modal="true" aria-labelledby="amt">
        <h2 id="amt">${esc(title)}</h2>${message ? `<p>${esc(message).replace(/\n/g, '<br>')}</p>` : ''}
        ${input !== null ? `<input type="text" class="app-modal-input" value="${esc(input)}" maxlength="40">` : ''}
        <div class="app-modal-btns">${cancel ? `<button type="button" class="btn ghost" data-v="0">${esc(cancel)}</button>` : ''}
        <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-v="1">${esc(ok)}</button></div></div>`;
      document.body.appendChild(wrap);
      const inp = wrap.querySelector('input');
      const done = v => { wrap.classList.add('out'); setTimeout(() => wrap.remove(), 180); resolve(v ? (inp ? inp.value.trim() : true) : (inp ? null : false)); };
      wrap.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) done(b.dataset.v === '1'); else if (e.target === wrap && cancel) done(false); });
      wrap.addEventListener('keydown', e => { if (e.key === 'Escape' && cancel) done(false); if (e.key === 'Enter' && inp) done(true); });
      requestAnimationFrame(() => { wrap.classList.add('in'); (inp || wrap.querySelector('[data-v="1"]')).focus(); if (inp) inp.select(); });
    });
  }

  /* ---------- 축하 꽃가루 ---------- */
  function confetti({ count = 140, colors = ['#ffd43b', '#ff6b6b', '#4dabf7', '#51cf66', '#cc5de8'], duration = 3200, origin = null } = {}) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = document.createElement('canvas'); c.className = 'app-confetti';
    const W = c.width = innerWidth * devicePixelRatio, H = c.height = innerHeight * devicePixelRatio;
    document.body.appendChild(c); const x = c.getContext('2d');
    const ox = origin ? origin[0] * devicePixelRatio : W / 2, oy = origin ? origin[1] * devicePixelRatio : H * 0.35;
    const ps = Array.from({ length: count }, () => {
      const a = Math.random() * Math.PI * 2, v = (4 + Math.random() * 9) * devicePixelRatio;
      return { x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 6 * devicePixelRatio, r: (4 + Math.random() * 5) * devicePixelRatio, c: colors[Math.random() * colors.length | 0], s: Math.random() * 6, w: Math.random() * 0.3 + 0.1 };
    });
    const t0 = performance.now();
    (function f(t) {
      const k = (t - t0) / duration; x.clearRect(0, 0, W, H);
      for (const p of ps) {
        p.vy += 0.25 * devicePixelRatio; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.s += p.w;
        x.save(); x.globalAlpha = Math.max(0, 1 - k * k); x.translate(p.x, p.y); x.rotate(p.s);
        x.fillStyle = p.c; x.fillRect(-p.r, -p.r * 0.45, p.r * 2, p.r * 0.9); x.restore();
      }
      if (k < 1) requestAnimationFrame(f); else c.remove();
    })(t0);
  }

  window.App = {
    CFG, ready: !!(CFG.supabaseUrl && CFG.supabaseKey), DEFAULT_CONFIG, THEMES, PALETTES, withDefaults, merge,
    rpc, RpcError, query, hashParam, links, siteBase, takeToken, deviceId, myEvents, rememberEvent, forgetEvent,
    esc, josa, hhmm, ymd, shortDate, applyColors, contrast, mix, lum,
    loadImage, shrinkImage, fetchAsDataUrl, loadAssets, qrCanvas, qrSvg, download, toast, dialog, confetti
  };
})();
