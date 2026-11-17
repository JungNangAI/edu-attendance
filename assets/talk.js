/* 강의실 화면의 '질문 받기'(참석자 → 강사)와 '질문 던지기'(강사 → 참석자, 워드클라우드).
   screen.js가 Talk.init(ctx)로 연결하고, 화면 모드가 바뀔 때 Talk.onMode(mode, pollId)를 부른다. */
(function () {
  'use strict';
  const A = window.App;
  const $ = id => document.getElementById(id);
  let C = null;                 // { eventId, token(), isAdmin(), cfg(), setMode(m), toast }
  let mode = 'in', pollId = null, timer = 0, lastSig = '', spot = null, seenQ = new Set(), firstLoad = true;
  const COLORS = ['#e03131', '#1c7ed6', '#f08c00', '#2f9e44', '#ae3ec9', '#e64980', '#0c8599', '#5c940d', '#d6336c', '#1971c2', '#e8590c', '#7048e8'];

  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function rpc(fn, args) { return A.rpc(fn, args); }
  const adm = () => C && C.isAdmin();

  function host() {
    let t = $('talk');
    if (!t) { t = el('section', 'talk'); t.id = 'talk'; t.hidden = true; document.querySelector('.s-main').appendChild(t); }
    return t;
  }

  /* ---------- 모드 바꾸기 ---------- */
  function onMode(m, pid) {
    const was = mode, wasPoll = pollId;
    mode = m; pollId = pid || null;
    const on = m === 'qna' || m === 'poll';
    document.body.classList.toggle('mode-talk', on);
    const t = host(); t.hidden = !on;
    if (!on) { clearTimeout(timer); t.innerHTML = ''; lastSig = ''; closeSpot(); return; }
    if (was !== m || wasPoll !== pollId) { lastSig = ''; t.innerHTML = ''; closeSpot(); firstLoad = true; build(); }
    clearTimeout(timer); tick();
  }
  function build() {
    const t = host();
    if (mode === 'qna') {
      t.innerHTML = `<div class="tk-head"><h2>💬 궁금한 점을 보내 주세요</h2><span class="tk-n" id="tkN"></span>${adm() ? `<div class="tk-btns"><button type="button" id="tkBack">출석 받기로 돌아가기</button></div>` : ''}</div>
        ${adm() ? '<div class="tk-wait" id="tkWait" hidden></div>' : ''}<div class="tk-qs" id="tkQs"></div>`;
    } else {
      t.innerHTML = `<div class="tk-head"><h2 id="tkQ"></h2><span class="tk-n" id="tkN"></span>${adm() ? `<div class="tk-btns"><button type="button" id="tkOpen"></button><button type="button" id="tkNew">새 질문</button><button type="button" id="tkPng">그림으로 저장</button><button type="button" id="tkBack">출석 받기로 돌아가기</button></div>` : ''}</div>
        <div class="tk-cloud" id="tkCloud"><canvas id="tkCv"></canvas><p class="tk-empty" id="tkEmpty">휴대폰으로 답을 보내면 여기에 낱말이 쌓여요</p></div>
        ${adm() ? '<div class="tk-hidden" id="tkHidden" hidden></div><p class="tk-tip">낱말을 누르면 숨길 수 있어요</p>' : ''}`;
    }
    if ($('tkBack')) $('tkBack').onclick = () => C.setMode('in');
    if ($('tkNew')) $('tkNew').onclick = () => startPoll();
    if ($('tkPng')) $('tkPng').onclick = savePng;
    if ($('tkOpen')) $('tkOpen').onclick = toggleOpen;
  }
  async function tick() {
    clearTimeout(timer);
    try { if (mode === 'qna') await loadQs(); else if (mode === 'poll') await loadPoll(); }
    catch (e) { /* 다음 번에 다시 */ }
    if (mode === 'qna' || mode === 'poll') timer = setTimeout(tick, document.hidden ? 15000 : mode === 'poll' ? 2500 : 3000);
  }

  /* ---------- 질문 받기 ---------- */
  async function loadQs() {
    const r = await rpc('get_questions', { p_id: C.eventId, p_device: null, p_token: adm() ? C.token() : null });
    if (!r) return;
    const sig = JSON.stringify(r.list.map(q => [q.id, q.likes, q.status]));
    if (sig === lastSig) return; lastSig = sig;
    const shown = r.list.filter(q => q.status === 'show' || q.status === 'done'), wait = r.list.filter(q => q.status === 'wait');
    const fresh = shown.filter(q => !seenQ.has(q.id)); shown.forEach(q => seenQ.add(q.id));
    $('tkN').textContent = `질문 ${shown.length}개`;
    const box = $('tkQs');
    box.innerHTML = shown.length ? shown.map(q => card(q)).join('') : '<p class="tk-empty on">아직 질문이 없어요. QR을 찍고 보내 주세요!</p>';
    if (!firstLoad) fresh.forEach(q => { const c = box.querySelector(`[data-q="${q.id}"]`); if (c) c.classList.add('new'); });
    if (!firstLoad && fresh.length) { try { Sound.sfx('land'); } catch (e) {} }
    firstLoad = false;
    if (adm()) {
      const w = $('tkWait'); w.hidden = !wait.length;
      w.innerHTML = wait.length ? `<b>띄우기 전 ${wait.length}개</b>` + wait.map(q => `<div class="tk-w"><span>${A.esc(q.body)}</span><button type="button" data-act="show" data-id="${q.id}">띄우기</button><button type="button" data-act="hide" data-id="${q.id}">숨기기</button></div>`).join('') : '';
    }
    if (spot) { const q = r.list.find(x => x.id === spot); if (q) openSpot(q); }
  }
  function card(q) {
    const who = q.who ? `${A.esc(q.who.dept || '')} ${A.esc(q.who.name || '')}` : '익명';
    return `<article class="tk-card${q.status === 'done' ? ' done' : ''}" data-q="${q.id}">
      <p>${A.esc(q.body)}</p><footer><span class="tk-who">${who}</span><span class="tk-like">👍 ${q.likes}</span>${q.status === 'done' ? '<span class="tk-done">답변 완료</span>' : ''}</footer>
      ${adm() ? `<div class="tk-act"><button type="button" data-act="spot" data-id="${q.id}">크게</button><button type="button" data-act="${q.status === 'done' ? 'show' : 'done'}" data-id="${q.id}">${q.status === 'done' ? '답변 전으로' : '답변 완료'}</button><button type="button" data-act="hide" data-id="${q.id}">숨기기</button></div>` : ''}</article>`;
  }
  async function act(id, what) {
    if (what === 'spot') { const q = await findQ(id); if (q) openSpot(q); return; }
    try { await rpc('set_question', { p_id: C.eventId, p_token: C.token(), p_qid: id, p_status: what }); lastSig = ''; if (what !== 'show' && spot === id) closeSpot(); tick(); }
    catch (e) { C.toast(e.message, 'bad'); }
  }
  async function findQ(id) {
    const r = await rpc('get_questions', { p_id: C.eventId, p_device: null, p_token: C.token() });
    return r && r.list.find(q => q.id === id);
  }
  function openSpot(q) {
    spot = q.id;
    let s = $('tkSpot');
    if (!s) { s = el('div', 'tk-spot'); s.id = 'tkSpot'; document.body.appendChild(s); s.addEventListener('click', e => { if (e.target === s || e.target.closest('[data-x]')) closeSpot(); const b = e.target.closest('[data-act]'); if (b) act(+b.dataset.id, b.dataset.act); }); }
    const who = q.who ? `${A.esc(q.who.dept || '')} ${A.esc(q.who.name || '')}` : '익명';
    s.innerHTML = `<div class="tk-spot-box"><span class="tk-spot-chip">질문</span><p>${A.esc(q.body)}</p><footer><span>${who}</span><span>👍 ${q.likes}</span></footer>
      ${adm() ? `<div class="tk-spot-btns"><button type="button" data-act="done" data-id="${q.id}">답변 완료</button><button type="button" data-x="1">닫기</button></div>` : ''}</div>`;
    s.hidden = false;
  }
  function closeSpot() { spot = null; const s = $('tkSpot'); if (s) s.hidden = true; }

  /* ---------- 질문 던지기(워드클라우드) ---------- */
  let poll = null, drawnSig = '', drawing = false;
  async function loadPoll() {
    const r = await rpc('get_poll', { p_id: C.eventId, p_poll: pollId, p_device: null });
    if (!r || !r.poll) { $('tkQ') && ($('tkQ').textContent = '질문을 준비하고 있어요'); return; }
    poll = r.poll;
    $('tkQ').textContent = poll.q;
    $('tkN').textContent = `응답 ${poll.n}명 · ${poll.open ? '답 받는 중' : '마감'}`;
    if ($('tkOpen')) $('tkOpen').textContent = poll.open ? '답 그만 받기' : '다시 받기';
    if ($('tkHidden')) {
      $('tkHidden').hidden = !poll.hidden.length;
      $('tkHidden').innerHTML = poll.hidden.length ? '숨긴 낱말: ' + poll.hidden.map(w => `<button type="button" data-unhide="${A.esc(w)}">${A.esc(w)} ✕</button>`).join('') : '';
    }
    const sig = JSON.stringify(poll.words);
    if (sig !== drawnSig) { drawnSig = sig; draw(poll.words); }
  }
  const FONT = '"Black Han Sans","IBM Plex Sans KR",sans-serif';
  async function draw(words) {
    const box = $('tkCloud'), cv = $('tkCv'); if (!box || !cv) return;
    // 웹 글꼴은 글자 묶음별로 늦게 받아지므로, 그리기 전에 이 낱말들의 글자를 먼저 받아 둔다(안 하면 글자가 섞여 겹침)
    try { await document.fonts.load('400 48px "Black Han Sans"', words.map(w => w[0]).join('') || '가'); } catch (e) {}
    $('tkEmpty').hidden = !!words.length;
    const W = box.clientWidth, H = box.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px';
    if (!words.length || !window.WordCloud) { cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); return; }
    const max = words[0][1], n = words.length;
    // 가장 많이 나온 낱말이 화면 높이의 약 1/4~1/6, 나머지는 제곱근 비율로 줄인다
    const top = Math.min(H * dpr * (n < 6 ? 0.32 : n < 20 ? 0.26 : n < 50 ? 0.22 : 0.18), W * dpr / Math.max(2, words[0][0].length) * 0.85);
    const minS = Math.max(16 * dpr, top * 0.24);
    const size = c => minS + (top - minS) * Math.sqrt((c - 1) / Math.max(1, max - 1 || 1)) * (max > 1 ? 1 : 0.6);
    const colorOf = w => { let h = 0; for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
    drawing = true;
    WordCloud(cv, {
      list: words.map(([w, c]) => [w, c]), gridSize: Math.round(5 * dpr), weightFactor: c => size(c),
      fontFamily: FONT, fontWeight: '400',
      color: w => colorOf(w), backgroundColor: 'rgba(0,0,0,0)', rotateRatio: 0.28, rotationSteps: 2, minRotation: -Math.PI / 2, maxRotation: 0,
      shuffle: false, shrinkToFit: true, drawOutOfBound: false, origin: [cv.width / 2, cv.height / 2], ellipticity: 0.62,
      click: adm() ? item => hideWord(item[0]) : undefined, hover: adm() ? (item) => { cv.style.cursor = item ? 'pointer' : ''; } : undefined
    });
    cv.addEventListener('wordcloudstop', () => { drawing = false; }, { once: true });
  }
  async function hideWord(w) {
    if (!poll) return;
    const ok = await A.dialog({ title: '낱말 숨기기', message: `'${w}'을(를) 화면에서 숨길까요?\n(답은 지우지 않아요. 아래 '숨긴 낱말'에서 되살릴 수 있어요)`, ok: '숨기기' });
    if (!ok) return;
    try { await rpc('hide_word', { p_id: C.eventId, p_token: C.token(), p_poll: poll.id, p_word: w, p_hide: true }); drawnSig = ''; tick(); }
    catch (e) { C.toast(e.message, 'bad'); }
  }
  async function unhide(w) {
    try { await rpc('hide_word', { p_id: C.eventId, p_token: C.token(), p_poll: poll.id, p_word: w, p_hide: false }); drawnSig = ''; tick(); }
    catch (e) { C.toast(e.message, 'bad'); }
  }
  async function toggleOpen() {
    if (!poll) return;
    try { await rpc('open_poll', { p_id: C.eventId, p_token: C.token(), p_poll: poll.id, p_open: !poll.open }); C.toast(poll.open ? '답을 그만 받아요. 구름은 그대로 보여요' : '다시 답을 받아요', 'ok'); tick(); }
    catch (e) { C.toast(e.message, 'bad'); }
  }
  function savePng() {
    const cv = $('tkCv'); if (!cv || !poll) return;
    const pad = 40 * (cv.width / cv.clientWidth || 1), out = document.createElement('canvas');
    const titleH = Math.round(cv.height * 0.12);
    out.width = cv.width + pad * 2; out.height = cv.height + titleH + pad * 2;
    const g = out.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, out.width, out.height);
    g.fillStyle = '#1b2133'; g.font = `700 ${Math.round(titleH * 0.45)}px "IBM Plex Sans KR",sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(poll.q, out.width / 2, pad + titleH / 2, out.width - pad * 2);
    g.drawImage(cv, pad, pad + titleH);
    g.fillStyle = '#868e96'; g.font = `500 ${Math.round(titleH * 0.2)}px "IBM Plex Sans KR",sans-serif`; g.textAlign = 'right';
    g.fillText(`응답 ${poll.n}명 · ${A.ymd(new Date().toISOString())}`, out.width - pad, out.height - pad / 2);
    const a = document.createElement('a'); a.href = out.toDataURL('image/png');
    a.download = `워드클라우드_${(poll.q || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 30)}.png`; a.click();
  }
  // 질문 던지기 시작: 미리 써 둔 질문을 고르거나 새로 쓰기
  function startPoll() {
    const prep = String((C.cfg().poll || {}).prepared || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, 20);
    return new Promise(resolve => {
      const wrap = el('div', 'app-modal');
      wrap.innerHTML = `<div class="app-modal-box tk-start" role="dialog" aria-modal="true" aria-labelledby="tkst"><h2 id="tkst">☁️ 질문 던지기</h2>
        <p>참석자 휴대폰에 질문이 뜨고, 답한 낱말이 화면에 구름처럼 쌓여요.</p>
        ${prep.length ? `<div class="tk-prep">${prep.map(q => `<button type="button" data-p="${A.esc(q)}">${A.esc(q)}</button>`).join('')}</div>` : ''}
        <input type="text" class="app-modal-input" id="tkInp" maxlength="120" placeholder="예: AI 하면 떠오르는 낱말은?">
        <div class="app-modal-btns"><button type="button" class="btn ghost" data-v="0">취소</button><button type="button" class="btn primary" data-v="1">던지기</button></div></div>`;
      document.body.appendChild(wrap);
      const inp = wrap.querySelector('input');
      const done = async v => {
        if (v) {
          const q = inp.value.trim(); if (!q) { inp.focus(); return; }
          try { const b = await rpc('start_poll', { p_id: C.eventId, p_token: C.token(), p_q: q }); C.onBoard(b); C.toast('질문을 던졌어요', 'ok'); }
          catch (e) { C.toast(C.noFnMsg(e, '질문 던지기'), 'bad'); return; }
        }
        wrap.classList.add('out'); setTimeout(() => wrap.remove(), 180); resolve(v);
      };
      wrap.addEventListener('click', e => { const p = e.target.closest('[data-p]'); if (p) { inp.value = p.dataset.p; inp.focus(); return; } const b = e.target.closest('[data-v]'); if (b) done(b.dataset.v === '1'); else if (e.target === wrap) done(false); });
      wrap.addEventListener('keydown', e => { if (e.key === 'Escape') done(false); if (e.key === 'Enter') done(true); });
      requestAnimationFrame(() => { wrap.classList.add('in'); inp.focus(); });
    });
  }

  /* ---------- 엑셀 시트 ---------- */
  async function sheets(sessions, people) {
    let d;
    try { d = await rpc('export_talk', { p_id: C.eventId, p_token: C.token() }); } catch (e) { return []; }
    if (!d) return [];
    const lab = new Map(sessions.map(s => [s.id, s.label])), byNo = new Map(people.map(p => [p.no, p]));
    const ST = { show: '화면에', done: '답변 완료', wait: '띄우기 전', hide: '숨김' };
    const out = [];
    if (d.questions.length) {
      const rows = [['회차', '보낸 시각', '부서명', '성명', '질문', '👍', '상태']];
      d.questions.forEach(q => { const p = q.no != null ? byNo.get(q.no) || {} : null; rows.push([lab.get(q.session_id) || '', A.hhmm(q.at), p ? p.dept || '' : '익명', p ? p.name || '' : '', q.body, q.likes, ST[q.status] || q.status]); });
      out.push({ name: '질문', rows, cols: [10, 9, 18, 10, 60, 5, 10] });
    }
    if (d.polls.length) {
      const sum = [['질문 던지기(워드클라우드) 결과'], []], raw = [['회차', '질문', '보낸 시각', '부서명', '성명', '낱말']];
      d.polls.forEach((p, i) => {
        sum.push([`${i + 1}. ${p.q}`, `${lab.get(p.session_id) || ''} · ${A.hhmm(p.at)} · 응답 ${p.summary.n}명${p.anon ? ' · 익명' : ''}`], ['', '낱말', '횟수']);
        p.summary.words.forEach(([w, c]) => sum.push(['', w + (p.summary.hidden.includes(w) ? ' (숨김)' : ''), c]));
        sum.push([]);
        p.answers.forEach(a => { const who = a.no != null ? byNo.get(a.no) || {} : null; raw.push([lab.get(p.session_id) || '', p.q, A.hhmm(a.at), who ? who.dept || '' : '익명', who ? who.name || '' : '', (a.words || []).join(', ')]); });
      });
      out.push({ name: '워드클라우드 요약', rows: sum, cols: [40, 24, 8] }, { name: '워드클라우드 응답', rows: raw, cols: [10, 36, 9, 18, 10, 30] });
    }
    return out;
  }

  function init(ctx) {
    C = ctx;
    document.addEventListener('click', e => {
      const b = e.target.closest('#talk [data-act], #tkWait [data-act]'); if (b && adm()) { act(+b.dataset.id, b.dataset.act); return; }
      const u = e.target.closest('[data-unhide]'); if (u && adm()) unhide(u.dataset.unhide);
    });
    let rt = 0; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (mode === 'poll' && poll) { drawnSig = ''; draw(poll.words); drawnSig = JSON.stringify(poll.words); } }, 250); });
  }
  window.Talk = { init, onMode, startPoll, sheets };
})();
