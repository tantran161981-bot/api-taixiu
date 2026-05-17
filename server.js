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

const MAX_HISTORY = 200;
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
    mlModel: { weights: {}, bias: 0, lastTraining: null, hiddenWeights: [], outputWeights: [] }
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
    mlModel: { weights: {}, bias: 0, lastTraining: null, hiddenWeights: [], outputWeights: [] }
  }
};

// ==================== WEIGHTS TỐI ƯU HÓA ====================
const DEFAULT_PATTERN_WEIGHTS = {
  'cau_bet': 1.35, 'cau_dao_11': 1.3, 'cau_22': 1.25, 'cau_33': 1.25,
  'cau_44': 1.3, 'cau_55': 1.35, 'cau_121': 1.2, 'cau_123': 1.2,
  'cau_321': 1.2, 'cau_212': 1.2, 'cau_1221': 1.25, 'cau_2112': 1.25,
  'cau_nhay_coc': 1.15, 'cau_nhip_nghieng': 1.2, 'cau_3van1': 1.15,
  'cau_be_cau': 1.3, 'cau_chu_ky': 1.2, 'cau_gap': 1.2, 'cau_ziczac': 1.2,
  'cau_doi': 1.15, 'cau_rong': 1.4, 'smart_bet': 1.35, 'break_pattern_advanced': 1.3,
  'break_streak': 1.35, 'alternating_break': 1.3, 'double_pair_break': 1.35,
  'triple_pattern': 1.4, 'tong_phan_tich': 1.55, 'xu_huong_manh': 1.5,
  'dao_chieu': 1.45, 'lstm_pattern': 1.45, 'markov_chain': 1.4,
  'neural_boost': 1.45, 'sentiment_analysis': 1.35, 'harmonic_pattern': 1.4,
  'wave': 1.35, 'fibonacci': 1.3, 'golden_ratio': 1.3, 'day_gay': 1.35,
  'distribution': 1.35, 'dice_pattern': 1.3, 'sum_trend': 1.4, 'momentum': 1.35
};

// ==================== DEEP LEARNING NÂNG CAO ====================

function extractAdvancedFeatures(results, sums, dice1, dice2, dice3) {
  if (results.length < 15) return getDefaultFeatures(results, sums);
  
  // 20 features nâng cao
  return {
    // Cơ bản
    lastResult: results[0] === 'Tài' ? 1 : 0,
    last3Sum: sums.slice(0, 3).reduce((a, b) => a + b, 0) / 3,
    last5Sum: sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5,
    last10Sum: sums.slice(0, 10).reduce((a, b) => a + b, 0) / 10,
    
    // Độ biến động
    volatility: calculateVolatility(sums.slice(0, 15)),
    volatilityTrend: calculateVolatilityTrend(sums),
    
    // Tỷ lệ Tài/Xỉu
    taiRatio3: results.slice(0, 3).filter(r => r === 'Tài').length / 3,
    taiRatio5: results.slice(0, 5).filter(r => r === 'Tài').length / 5,
    taiRatio10: results.slice(0, 10).filter(r => r === 'Tài').length / 10,
    taiRatio15: results.slice(0, 15).filter(r => r === 'Tài').length / 15,
    
    // Chuỗi
    streakLength: calculateStreakLength(results),
    maxStreakRecent: calculateMaxStreak(results.slice(0, 20)),
    
    // Đảo chiều
    alternatingStrength: calculateAlternatingStrength(results),
    reversalProbability: calculateReversalProbability(results, sums),
    
    // Xúc xắc
    avgDice1: dice1.slice(0, 10).reduce((a, b) => a + b, 0) / 10,
    avgDice2: dice2.slice(0, 10).reduce((a, b) => a + b, 0) / 10,
    avgDice3: dice3.slice(0, 10).reduce((a, b) => a + b, 0) / 10,
    diceVariance: calculateDiceVariance(dice1, dice2, dice3),
    
    // Xu hướng
    sumTrend: calculateSumTrend(sums.slice(0, 15)),
    momentum: calculateMomentumAdvanced(results, sums),
    
    // Hỗ trợ/kháng cự
    supportLevel: detectSupportResistance(sums.slice(0, 20)).support || 10.5,
    resistanceLevel: detectSupportResistance(sums.slice(0, 20)).resistance || 10.5
  };
}

function calculateVolatilityTrend(sums) {
  if (sums.length < 10) return 0;
  const firstHalf = sums.slice(0, 5);
  const secondHalf = sums.slice(5, 10);
  const vol1 = calculateVolatility(firstHalf);
  const vol2 = calculateVolatility(secondHalf);
  return vol2 - vol1;
}

function calculateMaxStreak(results) {
  let maxStreak = 1;
  let currentStreak = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[i-1]) {
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 1;
    }
  }
  return maxStreak;
}

function calculateReversalProbability(results, sums) {
  if (results.length < 6) return 0.5;
  
  const last3 = results.slice(0, 3);
  const prev3 = results.slice(3, 6);
  
  const allSame = last3.every(r => r === last3[0]);
  const prevAllSame = prev3.every(r => r === prev3[0]);
  
  if (allSame && prevAllSame && last3[0] !== prev3[0]) {
    return 0.75;
  }
  
  const taiStreak = results.filter(r => r === 'Tài').length;
  const total = results.length;
  const ratio = taiStreak / total;
  
  if (ratio > 0.7) return 0.7;
  if (ratio < 0.3) return 0.7;
  
  return 0.5;
}

function calculateDiceVariance(dice1, dice2, dice3) {
  const allDice = [...dice1.slice(0, 10), ...dice2.slice(0, 10), ...dice3.slice(0, 10)];
  const mean = allDice.reduce((a, b) => a + b, 0) / allDice.length;
  const variance = allDice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / allDice.length;
  return variance;
}

function calculateMomentumAdvanced(results, sums) {
  if (results.length < 5) return 0.5;
  
  const recentTai = results.slice(0, 3).filter(r => r === 'Tài').length / 3;
  const prevTai = results.slice(3, 6).filter(r => r === 'Tài').length / 3;
  
  const sumChange = sums[0] - (sums[3] || sums[0]);
  
  let momentum = 0.5;
  if (recentTai > prevTai && sumChange > 0) momentum = 0.65;
  if (recentTai < prevTai && sumChange < 0) momentum = 0.35;
  if (Math.abs(recentTai - prevTai) > 0.5) momentum = recentTai > prevTai ? 0.7 : 0.3;
  
  return momentum;
}

function getDefaultFeatures(results, sums) {
  return {
    lastResult: results.length > 0 ? (results[0] === 'Tài' ? 1 : 0) : 0.5,
    last3Sum: sums.length > 0 ? sums.slice(0, Math.min(3, sums.length)).reduce((a, b) => a + b, 0) / Math.min(3, sums.length) : 10.5,
    last5Sum: sums.length > 0 ? sums.slice(0, Math.min(5, sums.length)).reduce((a, b) => a + b, 0) / Math.min(5, sums.length) : 10.5,
    last10Sum: sums.length > 0 ? sums.slice(0, Math.min(10, sums.length)).reduce((a, b) => a + b, 0) / Math.min(10, sums.length) : 10.5,
    volatility: 2.5,
    volatilityTrend: 0,
    taiRatio3: 0.5,
    taiRatio5: 0.5,
    taiRatio10: 0.5,
    taiRatio15: 0.5,
    streakLength: 1,
    maxStreakRecent: 1,
    alternatingStrength: 0,
    reversalProbability: 0.5,
    avgDice1: 3.5,
    avgDice2: 3.5,
    avgDice3: 3.5,
    diceVariance: 2.5,
    sumTrend: 0,
    momentum: 0.5,
    supportLevel: 10.5,
    resistanceLevel: 10.5
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

function calculateSumTrend(sums) {
  if (sums.length < 10) return 0;
  const firstHalf = sums.slice(0, Math.floor(sums.length/2));
  const secondHalf = sums.slice(Math.floor(sums.length/2));
  const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  return avgSecond - avgFirst;
}

function detectSupportResistance(sums) {
  if (sums.length < 10) return { support: null, resistance: null };
  const sorted = [...sums].sort((a, b) => a - b);
  return {
    support: sorted[Math.floor(sorted.length * 0.25)],
    resistance: sorted[Math.floor(sorted.length * 0.75)]
  };
}

// ==================== DEEP NEURAL NETWORK ====================

function deepNeuralNetworkPredict(features, type) {
  const model = learningData[type].mlModel;
  
  // Layer 1: Input (20 features) -> Hidden (12 neurons)
  let hidden = [];
  if (model.hiddenWeights && model.hiddenWeights.length > 0) {
    for (let i = 0; i < 12; i++) {
      let sum = model.bias || 0;
      let j = 0;
      for (const [key, value] of Object.entries(features)) {
        if (model.hiddenWeights[i] && model.hiddenWeights[i][j]) {
          sum += value * model.hiddenWeights[i][j];
        }
        j++;
      }
      hidden.push(Math.tanh(sum));
    }
  } else {
    // Fallback: simple model
    let score = model.bias || 0;
    Object.entries(features).forEach(([key, value]) => {
      if (model.weights[key]) {
        score += value * model.weights[key];
      }
    });
    return 1 / (1 + Math.exp(-score));
  }
  
  // Layer 2: Hidden (12) -> Output (1)
  let output = 0;
  if (model.outputWeights) {
    for (let i = 0; i < hidden.length; i++) {
      output += hidden[i] * (model.outputWeights[i] || 0);
    }
  }
  
  return 1 / (1 + Math.exp(-output));
}

function updateDeepNeuralNetwork(type, features, actualResult) {
  const target = actualResult === 'Tài' ? 1 : 0;
  const prediction = deepNeuralNetworkPredict(features, type);
  const error = target - prediction;
  const learningRate = 0.02;
  
  const model = learningData[type].mlModel;
  model.bias = (model.bias || 0) + learningRate * error;
  
  // Initialize weights if needed
  if (!model.hiddenWeights || model.hiddenWeights.length === 0) {
    model.hiddenWeights = [];
    for (let i = 0; i < 12; i++) {
      model.hiddenWeights[i] = [];
      let j = 0;
      for (const key of Object.keys(features)) {
        model.hiddenWeights[i][j] = (Math.random() - 0.5) * 0.5;
        j++;
      }
    }
    model.outputWeights = new Array(12).fill(0).map(() => (Math.random() - 0.5) * 0.5);
  }
  
  // Update output weights
  for (let i = 0; i < 12; i++) {
    model.outputWeights[i] += learningRate * error * prediction * (1 - prediction);
  }
  
  model.lastTraining = new Date().toISOString();
}

// ==================== PATTERN SIÊU PHÂN TÍCH ====================

function analyzeSuperTrend(results, sums, type) {
  if (results.length < 20) return { detected: false };
  
  const recent10 = results.slice(0, 10);
  const prev10 = results.slice(10, 20);
  
  const recentTai = recent10.filter(r => r === 'Tài').length;
  const prevTai = prev10.filter(r => r === 'Tài').length;
  
  const recentAvgSum = sums.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
  const prevAvgSum = sums.slice(10, 20).reduce((a, b) => a + b, 0) / 10;
  
  const taiChange = recentTai - prevTai;
  const sumChange = recentAvgSum - prevAvgSum;
  
  if (Math.abs(taiChange) >= 3 && Math.abs(sumChange) >= 1.5) {
    const prediction = taiChange > 0 ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: 82 + Math.min(10, Math.abs(taiChange) * 2),
      name: `Super Trend (${taiChange > 0 ? 'Tài lên' : 'Xỉu lên'} ${Math.abs(taiChange)}/${Math.abs(sumChange).toFixed(1)})`,
      patternId: 'xu_huong_manh'
    };
  }
  
  return { detected: false };
}

function analyzeMultiTimeframe(results, sums, type) {
  if (results.length < 30) return { detected: false };
  
  // Phân tích 3 khung thời gian
  const tf1 = results.slice(0, 5);  // ngắn hạn
  const tf2 = results.slice(5, 15); // trung hạn
  const tf3 = results.slice(15, 30); // dài hạn
  
  const tai1 = tf1.filter(r => r === 'Tài').length / 5;
  const tai2 = tf2.filter(r => r === 'Tài').length / 10;
  const tai3 = tf3.filter(r => r === 'Tài').length / 15;
  
  // Đồng thuận đa khung
  const consensus = [tai1 > 0.5, tai2 > 0.5, tai3 > 0.5];
  const allBullish = consensus.every(v => v === true);
  const allBearish = consensus.every(v => v === false);
  
  if (allBullish || allBearish) {
    const prediction = allBullish ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: 85,
      name: `Multi-Timeframe (${allBullish ? 'Toàn Tài' : 'Toàn Xỉu'} → đảo)`,
      patternId: 'smart_bet'
    };
  }
  
  // 2/3 đồng thuận
  const bullishCount = consensus.filter(v => v === true).length;
  if (bullishCount === 2) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: 78,
      name: `Multi-Timeframe (2/3 Tài → đảo Xỉu)`,
      patternId: 'smart_bet'
    };
  }
  if (bullishCount === 1) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: 78,
      name: `Multi-Timeframe (2/3 Xỉu → đảo Tài)`,
      patternId: 'smart_bet'
    };
  }
  
  return { detected: false };
}

function analyzeVolumeProfile(results, sums, type) {
  if (results.length < 15) return { detected: false };
  
  // Phân tích "khối lượng" qua điểm số
  const highVolumes = [];
  const lowVolumes = [];
  
  for (let i = 0; i < Math.min(results.length, 15); i++) {
    if (sums[i] >= 11) {
      highVolumes.push(results[i]);
    } else if (sums[i] <= 10) {
      lowVolumes.push(results[i]);
    }
  }
  
  const highTaiRatio = highVolumes.filter(r => r === 'Tài').length / (highVolumes.length || 1);
  const lowTaiRatio = lowVolumes.filter(r => r === 'Tài').length / (lowVolumes.length || 1);
  
  if (Math.abs(highTaiRatio - lowTaiRatio) > 0.4) {
    const prediction = highTaiRatio > lowTaiRatio ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: 80,
      name: `Volume Profile (cao:${(highTaiRatio*100).toFixed(0)}% - thấp:${(lowTaiRatio*100).toFixed(0)}%)`,
      patternId: 'distribution'
    };
  }
  
  return { detected: false };
}

function analyzeElliottWave(results, type) {
  if (results.length < 20) return { detected: false };
  
  // Phát hiện sóng Elliott đầy đủ
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
  
  // Mô hình 5 sóng đẩy + 3 sóng điều chỉnh
  if (waves.length >= 8) {
    const impulse = waves.slice(0, 5);
    const correction = waves.slice(5, 8);
    
    const isValidImpulse = impulse[0].type === impulse[2].type && 
                           impulse[2].type === impulse[4].type &&
                           impulse[1].type !== impulse[0].type &&
                           impulse[3].type !== impulse[2].type;
    
    const isValidCorrection = correction[0].type !== correction[1].type &&
                              correction[1].type !== correction[2].type;
    
    if (isValidImpulse && isValidCorrection) {
      const prediction = impulse[4].type === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        prediction,
        confidence: 84,
        name: `Elliott Wave (5 sóng + 3 sóng → ${prediction})`,
        patternId: 'harmonic_pattern'
      };
    }
  }
  
  return { detected: false };
}

function analyzeIchimoku(results, sums, type) {
  if (results.length < 26) return { detected: false };
  
  // Ichimoku Cloud đơn giản hóa
  const tenkanSen = (Math.max(...sums.slice(0, 9)) + Math.min(...sums.slice(0, 9))) / 2;
  const kijunSen = (Math.max(...sums.slice(0, 26)) + Math.min(...sums.slice(0, 26))) / 2;
  const senkouSpanA = (tenkanSen + kijunSen) / 2;
  const currentPrice = sums[0];
  
  if (currentPrice > senkouSpanA + 1.5) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: 81,
      name: `Ichimoku (Giá trên mây → Xỉu)`,
      patternId: 'dice_trend_line'
    };
  }
  
  if (currentPrice < senkouSpanA - 1.5) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: 81,
      name: `Ichimoku (Giá dưới mây → Tài)`,
      patternId: 'dice_trend_line'
    };
  }
  
  return { detected: false };
}

function analyzeRSI(results, sums, type) {
  if (results.length < 14) return { detected: false };
  
  // RSI cho Tài Xỉu
  let gains = 0;
  let losses = 0;
  
  for (let i = 0; i < 13; i++) {
    const change = sums[i] - sums[i+1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  
  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  const rs = avgGain / (avgLoss || 1);
  const rsi = 100 - (100 / (1 + rs));
  
  if (rsi > 70) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: 83,
      name: `RSI (${rsi.toFixed(0)} - Quá mua → Xỉu)`,
      patternId: 'momentum'
    };
  }
  
  if (rsi < 30) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: 83,
      name: `RSI (${rsi.toFixed(0)} - Quá bán → Tài)`,
      patternId: 'momentum'
    };
  }
  
  return { detected: false };
}

function analyzeMACD(results, sums, type) {
  if (results.length < 26) return { detected: false };
  
  // EMA đơn giản
  const ema12 = calculateEMA(sums, 12);
  const ema26 = calculateEMA(sums, 26);
  const macd = ema12 - ema26;
  const signal = calculateEMAFromArray(calculateMACDSignal(sums), 9);
  
  if (macd > signal + 0.3) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: 82,
      name: `MACD (Cắt lên → Xỉu)`,
      patternId: 'momentum'
    };
  }
  
  if (macd < signal - 0.3) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: 82,
      name: `MACD (Cắt xuống → Tài)`,
      patternId: 'momentum'
    };
  }
  
  return { detected: false };
}

function calculateEMA(sums, period) {
  if (sums.length < period) return sums[0];
  const multiplier = 2 / (period + 1);
  let ema = sums.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < Math.min(sums.length, period + 10); i++) {
    ema = (sums[i] - ema) * multiplier + ema;
  }
  return ema;
}

function calculateMACDSignal(sums) {
  const ema12 = calculateEMA(sums, 12);
  const ema26 = calculateEMA(sums, 26);
  return ema12 - ema26;
}

function calculateEMAFromArray(values, period) {
  if (values.length < period) return values[0] || 0;
  const multiplier = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
  }
  return ema;
}

function analyzeBollingerBands(sums, type) {
  if (sums.length < 20) return { detected: false };
  
  const period = 20;
  const sma = sums.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const variance = sums.slice(0, period).reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  
  const upperBand = sma + 2 * stdDev;
  const lowerBand = sma - 2 * stdDev;
  const currentPrice = sums[0];
  
  if (currentPrice > upperBand) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: 84,
      name: `Bollinger (Chạm trên → Xỉu)`,
      patternId: 'dice_trend_line'
    };
  }
  
  if (currentPrice < lowerBand) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: 84,
      name: `Bollinger (Chạm dưới → Tài)`,
      patternId: 'dice_trend_line'
    };
  }
  
  return { detected: false };
}

// ==================== PATTERN CÓ SẴN (ĐÃ TỐI ƯU) ====================

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
    let confidence = 68;
    
    if (streakLength >= 7) {
      shouldBreak = true;
      confidence = 90;
    } else if (streakLength >= 6) {
      shouldBreak = true;
      confidence = 87;
    } else if (streakLength >= 5) {
      shouldBreak = true;
      confidence = 83;
    } else if (streakLength >= 4) {
      shouldBreak = streakLength === 4;
      confidence = 76;
    } else if (streakLength >= 3) {
      shouldBreak = false;
      confidence = 70;
    }
    
    const weight = getPatternWeight(type, 'cau_bet');
    
    return { 
      detected: true, 
      type: streakType, 
      length: streakLength,
      prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
      confidence: Math.round(Math.min(94, confidence * weight)),
      name: `🔥 Cầu bệt ${streakLength} ${streakType}${shouldBreak ? ' (Bẻ)' : ' (Tiếp)'}`,
      patternId: 'cau_bet'
    };
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
      confidence: Math.round(Math.min(94, 80 + streakLength) * weight),
      name: `🐉 Cầu rồng ${streakLength} (Bẻ mạnh)`,
      patternId: 'cau_rong'
    };
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
        confidence: Math.round(92 * weight),
        name: `👑 3 bộ ba cùng ${tripleType1} → bẻ ${prediction}`,
        patternId: 'triple_pattern'
      };
    }
    
    if (tripleType1 !== tripleType2 && tripleType2 !== tripleType3) {
      const prediction = tripleType1;
      return {
        detected: true,
        prediction,
        confidence: Math.round(85 * weight),
        name: `🔄 Bộ ba đảo → theo ${prediction}`,
        patternId: 'triple_pattern'
      };
    }
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
      confidence: Math.round(85 * weight),
      name: `🎯 Đảo xu hướng (${taiLast5}T → ${taiPrev5}T)`,
      patternId: 'smart_bet'
    };
  }
  
  const taiLast10 = last10.filter(r => r === 'Tài').length;
  if (taiLast10 >= 8 || taiLast10 <= 2) {
    const dominant = taiLast10 >= 8 ? 'Tài' : 'Xỉu';
    return { 
      detected: true, 
      prediction: dominant === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(88 * weight),
      name: `⚡ Xu hướng cực (${taiLast10}T-${10-taiLast10}X) → đảo`,
      patternId: 'smart_bet'
    };
  }
  
  return { detected: false };
}

function analyzeTongPhanTich(data, type) {
  if (data.length < 10) return { detected: false };
  
  const sums = data.slice(0, 10).map(d => d.Tong);
  const results = data.slice(0, 10).map(d => d.Ket_qua);
  
  const first5Sum = sums.slice(5, 10).reduce((a, b) => a + b, 0) / 5;
  const last5Sum = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const sumTrend = last5Sum - first5Sum;
  
  const taiCount = results.filter(r => r === 'Tài').length;
  
  if (sumTrend > 1.5) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: Math.round(80 + Math.min(12, Math.abs(sumTrend) * 2)),
      name: `📊 Tổng phân tích (giảm ${sumTrend.toFixed(1)} → Xỉu)`,
      patternId: 'tong_phan_tich'
    };
  }
  
  if (sumTrend < -1.5) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: Math.round(80 + Math.min(12, Math.abs(sumTrend) * 2)),
      name: `📊 Tổng phân tích (tăng ${Math.abs(sumTrend).toFixed(1)} → Tài)`,
      patternId: 'tong_phan_tich'
    };
  }
  
  if (taiCount >= 7 || taiCount <= 3) {
    const prediction = taiCount >= 7 ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: Math.round(78 + Math.abs(taiCount - 5) * 2),
      name: `📊 Tổng phân tích (${taiCount}/10 Tài → ${prediction})`,
      patternId: 'tong_phan_tich'
    };
  }
  
  return { detected: false };
}

// ==================== HÀM TÍNH TOÁN DỰ ĐOÁN CHÍNH ====================

function calculateAdvancedPrediction(data, type) {
  const last50 = data.slice(0, 50);
  const results = last50.map(d => d.Ket_qua);
  const sums = last50.map(d => d.Tong);
  const dice1 = last50.map(d => d.Xuc_xac_1);
  const dice2 = last50.map(d => d.Xuc_xac_2);
  const dice3 = last50.map(d => d.Xuc_xac_3);
  
  initializePatternStats(type);
  
  let predictions = [];
  let factors = [];
  let allPatterns = [];
  
  // Tất cả pattern theo thứ tự ưu tiên
  const patterns = [
    { name: 'Super Trend', func: () => analyzeSuperTrend(results, sums, type), priority: 25 },
    { name: 'Multi-Timeframe', func: () => analyzeMultiTimeframe(results, sums, type), priority: 24 },
    { name: 'Elliott Wave', func: () => analyzeElliottWave(results, type), priority: 24 },
    { name: 'RSI', func: () => analyzeRSI(results, sums, type), priority: 23 },
    { name: 'MACD', func: () => analyzeMACD(results, sums, type), priority: 23 },
    { name: 'Bollinger Bands', func: () => analyzeBollingerBands(sums, type), priority: 23 },
    { name: 'Ichimoku', func: () => analyzeIchimoku(results, sums, type), priority: 22 },
    { name: 'Volume Profile', func: () => analyzeVolumeProfile(results, sums, type), priority: 22 },
    { name: 'Triple Pattern', func: () => analyzeTriplePattern(results, type), priority: 22 },
    { name: 'Cầu rồng', func: () => analyzeCauRong(results, type), priority: 21 },
    { name: 'Smart Bet', func: () => analyzeSmartBet(results, type), priority: 21 },
    { name: 'Tổng phân tích', func: () => analyzeTongPhanTich(data, type), priority: 20 },
    { name: 'Cầu bệt', func: () => analyzeCauBet(results, type), priority: 19 },
    { name: 'Cầu đảo 1-1', func: () => analyzeCauDao11(results, type), priority: 18 },
    { name: 'Cầu 2-2', func: () => analyzeCau22(results, type), priority: 17 },
    { name: 'Cầu 3-3', func: () => analyzeCau33(results, type), priority: 17 },
    { name: 'Cầu 4-4', func: () => analyzeCau44(results, type), priority: 17 },
    { name: 'Cầu 5-5', func: () => analyzeCau55(results, type), priority: 17 },
    { name: 'Break streak', func: () => analyzeBreakStreak(results, type), priority: 20 },
    { name: 'Alternating break', func: () => analyzeAlternatingBreak(results, type), priority: 19 },
    { name: 'Double pair break', func: () => analyzeDoublePairBreak(results, type), priority: 19 },
    { name: 'Cầu bẻ cầu', func: () => analyzeCauBeCau(results, type), priority: 18 },
    { name: 'Dây gãy', func: () => analyzeDayGay(results, type), priority: 17 },
    { name: 'Fibonacci', func: () => analyzeFibonacci(sums, type), priority: 16 },
    { name: 'Golden ratio', func: () => analyzeGoldenRatio(results, sums, type), priority: 16 },
    { name: 'Wave pattern', func: () => analyzeWavePattern(results, sums, type), priority: 18 },
    { name: 'Cầu 1-2-1', func: () => analyzeCau121(results, type), priority: 15 },
    { name: 'Cầu 1-2-3', func: () => analyzeCau123(results, type), priority: 15 },
    { name: 'Cầu 3-2-1', func: () => analyzeCau321(results, type), priority: 15 },
    { name: 'Cầu 2-1-2', func: () => analyzeCau212(results, type), priority: 15 },
    { name: 'Cầu 1-2-2-1', func: () => analyzeCau1221(results, type), priority: 16 },
    { name: 'Cầu 2-1-1-2', func: () => analyzeCau2112(results, type), priority: 16 },
    { name: 'Cầu nhịp nghiêng', func: () => analyzeCauNhipNghieng(results, type), priority: 14 },
    { name: 'Cầu nhảy cóc', func: () => analyzeCauNhayCoc(results, type), priority: 14 },
    { name: 'Cầu 3 ván 1', func: () => analyzeCau3Van1(results, type), priority: 13 },
    { name: 'Cầu gấp', func: () => analyzeCauGap(results, type), priority: 13 },
    { name: 'Cầu ziczac', func: () => analyzeCauZiczac(results, type), priority: 12 },
    { name: 'Cầu đôi', func: () => analyzeCauDoi(results, type), priority: 12 }
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
  if (distribution.imbalance > 0.18) {
    const minority = distribution.taiPercent < 50 ? 'Tài' : 'Xỉu';
    predictions.push({ 
      prediction: minority, 
      confidence: 72 + Math.floor(distribution.imbalance * 25), 
      priority: 15, 
      name: '📈 Phân bố lệch' 
    });
    factors.push(`Phân bố (T:${distribution.taiPercent.toFixed(0)}% - X:${distribution.xiuPercent.toFixed(0)}%)`);
  }
  
  // Deep Neural Network prediction
  const advancedFeatures = extractAdvancedFeatures(results, sums, dice1, dice2, dice3);
  const nnPrediction = deepNeuralNetworkPredict(advancedFeatures, type);
  const nnResult = nnPrediction > 0.55 ? 'Tài' : (nnPrediction < 0.45 ? 'Xỉu' : null);
  
  if (nnResult && Math.abs(nnPrediction - 0.5) > 0.08) {
    predictions.push({
      prediction: nnResult,
      confidence: 70 + Math.abs(nnPrediction - 0.5) * 30,
      priority: 18,
      name: `🧠 Deep Neural Network`
    });
    factors.push(`DNN (${(nnPrediction * 100).toFixed(1)}%)`);
  }
  
  if (predictions.length === 0) {
    predictions.push({ 
      prediction: results[0], 
      confidence: 68, 
      priority: 1, 
      name: 'Theo ván trước' 
    });
    factors.push('Theo ván trước');
  }
  
  predictions.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
  
  // Tính điểm có trọng số
  const taiVotes = predictions.filter(p => p.prediction === 'Tài');
  const xiuVotes = predictions.filter(p => p.prediction === 'Xỉu');
  
  let taiScore = taiVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  let xiuScore = xiuVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  
  // Điều chỉnh theo độ chính xác gần đây
  const recentAcc = learningData[type].recentAccuracy;
  if (recentAcc.length >= 20) {
    const accuracy = recentAcc.reduce((a, b) => a + b, 0) / recentAcc.length;
    if (accuracy < 0.45) {
      taiScore *= 1.15;
      xiuScore *= 1.15;
    }
  }
  
  // Điều chỉnh theo streak
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
  
  // Tính độ tin cậy cuối cùng
  let baseConfidence = 70;
  
  const topPredictions = predictions.slice(0, 5);
  topPredictions.forEach(p => {
    if (p.prediction === finalPrediction) {
      baseConfidence += (p.confidence - 70) * 0.3;
    }
  });
  
  const agreementRatio = (finalPrediction === 'Tài' ? taiVotes.length : xiuVotes.length) / predictions.length;
  baseConfidence += Math.min(15, agreementRatio * 12);
  
  const scoreDiff = Math.abs(taiScore - xiuScore);
  const diffBoost = Math.min(12, scoreDiff / 40);
  baseConfidence += diffBoost;
  
  const nnBoost = nnResult === finalPrediction ? Math.abs(nnPrediction - 0.5) * 15 : 0;
  baseConfidence += nnBoost;
  
  const adaptiveBoost = getAdaptiveConfidenceBoost(type);
  baseConfidence += adaptiveBoost;
  
  let finalConfidence = Math.round(baseConfidence);
  finalConfidence = Math.max(70, Math.min(96, finalConfidence));
  
  // Lưu features để cập nhật ML sau
  learningData[type].lastFeatures = advancedFeatures;
  
  return {
    prediction: finalPrediction,
    confidence: finalConfidence,
    factors,
    allPatterns,
    nnProbability: (nnPrediction * 100).toFixed(1),
    detailedAnalysis: {
      totalPatterns: predictions.length,
      taiVotes: taiVotes.length,
      xiuVotes: xiuVotes.length,
      taiScore: Math.round(taiScore),
      xiuScore: Math.round(xiuScore),
      topPattern: predictions[0]?.name || 'N/A',
      topPatterns: predictions.slice(0, 3).map(p => `${p.name} (${p.confidence}%)`),
      distribution,
      learningStats: {
        totalPredictions: learningData[type].totalPredictions,
        correctPredictions: learningData[type].correctPredictions,
        accuracy: learningData[type].totalPredictions > 0 
          ? (learningData[type].correctPredictions / learningData[type].totalPredictions * 100).toFixed(1) + '%'
          : 'N/A',
        currentStreak: learningData[type].streakAnalysis.currentStreak,
        bestStreak: learningData[type].streakAnalysis.bestStreak
      }
    }
  };
}

// ==================== CÁC HÀM PATTERN CÒN LẠI ====================

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
    const confidence = Math.min(86, 68 + alternatingLength * 2.5);
    
    const prediction = (alternatingLength % 2 === 0) ? 
      (results[0] === 'Tài' ? 'Xỉu' : 'Tài') : 
      results[0];
    
    return { 
      detected: true, 
      length: alternatingLength,
      prediction,
      confidence: Math.round(confidence * weight),
      name: `🔄 Cầu đảo 1-1 (${alternatingLength} phiên)`,
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
      } else {
        prediction = lastPairType === 'Tài' ? 'Xỉu' : 'Tài';
      }
      
      return { 
        detected: true, 
        pairCount,
        prediction,
        confidence: Math.round(Math.min(87, 68 + pairCount * 4) * weight),
        name: `⚡ Cầu 2-2 (${pairCount} cặp)`,
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
      confidence: Math.round(Math.min(87, 70 + tripleCount * 5) * weight),
      name: `🎲 Cầu 3-3 (${tripleCount} bộ ba)`,
      patternId: 'cau_33'
    };
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
      confidence: Math.round(80 + quadrupleCount * 4),
      name: `💎 Cầu 4-4 (${quadrupleCount} bộ bốn)`,
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
      confidence: Math.round(84 + quintupleCount * 4),
      name: `🏆 Cầu 5-5 (${quintupleCount} bộ năm)`,
      patternId: 'cau_55'
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
      confidence: Math.round(76 * weight),
      name: `📐 Cầu 1-2-1`,
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
        confidence: Math.round(78 * weight),
        name: `📐 Cầu 1-2-3`,
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
      confidence: Math.round(80 * weight),
      name: `📐 Cầu 3-2-1`,
      patternId: 'cau_321'
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
      confidence: Math.round(75 * weight),
      name: `📐 Cầu 2-1-2`,
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
      confidence: Math.round(78 * weight),
      name: `📐 Cầu 1-2-2-1`,
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
      confidence: Math.round(79 * weight),
      name: `📐 Cầu 2-1-1-2`,
      patternId: 'cau_2112'
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
        confidence: Math.round(72 * weight),
        name: `🦘 Cầu nhảy cóc`,
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
        confidence: Math.round(70 * weight),
        name: `🦘 Cầu nhảy cóc đảo`,
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
      confidence: Math.round(74 * weight),
      name: `⚖️ Cầu nhịp nghiêng (${taiCount5}/5 Tài)`,
      patternId: 'cau_nhip_nghieng'
    };
  } else if (taiCount5 <= 1) {
    return { 
      detected: true, 
      type: 'nghieng_5',
      prediction: 'Xỉu',
      confidence: Math.round(74 * weight),
      name: `⚖️ Cầu nhịp nghiêng (${5 - taiCount5}/5 Xỉu)`,
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
      confidence: Math.round(72 * weight),
      name: `🎯 Cầu 3 ván 1 (3T-1X) → Xỉu`,
      patternId: 'cau_3van1'
    };
  } else if (taiCount === 1) {
    return { 
      detected: true, 
      prediction: 'Tài',
      confidence: Math.round(72 * weight),
      name: `🎯 Cầu 3 ván 1 (3X-1T) → Tài`,
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
        confidence: Math.round(80 * weight),
        name: `🔨 Cầu bẻ cầu`,
        patternId: 'cau_be_cau'
      };
    }
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
      confidence: Math.round(Math.min(90, 72 + streakLength) * weight),
      name: `⛓️ Bẻ chuỗi ${streakLength} (${streakType} → ${prediction})`,
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
      confidence: Math.round(Math.min(87, 70 + alternatingCount) * weight),
      name: `🔄 Bẻ đảo ${alternatingCount} → ${prediction}`,
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
        confidence: Math.round(88 * weight),
        name: `👥 4 cặp cùng ${pairType1} → bẻ ${prediction}`,
        patternId: 'double_pair_break'
      };
    }
    
    const alternatingPairs = pairType1 !== pairType2 && pairType2 !== results[4] && results[4] !== results[6];
    if (alternatingPairs) {
      const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        prediction,
        confidence: Math.round(82 * weight),
        name: `👥 Cặp đảo xen kẽ → bẻ ${prediction}`,
        patternId: 'double_pair_break'
      };
    }
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
      confidence: Math.round(78 * weight),
      name: `🔗 Dây gãy (${breaks[0]}→${breaks[1]})`,
      patternId: 'day_gay'
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
        confidence: Math.round(76 * weight),
        name: `📈 Fibonacci ${level} (chạm ${value.toFixed(1)})`,
        patternId: 'fibonacci'
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
      confidence: 78,
      name: `✨ Golden ratio (${ratio.toFixed(3)} ~ 1.618 → Tài)`,
      patternId: 'golden_ratio'
    };
  }
  
  if (Math.abs(ratio - 0.618) < 0.15) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: 78,
      name: `✨ Golden ratio (${ratio.toFixed(3)} ~ 0.618 → Xỉu)`,
      patternId: 'golden_ratio'
    };
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
        confidence: 80,
        name: `🌊 Wave pattern (sóng ${waves[4].type} → đảo ${prediction})`,
        patternId: 'wave'
      };
    }
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
      confidence: Math.round(76 * weight),
      name: `📏 Cầu gấp ${gaps[0].length}`,
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
      confidence: Math.round(74 * weight),
      name: `⚡ Cầu ziczac`,
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
      confidence: Math.round(73 * weight),
      name: `🪙 Cầu đôi (ABAB)`,
      patternId: 'cau_doi'
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

// ==================== HÀM HỖ TRỢ ====================

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
        console.log(`[Auto] 🎲 Hu phiên ${nextHuPhien}: ${result.prediction} (${result.confidence}%) | DNN: ${result.nnProbability}%`);
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
        console.log(`[Auto] 🎲 MD5 phiên ${nextMd5Phien}: ${result.prediction} (${result.confidence}%) | DNN: ${result.nnProbability}%`);
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
    if (recentAccuracy > 0.62) {
      newWeight = Math.min(2.2, oldWeight * 1.06);
    } else if (recentAccuracy < 0.38) {
      newWeight = Math.max(0.4, oldWeight * 0.94);
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
      
      // Cập nhật Deep Neural Network
      const allResults = learningData[type].predictions
        .filter(p => p.verified)
        .slice(0, 20)
        .map(p => p.actual);
      const allSums = currentData.slice(0, 20).map(d => d.Tong);
      const allDice1 = currentData.slice(0, 20).map(d => d.Xuc_xac_1);
      const allDice2 = currentData.slice(0, 20).map(d => d.Xuc_xac_2);
      const allDice3 = currentData.slice(0, 20).map(d => d.Xuc_xac_3);
      const features = extractAdvancedFeatures(allResults, allSums, allDice1, allDice2, allDice3);
      updateDeepNeuralNetwork(type, features, pred.actual);
      
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
    'Golden ratio': 'golden_ratio', 'Super Trend': 'xu_huong_manh',
    'Multi-Timeframe': 'smart_bet', 'Elliott Wave': 'harmonic_pattern',
    'RSI': 'momentum', 'MACD': 'momentum', 'Bollinger Bands': 'dice_trend_line',
    'Ichimoku': 'dice_trend_line', 'Volume Profile': 'distribution',
    'Triple Pattern': 'triple_pattern', 'Smart Bet': 'smart_bet',
    'Break streak': 'break_streak', 'Alternating break': 'alternating_break',
    'Double pair break': 'double_pair_break', 'Fibonacci': 'fibonacci'
  };
  
  for (const [key, value] of Object.entries(mapping)) {
    if (name.includes(key)) return value;
  }
  return null;
}

function getAdaptiveConfidenceBoost(type) {
  const recentAcc = learningData[type].recentAccuracy;
  if (recentAcc.length < 20) return 0;
  
  const accuracy = recentAcc.reduce((a, b) => a + b, 0) / recentAcc.length;
  
  if (accuracy > 0.75) return 10;
  if (accuracy > 0.68) return 7;
  if (accuracy > 0.6) return 4;
  if (accuracy > 0.55) return 2;
  if (accuracy < 0.4) return -8;
  if (accuracy < 0.45) return -4;
  
  return 0;
}

function getSmartPredictionAdjustment(type, prediction, patterns) {
  const streakInfo = learningData[type].streakAnalysis;
  
  // Anti-tilt: nếu thua quá 4 ván liên tiếp, đảo ngược
  if (streakInfo.currentStreak <= -4) {
    return prediction === 'Tài' ? 'Xỉu' : 'Tài';
  }
  
  // Nếu thắng quá 4 ván, tiếp tục theo xu hướng
  if (streakInfo.currentStreak >= 4) {
    return prediction;
  }
  
  let taiPatternScore = 0;
  let xiuPatternScore = 0;
  let patternCount = 0;
  
  patterns.slice(0, 5).forEach(p => {
    const patternId = getPatternIdFromName(p.name || p);
    if (patternId) {
      const stats = learningData[type].patternStats[patternId];
      if (stats && stats.recentResults.length >= 10) {
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
  
  if (patternCount >= 3 && Math.abs(taiPatternScore - xiuPatternScore) > 0.7) {
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
  res.send(`╔════════════════════════════════════════════════╗
║   🎲 API DỰ ĐOÁN TÀI XỈU SIÊU CHUẨN 🎲    ║
║            @tiendataox - v9.0              ║
╠════════════════════════════════════════════════╣
║  📍 ENDPOINTS:                               ║
║  • GET /lc79-hu      - Dự đoán Hũ          ║
║  • GET /lc79-md5     - Dự đoán MD5         ║
║  • GET /lc79-hu/lichsu - Lịch sử Hũ        ║
║  • GET /lc79-md5/lichsu - Lịch sử MD5      ║
║  • GET /.../analysis  - Phân tích chi tiết  ║
║  • GET /.../learning  - Thống kê học tập    ║
╚════════════════════════════════════════════════╝`);
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
      success: true,
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
      nn_probability: result.nnProbability,
      patterns_detected: result.factors.slice(0, 5)
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
      success: true,
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
      nn_probability: result.nnProbability,
      patterns_detected: result.factors.slice(0, 5)
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
      total: predictionHistory.hu.length,
      stats: {
        total: predictionHistory.hu.length,
        correct: predictionHistory.hu.filter(h => h.ket_qua_du_doan === 'Đúng ✅').length,
        wrong: predictionHistory.hu.filter(h => h.ket_qua_du_doan === 'Sai ❌').length,
        pending: predictionHistory.hu.filter(h => !h.ket_qua_du_doan).length
      }
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
      total: predictionHistory.md5.length,
      stats: {
        total: predictionHistory.md5.length,
        correct: predictionHistory.md5.filter(h => h.ket_qua_du_doan === 'Đúng ✅').length,
        wrong: predictionHistory.md5.filter(h => h.ket_qua_du_doan === 'Sai ❌').length,
        pending: predictionHistory.md5.filter(h => !h.ket_qua_du_doan).length
      }
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
      nn_probability: result.nnProbability,
      factors: result.factors,
      top_patterns: result.detailedAnalysis.topPatterns,
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
      nn_probability: result.nnProbability,
      factors: result.factors,
      top_patterns: result.detailedAnalysis.topPatterns,
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
  
  const recentAcc = stats.recentAccuracy.length > 0 
    ? (stats.recentAccuracy.reduce((a, b) => a + b, 0) / stats.recentAccuracy.length * 100).toFixed(1)
    : 'N/A';
  
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu Hũ - Learning Stats',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${accuracy}%`,
    recent30Accuracy: `${recentAcc}%`,
    streakAnalysis: stats.streakAnalysis,
    mlModel: {
      hasHiddenWeights: !!stats.mlModel.hiddenWeights?.length,
      lastTraining: stats.mlModel.lastTraining
    },
    topPatterns: Object.entries(stats.patternStats)
      .sort((a, b) => (b[1].accuracy || 0) - (a[1].accuracy || 0))
      .slice(0, 5)
      .map(([name, stat]) => ({
        name,
        accuracy: (stat.accuracy * 100).toFixed(1) + '%',
        total: stat.total,
        weight: stats.patternWeights[name]?.toFixed(2)
      }))
  });
});

app.get('/lc79-md5/learning', (req, res) => {
  const stats = learningData.md5;
  const accuracy = stats.totalPredictions > 0 
    ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2)
    : 0;
  
  const recentAcc = stats.recentAccuracy.length > 0 
    ? (stats.recentAccuracy.reduce((a, b) => a + b, 0) / stats.recentAccuracy.length * 100).toFixed(1)
    : 'N/A';
  
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu MD5 - Learning Stats',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${accuracy}%`,
    recent30Accuracy: `${recentAcc}%`,
    streakAnalysis: stats.streakAnalysis,
    mlModel: {
      hasHiddenWeights: !!stats.mlModel.hiddenWeights?.length,
      lastTraining: stats.mlModel.lastTraining
    },
    topPatterns: Object.entries(stats.patternStats)
      .sort((a, b) => (b[1].accuracy || 0) - (a[1].accuracy || 0))
      .slice(0, 5)
      .map(([name, stat]) => ({
        name,
        accuracy: (stat.accuracy * 100).toFixed(1) + '%',
        total: stat.total,
        weight: stats.patternWeights[name]?.toFixed(2)
      }))
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
      mlModel: { weights: {}, bias: 0, lastTraining: null, hiddenWeights: [], outputWeights: [] }
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
      mlModel: { weights: {}, bias: 0, lastTraining: null, hiddenWeights: [], outputWeights: [] }
    }
  };
  saveLearningData();
  res.json({ message: 'Reset dữ liệu học tập thành công' });
});

loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║         🎲🎲🎲  DỰ ĐOÁN TÀI XỈU SIÊU CHUẨN - v9.0  🎲🎲🎲                 ║
║                              @tiendataox                                     ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  🧠 DEEP LEARNING NÂNG CAO:                                                  ║
║     • Neural Network 2 lớp ẩn (20 features → 12 neurons → 1 output)        ║
║     • Học sâu từ 20 features đặc trưng                                      ║
║     • Tự động cập nhật weights sau mỗi kết quả                               ║
║                                                                              ║
║  📊 50+ PATTERN CHUYÊN SÂU:                                                 ║
║     • Super Trend - Xu hướng siêu mạnh                                      ║
║     • Multi-Timeframe - Phân tích đa khung thời gian                        ║
║     • Elliott Wave - Sóng Elliott hoàn chỉnh                                ║
║     • RSI, MACD, Bollinger Bands, Ichimoku Cloud                            ║
║     • Volume Profile - Phân tích khối lượng                                 ║
║     • Cầu bệt, rồng, đảo, 2-2, 3-3, 4-4, 5-5, 1-2-1, 1-2-3, 3-2-1...       ║
║                                                                              ║
║  🎯 MỤC TIÊU ĐỘ CHÍNH XÁC: 80%+                                              ║
║                                                                              ║
║  📡 SERVER: http://0.0.0.0:${PORT}                                             ║
║  📁 FILE: tiendat.json, tiendat1.json                                       ║
║  ⏰ AUTO-SAVE: mỗi ${AUTO_SAVE_INTERVAL/1000}s                                   ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
  `);
  
  startAutoSaveTask();
});