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
      t.innerHTML = `<div class="tk-head"><h2 id="tkQ"></h2><span class="tk-n" id="tkN"></span><div class="tk-btns">${adm() ? `<button type="button" id="tkReveal" hidden></button><button type="button" id="tkOpen"></button><button type="button" id="tkNew">새 질문</button>` : ''}<button type="button" id="tkView" class="tk-view" hidden></button>${adm() ? `<button type="button" id="tkPng">그림으로 저장</button><button type="button" id="tkBack">출석 받기로 돌아가기</button>` : ''}</div></div>
        <div class="tk-cloud" id="tkCloud"><canvas id="tkCv"></canvas><p class="tk-empty" id="tkEmpty">휴대폰으로 답을 보내면 여기에 낱말이 쌓여요</p></div>
        <div class="tk-bars" id="tkBars" hidden></div><div class="tk-texts" id="tkTexts" hidden></div>
        ${adm() ? '<div class="tk-hidden" id="tkHidden" hidden></div><p class="tk-tip" id="tkTip">낱말을 누르면 숨길 수 있어요</p>' : ''}`;
    }
    if ($('tkBack')) $('tkBack').onclick = () => C.setMode('in');
    if ($('tkNew')) $('tkNew').onclick = () => startPoll();
    if ($('tkPng')) $('tkPng').onclick = savePng;
    if ($('tkOpen')) $('tkOpen').onclick = toggleOpen;
    if ($('tkView')) $('tkView').onclick = () => { view = view === 'bars' ? 'cloud' : 'bars'; viewSet = true; drawnSig = ''; loadPoll(); };
    if ($('tkReveal')) $('tkReveal').onclick = toggleReveal;
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
  let poll = null, drawnSig = '', drawing = false, view = 'cloud', viewSet = false, viewFor = null;
  const kindOf = p => (p && p.kind) || 'word';
  const CIRC = '①②③④⑤⑥⑦⑧';
  async function loadPoll() {
    // 관리 화면은 정답까지 보려고 export 대신 open_poll 결과를 쓰지 않고, 정답은 reveal 버튼 상태로만 다룬다
    const r = await rpc('get_poll', { p_id: C.eventId, p_poll: pollId, p_device: null });
    if (!r || !r.poll) { $('tkQ') && ($('tkQ').textContent = '질문을 준비하고 있어요'); return; }
    poll = r.poll; const k = kindOf(poll);
    if (viewFor !== poll.id) { viewFor = poll.id; viewSet = false; }
    if (adm() && k === 'choice' && !(poll.id in answerMemo)) {   // 정답은 공개 전엔 안 오므로 관리 열쇠로 한 번 받아 둔다
      answerMemo[poll.id] = null;
      rpc('export_talk', { p_id: C.eventId, p_token: C.token() }).then(d => { const x = d && d.polls.find(q => q.summary && q.summary.id === poll.id); if (x) { answerMemo[poll.id] = x.summary.answer; drawnSig = ''; loadPoll(); } }).catch(() => {});
    }
    if (!viewSet) view = k === 'choice' ? 'bars' : k === 'text' ? 'texts' : 'cloud';
    $('tkQ').textContent = poll.q;
    $('tkN').textContent = `응답 ${poll.n}명 · ${poll.open ? '답 받는 중' : '마감'}`;
    if ($('tkOpen')) $('tkOpen').textContent = poll.open ? '답 그만 받기' : '다시 받기';
    const vb = $('tkView'); if (vb) { vb.hidden = k === 'text'; vb.textContent = view === 'bars' ? '☁️ 구름으로 보기' : '📊 막대로 보기'; }
    const rv = $('tkReveal'); if (rv) { rv.hidden = !(k === 'choice' && quizAns(poll) != null); rv.textContent = poll.reveal ? '정답 가리기' : '✅ 정답 공개'; }
    if ($('tkPng')) $('tkPng').hidden = view === 'texts';
    if ($('tkTip')) $('tkTip').textContent = k === 'text' ? '답을 누르면 숨길 수 있어요' : k === 'choice' ? '' : view === 'cloud' ? '낱말을 누르면 숨길 수 있어요' : '';
    if ($('tkHidden')) {
      $('tkHidden').hidden = !poll.hidden.length || k === 'choice';
      $('tkHidden').innerHTML = poll.hidden.length ? (k === 'text' ? '숨긴 답: ' : '숨긴 낱말: ') + poll.hidden.map(w => `<button type="button" data-unhide="${A.esc(w)}">${A.esc(w.length > 14 ? w.slice(0, 14) + '…' : w)} ✕</button>`).join('') : '';
    }
    $('tkCloud').hidden = view !== 'cloud'; $('tkBars').hidden = view !== 'bars'; $('tkTexts').hidden = view !== 'texts';
    const sig = JSON.stringify([view, poll.words, poll.counts, poll.texts, poll.reveal, poll.answer]);
    if (sig === drawnSig) return; drawnSig = sig;
    if (view === 'cloud') draw(poll.words); else if (view === 'bars') bars(); else texts();
  }
  // 관리 화면에서는 정답을 알아야 하므로, 던질 때 고른 정답을 기억해 둔다(공개 전엔 get_poll이 정답을 주지 않는다)
  const answerMemo = {};
  const quizAns = p => p.answer != null ? p.answer : answerMemo[p.id] != null ? answerMemo[p.id] : null;
  function barItems() {
    if (kindOf(poll) === 'choice') {
      const cs = poll.counts || [];
      return poll.choices.map((c, i) => ({ label: (CIRC[i] || (i + 1) + '.') + ' ' + c, c: cs[i] || 0, ok: poll.reveal && quizAns(poll) === i }));
    }
    return poll.words.slice(0, 12).map(([w, c]) => ({ label: w, c }));
  }
  function bars() {
    const box = $('tkBars'), items = barItems(), tot = poll.n || 0, max = Math.max(1, ...items.map(x => x.c));
    if (!items.length || !tot) { box.innerHTML = '<p class="tk-empty on">휴대폰으로 답을 보내면 여기에 막대가 올라가요</p>'; return; }
    const choice = kindOf(poll) === 'choice';
    box.innerHTML = items.map((x, i) => {
      const pct = tot ? Math.round(x.c * 100 / tot) : 0, w = Math.max(x.c ? 2 : 0, x.c * 100 / max);
      return `<div class="tk-bar${x.ok ? ' ok' : ''}${poll.reveal && choice && !x.ok ? ' dim' : ''}" style="--w:${w}%;--c:${COLORS[i % COLORS.length]}"><span class="tk-bl">${A.esc(x.label)}${x.ok ? ' <b>✓ 정답</b>' : ''}</span><span class="tk-bt"><i></i></span><span class="tk-bv">${x.c}${choice ? `<small>${pct}%</small>` : ''}</span></div>`;
    }).join('');
  }
  function texts() {
    const box = $('tkTexts'), ts = poll.texts || [];
    box.innerHTML = ts.length ? ts.map(t => `<div class="tk-tx"${adm() ? ` data-hidetx="${A.esc(t)}"` : ''}>${A.esc(t)}</div>`).join('') : '<p class="tk-empty on">휴대폰으로 답을 보내면 여기에 카드가 쌓여요</p>';
  }
  async function toggleReveal() {
    if (!poll) return;
    try { await rpc('reveal_poll', { p_id: C.eventId, p_token: C.token(), p_poll: poll.id, p_reveal: !poll.reveal }); if (!poll.reveal) { try { Sound.sfx('milestone', { pct: 90 }); } catch (e) {} A.confetti({ count: 90 }); } drawnSig = ''; tick(); }
    catch (e) { C.toast(C.noFnMsg(e, '정답 공개'), 'bad'); }
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
    const tx = kindOf(poll) === 'text';
    const ok = await A.dialog({ title: tx ? '답 숨기기' : '낱말 숨기기', message: `'${w}'을(를) 화면에서 숨길까요?\n(답은 지우지 않아요. 아래 '${tx ? '숨긴 답' : '숨긴 낱말'}'에서 되살릴 수 있어요)`, ok: '숨기기' });
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
  function barsCanvas() {
    const items = barItems(), tot = poll.n || 0, max = Math.max(1, ...items.map(x => x.c)), choice = kindOf(poll) === 'choice';
    const W = 1600, rowH = 84, H = Math.max(300, items.length * rowH + 40), cv = document.createElement('canvas');
    cv.width = W; cv.height = H; const g = cv.getContext('2d'), lw = 520, bw = W - lw - 200;
    g.textBaseline = 'middle';
    items.forEach((x, i) => {
      const y = 20 + i * rowH + rowH / 2;
      g.fillStyle = x.ok ? '#2b8a3e' : '#1b2133'; g.font = '700 34px "IBM Plex Sans KR",sans-serif'; g.textAlign = 'left';
      g.fillText((x.ok ? '✓ ' : '') + x.label, 10, y, lw - 30);
      g.fillStyle = '#eef0f6'; g.fillRect(lw, y - 24, bw, 48);
      g.fillStyle = x.ok ? '#2f9e44' : COLORS[i % COLORS.length]; g.fillRect(lw, y - 24, bw * x.c / max, 48);
      g.fillStyle = '#1b2133'; g.font = '800 34px "IBM Plex Sans KR",sans-serif';
      g.fillText(x.c + (choice && tot ? ` (${Math.round(x.c * 100 / tot)}%)` : ''), lw + bw + 16, y);
    });
    return cv;
  }
  function savePng() {
    const cv = view === 'bars' ? (poll && barsCanvas()) : $('tkCv'); if (!cv || !poll) return;
    const pad = 40 * (view === 'bars' ? 1.4 : (cv.width / cv.clientWidth || 1)), out = document.createElement('canvas');
    const titleH = Math.max(110, Math.round(cv.height * 0.12));
    out.width = cv.width + pad * 2; out.height = cv.height + titleH + pad * 2;
    const g = out.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, out.width, out.height);
    g.fillStyle = '#1b2133'; g.font = `700 ${Math.round(titleH * 0.45)}px "IBM Plex Sans KR",sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(poll.q, out.width / 2, pad + titleH / 2, out.width - pad * 2);
    g.drawImage(cv, pad, pad + titleH);
    g.fillStyle = '#868e96'; g.font = `500 ${Math.round(titleH * 0.2)}px "IBM Plex Sans KR",sans-serif`; g.textAlign = 'right';
    g.fillText(`응답 ${poll.n}명 · ${A.ymd(new Date().toISOString())}`, out.width - pad, out.height - pad / 2);
    const a = document.createElement('a'); a.href = out.toDataURL('image/png');
    a.download = `${view === 'bars' ? '막대그래프' : '워드클라우드'}_${(poll.q || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 30)}.png`; a.click();
  }
  // 질문 던지기 시작: 미리 써 둔 질문을 고르거나 새로 쓰기
  // 미리 써 둔 질문 한 줄: "질문" → 낱말 / "질문 | 보기1 | *보기2 | 보기3" → 보기 고르기(*는 정답) / "한줄: 질문" → 한 줄 답
  function parsePrep(line) {
    if (/^한\s*줄\s*[:：]/.test(line)) return { kind: 'text', q: line.replace(/^한\s*줄\s*[:：]\s*/, ''), choices: [], answer: null };
    const parts = line.split('|').map(x => x.trim()).filter(Boolean);
    if (parts.length >= 3) {
      let answer = null;
      const choices = parts.slice(1, 9).map((c, i) => { if (c.startsWith('*')) { answer = i; return c.slice(1).trim(); } return c; });
      return { kind: 'choice', q: parts[0], choices, answer };
    }
    return { kind: 'word', q: line, choices: [], answer: null };
  }
  const KINDS = [['word', '☁️ 낱말', '떠오르는 낱말 → 워드클라우드'], ['choice', '📊 보기 고르기', '투표·퀴즈 → 막대그래프'], ['text', '💬 한 줄 답', '소감·의견 → 카드']];
  function startPoll() {
    const prep = String((C.cfg().poll || {}).prepared || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, 20).map(parsePrep);
    return new Promise(resolve => {
      const wrap = el('div', 'app-modal');
      const icon = k => k === 'choice' ? '📊' : k === 'text' ? '💬' : '☁️';
      wrap.innerHTML = `<div class="app-modal-box tk-start" role="dialog" aria-modal="true" aria-labelledby="tkst"><h2 id="tkst">질문 던지기</h2>
        <p>참석자 휴대폰에 질문이 저절로 뜨고, 답이 강의실 화면에 모여요.</p>
        ${prep.length ? `<div class="tk-prep">${prep.map((p, i) => `<button type="button" data-p="${i}">${icon(p.kind)} ${A.esc(p.q)}${p.kind === 'choice' ? `<small>${p.choices.map((c, j) => A.esc(c) + (p.answer === j ? ' ✓' : '')).join(' · ')}</small>` : ''}</button>`).join('')}</div>` : ''}
        <div class="tk-kinds" role="radiogroup" aria-label="답 받는 방식">${KINDS.map(([k, t, d]) => `<button type="button" role="radio" data-k="${k}"><b>${t}</b><small>${d}</small></button>`).join('')}</div>
        <input type="text" class="app-modal-input" id="tkInp" maxlength="120" placeholder="예: AI 하면 떠오르는 낱말은?">
        <div class="tk-chs" id="tkChs" hidden><div id="tkChList"></div><button type="button" class="tk-chadd" id="tkChAdd">+ 보기 추가</button><p class="tk-chtip">정답이 있는 퀴즈면 정답 보기의 ○를 눌러 주세요(없으면 투표). 정답은 [정답 공개]를 누를 때 보여요.</p></div>
        <p class="err" id="tkStErr" role="alert"></p>
        <div class="app-modal-btns"><button type="button" class="btn ghost" data-v="0">취소</button><button type="button" class="btn primary" data-v="1">던지기</button></div></div>`;
      document.body.appendChild(wrap);
      const inp = wrap.querySelector('#tkInp'), chs = wrap.querySelector('#tkChs'), list = wrap.querySelector('#tkChList');
      let kind = 'word', answer = null;
      const PH = { word: '예: AI 하면 떠오르는 낱말은?', choice: '예: 생성형 AI에 넣으면 안 되는 것은?', text: '예: 오늘 교육 한 줄 소감은?' };
      const row = (v = '') => { const d = el('div', 'tk-ch'); d.innerHTML = `<button type="button" class="tk-ans" aria-label="정답으로 고르기">○</button><input type="text" maxlength="40" placeholder="보기" value="${A.esc(v)}"><button type="button" class="tk-chx" aria-label="보기 빼기">✕</button>`; list.appendChild(d); return d; };
      const marks = () => [...list.children].forEach((d, i) => { const b = d.querySelector('.tk-ans'); b.textContent = answer === i ? '✓' : '○'; d.classList.toggle('ans', answer === i); });
      const setKind = k => { kind = k; wrap.querySelectorAll('[data-k]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.k === k))); chs.hidden = k !== 'choice'; inp.placeholder = PH[k]; if (k === 'choice' && !list.children.length) { row(); row(); row(); } };
      const fill = p => { inp.value = p.q; list.innerHTML = ''; answer = p.answer; setKind(p.kind); if (p.kind === 'choice') { list.innerHTML = ''; p.choices.forEach(c => row(c)); marks(); } };
      setKind('word');
      const done = async v => {
        if (v) {
          const q = inp.value.trim(); if (!q) { inp.focus(); return; }
          const choices = kind === 'choice' ? [...list.querySelectorAll('input')].map(i => i.value.trim()) : [];
          let ans = answer;
          if (kind === 'choice') {   // 빈 보기는 빼고 정답 번호를 맞춘다
            const keep = choices.map((c, i) => [c, i]).filter(x => x[0]);
            if (keep.length < 2) { wrap.querySelector('#tkStErr').textContent = '보기를 두 개 이상 써 주세요'; return; }
            ans = answer == null ? null : keep.findIndex(x => x[1] === answer); if (ans < 0) ans = null;
            choices.length = 0; keep.forEach(x => choices.push(x[0]));
          }
          try {
            let b;
            try { b = await rpc('start_poll2', { p_id: C.eventId, p_token: C.token(), p_q: q, p_kind: kind, p_choices: choices, p_answer: ans }); }
            catch (e) { if (kind === 'word' && A.noFn && A.noFn(e)) b = await rpc('start_poll', { p_id: C.eventId, p_token: C.token(), p_q: q }); else throw e; }
            C.onBoard(b); C.toast('질문을 던졌어요', 'ok');
            if (kind === 'choice' && b && b.session && b.session.poll_id) answerMemo[b.session.poll_id] = ans;
          }
          catch (e) { wrap.querySelector('#tkStErr').textContent = C.noFnMsg(e, kind === 'word' ? '질문 던지기' : '이 답 방식'); return; }
        }
        wrap.classList.add('out'); setTimeout(() => wrap.remove(), 180); resolve(v);
      };
      wrap.addEventListener('click', e => {
        const p = e.target.closest('[data-p]'); if (p) { fill(prep[+p.dataset.p]); inp.focus(); return; }
        const k = e.target.closest('[data-k]'); if (k) { setKind(k.dataset.k); inp.focus(); return; }
        if (e.target.closest('#tkChAdd')) { if (list.children.length < 8) row().querySelector('input').focus(); return; }
        const a = e.target.closest('.tk-ans'); if (a) { const i = [...list.children].indexOf(a.parentNode); answer = answer === i ? null : i; marks(); return; }
        const x = e.target.closest('.tk-chx'); if (x) { const i = [...list.children].indexOf(x.parentNode); if (list.children.length > 2) { x.parentNode.remove(); if (answer === i) answer = null; else if (answer > i) answer--; marks(); } return; }
        const b = e.target.closest('[data-v]'); if (b) done(b.dataset.v === '1'); else if (e.target === wrap) done(false);
      });
      wrap.addEventListener('keydown', e => { if (e.key === 'Escape') done(false); if (e.key === 'Enter' && e.target === inp) done(true); });
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
      const sum = [['질문 던지기 결과'], []], raw = [['회차', '질문', '답 방식', '보낸 시각', '부서명', '성명', '답', '정답 여부']];
      const KN = { word: '낱말', choice: '보기 고르기', text: '한 줄 답' };
      d.polls.forEach((p, i) => {
        const S = p.summary, k = S.kind || 'word', quiz = k === 'choice' && S.answer != null;
        sum.push([`${i + 1}. ${p.q}`, `${KN[k]}${quiz ? '(퀴즈)' : ''} · ${lab.get(p.session_id) || ''} · ${A.hhmm(p.at)} · 응답 ${S.n}명${p.anon ? ' · 익명' : ''}`]);
        if (k === 'choice') {
          sum.push(['', '보기', '인원', '비율']);
          S.choices.forEach((c, j) => sum.push(['', c + (quiz && S.answer === j ? ' (정답)' : ''), S.counts[j] || 0, S.n ? Math.round((S.counts[j] || 0) * 100 / S.n) + '%' : '0%']));
          if (quiz) sum.push(['', '정답률', '', S.n ? Math.round((S.counts[S.answer] || 0) * 100 / S.n) + '%' : '-']);
        } else if (k === 'text') {
          sum.push(['', '답(최근 순)']);
          (S.texts || []).forEach(t => sum.push(['', t + (S.hidden.includes(t) ? ' (숨김)' : '')]));
        } else {
          sum.push(['', '낱말', '횟수']);
          S.words.forEach(([w, c]) => sum.push(['', w + (S.hidden.includes(w) ? ' (숨김)' : ''), c]));
        }
        sum.push([]);
        p.answers.forEach(a => {
          const who = a.no != null ? byNo.get(a.no) || {} : null, ws = a.words || [];
          const ans = k === 'choice' ? (S.choices[+ws[0]] || '') : ws.join(', ');
          raw.push([lab.get(p.session_id) || '', p.q, KN[k], A.hhmm(a.at), who ? who.dept || '' : '익명', who ? who.name || '' : '', ans, quiz ? (+ws[0] === S.answer ? 'O' : 'X') : '']);
        });
      });
      out.push({ name: '질문 던지기 요약', rows: sum, cols: [40, 30, 8, 8] }, { name: '질문 던지기 응답', rows: raw, cols: [10, 36, 11, 9, 18, 10, 30, 8] });
    }
    return out;
  }

  function init(ctx) {
    C = ctx;
    document.addEventListener('click', e => {
      const b = e.target.closest('#talk [data-act], #tkWait [data-act]'); if (b && adm()) { act(+b.dataset.id, b.dataset.act); return; }
      const u = e.target.closest('[data-unhide]'); if (u && adm()) unhide(u.dataset.unhide);
      const h = e.target.closest('[data-hidetx]'); if (h && adm()) hideWord(h.dataset.hidetx);
    });
    let rt = 0; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (mode === 'poll' && poll && view === 'cloud') draw(poll.words); }, 250); });
  }
  window.Talk = { init, onMode, startPoll, sheets };
})();
