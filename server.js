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
    mlModel: { weights: {}, bias: 0, lastTraining: null, hiddenWeights: {}, hiddenBias: {} }
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
    mlModel: { weights: {}, bias: 0, lastTraining: null, hiddenWeights: {}, hiddenBias: {} }
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
  'neural_boost': 1.25, 'sentiment_analysis': 1.1, 'harmonic_pattern': 1.2,
  'transformer': 1.35, 'attention_mechanism': 1.3, 'ensemble_voting': 1.4,
  'reinforcement': 1.3, 'bayesian_inference': 1.25, 'clustering_pattern': 1.2
};

// ==================== FEATURES NÂNG CAO CHO ML ====================

function encodeResultPattern(results) {
  if (!results || results.length === 0) return 0;
  let code = 0;
  for (let i = 0; i < results.length; i++) {
    code = (code << 1) | (results[i] === 'Tài' ? 1 : 0);
  }
  return code;
}

function calculateMomentumScore(results, sums, window) {
  if (results.length < window) return 0.5;
  const recent = results.slice(0, window);
  const taiCount = recent.filter(r => r === 'Tài').length;
  const baseScore = taiCount / window;
  
  const sumMomentum = sums.slice(0, window).reduce((a, b) => a + b, 0) / window;
  const sumAdjust = (sumMomentum - 10.5) / 5.5;
  
  return Math.min(0.95, Math.max(0.05, baseScore * 0.7 + sumAdjust * 0.3));
}

function calculateSumDistribution(sums) {
  if (sums.length === 0) return { low: 0, medium: 0, high: 0 };
  let low = 0, medium = 0, high = 0;
  sums.forEach(s => {
    if (s <= 8) low++;
    else if (s <= 13) medium++;
    else high++;
  });
  const total = sums.length;
  return { low: low/total, medium: medium/total, high: high/total };
}

function calculateRSI(sums, period = 14) {
  if (sums.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 0; i < period; i++) {
    const diff = sums[i] - sums[i+1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateMACD(sums) {
  if (sums.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  
  const ema12 = calculateEMA(sums, 12);
  const ema26 = calculateEMA(sums, 26);
  const macd = ema12 - ema26;
  
  const macdLine = [macd];
  const signal = calculateEMA(macdLine, 9);
  const histogram = macd - signal;
  
  return { macd, signal, histogram };
}

function calculateEMA(data, period) {
  const k = 2 / (period + 1);
  let ema = data[0];
  for (let i = 1; i < Math.min(data.length, period * 2); i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateBollingerBands(sums, period = 20) {
  if (sums.length < period) return { upper: 0, middle: 0, lower: 0, position: 0.5 };
  
  const slice = sums.slice(0, period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = middle + 2 * stdDev;
  const lower = middle - 2 * stdDev;
  
  const lastSum = sums[0];
  let position = 0.5;
  if (lastSum > upper) position = 1;
  else if (lastSum < lower) position = 0;
  else position = (lastSum - lower) / (upper - lower);
  
  return { upper, middle, lower, position };
}

function calculateStochasticOscillator(sums, period = 14) {
  if (sums.length < period) return 50;
  const slice = sums.slice(0, period);
  const lowest = Math.min(...slice);
  const highest = Math.max(...slice);
  const current = sums[0];
  if (highest === lowest) return 50;
  return ((current - lowest) / (highest - lowest)) * 100;
}

function calculateATR(sums, period = 14) {
  if (sums.length < period + 1) return 0;
  let tr = 0;
  for (let i = 0; i < period; i++) {
    tr += Math.abs(sums[i] - sums[i+1]);
  }
  return tr / period;
}

function extractAdvancedFeatures(results, sums, diceDetails = null) {
  const sumDist = calculateSumDistribution(sums.slice(0, 20));
  const rsi = calculateRSI(sums, 14);
  const macd = calculateMACD(sums);
  const bb = calculateBollingerBands(sums, 20);
  const stoch = calculateStochasticOscillator(sums, 14);
  const atr = calculateATR(sums, 14);
  
  return {
    // Features cũ
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
    
    // Features nâng cao mới
    momentum3: calculateMomentumScore(results, sums, 3),
    momentum5: calculateMomentumScore(results, sums, 5),
    momentum10: calculateMomentumScore(results, sums, 10),
    last2Pattern: encodeResultPattern(results.slice(0, 2)),
    last3Pattern: encodeResultPattern(results.slice(0, 3)),
    last4Pattern: encodeResultPattern(results.slice(0, 4)),
    sumDistLow: sumDist.low,
    sumDistMedium: sumDist.medium,
    sumDistHigh: sumDist.high,
    rsi: rsi / 100,
    macdHistogram: Math.min(1, Math.max(-1, macd.histogram / 10)),
    bbPosition: bb.position,
    stoch: stoch / 100,
    atrNormalized: Math.min(1, atr / 10)
  };
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
  return Math.min(streak, 10);
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
  return (avgSecond - avgFirst) / 5;
}

// ==================== MACHINE LEARNING NÂNG CAO ====================

// Neural Network với 2 lớp ẩn
function predictWithDeepML(features, type) {
  const model = learningData[type].mlModel;
  const featureValues = Object.values(features);
  
  // Layer 1: ẩn với 8神经元
  let hidden1 = [];
  const hiddenSize1 = 8;
  for (let i = 0; i < hiddenSize1; i++) {
    let sum = model.hiddenBias?.[`h1_${i}`] || 0;
    for (let j = 0; j < featureValues.length; j++) {
      sum += featureValues[j] * (model.hiddenWeights?.[`h1_${i}_${j}`] || 0);
    }
    hidden1.push(1 / (1 + Math.exp(-sum)));
  }
  
  // Layer 2: ẩn với 4神经元
  let hidden2 = [];
  const hiddenSize2 = 4;
  for (let i = 0; i < hiddenSize2; i++) {
    let sum = model.hiddenBias?.[`h2_${i}`] || 0;
    for (let j = 0; j < hidden1.length; j++) {
      sum += hidden1[j] * (model.hiddenWeights?.[`h2_${i}_${j}`] || 0);
    }
    hidden2.push(1 / (1 + Math.exp(-sum)));
  }
  
  // Output layer
  let output = model.bias || 0;
  for (let i = 0; i < hidden2.length; i++) {
    output += hidden2[i] * (model.weights?.[`out_${i}`] || 0);
  }
  
  return 1 / (1 + Math.exp(-output));
}

// Cập nhật Deep ML model
function updateDeepMLModel(type, features, actualResult) {
  const target = actualResult === 'Tài' ? 1 : 0;
  const prediction = predictWithDeepML(features, type);
  const error = target - prediction;
  const learningRate = 0.005;
  
  const model = learningData[type].mlModel;
  const featureValues = Object.values(features);
  
  // Tính gradient cho output layer
  const outputGradient = error * prediction * (1 - prediction);
  
  // Cập nhật output layer weights
  for (let i = 0; i < 4; i++) {
    const key = `out_${i}`;
    model.weights[key] = (model.weights[key] || 0) + learningRate * outputGradient * 
      (model.hidden2Cache?.[i] || 0.5);
  }
  model.bias = (model.bias || 0) + learningRate * outputGradient;
  
  // Cập nhật learning data
  model.lastTraining = new Date().toISOString();
}

// ==================== TRANSFORMER / ATTENTION MECHANISM ====================

function analyzeTransformerPattern(results, sums, type) {
  if (results.length < 20) return { detected: false };
  
  const weights = getPatternWeight(type, 'transformer');
  
  // Self-attention mechanism
  const sequence = results.slice(0, 20).map(r => r === 'Tài' ? 1 : 0);
  const sumSequence = sums.slice(0, 20);
  
  // Tính attention scores
  const attentionScores = [];
  for (let i = 0; i < sequence.length; i++) {
    let score = 0;
    for (let j = 0; j < sequence.length; j++) {
      score += sequence[i] * sequence[j] * (1 - Math.abs(i - j) / sequence.length);
    }
    attentionScores.push(score);
  }
  
  // Weighted sum
  let weightedPrediction = 0;
  let totalWeight = 0;
  for (let i = 0; i < 10; i++) {
    const weight = Math.exp(attentionScores[i]);
    weightedPrediction += sequence[i] * weight;
    totalWeight += weight;
  }
  weightedPrediction /= totalWeight;
  
  // Phân tích xu hướng tổng
  const sumTrend = sumSequence[0] - sumSequence[9];
  const volatility = calculateVolatility(sumSequence);
  
  if (Math.abs(weightedPrediction - 0.5) > 0.15 || Math.abs(sumTrend) > 3) {
    let prediction;
    let confidence;
    
    if (Math.abs(weightedPrediction - 0.5) > 0.15) {
      prediction = weightedPrediction > 0.5 ? 'Tài' : 'Xỉu';
      confidence = Math.round(70 + Math.abs(weightedPrediction - 0.5) * 40);
    } else {
      prediction = sumTrend > 0 ? 'Xỉu' : 'Tài';
      confidence = Math.round(68 + Math.min(15, Math.abs(sumTrend) * 2));
    }
    
    return {
      detected: true,
      prediction,
      confidence: Math.min(88, Math.round(confidence * weights)),
      name: `Transformer (Attention Score: ${weightedPrediction.toFixed(2)})`,
      patternId: 'transformer'
    };
  }
  
  return { detected: false };
}

function analyzeAttentionMechanism(results, sums, type) {
  if (results.length < 15) return { detected: false };
  
  const weights = getPatternWeight(type, 'attention_mechanism');
  
  // Multi-head attention đơn giản
  const heads = [];
  const sequence = results.slice(0, 15);
  
  // Head 1: focus vào 3 phiên gần nhất
  const recent3 = sequence.slice(0, 3);
  const head1 = recent3.filter(r => r === 'Tài').length / 3;
  
  // Head 2: focus vào pattern 5-5
  const first5 = sequence.slice(0, 5);
  const last5 = sequence.slice(5, 10);
  const head2 = (first5.filter(r => r === 'Tài').length / 5 + 
                  last5.filter(r => r === 'Tài').length / 5) / 2;
  
  // Head 3: focus vào xu hướng tổng
  const head3 = sequence.filter(r => r === 'Tài').length / sequence.length;
  
  // Head 4: focus vào alternating pattern
  let alternating = 0;
  for (let i = 1; i < sequence.length; i++) {
    if (sequence[i] !== sequence[i-1]) alternating++;
  }
  const head4 = alternating / (sequence.length - 1);
  
  // Weighted voting
  const attentionScore = (head1 * 0.35 + head2 * 0.25 + head3 * 0.25 + head4 * 0.15);
  
  if (Math.abs(attentionScore - 0.5) > 0.12) {
    const prediction = attentionScore > 0.5 ? 'Tài' : 'Xỉu';
    const confidence = Math.round(65 + Math.abs(attentionScore - 0.5) * 60);
    
    return {
      detected: true,
      prediction,
      confidence: Math.min(86, Math.round(confidence * weights)),
      name: `Attention (${(attentionScore * 100).toFixed(0)}% Tài)`,
      patternId: 'attention_mechanism'
    };
  }
  
  return { detected: false };
}

// ==================== ENSEMBLE VOTING ====================

function analyzeEnsembleVoting(results, sums, type) {
  if (results.length < 30) return { detected: false };
  
  const weights = getPatternWeight(type, 'ensemble_voting');
  
  // Lấy dự đoán từ các phương pháp khác nhau
  const predictions = [];
  
  // 1. RSI prediction
  const rsi = calculateRSI(sums, 14);
  if (rsi > 70) predictions.push({ pred: 'Xỉu', weight: 0.8 });
  else if (rsi < 30) predictions.push({ pred: 'Tài', weight: 0.8 });
  
  // 2. MACD prediction
  const macd = calculateMACD(sums);
  if (macd.histogram > 1) predictions.push({ pred: 'Xỉu', weight: 0.7 });
  else if (macd.histogram < -1) predictions.push({ pred: 'Tài', weight: 0.7 });
  
  // 3. Bollinger Bands prediction
  const bb = calculateBollingerBands(sums, 20);
  if (bb.position > 0.8) predictions.push({ pred: 'Xỉu', weight: 0.75 });
  else if (bb.position < 0.2) predictions.push({ pred: 'Tài', weight: 0.75 });
  
  // 4. Stochastic prediction
  const stoch = calculateStochasticOscillator(sums, 14);
  if (stoch > 80) predictions.push({ pred: 'Xỉu', weight: 0.7 });
  else if (stoch < 20) predictions.push({ pred: 'Tài', weight: 0.7 });
  
  // 5. Trend prediction
  const trend = calculateSumTrend(sums);
  if (trend > 1) predictions.push({ pred: 'Xỉu', weight: 0.65 });
  else if (trend < -1) predictions.push({ pred: 'Tài', weight: 0.65 });
  
  if (predictions.length >= 3) {
    let taiScore = 0, xiuScore = 0;
    predictions.forEach(p => {
      if (p.pred === 'Tài') taiScore += p.weight;
      else xiuScore += p.weight;
    });
    
    const total = taiScore + xiuScore;
    const taiProb = taiScore / total;
    
    if (Math.abs(taiProb - 0.5) > 0.2) {
      const prediction = taiProb > 0.5 ? 'Tài' : 'Xỉu';
      const confidence = Math.round(65 + Math.abs(taiProb - 0.5) * 50);
      
      return {
        detected: true,
        prediction,
        confidence: Math.min(85, Math.round(confidence * weights)),
        name: `Ensemble (${predictions.length} indicators → ${prediction})`,
        patternId: 'ensemble_voting'
      };
    }
  }
  
  return { detected: false };
}

// ==================== REINFORCEMENT LEARNING ====================

let reinforcementMemory = { hu: [], md5: [] };
const MAX_MEMORY = 100;

function analyzeReinforcementLearning(results, sums, type) {
  if (results.length < 20 || reinforcementMemory[type].length < 10) return { detected: false };
  
  const weights = getPatternWeight(type, 'reinforcement');
  
  // Tìm pattern tương tự trong lịch sử
  const currentPattern = results.slice(0, 10).join('');
  let similarPatterns = [];
  
  for (const mem of reinforcementMemory[type]) {
    if (mem.pattern === currentPattern) {
      similarPatterns.push(mem);
    } else {
      // Kiểm tra similarity
      let matches = 0;
      for (let i = 0; i < Math.min(10, mem.pattern.length); i++) {
        if (mem.pattern[i] === currentPattern[i]) matches++;
      }
      if (matches >= 7) similarPatterns.push(mem);
    }
  }
  
  if (similarPatterns.length >= 3) {
    let taiWins = 0, xiuWins = 0;
    similarPatterns.forEach(p => {
      if (p.nextResult === 'Tài') taiWins++;
      else xiuWins++;
    });
    
    const total = taiWins + xiuWins;
    const taiProb = taiWins / total;
    
    if (Math.abs(taiProb - 0.5) > 0.25) {
      const prediction = taiProb > 0.5 ? 'Tài' : 'Xỉu';
      const confidence = Math.round(65 + Math.abs(taiProb - 0.5) * 40);
      
      return {
        detected: true,
        prediction,
        confidence: Math.min(84, Math.round(confidence * weights)),
        name: `Reinforcement (${similarPatterns.length} patterns similar → ${prediction})`,
        patternId: 'reinforcement'
      };
    }
  }
  
  return { detected: false };
}

function updateReinforcementMemory(type, pattern, nextResult) {
  reinforcementMemory[type].unshift({ pattern, nextResult, timestamp: Date.now() });
  if (reinforcementMemory[type].length > MAX_MEMORY) {
    reinforcementMemory[type] = reinforcementMemory[type].slice(0, MAX_MEMORY);
  }
}

// ==================== BAYESIAN INFERENCE ====================

function analyzeBayesianInference(results, sums, type) {
  if (results.length < 25) return { detected: false };
  
  const weights = getPatternWeight(type, 'bayesian_inference');
  
  // Prior probability (50-50)
  let priorTai = 0.5;
  let priorXiu = 0.5;
  
  // Likelihood từ dữ liệu gần đây
  const recent20 = results.slice(0, 20);
  const taiCount = recent20.filter(r => r === 'Tài').length;
  const likelihoodTai = (taiCount + 1) / 22;
  const likelihoodXiu = (20 - taiCount + 1) / 22;
  
  // Evidence từ các yếu tố
  const rsi = calculateRSI(sums, 14);
  const bb = calculateBollingerBands(sums, 20);
  const stoch = calculateStochasticOscillator(sums, 14);
  
  let evidenceTai = 1, evidenceXiu = 1;
  
  // RSI evidence
  if (rsi > 70) evidenceXiu *= 1.5;
  else if (rsi < 30) evidenceTai *= 1.5;
  
  // BB evidence
  if (bb.position > 0.8) evidenceXiu *= 1.4;
  else if (bb.position < 0.2) evidenceTai *= 1.4;
  
  // Stochastic evidence
  if (stoch > 80) evidenceXiu *= 1.3;
  else if (stoch < 20) evidenceTai *= 1.3;
  
  // Posterior probability
  const posteriorTai = (priorTai * likelihoodTai * evidenceTai);
  const posteriorXiu = (priorXiu * likelihoodXiu * evidenceXiu);
  const total = posteriorTai + posteriorXiu;
  const taiProbability = posteriorTai / total;
  
  if (Math.abs(taiProbability - 0.5) > 0.18) {
    const prediction = taiProbability > 0.5 ? 'Tài' : 'Xỉu';
    const confidence = Math.round(60 + Math.abs(taiProbability - 0.5) * 60);
    
    return {
      detected: true,
      prediction,
      confidence: Math.min(83, Math.round(confidence * weights)),
      name: `Bayesian (${(taiProbability * 100).toFixed(0)}% Tài)`,
      patternId: 'bayesian_inference'
    };
  }
  
  return { detected: false };
}

// ==================== CLUSTERING PATTERN ====================

function analyzeClusteringPattern(results, sums, type) {
  if (results.length < 30) return { detected: false };
  
  const weights = getPatternWeight(type, 'clustering_pattern');
  
  // Tạo feature vector cho clustering
  const features = [];
  for (let i = 0; i < Math.min(30, results.length - 5); i += 5) {
    const cluster = results.slice(i, i + 5);
    const taiRatio = cluster.filter(r => r === 'Tài').length / 5;
    features.push(taiRatio);
  }
  
  if (features.length < 4) return { detected: false };
  
  // Simple K-means với K=2
  let centroid1 = features[0], centroid2 = features[2];
  let cluster1 = [], cluster2 = [];
  
  for (let i = 0; i < 5; i++) {
    cluster1 = [];
    cluster2 = [];
    for (const f of features) {
      const dist1 = Math.abs(f - centroid1);
      const dist2 = Math.abs(f - centroid2);
      if (dist1 < dist2) cluster1.push(f);
      else cluster2.push(f);
    }
    if (cluster1.length > 0) centroid1 = cluster1.reduce((a, b) => a + b, 0) / cluster1.length;
    if (cluster2.length > 0) centroid2 = cluster2.reduce((a, b) => a + b, 0) / cluster2.length;
  }
  
  // Phân loại pattern hiện tại
  const currentCluster = features[0];
  const distToC1 = Math.abs(currentCluster - centroid1);
  const distToC2 = Math.abs(currentCluster - centroid2);
  const belongsToC1 = distToC1 < distToC2;
  
  // Tính xác suất dựa trên cluster
  let taiProbability;
  if (belongsToC1) {
    taiProbability = cluster1.reduce((a, b) => a + b, 0) / cluster1.length;
  } else {
    taiProbability = cluster2.reduce((a, b) => a + b, 0) / cluster2.length;
  }
  
  // Điều chỉnh theo xu hướng gần đây
  const recentTrend = calculateSumTrend(sums.slice(0, 10));
  if (recentTrend > 1) taiProbability -= 0.1;
  else if (recentTrend < -1) taiProbability += 0.1;
  
  taiProbability = Math.min(0.85, Math.max(0.15, taiProbability));
  
  if (Math.abs(taiProbability - 0.5) > 0.15) {
    const prediction = taiProbability > 0.5 ? 'Tài' : 'Xỉu';
    const confidence = Math.round(62 + Math.abs(taiProbability - 0.5) * 55);
    
    return {
      detected: true,
      prediction,
      confidence: Math.min(82, Math.round(confidence * weights)),
      name: `Clustering (Cluster ${belongsToC1 ? 1 : 2} → ${prediction})`,
      patternId: 'clustering_pattern'
    };
  }
  
  return { detected: false };
}

// ==================== CÁC HÀM PHÂN TÍCH NÂNG CAO ====================

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
  
  // Phân tích chi tiết hơn
  const sumStd = calculateVolatility(sums);
  const isHighVolatility = sumStd > 3;
  
  const weight = getPatternWeight(type, 'tong_phan_tich');
  
  if (sumTrend > 1.5 && !isHighVolatility) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: Math.round(75 + Math.abs(sumTrend) * 3),
      name: `Tổng Phân Tích (Tổng tăng ${sumTrend.toFixed(1)} → Xỉu)`,
      patternId: 'tong_phan_tich'
    };
  }
  
  if (sumTrend < -1.5 && !isHighVolatility) {
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
    const confidence = Math.min(85, 75 + (taiCount - 5) * 3);
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: Math.round(confidence * weight),
      name: `Xu Hướng Mạnh (${taiCount}/8 Tài → Đảo Xỉu)`,
      patternId: 'xu_huong_manh'
    };
  }
  
  if (taiCount <= 2) {
    const confidence = Math.min(85, 75 + ((8 - taiCount) - 5) * 3);
    return {
      detected: true,
      prediction: 'Tài',
      confidence: Math.round(confidence * weight),
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
      confidence: Math.round(72 * weight),
      name: `Đảo Chiều (Chuỗi ${recent5.join('-')} → ${prediction})`,
      patternId: 'dao_chieu'
    };
  }
  
  return { detected: false };
}

function analyzeLSTMPattern(results, type) {
  if (results.length < 10) return { detected: false };
  
  const weights = getPatternWeight(type, 'lstm_pattern');
  let patternScore = 0;
  
  const sequence = results.slice(0, 10);
  let longTermTrend = 0;
  for (let i = 0; i < sequence.length - 1; i++) {
    if (sequence[i] === sequence[i+1]) longTermTrend++;
    else longTermTrend--;
  }
  
  // Phân tích chi tiết hơn
  const first5 = sequence.slice(0, 5);
  const last5 = sequence.slice(5, 10);
  const first5Tai = first5.filter(r => r === 'Tài').length;
  const last5Tai = last5.filter(r => r === 'Tài').length;
  const trendStrength = Math.abs(first5Tai - last5Tai);
  
  if (Math.abs(longTermTrend) >= 4 || trendStrength >= 3) {
    const isStrongTrend = Math.abs(longTermTrend) >= 6 || trendStrength >= 4;
    let prediction;
    let confidence;
    
    if (trendStrength >= 3) {
      prediction = last5Tai > first5Tai ? 'Xỉu' : 'Tài';
      confidence = 70 + trendStrength * 3;
    } else {
      prediction = longTermTrend > 0 ? 'Xỉu' : 'Tài';
      confidence = 68 + Math.abs(longTermTrend) * 2;
    }
    
    if (isStrongTrend) confidence += 5;
    
    return {
      detected: true,
      prediction,
      confidence: Math.min(88, Math.round(confidence * weights)),
      name: `LSTM (Xu hướng ${longTermTrend > 0 ? 'cùng' : 'ngược'} chiều)`,
      patternId: 'lstm_pattern'
    };
  }
  
  return { detected: false };
}

function analyzeMarkovChain(results, type) {
  if (results.length < 15) return { detected: false };
  
  const weights = getPatternWeight(type, 'markov_chain');
  
  const transitions = { 'Tài_Tài': 0, 'Tài_Xỉu': 0, 'Xỉu_Tài': 0, 'Xỉu_Xỉu': 0 };
  const triTransitions = {};
  
  for (let i = 0; i < results.length - 2; i++) {
    const key2 = `${results[i]}_${results[i+1]}`;
    const next = results[i+2];
    const triKey = `${key2}_${next}`;
    triTransitions[triKey] = (triTransitions[triKey] || 0) + 1;
  }
  
  for (let i = 0; i < results.length - 1; i++) {
    const key = `${results[i]}_${results[i+1]}`;
    transitions[key]++;
  }
  
  const lastResult = results[0];
  const secondLast = results[1];
  const lastPair = `${secondLast}_${lastResult}`;
  
  // Sử dụng transition bậc 2 nếu có đủ dữ liệu
  let probTai;
  const triKeyTai = `${lastPair}_Tài`;
  const triKeyXiu = `${lastPair}_Xỉu`;
  const triTai = triTransitions[triKeyTai] || 0;
  const triXiu = triTransitions[triKeyXiu] || 0;
  
  if (triTai + triXiu >= 3) {
    probTai = triTai / (triTai + triXiu);
  } else {
    const total = transitions[`${lastResult}_Tài`] + transitions[`${lastResult}_Xỉu`] || 1;
    probTai = (transitions[`${lastResult}_Tài`] || 0) / total;
  }
  
  if (probTai > 0.65 || probTai < 0.35) {
    const prediction = probTai > 0.5 ? 'Tài' : 'Xỉu';
    return {
      detected: true,
      prediction,
      confidence: Math.round(68 + Math.abs(probTai - 0.5) * 50),
      name: `Markov Chain (${(probTai * 100).toFixed(0)}% ${prediction})`,
      patternId: 'markov_chain'
    };
  }
  
  return { detected: false };
}

function analyzeNeuralBoost(results, sums, type) {
  if (results.length < 20) return { detected: false };
  
  const weights = getPatternWeight(type, 'neural_boost');
  
  const input = [
    results.slice(0, 5).filter(r => r === 'Tài').length / 5,
    results.slice(5, 10).filter(r => r === 'Tài').length / 5,
    results.slice(10, 15).filter(r => r === 'Tài').length / 5,
    (sums[0] - 10.5) / 5.5,
    calculateVolatility(sums.slice(0, 10)) / 5,
    calculateRSI(sums, 14) / 100,
    calculateBollingerBands(sums, 20).position
  ];
  
  const h1 = input.map(x => 1 / (1 + Math.exp(-x * 2)));
  const h2 = [];
  for (let i = 0; i < 4; i++) {
    let sum = 0;
    for (let j = 0; j < h1.length; j++) {
      sum += h1[j] * (0.5 - Math.random() * 0.2);
    }
    h2.push(1 / (1 + Math.exp(-sum)));
  }
  
  const output = h2.reduce((a, b) => a + b, 0) / h2.length;
  
  if (Math.abs(output - 0.5) > 0.12) {
    const prediction = output > 0.52 ? 'Tài' : (output < 0.48 ? 'Xỉu' : null);
    if (prediction) {
      return {
        detected: true,
        prediction,
        confidence: Math.round(65 + Math.abs(output - 0.5) * 60),
        name: `Neural Boost (${(output * 100).toFixed(0)}% Tài)`,
        patternId: 'neural_boost'
      };
    }
  }
  
  return { detected: false };
}

function analyzeHarmonicPattern(results, sums, type) {
  if (results.length < 12) return { detected: false };
  
  const weights = getPatternWeight(type, 'harmonic_pattern');
  
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
      const waveStrength = Math.min(5, pattern5[4].length);
      return {
        detected: true,
        prediction,
        confidence: Math.min(85, 70 + waveStrength * 2),
        name: `Harmonic (Sóng ${pattern5[4].type} → ${prediction})`,
        patternId: 'harmonic_pattern'
      };
    }
  }
  
  if (waves.length >= 3) {
    const pattern3 = waves.slice(0, 3);
    const isZigZag = pattern3[0].type !== pattern3[1].type && pattern3[1].type !== pattern3[2].type;
    if (isZigZag) {
      const prediction = pattern3[2].type;
      return {
        detected: true,
        prediction,
        confidence: 68,
        name: `Harmonic (ZigZag → Theo ${prediction})`,
        patternId: 'harmonic_pattern'
      };
    }
  }
  
  return { detected: false };
}

function analyzeSentiment(results, sums, type) {
  if (results.length < 10) return { detected: false };
  
  const weights = getPatternWeight(type, 'sentiment_analysis');
  
  const volatility = calculateVolatility(sums.slice(0, 10));
  const recentTaiRatio = results.slice(0, 5).filter(r => r === 'Tài').length / 5;
  const prevTaiRatio = results.slice(5, 10).filter(r => r === 'Tài').length / 5;
  
  // Extreme FOMO
  if (recentTaiRatio > 0.8 && prevTaiRatio < 0.4 && volatility > 2.5) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: 74,
      name: 'Sentiment FOMO (Đám đông FOMO → Đảo chiều)',
      patternId: 'sentiment_analysis'
    };
  }
  
  // Panic selling
  if (volatility > 3.5 && recentTaiRatio < 0.3 && prevTaiRatio > 0.6) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: 76,
      name: 'Sentiment Panic (Bán tháo hoảng loạn → Bật lại)',
      patternId: 'sentiment_analysis'
    };
  }
  
  // Capitulation
  if (results.slice(0, 7).filter(r => r === 'Xỉu').length >= 6 && volatility > 3) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: 72,
      name: 'Sentiment Capitulation (Đầu hàng → Phục hồi)',
      patternId: 'sentiment_analysis'
    };
  }
  
  return { detected: false };
}

// ==================== PATTERN CŨ (GIỮ NGUYÊN) ====================

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

// ==================== HÀM TÍNH TOÁN DỰ ĐOÁN CHÍNH NÂNG CẤP ====================

function calculateAdvancedPrediction(data, type) {
  const last50 = data.slice(0, 50);
  const results = last50.map(d => d.Ket_qua);
  const sums = last50.map(d => d.Tong);
  
  initializePatternStats(type);
  
  let predictions = [];
  let factors = [];
  let allPatterns = [];
  
  // Danh sách pattern với priority - ƯU TIÊN CÁC PATTERN MỚI
  const patterns = [
    // Pattern mới nâng cấp - priority cao nhất
    { name: 'Transformer', func: () => analyzeTransformerPattern(results, sums, type), priority: 20 },
    { name: 'Attention Mechanism', func: () => analyzeAttentionMechanism(results, sums, type), priority: 19 },
    { name: 'Ensemble Voting', func: () => analyzeEnsembleVoting(results, sums, type), priority: 18 },
    { name: 'Reinforcement Learning', func: () => analyzeReinforcementLearning(results, sums, type), priority: 18 },
    { name: 'Bayesian Inference', func: () => analyzeBayesianInference(results, sums, type), priority: 17 },
    { name: 'Clustering Pattern', func: () => analyzeClusteringPattern(results, sums, type), priority: 16 },
    
    // Pattern cũ đã cải tiến
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
  
  // Tính điểm cho Tài và Xỉu
  const taiVotes = predictions.filter(p => p.prediction === 'Tài');
  const xiuVotes = predictions.filter(p => p.prediction === 'Xỉu');
  
  let taiScore = taiVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  let xiuScore = xiuVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  
  // Điều chỉnh theo Deep ML
  const features = extractAdvancedFeatures(results, sums);
  const mlProbability = predictWithDeepML(features, type);
  
  if (mlProbability > 0.6) {
    taiScore *= (1 + mlProbability);
  } else if (mlProbability < 0.4) {
    xiuScore *= (1 + (1 - mlProbability));
  }
  
  // Điều chỉnh theo lịch sử thắng/thua
  const streakInfo = learningData[type].streakAnalysis;
  if (streakInfo.currentStreak <= -3) {
    if (taiScore > xiuScore) {
      xiuScore *= 1.3;
    } else {
      taiScore *= 1.3;
    }
  }
  
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  
  // Điều chỉnh thông minh
  finalPrediction = getSmartPredictionAdjustment(type, finalPrediction, allPatterns);
  
  // Tính confidence
  let baseConfidence = 65;
  
  const topPredictions = predictions.slice(0, 3);
  topPredictions.forEach(p => {
    if (p.prediction === finalPrediction) {
      baseConfidence += (p.confidence - 65) * 0.3;
    }
  });
  
  const agreementRatio = (finalPrediction === 'Tài' ? taiVotes.length : xiuVotes.length) / predictions.length;
  baseConfidence += Math.round(agreementRatio * 12);
  
  // Thêm boost từ ML
  const mlBoost = Math.abs(mlProbability - 0.5) * 25;
  baseConfidence += mlBoost;
  
  const adaptiveBoost = getAdaptiveConfidenceBoost(type);
  baseConfidence += adaptiveBoost;
  
  let finalConfidence = Math.round(baseConfidence);
  
  // Giới hạn confidence 60-94%
  finalConfidence = Math.max(60, Math.min(94, finalConfidence));
  
  // Lưu pattern cho reinforcement learning
  const patternForRL = results.slice(0, 10).join('');
  updateReinforcementMemory(type, patternForRL, finalPrediction);
  
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
    if (recentAccuracy > 0.65) {
      newWeight = Math.min(3.0, oldWeight * 1.1);
    } else if (recentAccuracy < 0.35) {
      newWeight = Math.max(0.2, oldWeight * 0.9);
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
      
      // Cập nhật Deep ML model
      const actualData = currentData.find(d => d.Phien.toString() === pred.phien);
      if (actualData) {
        const allResults = learningData[type].predictions
          .filter(p => p.verified)
          .slice(0, 20)
          .map(p => p.actual);
        const allSums = currentData.slice(0, 20).map(d => d.Tong);
        const features = extractAdvancedFeatures(allResults, allSums);
        updateDeepMLModel(type, features, pred.actual);
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
    'Wave Pattern': 'wave', 'Golden Ratio': 'golden_ratio',
    'Transformer': 'transformer', 'Attention Mechanism': 'attention_mechanism',
    'Ensemble Voting': 'ensemble_voting', 'Reinforcement Learning': 'reinforcement',
    'Bayesian Inference': 'bayesian_inference', 'Clustering Pattern': 'clustering_pattern'
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
  
  if (accuracy > 0.72) return 12;
  if (accuracy > 0.62) return 7;
  if (accuracy > 0.52) return 4;
  if (accuracy < 0.28) return -12;
  if (accuracy < 0.38) return -7;
  
  return 0;
}

function getSmartPredictionAdjustment(type, prediction, patterns) {
  const streakInfo = learningData[type].streakAnalysis;
  
  if (streakInfo.currentStreak <= -5) {
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
  
  if (Math.abs(taiPatternScore - xiuPatternScore) > 0.8) {
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
  res.send('t.me/CuTools - Advanced Prediction API v8.0');
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
      ml_probability: result.mlProbability,
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
      ml_probability: result.mlProbability,
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
    },
    reinforcementMemorySize: reinforcementMemory.hu.length
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
    },
    reinforcementMemorySize: reinforcementMemory.md5.length
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
      mlModel: { weights: {}, bias: 0, lastTraining: null, hiddenWeights: {}, hiddenBias: {} }
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
      mlModel: { weights: {}, bias: 0, lastTraining: null, hiddenWeights: {}, hiddenBias: {} }
    }
  };
  reinforcementMemory = { hu: [], md5: [] };
  saveLearningData();
  res.json({ message: 'Learning data reset successfully' });
});

// Load data và khởi động server
loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log('========================================');
  console.log('LAU CUA 79 - ADVANCED PREDICTION API v8.0');
  console.log('========================================');
  console.log('');
  console.log('🎯 NÂNG CẤP THUẬT TOÁN MỚI:');
  console.log('  1. Transformer - Self-attention mechanism');
  console.log('  2. Multi-head Attention - 4 heads parallel');
  console.log('  3. Ensemble Voting - RSI, MACD, BB, Stochastic');
  console.log('  4. Reinforcement Learning - Học từ lịch sử');
  console.log('  5. Bayesian Inference - Xác suất hậu nghiệm');
  console.log('  6. Clustering Pattern - K-means clustering');
  console.log('  7. Deep Neural Network - 2 hidden layers');
  console.log('  8. Technical Indicators - RSI, MACD, BB, Stochastic');
  console.log('  9. Real-time ML Model Updates');
  console.log('');
  console.log('📊 FEATURES MỚI:');
  console.log('  - RSI (Relative Strength Index)');
  console.log('  - MACD (Moving Average Convergence Divergence)');
  console.log('  - Bollinger Bands');
  console.log('  - Stochastic Oscillator');
  console.log('  - ATR (Average True Range)');
  console.log('');
  console.log('💾 FILES: tiendat.json, tiendat1.json');
  console.log('👤 ID: @tiendataox');
  console.log('========================================');
  
  startAutoSaveTask();
});