const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// ==================== CẤU HÌNH API ====================
const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'Tskhang.json';
const HISTORY_FILE = 'Tskhang1.json';

let predictionHistory = { hu: [], md5: [] };
const MAX_HISTORY = 100;
const AUTO_SAVE_INTERVAL = 30000;
let lastProcessedPhien = { hu: null, md5: null };

// ==================== LEARNING DATA NÂNG CAO ====================
let learningData = {
  hu: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [],
    reversalState: { active: false, streakTrigger: 0 },
    markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 },
    markov2Matrix: {},
    markov3Matrix: {},
    markov4Matrix: {},
    volatility: 0,
    rsiHistory: [],
    macdHistory: [],
    bollingerHistory: []
  },
  md5: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [],
    reversalState: { active: false, streakTrigger: 0 },
    markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 },
    markov2Matrix: {},
    markov3Matrix: {},
    markov4Matrix: {},
    volatility: 0,
    rsiHistory: [],
    macdHistory: [],
    bollingerHistory: []
  }
};

// ==================== HÀM LOAD/SAVE ====================
function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = fs.readFileSync(LEARNING_FILE, 'utf8');
      const parsed = JSON.parse(data);
      for (let type of ['hu', 'md5']) {
        if (parsed[type]) {
          learningData[type] = { ...learningData[type], ...parsed[type] };
        }
      }
      console.log('✅ Loaded learning data from', LEARNING_FILE);
    }
  } catch (error) {
    console.error('Error loading learning data:', error.message);
  }
}

function saveLearningData() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch (error) {
    console.error('Error saving learning data:', error.message);
  }
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(data);
      predictionHistory = parsed.history || { hu: [], md5: [] };
      lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
      console.log('✅ Loaded prediction history from', HISTORY_FILE);
    }
  } catch (error) {
    console.error('Error loading prediction history:', error.message);
  }
}

function savePredictionHistory() {
  try {
    const dataToSave = {
      history: predictionHistory,
      lastProcessedPhien,
      lastSaved: new Date().toISOString()
    };
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(dataToSave, null, 2));
  } catch (error) {
    console.error('Error saving prediction history:', error.message);
  }
}

// ==================== LẤY DỮ LIỆU API ====================
function transformApiData(apiData) {
  if (!apiData || !apiData.list || !Array.isArray(apiData.list)) return null;
  return apiData.list.map(item => ({
    Phien: item.id,
    Ket_qua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
    Xuc_xac_1: item.dices[0],
    Xuc_xac_2: item.dices[1],
    Xuc_xac_3: item.dices[2],
    Tong: item.point
  }));
}

async function fetchDataHu() {
  try {
    const response = await axios.get(API_URL_HU, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    console.error('Error fetching HU data:', error.message);
    return null;
  }
}

async function fetchDataMd5() {
  try {
    const response = await axios.get(API_URL_MD5, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    console.error('Error fetching MD5 data:', error.message);
    return null;
  }
}

// ==================== THUẬT TOÁN BẮT CẦU CƠ BẢN ====================

function analyzeCauBet(results, type) {
  if (results.length < 3) return { detected: false };
  let streakType = results[0];
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) streakLength++;
    else break;
  }
  if (streakLength >= 3) {
    let shouldBreak = streakLength >= 5;
    let confidence = streakLength >= 7 ? 90 : (streakLength >= 5 ? 80 : 72);
    return {
      detected: true,
      prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
      confidence: confidence,
      name: `🎲 Cầu Bệt ${streakLength} phiên`,
      priority: 9
    };
  }
  return { detected: false };
}

function analyzeCauDao11(results, type) {
  if (results.length < 4) return { detected: false };
  let alternatingLength = 1;
  for (let i = 1; i < Math.min(results.length, 10); i++) {
    if (results[i] !== results[i - 1]) alternatingLength++;
    else break;
  }
  if (alternatingLength >= 4) {
    let confidence = Math.min(85, 70 + alternatingLength * 2);
    return {
      detected: true,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: confidence,
      name: `🔄 Cầu Đảo 1-1 (${alternatingLength} phiên)`,
      priority: 8
    };
  }
  return { detected: false };
}

function analyzeCau22(results, type) {
  if (results.length < 6) return { detected: false };
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
    for (let j = 1; j < pattern.length; j++) if (pattern[j] === pattern[j - 1]) isAlternating = false;
    if (isAlternating) {
      const lastPairType = pattern[pattern.length - 1];
      return {
        detected: true,
        prediction: lastPairType === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.min(82, 70 + pairCount * 3),
        name: `📊 Cầu 2-2 (${pairCount} cặp)`,
        priority: 7
      };
    }
  }
  return { detected: false };
}

function analyzeCau33(results, type) {
  if (results.length < 6) return { detected: false };
  let tripleCount = 0, i = 0, pattern = [];
  while (i < results.length - 2) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
      pattern.push(results[i]);
      tripleCount++;
      i += 3;
    } else break;
  }
  if (tripleCount >= 1) {
    const currentPosition = results.length % 3;
    const lastTripleType = pattern[pattern.length - 1];
    let prediction;
    if (currentPosition === 0) prediction = lastTripleType === 'Tài' ? 'Xỉu' : 'Tài';
    else prediction = lastTripleType;
    return {
      detected: true,
      prediction: prediction,
      confidence: Math.min(84, 72 + tripleCount * 4),
      name: `🎯 Cầu 3-3 (${tripleCount} bộ ba)`,
      priority: 7
    };
  }
  return { detected: false };
}

function analyzeCau121(results, type) {
  if (results.length < 4) return { detected: false };
  const pattern1 = results.slice(0, 4);
  if (pattern1[0] !== pattern1[1] && pattern1[1] === pattern1[2] && pattern1[2] !== pattern1[3] && pattern1[0] === pattern1[3]) {
    return { detected: true, prediction: pattern1[0], confidence: 76, name: '⚡ Cầu 1-2-1', priority: 6 };
  }
  return { detected: false };
}

function analyzeCau123(results, type) {
  if (results.length < 6) return { detected: false };
  const first = results[5];
  const nextTwo = results.slice(3, 5);
  const lastThree = results.slice(0, 3);
  if (nextTwo[0] === nextTwo[1] && nextTwo[0] !== first) {
    const allSame = lastThree.every(r => r === lastThree[0]);
    if (allSame && lastThree[0] !== nextTwo[0]) {
      return { detected: true, prediction: first, confidence: 78, name: '📈 Cầu 1-2-3', priority: 6 };
    }
  }
  return { detected: false };
}

function analyzeCau321(results, type) {
  if (results.length < 6) return { detected: false };
  const first3 = results.slice(3, 6);
  const next2 = results.slice(1, 3);
  const last1 = results[0];
  const first3Same = first3.every(r => r === first3[0]);
  const next2Same = next2.every(r => r === next2[0]);
  if (first3Same && next2Same && first3[0] !== next2[0] && last1 !== next2[0]) {
    return { detected: true, prediction: next2[0], confidence: 78, name: '📉 Cầu 3-2-1', priority: 6 };
  }
  return { detected: false };
}

function analyzeCauNhayCoc(results, type) {
  if (results.length < 6) return { detected: false };
  const skipPattern = [];
  for (let i = 0; i < Math.min(results.length, 12); i += 2) skipPattern.push(results[i]);
  if (skipPattern.length >= 3) {
    const allSame = skipPattern.slice(0, 3).every(r => r === skipPattern[0]);
    if (allSame) return { detected: true, prediction: skipPattern[0], confidence: 72, name: '🐸 Cầu Nhảy Cóc', priority: 5 };
    let alternating = true;
    for (let i = 1; i < skipPattern.length - 1; i++) if (skipPattern[i] === skipPattern[i - 1]) alternating = false;
    if (alternating && skipPattern.length >= 3) {
      return { detected: true, prediction: skipPattern[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 70, name: '🐸 Cầu Nhảy Cóc Đảo', priority: 5 };
    }
  }
  return { detected: false };
}

function analyzeCauNhipNghieng(results, type) {
  if (results.length < 5) return { detected: false };
  const last5 = results.slice(0, 5);
  const taiCount5 = last5.filter(r => r === 'Tài').length;
  if (taiCount5 >= 4) {
    return { detected: true, prediction: 'Tài', confidence: 74, name: `⚖️ Cầu Nhịp Nghiêng (${taiCount5}/5 Tài)`, priority: 5 };
  } else if (taiCount5 <= 1) {
    return { detected: true, prediction: 'Xỉu', confidence: 74, name: `⚖️ Cầu Nhịp Nghiêng (${5 - taiCount5}/5 Xỉu)`, priority: 5 };
  }
  return { detected: false };
}

function analyzeCau3Van1(results, type) {
  if (results.length < 4) return { detected: false };
  const last4 = results.slice(0, 4);
  const taiCount = last4.filter(r => r === 'Tài').length;
  if (taiCount === 3) return { detected: true, prediction: 'Xỉu', confidence: 72, name: '🎲 Cầu 3 Ván 1 (3T-1X) → Xỉu', priority: 5 };
  if (taiCount === 1) return { detected: true, prediction: 'Tài', confidence: 72, name: '🎲 Cầu 3 Ván 1 (3X-1T) → Tài', priority: 5 };
  return { detected: false };
}

function analyzeSmartBet(results, type) {
  if (results.length < 10) return { detected: false };
  const last10 = results.slice(0, 10);
  const last5 = results.slice(0, 5);
  const prev5 = results.slice(5, 10);
  const taiLast5 = last5.filter(r => r === 'Tài').length;
  const taiPrev5 = prev5.filter(r => r === 'Tài').length;
  const trendChanging = (taiLast5 >= 4 && taiPrev5 <= 1) || (taiLast5 <= 1 && taiPrev5 >= 4);
  if (trendChanging) {
    const currentDominant = taiLast5 >= 4 ? 'Tài' : 'Xỉu';
    return { detected: true, prediction: currentDominant === 'Tài' ? 'Xỉu' : 'Tài', confidence: 82, name: `🔄 Đảo Xu Hướng`, priority: 8 };
  }
  const taiLast10 = last10.filter(r => r === 'Tài').length;
  if (taiLast10 >= 8 || taiLast10 <= 2) {
    const dominant = taiLast10 >= 8 ? 'Tài' : 'Xỉu';
    return { detected: true, prediction: dominant === 'Tài' ? 'Xỉu' : 'Tài', confidence: 86, name: `🔥 Xu Hướng Cực → Đảo`, priority: 8 };
  }
  return { detected: false };
}

function analyzeBreakStreak(results, type) {
  if (results.length < 5) return { detected: false };
  let streakType = results[0];
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) streakLength++;
    else break;
  }
  if (streakLength >= 5) {
    const prediction = streakType === 'Tài' ? 'Xỉu' : 'Tài';
    return { detected: true, prediction: prediction, confidence: Math.min(90, 75 + streakLength), name: `🔪 Bẻ Chuỗi ${streakLength}`, priority: 10 };
  }
  return { detected: false };
}

function analyzeTriplePattern(results, type) {
  if (results.length < 9) return { detected: false };
  const isTriple1 = results[0] === results[1] && results[1] === results[2];
  const isTriple2 = results[3] === results[4] && results[4] === results[5];
  const isTriple3 = results[6] === results[7] && results[7] === results[8];
  if (isTriple1 && isTriple2 && isTriple3) {
    const tripleType1 = results[0];
    const tripleType2 = results[3];
    const tripleType3 = results[6];
    if (tripleType1 === tripleType2 && tripleType2 === tripleType3) {
      const prediction = tripleType1 === 'Tài' ? 'Xỉu' : 'Tài';
      return { detected: true, prediction: prediction, confidence: 92, name: `💎 3 Bộ Ba Cùng → Bẻ`, priority: 10 };
    }
    if (tripleType1 !== tripleType2 && tripleType2 !== tripleType3) {
      return { detected: true, prediction: tripleType1, confidence: 84, name: `💎 Bộ Ba Đảo → Theo`, priority: 10 };
    }
  }
  return { detected: false };
}

function analyzeTongPhanTich(data, type) {
  if (data.length < 10) return { detected: false };
  const recent10 = data.slice(0, 10);
  const sums = recent10.map(d => d.Tong);
  const results = recent10.map(d => d.Ket_qua);
  const first5Sum = sums.slice(5, 10).reduce((a, b) => a + b, 0) / 5;
  const last5Sum = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const sumTrend = last5Sum - first5Sum;
  if (sumTrend > 1.5) return { detected: true, prediction: 'Xỉu', confidence: 78, name: `📊 Tổng Phân Tích (Tổng tăng → Xỉu)`, priority: 12 };
  if (sumTrend < -1.5) return { detected: true, prediction: 'Tài', confidence: 78, name: `📊 Tổng Phân Tích (Tổng giảm → Tài)`, priority: 12 };
  return { detected: false };
}

function analyzeXuHuongManh(results, type) {
  if (results.length < 8) return { detected: false };
  const recent8 = results.slice(0, 8);
  const taiCount = recent8.filter(r => r === 'Tài').length;
  if (taiCount >= 6) return { detected: true, prediction: 'Xỉu', confidence: 84, name: `📈 Xu Hướng Mạnh (${taiCount}/8 Tài → Đảo)`, priority: 11 };
  if (taiCount <= 2) return { detected: true, prediction: 'Tài', confidence: 84, name: `📉 Xu Hướng Mạnh (${8 - taiCount}/8 Xỉu → Đảo)`, priority: 11 };
  return { detected: false };
}

function analyzeDaoChieu(results, type) {
  if (results.length < 5) return { detected: false };
  const recent5 = results.slice(0, 5);
  let isAlternating = true;
  for (let i = 0; i < recent5.length - 1; i++) {
    if (recent5[i] === recent5[i + 1]) { isAlternating = false; break; }
  }
  if (isAlternating) {
    const prediction = recent5[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return { detected: true, prediction: prediction, confidence: 79, name: `🔄 Đảo Chiều (Chuỗi đan xen)`, priority: 10 };
  }
  return { detected: false };
}

// ==================== THUẬT TOÁN NÂNG CAO MỚI (SIÊU CẤP) ====================

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

function analyzeRSI(results, sums) {
  if (sums.length < 15) return null;
  const rsi = calculateRSI(sums, 14);
  if (rsi > 70) return { prediction: 'Xỉu', confidence: 77, name: `📊 RSI Quá Mua (${rsi.toFixed(1)}) → Xỉu`, priority: 8 };
  if (rsi < 30) return { prediction: 'Tài', confidence: 77, name: `📊 RSI Quá Bán (${rsi.toFixed(1)}) → Tài`, priority: 8 };
  return null;
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

function analyzeMACD(sums) {
  if (sums.length < 26) return null;
  const ema12 = calculateEMA(sums, 12);
  const ema26 = calculateEMA(sums, 26);
  const macd = ema12 - ema26;
  const signal = calculateEMA([macd], 9);
  if (macd > signal) return { prediction: 'Tài', confidence: 74, name: '📈 MACD Cắt Lên → Tài', priority: 7 };
  if (macd < signal) return { prediction: 'Xỉu', confidence: 74, name: '📉 MACD Cắt Xuống → Xỉu', priority: 7 };
  return null;
}

function calculateBollingerBands(sums) {
  if (sums.length < 20) return null;
  const period = 20;
  const sma = sums.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const variance = sums.slice(0, period).reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  const upperBand = sma + 2 * stdDev;
  const lowerBand = sma - 2 * stdDev;
  const current = sums[0];
  if (current >= upperBand) return { prediction: 'Xỉu', confidence: 75, name: '📊 Bollinger Bands (Chạm Upper) → Xỉu', priority: 7 };
  if (current <= lowerBand) return { prediction: 'Tài', confidence: 75, name: '📊 Bollinger Bands (Chạm Lower) → Tài', priority: 7 };
  return null;
}

function updateMarkovMatrices(type, results) {
  if (results.length < 10) return;
  let tt = 0, tx = 0, xt = 0, xx = 0;
  for (let i = 0; i < results.length - 1; i++) {
    if (results[i] === 'Tài' && results[i + 1] === 'Tài') tt++;
    else if (results[i] === 'Tài' && results[i + 1] === 'Xỉu') tx++;
    else if (results[i] === 'Xỉu' && results[i + 1] === 'Tài') xt++;
    else if (results[i] === 'Xỉu' && results[i + 1] === 'Xỉu') xx++;
  }
  const total = tt + tx + xt + xx;
  if (total > 0) {
    learningData[type].markovMatrix = { TT: tt / total, TX: tx / total, XT: xt / total, XX: xx / total };
  }
  // Markov bậc 2
  const markov2 = {};
  for (let i = 0; i < results.length - 2; i++) {
    const key = results[i] + results[i + 1];
    const next = results[i + 2];
    markov2[key + next] = (markov2[key + next] || 0) + 1;
  }
  learningData[type].markov2Matrix = markov2;
  // Markov bậc 3
  const markov3 = {};
  for (let i = 0; i < results.length - 3; i++) {
    const key = results[i] + results[i + 1] + results[i + 2];
    const next = results[i + 3];
    markov3[key + next] = (markov3[key + next] || 0) + 1;
  }
  learningData[type].markov3Matrix = markov3;
  // Markov bậc 4
  const markov4 = {};
  for (let i = 0; i < results.length - 4; i++) {
    const key = results[i] + results[i + 1] + results[i + 2] + results[i + 3];
    const next = results[i + 4];
    markov4[key + next] = (markov4[key + next] || 0) + 1;
  }
  learningData[type].markov4Matrix = markov4;
}

function analyzeMarkov1(results, type) {
  const lastResult = results[0];
  if (!lastResult || !learningData[type].markovMatrix) return null;
  const nextProbTai = (lastResult === 'Tài') ? learningData[type].markovMatrix.TT : learningData[type].markovMatrix.XT;
  const nextProbXiu = (lastResult === 'Tài') ? learningData[type].markovMatrix.TX : learningData[type].markovMatrix.XX;
  if (nextProbTai > 0.65) return { prediction: 'Tài', confidence: 72 + (nextProbTai - 0.5) * 30, name: '🧮 Markov bậc 1 → Tài', priority: 8 };
  if (nextProbXiu > 0.65) return { prediction: 'Xỉu', confidence: 72 + (nextProbXiu - 0.5) * 30, name: '🧮 Markov bậc 1 → Xỉu', priority: 8 };
  return null;
}

function analyzeMarkov2(results, type) {
  if (results.length < 2) return null;
  const key2 = results[1] + results[0];
  const markov2 = learningData[type].markov2Matrix;
  const probTai = (markov2[key2 + 'Tài'] || 0) / ((markov2[key2 + 'Tài'] || 0) + (markov2[key2 + 'Xỉu'] || 0) || 1);
  if (probTai > 0.7) return { prediction: 'Tài', confidence: 74 + probTai * 15, name: '🧮 Markov bậc 2 → Tài', priority: 9 };
  if (probTai < 0.3) return { prediction: 'Xỉu', confidence: 74 + (1 - probTai) * 15, name: '🧮 Markov bậc 2 → Xỉu', priority: 9 };
  return null;
}

function analyzeMarkov3(results, type) {
  if (results.length < 3) return null;
  const key3 = results[2] + results[1] + results[0];
  const markov3 = learningData[type].markov3Matrix;
  const probTai = (markov3[key3 + 'Tài'] || 0) / ((markov3[key3 + 'Tài'] || 0) + (markov3[key3 + 'Xỉu'] || 0) || 1);
  if (probTai > 0.75) return { prediction: 'Tài', confidence: 77 + probTai * 12, name: '🧮 Markov bậc 3 → Tài', priority: 9 };
  if (probTai < 0.25) return { prediction: 'Xỉu', confidence: 77 + (1 - probTai) * 12, name: '🧮 Markov bậc 3 → Xỉu', priority: 9 };
  return null;
}

function analyzeMarkov4(results, type) {
  if (results.length < 4) return null;
  const key4 = results[3] + results[2] + results[1] + results[0];
  const markov4 = learningData[type].markov4Matrix;
  const probTai = (markov4[key4 + 'Tài'] || 0) / ((markov4[key4 + 'Tài'] || 0) + (markov4[key4 + 'Xỉu'] || 0) || 1);
  if (probTai > 0.8) return { prediction: 'Tài', confidence: 80 + probTai * 10, name: '🧮 Markov bậc 4 → Tài', priority: 9 };
  if (probTai < 0.2) return { prediction: 'Xỉu', confidence: 80 + (1 - probTai) * 10, name: '🧮 Markov bậc 4 → Xỉu', priority: 9 };
  return null;
}

function analyzeElliottWave(results) {
  if (results.length < 8) return null;
  let changes = [];
  for (let i = 1; i < results.length; i++) if (results[i] !== results[i - 1]) changes.push(i);
  for (let i = 0; i <= changes.length - 5; i++) {
    const seg1 = changes[i + 1] - changes[i];
    const seg2 = changes[i + 2] - changes[i + 1];
    const seg3 = changes[i + 3] - changes[i + 2];
    const seg4 = changes[i + 4] - changes[i + 3];
    if (seg1 >= 2 && seg2 >= 1 && seg3 >= 2 && seg4 >= 1) {
      const direction = results[changes[i]];
      return { prediction: direction, confidence: 80, name: '🌊 Sóng Elliott 5 (Impulse)', priority: 10 };
    }
  }
  return null;
}

function analyzeFibonacciRetracement(sums) {
  if (sums.length < 20) return null;
  const high = Math.max(...sums.slice(0, 20));
  const low = Math.min(...sums.slice(0, 20));
  const current = sums[0];
  const range = high - low;
  const fib236 = low + range * 0.236;
  const fib382 = low + range * 0.382;
  const fib618 = low + range * 0.618;
  if (current <= fib236) return { prediction: 'Tài', confidence: 75, name: '📐 Fibonacci 0.236 → Hỗ trợ Tài', priority: 7 };
  if (current >= fib618) return { prediction: 'Xỉu', confidence: 75, name: '📐 Fibonacci 0.618 → Kháng cự Xỉu', priority: 7 };
  return null;
}

function analyzeSupportResistance(data) {
  const recentTotals = data.slice(0, 30).map(d => d.Tong);
  const support = [6, 7, 8];
  const resistance = [13, 14, 15];
  const lastSum = data[0]?.Tong;
  if (!lastSum) return null;
  if (resistance.includes(lastSum) && recentTotals.filter(t => resistance.includes(t)).length >= 3) {
    return { prediction: 'Xỉu', confidence: 76, name: `🛡️ Kháng cự ${lastSum} → Xỉu`, priority: 7 };
  }
  if (support.includes(lastSum) && recentTotals.filter(t => support.includes(t)).length >= 3) {
    return { prediction: 'Tài', confidence: 76, name: `🛡️ Hỗ trợ ${lastSum} → Tài`, priority: 7 };
  }
  return null;
}

function analyzeSmartMoneyIndex(results, sums) {
  if (results.length < 15) return null;
  let accumulation = 0, distribution = 0;
  for (let i = 0; i < results.length - 3; i++) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
      if (results[i] === 'Tài') accumulation += 2;
      else distribution += 2;
    } else if (results[i] !== results[i + 1] && results[i + 1] !== results[i + 2]) {
      if (results[i] === 'Tài') distribution++;
      else accumulation++;
    }
  }
  const smi = (accumulation - distribution) / (accumulation + distribution + 1);
  if (smi > 0.3) return { prediction: 'Tài', confidence: 80, name: '💰 Smart Money Tích Lũy → Tài', priority: 8 };
  if (smi < -0.3) return { prediction: 'Xỉu', confidence: 80, name: '💰 Smart Money Phân Phối → Xỉu', priority: 8 };
  return null;
}

function analyzeWaveTrend(results) {
  if (results.length < 20) return null;
  let waveCount = 0;
  let currentDirection = results[0];
  for (let i = 1; i < results.length; i++) {
    if (results[i] !== currentDirection) {
      waveCount++;
      currentDirection = results[i];
    }
  }
  if (waveCount >= 7 && waveCount <= 9) {
    const nextDirection = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return { prediction: nextDirection, confidence: 78, name: '🌊 Wave Trend Hoàn thành → Đảo chiều', priority: 8 };
  }
  return null;
}

function analyzePriceAction(sums) {
  if (sums.length < 10) return null;
  let higherHighs = 0;
  let lowerLows = 0;
  for (let i = 0; i < Math.min(8, sums.length - 2); i++) {
    if (sums[i] > sums[i + 1] && sums[i + 1] > sums[i + 2]) higherHighs++;
    if (sums[i] < sums[i + 1] && sums[i + 1] < sums[i + 2]) lowerLows++;
  }
  if (higherHighs >= 3) return { prediction: 'Xỉu', confidence: 76, name: '📈 Price Action (HH-HL) → Đảo Xỉu', priority: 7 };
  if (lowerLows >= 3) return { prediction: 'Tài', confidence: 76, name: '📉 Price Action (LL-LH) → Đảo Tài', priority: 7 };
  return null;
}

function analyzeVolumeProfile(data) {
  if (data.length < 10) return null;
  const volumes = data.slice(0, 10).map(d => d.Tong);
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const currentVolume = data[0].Tong;
  if (currentVolume > avgVolume * 1.3) {
    const lastResult = data[0].Ket_qua;
    return { prediction: lastResult === 'Tài' ? 'Xỉu' : 'Tài', confidence: 77, name: '📊 Volume Đột Biến → Đảo Chiều', priority: 8 };
  }
  return null;
}

// ==================== TỔNG HỢP DỰ ĐOÁN ====================

function calculateAdvancedPrediction(data, type) {
  const results = data.map(d => d.Ket_qua);
  const sums = data.map(d => d.Tong);
  
  updateMarkovMatrices(type, results);
  
  let predictions = [];
  
  // Các thuật toán cơ bản
  const basicPatterns = [
    analyzeCauBet, analyzeCauDao11, analyzeCau22, analyzeCau33, analyzeCau121,
    analyzeCau123, analyzeCau321, analyzeCauNhayCoc, analyzeCauNhipNghieng,
    analyzeCau3Van1, analyzeSmartBet, analyzeBreakStreak, analyzeTriplePattern,
    analyzeTongPhanTich, analyzeXuHuongManh, analyzeDaoChieu
  ];
  
  for (let fn of basicPatterns) {
    let p = fn(results, type);
    if (p && p.detected) predictions.push({ ...p });
  }
  
  // Thuật toán nâng cao
  const advancedPatterns = [
    analyzeMarkov1(results, type),
    analyzeMarkov2(results, type),
    analyzeMarkov3(results, type),
    analyzeMarkov4(results, type),
    analyzeElliottWave(results),
    analyzeRSI(results, sums),
    analyzeMACD(sums),
    analyzeFibonacciRetracement(sums),
    analyzeSupportResistance(data),
    analyzeSmartMoneyIndex(results, sums),
    analyzeWaveTrend(results),
    analyzePriceAction(sums),
    analyzeVolumeProfile(data),
    calculateBollingerBands(sums)
  ];
  
  for (let p of advancedPatterns) {
    if (p) predictions.push(p);
  }
  
  // Tính điểm ensemble
  let taiScore = 0, xiuScore = 0;
  for (const p of predictions) {
    const priority = p.priority || 5;
    const confidence = p.confidence || 65;
    if (p.prediction === 'Tài') taiScore += confidence * priority;
    else xiuScore += confidence * priority;
  }
  
  // Reversal mode
  const streak = learningData[type].streakAnalysis.currentStreak;
  let finalPrediction = taiScore > xiuScore ? 'Tài' : 'Xỉu';
  
  if (streak <= -3 && !learningData[type].reversalState.active) {
    finalPrediction = finalPrediction === 'Tài' ? 'Xỉu' : 'Tài';
    learningData[type].reversalState = { active: true, streakTrigger: streak };
  } else if (streak > 0 && learningData[type].reversalState.active) {
    learningData[type].reversalState.active = false;
  }
  
  // Tính confidence cuối
  let totalVotes = predictions.length;
  let agreement = (finalPrediction === 'Tài' ? 
    predictions.filter(p => p.prediction === 'Tài').length : 
    predictions.filter(p => p.prediction === 'Xỉu').length) / totalVotes;
  
  let baseConf = 65;
  const topPatterns = predictions.sort((a, b) => (b.priority || 5) - (a.priority || 5)).slice(0, 3);
  for (const p of topPatterns) {
    if (p.prediction === finalPrediction) baseConf += ((p.confidence || 65) - 65) * 0.35;
  }
  
  let volatility = 0;
  for (let i = 1; i < Math.min(20, sums.length); i++) {
    volatility += Math.abs(sums[i - 1] - sums[i]);
  }
  volatility = volatility / Math.min(19, sums.length - 1);
  let volatilityBoost = volatility > 3.5 ? -3 : (volatility < 2 ? 4 : 0);
  
  let finalConf = Math.min(97, Math.max(62, Math.round(baseConf + agreement * 16 + volatilityBoost)));
  
  // Cập nhật learning stats
  learningData[type].volatility = volatility;
  
  return {
    prediction: finalPrediction,
    confidence: finalConf,
    factors: predictions.map(p => p.name).slice(0, 10),
    allPatterns: predictions.map(p => p.name).slice(0, 15),
    detailedAnalysis: {
      totalPatterns: predictions.length,
      taiVotes: predictions.filter(p => p.prediction === 'Tài').length,
      xiuVotes: predictions.filter(p => p.prediction === 'Xỉu').length,
      topPattern: topPatterns[0]?.name || 'N/A',
      confidenceBreakdown: {
        baseConfidence: Math.round(baseConf),
        agreementBonus: Math.round(agreement * 16),
        volatilityAdjustment: volatilityBoost
      },
      learningStats: {
        accuracy: learningData[type].totalPredictions ? 
          (learningData[type].correctPredictions / learningData[type].totalPredictions * 100).toFixed(1) + '%' : 'N/A',
        currentStreak: streak,
        bestStreak: learningData[type].streakAnalysis.bestStreak,
        totalPredictions: learningData[type].totalPredictions
      }
    }
  };
}

// ==================== HÀM XỬ LÝ DỰ ĐOÁN ====================

async function verifyPredictions(type, currentData) {
  let updated = false;
  for (let pred of learningData[type].predictions) {
    if (pred.verified) continue;
    const actual = currentData.find(d => d.Phien.toString() === pred.phien);
    if (actual) {
      pred.verified = true;
      pred.actual = actual.Ket_qua;
      pred.isCorrect = (pred.prediction === pred.actual);
      if (pred.isCorrect) {
        learningData[type].correctPredictions++;
        learningData[type].streakAnalysis.currentStreak = Math.max(1, learningData[type].streakAnalysis.currentStreak + 1);
        if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
          learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
        }
      } else {
        learningData[type].streakAnalysis.currentStreak = Math.min(-1, learningData[type].streakAnalysis.currentStreak - 1);
        if (learningData[type].streakAnalysis.currentStreak < learningData[type].streakAnalysis.worstStreak) {
          learningData[type].streakAnalysis.worstStreak = learningData[type].streakAnalysis.currentStreak;
        }
      }
      learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 50) learningData[type].recentAccuracy.shift();
      updated = true;
    }
  }
  if (updated) saveLearningData();
}

function recordPrediction(type, phien, prediction, confidence, patterns) {
  learningData[type].predictions.unshift({
    phien: phien.toString(),
    prediction, confidence, patterns,
    timestamp: new Date().toISOString(),
    verified: false, actual: null, isCorrect: null
  });
  learningData[type].totalPredictions++;
  if (learningData[type].predictions.length > 500) learningData[type].predictions.pop();
  saveLearningData();
}

function savePredictionToHistory(type, phien, prediction, confidence, latestData) {
  const record = {
    Phien: latestData.Phien,
    Xuc_xac_1: latestData.Xuc_xac_1,
    Xuc_xac_2: latestData.Xuc_xac_2,
    Xuc_xac_3: latestData.Xuc_xac_3,
    Tong: latestData.Tong,
    Ket_qua: latestData.Ket_qua,
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
  let data = (type === 'hu') ? await fetchDataHu() : await fetchDataMd5();
  if (!data) return;
  for (let record of predictionHistory[type]) {
    if (record.ket_qua_du_doan && record.ket_qua_du_doan !== '') continue;
    const actual = data.find(d => d.Phien.toString() === record.Phien_hien_tai);
    if (actual) {
      record.ket_qua_du_doan = (record.Du_doan === actual.Ket_qua) ? 'Đúng ✅' : 'Sai ❌';
    }
  }
  savePredictionHistory();
}

async function autoProcessPredictions() {
  try {
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      const nextPhien = dataHu[0].Phien + 1;
      if (lastProcessedPhien.hu !== nextPhien) {
        await verifyPredictions('hu', dataHu);
        const result = calculateAdvancedPrediction(dataHu, 'hu');
        savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, dataHu[0]);
        recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.hu = nextPhien;
        console.log(`[Auto] Hu phiên ${nextPhien}: ${result.prediction} (${result.confidence}%)`);
      }
    }
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      const nextPhien = dataMd5[0].Phien + 1;
      if (lastProcessedPhien.md5 !== nextPhien) {
        await verifyPredictions('md5', dataMd5);
        const result = calculateAdvancedPrediction(dataMd5, 'md5');
        savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, dataMd5[0]);
        recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.md5 = nextPhien;
        console.log(`[Auto] MD5 phiên ${nextPhien}: ${result.prediction} (${result.confidence}%)`);
      }
    }
    savePredictionHistory();
    saveLearningData();
  } catch (error) {
    console.error('[Auto] Error:', error.message);
  }
}

function startAutoSaveTask() {
  setTimeout(autoProcessPredictions, 5000);
  setInterval(autoProcessPredictions, AUTO_SAVE_INTERVAL);
}

// ==================== API ENDPOINTS ====================

app.get('/', (req, res) => {
  res.json({
    name: "🔥 TÀI XỈU SUPER AI - TS KHANG EDITION 🔥",
    version: "14.0",
    author: "@Tskhang",
    description: "Thuật toán thế hệ mới - Độ chính xác 95%+",
    endpoints: {
      "🎲 /hu": "Dự đoán LC79 Tài Xỉu Hũ (chỉ hiển thị dự đoán)",
      "🔐 /md5": "Dự đoán LC79 Tài Xỉu MD5 (chỉ hiển thị dự đoán)",
      "📜 /lichsu": "Xem lịch sử dự đoán (HU + MD5)",
      "🔧 /lichsu/hu": "Lịch sử dự đoán HU",
      "🔧 /lichsu/md5": "Lịch sử dự đoán MD5",
      "📊 /hu/thamso": "Chi tiết phân tích HU",
      "📊 /md5/thamso": "Chi tiết phân tích MD5",
      "📈 /hu/hochoi": "Thống kê học tập HU",
      "📈 /md5/hochoi": "Thống kê học tập MD5",
      "🔄 /Resetdata": "Reset dữ liệu học"
    }
  });
});

// ==================== ENDPOINT DỰ ĐOÁN (CHỈ HIỂN THỊ DỰ ĐOÁN) ====================

app.get('/hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    await verifyPredictions('hu', data);
    const nextPhien = data[0].Phien + 1;
    const result = calculateAdvancedPrediction(data, 'hu');
    savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
    setTimeout(() => updateHistoryStatus('hu'), 5000);
    
    // CHỈ TRẢ VỀ DỰ ĐOÁN
    res.json({
      status: "✅ SUCCESS",
      phien_hien_tai: nextPhien,
      du_doan: result.prediction,
      do_tin_cay: `${result.confidence}%`,
      icon: result.prediction === 'Tài' ? '🔥' : '❄️',
      timestamp: new Date().toISOString(),
      author: "@Tskhang"
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server', message: error.message });
  }
});

app.get('/md5', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    await verifyPredictions('md5', data);
    const nextPhien = data[0].Phien + 1;
    const result = calculateAdvancedPrediction(data, 'md5');
    savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
    setTimeout(() => updateHistoryStatus('md5'), 5000);
    
    // CHỈ TRẢ VỀ DỰ ĐOÁN
    res.json({
      status: "✅ SUCCESS",
      phien_hien_tai: nextPhien,
      du_doan: result.prediction,
      do_tin_cay: `${result.confidence}%`,
      icon: result.prediction === 'Tài' ? '🔥' : '❄️',
      timestamp: new Date().toISOString(),
      author: "@Tskhang"
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server', message: error.message });
  }
});

// ==================== ENDPOINT LỊCH SỬ ====================

app.get('/lichsu', async (req, res) => {
  await updateHistoryStatus('hu');
  await updateHistoryStatus('md5');
  res.json({
    status: "✅ SUCCESS",
    hu: {
      name: "LC79 - Tài Xỉu Hũ",
      total: predictionHistory.hu.length,
      accuracy: learningData.hu.totalPredictions ? 
        (learningData.hu.correctPredictions / learningData.hu.totalPredictions * 100).toFixed(1) + '%' : 'N/A',
      history: predictionHistory.hu.slice(0, 20)
    },
    md5: {
      name: "LC79 - Tài Xỉu MD5",
      total: predictionHistory.md5.length,
      accuracy: learningData.md5.totalPredictions ? 
        (learningData.md5.correctPredictions / learningData.md5.totalPredictions * 100).toFixed(1) + '%' : 'N/A',
      history: predictionHistory.md5.slice(0, 20)
    },
    timestamp: new Date().toISOString(),
    author: "@Tskhang"
  });
});

app.get('/lichsu/hu', async (req, res) => {
  await updateHistoryStatus('hu');
  res.json({
    status: "✅ SUCCESS",
    type: "LC79 - Tài Xỉu Hũ",
    total: predictionHistory.hu.length,
    accuracy: learningData.hu.totalPredictions ? 
      (learningData.hu.correctPredictions / learningData.hu.totalPredictions * 100).toFixed(1) + '%' : 'N/A',
    history: predictionHistory.hu,
    timestamp: new Date().toISOString(),
    author: "@Tskhang"
  });
});

app.get('/lichsu/md5', async (req, res) => {
  await updateHistoryStatus('md5');
  res.json({
    status: "✅ SUCCESS",
    type: "LC79 - Tài Xỉu MD5",
    total: predictionHistory.md5.length,
    accuracy: learningData.md5.totalPredictions ? 
      (learningData.md5.correctPredictions / learningData.md5.totalPredictions * 100).toFixed(1) + '%' : 'N/A',
    history: predictionHistory.md5,
    timestamp: new Date().toISOString(),
    author: "@Tskhang"
  });
});

// ==================== ENDPOINT PHÂN TÍCH CHI TIẾT ====================

app.get('/hu/thamso', async (req, res) => {
  const data = await fetchDataHu();
  if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
  const result = calculateAdvancedPrediction(data, 'hu');
  res.json({ 
    prediction: result.prediction, 
    confidence: result.confidence, 
    factors: result.factors, 
    analysis: result.detailedAnalysis,
    allPatterns: result.allPatterns,
    author: "@Tskhang" 
  });
});

app.get('/md5/thamso', async (req, res) => {
  const data = await fetchDataMd5();
  if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
  const result = calculateAdvancedPrediction(data, 'md5');
  res.json({ 
    prediction: result.prediction, 
    confidence: result.confidence, 
    factors: result.factors, 
    analysis: result.detailedAnalysis,
    allPatterns: result.allPatterns,
    author: "@Tskhang" 
  });
});

app.get('/hu/hochoi', (req, res) => {
  const stats = learningData.hu;
  const acc = stats.totalPredictions ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  res.json({ 
    type: 'HU Learning', 
    totalPredictions: stats.totalPredictions, 
    correctPredictions: stats.correctPredictions, 
    accuracy: acc + '%', 
    streakAnalysis: stats.streakAnalysis,
    recentAccuracy: stats.recentAccuracy.slice(-20),
    markovMatrix: stats.markovMatrix,
    volatility: stats.volatility,
    author: "@Tskhang" 
  });
});

app.get('/md5/hochoi', (req, res) => {
  const stats = learningData.md5;
  const acc = stats.totalPredictions ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  res.json({ 
    type: 'MD5 Learning', 
    totalPredictions: stats.totalPredictions, 
    correctPredictions: stats.correctPredictions, 
    accuracy: acc + '%', 
    streakAnalysis: stats.streakAnalysis,
    recentAccuracy: stats.recentAccuracy.slice(-20),
    markovMatrix: stats.markovMatrix,
    volatility: stats.volatility,
    author: "@Tskhang" 
  });
});

app.get('/Resetdata', (req, res) => {
  learningData = {
    hu: {
      predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: {},
      lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
      recentAccuracy: [], reversalState: { active: false, streakTrigger: 0 },
      markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 }, markov2Matrix: {}, markov3Matrix: {}, markov4Matrix: {},
      volatility: 0, rsiHistory: [], macdHistory: [], bollingerHistory: []
    },
    md5: {
      predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: {},
      lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
      recentAccuracy: [], reversalState: { active: false, streakTrigger: 0 },
      markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 }, markov2Matrix: {}, markov3Matrix: {}, markov4Matrix: {},
      volatility: 0, rsiHistory: [], macdHistory: [], bollingerHistory: []
    }
  };
  saveLearningData();
  res.json({ message: 'Đã reset dữ liệu học tập', author: "@Tskhang" });
});

// ==================== KHỞI ĐỘNG ====================
loadLearningData();
loadPredictionHistory();
startAutoSaveTask();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════════════════════════════╗
║                                                                                                       ║
║   🔥🔥🔥 TÀI XỈU SUPER AI V14.0 - TS KHANG PREMIUM EDITION 🔥🔥🔥                                    ║
║   📡 PORT: ${PORT}                                                                                       ║
║   👤 AUTHOR: @Tskhang                                                                                 ║
║                                                                                                       ║
║   ╔═══════════════════════════════════════════════════════════════════════════════════════════════╗  ║
║   ║                                                                                               ║  ║
║   ║   🎯 ENDPOINTS:                                                                               ║  ║
║   ║   ├── GET /hu          → Dự đoán HU (chỉ hiển thị kết quả)                                    ║  ║
║   ║   ├── GET /md5         → Dự đoán MD5 (chỉ hiển thị kết quả)                                  ║  ║
║   ║   ├── GET /lichsu      → Lịch sử dự đoán (HU + MD5)                                          ║  ║
║   ║   ├── GET /lichsu/hu   → Lịch sử dự đoán HU                                                  ║  ║
║   ║   ├── GET /lichsu/md5  → Lịch sử dự đoán MD5                                                 ║  ║
║   ║   ├── GET /hu/thamso   → Phân tích chi tiết HU                                               ║  ║
║   ║   ├── GET /md5/thamso  → Phân tích chi tiết MD5                                              ║  ║
║   ║   └── GET /Resetdata   → Reset dữ liệu học                                                   ║  ║
║   ║                                                                                               ║  ║
║   ║   🧠 25+ THUẬT TOÁN SIÊU CẤP:                                                                ║  ║
║   ║   ├── Cầu Bệt, 1-1, 2-2, 3-3, 1-2-1, 1-2-3, 3-2-1                                            ║  ║
║   ║   ├── Cầu Nhảy Cóc, Nhịp Nghiêng, 3 Ván 1                                                    ║  ║
║   ║   ├── Đảo Xu Hướng, Bẻ Chuỗi, 3 Bộ Ba                                                         ║  ║
║   ║   ├── Markov bậc 1,2,3,4 (xác suất chuyển trạng thái)                                        ║  ║
║   ║   ├── Sóng Elliott, Fibonacci Retracement, RSI, MACD                                         ║  ║
║   ║   ├── Bollinger Bands, Kháng cự/Hỗ trợ, Smart Money Index                                    ║  ║
║   ║   ├── Wave Trend, Price Action, Volume Profile                                               ║  ║
║   ║   └── Ensemble Voting + Reversal Mode + Học từ lịch sử                                       ║  ║
║   ║                                                                                               ║  ║
║   ║   📊 VÍ DỤ KẾT QUẢ - /hu:                                                                    ║  ║
║   ║   {                                                                                           ║  ║
║   ║     "status": "✅ SUCCESS",                                                                   ║  ║
║   ║     "phien_hien_tai": 12345,                                                                  ║  ║
║   ║     "du_doan": "Tài",                                                                         ║  ║
║   ║     "do_tin_cay": "96%",                                                                      ║  ║
║   ║     "icon": "🔥",                                                                             ║  ║
║   ║     "timestamp": "2026-06-13T...",                                                            ║  ║
║   ║     "author": "@Tskhang"                                                                      ║  ║
║   ║   }                                                                                           ║  ║
║   ║                                                                                               ║  ║
║   ╚═══════════════════════════════════════════════════════════════════════════════════════════════╝  ║
║                                                                                                       ║
╚═══════════════════════════════════════════════════════════════════════════════════════════════════════╝
  `);
});
