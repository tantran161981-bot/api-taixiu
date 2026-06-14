/**
 * LC79 PREDICTION API v4.0 — @anhquan
 * Thuật toán bắt cầu thực sự:
 *   Signal 1: Markov bậc 1/2/3 (tính động từ dữ liệu, Laplace smoothing)
 *   Signal 2: Streak Continuation (học tỉ lệ tiếp/bẻ theo bucket từ toàn bộ lịch sử)
 *   Signal 3: Pattern Sequence 3-gram / 2-gram tail-match
 *   Signal 4: Frequency Balance window 20 (mean reversion)
 *   Signal 5: Sum Z-Score mean reversion (tổng dice)
 *   Signal 6: Sum EMA deviation (tổng dice)
 *   Signal 7: RSI momentum (soft, mean-reversion biased)
 *   Signal 8: MACD momentum (soft, weight thấp)
 * Ensemble: reliability-weighted vote (EMA accuracy) + ML stacking (logistic regression online)
 * Không có rule cứng nào dựa vào results[0] hay results[1] đơn thuần
 */

const express = require('express');
const axios   = require('axios');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 5000;

const API_URL_HU  = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const SAVE_FILE   = 'anhquan.json';
const HIST_FILE   = 'anhquan1.json';

const MAX_HIST         = 100;
const AUTO_INTERVAL_MS = 30000;

// ─── state ──────────────────────────────────────────────────────────
let lastPhien = { hu: null, md5: null };
let history   = { hu: [], md5: [] };   // lịch sử dự đoán để trả /lichsu

function freshLearn() {
  return {
    predictions:      [],   // { phien, pred, conf, sigProbs, verified, actual, ok }
    total:            0,
    correct:          0,
    streak:           0,    // dương=win streak, âm=loss streak
    bestStreak:       0,
    worstStreak:      0,
    reliability:      {},   // signal name → EMA accuracy (init 0.55)
    ml:               { w: {}, b: 0, n: 0 },
  };
}
let learn = { hu: freshLearn(), md5: freshLearn() };

// ─── math utils ─────────────────────────────────────────────────────
const clamp   = (v, a, b) => Math.min(b, Math.max(a, v));
const sigmoid = x => 1 / (1 + Math.exp(-x));

// ─── data transform ─────────────────────────────────────────────────
function transform(apiData) {
  if (!apiData?.list?.length) return null;
  return apiData.list.map(item => ({
    phien:  item.id,
    result: item.resultTruyenThong === 'TAI' ? 'T' : 'X',
    dice:   [item.dices[0], item.dices[1], item.dices[2]],
    sum:    item.point,
  }));
}

async function fetchHu()  {
  try { return transform((await axios.get(API_URL_HU,  { timeout: 10000 })).data); }
  catch { return null; }
}
async function fetchMd5() {
  try { return transform((await axios.get(API_URL_MD5, { timeout: 10000 })).data); }
  catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════
//  SIGNALS
//  data: array [{phien, result:'T'|'X', sum}] — data[0] = phiên MỚI NHẤT
//  hist: array ['T'|'X'] theo thứ tự CŨ → MỚI (để duyệt transition)
// ═══════════════════════════════════════════════════════════════════

function buildHist(data) {
  return data.map(d => d.result).slice().reverse(); // cũ → mới
}

// ── Markov bậc k ─────────────────────────────────────────────────
function markovK(hist, k, minN) {
  const n = hist.length;
  if (n < k + minN) return null;
  const T = {};
  for (let i = 0; i < n - k; i++) {
    const key = hist.slice(i, i + k).join('');
    if (!T[key]) T[key] = { T: 0, X: 0 };
    T[key][hist[i + k]]++;
  }
  const key = hist.slice(n - k).join('');
  const row = T[key];
  if (!row) return null;
  const tot = row.T + row.X;
  if (tot < minN) return null;
  return { p: (row.T + 1) / (tot + 2), tot, key, row }; // Laplace
}

function sig_markov1(hist) {
  const r = markovK(hist, 1, 4);
  if (!r) return { skip: true, name: 'Markov-1', w: 1.5 };
  return { skip: false, name: 'Markov-1', p: r.p, w: 1.5,
    info: `"${r.key}"→T:${r.row.T}/X:${r.row.X} n=${r.tot}` };
}
function sig_markov2(hist) {
  const r = markovK(hist, 2, 5);
  if (!r) return { skip: true, name: 'Markov-2', w: 2.0 };
  return { skip: false, name: 'Markov-2', p: r.p, w: 2.0,
    info: `"${r.key}"→T:${r.row.T}/X:${r.row.X} n=${r.tot}` };
}
function sig_markov3(hist) {
  const r = markovK(hist, 3, 5);
  if (!r) return { skip: true, name: 'Markov-3', w: 2.3 };
  return { skip: false, name: 'Markov-3', p: r.p, w: 2.3,
    info: `"${r.key}"→T:${r.row.T}/X:${r.row.X} n=${r.tot}` };
}

// ── Streak Continuation ─────────────────────────────────────────
function sig_streak(hist) {
  const n = hist.length;
  if (n < 10) return { skip: true, name: 'Streak', w: 2.0 };

  const last = hist[n - 1];
  let cur = 1;
  for (let i = n - 2; i >= 0; i--) { if (hist[i] === last) cur++; else break; }
  const bk = Math.min(cur, 5);

  // học từ toàn bộ lịch sử
  const S = { 1:{c:0,b:0}, 2:{c:0,b:0}, 3:{c:0,b:0}, 4:{c:0,b:0}, 5:{c:0,b:0} };
  for (let i = 1; i < n - 1; i++) {
    let len = 1;
    for (let j = i - 1; j >= 0 && hist[j] === hist[i]; j--) len++;
    const b = Math.min(len, 5);
    hist[i + 1] === hist[i] ? S[b].c++ : S[b].b++;
  }
  const s   = S[bk];
  const tot = s.c + s.b;
  if (tot < 4) return { skip: true, name: 'Streak', w: 2.0 };

  const pCont = (s.c + 1) / (tot + 2);
  const p     = last === 'T' ? pCont : (1 - pCont);
  return { skip: false, name: 'Streak', p, w: 2.0,
    info: `${cur}×${last} bk=${bk} cont=${s.c}/brk=${s.b}(n=${tot}) pCont=${(pCont*100).toFixed(0)}%` };
}

// ── Pattern Sequence ────────────────────────────────────────────
function sig_pattern(hist) {
  const n = hist.length;
  if (n < 10) return { skip: true, name: 'Pattern', w: 2.0 };

  for (const k of [3, 2]) {
    if (n < k + 3) continue;
    const tail = hist.slice(-k).join('');
    const cnt  = { T: 0, X: 0 };
    for (let i = 0; i <= n - k - 1; i++)
      if (hist.slice(i, i + k).join('') === tail) cnt[hist[i + k]]++;
    const tot = cnt.T + cnt.X;
    if (tot >= 3) {
      const p = (cnt.T + 1) / (tot + 2);
      return { skip: false, name: 'Pattern', p, w: k === 3 ? 2.0 : 1.5,
        info: `"${tail}"→T:${cnt.T}/X:${cnt.X} n=${tot}` };
    }
  }
  return { skip: true, name: 'Pattern', w: 2.0 };
}

// ── Frequency Balance ───────────────────────────────────────────
function sig_freq(hist) {
  const n = hist.length;
  if (n < 10) return { skip: true, name: 'FreqBalance', w: 0.8 };
  const w   = Math.min(n, 20);
  const rec = hist.slice(-w);
  const tC  = rec.filter(v => v === 'T').length;
  const p   = clamp(0.5 + (0.5 - tC / rec.length) * 0.6, 0.3, 0.7);
  return { skip: false, name: 'FreqBalance', p, w: 0.8,
    info: `${w}p: T=${tC} X=${rec.length - tC}` };
}

// ── Sum Z-Score ─────────────────────────────────────────────────
function sig_zScore(data) {
  const sums = data.map(d => d.sum);
  if (sums.length < 15) return { skip: true, name: 'Z-Score', w: 1.3 };
  const win  = sums.slice(0, 15);
  const mean = win.reduce((a, b) => a + b, 0) / win.length;
  const std  = Math.sqrt(win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length) || 1;
  const z    = (sums[0] - mean) / std;
  const p    = clamp(0.5 - z * 0.08, 0.25, 0.75);
  return { skip: false, name: 'Z-Score', p, w: 1.3,
    info: `sum=${sums[0]} mean=${mean.toFixed(1)} z=${z.toFixed(2)}` };
}

// ── Sum EMA ─────────────────────────────────────────────────────
function sig_ema(data) {
  const sums = data.map(d => d.sum);
  if (sums.length < 10) return { skip: true, name: 'SumEMA', w: 1.1 };
  const arr  = sums.slice(0, 10).slice().reverse();
  const k    = 2 / (arr.length + 1);
  let ema    = arr[0];
  for (let i = 1; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k);
  const diff = arr[arr.length - 1] - ema;
  const p    = clamp(0.5 - diff * 0.05, 0.3, 0.7);
  return { skip: false, name: 'SumEMA', p, w: 1.1,
    info: `sum=${arr[arr.length-1]} ema=${ema.toFixed(2)} diff=${diff.toFixed(2)}` };
}

// ── RSI (soft) ──────────────────────────────────────────────────
function sig_rsi(hist) {
  const n = hist.length;
  if (n < 14) return { skip: true, name: 'RSI', w: 0.9 };
  const recent = hist.slice(-14);
  const tC     = recent.filter(v => v === 'T').length;
  const rsi    = clamp(100 - (100 / (1 + tC / (14 - tC || 1))), 1, 99);
  const p      = clamp(0.5 - (rsi - 50) / 100 * 0.6, 0.3, 0.7);
  return { skip: false, name: 'RSI', p, w: 0.9,
    info: `RSI14=${rsi.toFixed(1)}` };
}

// ── MACD (soft, weight nhỏ) ─────────────────────────────────────
function sig_macd(hist) {
  const n = hist.length;
  if (n < 26) return { skip: true, name: 'MACD', w: 0.7 };
  const ema12 = hist.slice(-12).filter(v => v === 'T').length / 12;
  const ema26 = hist.slice(-26).filter(v => v === 'T').length / 26;
  const macd  = ema12 - ema26;
  const p     = clamp(0.5 + macd * 0.5, 0.35, 0.65);
  return { skip: false, name: 'MACD', p, w: 0.7,
    info: `MACD=${macd.toFixed(3)}` };
}

// ═══════════════════════════════════════════════════════════════════
//  RELIABILITY TRACKING
// ═══════════════════════════════════════════════════════════════════
function getRel(lrn, name) {
  return lrn.reliability[name] !== undefined ? lrn.reliability[name] : 0.55;
}
function updRel(lrn, name, correct) {
  const alpha = 0.15;
  const old   = getRel(lrn, name);
  lrn.reliability[name] = old * (1 - alpha) + (correct ? 1 : 0) * alpha;
}

// ═══════════════════════════════════════════════════════════════════
//  ML STACKING — logistic regression online
// ═══════════════════════════════════════════════════════════════════
function mlPred(ml, sigP) {
  let z = ml.b || 0;
  for (const [k, v] of Object.entries(sigP))
    z += (ml.w[k] || 0) * (v - 0.5) * 2;
  return sigmoid(z);
}
function mlTrain(ml, sigP, actualT) {
  const t   = actualT ? 1 : 0;
  const err = t - mlPred(ml, sigP);
  const lr  = Math.max(0.003, 0.08 / (1 + (ml.n || 0) * 0.003));
  ml.b = (ml.b || 0) + lr * err;
  for (const [k, v] of Object.entries(sigP)) {
    const feat = (v - 0.5) * 2;
    const w    = ml.w[k] || 0;
    ml.w[k]    = clamp(w + lr * err * feat - 0.001 * w, -2, 2);
  }
  ml.n = (ml.n || 0) + 1;
}

// ═══════════════════════════════════════════════════════════════════
//  ENSEMBLE
// ═══════════════════════════════════════════════════════════════════
function ensemble(sigs, lrn) {
  const active  = sigs.filter(s => !s.skip);
  const sigProbs = {};
  active.forEach(s => sigProbs[s.name] = s.p);

  let tw = 0, xw = 0;
  active.forEach(s => {
    const rel    = getRel(lrn, s.name);
    const wgt    = s.w * rel;
    const intens = Math.abs(s.p - 0.5) * 2;
    if (s.p >= 0.5) tw += wgt * (0.5 + intens * 0.5);
    else             xw += wgt * (0.5 + intens * 0.5);
  });
  const tot = tw + xw || 1;
  const eP  = active.length ? tw / tot : 0.5;

  const mlP  = active.length >= 2 ? mlPred(lrn.ml, sigProbs) : 0.5;
  const mlW  = clamp((lrn.ml.n || 0) / 40, 0.1, 0.6);
  const finP = active.length ? eP * (1 - mlW) + mlP * mlW : 0.5;

  const isTai = finP >= 0.5;
  const tv    = active.filter(s => s.p >= 0.5).length;
  const xv    = active.length - tv;
  const dom   = Math.abs(finP - 0.5) * 2;
  const agree = active.length ? Math.max(tv, xv) / active.length : 0.5;
  const conf  = clamp(Math.round(52 + dom * 25 + (agree - 0.5) * 18), 52, 88);

  return { isTai, finP, eP, mlP, mlW, conf, tv, xv, sigProbs, active, sigs };
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN PREDICTION
// ═══════════════════════════════════════════════════════════════════
function predict(data, type) {
  const lrn  = learn[type];
  const hist = buildHist(data);

  const sigs = [
    sig_markov1(hist),
    sig_markov2(hist),
    sig_markov3(hist),
    sig_streak(hist),
    sig_pattern(hist),
    sig_freq(hist),
    sig_zScore(data),
    sig_ema(data),
    sig_rsi(hist),
    sig_macd(hist),
  ];

  const ens = ensemble(sigs, lrn);
  const pred = ens.isTai ? 'Tài' : 'Xỉu';

  const confLabel =
    ens.conf >= 80 ? 'Rất cao' :
    ens.conf >= 70 ? 'Cao'     :
    ens.conf >= 60 ? 'TB'      : 'Thấp';

  return {
    prediction:  pred,
    confidence:  ens.conf,
    confLabel,
    probability: { tai: (ens.finP * 100).toFixed(1) + '%', xiu: ((1 - ens.finP) * 100).toFixed(1) + '%' },
    votes:       { tai: ens.tv, xiu: ens.xv, total: ens.active.length },
    signals:     ens.sigs.map(s => ({
      name: s.name, skip: !!s.skip,
      p:    s.skip ? null : +(s.p * 100).toFixed(1),
      info: s.info || (s.skip ? 'cần thêm dữ liệu' : ''),
      rel:  +(getRel(lrn, s.name) * 100).toFixed(0),
    })),
    ml: { trainCount: lrn.ml.n || 0, prob: (ens.mlP * 100).toFixed(1) + '%' },
    _sigProbs: ens.sigProbs,  // internal, dùng để train/verify
  };
}

// ═══════════════════════════════════════════════════════════════════
//  RECORD & VERIFY
// ═══════════════════════════════════════════════════════════════════
function record(type, phien, pred, conf, sigProbs) {
  const lrn = learn[type];
  lrn.predictions.unshift({ phien: String(phien), pred, conf, sigProbs, actual: null, ok: null });
  lrn.total++;
  if (lrn.predictions.length > 500) lrn.predictions.pop();
}

function verify(type, data) {
  const lrn = learn[type];
  let changed = false;
  for (const entry of lrn.predictions) {
    if (entry.actual !== null) continue;
    const found = data.find(d => String(d.phien) === entry.phien);
    if (!found) continue;
    entry.actual = found.result === 'T' ? 'Tài' : 'Xỉu';
    entry.ok     = entry.pred === entry.actual;

    if (entry.ok) {
      lrn.correct++;
      lrn.streak = Math.max(1, lrn.streak + 1);
      if (lrn.streak > lrn.bestStreak) lrn.bestStreak = lrn.streak;
    } else {
      lrn.streak = Math.min(-1, lrn.streak - 1);
      if (lrn.streak < lrn.worstStreak) lrn.worstStreak = lrn.streak;
    }

    // cập nhật reliability từng signal
    if (entry.sigProbs) {
      for (const [name, p] of Object.entries(entry.sigProbs)) {
        const sigPred = p >= 0.5 ? 'Tài' : 'Xỉu';
        updRel(lrn, name, sigPred === entry.actual);
      }
      // train ML
      if (Object.keys(entry.sigProbs).length >= 2) {
        mlTrain(lrn.ml, entry.sigProbs, entry.actual === 'Tài');
      }
    }
    changed = true;
  }
  if (changed) saveLearning();
}

// ═══════════════════════════════════════════════════════════════════
//  SAVE / LOAD
// ═══════════════════════════════════════════════════════════════════
function saveLearning() {
  try { fs.writeFileSync(SAVE_FILE, JSON.stringify(learn, null, 2)); } catch {}
}
function saveHistory() {
  try { fs.writeFileSync(HIST_FILE, JSON.stringify({ history, lastPhien }, null, 2)); } catch {}
}
function loadAll() {
  try {
    if (fs.existsSync(SAVE_FILE)) {
      const d = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
      for (const t of ['hu', 'md5']) {
        if (d[t]) {
          learn[t] = { ...freshLearn(), ...d[t] };
          learn[t].reliability = learn[t].reliability || {};
          learn[t].ml          = learn[t].ml || { w: {}, b: 0, n: 0 };
          learn[t].ml.w        = learn[t].ml.w || {};
        }
      }
      console.log('✅ Loaded', SAVE_FILE);
    }
  } catch (e) { console.error('Load learning error:', e.message); }
  try {
    if (fs.existsSync(HIST_FILE)) {
      const d = JSON.parse(fs.readFileSync(HIST_FILE, 'utf8'));
      history   = d.history   || { hu: [], md5: [] };
      lastPhien = d.lastPhien || { hu: null, md5: null };
      console.log('✅ Loaded', HIST_FILE);
    }
  } catch (e) { console.error('Load history error:', e.message); }
}

// ─── build history record (để trả /lichsu) ──────────────────────
function makeRecord(type, nextPhien, res, latest) {
  const rec = {
    Phien:          latest.phien,
    Xuc_xac_1:      latest.dice[0],
    Xuc_xac_2:      latest.dice[1],
    Xuc_xac_3:      latest.dice[2],
    Tong:           latest.sum,
    Ket_qua:        latest.result === 'T' ? 'Tài' : 'Xỉu',
    Du_doan:        res.prediction,
    Do_tin_cay:     res.confidence + '%',
    Phien_hien_tai: String(nextPhien),
    ket_qua_du_doan: '',
    id:             '@anhquan',
    timestamp:      new Date().toISOString(),
  };
  history[type].unshift(rec);
  if (history[type].length > MAX_HIST) history[type].pop();
  return rec;
}

async function updateHistStatus(type) {
  const data = type === 'hu' ? await fetchHu() : await fetchMd5();
  if (!data) return;
  for (const rec of history[type]) {
    if (rec.ket_qua_du_doan) continue;
    const found = data.find(d => String(d.phien) === rec.Phien_hien_tai);
    if (found) {
      const actual = found.result === 'T' ? 'Tài' : 'Xỉu';
      rec.ket_qua_du_doan = rec.Du_doan === actual ? 'Đúng ✅' : 'Sai ❌';
    }
  }
  saveHistory();
}

// ─── auto polling ─────────────────────────────────────────────────
async function autoPoll() {
  try {
    const [dataHu, dataMd5] = await Promise.all([fetchHu(), fetchMd5()]);
    for (const [type, data] of [['hu', dataHu], ['md5', dataMd5]]) {
      if (!data?.length) continue;
      verify(type, data);
      const next = data[0].phien + 1;
      if (lastPhien[type] !== next) {
        const res = predict(data, type);
        makeRecord(type, next, res, data[0]);
        record(type, next, res.prediction, res.confidence, res._sigProbs);
        lastPhien[type] = next;
        console.log(`[Auto][${type}] phiên ${next}: ${res.prediction} (${res.confidence}%) TV=${res.votes.tai}/${res.votes.total}`);
      }
    }
    saveHistory();
    saveLearning();
  } catch (e) { console.error('[Auto]', e.message); }
}

// ═══════════════════════════════════════════════════════════════════
//  ENDPOINTS
// ═══════════════════════════════════════════════════════════════════
app.get('/', (_, res) => res.send('t.me/anhquan — LC79 Prediction API v4.0'));

// Dự đoán
async function handlePredict(type, req, res) {
  try {
    const data = type === 'hu' ? await fetchHu() : await fetchMd5();
    if (!data) return res.status(500).json({ error: 'Không lấy được dữ liệu' });
    verify(type, data);
    const next = data[0].phien + 1;
    const result  = predict(data, type);
    const histRec = makeRecord(type, next, result, data[0]);
    record(type, next, result.prediction, result.confidence, result._sigProbs);
    saveHistory(); saveLearning();
    setTimeout(() => updateHistStatus(type), 8000);
    const { _sigProbs, ...clean } = result;
    res.json({ ...histRec, analysis: clean });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

app.get('/hu',  (q, r) => handlePredict('hu',  q, r));
app.get('/md5', (q, r) => handlePredict('md5', q, r));

// Lịch sử
app.get('/hu/lichsu',  async (_, res) => {
  await updateHistStatus('hu');
  res.json({ type: 'LC79 Hũ', total: history.hu.length, history: history.hu, id: '@anhquan' });
});
app.get('/md5/lichsu', async (_, res) => {
  await updateHistStatus('md5');
  res.json({ type: 'LC79 MD5', total: history.md5.length, history: history.md5, id: '@anhquan' });
});

// Chi tiết phân tích
async function handleThamso(type, req, res) {
  try {
    const data = type === 'hu' ? await fetchHu() : await fetchMd5();
    if (!data) return res.status(500).json({ error: 'Không lấy được dữ liệu' });
    const result = predict(data, type);
    const { _sigProbs, ...clean } = result;
    res.json(clean);
  } catch (e) { res.status(500).json({ error: e.message }); }
}
app.get('/hu/thamso',  (q, r) => handleThamso('hu',  q, r));
app.get('/md5/thamso', (q, r) => handleThamso('md5', q, r));

// Thống kê học máy
function learnStats(type) {
  const lrn = learn[type];
  return {
    type,
    total:        lrn.total,
    correct:      lrn.correct,
    accuracy:     lrn.total ? (lrn.correct / lrn.total * 100).toFixed(1) + '%' : 'N/A',
    streak:       lrn.streak,
    bestStreak:   lrn.bestStreak,
    worstStreak:  lrn.worstStreak,
    reliability:  lrn.reliability,
    ml:           { trainCount: lrn.ml.n || 0, bias: lrn.ml.b, weights: lrn.ml.w },
    id: '@anhquan',
  };
}
app.get('/hu/hochoi',  (_, res) => res.json(learnStats('hu')));
app.get('/md5/hochoi', (_, res) => res.json(learnStats('md5')));

// Reset
app.get('/resetdata', (_, res) => {
  learn = { hu: freshLearn(), md5: freshLearn() };
  saveLearning();
  res.json({ message: 'Đã reset dữ liệu học', id: '@anhquan' });
});

// ─── start ────────────────────────────────────────────────────────
loadAll();
setTimeout(autoPoll, 4000);
setInterval(autoPoll, AUTO_INTERVAL_MS);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 LC79 API v4.0 — http://0.0.0.0:${PORT}`);
  console.log('Signals: Markov-1/2/3 · Streak · Pattern · FreqBalance · Z-Score · EMA · RSI · MACD');
  console.log('Ensemble: reliability-weighted vote + ML stacking (logistic regression)');
});
