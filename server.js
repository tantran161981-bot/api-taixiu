const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'anhquan.json';
const HISTORY_FILE = 'anhquan1.json';

let predictionHistory = { hu: [], md5: [] };
const MAX_HISTORY = 100;
const AUTO_SAVE_INTERVAL = 30000;
let lastProcessedPhien = { hu: null, md5: null };

// ==================== CẤU TRÚC HỌC TẬP NÂNG CAO ====================
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
    volatility: 0,
    fibonacciLevels: { support: [], resistance: [] },
    rsiValue: 50,
    macdSignal: 0
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
    volatility: 0,
    fibonacciLevels: { support: [], resistance: [] },
    rsiValue: 50,
    macdSignal: 0
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
      console.log('✅ Đã tải dữ liệu học từ', LEARNING_FILE);
    }
  } catch (error) {
    console.error('Lỗi tải dữ liệu học:', error.message);
  }
}

function saveLearningData() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch (error) {
    console.error('Lỗi lưu dữ liệu học:', error.message);
  }
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(data);
      predictionHistory = parsed.history || { hu: [], md5: [] };
      lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
      console.log('✅ Đã tải lịch sử dự đoán từ', HISTORY_FILE);
    }
  } catch (error) {
    console.error('Lỗi tải lịch sử dự đoán:', error.message);
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
    console.error('Lỗi lưu lịch sử dự đoán:', error.message);
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
    console.error('Lỗi fetch HU:', error.message);
    return null;
  }
}

async function fetchDataMd5() {
  try {
    const response = await axios.get(API_URL_MD5, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    console.error('Lỗi fetch MD5:', error.message);
    return null;
  }
}

// ==================== THUẬT TOÁN NÂNG CAO ====================

// 1. Tính RSI (Relative Strength Index)
function tinhRSI(results, period = 14) {
  if (results.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 0; i < period; i++) {
    if (results[i] === 'Tài') gains++;
    else losses++;
  }
  const rs = gains / (losses || 1);
  const rsi = 100 - (100 / (1 + rs));
  return Math.min(99, Math.max(1, rsi));
}

// 2. Tính Fibonacci Levels
function tinhFibonacci(sums) {
  if (sums.length < 10) return { support: [6, 7, 8], resistance: [13, 14, 15] };
  const maxSum = Math.max(...sums.slice(0, 20));
  const minSum = Math.min(...sums.slice(0, 20));
  const diff = maxSum - minSum;
  return {
    support: [minSum, minSum + diff * 0.236, minSum + diff * 0.382],
    resistance: [maxSum - diff * 0.236, maxSum - diff * 0.382, maxSum]
  };
}

// 3. MACD đơn giản hóa
function tinhMACD(results) {
  if (results.length < 26) return 0;
  const ema12 = results.slice(0, 12).filter(r => r === 'Tài').length / 12;
  const ema26 = results.slice(0, 26).filter(r => r === 'Tài').length / 26;
  return ema12 - ema26;
}

// 4. Phân tích sóng Elliott nâng cao
function analyzeElliottWaveAdvanced(results) {
  if (results.length < 12) return null;
  let changes = [];
  for (let i = 1; i < results.length; i++) {
    if (results[i] !== results[i - 1]) changes.push(i);
  }
  
  // Tìm sóng impulse 5
  for (let i = 0; i <= changes.length - 5; i++) {
    const wave1 = changes[i + 1] - changes[i];
    const wave2 = changes[i + 2] - changes[i + 1];
    const wave3 = changes[i + 3] - changes[i + 2];
    const wave4 = changes[i + 4] - changes[i + 3];
    
    if (wave3 > wave1 && wave3 > wave5 && wave2 < wave1 && wave4 < wave3) {
      const direction = results[changes[i]];
      return { detected: true, prediction: direction === 'Tài' ? 'Xỉu' : 'Tài', confidence: 82, name: 'Sóng Elliott 5 sóng' };
    }
  }
  return null;
}

// 5. Phân tích kháng cự hỗ trợ Fibonacci
function analyzeFibonacciSR(data, type) {
  const sums = data.slice(0, 20).map(d => d.Tong);
  const fib = learningData[type].fibonacciLevels;
  const lastSum = data[0]?.Tong;
  if (!lastSum) return null;
  
  if (fib.resistance.some(r => Math.abs(r - lastSum) < 0.5)) {
    return { prediction: 'Xỉu', confidence: 76, name: `Fibonacci kháng cự ${lastSum} → Xỉu`, priority: 8 };
  }
  if (fib.support.some(s => Math.abs(s - lastSum) < 0.5)) {
    return { prediction: 'Tài', confidence: 76, name: `Fibonacci hỗ trợ ${lastSum} → Tài`, priority: 8 };
  }
  return null;
}

// 6. Cầu 1-1 nâng cao
function analyzeCauDao11NangCao(results, type) {
  if (results.length < 6) return { detected: false };
  let alternatingLength = 1;
  for (let i = 1; i < Math.min(results.length, 15); i++) {
    if (results[i] !== results[i - 1]) alternatingLength++;
    else break;
  }
  if (alternatingLength >= 6) {
    let confidence = Math.min(88, 70 + alternatingLength * 2);
    let prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction: prediction,
      confidence: confidence,
      name: `Cầu Đảo 1-1 siêu dài (${alternatingLength} phiên)`,
      priority: 9
    };
  }
  return { detected: false };
}

// 7. Cầu 2-2 nâng cao
function analyzeCau22NangCao(results, type) {
  if (results.length < 8) return { detected: false };
  let pairCount = 0, i = 0, pattern = [];
  while (i < results.length - 1 && pairCount < 5) {
    if (results[i] === results[i + 1]) {
      pattern.push(results[i]);
      pairCount++;
      i += 2;
    } else break;
  }
  if (pairCount >= 3) {
    let isAlternating = true;
    for (let j = 1; j < pattern.length; j++) {
      if (pattern[j] === pattern[j - 1]) isAlternating = false;
    }
    if (isAlternating) {
      const lastPairType = pattern[pattern.length - 1];
      let confidence = Math.min(85, 68 + pairCount * 4);
      return {
        detected: true,
        prediction: lastPairType === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: confidence,
        name: `Cầu 2-2 siêu dài (${pairCount} cặp)`,
        priority: 8
      };
    }
  }
  return { detected: false };
}

// 8. Cầu nhảy cóc nâng cao
function analyzeCauNhayCocNangCao(results, type) {
  if (results.length < 8) return { detected: false };
  const skipPattern = [];
  for (let i = 0; i < Math.min(results.length, 20); i += 2) skipPattern.push(results[i]);
  if (skipPattern.length >= 4) {
    const allSame = skipPattern.slice(0, 4).every(r => r === skipPattern[0]);
    if (allSame) {
      return { detected: true, prediction: skipPattern[0], confidence: 75, name: 'Cầu Nhảy Cóc siêu dài', priority: 7 };
    }
    let alternating = true;
    for (let i = 1; i < skipPattern.length - 1; i++) {
      if (skipPattern[i] === skipPattern[i - 1]) alternating = false;
    }
    if (alternating && skipPattern.length >= 4) {
      return { detected: true, prediction: skipPattern[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 73, name: 'Cầu Nhảy Cóc Đảo siêu dài', priority: 7 };
    }
  }
  return { detected: false };
}

// 9. Phân tích xu hướng mạnh nâng cao
function analyzeXuHuongManhNangCao(results, type) {
  if (results.length < 12) return { detected: false };
  const recent12 = results.slice(0, 12);
  const taiCount = recent12.filter(r => r === 'Tài').length;
  if (taiCount >= 9) {
    return { detected: true, prediction: 'Xỉu', confidence: 85, name: `Xu Hướng Cực Mạnh (${taiCount}/12 Tài → Bẻ Xỉu)`, priority: 10 };
  }
  if (taiCount <= 3) {
    return { detected: true, prediction: 'Tài', confidence: 85, name: `Xu Hướng Cực Mạnh (${12 - taiCount}/12 Xỉu → Bẻ Tài)`, priority: 10 };
  }
  return { detected: false };
}

// 10. Phân tích tổng nâng cao
function analyzeTongPhanTichNangCao(data, type) {
  if (data.length < 15) return { detected: false };
  const recent15 = data.slice(0, 15);
  const sums = recent15.map(d => d.Tong);
  const results = recent15.map(d => d.Ket_qua);
  
  const first5Sum = sums.slice(10, 15).reduce((a, b) => a + b, 0) / 5;
  const last5Sum = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const sumTrend = last5Sum - first5Sum;
  const volatility = Math.abs(sumTrend);
  
  if (volatility > 2.5) {
    if (sumTrend > 0) return { detected: true, prediction: 'Xỉu', confidence: 82, name: `Tổng Tăng Mạnh (${sumTrend.toFixed(1)}) → Xỉu`, priority: 11 };
    if (sumTrend < 0) return { detected: true, prediction: 'Tài', confidence: 82, name: `Tổng Giảm Mạnh (${Math.abs(sumTrend).toFixed(1)}) → Tài`, priority: 11 };
  }
  
  const taiCount = results.filter(r => r === 'Tài').length;
  if (taiCount >= 10) {
    return { detected: true, prediction: 'Xỉu', confidence: 80, name: `Tổng Phân Tích (${taiCount}/15 Tài → Xỉu)`, priority: 10 };
  }
  if (taiCount <= 5) {
    return { detected: true, prediction: 'Tài', confidence: 80, name: `Tổng Phân Tích (${15 - taiCount}/15 Xỉu → Tài)`, priority: 10 };
  }
  return { detected: false };
}

// ==================== CẬP NHẬT MARKOV BẬC 3 ====================
function updateMarkovMatrices(type, results) {
  if (results.length < 20) return;
  
  // Markov bậc 1
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
  
  // Markov bậc 3 (MỚI)
  const markov3 = {};
  for (let i = 0; i < results.length - 3; i++) {
    const key = results[i] + results[i + 1] + results[i + 2];
    const next = results[i + 3];
    markov3[key + next] = (markov3[key + next] || 0) + 1;
  }
  learningData[type].markov3Matrix = markov3;
}

// ==================== TỔNG HỢP DỰ ĐOÁN CHÍNH ====================
function calculateAdvancedPrediction(data, type) {
  const results = data.map(d => d.Ket_qua);
  const sums = data.map(d => d.Tong);
  
  // Cập nhật các chỉ số kỹ thuật
  updateMarkovMatrices(type, results);
  learningData[type].rsiValue = tinhRSI(results, 14);
  learningData[type].macdSignal = tinhMACD(results);
  learningData[type].fibonacciLevels = tinhFibonacci(sums);
  
  let predictions = [];
  let factors = [];

  // ===== MARKOV BẬC 1 =====
  const lastResult = results[0];
  if (lastResult && learningData[type].markovMatrix) {
    const nextProbTai = (lastResult === 'Tài') ? learningData[type].markovMatrix.TT : learningData[type].markovMatrix.XT;
    const nextProbXiu = (lastResult === 'Tài') ? learningData[type].markovMatrix.TX : learningData[type].markovMatrix.XX;
    if (nextProbTai > 0.68) {
      predictions.push({ prediction: 'Tài', confidence: 72 + nextProbTai * 10, priority: 8, name: 'Markov bậc 1' });
      factors.push('📊 Markov 1 → Tài');
    } else if (nextProbXiu > 0.68) {
      predictions.push({ prediction: 'Xỉu', confidence: 72 + nextProbXiu * 10, priority: 8, name: 'Markov bậc 1' });
      factors.push('📊 Markov 1 → Xỉu');
    }
  }
  
  // ===== MARKOV BẬC 2 =====
  if (results.length >= 2) {
    const key2 = results[1] + results[0];
    const markov2 = learningData[type].markov2Matrix;
    const probTai = (markov2[key2 + 'Tài'] || 0) / ((markov2[key2 + 'Tài'] || 0) + (markov2[key2 + 'Xỉu'] || 0) || 1);
    if (probTai > 0.72) {
      predictions.push({ prediction: 'Tài', confidence: 74 + probTai * 10, priority: 9, name: 'Markov bậc 2' });
      factors.push('📈 Markov 2 → Tài');
    } else if (probTai < 0.28) {
      predictions.push({ prediction: 'Xỉu', confidence: 74 + (1 - probTai) * 10, priority: 9, name: 'Markov bậc 2' });
      factors.push('📈 Markov 2 → Xỉu');
    }
  }
  
  // ===== MARKOV BẬC 3 (MỚI) =====
  if (results.length >= 3) {
    const key3 = results[2] + results[1] + results[0];
    const markov3 = learningData[type].markov3Matrix;
    const probTai = (markov3[key3 + 'Tài'] || 0) / ((markov3[key3 + 'Tài'] || 0) + (markov3[key3 + 'Xỉu'] || 0) || 1);
    if (probTai > 0.75) {
      predictions.push({ prediction: 'Tài', confidence: 76 + probTai * 10, priority: 10, name: 'Markov bậc 3' });
      factors.push('🎯 Markov 3 → Tài');
    } else if (probTai < 0.25) {
      predictions.push({ prediction: 'Xỉu', confidence: 76 + (1 - probTai) * 10, priority: 10, name: 'Markov bậc 3' });
      factors.push('🎯 Markov 3 → Xỉu');
    }
  }
  
  // ===== PHÂN TÍCH RSI =====
  if (learningData[type].rsiValue > 75) {
    predictions.push({ prediction: 'Xỉu', confidence: 78, priority: 8, name: 'RSI quá mua' });
    factors.push(`⚡ RSI ${learningData[type].rsiValue.toFixed(1)} (quá mua) → Xỉu`);
  } else if (learningData[type].rsiValue < 25) {
    predictions.push({ prediction: 'Tài', confidence: 78, priority: 8, name: 'RSI quá bán' });
    factors.push(`⚡ RSI ${learningData[type].rsiValue.toFixed(1)} (quá bán) → Tài`);
  }
  
  // ===== PHÂN TÍCH MACD =====
  if (learningData[type].macdSignal > 0.15) {
    predictions.push({ prediction: 'Tài', confidence: 75, priority: 7, name: 'MACD dương' });
    factors.push('📈 MACD dương → Tài');
  } else if (learningData[type].macdSignal < -0.15) {
    predictions.push({ prediction: 'Xỉu', confidence: 75, priority: 7, name: 'MACD âm' });
    factors.push('📉 MACD âm → Xỉu');
  }
  
  // ===== CÁC PATTERN CẦU =====
  const patternFunctions = [
    analyzeCauBet, analyzeCauDao11, analyzeCauDao11NangCao, analyzeCau22, analyzeCau22NangCao,
    analyzeCau33, analyzeCau121, analyzeCau123, analyzeCau321, analyzeCauNhayCoc,
    analyzeCauNhayCocNangCao, analyzeCauNhipNghieng, analyzeCau3Van1, analyzeSmartBet,
    analyzeBreakStreak, analyzeTriplePattern, analyzeTongPhanTich, analyzeTongPhanTichNangCao,
    analyzeXuHuongManh, analyzeXuHuongManhNangCao, analyzeDaoChieu, analyzeElliottWaveAdvanced
  ];
  
  for (let fn of patternFunctions) {
    let p = fn(results, type);
    if (p && p.detected) {
      predictions.push({ ...p, priority: p.priority || 6 });
      if (p.name) factors.push(p.name);
    }
  }
  
  // ===== FIBONACCI SUPPORT/RESISTANCE =====
  const fibSR = analyzeFibonacciSR(data, type);
  if (fibSR) {
    predictions.push(fibSR);
    factors.push(fibSR.name);
  }
  
  // ===== TỔNG HỢP ĐIỂM =====
  let taiScore = 0, xiuScore = 0;
  for (const p of predictions) {
    const weight = learningData[type].patternWeights[p.name] || 1.0;
    const conf = p.confidence * weight;
    const priorityBonus = (p.priority || 5) / 5;
    if (p.prediction === 'Tài') taiScore += conf * priorityBonus;
    else xiuScore += conf * priorityBonus;
  }
  
  // ===== REVERSAL MODE =====
  const streak = learningData[type].streakAnalysis.currentStreak;
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  
  if (streak <= -4 && !learningData[type].reversalState.active) {
    finalPrediction = finalPrediction === 'Tài' ? 'Xỉu' : 'Tài';
    learningData[type].reversalState = { active: true, streakTrigger: streak };
    factors.push('🔄 REVERSAL MODE ACTIVE');
  } else if (streak > 0 && learningData[type].reversalState.active) {
    learningData[type].reversalState.active = false;
  }
  
  // ===== TÍNH CONFIDENCE CUỐI =====
  let baseConf = 65;
  const topPatterns = predictions.sort((a, b) => (b.priority || 5) - (a.priority || 5)).slice(0, 3);
  for (const p of topPatterns) {
    if (p.prediction === finalPrediction) {
      baseConf += (p.confidence - 65) * 0.3;
    }
  }
  
  const totalVotes = predictions.length;
  const agreement = (finalPrediction === 'Tài' ? 
    predictions.filter(p => p.prediction === 'Tài').length : 
    predictions.filter(p => p.prediction === 'Xỉu').length) / (totalVotes || 1);
  baseConf += agreement * 15;
  
  // Điều chỉnh theo volatility
  const volatility = learningData[type].volatility;
  if (volatility > 4) baseConf -= 8;
  else if (volatility < 2) baseConf += 6;
  
  let finalConf = Math.min(96, Math.max(58, Math.round(baseConf)));
  
  return {
    prediction: finalPrediction,
    confidence: finalConf,
    factors: factors.slice(0, 8),
    allPatterns: predictions.map(p => p.name).slice(0, 6),
    detailedAnalysis: {
      totalPatterns: predictions.length,
      taiVotes: predictions.filter(p => p.prediction === 'Tài').length,
      xiuVotes: predictions.filter(p => p.prediction === 'Xỉu').length,
      topPattern: topPatterns[0]?.name || 'N/A',
      rsi: learningData[type].rsiValue.toFixed(1),
      macd: learningData[type].macdSignal.toFixed(3),
      learningStats: {
        accuracy: learningData[type].totalPredictions ? 
          (learningData[type].correctPredictions / learningData[type].totalPredictions * 100).toFixed(1) + '%' : 'N/A',
        currentStreak: streak
      }
    }
  };
}

// ==================== CÁC HÀM HỖ TRỢ ====================
function getPatternIdFromName(name) {
  const mapping = {
    'Cầu Bệt': 'cau_bet', 'Cầu Đảo 1-1': 'cau_dao_11', 'Cầu 2-2': 'cau_22', 'Cầu 3-3': 'cau_33',
    'Cầu 1-2-1': 'cau_121', 'Cầu 1-2-3': 'cau_123', 'Cầu 3-2-1': 'cau_321', 'Cầu Nhảy Cóc': 'cau_nhay_coc',
    'Cầu Nhịp Nghiêng': 'cau_nhip_nghieng', 'Cầu 3 Ván 1': 'cau_3van1', 'Đảo Xu Hướng': 'smart_bet',
    'Bẻ Chuỗi': 'break_streak', '3 Bộ Ba': 'triple_pattern', 'Tổng Phân Tích': 'tong_phan_tich',
    'Xu Hướng Mạnh': 'xu_huong_manh', 'Đảo Chiều': 'dao_chieu', 'Markov bậc 1': 'markov1', 
    'Markov bậc 2': 'markov2', 'Markov bậc 3': 'markov3', 'Sóng Elliott': 'elliott',
    'RSI quá mua': 'rsi_overbought', 'RSI quá bán': 'rsi_oversold', 'MACD dương': 'macd_positive',
    'MACD âm': 'macd_negative', 'Fibonacci kháng cự': 'fib_resistance', 'Fibonacci hỗ trợ': 'fib_support'
  };
  for (const [key, val] of Object.entries(mapping)) {
    if (name.includes(key)) return val;
  }
  return null;
}

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
        learningData[type].streakAnalysis.wins++;
        if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
          learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
        }
      } else {
        learningData[type].streakAnalysis.currentStreak = Math.min(-1, learningData[type].streakAnalysis.currentStreak - 1);
        learningData[type].streakAnalysis.losses++;
        if (learningData[type].streakAnalysis.currentStreak < learningData[type].streakAnalysis.worstStreak) {
          learningData[type].streakAnalysis.worstStreak = learningData[type].streakAnalysis.currentStreak;
        }
      }
      learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 100) learningData[type].recentAccuracy.shift();
      
      // Cập nhật pattern weights
      if (pred.patterns) {
        for (const pName of pred.patterns) {
          const patId = getPatternIdFromName(pName);
          if (patId && learningData[type].patternStats[patId]) {
            learningData[type].patternStats[patId].total++;
            if (pred.isCorrect) learningData[type].patternStats[patId].correct++;
            const acc = learningData[type].patternStats[patId].correct / learningData[type].patternStats[patId].total;
            learningData[type].patternWeights[patId] = Math.min(2.0, Math.max(0.4, acc * 1.5));
          } else if (patId) {
            learningData[type].patternStats[patId] = { total: 1, correct: pred.isCorrect ? 1 : 0, recentResults: [] };
            learningData[type].patternWeights[patId] = pred.isCorrect ? 1.2 : 0.8;
          }
        }
      }
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
    id: '@anhquan',
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
    // Cập nhật volatility
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 20) {
      const sums = dataHu.slice(0, 20).map(d => d.Tong);
      let changes = [];
      for (let i = 1; i < sums.length; i++) changes.push(Math.abs(sums[i] - sums[i-1]));
      learningData.hu.volatility = changes.reduce((a,b) => a+b, 0) / changes.length;
    }
    
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 20) {
      const sums = dataMd5.slice(0, 20).map(d => d.Tong);
      let changes = [];
      for (let i = 1; i < sums.length; i++) changes.push(Math.abs(sums[i] - sums[i-1]));
      learningData.md5.volatility = changes.reduce((a,b) => a+b, 0) / changes.length;
    }
    
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
    console.error('[Auto] Lỗi:', error.message);
  }
}

function startAutoSaveTask() {
  setTimeout(autoProcessPredictions, 5000);
  setInterval(autoProcessPredictions, AUTO_SAVE_INTERVAL);
}

// ==================== ENDPOINTS ====================
app.get('/', (req, res) => res.send('t.me/anhquan'));

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
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
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
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/hu/lichsu', async (req, res) => {
  await updateHistoryStatus('hu');
  res.json({ type: 'Lẩu Cua 79 - Tài Xỉu Hũ', history: predictionHistory.hu, total: predictionHistory.hu.length, id: '@anhquan' });
});

app.get('/md5/lichsu', async (req, res) => {
  await updateHistoryStatus('md5');
  res.json({ type: 'Lẩu Cua 79 - Tài Xỉu MD5', history: predictionHistory.md5, total: predictionHistory.md5.length, id: '@anhquan' });
});

app.get('/hu/thamso', async (req, res) => {
  const data = await fetchDataHu();
  if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
  const result = calculateAdvancedPrediction(data, 'hu');
  res.json({ prediction: result.prediction, confidence: result.confidence, factors: result.factors, analysis: result.detailedAnalysis });
});

app.get('/md5/thamso', async (req, res) => {
  const data = await fetchDataMd5();
  if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
  const result = calculateAdvancedPrediction(data, 'md5');
  res.json({ prediction: result.prediction, confidence: result.confidence, factors: result.factors, analysis: result.detailedAnalysis });
});

app.get('/hu/hochoi', (req, res) => {
  const stats = learningData.hu;
  const acc = stats.totalPredictions ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  res.json({ type: 'HU Learning', totalPredictions: stats.totalPredictions, correctPredictions: stats.correctPredictions, accuracy: acc + '%', streakAnalysis: stats.streakAnalysis, id: '@anhquan' });
});

app.get('/md5/hochoi', (req, res) => {
  const stats = learningData.md5;
  const acc = stats.totalPredictions ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  res.json({ type: 'MD5 Learning', totalPredictions: stats.totalPredictions, correctPredictions: stats.correctPredictions, accuracy: acc + '%', streakAnalysis: stats.streakAnalysis, id: '@anhquan' });
});

app.get('/resetdata', (req, res) => {
  learningData = {
    hu: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: {}, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [], reversalState: { active: false, streakTrigger: 0 }, markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 }, markov2Matrix: {}, markov3Matrix: {}, volatility: 0, fibonacciLevels: { support: [], resistance: [] }, rsiValue: 50, macdSignal: 0 },
    md5: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: {}, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [], reversalState: { active: false, streakTrigger: 0 }, markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 }, markov2Matrix: {}, markov3Matrix: {}, volatility: 0, fibonacciLevels: { support: [], resistance: [] }, rsiValue: 50, macdSignal: 0 }
  };
  saveLearningData();
  res.json({ message: 'Đã reset dữ liệu học', id: '@anhquan' });
});

// ==================== KHỞI ĐỘNG ====================
loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server @anhquan chạy trên http://0.0.0.0:${PORT}`);
  console.log(`✅ Đã nâng cấp thuật toán: Markov bậc 3, RSI, MACD, Fibonacci`);
  console.log(`✅ Thêm cầu siêu dài: 1-1 dài, 2-2 dài, nhảy cóc dài, xu hướng cực mạnh`);
  console.log(`✅ Tự động học và điều chỉnh trọng số`);
  startAutoSaveTask();
});