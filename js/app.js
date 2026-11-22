/* =========================================================
   mathS · 应用逻辑（纯前端 / localStorage / 静态可部署）
   ========================================================= */
(function () {
  'use strict';

  var BANK = window.MATH_BANK;
  var app = document.getElementById('app');
  if (!BANK || !app) return;

  /* ---------- 基础工具 ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmt(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return fmt(new Date()); }
  function stars(n) { return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); }
  function uid() { return 'u-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }

  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  /* ---------- 存储 ---------- */
  var K = {
    custom: 'maths_custom_v1',
    progress: 'maths_progress_v1',
    daily: 'maths_daily_v1',
    days: 'maths_days_v1'
  };
  function getK(k, d) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }
    catch (e) { return d; }
  }
  function setK(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { toast('本地存储空间不足，请删掉部分图片或补充题'); return false; }
  }

  var custom = getK(K.custom, []);
  var progress = getK(K.progress, { learned: {}, answers: {}, states: {} });
  if (!progress.learned) progress.learned = {};
  if (!progress.answers) progress.answers = {};
  if (!progress.states) progress.states = {};

  function allQuestions() { return BANK.questions.concat(custom); }
  function qById(id) {
    return allQuestions().filter(function (q) { return q.id === id; })[0];
  }
  function catById(id) {
    return BANK.categories.filter(function (c) { return c.id === id; })[0];
  }
  function levelById(id) {
    return BANK.levels.filter(function (l) { return l.id === id; })[0];
  }
  function poolOf(level) {
    return allQuestions().filter(function (q) {
      return q.level === level && q.status !== 'placeholder';
    });
  }

  /* ---------- 知识点 / 答题 ---------- */
  function isLearned(kp) { return !!progress.learned[kp]; }
  function toggleLearned(kp) {
    progress.learned[kp] = !progress.learned[kp];
    setK(K.progress, progress);
    toast(progress.learned[kp] ? '已标记为「已学」' : '已标记为「未学」');
    render();
  }
  function answerOf(id) { return progress.answers[id]; }
  function recordAnswer(id, r) {
    progress.answers[id] = { r: r, ts: Date.now() };
    var s = stateOf(id);
    s.attempts.push({ r: r, ts: Date.now() });
    setK(K.progress, progress);
    checkDailyDone();
  }

  /* ---------- 错题本 / 四色状态点 ----------
     状态点语义：
       不标   —— 还没做过
       红点   —— 做错 / 不会（最近一次未答对）
       绿点   —— 做对了（还没达成黄点条件）
       黄点   —— 曾经做错 → 重做做对 + 两道举一反三全对（已掌握）
  */
  function stateOf(id) {
    if (!progress.states[id]) progress.states[id] = { attempts: [], drills: [null, null] };
    var s = progress.states[id];
    if (!s.attempts) s.attempts = [];
    if (!s.drills || s.drills.length < 2) s.drills = [s.drills && s.drills[0], s.drills && s.drills[1]];
    return s;
  }
  function everWrong(id) {
    var s = progress.states[id];
    if (s && s.attempts.length) {
      return s.attempts.some(function (x) { return x.r === 'wrong' || x.r === 'dontknow'; });
    }
    // 兼容旧数据：只有 answers 没有 attempts
    var a = answerOf(id);
    return !!(a && (a.r === 'wrong' || a.r === 'dontknow'));
  }
  function drillsAllRight(q) {
    var s = progress.states[q.id];
    var ds = (q.drills || []).length;
    if (!s || ds < 2) return false;
    return s.drills[0] === true && s.drills[1] === true;
  }
  function dotOf(id) {
    var s = progress.states[id];
    var a = answerOf(id);
    if (!s || !s.attempts.length) return a ? (a.r === 'correct' ? 'green' : 'red') : '';
    var last = s.attempts[s.attempts.length - 1];
    var q = qById(id);
    if (everWrong(id) && last.r === 'correct' && q && drillsAllRight(q)) return 'yellow';
    return last.r === 'correct' ? 'green' : 'red';
  }
  function dotHtml(id, withLabel) {
    var st = dotOf(id);
    if (!st) return '';
    var label = st === 'yellow' ? '已掌握' : st === 'green' ? '做对' : '错题';
    return '<span class="qdot ' + st + '" title="' + label + '"></span>' +
      (withLabel ? '<span class="small muted">' + label + '</span>' : '');
  }
  function wrongQuestions() {
    return allQuestions().filter(function (q) { return everWrong(q.id); });
  }
  function recordDrill(id, idx, ok) {
    var s = stateOf(id);
    s.drills[idx] = !!ok;
    setK(K.progress, progress);
  }

  /* ---------- 打卡（当天固定 2 题） ---------- */
  function dailyFor(level) {
    var all = getK(K.daily, {});
    var rec = all[level];
    var t = today();
    if (!rec || rec.date !== t || !rec.ids || rec.ids.length < 2) {
      var picks = pickTwo(poolOf(level));
      rec = { date: t, ids: picks.map(function (q) { return q.id; }), swaps: 0 };
      all[level] = rec;
      setK(K.daily, all);
    }
    // 若题目被删除，补齐
    var valid = rec.ids.filter(function (id) { return !!qById(id); });
    if (valid.length < 2) {
      var pool = poolOf(level).filter(function (q) { return valid.indexOf(q.id) < 0; });
      while (valid.length < 2 && pool.length) valid.push(pool.shift().id);
      rec.ids = valid;
      all[level] = rec;
      setK(K.daily, all);
    }
    return rec;
  }
  function pickTwo(pool) {
    if (pool.length <= 2) return pool.slice(0, 2);
    var arr = pool.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    // 尽量取不同分类
    var a = arr[0], b = null;
    for (var k = 1; k < arr.length; k++) {
      if (arr[k].categoryId !== a.categoryId) { b = arr[k]; break; }
    }
    return [a, b || arr[1]];
  }
  function swapQuestion(level, slot) {
    var all = getK(K.daily, {});
    var rec = all[level];
    if (!rec) return;
    var current = rec.ids[slot];
    var pool = poolOf(level).filter(function (q) {
      return q.id !== current && rec.ids.indexOf(q.id) < 0;
    });
    if (!pool.length) { toast('题库里暂时没有可替换的题目'); return; }
    var q = pool[Math.floor(Math.random() * pool.length)];
    rec.ids[slot] = q.id;
    rec.swaps = (rec.swaps || 0) + 1;
    all[level] = rec;
    setK(K.daily, all);
    toast('已换一道新题');
    render();
  }
  function checkDailyDone() {
    var level = currentLevel();
    var rec = dailyFor(level);
    var done = rec.ids.every(function (id) { return !!answerOf(id); });
    if (done) {
      var days = getK(K.days, []);
      if (days.indexOf(today()) < 0) { days.push(today()); setK(K.days, days); }
    }
  }
  function streakDays() {
    var days = getK(K.days, []);
    if (!days.length) return 0;
    var set = {};
    days.forEach(function (d) { set[d] = 1; });
    var d = new Date();
    if (!set[fmt(d)]) { d.setDate(d.getDate() - 1); if (!set[fmt(d)]) return 0; }
    var n = 0;
    while (set[fmt(d)]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  /* ---------- 判题 ---------- */
  function normalize(s) {
    return String(s == null ? '' : s)
      .replace(/[\uFF01-\uFF5E]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[\s,，.。;；:：!！?？、'"“”‘’()（）]/g, '')
      .toLowerCase();
  }
  function judge(q, input) {
    // 兼容题目对象（带 answer 字段）与练习对象（correct/accept 平铺）
    var a = q.answer || (q.correct !== undefined ? q : {});
    if (a.type === 'choice') {
      return normalize(input) === normalize(a.correct);
    }
    if (a.type === 'number') {
      var n = parseFloat(String(input).replace(/[^\d.\-]/g, ''));
      var c = parseFloat(String(a.correct).replace(/[^\d.\-]/g, ''));
      if (!isNaN(n) && !isNaN(c)) return Math.abs(n - c) < 1e-6;
      // 退回文本比较
    }
    var accepts = [a.correct].concat(a.accept || []);
    var v = normalize(input);
    for (var i = 0; i < accepts.length; i++) {
      if (v && v === normalize(accepts[i])) return true;
    }
    return false;
  }

  /* ---------- 路由 ---------- */
  function parseRoute() {
    return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  }
  function currentLevel() {
    var p = parseRoute();
    var guess = p[1] || p[0];
    return levelById(guess) ? guess : 'L_a';
  }
  function navTo(path) { location.hash = '#' + path; }

  /* =========================================================
     视图
     ========================================================= */
  function viewHome() {
    var total = poolOf('L_a').length;
    var kpCount = Object.keys(progress.learned).filter(function (k) { return progress.learned[k]; }).length;
    var rec = dailyFor('L_a');
    var cards = rec.ids.map(function (id, i) {
      var q = qById(id);
      if (!q) return '';
      var ans = answerOf(id);
      var dot = dotOf(id);
      var st = ans ? (ans.r === 'correct' ? 'ok' : ans.r === 'dontknow' ? 'dontknow' : 'err') : '';
      return '<article class="card daily-card">' +
        '<div class="top"><span class="slot">第 ' + (i + 1) + ' 题</span>' +
        '<span class="badge star">' + stars(q.star) + '</span>' +
        (dot ? '<span class="qdot ' + dot + '"></span>' : '') +
        (ans ? '<span class="badge ' + (dot === 'yellow' ? 'mastered' : st === 'ok' ? 'ok' : st === 'err' ? 'err' : 'warn') + '">' +
          (dot === 'yellow' ? '已掌握' : st === 'ok' ? '已做对' : st === 'err' ? '做错了' : '看过讲解') + '</span>' : '<span class="badge gray">未作答</span>') +
        '</div>' +
        '<h3>' + esc((q.question.text || '').slice(0, 54)) + ((q.question.text || '').length > 54 ? '…' : '') + '</h3>' +
        '<div class="meta">' + esc(catById(q.categoryId) ? catById(q.categoryId).name : q.categoryId) + ' · ' + esc(q.knowledgePoint) + '</div>' +
        '<div class="bottom"><a class="btn btn-sm" href="#/q/L_a/' + encodeURIComponent(id) + '">' + (ans ? '再看一题' : '开始做题') + '</a></div>' +
        '</article>';
    }).join('');

    return '' +
      '<section class="hero">' +
        '<div class="hero-tag">五年级数学 · L_a 题库</div>' +
        '<h1>每天两题，思维每天都进步</h1>' +
        '<p>按课程分类练习，做题后立刻看讲解、原题和举一反三。题库题目持续补充，支持拍照录入，数据保存在你自己的浏览器里。</p>' +
        '<div class="hero-actions row">' +
          '<a class="btn btn-lg" href="#/checkin">开始今日打卡</a>' +
          '<a class="btn btn-lg btn-ghost" href="#/bank">浏览题库</a>' +
          (wrongQuestions().length ? '<a class="btn btn-lg btn-ghost" href="#/wrong">错题本（' + wrongQuestions().length + '）</a>' : '') +
        '</div>' +
      '</section>' +
      '<div class="grid grid-4 stats">' +
        '<div class="stat"><div class="stat-num">' + total + '</div><div class="stat-label">L_a 可用题</div></div>' +
        '<div class="stat"><div class="stat-num">' + BANK.categories.length + '</div><div class="stat-label">课程分类</div></div>' +
        '<div class="stat"><div class="stat-num">' + kpCount + '</div><div class="stat-label">已学知识点</div></div>' +
        '<div class="stat"><div class="stat-num">' + streakDays() + '</div><div class="stat-label">连续打卡天数</div></div>' +
      '</div>' +
      '<div class="sec-title">今日打卡 <a class="more" href="#/checkin">查看全部 →</a></div>' +
      '<div class="grid grid-2">' + cards + '</div>' +
      '<div class="sec-title">按课程分类练习 <a class="more" href="#/bank">全部 15 类 →</a></div>' +
      '<div class="grid grid-3">' + BANK.categories.slice(0, 6).map(catCard).join('') + '</div>' +
      '<div class="notice mt24">' + esc(BANK.meta.disclaimer) + '</div>';
  }

  function catCard(c) {
    var cnt = poolOf(c.level).filter(function (q) { return q.categoryId === c.id; }).length;
    return '<a class="cat-card" href="#/bank/' + encodeURIComponent(c.level) + '/' + encodeURIComponent(c.id) + '">' +
      '<div class="spread"><span class="cat-index">' + pad(c.index) + '</span>' +
      (c.pendingVerify ? '<span class="badge warn tiny">分类待核对</span>' : '') + '</div>' +
      '<h3>' + esc(c.name) + '</h3>' +
      '<p>' + esc(c.desc) + '</p>' +
      '<div class="foot"><span class="badge">' + cnt + ' 道可用题</span><span class="badge gray">4★ / 5★</span></div>' +
      '</a>';
  }

  function viewCheckin() {
    var rec = dailyFor('L_a');
    var doneCount = rec.ids.filter(function (id) { return !!answerOf(id); }).length;
    var cards = rec.ids.map(function (id, i) {
      var q = qById(id);
      if (!q) return '';
      var ans = answerOf(id);
      var learned = isLearned(q.knowledgePoint);
      return '<article class="card daily-card">' +
        '<div class="top"><span class="slot">第 ' + (i + 1) + ' 题</span>' +
        '<span class="badge star">' + stars(q.star) + '</span>' +
        '<span class="badge gray">' + esc(catById(q.categoryId) ? catById(q.categoryId).name : '') + '</span>' +
        (!learned ? '<span class="badge warn">知识点未学</span>' : '<span class="badge ok">知识点已学</span>') +
        '</div>' +
        '<h3>' + esc((q.question.text || '').slice(0, 70)) + ((q.question.text || '').length > 70 ? '…' : '') + '</h3>' +
        '<div class="meta">知识点：' + esc(q.knowledgePoint) + ' · 来源：' + esc(q.source) + '</div>' +
        '<div class="bottom">' +
          '<a class="btn btn-sm" href="#/q/L_a/' + encodeURIComponent(id) + '">' + (ans ? '查看 / 重做' : '开始做题') + '</a>' +
          (!learned ? '<button class="btn btn-sm btn-ghost" data-act="swap" data-slot="' + i + '" data-level="L_a">换一个</button>' : '') +
          '<button class="btn btn-sm btn-soft" data-act="learn" data-kp="' + esc(q.knowledgePoint) + '">' + (learned ? '取消已学' : '标记已学') + '</button>' +
        '</div>' +
        '</article>';
    }).join('');

    return '' +
      '<div class="page-head"><h1>每日打卡</h1><p>' + today() + ' · 今天的两道题已固定，刷新页面不会改变</p></div>' +
      (doneCount === 2 ? '<div class="notice">今天的 2 题都完成了，继续保持！明天会有新题。</div>' :
        '<div class="notice">今日进度：' + doneCount + ' / 2 题。遇到还没学过的知识点，可以点「换一个」。</div>') +
      '<div class="grid grid-2 mt16">' + cards + '</div>' +
      '<div class="card mt16"><div class="spread"><div><strong>连续打卡：' + streakDays() + ' 天</strong>' +
      '<div class="small muted mt8">两道题都作答后自动记为当天打卡。记录保存在本机浏览器。</div></div>' +
      '<a class="btn btn-ghost btn-sm" href="#/about">查看说明</a></div></div>';
  }

  function viewWrongBook() {
    var qs = wrongQuestions();
    var mastered = qs.filter(function (q) { return dotOf(q.id) === 'yellow'; }).length;
    var pending = qs.length - mastered;
    var rows = qs.map(function (q) {
      var st = dotOf(q.id);
      var label = st === 'yellow' ? '已掌握' : st === 'green' ? '做对了' : '待攻克';
      var cls = st === 'yellow' ? 'ok' : st === 'green' ? 'ok' : 'err';
      var c = catById(q.categoryId);
      return '<article class="q-row wrong-row">' +
        '<span class="qdot-lg ' + (st || 'red') + '"></span>' +
        '<div class="body">' +
          '<div class="row tiny" style="gap:6px"><span class="badge star">' + stars(q.star) + '</span>' +
          '<span class="badge ' + cls + '">' + label + '</span>' +
          '<span class="badge gray">' + esc(c ? c.name : q.categoryId) + '</span></div>' +
          '<h4>' + esc((q.question.text || '').slice(0, 90)) + ((q.question.text || '').length > 90 ? '…' : '') + '</h4>' +
          '<p>' + esc(q.knowledgePoint) + ' · ' + dotProgressText(q) + '</p>' +
        '</div>' +
        '<a class="btn btn-sm" href="#/q/' + encodeURIComponent(q.level) + '/' + encodeURIComponent(q.id) + '">' +
          (st === 'yellow' ? '再看一遍' : '再做一遍') + '</a>' +
      '</article>';
    }).join('');

    return '' +
      '<div class="page-head"><h1>错题本</h1><p>所有做错或看过讲解的题都在这里。重做做对，再把两道举一反三都做对，就能点亮黄点。</p></div>' +
      '<div class="grid grid-3 stats">' +
        '<div class="stat"><div class="stat-num">' + qs.length + '</div><div class="stat-label">错题总数</div></div>' +
        '<div class="stat"><div class="stat-num">' + pending + '</div><div class="stat-label">待攻克</div></div>' +
        '<div class="stat"><div class="stat-num">' + mastered + '</div><div class="stat-label">已掌握（黄点）</div></div>' +
      '</div>' +
      '<div class="notice mt16"><span class="qdot red"></span> 红点＝还没攻克　<span class="qdot green"></span> 绿点＝最近做对了　' +
      '<span class="qdot yellow"></span> 黄点＝重做做对 + 两道举一反三全对（真正掌握）</div>' +
      '<div class="data-list mt16">' + (rows || '<div class="empty"><h3>还没有错题</h3><p>去做几道题吧，做错的题会自动收进这里。</p><a class="btn" href="#/checkin">开始打卡</a></div>') + '</div>';
  }

  function dotProgressText(q) {
    var s = progress.states[q.id];
    if (!s) return '还没重做';
    var d0 = s.drills[0] === true ? '✓' : '·';
    var d1 = s.drills[1] === true ? '✓' : '·';
    return '举一反三 ' + d0 + ' ' + d1;
  }

  function viewBank(level) {
    level = levelById(level) ? level : 'L_a';
    var tabs = BANK.levels.map(function (l) {
      return '<button class="level-tab ' + (l.id === level ? 'active' : '') + (l.status === 'planned' ? ' planned' : '') +
        '" data-act="level" data-level="' + l.id + '">' + l.name +
        (l.status === 'planned' ? ' · 待开放' : '') + '</button>';
    }).join('');
    var lv = levelById(level);
    return '' +
      '<div class="page-head"><h1>题库</h1><p>' + esc(BANK.meta.levelNote) + '</p></div>' +
      '<div class="level-tabs">' + tabs + '</div>' +
      '<div class="notice">' + esc(lv.desc) + ' · 共 ' + poolOf(level).length + ' 道可用题。' +
      (level === 'L_a' ? ' ' + esc(BANK.meta.sourceNote) + ' <a href="' + esc(BANK.meta.sourceUrl) + '" target="_blank" rel="noopener">查看分类参考来源</a>' : '') +
      '</div>' +
      '<div class="grid grid-3 mt16">' + BANK.categories.map(catCard).join('') + '</div>';
  }

  function viewQuestions(level, catId) {
    var c = catById(catId);
    if (!c) return '<div class="empty"><h3>没有找到这个分类</h3><a class="btn" href="#/bank">返回题库</a></div>';
    var qs = allQuestions().filter(function (q) { return q.level === level && q.categoryId === catId; });
    var rows = qs.map(function (q) {
      var ans = answerOf(q.id);
      var status = q.status === 'placeholder' ? '<span class="badge warn">待补充</span>' :
        q.status === 'demo' ? '<span class="badge">演示题</span>' : '<span class="badge ok">改编题</span>';
      var result = ans ? (ans.r === 'correct' ? '<span class="badge ok">做对</span>' :
        ans.r === 'dontknow' ? '<span class="badge warn">看过讲解</span>' : '<span class="badge err">做错</span>') : '';
      var link = q.status === 'placeholder' ? '#/add' : '#/q/' + encodeURIComponent(level) + '/' + encodeURIComponent(q.id);
      return '<a class="q-row" href="' + link + '">' +
        (dotOf(q.id) ? '<span class="qdot-lg ' + dotOf(q.id) + '"></span>' : '<span class="qdot-lg none"></span>') +
        '<span class="badge star">' + stars(q.star) + '</span>' +
        '<div class="body"><div class="row tiny" style="gap:6px">' + status + result +
        '<span class="badge gray">' + esc(q.knowledgePoint) + '</span></div>' +
        '<h4>' + esc(q.question.text || '（这道题还没录入，点此拍照补充）') + '</h4>' +
        '<p>' + esc(q.source) + '</p></div>' +
        '<span class="muted">›</span></a>';
    }).join('');
    return '' +
      '<div class="crumb"><a href="#/bank">题库</a> / ' + esc(c.name) + '</div>' +
      '<div class="page-head"><h1>第 ' + pad(c.index) + ' 讲 · ' + esc(c.name) + '</h1><p>' + esc(c.desc) + '</p></div>' +
      '<div class="notice">' + esc(BANK.meta.disclaimer) + '</div>' +
      '<div class="data-list mt16">' + (rows || '<div class="empty">暂无题目</div>') + '</div>' +
      '<div class="mt16"><a class="btn btn-ghost btn-sm" href="#/bank">← 返回题库</a></div>';
  }

  function mediaHtml(m) {
    m = m || {};
    var html = '';
    if (m.text) html += '<div class="q-text">' + nl2br(m.text) + '</div>';
    if (m.images && m.images.length) {
      html += '<div class="media-list">' + m.images.map(function (src) {
        return '<img src="' + esc(src) + '" alt="题目图片" loading="lazy" />';
      }).join('') + '</div>';
    }
    return html || '<div class="muted">（暂无内容）</div>';
  }
  function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }

  function resultHtml(q, r) {
    var a = q.answer || {};
    var s = q.solution || {};
    var head, cls;
    if (r === 'dontknow') { cls = 'dontknow'; head = '已为你展示讲解 —— 看懂了再试着自己做一遍'; }
    else if (r === 'correct') { cls = 'ok'; head = '回答正确，很棒！'; }
    else { cls = 'err'; head = '这次没答对，看看讲解吧'; }
    var steps = (s.steps && s.steps.length)
      ? '<ol class="steps">' + s.steps.map(function (x) { return '<li>' + nl2br(x) + '</li>'; }).join('') + '</ol>'
      : '<div class="muted">（讲解待补充）</div>';
    return '<div class="result-panel">' +
      '<div class="result-head ' + cls + '">' + (cls === 'ok' ? '✓' : cls === 'err' ? '✕' : '!') + ' ' + head + '</div>' +
      '<div class="result-body">' +
        '<div class="block"><h5>正确答案</h5><div class="q-text" style="font-size:15px">' + esc(a.correct || '（待补充）') + '</div></div>' +
        '<div class="block"><h5>讲解</h5>' + steps +
          (s.note ? '<div class="explain-note">' + nl2br(s.note) + '</div>' : '') + '</div>' +
        '<div class="block"><h5>原题</h5>' + mediaHtml(q.original) + '</div>' +
        '<div class="block"><h5>举一反三</h5>' + mediaHtml(q.followUp) + '</div>' +
      '</div></div>';
  }

  // 错题重做时的两道举一反三练习（可提交判分）
  function drillsHtml(q) {
    var drills = q.drills || [];
    if (!drills.length) return '';
    var s = stateOf(q.id);
    var solved = s.drills.filter(function (x) { return x === true; }).length;
    var allOk = drillsAllRight(q);
    var rows = drills.map(function (d, i) {
      var ok = s.drills[i] === true;
      var wrong = s.drills[i] === false;
      return '<div class="drill-item">' +
        '<div class="drill-head"><span class="drill-n">举一反三 ' + (i + 1) + '</span>' +
        (ok ? '<span class="badge ok">✓ 做对</span>' : wrong ? '<span class="badge err">✕ 再做一次</span>' : '<span class="badge gray">待作答</span>') + '</div>' +
        (d.text ? '<div class="q-text">' + nl2br(d.text) + '</div>' : mediaHtml(d)) +
        (ok ? '' :
          '<div class="row mt8">' +
            '<input class="input-answer drill-input" type="text" id="drill_' + i + '" placeholder="输入你的答案" />' +
            '<button class="btn btn-sm" data-act="drill" data-q="' + esc(q.id) + '" data-i="' + i + '">提交</button>' +
          '</div>' +
          (d.hint ? '<div class="small muted mt8">提示：' + esc(d.hint) + '</div>' : '')) +
      '</div>';
    }).join('');
    return '<div class="card mt16 drills-card">' +
      '<div class="panel-title"><span class="n">3</span> 举一反三练习 ' +
        '<span class="badge ' + (allOk ? 'ok' : '') + '">' + solved + ' / ' + drills.length + ' 做对</span></div>' +
      '<p class="small muted">把两道都做对，配合上面的重做做对，这道题就能点亮 <span class="qdot yellow"></span> 黄点。</p>' +
      '<div class="drill-list">' + rows + '</div>' +
      (allOk ? '<div class="notice mt12">两道举一反三都做对了，厉害！' +
        (dotOf(q.id) === 'yellow' ? ' 这道题已点亮黄点（完全掌握）。' : ' 重做做对后即可点亮黄点。') + '</div>' : '') +
      '</div>';
  }

  function answerArea(q) {
    var a = q.answer || {};
    var id = q.id;
    if (a.type === 'choice' && a.options && a.options.length) {
      return '<div class="option-list">' + a.options.map(function (o, i) {
        return '<label class="option"><input type="radio" name="opt_' + esc(id) + '" value="' + esc(o) + '" /> ' + nl2br(o) + '</label>';
      }).join('') + '</div>';
    }
    return '<input class="input-answer" type="text" id="answerInput" placeholder="在这里输入你的答案" autocomplete="off" />';
  }

  function viewSolve(level, qid) {
    var q = qById(qid);
    if (!q) return '<div class="empty"><h3>没有找到这道题</h3><a class="btn" href="#/checkin">返回打卡</a></div>';
    var c = catById(q.categoryId);
    var ans = answerOf(q.id);
    var learned = isLearned(q.knowledgePoint);
    var rec = null;
    if (level === 'L_a') {
      var d = getK(K.daily, {})[level];
      if (d && d.date === today() && d.ids.indexOf(q.id) >= 0) rec = d;
    }
    var slot = rec ? rec.ids.indexOf(q.id) : -1;
    var placeholder = q.status === 'placeholder';
    var main = placeholder
      ? '<div class="notice warn">这道题还没有录入。你可以 <a href="#/add">拍照补充题目</a> 后再来做。</div>'
      : '<div class="card">' +
          '<div class="panel-title"><span class="n">1</span> 原题</div>' +
          mediaHtml(q.question) +
          '<div class="answer-area">' +
            '<div class="panel-title"><span class="n">2</span> 你的答案</div>' +
            answerArea(q) +
            '<div class="row mt16">' +
              '<button class="btn" data-act="submit" data-q="' + esc(q.id) + '">提交答案</button>' +
              '<button class="btn btn-ghost" data-act="dontknow" data-q="' + esc(q.id) + '">我不会</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        (ans ? resultHtml(q, ans.r) : '') +
        (ans && everWrong(q.id) ? drillsHtml(q) : '');

    var side = '<div class="card">' +
      '<h4>题目信息</h4>' +
      '<div class="row tiny" style="gap:6px"><span class="badge star">' + stars(q.star) + '</span>' +
      '<span class="badge gray">' + esc(placeholder ? '待补充' : q.status === 'demo' ? '演示题' : '改编题') + '</span></div>' +
      '<dl class="kv mt12">' +
        '<dt>课程</dt><dd>' + esc(c ? ('第' + pad(c.index) + '讲 ' + c.name) : q.categoryId) + '</dd>' +
        '<dt>知识点</dt><dd>' + esc(q.knowledgePoint) + '</dd>' +
        '<dt>来源</dt><dd class="small">' + esc(q.source) + '</dd>' +
      '</dl>' +
      '<div class="mt16"><button class="btn btn-sm ' + (learned ? 'btn-soft' : 'btn-ghost') + ' btn-block" data-act="learn" data-kp="' + esc(q.knowledgePoint) + '">' +
        (learned ? '✓ 已学（点击取消）' : '标记为已学') + '</button></div>' +
      (slot >= 0 && rec ? '<div class="mt8"><button class="btn btn-sm btn-ghost btn-block" data-act="swap" data-slot="' + slot + '" data-level="' + esc(level) + '">换一个</button></div>' : '') +
      '<div class="mt8"><a class="btn btn-sm btn-ghost btn-block" href="#/bank/' + encodeURIComponent(level) + '/' + encodeURIComponent(q.categoryId) + '">同类题目</a></div>' +
      '</div>' +
      '<div class="card mt16"><h4>做题小贴士</h4>' +
      '<ul class="clean small">' +
      '<li>先自己想 3 分钟，再点「我不会」。</li>' +
      '<li>提交后会立刻显示对错、讲解和举一反三。</li>' +
      '<li>还没学的知识点可以用「换一个」跳过。</li>' +
      '</ul></div>';

    return '' +
      '<div class="crumb"><a href="#/checkin">每日打卡</a> / <a href="#/bank/' + encodeURIComponent(level) + '/' + encodeURIComponent(q.categoryId) + '">' + esc(c ? c.name : q.categoryId) + '</a></div>' +
      '<div class="page-head"><h1>做题</h1><p>' + esc(q.knowledgePoint) + ' · ' + stars(q.star) + '</p></div>' +
      '<div class="solve-grid"><div>' + main + '</div><div>' + side + '</div></div>';
  }

  function viewAdd() {
    var cats = BANK.categories.map(function (c) {
      return '<option value="' + c.id + '">' + pad(c.index) + ' ' + esc(c.name) + '</option>';
    }).join('');
    var lists = custom.length ? custom.map(function (q) {
      return '<div class="data-item"><span class="badge star">' + stars(q.star) + '</span>' +
        '<div class="body"><strong>' + esc((q.question.text || '').slice(0, 48)) + '</strong>' +
        '<span>' + esc(q.level) + ' · ' + esc(catById(q.categoryId) ? catById(q.categoryId).name : q.categoryId) + ' · ' + esc(q.source) + '</span></div>' +
        '<button class="btn btn-sm btn-danger-soft" data-act="del-custom" data-id="' + esc(q.id) + '">删除</button></div>';
    }).join('') : '<div class="muted small">还没有补充的题目。拍下教材题目，用下面的表单录入吧。</div>';

    return '' +
      '<div class="page-head"><h1>补充题目</h1><p>拍照录入题目；题目保存在本机浏览器，也可导出 JSON 用于部署到网站。</p></div>' +
      '<div class="notice">' + esc(BANK.meta.disclaimer) + ' 录入时请在「来源」里写清楚是教材原题、改编题还是自己出的题。</div>' +
      '<div class="card mt16">' +
        '<form id="addForm">' +
        '<div class="form-grid">' +
          '<div class="field"><label>题库等级</label><select name="level">' +
            BANK.levels.map(function (l) { return '<option value="' + l.id + '">' + l.name + '</option>'; }).join('') +
          '</select></div>' +
          '<div class="field"><label>课程分类</label><select name="categoryId">' + cats + '</select></div>' +
          '<div class="field"><label>难度星级</label><select name="star"><option value="4">4 星 ★★★★☆</option><option value="5">5 星 ★★★★★</option></select></div>' +
          '<div class="field"><label>知识点</label><input name="knowledgePoint" placeholder="例如：分数应用题" required /></div>' +
          '<div class="field full"><label>来源说明 <span class="hint">必填，请如实标注</span></label><input name="source" placeholder="例如：学而思《五年级思维向导》P12 第3题（拍照原题）" required /></div>' +
          '<div class="field full"><label>原题内容</label><textarea name="questionText" placeholder="把题目文字打出来；也可以只传图片" required></textarea></div>' +
          '<div class="field full"><label>原题图片 <span class="hint">可多选，会自动压缩后存在本机</span></label>' +
            '<div class="upload-zone" id="uploadZone">点击选择题目照片（JPG / PNG）</div>' +
            '<input type="file" id="imageInput" accept="image/*" multiple hidden />' +
            '<div class="preview-imgs" id="previewImgs"></div></div>' +
          '<div class="field"><label>答案类型</label><select name="answerType">' +
            '<option value="text">文字 / 填空</option><option value="number">数字</option><option value="choice">选择题</option>' +
          '</select></div>' +
          '<div class="field"><label>正确答案</label><input name="correct" placeholder="标准答案" required /></div>' +
          '<div class="field full"><label>可接受答案 <span class="hint">选填，用英文逗号分隔，例如 10,10米</span></label><input name="accept" placeholder="10,10米" /></div>' +
          '<div class="field full" id="optionsField" style="display:none"><label>选项 <span class="hint">选择题填写，每行一个</span></label><textarea name="options" placeholder="A. 10&#10;B. 12&#10;C. 15"></textarea></div>' +
          '<div class="field full"><label>讲解步骤 <span class="hint">每行一步</span></label><textarea name="steps" placeholder="第一步……&#10;第二步……" required></textarea></div>' +
          '<div class="field full"><label>讲解提示 <span class="hint">选填，易错点或小结</span></label><input name="note" placeholder="注意单位“1”不同" /></div>' +
          '<div class="field full"><label>举一反三</label><textarea name="followUp" placeholder="一道同类练习题"></textarea></div>' +
        '</div>' +
        '<div class="row mt16"><button type="submit" class="btn btn-lg">保存这道题</button>' +
        '<button type="button" class="btn btn-ghost" data-act="export">导出全部补充题 JSON</button>' +
        '<label class="btn btn-ghost" for="importInput">导入 JSON</label>' +
        '<input type="file" id="importInput" accept=".json,application/json" hidden />' +
        '<button type="button" class="btn btn-danger-soft" data-act="clear-custom">清空我的补充</button></div>' +
        '</form>' +
      '</div>' +
      '<div class="sec-title">我补充的题目 <span class="badge">' + custom.length + '</span></div>' +
      '<div class="data-list">' + lists + '</div>';
  }

  function viewAbout() {
    return '' +
      '<div class="page-head"><h1>说明</h1><p>题库来源、等级规划与使用方法</p></div>' +
      '<div class="card">' +
        '<div class="panel-title"><span class="n">1</span> 题库等级</div>' +
        '<dl class="kv">' +
          '<dt>L_a</dt><dd>当前题库，按五年级 S 班课程体系整理 15 个分类，每类含 4★ / 5★ 题。</dd>' +
          '<dt>L_b / L_c</dt><dd>预留等级，结构已就绪。在「补充题目」页选择等级即可提前录入。</dd>' +
        '</dl>' +
        '<div class="panel-title mt24"><span class="n">2</span> 题目来源</div>' +
        '<ul class="clean">' +
          '<li><strong>分类骨架</strong>参考学而思五年级目标 S 班公开课程目录（史乐老师，2020 秋 / 2021 寒 / 2021 春），' +
            '<a href="' + esc(BANK.meta.sourceUrl) + '" target="_blank" rel="noopener">查看参考来源</a>。分类名称标记为「待核对」，请以你手上的《五年级思维向导》目录为准。</li>' +
          '<li><strong>题目</strong>为依据公开知识点编写的<strong>改编题（非教材原题）</strong>，在题干下方明确标注来源性质。' +
            '本站没有复制或引用未经核实的教材原题。</li>' +
          '<li><strong>待补充</strong>占位题保留在题库中，等待你拍照录入真实原题后替换。</li>' +
        '</ul>' +
        '<div class="panel-title mt24"><span class="n">3</span> 功能说明</div>' +
        '<ul class="clean">' +
          '<li>每日打卡：每天自动从题库随机抽 2 题，当天固定不变；两题都作答后记为当天打卡。</li>' +
          '<li>换一个：知识点未学时可换题，换题结果同样当天固定。</li>' +
          '<li>我不会：点击后直接展示讲解、原题和举一反三，并记为「看过讲解」。</li>' +
          '<li>提交答案：自动判断对错，随后展示讲解、原题和举一反三。</li>' +
          '<li>错题本：所有做错或看过讲解的题自动收录，可以在里面「再做一遍」，并附两道举一反三练习。</li>' +
          '<li>状态点：没做不标点；做错标红点；做对标绿点；<strong>重做做对 + 两道举一反三全对 = 黄点（完全掌握）</strong>。</li>' +
        '</ul>' +
        '<div class="panel-title mt24"><span class="n">4</span> 数据保存在哪里</div>' +
        '<p class="small">所有打卡、答题、知识点状态和补充题目都保存在当前浏览器的 localStorage 中，不会上传到服务器。' +
        '换浏览器或清理浏览器数据会丢失记录。需要长期保存请在「补充题目」页导出 JSON 备份。</p>' +
        '<div class="notice warn mt16">本站为个人学习工具。题目版权归原作者所有，请勿将教材原题用于公开传播或商业用途。</div>' +
      '</div>';
  }

  /* =========================================================
     事件
     ========================================================= */
  var pendingImages = [];
  function compressImage(file, cb) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var max = 1000, w = img.width, h = img.height;
        if (w > max || h > max) { var r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        cb(cv.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = function () { cb(null); };
      img.src = e.target.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  }

  function handleSubmit(e) {
    if (e.target.id !== 'addForm') return;
    e.preventDefault();
    var f = e.target;
    var v = function (n) { return (f.elements[n] || {}).value || ''; };
    var level = v('level'), catId = v('categoryId');
    var correct = v('correct').trim();
    if (!v('questionText').trim() || !correct) { toast('请填写原题和正确答案'); return; }
    var q = {
      id: uid(),
      level: level,
      categoryId: catId,
      star: parseInt(v('star'), 10) || 4,
      status: 'custom',
      source: v('source').trim(),
      knowledgePoint: v('knowledgePoint').trim(),
      question: { text: v('questionText').trim(), images: pendingImages.slice() },
      answer: {
        type: v('answerType'), options: v('options').split('\n').map(function (s) { return s.trim(); }).filter(Boolean),
        correct: correct, accept: v('accept').split(',').map(function (s) { return s.trim(); }).filter(Boolean)
      },
      solution: { steps: v('steps').split('\n').map(function (s) { return s.trim(); }).filter(Boolean), note: v('note').trim() },
      original: { text: v('questionText').trim(), images: pendingImages.slice() },
      followUp: { text: v('followUp').trim(), images: [] },
      createdAt: today(), updatedAt: today()
    };
    custom.push(q);
    if (!setK(K.custom, custom)) { custom.pop(); return; }
    f.reset();
    pendingImages = [];
    $('#previewImgs').innerHTML = '';
    $('#optionsField').style.display = 'none';
    toast('题目已保存');
    navTo('bank/' + level + '/' + catId);
  }

  function exportCustom() {
    var blob = new Blob([JSON.stringify(custom, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mathS-supplements.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('已导出 ' + custom.length + ' 道题');
  }

  function bindView() {
    // 导航高亮
    var parts = parseRoute();
    var view = parts[0] || 'home';
    $$('.site-nav a').forEach(function (a) { a.classList.remove('active'); });
    var nav = $('.site-nav a[data-nav="' + view + '"]');
    if (nav) nav.classList.add('active');

    // 文件输入
    var imageInput = $('#imageInput');
    if (imageInput) {
      imageInput.onchange = function () {
        var files = Array.prototype.slice.call(this.files || []);
        if (!files.length) return;
        files.forEach(function (file) {
          if (file.size > 5 * 1024 * 1024) { toast('图片太大（>5MB），请压缩后再传'); return; }
          compressImage(file, function (data) {
            if (!data) return;
            pendingImages.push(data);
            var box = $('#previewImgs');
            if (box) {
              var d = document.createElement('div');
              d.className = 'thumb';
              d.innerHTML = '<img src="' + data + '" alt="预览" /><button type="button" data-act="del-img" data-idx="' + (pendingImages.length - 1) + '">×</button>';
              box.appendChild(d);
            }
          });
        });
        this.value = '';
      };
      var zone = $('#uploadZone');
      if (zone) zone.onclick = function () { imageInput.click(); };
    }
    var importInput = $('#importInput');
    if (importInput) {
      importInput.onchange = function () {
        var file = (this.files || [])[0];
        if (!file) return;
        var r = new FileReader();
        r.onload = function (e) {
          try {
            var arr = JSON.parse(e.target.result);
            if (!Array.isArray(arr)) throw new Error('格式不正确');
            var ids = {};
            custom.forEach(function (q) { ids[q.id] = 1; });
            var added = 0;
            arr.forEach(function (q) {
              if (!q || !q.id || ids[q.id]) return;
              custom.push(q); ids[q.id] = 1; added++;
            });
            setK(K.custom, custom);
            toast('导入 ' + added + ' 道题');
            render();
          } catch (err) { toast('导入失败：JSON 格式不正确'); }
        };
        r.readAsText(file);
        this.value = '';
      };
    }
    var typeSel = $('[name="answerType"]');
    if (typeSel) {
      typeSel.onchange = function () {
        var el = $('#optionsField');
        if (el) el.style.display = this.value === 'choice' ? '' : 'none';
      };
    }
  }

  function handleClick(e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    if (act === 'level') { navTo('bank/' + el.getAttribute('data-level')); return; }
    if (act === 'swap') {
      swapQuestion(el.getAttribute('data-level') || currentLevel(), parseInt(el.getAttribute('data-slot'), 10));
      return;
    }
    if (act === 'learn') { toggleLearned(el.getAttribute('data-kp')); return; }
    if (act === 'submit') {
      var q = qById(el.getAttribute('data-q'));
      if (!q) return;
      var input;
      if ((q.answer || {}).type === 'choice') {
        var sel = $('input[name="opt_' + q.id + '"]:checked');
        input = sel ? sel.value : '';
      } else {
        var f = $('#answerInput');
        input = f ? f.value : '';
      }
      if (!String(input).trim()) { toast('请先填写答案，或点「我不会」'); return; }
      var ok = judge(q, input);
      recordAnswer(q.id, ok ? 'correct' : 'wrong');
      render();
      if (!ok) toast('答错了，下面有讲解');
      return;
    }
    if (act === 'dontknow') {
      recordAnswer(el.getAttribute('data-q'), 'dontknow');
      render();
      return;
    }
    if (act === 'drill') {
      var dq = qById(el.getAttribute('data-q'));
      var di = parseInt(el.getAttribute('data-i'), 10);
      if (!dq || !dq.drills || !dq.drills[di]) return;
      var df = $('#drill_' + di);
      var din = df ? df.value : '';
      if (!String(din).trim()) { toast('请先填写答案'); return; }
      var dok = judge(dq.drills[di], din);
      recordDrill(dq.id, di, dok);
      render();
      toast(dok ? (drillsAllRight(dq) ? '两道举一反三都做对了！' : '答对了，继续下一道') : '没答对，再看讲解试试');
      return;
    }
    if (act === 'del-custom') {
      var id = el.getAttribute('data-id');
      custom = custom.filter(function (q) { return q.id !== id; });
      setK(K.custom, custom);
      toast('已删除');
      render();
      return;
    }
    if (act === 'del-img') {
      var idx = parseInt(el.getAttribute('data-idx'), 10);
      pendingImages.splice(idx, 1);
      var box = $('#previewImgs');
      if (box) { box.innerHTML = ''; pendingImages.forEach(function (src, i) {
        var d = document.createElement('div'); d.className = 'thumb';
        d.innerHTML = '<img src="' + src + '" alt="预览" /><button type="button" data-act="del-img" data-idx="' + i + '">×</button>';
        box.appendChild(d);
      }); }
      return;
    }
    if (act === 'export') { exportCustom(); return; }
    if (act === 'clear-custom') {
      if (custom.length && window.confirm('确定清空全部补充的题目吗？此操作不可恢复。')) {
        custom = []; setK(K.custom, custom); toast('已清空'); render();
      }
      return;
    }
  }

  function render() {
    var parts = parseRoute();
    var view = parts[0] || 'home';
    var html;
    switch (view) {
      case 'checkin': html = viewCheckin(); break;
      case 'wrong': html = viewWrongBook(); break;
      case 'bank': html = parts[2] ? viewQuestions(parts[1], parts[2]) : viewBank(parts[1]); break;
      case 'q': html = viewSolve(parts[1], parts[2]); break;
      case 'add': html = viewAdd(); break;
      case 'about': html = viewAbout(); break;
      default: html = viewHome();
    }
    app.innerHTML = html;
    bindView(view, parts);
    try { window.scrollTo(0, 0); } catch (e) {}
  }

  document.addEventListener('click', handleClick);
  document.addEventListener('submit', handleSubmit);
  window.addEventListener('hashchange', render);

  // 移动端导航
  var navToggle = $('#navToggle');
  if (navToggle) {
    navToggle.addEventListener('click', function () {
      var nav = $('#siteNav');
      var open = nav.classList.toggle('open');
      this.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  $$('.site-nav a').forEach(function (a) {
    a.addEventListener('click', function () {
      var nav = $('#siteNav');
      if (nav) nav.classList.remove('open');
    });
  });

  render();
})();
