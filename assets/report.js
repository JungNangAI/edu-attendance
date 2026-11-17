/* 결과보고서 초안(한글 HWPX): 출석·만족도·질문 기록으로 단면 결과보고서를 만든다.
   서식은 assets/report_base.hwpx(머리말·글자·문단 모양이 들어 있는 정상 HWPX)를 그대로 쓰고, 본문(section0.xml)만 새로 쓴다.
   글자 모양 번호(CID)·문단 모양 번호(PID)는 report_base.hwpx를 만든 순서와 같다. */
(function () {
  'use strict';
  const CID = { base: 0, title: 1, meta: 2, box: 3, sec: 4, item: 5, note: 6, th: 7, td: 8, tdb: 9, small: 10, gap: 11 };
  const PID = { base: 0, center: 1, left: 2, right: 3, box: 4, sec: 5, item: 6, note: 7, gap: 8, tbl: 9, plan: 10 };
  const TW = 48758;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const rid = () => 1000000000 + Math.floor(Math.random() * 1100000000);
  const run = (t, c) => `<hp:run charPrIDRef="${CID[c]}"><hp:t>${esc(t)}</hp:t></hp:run>`;
  const para = (runs, p = 'base') => `<hp:p id="0" paraPrIDRef="${PID[p]}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${runs}</hp:p>`;
  function cell(col, row, w, h, bf, inner, valign = 'CENTER', pad = 141) {
    return `<hp:tc name="" header="0" hasMargin="${pad !== 141 ? 1 : 0}" protect="0" editable="0" dirty="0" borderFillIDRef="${bf}">`
      + `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${valign}" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${inner}</hp:subList>`
      + `<hp:cellAddr colAddr="${col}" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${w}" height="${h}"/>`
      + `<hp:cellMargin left="${pad}" right="${pad}" top="${pad}" bottom="${pad}"/></hp:tc>`;
  }
  function table(rows, nr, nc, width, height, out = 283) {
    return `<hp:tbl id="${rid()}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="${nr}" colCnt="${nc}" cellSpacing="0" borderFillIDRef="1" noAdjust="0">`
      + `<hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/>`
      + `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>`
      + `<hp:outMargin left="${out}" right="${out}" top="${out}" bottom="${out}"/><hp:inMargin left="141" right="141" top="141" bottom="141"/>`
      + rows.join('') + '</hp:tbl>';
  }
  const tblPara = (t, p = 'tbl') => para(`<hp:run charPrIDRef="${CID.base}">${t}</hp:run><hp:run charPrIDRef="${CID.base}"/>`, p);
  function titleBlock(spec, logoXml) {
    const c0 = 9100, c1 = TW - 9100;
    const logo = para(`<hp:run charPrIDRef="${CID.base}">${logoXml}</hp:run>`, 'center');
    const r0 = '<hp:tr>' + cell(0, 0, c0, 4400, 2, logo) + cell(1, 0, c1, 4400, 3, para(run(spec.title, 'title'), 'center')) + '</hp:tr>';
    const r1 = '<hp:tr>' + cell(0, 1, c0, 2600, 4, para(run(spec.date, 'meta'), 'center')) + cell(1, 1, c1, 2600, 5, para(run(spec.contact, 'meta'), 'left')) + '</hp:tr>';
    return table([r0, r1], 2, 2, TW, 7000);
  }
  const summaryBlock = t => table(['<hp:tr>' + cell(0, 0, TW, 5000, 6, para(run(t, 'box'), 'box'), 'CENTER', 708) + '</hp:tr>'], 1, 1, TW, 5000);
  function dataTable(t) {
    const sum = t.widths.reduce((a, b) => a + b, 0), scale = (TW - 1200) / sum;
    const ws = t.widths.map(w => Math.floor(w * scale)); ws[ws.length - 1] += (TW - 1200) - ws.reduce((a, b) => a + b, 0);
    const al = t.align || ws.map(() => 'center'), bold = new Set(t.bold || []);
    const rows = ['<hp:tr>' + t.head.map((h, c) => cell(c, 0, ws[c], 1900, 7, para(run(h, 'th'), 'center'))).join('') + '</hp:tr>'];
    t.rows.forEach((row, i) => {
      const r = i + 1, bf = r === t.rows.length ? 9 : 8;
      rows.push('<hp:tr>' + row.map((v, c) => cell(c, r, ws[c], 1700, bf, String(v).split('\n').map(l => para(run(l, bold.has(c) ? 'tdb' : 'td'), al[c] === 'left' ? 'left' : 'center')).join(''))).join('') + '</hp:tr>');
    });
    return table(rows, rows.length, ws.length, TW - 1200, 1900 + 1700 * t.rows.length);
  }
  function body(spec) {
    const ps = [];
    spec.sections.forEach((sec, i) => {
      if (i) ps.push(para(run('', 'gap'), 'gap'));
      ps.push(para(run('□ ' + sec.head, 'sec'), 'sec'));
      sec.items.forEach(it => {
        if (it && it.table) ps.push(tblPara(dataTable(it.table)));
        else if (/^[☞※*]/.test(it)) ps.push(para(run('   ' + it, 'note'), 'note'));
        else ps.push(para(run(' ㅇ ' + it, 'item'), 'item'));
      });
    });
    return ps;
  }

  /* ---------- 자료 → 보고서 내용 ---------- */
  const WD = '일월화수목금토';
  const d8 = iso => { const d = new Date(iso); return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), w: WD[d.getDay()] }; };
  const fmtDay = (iso, withYear = true) => { const x = d8(iso); return `${withYear ? '’' + String(x.y).slice(2) + '. ' : ''}${x.m}. ${x.d}.(${x.w})`; };
  const hhmm = iso => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const josa = (w, a, b) => { const c = String(w).replace(/[」』)\]\s]+$/, '').slice(-1).charCodeAt(0); if (c < 0xac00 || c > 0xd7a3) return a + '(' + b + ')'; return (c - 0xac00) % 28 ? a : b; };
  const pct = (a, b) => b ? Math.round(a * 100 / b) : 0;
  const CIRC = '①②③④⑤⑥⑦⑧';

  function makeSpec(x) {
    const { cfg, sessions, attendance, all, roster, responses = [], talk = { questions: [], polls: [] } } = x;
    const ss = sessions.slice().sort((a, b) => a.started_at < b.started_at ? -1 : 1);
    const title = cfg.title || '행사';
    const anonEv = !!(cfg.attend && cfg.attend.anon), nR = roster.length;
    const att = attendance.filter(a => a.at);
    const bySess = ss.map(s => ({ s, ins: att.filter(a => a.session_id === s.id), outs: attendance.filter(a => a.session_id === s.id && a.out_at) }));
    const used = bySess.filter(b => b.ins.length || b.outs.length);
    const rows = used.length ? used : bySess;
    const usesOut = cfg.screen && cfg.screen.checkout === 'on' || attendance.some(a => a.out_at);
    const people = new Set(att.map(a => a.no)).size, extra = all.filter(p => p.extra && att.some(a => a.no === p.no)).length;
    const total = att.length, avgPct = nR && rows.length ? Math.round(rows.reduce((t, b) => t + pct(b.ins.filter(a => !all.find(p => p.no === a.no && p.extra)).length, nR), 0) / rows.length) : null;
    // 일시
    let when = '○○';
    if (rows.length) {
      const first = rows[0].s.started_at, last = rows[rows.length - 1].s.started_at;
      if (rows.length === 1) {
        const ts = rows[0].ins.map(a => a.at).sort();
        when = fmtDay(first) + (ts.length ? (hhmm(ts[0]) === hhmm(ts[ts.length - 1]) ? ` ${hhmm(ts[0])}` : ` ${hhmm(ts[0])} ~ ${hhmm(ts[ts.length - 1])}(출석 기준)`) : '');
      } else when = `${fmtDay(first)} ~ ${fmtDay(last, d8(first).y !== d8(last).y)}, 총 ${rows.length}회`;
    }
    const sec1 = [`행 사 명 : 「${title}」${cfg.subtitle ? ' ' + cfg.subtitle : ''}`, `일    시 : ${when}`,
      `대    상 : ${anonEv ? '참석자(명단 없이 QR 출석)' : nR ? `명단 ${nR}명${extra ? ` (명단 밖 참석 ${extra}명)` : ''}` : '참석자(명단 없이 받기)'}`,
      `주    관 : ${cfg.org || '○○○○'}`, '출석방식 : 「중랑출석부」 QR 출석(종이 출석부 없음)'];
    // 운영 결과
    const sec2 = [];
    if (rows.length > 1) sec2.push(`출석 : 연인원 ${total}명(실인원 ${people}명)${avgPct != null ? `, 평균 출석률 ${avgPct}%` : ''}`);
    else sec2.push(`출석 : ${total}명${nR ? ` / 명단 ${nR}명(출석률 ${pct(rows[0] ? rows[0].ins.length : 0, nR)}%)` : ''}`);
    const head = ['회차', '일자', '출석', ...(nR ? ['출석률'] : []), ...(usesOut ? ['퇴실'] : [])];
    sec2.push({ table: { head, widths: [22, 20, 14, ...(nR ? [14] : []), ...(usesOut ? [14] : [])], bold: [0],
      rows: rows.slice(0, 12).map(b => [b.s.label, fmtDay(b.s.started_at, false), b.ins.length + '명', ...(nR ? [pct(b.ins.length, nR) + '%'] : []), ...(usesOut ? [b.outs.length + '명'] : [])]) } });
    if (rows.length > 12) sec2.push(`※ 회차가 많아 앞 12회만 적음(전체는 엑셀 출석부 참고)`);
    const P = cfg.pass || {};
    if (P.on && nR && ss.length) {
      const minPct = +P.min_pct || 80, n = roster.filter(p => pct(new Set(att.filter(a => a.no === p.no).map(a => a.session_id)).size, ss.length) >= minPct).length;
      sec2.push(`이수 : ${n}명 / ${nR}명(이수율 ${pct(n, nR)}%, 기준 ${P.min_pct === '100' ? '모두 출석' : minPct + '% 이상 출석'})`);
    }
    const sections = [{ head: '행사 개요', items: sec1 }, { head: '운영 결과', items: sec2 }];
    // 만족도
    let star = null;
    const qs = (cfg.survey && cfg.survey.questions) || [];
    if (responses.length && qs.length) {
      const items = [`응답 : ${responses.length}명${cfg.survey.anon ? '(익명)' : ''}${people ? `, 응답률 ${pct(responses.length, people)}%` : ''}`];
      const trs = [], opin = [];
      qs.forEach(q => {
        const vals = responses.map(r => r.answers[q.id]).filter(v => v != null && v !== '' && !(Array.isArray(v) && !v.length));
        if (q.type === 'star') {
          const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
          if (star == null && vals.length) star = avg;
          trs.push([q.q, vals.length ? `평균 ${avg.toFixed(1)}점(5점 만점)` : '-']);
        } else if (q.type === 'one' || q.type === 'multi') {
          const cs = (q.options || []).map(o => [o, vals.filter(v => Array.isArray(v) ? v.includes(o) : v === o).length]).sort((a, b) => b[1] - a[1]).slice(0, 3);
          trs.push([q.q, cs.filter(c => c[1]).map(([o, c]) => `${o} ${c}명(${pct(c, vals.length)}%)`).join(', ') || '-']);
        } else {
          trs.push([q.q, `의견 ${vals.length}건`]);
          vals.slice(0, 2).forEach(v => opin.push(`☞ "${String(v).slice(0, 60)}${String(v).length > 60 ? '…' : ''}"`));
        }
      });
      items.push({ table: { head: ['문항', '결과'], widths: [45, 48], align: ['left', 'left'], rows: trs } });
      opin.forEach(o => items.push(o));
      sections.push({ head: '만족도 조사', items });
    }
    // 교육 중 소통
    const qn = talk.questions.filter(q => q.status !== 'hide'), pl = talk.polls;
    if (qn.length || pl.length) {
      const items = [];
      if (qn.length) {
        items.push(`질문 받기 : 질문 ${qn.length}건, 공감 ${qn.reduce((t, q) => t + (q.likes || 0), 0)}회`);
        qn.slice().sort((a, b) => b.likes - a.likes).slice(0, 3).forEach(q => items.push(`☞ "${q.body.slice(0, 60)}${q.body.length > 60 ? '…' : ''}"${q.likes ? ` (공감 ${q.likes})` : ''}`));
      }
      if (pl.length) {
        items.push(`질문 던지기 : ${pl.length}회(참석자 휴대폰으로 실시간 응답)`);
        pl.slice(0, 5).forEach(p => {
          const S = p.summary || {}, k = S.kind || 'word';
          let r;
          if (k === 'choice') {
            const cs = S.choices.map((c, i) => [i, c, (S.counts || [])[i] || 0]);
            if (S.answer != null) r = `정답률 ${pct((S.counts || [])[S.answer] || 0, S.n)}%(정답: ${S.choices[S.answer]})`;
            else r = cs.slice().sort((a, b) => b[2] - a[2]).slice(0, 3).map(([i, c, n]) => `${CIRC[i]} ${c} ${pct(n, S.n)}%`).join(', ');
          } else if (k === 'text') r = `한 줄 답 ${S.n}건`;
          else r = 'Top ' + (S.words || []).filter(w => !(S.hidden || []).includes(w[0])).slice(0, 5).map(([w, c]) => `${w}(${c})`).join('·');
          items.push(`☞ ${p.q} → ${r} [응답 ${S.n}명]`);
        });
      }
      sections.push({ head: '교육 중 소통', items });
    }
    sections.push({ head: '향후 계획', items: ['운영 결과와 만족도 의견을 다음 교육·행사 기획에 반영 (○○)', '출석부·만족도·질문 기록 엑셀 보관(행사 기록은 사이트에서 자동 삭제)',
      '※ 이 보고서 초안은 「중랑출석부」 기록으로 자동 작성하였으며, ○○ 부분은 담당자가 보완'] });
    const days = rows.length ? (rows.length === 1 ? fmtDay(rows[0].s.started_at) : `${fmtDay(rows[0].s.started_at)}~${fmtDay(rows[rows.length - 1].s.started_at, false)}`) : '';
    const resTxt = anonEv || !nR ? `${total}명 참석` : `출석률 ${rows.length > 1 ? avgPct : pct(rows[0] ? rows[0].ins.length : 0, nR)}%(${rows.length > 1 ? '연인원 ' : ''}${total}명)`;
    const summary = `「${title}」${josa(title, '을', '를')} ${days ? days + ' ' : ''}운영한 결과 ${resTxt}${star != null ? `, 만족도 ${star.toFixed(1)}점(5점 만점)` : ''}${qn.length ? `, 교육 중 질문 ${qn.length}건` : ''}으로 마무리하였기에 그 결과를 보고드림`;
    const now = new Date().toISOString();
    return { title: `「${title}」 결과 보고`, date: fmtDay(now), contact: `${cfg.org || '○○과'}장:○○○ ☎ ○○○○  담당:○○○ ☎ ○○○○`, summary, sections };
  }

  async function build(x) {
    const res = await fetch('assets/report_base.hwpx?v=20261118'); if (!res.ok) throw new Error('보고서 서식을 불러오지 못했어요');
    const zip = fflate.unzipSync(new Uint8Array(await res.arrayBuffer()));
    const dec = u => fflate.strFromU8(u), enc = s => fflate.strToU8(s);
    const sec = dec(zip['Contents/section0.xml']);
    const headOpen = sec.slice(0, sec.indexOf('<hp:p '));
    const secPr = sec.match(/<hp:secPr [\s\S]*?<\/hp:secPr>/)[0];
    const logo = sec.match(/<hp:pic [\s\S]*?<\/hp:pic>/)[0];
    const spec = makeSpec(x);
    const colPr = '<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>';
    const first = `<hp:p id="0" paraPrIDRef="${PID.center}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${CID.base}">${secPr}${colPr}</hp:run>`
      + `<hp:run charPrIDRef="${CID.base}">${titleBlock(spec, logo)}</hp:run><hp:run charPrIDRef="${CID.base}"/></hp:p>`;
    const out = {};
    // mimetype은 압축 없이 맨 앞에
    out['mimetype'] = [zip['mimetype'], { level: 0 }];
    Object.keys(zip).forEach(k => {
      if (k === 'mimetype') return;
      if (k === 'Contents/section0.xml') out[k] = enc(headOpen + [first, tblPara(summaryBlock(spec.summary)), ...body(spec)].join('') + '</hs:sec>');
      else if (k === 'Preview/PrvText.txt') out[k] = enc(spec.title + '\n' + spec.summary);
      else if (k === 'Contents/content.hpf') out[k] = enc(dec(zip[k]).replace(/<opf:title>[^<]*<\/opf:title>|<opf:title\/>/, `<opf:title>${esc(spec.title)}</opf:title>`));
      else out[k] = zip[k];
    });
    return { bytes: fflate.zipSync(out, { level: 6 }), spec };
  }
  window.Report = { build, makeSpec };
})();
