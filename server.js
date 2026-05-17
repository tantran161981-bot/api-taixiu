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
  'cau_bet': 1.2, 'cau_dao_11': 1.15, 'cau_22': 1.1, 'cau_33': 1.1,
  'cau_121': 1.05, 'cau_123': 1.05, 'cau_321': 1.05, 'cau_nhay_coc': 1.0,
  'cau_nhip_nghieng': 1.1, 'cau_3van1': 1.0, 'cau_be_cau': 1.15,
  'cau_chu_ky': 1.1, 'distribution': 1.2, 'dice_pattern': 1.15,
  'sum_trend': 1.25, 'edge_cases': 1.1, 'momentum': 1.15, 'cau_tu_nhien': 0.9,
  'dice_trend_line': 1.1, 'dice_trend_line_md5': 1.1, 'break_pattern_hu': 1.2,
  'break_pattern_md5': 1.2, 'fibonacci': 1.15, 'resistance_support': 1.1,
  'wave': 1.2, 'golden_ratio': 1.15, 'day_gay': 1.2, 'day_gay_md5': 1.2,
  'cau_44': 1.1, 'cau_55': 1.1, 'cau_212': 1.05, 'cau_1221': 1.1,
  'cau_2112': 1.1, 'cau_gap': 1.05, 'cau_ziczac': 1.1, 'cau_doi': 1.05,
  'cau_rong': 1.25, 'smart_bet': 1.2, 'break_pattern_advanced': 1.15,
  'break_streak': 1.25, 'alternating_break': 1.2, 'double_pair_break': 1.2,
  'triple_pattern': 1.25, 'tong_phan_tich': 1.5, 'xu_huong_manh': 1.4,
  'dao_chieu': 1.4, 'lstm_pattern': 1.35, 'markov_chain': 1.3,
  'neural_boost': 1.35, 'sentiment_analysis': 1.25, 'harmonic_pattern': 1.3
};

// ==================== MACHINE LEARNING NÂNG CAO ====================

function extractFeatures(results, sums) {
  if (results.length < 10) return getDefaultFeatures(results, sums);
  
  return {
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
    momentum: calculateMomentum(results, sums).taiMomentum,
    supportResistance: detectSupportResistance(sums.slice(0, 20)).support || 10.5
  };
}

function getDefaultFeatures(results, sums) {
  return {
    lastResult: results.length > 0 ? (results[0] === 'Tài' ? 1 : 0) : 0.5,
    last3Sum: sums.length > 0 ? sums.slice(0, Math.min(3, sums.length)).reduce((a, b) => a + b, 0) / Math.min(3, sums.length) : 10.5,
    last5Sum: sums.length > 0 ? sums.slice(0, Math.min(5, sums.length)).reduce((a, b) => a + b, 0) / Math.min(5, sums.length) : 10.5,
    last10Sum: sums.length > 0 ? sums.slice(0, Math.min(10, sums.length)).reduce((a, b) => a + b, 0) / Math.min(10, sums.length) : 10.5,
    volatility: 2.5,
    taiRatio5: results.length > 0 ? results.slice(0, Math.min(5, results.length)).filter(r => r === 'Tài').length / Math.min(5, results.length) : 0.5,
    taiRatio10: results.length > 0 ? results.slice(0, Math.min(10, results.length)).filter(r => r === 'Tài').length / Math.min(10, results.length) : 0.5,
    streakLength: 1,
    alternatingStrength: 0,
    patternComplexity: 0.5,
    sumTrend: 0,
    momentum: 0.5,
    supportResistance: 10.5
  };
}

function calculateVolatility(sums) {
  if (sums.length < 2) return 0;
  const mean = sums.reduce((a, b) => a + b, 0) / sums.length;
  const variance = sums.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / sums.length;
  return Math.sqrt(variance);
}

function calculateStreakLength(results) {
  if (results.length === 0) return 1;
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
  if (results.length === 0) return 0.5;
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
  const avgSum = recentSums.length > 0 ? recentSums.reduce((a, b) => a + b, 0) / recentSums.length : 10.5;
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
  
  return 1 / (1 + Math.exp(-score));
}

function updateMLModel(type, features, actualResult) {
  const target = actualResult === 'Tài' ? 1 : 0;
  const prediction = predictWithML(features, type);
  const error = target - prediction;
  const learningRate = 0.015;
  
  const model = learningData[type].mlModel;
  model.bias = (model.bias || 0) + learningRate * error;
  
  Object.entries(features).forEach(([key, value]) => {
    if (!model.weights[key]) model.weights[key] = 0;
    model.weights[key] += learningRate * error * value;
  });
  
  model.lastTraining = new Date().toISOString();
}

// ==================== PATTERN PHÂN TÍCH THỰC ====================

function analyzeLSTMPattern(results, type) {
  if (results.length < 10) return { detected: false };
  
  const sequence = results.slice(0, 10);
  let longTermTrend = 0;
  for (let i = 0; i < sequence.length - 3; i++) {
    if (sequence[i] === sequence[i+1] && sequence[i+1] === sequence[i+2] && sequence[i+2] === sequence[i+3]) {
      longTermTrend += 2;
    } else if (sequence[i] === sequence[i+1] && sequence[i+1] === sequence[i+2]) {
      longTermTrend += 1.5;
    } else if (sequence[i] === sequence[i+1]) {
      longTermTrend += 0.5;
    } else {
      longTermTrend -= 0.5;
    }
  }
  
  if (Math.abs(longTermTrend) >= 5) {
    const prediction = longTermTrend > 0 ? 
      (longTermTrend > 8 ? 'Xỉu' : (Math.random() > 0.65 ? 'Xỉu' : 'Tài')) : 
      (longTermTrend < -8 ? 'Tài' : (Math.random() > 0.65 ? 'Tài' : 'Xỉu'));
    
    return {
      detected: true,
      prediction,
      confidence: Math.round(68 + Math.min(20, Math.abs(longTermTrend) * 1.5)),
      name: `LSTM (Xu hướng ${longTermTrend > 0 ? 'tăng mạnh' : 'giảm mạnh'})`,
      patternId: 'lstm_pattern'
    };
  }
  
  return { detected: false };
}

function analyzeMarkovChain(results, type) {
  if (results.length < 12) return { detected: false };
  
  const transitions = { 'Tài_Tài': 0, 'Tài_Xỉu': 0, 'Xỉu_Tài': 0, 'Xỉu_Xỉu': 0 };
  
  for (let i = 0; i < results.length - 1; i++) {
    const key = `${results[i]}_${results[i+1]}`;
    transitions[key]++;
  }
  
  const lastResult = results[0];
  const probTai = transitions[`${lastResult}_Tài`] / 
    (transitions[`${lastResult}_Tài`] + transitions[`${lastResult}_Xỉu`] || 1);
  
  if (probTai > 0.65 || probTai < 0.35) {
    const prediction = probTai > 0.65 ? 'Tài' : 'Xỉu';
    return {
      detected: true,
      prediction,
      confidence: Math.round(70 + Math.abs(probTai - 0.5) * 40),
      name: `Markov (Xác suất ${(probTai * 100).toFixed(0)}% ${prediction})`,
      patternId: 'markov_chain'
    };
  }
  
  return { detected: false };
}

function analyzeNeuralBoost(results, sums, type) {
  if (results.length < 15) return { detected: false };
  
  const input = [
    results.slice(0, 5).filter(r => r === 'Tài').length / 5,
    results.slice(5, 10).filter(r => r === 'Tài').length / 5,
    (sums[0] - 10.5) / 5.5,
    calculateVolatility(sums.slice(0, 10)) / 5,
    results.slice(0, 3).filter(r => r === results[0]).length / 3
  ];
  
  const h1 = input.map(x => Math.tanh(x * 1.5));
  const output = (h1[0] * 0.4 + h1[1] * 0.3 + h1[2] * 0.15 + h1[3] * 0.1 + h1[4] * 0.05);
  const normalizedOutput = (output + 1) / 2;
  
  const prediction = normalizedOutput > 0.55 ? 'Tài' : (normalizedOutput < 0.45 ? 'Xỉu' : null);
  
  if (prediction && Math.abs(normalizedOutput - 0.5) > 0.08) {
    return {
      detected: true,
      prediction,
      confidence: Math.round(65 + Math.abs(normalizedOutput - 0.5) * 50),
      name: `Neural Boost (độ tin cậy ${(Math.abs(normalizedOutput - 0.5) * 100).toFixed(0)}%)`,
      patternId: 'neural_boost'
    };
  }
  
  return { detected: false };
}

function analyzeHarmonicPattern(results, sums, type) {
  if (results.length < 12) return { detected: false };
  
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
        confidence: 76,
        name: `Harmonic (Sóng ${pattern5[4].type} → ${prediction})`,
        patternId: 'harmonic_pattern'
      };
    }
  }
  
  return { detected: false };
}

function analyzeSentiment(results, sums, type) {
  if (results.length < 10) return { detected: false };
  
  const volatility = calculateVolatility(sums.slice(0, 10));
  const recentTaiRatio = results.slice(0, 5).filter(r => r === 'Tài').length / 5;
  const prevTaiRatio = results.slice(5, 10).filter(r => r === 'Tài').length / 5;
  
  if (recentTaiRatio > 0.8 && prevTaiRatio < 0.5 && volatility > 2) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: 72,
      name: 'Sentiment FOMO (đám đông đổ xô)',
      patternId: 'sentiment_analysis'
    };
  }
  
  if (volatility > 3.5 && recentTaiRatio < 0.3 && sums[0] < 8) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: 74,
      name: 'Sentiment Panic (bật lại mạnh)',
      patternId: 'sentiment_analysis'
    };
  }
  
  return { detected: false };
}

// ==================== CÁC HÀM PHÂN TÍCH ====================

function analyzeTongPhanTich(data, type) {
  if (data.length < 10) return { detected: false };
  
  const sums = data.slice(0, 10).map(d => d.Tong);
  const results = data.slice(0, 10).map(d => d.Ket_qua);
  
  const first5Sum = sums.slice(5, 10).reduce((a, b) => a + b, 0) / 5;
  const last5Sum = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const sumTrend = last5Sum - first5Sum;
  
  const recent10 = results.slice(0, 10);
  const taiCount = recent10.filter(r => r === 'Tài').length;
  const xiuCount = recent10.filter(r => r === 'Xỉu').length;
  
  if (sumTrend > 1.5) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: Math.round(75 + Math.min(15, Math.abs(sumTrend) * 3)),
      name: `Tổng phân tích (giảm ${sumTrend.toFixed(1)} → Xỉu)`,
      patternId: 'tong_phan_tich'
    };
  }
  
  if (sumTrend < -1.5) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: Math.round(75 + Math.min(15, Math.abs(sumTrend) * 3)),
      name: `Tổng phân tích (tăng ${Math.abs(sumTrend).toFixed(1)} → Tài)`,
      patternId: 'tong_phan_tich'
    };
  }
  
  if (Math.abs(taiCount - xiuCount) >= 3) {
    const lech = taiCount > xiuCount ? 'Tài' : 'Xỉu';
    const prediction = lech === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: Math.round(70 + Math.min(20, Math.abs(taiCount - xiuCount) * 3)),
      name: `Tổng phân tích (lệch ${Math.abs(taiCount - xiuCount)} về ${lech})`,
      patternId: 'tong_phan_tich'
    };
  }
  
  return { detected: false };
}

function analyzeXuHuongManh(results, type) {
  if (results.length < 8) return { detected: false };
  
  const recent8 = results.slice(0, 8);
  const taiCount = recent8.filter(r => r === 'Tài').length;
  
  if (taiCount >= 6) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: Math.round(78 + Math.min(12, taiCount * 1.5)),
      name: `Xu hướng mạnh (${taiCount}/8 Tài → đảo Xỉu)`,
      patternId: 'xu_huong_manh'
    };
  }
  
  if (taiCount <= 2) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: Math.round(78 + Math.min(12, (8 - taiCount) * 1.5)),
      name: `Xu hướng mạnh (${8 - taiCount}/8 Xỉu → đảo Tài)`,
      patternId: 'xu_huong_manh'
    };
  }
  
  return { detected: false };
}

function analyzeDaoChieu(results, type) {
  if (results.length < 5) return { detected: false };
  
  const recent5 = results.slice(0, 5);
  
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
      name: `Đảo chiều (${recent5.join('-')} → ${prediction})`,
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
    let shouldBreak = false;
    let confidence = 65;
    
    if (streakLength >= 6) {
      shouldBreak = true;
      confidence = 88;
    } else if (streakLength >= 5) {
      shouldBreak = true;
      confidence = 82;
    } else if (streakLength >= 4) {
      shouldBreak = true;
      confidence = 75;
    } else if (streakLength >= 3) {
      shouldBreak = Math.random() < 0.4;
      confidence = 68;
    }
    
    const weight = getPatternWeight(type, 'cau_bet');
    
    return { 
      detected: true, 
      type: streakType, 
      length: streakLength,
      prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
      confidence: Math.round(Math.min(92, confidence * weight)),
      name: `Cầu bệt ${streakLength} ${streakType}`,
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
    const confidence = Math.min(85, 65 + alternatingLength * 2.5);
    
    const prediction = (alternatingLength % 2 === 0) ? 
      (results[0] === 'Tài' ? 'Xỉu' : 'Tài') : 
      results[0];
    
    return { 
      detected: true, 
      length: alternatingLength,
      prediction,
      confidence: Math.round(confidence * weight),
      name: `Cầu đảo 1-1 (${alternatingLength} phiên)`,
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
      
      let prediction;
      if (pairCount === 2) {
        prediction = lastPairType;
      } else if (pairCount === 3) {
        prediction = lastPairType === 'Tài' ? 'Xỉu' : 'Tài';
      } else {
        prediction = lastPairType === 'Tài' ? 'Xỉu' : 'Tài';
      }
      
      return { 
        detected: true, 
        pairCount,
        prediction,
        confidence: Math.round(Math.min(85, 65 + pairCount * 4) * weight),
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
      confidence: Math.round(Math.min(85, 68 + tripleCount * 5) * weight),
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
      confidence: Math.round(74 * weight),
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
        confidence: Math.round(76 * weight),
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
      confidence: Math.round(78 * weight),
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
        confidence: Math.round(70 * weight),
        name: 'Cầu nhảy cóc',
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
        confidence: Math.round(68 * weight),
        name: 'Cầu nhảy cóc đảo',
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
      confidence: Math.round(72 * weight),
      name: `Cầu nhịp nghiêng (${taiCount5}/5 Tài)`,
      patternId: 'cau_nhip_nghieng'
    };
  } else if (taiCount5 <= 1) {
    return { 
      detected: true, 
      type: 'nghieng_5',
      prediction: 'Xỉu',
      confidence: Math.round(72 * weight),
      name: `Cầu nhịp nghiêng (${5 - taiCount5}/5 Xỉu)`,
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
      confidence: Math.round(70 * weight),
      name: 'Cầu 3 ván 1 (3T-1X) → Xỉu',
      patternId: 'cau_3van1'
    };
  } else if (taiCount === 1) {
    return { 
      detected: true, 
      prediction: 'Tài',
      confidence: Math.round(70 * weight),
      name: 'Cầu 3 ván 1 (3X-1T) → Tài',
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
        confidence: Math.round(78 * weight),
        name: 'Cầu bẻ cầu',
        patternId: 'cau_be_cau'
      };
    }
  }
  
  return { detected: false };
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
      confidence: Math.round(Math.min(92, 78 + streakLength) * weight),
      name: `Cầu rồng ${streakLength} (bẻ mạnh)`,
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
      confidence: Math.round(80 * weight),
      name: `Đảo xu hướng (${taiLast5}T → ${taiPrev5}T)`,
      patternId: 'smart_bet'
    };
  }
  
  const taiLast10 = last10.filter(r => r === 'Tài').length;
  if (taiLast10 >= 8 || taiLast10 <= 2) {
    const dominant = taiLast10 >= 8 ? 'Tài' : 'Xỉu';
    return { 
      detected: true, 
      prediction: dominant === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(84 * weight),
      name: `Xu hướng cực (${taiLast10}T-${10-taiLast10}X) → đảo`,
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
      confidence: Math.round(Math.min(88, 70 + streakLength) * weight),
      name: `Bẻ chuỗi ${streakLength} (${streakType} → ${prediction})`,
      patternId: 'break_streak'
    };
  }
  
  return { detected: false };
}

function analyzeAlternatingBreak(results, type) {
  if (results.length < 8) return { detected: false };
  
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
      confidence: Math.round(Math.min(85, 68 + alternatingCount) * weight),
      name: `Bẻ đảo ${alternatingCount} → ${prediction}`,
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
        confidence: Math.round(86 * weight),
        name: `4 cặp cùng ${pairType1} → bẻ ${prediction}`,
        patternId: 'double_pair_break'
      };
    }
    
    const alternatingPairs = pairType1 !== pairType2 && pairType2 !== results[4] && results[4] !== results[6];
    if (alternatingPairs) {
      const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        prediction,
        confidence: Math.round(80 * weight),
        name: `Cặp đảo xen kẽ → bẻ ${prediction}`,
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
        confidence: Math.round(90 * weight),
        name: `3 bộ ba cùng ${tripleType1} → bẻ ${prediction}`,
        patternId: 'triple_pattern'
      };
    }
    
    if (tripleType1 !== tripleType2 && tripleType2 !== tripleType3) {
      const prediction = tripleType1;
      return {
        detected: true,
        prediction,
        confidence: Math.round(82 * weight),
        name: `Bộ ba đảo → theo ${prediction}`,
        patternId: 'triple_pattern'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCau44(results, type) {
  if (results.length < 8) return { detected: false };
  
  let quadrupleCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 3 && quadrupleCount < 3) {
    if (results[i] === results[i+1] && results[i+1] === results[i+2] && results[i+2] === results[i+3]) {
      pattern.push(results[i]);
      quadrupleCount++;
      i += 4;
    } else {
      break;
    }
  }
  
  if (quadrupleCount >= 1) {
    const weight = getPatternWeight(type, 'cau_44');
    const lastQuadrupleType = pattern[pattern.length - 1];
    const prediction = lastQuadrupleType === 'Tài' ? 'Xỉu' : 'Tài';
    
    return {
      detected: true,
      quadrupleCount,
      prediction,
      confidence: Math.round(78 + quadrupleCount * 4),
      name: `Cầu 4-4 (${quadrupleCount} bộ bốn)`,
      patternId: 'cau_44'
    };
  }
  
  return { detected: false };
}

function analyzeCau55(results, type) {
  if (results.length < 10) return { detected: false };
  
  let quintupleCount = 0;
  let i = 0;
  
  while (i < results.length - 4 && quintupleCount < 2) {
    let allSame = true;
    for (let j = 0; j < 4; j++) {
      if (results[i+j] !== results[i+j+1]) {
        allSame = false;
        break;
      }
    }
    
    if (allSame) {
      quintupleCount++;
      i += 5;
    } else {
      break;
    }
  }
  
  if (quintupleCount >= 1) {
    const weight = getPatternWeight(type, 'cau_55');
    const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    
    return {
      detected: true,
      quintupleCount,
      prediction,
      confidence: Math.round(82 + quintupleCount * 4),
      name: `Cầu 5-5 (${quintupleCount} bộ năm)`,
      patternId: 'cau_55'
    };
  }
  
  return { detected: false };
}

function analyzeCau212(results, type) {
  if (results.length < 5) return { detected: false };
  
  const pattern5 = results.slice(0, 5);
  
  if (pattern5[0] !== pattern5[1] && 
      pattern5[1] === pattern5[2] && 
      pattern5[2] !== pattern5[3] &&
      pattern5[3] === pattern5[4]) {
    const weight = getPatternWeight(type, 'cau_212');
    return {
      detected: true,
      prediction: pattern5[0],
      confidence: Math.round(73 * weight),
      name: 'Cầu 2-1-2',
      patternId: 'cau_212'
    };
  }
  
  return { detected: false };
}

function analyzeCau1221(results, type) {
  if (results.length < 8) return { detected: false };
  
  const pattern8 = results.slice(0, 8);
  
  if (pattern8[0] !== pattern8[1] && 
      pattern8[1] === pattern8[2] && 
      pattern8[2] === pattern8[3] &&
      pattern8[3] !== pattern8[4] &&
      pattern8[4] !== pattern8[5] &&
      pattern8[5] === pattern8[6] &&
      pattern8[6] === pattern8[7] &&
      pattern8[0] === pattern8[7]) {
    const weight = getPatternWeight(type, 'cau_1221');
    return {
      detected: true,
      prediction: pattern8[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(76 * weight),
      name: 'Cầu 1-2-2-1',
      patternId: 'cau_1221'
    };
  }
  
  return { detected: false };
}

function analyzeCau2112(results, type) {
  if (results.length < 8) return { detected: false };
  
  const pattern8 = results.slice(0, 8);
  
  if (pattern8[0] === pattern8[1] && 
      pattern8[1] !== pattern8[2] &&
      pattern8[2] !== pattern8[3] &&
      pattern8[3] === pattern8[4] &&
      pattern8[4] === pattern8[5] &&
      pattern8[5] !== pattern8[6] &&
      pattern8[6] !== pattern8[7]) {
    const weight = getPatternWeight(type, 'cau_2112');
    return {
      detected: true,
      prediction: pattern8[7],
      confidence: Math.round(77 * weight),
      name: 'Cầu 2-1-1-2',
      patternId: 'cau_2112'
    };
  }
  
  return { detected: false };
}

function analyzeCauGap(results, type) {
  if (results.length < 6) return { detected: false };
  
  let gaps = [];
  for (let i = 0; i < results.length - 1; i++) {
    if (results[i] === results[i+1]) {
      gaps.push({ position: i, length: 1 });
      let j = i + 1;
      while (j < results.length - 1 && results[j] === results[j+1]) {
        gaps[gaps.length - 1].length++;
        j++;
      }
      i = j;
    }
  }
  
  if (gaps.length >= 2 && gaps[0].length === gaps[1].length && gaps[0].length >= 2) {
    const weight = getPatternWeight(type, 'cau_gap');
    return {
      detected: true,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(74 * weight),
      name: `Cầu gấp ${gaps[0].length}`,
      patternId: 'cau_gap'
    };
  }
  
  return { detected: false };
}

function analyzeCauZiczac(results, type) {
  if (results.length < 8) return { detected: false };
  
  let isZigzag = true;
  for (let i = 0; i < 6; i++) {
    if (results[i] === results[i+2]) {
      isZigzag = false;
      break;
    }
  }
  
  if (isZigzag) {
    const weight = getPatternWeight(type, 'cau_ziczac');
    const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: Math.round(72 * weight),
      name: 'Cầu ziczac',
      patternId: 'cau_ziczac'
    };
  }
  
  return { detected: false };
}

function analyzeCauDoi(results, type) {
  if (results.length < 4) return { detected: false };
  
  const recent4 = results.slice(0, 4);
  
  if (recent4[0] === recent4[2] && recent4[1] === recent4[3] && recent4[0] !== recent4[1]) {
    const weight = getPatternWeight(type, 'cau_doi');
    return {
      detected: true,
      prediction: recent4[1],
      confidence: Math.round(71 * weight),
      name: 'Cầu đôi (ABAB)',
      patternId: 'cau_doi'
    };
  }
  
  return { detected: false };
}

function analyzeDayGay(results, type) {
  if (results.length < 6) return { detected: false };
  
  const breaks = [];
  let currentRun = 1;
  
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[i-1]) {
      currentRun++;
    } else {
      if (currentRun >= 3) {
        breaks.push(currentRun);
      }
      currentRun = 1;
    }
  }
  
  if (breaks.length >= 2 && breaks[0] >= 3 && breaks[1] >= 3) {
    const weight = getPatternWeight(type, 'day_gay');
    return {
      detected: true,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(76 * weight),
      name: 'Dây gãy',
      patternId: 'day_gay'
    };
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
        confidence: Math.round(74 * weight),
        name: `Fibonacci ${level} (chạm ${value.toFixed(1)})`,
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
        confidence: 78,
        name: `Wave pattern (sóng ${waves[4].type} → đảo ${prediction})`,
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
  
  for (let i = 0; i < results.length && i < sums.length; i++) {
    if (results[i] === 'Tài') {
      taiWins.push(sums[i]);
    } else {
      xiuWins.push(sums[i]);
    }
  }
  
  if (taiWins.length === 0 || xiuWins.length === 0) return { detected: false };
  
  const avgTai = taiWins.reduce((a, b) => a + b, 0) / taiWins.length;
  const avgXiu = xiuWins.reduce((a, b) => a + b, 0) / xiuWins.length;
  const ratio = avgTai / avgXiu;
  
  const weight = getPatternWeight(type, 'golden_ratio');
  
  if (Math.abs(ratio - 1.618) < 0.25) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: 76,
      name: `Golden ratio (${ratio.toFixed(3)} ~ 1.618 → Tài)`,
      patternId: 'golden_ratio'
    };
  }
  
  if (Math.abs(ratio - 0.618) < 0.15) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: 76,
      name: `Golden ratio (${ratio.toFixed(3)} ~ 0.618 → Xỉu)`,
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
  
  const patterns = [
    { name: 'Tổng phân tích', func: () => analyzeTongPhanTich(last50, type), priority: 18 },
    { name: 'Cầu rồng', func: () => analyzeCauRong(results, type), priority: 17 },
    { name: 'Xu hướng mạnh', func: () => analyzeXuHuongManh(results, type), priority: 17 },
    { name: 'Triple pattern', func: () => analyzeTriplePattern(results, type), priority: 17 },
    { name: 'Neural boost', func: () => analyzeNeuralBoost(results, sums, type), priority: 16 },
    { name: 'LSTM pattern', func: () => analyzeLSTMPattern(results, type), priority: 16 },
    { name: 'Break streak', func: () => analyzeBreakStreak(results, type), priority: 16 },
    { name: 'Double pair break', func: () => analyzeDoublePairBreak(results, type), priority: 16 },
    { name: 'Markov chain', func: () => analyzeMarkovChain(results, type), priority: 15 },
    { name: 'Đảo chiều', func: () => analyzeDaoChieu(results, type), priority: 15 },
    { name: 'Smart bet', func: () => analyzeSmartBet(results, type), priority: 15 },
    { name: 'Alternating break', func: () => analyzeAlternatingBreak(results, type), priority: 15 },
    { name: 'Harmonic pattern', func: () => analyzeHarmonicPattern(results, sums, type), priority: 14 },
    { name: 'Sentiment', func: () => analyzeSentiment(results, sums, type), priority: 14 },
    { name: 'Wave pattern', func: () => analyzeWavePattern(results, sums, type), priority: 14 },
    { name: 'Cầu bệt', func: () => analyzeCauBet(results, type), priority: 13 },
    { name: 'Cầu đảo 1-1', func: () => analyzeCauDao11(results, type), priority: 13 },
    { name: 'Cầu 2-2', func: () => analyzeCau22(results, type), priority: 13 },
    { name: 'Cầu 3-3', func: () => analyzeCau33(results, type), priority: 12 },
    { name: 'Cầu 4-4', func: () => analyzeCau44(results, type), priority: 12 },
    { name: 'Cầu 5-5', func: () => analyzeCau55(results, type), priority: 12 },
    { name: 'Fibonacci', func: () => analyzeFibonacci(sums, type), priority: 12 },
    { name: 'Golden ratio', func: () => analyzeGoldenRatio(results, sums, type), priority: 11 },
    { name: 'Cầu bẻ cầu', func: () => analyzeCauBeCau(results, type), priority: 11 },
    { name: 'Dây gãy', func: () => analyzeDayGay(results, type), priority: 11 },
    { name: 'Cầu 1-2-1', func: () => analyzeCau121(results, type), priority: 10 },
    { name: 'Cầu 1-2-3', func: () => analyzeCau123(results, type), priority: 10 },
    { name: 'Cầu 3-2-1', func: () => analyzeCau321(results, type), priority: 10 },
    { name: 'Cầu 2-1-2', func: () => analyzeCau212(results, type), priority: 10 },
    { name: 'Cầu 1-2-2-1', func: () => analyzeCau1221(results, type), priority: 10 },
    { name: 'Cầu 2-1-1-2', func: () => analyzeCau2112(results, type), priority: 10 },
    { name: 'Cầu nhịp nghiêng', func: () => analyzeCauNhipNghieng(results, type), priority: 9 },
    { name: 'Cầu nhảy cóc', func: () => analyzeCauNhayCoc(results, type), priority: 9 },
    { name: 'Cầu 3 ván 1', func: () => analyzeCau3Van1(results, type), priority: 9 },
    { name: 'Cầu gấp', func: () => analyzeCauGap(results, type), priority: 8 },
    { name: 'Cầu ziczac', func: () => analyzeCauZiczac(results, type), priority: 8 },
    { name: 'Cầu đôi', func: () => analyzeCauDoi(results, type), priority: 8 }
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
  
  const distribution = analyzeDistribution(last50, type);
  if (distribution.imbalance > 0.2) {
    const minority = distribution.taiPercent < 50 ? 'Tài' : 'Xỉu';
    predictions.push({ 
      prediction: minority, 
      confidence: 68 + Math.floor(distribution.imbalance * 30), 
      priority: 12, 
      name: 'Phân bố lệch' 
    });
    factors.push(`Phân bố (T:${distribution.taiPercent.toFixed(0)}% - X:${distribution.xiuPercent.toFixed(0)}%)`);
  }
  
  if (predictions.length === 0) {
    const cauTuNhien = { 
      detected: true, 
      prediction: results[0], 
      confidence: 65, 
      name: 'Theo ván trước' 
    };
    predictions.push({ 
      prediction: cauTuNhien.prediction, 
      confidence: cauTuNhien.confidence, 
      priority: 1, 
      name: cauTuNhien.name 
    });
    factors.push(cauTuNhien.name);
    allPatterns.push(cauTuNhien);
  }
  
  predictions.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
  
  const taiVotes = predictions.filter(p => p.prediction === 'Tài');
  const xiuVotes = predictions.filter(p => p.prediction === 'Xỉu');
  
  let taiScore = taiVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  let xiuScore = xiuVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  
  const features = extractFeatures(results, sums);
  const mlProbability = predictWithML(features, type);
  
  if (mlProbability > 0.58) {
    taiScore *= (1 + mlProbability * 0.5);
  } else if (mlProbability < 0.42) {
    xiuScore *= (1 + (1 - mlProbability) * 0.5);
  }
  
  const streakInfo = learningData[type].streakAnalysis;
  if (streakInfo.currentStreak <= -3) {
    if (taiScore > xiuScore) {
      xiuScore *= 1.25;
    } else {
      taiScore *= 1.25;
    }
  } else if (streakInfo.currentStreak >= 3) {
    if (taiScore > xiuScore) {
      taiScore *= 1.2;
    } else {
      xiuScore *= 1.2;
    }
  }
  
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  finalPrediction = getSmartPredictionAdjustment(type, finalPrediction, allPatterns);
  
  let baseConfidence = 65;
  
  const topPredictions = predictions.slice(0, 3);
  topPredictions.forEach(p => {
    if (p.prediction === finalPrediction) {
      baseConfidence += (p.confidence - 65) * 0.35;
    }
  });
  
  const agreementRatio = (finalPrediction === 'Tài' ? taiVotes.length : xiuVotes.length) / predictions.length;
  baseConfidence += Math.min(15, agreementRatio * 12);
  
  const scoreDiff = Math.abs(taiScore - xiuScore);
  const diffBoost = Math.min(10, scoreDiff / 50);
  baseConfidence += diffBoost;
  
  const mlBoost = Math.abs(mlProbability - 0.5) * 15;
  baseConfidence += mlBoost;
  
  const adaptiveBoost = getAdaptiveConfidenceBoost(type);
  baseConfidence += adaptiveBoost;
  
  let finalConfidence = Math.round(baseConfidence);
  finalConfidence = Math.max(65, Math.min(94, finalConfidence));
  
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
      topPattern: predictions[0]?.name || 'N/A',
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

// ==================== CÁC HÀM HỖ TRỢ ====================

function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = fs.readFileSync(LEARNING_FILE, 'utf8');
      const parsed = JSON.parse(data);
      learningData = { ...learningData, ...parsed };
      console.log('✓ Đã tải dữ liệu học tập từ tiendat.json');
    }
  } catch (error) {
    console.error('Lỗi tải learning data:', error.message);
  }
}

function saveLearningData() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch (error) {
    console.error('Lỗi lưu learning data:', error.message);
  }
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(data);
      predictionHistory = parsed.history || { hu: [], md5: [] };
      lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
      console.log('✓ Đã tải lịch sử dự đoán từ tiendat1.json');
      console.log(`  - Hu: ${predictionHistory.hu.length} bản ghi`);
      console.log(`  - MD5: ${predictionHistory.md5.length} bản ghi`);
    }
  } catch (error) {
    console.error('Lỗi tải history:', error.message);
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
    console.error('Lỗi lưu history:', error.message);
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
        console.log(`[Auto] Hu phiên ${nextHuPhien}: ${result.prediction} (${result.confidence}%)`);
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
        console.log(`[Auto] MD5 phiên ${nextMd5Phien}: ${result.prediction} (${result.confidence}%)`);
      }
    }
    
    await updateHistoryStatus('hu');
    await updateHistoryStatus('md5');
    
    savePredictionHistory();
    saveLearningData();
    
  } catch (error) {
    console.error('[Auto] Lỗi xử lý:', error.message);
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
    console.error(`Lỗi cập nhật ${type}:`, error.message);
  }
}

function startAutoSaveTask() {
  console.log(`\n⏰ Auto-save: mỗi ${AUTO_SAVE_INTERVAL/1000}s`);
  
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
  
  if (stats.recentResults.length >= 10) {
    if (recentAccuracy > 0.6) {
      newWeight = Math.min(2.5, oldWeight * 1.08);
    } else if (recentAccuracy < 0.4) {
      newWeight = Math.max(0.3, oldWeight * 0.92);
    }
  }
  
  learningData[type].patternWeights[patternId] = newWeight;
  stats.lastAdjustment = new Date().toISOString();
}

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
      
      const allResults = learningData[type].predictions
        .filter(p => p.verified)
        .slice(0, 20)
        .map(p => p.actual);
      const allSums = currentData.slice(0, 20).map(d => d.Tong);
      const features = extractFeatures(allResults, allSums);
      updateMLModel(type, features, pred.actual);
      
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
    'Cầu bệt': 'cau_bet', 'Cầu đảo 1-1': 'cau_dao_11',
    'Cầu 2-2': 'cau_22', 'Cầu 3-3': 'cau_33', 'Cầu 4-4': 'cau_44',
    'Cầu 5-5': 'cau_55', 'Cầu 1-2-1': 'cau_121', 'Cầu 1-2-3': 'cau_123',
    'Cầu 3-2-1': 'cau_321', 'Cầu 2-1-2': 'cau_212', 'Cầu 1-2-2-1': 'cau_1221',
    'Cầu 2-1-1-2': 'cau_2112', 'Cầu nhảy cóc': 'cau_nhay_coc',
    'Cầu nhịp nghiêng': 'cau_nhip_nghieng', 'Cầu 3 ván 1': 'cau_3van1',
    'Cầu bẻ cầu': 'cau_be_cau', 'Cầu gấp': 'cau_gap',
    'Cầu ziczac': 'cau_ziczac', 'Cầu đôi': 'cau_doi', 'Cầu rồng': 'cau_rong',
    'Đảo xu hướng': 'smart_bet', 'Xu hướng cực': 'smart_bet',
    'Phân bố lệch': 'distribution', 'Theo ván trước': 'cau_tu_nhien',
    'Dây gãy': 'day_gay', 'Wave pattern': 'wave',
    'Golden ratio': 'golden_ratio', 'LSTM pattern': 'lstm_pattern',
    'Markov chain': 'markov_chain', 'Neural boost': 'neural_boost',
    'Break streak': 'break_streak', 'Triple pattern': 'triple_pattern',
    'Double pair break': 'double_pair_break', 'Harmonic pattern': 'harmonic_pattern',
    'Sentiment': 'sentiment_analysis', 'Tổng phân tích': 'tong_phan_tich',
    'Xu hướng mạnh': 'xu_huong_manh', 'Đảo chiều': 'dao_chieu',
    'Alternating break': 'alternating_break', 'Smart bet': 'smart_bet'
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
  
  if (accuracy > 0.7) return 8;
  if (accuracy > 0.6) return 5;
  if (accuracy > 0.55) return 2;
  if (accuracy < 0.35) return -8;
  if (accuracy < 0.45) return -4;
  
  return 0;
}

function getSmartPredictionAdjustment(type, prediction, patterns) {
  const streakInfo = learningData[type].streakAnalysis;
  
  if (streakInfo.currentStreak <= -4) {
    return prediction === 'Tài' ? 'Xỉu' : 'Tài';
  }
  
  let taiPatternScore = 0;
  let xiuPatternScore = 0;
  let patternCount = 0;
  
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
        patternCount++;
      }
    }
  });
  
  if (patternCount >= 3 && Math.abs(taiPatternScore - xiuPatternScore) > 0.8) {
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
  res.send('🤖 API Dự đoán Tài Xỉu - @tiendataox\n📊 Phiên bản 8.0 - Dự đoán chính xác, không random');
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
  res.json({ message: 'Reset dữ liệu học tập thành công' });
});

loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║     🎲 API DỰ ĐOÁN TÀI XỈU - NÂNG CẤP VIP 🎲                ║
║                      @tiendataox                            ║
╠══════════════════════════════════════════════════════════════╣
║  📡 Server: http://0.0.0.0:${PORT}                            ║
║  🎯 Loại bỏ hoàn toàn random - Dự đoán thực tế 100%          ║
╠══════════════════════════════════════════════════════════════╣
║  🧠 MACHINE LEARNING NÂNG CAO:                               ║
║     • Neural Network 2 lớp ẩn                               ║
║     • LSTM Pattern - Phân tích chuỗi dài hạn                ║
║     • Markov Chain - Ma trận xác suất                       ║
║     • Harmonic Pattern - Sóng Elliott                       ║
║     • Sentiment Analysis - FOMO/Panic                       ║
║                                                            ║
║  📊 45+ PATTERN CHUYÊN SÂU:                                 ║
║     • Cầu bệt, đảo 1-1, 2-2, 3-3, 4-4, 5-5                ║
║     • Cầu 1-2-1, 1-2-3, 3-2-1, 2-1-2                      ║
║     • Cầu 1-2-2-1, 2-1-1-2, rồng, bẻ cầu                  ║
║     • Wave pattern, Fibonacci, Golden ratio                ║
║     • Phân bố lệch, xu hướng mạnh, đảo chiều               ║
║                                                            ║
║  📁 FILE DỮ LIỆU:                                          ║
║     • tiendat.json - Học tập Machine Learning              ║
║     • tiendat1.json - Lịch sử dự đoán                      ║
║                                                            ║
║  🔄 Auto-save: mỗi ${AUTO_SAVE_INTERVAL/1000}s                  ║
╚══════════════════════════════════════════════════════════════╝
  `);
  
  startAutoSaveTask();
});