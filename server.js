const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'anhquan.json';
const HISTORY_FILE = 'anhquan1.json';

let predictionHistory = { hu: [], md5: [] };
const MAX_HISTORY = 100;
const AUTO_SAVE_INTERVAL = 30000;
let lastProcessedPhien = { hu: null, md5: null };

// ==================== CẤU TRÚC HỌC TẬP ====================
let learningData = {
  hu: {
    predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0,
    patternWeights: {}, lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [], reversalState: { active: false, streakTrigger: 0 },
    markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 },
    markov2Matrix: {}, markov3Matrix: {}, volatility: 0,
    fibonacciLevels: { support: [], resistance: [] }, rsiValue: 50, macdSignal: 0
  },
  md5: {
    predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0,
    patternWeights: {}, lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [], reversalState: { active: false, streakTrigger: 0 },
    markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 },
    markov2Matrix: {}, markov3Matrix: {}, volatility: 0,
    fibonacciLevels: { support: [], resistance: [] }, rsiValue: 50, macdSignal: 0
  }
};

// ==================== THUẬT TOÁN PHÂN TÍCH CẦU (CÂN BẰNG) ====================

// 1. Cầu Bệt
function analyzeCauBet(results, type) {
  if (results.length < 3) return { detected: false };
  let streakType = results[0];
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) streakLength++;
    else break;
  }
  if (streakLength >= 3) {
    let shouldBreak = streakLength >= 4;
    let confidence = 65 + Math.min(streakLength, 8) * 3;
    let prediction = shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType;
    return {
      detected: true,
      prediction: prediction,
      confidence: Math.min(85, confidence),
      name: `📈 Cầu Bệt ${streakLength}p`,
      priority: 8
    };
  }
  return { detected: false };
}

// 2. Cầu Đảo 1-1
function analyzeCauDao11(results, type) {
  if (results.length < 4) return { detected: false };
  let alternatingLength = 1;
  for (let i = 1; i < Math.min(results.length, 12); i++) {
    if (results[i] !== results[i - 1]) alternatingLength++;
    else break;
  }
  if (alternatingLength >= 4) {
    let confidence = 60 + Math.min(alternatingLength, 10) * 3;
    let prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction: prediction,
      confidence: Math.min(82, confidence),
      name: `🔄 Cầu 1-1 (${alternatingLength}p)`,
      priority: 7
    };
  }
  return { detected: false };
}

// 3. Cầu 2-2
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
    for (let j = 1; j < pattern.length; j++) {
      if (pattern[j] === pattern[j - 1]) isAlternating = false;
    }
    if (isAlternating) {
      let confidence = 62 + pairCount * 4;
      return {
        detected: true,
        prediction: pattern[pattern.length - 1] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.min(80, confidence),
        name: `📊 Cầu 2-2 (${pairCount} cặp)`,
        priority: 7
      };
    }
  }
  return { detected: false };
}

// 4. Cầu 3-3
function analyzeCau33(results, type) {
  if (results.length < 6) return { detected: false };
  let tripleCount = 0, i = 0, pattern = [];
  while (i < results.length - 2 && tripleCount < 3) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
      pattern.push(results[i]);
      tripleCount++;
      i += 3;
    } else break;
  }
  if (tripleCount >= 1) {
    let confidence = 65 + tripleCount * 5;
    let prediction = pattern[pattern.length - 1] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction: prediction,
      confidence: Math.min(82, confidence),
      name: `🎲 Cầu 3-3 (${tripleCount} bộ)`,
      priority: 7
    };
  }
  return { detected: false };
}

// 5. Cầu 1-2-1
function analyzeCau121(results, type) {
  if (results.length < 4) return { detected: false };
  const p = results.slice(0, 4);
  if (p[0] !== p[1] && p[1] === p[2] && p[2] !== p[3] && p[0] === p[3]) {
    return { detected: true, prediction: p[0], confidence: 70, name: '✨ Cầu 1-2-1', priority: 6 };
  }
  return { detected: false };
}

// 6. Cầu 1-2-3
function analyzeCau123(results, type) {
  if (results.length < 6) return { detected: false };
  const first = results[5];
  const nextTwo = results.slice(3, 5);
  const lastThree = results.slice(0, 3);
  if (nextTwo[0] === nextTwo[1] && nextTwo[0] !== first) {
    const allSame = lastThree.every(r => r === lastThree[0]);
    if (allSame && lastThree[0] !== nextTwo[0]) {
      return { detected: true, prediction: first, confidence: 72, name: '🎯 Cầu 1-2-3', priority: 6 };
    }
  }
  return { detected: false };
}

// 7. Cầu 3-2-1
function analyzeCau321(results, type) {
  if (results.length < 6) return { detected: false };
  const first3 = results.slice(3, 6);
  const next2 = results.slice(1, 3);
  const last1 = results[0];
  const first3Same = first3.every(r => r === first3[0]);
  const next2Same = next2.every(r => r === next2[0]);
  if (first3Same && next2Same && first3[0] !== next2[0] && last1 !== next2[0]) {
    return { detected: true, prediction: next2[0], confidence: 74, name: '🏆 Cầu 3-2-1', priority: 6 };
  }
  return { detected: false };
}

// 8. Cầu Nhảy Cóc
function analyzeCauNhayCoc(results, type) {
  if (results.length < 6) return { detected: false };
  const skipPattern = [];
  for (let i = 0; i < Math.min(results.length, 12); i += 2) skipPattern.push(results[i]);
  if (skipPattern.length >= 3) {
    const allSame = skipPattern.slice(0, 3).every(r => r === skipPattern[0]);
    if (allSame) {
      return { detected: true, prediction: skipPattern[0], confidence: 68, name: '🐸 Cầu Nhảy Cóc', priority: 5 };
    }
    let alternating = true;
    for (let i = 1; i < skipPattern.length - 1; i++) {
      if (skipPattern[i] === skipPattern[i - 1]) alternating = false;
    }
    if (alternating && skipPattern.length >= 3) {
      return { detected: true, prediction: skipPattern[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 66, name: '🐸 Cầu Nhảy Cóc Đảo', priority: 5 };
    }
  }
  return { detected: false };
}

// 9. Cầu Nhịp Nghiêng
function analyzeCauNhipNghieng(results, type) {
  if (results.length < 5) return { detected: false };
  const last5 = results.slice(0, 5);
  const taiCount = last5.filter(r => r === 'Tài').length;
  if (taiCount >= 4) {
    return { detected: true, prediction: 'Xỉu', confidence: 68, name: `⚖️ Nghiêng Tài (${taiCount}/5)`, priority: 5 };
  } else if (taiCount <= 1) {
    return { detected: true, prediction: 'Tài', confidence: 68, name: `⚖️ Nghiêng Xỉu (${5 - taiCount}/5)`, priority: 5 };
  }
  return { detected: false };
}

// 10. Cầu 3 Ván 1
function analyzeCau3Van1(results, type) {
  if (results.length < 4) return { detected: false };
  const last4 = results.slice(0, 4);
  const taiCount = last4.filter(r => r === 'Tài').length;
  if (taiCount === 3) return { detected: true, prediction: 'Xỉu', confidence: 68, name: '🎰 3T-1X → Xỉu', priority: 5 };
  if (taiCount === 1) return { detected: true, prediction: 'Tài', confidence: 68, name: '🎰 3X-1T → Tài', priority: 5 };
  return { detected: false };
}

// 11. Smart Bet (Đảo xu hướng)
function analyzeSmartBet(results, type) {
  if (results.length < 10) return { detected: false };
  const last5 = results.slice(0, 5);
  const prev5 = results.slice(5, 10);
  const taiLast5 = last5.filter(r => r === 'Tài').length;
  const taiPrev5 = prev5.filter(r => r === 'Tài').length;
  const trendChanging = (taiLast5 >= 4 && taiPrev5 <= 1) || (taiLast5 <= 1 && taiPrev5 >= 4);
  if (trendChanging) {
    return { detected: true, prediction: taiLast5 >= 4 ? 'Xỉu' : 'Tài', confidence: 75, name: `🧠 Đảo xu hướng`, priority: 8 };
  }
  const taiLast10 = results.slice(0, 10).filter(r => r === 'Tài').length;
  if (taiLast10 >= 8) {
    return { detected: true, prediction: 'Xỉu', confidence: 78, name: `🧠 Cực Tài (${taiLast10}/10)`, priority: 8 };
  }
  if (taiLast10 <= 2) {
    return { detected: true, prediction: 'Tài', confidence: 78, name: `🧠 Cực Xỉu (${10 - taiLast10}/10)`, priority: 8 };
  }
  return { detected: false };
}

// 12. Tổng Phân Tích
function analyzeTongPhanTich(data, type) {
  if (data.length < 10) return { detected: false };
  const sums = data.slice(0, 10).map(d => d.Tong);
  const results = data.slice(0, 10).map(d => d.Ket_qua);
  const first5Sum = sums.slice(5, 10).reduce((a, b) => a + b, 0) / 5;
  const last5Sum = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const sumTrend = last5Sum - first5Sum;
  if (sumTrend > 2) return { detected: true, prediction: 'Xỉu', confidence: 72, name: `📉 Tổng tăng → Xỉu`, priority: 7 };
  if (sumTrend < -2) return { detected: true, prediction: 'Tài', confidence: 72, name: `📈 Tổng giảm → Tài`, priority: 7 };
  const taiCount = results.filter(r => r === 'Tài').length;
  if (taiCount >= 7) return { detected: true, prediction: 'Xỉu', confidence: 70, name: `📐 Lệch Tài (${taiCount}/10)`, priority: 6 };
  if (taiCount <= 3) return { detected: true, prediction: 'Tài', confidence: 70, name: `📐 Lệch Xỉu (${10 - taiCount}/10)`, priority: 6 };
  return { detected: false };
}

// 13. Xu Hướng Mạnh
function analyzeXuHuongManh(results, type) {
  if (results.length < 8) return { detected: false };
  const taiCount = results.slice(0, 8).filter(r => r === 'Tài').length;
  if (taiCount >= 6) return { detected: true, prediction: 'Xỉu', confidence: 76, name: `📊 XH Tài (${taiCount}/8)`, priority: 8 };
  if (taiCount <= 2) return { detected: true, prediction: 'Tài', confidence: 76, name: `📊 XH Xỉu (${8 - taiCount}/8)`, priority: 8 };
  return { detected: false };
}

// 14. Đảo Chiều
function analyzeDaoChieu(results, type) {
  if (results.length < 5) return { detected: false };
  let isAlternating = true;
  for (let i = 1; i < 5; i++) {
    if (results[i] === results[i - 1]) { isAlternating = false; break; }
  }
  if (isAlternating) {
    return { detected: true, prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 72, name: `🔄 Đảo chiều`, priority: 7 };
  }
  return { detected: false };
}

// 15. LSTM Pattern (học từ lịch sử)
function analyzeLSTMPattern(results, type) {
  if (results.length < 12) return { detected: false };
  const weights = [0.14, 0.12, 0.11, 0.1, 0.09, 0.08, 0.07, 0.06, 0.05, 0.04, 0.03, 0.02];
  let taiScore = 0, totalWeight = 0;
  for (let i = 0; i < 12; i++) {
    if (results[i] === 'Tài') taiScore += weights[i];
    totalWeight += weights[i];
  }
  const taiProb = taiScore / totalWeight;
  if (taiProb > 0.6) {
    return { detected: true, prediction: 'Tài', confidence: 65 + taiProb * 20, name: '🧠 LSTM → Tài', priority: 9 };
  } else if (taiProb < 0.4) {
    return { detected: true, prediction: 'Xỉu', confidence: 65 + (1 - taiProb) * 20, name: '🧠 LSTM → Xỉu', priority: 9 };
  }
  return { detected: false };
}

// 16. Phân tích chu kỳ
function analyzeCyclePattern(results, type) {
  if (results.length < 16) return { detected: false };
  for (let cycle of [4, 5, 6]) {
    let matches = 0;
    for (let i = 0; i < Math.min(results.length - cycle, 15); i++) {
      if (results[i] === results[i + cycle]) matches++;
    }
    if (matches >= 10) {
      return { detected: true, prediction: results[cycle - 1], confidence: 68, name: `🔄 Chu kỳ ${cycle}p`, priority: 7 };
    }
  }
  return { detected: false };
}

// 17. Phân tích Momentum
function analyzeMomentum(results, type) {
  if (results.length < 8) return { detected: false };
  let momentum = 0;
  for (let i = 0; i < 4; i++) {
    if (results[i] === 'Tài' && results[i + 1] === 'Tài') momentum++;
    else if (results[i] === 'Xỉu' && results[i + 1] === 'Xỉu') momentum--;
  }
  if (momentum >= 3) return { detected: true, prediction: 'Xỉu', confidence: 70, name: '📉 Momentum giảm', priority: 6 };
  if (momentum <= -3) return { detected: true, prediction: 'Tài', confidence: 70, name: '📈 Momentum tăng', priority: 6 };
  return { detected: false };
}

// 18. Phân tích RSI
function analyzeRSI(results, type) {
  if (results.length < 14) return { detected: false };
  let gains = 0, losses = 0;
  for (let i = 0; i < 14; i++) {
    if (results[i] === 'Tài') gains++;
    else losses++;
  }
  const rsi = 100 - (100 / (1 + (gains / (losses || 1))));
  if (rsi > 75) return { detected: true, prediction: 'Xỉu', confidence: 72, name: `⚡ RSI ${Math.round(rsi)}`, priority: 7 };
  if (rsi < 25) return { detected: true, prediction: 'Tài', confidence: 72, name: `⚡ RSI ${Math.round(rsi)}`, priority: 7 };
  return { detected: false };
}

// ==================== HÀM HỖ TRỢ ====================
function updateMarkovMatrices(type, results) {
  if (results.length < 20) return;
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
}

// ==================== TỔNG HỢP DỰ ĐOÁN (CÂN BẰNG) ====================
function calculateAdvancedPrediction(data, type) {
  const results = data.map(d => d.Ket_qua);
  const sums = data.map(d => d.Tong);
  
  updateMarkovMatrices(type, results);
  
  let predictions = [];
  let factors = [];

  // === TẤT CẢ CÁC PATTERN (ĐÃ CÂN BẰNG) ===
  const patternFunctions = [
    analyzeCauBet, analyzeCauDao11, analyzeCau22, analyzeCau33, analyzeCau121,
    analyzeCau123, analyzeCau321, analyzeCauNhayCoc, analyzeCauNhipNghieng,
    analyzeCau3Van1, analyzeSmartBet, analyzeTongPhanTich, analyzeXuHuongManh,
    analyzeDaoChieu, analyzeLSTMPattern, analyzeCyclePattern, analyzeMomentum, analyzeRSI
  ];
  
  for (let fn of patternFunctions) {
    let p = fn(results, type);
    if (p && p.detected) {
      predictions.push(p);
      if (p.name) factors.push(p.name);
    }
  }
  
  // === MARKOV BẬC 1 (CHỈ KHI XÁC SUẤT CAO) ===
  const lastResult = results[0];
  if (lastResult && learningData[type].markovMatrix) {
    const nextProbTai = (lastResult === 'Tài') ? learningData[type].markovMatrix.TT : learningData[type].markovMatrix.XT;
    const nextProbXiu = (lastResult === 'Tài') ? learningData[type].markovMatrix.TX : learningData[type].markovMatrix.XX;
    if (nextProbTai > 0.7) {
      predictions.push({ prediction: 'Tài', confidence: 70 + nextProbTai * 15, priority: 7, name: '📊 Markov 1' });
      factors.push('📊 Markov 1 → Tài');
    } else if (nextProbXiu > 0.7) {
      predictions.push({ prediction: 'Xỉu', confidence: 70 + nextProbXiu * 15, priority: 7, name: '📊 Markov 1' });
      factors.push('📊 Markov 1 → Xỉu');
    }
  }
  
  // === TÍNH ĐIỂM (CÂN BẰNG) ===
  let taiScore = 0, xiuScore = 0;
  for (const p of predictions) {
    const weight = learningData[type].patternWeights[p.name] || 1.0;
    const conf = p.confidence * weight;
    const priorityBonus = (p.priority || 5) / 5;
    if (p.prediction === 'Tài') taiScore += conf * priorityBonus;
    else xiuScore += conf * priorityBonus;
  }
  
  // === THÊM MỘT CHÚT NGẪU NHIÊN CÓ KIỂM SOÁT ĐỂ TRÁNH NGHIÊNG ===
  // Nếu không có pattern nào hoặc điểm quá cân bằng, dùng luật đơn giản
  if (predictions.length === 0 || Math.abs(taiScore - xiuScore) < 10) {
    // Dùng luật: theo kết quả 3 phiên gần nhất
    const last3 = results.slice(0, 3);
    const taiCount = last3.filter(r => r === 'Tài').length;
    if (taiCount >= 2) {
      taiScore += 15;
      factors.push('📋 Theo 3 phiên gần → Tài');
    } else {
      xiuScore += 15;
      factors.push('📋 Theo 3 phiên gần → Xỉu');
    }
  }
  
  // Quyết định cuối cùng
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  
  // === REVERSAL MODE (CHỐNG ĐẢO KHI THUA LIÊN TIẾP) ===
  const streak = learningData[type].streakAnalysis.currentStreak;
  if (streak <= -3 && !learningData[type].reversalState.active) {
    finalPrediction = finalPrediction === 'Tài' ? 'Xỉu' : 'Tài';
    learningData[type].reversalState = { active: true, streakTrigger: streak };
    factors.unshift('🔄 REVERSAL MODE');
  } else if (streak > 0 && learningData[type].reversalState.active) {
    learningData[type].reversalState.active = false;
  }
  
  // Tính confidence
  let baseConf = 62;
  const topPatterns = predictions.sort((a, b) => (b.priority || 5) - (a.priority || 5)).slice(0, 3);
  for (const p of topPatterns) {
    if (p.prediction === finalPrediction) {
      baseConf += (p.confidence - 62) * 0.25;
    }
  }
  
  const totalVotes = predictions.length;
  if (totalVotes > 0) {
    const agreement = (finalPrediction === 'Tài' ? 
      predictions.filter(p => p.prediction === 'Tài').length : 
      predictions.filter(p => p.prediction === 'Xỉu').length) / totalVotes;
    baseConf += agreement * 12;
  }
  
  let finalConf = Math.min(94, Math.max(60, Math.round(baseConf)));
  
  return {
    prediction: finalPrediction,
    confidence: finalConf,
    factors: factors.slice(0, 6),
    allPatterns: predictions.map(p => p.name).slice(0, 5),
    detailedAnalysis: {
      totalPatterns: predictions.length,
      taiVotes: predictions.filter(p => p.prediction === 'Tài').length,
      xiuVotes: predictions.filter(p => p.prediction === 'Xỉu').length,
      topPattern: topPatterns[0]?.name || 'N/A',
      learningStats: {
        accuracy: learningData[type].totalPredictions ? 
          (learningData[type].correctPredictions / learningData[type].totalPredictions * 100).toFixed(1) + '%' : 'N/A',
        currentStreak: streak
      }
    }
  };
}

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

function getPatternIdFromName(name) {
  const mapping = {
    'Cầu Bệt': 'cau_bet', 'Cầu Đảo 1-1': 'cau_dao_11', 'Cầu 2-2': 'cau_22', 'Cầu 3-3': 'cau_33',
    'Cầu 1-2-1': 'cau_121', 'Cầu 1-2-3': 'cau_123', 'Cầu 3-2-1': 'cau_321', 'Cầu Nhảy Cóc': 'cau_nhay_coc',
    'Nghiêng': 'cau_nhip_nghieng', '3T-1X': 'cau_3van1', 'Smart Bet': 'smart_bet',
    'Tổng Phân Tích': 'tong_phan_tich', 'Xu Hướng Mạnh': 'xu_huong_manh', 'Đảo chiều': 'dao_chieu',
    'LSTM': 'lstm', 'Chu kỳ': 'cycle', 'Momentum': 'momentum', 'RSI': 'rsi', 'Markov': 'markov'
  };
  for (const [key, val] of Object.entries(mapping)) {
    if (name && name.includes(key)) return val;
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
      
      if (pred.patterns) {
        for (const pName of pred.patterns) {
          const patId = getPatternIdFromName(pName);
          if (patId && learningData[type].patternStats[patId]) {
            learningData[type].patternStats[patId].total++;
            if (pred.isCorrect) learningData[type].patternStats[patId].correct++;
            const acc = learningData[type].patternStats[patId].correct / learningData[type].patternStats[patId].total;
            learningData[type].patternWeights[patId] = Math.min(1.8, Math.max(0.5, acc * 1.3));
          } else if (patId) {
            learningData[type].patternStats[patId] = { total: 1, correct: pred.isCorrect ? 1 : 0 };
            learningData[type].patternWeights[patId] = pred.isCorrect ? 1.1 : 0.9;
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
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      const nextPhien = dataHu[0].Phien + 1;
      if (lastProcessedPhien.hu !== nextPhien) {
        await verifyPredictions('hu', dataHu);
        const result = calculateAdvancedPrediction(dataHu, 'hu');
        savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, dataHu[0]);
        recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.hu = nextPhien;
        console.log(`[Auto] Hu ${nextPhien}: ${result.prediction} (${result.confidence}%)`);
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
        console.log(`[Auto] MD5 ${nextPhien}: ${result.prediction} (${result.confidence}%)`);
      }
    }
    savePredictionHistory();
    saveLearningData();
  } catch (error) {
    console.error('[Auto] Lỗi:', error.message);
  }
}

// ==================== API FUNCTIONS ====================
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
  res.json({ type: 'Tài Xỉu Hũ', history: predictionHistory.hu, total: predictionHistory.hu.length, id: '@anhquan' });
});

app.get('/md5/lichsu', async (req, res) => {
  await updateHistoryStatus('md5');
  res.json({ type: 'Tài Xỉu MD5', history: predictionHistory.md5, total: predictionHistory.md5.length, id: '@anhquan' });
});

app.get('/hu/phantich', async (req, res) => {
  const data = await fetchDataHu();
  if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
  const result = calculateAdvancedPrediction(data, 'hu');
  res.json({ prediction: result.prediction, confidence: result.confidence, factors: result.factors, analysis: result.detailedAnalysis });
});

app.get('/md5/phantich', async (req, res) => {
  const data = await fetchDataMd5();
  if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
  const result = calculateAdvancedPrediction(data, 'md5');
  res.json({ prediction: result.prediction, confidence: result.confidence, factors: result.factors, analysis: result.detailedAnalysis });
});

app.get('/hu/stat', (req, res) => {
  const stats = learningData.hu;
  const acc = stats.totalPredictions ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(1) : 0;
  res.json({ total: stats.totalPredictions, correct: stats.correctPredictions, accuracy: acc + '%', streak: stats.streakAnalysis.currentStreak });
});

app.get('/md5/stat', (req, res) => {
  const stats = learningData.md5;
  const acc = stats.totalPredictions ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(1) : 0;
  res.json({ total: stats.totalPredictions, correct: stats.correctPredictions, accuracy: acc + '%', streak: stats.streakAnalysis.currentStreak });
});

app.get('/reset', (req, res) => {
  learningData = {
    hu: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: {}, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [], reversalState: { active: false, streakTrigger: 0 }, markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 }, markov2Matrix: {}, markov3Matrix: {}, volatility: 0, fibonacciLevels: { support: [], resistance: [] }, rsiValue: 50, macdSignal: 0 },
    md5: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: {}, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [], reversalState: { active: false, streakTrigger: 0 }, markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 }, markov2Matrix: {}, markov3Matrix: {}, volatility: 0, fibonacciLevels: { support: [], resistance: [] }, rsiValue: 50, macdSignal: 0 }
  };
  saveLearningData();
  res.json({ message: 'Đã reset dữ liệu học' });
});

// ==================== KHỞI ĐỘNG ====================
loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 SERVER @anhquan ĐÃ CHẠY`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`✅ Đã sửa lỗi nghiêng về Xỉu - Cân bằng Tài/Xỉu`);
  console.log(`🧠 18 thuật toán: Bệt, 1-1, 2-2, 3-3, 1-2-1, 1-2-3, 3-2-1, Nhảy cóc, Nghiêng, 3 ván 1, Smart Bet, Tổng phân tích, Xu hướng, Đảo chiều, LSTM, Chu kỳ, Momentum, RSI`);
  console.log(`\n📊 API endpoints:`);
  console.log(`   GET /hu      - Dự đoán Hũ`);
  console.log(`   GET /md5     - Dự đoán MD5`);
  console.log(`   GET /hu/lichsu - Lịch sử Hũ`);
  console.log(`   GET /md5/lichsu - Lịch sử MD5`);
  console.log(`   GET /hu/stat - Thống kê Hũ`);
  console.log(`   GET /md5/stat - Thống kê MD5`);
  console.log(`\n`);
  
  startAutoSaveTask();
});
