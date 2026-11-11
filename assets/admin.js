/* 행사 만들기·고치기: 4단계 입력, 명단 엑셀 읽기, 이미지 올리기, 실시간 미리보기, 만들기·저장 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id), A = window.App, CR = window.CertRender;
  const $$ = s => [...document.querySelectorAll(s)];
  const eventId = A.query('e');
  const EDIT = !!eventId;
  let token = null, step = 1, changed = false, created = null, expiresAt = null;
  const state = { config: A.withDefaults({}), roster: [], assets: {}, dirty: new Set() };

  /* ---------- 설정값 읽고 쓰기 ---------- */
  const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
  const getK = (o, p) => p.split('.').reduce((a, k) => a == null ? a : a[k], o);
  const setK = (o, p, v) => { const ks = p.split('.'); let a = o; ks.slice(0, -1).forEach(k => { if (!isObj(a[k])) a[k] = {}; a = a[k]; }); a[ks[ks.length - 1]] = v; };
  function bindAll() {
    $$('[data-k]').forEach(el => {
      const v = getK(state.config, el.dataset.k);
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'radio') el.checked = String(v) === el.value;
      else el.value = v ?? '';
    });
    $('kind').value = ['위촉장', '수료증', '감사장', '임명장', '표창장'].includes(state.config.cert.title) ? state.config.cert.title : '';
  }
  function readEl(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'range') return Number(el.value);
    if (el.type === 'radio') return el.value === 'true' ? true : el.value === 'false' ? false : el.value;
    return el.value;
  }
  function onField(e) {
    const el = e.target.closest('[data-k]'); if (!el) return;
    if (el.type === 'radio' && !el.checked) return;
    const k = el.dataset.k; let v = readEl(el);
    if (/^screen\.(bg|accent)$/.test(k)) { if (!/^#[0-9a-f]{6}$/i.test(v)) return; $$(`[data-k="${k}"]`).forEach(x => { if (x !== el) x.value = v; }); }
    setK(state.config, k, v);
    if (k === 'cert.title') $('kind').value = ['위촉장', '수료증', '감사장', '임명장', '표창장'].includes(v) ? v : '';
    touch(k);
  }
  document.addEventListener('input', onField);
  document.addEventListener('change', onField);

  function touch(k = '') {
    changed = true;
    if (/^screen\.(bg|accent)/.test(k) || !k) checkContrast();
    if (k.startsWith('cert') || !k) { syncCertUi(); certPreview(); }
    if (!k.startsWith('cert.template') ) sendPreview();
    if (k === 'cert.enabled' || k === 'cert.button') sendPreview();
    markSteps();
  }
  function checkContrast() { $('contrastWarn').hidden = A.contrast(state.config.screen.bg, state.config.screen.accent) >= 2.2; }

  /* ---------- 단계 ---------- */
  function showStep(n) {
    step = n;
    $$('section.step').forEach(s => s.hidden = +s.dataset.step !== n);
    $$('.steps button').forEach(b => b.classList.toggle('on', +b.dataset.step === n));
    $('prev').style.visibility = n > 1 ? 'visible' : 'hidden';
    $('next').hidden = n >= 5;
    $('next').textContent = n === 4 ? (EDIT ? '저장 단계로' : '만들기 단계로') : '다음';
    if (n === 5) renderSummary();
    if (n === 4) pvTab('cert'); else if (n === 3 || n === 1) pvTab('screen');
    scrollTo({ top: 0, behavior: 'smooth' });
  }
  function problems() {
    const p = [];
    if (!String(state.config.title || '').trim()) p.push([1, '행사 이름을 넣어 주세요']);
    if (!state.roster.length) p.push([2, '명단을 올려 주세요']);
    if (state.config.cert.enabled) {
      if (!String(state.config.cert.title || '').trim()) p.push([4, '증서 제목을 넣어 주세요']);
      if (!String(state.config.cert.issuer || '').trim()) p.push([4, '증서 명의를 넣어 주세요']);
      if (state.config.cert.date_mode === 'fixed' && !state.config.cert.date) p.push([4, '증서 날짜를 골라 주세요']);
    }
    return p;
  }
  function markSteps() {
    const bad = new Set(problems().map(x => x[0]));
    $$('.steps button').forEach(b => { const n = +b.dataset.step; b.classList.toggle('ok', n < 5 && !bad.has(n) && (n !== 2 || state.roster.length > 0)); });
  }
  $$('.steps button').forEach(b => b.addEventListener('click', () => showStep(+b.dataset.step)));
  $('prev').onclick = () => showStep(Math.max(1, step - 1));
  $('next').onclick = () => {
    if (step === 1 && !String(state.config.title || '').trim()) { A.toast('행사 이름을 넣어 주세요', 'bad'); $('title').focus(); return; }
    showStep(Math.min(5, step + 1));
  };
  function renderSummary() {
    const c = state.config, items = [
      ['행사', c.title || '(없음)'], ['명단', state.roster.length + '명'], ['테마', (A.THEMES[c.screen.theme] || {}).label],
      ['증서', c.cert.enabled ? `${c.cert.title} · ${c.cert.only_attendees ? '출석한 사람만' : '누구나'}` : '쓰지 않음']
    ];
    if (EDIT && expiresAt) items.push(['자동 삭제 예정', new Date(expiresAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }) + ' (출석·새 회차·저장할 때마다 10일씩 늦춰져요)']);
    const html = items.map(([k, v]) => `<li>${k}: <b>${A.esc(v)}</b></li>`).join('') + problems().map(([n, m]) => `<li style="color:var(--bad)">${n}단계: ${A.esc(m)}</li>`).join('');
    $('summary').innerHTML = html; $('summary2').innerHTML = html;
  }

  /* ---------- 2. 명단 ---------- */
  let sheet = null;  // {headers, data}
  const KEYS = {
    no: /^(연\s*번|번\s*호|순\s*번|순|no\.?)$/i, name: /^(성\s*명|이\s*름|성함|name)$/i,
    dept: /(부서|소속|기관|과\s*명|팀명|department)/i, rank: /(직위|직급|직렬|직책|rank|title)/i
  };
  function readRows(rows) {
    rows = rows.map(r => (r || []).map(c => String(c ?? '').trim()));
    let h = rows.slice(0, 15).findIndex(r => r.some(c => KEYS.name.test(c)));
    let headers, data;
    if (h >= 0) { headers = rows[h].map((c, i) => c || `${i + 1}열`); data = rows.slice(h + 1); }
    else { const w = Math.max(...rows.map(r => r.length)); headers = Array.from({ length: w }, (_, i) => `${i + 1}열`); data = rows; }
    data = data.filter(r => r.some(Boolean));
    sheet = { headers, data };
    const opts = '<option value="-1">(없음)</option>' + headers.map((t, i) => `<option value="${i}">${A.esc(t)}</option>`).join('');
    $$('[data-map]').forEach(s => {
      s.innerHTML = opts;
      const k = s.dataset.map, idx = headers.findIndex(t => KEYS[k].test(t));
      s.value = String(idx);
    });
    $('mapBox').hidden = false;
    applyMapping();
  }
  function applyMapping() {
    if (!sheet) return;
    const m = Object.fromEntries($$('[data-map]').map(s => [s.dataset.map, +s.value]));
    const cell = (r, k) => m[k] >= 0 ? String(r[m[k]] || '').trim() : '';
    let skipped = 0;
    let list = sheet.data.map(r => ({ no: parseInt(cell(r, 'no'), 10), dept: cell(r, 'dept'), rank: cell(r, 'rank'), name: cell(r, 'name') }))
      .filter(p => { if (!p.name) { skipped++; return false; } return true; });
    const nos = list.map(p => p.no);
    if (nos.some(n => !Number.isFinite(n)) || new Set(nos).size !== nos.length) list = list.map((p, i) => ({ ...p, no: i + 1 }));
    if (EDIT && state.roster.length && !applyMapping.warned) {
      applyMapping.warned = true;
      A.toast('명단을 바꿨어요. 연번이 같은 사람끼리 출석 기록이 이어져요.');
    }
    state.roster = list;
    renderRoster(skipped);
    touch('roster');
  }
  function renderRoster(skipped = 0) {
    const r = state.roster;
    const names = {}; r.forEach(p => names[p.name] = (names[p.name] || 0) + 1);
    const dup = Object.keys(names).filter(n => names[n] > 1);
    $('rosterInfo').innerHTML = r.length ? `<div class="ok-box"><b>${r.length}명</b>을 읽었어요.${skipped ? ` 이름이 빈 줄 ${skipped}개는 뺐어요.` : ''}
      ${dup.length ? `<br>동명이인: ${dup.map(A.esc).join(', ')} — 휴대폰에서 부서와 함께 보여서 구분돼요.` : ''}</div>` : '';
    $('rosterTable').innerHTML = r.length ? `<thead><tr><th>연번</th><th>부서명</th><th>직위(직급)</th><th>성명</th></tr></thead><tbody>` +
      r.map(p => `<tr><td>${p.no}</td><td>${A.esc(p.dept)}</td><td>${A.esc(p.rank)}</td><td>${A.esc(p.name)}</td></tr>`).join('') + '</tbody>' : '';
  }
  $$('[data-map]').forEach(s => s.addEventListener('change', e => { e.stopPropagation(); applyMapping(); }));
  async function readFile(f) {
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      readRows(XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }));
      A.toast(`${f.name}을(를) 읽었어요`, 'ok');
    } catch (e) { A.toast('파일을 읽지 못했어요. 엑셀(.xlsx) 파일인지 확인해 주세요.', 'bad'); }
  }
  const drop = $('drop');
  drop.onclick = () => $('rosterFile').click();
  drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('rosterFile').click(); } };
  $('rosterFile').onchange = e => { if (e.target.files[0]) readFile(e.target.files[0]); e.target.value = ''; };
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });
  $('pasteToggle').onclick = () => { $('pasteBox').hidden = !$('pasteBox').hidden; if (!$('pasteBox').hidden) $('pasteArea').focus(); };
  $('pasteGo').onclick = () => { const t = $('pasteArea').value.trim(); if (!t) return; readRows(t.split(/\r?\n/).map(l => l.split('\t'))); };
  $('sampleXls').onclick = () => {
    const ws = XLSX.utils.aoa_to_sheet([['연번', '부서명', '직위(직급)', '성명'], [1, '스마트정보과', '지방행정주사', '홍길동'], [2, '감사담당관', '지방행정주사보', '김철수']]);
    ws['!cols'] = [{ wch: 6 }, { wch: 22 }, { wch: 16 }, { wch: 10 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '명단'); XLSX.writeFile(wb, '명단_양식.xlsx');
  };

  /* ---------- 3. 테마·색 ---------- */
  const THUMB = {
    card: (bg, ac) => `<div class="tthumb" style="background:${bg}"><svg viewBox="0 0 60 36" width="78"><rect width="60" height="9" fill="${ac}"/><rect y="9" width="20" height="1.6" fill="#106A3A"/><rect x="20" y="9" width="20" height="1.6" fill="#9E1C84"/><rect x="40" y="9" width="20" height="1.6" fill="#0057A3"/>${[0, 1].map(r => [0, 1, 2, 3].map(c => `<rect x="${c * 14 + 3}" y="${r * 11 + 14}" width="12" height="9" rx="1.5" fill="${r * 4 + c < 5 ? ac : '#fff'}" stroke="${ac}" stroke-width=".4"/><rect x="${c * 14 + 3}" y="${r * 11 + 14}" width="12" height="1.4" fill="${['#106A3A', '#9E1C84', '#0057A3'][(r * 4 + c) % 3]}"/>`).join('')).join('')}</svg></div>`,
    apartment: (bg, ac) => `<div class="tthumb" style="background:linear-gradient(#2c3f7c,#7d5aa6 60%,#f39a6b)"><svg viewBox="0 0 60 40" width="78">${[[6, 18, 22, '#106A3A'], [24, 8, 32, '#9E1C84'], [42, 18, 22, '#0057A3']].map(([x, y, h, c]) => `<polygon points="${x + 12},${y} ${x + 16},${y - 3} ${x + 16},${y + h - 3} ${x + 12},${y + h}" fill="${c}" opacity=".7"/><polygon points="${x},${y} ${x + 4},${y - 3} ${x + 16},${y - 3} ${x + 12},${y}" fill="#fff" opacity=".35"/><rect x="${x}" y="${y}" width="12" height="${h}" fill="${c}"/>`).join('')}${[[8, 22], [26, 12], [31, 18], [26, 24], [44, 22], [49, 30]].map(([x, y]) => `<rect x="${x}" y="${y}" width="3.5" height="3.5" fill="#ffe27a"/>`).join('')}<rect y="38" width="60" height="2" fill="#2a2d40"/></svg></div>`,
    star: (bg, ac) => `<div class="tthumb" style="background:radial-gradient(ellipse at 50% 50%,#3a2f55 0%,#02030a 70%)"><svg viewBox="0 0 60 36" width="78"><path d="M0 34 L60 2" stroke="#ffd9b0" stroke-width="10" opacity=".18"/><path d="M0 34 L60 2" stroke="#fff" stroke-width="3" opacity=".12"/>${Array.from({ length: 26 }, (_, i) => `<circle cx="${(i * 37) % 60}" cy="${(i * 23) % 36}" r=".5" fill="#fff"/>`).join('')}${[[14, 22], [30, 14], [44, 20]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2" fill="#fff"/><path d="M${x - 5} ${y}h10M${x} ${y - 5}v10" stroke="#fff" stroke-width=".5"/>`).join('')}</svg></div>`,
    garden: (bg, ac) => `<div class="tthumb" style="background:linear-gradient(#fff7f9,#ffd9e3)"><svg viewBox="0 0 60 36" width="78"><path d="M2 36 Q30 -6 58 36" stroke="#3f7d3f" stroke-width="2" fill="none"/>${[[8, 22], [16, 12], [30, 7], [44, 12], [52, 22]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="2.4" fill="${['#d6204f', '#ff5c8a', '#c2185b', '#ff8fa3', '#e63946'][i]}"/>`).join('')}${[[20, '#d6204f'], [30, '#ff5c8a'], [40, '#c2185b']].map(([x, c]) => `<rect x="${x - .5}" y="26" width="1" height="8" fill="#4f9a52"/><circle cx="${x}" cy="24" r="4" fill="${c}"/><circle cx="${x}" cy="24" r="1.6" fill="none" stroke="rgba(0,0,0,.3)" stroke-width=".6"/>`).join('')}<rect y="33" width="60" height="3" fill="#4f9a52"/></svg></div>`
  };
  function renderThemes() {
    $('themes').innerHTML = Object.entries(A.THEMES).map(([k, t]) => `<label class="theme"><input type="radio" name="theme" data-k="screen.theme" value="${k}">${THUMB[k](t.bg, t.accent)}<b>${t.label}</b><span>${t.desc}</span></label>`).join('');
    $('themes').addEventListener('change', e => {
      const t = A.THEMES[e.target.value]; if (!t) return;
      state.config.screen.bg = t.bg; state.config.screen.accent = t.accent; bindAll(); touch('screen.bg');
    });
    $('palettes').innerHTML = A.PALETTES.map(([bg, ac, name]) => `<button type="button" class="pal" style="background:${bg}" data-bg="${bg}" data-ac="${ac}" title="${name}" aria-label="색 조합: ${name}"><i style="background:${ac}"></i></button>`).join('');
    $('palettes').addEventListener('click', e => { const b = e.target.closest('.pal'); if (!b) return; state.config.screen.bg = b.dataset.bg; state.config.screen.accent = b.dataset.ac; bindAll(); touch('screen.bg'); });
  }

  /* ---------- 이미지 ---------- */
  const imgCache = {};
  function renderThumbs() {
    $$('.img-slot[data-asset]').forEach(s => {
      const k = s.dataset.asset, url = state.assets[k];
      s.querySelector('.thumb').innerHTML = url ? `<img src="${url}" alt="">` : '';
      const rm = s.querySelector('.rm'); if (rm) rm.disabled = !url;
    });
    $('tplBox').hidden = !state.assets.cert_template;
    $('sealSlot').hidden = state.config.cert.seal !== 'image';
  }
  async function setAsset(k, url) {
    state.assets[k] = url || null; state.dirty.add(k); delete imgCache[k];
    renderThumbs(); touch(k.startsWith('cert') ? 'cert.asset' : 'asset');
    if (!k.startsWith('cert')) sendPreview();
  }
  $$('.img-slot[data-asset]').forEach(s => {
    const k = s.dataset.asset, f = s.querySelector('input[type=file]');
    f.addEventListener('change', async e => {
      e.stopPropagation(); const file = f.files[0]; f.value = ''; if (!file) return;
      try { A.toast('이미지를 줄이는 중…'); await setAsset(k, await A.shrinkImage(file, k)); A.toast('올렸어요', 'ok'); }
      catch (err) { A.toast(err.message, 'bad'); }
    });
    s.querySelector('.rm').addEventListener('click', () => setAsset(k, null));
    s.querySelectorAll('[data-default]').forEach(b => b.addEventListener('click', async () => {
      try { await setAsset(k, await A.fetchAsDataUrl('assets/defaults/' + b.dataset.default)); } catch (e) { A.toast('기본 이미지를 불러오지 못했어요', 'bad'); }
    }));
  });

  /* ---------- 4. 위촉장 ---------- */
  const BODY = {
    위촉장: '위 사람을 ○○로 위촉합니다.', 수료증: '위 사람은 ○○ 과정을 성실히 이수하였으므로\n이 증서를 수여합니다.',
    감사장: '위 사람은 ○○에 적극 참여하여\n큰 도움을 주셨기에 깊이 감사드립니다.', 임명장: '위 사람을 ○○에 임명합니다.',
    표창장: '위 사람은 ○○에 힘써 공이 크므로\n이에 표창합니다.'
  };
  $('kind').addEventListener('change', e => {
    e.stopPropagation();
    const v = e.target.value, c = state.config.cert;
    if (!v) { $('ctitle').focus(); return; }
    const wasTemplate = !c.body || Object.values(BODY).includes(c.body);
    c.title = v; if (wasTemplate) c.body = BODY[v]; c.button = v + ' 받기';
    bindAll(); touch('cert.title');
  });
  function renderFields() {
    const fs = state.config.cert.fields;
    const fixed = { dept: '명단: 부서', rank: '명단: 직급', name: '명단: 성명' };
    $('fieldList').innerHTML = fs.map((f, i) => `<div class="fld"><span class="tag">${fixed[f.key] || '직접 입력'}</span><input type="text" value="${A.esc(f.label)}" data-fi="${i}" maxlength="8" aria-label="칸 이름">
      <button type="button" class="btn ghost" data-fdel="${i}" ${fs.length <= 1 ? 'disabled' : ''} aria-label="칸 빼기">빼기</button></div>`).join('');
    $('addField').disabled = fs.length >= 5;
  }
  $('fieldList').addEventListener('input', e => { const i = e.target.dataset.fi; if (i == null) return; e.stopPropagation(); state.config.cert.fields[+i].label = e.target.value; touch('cert.fields'); });
  $('fieldList').addEventListener('click', e => { const i = e.target.dataset.fdel; if (i == null) return; state.config.cert.fields.splice(+i, 1); renderFields(); touch('cert.fields'); });
  $('addField').onclick = () => {
    const used = new Set(state.config.cert.fields.map(f => f.key));
    const missing = ['dept', 'rank', 'name'].find(k => !used.has(k));
    const key = missing || ['x1', 'x2', 'x3', 'x4', 'x5'].find(k => !used.has(k));
    state.config.cert.fields.push({ key, label: { dept: '부서명', rank: '직급', name: '성명' }[key] || '과정명' });
    renderFields(); touch('cert.fields');
  };
  function syncCertUi() {
    const on = !!state.config.cert.enabled;
    $('certBox').style.opacity = on ? 1 : .45; $('certBox').inert = !on;
    $('cdate').hidden = state.config.cert.date_mode !== 'fixed';
    $('sealSlot').hidden = state.config.cert.seal !== 'image';
  }
  async function certImages() {
    const out = {};
    for (const [k, key] of [['mark', 'cert_mark'], ['seal', 'cert_seal'], ['slogan', 'cert_slogan'], ['template', 'cert_template']]) {
      const url = state.assets[key]; if (!url) continue;
      if (!imgCache[key]) { try { imgCache[key] = await A.loadImage(url); } catch (e) { continue; } }
      out[k] = imgCache[key];
    }
    return out;
  }
  let certT = 0;
  function certPreview() {
    clearTimeout(certT);
    certT = setTimeout(async () => {
      const p = state.roster[0] || { dept: '스마트정보과', rank: '지방행정주사', name: '홍길동' };
      const vals = { dept: p.dept, rank: p.rank, name: p.name, x1: '○○ 과정', x2: '○○', x3: '○○', x4: '○○', x5: '○○' };
      await CR.render($('pvCert'), state.config.cert, await certImages(), vals, { sample: true });
      $('pvCertHint').textContent = state.config.cert.enabled ? `명단 첫 사람(${p.name})으로 그린 예시예요.` : '위촉장을 쓰지 않는 상태예요. 4단계에서 켤 수 있어요.';
    }, 150);
  }

  /* ---------- 미리보기 ---------- */
  const frames = { screen: { el: $('pvScreen'), ready: false }, join: { el: $('pvJoin'), ready: false } };
  addEventListener('message', e => {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'preview-ready') return;
    const f = frames[e.data.page]; if (f && !f.ready) { f.ready = true; sendNow(e.data.page); }
  });
  function payload() { return { type: 'preview', event: { config: state.config, roster: state.roster }, assets: { logo: state.assets.logo || null, bg: state.assets.bg || null, char_left: state.assets.char_left || null, char_right: state.assets.char_right || null } }; }
  function sendNow(only) {
    const msg = JSON.parse(JSON.stringify(payload()));
    Object.entries(frames).forEach(([k, f]) => { if ((!only || only === k) && f.ready && f.el.contentWindow) f.el.contentWindow.postMessage(msg, location.origin); });
  }
  let pvT = 0;
  function sendPreview() { clearTimeout(pvT); pvT = setTimeout(sendNow, 350); }
  function fitScreen() { const box = $('pvScreen').parentElement; $('pvScreen').style.transform = `scale(${box.clientWidth / 1600})`; }
  new ResizeObserver(fitScreen).observe($('pvScreen').parentElement);
  function pvTab(name) {
    $$('.pv-tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.pv === name));
    $$('.pv').forEach(p => p.hidden = p.dataset.pv !== name);
    if (name === 'cert') certPreview();
    if (name === 'screen') fitScreen();
  }
  $$('.pv-tabs button').forEach(b => b.addEventListener('click', () => pvTab(b.dataset.pv)));

  /* ---------- 링크·QR 안내문 ---------- */
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
    A.toast('복사했어요', 'ok');
  }
  async function poster(joinUrl) {
    const W = 1240, H = 1754, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'), cf = state.config, ac = cf.screen.accent, bg = cf.screen.bg;
    const FB = '"IBM Plex Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif';
    // 머리띠는 강의실 화면 바탕색(로고가 그 위에서 잘 보이게 고른 색), 본문은 흰 종이
    const ink = A.contrast(ac, bg) >= 3 ? ac : (A.lum(bg) < .25 ? '#ffffff' : '#1b2133');
    const paperInk = A.contrast(ac, '#ffffff') >= 3 ? ac : '#1b2133';
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);
    x.fillStyle = bg; x.fillRect(0, 0, W, 360);
    x.fillStyle = ac; x.fillRect(0, 360, W, 12);
    x.fillStyle = ink; x.textAlign = 'center';
    x.font = `600 40px ${FB}`; x.fillText(cf.subtitle || cf.org || '', W / 2, 140);
    let fs = 84; x.font = `800 ${fs}px ${FB}`; while (x.measureText(cf.title).width > W - 160 && fs > 40) { fs -= 4; x.font = `800 ${fs}px ${FB}`; }
    x.fillText(cf.title, W / 2, 250);
    if (state.assets.logo) { try { const l = await A.loadImage(state.assets.logo); const h = 70, w = Math.min(320, h * l.naturalWidth / l.naturalHeight); x.drawImage(l, W - 60 - w, 30, w, w * l.naturalHeight / l.naturalWidth); } catch (e) {} }
    x.fillStyle = '#fff'; x.beginPath(); x.roundRect(220, 470, 800, 800, 40); x.fill();
    x.lineWidth = 10; x.strokeStyle = paperInk; x.stroke();
    x.drawImage(A.qrCanvas(joinUrl, 720, 1), 260, 510, 720, 720);
    x.fillStyle = paperInk; x.font = `800 64px ${FB}`; x.fillText('QR을 찍어 출석해 주세요', W / 2, 1410);
    x.fillStyle = '#1b2133';
    x.font = `500 38px ${FB}`; x.globalAlpha = .8;
    x.fillText('휴대폰 카메라로 찍고 → 내 이름을 고르고 → 제출', W / 2, 1490);
    x.globalAlpha = .6; x.font = `500 30px ${FB}`; x.fillText(cf.org || '', W / 2, 1650);
    return c.toDataURL('image/png');
  }
  function linkCards(id, tk) {
    const L = A.links(id, tk), cf = state.config;
    const qr = A.qrCanvas(L.join, 360, 2).toDataURL('image/png');
    const card = (cls, title, desc, url, extra = '') => `<div class="link-card ${cls}">${extra}<div style="min-width:0;flex:1"><h3>${title}</h3><p class="hint" style="margin:0">${desc}</p><div class="url">${A.esc(url)}</div>
      <div class="row-btns" style="margin:0"><a class="btn ghost" href="${url}" target="_blank" rel="noopener">열기</a><button type="button" class="btn ghost" data-copy="${A.esc(url)}">복사</button></div></div></div>`;
    return card('', '① 강의실 화면 (담당자용)', '이 링크로 열어야 엑셀·새 회차·출석 취소 버튼이 보여요. 주소창의 열쇠 부분은 열면 자동으로 숨겨져요.', L.screenAdmin)
      + `<div class="link-card"><img class="qr" src="${qr}" alt="참석자 QR"><div style="min-width:0;flex:1"><h3>② 참석자 QR</h3><p class="hint" style="margin:0">강의실 화면에도 나오고, A4 안내문으로 뽑아 붙일 수도 있어요.</p><div class="url">${A.esc(L.join)}</div>
        <div class="row-btns" style="margin:0"><button type="button" class="btn ghost" id="dlPoster">A4 QR 안내문</button><button type="button" class="btn ghost" id="dlQr">QR만</button><button type="button" class="btn ghost" data-copy="${A.esc(L.join)}">링크 복사</button></div></div></div>`
      + (cf.cert.enabled ? card('', `③ ${cf.cert.title} 받기`, '보통은 출석 완료 화면의 버튼으로 들어가요. 따로 보낼 때 쓰세요.', L.cert) : '')
      + card('key', '🔑 관리 링크 (설정 고치기)', '잃어버리면 설정을 고치거나 엑셀을 받을 수 없어요. 이 브라우저의 첫 화면에도 저장해 두었어요.', L.admin)
      + `<button type="button" class="btn ghost" id="dlLinks">링크 모음 파일(.txt) 내려받기</button>`;
  }
  function wireLinks(root, id, tk) {
    const L = A.links(id, tk);
    root.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => copy(b.dataset.copy));
    const p = root.querySelector('#dlPoster'); if (p) p.onclick = async () => A.download(await poster(L.join), `${state.config.title}_QR안내문_A4.png`);
    const q = root.querySelector('#dlQr'); if (q) q.onclick = () => A.download(A.qrCanvas(L.join, 1000, 3).toDataURL('image/png'), `${state.config.title}_QR.png`);
    const t = root.querySelector('#dlLinks'); if (t) t.onclick = () => {
      const txt = `${state.config.title} 링크 모음\r\n\r\n강의실 화면(담당자용): ${L.screenAdmin}\r\n참석자 QR 주소: ${L.join}\r\n` + (state.config.cert.enabled ? `${state.config.cert.title} 받기: ${L.cert}\r\n` : '') + `관리 링크(설정 고치기): ${L.admin}\r\n\r\n※ 관리 링크와 강의실 화면(담당자용) 링크는 다른 사람에게 주지 마세요.\r\n`;
      A.download('data:text/plain;charset=utf-8,' + encodeURIComponent('﻿' + txt), `${state.config.title}_링크.txt`);
    };
  }

  /* ---------- 만들기·저장 ---------- */
  async function uploadAssets(id, tk, keys) {
    for (const k of keys) {
      await A.rpc('set_asset', { p_id: id, p_token: tk, p_key: k, p_data: state.assets[k] || '' });
    }
  }
  $('createBtn').onclick = async () => {
    const p = problems();
    if (p.length) { $('createErr').textContent = p.map(x => `${x[0]}단계: ${x[1]}`).join(' / '); return; }
    const pw = $('pw').value; if (!pw) { $('createErr').textContent = '비밀번호를 넣어 주세요.'; $('pw').focus(); return; }
    const btn = $('createBtn'); btn.disabled = true; btn.textContent = '만드는 중…'; $('createErr').textContent = '';
    try {
      const r = created || await A.rpc('create_event', { p_password: pw, p_config: state.config, p_roster: state.roster });
      created = r;
      const keys = Object.keys(state.assets).filter(k => state.assets[k]);
      btn.textContent = '이미지 올리는 중…';
      await uploadAssets(r.id, r.token, keys);
      A.rememberEvent({ id: r.id, token: r.token, title: state.config.title });
      changed = false;
      showDone(r.id, r.token);
    } catch (e) { $('createErr').textContent = e.message; btn.disabled = false; btn.textContent = created ? '이미지 다시 올리기' : '행사 만들기'; }
  };
  function showDone(id, tk) {
    $('createBox').hidden = true; $('navBtns').hidden = true; document.querySelector('.steps').hidden = true;
    const d = $('doneBox'); d.hidden = false;
    d.innerHTML = `<div class="done-hero"><div class="big-check">✓</div><h2>행사를 만들었어요</h2><p class="hint">아래 링크로 바로 시작하세요. 명단과 출석 기록은 마지막으로 쓴 날부터 <b>10일 뒤 자동으로 지워져요</b>. 출석부 엑셀은 미리 받아 두세요.</p></div>` + linkCards(id, tk)
      + `<div class="row-btns"><a class="btn ghost" href="admin.html?e=${id}">설정 고치기</a><a class="btn ghost" href="index.html">처음으로</a></div>`;
    wireLinks(d, id, tk);
    try { sessionStorage.setItem('k:' + id, tk); } catch (e) {}
    A.confetti();
  }
  async function save() {
    const p = problems();
    if (p.length) { A.toast(p[0][1], 'bad'); showStep(p[0][0]); return; }
    const btns = [$('saveBtn'), $('saveTop')]; btns.forEach(b => { b.disabled = true; });
    try {
      await A.rpc('update_event', { p_id: eventId, p_token: token, p_config: state.config, p_roster: state.roster });
      await uploadAssets(eventId, token, [...state.dirty]);
      state.dirty.clear(); changed = false;
      A.rememberEvent({ id: eventId, token, title: state.config.title });
      A.toast('저장했어요. 열려 있는 강의실 화면에도 곧 반영돼요.', 'ok');
    } catch (e) { A.toast(e.message, 'bad'); }
    btns.forEach(b => { b.disabled = false; });
  }
  $('saveBtn').onclick = save; $('saveTop').onclick = save;
  $('delBtn').onclick = async () => {
    const ok = await A.dialog({ title: '행사 삭제', message: `"${state.config.title}" 행사와 모든 출석 기록을 지웁니다.\n되돌릴 수 없어요.`, ok: '삭제', danger: true });
    if (!ok) return;
    try { await A.rpc('delete_event', { p_id: eventId, p_token: token }); A.forgetEvent(eventId); changed = false; location.href = 'index.html'; }
    catch (e) { A.toast(e.message, 'bad'); }
  };
  addEventListener('beforeunload', e => { if (changed && (EDIT || state.roster.length || state.config.title)) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- 시작 ---------- */
  function initUi() {
    renderThemes(); renderFields(); bindAll(); renderThumbs(); syncCertUi(); checkContrast(); renderRoster(); markSteps();
    showStep(1); sendPreview(); certPreview();
  }
  (async function start() {
    if (!A.ready) { document.querySelector('.layout').innerHTML = '<div class="card">저장소(Supabase) 설정이 아직 없어요. config.js를 먼저 채워 주세요. (README 참고)</div>'; return; }
    if (!EDIT) {
      state.config.cert.issuer = ''; initUi(); changed = false; return;
    }
    token = A.takeToken(eventId);
    $('modeLabel').textContent = '행사 고치기'; $('pageTitle').textContent = '불러오는 중…';
    $('saveTop').hidden = false; $('createBox').hidden = true; $('editBox').hidden = false;
    $('stepFinish').querySelector('span').textContent = '저장·관리'; $('firstSessionBox').hidden = true;
    try {
      const ev = await A.rpc('get_event', { p_id: eventId });
      if (!ev) throw new Error('행사를 찾을 수 없어요 (마지막으로 쓴 날부터 10일이 지나 자동으로 지워졌을 수 있어요)');
      if (!token || !await A.rpc('check_admin', { p_id: eventId, p_token: token })) throw new Error('관리 링크로 열어야 고칠 수 있어요. 처음 만들 때 받은 관리 링크를 써 주세요.');
      state.config = A.withDefaults(ev.config); state.roster = ev.roster; expiresAt = ev.expires_at;
      state.assets = await A.loadAssets(eventId, ev.assets);
      $('pageTitle').textContent = state.config.title;
      initUi();
      $('linksEdit').innerHTML = '<h3>링크</h3>' + linkCards(eventId, token); wireLinks($('linksEdit'), eventId, token);
      changed = false;
    } catch (e) {
      document.querySelector('.layout').innerHTML = `<div class="card"><h2>열 수 없어요</h2><p>${A.esc(e.message)}</p><a class="btn ghost" href="index.html">처음으로</a></div>`;
      document.querySelector('.steps').hidden = true; $('saveTop').hidden = true;
    }
  })();
})();
