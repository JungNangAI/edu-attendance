/* 실시간 해설: 강의실 화면 구석에서 캐릭터가 말풍선으로 지금 상황을 말해 준다.
   진짜 AI가 아니라 상황별 문장을 골라 쓴다. 한 번에 하나씩, 5.5초 보여 주고 2.5초 쉰다. 20초 넘게 밀린 말은 버린다.
   Buddy.say(문장) · Buddy.pick([문장들]) · Buddy.setOn(켜기) · Buddy.once(열쇠, 문장): 같은 열쇠는 한 번만 */
(function () {
  'use strict';
  let el = null, q = [], busy = false, lastAt = 0, on = true;
  const said = new Set();
  const IMGS = ['main', 'welcome', 'news', 'chuck', 'call'];
  function host() {
    if (el) return el;
    el = document.createElement('div'); el.className = 'buddy'; el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<img alt="" src="assets/defaults/main.png"><p></p>';
    document.body.appendChild(el); return el;
  }
  function pump() {
    if (busy || !q.length || !on) return;
    busy = true;
    const wait = Math.max(0, lastAt + 2500 - Date.now());
    setTimeout(() => {
      let m = q.shift(); while (m && Date.now() - m.at > 20000) m = q.shift();   // 너무 늦은 말은 버린다
      if (!m || !on || document.body.classList.contains('phone-admin')) { busy = false; return; }
      const b = host();
      b.querySelector('img').src = 'assets/defaults/' + (m.img || IMGS[Math.floor(Math.random() * IMGS.length)]) + '.png';
      b.querySelector('p').textContent = m.text;
      b.classList.remove('on'); void b.offsetWidth; b.classList.add('on');
      try { Sound.sfx('land'); } catch (e) {}
      setTimeout(() => { b.classList.remove('on'); lastAt = Date.now(); busy = false; pump(); }, m.ms || 5500);
    }, wait);
  }
  function say(text, opt = {}) {
    if (!on || !text) return;
    const m = { text, at: Date.now(), ...opt };
    if (opt.urgent) q.unshift(m); else q.push(m);
    if (q.length > 3) q = opt.urgent ? q.slice(0, 3) : q.slice(-3);   // 밀리면 오래된 말은 버린다
    pump();
  }
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  function once(key, text, opt) { if (said.has(key)) return; said.add(key); say(text, opt); }
  function setOn(v) { on = !!v; if (!on) { q = []; if (el) el.classList.remove('on'); } }
  window.Buddy = { say, pick, once, setOn, reset: () => said.clear() };
})();
