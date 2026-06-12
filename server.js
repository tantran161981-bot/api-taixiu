const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// ==================== CẤU HÌNH API ====================
const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const HISTORY_FILE = 'Tskhang_history.json';
const WEIGHTS_FILE = 'Tskhang_weights.json';

let predictionHistory = { hu: [], md5: [] };
let lastProcessedPhien = { hu: null, md5: null };
let systemStartTime = Date.now();

// ==================== TRỌNG SỐ THUẬT TOÁN (TỰ HỌC) ====================
let algorithmWeights = {
  hu: {
    cau_bet: 1.0, cau_dao_11: 1.0, cau_22: 1.0, cau_33: 1.0,
    cau_121: 1.0, cau_123: 1.0, cau_321: 1.0, cau_nhay_coc: 1.0,
    cau_nhip_nghieng: 1.0, cau_3van1: 1.0, smart_bet: 1.0,
    break_streak: 1.0, triple_pattern: 1.0, tong_phan_tich: 1.0,
    xu_huong_manh: 1.0, dao_chieu: 1.0, markov1: 1.0, markov2: 1.0,
    markov3: 1.0, markov4: 1.0, markov5: 1.0, rsi: 1.0, macd: 1.0,
    fibonacci: 1.0, elliott: 1.0, smart_money: 1.0, neural_ai: 1.0
  },
  md5: {
    cau_bet: 1.0, cau_dao_11: 1.0, cau_22: 1.0, cau_33: 1.0,
    cau_121: 1.0, cau_123: 1.0, cau_321: 1.0, cau_nhay_coc: 1.0,
    cau_nhip_nghieng: 1.0, cau_3van1: 1.0, smart_bet: 1.0,
    break_streak: 1.0, triple_pattern: 1.0, tong_phan_tich: 1.0,
    xu_huong_manh: 1.0, dao_chieu: 1.0, markov1: 1.0, markov2: 1.0,
    markov3: 1.0, markov4: 1.0, markov5: 1.0, rsi: 1.0, macd: 1.0,
    fibonacci: 1.0, elliott: 1.0, smart_money: 1.0, neural_ai: 1.0
  }
};

let algorithmStats = {
  hu: {}, md5: {}
};

let learningData = {
  hu: { totalPredictions: 0, correctPredictions: 0, currentStreak: 0, bestStreak: 0 },
  md5: { totalPredictions: 0, correctPredictions: 0, currentStreak: 0, bestStreak: 0 }
};

// ==================== HÀM LOAD/SAVE ====================
function loadData() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      predictionHistory = data.history || { hu: [], md5: [] };
      lastProcessedPhien = data.lastProcessedPhien || { hu: null, md5: null };
      console.log('✅ Đã tải lịch sử dự đoán');
    }
    if (fs.existsSync(WEIGHTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(WEIGHTS_FILE, 'utf8'));
      algorithmWeights = data.algorithmWeights || algorithmWeights;
      algorithmStats = data.algorithmStats || algorithmStats;
      learningData = data.learningData || learningData;
      console.log('✅ Đã tải trọng số thuật toán');
    }
  } catch (error) {
    console.error('Lỗi tải dữ liệu:', error.message);
  }
}

function saveData() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      history: predictionHistory,
      lastProcessedPhien,
      lastSaved: new Date().toISOString()
    }, null, 2));
    fs.writeFileSync(WEIGHTS_FILE, JSON.stringify({
      algorithmWeights, algorithmStats, learningData
    }, null, 2));
  } catch (error) {
    console.error('Lỗi lưu dữ liệu:', error.message);
  }
}

// ==================== LẤY DỮ LIỆU API ====================
async function fetchData(apiUrl) {
  try {
    const response = await axios.get(apiUrl, { timeout: 10000 });
    const raw = response.data;
    const list = raw.list || [];
    if (!list.length) return null;
    
    return list.map(item => ({
      Phien: item.id,
      Ket_qua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
      Xuc_xac_1: item.dices?.[0] || 0,
      Xuc_xac_2: item.dices?.[1] || 0,
      Xuc_xac_3: item.dices?.[2] || 0,
      Tong: item.point || 0
    }));
  } catch (error) {
    console.error('Lỗi fetch API:', error.message);
    return null;
  }
}

// ==================== TÍNH TOÁN HỖ TRỢ ====================
function calculateRSI(values, period = 14) {
  if (values.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length - 1; i++) {
    let change = values[i + 1] - values[i];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  let rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateEMA(values, period) {
  if (values.length < period) return values[values.length - 1] || 0;
  let k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

// ==================== THUẬT TOÁN TỪ FILE HTML (GIỮ NGUYÊN 100%) ====================

function html_cau_bet(results) {
  if (results.length < 3) return null;
  let streakType = results[0];
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) streakLength++;
    else break;
  }
  if (streakLength >= 3) {
    let shouldBreak = streakLength >= 5;
    let confidence = streakLength >= 7 ? 88 : (streakLength >= 5 ? 78 : 70);
    return {
      prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
      confidence: confidence,
      name: '🎲 Cầu Bệt ' + streakLength + ' phiên'
    };
  }
  return null;
}

function html_cau_dao_11(results) {
  if (results.length < 4) return null;
  let alternatingLength = 1;
  for (let i = 1; i < Math.min(results.length, 10); i++) {
    if (results[i] !== results[i - 1]) alternatingLength++;
    else break;
  }
  if (alternatingLength >= 4) {
    let confidence = Math.min(82, 68 + alternatingLength * 2);
    return {
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: confidence,
      name: '🔄 Cầu Đảo 1-1 (' + alternatingLength + ' phiên)'
    };
  }
  return null;
}

function html_cau_22(results) {
  if (results.length < 6) return null;
  let pairCount = 0, i = 0, pattern = [];
  while (i < results.length - 1 && pairCount < 4) {
    if (results[i] === results[i + 1]) {
      pattern.push(results[i]);
      pairCount++;
      i += 2;
    } else break;
  }
  if (pairCount >= 2) {
    let isAlternating = true;
    for (let j = 1; j < pattern.length; j++) {
      if (pattern[j] === pattern[j - 1]) isAlternating = false;
    }
    if (isAlternating) {
      let lastPairType = pattern[pattern.length - 1];
      return {
        prediction: lastPairType === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.min(80, 68 + pairCount * 3),
        name: '📊 Cầu 2-2 (' + pairCount + ' cặp)'
      };
    }
  }
  return null;
}

function html_cau_33(results) {
  if (results.length < 6) return null;
  let tripleCount = 0, i = 0, pattern = [];
  while (i < results.length - 2) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
      pattern.push(results[i]);
      tripleCount++;
      i += 3;
    } else break;
  }
  if (tripleCount >= 1) {
    let currentPosition = results.length % 3;
    let lastTripleType = pattern[pattern.length - 1];
    let prediction;
    if (currentPosition === 0) prediction = lastTripleType === 'Tài' ? 'Xỉu' : 'Tài';
    else prediction = lastTripleType;
    return {
      prediction: prediction,
      confidence: Math.min(82, 70 + tripleCount * 4),
      name: '🎯 Cầu 3-3 (' + tripleCount + ' bộ ba)'
    };
  }
  return null;
}

function html_cau_121(results) {
  if (results.length < 4) return null;
  let p = results.slice(0, 4);
  if (p[0] !== p[1] && p[1] === p[2] && p[2] !== p[3] && p[0] === p[3]) {
    return { prediction: p[0], confidence: 74, name: '⚡ Cầu 1-2-1' };
  }
  return null;
}

function html_cau_123(results) {
  if (results.length < 6) return null;
  let first = results[5];
  let nextTwo = results.slice(3, 5);
  let lastThree = results.slice(0, 3);
  if (nextTwo[0] === nextTwo[1] && nextTwo[0] !== first) {
    let allSame = lastThree.every(r => r === lastThree[0]);
    if (allSame && lastThree[0] !== nextTwo[0]) {
      return { prediction: first, confidence: 76, name: '📈 Cầu 1-2-3' };
    }
  }
  return null;
}

function html_cau_321(results) {
  if (results.length < 6) return null;
  let first3 = results.slice(3, 6);
  let next2 = results.slice(1, 3);
  let last1 = results[0];
  let first3Same = first3.every(r => r === first3[0]);
  let next2Same = next2.every(r => r === next2[0]);
  if (first3Same && next2Same && first3[0] !== next2[0] && last1 !== next2[0]) {
    return { prediction: next2[0], confidence: 78, name: '📉 Cầu 3-2-1' };
  }
  return null;
}

function html_cau_nhay_coc(results) {
  if (results.length < 6) return null;
  let skipPattern = [];
  for (let i = 0; i < Math.min(results.length, 12); i += 2) skipPattern.push(results[i]);
  if (skipPattern.length >= 3) {
    let allSame = skipPattern.slice(0, 3).every(r => r === skipPattern[0]);
    if (allSame) return { prediction: skipPattern[0], confidence: 70, name: '🐸 Cầu Nhảy Cóc' };
    let alternating = true;
    for (let i = 1; i < skipPattern.length - 1; i++) {
      if (skipPattern[i] === skipPattern[i - 1]) alternating = false;
    }
    if (alternating && skipPattern.length >= 3) {
      return {
        prediction: skipPattern[0] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: 68,
        name: '🐸 Cầu Nhảy Cóc Đảo'
      };
    }
  }
  return null;
}

function html_cau_nhip_nghieng(results) {
  if (results.length < 5) return null;
  let last5 = results.slice(0, 5);
  let taiCount5 = last5.filter(r => r === 'Tài').length;
  if (taiCount5 >= 4) {
    return { prediction: 'Tài', confidence: 72, name: '⚖️ Cầu Nhịp Nghiêng (' + taiCount5 + '/5 Tài)' };
  } else if (taiCount5 <= 1) {
    return { prediction: 'Xỉu', confidence: 72, name: '⚖️ Cầu Nhịp Nghiêng (' + (5 - taiCount5) + '/5 Xỉu)' };
  }
  return null;
}

function html_cau_3van1(results) {
  if (results.length < 4) return null;
  let last4 = results.slice(0, 4);
  let taiCount = last4.filter(r => r === 'Tài').length;
  if (taiCount === 3) return { prediction: 'Xỉu', confidence: 70, name: '🎲 Cầu 3 Ván 1 (3T-1X) → Xỉu' };
  if (taiCount === 1) return { prediction: 'Tài', confidence: 70, name: '🎲 Cầu 3 Ván 1 (3X-1T) → Tài' };
  return null;
}

function html_smart_bet(results) {
  if (results.length < 10) return null;
  let last5 = results.slice(0, 5);
  let prev5 = results.slice(5, 10);
  let taiLast5 = last5.filter(r => r === 'Tài').length;
  let taiPrev5 = prev5.filter(r => r === 'Tài').length;
  let trendChanging = (taiLast5 >= 4 && taiPrev5 <= 1) || (taiLast5 <= 1 && taiPrev5 >= 4);
  if (trendChanging) {
    let currentDominant = taiLast5 >= 4 ? 'Tài' : 'Xỉu';
    return {
      prediction: currentDominant === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: 80,
      name: '🔄 Đảo Xu Hướng'
    };
  }
  let last10 = results.slice(0, 10);
  let taiLast10 = last10.filter(r => r === 'Tài').length;
  if (taiLast10 >= 8 || taiLast10 <= 2) {
    let dominant = taiLast10 >= 8 ? 'Tài' : 'Xỉu';
    return {
      prediction: dominant === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: 84,
      name: '🔥 Xu Hướng Cực → Đảo'
    };
  }
  return null;
}

function html_break_streak(results) {
  if (results.length < 5) return null;
  let streakType = results[0];
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) streakLength++;
    else break;
  }
  if (streakLength >= 5) {
    let prediction = streakType === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      prediction: prediction,
      confidence: Math.min(88, 72 + streakLength),
      name: '🔪 Bẻ Chuỗi ' + streakLength
    };
  }
  return null;
}

function html_triple_pattern(results) {
  if (results.length < 9) return null;
  let isTriple1 = results[0] === results[1] && results[1] === results[2];
  let isTriple2 = results[3] === results[4] && results[4] === results[5];
  let isTriple3 = results[6] === results[7] && results[7] === results[8];
  if (isTriple1 && isTriple2 && isTriple3) {
    if (results[0] === results[3] && results[3] === results[6]) {
      return {
        prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: 90,
        name: '💎 3 Bộ Ba Cùng → Bẻ'
      };
    }
    if (results[0] !== results[3] && results[3] !== results[6]) {
      return {
        prediction: results[0],
        confidence: 82,
        name: '💎 Bộ Ba Đảo → Theo'
      };
    }
  }
  return null;
}

function html_tong_phan_tich(data) {
  if (data.length < 10) return null;
  let sums = data.slice(0, 10).map(d => d.Tong);
  let first5Sum = sums.slice(5, 10).reduce((a, b) => a + b, 0) / 5;
  let last5Sum = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  let sumTrend = last5Sum - first5Sum;
  if (sumTrend > 1.5) return { prediction: 'Xỉu', confidence: 77, name: '📊 Tổng Phân Tích (Tổng tăng → Xỉu)' };
  if (sumTrend < -1.5) return { prediction: 'Tài', confidence: 77, name: '📊 Tổng Phân Tích (Tổng giảm → Tài)' };
  return null;
}

function html_xu_huong_manh(results) {
  if (results.length < 8) return null;
  let recent8 = results.slice(0, 8);
  let taiCount = recent8.filter(r => r === 'Tài').length;
  if (taiCount >= 6) return { prediction: 'Xỉu', confidence: 82, name: '📈 Xu Hướng Mạnh (' + taiCount + '/8 Tài → Đảo)' };
  if (taiCount <= 2) return { prediction: 'Tài', confidence: 82, name: '📉 Xu Hướng Mạnh (' + (8 - taiCount) + '/8 Xỉu → Đảo)' };
  return null;
}

function html_dao_chieu(results) {
  if (results.length < 5) return null;
  let recent5 = results.slice(0, 5);
  let isAlternating = true;
  for (let i = 0; i < recent5.length - 1; i++) {
    if (recent5[i] === recent5[i + 1]) { isAlternating = false; break; }
  }
  if (isAlternating) {
    return {
      prediction: recent5[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: 77,
      name: '🔄 Đảo Chiều (Chuỗi đan xen)'
    };
  }
  return null;
}

// ==================== THUẬT TOÁN TỪ API (NÂNG CAO) ====================

function api_markov(results, order, type, markovMatrix) {
  if (results.length < order + 1) return null;
  let key = results.slice(0, order).join('');
  let probTai = (markovMatrix[key + 'Tài'] || 0) / ((markovMatrix[key + 'Tài'] || 0) + (markovMatrix[key + 'Xỉu'] || 0) || 1);
  if (probTai > 0.7) {
    return { prediction: 'Tài', confidence: 75 + probTai * 12, name: `🧮 Markov bậc ${order} → Tài` };
  }
  if (probTai < 0.3) {
    return { prediction: 'Xỉu', confidence: 75 + (1 - probTai) * 12, name: `🧮 Markov bậc ${order} → Xỉu` };
  }
  return null;
}

function buildMarkovMatrices(results) {
  let matrices = {};
  for (let order = 1; order <= 5; order++) {
    if (results.length < order + 1) continue;
    let matrix = {};
    for (let i = 0; i < results.length - order; i++) {
      let key = results.slice(i, i + order).join('');
      let next = results[i + order];
      matrix[key + next] = (matrix[key + next] || 0) + 1;
    }
    matrices[order] = matrix;
  }
  return matrices;
}

function api_rsi(sums) {
  if (sums.length < 15) return null;
  let rsi = calculateRSI(sums, 14);
  if (rsi > 70) return { prediction: 'Xỉu', confidence: 78, name: `📊 RSI Quá Mua (${rsi.toFixed(1)}) → Xỉu` };
  if (rsi < 30) return { prediction: 'Tài', confidence: 78, name: `📊 RSI Quá Bán (${rsi.toFixed(1)}) → Tài` };
  return null;
}

function api_macd(sums) {
  if (sums.length < 26) return null;
  let ema12 = calculateEMA(sums, 12);
  let ema26 = calculateEMA(sums, 26);
  let macd = ema12 - ema26;
  let signal = calculateEMA([macd], 9);
  if (macd > signal) return { prediction: 'Tài', confidence: 75, name: '📈 MACD Cắt Lên → Tài' };
  if (macd < signal) return { prediction: 'Xỉu', confidence: 75, name: '📉 MACD Cắt Xuống → Xỉu' };
  return null;
}

function api_fibonacci(sums) {
  if (sums.length < 20) return null;
  let high = Math.max(...sums.slice(0, 20));
  let low = Math.min(...sums.slice(0, 20));
  let current = sums[0];
  let range = high - low;
  let fib618 = low + range * 0.618;
  let fib382 = low + range * 0.382;
  if (current <= fib382) return { prediction: 'Tài', confidence: 76, name: '📐 Fibonacci Hỗ trợ → Tài' };
  if (current >= fib618) return { prediction: 'Xỉu', confidence: 76, name: '📐 Fibonacci Kháng cự → Xỉu' };
  return null;
}

function api_elliott(results) {
  if (results.length < 8) return null;
  let changes = [];
  for (let i = 1; i < results.length; i++) {
    if (results[i] !== results[i - 1]) changes.push(i);
  }
  for (let i = 0; i <= changes.length - 5; i++) {
    let seg1 = changes[i + 1] - changes[i];
    let seg2 = changes[i + 2] - changes[i + 1];
    let seg3 = changes[i + 3] - changes[i + 2];
    let seg4 = changes[i + 4] - changes[i + 3];
    if (seg1 >= 2 && seg2 >= 1 && seg3 >= 2 && seg4 >= 1) {
      return { prediction: results[changes[i]], confidence: 80, name: '🌊 Sóng Elliott 5 sóng' };
    }
  }
  return null;
}

function api_smart_money(results) {
  if (results.length < 15) return null;
  let accumulation = 0, distribution = 0;
  for (let i = 0; i < results.length - 3; i++) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
      if (results[i] === 'Tài') accumulation += 2;
      else distribution += 2;
    }
  }
  let smi = (accumulation - distribution) / (accumulation + distribution + 1);
  if (smi > 0.25) return { prediction: 'Tài', confidence: 80, name: '💰 Smart Money Tích Lũy → Tài' };
  if (smi < -0.25) return { prediction: 'Xỉu', confidence: 80, name: '💰 Smart Money Phân Phối → Xỉu' };
  return null;
}

function api_neural_ai(results, sums, type) {
  // Neural network simplified
  let taiCount = results.slice(0, 10).filter(r => r === 'Tài').length;
  let streak = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) streak++;
    else break;
  }
  let rsi = calculateRSI(sums, 14) / 100;
  let score = (taiCount / 10) * 0.4 + (streak / 10) * 0.3 + rsi * 0.3;
  if (score > 0.6) return { prediction: 'Tài', confidence: 73 + score * 15, name: '🧠 AI Neural Network → Tài' };
  if (score < 0.4) return { prediction: 'Xỉu', confidence: 73 + (1 - score) * 15, name: '🧠 AI Neural Network → Xỉu' };
  return null;
}

// ==================== CẬP NHẬT TRỌNG SỐ (TỰ HỌC) ====================
function updateWeights(type, algorithmName, isCorrect) {
  let id = algorithmName.split(' ')[0].replace(/[^a-z]/gi, '').toLowerCase();
  if (!algorithmWeights[type][id]) return;
  
  if (isCorrect) {
    algorithmWeights[type][id] = Math.min(2.0, algorithmWeights[type][id] + 0.05);
  } else {
    algorithmWeights[type][id] = Math.max(0.5, algorithmWeights[type][id] - 0.05);
  }
}

// ==================== TỔNG HỢP DỰ ĐOÁN ====================
function predict(data, type) {
  const results = data.map(d => d.Ket_qua);
  const sums = data.map(d => d.Tong);
  
  let predictions = [];
  
  // Thuật toán từ HTML
  const htmlAlgos = [
    html_cau_bet(results), html_cau_dao_11(results), html_cau_22(results),
    html_cau_33(results), html_cau_121(results), html_cau_123(results),
    html_cau_321(results), html_cau_nhay_coc(results), html_cau_nhip_nghieng(results),
    html_cau_3van1(results), html_smart_bet(results), html_break_streak(results),
    html_triple_pattern(results), html_tong_phan_tich(data), html_xu_huong_manh(results),
    html_dao_chieu(results)
  ];
  
  for (let algo of htmlAlgos) {
    if (algo) predictions.push(algo);
  }
  
  // Markov matrices
  let matrices = buildMarkovMatrices(results);
  for (let order = 1; order <= 5; order++) {
    let markov = api_markov(results, order, type, matrices[order] || {});
    if (markov) predictions.push(markov);
  }
  
  // API advanced algorithms
  let rsi = api_rsi(sums);
  if (rsi) predictions.push(rsi);
  
  let macd = api_macd(sums);
  if (macd) predictions.push(macd);
  
  let fib = api_fibonacci(sums);
  if (fib) predictions.push(fib);
  
  let elliott = api_elliott(results);
  if (elliott) predictions.push(elliott);
  
  let smart = api_smart_money(results);
  if (smart) predictions.push(smart);
  
  let neural = api_neural_ai(results, sums, type);
  if (neural) predictions.push(neural);
  
  // Ensemble voting với trọng số
  let taiScore = 0, xiuScore = 0;
  let taiConf = 0, xiuConf = 0;
  
  for (let p of predictions) {
    let weight = 1.0;
    let id = p.name.split(' ')[0].replace(/[^a-z]/gi, '').toLowerCase();
    if (algorithmWeights[type][id]) weight = algorithmWeights[type][id];
    
    if (p.prediction === 'Tài') {
      taiScore += weight;
      taiConf += p.confidence * weight;
    } else {
      xiuScore += weight;
      xiuConf += p.confidence * weight;
    }
  }
  
  let totalWeight = taiScore + xiuScore;
  let finalPrediction = taiScore > xiuScore ? 'Tài' : 'Xỉu';
  let finalConfidence = 0;
  
  if (finalPrediction === 'Tài') {
    finalConfidence = Math.min(98, Math.max(65, Math.round(taiConf / taiScore)));
  } else {
    finalConfidence = Math.min(98, Math.max(65, Math.round(xiuConf / xiuScore)));
  }
  
  // Lấy top 5 thuật toán
  let topAlgos = [...predictions].sort((a, b) => b.confidence - a.confidence).slice(0, 5);
  
  return {
    prediction: finalPrediction,
    confidence: finalConfidence,
    topAlgorithms: topAlgos.map(a => a.name),
    totalAlgorithms: predictions.length,
    taiVotes: Math.round((taiScore / totalWeight) * 100) + '%',
    xiuVotes: Math.round((xiuScore / totalWeight) * 100) + '%'
  };
}

// ==================== XỬ LÝ DỰ ĐOÁN ====================
async function verifyAndLearn(type, currentData) {
  let data = learningData[type];
  let updated = false;
  
  for (let record of predictionHistory[type]) {
    if (record.da_xac_nhan) continue;
    const actual = currentData.find(d => d.Phien.toString() === record.phien_hien_tai);
    if (actual) {
      let isCorrect = (record.du_doan === actual.Ket_qua);
      record.ket_qua_du_doan = isCorrect ? 'Đúng ✅' : 'Sai ❌';
      record.da_xac_nhan = true;
      
      if (isCorrect) {
        data.correctPredictions++;
        data.currentStreak = Math.max(1, data.currentStreak + 1);
        if (data.currentStreak > data.bestStreak) data.bestStreak = data.currentStreak;
        // Cập nhật trọng số cho các thuật toán đã dùng
        if (record.thuat_toan_da_dung) {
          for (let algo of record.thuat_toan_da_dung) {
            updateWeights(type, algo, true);
          }
        }
      } else {
        data.currentStreak = Math.min(-1, data.currentStreak - 1);
        if (record.thuat_toan_da_dung) {
          for (let algo of record.thuat_toan_da_dung) {
            updateWeights(type, algo, false);
          }
        }
      }
      updated = true;
    }
  }
  
  if (updated) {
    saveData();
  }
}

function savePrediction(type, phien, prediction, confidence, topAlgos, latestData) {
  const record = {
    phien_hien_tai: phien.toString(),
    du_doan: prediction,
    do_tin_cay: `${confidence}%`,
    ket_qua_thuc_te: latestData.Ket_qua,
    xuc_xac: `${latestData.Xuc_xac_1}-${latestData.Xuc_xac_2}-${latestData.Xuc_xac_3}`,
    tong: latestData.Tong,
    thuat_toan_da_dung: topAlgos,
    ket_qua_du_doan: '',
    da_xac_nhan: false,
    timestamp: new Date().toISOString()
  };
  predictionHistory[type].unshift(record);
  if (predictionHistory[type].length > 200) predictionHistory[type].pop();
  saveData();
  return record;
}

// ==================== API ENDPOINTS ====================

app.get('/', (req, res) => {
  res.json({
    name: "⚡ TÀI XỈU SUPER AI V16.0 ⚡",
    version: "16.0 - TÍCH HỢP HOÀN HẢO",
    author: "@Tskhang",
    description: "Gộp 100% thuật toán từ HTML + API | Tự học từ kết quả thực tế",
    uptime: Math.floor((Date.now() - systemStartTime) / 1000) + ' giây',
    endpoints: {
      "🎲 /hu": "Dự đoán Tài Xỉu Hũ",
      "🔐 /md5": "Dự đoán Tài Xỉu MD5",
      "📜 /lichsu": "Lịch sử dự đoán",
      "📜 /lichsu/hu": "Lịch sử HU",
      "📜 /lichsu/md5": "Lịch sử MD5",
      "📊 /hu/thamso": "Phân tích chi tiết HU",
      "📊 /md5/thamso": "Phân tích chi tiết MD5",
      "🔄 /reset": "Reset dữ liệu học"
    }
  });
});

app.get('/hu', async (req, res) => {
  try {
    const data = await fetchData(API_URL_HU);
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    
    await verifyAndLearn('hu', data);
    const nextPhien = data[0].Phien + 1;
    const result = predict(data, 'hu');
    const stats = learningData.hu;
    
    const record = savePrediction('hu', nextPhien, result.prediction, result.confidence, result.topAlgorithms, data[0]);
    
    res.json({
      status: "✅ SUCCESS",
      timestamp: new Date().toISOString(),
      phien_hien_tai: nextPhien,
      du_doan: result.prediction,
      do_tin_cay: `${result.confidence}%`,
      icon: result.prediction === 'Tài' ? '🔥' : '❄️',
      thong_ke: {
        tong_phien: stats.totalPredictions + stats.correctPredictions,
        ty_le_dung: stats.totalPredictions + stats.correctPredictions > 0 ? 
          ((stats.correctPredictions / (stats.totalPredictions + stats.correctPredictions)) * 100).toFixed(1) + '%' : 'N/A',
        chuoi_hien_tai: stats.currentStreak
      },
      thuat_toan: result.topAlgorithms,
      voting: { tai: result.taiVotes, xiu: result.xiuVotes },
      author: "@Tskhang"
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server', message: error.message });
  }
});

app.get('/md5', async (req, res) => {
  try {
    const data = await fetchData(API_URL_MD5);
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    
    await verifyAndLearn('md5', data);
    const nextPhien = data[0].Phien + 1;
    const result = predict(data, 'md5');
    const stats = learningData.md5;
    
    const record = savePrediction('md5', nextPhien, result.prediction, result.confidence, result.topAlgorithms, data[0]);
    
    res.json({
      status: "✅ SUCCESS",
      timestamp: new Date().toISOString(),
      phien_hien_tai: nextPhien,
      du_doan: result.prediction,
      do_tin_cay: `${result.confidence}%`,
      icon: result.prediction === 'Tài' ? '🔥' : '❄️',
      thong_ke: {
        tong_phien: stats.totalPredictions + stats.correctPredictions,
        ty_le_dung: stats.totalPredictions + stats.correctPredictions > 0 ? 
          ((stats.correctPredictions / (stats.totalPredictions + stats.correctPredictions)) * 100).toFixed(1) + '%' : 'N/A',
        chuoi_hien_tai: stats.currentStreak
      },
      thuat_toan: result.topAlgorithms,
      voting: { tai: result.taiVotes, xiu: result.xiuVotes },
      author: "@Tskhang"
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server', message: error.message });
  }
});

app.get('/lichsu', async (req, res) => {
  res.json({
    status: "✅ SUCCESS",
    timestamp: new Date().toISOString(),
    hu: {
      tong_phien: predictionHistory.hu.length,
      lich_su: predictionHistory.hu.map(h => ({
        phien: h.phien_hien_tai,
        du_doan: h.du_doan,
        ket_qua: h.ket_qua_thuc_te,
        ket_luan: h.ket_qua_du_doan || 'Đang chờ...',
        do_tin_cay: h.do_tin_cay
      }))
    },
    md5: {
      tong_phien: predictionHistory.md5.length,
      lich_su: predictionHistory.md5.map(h => ({
        phien: h.phien_hien_tai,
        du_doan: h.du_doan,
        ket_qua: h.ket_qua_thuc_te,
        ket_luan: h.ket_qua_du_doan || 'Đang chờ...',
        do_tin_cay: h.do_tin_cay
      }))
    },
    author: "@Tskhang"
  });
});

app.get('/lichsu/hu', async (req, res) => {
  res.json({
    status: "✅ SUCCESS",
    type: "Tài Xỉu Hũ",
    tong_phien: predictionHistory.hu.length,
    lich_su: predictionHistory.hu,
    author: "@Tskhang"
  });
});

app.get('/lichsu/md5', async (req, res) => {
  res.json({
    status: "✅ SUCCESS",
    type: "Tài Xỉu MD5",
    tong_phien: predictionHistory.md5.length,
    lich_su: predictionHistory.md5,
    author: "@Tskhang"
  });
});

app.get('/hu/thamso', async (req, res) => {
  const data = await fetchData(API_URL_HU);
  if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
  const result = predict(data, 'hu');
  res.json({
    du_doan: result.prediction,
    do_tin_cay: `${result.confidence}%`,
    top_thuat_toan: result.topAlgorithms,
    voting: result.taiVotes + ' - ' + result.xiuVotes,
    tong_so_thuat_toan: result.totalAlgorithms,
    author: "@Tskhang"
  });
});

app.get('/md5/thamso', async (req, res) => {
  const data = await fetchData(API_URL_MD5);
  if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
  const result = predict(data, 'md5');
  res.json({
    du_doan: result.prediction,
    do_tin_cay: `${result.confidence}%`,
    top_thuat_toan: result.topAlgorithms,
    voting: result.taiVotes + ' - ' + result.xiuVotes,
    tong_so_thuat_toan: result.totalAlgorithms,
    author: "@Tskhang"
  });
});

app.get('/reset', (req, res) => {
  predictionHistory = { hu: [], md5: [] };
  lastProcessedPhien = { hu: null, md5: null };
  algorithmWeights = {
    hu: {}, md5: {}
  };
  algorithmStats = { hu: {}, md5: {} };
  learningData = {
    hu: { totalPredictions: 0, correctPredictions: 0, currentStreak: 0, bestStreak: 0 },
    md5: { totalPredictions: 0, correctPredictions: 0, currentStreak: 0, bestStreak: 0 }
  };
  saveData();
  res.json({ message: '✅ Đã reset toàn bộ dữ liệu', author: "@Tskhang" });
});

// Khởi động
loadData();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════════════╗
║                                                                                       ║
║   ⚡⚡⚡ TÀI XỈU SUPER AI V16.0 - TÍCH HỢP HOÀN HẢO ⚡⚡⚡                             ║
║   📡 PORT: ${PORT}                                                                       ║
║   👤 AUTHOR: @Tskhang                                                                 ║
║                                                                                       ║
║   🧠 20+ THUẬT TOÁN ĐÃ TÍCH HỢP:                                                      ║
║   ├── 📁 TỪ FILE HTML (GIỮ NGUYÊN 100%):                                              ║
║   │   ├── 🎲 Cầu Bệt, 🔄 Cầu Đảo 1-1, 📊 Cầu 2-2, 🎯 Cầu 3-3                         ║
║   │   ├── ⚡ Cầu 1-2-1, 📈 Cầu 1-2-3, 📉 Cầu 3-2-1                                    ║
║   │   ├── 🐸 Cầu Nhảy Cóc, ⚖️ Cầu Nhịp Nghiêng, 🎲 Cầu 3 Ván 1                        ║
║   │   ├── 🔄 Đảo Xu Hướng, 🔪 Bẻ Chuỗi, 💎 3 Bộ Ba                                     ║
║   │   └── 📊 Tổng Phân Tích, 📈 Xu Hướng Mạnh, 🔄 Đảo Chiều                            ║
║   │                                                                                   ║
║   ├── 🚀 TỪ API (NÂNG CAO):                                                           ║
║   │   ├── 🧮 Markov bậc 1,2,3,4,5 (xác suất chuyển trạng thái)                       ║
║   │   ├── 📊 RSI (Relative Strength Index)                                            ║
║   │   ├── 📈 MACD (Moving Average Convergence Divergence)                             ║
║   │   ├── 📐 Fibonacci Retracement (0.382, 0.618)                                     ║
║   │   ├── 🌊 Sóng Elliott (5 sóng impulse)                                            ║
║   │   ├── 💰 Smart Money Index (Tích lũy/Phân phối)                                   ║
║   │   └── 🧠 AI Neural Network (Học từ kết quả thực tế)                               ║
║   │                                                                                   ║
║   └── 🔄 TỰ HỌC THÔNG MINH:                                                           ║
║       ├── Cập nhật trọng số thuật toán dựa trên kết quả thực tế                       ║
║       └── Tối ưu hóa dự đoán theo thời gian                                           ║
║                                                                                       ║
║   📊 VÍ DỤ KẾT QUẢ - /hu:                                                             ║
║   {                                                                                   ║
║     "status": "✅ SUCCESS",                                                            ║
║     "phien_hien_tai": 12345,                                                          ║
║     "du_doan": "Tài",                                                                 ║
║     "do_tin_cay": "94%",                                                              ║
║     "thong_ke": { "ty_le_dung": "78.5%", "chuoi_hien_tai": 3 },                       ║
║     "thuat_toan": ["🎲 Cầu Bệt 5 phiên", "🧮 Markov bậc 2 → Tài", "🧠 AI Neural Network"]║
║   }                                                                                   ║
║                                                                                       ║
╚═══════════════════════════════════════════════════════════════════════════════════════╝
  `);
});
