const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'Tskhang.json';
const HISTORY_FILE = 'Tskhang1.json';

let predictionHistory = { hu: [], md5: [] };
const MAX_HISTORY = 100;
const AUTO_SAVE_INTERVAL = 30000;
let lastProcessedPhien = { hu: null, md5: null };

// ==================== CẤU TRÚC DỮ LIỆU NÂNG CẤP ====================
function makeEmptyTypeData() {
  return {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [],
    reversalState: { active: false, streakTrigger: 0, cooldown: 0 },
    markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 },
    markov2Matrix: {},
    markov3Matrix: {},    // BẬC 3 MỚI
    volatility: 0,
    // Thống kê bẻ cầu theo độ dài streak
    breakStats: {
      // key: "3","4","5",... = độ dài streak
      // value: { total, broken } -> tỷ lệ bẻ thực tế
    },
    // Lịch sử nhịp cầu (chu kỳ phát hiện)
    cycleDetection: {
      lastCycles: [],   // mảng lưu chu kỳ gần đây
      avgCycleLen: 0
    }
  };
}

let learningData = { hu: makeEmptyTypeData(), md5: makeEmptyTypeData() };

// ==================== LOAD / SAVE ====================
function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'));
      for (const t of ['hu', 'md5']) {
        if (parsed[t]) learningData[t] = { ...makeEmptyTypeData(), ...parsed[t] };
      }
      console.log('✅ Loaded learning data');
    }
  } catch (e) { console.error('Load learning error:', e.message); }
}

function saveLearningData() {
  try { fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2)); }
  catch (e) { console.error('Save learning error:', e.message); }
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      predictionHistory = parsed.history || { hu: [], md5: [] };
      lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
      console.log('✅ Loaded prediction history');
    }
  } catch (e) { console.error('Load history error:', e.message); }
}

function savePredictionHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      history: predictionHistory, lastProcessedPhien, lastSaved: new Date().toISOString()
    }, null, 2));
  } catch (e) { console.error('Save history error:', e.message); }
}

// ==================== LẤY DỮ LIỆU ====================
function transformApiData(apiData) {
  if (!apiData?.list || !Array.isArray(apiData.list)) return null;
  return apiData.list.map(item => ({
    Phien: item.id,
    Ket_qua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
    Xuc_xac_1: item.dices[0], Xuc_xac_2: item.dices[1], Xuc_xac_3: item.dices[2],
    Tong: item.point
  }));
}

async function fetchDataHu() {
  try {
    const r = await axios.get(API_URL_HU, { timeout: 10000 });
    return transformApiData(r.data);
  } catch (e) { console.error('Fetch HU error:', e.message); return null; }
}

async function fetchDataMd5() {
  try {
    const r = await axios.get(API_URL_MD5, { timeout: 10000 });
    return transformApiData(r.data);
  } catch (e) { console.error('Fetch MD5 error:', e.message); return null; }
}

// ==================== PATTERN ID MAPPING ====================
function getPatternId(name) {
  const map = {
    'Cầu Bệt': 'cau_bet', 'Cầu Đảo 1-1': 'cau_dao_11', 'Cầu 2-2': 'cau_22',
    'Cầu 3-3': 'cau_33', 'Cầu 1-2-1': 'cau_121', 'Cầu 1-2-3': 'cau_123',
    'Cầu 3-2-1': 'cau_321', 'Nhảy Cóc': 'nhay_coc', 'Nhịp Nghiêng': 'nhip_nghieng',
    'Cầu 3 Ván': 'cau_3van', 'Đảo Xu Hướng': 'smart_bet', 'Bẻ Chuỗi': 'break_streak',
    'Bộ Ba': 'triple', 'Tổng Phân Tích': 'tong', 'Xu Hướng Mạnh': 'xu_huong',
    'Đảo Chiều': 'dao_chieu', 'Markov bậc 1': 'markov1', 'Markov bậc 2': 'markov2',
    'Markov bậc 3': 'markov3', 'Elliott': 'elliott', 'Kháng cự': 'resistance',
    'Hỗ trợ': 'support', 'Nhịp Cầu': 'nhip_cau', 'Theo Cầu': 'theo_cau',
    'Bẻ Thông Minh': 'be_thong_minh', 'Lệch Tổng': 'lech_tong', 'Zigzag': 'zigzag',
    'Cầu Vắt': 'cau_vat', 'Xác Suất Lịch Sử': 'xs_lich_su'
  };
  for (const [k, v] of Object.entries(map)) if (name.includes(k)) return v;
  return 'unknown';
}

// ==================== CẬP NHẬT MARKOV ====================
function updateMarkovMatrices(type, results) {
  if (results.length < 5) return;

  // Bậc 1
  let tt = 0, tx = 0, xt = 0, xx = 0;
  for (let i = 0; i < results.length - 1; i++) {
    if (results[i] === 'Tài' && results[i+1] === 'Tài') tt++;
    else if (results[i] === 'Tài' && results[i+1] === 'Xỉu') tx++;
    else if (results[i] === 'Xỉu' && results[i+1] === 'Tài') xt++;
    else xx++;
  }
  const tot1 = tt + tx + xt + xx;
  if (tot1 > 0) learningData[type].markovMatrix = { TT: tt/tot1, TX: tx/tot1, XT: xt/tot1, XX: xx/tot1 };

  // Bậc 2
  const m2 = {};
  for (let i = 0; i < results.length - 2; i++) {
    const k = results[i+1] + '_' + results[i];  // [prev, curr] -> next
    const nxt = results[i-1] || results[i];
    const key = results[i] + '_' + results[i+1];
    const next = results[i+2] ? null : null;
  }
  // Đúng chiều: results[0] là mới nhất
  const m2b = {};
  for (let i = results.length - 1; i >= 2; i--) {
    const key = results[i] + '_' + results[i-1];
    const nxt = results[i-2];
    m2b[key + '_' + nxt] = (m2b[key + '_' + nxt] || 0) + 1;
  }
  learningData[type].markov2Matrix = m2b;

  // Bậc 3 MỚI
  const m3 = {};
  for (let i = results.length - 1; i >= 3; i--) {
    const key = results[i] + '_' + results[i-1] + '_' + results[i-2];
    const nxt = results[i-3];
    m3[key + '_' + nxt] = (m3[key + '_' + nxt] || 0) + 1;
  }
  learningData[type].markov3Matrix = m3;

  // Cập nhật breakStats (tỷ lệ bẻ cầu thực tế theo độ dài)
  updateBreakStats(type, results);
}

function updateBreakStats(type, results) {
  const bs = learningData[type].breakStats;
  let i = 0;
  while (i < results.length - 1) {
    let len = 1;
    while (i + len < results.length && results[i + len] === results[i]) len++;
    // streak độ dài `len` kết thúc tại i+len-1
    if (i + len < results.length) {
      const sKey = String(len);
      if (!bs[sKey]) bs[sKey] = { total: 0, broken: 0 };
      bs[sKey].total++;
      if (results[i + len] !== results[i]) bs[sKey].broken++;
    }
    i += len;
  }
}

// ==================== CÁC HÀM PHÂN TÍCH CẦU ====================

function analyzeCauBet(results) {
  if (results.length < 3) return { detected: false };
  let type = results[0], len = 1;
  for (let i = 1; i < results.length; i++) { if (results[i] === type) len++; else break; }
  if (len >= 3) {
    return { detected: true, prediction: type, confidence: Math.min(80, 62 + len * 2),
      name: `Cầu Bệt ${len} phiên`, priority: 7 };
  }
  return { detected: false };
}

function analyzeCauDao11(results) {
  if (results.length < 4) return { detected: false };
  let altLen = 1;
  for (let i = 1; i < Math.min(results.length, 12); i++) {
    if (results[i] !== results[i-1]) altLen++; else break;
  }
  if (altLen >= 4) {
    return { detected: true, prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.min(82, 64 + altLen * 2), name: `Cầu Đảo 1-1 (${altLen} phiên)`, priority: 8 };
  }
  return { detected: false };
}

function analyzeCau22(results) {
  if (results.length < 6) return { detected: false };
  let pairs = [], i = 0;
  while (i < results.length - 1 && pairs.length < 5) {
    if (results[i] === results[i+1]) { pairs.push(results[i]); i += 2; } else break;
  }
  if (pairs.length >= 2) {
    let alt = pairs.every((p, j) => j === 0 || p !== pairs[j-1]);
    if (alt) return { detected: true, prediction: pairs[pairs.length-1] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.min(80, 63 + pairs.length * 3), name: `Cầu 2-2 (${pairs.length} cặp)`, priority: 7 };
  }
  return { detected: false };
}

function analyzeCau33(results) {
  if (results.length < 6) return { detected: false };
  let trips = [], i = 0;
  while (i < results.length - 2 && trips.length < 4) {
    if (results[i] === results[i+1] && results[i+1] === results[i+2]) { trips.push(results[i]); i += 3; } else break;
  }
  if (trips.length >= 1) {
    const pos = results.length % 3;
    const last = trips[trips.length-1];
    const pred = pos === 0 ? (last === 'Tài' ? 'Xỉu' : 'Tài') : last;
    return { detected: true, prediction: pred, confidence: Math.min(82, 66 + trips.length * 4),
      name: `Cầu 3-3 (${trips.length} bộ)`, priority: 7 };
  }
  return { detected: false };
}

function analyzeCau121(results) {
  if (results.length < 4) return { detected: false };
  const [a,b,c,d] = results;
  if (a !== b && b === c && c !== d && a === d)
    return { detected: true, prediction: a, confidence: 72, name: 'Cầu 1-2-1', priority: 6 };
  return { detected: false };
}

function analyzeCau22Plus(results) {
  // Cầu vắt: TTXX hoặc XXTT (nhóm 2 đổi sang nhóm 2)
  if (results.length < 5) return { detected: false };
  if (results[0]===results[1] && results[2]===results[3] && results[0]!==results[2]) {
    // đang ở đầu cặp mới -> tiếp tục theo cặp hiện tại
    return { detected: true, prediction: results[0], confidence: 73,
      name: `Cầu Vắt 2-2 theo ${results[0]}`, priority: 7 };
  }
  return { detected: false };
}

function analyzeSmartBet(results) {
  if (results.length < 10) return { detected: false };
  const l5 = results.slice(0, 5), p5 = results.slice(5, 10);
  const tL = l5.filter(r => r === 'Tài').length;
  const tP = p5.filter(r => r === 'Tài').length;
  if ((tL >= 4 && tP <= 1) || (tL <= 1 && tP >= 4)) {
    const dom = tL >= 4 ? 'Tài' : 'Xỉu';
    return { detected: true, prediction: dom === 'Tài' ? 'Xỉu' : 'Tài', confidence: 78,
      name: `Đảo Xu Hướng (${tL}T-${5-tL}X vs ${tP}T-${5-tP}X)`, priority: 9 };
  }
  const t10 = results.slice(0, 10).filter(r => r === 'Tài').length;
  if (t10 >= 8 || t10 <= 2) {
    const dom = t10 >= 8 ? 'Tài' : 'Xỉu';
    return { detected: true, prediction: dom === 'Tài' ? 'Xỉu' : 'Tài', confidence: 82,
      name: `Xu Hướng Cực (${t10}T/${10-t10}X) → Đảo`, priority: 9 };
  }
  return { detected: false };
}

// ==================== BẺ CẦU THÔNG MINH (CORE UPGRADE) ====================
function analyzeBreakStreakSmart(results, type) {
  if (results.length < 3) return { detected: false };
  let sType = results[0], sLen = 1;
  for (let i = 1; i < results.length; i++) { if (results[i] === sType) sLen++; else break; }
  if (sLen < 3) return { detected: false };

  const bs = learningData[type].breakStats;
  const key = String(sLen);
  const keyPlus = String(sLen + 1);

  // Tỷ lệ bẻ thực tế từ lịch sử
  let breakRate = 0.5;
  if (bs[key] && bs[key].total >= 5) {
    breakRate = bs[key].broken / bs[key].total;
  } else {
    // Mặc định theo thống kê xúc xắc: streak càng dài càng dễ bẻ
    const defaultBreakRates = { 3: 0.52, 4: 0.58, 5: 0.66, 6: 0.72, 7: 0.78, 8: 0.84 };
    breakRate = defaultBreakRates[Math.min(sLen, 8)] || 0.87;
  }

  const shouldBreak = breakRate >= 0.55;
  const prediction = shouldBreak ? (sType === 'Tài' ? 'Xỉu' : 'Tài') : sType;
  const conf = Math.min(90, 50 + Math.abs(breakRate - 0.5) * 80 + sLen * 2);

  if (sLen >= 3) {
    return {
      detected: true, prediction,
      confidence: conf,
      name: `Bẻ Thông Minh Streak ${sLen} (${(breakRate*100).toFixed(0)}% bẻ)`,
      priority: 8 + Math.min(4, sLen - 3),
      breakRate,
      streakLen: sLen,
      streakType: sType
    };
  }
  return { detected: false };
}

// ==================== THEO CẦU THÔNG MINH ====================
function analyzeTheoCAuThongMinh(results, type) {
  if (results.length < 6) return { detected: false };

  // Phát hiện nhịp lặp: ví dụ TTXTTX hoặc TXXTTXX
  const r = results;
  for (let cycleLen = 2; cycleLen <= 5; cycleLen++) {
    let matchCount = 0, totalChecks = 0;
    for (let i = 0; i + cycleLen < r.length && i < cycleLen * 4; i++) {
      if (r[i] === r[i + cycleLen]) matchCount++;
      totalChecks++;
    }
    const matchRate = totalChecks > 0 ? matchCount / totalChecks : 0;
    if (matchRate >= 0.75 && totalChecks >= 4) {
      // Chu kỳ `cycleLen` đang lặp -> dự đoán theo chu kỳ
      const nextInCycle = r[cycleLen]; // vị trí tiếp theo trong chu kỳ
      if (nextInCycle) {
        return {
          detected: true, prediction: nextInCycle,
          confidence: Math.min(85, 60 + matchRate * 30),
          name: `Nhịp Cầu Chu Kỳ ${cycleLen} (${(matchRate*100).toFixed(0)}% khớp)`,
          priority: 10
        };
      }
    }
  }
  return { detected: false };
}

// ==================== PHÂN TÍCH ZIGZAG NÂNG CẤP ====================
function analyzeZigzag(results) {
  if (results.length < 6) return { detected: false };
  // Zigzag 1-1: xen kẽ hoàn hảo
  let altLen = 0;
  for (let i = 0; i < results.length - 1; i++) {
    if (results[i] !== results[i+1]) altLen++; else break;
  }
  altLen++; // count first element
  if (altLen >= 5) {
    return { detected: true, prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.min(86, 68 + altLen), name: `Zigzag ${altLen} phiên`, priority: 9 };
  }
  return { detected: false };
}

// ==================== PHÂN TÍCH LỆCH TỔNG ====================
function analyzeLechTong(data) {
  if (data.length < 15) return { detected: false };
  const recent = data.slice(0, 15);
  const sums = recent.map(d => d.Tong);
  const avg = sums.reduce((a, b) => a + b, 0) / sums.length;
  const last3avg = sums.slice(0, 3).reduce((a, b) => a + b, 0) / 3;

  // Tổng trung bình xúc xắc là ~10.5 (lý thuyết)
  const NEUTRAL = 10.5;
  const deviation = last3avg - NEUTRAL;

  if (deviation > 2.5) {
    // Tổng đang cao -> xu hướng về Xỉu theo mean reversion
    return { detected: true, prediction: 'Xỉu', confidence: 72,
      name: `Lệch Tổng Cao (${last3avg.toFixed(1)}) → Mean Reversion Xỉu`, priority: 8 };
  }
  if (deviation < -2.5) {
    return { detected: true, prediction: 'Tài', confidence: 72,
      name: `Lệch Tổng Thấp (${last3avg.toFixed(1)}) → Mean Reversion Tài`, priority: 8 };
  }
  return { detected: false };
}

// ==================== PHÂN TÍCH TỶ LỆ LỊCH SỬ GẦN ====================
function analyzeXacSuatLichSu(results, type) {
  // Dùng 30-50 phiên gần nhất để xác định xu hướng thực
  const window = Math.min(50, results.length);
  if (window < 20) return { detected: false };
  const r = results.slice(0, window);
  const taiCount = r.filter(x => x === 'Tài').length;
  const rate = taiCount / window;

  if (rate >= 0.62) {
    return { detected: true, prediction: 'Xỉu', confidence: 68 + (rate - 0.5) * 40,
      name: `Xác Suất Lịch Sử (${(rate*100).toFixed(0)}% Tài → Về Xỉu)`, priority: 6 };
  }
  if (rate <= 0.38) {
    return { detected: true, prediction: 'Tài', confidence: 68 + (0.5 - rate) * 40,
      name: `Xác Suất Lịch Sử (${((1-rate)*100).toFixed(0)}% Xỉu → Về Tài)`, priority: 6 };
  }
  return { detected: false };
}

// ==================== XU HƯỚNG MẠNH ====================
function analyzeXuHuongManh(results) {
  if (results.length < 8) return { detected: false };
  const r8 = results.slice(0, 8);
  const tc = r8.filter(x => x === 'Tài').length;
  if (tc >= 6) return { detected: true, prediction: 'Xỉu', confidence: 80, name: `Xu Hướng Mạnh (${tc}/8 Tài → Đảo)`, priority: 10 };
  if (tc <= 2) return { detected: true, prediction: 'Tài', confidence: 80, name: `Xu Hướng Mạnh (${8-tc}/8 Xỉu → Đảo)`, priority: 10 };
  return { detected: false };
}

function analyzeDaoChieu(results) {
  if (results.length < 5) return { detected: false };
  const r5 = results.slice(0, 5);
  for (let i = 0; i < r5.length - 1; i++) if (r5[i] === r5[i+1]) return { detected: false };
  return { detected: true, prediction: r5[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 75,
    name: `Đảo Chiều Chuỗi (${r5.join('-')})`, priority: 9 };
}

function analyzeTriplePattern(results) {
  if (results.length < 9) return { detected: false };
  const isT = (i) => results[i] === results[i+1] && results[i+1] === results[i+2];
  if (isT(0) && isT(3) && isT(6)) {
    const [t1, t2, t3] = [results[0], results[3], results[6]];
    if (t1 === t2 && t2 === t3)
      return { detected: true, prediction: t1 === 'Tài' ? 'Xỉu' : 'Tài', confidence: 88,
        name: `3 Bộ Ba Cùng ${t1} → Bẻ`, priority: 11 };
    if (t1 !== t2 && t2 !== t3)
      return { detected: true, prediction: t1, confidence: 80, name: 'Bộ Ba Đảo Chiều', priority: 10 };
  }
  return { detected: false };
}

function analyzeTongPhanTich(data) {
  if (data.length < 10) return { detected: false };
  const sums = data.slice(0, 10).map(d => d.Tong);
  const results = data.slice(0, 10).map(d => d.Ket_qua);
  const f5 = sums.slice(5).reduce((a,b)=>a+b,0)/5;
  const l5 = sums.slice(0,5).reduce((a,b)=>a+b,0)/5;
  const trend = l5 - f5;
  if (trend > 1.5) return { detected: true, prediction: 'Xỉu', confidence: 75,
    name: `Tổng Phân Tích (Tổng tăng ${trend.toFixed(1)})`, priority: 11 };
  if (trend < -1.5) return { detected: true, prediction: 'Tài', confidence: 75,
    name: `Tổng Phân Tích (Tổng giảm ${Math.abs(trend).toFixed(1)})`, priority: 11 };
  const tc = results.filter(r=>r==='Tài').length;
  if (Math.abs(tc - 5) >= 3) {
    const dom = tc > 5 ? 'Tài' : 'Xỉu';
    return { detected: true, prediction: dom === 'Tài' ? 'Xỉu' : 'Tài', confidence: 70,
      name: `Tổng Phân Tích (Lệch ${Math.abs(tc-5)} về ${dom})`, priority: 10 };
  }
  return { detected: false };
}

function analyzeElliottWave(results) {
  if (results.length < 8) return null;
  const changes = [];
  for (let i = 1; i < results.length; i++) if (results[i] !== results[i-1]) changes.push(i);
  for (let i = 0; i <= changes.length - 5; i++) {
    const segs = [1,2,3,4].map(j => changes[i+j] - changes[i+j-1]);
    if (segs[0] >= 2 && segs[1] >= 1 && segs[2] >= 2 && segs[3] >= 1) {
      return { detected: true, prediction: results[changes[i]], confidence: 75,
        name: 'Elliott Wave 5 (Impulse)', priority: 9 };
    }
  }
  return null;
}

function analyzeSupportResistance(data) {
  if (!data[0]) return null;
  const lastSum = data[0].Tong;
  const recent30 = data.slice(0, 30).map(d => d.Tong);
  const support = [3, 4, 5, 6, 7];
  const resistance = [14, 15, 16, 17, 18];
  if (resistance.includes(lastSum) && recent30.filter(t => resistance.includes(t)).length >= 3)
    return { detected: true, prediction: 'Xỉu', confidence: 73, name: `Kháng cự Tổng ${lastSum} → Xỉu`, priority: 7 };
  if (support.includes(lastSum) && recent30.filter(t => support.includes(t)).length >= 3)
    return { detected: true, prediction: 'Tài', confidence: 73, name: `Hỗ trợ Tổng ${lastSum} → Tài`, priority: 7 };
  return null;
}

// ==================== MARKOV BẬC 3 ====================
function analyzeMarkov3(results, type) {
  if (results.length < 4) return null;
  const m3 = learningData[type].markov3Matrix;
  if (!m3 || Object.keys(m3).length === 0) return null;

  const key = results[2] + '_' + results[1] + '_' + results[0];
  const taiKey = key + '_Tài';
  const xiuKey = key + '_Xỉu';
  const taiCount = m3[taiKey] || 0;
  const xiuCount = m3[xiuKey] || 0;
  const total = taiCount + xiuCount;
  if (total < 5) return null;

  const probTai = taiCount / total;
  if (probTai > 0.68) {
    return { detected: true, prediction: 'Tài', confidence: 68 + probTai * 18,
      name: `Markov bậc 3 (${(probTai*100).toFixed(0)}% Tài)`, priority: 10 };
  }
  if (probTai < 0.32) {
    return { detected: true, prediction: 'Xỉu', confidence: 68 + (1-probTai)*18,
      name: `Markov bậc 3 (${((1-probTai)*100).toFixed(0)}% Xỉu)`, priority: 10 };
  }
  return null;
}

// ==================== HÀM DỰ ĐOÁN CHÍNH (NÂNG CẤP) ====================
function calculateAdvancedPrediction(data, type) {
  const results = data.map(d => d.Ket_qua);
  updateMarkovMatrices(type, results);

  let predictions = [];
  const ld = learningData[type];

  // --- 1. MARKOV BẬC 1 ---
  const lastResult = results[0];
  if (lastResult) {
    const mm = ld.markovMatrix;
    const probTai = lastResult === 'Tài' ? mm.TT : mm.XT;
    const probXiu = lastResult === 'Tài' ? mm.TX : mm.XX;
    if (probTai > 0.60) predictions.push({ prediction: 'Tài', confidence: 63 + (probTai-0.5)*30, priority: 7, name: 'Markov bậc 1' });
    else if (probXiu > 0.60) predictions.push({ prediction: 'Xỉu', confidence: 63 + (probXiu-0.5)*30, priority: 7, name: 'Markov bậc 1' });
  }

  // --- 2. MARKOV BẬC 2 ---
  if (results.length >= 2) {
    const key = results[1] + '_' + results[0];
    const m2 = ld.markov2Matrix;
    const tc = m2[key + '_Tài'] || 0;
    const xc = m2[key + '_Xỉu'] || 0;
    const tot = tc + xc;
    if (tot >= 5) {
      const pT = tc / tot;
      if (pT > 0.65) predictions.push({ prediction: 'Tài', confidence: 68 + pT*15, priority: 9, name: 'Markov bậc 2' });
      else if (pT < 0.35) predictions.push({ prediction: 'Xỉu', confidence: 68 + (1-pT)*15, priority: 9, name: 'Markov bậc 2' });
    }
  }

  // --- 3. MARKOV BẬC 3 (MỚI) ---
  const m3result = analyzeMarkov3(results, type);
  if (m3result?.detected) predictions.push(m3result);

  // --- 4. BẺ CẦU THÔNG MINH ---
  const beSmart = analyzeBreakStreakSmart(results, type);
  if (beSmart?.detected) predictions.push(beSmart);

  // --- 5. THEO CẦU NHỊP CÁ NHÂN (MỚI) ---
  const theoCau = analyzeTheoCAuThongMinh(results, type);
  if (theoCau?.detected) predictions.push(theoCau);

  // --- 6. ZIGZAG ---
  const zigzag = analyzeZigzag(results);
  if (zigzag?.detected) predictions.push(zigzag);

  // --- 7. CÁC PATTERN CẦU TRUYỀN THỐNG ---
  const patternFns = [
    analyzeCauBet, analyzeCauDao11, analyzeCau22, analyzeCau33,
    analyzeCau121, analyzeCau22Plus, analyzeSmartBet, analyzeXuHuongManh,
    analyzeDaoChieu, analyzeTriplePattern
  ];
  for (const fn of patternFns) {
    const p = fn(results, type);
    if (p?.detected) predictions.push({ ...p, priority: p.priority || 5 });
  }

  // --- 8. LỆCH TỔNG MEAN REVERSION (MỚI) ---
  const lechTong = analyzeLechTong(data);
  if (lechTong?.detected) predictions.push(lechTong);

  // --- 9. TỔNG PHÂN TÍCH ---
  const tongPT = analyzeTongPhanTich(data);
  if (tongPT?.detected) predictions.push(tongPT);

  // --- 10. ELLIOTT WAVE ---
  const elliott = analyzeElliottWave(results);
  if (elliott?.detected) predictions.push(elliott);

  // --- 11. SUPPORT / RESISTANCE ---
  const sr = analyzeSupportResistance(data);
  if (sr?.detected) predictions.push(sr);

  // --- 12. XÁC SUẤT LỊCH SỬ ---
  const xsLs = analyzeXacSuatLichSu(results, type);
  if (xsLs?.detected) predictions.push(xsLs);

  // ==================== ENSEMBLE VOTE VỚI TRỌNG SỐ ADAPTIVE ====================
  let taiScore = 0, xiuScore = 0;
  for (const p of predictions) {
    const patId = getPatternId(p.name);
    const w = ld.patternWeights[patId] || 1.0;
    const score = p.confidence * w * (p.priority || 5);
    if (p.prediction === 'Tài') taiScore += score;
    else xiuScore += score;
  }

  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  const margin = Math.abs(taiScore - xiuScore) / (taiScore + xiuScore + 1);

  // ==================== REVERSAL MODE (CẢI TIẾN) ====================
  const streak = ld.streakAnalysis.currentStreak;
  // Chỉ bật reversal khi thua liên tục >= 4 lần VÀ không trong cooldown
  if (streak <= -4 && !ld.reversalState.active && (ld.reversalState.cooldown || 0) <= 0) {
    finalPrediction = finalPrediction === 'Tài' ? 'Xỉu' : 'Tài';
    ld.reversalState = { active: true, streakTrigger: streak, cooldown: 3 };
  } else if (streak > 0 && ld.reversalState.active) {
    ld.reversalState.active = false;
    ld.reversalState.cooldown = Math.max(0, (ld.reversalState.cooldown || 1) - 1);
  } else if (ld.reversalState.cooldown > 0) {
    ld.reversalState.cooldown--;
  }

  // ==================== TÍNH CONFIDENCE THỰC TẾ ====================
  const agreeCount = predictions.filter(p => p.prediction === finalPrediction).length;
  const totalVotes = predictions.length || 1;
  const agreementRate = agreeCount / totalVotes;

  // Volatility adjustment
  const sums = data.map(d => d.Tong);
  let sumChanges = [];
  for (let i = 1; i < Math.min(20, sums.length); i++) sumChanges.push(Math.abs(sums[i-1] - sums[i]));
  const avgChange = sumChanges.length > 0 ? sumChanges.reduce((a,b)=>a+b,0)/sumChanges.length : 2;
  ld.volatility = avgChange;
  const volatilityAdj = avgChange > 3.5 ? -5 : avgChange < 2 ? 3 : 0;

  // Base confidence từ đồng thuận + trọng số pattern
  let baseConf = 60;
  baseConf += agreementRate * 20;   // đồng thuận cao -> +20
  baseConf += margin * 15;          // margin score rõ ràng -> +15
  baseConf += volatilityAdj;

  // Boost nhỏ từ top patterns
  const topPats = [...predictions].sort((a,b) => b.priority - a.priority).slice(0, 3);
  for (const p of topPats) {
    if (p.prediction === finalPrediction) baseConf += (p.confidence - 65) * 0.15;
  }

  // Recent accuracy factor
  const recentAcc = ld.recentAccuracy.slice(-20);
  if (recentAcc.length >= 10) {
    const accRate = recentAcc.reduce((a,b)=>a+b,0) / recentAcc.length;
    baseConf += (accRate - 0.5) * 8;  // đang đúng nhiều thì boost nhẹ
  }

  const finalConf = Math.min(93, Math.max(55, Math.round(baseConf)));

  // ==================== THỐNG KÊ PATTERN WEIGHTS ====================
  // Cập nhật patternStats để tự học
  for (const p of predictions) {
    const patId = getPatternId(p.name);
    if (!ld.patternStats[patId]) {
      ld.patternStats[patId] = { total: 0, correct: 0, recentResults: [] };
    }
  }

  return {
    prediction: finalPrediction,
    confidence: finalConf,
    factors: predictions.map(p => p.name).slice(0, 10),
    allPatterns: predictions.map(p => `${p.name} → ${p.prediction} (${Math.round(p.confidence)}%)`).slice(0, 8),
    detailedAnalysis: {
      totalPatterns: predictions.length,
      taiVotes: predictions.filter(p => p.prediction === 'Tài').length,
      xiuVotes: predictions.filter(p => p.prediction === 'Xỉu').length,
      taiScore: Math.round(taiScore),
      xiuScore: Math.round(xiuScore),
      agreement: `${(agreementRate * 100).toFixed(0)}%`,
      margin: `${(margin * 100).toFixed(1)}%`,
      volatility: avgChange.toFixed(2),
      reversalMode: ld.reversalState.active,
      learningStats: {
        accuracy: ld.totalPredictions > 0
          ? (ld.correctPredictions / ld.totalPredictions * 100).toFixed(1) + '%' : 'N/A',
        totalPredictions: ld.totalPredictions,
        currentStreak: streak,
        recentAccuracy: recentAcc.length >= 5
          ? (recentAcc.slice(-10).reduce((a,b)=>a+b,0)/Math.min(10,recentAcc.length)*100).toFixed(1)+'%' : 'N/A'
      }
    }
  };
}

// ==================== CẬP NHẬT TRỌNG SỐ PATTERN SAU KHI XÁC MINH ====================
function updatePatternWeightsFromResult(type, patterns, isCorrect) {
  const ld = learningData[type];
  for (const pName of (patterns || [])) {
    const patId = getPatternId(pName);
    if (!patId || patId === 'unknown') continue;
    if (!ld.patternStats[patId]) ld.patternStats[patId] = { total: 0, correct: 0, recentResults: [] };
    ld.patternStats[patId].total++;
    if (isCorrect) ld.patternStats[patId].correct++;
    ld.patternStats[patId].recentResults.push(isCorrect ? 1 : 0);
    if (ld.patternStats[patId].recentResults.length > 30) ld.patternStats[patId].recentResults.shift();

    // Weight dựa trên 30 kết quả gần nhất (ưu tiên recent hơn overall)
    const recent = ld.patternStats[patId].recentResults;
    const recentAcc = recent.length >= 5
      ? recent.reduce((a,b)=>a+b,0) / recent.length
      : ld.patternStats[patId].correct / ld.patternStats[patId].total;

    // weight: 0.3 (pattern kém) đến 2.2 (pattern rất tốt)
    ld.patternWeights[patId] = Math.min(2.2, Math.max(0.3, 0.3 + recentAcc * 1.9));
  }
}

// ==================== XÁC MINH DỰ ĐOÁN ====================
async function verifyPredictions(type, currentData) {
  let updated = false;
  const ld = learningData[type];
  for (const pred of ld.predictions) {
    if (pred.verified) continue;
    const actual = currentData.find(d => d.Phien.toString() === pred.phien);
    if (actual) {
      pred.verified = true;
      pred.actual = actual.Ket_qua;
      pred.isCorrect = pred.prediction === pred.actual;
      ld.totalPredictions++;
      if (pred.isCorrect) {
        ld.correctPredictions++;
        ld.streakAnalysis.currentStreak = Math.max(1, ld.streakAnalysis.currentStreak + 1);
        ld.streakAnalysis.bestStreak = Math.max(ld.streakAnalysis.bestStreak, ld.streakAnalysis.currentStreak);
      } else {
        ld.streakAnalysis.currentStreak = Math.min(-1, ld.streakAnalysis.currentStreak - 1);
        ld.streakAnalysis.worstStreak = Math.min(ld.streakAnalysis.worstStreak, ld.streakAnalysis.currentStreak);
      }
      ld.recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (ld.recentAccuracy.length > 100) ld.recentAccuracy.shift();
      // Cập nhật trọng số pattern
      updatePatternWeightsFromResult(type, pred.patterns, pred.isCorrect);
      updated = true;
    }
  }
  if (updated) saveLearningData();
}

function recordPrediction(type, phien, prediction, confidence, patterns) {
  const ld = learningData[type];
  ld.predictions.unshift({
    phien: phien.toString(), prediction, confidence,
    patterns: patterns || [],
    timestamp: new Date().toISOString(),
    verified: false, actual: null, isCorrect: null
  });
  if (ld.predictions.length > 500) ld.predictions.pop();
  saveLearningData();
}

function savePredictionToHistory(type, phien, prediction, confidence, latestData) {
  const record = {
    Phien: latestData.Phien,
    Xuc_xac_1: latestData.Xuc_xac_1, Xuc_xac_2: latestData.Xuc_xac_2, Xuc_xac_3: latestData.Xuc_xac_3,
    Tong: latestData.Tong, Ket_qua: latestData.Ket_qua,
    Do_tin_cay: `${confidence}%`,
    Phien_hien_tai: phien.toString(),
    Du_doan: prediction,
    ket_qua_du_doan: '',
    id: '@Tskhang',
    timestamp: new Date().toISOString()
  };
  predictionHistory[type].unshift(record);
  if (predictionHistory[type].length > MAX_HISTORY) predictionHistory[type].pop();
  return record;
}

async function updateHistoryStatus(type) {
  const data = type === 'hu' ? await fetchDataHu() : await fetchDataMd5();
  if (!data) return;
  for (const record of predictionHistory[type]) {
    if (record.ket_qua_du_doan && record.ket_qua_du_doan !== '') continue;
    const actual = data.find(d => d.Phien.toString() === record.Phien_hien_tai);
    if (actual) {
      record.ket_qua_du_doan = record.Du_doan === actual.Ket_qua ? 'Đúng ✅' : 'Sai ❌';
    }
  }
  savePredictionHistory();
}

// ==================== AUTO PROCESS ====================
async function autoProcessPredictions() {
  try {
    for (const type of ['hu', 'md5']) {
      const data = type === 'hu' ? await fetchDataHu() : await fetchDataMd5();
      if (data && data.length > 0) {
        const nextPhien = data[0].Phien + 1;
        if (lastProcessedPhien[type] !== nextPhien) {
          await verifyPredictions(type, data);
          const result = calculateAdvancedPrediction(data, type);
          savePredictionToHistory(type, nextPhien, result.prediction, result.confidence, data[0]);
          recordPrediction(type, nextPhien, result.prediction, result.confidence, result.factors);
          lastProcessedPhien[type] = nextPhien;
          console.log(`[Auto] ${type.toUpperCase()} phiên ${nextPhien}: ${result.prediction} (${result.confidence}%) | ${result.detailedAnalysis.taiVotes}T/${result.detailedAnalysis.xiuVotes}X votes`);
        }
      }
    }
    savePredictionHistory();
    saveLearningData();
  } catch (e) { console.error('[Auto] Error:', e.message); }
}

function startAutoSaveTask() {
  setTimeout(autoProcessPredictions, 5000);
  setInterval(autoProcessPredictions, AUTO_SAVE_INTERVAL);
}

// ==================== ENDPOINTS ====================
app.get('/', (req, res) => res.send('t.me/Tskhang - API v9.0 Smart Pattern'));

app.get('/hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    await verifyPredictions('hu', data);
    const nextPhien = data[0].Phien + 1;
    const result = calculateAdvancedPrediction(data, 'hu');
    const record = savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
    setTimeout(() => updateHistoryStatus('hu'), 5000);
    res.json(record);
  } catch (e) { res.status(500).json({ error: 'Lỗi server' }); }
});

app.get('/md5', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    await verifyPredictions('md5', data);
    const nextPhien = data[0].Phien + 1;
    const result = calculateAdvancedPrediction(data, 'md5');
    const record = savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
    setTimeout(() => updateHistoryStatus('md5'), 5000);
    res.json(record);
  } catch (e) { res.status(500).json({ error: 'Lỗi server' }); }
});

app.get('/hu/lichsu', async (req, res) => {
  await updateHistoryStatus('hu');
  res.json({ type: 'Lẩu Cua 79 - HU', history: predictionHistory.hu, total: predictionHistory.hu.length, id: '@Tskhang' });
});

app.get('/md5/lichsu', async (req, res) => {
  await updateHistoryStatus('md5');
  res.json({ type: 'Lẩu Cua 79 - MD5', history: predictionHistory.md5, total: predictionHistory.md5.length, id: '@Tskhang' });
});

app.get('/hu/thamso', async (req, res) => {
  const data = await fetchDataHu();
  if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
  const result = calculateAdvancedPrediction(data, 'hu');
  res.json({ prediction: result.prediction, confidence: result.confidence, allPatterns: result.allPatterns, analysis: result.detailedAnalysis });
});

app.get('/md5/Thamso', async (req, res) => {
  const data = await fetchDataMd5();
  if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
  const result = calculateAdvancedPrediction(data, 'md5');
  res.json({ prediction: result.prediction, confidence: result.confidence, allPatterns: result.allPatterns, analysis: result.detailedAnalysis });
});

app.get('/hu/hochoi', (req, res) => {
  const s = learningData.hu;
  const acc = s.totalPredictions ? (s.correctPredictions / s.totalPredictions * 100).toFixed(2) : 0;
  const recent10 = s.recentAccuracy.slice(-10);
  const recAcc = recent10.length ? (recent10.reduce((a,b)=>a+b,0)/recent10.length*100).toFixed(1)+'%' : 'N/A';
  const topPatterns = Object.entries(s.patternStats)
    .filter(([,v]) => v.total >= 5)
    .map(([k,v]) => ({ pattern: k, accuracy: (v.correct/v.total*100).toFixed(1)+'%', total: v.total, weight: (s.patternWeights[k]||1).toFixed(2) }))
    .sort((a,b) => parseFloat(b.accuracy) - parseFloat(a.accuracy))
    .slice(0, 10);
  res.json({ type: 'HU Learning v9', totalPredictions: s.totalPredictions, correctPredictions: s.correctPredictions,
    accuracy: acc + '%', recentAccuracy: recAcc, streakAnalysis: s.streakAnalysis, topPatterns, id: '@Tskhang' });
});

app.get('/md5/Hochoi', (req, res) => {
  const s = learningData.md5;
  const acc = s.totalPredictions ? (s.correctPredictions / s.totalPredictions * 100).toFixed(2) : 0;
  const recent10 = s.recentAccuracy.slice(-10);
  const recAcc = recent10.length ? (recent10.reduce((a,b)=>a+b,0)/recent10.length*100).toFixed(1)+'%' : 'N/A';
  const topPatterns = Object.entries(s.patternStats)
    .filter(([,v]) => v.total >= 5)
    .map(([k,v]) => ({ pattern: k, accuracy: (v.correct/v.total*100).toFixed(1)+'%', total: v.total, weight: (s.patternWeights[k]||1).toFixed(2) }))
    .sort((a,b) => parseFloat(b.accuracy) - parseFloat(a.accuracy))
    .slice(0, 10);
  res.json({ type: 'MD5 Learning v9', totalPredictions: s.totalPredictions, correctPredictions: s.correctPredictions,
    accuracy: acc + '%', recentAccuracy: recAcc, streakAnalysis: s.streakAnalysis, topPatterns, id: '@Tskhang' });
});

app.get('/Resetdata', (req, res) => {
  learningData = { hu: makeEmptyTypeData(), md5: makeEmptyTypeData() };
  saveLearningData();
  res.json({ message: 'Learning data reset', version: 'v9.0', id: '@Tskhang' });
});

// KHỞI ĐỘNG
loadLearningData();
loadPredictionHistory();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server @Tskhang v9.0 running on http://0.0.0.0:${PORT}`);
  console.log('✅ Smart Pattern: Markov bậc 3, Bẻ cầu thông minh, Theo cầu nhịp, Adaptive weights');
  startAutoSaveTask();
});
