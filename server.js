const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 8000;

const POLL_INTERVAL = 5000;
const RETRY_DELAY = 5000;
const MAX_HISTORY = 1000;
const ID_TAG = "@tiendataox";

// ==================== API LC79 ====================
const API_URLS = {
    lc79_hu: 'https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5',
    lc79_md5: 'https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=3959701241b686f12e01bfe9c3a319b8',
    betvip_hu: 'https://wtx.macminim6.online/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=f69c1c37e9ffbfea5b655ed312604b40',
    betvip_md5: 'https://wtxmd52.macminim6.online/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=7aa1c7e7ea0160fd97524740774a4c61'
};

// ==================== LƯU NHIỀU PHIÊN CHO LC79 ====================
let lc79_history = {
    hu: [],      // lịch sử HŨ
    md5: []      // lịch sử MD5
};

let latest_result_lc79 = {
    hu: {
        Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0,
        Tong_diem: 0, Pattern: "Chưa có", Phien_hien_tai: 0,
        Du_doan: "Chưa có", Tong_du_doan: 0, Tong_thang: 0, Tong_thua: 0, Id: ID_TAG
    },
    md5: {
        Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0,
        Tong_diem: 0, Pattern: "Chưa có", Phien_hien_tai: 0,
        Du_doan: "Chưa có", Tong_du_doan: 0, Tong_thang: 0, Tong_thua: 0, Id: ID_TAG
    }
};

// Stats cho LC79
let lc79Stats = {
    hu: { totalPredictions: 0, totalWins: 0, totalLosses: 0 },
    md5: { totalPredictions: 0, totalWins: 0, totalLosses: 0 }
};

let latest_result_100 = {
  Phien: 0,
  Xuc_xac_1: 0,
  Xuc_xac_2: 0,
  Xuc_xac_3: 0,
  Tong_diem: 0,
  Pattern: "Chưa có",
  Phien_hien_tai: 0,
  Du_doan: "Chưa có",
  Tong_du_doan: 0,
  Tong_thang: 0,
  Tong_thua: 0,
  Id: ID_TAG
};

let latest_result_101 = {
  Phien: 0,
  Xuc_xac_1: 0,
  Xuc_xac_2: 0,
  Xuc_xac_3: 0,
  Tong_diem: 0,
  Pattern: "Chưa có",
  Phien_hien_tai: 0,
  Du_doan: "Chưa có",
  Tong_du_doan: 0,
  Tong_thang: 0,
  Tong_thua: 0,
  Id: ID_TAG
};

let history_100 = [];
let history_101 = [];
let last_sid_100 = null;
let last_sid_101 = null;
let sid_for_tx = null;

let globalStats = {
  ban_tai_xiu: { totalPredictions: 0, totalWins: 0, totalLosses: 0 },
  ban_md5: { totalPredictions: 0, totalWins: 0, totalLosses: 0 }
};

/**
 * AdvancedMarkovAnalyzer
 */
class AdvancedMarkovAnalyzer {
  constructor({ states = ['Tài','Xỉu'], order = 2, decay = 0.98, laplace = 1, memories = [3,10,50], maxHistory = 1000 } = {}) {
    this.states = states;
    this.order = Math.max(1, order);
    this.decay = decay;
    this.laplace = laplace;
    this.memories = memories;
    this.maxHistory = maxHistory;
    this.transitionCounts = new Map();
    this.patternFreq = new Map();
    this.rawHistory = [];
    this.predictionHistory = new Map();
  }

  update(actualState) {
    if (!this.states.includes(actualState)) throw new Error("Unknown state: " + actualState);
    this.rawHistory.push(actualState);
    if (this.rawHistory.length > this.maxHistory) this.rawHistory.shift();

    const L = this.rawHistory.length;
    const maxPat = Math.min(this.order, L);
    for (let patLen = 1; patLen <= maxPat; patLen++) {
      const seq = this.rawHistory.slice(L - patLen, L).join('|');
      this.patternFreq.set(seq, (this.patternFreq.get(seq) || 0) + 1);
    }

    for (let k = 1; k <= this.order; k++) {
      if (this.rawHistory.length - 1 - (k - 1) < 0) break;
      const ctxStart = this.rawHistory.length - 1 - k;
      if (ctxStart < 0) continue;
      const ctx = this.rawHistory.slice(ctxStart, ctxStart + k).join('|');
      const counts = this.transitionCounts.get(ctx) || {};
      counts[actualState] = (counts[actualState] || 0) + 1;
      this.transitionCounts.set(ctx, counts);
    }

    if (this.rawHistory.length % 20 === 0) this.applyDecayToAll();
  }

  applyDecayToAll() {
    const decayFactor = this.decay;
    for (const [ctx, counts] of this.transitionCounts.entries()) {
      const newCounts = {};
      let total = 0;
      for (const s of this.states) {
        const v = (counts[s] || 0) * decayFactor;
        newCounts[s] = v;
        total += v;
      }
      if (total < 1e-6) this.transitionCounts.delete(ctx);
      else this.transitionCounts.set(ctx, newCounts);
    }
    for (const [pat, cnt] of this.patternFreq.entries()) {
      const v = cnt * decayFactor;
      if (v < 1e-6) this.patternFreq.delete(pat);
      else this.patternFreq.set(pat, v);
    }
  }

  getProbabilitiesForContext(ctx) {
    const counts = this.transitionCounts.get(ctx) || {};
    let sum = 0;
    for (const s of this.states) sum += (counts[s] || 0);
    const K = this.states.length;
    const probs = {};
    for (const s of this.states) {
      const c = (counts[s] || 0);
      probs[s] = (c + this.laplace) / (sum + this.laplace * K);
    }
    return probs;
  }

  predictEnsemble() {
    const aggregate = {};
    for (const s of this.states) aggregate[s] = 0;
    const L = this.rawHistory.length;
    if (L === 0) {
      const uniform = 1 / this.states.length;
      for (const s of this.states) aggregate[s] = uniform;
      return { probs: aggregate, chosen: this.states[0], confidence: 0 };
    }
    for (const mem of this.memories) {
      const memSize = Math.min(mem, L);
      const orderForMem = Math.min(this.order, memSize);
      const ctx = this.rawHistory.slice(L - orderForMem, L).join('|');
      const probs = this.getProbabilitiesForContext(ctx);
      const weight = 1 / (1 + Math.log(1 + mem));
      for (const s of this.states) aggregate[s] += probs[s] * weight;
    }
    let total = 0;
    for (const s of this.states) total += aggregate[s];
    if (total <= 0) {
      const uniform = 1 / this.states.length;
      for (const s of this.states) aggregate[s] = uniform;
    } else {
      for (const s of this.states) aggregate[s] /= total;
    }
    let chosen = this.states[0];
    let best = aggregate[chosen];
    for (const s of this.states) if (aggregate[s] > best) { best = aggregate[s]; chosen = s; }
    const confidence = Math.abs(aggregate[this.states[0]] - aggregate[this.states[1]]);
    return { probs: aggregate, chosen, confidence };
  }

  topPatterns(k = 20, maxLen = undefined) {
    const arr = [];
    for (const [pat, cnt] of this.patternFreq.entries()) {
      const parts = pat.split('|');
      if (maxLen && parts.length > maxLen) continue;
      arr.push({ pattern: pat, count: cnt, length: parts.length });
    }
    arr.sort((a, b) => b.count - a.count);
    return arr.slice(0, k);
  }

  savePrediction(phien, result) {
    this.predictionHistory.set(phien, { ...result, timestamp: Date.now() });
    if (this.predictionHistory.size > 500) {
      const oldest = Array.from(this.predictionHistory.keys())[0];
      this.predictionHistory.delete(oldest);
    }
  }

  getPrediction(phien) { return this.predictionHistory.get(phien); }

  getFullAnalysis() {
    const memAnalyses = {};
    for (const mem of this.memories) {
      const memSize = Math.min(mem, this.rawHistory.length);
      const orderForMem = Math.min(this.order, memSize);
      const ctx = this.rawHistory.slice(this.rawHistory.length - orderForMem, this.rawHistory.length).join('|');
      memAnalyses[`m${mem}`] = { context: ctx, probs: this.getProbabilitiesForContext(ctx) };
    }
    return {
      order: this.order, decay: this.decay, laplace: this.laplace, memories: this.memories,
      rawHistoryLength: this.rawHistory.length,
      rawHistorySample: this.rawHistory.slice(-Math.min(50, this.rawHistory.length)),
      transitionContextsStored: this.transitionCounts.size,
      topPatterns: this.topPatterns(30, this.order),
      memoryAnalyses: memAnalyses
    };
  }
}

// Khởi tạo analyzers cho tất cả các bàn
const advanced_tx = new AdvancedMarkovAnalyzer({ order: 3, decay: 0.985, laplace: 1, memories: [3, 10, 50], maxHistory: 2000 });
const advanced_md5 = new AdvancedMarkovAnalyzer({ order: 3, decay: 0.985, laplace: 1, memories: [3, 10, 50], maxHistory: 2000 });
const advanced_lc79_hu = new AdvancedMarkovAnalyzer({ order: 3, decay: 0.985, laplace: 1, memories: [3, 10, 50], maxHistory: 2000 });
const advanced_lc79_md5 = new AdvancedMarkovAnalyzer({ order: 3, decay: 0.985, laplace: 1, memories: [3, 10, 50], maxHistory: 2000 });

function formatBeautifulJSON(data) { return JSON.stringify(data, null, 2); }

function updateResult(store, history, analyzer, stats, result, tableName) {
  Object.assign(store, result);
  const actualResult = store.Tong_diem > 10 ? 'Tài' : 'Xỉu';
  store.Pattern = actualResult;
  analyzer.update(actualResult);
  const pred = analyzer.predictEnsemble();
  store.Phien_hien_tai = store.Phien + 1;
  store.Du_doan = pred.chosen;
  store.Du_doan_confidence = parseFloat(pred.confidence.toFixed(3));
  store.Du_doan_probs = pred.probs;
  analyzer.savePrediction(store.Phien_hien_tai, { prediction: pred.chosen, probs: pred.probs, confidence: pred.confidence });

  if (history.length >= 1) {
    const previousGame = history[0];
    const prevPredRecord = analyzer.getPrediction(previousGame.Phien);
    if (prevPredRecord && prevPredRecord.prediction) {
      stats.totalPredictions++;
      const wasCorrect = prevPredRecord.prediction === actualResult;
      if (wasCorrect) stats.totalWins++;
      else stats.totalLosses++;
      previousGame.Tong_thang = stats.totalWins;
      previousGame.Tong_thua = stats.totalLosses;
      previousGame.Tong_du_doan = stats.totalPredictions;
      previousGame.Du_doan = prevPredRecord.prediction;
      previousGame.Danh_gia = wasCorrect ? 'Đúng' : 'Sai';
      console.log(`[${tableName}] EVAL Phiên ${previousGame.Phien} | Dự đoán: ${prevPredRecord.prediction} | Thực tế: ${actualResult} | ${wasCorrect ? '✅' : '❌'}`);
    }
  }

  const historyEntry = { ...result, Ket_qua: actualResult, Tong_thang: stats.totalWins, Tong_thua: stats.totalLosses, Tong_du_doan: stats.totalPredictions, Id: ID_TAG };
  history.unshift(historyEntry);
  if (history.length > MAX_HISTORY) history.pop();
  store.Tong_du_doan = stats.totalPredictions;
  store.Tong_thang = stats.totalWins;
  store.Tong_thua = stats.totalLosses;
  store.Id = ID_TAG;
  console.log(`[${tableName}] 🎲 Phiên ${store.Phien} | Tổng: ${store.Tong_diem} | KQ: ${actualResult} | Dự đoán tiếp theo: ${store.Du_doan} (conf ${store.Du_doan_confidence})`);
}

// ==================== LẤY DỮ LIỆU LC79 ====================
async function fetchLC79Data(apiUrl, type) {
    try {
        const response = await axios.get(apiUrl, { timeout: 10000 });
        const list = response.data?.list || [];
        if (!list.length) return null;
        
        return list.map(item => ({
            phien: item.id,
            result: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
            dice: [item.dices?.[0] || 0, item.dices?.[1] || 0, item.dices?.[2] || 0],
            sum: item.point || 0
        }));
    } catch (error) {
        console.error(`Lỗi fetch LC79 ${type}:`, error.message);
        return null;
    }
}

// ==================== POLLING FUNCTIONS ====================
async function pollTaiXiu() {
  const url = `https://jakpotgwab.geightdors.net/glms/v1/notify/taixiu?platform_id=rik&gid=vgmn_100`;
  while (true) {
    try {
      const res = await axios.get(url, { headers: { 'User-Agent': 'Node-Proxy/1.0' }, timeout: 10000 });
      const data = res.data;
      if (data && data.status === 'OK' && Array.isArray(data.data)) {
        for (const game of data.data) if (game.cmd === 1008) sid_for_tx = game.sid;
        for (const game of data.data) {
          if (game.cmd === 1003) {
            const sid = sid_for_tx;
            const { d1, d2, d3 } = game;
            if (sid && sid !== last_sid_100 && [d1, d2, d3].every(x => x != null)) {
              last_sid_100 = sid;
              const total = d1 + d2 + d3;
              const result = { Phien: sid, Xuc_xac_1: d1, Xuc_xac_2: d2, Xuc_xac_3: d3, Tong_diem: total, Pattern: "", Du_doan: "Chưa có", Tong_du_doan: 0, Tong_thang: 0, Tong_thua: 0, Id: ID_TAG };
              updateResult(latest_result_100, history_100, advanced_tx, globalStats.ban_tai_xiu, result, "BÀN TÀI XỈU");
              sid_for_tx = null;
            }
          }
        }
      }
    } catch (err) { console.error("Lỗi poll TX:", err.message); await new Promise(r => setTimeout(r, RETRY_DELAY)); }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
}

async function pollMD5() {
  const url = `https://jakpotgwab.geightdors.net/glms/v1/notify/taixiu?platform_id=rik&gid=vgmn_101`;
  while (true) {
    try {
      const res = await axios.get(url, { headers: { 'User-Agent': 'Node-Proxy/1.0' }, timeout: 10000 });
      const data = res.data;
      if (data && data.status === 'OK' && data.data && Array.isArray(data.data)) {
        for (const game of data.data) {
          if (game.cmd === 7006 && game.d1 && game.d2 && game.d3) {
            const sid = game.sid;
            if (sid && sid !== last_sid_101) {
              last_sid_101 = sid;
              const total = game.d1 + game.d2 + game.d3;
              const result = { Phien: sid, Xuc_xac_1: game.d1, Xuc_xac_2: game.d2, Xuc_xac_3: game.d3, Tong_diem: total, Pattern: "", Du_doan: "Chưa có", Tong_du_doan: 0, Tong_thang: 0, Tong_thua: 0, Id: ID_TAG };
              updateResult(latest_result_101, history_101, advanced_md5, globalStats.ban_md5, result, "BÀN MD5");
            }
          }
        }
      }
    } catch (err) { console.error("Lỗi poll MD5:", err.message); await new Promise(r => setTimeout(r, RETRY_DELAY)); }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
}

// ==================== POLL LC79 ====================
async function pollLC79() {
    while (true) {
        try {
            // LC79 HŨ
            const dataHu = await fetchLC79Data(API_URLS.lc79_hu, 'HŨ');
            if (dataHu && dataHu.length > 0) {
                const latest = dataHu[0];
                const lastKey = `hu_${latest.phien}`;
                if (lc79_history.hu.length === 0 || lc79_history.hu[0]?.Phien !== latest.phien) {
                    const result = {
                        Phien: latest.phien,
                        Xuc_xac_1: latest.dice[0],
                        Xuc_xac_2: latest.dice[1],
                        Xuc_xac_3: latest.dice[2],
                        Tong_diem: latest.sum,
                        Pattern: "", Du_doan: "Chưa có",
                        Tong_du_doan: 0, Tong_thang: 0, Tong_thua: 0, Id: ID_TAG
                    };
                    updateResult(latest_result_lc79.hu, lc79_history.hu, advanced_lc79_hu, lc79Stats.hu, result, "LC79 HŨ");
                }
            }
            
            // LC79 MD5
            const dataMd5 = await fetchLC79Data(API_URLS.lc79_md5, 'MD5');
            if (dataMd5 && dataMd5.length > 0) {
                const latest = dataMd5[0];
                if (lc79_history.md5.length === 0 || lc79_history.md5[0]?.Phien !== latest.phien) {
                    const result = {
                        Phien: latest.phien,
                        Xuc_xac_1: latest.dice[0],
                        Xuc_xac_2: latest.dice[1],
                        Xuc_xac_3: latest.dice[2],
                        Tong_diem: latest.sum,
                        Pattern: "", Du_doan: "Chưa có",
                        Tong_du_doan: 0, Tong_thang: 0, Tong_thua: 0, Id: ID_TAG
                    };
                    updateResult(latest_result_lc79.md5, lc79_history.md5, advanced_lc79_md5, lc79Stats.md5, result, "LC79 MD5");
                }
            }
        } catch (err) { console.error("Lỗi poll LC79:", err.message); }
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
}

// ==================== API ENDPOINTS ====================
app.get('/', (req, res) => {
  res.json({
    name: "🎲 Advanced Markov Analyzer API",
    author: ID_TAG,
    endpoints: [
      "/api/taixiu - Dự đoán bàn Tài Xỉu",
      "/api/md5 - Dự đoán bàn MD5",
      "/api/lc79-hu - Dự đoán LC79 HŨ",
      "/api/lc79-md5 - Dự đoán LC79 MD5",
      "/api/history - Lịch sử bàn Tài Xỉu",
      "/api/history/md5 - Lịch sử bàn MD5",
      "/api/history/lc79-hu - Lịch sử LC79 HŨ",
      "/api/history/lc79-md5 - Lịch sử LC79 MD5",
      "/api/stats - Thống kê tổng hợp",
      "/api/markov - Phân tích Markov bàn Tài Xỉu",
      "/api/markov/md5 - Phân tích Markov bàn MD5",
      "/api/markov/lc79-hu - Phân tích Markov LC79 HŨ",
      "/api/markov/lc79-md5 - Phân tích Markov LC79 MD5"
    ]
  });
});

// API dự đoán
app.get('/api/taixiu', (req, res) => res.json(latest_result_100));
app.get('/api/md5', (req, res) => res.json(latest_result_101));
app.get('/api/lc79-hu', (req, res) => res.json(latest_result_lc79.hu));
app.get('/api/lc79-md5', (req, res) => res.json(latest_result_lc79.md5));

// API lịch sử
app.get('/api/history', (req, res) => {
  res.json({
    ban: "Tài Xỉu",
    Tong_so_phien_du_doan: globalStats.ban_tai_xiu.totalPredictions,
    Tong_du_doan_dung: globalStats.ban_tai_xiu.totalWins,
    Tong_du_doan_sai: globalStats.ban_tai_xiu.totalLosses,
    lich_su: history_100.map(item => ({ Phien: item.Phien, Du_doan: item.Du_doan || 'Chưa có', Ket_qua: item.Ket_qua, Danh_gia: item.Danh_gia || 'Chưa đánh giá' }))
  });
});

app.get('/api/history/md5', (req, res) => {
  res.json({
    ban: "MD5",
    Tong_so_phien_du_doan: globalStats.ban_md5.totalPredictions,
    Tong_du_doan_dung: globalStats.ban_md5.totalWins,
    Tong_du_doan_sai: globalStats.ban_md5.totalLosses,
    lich_su: history_101.map(item => ({ Phien: item.Phien, Du_doan: item.Du_doan || 'Chưa có', Ket_qua: item.Ket_qua, Danh_gia: item.Danh_gia || 'Chưa đánh giá' }))
  });
});

app.get('/api/history/lc79-hu', (req, res) => {
  res.json({
    ban: "LC79 HŨ",
    Tong_so_phien_du_doan: lc79Stats.hu.totalPredictions,
    Tong_du_doan_dung: lc79Stats.hu.totalWins,
    Tong_du_doan_sai: lc79Stats.hu.totalLosses,
    lich_su: lc79_history.hu.map(item => ({ Phien: item.Phien, Du_doan: item.Du_doan || 'Chưa có', Ket_qua: item.Ket_qua, Danh_gia: item.Danh_gia || 'Chưa đánh giá' }))
  });
});

app.get('/api/history/lc79-md5', (req, res) => {
  res.json({
    ban: "LC79 MD5",
    Tong_so_phien_du_doan: lc79Stats.md5.totalPredictions,
    Tong_du_doan_dung: lc79Stats.md5.totalWins,
    Tong_du_doan_sai: lc79Stats.md5.totalLosses,
    lich_su: lc79_history.md5.map(item => ({ Phien: item.Phien, Du_doan: item.Du_doan || 'Chưa có', Ket_qua: item.Ket_qua, Danh_gia: item.Danh_gia || 'Chưa đánh giá' }))
  });
});

// API thống kê
app.get('/api/stats', (req, res) => {
  res.json({
    ban_tai_xiu: {
      accuracy: globalStats.ban_tai_xiu.totalPredictions > 0 ? (globalStats.ban_tai_xiu.totalWins / globalStats.ban_tai_xiu.totalPredictions * 100).toFixed(2) + '%' : '0%',
      total_predictions: globalStats.ban_tai_xiu.totalPredictions,
      correct_predictions: globalStats.ban_tai_xiu.totalWins,
      incorrect_predictions: globalStats.ban_tai_xiu.totalLosses,
      current_prediction: latest_result_100.Du_doan
    },
    ban_md5: {
      accuracy: globalStats.ban_md5.totalPredictions > 0 ? (globalStats.ban_md5.totalWins / globalStats.ban_md5.totalPredictions * 100).toFixed(2) + '%' : '0%',
      total_predictions: globalStats.ban_md5.totalPredictions,
      correct_predictions: globalStats.ban_md5.totalWins,
      incorrect_predictions: globalStats.ban_md5.totalLosses,
      current_prediction: latest_result_101.Du_doan
    },
    lc79_hu: {
      accuracy: lc79Stats.hu.totalPredictions > 0 ? (lc79Stats.hu.totalWins / lc79Stats.hu.totalPredictions * 100).toFixed(2) + '%' : '0%',
      total_predictions: lc79Stats.hu.totalPredictions,
      correct_predictions: lc79Stats.hu.totalWins,
      incorrect_predictions: lc79Stats.hu.totalLosses,
      current_prediction: latest_result_lc79.hu.Du_doan
    },
    lc79_md5: {
      accuracy: lc79Stats.md5.totalPredictions > 0 ? (lc79Stats.md5.totalWins / lc79Stats.md5.totalPredictions * 100).toFixed(2) + '%' : '0%',
      total_predictions: lc79Stats.md5.totalPredictions,
      correct_predictions: lc79Stats.md5.totalWins,
      incorrect_predictions: lc79Stats.md5.totalLosses,
      current_prediction: latest_result_lc79.md5.Du_doan
    }
  });
});

// API phân tích Markov
app.get('/api/markov', (req, res) => res.json(advanced_tx.getFullAnalysis()));
app.get('/api/markov/md5', (req, res) => res.json(advanced_md5.getFullAnalysis()));
app.get('/api/markov/lc79-hu', (req, res) => res.json(advanced_lc79_hu.getFullAnalysis()));
app.get('/api/markov/lc79-md5', (req, res) => res.json(advanced_lc79_md5.getFullAnalysis()));

// ==================== KHỞI ĐỘNG ====================
console.log("🚀 Khởi động Advanced Analyzer API...");
pollTaiXiu();
pollMD5();
pollLC79();

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📌 ID: ${ID_TAG}`);
  console.log(`📡 Endpoints:`);
  console.log(`   http://localhost:${PORT}/api/taixiu`);
  console.log(`   http://localhost:${PORT}/api/md5`);
  console.log(`   http://localhost:${PORT}/api/lc79-hu`);
  console.log(`   http://localhost:${PORT}/api/lc79-md5`);
});
