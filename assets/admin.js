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
    $('depts').value = (state.config.attend.depts || []).join('\n');
    syncAttendUi();
  }
  // 출석 방식: 명단 밖 출석을 켜면 부서 목록 칸이 보이고, 명단이 없어도 된다
  const walkin = () => !!(state.config.attend && state.config.attend.walkin);
  function syncAttendUi() { $('deptsBox').hidden = !walkin(); }
  $('depts').addEventListener('input', e => {
    e.stopPropagation();
    state.config.attend.depts = [...new Set(e.target.value.split(/\r?\n/).map(x => x.trim().slice(0, 60)).filter(Boolean))].slice(0, 300);
    touch('attend.depts');
  });
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
    if (k.startsWith('attend')) syncAttendUi();
    if (k.startsWith('cert') || !k) { syncCertUi(); certPreview(); }
    if (k === 'pass.on' || k === 'survey.on' || !k) syncOptUi();
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
    if (!state.roster.length && !walkin()) p.push([2, '명단을 올리거나 "명단에 없는 사람도 출석 받기"를 켜 주세요']);
    if (state.config.cert.enabled) {
      if (!String(state.config.cert.title || '').trim()) p.push([4, '증서 제목을 넣어 주세요']);
      if (!String(state.config.cert.issuer || '').trim()) p.push([4, '증서 명의를 넣어 주세요']);
      if (state.config.cert.date_mode === 'fixed' && !state.config.cert.date) p.push([4, '증서 날짜를 골라 주세요']);
      if (state.config.cert.only_attendees === 'pass' && !state.config.pass.on) p.push([4, "'이수 기준을 채운 사람만'을 고르면 이수 기준을 켜 주세요"]);
    }
    const sp = surveyProblem(); if (sp) p.push([4, sp]);
    return p;
  }
  function markSteps() {
    const bad = new Set(problems().map(x => x[0]));
    $$('.steps button').forEach(b => { const n = +b.dataset.step; b.classList.toggle('ok', n < 5 && !bad.has(n) && (n !== 2 || state.roster.length > 0 || walkin())); });
  }
  $$('.steps button').forEach(b => b.addEventListener('click', () => showStep(+b.dataset.step)));
  $('prev').onclick = () => showStep(Math.max(1, step - 1));
  $('next').onclick = () => {
    if (step === 1 && !String(state.config.title || '').trim()) { A.toast('행사 이름을 넣어 주세요', 'bad'); $('title').focus(); return; }
    showStep(Math.min(5, step + 1));
  };
  const keepDays = () => [10, 30, 60, 90].includes(+state.config.keep_days) ? +state.config.keep_days : 10;
  function renderSummary() {
    const c = state.config, items = [
      ['행사', c.title || '(없음)'], ['명단', state.roster.length ? state.roster.length + '명' + (walkin() ? ' + 명단에 없는 사람도 받기' : '') : (walkin() ? '명단 없이 오는 대로 받기' : '0명')],
      ['출석 방식', [c.attend.one_phone ? '한 휴대폰 한 사람' : '휴대폰 제한 없음', c.attend.rotate_qr ? '30초마다 바뀌는 QR' : '', c.screen.checkout === 'on' ? '퇴실 체크' : ''].filter(Boolean).join(' · ')],
      ['테마', (A.THEMES[c.screen.theme] || {}).label],
      ['증서', c.cert.enabled ? `${c.cert.title} · ${c.cert.only_attendees === 'pass' ? '이수한 사람만' : c.cert.only_attendees === 'inout' ? '입실·퇴실 모두 한 사람만' : c.cert.only_attendees ? '출석한 사람만' : '누구나'}` : '쓰지 않음']
    ];
    const extra = [c.pass.on ? `이수 ${c.pass.min_pct === '100' ? '모두 출석' : c.pass.min_pct + '% 이상'}${c.pass.late ? ' · 지각 ' + c.pass.late : ''}` : '', c.survey.on ? `만족도 ${c.survey.questions.length}문항${c.survey.anon ? '(익명)' : ''}` : '', c.lottery ? '경품 추첨' : ''].filter(Boolean);
    if (extra.length) items.push(['더 쓰는 기능', extra.join(' · ')]);
    items.push(['기록 보관', keepDays() + '일']);
    if (EDIT && expiresAt) items.push(['자동 삭제 예정', new Date(expiresAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }) + ` (출석·새 회차·저장할 때마다 ${keepDays()}일 뒤로 늦춰져요)`]);
    const html = items.map(([k, v]) => `<li>${k}: <b>${A.esc(v)}</b></li>`).join('') + problems().map(([n, m]) => `<li style="color:var(--bad)">${n}단계: ${A.esc(m)}</li>`).join('');
    $('summary').innerHTML = html; $('summary2').innerHTML = html;
  }

  /* ---------- 2. 명단 ---------- */
  let sheet = null;  // {headers, data}
  const KEYS = {
    no: /^(연\s*번|번\s*호|순\s*번|순|no\.?)$/i, name: /^(성\s*명|이\s*름|성함|name)$/i,
    dept: /(부서|소속|기관|과\s*명|팀명|department)/i, rank: /(직위|직급|직렬|직책|rank|title)/i,
    phone: /(전화|휴대|연락처|핸드폰|폰|phone|mobile|tel)/i
  };
  function readRows(rows) {
    rows = rows.map(r => (r || []).map(c => String(c ?? '').trim()));
    let h = rows.slice(0, 15).findIndex(r => r.some(c => KEYS.name.test(c)));
    let headers, data;
    if (h >= 0) { headers = rows[h].map((c, i) => c || `${i + 1}열`); data = rows.slice(h + 1); }
    else { const w = Math.max(...rows.map(r => r.length)); headers = Array.from({ length: w }, (_, i) => `${i + 1}열`); data = rows; }
    data = data.filter(r => r.some(Boolean));
    sheet = { headers, data };
    state.history = detectHistory(headers, data);
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
    const gu = state.history ? state.history.guCol : -1;   // 지난 출석부를 올렸으면 '추가'(명단 밖) 사람은 명단에서 뺀다
    let list = sheet.data.filter(r => gu < 0 || String(r[gu] || '').trim() !== '추가').map(r => ({ no: parseInt(cell(r, 'no'), 10), dept: cell(r, 'dept'), rank: cell(r, 'rank'), name: cell(r, 'name'), phone: cell(r, 'phone') }))
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
  /* 지난 '전체 출석부' 엑셀이면: 회차 열("1회차 (2026-10-01)")과 칸("출석 09:58 / 퇴실 12:01")을 읽어 이어 붙일 기록을 만든다 */
  function detectHistory(headers, data) {
    const cols = headers.map((h, i) => { const m = String(h).match(/^(.+?)\s*\((\d{4})[-.]\s*(\d{1,2})[-.]\s*(\d{1,2})\.?\)$/); return m ? { i, label: m[1].trim(), date: `${m[2]}-${m[3].padStart(2, '0')}-${m[4].padStart(2, '0')}` } : null; }).filter(Boolean);
    const ni = headers.findIndex(h => KEYS.name.test(h)), di = headers.findIndex(h => KEYS.dept.test(h)), gi = headers.findIndex(h => String(h).trim() === '구분');
    if (!cols.length || ni < 0 || !headers.some(h => String(h).trim() === '출석 횟수')) return null;
    const tm = (date, hm) => hm ? `${date}T${hm.padStart(5, '0')}:00+09:00` : null;
    let rows = 0;
    const sessions = cols.map(c => {
      const list = [];
      data.forEach(r => {
        const name = String(r[ni] || '').trim(), v = String(r[c.i] || '').trim(); if (!name || !v) return;
        const a = v.match(/출석\s*(\d{1,2}:\d{2})/), o = v.match(/퇴실(?:만)?\s*(\d{1,2}:\d{2})/);
        if (!a && !o) return;
        list.push({ dept: di >= 0 ? String(r[di] || '').trim() : '', name, at: a ? tm(c.date, a[1]) : null, out_at: o ? tm(c.date, o[1]) : null });
      });
      rows += list.length;
      const first = list.map(x => x.at || x.out_at).filter(Boolean).sort()[0];
      return { label: c.label, started_at: first || `${c.date}T09:00:00+09:00`, rows: list };
    });
    return { sessions, rows, guCol: gi };
  }
  async function importHistory(id, tk) {
    if (!state.history || !$('histChk') || !$('histChk').checked) return;
    try {
      const r = await A.rpc('import_history', { p_id: id, p_token: tk, p_sessions: state.history.sessions });
      A.toast(r.sessions ? `지난 회차 ${r.sessions}개(출석 ${r.rows}건)를 이어 붙였어요` : '이미 이어 붙인 기록이라 건너뛰었어요', 'ok');
      state.history = null;
    } catch (e) { A.toast(A.noFn(e) ? '지난 기록을 이어 붙이려면 저장소 업데이트(update.sql)가 먼저 필요해요' : '지난 기록을 이어 붙이지 못했어요: ' + e.message, 'bad'); }
  }
  function renderRoster(skipped = 0) {
    const r = state.roster;
    const names = {}; r.forEach(p => names[p.name] = (names[p.name] || 0) + 1);
    const dup = Object.keys(names).filter(n => names[n] > 1);
    $('rosterInfo').innerHTML = r.length ? `<div class="ok-box"><b>${r.length}명</b>을 읽었어요.${skipped && !state.history ? ` 이름이 빈 줄 ${skipped}개는 뺐어요.` : ''}
      ${dup.length ? `<br>동명이인: ${dup.map(A.esc).join(', ')} — 휴대폰에서 부서와 함께 보여서 구분돼요.` : ''}</div>` : '';
    const ph = r.some(p => p.phone), nPh = r.filter(p => p.phone).length;
    if (r.length && ph) $('rosterInfo').firstElementChild.insertAdjacentHTML('beforeend', `<br>연락처 ${nPh}명 — 관리 링크로 연 화면(미참석자 확인)에서만 보이고, 참석자 휴대폰에는 나오지 않아요.`);
    if (r.length && state.history) $('rosterInfo').insertAdjacentHTML('beforeend', `<div class="ok-box hist-box"><label class="check"><input type="checkbox" id="histChk" checked> <b>지난 출석 기록도 이어 붙이기</b></label>
      <p class="hint" style="margin:4px 0 0">받아 두었던 '전체 출석부' 파일이에요. 지난 회차 ${state.history.sessions.length}개(출석 ${state.history.rows}건)를 ${EDIT ? '저장할' : '만들'} 때 함께 되살려요. 같은 회차를 두 번 올려도 한 번만 들어가요.</p></div>`);
    $('rosterTable').innerHTML = r.length ? `<thead><tr><th>연번</th><th>부서명</th><th>직위(직급)</th><th>성명</th>${ph ? '<th>연락처</th>' : ''}</tr></thead><tbody>` +
      r.map(p => `<tr><td>${p.no}</td><td>${A.esc(p.dept)}</td><td>${A.esc(p.rank)}</td><td>${A.esc(p.name)}</td>${ph ? `<td>${A.esc(p.phone || '')}</td>` : ''}</tr>`).join('') + '</tbody>' : '';
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
  const tsvg = (bg, inner) => `<div class="tthumb" style="background:${bg}"><svg viewBox="0 0 60 36" width="78">${inner}</svg></div>`;
  const cells = (cols, rows, w, h, x0, y0, gx, gy, f) => Array.from({ length: cols * rows }, (_, i) => f(x0 + (i % cols) * (w + gx), y0 + Math.floor(i / cols) * (h + gy), i)).join('');
  Object.assign(THUMB, {
    lantern: () => tsvg('linear-gradient(#060a1c,#3a2a58 80%,#70405a)', cells(4, 2, 9, 11, 6, 4, 4, 5, (x, y, i) => `<rect x="${x}" y="${y}" width="9" height="11" rx="4" fill="${[0, 2, 3, 5, 6].includes(i) ? '#ffc35c' : 'rgba(255,255,255,.12)'}"/>`) + '<path d="M0 36V31l8-4 9 3 10-5 10 5 9-3 14 4v5z" fill="#0a0d1e"/>'),
    forest: () => tsvg('linear-gradient(#dff3ff,#d9f0c4)', '<circle cx="52" cy="7" r="4" fill="#ffd95a"/>' + cells(4, 1, 10, 0, 5, 0, 4, 0, (x, y, i) => `<rect x="${x + 4}" y="20" width="2" height="9" fill="#8a5a34"/><circle cx="${x + 5}" cy="${i === 3 ? 26 : 16}" r="${i === 3 ? 2 : 6}" fill="${['#3f9a4b', '#6aa84f', '#2f8a56', '#9ccc65'][i]}"/>`) + '<rect y="29" width="60" height="7" fill="#aad992"/>'),
    chalk: () => tsvg('#27503f', '<rect x="1" y="1" width="58" height="34" fill="none" stroke="#8a5a2b" stroke-width="2"/>' + cells(3, 2, 14, 8, 6, 6, 3, 4, (x, y, i) => i < 4 ? `<path d="M${x + 2} ${y + 4}h10" stroke="${['#fff', '#ffe98a', '#ffc2d1', '#bfe9ff'][i]}" stroke-width="2.4" stroke-linecap="round"/>` : `<rect x="${x}" y="${y}" width="14" height="8" rx="1.5" fill="none" stroke="rgba(255,255,255,.3)" stroke-dasharray="2 1.5" stroke-width=".6"/>`)),
    memo: () => tsvg('#c99b62', cells(4, 2, 10, 10, 6, 5, 3, 4, (x, y, i) => i < 6 ? `<rect x="${x}" y="${y}" width="10" height="10" fill="${['#fff3a3', '#ffd1dc', '#c8ecff', '#d4f5c4', '#ffe0b5', '#fff3a3'][i]}" transform="rotate(${[-4, 3, -2, 5, -3, 2][i]} ${x + 5} ${y + 5})"/><circle cx="${x + 5}" cy="${y + 1.5}" r="1" fill="#d62828"/>` : '')),
    led: () => tsvg('#07090d', '<rect x="3" y="3" width="54" height="4" fill="none" stroke="#2a2e38" stroke-width=".5"/><circle cx="53" cy="5" r="1" fill="#ff4d4d"/>' + cells(3, 2, 15, 9, 4, 10, 3, 3, (x, y, i) => `<rect x="${x}" y="${y}" width="15" height="9" rx="1" fill="#0c0f15" stroke="${i < 4 ? ['#ffb000', '#39ff88', '#4fd8ff', '#ff6b6b'][i] : '#1e222b'}" stroke-width=".7"/>${i < 4 ? `<path d="M${x + 3} ${y + 4.5}h9" stroke="${['#ffb000', '#39ff88', '#4fd8ff', '#ff6b6b'][i]}" stroke-width="2"/>` : ''}`)),
    train: () => tsvg('linear-gradient(#bfe4ff,#f6fbff)', [[5, '#106A3A'], [20, '#9E1C84']].map(([y, c], r) => `<path d="M6 ${y}h42q6 0 6 6v6H6z" fill="#f7f9fc" stroke="#c9d3e0" stroke-width=".5"/><rect x="6" y="${y + 9}" width="48" height="1.6" fill="${c}"/>${[0, 1, 2, 3].map(k => `<rect x="${9 + k * 10}" y="${y + 2}" width="8" height="6" rx="1" fill="${(r * 4 + k) % 3 ? '#ffe58a' : '#7fa5c7'}"/>`).join('')}<circle cx="14" cy="${y + 13}" r="1.6" fill="#2b3142"/><circle cx="46" cy="${y + 13}" r="1.6" fill="#2b3142"/>`).join('')),
    ocean: () => tsvg('linear-gradient(#0a6fa8,#042848)', [[12, 9, '#ff8a5c'], [36, 14, '#ffd166'], [18, 24, '#5ee0c8'], [44, 26, '#b79cff']].map(([x, y, c]) => `<path d="M${x - 9} ${y - 3}l4 3-4 3z" fill="${c}"/><ellipse cx="${x}" cy="${y}" rx="7" ry="4" fill="${c}"/><circle cx="${x + 4}" cy="${y - 1}" r=".8" fill="#12233f"/>`).join('') + '<circle cx="28" cy="6" r="1.5" fill="none" stroke="#fff" stroke-width=".4"/><circle cx="52" cy="10" r="1" fill="none" stroke="#fff" stroke-width=".4"/><rect y="33" width="60" height="3" fill="#d9c188"/>'),
    plaque: () => tsvg('radial-gradient(ellipse at 50% 0,#2b3566,#0b0e1f)', '<rect x="1.5" y="1.5" width="57" height="33" fill="none" stroke="#caa24a" stroke-width=".8"/>' + cells(3, 3, 15, 6, 5, 7, 3, 3, (x, y, i) => `<rect x="${x}" y="${y}" width="15" height="6" rx=".8" fill="${i < 5 ? '#e0bb5b' : 'rgba(227,192,106,.08)'}" stroke="#caa24a" stroke-width=".4"/>`))
  });
  function renderThemes() {
    $('themes').innerHTML = Object.entries(A.THEMES).map(([k, t]) => `<label class="theme"><input type="radio" name="theme" data-k="screen.theme" value="${k}">${(THUMB[k] || THUMB.card)(t.bg, t.accent)}<b>${t.label}</b><span>${t.desc}</span></label>`).join('');
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
  /* ---------- 4. 이수 기준 · 만족도 조사 ---------- */
  function syncOptUi() {
    $('passBox').hidden = !state.config.pass.on;
    const on = !!state.config.survey.on; $('surveyBox').hidden = !on;
    if (on && !(state.config.survey.questions || []).length) { state.config.survey.questions = A.DEFAULT_SURVEY.map(q => ({ ...q })); }
    if (on) renderQs();
  }
  const QT = { star: '별점 (1~5)', one: '하나 고르기', multi: '여러 개 고르기', text: '짧은 글' };
  function renderQs() {
    const qs = state.config.survey.questions;
    $('qList').innerHTML = qs.map((q, i) => `<div class="q-item" data-i="${i}">
      <div class="q-row"><b>${i + 1}</b><input type="text" data-q="q" value="${A.esc(q.q || '')}" maxlength="80" placeholder="질문을 써 주세요" aria-label="${i + 1}번 질문">
        <select data-q="type" aria-label="답 종류">${Object.entries(QT).map(([k, v]) => `<option value="${k}" ${q.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      ${q.type === 'one' || q.type === 'multi' ? `<textarea data-q="options" rows="2" placeholder="보기를 한 줄에 하나씩 (최대 8개)" aria-label="보기">${A.esc((q.options || []).join('\n'))}</textarea>` : ''}
      <div class="q-row"><label class="check"><input type="checkbox" data-q="req" ${q.req ? 'checked' : ''}> 꼭 답하기</label>
        <button type="button" class="btn ghost q-del" data-qdel="${i}" ${qs.length <= 1 ? 'disabled' : ''}>빼기</button></div></div>`).join('');
  }
  const newQid = () => 'q' + Date.now().toString(36).slice(-5) + Math.floor(Math.random() * 99);
  $('qList').addEventListener('input', e => {
    const box = e.target.closest('.q-item'); if (!box) return; e.stopPropagation();
    const q = state.config.survey.questions[+box.dataset.i], k = e.target.dataset.q;
    if (k === 'q') q.q = e.target.value.slice(0, 80);
    if (k === 'options') q.options = [...new Set(e.target.value.split(/\r?\n/).map(x => x.trim().slice(0, 40)).filter(Boolean))].slice(0, 8);
    if (k === 'req') q.req = e.target.checked;
    touch('survey.questions');
  });
  $('qList').addEventListener('change', e => {
    const box = e.target.closest('.q-item'); if (!box) return; e.stopPropagation();
    const q = state.config.survey.questions[+box.dataset.i];
    if (e.target.dataset.q === 'type') { q.type = e.target.value; if ((q.type === 'one' || q.type === 'multi') && !(q.options || []).length) q.options = ['매우 그렇다', '그렇다', '보통', '아니다']; renderQs(); }
    if (e.target.dataset.q === 'req') q.req = e.target.checked;
    touch('survey.questions');
  });
  $('qList').addEventListener('click', e => { const b = e.target.closest('[data-qdel]'); if (!b) return; state.config.survey.questions.splice(+b.dataset.qdel, 1); renderQs(); touch('survey.questions'); });
  $('qAdd').onclick = () => { const qs = state.config.survey.questions; if (qs.length >= 10) { A.toast('문항은 10개까지예요', 'bad'); return; } qs.push({ id: newQid(), type: 'star', q: '', req: false }); renderQs(); touch('survey.questions'); $('qList').lastElementChild.querySelector('input').focus(); };
  $('qReset').onclick = async () => { if (await A.dialog({ title: '기본 문항으로', message: '지금 문항을 지우고 기본 문항 5개로 바꿀까요?', ok: '바꾸기' })) { state.config.survey.questions = A.DEFAULT_SURVEY.map(q => ({ ...q })); renderQs(); touch('survey.questions'); } };
  // 지난 행사 문항 불러오기: 이 브라우저에서 만든 행사 목록에서
  function fillQFrom() { $('qFrom').innerHTML = '<option value="">지난 행사 문항 불러오기…</option>' + A.myEvents().filter(x => x.id !== eventId).map(x => `<option value="${x.id}">${A.esc(x.title || '(이름 없음)')}</option>`).join(''); }
  $('qFrom').addEventListener('change', async e => {
    e.stopPropagation(); const id = e.target.value; if (!id) return;
    try {
      const ev = await A.rpc('get_event', { p_id: id }); const qs = ev && ev.config && ev.config.survey && ev.config.survey.questions;
      if (!qs || !qs.length) { A.toast('그 행사에는 만족도 문항이 없어요', 'bad'); }
      else { state.config.survey.questions = qs.slice(0, 10).map(q => ({ ...q })); renderQs(); touch('survey.questions'); A.toast(`문항 ${qs.length}개를 불러왔어요`, 'ok'); }
    } catch (er) { A.toast('불러오지 못했어요 (지워진 행사일 수 있어요)', 'bad'); }
    e.target.value = '';
  });
  function surveyProblem() {
    const sv = state.config.survey; if (!sv.on) return null;
    if (!sv.questions.length) return '만족도 문항이 없어요';
    if (sv.questions.some(q => !String(q.q || '').trim())) return '비어 있는 만족도 질문이 있어요';
    if (sv.questions.some(q => (q.type === 'one' || q.type === 'multi') && (q.options || []).length < 2)) return '고르기 문항은 보기가 2개 이상 있어야 해요';
    return null;
  }

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
    x.fillText(state.roster.length ? '휴대폰 카메라로 찍고 → 내 이름을 고르고 → 제출' : '휴대폰 카메라로 찍고 → 부서·이름을 쓰고 → 제출', W / 2, 1490);
    x.globalAlpha = .6; x.font = `500 30px ${FB}`; x.fillText(cf.org || '', W / 2, 1650);
    return c.toDataURL('image/png');
  }
  function linkCards(id, tk) {
    const L = A.links(id, tk), cf = state.config;
    const qr = A.qrCanvas(L.join, 360, 2).toDataURL('image/png');
    const card = (cls, title, desc, url, extra = '') => `<div class="link-card ${cls}">${extra}<div style="min-width:0;flex:1"><h3>${title}</h3><p class="hint" style="margin:0">${desc}</p><div class="url">${A.esc(url)}</div>
      <div class="row-btns" style="margin:0"><a class="btn ghost" href="${url}" target="_blank" rel="noopener">열기</a><button type="button" class="btn ghost" data-copy="${A.esc(url)}">복사</button></div></div></div>`;
    const rot = !!(cf.attend && cf.attend.rotate_qr);
    return card('', '① 강의실 화면 (담당자용)', '이 링크로 열어야 엑셀·새 회차·출석 취소 버튼이 보여요. 주소창의 열쇠 부분은 열면 자동으로 숨겨져요.', L.screenAdmin)
      + (rot ? `<div class="link-card"><div style="min-width:0;flex:1"><h3>② 참석자 QR</h3><p class="hint" style="margin:0"><b>30초마다 바뀌는 QR</b>을 켠 행사예요. QR은 ①번 강의실 화면(담당자용)에만 나오고, A4 안내문이나 링크로는 출석할 수 없어요.</p></div></div>` : '')
      + (rot ? '' : `<div class="link-card"><img class="qr" src="${qr}" alt="참석자 QR"><div style="min-width:0;flex:1"><h3>② 참석자 QR</h3><p class="hint" style="margin:0">강의실 화면에도 나오고, A4 안내문으로 뽑아 붙일 수도 있어요.</p><div class="url">${A.esc(L.join)}</div>
        <div class="row-btns" style="margin:0"><button type="button" class="btn ghost" id="dlPoster">A4 QR 안내문</button><button type="button" class="btn ghost" id="dlQr">QR만</button><button type="button" class="btn ghost" data-copy="${A.esc(L.join)}">링크 복사</button></div></div></div>`)
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
      await importHistory(r.id, r.token);
      changed = false;
      showDone(r.id, r.token);
    } catch (e) { $('createErr').textContent = e.message; btn.disabled = false; btn.textContent = created ? '이미지 다시 올리기' : '행사 만들기'; }
  };
  function showDone(id, tk) {
    $('createBox').hidden = true; $('navBtns').hidden = true; document.querySelector('.steps').hidden = true;
    const d = $('doneBox'); d.hidden = false;
    d.innerHTML = `<div class="done-hero"><div class="big-check">✓</div><h2>행사를 만들었어요</h2><p class="hint">아래 링크로 바로 시작하세요. 명단과 출석 기록은 마지막으로 쓴 날부터 <b>${keepDays()}일 뒤 자동으로 지워져요</b>. 출석부 엑셀은 미리 받아 두세요.</p></div>` + linkCards(id, tk)
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
      await importHistory(eventId, token);
      A.rememberEvent({ id: eventId, token, title: state.config.title });
      A.toast('저장했어요. 열려 있는 강의실 화면에도 곧 반영돼요.', 'ok');
    } catch (e) { A.toast(e.message, 'bad'); }
    btns.forEach(b => { b.disabled = false; });
  }
  $('saveBtn').onclick = save; $('saveTop').onclick = save;
  $('extendBtn').onclick = async () => {
    try { const r = await A.rpc('extend_keep', { p_id: eventId, p_token: token }); expiresAt = r.expires_at; renderSummary(); A.toast('보관 기간을 30일 늘렸어요 (오늘부터 최대 120일)', 'ok'); }
    catch (e) { A.toast(A.noFn(e) ? '보관 연장은 저장소 업데이트(update.sql) 뒤에 쓸 수 있어요' : e.message, 'bad'); }
  };
  $('delBtn').onclick = async () => {
    const ok = await A.dialog({ title: '행사 삭제', message: `"${state.config.title}" 행사와 모든 출석 기록을 지웁니다.\n되돌릴 수 없어요.`, ok: '삭제', danger: true });
    if (!ok) return;
    try { await A.rpc('delete_event', { p_id: eventId, p_token: token }); A.forgetEvent(eventId); changed = false; location.href = 'index.html'; }
    catch (e) { A.toast(e.message, 'bad'); }
  };
  addEventListener('beforeunload', e => { if (changed && (EDIT || state.roster.length || state.config.title)) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- 시작 ---------- */
  function initUi() {
    renderThemes(); renderFields(); bindAll(); renderThumbs(); syncCertUi(); syncOptUi(); fillQFrom(); checkContrast(); renderRoster(); markSteps();
    showStep(1); sendPreview(); certPreview();
  }
  (async function start() {
    if (!A.ready) { document.querySelector('.layout').innerHTML = '<div class="card">저장소(Supabase) 설정이 아직 없어요. config.js를 먼저 채워 주세요. (README 참고)</div>'; return; }
    if (!EDIT) {
      state.config.attend.one_phone = true;   // 새 행사는 '한 휴대폰 한 사람'을 켠 채로 시작 (예전 행사는 그대로)
      state.config.cert.issuer = ''; initUi(); changed = false; return;
    }
    token = A.takeToken(eventId);
    $('modeLabel').textContent = '행사 고치기'; $('pageTitle').textContent = '불러오는 중…';
    $('saveTop').hidden = false; $('createBox').hidden = true; $('editBox').hidden = false;
    $('stepFinish').querySelector('span').textContent = '저장·관리'; $('firstSessionBox').hidden = true;
    try {
      const ev = await A.rpc('get_event', { p_id: eventId });
      if (!ev) throw new Error('행사를 찾을 수 없어요 (보관 기간이 지나 자동으로 지워졌을 수 있어요)');
      if (!token || !await A.rpc('check_admin', { p_id: eventId, p_token: token })) throw new Error('관리 링크로 열어야 고칠 수 있어요. 처음 만들 때 받은 관리 링크를 써 주세요.');
      state.config = A.withDefaults(ev.config); state.roster = ev.roster || []; expiresAt = ev.expires_at;
      try { const ph = await A.rpc('get_phones', { p_id: eventId, p_token: token }) || {}; state.roster = state.roster.map(p => ({ ...p, phone: ph[p.no] || '' })); } catch (e) {}
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
