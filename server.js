const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 5000;

// ==================== CẤU HÌNH CAO CẤP ====================
const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'Tskhang.json';
const HISTORY_FILE = 'Tskhang1.json';

// Bộ nhớ đệm thông minh
let cache = {
  hu: { data: null, timestamp: 0, ttl: 5000 },
  md5: { data: null, timestamp: 0, ttl: 5000 }
};

// ==================== CẤU TRÚC DỮ LIỆU HỌC SÂU ====================
let deepLearning = {
  hu: {
    lstmWeights: {},
    transformerAttention: {},
    reinforcementQ: {},
    ensembleModels: [],
    metaLearner: { accuracy: 0.65, bias: 0, lastAdjustment: null },
    patternLibrary: new Map(),
    temporalPatterns: [],
    anomalyScores: {},
    confidenceCalibration: { slope: 1.0, intercept: 0.0 }
  },
  md5: {
    lstmWeights: {},
    transformerAttention: {},
    reinforcementQ: {},
    ensembleModels: [],
    metaLearner: { accuracy: 0.65, bias: 0, lastAdjustment: null },
    patternLibrary: new Map(),
    temporalPatterns: [],
    anomalyScores: {},
    confidenceCalibration: { slope: 1.0, intercept: 0.0 }
  }
};

let predictionHistory = { hu: [], md5: [] };
let lastProcessedPhien = { hu: null, md5: null };
const MAX_HISTORY = 200;
const AUTO_SAVE_INTERVAL = 15000; // 15 giây

// ==================== HỆ SỐ THÔNG MINH ====================
const SMART_PARAMS = {
  entropyThreshold: 0.7,
  volatilityDecay: 0.95,
  momentumFactor: 0.3,
  meanReversion: 0.2,
  bayesianPrior: 0.5,
  kalmanGain: 0.1,
  monteCarloSims: 1000,
  chaosTheory: true,
  fractalDimension: 1.5,
  hurstExponent: 0.5
};

// ==================== KHỞI TẠO DỮ LIỆU HỌC ====================
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
    markovChain: {},
    neuralMemory: [],
    bayesianBeliefs: { tai: 0.5, xiu: 0.5 },
    reinforcementPolicy: { exploreRate: 0.1, exploitRate: 0.9 }
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
    markovChain: {},
    neuralMemory: [],
    bayesianBeliefs: { tai: 0.5, xiu: 0.5 },
    reinforcementPolicy: { exploreRate: 0.1, exploitRate: 0.9 }
  }
};

const DEFAULT_PATTERN_WEIGHTS = {
  'cau_bet': 1.0, 'cau_dao_11': 1.0, 'cau_22': 1.0, 'cau_33': 1.0, 'cau_44': 1.0,
  'cau_55': 1.0, 'cau_121': 1.0, 'cau_123': 1.0, 'cau_321': 1.0, 'cau_212': 1.0,
  'cau_1221': 1.0, 'cau_2112': 1.0, 'cau_nhay_coc': 1.0, 'cau_nhip_nghieng': 1.0,
  'cau_3van1': 1.0, 'cau_be_cau': 1.0, 'cau_chu_ky': 1.0, 'cau_gap': 1.0,
  'cau_ziczac': 1.0, 'cau_doi': 1.0, 'cau_rong': 1.0, 'cau_tu_nhien': 1.0,
  'distribution': 1.0, 'dice_pattern': 1.0, 'sum_trend': 1.0, 'momentum': 1.0,
  'break_pattern': 1.0, 'alternating_pattern': 1.0, 'harmonic_pattern': 1.0,
  'elliott_wave': 1.2, 'fibonacci_retracement': 1.15, 'support_resistance': 1.1,
  'volume_profile': 1.05, 'market_sentiment': 1.1, 'arbitrage_signal': 1.2,
  'neural_prediction': 1.25, 'lstm_forecast': 1.3, 'transformer_analysis': 1.35,
  'reinforcement_learning': 1.2, 'ensemble_vote': 1.4, 'bayesian_inference': 1.15,
  'monte_carlo': 1.2, 'chaos_theory': 1.1, 'fractal_analysis': 1.15
};

// ==================== HÀM TIỆN ÍCH NÂNG CAO ====================
function calculateEntropy(sequence) {
  const counts = sequence.reduce((acc, val) => {
    acc[val] = (acc[val] || 0) + 1;
    return acc;
  }, {});
  const entropy = -Object.values(counts).reduce((sum, count) => {
    const p = count / sequence.length;
    return sum + p * Math.log2(p);
  }, 0);
  return entropy;
}

function calculateHurstExponent(sequence) {
  if (sequence.length < 10) return 0.5;
  const N = sequence.length;
  const mean = sequence.reduce((a, b) => a + b, 0) / N;
  const deviations = sequence.map(x => x - mean);
  const Z = deviations.reduce((arr, val, i) => {
    arr.push((arr[i - 1] || 0) + val);
    return arr;
  }, []);
  const R = Math.max(...Z) - Math.min(...Z);
  const S = Math.sqrt(deviations.reduce((sum, val) => sum + val * val, 0) / N);
  if (S === 0) return 0.5;
  return Math.log(R / S) / Math.log(N);
}

function kalmanFilter(measurement, previousEstimate, previousError) {
  const gain = previousError / (previousError + 0.1);
  const estimate = previousEstimate + gain * (measurement - previousEstimate);
  const error = (1 - gain) * previousError + 0.05;
  return { estimate, error };
}

function monteCarloSimulation(results, iterations = 1000) {
  const taiProb = results.filter(r => r === 'Tài').length / results.length;
  const simulations = [];
  for (let i = 0; i < iterations; i++) {
    const random = Math.random();
    simulations.push(random < taiProb ? 'Tài' : 'Xỉu');
  }
  const predictedTai = simulations.filter(s => s === 'Tài').length / iterations;
  const confidence = Math.abs(predictedTai - 0.5) * 2 * 100;
  return { prediction: predictedTai > 0.5 ? 'Tài' : 'Xỉu', confidence: Math.min(95, confidence) };
}

function calculateFractalDimension(sequence) {
  if (sequence.length < 5) return 1.5;
  let sum = 0;
  for (let i = 1; i < sequence.length; i++) {
    sum += Math.abs(sequence[i] - sequence[i - 1]);
  }
  const length = sum;
  const diameter = Math.max(...sequence) - Math.min(...sequence);
  if (diameter === 0) return 1;
  return Math.log(length) / Math.log(diameter);
}

// ==================== THUẬT TOÁN DỰ ĐOÁN THẾ HỆ MỚI ====================

// 1. LSTM Neural Network mô phỏng
function lstmPrediction(sequence, type) {
  if (sequence.length < 10) return null;
  
  // Mô phỏng LSTM với trọng số động
  const weights = deepLearning[type].lstmWeights;
  const sequenceNum = sequence.map(s => s === 'Tài' ? 1 : 0);
  
  let hiddenState = 0;
  let cellState = 0;
  const forgetGate = 0.85;
  const inputGate = 0.7;
  const outputGate = 0.8;
  
  for (let i = 0; i < sequenceNum.length; i++) {
    const input = sequenceNum[i];
    const forget = forgetGate * cellState;
    const inputTransform = inputGate * input;
    cellState = forget + inputTransform;
    hiddenState = outputGate * Math.tanh(cellState);
  }
  
  const prediction = hiddenState > 0.3 ? 1 : 0;
  const confidence = 60 + Math.abs(hiddenState) * 25;
  
  return { prediction: prediction === 1 ? 'Tài' : 'Xỉu', confidence: Math.min(88, confidence) };
}

// 2. Transformer Attention Mechanism
function transformerAttention(results, type) {
  if (results.length < 15) return null;
  
  const attentionScores = [];
  const query = results.slice(0, 5);
  const keys = results.slice(5, 15);
  
  for (let i = 0; i < keys.length; i++) {
    let score = 0;
    for (let j = 0; j < query.length; j++) {
      if (keys[i] === query[j]) score += 1;
    }
    attentionScores.push(score);
  }
  
  const softmax = attentionScores.map(s => Math.exp(s) / attentionScores.reduce((a, b) => a + Math.exp(b), 0));
  const weightedSum = keys.reduce((sum, key, idx) => sum + (key === 'Tài' ? 1 : 0) * softmax[idx], 0);
  
  const prediction = weightedSum > 0.5 ? 'Tài' : 'Xỉu';
  const confidence = 65 + Math.abs(weightedSum - 0.5) * 40;
  
  return { prediction, confidence: Math.min(90, confidence) };
}

// 3. Reinforcement Learning Q-Learning
function reinforcementQLearning(state, action, reward, type) {
  const qTable = deepLearning[type].reinforcementQ;
  const key = state.join(',');
  const lr = 0.1;
  const gamma = 0.95;
  
  if (!qTable[key]) {
    qTable[key] = { tai: 0.5, xiu: 0.5 };
  }
  
  const maxFutureQ = Math.max(qTable[key].tai, qTable[key].xiu);
  const currentQ = qTable[key][action];
  const newQ = currentQ + lr * (reward + gamma * maxFutureQ - currentQ);
  qTable[key][action] = newQ;
  
  const bestAction = qTable[key].tai > qTable[key].xiu ? 'Tài' : 'Xỉu';
  const confidence = 50 + Math.abs(qTable[key].tai - qTable[key].xiu) * 40;
  
  return { prediction: bestAction, confidence: Math.min(92, confidence) };
}

// 4. Ensemble Learning với nhiều mô hình
function ensemblePrediction(results, type) {
  const predictions = [];
  
  const lstm = lstmPrediction(results, type);
  if (lstm) predictions.push(lstm);
  
  const transformer = transformerAttention(results, type);
  if (transformer) predictions.push(transformer);
  
  const markov = markovChainPrediction(results, type);
  if (markov) predictions.push(markov);
  
  const monteCarlo = monteCarloSimulation(results, 500);
  if (monteCarlo) predictions.push(monteCarlo);
  
  if (predictions.length === 0) return null;
  
  const taiWeight = predictions.filter(p => p.prediction === 'Tài').reduce((sum, p) => sum + p.confidence, 0);
  const xiuWeight = predictions.filter(p => p.prediction === 'Xỉu').reduce((sum, p) => sum + p.confidence, 0);
  
  const totalWeight = taiWeight + xiuWeight;
  const finalPrediction = taiWeight > xiuWeight ? 'Tài' : 'Xỉu';
  const confidence = Math.max(taiWeight, xiuWeight) / totalWeight * 100;
  
  return { prediction: finalPrediction, confidence: Math.min(94, confidence) };
}

// 5. Markov Chain với bậc động
function markovChainPrediction(results, type) {
  if (results.length < 5) return null;
  
  const order = Math.min(3, Math.floor(results.length / 3));
  const chain = learningData[type].markovChain;
  
  for (let i = order; i < results.length; i++) {
    const state = results.slice(i - order, i).join(',');
    const next = results[i];
    if (!chain[state]) chain[state] = { tai: 0, xiu: 0 };
    chain[state][next === 'Tài' ? 'tai' : 'xiu']++;
  }
  
  const currentState = results.slice(0, order).join(',');
  const probabilities = chain[currentState];
  
  if (!probabilities) return null;
  
  const total = probabilities.tai + probabilities.xiu;
  const taiProb = probabilities.tai / total;
  const prediction = taiProb > 0.5 ? 'Tài' : 'Xỉu';
  const confidence = 55 + Math.abs(taiProb - 0.5) * 60;
  
  return { prediction, confidence: Math.min(85, confidence) };
}

// 6. Harmonic Pattern Recognition
function detectHarmonicPatterns(results, type) {
  if (results.length < 12) return null;
  
  const numResults = results.map(r => r === 'Tài' ? 1 : 0);
  const diffs = [];
  for (let i = 1; i < numResults.length; i++) {
    diffs.push(numResults[i] - numResults[i - 1]);
  }
  
  // Phát hiện mô hình sóng Elliott
  let waveCount = 0;
  let currentWave = diffs[0] > 0 ? 'up' : 'down';
  
  for (let i = 1; i < diffs.length; i++) {
    const newWave = diffs[i] > 0 ? 'up' : 'down';
    if (newWave !== currentWave) {
      waveCount++;
      currentWave = newWave;
    }
  }
  
  if (waveCount >= 4 && waveCount <= 6) {
    const lastDiff = diffs[diffs.length - 1];
    const prediction = lastDiff > 0 ? 'Xỉu' : 'Tài'; // Đảo chiều sau sóng Elliott
    return { prediction, confidence: 75, pattern: 'Elliott Wave' };
  }
  
  // Fibonacci retracement
  const high = Math.max(...numResults);
  const low = Math.min(...numResults);
  const fib382 = low + (high - low) * 0.382;
  const fib618 = low + (high - low) * 0.618;
  const current = numResults[0];
  
  if (current > fib618) {
    return { prediction: 'Xỉu', confidence: 72, pattern: 'Fibonacci 61.8% Resistance' };
  }
  if (current < fib382) {
    return { prediction: 'Tài', confidence: 72, pattern: 'Fibonacci 38.2% Support' };
  }
  
  return null;
}

// 7. Bayesian Inference
function bayesianUpdate(type, observation) {
  const prior = learningData[type].bayesianBeliefs;
  const likelihood = {
    tai: observation === 'Tài' ? 0.7 : 0.3,
    xiu: observation === 'Xỉu' ? 0.7 : 0.3
  };
  
  const posteriorTai = prior.tai * likelihood.tai;
  const posteriorXiu = prior.xiu * likelihood.xiu;
  const normalizer = posteriorTai + posteriorXiu;
  
  learningData[type].bayesianBeliefs = {
    tai: posteriorTai / normalizer,
    xiu: posteriorXiu / normalizer
  };
  
  const prediction = learningData[type].bayesianBeliefs.tai > 0.5 ? 'Tài' : 'Xỉu';
  const confidence = Math.abs(learningData[type].bayesianBeliefs.tai - 0.5) * 2 * 100;
  
  return { prediction, confidence: Math.min(88, confidence) };
}

// 8. Chaos Theory & Fractal Analysis
function chaosTheoryPrediction(results, type) {
  if (results.length < 20) return null;
  
  const numResults = results.map(r => r === 'Tài' ? 1 : 0);
  const entropy = calculateEntropy(results);
  const hurst = calculateHurstExponent(numResults);
  const fractalDim = calculateFractalDimension(numResults);
  
  // Lý thuyết hỗn loạn: entropy cao = khó dự đoán, cần giảm confidence
  // Hurst > 0.5 = xu hướng, < 0.5 = mean reversion
  
  let prediction = null;
  let confidence = 65;
  
  if (hurst > 0.6) {
    // Xu hướng mạnh
    const trend = numResults.slice(0, 5).reduce((a, b) => a + b, 0) > 2.5 ? 'Tài' : 'Xỉu';
    prediction = trend;
    confidence += hurst * 15;
  } else if (hurst < 0.4) {
    // Mean reversion
    const recentAvg = numResults.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    prediction = recentAvg > 0.5 ? 'Xỉu' : 'Tài';
    confidence += (0.5 - hurst) * 20;
  } else {
    // Random walk
    prediction = Math.random() > 0.5 ? 'Tài' : 'Xỉu';
    confidence = 55;
  }
  
  // Điều chỉnh theo entropy
  if (entropy > 0.9) {
    confidence *= 0.85;
  } else if (entropy < 0.5) {
    confidence *= 1.1;
  }
  
  return { prediction, confidence: Math.min(85, confidence), hurst, entropy, fractalDim };
}

// ==================== CÁC HÀM PHÂN TÍCH TRUYỀN THỐNG NÂNG CẤP ====================

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
    const weight = learningData[type].patternWeights['cau_bet'] || 1.0;
    const shouldBreak = streakLength >= 4;
    const confidence = shouldBreak ? 70 + streakLength : 60 + streakLength;
    
    return {
      detected: true,
      prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
      confidence: Math.min(88, confidence * weight),
      name: `🔥 Cầu Bệt ${streakLength} phiên ${streakType}`,
      patternId: 'cau_bet',
      priority: 9
    };
  }
  return { detected: false };
}

function analyzeSmartBet(results, type) {
  if (results.length < 12) return { detected: false };
  
  const windows = [
    results.slice(0, 4),
    results.slice(4, 8),
    results.slice(8, 12)
  ];
  
  const taiCounts = windows.map(w => w.filter(r => r === 'Tài').length);
  const trends = [];
  
  for (let i = 1; i < taiCounts.length; i++) {
    trends.push(taiCounts[i] - taiCounts[i - 1]);
  }
  
  const accelerating = trends[0] > 0 && trends[1] > trends[0];
  const decelerating = trends[0] < 0 && trends[1] < trends[0];
  
  if (accelerating) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: 78,
      name: '🚀 Xu Hướng Gia Tốc Tài',
      patternId: 'smart_bet',
      priority: 10
    };
  }
  
  if (decelerating) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: 78,
      name: '📉 Xu Hướng Giảm Tốc Xỉu',
      patternId: 'smart_bet',
      priority: 10
    };
  }
  
  return { detected: false };
}

function analyzeAdvancedBreakPattern(results, type) {
  if (results.length < 8) return { detected: false };
  
  // Phát hiện pattern bẻ cầu thông minh
  const recent = results.slice(0, 6);
  const pattern = recent.join('');
  
  const breakPatterns = [
    { pattern: 'TàiTàiXỉuXỉuTàiTài', prediction: 'Xỉu', confidence: 82, name: '🎯 Pattern 2-2-2 Đảo' },
    { pattern: 'XỉuXỉuTàiTàiXỉuXỉu', prediction: 'Tài', confidence: 82, name: '🎯 Pattern 2-2-2 Đảo' },
    { pattern: 'TàiXỉuTàiXỉuTàiXỉu', prediction: 'Tài', confidence: 75, name: '🔄 Pattern Đảo Dài (bẻ chu kỳ)' },
    { pattern: 'XỉuTàiXỉuTàiXỉuTài', prediction: 'Xỉu', confidence: 75, name: '🔄 Pattern Đảo Dài (bẻ chu kỳ)' }
  ];
  
  for (const bp of breakPatterns) {
    if (pattern.includes(bp.pattern)) {
      return {
        detected: true,
        prediction: bp.prediction,
        confidence: bp.confidence,
        name: bp.name,
        patternId: 'break_pattern',
        priority: 11
      };
    }
  }
  
  return { detected: false };
}

function analyzeMomentum(results, type) {
  if (results.length < 10) return { detected: false };
  
  const numResults = results.map(r => r === 'Tài' ? 1 : 0);
  const momentum = [];
  
  for (let i = 3; i < numResults.length; i++) {
    momentum.push(numResults[i] - numResults[i - 3]);
  }
  
  const avgMomentum = momentum.reduce((a, b) => a + b, 0) / momentum.length;
  const lastMomentum = momentum[momentum.length - 1];
  
  if (Math.abs(lastMomentum) > Math.abs(avgMomentum) * 1.5) {
    const prediction = lastMomentum > 0 ? 'Tài' : 'Xỉu';
    return {
      detected: true,
      prediction,
      confidence: 70 + Math.abs(lastMomentum) * 10,
      name: `⚡ Đà ${lastMomentum > 0 ? 'Tăng Mạnh' : 'Giảm Mạnh'}`,
      patternId: 'momentum',
      priority: 8
    };
  }
  
  return { detected: false };
}

function analyzeVolumeProfile(data, type) {
  if (data.length < 20) return { detected: false };
  
  const volumes = data.map(d => d.Tong);
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const lastVolume = volumes[0];
  const volumeRatio = lastVolume / avgVolume;
  
  if (volumeRatio > 1.3) {
    return {
      detected: true,
      prediction: lastVolume > 10 ? 'Tài' : 'Xỉu',
      confidence: 65 + volumeRatio * 10,
      name: `📊 Volume Đột Biến (${volumeRatio.toFixed(1)}x)`,
      patternId: 'volume_profile',
      priority: 7
    };
  }
  
  return { detected: false };
}

function analyzeMarketSentiment(results, type) {
  if (results.length < 30) return { detected: false };
  
  const recentAccuracy = learningData[type].recentAccuracy;
  if (recentAccuracy.length < 10) return { detected: false };
  
  const accuracy = recentAccuracy.reduce((a, b) => a + b, 0) / recentAccuracy.length;
  const sentiment = accuracy > 0.6 ? 'bullish' : accuracy < 0.4 ? 'bearish' : 'neutral';
  
  if (sentiment === 'bullish') {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: 68 + accuracy * 15,
      name: '😎 Sentiment Tích Cực',
      patternId: 'market_sentiment',
      priority: 6
    };
  }
  
  if (sentiment === 'bearish') {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: 68 + (1 - accuracy) * 15,
      name: '😰 Sentiment Tiêu Cực',
      patternId: 'market_sentiment',
      priority: 6
    };
  }
  
  return { detected: false };
}

function analyzeArbitrageSignal(dataHu, dataMd5, type) {
  if (!dataHu || !dataMd5 || dataHu.length < 5 || dataMd5.length < 5) return { detected: false };
  
  const huTrend = dataHu.slice(0, 5).filter(d => d.Ket_qua === 'Tài').length;
  const md5Trend = dataMd5.slice(0, 5).filter(d => d.Ket_qua === 'Tài').length;
  
  if (Math.abs(huTrend - md5Trend) >= 3) {
    const prediction = huTrend > md5Trend ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: 80,
      name: '🔄 Arbitrage Signal (Chênh lệch 2 bàn)',
      patternId: 'arbitrage_signal',
      priority: 12
    };
  }
  
  return { detected: false };
}

// ==================== HÀM DỰ ĐOÁN CHÍNH CAO CẤP ====================

async function calculateAdvancedPrediction(data, type) {
  const last50 = data.slice(0, 50);
  const results = last50.map(d => d.Ket_qua);
  const allPatterns = [];
  const predictions = [];
  
  // Lấy dữ liệu MD5 cho arbitrage nếu cần
  let md5Data = null;
  if (type === 'hu') {
    md5Data = await fetchDataMd5();
  }
  
  // 1. Ensemble Learning (ưu tiên cao nhất)
  const ensemble = ensemblePrediction(results, type);
  if (ensemble && ensemble.confidence > 70) {
    predictions.push({ 
      prediction: ensemble.prediction, 
      confidence: ensemble.confidence, 
      priority: 20, 
      name: '🧠 Ensemble AI (LSTM+Transformer+Markov)'
    });
    allPatterns.push({ name: 'Ensemble AI', prediction: ensemble.prediction });
  }
  
  // 2. Reinforcement Learning
  const currentState = results.slice(0, 5);
  const rl = reinforcementQLearning(currentState, null, 0, type);
  if (rl && rl.confidence > 68) {
    predictions.push({ 
      prediction: rl.prediction, 
      confidence: rl.confidence, 
      priority: 19, 
      name: '🎯 Reinforcement Q-Learning'
    });
    allPatterns.push({ name: 'Reinforcement Learning', prediction: rl.prediction });
  }
  
  // 3. Chaos Theory & Fractal
  const chaos = chaosTheoryPrediction(results, type);
  if (chaos && chaos.confidence > 65) {
    predictions.push({ 
      prediction: chaos.prediction, 
      confidence: chaos.confidence, 
      priority: 18, 
      name: `🌊 Chaos Theory (H=${chaos.hurst?.toFixed(2)})`
    });
    allPatterns.push({ name: 'Chaos Theory', prediction: chaos.prediction });
  }
  
  // 4. Harmonic Patterns
  const harmonic = detectHarmonicPatterns(results, type);
  if (harmonic) {
    predictions.push({ 
      prediction: harmonic.prediction, 
      confidence: harmonic.confidence, 
      priority: 17, 
      name: `🎵 ${harmonic.pattern}`
    });
    allPatterns.push({ name: harmonic.pattern, prediction: harmonic.prediction });
  }
  
  // 5. Arbitrage Signal
  if (type === 'hu' && md5Data) {
    const arbitrage = analyzeArbitrageSignal(data, md5Data, type);
    if (arbitrage.detected) {
      predictions.push({ 
        prediction: arbitrage.prediction, 
        confidence: arbitrage.confidence, 
        priority: 16, 
        name: arbitrage.name
      });
      allPatterns.push(arbitrage);
    }
  }
  
  // 6. Advanced Break Pattern
  const advancedBreak = analyzeAdvancedBreakPattern(results, type);
  if (advancedBreak.detected) {
    predictions.push({ 
      prediction: advancedBreak.prediction, 
      confidence: advancedBreak.confidence, 
      priority: 15, 
      name: advancedBreak.name
    });
    allPatterns.push(advancedBreak);
  }
  
  // 7. Smart Bet
  const smartBet = analyzeSmartBet(results, type);
  if (smartBet.detected) {
    predictions.push({ 
      prediction: smartBet.prediction, 
      confidence: smartBet.confidence, 
      priority: 14, 
      name: smartBet.name
    });
    allPatterns.push(smartBet);
  }
  
  // 8. Momentum
  const momentum = analyzeMomentum(results, type);
  if (momentum.detected) {
    predictions.push({ 
      prediction: momentum.prediction, 
      confidence: momentum.confidence, 
      priority: 13, 
      name: momentum.name
    });
    allPatterns.push(momentum);
  }
  
  // 9. Volume Profile
  const volume = analyzeVolumeProfile(last50, type);
  if (volume.detected) {
    predictions.push({ 
      prediction: volume.prediction, 
      confidence: volume.confidence, 
      priority: 12, 
      name: volume.name
    });
    allPatterns.push(volume);
  }
  
  // 10. Market Sentiment
  const sentiment = analyzeMarketSentiment(results, type);
  if (sentiment.detected) {
    predictions.push({ 
      prediction: sentiment.prediction, 
      confidence: sentiment.confidence, 
      priority: 11, 
      name: sentiment.name
    });
    allPatterns.push(sentiment);
  }
  
  // 11-20. Các pattern truyền thống
  const patterns = [
    analyzeCauBet(results, type),
    analyzeCauDao11(results, type),
    analyzeCau22(results, type),
    analyzeCau33(results, type),
    analyzeCauRong(results, type),
    analyzeBreakStreak(results, type),
    analyzeAlternatingBreak(results, type),
    analyzeTriplePattern(results, type)
  ];
  
  for (const p of patterns) {
    if (p.detected) {
      predictions.push({ 
        prediction: p.prediction, 
        confidence: p.confidence, 
        priority: p.priority || 10 - patterns.indexOf(p),
        name: p.name
      });
      allPatterns.push(p);
    }
  }
  
  // Bayesian update nếu có history
  if (learningData[type].totalPredictions > 10) {
    const bayesian = bayesianUpdate(type, results[0]);
    if (bayesian) {
      predictions.push({ 
        prediction: bayesian.prediction, 
        confidence: bayesian.confidence * 0.9, 
        priority: 10, 
        name: '📐 Bayesian Inference'
      });
    }
  }
  
  // Markov Chain
  const markov = markovChainPrediction(results, type);
  if (markov && markov.confidence > 60) {
    predictions.push({ 
      prediction: markov.prediction, 
      confidence: markov.confidence, 
      priority: 9, 
      name: '🔗 Markov Chain'
    });
    allPatterns.push({ name: 'Markov Chain', prediction: markov.prediction });
  }
  
  // Nếu không có pattern nào
  if (predictions.length === 0) {
    const cauTuNhien = analyzeCauTuNhien(results, type);
    predictions.push({ 
      prediction: cauTuNhien.prediction, 
      confidence: 60, 
      priority: 1, 
      name: '🌿 Cầu Tự Nhiên'
    });
  }
  
  // Sắp xếp theo priority và confidence
  predictions.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
  
  // Tính điểm weighted vote
  let taiScore = 0, xiuScore = 0;
  for (const p of predictions) {
    const weight = p.priority * (p.confidence / 50);
    if (p.prediction === 'Tài') taiScore += weight;
    else xiuScore += weight;
  }
  
  // Kalman filter cho ổn định dự đoán
  const previousPrediction = learningData[type].neuralMemory.slice(-1)[0];
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  
  if (previousPrediction && learningData[type].neuralMemory.length > 5) {
    const kalman = kalmanFilter(
      finalPrediction === 'Tài' ? 1 : 0,
      previousPrediction === 'Tài' ? 1 : 0,
      0.2
    );
    finalPrediction = kalman.estimate > 0.5 ? 'Tài' : 'Xỉu';
  }
  
  // Mean reversion adjustment
  const recentTaiCount = results.slice(0, 10).filter(r => r === 'Tài').length;
  if (recentTaiCount >= 8) {
    finalPrediction = 'Xỉu';
  } else if (recentTaiCount <= 2) {
    finalPrediction = 'Tài';
  }
  
  // Tính confidence cuối cùng
  let finalConfidence = 65;
  const top3 = predictions.slice(0, 3);
  for (const p of top3) {
    if (p.prediction === finalPrediction) {
      finalConfidence += (p.confidence - 65) * 0.4;
    }
  }
  
  const agreement = predictions.filter(p => p.prediction === finalPrediction).length / predictions.length;
  finalConfidence += agreement * 12;
  
  // Adjust theo learning accuracy
  if (learningData[type].totalPredictions > 20) {
    const accuracy = learningData[type].correctPredictions / learningData[type].totalPredictions;
    finalConfidence *= (0.8 + accuracy * 0.4);
  }
  
  // Chaos theory adjustment
  const entropy = calculateEntropy(results.slice(0, 20));
  if (entropy > 0.85) {
    finalConfidence *= 0.85; // Giảm confidence khi entropy cao
  }
  
  finalConfidence = Math.max(55, Math.min(94, finalConfidence));
  
  // Lưu vào neural memory
  learningData[type].neuralMemory.push(finalPrediction);
  if (learningData[type].neuralMemory.length > 50) {
    learningData[type].neuralMemory.shift();
  }
  
  return {
    prediction: finalPrediction,
    confidence: Math.round(finalConfidence),
    factors: predictions.slice(0, 5).map(p => p.name),
    allPatterns,
    detailedAnalysis: {
      totalPatterns: predictions.length,
      ensembleVotes: predictions.length,
      taiScore: Math.round(taiScore),
      xiuScore: Math.round(xiuScore),
      topPatterns: predictions.slice(0, 3).map(p => ({ name: p.name, confidence: p.confidence })),
      chaosMetrics: chaos ? { hurst: chaos.hurst, entropy: entropy, fractalDim: chaos.fractalDim } : null,
      learningStats: {
        totalPredictions: learningData[type].totalPredictions,
        correctPredictions: learningData[type].correctPredictions,
        accuracy: learningData[type].totalPredictions > 0 
          ? (learningData[type].correctPredictions / learningData[type].totalPredictions * 100).toFixed(1) + '%'
          : 'Chưa có dữ liệu',
        currentStreak: learningData[type].streakAnalysis.currentStreak,
        bestStreak: learningData[type].streakAnalysis.bestStreak
      },
      smartMetrics: {
        confidenceScore: finalConfidence,
        patternRichness: predictions.length,
        marketRegime: entropy > 0.7 ? 'Chaotic' : entropy < 0.4 ? 'Trending' : 'Normal'
      }
    }
  };
}

// ==================== CÁC HÀM HỖ TRỢ ====================

function analyzeCauDao11(results, type) {
  if (results.length < 4) return { detected: false };
  
  let alternatingLength = 1;
  for (let i = 1; i < Math.min(results.length, 12); i++) {
    if (results[i] !== results[i - 1]) {
      alternatingLength++;
    } else break;
  }
  
  if (alternatingLength >= 4) {
    const weight = learningData[type].patternWeights['cau_dao_11'] || 1.0;
    return {
      detected: true,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.min(80, 60 + alternatingLength * 3) * weight,
      name: `🔄 Cầu Đảo 1-1 (${alternatingLength} phiên)`,
      patternId: 'cau_dao_11',
      priority: 8
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
      const weight = learningData[type].patternWeights['cau_22'] || 1.0;
      return {
        detected: true,
        prediction: lastPairType === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.min(78, 60 + pairCount * 4) * weight,
        name: `📊 Cầu 2-2 (${pairCount} cặp)`,
        patternId: 'cau_22',
        priority: 7
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
  
  while (i < results.length - 2 && tripleCount < 3) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
      pattern.push(results[i]);
      tripleCount++;
      i += 3;
    } else break;
  }
  
  if (tripleCount >= 1) {
    const lastTripleType = pattern[pattern.length - 1];
    const weight = learningData[type].patternWeights['cau_33'] || 1.0;
    const prediction = tripleCount >= 2 ? (lastTripleType === 'Tài' ? 'Xỉu' : 'Tài') : lastTripleType;
    
    return {
      detected: true,
      prediction,
      confidence: Math.min(82, 65 + tripleCount * 5) * weight,
      name: `🎲 Cầu 3-3 (${tripleCount} bộ ba)`,
      patternId: 'cau_33',
      priority: 7
    };
  }
  return { detected: false };
}

function analyzeCauRong(results, type) {
  if (results.length < 5) return { detected: false };
  
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) streakLength++;
    else break;
  }
  
  if (streakLength >= 5) {
    const weight = learningData[type].patternWeights['cau_rong'] || 1.0;
    return {
      detected: true,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.min(88, 70 + streakLength) * weight,
      name: `🐉 Cầu Rồng ${streakLength} phiên (Bẻ mạnh)`,
      patternId: 'cau_rong',
      priority: 10
    };
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
    return {
      detected: true,
      prediction,
      confidence: Math.min(85, 65 + streakLength),
      name: `⚔️ Bẻ Chuỗi ${streakLength} (${streakType} → ${prediction})`,
      patternId: 'break_pattern',
      priority: 9
    };
  }
  return { detected: false };
}

function analyzeAlternatingBreak(results, type) {
  if (results.length < 8) return { detected: false };
  
  let alternatingCount = 0;
  for (let i = 0; i < results.length - 1; i++) {
    if (results[i] !== results[i + 1]) alternatingCount++;
    else break;
  }
  
  if (alternatingCount >= 7) {
    const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: Math.min(82, 65 + alternatingCount),
      name: `🎭 Bẻ Đảo ${alternatingCount} phiên → ${prediction}`,
      patternId: 'alternating_pattern',
      priority: 8
    };
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
    const tripleType3 = results[6];
    
    if (tripleType1 === tripleType3) {
      const prediction = tripleType1 === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        prediction,
        confidence: 85,
        name: `🎰 3 Bộ Ba Cùng ${tripleType1} → Bẻ ${prediction}`,
        patternId: 'triple_pattern',
        priority: 11
      };
    }
  }
  return { detected: false };
}

function analyzeCauTuNhien(results, type) {
  return {
    detected: true,
    prediction: results[0],
    confidence: 60,
    name: '🌿 Cầu Tự Nhiên (Theo Ván Trước)',
    patternId: 'cau_tu_nhien',
    priority: 1
  };
}

// ==================== CÁC HÀM LOAD/SAVE ====================

function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = fs.readFileSync(LEARNING_FILE, 'utf8');
      const parsed = JSON.parse(data);
      Object.assign(learningData, parsed);
      console.log('✅ Learning data loaded successfully');
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
      console.log('✅ Prediction history loaded');
    }
  } catch (error) {
    console.error('Error loading history:', error.message);
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
    console.error('Error saving history:', error.message);
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

async function fetchDataHu() {
  try {
    if (cache.hu.data && Date.now() - cache.hu.timestamp < cache.hu.ttl) {
      return cache.hu.data;
    }
    const response = await axios.get(API_URL_HU, { timeout: 10000 });
    cache.hu.data = transformApiData(response.data);
    cache.hu.timestamp = Date.now();
    return cache.hu.data;
  } catch (error) {
    console.error('Error fetching HU data:', error.message);
    return cache.hu.data || null;
  }
}

async function fetchDataMd5() {
  try {
    if (cache.md5.data && Date.now() - cache.md5.timestamp < cache.md5.ttl) {
      return cache.md5.data;
    }
    const response = await axios.get(API_URL_MD5, { timeout: 10000 });
    cache.md5.data = transformApiData(response.data);
    cache.md5.timestamp = Date.now();
    return cache.md5.data;
  } catch (error) {
    console.error('Error fetching MD5 data:', error.message);
    return cache.md5.data || null;
  }
}

function recordPrediction(type, phien, prediction, confidence, patterns) {
  learningData[type].predictions.unshift({
    phien: phien.toString(),
    prediction, confidence, patterns,
    timestamp: new Date().toISOString(),
    verified: false, actual: null, isCorrect: null
  });
  learningData[type].totalPredictions++;
  if (learningData[type].predictions.length > 1000) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 1000);
  }
  saveLearningData();
}

function savePredictionToHistory(type, phien, prediction, confidence, latestData) {
  const record = {
    ...latestData,
    Do_tin_cay: `${confidence}%`,
    Phien_hien_tai: phien.toString(),
    Du_doan: prediction,
    ket_qua_du_doan: '',
    id: '@Tskhang',
    timestamp: new Date().toISOString(),
    aiModels: ['LSTM', 'Transformer', 'RL', 'Ensemble']
  };
  predictionHistory[type].unshift(record);
  if (predictionHistory[type].length > MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
  }
  return record;
}

async function updatePredictionResults(type, currentData) {
  let updated = false;
  for (const pred of learningData[type].predictions) {
    if (pred.verified) continue;
    const actualResult = currentData.find(d => d.Phien.toString() === pred.phien);
    if (actualResult) {
      pred.verified = true;
      pred.actual = actualResult.Ket_qua;
      pred.isCorrect = pred.prediction === pred.actual;
      
      if (pred.isCorrect) {
        learningData[type].correctPredictions++;
        learningData[type].streakAnalysis.currentStreak = Math.max(1, learningData[type].streakAnalysis.currentStreak + 1);
        learningData[type].streakAnalysis.bestStreak = Math.max(learningData[type].streakAnalysis.bestStreak, learningData[type].streakAnalysis.currentStreak);
      } else {
        learningData[type].streakAnalysis.currentStreak = Math.min(-1, learningData[type].streakAnalysis.currentStreak - 1);
        learningData[type].streakAnalysis.worstStreak = Math.min(learningData[type].streakAnalysis.worstStreak, learningData[type].streakAnalysis.currentStreak);
      }
      
      // Update reinforcement learning reward
      reinforcementQLearning([], pred.prediction, pred.isCorrect ? 1 : -1, type);
      
      // Update Bayesian beliefs
      bayesianUpdate(type, pred.actual);
      
      learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 100) {
        learningData[type].recentAccuracy.shift();
      }
      updated = true;
    }
  }
  
  if (updated) {
    saveLearningData();
    // Cập nhật history display
    for (const record of predictionHistory[type]) {
      if (!record.ket_qua_du_doan && record.Phien_hien_tai) {
        const actual = currentData.find(d => d.Phien.toString() === record.Phien_hien_tai);
        if (actual) {
          record.ket_qua_du_doan = record.Du_doan === actual.Ket_qua ? '✅ Chính Xác' : '❌ Sai';
        }
      }
    }
    savePredictionHistory();
  }
}

// ==================== AUTO PROCESS ====================

async function autoProcess() {
  try {
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      const latestHuPhien = dataHu[0].Phien;
      const nextHuPhien = latestHuPhien + 1;
      
      if (lastProcessedPhien.hu !== nextHuPhien) {
        await updatePredictionResults('hu', dataHu);
        const result = await calculateAdvancedPrediction(dataHu, 'hu');
        savePredictionToHistory('hu', nextHuPhien, result.prediction, result.confidence, dataHu[0]);
        recordPrediction('hu', nextHuPhien, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.hu = nextHuPhien;
        console.log(`🤖 [HU] Phiên ${nextHuPhien}: ${result.prediction} (${result.confidence}%) | ${result.factors[0] || ''}`);
      }
    }
    
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      const latestMd5Phien = dataMd5[0].Phien;
      const nextMd5Phien = latestMd5Phien + 1;
      
      if (lastProcessedPhien.md5 !== nextMd5Phien) {
        await updatePredictionResults('md5', dataMd5);
        const result = await calculateAdvancedPrediction(dataMd5, 'md5');
        savePredictionToHistory('md5', nextMd5Phien, result.prediction, result.confidence, dataMd5[0]);
        recordPrediction('md5', nextMd5Phien, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.md5 = nextMd5Phien;
        console.log(`🤖 [MD5] Phiên ${nextMd5Phien}: ${result.prediction} (${result.confidence}%) | ${result.factors[0] || ''}`);
      }
    }
    
    savePredictionHistory();
  } catch (error) {
    console.error('Auto process error:', error.message);
  }
}

// ==================== ENDPOINTS ====================

app.get('/', (req, res) => {
  res.json({
    name: '🎲 Lẩu Cua 79 - AI Prediction Engine v7.0',
    author: '@Tskhang',
    status: 'online',
    features: ['LSTM', 'Transformer', 'Reinforcement Learning', 'Ensemble', 'Chaos Theory', 'Bayesian Inference'],
    endpoints: {
      prediction_hu: '/lc79-hu',
      prediction_md5: '/lc79-md5',
      history_hu: '/lc79-hu/lichsu',
      history_md5: '/lc79-md5/lichsu',
      analysis_hu: '/lc79-hu/analysis',
      analysis_md5: '/lc79-md5/analysis',
      stats_hu: '/lc79-hu/stats',
      stats_md5: '/lc79-md5/stats'
    }
  });
});

app.get('/lc79-hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data || data.length === 0) return res.status(500).json({ error: 'Cannot fetch data' });
    
    await updatePredictionResults('hu', data);
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    const result = await calculateAdvancedPrediction(data, 'hu');
    const record = savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
    
    res.json({
      success: true,
      prediction: record.Du_doan,
      confidence: record.Do_tin_cay,
      currentPhien: record.Phien,
      nextPhien: record.Phien_hien_tai,
      currentResult: record.Ket_qua,
      dice: [record.Xuc_xac_1, record.Xuc_xac_2, record.Xuc_xac_3],
      total: record.Tong,
      analysis: result.detailedAnalysis,
      timestamp: record.timestamp,
      poweredBy: 'AI v7.0'
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error', message: error.message });
  }
});

app.get('/lc79-md5', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data || data.length === 0) return res.status(500).json({ error: 'Cannot fetch data' });
    
    await updatePredictionResults('md5', data);
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    const result = await calculateAdvancedPrediction(data, 'md5');
    const record = savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
    
    res.json({
      success: true,
      prediction: record.Du_doan,
      confidence: record.Do_tin_cay,
      currentPhien: record.Phien,
      nextPhien: record.Phien_hien_tai,
      currentResult: record.Ket_qua,
      dice: [record.Xuc_xac_1, record.Xuc_xac_2, record.Xuc_xac_3],
      total: record.Tong,
      analysis: result.detailedAnalysis,
      timestamp: record.timestamp,
      poweredBy: 'AI v7.0'
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error', message: error.message });
  }
});

app.get('/lc79-hu/lichsu', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({
    type: '🎲 Lẩu Cua 79 - Tài Xỉu Hũ',
    total: predictionHistory.hu.length,
    history: predictionHistory.hu.slice(0, limit),
    lastUpdate: new Date().toISOString()
  });
});

app.get('/lc79-md5/lichsu', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({
    type: '🎲 Lẩu Cua 79 - Tài Xỉu MD5',
    total: predictionHistory.md5.length,
    history: predictionHistory.md5.slice(0, limit),
    lastUpdate: new Date().toISOString()
  });
});

app.get('/lc79-hu/analysis', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
    const result = await calculateAdvancedPrediction(data, 'hu');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/lc79-md5/analysis', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
    const result = await calculateAdvancedPrediction(data, 'md5');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/lc79-hu/stats', (req, res) => {
  const stats = learningData.hu;
  const accuracy = stats.totalPredictions > 0 ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  const recentAcc = stats.recentAccuracy.length > 0 
    ? (stats.recentAccuracy.reduce((a, b) => a + b, 0) / stats.recentAccuracy.length * 100).toFixed(1)
    : 0;
  
  res.json({
    type: 'HU Statistics',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${accuracy}%`,
    recentAccuracy: `${recentAcc}%`,
    streak: stats.streakAnalysis,
    bayesianBeliefs: stats.bayesianBeliefs,
    neuralMemorySize: stats.neuralMemory.length,
    lastUpdate: stats.lastUpdate
  });
});

app.get('/lc79-md5/stats', (req, res) => {
  const stats = learningData.md5;
  const accuracy = stats.totalPredictions > 0 ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  const recentAcc = stats.recentAccuracy.length > 0 
    ? (stats.recentAccuracy.reduce((a, b) => a + b, 0) / stats.recentAccuracy.length * 100).toFixed(1)
    : 0;
  
  res.json({
    type: 'MD5 Statistics',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${accuracy}%`,
    recentAccuracy: `${recentAcc}%`,
    streak: stats.streakAnalysis,
    bayesianBeliefs: stats.bayesianBeliefs,
    neuralMemorySize: stats.neuralMemory.length,
    lastUpdate: stats.lastUpdate
  });
});

app.get('/reset', (req, res) => {
  const secret = req.query.secret;
  if (secret !== 'Tskhang2024') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  learningData = {
    hu: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: { ...DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, adaptiveThresholds: {}, recentAccuracy: [], markovChain: {}, neuralMemory: [], bayesianBeliefs: { tai: 0.5, xiu: 0.5 }, reinforcementPolicy: { exploreRate: 0.1, exploitRate: 0.9 } },
    md5: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: { ...DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, adaptiveThresholds: {}, recentAccuracy: [], markovChain: {}, neuralMemory: [], bayesianBeliefs: { tai: 0.5, xiu: 0.5 }, reinforcementPolicy: { exploreRate: 0.1, exploitRate: 0.9 } }
  };
  
  saveLearningData();
  res.json({ message: '✅ Learning data reset successfully', timestamp: new Date().toISOString() });
});

// ==================== KHỞI ĐỘNG SERVER ====================
loadLearningData();
loadPredictionHistory();

// Khởi tạo pattern weights
for (const type of ['hu', 'md5']) {
  Object.keys(DEFAULT_PATTERN_WEIGHTS).forEach(pattern => {
    if (!learningData[type].patternWeights[pattern]) {
      learningData[type].patternWeights[pattern] = DEFAULT_PATTERN_WEIGHTS[pattern];
    }
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║     🎲 LẨU CUA 79 - AI PREDICTION ENGINE v7.0 🚀            ║
║                                                              ║
║     🤖 AI Models: LSTM | Transformer | RL | Ensemble        ║
║     📊 Advanced: Chaos Theory | Bayesian | Markov Chain     ║
║     🎯 Accuracy Target: 75-85%                              ║
║                                                              ║
║     📡 Server: http://0.0.0.0:${PORT}                         ║
║     👤 Author: @Tskhang                                      ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);
  
  // Auto process mỗi 15 giây
  setInterval(() => autoProcess(), AUTO_SAVE_INTERVAL);
  setTimeout(() => autoProcess(), 3000);
});