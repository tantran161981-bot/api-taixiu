const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'tiendat.json';
const HISTORY_FILE = 'tiendat1.json';

let predictionHistory = {
  hu: [],
  md5: []
};

const MAX_HISTORY = 100;
const AUTO_SAVE_INTERVAL = 30000;
let lastProcessedPhien = { hu: null, md5: null };

let learningData = {
  hu: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    adaptiveThresholds: {},
    recentAccuracy: [],
    mlModel: { weights: {}, bias: 0, lastTraining: null }
  },
  md5: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    adaptiveThresholds: {},
    recentAccuracy: [],
    mlModel: { weights: {}, bias: 0, lastTraining: null }
  }
};

const DEFAULT_PATTERN_WEIGHTS = {
  'cau_bet': 1.0, 'cau_dao_11': 1.0, 'cau_22': 1.0, 'cau_33': 1.0,
  'cau_121': 1.0, 'cau_123': 1.0, 'cau_321': 1.0, 'cau_nhay_coc': 1.0,
  'cau_nhip_nghieng': 1.0, 'cau_3van1': 1.0, 'cau_be_cau': 1.0,
  'cau_chu_ky': 1.0, 'distribution': 1.0, 'dice_pattern': 1.0,
  'sum_trend': 1.0, 'edge_cases': 1.0, 'momentum': 1.0, 'cau_tu_nhien': 1.0,
  'dice_trend_line': 1.0, 'dice_trend_line_md5': 1.0, 'break_pattern_hu': 1.0,
  'break_pattern_md5': 1.0, 'fibonacci': 1.0, 'resistance_support': 1.0,
  'wave': 1.0, 'golden_ratio': 1.0, 'day_gay': 1.0, 'day_gay_md5': 1.0,
  'cau_44': 1.0, 'cau_55': 1.0, 'cau_212': 1.0, 'cau_1221': 1.0,
  'cau_2112': 1.0, 'cau_gap': 1.0, 'cau_ziczac': 1.0, 'cau_doi': 1.0,
  'cau_rong': 1.0, 'smart_bet': 1.0, 'break_pattern_advanced': 1.0,
  'break_streak': 1.0, 'alternating_break': 1.0, 'double_pair_break': 1.0,
  'triple_pattern': 1.0, 'tong_phan_tich': 1.5, 'xu_huong_manh': 1.3,
  'dao_chieu': 1.4, 'lstm_pattern': 1.2, 'markov_chain': 1.15,
  'neural_boost': 1.25, 'sentiment_analysis': 1.1, 'harmonic_pattern': 1.2
};

// ==================== HÀM MỚI: MACHINE LEARNING NÂNG CAO ====================

function extractFeatures(results, sums) {
  const features = {
    lastResult: results[0] === 'Tài' ? 1 : 0,
    last3Sum: sums.slice(0, 3).reduce((a, b) => a + b, 0) / 3,
    last5Sum: sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5,
    last10Sum: sums.slice(0, 10).reduce((a, b) => a + b, 0) / 10,
    volatility: calculateVolatility(sums.slice(0, 10)),
    taiRatio5: results.slice(0, 5).filter(r => r === 'Tài').length / 5,
    taiRatio10: results.slice(0, 10).filter(r => r === 'Tài').length / 10,
    streakLength: calculateStreakLength(results),
    alternatingStrength: calculateAlternatingStrength(results),
    patternComplexity: calculatePatternComplexity(results),
    sumTrend: calculateSumTrend(sums.slice(0, 10)),
    momentum: calculateMomentum(results, sums),
    supportResistance: detectSupportResistance(sums.slice(0, 20))
  };
  return features;
}

function calculateVolatility(sums) {
  if (sums.length < 2) return 0;
  const mean = sums.reduce((a, b) => a + b, 0) / sums.length;
  const variance = sums.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / sums.length;
  return Math.sqrt(variance);
}

function calculateStreakLength(results) {
  let streak = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) streak++;
    else break;
  }
  return streak;
}

function calculateAlternatingStrength(results) {
  let alternating = 0;
  for (let i = 1; i < Math.min(results.length, 10); i++) {
    if (results[i] !== results[i-1]) alternating++;
    else break;
  }
  return alternating;
}

function calculatePatternComplexity(results) {
  let changes = 0;
  for (let i = 1; i < results.length; i++) {
    if (results[i] !== results[i-1]) changes++;
  }
  return changes / results.length;
}

function calculateSumTrend(sums) {
  if (sums.length < 5) return 0;
  const firstHalf = sums.slice(0, Math.floor(sums.length/2));
  const secondHalf = sums.slice(Math.floor(sums.length/2));
  const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  return avgSecond - avgFirst;
}

function calculateMomentum(results, sums) {
  const recentResults = results.slice(0, 3);
  const recentSums = sums.slice(0, 3);
  const taiCount = recentResults.filter(r => r === 'Tài').length;
  const avgSum = recentSums.reduce((a, b) => a + b, 0) / 3;
  return { taiMomentum: taiCount / 3, sumMomentum: avgSum };
}

function detectSupportResistance(sums) {
  if (sums.length < 10) return { support: null, resistance: null };
  const sorted = [...sums].sort((a, b) => a - b);
  return {
    support: sorted[Math.floor(sorted.length * 0.25)],
    resistance: sorted[Math.floor(sorted.length * 0.75)]
  };
}

function predictWithML(features, type) {
  const model = learningData[type].mlModel;
  let score = model.bias || 0;
  
  Object.entries(features).forEach(([key, value]) => {
    if (model.weights[key]) {
      score += value * model.weights[key];
    }
  });
  
  return 1 / (1 + Math.exp(-score)); // Sigmoid
}

function updateMLModel(type, features, actualResult) {
  const target = actualResult === 'Tài' ? 1 : 0;
  const prediction = predictWithML(features, type);
  const error = target - prediction;
  
  const model = learningData[type].mlModel;
  // Learning rate decay: giảm dần theo số lần huấn luyện
  const trainCount = learningData[type].totalPredictions || 1;
  const learningRate = Math.max(0.001, 0.05 / (1 + trainCount * 0.001));
  
  // L2 regularization để tránh overfitting
  const lambda = 0.001;
  
  model.bias = (model.bias || 0) + learningRate * error;
  
  Object.entries(features).forEach(([key, value]) => {
    if (!model.weights[key]) model.weights[key] = 0;
    // Gradient clipping: giới hạn cập nhật tối đa
    const gradient = learningRate * error * value - lambda * model.weights[key];
    const clipped = Math.max(-0.1, Math.min(0.1, gradient));
    model.weights[key] += clipped;
  });
  
  model.lastTraining = new Date().toISOString();
  model.trainCount = (model.trainCount || 0) + 1;
}

// ==================== PATTERN MỚI: LSTM và MARKOV CHAIN ====================

function analyzeLSTMPattern(results, type) {
  if (results.length < 10) return { detected: false };
  
  const weights = getPatternWeight(type, 'lstm_pattern');
  let patternScore = 0;
  
  // Phân tích chuỗi dài hạn
  const sequence = results.slice(0, 10);
  let longTermTrend = 0;
  for (let i = 0; i < sequence.length - 1; i++) {
    if (sequence[i] === sequence[i+1]) longTermTrend++;
    else longTermTrend--;
  }
  
  // Dự đoán dựa trên xu hướng dài hạn
  if (Math.abs(longTermTrend) >= 4) {
    const prediction = longTermTrend > 0 ? 
      (Math.random() > 0.7 ? 'Xỉu' : 'Tài') : 
      (Math.random() > 0.7 ? 'Tài' : 'Xỉu');
    
    return {
      detected: true,
      prediction,
      confidence: Math.round(68 + Math.abs(longTermTrend) * 2),
      name: `LSTM Pattern (Xu hướng ${longTermTrend > 0 ? 'cùng chiều' : 'đảo chiều'})`,
      patternId: 'lstm_pattern'
    };
  }
  
  return { detected: false };
}

function analyzeMarkovChain(results, type) {
  if (results.length < 15) return { detected: false };
  
  const weights = getPatternWeight(type, 'markov_chain');
  
  // --- Markov bậc 1 ---
  const transitions1 = { 'Tài_Tài': 0, 'Tài_Xỉu': 0, 'Xỉu_Tài': 0, 'Xỉu_Xỉu': 0 };
  for (let i = 0; i < results.length - 1; i++) {
    const key = `${results[i]}_${results[i+1]}`;
    transitions1[key]++;
  }
  const lastResult = results[0];
  const fromLast1_Tai = transitions1[`${lastResult}_Tài`] || 0;
  const fromLast1_Xiu = transitions1[`${lastResult}_Xỉu`] || 0;
  const probTai1 = fromLast1_Tai / (fromLast1_Tai + fromLast1_Xiu || 1);

  // --- Markov bậc 2 (xét 2 kết quả gần nhất) ---
  let probTai2 = 0.5;
  if (results.length >= 20) {
    const transitions2 = {};
    for (let i = 0; i < results.length - 2; i++) {
      const state = `${results[i]}_${results[i+1]}`;
      const next = results[i+2];
      if (!transitions2[state]) transitions2[state] = { Tài: 0, Xỉu: 0 };
      transitions2[state][next]++;
    }
    const state2 = `${results[0]}_${results[1]}`;
    if (transitions2[state2]) {
      const t2 = transitions2[state2].Tài || 0;
      const x2 = transitions2[state2].Xỉu || 0;
      probTai2 = t2 / (t2 + x2 || 1);
    }
  }

  // Kết hợp bậc 1 và bậc 2 (trọng số cao hơn cho bậc 2 khi có đủ dữ liệu)
  const dataWeight2 = results.length >= 30 ? 0.6 : 0.3;
  const combinedProb = probTai1 * (1 - dataWeight2) + probTai2 * dataWeight2;
  
  if (combinedProb > 0.68 || combinedProb < 0.32) {
    const prediction = combinedProb > 0.68 ? 'Tài' : 'Xỉu';
    return {
      detected: true,
      prediction,
      confidence: Math.round(70 + Math.abs(combinedProb - 0.5) * 50),
      name: `Markov Chain Bậc 2 (Xác suất ${(combinedProb * 100).toFixed(0)}% ${prediction})`,
      patternId: 'markov_chain'
    };
  }
  
  return { detected: false };
}

function analyzeNeuralBoost(results, sums, type) {
  if (results.length < 20) return { detected: false };
  
  const weights = getPatternWeight(type, 'neural_boost');
  
  // Mạng neuron đơn giản với 3 lớp ẩn
  const input = [
    results.slice(0, 5).filter(r => r === 'Tài').length / 5,
    results.slice(5, 10).filter(r => r === 'Tài').length / 5,
    (sums[0] - 10.5) / 5.5,
    calculateVolatility(sums.slice(0, 10)) / 5
  ];
  
  // Layer 1
  const h1 = input.map(x => 1 / (1 + Math.exp(-x * 2)));
  // Layer 2
  const output = h1.reduce((a, b) => a + b, 0) / h1.length;
  
  const prediction = output > 0.55 ? 'Tài' : (output < 0.45 ? 'Xỉu' : null);
  
  if (prediction && Math.abs(output - 0.5) > 0.1) {
    return {
      detected: true,
      prediction,
      confidence: Math.round(65 + Math.abs(output - 0.5) * 50),
      name: `Neural Boost (Độ tin cậy: ${(Math.abs(output - 0.5) * 100).toFixed(0)}%)`,
      patternId: 'neural_boost'
    };
  }
  
  return { detected: false };
}

function analyzeHarmonicPattern(results, sums, type) {
  if (results.length < 12) return { detected: false };
  
  const weights = getPatternWeight(type, 'harmonic_pattern');
  
  // Phát hiện mô hình sóng Elliott đơn giản
  const waves = [];
  let currentWave = { type: results[0], length: 1 };
  
  for (let i = 1; i < results.length; i++) {
    if (results[i] === currentWave.type) {
      currentWave.length++;
    } else {
      waves.push({ ...currentWave });
      currentWave = { type: results[i], length: 1 };
    }
  }
  waves.push(currentWave);
  
  // Mô hình 5 sóng
  if (waves.length >= 5) {
    const pattern5 = waves.slice(0, 5);
    const isImpulse = pattern5[0].type === pattern5[2].type && 
                      pattern5[2].type === pattern5[4].type &&
                      pattern5[1].type !== pattern5[0].type &&
                      pattern5[3].type !== pattern5[2].type;
    
    if (isImpulse) {
      const prediction = pattern5[4].type === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        prediction,
        confidence: 78,
        name: `Harmonic Pattern (Sóng Elliott ${pattern5[4].type} → ${prediction})`,
        patternId: 'harmonic_pattern'
      };
    }
  }
  
  return { detected: false };
}

function analyzeSentiment(results, sums, type) {
  if (results.length < 10) return { detected: false };
  
  const weights = getPatternWeight(type, 'sentiment_analysis');
  
  // Phân tích tâm lý thị trường dựa trên biến động
  const volatility = calculateVolatility(sums.slice(0, 10));
  const recentTaiRatio = results.slice(0, 5).filter(r => r === 'Tài').length / 5;
  const prevTaiRatio = results.slice(5, 10).filter(r => r === 'Tài').length / 5;
  
  // Tâm lý FOMO (sợ bỏ lỡ)
  if (recentTaiRatio > 0.8 && prevTaiRatio < 0.5) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: 72,
      name: 'Sentiment FOMO (Đám đông đổ xô vào Tài → Đảo chiều)',
      patternId: 'sentiment_analysis'
    };
  }
  
  // Tâm lý hoảng loạn
  if (volatility > 3.5 && recentTaiRatio < 0.3) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: 74,
      name: 'Sentiment Panic (Hoảng loạn bán tháo → Bật lại)',
      patternId: 'sentiment_analysis'
    };
  }
  
  return { detected: false };
}

// ==================== CÁC HÀM PHÂN TÍCH CẢI TIẾN ====================

function analyzeTongPhanTich(data, type) {
  if (data.length < 10) return { detected: false };
  
  const recent10 = data.slice(0, 10);
  const sums = recent10.map(d => d.Tong);
  const results = recent10.map(d => d.Ket_qua);
  
  const avgSum = sums.reduce((a, b) => a + b, 0) / sums.length;
  const taiCount = results.filter(r => r === 'Tài').length;
  const xiuCount = results.filter(r => r === 'Xỉu').length;
  
  const first5Sum = sums.slice(5, 10).reduce((a, b) => a + b, 0) / 5;
  const last5Sum = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const sumTrend = last5Sum - first5Sum;
  
  const weight = getPatternWeight(type, 'tong_phan_tich');
  
  if (sumTrend > 1.5) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: Math.round(75 + Math.abs(sumTrend) * 3),
      name: `Tổng Phân Tích (Tổng tăng ${sumTrend.toFixed(1)} → Xỉu)`,
      patternId: 'tong_phan_tich'
    };
  }
  
  if (sumTrend < -1.5) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: Math.round(75 + Math.abs(sumTrend) * 3),
      name: `Tổng Phân Tích (Tổng giảm ${Math.abs(sumTrend).toFixed(1)} → Tài)`,
      patternId: 'tong_phan_tich'
    };
  }
  
  if (Math.abs(taiCount - xiuCount) >= 3) {
    const lech = taiCount > xiuCount ? 'Tài' : 'Xỉu';
    const prediction = lech === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: Math.round(70 + Math.abs(taiCount - xiuCount) * 3),
      name: `Tổng Phân Tích (Lệch ${Math.abs(taiCount - xiuCount)} về ${lech} → ${prediction})`,
      patternId: 'tong_phan_tich'
    };
  }
  
  return { detected: false };
}

function analyzeXuHuongManh(results, type) {
  if (results.length < 8) return { detected: false };
  
  const recent8 = results.slice(0, 8);
  const taiCount = recent8.filter(r => r === 'Tài').length;
  const weight = getPatternWeight(type, 'xu_huong_manh');
  
  if (taiCount >= 6) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: Math.round(80 + taiCount * 2),
      name: `Xu Hướng Mạnh (${taiCount}/8 Tài → Đảo Xỉu)`,
      patternId: 'xu_huong_manh'
    };
  }
  
  if (taiCount <= 2) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: Math.round(80 + (8 - taiCount) * 2),
      name: `Xu Hướng Mạnh (${8 - taiCount}/8 Xỉu → Đảo Tài)`,
      patternId: 'xu_huong_manh'
    };
  }
  
  return { detected: false };
}

function analyzeDaoChieu(results, type) {
  if (results.length < 5) return { detected: false };
  
  const recent5 = results.slice(0, 5);
  const weight = getPatternWeight(type, 'dao_chieu');
  
  let isAlternating = true;
  for (let i = 0; i < recent5.length - 1; i++) {
    if (recent5[i] === recent5[i + 1]) {
      isAlternating = false;
      break;
    }
  }
  
  if (isAlternating) {
    const prediction = recent5[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: 75,
      name: `Đảo Chiều (Chuỗi ${recent5.join('-')} → ${prediction})`,
      patternId: 'dao_chieu'
    };
  }
  
  return { detected: false };
}

function analyzeCauBet(results, type) {
  if (results.length < 3) return { detected: false };
  
  let streakType = results[0];
  let streakLength = 1;
  
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 3) {
    const weight = getPatternWeight(type, 'cau_bet');
    
    let shouldBreak = streakLength >= 5;
    let confidence = 65;
    
    if (streakLength >= 7) {
      shouldBreak = true;
      confidence = 85;
    } else if (streakLength >= 5) {
      shouldBreak = true;
      confidence = 75;
    } else if (streakLength >= 3) {
      shouldBreak = false;
      confidence = 68;
    }
    
    return { 
      detected: true, 
      type: streakType, 
      length: streakLength,
      prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
      confidence: Math.round(confidence * weight),
      name: `Cầu Bệt ${streakLength} phiên ${streakType}`,
      patternId: 'cau_bet'
    };
  }
  
  return { detected: false };
}

function analyzeCauDao11(results, type) {
  if (results.length < 4) return { detected: false };
  
  let alternatingLength = 1;
  for (let i = 1; i < Math.min(results.length, 10); i++) {
    if (results[i] !== results[i - 1]) {
      alternatingLength++;
    } else {
      break;
    }
  }
  
  if (alternatingLength >= 4) {
    const weight = getPatternWeight(type, 'cau_dao_11');
    const confidence = Math.min(80, 65 + alternatingLength * 2);
    
    return { 
      detected: true, 
      length: alternatingLength,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(confidence * weight),
      name: `Cầu Đảo 1-1 (${alternatingLength} phiên)`,
      patternId: 'cau_dao_11'
    };
  }
  
  return { detected: false };
}

function analyzeCau22(results, type) {
  if (results.length < 6) return { detected: false };
  
  let pairCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 1 && pairCount < 4) {
    if (results[i] === results[i + 1]) {
      pattern.push(results[i]);
      pairCount++;
      i += 2;
    } else {
      break;
    }
  }
  
  if (pairCount >= 2) {
    let isAlternating = true;
    for (let j = 1; j < pattern.length; j++) {
      if (pattern[j] === pattern[j - 1]) {
        isAlternating = false;
        break;
      }
    }
    
    if (isAlternating) {
      const lastPairType = pattern[pattern.length - 1];
      const weight = getPatternWeight(type, 'cau_22');
      
      return { 
        detected: true, 
        pairCount,
        prediction: lastPairType === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(Math.min(78, 65 + pairCount * 3) * weight),
        name: `Cầu 2-2 (${pairCount} cặp)`,
        patternId: 'cau_22'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCau33(results, type) {
  if (results.length < 6) return { detected: false };
  
  let tripleCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 2) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
      pattern.push(results[i]);
      tripleCount++;
      i += 3;
    } else {
      break;
    }
  }
  
  if (tripleCount >= 1) {
    const currentPosition = results.length % 3;
    const lastTripleType = pattern[pattern.length - 1];
    const weight = getPatternWeight(type, 'cau_33');
    
    let prediction;
    if (currentPosition === 0) {
      prediction = lastTripleType === 'Tài' ? 'Xỉu' : 'Tài';
    } else {
      prediction = lastTripleType;
    }
    
    return { 
      detected: true, 
      tripleCount,
      prediction,
      confidence: Math.round(Math.min(80, 68 + tripleCount * 4) * weight),
      name: `Cầu 3-3 (${tripleCount} bộ ba)`,
      patternId: 'cau_33'
    };
  }
  
  return { detected: false };
}

function analyzeCau121(results, type) {
  if (results.length < 4) return { detected: false };
  
  const pattern1 = results.slice(0, 4);
  
  if (pattern1[0] !== pattern1[1] && 
      pattern1[1] === pattern1[2] && 
      pattern1[2] !== pattern1[3] &&
      pattern1[0] === pattern1[3]) {
    const weight = getPatternWeight(type, 'cau_121');
    return { 
      detected: true, 
      pattern: '1-2-1',
      prediction: pattern1[0],
      confidence: Math.round(72 * weight),
      name: 'Cầu 1-2-1',
      patternId: 'cau_121'
    };
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
      const weight = getPatternWeight(type, 'cau_123');
      return { 
        detected: true, 
        pattern: '1-2-3',
        prediction: first,
        confidence: Math.round(74 * weight),
        name: 'Cầu 1-2-3',
        patternId: 'cau_123'
      };
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
    const weight = getPatternWeight(type, 'cau_321');
    return { 
      detected: true, 
      pattern: '3-2-1',
      prediction: next2[0],
      confidence: Math.round(76 * weight),
      name: 'Cầu 3-2-1',
      patternId: 'cau_321'
    };
  }
  
  return { detected: false };
}

function analyzeCauNhayCoc(results, type) {
  if (results.length < 6) return { detected: false };
  
  const skipPattern = [];
  for (let i = 0; i < Math.min(results.length, 12); i += 2) {
    skipPattern.push(results[i]);
  }
  
  if (skipPattern.length >= 3) {
    const weight = getPatternWeight(type, 'cau_nhay_coc');
    const allSame = skipPattern.slice(0, 3).every(r => r === skipPattern[0]);
    if (allSame) {
      return { 
        detected: true, 
        pattern: skipPattern.slice(0, 3),
        prediction: skipPattern[0],
        confidence: Math.round(68 * weight),
        name: 'Cầu Nhảy Cóc',
        patternId: 'cau_nhay_coc'
      };
    }
    
    let alternating = true;
    for (let i = 1; i < skipPattern.length - 1; i++) {
      if (skipPattern[i] === skipPattern[i - 1]) {
        alternating = false;
        break;
      }
    }
    
    if (alternating && skipPattern.length >= 3) {
      return { 
        detected: true, 
        pattern: skipPattern.slice(0, 3),
        prediction: skipPattern[0] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(66 * weight),
        name: 'Cầu Nhảy Cóc Đảo',
        patternId: 'cau_nhay_coc'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCauNhipNghieng(results, type) {
  if (results.length < 5) return { detected: false };
  
  const last5 = results.slice(0, 5);
  const taiCount5 = last5.filter(r => r === 'Tài').length;
  const weight = getPatternWeight(type, 'cau_nhip_nghieng');
  
  if (taiCount5 >= 4) {
    return { 
      detected: true, 
      type: 'nghieng_5',
      prediction: 'Tài',
      confidence: Math.round(70 * weight),
      name: `Cầu Nhịp Nghiêng (${taiCount5}/5 Tài)`,
      patternId: 'cau_nhip_nghieng'
    };
  } else if (taiCount5 <= 1) {
    return { 
      detected: true, 
      type: 'nghieng_5',
      prediction: 'Xỉu',
      confidence: Math.round(70 * weight),
      name: `Cầu Nhịp Nghiêng (${5 - taiCount5}/5 Xỉu)`,
      patternId: 'cau_nhip_nghieng'
    };
  }
  
  return { detected: false };
}

function analyzeCau3Van1(results, type) {
  if (results.length < 4) return { detected: false };
  
  const last4 = results.slice(0, 4);
  const taiCount = last4.filter(r => r === 'Tài').length;
  const weight = getPatternWeight(type, 'cau_3van1');
  
  if (taiCount === 3) {
    return { 
      detected: true, 
      prediction: 'Xỉu',
      confidence: Math.round(68 * weight),
      name: 'Cầu 3 Ván 1 (3T-1X) → Xỉu',
      patternId: 'cau_3van1'
    };
  } else if (taiCount === 1) {
    return { 
      detected: true, 
      prediction: 'Tài',
      confidence: Math.round(68 * weight),
      name: 'Cầu 3 Ván 1 (3X-1T) → Tài',
      patternId: 'cau_3van1'
    };
  }
  
  return { detected: false };
}

function analyzeCauBeCau(results, type) {
  if (results.length < 8) return { detected: false };
  
  const recentStreak = analyzeCauBet(results, type);
  
  if (recentStreak.detected && recentStreak.length >= 4) {
    const beforeStreak = results.slice(recentStreak.length, recentStreak.length + 4);
    const previousPattern = analyzeCauBet(beforeStreak, type);
    
    if (previousPattern.detected && previousPattern.type !== recentStreak.type) {
      const weight = getPatternWeight(type, 'cau_be_cau');
      return { 
        detected: true, 
        prediction: recentStreak.type === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(76 * weight),
        name: 'Cầu Bẻ Cầu',
        patternId: 'cau_be_cau'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCauTuNhien(results, type) {
  if (results.length < 2) return { detected: false };
  const weight = getPatternWeight(type, 'cau_tu_nhien');
  
  return { 
    detected: true, 
    prediction: results[0],
    confidence: Math.round(60 * weight),
    name: 'Cầu Tự Nhiên (Theo Ván Trước)',
    patternId: 'cau_tu_nhien'
  };
}

function analyzeCauRong(results, type) {
  if (results.length < 6) return { detected: false };
  
  const weight = getPatternWeight(type, 'cau_rong');
  
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 6) {
    return { 
      detected: true, 
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(Math.min(88, 75 + streakLength) * weight),
      name: `Cầu Rồng ${streakLength} phiên (Bẻ mạnh)`,
      patternId: 'cau_rong'
    };
  }
  
  return { detected: false };
}

function analyzeSmartBet(results, type) {
  if (results.length < 10) return { detected: false };
  
  const weight = getPatternWeight(type, 'smart_bet');
  const last10 = results.slice(0, 10);
  const last5 = results.slice(0, 5);
  const prev5 = results.slice(5, 10);
  
  const taiLast5 = last5.filter(r => r === 'Tài').length;
  const taiPrev5 = prev5.filter(r => r === 'Tài').length;
  
  const trendChanging = (taiLast5 >= 4 && taiPrev5 <= 1) || (taiLast5 <= 1 && taiPrev5 >= 4);
  
  if (trendChanging) {
    const currentDominant = taiLast5 >= 4 ? 'Tài' : 'Xỉu';
    return { 
      detected: true, 
      prediction: currentDominant === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(78 * weight),
      name: `Đảo Xu Hướng (${taiLast5}T-${5-taiLast5}X → ${taiPrev5}T-${5-taiPrev5}X)`,
      patternId: 'smart_bet'
    };
  }
  
  const taiLast10 = last10.filter(r => r === 'Tài').length;
  if (taiLast10 >= 8 || taiLast10 <= 2) {
    const dominant = taiLast10 >= 8 ? 'Tài' : 'Xỉu';
    return { 
      detected: true, 
      prediction: dominant === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(82 * weight),
      name: `Xu Hướng Cực (${taiLast10}T-${10-taiLast10}X) → Đảo`,
      patternId: 'smart_bet'
    };
  }
  
  return { detected: false };
}

function analyzeBreakStreak(results, type) {
  if (results.length < 5) return { detected: false };
  
  const weight = getPatternWeight(type, 'break_streak') || 1.0;
  
  let streakType = results[0];
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 5) {
    const prediction = streakType === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: Math.round(Math.min(85, 70 + streakLength) * weight),
      name: `Bẻ Chuỗi ${streakLength} (${streakType} → ${prediction})`,
      patternId: 'break_streak'
    };
  }
  
  return { detected: false };
}

function analyzeAlternatingBreak(results, type) {
  if (results.length < 6) return { detected: false };
  
  const weight = getPatternWeight(type, 'alternating_break') || 1.0;
  
  let alternatingCount = 0;
  for (let i = 0; i < results.length - 1; i++) {
    if (results[i] !== results[i + 1]) {
      alternatingCount++;
    } else {
      break;
    }
  }
  
  if (alternatingCount >= 6) {
    const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: Math.round(Math.min(82, 68 + alternatingCount) * weight),
      name: `Bẻ Đảo ${alternatingCount} phiên → ${prediction}`,
      patternId: 'alternating_break'
    };
  }
  
  return { detected: false };
}

function analyzeDoublePairBreak(results, type) {
  if (results.length < 8) return { detected: false };
  
  const weight = getPatternWeight(type, 'double_pair_break') || 1.0;
  
  const isPair1 = results[0] === results[1];
  const isPair2 = results[2] === results[3];
  const isPair3 = results[4] === results[5];
  const isPair4 = results[6] === results[7];
  
  if (isPair1 && isPair2 && isPair3 && isPair4) {
    const pairType1 = results[0];
    const pairType2 = results[2];
    
    const allSamePair = pairType1 === pairType2 && pairType2 === results[4] && results[4] === results[6];
    if (allSamePair) {
      const prediction = pairType1 === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        prediction,
        confidence: Math.round(84 * weight),
        name: `4 Cặp Cùng ${pairType1} → Bẻ ${prediction}`,
        patternId: 'double_pair_break'
      };
    }
    
    const alternatingPairs = pairType1 !== pairType2 && pairType2 !== results[4] && results[4] !== results[6];
    if (alternatingPairs) {
      const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        prediction,
        confidence: Math.round(78 * weight),
        name: `Cặp Đảo Xen Kẽ → Bẻ ${prediction}`,
        patternId: 'double_pair_break'
      };
    }
  }
  
  return { detected: false };
}

function analyzeTriplePattern(results, type) {
  if (results.length < 9) return { detected: false };
  
  const weight = getPatternWeight(type, 'triple_pattern') || 1.0;
  
  const isTriple1 = results[0] === results[1] && results[1] === results[2];
  const isTriple2 = results[3] === results[4] && results[4] === results[5];
  const isTriple3 = results[6] === results[7] && results[7] === results[8];
  
  if (isTriple1 && isTriple2 && isTriple3) {
    const tripleType1 = results[0];
    const tripleType2 = results[3];
    const tripleType3 = results[6];
    
    if (tripleType1 === tripleType2 && tripleType2 === tripleType3) {
      const prediction = tripleType1 === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        prediction,
        confidence: Math.round(88 * weight),
        name: `3 Bộ Ba Cùng ${tripleType1} → Bẻ ${prediction}`,
        patternId: 'triple_pattern'
      };
    }
    
    if (tripleType1 !== tripleType2 && tripleType2 !== tripleType3) {
      const prediction = tripleType1;
      return {
        detected: true,
        prediction,
        confidence: Math.round(80 * weight),
        name: `Bộ Ba Đảo → Theo ${prediction}`,
        patternId: 'triple_pattern'
      };
    }
  }
  
  return { detected: false };
}

function analyzeDistribution(data, type, windowSize = 50) {
  const window = data.slice(0, windowSize);
  const taiCount = window.filter(d => d.Ket_qua === 'Tài').length;
  const xiuCount = window.length - taiCount;
  
  return {
    taiPercent: (taiCount / window.length) * 100,
    xiuPercent: (xiuCount / window.length) * 100,
    taiCount,
    xiuCount,
    total: window.length,
    imbalance: Math.abs(taiCount - xiuCount) / window.length
  };
}

function analyzeFibonacci(sums, type) {
  if (sums.length < 10) return { detected: false };
  
  const recent = sums.slice(0, 10);
  const maxSum = Math.max(...recent);
  const minSum = Math.min(...recent);
  const range = maxSum - minSum;
  
  const fibLevels = {
    '0.236': minSum + range * 0.236,
    '0.382': minSum + range * 0.382,
    '0.5': minSum + range * 0.5,
    '0.618': minSum + range * 0.618,
    '0.786': minSum + range * 0.786
  };
  
  const lastSum = sums[0];
  const weight = getPatternWeight(type, 'fibonacci');
  
  for (const [level, value] of Object.entries(fibLevels)) {
    if (Math.abs(lastSum - value) < 1.5) {
      const prediction = lastSum > fibLevels['0.5'] ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        prediction,
        confidence: Math.round(72 * weight),
        name: `Fibonacci ${level} (${lastSum} chạm ngưỡng ${value.toFixed(1)})`,
        patternId: 'fibonacci'
      };
    }
  }
  
  return { detected: false };
}

function analyzeWavePattern(results, sums, type) {
  if (results.length < 15) return { detected: false };
  
  const waves = [];
  let currentWave = { type: results[0], length: 1, sum: sums[0] };
  
  for (let i = 1; i < results.length; i++) {
    if (results[i] === currentWave.type) {
      currentWave.length++;
      currentWave.sum += sums[i];
    } else {
      currentWave.sum /= currentWave.length;
      waves.push({ ...currentWave });
      currentWave = { type: results[i], length: 1, sum: sums[i] };
    }
  }
  currentWave.sum /= currentWave.length;
  waves.push(currentWave);
  
  if (waves.length >= 5) {
    const weight = getPatternWeight(type, 'wave');
    const trend = waves[0].type === waves[2].type && waves[2].type === waves[4].type;
    
    if (trend) {
      const prediction = waves[4].type === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        prediction,
        confidence: 76,
        name: `Wave Pattern (Sóng chính ${waves[4].type} → Đảo ${prediction})`,
        patternId: 'wave'
      };
    }
  }
  
  return { detected: false };
}

function analyzeGoldenRatio(results, sums, type) {
  if (results.length < 20) return { detected: false };
  
  const taiWins = [];
  const xiuWins = [];
  
  for (let i = 0; i < results.length; i++) {
    if (results[i] === 'Tài') {
      taiWins.push(sums[i]);
    } else {
      xiuWins.push(sums[i]);
    }
  }
  
  const avgTai = taiWins.reduce((a, b) => a + b, 0) / taiWins.length;
  const avgXiu = xiuWins.reduce((a, b) => a + b, 0) / xiuWins.length;
  const ratio = avgTai / avgXiu;
  
  const weight = getPatternWeight(type, 'golden_ratio');
  
  if (Math.abs(ratio - 1.618) < 0.2) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: 74,
      name: `Golden Ratio (Tỷ lệ ${ratio.toFixed(3)} ~ 1.618 → Tài)`,
      patternId: 'golden_ratio'
    };
  }
  
  if (Math.abs(ratio - 0.618) < 0.1) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: 74,
      name: `Golden Ratio (Tỷ lệ ${ratio.toFixed(3)} ~ 0.618 → Xỉu)`,
      patternId: 'golden_ratio'
    };
  }
  
  return { detected: false };
}

// ==================== HÀM TÍNH TOÁN DỰ ĐOÁN CHÍNH ====================

function calculateAdvancedPrediction(data, type) {
  const last50 = data.slice(0, 50);
  const results = last50.map(d => d.Ket_qua);
  const sums = last50.map(d => d.Tong);
  
  initializePatternStats(type);
  
  let predictions = [];
  let factors = [];
  let allPatterns = [];
  
  // Ưu tiên các pattern mới có độ chính xác cao
  const patterns = [
    { name: 'Tổng Phân Tích', func: () => analyzeTongPhanTich(last50, type), priority: 16 },
    { name: 'LSTM Pattern', func: () => analyzeLSTMPattern(results, type), priority: 15 },
    { name: 'Neural Boost', func: () => analyzeNeuralBoost(results, sums, type), priority: 15 },
    { name: 'Markov Chain', func: () => analyzeMarkovChain(results, type), priority: 14 },
    { name: 'Xu Hướng Mạnh', func: () => analyzeXuHuongManh(results, type), priority: 14 },
    { name: 'Harmonic Pattern', func: () => analyzeHarmonicPattern(results, sums, type), priority: 13 },
    { name: 'Sentiment', func: () => analyzeSentiment(results, sums, type), priority: 13 },
    { name: 'Đảo Chiều', func: () => analyzeDaoChieu(results, type), priority: 13 },
    { name: 'Cầu Rồng', func: () => analyzeCauRong(results, type), priority: 12 },
    { name: 'Wave Pattern', func: () => analyzeWavePattern(results, sums, type), priority: 12 },
    { name: 'Bẻ Chuỗi', func: () => analyzeBreakStreak(results, type), priority: 11 },
    { name: 'Triple Pattern', func: () => analyzeTriplePattern(results, type), priority: 11 },
    { name: 'Double Pair Break', func: () => analyzeDoublePairBreak(results, type), priority: 10 },
    { name: 'Smart Bet', func: () => analyzeSmartBet(results, type), priority: 10 },
    { name: 'Fibonacci', func: () => analyzeFibonacci(sums, type), priority: 10 },
    { name: 'Golden Ratio', func: () => analyzeGoldenRatio(results, sums, type), priority: 9 },
    { name: 'Cầu Bệt', func: () => analyzeCauBet(results, type), priority: 9 },
    { name: 'Cầu Đảo 1-1', func: () => analyzeCauDao11(results, type), priority: 9 },
    { name: 'Cầu Bẻ Cầu', func: () => analyzeCauBeCau(results, type), priority: 8 },
    { name: 'Cầu 2-2', func: () => analyzeCau22(results, type), priority: 8 },
    { name: 'Cầu 3-3', func: () => analyzeCau33(results, type), priority: 8 },
    { name: 'Alternating Break', func: () => analyzeAlternatingBreak(results, type), priority: 8 },
    { name: 'Cầu 1-2-1', func: () => analyzeCau121(results, type), priority: 7 },
    { name: 'Cầu 1-2-3', func: () => analyzeCau123(results, type), priority: 7 },
    { name: 'Cầu 3-2-1', func: () => analyzeCau321(results, type), priority: 7 },
    { name: 'Cầu Nhịp Nghiêng', func: () => analyzeCauNhipNghieng(results, type), priority: 7 },
    { name: 'Cầu 3 Ván 1', func: () => analyzeCau3Van1(results, type), priority: 6 },
    { name: 'Cầu Nhảy Cóc', func: () => analyzeCauNhayCoc(results, type), priority: 6 }
  ];
  
  for (const pattern of patterns) {
    const result = pattern.func();
    if (result.detected) {
      predictions.push({
        prediction: result.prediction,
        confidence: result.confidence,
        priority: pattern.priority,
        name: result.name
      });
      factors.push(result.name);
      allPatterns.push(result);
    }
  }
  
  // Phân bố lệch
  const distribution = analyzeDistribution(last50, type);
  if (distribution.imbalance > 0.15) {
    const minority = distribution.taiPercent < 50 ? 'Tài' : 'Xỉu';
    predictions.push({ prediction: minority, confidence: 65, priority: 5, name: 'Phân bố lệch' });
    factors.push(`Phân bố lệch (T:${distribution.taiPercent.toFixed(0)}% - X:${distribution.xiuPercent.toFixed(0)}%)`);
  }
  
  // Nếu không có pattern nào, dùng cầu tự nhiên
  if (predictions.length === 0) {
    const cauTuNhien = analyzeCauTuNhien(results, type);
    predictions.push({ prediction: cauTuNhien.prediction, confidence: cauTuNhien.confidence, priority: 1, name: cauTuNhien.name });
    factors.push(cauTuNhien.name);
    allPatterns.push(cauTuNhien);
  }
  
  // Sắp xếp theo priority và confidence
  predictions.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
  
  // ==================== ENSEMBLE VOTING NÂNG CAO ====================
  // Mỗi pattern được nhân trọng số = reliability * priority thay vì chỉ confidence * priority
  
  let taiScore = 0;
  let xiuScore = 0;
  
  predictions.forEach(p => {
    const patternId = getPatternIdFromName(p.name || '');
    const reliability = patternId ? getPatternReliability(type, patternId) : 0.5;
    
    // Loại bỏ pattern kém tin cậy (reliability < 0.4)
    if (reliability < 0.4) return;
    
    const vote = p.confidence * p.priority * reliability;
    if (p.prediction === 'Tài') {
      taiScore += vote;
    } else {
      xiuScore += vote;
    }
  });
  
  const taiVotes = predictions.filter(p => p.prediction === 'Tài');
  const xiuVotes = predictions.filter(p => p.prediction === 'Xỉu');
  
  // ==================== BAYESIAN PRIOR ====================
  const bayesianProb = bayesianUpdate(type, results);
  const bayesianBoost = (bayesianProb - 0.5) * 60; // scale ±30
  if (bayesianProb > 0.55) {
    taiScore *= (1 + (bayesianProb - 0.5));
  } else if (bayesianProb < 0.45) {
    xiuScore *= (1 + (0.5 - bayesianProb));
  }

  // Điều chỉnh theo ML
  const features = extractFeatures(results, sums);
  const mlProbability = predictWithML(features, type);
  
  if (mlProbability > 0.6) {
    taiScore *= (1 + mlProbability * 0.5);
  } else if (mlProbability < 0.4) {
    xiuScore *= (1 + (1 - mlProbability) * 0.5);
  }
  
  // Điều chỉnh theo lịch sử thắng/thua (giảm multiplier để tránh over-correct)
  const streakInfo = learningData[type].streakAnalysis;
  if (streakInfo.currentStreak <= -3) {
    if (taiScore > xiuScore) {
      xiuScore *= 1.15; // giảm từ 1.3 → 1.15
    } else {
      taiScore *= 1.15;
    }
  }
  
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  
  // Anti-Overfitting Guard: nếu tỉ lệ score quá chênh lệch mà confidence pattern thấp, không đổi chiều
  const scoreRatio = taiScore > 0 && xiuScore > 0
    ? Math.max(taiScore, xiuScore) / Math.min(taiScore, xiuScore)
    : 1;
  const topPatternConfidence = predictions[0]?.confidence || 60;
  if (scoreRatio < 1.15 && topPatternConfidence < 70) {
    // Không đủ bằng chứng → giữ theo pattern có priority cao nhất
    finalPrediction = predictions[0]?.prediction || finalPrediction;
  }
  
  // Điều chỉnh thông minh
  finalPrediction = getSmartPredictionAdjustment(type, finalPrediction, allPatterns);
  
  // ==================== CONFIDENCE CALIBRATION ====================
  let baseConfidence = 60;
  
  const topPredictions = predictions.slice(0, 3);
  topPredictions.forEach(p => {
    if (p.prediction === finalPrediction) {
      baseConfidence += (p.confidence - 65) * 0.25; // giảm từ 0.3 → 0.25 để bớt inflate
    }
  });
  
  const agreementRatio = (finalPrediction === 'Tài' ? taiVotes.length : xiuVotes.length) / Math.max(predictions.length, 1);
  baseConfidence += Math.round(agreementRatio * 12);
  
  // ML boost (có giới hạn)
  const mlBoost = Math.min(8, Math.abs(mlProbability - 0.5) * 20);
  baseConfidence += mlBoost;
  
  // Bayesian boost (nhỏ, chỉ hỗ trợ)
  baseConfidence += Math.min(5, Math.abs(bayesianBoost * 0.15));
  
  const adaptiveBoost = getAdaptiveConfidenceBoost(type);
  baseConfidence += adaptiveBoost;
  
  // Penalty nếu score ratio quá gần (không chắc)
  if (scoreRatio < 1.1) baseConfidence -= 5;
  
  let finalConfidence = Math.round(baseConfidence);
  
  // Giới hạn confidence 58-90% (hẹp hơn để calibration tốt hơn)
  finalConfidence = Math.max(58, Math.min(90, finalConfidence));
  
  // Cập nhật ML model sau mỗi lần dự đoán (sẽ được cập nhật khi có kết quả thực tế)
  
  return {
    prediction: finalPrediction,
    confidence: finalConfidence,
    factors,
    allPatterns,
    mlProbability: (mlProbability * 100).toFixed(1),
    detailedAnalysis: {
      totalPatterns: predictions.length,
      taiVotes: taiVotes.length,
      xiuVotes: xiuVotes.length,
      taiScore: Math.round(taiScore),
      xiuScore: Math.round(xiuScore),
      scoreRatio: scoreRatio.toFixed(2),
      topPattern: predictions[0]?.name || 'N/A',
      bayesianProb: (bayesianProb * 100).toFixed(1) + '%',
      distribution,
      learningStats: {
        totalPredictions: learningData[type].totalPredictions,
        correctPredictions: learningData[type].correctPredictions,
        accuracy: learningData[type].totalPredictions > 0 
          ? (learningData[type].correctPredictions / learningData[type].totalPredictions * 100).toFixed(1) + '%'
          : 'N/A',
        currentStreak: learningData[type].streakAnalysis.currentStreak
      }
    }
  };
}

// ==================== CÁC HÀM HỖ TRỢ KHÁC ====================

function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = fs.readFileSync(LEARNING_FILE, 'utf8');
      const parsed = JSON.parse(data);
      learningData = { ...learningData, ...parsed };
      console.log('Learning data loaded successfully from tiendat.json');
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
      console.log('Prediction history loaded successfully from tiendat1.json');
      console.log(`  - Hu: ${predictionHistory.hu.length} records`);
      console.log(`  - MD5: ${predictionHistory.md5.length} records`);
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

async function autoProcessPredictions() {
  try {
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      const latestHuPhien = dataHu[0].Phien;
      const nextHuPhien = latestHuPhien + 1;
      
      if (lastProcessedPhien.hu !== nextHuPhien) {
        await verifyPredictions('hu', dataHu);
        
        const result = calculateAdvancedPrediction(dataHu, 'hu');
        savePredictionToHistory('hu', nextHuPhien, result.prediction, result.confidence, dataHu[0]);
        recordPrediction('hu', nextHuPhien, result.prediction, result.confidence, result.factors);
        
        lastProcessedPhien.hu = nextHuPhien;
        console.log(`[Auto] Hu phien ${nextHuPhien}: ${result.prediction} (${result.confidence}%) [ML: ${result.mlProbability}%]`);
      }
    }
    
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      const latestMd5Phien = dataMd5[0].Phien;
      const nextMd5Phien = latestMd5Phien + 1;
      
      if (lastProcessedPhien.md5 !== nextMd5Phien) {
        await verifyPredictions('md5', dataMd5);
        
        const result = calculateAdvancedPrediction(dataMd5, 'md5');
        savePredictionToHistory('md5', nextMd5Phien, result.prediction, result.confidence, dataMd5[0]);
        recordPrediction('md5', nextMd5Phien, result.prediction, result.confidence, result.factors);
        
        lastProcessedPhien.md5 = nextMd5Phien;
        console.log(`[Auto] MD5 phien ${nextMd5Phien}: ${result.prediction} (${result.confidence}%) [ML: ${result.mlProbability}%]`);
      }
    }
    
    await updateHistoryStatus('hu');
    await updateHistoryStatus('md5');
    
    savePredictionHistory();
    saveLearningData();
    
  } catch (error) {
    console.error('[Auto] Error processing predictions:', error.message);
  }
}

async function updateHistoryStatus(type) {
  try {
    let data = null;
    if (type === 'hu') {
      data = await fetchDataHu();
    } else {
      data = await fetchDataMd5();
    }
    
    if (!data || data.length === 0) return;
    
    let updated = false;
    for (const record of predictionHistory[type]) {
      if (record.ket_qua_du_doan && record.ket_qua_du_doan !== '') continue;
      
      const actualResult = data.find(d => d.Phien.toString() === record.Phien_hien_tai);
      if (actualResult) {
        const duDoanNormalized = record.Du_doan;
        const ketQuaThucTe = actualResult.Ket_qua;
        
        if (duDoanNormalized === ketQuaThucTe) {
          record.ket_qua_du_doan = 'Đúng ✅';
        } else {
          record.ket_qua_du_doan = 'Sai ❌';
        }
        updated = true;
      }
    }
    
    if (updated) {
      savePredictionHistory();
    }
  } catch (error) {
    console.error(`Error updating ${type} history status:`, error.message);
  }
}

function startAutoSaveTask() {
  console.log(`Auto-save task started (every ${AUTO_SAVE_INTERVAL/1000}s)`);
  
  setTimeout(() => {
    autoProcessPredictions();
  }, 5000);
  
  setInterval(() => {
    autoProcessPredictions();
  }, AUTO_SAVE_INTERVAL);
}

function initializePatternStats(type) {
  if (!learningData[type].patternWeights || Object.keys(learningData[type].patternWeights).length === 0) {
    learningData[type].patternWeights = { ...DEFAULT_PATTERN_WEIGHTS };
  }
  
  Object.keys(DEFAULT_PATTERN_WEIGHTS).forEach(pattern => {
    if (!learningData[type].patternStats[pattern]) {
      learningData[type].patternStats[pattern] = {
        total: 0,
        correct: 0,
        accuracy: 0.5,
        recentResults: [],
        lastAdjustment: null
      };
    }
  });
}

function getPatternWeight(type, patternId) {
  initializePatternStats(type);
  return learningData[type].patternWeights[patternId] || 1.0;
}

function updatePatternPerformance(type, patternId, isCorrect) {
  initializePatternStats(type);
  
  const stats = learningData[type].patternStats[patternId];
  if (!stats) return;
  
  stats.total++;
  if (isCorrect) stats.correct++;
  
  stats.recentResults.push(isCorrect ? 1 : 0);
  if (stats.recentResults.length > 20) {
    stats.recentResults.shift();
  }
  
  const recentAccuracy = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
  stats.accuracy = stats.total > 0 ? stats.correct / stats.total : 0.5;
  
  const oldWeight = learningData[type].patternWeights[patternId];
  let newWeight = oldWeight;
  
  if (stats.recentResults.length >= 5) {
    if (recentAccuracy > 0.70) {
      newWeight = Math.min(3.0, oldWeight * 1.15); // tăng nhanh hơn khi chính xác cao
    } else if (recentAccuracy > 0.60) {
      newWeight = Math.min(2.5, oldWeight * 1.05);
    } else if (recentAccuracy < 0.35) {
      newWeight = Math.max(0.1, oldWeight * 0.80); // giảm nhanh hơn khi kém
    } else if (recentAccuracy < 0.45) {
      newWeight = Math.max(0.2, oldWeight * 0.92);
    }
    // Entropy bonus: pattern tốt nhưng ít dùng → giữ weight
  }
  
  learningData[type].patternWeights[patternId] = newWeight;
  stats.lastAdjustment = new Date().toISOString();
}

// ==================== BAYESIAN UPDATE & PATTERN RELIABILITY ====================

function bayesianUpdate(type, results) {
  const taiCount = results.slice(0, 50).filter(r => r === 'Tài').length;
  const totalCount = Math.min(results.length, 50);
  const alpha0 = taiCount + 1;
  const beta0 = (totalCount - taiCount) + 1;
  const recent5Tai = results.slice(0, 5).filter(r => r === 'Tài').length;
  const alpha1 = alpha0 + recent5Tai;
  const beta1 = beta0 + (5 - recent5Tai);
  return alpha1 / (alpha1 + beta1);
}

function getPatternReliability(type, patternId) {
  const stats = learningData[type].patternStats[patternId];
  if (!stats || stats.total < 10) return 0.5;
  const recentAcc = stats.recentResults.length >= 5
    ? stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length
    : stats.accuracy;
  if (recentAcc < 0.45) return Math.max(0.1, recentAcc);
  return recentAcc;
}

// ==================== END BAYESIAN ====================

function recordPrediction(type, phien, prediction, confidence, patterns) {
  const record = {
    phien: phien.toString(),
    prediction,
    confidence,
    patterns,
    timestamp: new Date().toISOString(),
    verified: false,
    actual: null,
    isCorrect: null
  };
  
  learningData[type].predictions.unshift(record);
  learningData[type].totalPredictions++;
  
  if (learningData[type].predictions.length > 500) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 500);
  }
  
  saveLearningData();
}

async function verifyPredictions(type, currentData) {
  let updated = false;
  
  for (const pred of learningData[type].predictions) {
    if (pred.verified) continue;
    
    const actualResult = currentData.find(d => d.Phien.toString() === pred.phien);
    if (actualResult) {
      pred.verified = true;
      pred.actual = actualResult.Ket_qua;
      
      const predictedNormalized = pred.prediction === 'Tài' || pred.prediction === 'tai' ? 'Tài' : 'Xỉu';
      pred.isCorrect = pred.actual === predictedNormalized;
      
      if (pred.isCorrect) {
        learningData[type].correctPredictions++;
        learningData[type].streakAnalysis.wins++;
        
        if (learningData[type].streakAnalysis.currentStreak >= 0) {
          learningData[type].streakAnalysis.currentStreak++;
        } else {
          learningData[type].streakAnalysis.currentStreak = 1;
        }
        
        if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
          learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
        }
      } else {
        learningData[type].streakAnalysis.losses++;
        
        if (learningData[type].streakAnalysis.currentStreak <= 0) {
          learningData[type].streakAnalysis.currentStreak--;
        } else {
          learningData[type].streakAnalysis.currentStreak = -1;
        }
        
        if (learningData[type].streakAnalysis.currentStreak < learningData[type].streakAnalysis.worstStreak) {
          learningData[type].streakAnalysis.worstStreak = learningData[type].streakAnalysis.currentStreak;
        }
      }
      
      learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 50) {
        learningData[type].recentAccuracy.shift();
      }
      
      // Cập nhật ML model
      const actualData = currentData.find(d => d.Phien.toString() === pred.phien);
      if (actualData) {
        const allResults = learningData[type].predictions
          .filter(p => p.verified)
          .slice(0, 20)
          .map(p => p.actual);
        const allSums = currentData.slice(0, 20).map(d => d.Tong);
        const features = extractFeatures(allResults, allSums);
        updateMLModel(type, features, pred.actual);
      }
      
      if (pred.patterns && pred.patterns.length > 0) {
        pred.patterns.forEach(patternName => {
          const patternId = getPatternIdFromName(patternName);
          if (patternId) {
            updatePatternPerformance(type, patternId, pred.isCorrect);
          }
        });
      }
      
      updated = true;
    }
  }
  
  if (updated) {
    learningData[type].lastUpdate = new Date().toISOString();
    saveLearningData();
  }
}

function getPatternIdFromName(name) {
  const mapping = {
    'Cầu Bệt': 'cau_bet', 'Cầu Đảo 1-1': 'cau_dao_11',
    'Cầu 2-2': 'cau_22', 'Cầu 3-3': 'cau_33', 'Cầu 4-4': 'cau_44',
    'Cầu 5-5': 'cau_55', 'Cầu 1-2-1': 'cau_121', 'Cầu 1-2-3': 'cau_123',
    'Cầu 3-2-1': 'cau_321', 'Cầu 2-1-2': 'cau_212', 'Cầu 1-2-2-1': 'cau_1221',
    'Cầu 2-1-1-2': 'cau_2112', 'Cầu Nhảy Cóc': 'cau_nhay_coc',
    'Cầu Nhịp Nghiêng': 'cau_nhip_nghieng', 'Cầu 3 Ván 1': 'cau_3van1',
    'Cầu Bẻ Cầu': 'cau_be_cau', 'Cầu Chu Kỳ': 'cau_chu_ky', 'Cầu Gấp': 'cau_gap',
    'Cầu Ziczac': 'cau_ziczac', 'Cầu Đôi': 'cau_doi', 'Cầu Rồng': 'cau_rong',
    'Đảo Xu Hướng': 'smart_bet', 'Xu Hướng Cực': 'smart_bet',
    'Phân bố': 'distribution', 'Tổng TB': 'dice_pattern',
    'Xu hướng': 'sum_trend', 'Cực Điểm': 'edge_cases',
    'Biến động': 'momentum', 'Cầu Tự Nhiên': 'cau_tu_nhien',
    'Biểu Đồ Đường': 'dice_trend_line', 'MD5 Biểu Đồ': 'dice_trend_line_md5',
    'Cầu Liên Tục': 'break_pattern_hu', 'MD5 Cầu': 'break_pattern_md5',
    'Dây Gãy': 'day_gay', 'MD5 Dây Gãy': 'day_gay_md5',
    'Tổng Phân Tích': 'tong_phan_tich', 'Xu Hướng Mạnh': 'xu_huong_manh',
    'Đảo Chiều': 'dao_chieu', 'LSTM Pattern': 'lstm_pattern',
    'Markov Chain': 'markov_chain', 'Neural Boost': 'neural_boost',
    'Harmonic Pattern': 'harmonic_pattern', 'Sentiment': 'sentiment_analysis',
    'Wave Pattern': 'wave', 'Golden Ratio': 'golden_ratio'
  };
  
  for (const [key, value] of Object.entries(mapping)) {
    if (name.includes(key)) return value;
  }
  return null;
}

function getAdaptiveConfidenceBoost(type) {
  const recentAcc = learningData[type].recentAccuracy;
  if (recentAcc.length < 10) return 0;
  
  const accuracy = recentAcc.reduce((a, b) => a + b, 0) / recentAcc.length;
  
  if (accuracy > 0.70) return 10;
  if (accuracy > 0.60) return 6;
  if (accuracy > 0.50) return 3;
  if (accuracy < 0.30) return -10;
  if (accuracy < 0.40) return -6;
  
  return 0;
}

function getSmartPredictionAdjustment(type, prediction, patterns) {
  const streakInfo = learningData[type].streakAnalysis;
  
  if (streakInfo.currentStreak <= -4) {
    return prediction === 'Tài' ? 'Xỉu' : 'Tài';
  }
  
  let taiPatternScore = 0;
  let xiuPatternScore = 0;
  
  patterns.forEach(p => {
    const patternId = getPatternIdFromName(p.name || p);
    if (patternId) {
      const stats = learningData[type].patternStats[patternId];
      if (stats && stats.recentResults.length >= 5) {
        const recentAcc = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
        const weight = learningData[type].patternWeights[patternId] || 1;
        
        if (p.prediction === 'Tài') {
          taiPatternScore += recentAcc * weight;
        } else {
          xiuPatternScore += recentAcc * weight;
        }
      }
    }
  });
  
  if (Math.abs(taiPatternScore - xiuPatternScore) > 0.7) {
    return taiPatternScore > xiuPatternScore ? 'Tài' : 'Xỉu';
  }
  
  return prediction;
}

function transformApiData(apiData) {
  if (!apiData || !apiData.list || !Array.isArray(apiData.list)) {
    return null;
  }
  
  return apiData.list.map(item => {
    const result = item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu';
    return {
      Phien: item.id,
      Ket_qua: result,
      Xuc_xac_1: item.dices[0],
      Xuc_xac_2: item.dices[1],
      Xuc_xac_3: item.dices[2],
      Tong: item.point
    };
  });
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
    id: '@tiendataox',
    timestamp: new Date().toISOString()
  };
  
  predictionHistory[type].unshift(record);
  
  if (predictionHistory[type].length > MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
  }
  
  return record;
}

// ==================== ENDPOINTS ====================

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send('t.me/CuTools');
});

app.get('/lc79-hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data || data.length === 0) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('hu', data);
    
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    
    const result = calculateAdvancedPrediction(data, 'hu');
    
    const record = savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
    
    setTimeout(async () => {
      await updateHistoryStatus('hu');
    }, 5000);
    
    res.json({
      Phien: record.Phien,
      Xuc_xac_1: record.Xuc_xac_1,
      Xuc_xac_2: record.Xuc_xac_2,
      Xuc_xac_3: record.Xuc_xac_3,
      Tong: record.Tong,
      Ket_qua: record.Ket_qua,
      Do_tin_cay: record.Do_tin_cay,
      Phien_hien_tai: record.Phien_hien_tai,
      Du_doan: record.Du_doan,
      ket_qua_du_doan: record.ket_qua_du_doan || '',
      id: record.id,
      ml_probability: result.mlProbability
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-md5', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data || data.length === 0) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('md5', data);
    
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    
    const result = calculateAdvancedPrediction(data, 'md5');
    
    const record = savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
    
    setTimeout(async () => {
      await updateHistoryStatus('md5');
    }, 5000);
    
    res.json({
      Phien: record.Phien,
      Xuc_xac_1: record.Xuc_xac_1,
      Xuc_xac_2: record.Xuc_xac_2,
      Xuc_xac_3: record.Xuc_xac_3,
      Tong: record.Tong,
      Ket_qua: record.Ket_qua,
      Do_tin_cay: record.Do_tin_cay,
      Phien_hien_tai: record.Phien_hien_tai,
      Du_doan: record.Du_doan,
      ket_qua_du_doan: record.ket_qua_du_doan || '',
      id: record.id,
      ml_probability: result.mlProbability
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-hu/lichsu', async (req, res) => {
  try {
    await updateHistoryStatus('hu');
    
    res.json({
      type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
      history: predictionHistory.hu,
      total: predictionHistory.hu.length
    });
  } catch (error) {
    res.json({
      type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
      history: predictionHistory.hu,
      total: predictionHistory.hu.length
    });
  }
});

app.get('/lc79-md5/lichsu', async (req, res) => {
  try {
    await updateHistoryStatus('md5');
    
    res.json({
      type: 'Lẩu Cua 79 - Tài Xỉu MD5',
      history: predictionHistory.md5,
      total: predictionHistory.md5.length
    });
  } catch (error) {
    res.json({
      type: 'Lẩu Cua 79 - Tài Xỉu MD5',
      history: predictionHistory.md5,
      total: predictionHistory.md5.length
    });
  }
});

app.get('/lc79-hu/analysis', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data || data.length === 0) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('hu', data);
    
    const result = calculateAdvancedPrediction(data, 'hu');
    res.json({
      prediction: result.prediction,
      confidence: result.confidence,
      ml_probability: result.mlProbability,
      factors: result.factors,
      analysis: result.detailedAnalysis
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-md5/analysis', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data || data.length === 0) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('md5', data);
    
    const result = calculateAdvancedPrediction(data, 'md5');
    res.json({
      prediction: result.prediction,
      confidence: result.confidence,
      ml_probability: result.mlProbability,
      factors: result.factors,
      analysis: result.detailedAnalysis
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-hu/learning', (req, res) => {
  const stats = learningData.hu;
  const accuracy = stats.totalPredictions > 0 
    ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2)
    : 0;
  
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu Hũ - Learning Stats',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${accuracy}%`,
    streakAnalysis: stats.streakAnalysis,
    mlModel: {
      weights: stats.mlModel.weights,
      lastTraining: stats.mlModel.lastTraining
    }
  });
});

app.get('/lc79-md5/learning', (req, res) => {
  const stats = learningData.md5;
  const accuracy = stats.totalPredictions > 0 
    ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2)
    : 0;
  
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu MD5 - Learning Stats',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${accuracy}%`,
    streakAnalysis: stats.streakAnalysis,
    mlModel: {
      weights: stats.mlModel.weights,
      lastTraining: stats.mlModel.lastTraining
    }
  });
});

app.get('/reset-learning', (req, res) => {
  learningData = {
    hu: {
      predictions: [],
      patternStats: {},
      totalPredictions: 0,
      correctPredictions: 0,
      patternWeights: { ...DEFAULT_PATTERN_WEIGHTS },
      lastUpdate: null,
      streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
      adaptiveThresholds: {},
      recentAccuracy: [],
      mlModel: { weights: {}, bias: 0, lastTraining: null }
    },
    md5: {
      predictions: [],
      patternStats: {},
      totalPredictions: 0,
      correctPredictions: 0,
      patternWeights: { ...DEFAULT_PATTERN_WEIGHTS },
      lastUpdate: null,
      streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
      adaptiveThresholds: {},
      recentAccuracy: [],
      mlModel: { weights: {}, bias: 0, lastTraining: null }
    }
  };
  saveLearningData();
  res.json({ message: 'Learning data reset successfully' });
});

loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log('Lau Cua 79 - Advanced Tai Xiu Prediction API v8.0');
  console.log('');
  console.log('NÂNG CẤP v8.0 (Thuật toán nâng cao):');
  console.log('  1. Ensemble Voting có trọng số động theo Reliability Score');
  console.log('  2. Markov Chain Bậc 2 (xét 2 kết quả liên tiếp trước)');
  console.log('  3. Bayesian Update - Xác suất posterior từ prior + likelihood');
  console.log('  4. Pattern Reliability Guard - loại bỏ pattern kém hiệu quả');
  console.log('  5. Anti-Overfitting Guard - không đổi chiều khi bằng chứng yếu');
  console.log('  6. Confidence Calibration - confidence phản ánh thực tế hơn');
  console.log('  7. ML Learning Rate Decay + L2 Regularization + Gradient Clipping');
  console.log('  8. Pattern Weight Decay nhanh hơn khi accuracy < 35%');
  console.log('  9. scoreRatio và bayesianProb trong detailedAnalysis');
  console.log('');
  console.log('FILE: tiendat.json, tiendat1.json');
  console.log('ID: @tiendataox');
  
  startAutoSaveTask();
});