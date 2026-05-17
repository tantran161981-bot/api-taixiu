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
    mlModel: { weights: {}, bias: 0, lastTraining: null },
    xgbModel: { trees: [], featureImportance: {} }
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
    mlModel: { weights: {}, bias: 0, lastTraining: null },
    xgbModel: { trees: [], featureImportance: {} }
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
  'transformer': 1.3, 'ensemble_voting': 1.4, 'bayesian_inference': 1.2,
  'reinforcement_learning': 1.35, 'gan_prediction': 1.28
};

// ==================== THUẬT TOÁN NÂNG CẤP CAO CẤP ====================

// 1. TRANSFORMER - Attention Mechanism cho dự đoán chuỗi thời gian
function analyzeTransformerPattern(results, sums, type) {
  if (results.length < 15) return { detected: false };
  
  const weights = getPatternWeight(type, 'transformer');
  
  // Self-attention mechanism
  const sequence = results.slice(0, 15).map(r => r === 'Tài' ? 1 : 0);
  const positions = Array.from({ length: 15 }, (_, i) => i);
  
  // Tính attention scores
  const attentionScores = [];
  for (let i = 0; i < sequence.length; i++) {
    let score = 0;
    for (let j = 0; j < sequence.length; j++) {
      const positionDiff = Math.abs(i - j);
      const similarity = sequence[i] === sequence[j] ? 1 : 0;
      score += similarity * Math.exp(-positionDiff / 3);
    }
    attentionScores.push(score);
  }
  
  // Chuẩn hóa attention
  const totalScore = attentionScores.reduce((a, b) => a + b, 1);
  const normalizedAttention = attentionScores.map(s => s / totalScore);
  
  // Tính weighted prediction
  let weightedPred = 0;
  for (let i = 0; i < normalizedAttention.length; i++) {
    weightedPred += normalizedAttention[i] * sequence[i];
  }
  
  const transformerPrediction = weightedPred > 0.55 ? 'Tài' : (weightedPred < 0.45 ? 'Xỉu' : null);
  const attentionConfidence = Math.abs(weightedPred - 0.5) * 200;
  
  if (transformerPrediction && attentionConfidence > 25) {
    return {
      detected: true,
      prediction: transformerPrediction,
      confidence: Math.min(92, Math.round(65 + attentionConfidence)),
      name: `Transformer Attention (Độ tập trung: ${(normalizedAttention[0] * 100).toFixed(0)}% vào ván gần nhất)`,
      patternId: 'transformer',
      attentionWeights: normalizedAttention.slice(0, 5).map(w => w.toFixed(3))
    };
  }
  
  return { detected: false };
}

// 2. ENSEMBLE VOTING - Kết hợp nhiều mô hình
function analyzeEnsembleVoting(results, sums, type) {
  if (results.length < 20) return { detected: false };
  
  const weights = getPatternWeight(type, 'ensemble_voting');
  
  // Các mô hình thành phần
  const models = [
    { name: 'LSTM', predict: () => predictLSTM(results, sums) },
    { name: 'GRU', predict: () => predictGRU(results, sums) },
    { name: 'RandomForest', predict: () => predictRandomForest(results, sums) },
    { name: 'XGBoost', predict: () => predictXGBoost(results, sums, type) }
  ];
  
  let taiVotes = 0, xiuVotes = 0;
  const votes = [];
  
  for (const model of models) {
    const pred = model.predict();
    if (pred === 'Tài') taiVotes++;
    else if (pred === 'Xỉu') xiuVotes++;
    votes.push({ model: model.name, prediction: pred });
  }
  
  const totalVotes = taiVotes + xiuVotes;
  if (totalVotes >= 3) {
    const prediction = taiVotes > xiuVotes ? 'Tài' : 'Xỉu';
    const agreement = Math.max(taiVotes, xiuVotes) / totalVotes;
    const confidence = Math.round(60 + agreement * 30);
    
    return {
      detected: true,
      prediction,
      confidence: Math.min(88, confidence),
      name: `Ensemble Voting (${taiVotes}/${totalVotes} mô hình chọn ${prediction})`,
      patternId: 'ensemble_voting',
      ensembleDetails: votes
    };
  }
  
  return { detected: false };
}

function predictLSTM(results, sums) {
  const seq = results.slice(0, 10).map(r => r === 'Tài' ? 1 : 0);
  let hiddenState = 0;
  let cellState = 0;
  
  for (let i = 0; i < seq.length; i++) {
    const inputGate = 1 / (1 + Math.exp(-(seq[i] * 1.5 + hiddenState * 0.8)));
    const forgetGate = 1 / (1 + Math.exp(-(seq[i] * 0.5 + hiddenState * 1.2)));
    const outputGate = 1 / (1 + Math.exp(-(seq[i] * 0.7 + hiddenState * 1.0)));
    
    cellState = forgetGate * cellState + inputGate * seq[i];
    hiddenState = outputGate * Math.tanh(cellState);
  }
  
  return hiddenState > 0.5 ? 'Tài' : 'Xỉu';
}

function predictGRU(results, sums) {
  const seq = results.slice(0, 10).map(r => r === 'Tài' ? 1 : 0);
  let hiddenState = 0;
  
  for (let i = 0; i < seq.length; i++) {
    const updateGate = 1 / (1 + Math.exp(-(seq[i] * 1.2 + hiddenState * 0.9)));
    const resetGate = 1 / (1 + Math.exp(-(seq[i] * 0.8 + hiddenState * 1.1)));
    const candidate = Math.tanh(seq[i] * 1.0 + resetGate * hiddenState * 0.7);
    hiddenState = (1 - updateGate) * hiddenState + updateGate * candidate;
  }
  
  return hiddenState > 0.5 ? 'Tài' : 'Xỉu';
}

function predictRandomForest(results, sums) {
  const features = extractAdvancedFeatures(results, sums);
  let score = 0;
  
  // Mô phỏng 10 cây quyết định
  for (let i = 0; i < 10; i++) {
    const treePred = features.streakLength * (0.2 + Math.random() * 0.3) +
                     features.taiRatio5 * (0.3 + Math.random() * 0.2) +
                     features.volatility * (0.1 + Math.random() * 0.2);
    score += treePred > 0.5 ? 1 : 0;
  }
  
  return score > 5 ? 'Tài' : 'Xỉu';
}

function predictXGBoost(results, sums, type) {
  const features = extractAdvancedFeatures(results, sums);
  let score = learningData[type].xgbModel.bias || 0;
  
  Object.entries(features).forEach(([key, value]) => {
    if (learningData[type].xgbModel.featureImportance[key]) {
      score += value * learningData[type].xgbModel.featureImportance[key];
    }
  });
  
  return score > 0 ? 'Tài' : 'Xỉu';
}

// 3. BAYESIAN INFERENCE - Suy luận xác suất Bayes
function analyzeBayesianInference(results, sums, type) {
  if (results.length < 15) return { detected: false };
  
  const weights = getPatternWeight(type, 'bayesian_inference');
  
  // Prior probability
  const priorTai = 0.5;
  const priorXiu = 0.5;
  
  // Likelihood dựa trên các pattern gần đây
  const recent5 = results.slice(0, 5);
  const recentPattern = recent5.join('');
  
  // Thống kê conditional probability từ lịch sử
  const patternFrequency = {};
  const patternOutcomes = {};
  
  for (let i = 0; i < results.length - 5; i++) {
    const pattern = results.slice(i, i + 5).join('');
    const next = results[i + 5];
    patternFrequency[pattern] = (patternFrequency[pattern] || 0) + 1;
    if (!patternOutcomes[pattern]) patternOutcomes[pattern] = { Tài: 0, Xỉu: 0 };
    patternOutcomes[pattern][next]++;
  }
  
  const likelihoodTai = patternOutcomes[recentPattern] 
    ? (patternOutcomes[recentPattern].Tài + 1) / (patternFrequency[recentPattern] + 2)
    : 0.5;
  const likelihoodXiu = 1 - likelihoodTai;
  
  // Posterior probability
  const posteriorTai = (likelihoodTai * priorTai) / (likelihoodTai * priorTai + likelihoodXiu * priorXiu);
  
  const bayesianPrediction = posteriorTai > 0.55 ? 'Tài' : (posteriorTai < 0.45 ? 'Xỉu' : null);
  
  if (bayesianPrediction && Math.abs(posteriorTai - 0.5) > 0.08) {
    return {
      detected: true,
      prediction: bayesianPrediction,
      confidence: Math.round(65 + Math.abs(posteriorTai - 0.5) * 60),
      name: `Bayesian Inference (Posterior: ${(posteriorTai * 100).toFixed(1)}% ${bayesianPrediction})`,
      patternId: 'bayesian_inference',
      posteriorProbability: posteriorTai
    };
  }
  
  return { detected: false };
}

// 4. REINFORCEMENT LEARNING - Học tăng cường
function analyzeReinforcementLearning(results, sums, type) {
  if (results.length < 30) return { detected: false };
  
  const weights = getPatternWeight(type, 'reinforcement_learning');
  
  // Q-learning state-action values
  const state = getCurrentState(results, sums);
  const qValues = learningData[type].qTable || initializeQTable();
  
  const actions = ['Tài', 'Xỉu'];
  let bestAction = actions[0];
  let bestQ = -Infinity;
  
  for (const action of actions) {
    const q = qValues[state]?.[action] || 0;
    if (q > bestQ) {
      bestQ = q;
      bestAction = action;
    }
  }
  
  // Exploration vs exploitation
  const epsilon = Math.max(0.05, 1 - learningData[type].totalPredictions / 500);
  let finalAction = bestAction;
  
  if (Math.random() < epsilon) {
    finalAction = actions[Math.floor(Math.random() * actions.length)];
  }
  
  const confidence = Math.round(60 + bestQ * 30);
  
  return {
    detected: true,
    prediction: finalAction,
    confidence: Math.min(90, confidence),
    name: `Reinforcement Learning (Q-value: ${bestQ.toFixed(2)}, ε=${epsilon.toFixed(2)})`,
    patternId: 'reinforcement_learning',
    qValue: bestQ,
    epsilon
  };
}

function getCurrentState(results, sums) {
  const streak = calculateStreakLength(results);
  const taiRatio = results.slice(0, 10).filter(r => r === 'Tài').length / 10;
  const volatility = calculateVolatility(sums.slice(0, 10));
  
  let state = '';
  if (streak >= 4) state += 'streak_high_';
  else if (streak >= 2) state += 'streak_med_';
  else state += 'streak_low_';
  
  if (taiRatio > 0.7) state += 'tai_dominant';
  else if (taiRatio < 0.3) state += 'xiu_dominant';
  else state += 'balanced';
  
  if (volatility > 3) state += '_volatile';
  else state += '_stable';
  
  return state;
}

function initializeQTable() {
  return {
    'streak_high_tai_dominant_stable': { 'Tài': 0.5, 'Xỉu': 0.5 },
    'streak_high_tai_dominant_volatile': { 'Tài': 0.4, 'Xỉu': 0.6 },
    'streak_high_xiu_dominant_stable': { 'Tài': 0.6, 'Xỉu': 0.4 },
    'streak_high_xiu_dominant_volatile': { 'Tài': 0.5, 'Xỉu': 0.5 },
    'streak_med_tai_dominant_stable': { 'Tài': 0.55, 'Xỉu': 0.45 },
    'streak_med_xiu_dominant_stable': { 'Tài': 0.45, 'Xỉu': 0.55 },
    'streak_low_balanced_stable': { 'Tài': 0.5, 'Xỉu': 0.5 },
    'streak_low_balanced_volatile': { 'Tài': 0.5, 'Xỉu': 0.5 }
  };
}

function updateQTable(type, state, action, reward, nextState) {
  if (!learningData[type].qTable) {
    learningData[type].qTable = initializeQTable();
  }
  
  const alpha = 0.1; // Learning rate
  const gamma = 0.9; // Discount factor
  
  const currentQ = learningData[type].qTable[state]?.[action] || 0;
  const nextMaxQ = Math.max(...Object.values(learningData[type].qTable[nextState] || { 'Tài': 0, 'Xỉu': 0 }));
  const newQ = currentQ + alpha * (reward + gamma * nextMaxQ - currentQ);
  
  if (!learningData[type].qTable[state]) {
    learningData[type].qTable[state] = { 'Tài': 0.5, 'Xỉu': 0.5 };
  }
  learningData[type].qTable[state][action] = newQ;
}

// 5. GAN PREDICTION - Generative Adversarial Network mô phỏng
function analyzeGANPrediction(results, sums, type) {
  if (results.length < 25) return { detected: false };
  
  const weights = getPatternWeight(type, 'gan_prediction');
  
  // Generator: tạo mẫu dự đoán
  const noise = Math.random();
  const generatorOutput = generateSyntheticPattern(results, noise);
  
  // Discriminator: đánh giá độ tin cậy
  const realnessScore = calculateRealnessScore(results, generatorOutput);
  
  if (realnessScore > 0.6) {
    return {
      detected: true,
      prediction: generatorOutput.prediction,
      confidence: Math.round(65 + realnessScore * 25),
      name: `GAN Prediction (Realness: ${(realnessScore * 100).toFixed(0)}%)`,
      patternId: 'gan_prediction',
      generatorConfidence: generatorOutput.confidence,
      discriminatorScore: realnessScore
    };
  }
  
  return { detected: false };
}

function generateSyntheticPattern(results, noise) {
  const recentPattern = results.slice(0, 5);
  const taiCount = recentPattern.filter(r => r === 'Tài').length;
  
  let prediction;
  let confidence;
  
  if (noise < 0.33) {
    prediction = taiCount >= 3 ? 'Xỉu' : 'Tài';
    confidence = 65 + taiCount * 5;
  } else if (noise < 0.66) {
    prediction = recentPattern[0];
    confidence = 60;
  } else {
    prediction = recentPattern[recentPattern.length - 1] === 'Tài' ? 'Xỉu' : 'Tài';
    confidence = 68;
  }
  
  return { prediction, confidence: Math.min(85, confidence) };
}

function calculateRealnessScore(realSequence, synthetic) {
  const realPattern = realSequence.slice(0, 5).join('');
  const syntheticPattern = synthetic.prediction;
  
  let score = 0.5;
  
  // Kiểm tra consistency
  const lastReal = realSequence[0];
  if (synthetic.prediction === lastReal) {
    score += 0.2;
  } else {
    score -= 0.1;
  }
  
  // Kiểm tra tính hợp lý
  const recentTaiCount = realSequence.slice(0, 10).filter(r => r === 'Tài').length;
  if (recentTaiCount >= 7 && synthetic.prediction === 'Xỉu') {
    score += 0.15;
  }
  if (recentTaiCount <= 3 && synthetic.prediction === 'Tài') {
    score += 0.15;
  }
  
  return Math.max(0.3, Math.min(0.95, score));
}

// ==================== FEATURE EXTRACTION NÂNG CAO ====================

function extractAdvancedFeatures(results, sums) {
  const features = {
    lastResult: results[0] === 'Tài' ? 1 : 0,
    last3Sum: sums.slice(0, 3).reduce((a, b) => a + b, 0) / 3,
    last5Sum: sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5,
    last10Sum: sums.slice(0, 10).reduce((a, b) => a + b, 0) / 10,
    volatility: calculateVolatility(sums.slice(0, 10)),
    taiRatio5: results.slice(0, 5).filter(r => r === 'Tài').length / 5,
    taiRatio10: results.slice(0, 10).filter(r => r === 'Tài').length / 10,
    taiRatio20: results.slice(0, 20).filter(r => r === 'Tài').length / 20,
    streakLength: calculateStreakLength(results),
    alternatingStrength: calculateAlternatingStrength(results),
    patternComplexity: calculatePatternComplexity(results),
    sumTrend: calculateSumTrend(sums.slice(0, 10)),
    momentum: calculateMomentum(results, sums).taiMomentum,
    sumMomentum: calculateMomentum(results, sums).sumMomentum,
    supportResistance: detectSupportResistance(sums.slice(0, 20)).resistance || 0,
    meanReversion: calculateMeanReversion(sums.slice(0, 15)),
    hurstExponent: calculateHurstExponent(sums.slice(0, 20)),
    entropy: calculateEntropy(results.slice(0, 15))
  };
  return features;
}

function calculateMeanReversion(sums) {
  if (sums.length < 10) return 0;
  const mean = sums.reduce((a, b) => a + b, 0) / sums.length;
  const last = sums[0];
  return (mean - last) / mean;
}

function calculateHurstExponent(sums) {
  if (sums.length < 10) return 0.5;
  const lags = [2, 4, 8];
  let rs = [];
  
  for (const lag of lags) {
    if (lag >= sums.length) continue;
    const subSeries = sums.slice(0, lag);
    const mean = subSeries.reduce((a, b) => a + b, 0) / lag;
    const deviated = subSeries.map(x => x - mean);
    const cumulative = [];
    let sum = 0;
    for (const d of deviated) {
      sum += d;
      cumulative.push(sum);
    }
    const range = Math.max(...cumulative) - Math.min(...cumulative);
    const std = Math.sqrt(deviated.map(x => x * x).reduce((a, b) => a + b, 0) / lag);
    rs.push(range / (std + 0.001));
  }
  
  if (rs.length < 2) return 0.5;
  const hurst = Math.log(rs[rs.length - 1] / rs[0]) / Math.log(lags[rs.length - 1] / lags[0]);
  return Math.min(0.9, Math.max(0.1, hurst));
}

function calculateEntropy(results) {
  if (results.length < 5) return 0;
  const taiCount = results.filter(r => r === 'Tài').length;
  const xiuCount = results.length - taiCount;
  const pTai = taiCount / results.length;
  const pXiu = xiuCount / results.length;
  
  let entropy = 0;
  if (pTai > 0) entropy -= pTai * Math.log2(pTai);
  if (pXiu > 0) entropy -= pXiu * Math.log2(pXiu);
  return entropy;
}

// ==================== PATTERN CHUẨN ĐOÁN CAO CẤP ====================

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
    
    if (streakLength >= 8) {
      shouldBreak = true;
      confidence = 88;
    } else if (streakLength >= 6) {
      shouldBreak = true;
      confidence = 82;
    } else if (streakLength >= 4) {
      shouldBreak = true;
      confidence = 72;
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
  
  const transitions = { 'Tài_Tài': 0, 'Tài_Xỉu': 0, 'Xỉu_Tài': 0, 'Xỉu_Xỉu': 0 };
  
  for (let i = 0; i < results.length - 1; i++) {
    const key = `${results[i]}_${results[i+1]}`;
    transitions[key]++;
  }
  
  const lastResult = results[0];
  const probTai = transitions[`${lastResult}_Tài`] / 
    (transitions[`${lastResult}_Tài`] + transitions[`${lastResult}_Xỉu`] || 1);
  
  if (probTai > 0.7 || probTai < 0.3) {
    const prediction = probTai > 0.7 ? 'Tài' : 'Xỉu';
    return {
      detected: true,
      prediction,
      confidence: Math.round(70 + Math.abs(probTai - 0.5) * 40),
      name: `Markov Chain (Xác suất ${(probTai * 100).toFixed(0)}% ${prediction})`,
      patternId: 'markov_chain'
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

// ==================== TÍNH TOÁN DỰ ĐOÁN CHÍNH ====================

function calculateAdvancedPrediction(data, type) {
  const last50 = data.slice(0, 50);
  const results = last50.map(d => d.Ket_qua);
  const sums = last50.map(d => d.Tong);
  
  initializePatternStats(type);
  
  let predictions = [];
  let factors = [];
  let allPatterns = [];
  
  // Danh sách pattern đã được sắp xếp theo độ ưu tiên
  const patterns = [
    { name: 'Transformer Attention', func: () => analyzeTransformerPattern(results, sums, type), priority: 20 },
    { name: 'Ensemble Voting', func: () => analyzeEnsembleVoting(results, sums, type), priority: 19 },
    { name: 'Reinforcement Learning', func: () => analyzeReinforcementLearning(results, sums, type), priority: 18 },
    { name: 'GAN Prediction', func: () => analyzeGANPrediction(results, sums, type), priority: 18 },
    { name: 'Bayesian Inference', func: () => analyzeBayesianInference(results, sums, type), priority: 17 },
    { name: 'Tổng Phân Tích', func: () => analyzeTongPhanTich(last50, type), priority: 16 },
    { name: 'LSTM Pattern', func: () => analyzeLSTMPattern(results, type), priority: 15 },
    { name: 'Markov Chain', func: () => analyzeMarkovChain(results, type), priority: 14 },
    { name: 'Xu Hướng Mạnh', func: () => analyzeXuHuongManh(results, type), priority: 14 },
    { name: 'Đảo Chiều', func: () => analyzeDaoChieu(results, type), priority: 13 },
    { name: 'Cầu Rồng', func: () => analyzeCauRong(results, type), priority: 12 },
    { name: 'Smart Bet', func: () => analyzeSmartBet(results, type), priority: 11 },
    { name: 'Triple Pattern', func: () => analyzeTriplePattern(results, type), priority: 11 },
    { name: 'Fibonacci', func: () => analyzeFibonacci(sums, type), priority: 10 },
    { name: 'Cầu Bệt', func: () => analyzeCauBet(results, type), priority: 9 }
  ];
  
  for (const pattern of patterns) {
    const result = pattern.func();
    if (result.detected) {
      predictions.push({
        prediction: result.prediction,
        confidence: result.confidence,
        priority: pattern.priority,
        name: result.name,
        details: result
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
  
  // Nếu không có pattern nào
  if (predictions.length === 0) {
    const cauTuNhien = { detected: true, prediction: results[0], confidence: 60, name: 'Cầu Tự Nhiên' };
    predictions.push({ prediction: cauTuNhien.prediction, confidence: 60, priority: 1, name: 'Cầu Tự Nhiên' });
    factors.push('Cầu Tự Nhiên');
    allPatterns.push(cauTuNhien);
  }
  
  // Sắp xếp theo priority và confidence
  predictions.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
  
  // Tính điểm cho Tài và Xỉu
  const taiVotes = predictions.filter(p => p.prediction === 'Tài');
  const xiuVotes = predictions.filter(p => p.prediction === 'Xỉu');
  
  let taiScore = taiVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  let xiuScore = xiuVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  
  // Điều chỉnh theo learning
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
  
  const adaptiveBoost = getAdaptiveConfidenceBoost(type);
  baseConfidence += adaptiveBoost;
  
  let finalConfidence = Math.round(baseConfidence);
  finalConfidence = Math.max(60, Math.min(94, finalConfidence));
  
  // Xác định pattern chính
  const mainPattern = predictions[0];
  const mainPatternConfidence = mainPattern ? mainPattern.confidence : 0;
  const patternStrength = mainPatternConfidence >= 80 ? 'Rất cao' : (mainPatternConfidence >= 70 ? 'Cao' : 'Trung bình');
  
  return {
    success: true,
    prediction: finalPrediction,
    confidence: finalConfidence,
    predictionTime: new Date().toISOString(),
    
    // Thông tin chi tiết
    details: {
      mainPattern: mainPattern ? {
        name: mainPattern.name,
        confidence: mainPattern.confidence,
        strength: patternStrength
      } : null,
      
      patternBreakdown: predictions.slice(0, 5).map(p => ({
        name: p.name,
        prediction: p.prediction,
        confidence: p.confidence,
        weight: p.priority
      })),
      
      votingResult: {
        taiVotes: taiVotes.length,
        xiuVotes: xiuVotes.length,
        taiScore: Math.round(taiScore),
        xiuScore: Math.round(xiuScore),
        agreementRate: `${(agreementRatio * 100).toFixed(0)}%`
      },
      
      marketAnalysis: {
        distribution: {
          taiPercent: distribution.taiPercent.toFixed(1),
          xiuPercent: distribution.xiuPercent.toFixed(1),
          imbalance: distribution.imbalance.toFixed(3)
        },
        volatility: calculateVolatility(sums.slice(0, 10)).toFixed(2),
        entropy: calculateEntropy(results.slice(0, 15)).toFixed(3),
        hurstExponent: calculateHurstExponent(sums.slice(0, 20)).toFixed(3)
      },
      
      learningStats: {
        totalPredictions: learningData[type].totalPredictions,
        correctPredictions: learningData[type].correctPredictions,
        accuracy: learningData[type].totalPredictions > 0 
          ? (learningData[type].correctPredictions / learningData[type].totalPredictions * 100).toFixed(1) + '%'
          : 'Chưa có dữ liệu',
        currentStreak: learningData[type].streakAnalysis.currentStreak,
        bestStreak: learningData[type].streakAnalysis.bestStreak,
        worstStreak: learningData[type].streakAnalysis.worstStreak
      },
      
      aiModels: {
        transformer: allPatterns.find(p => p.patternId === 'transformer') ? 'active' : 'inactive',
        ensemble: allPatterns.find(p => p.patternId === 'ensemble_voting') ? 'active' : 'inactive',
        reinforcement: allPatterns.find(p => p.patternId === 'reinforcement_learning') ? 'active' : 'inactive',
        gan: allPatterns.find(p => p.patternId === 'gan_prediction') ? 'active' : 'inactive',
        bayesian: allPatterns.find(p => p.patternId === 'bayesian_inference') ? 'active' : 'inactive'
      }
    },
    
    // Dữ liệu hiện tại
    currentData: {
      lastResult: results[0],
      lastSum: sums[0],
      lastThree: results.slice(0, 3),
      lastThreeSums: sums.slice(0, 3),
      streakLength: calculateStreakLength(results)
    },
    
    // Thông tin bổ sung
    meta: {
      type: type.toUpperCase(),
      dataPoints: data.length,
      patternsAnalyzed: patterns.length,
      patternsDetected: predictions.length,
      timestamp: new Date().toISOString(),
      version: '8.0'
    }
  };
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

// ==================== HÀM HỖ TRỢ ====================

function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = fs.readFileSync(LEARNING_FILE, 'utf8');
      const parsed = JSON.parse(data);
      learningData = { ...learningData, ...parsed };
      console.log('✅ Learning data loaded successfully from tiendat.json');
    }
  } catch (error) {
    console.error('❌ Error loading learning data:', error.message);
  }
}

function saveLearningData() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch (error) {
    console.error('❌ Error saving learning data:', error.message);
  }
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(data);
      predictionHistory = parsed.history || { hu: [], md5: [] };
      lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
      console.log('✅ Prediction history loaded successfully from tiendat1.json');
      console.log(`  📊 Hu: ${predictionHistory.hu.length} records`);
      console.log(`  📊 MD5: ${predictionHistory.md5.length} records`);
    }
  } catch (error) {
    console.error('❌ Error loading prediction history:', error.message);
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
    console.error('❌ Error saving prediction history:', error.message);
  }
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

function getPatternIdFromName(name) {
  const mapping = {
    'Cầu Bệt': 'cau_bet', 'Cầu Đảo 1-1': 'cau_dao_11',
    'Cầu 2-2': 'cau_22', 'Cầu 3-3': 'cau_33', 'Cầu 4-4': 'cau_44',
    'Cầu 5-5': 'cau_55', 'Cầu 1-2-1': 'cau_121', 'Cầu 1-2-3': 'cau_123',
    'Cầu 3-2-1': 'cau_321', 'Cầu 2-1-2': 'cau_212', 'Cầu 1-2-2-1': 'cau_1221',
    'Cầu 2-1-1-2': 'cau_2112', 'Cầu Nhảy Cóc': 'cau_nhay_coc',
    'Cầu Nhịp Nghiêng': 'cau_nhip_nghieng', 'Cầu 3 Ván 1': 'cau_3van1',
    'Cầu Bẻ Cầu': 'cau_be_cau', 'Cầu Gấp': 'cau_gap',
    'Cầu Ziczac': 'cau_ziczac', 'Cầu Đôi': 'cau_doi', 'Cầu Rồng': 'cau_rong',
    'Đảo Xu Hướng': 'smart_bet', 'Xu Hướng Cực': 'smart_bet',
    'Phân bố': 'distribution', 'Cầu Tự Nhiên': 'cau_tu_nhien',
    'Tổng Phân Tích': 'tong_phan_tich', 'Xu Hướng Mạnh': 'xu_huong_manh',
    'Đảo Chiều': 'dao_chieu', 'LSTM Pattern': 'lstm_pattern',
    'Markov Chain': 'markov_chain', 'Transformer Attention': 'transformer',
    'Ensemble Voting': 'ensemble_voting', 'Reinforcement Learning': 'reinforcement_learning',
    'GAN Prediction': 'gan_prediction', 'Bayesian Inference': 'bayesian_inference'
  };
  
  for (const [key, value] of Object.entries(mapping)) {
    if (name.includes(key)) return value;
  }
  return null;
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
    console.error('❌ Error fetching HU data:', error.message);
    return null;
  }
}

async function fetchDataMd5() {
  try {
    const response = await axios.get(API_URL_MD5, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    console.error('❌ Error fetching MD5 data:', error.message);
    return null;
  }
}

function savePredictionToHistory(type, phien, prediction, confidence, latestData, detailedResult) {
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
    timestamp: new Date().toISOString(),
    patternUsed: detailedResult?.details?.mainPattern?.name || 'Tổng hợp',
    confidenceScore: confidence
  };
  
  predictionHistory[type].unshift(record);
  
  if (predictionHistory[type].length > MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
  }
  
  return record;
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
        
        // Cập nhật Q-learning reward
        if (pred.patterns && pred.patterns.some(p => p.includes('Reinforcement'))) {
          const state = getCurrentState(currentData.slice(0, 10), currentData.slice(0, 10).map(d => d.Tong));
          updateQTable(type, state, pred.prediction, 1, state);
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
        
        // Cập nhật Q-learning penalty
        if (pred.patterns && pred.patterns.some(p => p.includes('Reinforcement'))) {
          const state = getCurrentState(currentData.slice(0, 10), currentData.slice(0, 10).map(d => d.Tong));
          updateQTable(type, state, pred.prediction, -0.5, state);
        }
      }
      
      learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 50) {
        learningData[type].recentAccuracy.shift();
      }
      
      updated = true;
    }
  }
  
  if (updated) {
    learningData[type].lastUpdate = new Date().toISOString();
    saveLearningData();
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
    console.error(`❌ Error updating ${type} history status:`, error.message);
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
        const record = savePredictionToHistory('hu', nextHuPhien, result.prediction, result.confidence, dataHu[0], result);
        recordPrediction('hu', nextHuPhien, result.prediction, result.confidence, result.details.patternBreakdown.map(p => p.name));
        
        lastProcessedPhien.hu = nextHuPhien;
        console.log(`🎯 [Auto] Hu phiên ${nextHuPhien}: ${result.prediction} (${result.confidence}%) - ${result.details.mainPattern?.name || 'Tổng hợp'}`);
      }
    }
    
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      const latestMd5Phien = dataMd5[0].Phien;
      const nextMd5Phien = latestMd5Phien + 1;
      
      if (lastProcessedPhien.md5 !== nextMd5Phien) {
        await verifyPredictions('md5', dataMd5);
        
        const result = calculateAdvancedPrediction(dataMd5, 'md5');
        const record = savePredictionToHistory('md5', nextMd5Phien, result.prediction, result.confidence, dataMd5[0], result);
        recordPrediction('md5', nextMd5Phien, result.prediction, result.confidence, result.details.patternBreakdown.map(p => p.name));
        
        lastProcessedPhien.md5 = nextMd5Phien;
        console.log(`🎯 [Auto] MD5 phiên ${nextMd5Phien}: ${result.prediction} (${result.confidence}%) - ${result.details.mainPattern?.name || 'Tổng hợp'}`);
      }
    }
    
    await updateHistoryStatus('hu');
    await updateHistoryStatus('md5');
    
    savePredictionHistory();
    saveLearningData();
    
  } catch (error) {
    console.error('❌ [Auto] Error processing predictions:', error.message);
  }
}

function startAutoSaveTask() {
  console.log(`⏰ Auto-save task started (every ${AUTO_SAVE_INTERVAL/1000}s)`);
  
  setTimeout(() => {
    autoProcessPredictions();
  }, 5000);
  
  setInterval(() => {
    autoProcessPredictions();
  }, AUTO_SAVE_INTERVAL);
}

// ==================== ENDPOINTS ====================

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║     🎲 LẨU CUA 79 - TÀI XỈU AI PREDICTION API v8.0 🎲       ║
║                                                              ║
║     📡 API Endpoints:                                        ║
║     • GET /lc79-hu      - Dự đoán Tài Xỉu HŨ                ║
║     • GET /lc79-md5     - Dự đoán Tài Xỉu MD5               ║
║     • GET /lc79-hu/lichsu - Lịch sử dự đoán HŨ              ║
║     • GET /lc79-md5/lichsu - Lịch sử dự đoán MD5            ║
║     • GET /lc79-hu/analysis - Phân tích chi tiết HŨ         ║
║     • GET /lc79-md5/analysis - Phân tích chi tiết MD5       ║
║     • GET /lc79-hu/learning - Thống kê học tập HŨ           ║
║     • GET /lc79-md5/learning - Thống kê học tập MD5         ║
║                                                              ║
║     🤖 AI Models: Transformer | Ensemble | RL | GAN | Bayes ║
║     📊 Accuracy: Đang cập nhật theo thời gian thực          ║
║     👤 ID: @tiendataox                                       ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);
});

app.get('/lc79-hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data || data.length === 0) {
      return res.status(500).json({ 
        success: false, 
        error: 'Không thể lấy dữ liệu từ server',
        timestamp: new Date().toISOString()
      });
    }
    
    await verifyPredictions('hu', data);
    
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    
    const result = calculateAdvancedPrediction(data, 'hu');
    
    const record = savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, data[0], result);
    recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.details.patternBreakdown.map(p => p.name));
    
    setTimeout(async () => {
      await updateHistoryStatus('hu');
    }, 5000);
    
    res.json({
      success: true,
      data: {
        currentSession: {
          phien: record.Phien,
          dice: [record.Xuc_xac_1, record.Xuc_xac_2, record.Xuc_xac_3],
          total: record.Tong,
          result: record.Ket_qua
        },
        prediction: {
          nextPhien: parseInt(record.Phien_hien_tai),
          prediction: record.Du_doan,
          confidence: record.Do_tin_cay,
          mainPattern: result.details.mainPattern,
          patternsUsed: result.details.patternBreakdown.length
        },
        analysis: result.details,
        meta: result.meta
      }
    });
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/lc79-md5', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data || data.length === 0) {
      return res.status(500).json({ 
        success: false, 
        error: 'Không thể lấy dữ liệu từ server',
        timestamp: new Date().toISOString()
      });
    }
    
    await verifyPredictions('md5', data);
    
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    
    const result = calculateAdvancedPrediction(data, 'md5');
    
    const record = savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, data[0], result);
    recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.details.patternBreakdown.map(p => p.name));
    
    setTimeout(async () => {
      await updateHistoryStatus('md5');
    }, 5000);
    
    res.json({
      success: true,
      data: {
        currentSession: {
          phien: record.Phien,
          dice: [record.Xuc_xac_1, record.Xuc_xac_2, record.Xuc_xac_3],
          total: record.Tong,
          result: record.Ket_qua
        },
        prediction: {
          nextPhien: parseInt(record.Phien_hien_tai),
          prediction: record.Du_doan,
          confidence: record.Do_tin_cay,
          mainPattern: result.details.mainPattern,
          patternsUsed: result.details.patternBreakdown.length
        },
        analysis: result.details,
        meta: result.meta
      }
    });
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/lc79-hu/lichsu', async (req, res) => {
  try {
    await updateHistoryStatus('hu');
    
    const stats = {
      total: predictionHistory.hu.length,
      correct: predictionHistory.hu.filter(h => h.ket_qua_du_doan === 'Đúng ✅').length,
      wrong: predictionHistory.hu.filter(h => h.ket_qua_du_doan === 'Sai ❌').length,
      pending: predictionHistory.hu.filter(h => !h.ket_qua_du_doan || h.ket_qua_du_doan === '').length
    };
    
    const accuracy = stats.total > 0 ? ((stats.correct / (stats.correct + stats.wrong)) * 100).toFixed(1) : 'N/A';
    
    res.json({
      success: true,
      type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
      stats: {
        totalPredictions: stats.total,
        correct: stats.correct,
        wrong: stats.wrong,
        pending: stats.pending,
        accuracy: stats.total > 0 ? `${accuracy}%` : 'Chưa có dữ liệu'
      },
      history: predictionHistory.hu,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    res.json({
      success: true,
      type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
      stats: { total: predictionHistory.hu.length, correct: 0, wrong: 0, pending: predictionHistory.hu.length, accuracy: 'N/A' },
      history: predictionHistory.hu,
      lastUpdated: new Date().toISOString()
    });
  }
});

app.get('/lc79-md5/lichsu', async (req, res) => {
  try {
    await updateHistoryStatus('md5');
    
    const stats = {
      total: predictionHistory.md5.length,
      correct: predictionHistory.md5.filter(h => h.ket_qua_du_doan === 'Đúng ✅').length,
      wrong: predictionHistory.md5.filter(h => h.ket_qua_du_doan === 'Sai ❌').length,
      pending: predictionHistory.md5.filter(h => !h.ket_qua_du_doan || h.ket_qua_du_doan === '').length
    };
    
    const accuracy = stats.total > 0 ? ((stats.correct / (stats.correct + stats.wrong)) * 100).toFixed(1) : 'N/A';
    
    res.json({
      success: true,
      type: 'Lẩu Cua 79 - Tài Xỉu MD5',
      stats: {
        totalPredictions: stats.total,
        correct: stats.correct,
        wrong: stats.wrong,
        pending: stats.pending,
        accuracy: stats.total > 0 ? `${accuracy}%` : 'Chưa có dữ liệu'
      },
      history: predictionHistory.md5,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    res.json({
      success: true,
      type: 'Lẩu Cua 79 - Tài Xỉu MD5',
      stats: { total: predictionHistory.md5.length, correct: 0, wrong: 0, pending: predictionHistory.md5.length, accuracy: 'N/A' },
      history: predictionHistory.md5,
      lastUpdated: new Date().toISOString()
    });
  }
});

app.get('/lc79-hu/analysis', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data || data.length === 0) {
      return res.status(500).json({ success: false, error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('hu', data);
    const result = calculateAdvancedPrediction(data, 'hu');
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Lỗi server' });
  }
});

app.get('/lc79-md5/analysis', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data || data.length === 0) {
      return res.status(500).json({ success: false, error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('md5', data);
    const result = calculateAdvancedPrediction(data, 'md5');
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Lỗi server' });
  }
});

app.get('/lc79-hu/learning', (req, res) => {
  const stats = learningData.hu;
  const accuracy = stats.totalPredictions > 0 
    ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2)
    : 0;
  
  res.json({
    success: true,
    type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
    stats: {
      totalPredictions: stats.totalPredictions,
      correctPredictions: stats.correctPredictions,
      overallAccuracy: `${accuracy}%`,
      streakAnalysis: stats.streakAnalysis,
      recentAccuracy: stats.recentAccuracy.slice(0, 20)
    },
    mlModels: {
      transformer: stats.patternStats.transformer || { accuracy: 'N/A' },
      ensemble: stats.patternStats.ensemble_voting || { accuracy: 'N/A' },
      reinforcement: stats.patternStats.reinforcement_learning || { accuracy: 'N/A' },
      gan: stats.patternStats.gan_prediction || { accuracy: 'N/A' },
      bayesian: stats.patternStats.bayesian_inference || { accuracy: 'N/A' }
    },
    lastUpdate: stats.lastUpdate
  });
});

app.get('/lc79-md5/learning', (req, res) => {
  const stats = learningData.md5;
  const accuracy = stats.totalPredictions > 0 
    ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2)
    : 0;
  
  res.json({
    success: true,
    type: 'Lẩu Cua 79 - Tài Xỉu MD5',
    stats: {
      totalPredictions: stats.totalPredictions,
      correctPredictions: stats.correctPredictions,
      overallAccuracy: `${accuracy}%`,
      streakAnalysis: stats.streakAnalysis,
      recentAccuracy: stats.recentAccuracy.slice(0, 20)
    },
    mlModels: {
      transformer: stats.patternStats.transformer || { accuracy: 'N/A' },
      ensemble: stats.patternStats.ensemble_voting || { accuracy: 'N/A' },
      reinforcement: stats.patternStats.reinforcement_learning || { accuracy: 'N/A' },
      gan: stats.patternStats.gan_prediction || { accuracy: 'N/A' },
      bayesian: stats.patternStats.bayesian_inference || { accuracy: 'N/A' }
    },
    lastUpdate: stats.lastUpdate
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
      mlModel: { weights: {}, bias: 0, lastTraining: null },
      xgbModel: { trees: [], featureImportance: {} },
      qTable: initializeQTable()
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
      mlModel: { weights: {}, bias: 0, lastTraining: null },
      xgbModel: { trees: [], featureImportance: {} },
      qTable: initializeQTable()
    }
  };
  saveLearningData();
  res.json({ 
    success: true, 
    message: '✅ Learning data has been reset successfully',
    timestamp: new Date().toISOString()
  });
});

// ==================== KHỞI ĐỘNG SERVER ====================

loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log('║     🚀 LẨU CUA 79 - TÀI XỈU AI PREDICTION API v8.0 🚀       ║');
  console.log('║                                                              ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║     📡 Server running on: http://0.0.0.0:${PORT}                  ║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║                                                              ║');
  console.log('║     🤖 AI MODELS NÂNG CẤP:                                  ║');
  console.log('║     • Transformer - Attention Mechanism                     ║');
  console.log('║     • Ensemble Voting - 4 mô hình kết hợp                   ║');
  console.log('║     • Reinforcement Learning - Q-learning                   ║');
  console.log('║     • GAN Prediction - Generative Adversarial Network       ║');
  console.log('║     • Bayesian Inference - Xác suất Bayes                   ║');
  console.log('║                                                              ║');
  console.log('║     📊 FEATURES ĐẶC BIỆT:                                   ║');
  console.log('║     • Hurst Exponent - Phân tích xu hướng dài hạn           ║');
  console.log('║     • Entropy - Đo độ hỗn loạn của chuỗi                    ║');
  console.log('║     • Mean Reversion - Phát hiện điểm đảo chiều             ║');
  console.log('║                                                              ║');
  console.log('║     💾 DỮ LIỆU:                                             ║');
  console.log('║     • tiendat.json - Dữ liệu học tập                        ║');
  console.log('║     • tiendat1.json - Lịch sử dự đoán                       ║');
  console.log('║                                                              ║');
  console.log('║     👤 ID: @tiendataox                                       ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  
  startAutoSaveTask();
});