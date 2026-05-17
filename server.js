const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

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
    recentAccuracy: []
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
    recentAccuracy: []
  }
};

const DEFAULT_PATTERN_WEIGHTS = {
  'cau_bet': 1.3, 'cau_dao_11': 1.2, 'cau_22': 1.1, 'cau_33': 1.1,
  'cau_121': 1.1, 'cau_123': 1.0, 'cau_321': 1.0, 'cau_nhay_coc': 1.0,
  'cau_nhip_nghieng': 1.0, 'cau_3van1': 1.0, 'cau_be_cau': 1.1,
  'cau_chu_ky': 1.0, 'distribution': 1.0, 'dice_pattern': 1.0,
  'sum_trend': 1.0, 'edge_cases': 1.0, 'momentum': 1.0, 'cau_tu_nhien': 0.8,
  'cau_rong': 1.3, 'smart_bet': 1.2, 'break_streak': 1.2,
  'alternating_break': 1.1, 'double_pair_break': 1.1, 'triple_pattern': 1.1,
  'tong_phan_tich': 1.5, 'xu_huong_manh': 1.4, 'dao_chieu': 1.4,
  'fibonacci': 1.2, 'golden_ratio': 1.2, 'wave': 1.1,
  'cau_thoi_gian': 1.2, 'cau_doi_xung': 1.3, 'cau_tang_truong': 1.3,
  'thuat_toan_genetic': 1.3, 'fuzzy_logic': 1.3, 'knn_pattern': 1.3,
  'bayesian_inference': 1.3, 'entropy_analysis': 1.2, 'chaos_theory': 1.2,
  'monte_carlo': 1.3, 'time_series': 1.2, 'kalman_filter': 1.2
};

// ==================== THUẬT TOÁN NÂNG CẤP ====================

function calculateVolatility(sums) {
  if (sums.length < 2) return 0;
  const mean = sums.reduce((a, b) => a + b, 0) / sums.length;
  const variance = sums.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / sums.length;
  return Math.sqrt(variance);
}

function analyzeCauBet(results, type) {
  if (results.length < 3) return { detected: false };
  
  let streakType = results[0];
  let streakLength = 1;
  
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) streakLength++;
    else break;
  }
  
  if (streakLength >= 3) {
    const weight = getPatternWeight(type, 'cau_bet');
    let confidence = 65;
    let prediction = streakType === 'Tài' ? 'Xỉu' : 'Tài';
    
    if (streakLength >= 7) confidence = 88;
    else if (streakLength >= 5) confidence = 80;
    else if (streakLength >= 3) confidence = 72;
    
    return { 
      detected: true, 
      prediction,
      confidence: Math.round(confidence * weight),
      name: `💰 Cầu bệt ${streakLength} phiên ${streakType} → ${prediction}`,
      patternId: 'cau_bet'
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
    const weight = getPatternWeight(type, 'cau_dao_11');
    const confidence = Math.min(80, 65 + alternatingLength * 2);
    const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    
    return { 
      detected: true, 
      prediction,
      confidence: Math.round(confidence * weight),
      name: `🔄 Cầu đảo ${alternatingLength} phiên → ${prediction}`,
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
    } else break;
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
      const prediction = lastPairType === 'Tài' ? 'Xỉu' : 'Tài';
      
      return { 
        detected: true, 
        prediction,
        confidence: Math.round(Math.min(78, 65 + pairCount * 3) * weight),
        name: `📊 Cầu 2-2 (${pairCount} cặp) → ${prediction}`,
        patternId: 'cau_22'
      };
    }
  }
  return { detected: false };
}

function analyzeCau33(results, type) {
  if (results.length < 9) return { detected: false };
  
  let tripleCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 2 && tripleCount < 3) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
      pattern.push(results[i]);
      tripleCount++;
      i += 3;
    } else break;
  }
  
  if (tripleCount >= 1) {
    const lastTripleType = pattern[pattern.length - 1];
    const weight = getPatternWeight(type, 'cau_33');
    const prediction = lastTripleType === 'Tài' ? 'Xỉu' : 'Tài';
    
    return { 
      detected: true, 
      prediction,
      confidence: Math.round(Math.min(82, 68 + tripleCount * 4) * weight),
      name: `🎲 Cầu 3-3 (${tripleCount} bộ ba) → ${prediction}`,
      patternId: 'cau_33'
    };
  }
  return { detected: false };
}

function analyzeCauRong(results, type) {
  if (results.length < 6) return { detected: false };
  
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) streakLength++;
    else break;
  }
  
  if (streakLength >= 6) {
    const weight = getPatternWeight(type, 'cau_rong');
    const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    
    return { 
      detected: true, 
      prediction,
      confidence: Math.round(Math.min(88, 75 + streakLength) * weight),
      name: `🐉 Cầu rồng ${streakLength} phiên → ${prediction}`,
      patternId: 'cau_rong'
    };
  }
  return { detected: false };
}

function analyzeTongPhanTich(data, type) {
  if (data.length < 10) return { detected: false };
  
  const sums = data.slice(0, 10).map(d => d.Tong);
  const results = data.slice(0, 10).map(d => d.Ket_qua);
  
  const avgSum = sums.reduce((a, b) => a + b, 0) / sums.length;
  const taiCount = results.filter(r => r === 'Tài').length;
  const xiuCount = 10 - taiCount;
  
  const weight = getPatternWeight(type, 'tong_phan_tich');
  
  if (avgSum > 11.5) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: Math.round(70 * weight),
      name: `📈 Tổng điểm TB cao (${avgSum.toFixed(1)}) → Tài`,
      patternId: 'tong_phan_tich'
    };
  } else if (avgSum < 9.5) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: Math.round(70 * weight),
      name: `📉 Tổng điểm TB thấp (${avgSum.toFixed(1)}) → Xỉu`,
      patternId: 'tong_phan_tich'
    };
  }
  
  if (Math.abs(taiCount - xiuCount) >= 3) {
    const prediction = taiCount > xiuCount ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: Math.round(68 * weight),
      name: `⚖️ Bù tỷ lệ (Tài:${taiCount} Xỉu:${xiuCount}) → ${prediction}`,
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
      confidence: Math.round(78 * weight),
      name: `🔥 Xu hướng Tài mạnh (${taiCount}/8) → Đảo Xỉu`,
      patternId: 'xu_huong_manh'
    };
  } else if (taiCount <= 2) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: Math.round(78 * weight),
      name: `🔥 Xu hướng Xỉu mạnh (${8-taiCount}/8) → Đảo Tài`,
      patternId: 'xu_huong_manh'
    };
  }
  return { detected: false };
}

function analyzeCau121(results, type) {
  if (results.length < 5) return { detected: false };
  
  if (results[0] !== results[1] && results[1] === results[2] && 
      results[2] !== results[3] && results[0] === results[3]) {
    const weight = getPatternWeight(type, 'cau_121');
    return { 
      detected: true, 
      prediction: results[0],
      confidence: Math.round(72 * weight),
      name: `⚡ Cầu 1-2-1 → ${results[0]}`,
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
        prediction: first,
        confidence: Math.round(74 * weight),
        name: `📐 Cầu 1-2-3 → ${first}`,
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
  
  const first3Same = first3.every(r => r === first3[0]);
  const next2Same = next2.every(r => r === next2[0]);
  
  if (first3Same && next2Same && first3[0] !== next2[0]) {
    const weight = getPatternWeight(type, 'cau_321');
    return { 
      detected: true, 
      prediction: next2[0],
      confidence: Math.round(76 * weight),
      name: `📐 Cầu 3-2-1 → ${next2[0]}`,
      patternId: 'cau_321'
    };
  }
  return { detected: false };
}

function analyzeSmartBet(results, type) {
  if (results.length < 10) return { detected: false };
  
  const weight = getPatternWeight(type, 'smart_bet');
  const last5 = results.slice(0, 5);
  const prev5 = results.slice(5, 10);
  
  const taiLast5 = last5.filter(r => r === 'Tài').length;
  const taiPrev5 = prev5.filter(r => r === 'Tài').length;
  
  const trendChanging = (taiLast5 >= 4 && taiPrev5 <= 1) || (taiLast5 <= 1 && taiPrev5 >= 4);
  
  if (trendChanging) {
    const prediction = taiLast5 >= 4 ? 'Xỉu' : 'Tài';
    return { 
      detected: true, 
      prediction,
      confidence: Math.round(78 * weight),
      name: `🎯 Đảo xu hướng (${taiLast5}T-${5-taiLast5}X) → ${prediction}`,
      patternId: 'smart_bet'
    };
  }
  return { detected: false };
}

function analyzeFibonacci(sums, type) {
  if (sums.length < 10) return { detected: false };
  
  const recent = sums.slice(0, 10);
  const maxSum = Math.max(...recent);
  const minSum = Math.min(...recent);
  const range = maxSum - minSum;
  const fib618 = minSum + range * 0.618;
  const lastSum = sums[0];
  const weight = getPatternWeight(type, 'fibonacci');
  
  if (Math.abs(lastSum - fib618) < 1.5) {
    const prediction = lastSum > 11 ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: Math.round(72 * weight),
      name: `📐 Fibonacci (chạm ngưỡng 0.618) → ${prediction}`,
      patternId: 'fibonacci'
    };
  }
  return { detected: false };
}

function analyzeGoldenRatio(results, sums, type) {
  if (results.length < 20) return { detected: false };
  
  const taiWins = [];
  const xiuWins = [];
  
  for (let i = 0; i < Math.min(results.length, 30); i++) {
    if (results[i] === 'Tài') taiWins.push(sums[i]);
    else xiuWins.push(sums[i]);
  }
  
  const avgTai = taiWins.reduce((a, b) => a + b, 0) / taiWins.length;
  const avgXiu = xiuWins.reduce((a, b) => a + b, 0) / xiuWins.length;
  const ratio = avgTai / avgXiu;
  const weight = getPatternWeight(type, 'golden_ratio');
  
  if (Math.abs(ratio - 1.618) < 0.2) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: Math.round(74 * weight),
      name: `✨ Tỷ lệ vàng ${ratio.toFixed(3)} → Tài`,
      patternId: 'golden_ratio'
    };
  }
  if (Math.abs(ratio - 0.618) < 0.1) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: Math.round(74 * weight),
      name: `✨ Tỷ lệ vàng ${ratio.toFixed(3)} → Xỉu`,
      patternId: 'golden_ratio'
    };
  }
  return { detected: false };
}

function analyzeMonteCarlo(results, type) {
  if (results.length < 30) return { detected: false };
  
  const weight = getPatternWeight(type, 'monte_carlo');
  const simulations = 500;
  let taiWins = 0;
  
  for (let sim = 0; sim < simulations; sim++) {
    const randomIndex = Math.floor(Math.random() * (results.length - 6));
    const pattern = results.slice(randomIndex, randomIndex + 5);
    const nextResult = results[randomIndex - 1];
    
    if (pattern.join('') === results.slice(0, 5).join('')) {
      if (nextResult === 'Tài') taiWins++;
    }
  }
  
  const taiProbability = taiWins / simulations;
  if (taiProbability > 0.6 || taiProbability < 0.4) {
    const prediction = taiProbability > 0.6 ? 'Tài' : 'Xỉu';
    return {
      detected: true,
      prediction,
      confidence: Math.round(65 + Math.abs(taiProbability - 0.5) * 40),
      name: `🎲 Monte Carlo (${(taiProbability * 100).toFixed(0)}%) → ${prediction}`,
      patternId: 'monte_carlo'
    };
  }
  return { detected: false };
}

function analyzeFuzzyLogic(results, sums, type) {
  if (results.length < 10) return { detected: false };
  
  const weight = getPatternWeight(type, 'fuzzy_logic');
  const taiRatio = results.slice(0, 10).filter(r => r === 'Tài').length / 10;
  const avgSum = sums.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
  const volatility = calculateVolatility(sums.slice(0, 10));
  
  let taiScore = 0, xiuScore = 0;
  
  if (taiRatio > 0.7) xiuScore += 30;
  else if (taiRatio > 0.6) xiuScore += 20;
  
  if (avgSum > 12) taiScore += 25;
  else if (avgSum > 11) taiScore += 15;
  else if (avgSum < 9) xiuScore += 25;
  else if (avgSum < 10) xiuScore += 15;
  
  if (volatility > 3) {
    if (results[0] === 'Tài') xiuScore += 20;
    else taiScore += 20;
  }
  
  if (Math.abs(taiScore - xiuScore) > 20) {
    const prediction = taiScore > xiuScore ? 'Tài' : 'Xỉu';
    return {
      detected: true,
      prediction,
      confidence: Math.min(85, Math.round(65 + Math.abs(taiScore - xiuScore) / 4)),
      name: `🧠 Logic mờ → ${prediction}`,
      patternId: 'fuzzy_logic'
    };
  }
  return { detected: false };
}

function analyzeKNN(results, type) {
  if (results.length < 20) return { detected: false };
  
  const weight = getPatternWeight(type, 'knn_pattern');
  const k = 5;
  const currentPattern = results.slice(0, 5);
  const distances = [];
  
  for (let i = 5; i < results.length - 1; i++) {
    const pattern = results.slice(i, i + 5);
    let distance = 0;
    for (let j = 0; j < 5; j++) {
      if (pattern[j] !== currentPattern[j]) distance++;
    }
    distances.push({ distance, nextResult: results[i - 1] });
  }
  
  distances.sort((a, b) => a.distance - b.distance);
  const nearest = distances.slice(0, k);
  const taiCount = nearest.filter(n => n.nextResult === 'Tài').length;
  
  if (taiCount >= 4 || taiCount <= 1) {
    const prediction = taiCount >= 4 ? 'Tài' : 'Xỉu';
    return {
      detected: true,
      prediction,
      confidence: 70,
      name: `👥 KNN (${taiCount}/${k} mẫu) → ${prediction}`,
      patternId: 'knn_pattern'
    };
  }
  return { detected: false };
}

function analyzeEntropy(results, type) {
  if (results.length < 15) return { detected: false };
  
  const weight = getPatternWeight(type, 'entropy_analysis');
  const taiCount = results.slice(0, 15).filter(r => r === 'Tài').length;
  const pTai = taiCount / 15;
  const pXiu = 1 - pTai;
  
  let entropy = 0;
  if (pTai > 0) entropy -= pTai * Math.log2(pTai);
  if (pXiu > 0) entropy -= pXiu * Math.log2(pXiu);
  
  if (entropy < 0.8) {
    const prediction = pTai > 0.6 ? 'Tài' : (pXiu > 0.6 ? 'Xỉu' : null);
    if (prediction) {
      return {
        detected: true,
        prediction,
        confidence: 75,
        name: `📊 Entropy thấp (${entropy.toFixed(2)}bit) → ${prediction}`,
        patternId: 'entropy_analysis'
      };
    }
  }
  return { detected: false };
}

function analyzeDistribution(data, type, windowSize = 50) {
  const window = data.slice(0, windowSize);
  const taiCount = window.filter(d => d.Ket_qua === 'Tài').length;
  return {
    taiPercent: (taiCount / window.length) * 100,
    imbalance: Math.abs(taiCount - (window.length - taiCount)) / window.length
  };
}

function analyzeCauTuNhien(results, type) {
  if (results.length < 2) return { detected: false };
  const weight = getPatternWeight(type, 'cau_tu_nhien');
  return { 
    detected: true, 
    prediction: results[0],
    confidence: Math.round(60 * weight),
    name: `📌 Theo cầu tự nhiên → ${results[0]}`,
    patternId: 'cau_tu_nhien'
  };
}

// ==================== HÀM DỰ ĐOÁN CHÍNH ====================

function calculateAdvancedPrediction(data, type) {
  const last50 = data.slice(0, 50);
  const results = last50.map(d => d.Ket_qua);
  const sums = last50.map(d => d.Tong);
  
  initializePatternStats(type);
  
  let predictions = [];
  let factors = [];
  let allPatterns = [];
  
  const patterns = [
    { name: 'Cầu bệt', func: () => analyzeCauBet(results, type), priority: 15 },
    { name: 'Cầu đảo 1-1', func: () => analyzeCauDao11(results, type), priority: 14 },
    { name: 'Cầu rồng', func: () => analyzeCauRong(results, type), priority: 14 },
    { name: 'Tổng phân tích', func: () => analyzeTongPhanTich(last50, type), priority: 13 },
    { name: 'Xu hướng mạnh', func: () => analyzeXuHuongManh(results, type), priority: 13 },
    { name: 'Monte Carlo', func: () => analyzeMonteCarlo(results, type), priority: 12 },
    { name: 'KNN', func: () => analyzeKNN(results, type), priority: 12 },
    { name: 'Cầu 2-2', func: () => analyzeCau22(results, type), priority: 11 },
    { name: 'Cầu 3-3', func: () => analyzeCau33(results, type), priority: 11 },
    { name: 'Smart Bet', func: () => analyzeSmartBet(results, type), priority: 11 },
    { name: 'Fibonacci', func: () => analyzeFibonacci(sums, type), priority: 10 },
    { name: 'Golden Ratio', func: () => analyzeGoldenRatio(results, sums, type), priority: 10 },
    { name: 'Logic mờ', func: () => analyzeFuzzyLogic(results, sums, type), priority: 10 },
    { name: 'Entropy', func: () => analyzeEntropy(results, type), priority: 9 },
    { name: 'Cầu 1-2-1', func: () => analyzeCau121(results, type), priority: 9 },
    { name: 'Cầu 1-2-3', func: () => analyzeCau123(results, type), priority: 8 },
    { name: 'Cầu 3-2-1', func: () => analyzeCau321(results, type), priority: 8 }
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
  if (distribution.imbalance > 0.15) {
    const minority = distribution.taiPercent < 50 ? 'Tài' : 'Xỉu';
    predictions.push({ 
      prediction: minority, 
      confidence: 65, 
      priority: 5, 
      name: `📊 Phân bố lệch (T:${distribution.taiPercent.toFixed(0)}%)` 
    });
    factors.push(`Phân bố lệch`);
  }
  
  if (predictions.length === 0) {
    const cauTuNhien = analyzeCauTuNhien(results, type);
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
  
  const streakInfo = learningData[type].streakAnalysis;
  if (streakInfo.currentStreak <= -3) {
    if (taiScore > xiuScore) xiuScore *= 1.3;
    else taiScore *= 1.3;
  }
  
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  finalPrediction = getSmartPredictionAdjustment(type, finalPrediction, allPatterns);
  
  let baseConfidence = 65;
  const topPredictions = predictions.slice(0, 3);
  topPredictions.forEach(p => {
    if (p.prediction === finalPrediction) {
      baseConfidence += (p.confidence - 65) * 0.3;
    }
  });
  
  const agreementRatio = (finalPrediction === 'Tài' ? taiVotes.length : xiuVotes.length) / predictions.length;
  baseConfidence += agreementRatio * 10;
  
  const adaptiveBoost = getAdaptiveConfidenceBoost(type);
  baseConfidence += adaptiveBoost;
  
  let finalConfidence = Math.round(baseConfidence);
  finalConfidence = Math.max(60, Math.min(92, finalConfidence));
  
  return {
    prediction: finalPrediction,
    confidence: finalConfidence,
    factors,
    allPatterns,
    detailedAnalysis: {
      totalPatterns: predictions.length,
      taiVotes: taiVotes.length,
      xiuVotes: xiuVotes.length,
      topPattern: predictions[0]?.name || 'N/A',
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
      Object.assign(learningData, parsed);
      console.log('✅ Loaded learning data');
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
      console.log('✅ Loaded prediction history');
    }
  } catch (error) {
    console.error('Error loading prediction history:', error.message);
  }
}

function savePredictionHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      history: predictionHistory,
      lastProcessedPhien,
      lastSaved: new Date().toISOString()
    }, null, 2));
  } catch (error) {
    console.error('Error saving prediction history:', error.message);
  }
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

function initializePatternStats(type) {
  if (!learningData[type].patternWeights || Object.keys(learningData[type].patternWeights).length === 0) {
    learningData[type].patternWeights = { ...DEFAULT_PATTERN_WEIGHTS };
  }
  Object.keys(DEFAULT_PATTERN_WEIGHTS).forEach(pattern => {
    if (!learningData[type].patternStats[pattern]) {
      learningData[type].patternStats[pattern] = {
        total: 0, correct: 0, accuracy: 0.5, recentResults: [], lastAdjustment: null
      };
    }
  });
}

function getPatternWeight(type, patternId) {
  initializePatternStats(type);
  return learningData[type].patternWeights[patternId] || 1.0;
}

function updatePatternPerformance(type, patternId, isCorrect) {
  const stats = learningData[type].patternStats[patternId];
  if (!stats) return;
  stats.total++;
  if (isCorrect) stats.correct++;
  stats.recentResults.push(isCorrect ? 1 : 0);
  if (stats.recentResults.length > 20) stats.recentResults.shift();
  
  const recentAccuracy = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
  const oldWeight = learningData[type].patternWeights[patternId];
  let newWeight = oldWeight;
  if (stats.recentResults.length >= 5) {
    if (recentAccuracy > 0.65) newWeight = Math.min(3.0, oldWeight * 1.1);
    else if (recentAccuracy < 0.35) newWeight = Math.max(0.2, oldWeight * 0.9);
  }
  learningData[type].patternWeights[patternId] = newWeight;
}

function getPatternIdFromName(name) {
  const mapping = {
    'Cầu bệt': 'cau_bet', 'Cầu đảo': 'cau_dao_11', 'Cầu 2-2': 'cau_22',
    'Cầu 3-3': 'cau_33', 'Cầu 1-2-1': 'cau_121', 'Cầu 1-2-3': 'cau_123',
    'Cầu 3-2-1': 'cau_321', 'Cầu rồng': 'cau_rong', 'Smart Bet': 'smart_bet',
    'Tổng phân tích': 'tong_phan_tich', 'Xu hướng mạnh': 'xu_huong_manh',
    'Fibonacci': 'fibonacci', 'Golden Ratio': 'golden_ratio', 'KNN': 'knn_pattern',
    'Logic mờ': 'fuzzy_logic', 'Monte Carlo': 'monte_carlo', 'Entropy': 'entropy_analysis'
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
  
  let taiScore = 0, xiuScore = 0;
  patterns.forEach(p => {
    const patternId = getPatternIdFromName(p.name);
    if (patternId) {
      const stats = learningData[type].patternStats[patternId];
      if (stats && stats.recentResults.length >= 5) {
        const recentAcc = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
        const weight = learningData[type].patternWeights[patternId] || 1;
        if (p.prediction === 'Tài') taiScore += recentAcc * weight;
        else xiuScore += recentAcc * weight;
      }
    }
  });
  
  if (Math.abs(taiScore - xiuScore) > 0.7) {
    return taiScore > xiuScore ? 'Tài' : 'Xỉu';
  }
  return prediction;
}

function recordPrediction(type, phien, prediction, confidence, factors) {
  learningData[type].predictions.unshift({
    phien: phien.toString(), prediction, confidence, factors,
    timestamp: new Date().toISOString(), verified: false, actual: null, isCorrect: null
  });
  learningData[type].totalPredictions++;
  if (learningData[type].predictions.length > 500) learningData[type].predictions.pop();
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
      const predictedNormalized = pred.prediction === 'Tài' ? 'Tài' : 'Xỉu';
      pred.isCorrect = pred.actual === predictedNormalized;
      
      if (pred.isCorrect) {
        learningData[type].correctPredictions++;
        learningData[type].streakAnalysis.wins++;
        learningData[type].streakAnalysis.currentStreak = Math.max(1, learningData[type].streakAnalysis.currentStreak + 1);
        if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
          learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
        }
      } else {
        learningData[type].streakAnalysis.losses++;
        learningData[type].streakAnalysis.currentStreak = Math.min(-1, learningData[type].streakAnalysis.currentStreak - 1);
        if (learningData[type].streakAnalysis.currentStreak < learningData[type].streakAnalysis.worstStreak) {
          learningData[type].streakAnalysis.worstStreak = learningData[type].streakAnalysis.currentStreak;
        }
      }
      
      learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 50) learningData[type].recentAccuracy.shift();
      
      if (pred.factors) {
        for (const factor of pred.factors) {
          const patternId = getPatternIdFromName(factor);
          if (patternId) updatePatternPerformance(type, patternId, pred.isCorrect);
        }
      }
      updated = true;
    }
  }
  if (updated) saveLearningData();
}

async function updateHistoryStatus(type) {
  try {
    const data = type === 'hu' ? await fetchDataHu() : await fetchDataMd5();
    if (!data) return;
    let updated = false;
    for (const record of predictionHistory[type]) {
      if (record.ket_qua_du_doan && record.ket_qua_du_doan !== '') continue;
      const actualResult = data.find(d => d.Phien.toString() === record.Phien_hien_tai);
      if (actualResult) {
        record.ket_qua_du_doan = record.Du_doan === actualResult.Ket_qua ? 'Đúng ✅' : 'Sai ❌';
        updated = true;
      }
    }
    if (updated) savePredictionHistory();
  } catch (error) {
    console.error(`Error updating ${type} history:`, error.message);
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
  if (predictionHistory[type].length > MAX_HISTORY) predictionHistory[type].pop();
  return record;
}

async function autoProcessPredictions() {
  try {
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      const nextHuPhien = dataHu[0].Phien + 1;
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
      const nextMd5Phien = dataMd5[0].Phien + 1;
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
    console.error('[Auto] Error:', error.message);
  }
}

function startAutoSaveTask() {
  setTimeout(() => autoProcessPredictions(), 5000);
  setInterval(() => autoProcessPredictions(), AUTO_SAVE_INTERVAL);
}

// ==================== ENDPOINTS (GIỮ NGUYÊN FORMAT CŨ) ====================

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send('t.me/CuTools');
});

app.get('/lc79-hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data || data.length === 0) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    
    await verifyPredictions('hu', data);
    const result = calculateAdvancedPrediction(data, 'hu');
    const record = savePredictionToHistory('hu', data[0].Phien + 1, result.prediction, result.confidence, data[0]);
    recordPrediction('hu', data[0].Phien + 1, result.prediction, result.confidence, result.factors);
    
    setTimeout(() => updateHistoryStatus('hu'), 5000);
    
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
      id: record.id
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-md5', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data || data.length === 0) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    
    await verifyPredictions('md5', data);
    const result = calculateAdvancedPrediction(data, 'md5');
    const record = savePredictionToHistory('md5', data[0].Phien + 1, result.prediction, result.confidence, data[0]);
    recordPrediction('md5', data[0].Phien + 1, result.prediction, result.confidence, result.factors);
    
    setTimeout(() => updateHistoryStatus('md5'), 5000);
    
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
      id: record.id
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-hu/lichsu', async (req, res) => {
  await updateHistoryStatus('hu');
  res.json({ type: 'Lẩu Cua 79 - Tài Xỉu Hũ', history: predictionHistory.hu, total: predictionHistory.hu.length });
});

app.get('/lc79-md5/lichsu', async (req, res) => {
  await updateHistoryStatus('md5');
  res.json({ type: 'Lẩu Cua 79 - Tài Xỉu MD5', history: predictionHistory.md5, total: predictionHistory.md5.length });
});

app.get('/lc79-hu/analysis', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    await verifyPredictions('hu', data);
    const result = calculateAdvancedPrediction(data, 'hu');
    res.json({ prediction: result.prediction, confidence: result.confidence, factors: result.factors, analysis: result.detailedAnalysis });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-md5/analysis', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    await verifyPredictions('md5', data);
    const result = calculateAdvancedPrediction(data, 'md5');
    res.json({ prediction: result.prediction, confidence: result.confidence, factors: result.factors, analysis: result.detailedAnalysis });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-hu/learning', (req, res) => {
  const stats = learningData.hu;
  const accuracy = stats.totalPredictions > 0 ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  res.json({ type: 'Lẩu Cua 79 - Tài Xỉu Hũ', totalPredictions: stats.totalPredictions, correctPredictions: stats.correctPredictions, overallAccuracy: `${accuracy}%`, streakAnalysis: stats.streakAnalysis });
});

app.get('/lc79-md5/learning', (req, res) => {
  const stats = learningData.md5;
  const accuracy = stats.totalPredictions > 0 ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  res.json({ type: 'Lẩu Cua 79 - Tài Xỉu MD5', totalPredictions: stats.totalPredictions, correctPredictions: stats.correctPredictions, overallAccuracy: `${accuracy}%`, streakAnalysis: stats.streakAnalysis });
});

app.get('/reset-learning', (req, res) => {
  learningData = {
    hu: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: { ...DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, adaptiveThresholds: {}, recentAccuracy: [] },
    md5: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: { ...DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, adaptiveThresholds: {}, recentAccuracy: [] }
  };
  saveLearningData();
  res.json({ message: 'Learning data reset successfully' });
});

// Khởi động server
loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔════════════════════════════════════════════════════════════╗`);
  console.log(`║   🎲 TÀI XỈU PREDICTOR PRO v9.0 - NÂNG CẤP SIÊU CẤP 🎲   ║`);
  console.log(`╠════════════════════════════════════════════════════════════╣`);
  console.log(`║  🚀 Server: http://0.0.0.0:${PORT}                          ║`);
  console.log(`║  📊 Status: Running                                        ║`);
  console.log(`║  🧠 Thuật toán: 20+ pattern thông minh                    ║`);
  console.log(`║  💡 Cầu bệt, cầu đảo, cầu 2-2, 3-3, cầu rồng             ║`);
  console.log(`║  💡 Tổng điểm, Fibonacci, Golden Ratio, KNN               ║`);
  console.log(`║  💡 Logic mờ, Monte Carlo, Entropy, Smart Bet             ║`);
  console.log(`╠════════════════════════════════════════════════════════════╣`);
  console.log(`║  📁 Files: tiendat.json, tiendat1.json                     ║`);
  console.log(`║  🆔 Author: @tiendataox                                    ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝\n`);
  
  startAutoSaveTask();
});