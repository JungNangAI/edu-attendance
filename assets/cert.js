/* 위촉장·수료증 그리기 (A4 1240×1754). 기존 중랑 위촉장 그림을 설정값으로 바꿀 수 있게 옮긴 것 */
(function () {
  'use strict';
  const W = 1240, H = 1754;
  const FD = '"Nanum Myeongjo","Noto Serif KR",Batang,serif';
  const INK = [206, 30, 36];

  function seeded(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
  const korDate = d => `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;

  async function ensureFonts(text) {
    try { await Promise.all([800, 700, 400].map(w => document.fonts.load(`${w} 40px "Nanum Myeongjo"`, text))); } catch (e) {}
  }
  function fitFont(ctx, weight, size, text, maxW) {
    ctx.font = `${weight} ${size}px ${FD}`;
    const w = ctx.measureText(text).width;
    if (w > maxW) { size = Math.floor(size * maxW / w); ctx.font = `${weight} ${size}px ${FD}`; }
  }
  // 인주 질감: 그려진 모양을 한 가지 인주색으로, 얼룩·빠짐을 넣는다
  function inkify(o, size, seed) {
    const img = o.getImageData(0, 0, size, size), px = img.data, rnd = seeded(seed);
    const blots = Array.from({ length: 9 }, () => ({ x: rnd() * size, y: rnd() * size, r: size * (0.12 + rnd() * 0.22), d: 0.25 + rnd() * 0.4 }));
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (px[i + 3] < 90) { px[i + 3] = 0; continue; }
      let a = 1;
      for (const b of blots) { const q = ((x - b.x) ** 2 + (y - b.y) ** 2) / (b.r * b.r); if (q < 1) a -= b.d * (1 - q) * (1 - q); }
      a *= 0.86 + rnd() * 0.14;
      if (rnd() < 0.025) a *= 0.15;
      px[i] = INK[0]; px[i + 1] = INK[1]; px[i + 2] = INK[2]; px[i + 3] = Math.max(0, Math.min(255, a * 235));
    }
    o.putImageData(img, 0, 0);
  }
  // 직인: 마크가 있으면 마크로, 없으면 명의 글자로 네모 도장을 만든다
  function makeSeal(size, mark, issuer) {
    const off = document.createElement('canvas'); off.width = off.height = size;
    const o = off.getContext('2d'), bw = size * 0.075;
    o.fillStyle = `rgb(${INK})`; o.fillRect(0, 0, size, size); o.clearRect(bw, bw, size - bw * 2, size - bw * 2);
    if (mark) {
      const pad = size * 0.15, inner = size - pad * 2, k = Math.min(inner / mark.naturalWidth, inner / mark.naturalHeight);
      const mw = mark.naturalWidth * k, mh = mark.naturalHeight * k;
      o.drawImage(mark, (size - mw) / 2, (size - mh) / 2, mw, mh);
    } else {
      const chars = [...String(issuer || '직인').replace(/\s/g, '')].slice(0, 9);
      if (chars.length > 1 && chars.length < 4) chars.push('인');
      const n = Math.ceil(Math.sqrt(chars.length)), cell = (size - bw * 3) / n;
      o.font = `800 ${cell * 0.86}px ${FD}`; o.textAlign = 'center'; o.textBaseline = 'middle';
      // 도장은 오른쪽 줄부터 위에서 아래로 읽는다
      chars.forEach((c, i) => { const col = n - 1 - Math.floor(i / n), row = i % n; o.fillText(c, bw * 1.5 + cell * (col + 0.5), bw * 1.5 + cell * (row + 0.52)); });
    }
    inkify(o, size, 20261104);
    return off;
  }
  function frame(ctx, style, color) {
    if (style === 'none') return;
    ctx.strokeStyle = color;
    if (style === 'line') { ctx.lineWidth = 4; ctx.strokeRect(70, 70, W - 140, H - 140); return; }
    ctx.lineWidth = 7; ctx.strokeRect(58, 58, W - 116, H - 116);
    ctx.lineWidth = 2; ctx.strokeRect(80, 80, W - 160, H - 160);
    const corner = (x, y, sx, sy) => {
      ctx.save(); ctx.translate(x, y); ctx.scale(sx, sy); ctx.lineWidth = 3; ctx.beginPath();
      ctx.moveTo(0, 70); ctx.lineTo(0, 0); ctx.lineTo(70, 0);
      ctx.moveTo(14, 70); ctx.lineTo(14, 14); ctx.lineTo(70, 14);
      ctx.moveTo(28, 56); ctx.lineTo(28, 28); ctx.lineTo(56, 28); ctx.lineTo(56, 42); ctx.lineTo(42, 42);
      ctx.stroke(); ctx.restore();
    };
    corner(96, 96, 1, 1); corner(W - 96, 96, -1, 1); corner(96, H - 96, 1, -1); corner(W - 96, H - 96, -1, -1);
  }
  // 칸 이름을 일정한 너비에 고르게 벌려 쓴다 (예: 부 서 명 / 직    급)
  function spacedLabel(ctx, text, x, y, width) {
    const ch = [...text];
    if (ch.length <= 1) { ctx.fillText(text, x, y); return; }
    const tw = ch.reduce((a, c) => a + ctx.measureText(c).width, 0);
    if (tw >= width || ch.length > 5) { ctx.fillText(text, x, y); return; }
    const gap = (width - tw) / (ch.length - 1); let cx = x;
    ch.forEach(c => { ctx.fillText(c, cx, y); cx += ctx.measureText(c).width + gap; });
  }
  function certDate(c, at) {
    if (c.date_mode === 'fixed' && c.date) { const [y, m, d] = c.date.split('-').map(Number); if (y) return new Date(y, m - 1, d); }
    return at ? new Date(at) : new Date();
  }

  /** canvas에 그린다. imgs: {mark, seal, slogan, template} (Image), values: {키: 값} */
  async function render(canvas, cert, imgs, values, opt = {}) {
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const fields = (cert.fields || []).filter(f => f && f.label);
    const dy = Object.assign({ info: 0, body: 0, date: 0, sign: 0 }, cert.template && cert.template.dy);
    const date = certDate(cert, opt.at);
    await ensureFonts([cert.title, cert.body, cert.issuer, ...fields.map(f => f.label + (values[f.key] || '')), '년월일0123456789—미리보기직인'].join(''));
    const tpl = imgs.template;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fdfcf8'; ctx.fillRect(0, 0, W, H);
    if (tpl) ctx.drawImage(tpl, 0, 0, W, H);
    else {
      if (imgs.mark) {   // 워터마크
        const h = 820, w = h * imgs.mark.naturalWidth / imgs.mark.naturalHeight, k = Math.min(1, 1000 / w);
        ctx.save(); ctx.globalAlpha = 0.07; ctx.drawImage(imgs.mark, W / 2 - w * k / 2, H * 0.53 - h * k / 2, w * k, h * k); ctx.restore();
      }
      frame(ctx, cert.border || 'gold', '#8a6a33');
      if (imgs.slogan) { const w = 440, h = w * imgs.slogan.naturalHeight / imgs.slogan.naturalWidth; ctx.drawImage(imgs.slogan, W - 190 - w, 116, w, Math.min(h, 140)); }
    }
    ctx.fillStyle = '#1b1b1b'; ctx.textBaseline = 'alphabetic';

    if (!(tpl && cert.template && cert.template.noTitle)) {   // 제목
      const t = String(cert.title || '');
      ctx.textAlign = 'center';
      if ([...t].length <= 4) { ctx.font = `800 128px ${FD}`; ctx.fillText([...t].join('   '), W / 2, 450); }
      else { fitFont(ctx, 800, 110, t, W - 300); ctx.fillText(t, W / 2, 450); }
    }

    // 받는 사람 칸
    const step = fields.length > 3 ? Math.max(62, 84 - (fields.length - 3) * 10) : 84;
    let y = 660 + dy.info - (fields.length > 3 ? (fields.length - 3) * step / 2 : 0);
    for (const f of fields) {
      const v = String(values[f.key] || '').trim();
      ctx.textAlign = 'left'; ctx.font = `400 40px ${FD}`; ctx.fillStyle = '#3a3a3a';
      spacedLabel(ctx, f.label, 330, y, 150); ctx.fillText(':', 520, y);
      ctx.fillStyle = v ? '#1b1b1b' : '#b5b5b5';
      fitFont(ctx, 700, 46, v || '—', W - 330 - 560);
      ctx.fillText(v || '—', 560, y);
      y += step;
    }

    // 본문 (줄바꿈 지원)
    ctx.fillStyle = '#1b1b1b'; ctx.textAlign = 'center';
    const lines = String(cert.body || '').split('\n').slice(0, 3);
    lines.forEach((ln, i) => { fitFont(ctx, 400, 56, ln, W - 320); ctx.fillText(ln, W / 2, 1110 + dy.body + (i - (lines.length - 1) / 2) * 76); });

    ctx.font = `400 44px ${FD}`;
    ctx.fillText(korDate(date), W / 2, 1320 + dy.date);

    // 명의 + 직인
    const issuer = String(cert.issuer || '');
    fitFont(ctx, 800, 64, issuer, W - 520);
    const fw = ctx.measureText(issuer).width, sealSize = 180, hasSeal = cert.seal !== 'none';
    const sx = W / 2 - (fw + (hasSeal ? sealSize * 0.5 : 0)) / 2;
    ctx.textAlign = 'left'; ctx.fillStyle = '#111';
    ctx.fillText(issuer, sx, 1480 + dy.sign);
    if (hasSeal) {
      const seal = cert.seal === 'image' && imgs.seal ? imgs.seal : makeSeal(sealSize, imgs.mark, issuer);
      const k = sealSize / Math.max(seal.width || seal.naturalWidth, seal.height || seal.naturalHeight);
      const sw = (seal.width || seal.naturalWidth) * k, sh = (seal.height || seal.naturalHeight) * k;
      ctx.save(); ctx.globalCompositeOperation = 'multiply';
      ctx.translate(sx + fw + sealSize * 0.25, 1458 + dy.sign); ctx.rotate(-3.5 * Math.PI / 180);
      ctx.drawImage(seal, -sw / 2, -sh / 2, sw, sh); ctx.restore();
    }
    if (opt.sample) {
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-Math.PI / 7);
      ctx.font = `800 170px ${FD}`; ctx.fillStyle = 'rgba(196,38,30,0.12)'; ctx.textAlign = 'center';
      ctx.fillText('미리보기', 0, 0); ctx.restore();
    }
  }
  // 저장소의 data URL들을 Image로
  async function images(assetMap) {
    const A = window.App, out = {};
    const pairs = [['mark', 'cert_mark'], ['seal', 'cert_seal'], ['slogan', 'cert_slogan'], ['template', 'cert_template']];
    await Promise.all(pairs.map(async ([k, key]) => { if (assetMap[key]) { try { out[k] = await A.loadImage(assetMap[key]); } catch (e) {} } }));
    return out;
  }
  window.CertRender = { W, H, render, images };
})();
