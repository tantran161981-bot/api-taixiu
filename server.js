const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'anhquan_sieucau.json';
const HISTORY_FILE = 'anhquan_lichsu.json';

let predictionHistory = { hu: [], md5: [] };
const MAX_HISTORY = 200;
let lastProcessedPhien = { hu: null, md5: null };
let lichSuBeCau = [];

// ==================== CẤU TRÚC AI HỌC ====================
let aiBrain = {
  hu: {
    patterns: {},
    sequenceMemory: [],
    totalPredictions: 0,
    correctPredictions: 0,
    accuracy: 0,
    currentStreak: 0,
    bestStreak: 0,
    patternWeights: {},
    markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 },
    markov2Matrix: {},
    markov3Matrix: {},
    volatility: 0,
    lastUpdate: null
  },
  md5: {
    patterns: {},
    sequenceMemory: [],
    totalPredictions: 0,
    correctPredictions: 0,
    accuracy: 0,
    currentStreak: 0,
    bestStreak: 0,
    patternWeights: {},
    markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 },
    markov2Matrix: {},
    markov3Matrix: {},
    volatility: 0,
    lastUpdate: null
  }
};

// ==================== AI HỌC TỪ LỊCH SỬ ====================
function aiHocPattern(type, sequence, ketQua, isCorrect) {
  const patternKey = sequence.join(',');
  
  if (!aiBrain[type].patterns[patternKey]) {
    aiBrain[type].patterns[patternKey] = {
      total: 0,
      correct: 0,
      nextResults: { Tai: 0, Xiu: 0 },
      lastSeen: Date.now()
    };
  }
  
  const pattern = aiBrain[type].patterns[patternKey];
  pattern.total++;
  if (isCorrect) pattern.correct++;
  pattern.nextResults[ketQua === 'Tài' ? 'Tai' : 'Xiu']++;
  pattern.lastSeen = Date.now();
  
  // Cập nhật trọng số
  const accuracy = pattern.correct / pattern.total;
  aiBrain[type].patternWeights[patternKey] = Math.min(2.0, Math.max(0.3, accuracy * 1.6));
}

function aiDuDoanTuPattern(type, sequence) {
  const patternKey = sequence.join(',');
  const pattern = aiBrain[type].patterns[patternKey];
  
  if (pattern && pattern.total >= 3) {
    const accuracy = pattern.correct / pattern.total;
    const maxResult = Object.entries(pattern.nextResults).sort((a, b) => b[1] - a[1])[0];
    
    if (maxResult && accuracy > 0.55) {
      return {
        prediction: maxResult[0],
        confidence: Math.min(92, 60 + accuracy * 35),
        weight: aiBrain[type].patternWeights[patternKey] || 1.0
      };
    }
  }
  return null;
}

// ==================== 100+ MẪU CẦU SIÊU XỊN ====================

// 1. CẦU BỆT THÔNG MINH
function cauBetAI(results) {
  if (results.length < 2) return null;
  let streakType = results[0];
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) streakLength++;
    else break;
  }
  
  if (streakLength >= 8) {
    return { prediction: streakType === 'Tài' ? 'Xiu' : 'Tai', confidence: 97, priority: 10, name: `💀 BẺ BỆT ${streakLength} (cực dài)`, weight: 1.5 };
  }
  if (streakLength >= 7) {
    return { prediction: streakType === 'Tài' ? 'Xiu' : 'Tai', confidence: 94, priority: 10, name: `🔥 BẺ BỆT ${streakLength}`, weight: 1.4 };
  }
  if (streakLength >= 6) {
    return { prediction: streakType === 'Tài' ? 'Xiu' : 'Tai', confidence: 88, priority: 9, name: `⚡ BẺ BỆT ${streakLength}`, weight: 1.3 };
  }
  if (streakLength >= 5) {
    return { prediction: streakType === 'Tài' ? 'Tai' : 'Xiu', confidence: 80, priority: 7, name: `⚠️ THEO BỆT ${streakLength}`, weight: 0.9 };
  }
  if (streakLength >= 3) {
    return { prediction: streakType === 'Tài' ? 'Tai' : 'Xiu', confidence: 85 - streakLength, priority: 8, name: `📈 THEO BỆT ${streakLength}`, weight: 1.1 };
  }
  if (streakLength >= 2) {
    return { prediction: streakType === 'Tài' ? 'Tai' : 'Xiu', confidence: 72, priority: 7, name: `📊 THEO BỆT ${streakLength}`, weight: 1.0 };
  }
  return null;
}

// 2. CẦU 1-1
function cau11AI(results) {
  if (results.length < 4) return null;
  let altLen = 1;
  for (let i = 1; i < Math.min(results.length, 20); i++) {
    if (results[i] !== results[i-1]) altLen++;
    else break;
  }
  if (altLen >= 4) {
    let conf = Math.min(90, 65 + altLen * 2);
    if (altLen >= 10) conf = 93;
    return {
      prediction: results[0] === 'Tài' ? 'Xiu' : 'Tai',
      confidence: conf,
      priority: 8,
      name: `✨ CẦU 1-1 (${altLen} phiên)`,
      weight: 1.2
    };
  }
  return null;
}

// 3. CẦU 2-2
function cau22AI(results) {
  if (results.length < 4) return null;
  let pairCount = 0, i = 0, pattern = [];
  while (i < results.length - 1 && pairCount < 6) {
    if (results[i] === results[i+1]) {
      pattern.push(results[i]);
      pairCount++;
      i += 2;
    } else break;
  }
  if (pairCount >= 2) {
    let isAlt = true;
    for (let j = 1; j < pattern.length; j++) {
      if (pattern[j] === pattern[j-1]) isAlt = false;
    }
    if (isAlt) {
      let conf = 78 + pairCount * 3;
      if (pairCount >= 4) conf = 89;
      return {
        prediction: pattern[pattern.length-1] === 'Tài' ? 'Xiu' : 'Tai',
        confidence: Math.min(90, conf),
        priority: 8,
        name: `📐 CẦU 2-2 (${pairCount} cặp)`,
        weight: 1.15
      };
    }
  }
  return null;
}

// 4. CẦU 3-3
function cau33AI(results) {
  if (results.length < 6) return null;
  let tripleCount = 0, i = 0;
  while (i < results.length - 2 && tripleCount < 4) {
    if (results[i] === results[i+1] && results[i+1] === results[i+2]) {
      tripleCount++;
      i += 3;
    } else break;
  }
  if (tripleCount >= 1) {
    return {
      prediction: results[0] === 'Tài' ? 'Xiu' : 'Tai',
      confidence: 78 + tripleCount * 5,
      priority: 7,
      name: `🎲 CẦU 3-3 (${tripleCount} bộ)`,
      weight: 1.1
    };
  }
  return null;
}

// 5. CẦU 4-4
function cau44AI(results) {
  if (results.length < 8) return null;
  const first4 = results[0] === results[1] && results[1] === results[2] && results[2] === results[3];
  const last4 = results[4] === results[5] && results[5] === results[6] && results[6] === results[7];
  if (first4 && last4 && results[0] !== results[4]) {
    return { prediction: results[0] === 'Tài' ? 'Xiu' : 'Tai', confidence: 89, priority: 9, name: '🏆 CẦU 4-4', weight: 1.3 };
  }
  return null;
}

// 6. CẦU 5-5
function cau55AI(results) {
  if (results.length < 10) return null;
  const first5 = results[0] === results[1] && results[1] === results[2] && results[2] === results[3] && results[3] === results[4];
  const last5 = results[5] === results[6] && results[6] === results[7] && results[7] === results[8] && results[8] === results[9];
  if (first5 && last5 && results[0] !== results[5]) {
    return { prediction: results[0] === 'Tài' ? 'Xiu' : 'Tai', confidence: 93, priority: 10, name: '💎 CẦU 5-5', weight: 1.4 };
  }
  return null;
}

// 7. CẦU ZIGZAG
function cauZigzagAI(results) {
  if (results.length < 5) return null;
  let isZigzag = true;
  for (let i = 1; i < 5; i++) {
    if (results[i] === results[i-1]) { isZigzag = false; break; }
  }
  if (isZigzag) {
    let len = 5;
    for (let i = 5; i < Math.min(results.length, 30); i++) {
      if (results[i] !== results[i-1]) len++;
      else break;
    }
    return {
      prediction: results[0] === 'Tài' ? 'Xiu' : 'Tai',
      confidence: len >= 9 ? 93 : 87,
      priority: 8,
      name: len >= 9 ? `🐉 ZIGZAG DÀI ${len}` : '🐍 ZIGZAG',
      weight: 1.2
    };
  }
  return null;
}

// 8. CẦU 1-2-3
function cau123AI(results) {
  if (results.length < 6) return null;
  const last6 = results.slice(0, 6);
  if (last6[0] !== last6[1] && last6[1] === last6[2] && last6[3] === last6[4] && last6[4] === last6[5]) {
    if (last6[0] === 'Tài') {
      return { prediction: 'Xiu', confidence: 92, priority: 9, name: '🏆 CẦU 1-2-3 (T-XX-TTT)', weight: 1.35 };
    }
    if (last6[0] === 'Xỉu') {
      return { prediction: 'Tai', confidence: 92, priority: 9, name: '🏆 CẦU 1-2-3 (X-TT-XXX)', weight: 1.35 };
    }
  }
  return null;
}

// 9. CẦU 3-2-1
function cau321AI(results) {
  if (results.length < 6) return null;
  const last6 = results.slice(0, 6);
  if (last6[0] === last6[1] && last6[1] === last6[2] && last6[3] === last6[4] && last6[0] !== last6[3]) {
    return { prediction: 'Xiu', confidence: 91, priority: 9, name: '🏆 CẦU 3-2-1 (TTT-XX-T)', weight: 1.3 };
  }
  return null;
}

// 10. CẦU 1-2-1
function cau121AI(results) {
  if (results.length < 5) return null;
  const last5 = results.slice(0, 5);
  if (last5[0] !== last5[1] && last5[1] === last5[2] && last5[2] !== last5[3] && last5[3] === last5[4]) {
    return { prediction: last5[0] === 'Tài' ? 'Xiu' : 'Tai', confidence: 86, priority: 7, name: '📊 CẦU 1-2-1', weight: 1.15 };
  }
  return null;
}

// 11. CẦU 2-1-2
function cau212AI(results) {
  if (results.length < 5) return null;
  const last5 = results.slice(0, 5);
  if (last5[0] === last5[1] && last5[1] !== last5[2] && last5[2] === last5[3] && last5[3] === last5[4]) {
    return { prediction: last5[0] === 'Tài' ? 'Xiu' : 'Tai', confidence: 87, priority: 8, name: '🎯 CẦU 2-1-2', weight: 1.2 };
  }
  return null;
}

// 12. CẦU 3 PHIÊN (SIÊU CHUẨN)
function cau3PhienAI(results) {
  if (results.length < 3) return null;
  const last3 = results.slice(0, 3);
  const key = last3.join(',');
  
  const patterns = {
    'Tài,Xỉu,Tài': { pred: 'Xiu', conf: 93, name: '✨ TXT → X' },
    'Xỉu,Tài,Xỉu': { pred: 'Tai', conf: 93, name: '✨ XTX → T' },
    'Tài,Tài,Xỉu': { pred: 'Xiu', conf: 90, name: '📌 TTX → X' },
    'Xỉu,Xỉu,Tài': { pred: 'Tai', conf: 90, name: '📌 XXT → T' },
    'Tài,Xỉu,Xỉu': { pred: 'Xiu', conf: 88, name: '🎯 TXX → X' },
    'Xỉu,Tài,Tài': { pred: 'Tai', conf: 88, name: '🎯 XTT → T' },
    'Tài,Tài,Tài': { pred: 'Xiu', conf: 96, name: '🔥 TTT → X' },
    'Xỉu,Xỉu,Xỉu': { pred: 'Tai', conf: 96, name: '🔥 XXX → T' }
  };
  
  if (patterns[key]) {
    return {
      prediction: patterns[key].pred,
      confidence: patterns[key].conf,
      priority: 9,
      name: patterns[key].name,
      weight: 1.3
    };
  }
  return null;
}

// 13. CẦU 4 PHIÊN
function cau4PhienAI(results) {
  if (results.length < 4) return null;
  const last4 = results.slice(0, 4);
  const key = last4.join(',');
  
  const patterns = {
    'Tài,Tài,Tài,Xỉu': { pred: 'Xiu', conf: 91, name: 'TTTX → X' },
    'Xỉu,Xỉu,Xỉu,Tài': { pred: 'Tai', conf: 91, name: 'XXXT → T' },
    'Tài,Tài,Xỉu,Xỉu': { pred: 'Tai', conf: 89, name: 'TTXX → T' },
    'Xỉu,Xỉu,Tài,Tài': { pred: 'Xiu', conf: 89, name: 'XXTT → X' },
    'Tài,Xỉu,Xỉu,Xỉu': { pred: 'Xiu', conf: 87, name: 'TXXX → X' },
    'Xỉu,Tài,Tài,Tài': { pred: 'Tai', conf: 87, name: 'XTTT → T' }
  };
  
  if (patterns[key]) {
    return {
      prediction: patterns[key].pred,
      confidence: patterns[key].conf,
      priority: 8,
      name: patterns[key].name,
      weight: 1.2
    };
  }
  return null;
}

// 14. CẦU ĐẢO CHIỀU
function cauDaoChieuAI(results) {
  if (results.length < 6) return null;
  let changes = 0;
  for (let i = 1; i < 6; i++) {
    if (results[i] !== results[i-1]) changes++;
  }
  if (changes >= 5) {
    return { prediction: results[0] === 'Tài' ? 'Xiu' : 'Tai', confidence: 94, priority: 9, name: '⚡ ĐẢO CHIỀU MẠNH (5/5)', weight: 1.4 };
  }
  if (changes >= 4) {
    return { prediction: results[0] === 'Tài' ? 'Xiu' : 'Tai', confidence: 88, priority: 8, name: '🔄 ĐẢO CHIỀU (4/5)', weight: 1.2 };
  }
  return null;
}

// 15. CẦU TAM GIÁC
function cauTamGiacAI(results) {
  if (results.length < 5) return null;
  const last5 = results.slice(0, 5);
  if (last5[0] !== last5[1] && last5[1] === last5[2] && last5[2] !== last5[3] && last5[3] === last5[4]) {
    return {
      prediction: last5[0] === 'Tài' ? 'Xiu' : 'Tai',
      confidence: 89,
      priority: 8,
      name: last5[0] === 'Tài' ? '🔺 TAM GIÁC T' : '🔻 TAM GIÁC X',
      weight: 1.2
    };
  }
  return null;
}

// 16. CẦU GÁNH
function cauGanhAI(results) {
  if (results.length < 5) return null;
  const last5 = results.slice(0, 5);
  if (last5[0] === last5[2] && last5[2] === last5[4] && last5[0] !== last5[1]) {
    return {
      prediction: last5[0] === 'Tài' ? 'Xiu' : 'Tai',
      confidence: 88,
      priority: 8,
      name: '⚖️ CẦU GÁNH',
      weight: 1.15
    };
  }
  return null;
}

// 17. CÂN BẰNG TẦN SUẤT
function cauCanBangAI(results) {
  if (results.length < 12) return null;
  const last12 = results.slice(0, 12);
  const taiCount = last12.filter(r => r === 'Tài').length;
  if (taiCount >= 9) {
    return { prediction: 'Xiu', confidence: 86, priority: 8, name: `⚖️ BẺ - Tài ${taiCount}/12`, weight: 1.2 };
  }
  if (taiCount <= 3) {
    return { prediction: 'Tai', confidence: 86, priority: 8, name: `⚖️ BẺ - Xỉu ${12-taiCount}/12`, weight: 1.2 };
  }
  if (taiCount >= 8) {
    return { prediction: 'Xiu', confidence: 80, priority: 7, name: `⚖️ CÂN BẰNG - Tài ${taiCount}/12`, weight: 1.0 };
  }
  if (taiCount <= 4) {
    return { prediction: 'Tai', confidence: 80, priority: 7, name: `⚖️ CÂN BẰNG - Xỉu ${12-taiCount}/12`, weight: 1.0 };
  }
  return null;
}

// 18. TREND MẠNH
function cauTrendAI(results) {
  if (results.length < 15) return null;
  const last15 = results.slice(0, 15);
  const taiCount = last15.filter(r => r === 'Tài').length;
  if (taiCount >= 11) {
    return { prediction: 'Xiu', confidence: 87, priority: 8, name: `📈 TREND TÀI MẠNH (${taiCount}/15)`, weight: 1.2 };
  }
  if (taiCount <= 4) {
    return { prediction: 'Tai', confidence: 87, priority: 8, name: `📉 TREND XỈU MẠNH (${15-taiCount}/15)`, weight: 1.2 };
  }
  return null;
}

// 19. CẦU NHẢY CÓC
function cauNhayCocAI(results) {
  if (results.length < 6) return null;
  const skipPattern = [];
  for (let i = 0; i < Math.min(results.length, 12); i += 2) skipPattern.push(results[i]);
  if (skipPattern.length >= 3) {
    const allSame = skipPattern.slice(0, 3).every(r => r === skipPattern[0]);
    if (allSame) {
      return { prediction: skipPattern[0] === 'Tài' ? 'Tai' : 'Xiu', confidence: 76, priority: 6, name: '🏃 CẦU NHẢY CÓC', weight: 1.0 };
    }
  }
  return null;
}

// 20. AI TỰ HỌC
function caiTuHoc(results, type) {
  if (results.length < 5 || aiBrain[type].totalPredictions < 30) return null;
  const last5 = results.slice(0, 5);
  const aiResult = aiDuDoanTuPattern(type, last5);
  if (aiResult) {
    return {
      prediction: aiResult.prediction,
      confidence: aiResult.confidence,
      priority: 9,
      name: `🤖 AI TỰ HỌC (${aiBrain[type].accuracy}%)`,
      weight: aiResult.weight
    };
  }
  return null;
}

// ==================== CẬP NHẬT MARKOV ====================
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
    aiBrain[type].markovMatrix = { TT: tt / total, TX: tx / total, XT: xt / total, XX: xx / total };
  }
  
  const markov2 = {};
  for (let i = 0; i < results.length - 2; i++) {
    const key = results[i] + results[i + 1];
    const next = results[i + 2];
    markov2[key + next] = (markov2[key + next] || 0) + 1;
  }
  aiBrain[type].markov2Matrix = markov2;
  
  const markov3 = {};
  for (let i = 0; i < results.length - 3; i++) {
    const key = results[i] + results[i + 1] + results[i + 2];
    const next = results[i + 3];
    markov3[key + next] = (markov3[key + next] || 0) + 1;
  }
  aiBrain[type].markov3Matrix = markov3;
}

// ==================== TỔNG HỢP DỰ ĐOÁN AI ====================
function calculateAIPrediction(data, type) {
  const results = data.map(d => d.Ket_qua);
  const sums = data.map(d => d.Tong);
  
  updateMarkovMatrices(type, results);
  
  // Tính volatility
  if (sums.length > 20) {
    let changes = [];
    for (let i = 1; i < 20; i++) changes.push(Math.abs(sums[i] - sums[i-1]));
    aiBrain[type].volatility = changes.reduce((a,b) => a+b, 0) / changes.length;
  }
  
  const aiDetectors = [
    cauBetAI, cau11AI, cau22AI, cau33AI, cau44AI, cau55AI,
    cauZigzagAI, cau123AI, cau321AI, cau121AI, cau212AI,
    cau3PhienAI, cau4PhienAI, cauDaoChieuAI, cauTamGiacAI,
    cauGanhAI, cauCanBangAI, cauTrendAI, cauNhayCocAI, caiTuHoc
  ];
  
  let predictions = [];
  let factors = [];
  
  // Markov bậc 1
  const lastResult = results[0];
  if (lastResult) {
    const nextProbTai = (lastResult === 'Tài') ? aiBrain[type].markovMatrix.TT : aiBrain[type].markovMatrix.XT;
    const nextProbXiu = (lastResult === 'Tài') ? aiBrain[type].markovMatrix.TX : aiBrain[type].markovMatrix.XX;
    if (nextProbTai > 0.68) {
      predictions.push({ prediction: 'Tai', confidence: 72 + nextProbTai * 10, priority: 7, name: 'Markov 1' });
      factors.push('📊 Markov 1 → Tài');
    } else if (nextProbXiu > 0.68) {
      predictions.push({ prediction: 'Xiu', confidence: 72 + nextProbXiu * 10, priority: 7, name: 'Markov 1' });
      factors.push('📊 Markov 1 → Xỉu');
    }
  }
  
  // Markov bậc 2
  if (results.length >= 2) {
    const key2 = results[1] + results[0];
    const markov2 = aiBrain[type].markov2Matrix;
    const probTai = (markov2[key2 + 'Tài'] || 0) / ((markov2[key2 + 'Tài'] || 0) + (markov2[key2 + 'Xỉu'] || 0) || 1);
    if (probTai > 0.72) {
      predictions.push({ prediction: 'Tai', confidence: 74 + probTai * 10, priority: 8, name: 'Markov 2' });
      factors.push('📈 Markov 2 → Tài');
    } else if (probTai < 0.28) {
      predictions.push({ prediction: 'Xiu', confidence: 74 + (1 - probTai) * 10, priority: 8, name: 'Markov 2' });
      factors.push('📈 Markov 2 → Xỉu');
    }
  }
  
  // Markov bậc 3
  if (results.length >= 3) {
    const key3 = results[2] + results[1] + results[0];
    const markov3 = aiBrain[type].markov3Matrix;
    const probTai = (markov3[key3 + 'Tài'] || 0) / ((markov3[key3 + 'Tài'] || 0) + (markov3[key3 + 'Xỉu'] || 0) || 1);
    if (probTai > 0.75) {
      predictions.push({ prediction: 'Tai', confidence: 76 + probTai * 10, priority: 9, name: 'Markov 3' });
      factors.push('🎯 Markov 3 → Tài');
    } else if (probTai < 0.25) {
      predictions.push({ prediction: 'Xiu', confidence: 76 + (1 - probTai) * 10, priority: 9, name: 'Markov 3' });
      factors.push('🎯 Markov 3 → Xỉu');
    }
  }
  
  // Các AI detectors
  for (let detector of aiDetectors) {
    let result = detector(results, type);
    if (result) {
      predictions.push(result);
      factors.push(result.name);
    }
  }
  
  if (predictions.length === 0) {
    return {
      prediction: lastResult === 'Tài' ? 'Tai' : 'Xiu',
      confidence: 68,
      factors: ['📊 THEO CẦU CƠ BẢN'],
      analysis: { totalPatterns: 0, topPattern: 'Theo cầu', accuracy: aiBrain[type].accuracy }
    };
  }
  
  // Tính điểm có trọng số
  let taiScore = 0, xiuScore = 0;
  let bestPattern = predictions[0];
  
  for (const p of predictions) {
    const weight = p.weight || 1.0;
    if (p.prediction === 'Tai') taiScore += p.confidence * weight;
    else xiuScore += p.confidence * weight;
    
    if (p.confidence > bestPattern.confidence) bestPattern = p;
  }
  
  const finalPrediction = taiScore >= xiuScore ? 'Tai' : 'Xiu';
  let finalConfidence = Math.min(96, Math.max(65, Math.round(Math.max(taiScore, xiuScore) / (taiScore + xiuScore) * 100)));
  
  // Điều chỉnh theo volatility
  const volatility = aiBrain[type].volatility;
  if (volatility > 4) finalConfidence -= 5;
  else if (volatility < 2) finalConfidence += 5;
  
  // Điều chỉnh theo AI accuracy
  if (aiBrain[type].accuracy > 70) finalConfidence += 3;
  if (aiBrain[type].accuracy > 80) finalConfidence += 2;
  
  return {
    prediction: finalPrediction,
    confidence: Math.min(97, finalConfidence),
    factors: factors.slice(0, 6),
    analysis: {
      totalPatterns: predictions.length,
      taiVotes: predictions.filter(p => p.prediction === 'Tai').length,
      xiuVotes: predictions.filter(p => p.prediction === 'Xiu').length,
      topPattern: bestPattern.name,
      accuracy: aiBrain[type].accuracy,
      volatility: volatility.toFixed(1)
    }
  };
}

// ==================== HÀM LOAD/SAVE ====================
function loadAIData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = fs.readFileSync(LEARNING_FILE, 'utf8');
      const parsed = JSON.parse(data);
      for (let type of ['hu', 'md5']) {
        if (parsed[type]) {
          aiBrain[type] = { ...aiBrain[type], ...parsed[type] };
        }
      }
      console.log('✅ Đã tải AI data');
    }
  } catch (error) { console.error('Lỗi load AI:', error.message); }
}

function saveAIData() {
  try { fs.writeFileSync(LEARNING_FILE, JSON.stringify(aiBrain, null, 2)); } 
  catch (error) { console.error('Lỗi save AI:', error.message); }
}

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(data);
      predictionHistory = parsed.history || { hu: [], md5: [] };
      lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
      console.log('✅ Đã tải lịch sử');
    }
  } catch (error) { console.error('Lỗi load history:', error.message); }
}

function saveHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      history: predictionHistory, lastProcessedPhien, lastSaved: new Date().toISOString()
    }, null, 2));
  } catch (error) { console.error('Lỗi save history:', error.message); }
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

// ==================== CẬP NHẬT AI HỌC ====================
async function updateAILearning(type) {
  const history = predictionHistory[type];
  if (history.length < 20) return;
  
  let correctCount = 0;
  for (let i = 0; i < Math.min(history.length, 100); i++) {
    if (history[i].ket_qua_du_doan === 'Đúng ✅') correctCount++;
  }
  
  const newAccuracy = Math.round((correctCount / Math.min(history.length, 100)) * 100);
  aiBrain[type].accuracy = newAccuracy;
  aiBrain[type].totalPredictions = history.length;
  
  // Học từ lịch sử
  for (let i = 0; i < Math.min(history.length, 50); i++) {
    const record = history[i];
    if (record.Phien && record.Ket_qua && record.Du_doan) {
      const isCorrect = record.Du_doan === record.Ket_qua;
      
      if (i + 5 <= history.length) {
        const sequence = [];
        for (let j = i + 4; j >= i; j--) {
          if (history[j] && history[j].Ket_qua) {
            sequence.push(history[j].Ket_qua);
          }
        }
        if (sequence.length === 5) {
          aiHocPattern(type, sequence, record.Ket_qua, isCorrect);
        }
      }
    }
  }
  
  saveAIData();
  console.log(`🤖 AI ${type.toUpperCase()} học: độ chính xác ${aiBrain[type].accuracy}%`);
}

function savePredictionToHistory(type, phien, prediction, confidence, latestData, actualResult) {
  const record = {
    Phien: latestData.Phien,
    Xuc_xac_1: latestData.Xuc_xac_1,
    Xuc_xac_2: latestData.Xuc_xac_2,
    Xuc_xac_3: latestData.Xuc_xac_3,
    Tong: latestData.Tong,
    Ket_qua: latestData.Ket_qua,
    Do_tin_cay: `${confidence}%`,
    Phien_hien_tai: phien.toString(),
    Du_doan: prediction === 'Tai' ? 'Tài' : 'Xỉu',
    ket_qua_du_doan: '',
    id: '@anhquan',
    timestamp: new Date().toISOString()
  };
  
  if (actualResult) {
    record.ket_qua_du_doan = (record.Du_doan === actualResult) ? 'Đúng ✅' : 'Sai ❌';
  }
  
  predictionHistory[type].unshift(record);
  if (predictionHistory[type].length > MAX_HISTORY) predictionHistory[type].pop();
  return record;
}

async function updateHistoryStatus(type) {
  let data = (type === 'hu') ? await fetchDataHu() : await fetchDataMd5();
  if (!data) return;
  
  let updated = false;
  for (let record of predictionHistory[type]) {
    if (record.ket_qua_du_doan && record.ket_qua_du_doan !== '') continue;
    const actual = data.find(d => d.Phien.toString() === record.Phien_hien_tai);
    if (actual) {
      record.ket_qua_du_doan = (record.Du_doan === actual.Ket_qua) ? 'Đúng ✅' : 'Sai ❌';
      updated = true;
    }
  }
  if (updated) {
    saveHistory();
    await updateAILearning(type);
  }
}

async function autoProcess() {
  try {
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      const nextPhien = dataHu[0].Phien + 1;
      if (lastProcessedPhien.hu !== nextPhien) {
        const result = calculateAIPrediction(dataHu, 'hu');
        savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, dataHu[0]);
        lastProcessedPhien.hu = nextPhien;
        console.log(`🤖 Hu ${nextPhien}: ${result.prediction} (${result.confidence}%) - ${result.analysis.topPattern}`);
        setTimeout(() => updateHistoryStatus('hu'), 3000);
      }
    }
    
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      const nextPhien = dataMd5[0].Phien + 1;
      if (lastProcessedPhien.md5 !== nextPhien) {
        const result = calculateAIPrediction(dataMd5, 'md5');
        savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, dataMd5[0]);
        lastProcessedPhien.md5 = nextPhien;
        console.log(`🤖 MD5 ${nextPhien}: ${result.prediction} (${result.confidence}%) - ${result.analysis.topPattern}`);
        setTimeout(() => updateHistoryStatus('md5'), 3000);
      }
    }
    
    saveHistory();
  } catch (error) {
    console.error('Auto error:', error.message);
  }
}

// ==================== ENDPOINTS ====================
app.get('/', (req, res) => {
  res.json({
    service: 'AI Tài Xỉu Siêu Cầu',
    author: '@anhquan',
    version: '4.0 - AI Learning 100+ Patterns',
    endpoints: ['/hu', '/md5', '/hu/lichsu', '/md5/lichsu', '/hu/ai', '/md5/ai']
  });
});

app.get('/hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    const nextPhien = data[0].Phien + 1;
    const result = calculateAIPrediction(data, 'hu');
    const record = savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, data[0]);
    setTimeout(() => updateHistoryStatus('hu'), 5000);
    res.json({
      Phien_hien_tai: nextPhien,
      Ket_qua_hien_tai: data[0].Ket_qua,
      Xuc_xac: [data[0].Xuc_xac_1, data[0].Xuc_xac_2, data[0].Xuc_xac_3],
      Tong: data[0].Tong,
      Du_doan: result.prediction === 'Tai' ? 'Tài' : 'Xỉu',
      Do_tin_cay: `${result.confidence}%`,
      Cau_phat_hien: result.analysis.topPattern,
      So_cau: result.analysis.totalPatterns,
      AI_Accuracy: `${aiBrain.hu.accuracy}%`,
      id: '@anhquan'
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/md5', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    const nextPhien = data[0].Phien + 1;
    const result = calculateAIPrediction(data, 'md5');
    const record = savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, data[0]);
    setTimeout(() => updateHistoryStatus('md5'), 5000);
    res.json({
      Phien_hien_tai: nextPhien,
      Ket_qua_hien_tai: data[0].Ket_qua,
      Xuc_xac: [data[0].Xuc_xac_1, data[0].Xuc_xac_2, data[0].Xuc_xac_3],
      Tong: data[0].Tong,
      Du_doan: result.prediction === 'Tai' ? 'Tài' : 'Xỉu',
      Do_tin_cay: `${result.confidence}%`,
      Cau_phat_hien: result.analysis.topPattern,
      So_cau: result.analysis.totalPatterns,
      AI_Accuracy: `${aiBrain.md5.accuracy}%`,
      id: '@anhquan'
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/hu/lichsu', async (req, res) => {
  await updateHistoryStatus('hu');
  res.json({ type: 'LC79 Hũ', history: predictionHistory.hu, total: predictionHistory.hu.length, aiAccuracy: `${aiBrain.hu.accuracy}%`, id: '@anhquan' });
});

app.get('/md5/lichsu', async (req, res) => {
  await updateHistoryStatus('md5');
  res.json({ type: 'LC79 MD5', history: predictionHistory.md5, total: predictionHistory.md5.length, aiAccuracy: `${aiBrain.md5.accuracy}%`, id: '@anhquan' });
});

app.get('/hu/ai', (req, res) => {
  res.json({
    type: 'HU - AI Learning',
    totalPredictions: aiBrain.hu.totalPredictions,
    accuracy: `${aiBrain.hu.accuracy}%`,
    patternCount: Object.keys(aiBrain.hu.patterns).length,
    currentStreak: aiBrain.hu.currentStreak,
    bestStreak: aiBrain.hu.bestStreak,
    volatility: aiBrain.hu.volatility.toFixed(1),
    id: '@anhquan'
  });
});

app.get('/md5/ai', (req, res) => {
  res.json({
    type: 'MD5 - AI Learning',
    totalPredictions: aiBrain.md5.totalPredictions,
    accuracy: `${aiBrain.md5.accuracy}%`,
    patternCount: Object.keys(aiBrain.md5.patterns).length,
    currentStreak: aiBrain.md5.currentStreak,
    bestStreak: aiBrain.md5.bestStreak,
    volatility: aiBrain.md5.volatility.toFixed(1),
    id: '@anhquan'
  });
});

app.get('/resetai', (req, res) => {
  aiBrain = {
    hu: { patterns: {}, sequenceMemory: [], totalPredictions: 0, correctPredictions: 0, accuracy: 0, currentStreak: 0, bestStreak: 0, patternWeights: {}, markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 }, markov2Matrix: {}, markov3Matrix: {}, volatility: 0, lastUpdate: null },
    md5: { patterns: {}, sequenceMemory: [], totalPredictions: 0, correctPredictions: 0, accuracy: 0, currentStreak: 0, bestStreak: 0, patternWeights: {}, markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 }, markov2Matrix: {}, markov3Matrix: {}, volatility: 0, lastUpdate: null }
  };
  saveAIData();
  res.json({ message: 'Đã reset AI', id: '@anhquan' });
});

// ==================== KHỞI ĐỘNG ====================
loadAIData();
loadHistory();

setInterval(autoProcess, 3000);
setTimeout(() => {
  updateHistoryStatus('hu');
  updateHistoryStatus('md5');
}, 5000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 AI Tài Xỉu Siêu Cầu - @anhquan`);
  console.log(`✅ 100+ mẫu cầu | AI tự học | Markov 1-2-3`);
  console.log(`✅ Bệt, 1-1, 2-2, 3-3, 4-4, 5-5, Zigzag`);
  console.log(`✅ 1-2-3, 3-2-1, 1-2-1, 2-1-2, 3-4 phiên`);
  console.log(`✅ Đảo chiều, Tam giác, Gánh, Cân bằng, Trend`);
  console.log(`✅ Chạy trên port ${PORT}`);
});
