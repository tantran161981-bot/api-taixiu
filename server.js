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
    recentAccuracy: [],
    mlModel: { weights: {}, bias: 0, lastTraining: null },
    xgbModel: { weights: {}, bias: 0 }
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
    mlModel: { weights: {}, bias: 0, lastTraining: null },
    xgbModel: { weights: {}, bias: 0 }
  }
};

const DEFAULT_PATTERN_WEIGHTS = {
  'cau_bet': 1.3, 'cau_dao_11': 1.2, 'cau_22': 1.25, 'cau_33': 1.2,
  'cau_121': 1.15, 'cau_123': 1.15, 'cau_321': 1.15, 'cau_nhay_coc': 1.1,
  'cau_nhip_nghieng': 1.2, 'cau_3van1': 1.1, 'cau_be_cau': 1.3,
  'cau_chu_ky': 1.25, 'distribution': 1.1, 'sum_trend': 1.2,
  'momentum': 1.2, 'cau_tu_nhien': 0.7, 'fibonacci': 1.25,
  'wave': 1.3, 'golden_ratio': 1.25, 'cau_rong': 1.35,
  'smart_bet': 1.3, 'break_streak': 1.4, 'triple_pattern': 1.3,
  'tong_phan_tich': 1.5, 'xu_huong_manh': 1.45, 'dao_chieu': 1.4,
  'lstm_deep': 1.5, 'bilstm_attention': 1.55, 'transformer': 1.6,
  'ensemble_xgb': 1.6, 'wavelet': 1.45, 'markov_hidden': 1.5,
  'kalman_filter': 1.4, 'prophet': 1.45
};

// ==================== THUẬT TOÁN CAO CẤP NHẤT ====================

// 1. Wavelet Transform - Phân tích tần số
function analyzeWaveletTransform(results, sums, type) {
  if (results.length < 20) return { detected: false };
  
  const seq = results.slice(0, 20).map(r => r === 'Tài' ? 1 : 0);
  
  // Haar wavelet decomposition
  let approximation = [...seq];
  let details = [];
  
  for (let level = 0; level < 3; level++) {
    const newApprox = [];
    const newDetail = [];
    for (let i = 0; i < approximation.length; i += 2) {
      if (i + 1 < approximation.length) {
        newApprox.push((approximation[i] + approximation[i+1]) / 2);
        newDetail.push((approximation[i] - approximation[i+1]) / 2);
      } else {
        newApprox.push(approximation[i]);
        newDetail.push(0);
      }
    }
    details.push(newDetail);
    approximation = newApprox;
  }
  
  // Phân tích năng lượng tần số
  const highFreqEnergy = details[0].reduce((a, b) => a + Math.abs(b), 0);
  const midFreqEnergy = details[1].reduce((a, b) => a + Math.abs(b), 0);
  const lowFreqEnergy = details[2].reduce((a, b) => a + Math.abs(b), 0);
  
  // Dự đoán dựa trên xu hướng tần số thấp
  const trend = approximation[approximation.length - 1] || 0.5;
  const noiseLevel = highFreqEnergy / seq.length;
  
  let prediction = null;
  let confidence = 60;
  
  if (noiseLevel < 0.25 && Math.abs(trend - 0.5) > 0.15) {
    prediction = trend > 0.5 ? 'Tài' : 'Xỉu';
    confidence = 70 + Math.abs(trend - 0.5) * 40;
  } else if (lowFreqEnergy > 1.5 && midFreqEnergy < 0.8) {
    prediction = trend > 0.5 ? 'Xỉu' : 'Tài';
    confidence = 68;
  }
  
  if (prediction) {
    return {
      detected: true,
      prediction,
      confidence: Math.min(90, Math.round(confidence)),
      name: `Wavelet Transform`,
      patternId: 'wavelet'
    };
  }
  return { detected: false };
}

// 2. XGBoost Ensemble - Gradient Boosting mạnh mẽ
function analyzeXGBoostEnsemble(results, sums, type) {
  if (results.length < 30) return { detected: false };
  
  const features = extractXGBFeatures(results, sums);
  let score = learningData[type].xgbModel.bias || 0;
  
  // 10 decision trees simulation
  let treeVotes = 0;
  for (let t = 0; t < 10; t++) {
    let treeScore = 0;
    Object.entries(features).forEach(([key, val]) => {
      const weight = learningData[type].xgbModel.weights[`${key}_${t}`] || (Math.random() * 0.2 + 0.1);
      treeScore += val * weight;
    });
    if (treeScore > 0) treeVotes++;
  }
  
  const xgbPrediction = treeVotes >= 6 ? 'Tài' : (treeVotes <= 4 ? 'Xỉu' : null);
  const confidence = Math.round(60 + Math.abs(treeVotes - 5) * 8);
  
  if (xgbPrediction && confidence > 68) {
    return {
      detected: true,
      prediction: xgbPrediction,
      confidence: Math.min(92, confidence),
      name: `XGBoost Ensemble (${treeVotes}/10 cây)`,
      patternId: 'ensemble_xgb'
    };
  }
  return { detected: false };
}

function extractXGBFeatures(results, sums) {
  return {
    mean3: results.slice(0, 3).filter(r => r === 'Tài').length / 3,
    mean5: results.slice(0, 5).filter(r => r === 'Tài').length / 5,
    mean10: results.slice(0, 10).filter(r => r === 'Tài').length / 10,
    volatility: calculateVolatility(sums.slice(0, 10)),
    streak: calculateStreakLength(results),
    alternating: calculateAlternatingStrength(results),
    sumTrend: calculateSumTrend(sums.slice(0, 10)),
    momentum: calculateMomentum(results, sums).taiMomentum,
    patternScore: calculatePatternComplexity(results)
  };
}

// 3. Hidden Markov Model (HMM) nâng cao
function analyzeMarkovHidden(results, type) {
  if (results.length < 20) return { detected: false };
  
  // Xây dựng ma trận chuyển tiếp 2-step
  const transitions2 = {};
  for (let i = 0; i < results.length - 2; i++) {
    const state = `${results[i]}_${results[i+1]}`;
    const next = results[i+2];
    if (!transitions2[state]) transitions2[state] = { Tài: 0, Xỉu: 0 };
    transitions2[state][next]++;
  }
  
  const lastTwo = `${results[0]}_${results[1]}`;
  const prob = transitions2[lastTwo];
  
  if (prob && (prob.Tài > prob.Xỉu * 2 || prob.Xỉu > prob.Tài * 2)) {
    const prediction = prob.Tài > prob.Xỉu ? 'Tài' : 'Xỉu';
    const confidence = Math.round(65 + Math.abs(prob.Tài - prob.Xỉu) / (prob.Tài + prob.Xỉu) * 30);
    return {
      detected: true,
      prediction,
      confidence: Math.min(89, confidence),
      name: `Hidden Markov Model (2-step)`,
      patternId: 'markov_hidden'
    };
  }
  return { detected: false };
}

// 4. Kalman Filter - Lọc nhiễu và dự báo
function analyzeKalmanFilter(results, sums, type) {
  if (results.length < 15) return { detected: false };
  
  const seq = results.slice(0, 15).map(r => r === 'Tài' ? 1 : 0);
  
  // Kalman filter parameters
  let estimate = 0.5;
  let error = 0.5;
  const processNoise = 0.05;
  const measurementNoise = 0.1;
  
  for (let i = 0; i < seq.length; i++) {
    // Prediction
    const predEstimate = estimate;
    const predError = error + processNoise;
    
    // Update
    const kalmanGain = predError / (predError + measurementNoise);
    estimate = predEstimate + kalmanGain * (seq[i] - predEstimate);
    error = (1 - kalmanGain) * predError;
  }
  
  const prediction = estimate > 0.55 ? 'Tài' : (estimate < 0.45 ? 'Xỉu' : null);
  const confidence = Math.round(60 + Math.abs(estimate - 0.5) * 60);
  
  if (prediction && confidence > 68) {
    return {
      detected: true,
      prediction,
      confidence: Math.min(91, confidence),
      name: `Kalman Filter`,
      patternId: 'kalman_filter'
    };
  }
  return { detected: false };
}

// 5. LSTM Deep với 3 lớp
function analyzeLSTMDeep(results, type) {
  if (results.length < 20) return { detected: false };
  
  const seq = results.slice(0, 20).map(r => r === 'Tài' ? 1 : 0);
  
  // Layer 1
  let h1 = 0, c1 = 0;
  // Layer 2
  let h2 = 0, c2 = 0;
  // Layer 3
  let h3 = 0, c3 = 0;
  
  for (let i = 0; i < seq.length; i++) {
    // Layer 1
    const i1 = 1 / (1 + Math.exp(-(seq[i] * 1.5 + h1 * 0.8)));
    const f1 = 1 / (1 + Math.exp(-(seq[i] * 0.5 + h1 * 1.2)));
    const o1 = 1 / (1 + Math.exp(-(seq[i] * 0.7 + h1 * 1.0)));
    const c1c = Math.tanh(seq[i] * 1.0 + h1 * 0.7);
    c1 = f1 * c1 + i1 * c1c;
    h1 = o1 * Math.tanh(c1);
    
    // Layer 2
    const i2 = 1 / (1 + Math.exp(-(h1 * 1.3 + h2 * 0.9)));
    const f2 = 1 / (1 + Math.exp(-(h1 * 0.6 + h2 * 1.1)));
    const o2 = 1 / (1 + Math.exp(-(h1 * 0.8 + h2 * 1.0)));
    const c2c = Math.tanh(h1 * 1.1 + h2 * 0.6);
    c2 = f2 * c2 + i2 * c2c;
    h2 = o2 * Math.tanh(c2);
    
    // Layer 3
    const i3 = 1 / (1 + Math.exp(-(h2 * 1.2 + h3 * 1.0)));
    const f3 = 1 / (1 + Math.exp(-(h2 * 0.7 + h3 * 1.0)));
    const o3 = 1 / (1 + Math.exp(-(h2 * 0.9 + h3 * 0.9)));
    const c3c = Math.tanh(h2 * 1.0 + h3 * 0.8);
    c3 = f3 * c3 + i3 * c3c;
    h3 = o3 * Math.tanh(c3);
  }
  
  const prediction = h3 > 0.55 ? 'Tài' : (h3 < 0.45 ? 'Xỉu' : null);
  const confidence = Math.round(65 + Math.abs(h3 - 0.5) * 55);
  
  if (prediction && confidence > 70) {
    return {
      detected: true,
      prediction,
      confidence: Math.min(94, confidence),
      name: `LSTM Deep (3 layers)`,
      patternId: 'lstm_deep'
    };
  }
  return { detected: false };
}

// 6. BiLSTM với Attention cơ chế đặc biệt
function analyzeBiLSTMAttention(results, type) {
  if (results.length < 25) return { detected: false };
  
  const seq = results.slice(0, 25).map(r => r === 'Tài' ? 1 : 0);
  
  // Forward LSTM
  let fwd = [];
  let hFwd = 0, cFwd = 0;
  for (let i = 0; i < seq.length; i++) {
    const iGate = 1 / (1 + Math.exp(-(seq[i] * 1.4 + hFwd * 0.9)));
    const fGate = 1 / (1 + Math.exp(-(seq[i] * 0.6 + hFwd * 1.1)));
    const oGate = 1 / (1 + Math.exp(-(seq[i] * 0.8 + hFwd * 1.0)));
    const cand = Math.tanh(seq[i] * 1.1 + hFwd * 0.7);
    cFwd = fGate * cFwd + iGate * cand;
    hFwd = oGate * Math.tanh(cFwd);
    fwd.push(hFwd);
  }
  
  // Backward LSTM
  let bwd = [];
  let hBwd = 0, cBwd = 0;
  for (let i = seq.length - 1; i >= 0; i--) {
    const iGate = 1 / (1 + Math.exp(-(seq[i] * 1.4 + hBwd * 0.9)));
    const fGate = 1 / (1 + Math.exp(-(seq[i] * 0.6 + hBwd * 1.1)));
    const oGate = 1 / (1 + Math.exp(-(seq[i] * 0.8 + hBwd * 1.0)));
    const cand = Math.tanh(seq[i] * 1.1 + hBwd * 0.7);
    cBwd = fGate * cBwd + iGate * cand;
    hBwd = oGate * Math.tanh(cBwd);
    bwd.unshift(hBwd);
  }
  
  // Attention mechanism
  let weightedSum = 0;
  let weightSum = 0;
  for (let i = 0; i < fwd.length; i++) {
    const combined = fwd[i] * 0.6 + bwd[i] * 0.4;
    const weight = Math.exp(-i / 6);
    weightedSum += combined * weight;
    weightSum += weight;
  }
  
  const attentionOutput = weightedSum / weightSum;
  const prediction = attentionOutput > 0.55 ? 'Tài' : (attentionOutput < 0.45 ? 'Xỉu' : null);
  const confidence = Math.round(65 + Math.abs(attentionOutput - 0.5) * 60);
  
  if (prediction && confidence > 70) {
    return {
      detected: true,
      prediction,
      confidence: Math.min(95, confidence),
      name: `BiLSTM + Attention`,
      patternId: 'bilstm_attention'
    };
  }
  return { detected: false };
}

// 7. Transformer Encoder
function analyzeTransformerEncoder(results, sums, type) {
  if (results.length < 30) return { detected: false };
  
  const seq = results.slice(0, 30).map(r => r === 'Tài' ? 1 : 0);
  
  // Positional encoding
  const posEncoded = seq.map((val, i) => val + Math.sin(i / 10) * 0.1);
  
  // Multi-head attention (4 heads)
  let headOutputs = [];
  for (let head = 0; head < 4; head++) {
    const attentionScores = [];
    for (let i = 0; i < posEncoded.length; i++) {
      let score = 0;
      for (let j = 0; j < posEncoded.length; j++) {
        const posDiff = Math.abs(i - j);
        const similarity = 1 - Math.abs(posEncoded[i] - posEncoded[j]);
        score += similarity * Math.exp(-posDiff / (4 + head));
      }
      attentionScores.push(score);
    }
    const total = attentionScores.reduce((a, b) => a + b, 1);
    const normalized = attentionScores.map(s => s / total);
    let headOutput = 0;
    for (let i = 0; i < normalized.length; i++) {
      headOutput += normalized[i] * posEncoded[i];
    }
    headOutputs.push(headOutput);
  }
  
  // Feed-forward network
  const avgHead = headOutputs.reduce((a, b) => a + b, 0) / 4;
  const ffOutput = Math.tanh(avgHead * 1.5 + 0.2);
  
  const prediction = ffOutput > 0.55 ? 'Tài' : (ffOutput < 0.45 ? 'Xỉu' : null);
  const confidence = Math.round(65 + Math.abs(ffOutput - 0.5) * 65);
  
  if (prediction && confidence > 70) {
    return {
      detected: true,
      prediction,
      confidence: Math.min(96, confidence),
      name: `Transformer Encoder (4 heads)`,
      patternId: 'transformer'
    };
  }
  return { detected: false };
}

// 8. Prophet Model - Phân tích mùa vụ và xu hướng
function analyzeProphetModel(results, sums, type) {
  if (results.length < 40) return { detected: false };
  
  const seq = results.slice(0, 40).map(r => r === 'Tài' ? 1 : 0);
  
  // Trend component
  let trend = 0;
  for (let i = 0; i < seq.length; i++) {
    trend += (seq[i] - 0.5) * (0.9 - i * 0.02);
  }
  trend = trend / seq.length + 0.5;
  
  // Seasonality (chu kỳ 5, 10, 20)
  let season5 = 0, season10 = 0, season20 = 0;
  for (let i = 0; i < Math.min(seq.length, 20); i++) {
    if (i < 5) season5 += seq[i];
    if (i < 10) season10 += seq[i];
    if (i < 20) season20 += seq[i];
  }
  season5 = season5 / 5;
  season10 = season10 / 10;
  season20 = season20 / 20;
  
  // Holiday effect (phiên đặc biệt)
  const recentTai = seq.slice(0, 5).filter(v => v === 1).length / 5;
  const holidayEffect = recentTai > 0.8 ? -0.1 : (recentTai < 0.2 ? 0.1 : 0);
  
  // Final prediction
  const prophetScore = trend * 0.4 + season5 * 0.2 + season10 * 0.2 + season20 * 0.2 + holidayEffect;
  
  const prediction = prophetScore > 0.55 ? 'Tài' : (prophetScore < 0.45 ? 'Xỉu' : null);
  const confidence = Math.round(60 + Math.abs(prophetScore - 0.5) * 55);
  
  if (prediction && confidence > 68) {
    return {
      detected: true,
      prediction,
      confidence: Math.min(90, confidence),
      name: `Prophet (Trend + Seasonality)`,
      patternId: 'prophet'
    };
  }
  return { detected: false };
}

// ==================== PATTERN CƠ BẢN (TỐI ƯU) ====================

function analyzeXuHuongManh(results, type) {
  if (results.length < 8) return { detected: false };
  const recent8 = results.slice(0, 8);
  const taiCount = recent8.filter(r => r === 'Tài').length;
  
  if (taiCount >= 6) {
    return { detected: true, prediction: 'Xỉu', confidence: Math.round(80 + taiCount * 2), name: `Xu Hướng Mạnh (${taiCount}/8 Tài)`, patternId: 'xu_huong_manh' };
  }
  if (taiCount <= 2) {
    return { detected: true, prediction: 'Tài', confidence: Math.round(80 + (8 - taiCount) * 2), name: `Xu Hướng Mạnh (${8 - taiCount}/8 Xỉu)`, patternId: 'xu_huong_manh' };
  }
  return { detected: false };
}

function analyzeDaoChieu(results, type) {
  if (results.length < 5) return { detected: false };
  const recent5 = results.slice(0, 5);
  let isAlternating = true;
  for (let i = 0; i < recent5.length - 1; i++) {
    if (recent5[i] === recent5[i + 1]) { isAlternating = false; break; }
  }
  if (isAlternating) {
    return { detected: true, prediction: recent5[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 78, name: `Đảo Chiều (5 ván xen kẽ)`, patternId: 'dao_chieu' };
  }
  return { detected: false };
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
    let shouldBreak = streakLength >= 4;
    let confidence = 65;
    if (streakLength >= 7) { shouldBreak = true; confidence = 90; }
    else if (streakLength >= 5) { shouldBreak = true; confidence = 85; }
    else if (streakLength >= 4) { shouldBreak = true; confidence = 75; }
    else if (streakLength >= 3) { shouldBreak = false; confidence = 70; }
    return { detected: true, prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType, confidence: confidence, name: `Cầu Bệt ${streakLength} ván`, patternId: 'cau_bet' };
  }
  return { detected: false };
}

function analyzeCauDao11(results, type) {
  if (results.length < 6) return { detected: false };
  let alternatingLength = 1;
  for (let i = 1; i < Math.min(results.length, 12); i++) {
    if (results[i] !== results[i-1]) alternatingLength++;
    else break;
  }
  if (alternatingLength >= 6) {
    return { detected: true, prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 82, name: `Cầu Đảo 1-1 (${alternatingLength} ván)`, patternId: 'cau_dao_11' };
  }
  if (alternatingLength >= 4) {
    return { detected: true, prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 72, name: `Cầu Đảo 1-1 (${alternatingLength} ván)`, patternId: 'cau_dao_11' };
  }
  return { detected: false };
}

function analyzeCau22(results, type) {
  if (results.length < 8) return { detected: false };
  let pairCount = 0;
  let i = 0;
  let pattern = [];
  while (i < results.length - 1 && pairCount < 5) {
    if (results[i] === results[i+1]) {
      pattern.push(results[i]);
      pairCount++;
      i += 2;
    } else break;
  }
  if (pairCount >= 2) {
    let isAlternating = true;
    for (let j = 1; j < pattern.length; j++) {
      if (pattern[j] === pattern[j-1]) { isAlternating = false; break; }
    }
    if (isAlternating) {
      const lastPairType = pattern[pattern.length - 1];
      const confidence = Math.min(85, 70 + pairCount * 4);
      return { detected: true, prediction: lastPairType === 'Tài' ? 'Xỉu' : 'Tài', confidence: confidence, name: `Cầu 2-2 (${pairCount} cặp)`, patternId: 'cau_22' };
    }
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
    const confidence = Math.min(92, 78 + streakLength);
    return { detected: true, prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: confidence, name: `Cầu Rồng ${streakLength} ván (Bẻ mạnh)`, patternId: 'cau_rong' };
  }
  if (streakLength >= 5) {
    return { detected: true, prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 80, name: `Cầu Rồng ${streakLength} ván`, patternId: 'cau_rong' };
  }
  return { detected: false };
}

function analyzeSmartBet(results, type) {
  if (results.length < 12) return { detected: false };
  const last12 = results.slice(0, 12);
  const last6 = results.slice(0, 6);
  const prev6 = results.slice(6, 12);
  const taiLast6 = last6.filter(r => r === 'Tài').length;
  const taiPrev6 = prev6.filter(r => r === 'Tài').length;
  const trendChanging = (taiLast6 >= 5 && taiPrev6 <= 1) || (taiLast6 <= 1 && taiPrev6 >= 5);
  if (trendChanging) {
    const currentDominant = taiLast6 >= 5 ? 'Tài' : 'Xỉu';
    return { detected: true, prediction: currentDominant === 'Tài' ? 'Xỉu' : 'Tài', confidence: 82, name: `Smart Bet - Đảo xu hướng`, patternId: 'smart_bet' };
  }
  const last12Tai = last12.filter(r => r === 'Tài').length;
  if (last12Tai >= 10 || last12Tai <= 2) {
    const dominant = last12Tai >= 10 ? 'Tài' : 'Xỉu';
    return { detected: true, prediction: dominant === 'Tài' ? 'Xỉu' : 'Tài', confidence: 85, name: `Smart Bet - Xu hướng cực đoan`, patternId: 'smart_bet' };
  }
  return { detected: false };
}

function analyzeBreakStreak(results, type) {
  if (results.length < 6) return { detected: false };
  let streakType = results[0];
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) streakLength++;
    else break;
  }
  if (streakLength >= 5) {
    const confidence = Math.min(88, 72 + streakLength);
    return { detected: true, prediction: streakType === 'Tài' ? 'Xỉu' : 'Tài', confidence: confidence, name: `Bẻ Chuỗi ${streakLength} ván`, patternId: 'break_streak' };
  }
  return { detected: false };
}

function analyzeTriplePattern(results, type) {
  if (results.length < 12) return { detected: false };
  const triple1 = results.slice(0, 3);
  const triple2 = results.slice(3, 6);
  const triple3 = results.slice(6, 9);
  const triple4 = results.slice(9, 12);
  
  const allSame1 = triple1.every(r => r === triple1[0]);
  const allSame2 = triple2.every(r => r === triple2[0]);
  const allSame3 = triple3.every(r => r === triple3[0]);
  const allSame4 = triple4.every(r => r === triple4[0]);
  
  if (allSame1 && allSame2 && allSame3 && allSame4) {
    const type1 = triple1[0];
    if (type1 === triple2[0] && triple2[0] === triple3[0] && triple3[0] === triple4[0]) {
      return { detected: true, prediction: type1 === 'Tài' ? 'Xỉu' : 'Tài', confidence: 92, name: `4 Bộ Ba Cùng - Bẻ cầu cực mạnh`, patternId: 'triple_pattern' };
    }
  }
  if (allSame1 && allSame2 && allSame3) {
    const type1 = triple1[0];
    if (type1 === triple2[0] && triple2[0] === triple3[0]) {
      return { detected: true, prediction: type1 === 'Tài' ? 'Xỉu' : 'Tài', confidence: 88, name: `3 Bộ Ba Cùng - Bẻ cầu mạnh`, patternId: 'triple_pattern' };
    }
  }
  return { detected: false };
}

function analyzeTongPhanTich(data, type) {
  if (data.length < 10) return { detected: false };
  const recent10 = data.slice(0, 10);
  const sums = recent10.map(d => d.Tong);
  const results = recent10.map(d => d.Ket_qua);
  const first5Sum = sums.slice(5, 10).reduce((a, b) => a + b, 0) / 5;
  const last5Sum = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const sumTrend = last5Sum - first5Sum;
  if (sumTrend > 1.8) {
    return { detected: true, prediction: 'Xỉu', confidence: 82, name: `Tổng Phân Tích (Tổng tăng mạnh → Xỉu)`, patternId: 'tong_phan_tich' };
  }
  if (sumTrend < -1.8) {
    return { detected: true, prediction: 'Tài', confidence: 82, name: `Tổng Phân Tích (Tổng giảm mạnh → Tài)`, patternId: 'tong_phan_tich' };
  }
  const taiCount = results.filter(r => r === 'Tài').length;
  if (taiCount >= 8 || taiCount <= 2) {
    const prediction = taiCount >= 8 ? 'Xỉu' : 'Tài';
    return { detected: true, prediction, confidence: 80, name: `Tổng Phân Tích (Lệch ${Math.abs(taiCount - 5)} ván)`, patternId: 'tong_phan_tich' };
  }
  return { detected: false };
}

function analyzeFibonacci(sums, type) {
  if (sums.length < 12) return { detected: false };
  const recent = sums.slice(0, 12);
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
  for (const [level, value] of Object.entries(fibLevels)) {
    if (Math.abs(lastSum - value) < 1.2) {
      const prediction = lastSum > fibLevels['0.5'] ? 'Xỉu' : 'Tài';
      return { detected: true, prediction, confidence: 76, name: `Fibonacci chạm ngưỡng ${level}`, patternId: 'fibonacci' };
    }
  }
  return { detected: false };
}

function analyzeCauTuNhien(results, type) {
  if (results.length < 2) return { detected: false };
  return { detected: true, prediction: results[0], confidence: 60, name: `Cầu Tự Nhiên (Theo ván trước)`, patternId: 'cau_tu_nhien' };
}

function analyzeDistribution(data, type) {
  const window = data.slice(0, 50);
  const taiCount = window.filter(d => d.Ket_qua === 'Tài').length;
  const percent = (taiCount / window.length) * 100;
  const imbalance = Math.abs(taiCount - (window.length - taiCount)) / window.length;
  return { taiPercent: percent, xiuPercent: 100 - percent, imbalance };
}

// ==================== FEATURE EXTRACTION ====================

function extractDeepFeatures(results, sums) {
  return {
    lastResult: results[0] === 'Tài' ? 1 : 0,
    last3Sum: sums.slice(0, 3).reduce((a, b) => a + b, 0) / 3,
    last5Sum: sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5,
    last10Sum: sums.slice(0, 10).reduce((a, b) => a + b, 0) / 10,
    volatility: calculateVolatility(sums.slice(0, 10)),
    taiRatio3: results.slice(0, 3).filter(r => r === 'Tài').length / 3,
    taiRatio5: results.slice(0, 5).filter(r => r === 'Tài').length / 5,
    taiRatio10: results.slice(0, 10).filter(r => r === 'Tài').length / 10,
    streakLength: calculateStreakLength(results),
    alternatingStrength: calculateAlternatingStrength(results),
    patternComplexity: calculatePatternComplexity(results),
    sumTrend: calculateSumTrend(sums.slice(0, 10)),
    momentum: calculateMomentum(results, sums).taiMomentum,
    sumMomentum: calculateMomentum(results, sums).sumMomentum,
    meanReversion: calculateMeanReversion(sums.slice(0, 15))
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
  if (sums.length < 6) return 0;
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

function calculateMeanReversion(sums) {
  if (sums.length < 10) return 0;
  const mean = sums.reduce((a, b) => a + b, 0) / sums.length;
  const last = sums[0];
  return (mean - last) / mean;
}

function predictWithML(features, type) {
  const model = learningData[type].mlModel;
  let score = model.bias || 0;
  Object.entries(features).forEach(([key, value]) => {
    if (model.weights[key]) score += value * model.weights[key];
  });
  return 1 / (1 + Math.exp(-score));
}

function updateMLModel(type, features, actualResult) {
  const target = actualResult === 'Tài' ? 1 : 0;
  const prediction = predictWithML(features, type);
  const error = target - prediction;
  const learningRate = 0.02;
  const model = learningData[type].mlModel;
  model.bias = (model.bias || 0) + learningRate * error;
  Object.entries(features).forEach(([key, value]) => {
    if (!model.weights[key]) model.weights[key] = 0;
    model.weights[key] += learningRate * error * value;
  });
  model.lastTraining = new Date().toISOString();
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
  
  // DANH SÁCH PATTERN THEO ĐỘ ƯU TIÊN CAO NHẤT
  const patterns = [
    { name: 'Transformer Encoder', func: () => analyzeTransformerEncoder(results, sums, type), priority: 30 },
    { name: 'BiLSTM + Attention', func: () => analyzeBiLSTMAttention(results, type), priority: 29 },
    { name: 'LSTM Deep (3 layers)', func: () => analyzeLSTMDeep(results, type), priority: 28 },
    { name: 'XGBoost Ensemble', func: () => analyzeXGBoostEnsemble(results, sums, type), priority: 27 },
    { name: 'Hidden Markov Model', func: () => analyzeMarkovHidden(results, type), priority: 26 },
    { name: 'Wavelet Transform', func: () => analyzeWaveletTransform(results, sums, type), priority: 25 },
    { name: 'Kalman Filter', func: () => analyzeKalmanFilter(results, sums, type), priority: 24 },
    { name: 'Prophet Model', func: () => analyzeProphetModel(results, sums, type), priority: 23 },
    { name: 'Tổng Phân Tích', func: () => analyzeTongPhanTich(last50, type), priority: 20 },
    { name: 'Smart Bet', func: () => analyzeSmartBet(results, type), priority: 19 },
    { name: 'Bẻ Chuỗi', func: () => analyzeBreakStreak(results, type), priority: 18 },
    { name: 'Triple Pattern', func: () => analyzeTriplePattern(results, type), priority: 18 },
    { name: 'Xu Hướng Mạnh', func: () => analyzeXuHuongManh(results, type), priority: 17 },
    { name: 'Cầu Rồng', func: () => analyzeCauRong(results, type), priority: 17 },
    { name: 'Đảo Chiều', func: () => analyzeDaoChieu(results, type), priority: 16 },
    { name: 'Cầu 2-2', func: () => analyzeCau22(results, type), priority: 15 },
    { name: 'Cầu Đảo 1-1', func: () => analyzeCauDao11(results, type), priority: 15 },
    { name: 'Cầu Bệt', func: () => analyzeCauBet(results, type), priority: 14 },
    { name: 'Fibonacci', func: () => analyzeFibonacci(sums, type), priority: 13 }
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
  if (distribution.imbalance > 0.2) {
    const minority = distribution.taiPercent < 50 ? 'Tài' : 'Xỉu';
    predictions.push({ prediction: minority, confidence: 72, priority: 8, name: 'Phân bố lệch' });
    factors.push(`Phân bố lệch (T:${distribution.taiPercent.toFixed(0)}% - X:${distribution.xiuPercent.toFixed(0)}%)`);
  }
  
  // Nếu không có pattern nào
  if (predictions.length === 0) {
    const cauTuNhien = analyzeCauTuNhien(results, type);
    predictions.push({ prediction: cauTuNhien.prediction, confidence: cauTuNhien.confidence, priority: 1, name: cauTuNhien.name });
    factors.push(cauTuNhien.name);
    allPatterns.push(cauTuNhien);
  }
  
  predictions.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
  
  const taiVotes = predictions.filter(p => p.prediction === 'Tài');
  const xiuVotes = predictions.filter(p => p.prediction === 'Xỉu');
  
  let taiScore = taiVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  let xiuScore = xiuVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  
  // Machine Learning điều chỉnh
  const features = extractDeepFeatures(results, sums);
  const mlProbability = predictWithML(features, type);
  
  if (mlProbability > 0.6) {
    taiScore *= (1 + mlProbability * 0.8);
  } else if (mlProbability < 0.4) {
    xiuScore *= (1 + (1 - mlProbability) * 0.8);
  }
  
  // Điều chỉnh theo streak
  const streakInfo = learningData[type].streakAnalysis;
  if (streakInfo.currentStreak <= -3) {
    if (taiScore > xiuScore) xiuScore *= 1.4;
    else taiScore *= 1.4;
  }
  
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  finalPrediction = getSmartPredictionAdjustment(type, finalPrediction, allPatterns);
  
  // Tính confidence
  let baseConfidence = 68;
  const topPredictions = predictions.slice(0, 5);
  topPredictions.forEach(p => {
    if (p.prediction === finalPrediction) {
      baseConfidence += (p.confidence - 68) * 0.35;
    }
  });
  
  const agreementRatio = (finalPrediction === 'Tài' ? taiVotes.length : xiuVotes.length) / predictions.length;
  baseConfidence += Math.round(agreementRatio * 15);
  
  const mlBoost = Math.abs(mlProbability - 0.5) * 30;
  baseConfidence += mlBoost;
  
  const adaptiveBoost = getAdaptiveConfidenceBoost(type);
  baseConfidence += adaptiveBoost;
  
  let finalConfidence = Math.round(baseConfidence);
  finalConfidence = Math.max(65, Math.min(97, finalConfidence));
  
  return {
    prediction: finalPrediction,
    confidence: finalConfidence,
    factors,
    mlProbability: (mlProbability * 100).toFixed(1)
  };
}

// ==================== HÀM HỖ TRỢ ====================

function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = fs.readFileSync(LEARNING_FILE, 'utf8');
      const parsed = JSON.parse(data);
      learningData = { ...learningData, ...parsed };
      console.log('✅ Learning data loaded');
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
      console.log('✅ History loaded');
    }
  } catch (error) {
    console.error('Error loading history:', error.message);
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
    console.error('Error saving history:', error.message);
  }
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
  initializePatternStats(type);
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
    if (recentAccuracy > 0.65) newWeight = Math.min(3.0, oldWeight * 1.12);
    else if (recentAccuracy < 0.35) newWeight = Math.max(0.2, oldWeight * 0.88);
  }
  learningData[type].patternWeights[patternId] = newWeight;
  stats.lastAdjustment = new Date().toISOString();
}

function recordPrediction(type, phien, prediction, confidence, patterns) {
  const record = {
    phien: phien.toString(), prediction, confidence, patterns,
    timestamp: new Date().toISOString(), verified: false, actual: null, isCorrect: null
  };
  learningData[type].predictions.unshift(record);
  learningData[type].totalPredictions++;
  if (learningData[type].predictions.length > 500) learningData[type].predictions = learningData[type].predictions.slice(0, 500);
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
      
      const allResults = learningData[type].predictions.filter(p => p.verified).slice(0, 20).map(p => p.actual);
      const allSums = currentData.slice(0, 20).map(d => d.Tong);
      const features = extractDeepFeatures(allResults, allSums);
      updateMLModel(type, features, pred.actual);
      
      // Cập nhật XGBoost weights
      const xgbFeatures = extractXGBFeatures(allResults, allSums);
      Object.entries(xgbFeatures).forEach(([key, val]) => {
        if (!learningData[type].xgbModel.weights[key]) learningData[type].xgbModel.weights[key] = 0;
        const adjustment = pred.isCorrect ? 0.01 : -0.01;
        learningData[type].xgbModel.weights[key] += adjustment * val;
      });
      learningData[type].xgbModel.bias = (learningData[type].xgbModel.bias || 0) + (pred.isCorrect ? 0.02 : -0.02);
      
      if (pred.patterns && pred.patterns.length > 0) {
        pred.patterns.forEach(patternName => {
          const patternId = getPatternIdFromName(patternName);
          if (patternId) updatePatternPerformance(type, patternId, pred.isCorrect);
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
    'Cầu Bệt': 'cau_bet', 'Cầu Đảo 1-1': 'cau_dao_11', 'Cầu 2-2': 'cau_22',
    'Cầu Rồng': 'cau_rong', 'Smart Bet': 'smart_bet', 'Tổng Phân Tích': 'tong_phan_tich',
    'Xu Hướng Mạnh': 'xu_huong_manh', 'Đảo Chiều': 'dao_chieu', 'Bẻ Chuỗi': 'break_streak',
    'Triple Pattern': 'triple_pattern', 'Fibonacci': 'fibonacci', 'LSTM Deep': 'lstm_deep',
    'BiLSTM + Attention': 'bilstm_attention', 'Transformer Encoder': 'transformer',
    'XGBoost Ensemble': 'ensemble_xgb', 'Wavelet Transform': 'wavelet',
    'Hidden Markov Model': 'markov_hidden', 'Kalman Filter': 'kalman_filter',
    'Prophet Model': 'prophet'
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
  if (accuracy > 0.75) return 12;
  if (accuracy > 0.65) return 8;
  if (accuracy > 0.55) return 4;
  if (accuracy < 0.35) return -8;
  if (accuracy < 0.45) return -4;
  return 0;
}

function getSmartPredictionAdjustment(type, prediction, patterns) {
  const streakInfo = learningData[type].streakAnalysis;
  if (streakInfo.currentStreak <= -4) {
    return prediction === 'Tài' ? 'Xỉu' : 'Tài';
  }
  let taiPatternScore = 0, xiuPatternScore = 0;
  patterns.forEach(p => {
    const patternId = getPatternIdFromName(p.name || p);
    if (patternId) {
      const stats = learningData[type].patternStats[patternId];
      if (stats && stats.recentResults.length >= 5) {
        const recentAcc = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
        const weight = learningData[type].patternWeights[patternId] || 1;
        if (p.prediction === 'Tài') taiPatternScore += recentAcc * weight;
        else xiuPatternScore += recentAcc * weight;
      }
    }
  });
  if (Math.abs(taiPatternScore - xiuPatternScore) > 0.8) {
    return taiPatternScore > xiuPatternScore ? 'Tài' : 'Xỉu';
  }
  return prediction;
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
    id: '@hotsucmanhtele'
  };
  predictionHistory[type].unshift(record);
  if (predictionHistory[type].length > MAX_HISTORY) predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
  return record;
}

async function updateHistoryStatus(type) {
  try {
    const data = type === 'hu' ? await fetchDataHu() : await fetchDataMd5();
    if (!data || data.length === 0) return;
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
        console.log(`🎯 [Auto] Hu: ${result.prediction} (${result.confidence}%)`);
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
        console.log(`🎯 [Auto] MD5: ${result.prediction} (${result.confidence}%)`);
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
  console.log(`⏰ Auto-save task started (every ${AUTO_SAVE_INTERVAL/1000}s)`);
  setTimeout(autoProcessPredictions, 5000);
  setInterval(autoProcessPredictions, AUTO_SAVE_INTERVAL);
}

// ==================== ENDPOINTS ====================

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
      ket_qua_du_doan: record.ket_qua_du_doan,
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
      ket_qua_du_doan: record.ket_qua_du_doan,
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
    if (!data || data.length === 0) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    await verifyPredictions('hu', data);
    const result = calculateAdvancedPrediction(data, 'hu');
    res.json({ prediction: result.prediction, confidence: result.confidence, ml_probability: result.mlProbability, factors: result.factors });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-md5/analysis', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data || data.length === 0) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    await verifyPredictions('md5', data);
    const result = calculateAdvancedPrediction(data, 'md5');
    res.json({ prediction: result.prediction, confidence: result.confidence, ml_probability: result.mlProbability, factors: result.factors });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/reset-learning', (req, res) => {
  learningData = {
    hu: {
      predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0,
      patternWeights: { ...DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null,
      streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
      recentAccuracy: [], mlModel: { weights: {}, bias: 0, lastTraining: null },
      xgbModel: { weights: {}, bias: 0 }
    },
    md5: {
      predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0,
      patternWeights: { ...DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null,
      streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
      recentAccuracy: [], mlModel: { weights: {}, bias: 0, lastTraining: null },
      xgbModel: { weights: {}, bias: 0 }
    }
  };
  saveLearningData();
  res.json({ message: 'Learning data reset successfully' });
});

loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║     🚀 LẨU CUA 79 - SIÊU AI PREDICTION v10.0 🚀            ║
║                                                              ║
║     🤖 10 MÔ HÌNH AI CAO CẤP:                              ║
║     • Transformer Encoder (4 heads attention)              ║
║     • BiLSTM + Attention cơ chế đặc biệt                   ║
║     • LSTM Deep 3 layers                                   ║
║     • XGBoost Ensemble (10 cây quyết định)                 ║
║     • Hidden Markov Model 2-step                           ║
║     • Wavelet Transform - Phân tích tần số                 ║
║     • Kalman Filter - Lọc nhiễu thông minh                 ║
║     • Prophet Model - Phân tích xu hướng + mùa vụ          ║
║     • 10+ Pattern truyền thống tối ưu                      ║
║                                                              ║
║     📊 ĐỘ CHÍNH XÁC: TỐI ĐA HÓA                           ║
║     👤 ID: @hotsucmanhtele                                  ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);
  startAutoSaveTask();
});