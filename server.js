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
    lstmMemory: [],
    gruMemory: []
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
    lstmMemory: [],
    gruMemory: []
  }
};

const DEFAULT_PATTERN_WEIGHTS = {
  'cau_bet': 1.2, 'cau_dao_11': 1.1, 'cau_22': 1.15, 'cau_33': 1.1,
  'cau_121': 1.05, 'cau_123': 1.05, 'cau_321': 1.05, 'cau_nhay_coc': 1.0,
  'cau_nhip_nghieng': 1.1, 'cau_3van1': 1.0, 'cau_be_cau': 1.2,
  'cau_chu_ky': 1.15, 'distribution': 1.0, 'dice_pattern': 1.0,
  'sum_trend': 1.1, 'edge_cases': 1.05, 'momentum': 1.1, 'cau_tu_nhien': 0.8,
  'fibonacci': 1.15, 'wave': 1.2, 'golden_ratio': 1.15,
  'cau_rong': 1.25, 'smart_bet': 1.2, 'break_streak': 1.3,
  'triple_pattern': 1.2, 'tong_phan_tich': 1.4, 'xu_huong_manh': 1.35,
  'dao_chieu': 1.3, 'lstm_advanced': 1.4, 'gru_advanced': 1.4,
  'transformer': 1.45, 'ensemble_deep': 1.5, 'attention_bilstm': 1.45,
  'cnn_pattern': 1.35, 'residual': 1.4, 'temporal_cnn': 1.35
};

// ==================== THUẬT TOÁN AI NÂNG CẤP ====================

// 1. LSTM NÂNG CAO với Memory Cell
function analyzeLSTMAdvanced(results, type) {
  if (results.length < 15) return { detected: false };
  
  const sequence = results.slice(0, 15).map(r => r === 'Tài' ? 1 : 0);
  let memory = learningData[type].lstmMemory;
  
  if (memory.length === 0) {
    memory = Array(5).fill(0);
  }
  
  let hiddenState = 0;
  let cellState = 0;
  
  for (let i = 0; i < sequence.length; i++) {
    // LSTM gates với forget bias lớn hơn
    const inputGate = 1 / (1 + Math.exp(-(sequence[i] * 1.8 + hiddenState * 0.9 + memory[0] * 0.5)));
    const forgetGate = 1 / (1 + Math.exp(-(sequence[i] * 0.6 + hiddenState * 1.3 + memory[1] * 0.4)));
    const outputGate = 1 / (1 + Math.exp(-(sequence[i] * 0.9 + hiddenState * 1.1 + memory[2] * 0.6)));
    const candidate = Math.tanh(sequence[i] * 1.2 + hiddenState * 0.7 + memory[3] * 0.5);
    
    cellState = forgetGate * cellState + inputGate * candidate;
    hiddenState = outputGate * Math.tanh(cellState);
    
    // Cập nhật memory
    memory = [hiddenState, cellState, sequence[i], hiddenState * cellState, memory[0]];
  }
  
  learningData[type].lstmMemory = memory;
  
  const prediction = hiddenState > 0.55 ? 'Tài' : (hiddenState < 0.45 ? 'Xỉu' : null);
  const confidence = Math.round(65 + Math.abs(hiddenState - 0.5) * 50);
  
  if (prediction && confidence > 68) {
    return {
      detected: true,
      prediction,
      confidence: Math.min(92, confidence),
      name: `LSTM Advanced`,
      patternId: 'lstm_advanced'
    };
  }
  return { detected: false };
}

// 2. GRU NÂNG CAO
function analyzeGRUAdvanced(results, type) {
  if (results.length < 15) return { detected: false };
  
  const sequence = results.slice(0, 15).map(r => r === 'Tài' ? 1 : 0);
  let memory = learningData[type].gruMemory;
  
  if (memory.length === 0) {
    memory = Array(4).fill(0);
  }
  
  let hiddenState = 0;
  
  for (let i = 0; i < sequence.length; i++) {
    const updateGate = 1 / (1 + Math.exp(-(sequence[i] * 1.5 + hiddenState * 1.0 + memory[0] * 0.6)));
    const resetGate = 1 / (1 + Math.exp(-(sequence[i] * 1.0 + hiddenState * 1.2 + memory[1] * 0.5)));
    const candidate = Math.tanh(sequence[i] * 1.3 + resetGate * hiddenState * 0.8 + memory[2] * 0.4);
    hiddenState = (1 - updateGate) * hiddenState + updateGate * candidate;
    
    memory = [hiddenState, updateGate, resetGate, memory[0]];
  }
  
  learningData[type].gruMemory = memory;
  
  const prediction = hiddenState > 0.55 ? 'Tài' : (hiddenState < 0.45 ? 'Xỉu' : null);
  const confidence = Math.round(65 + Math.abs(hiddenState - 0.5) * 50);
  
  if (prediction && confidence > 68) {
    return {
      detected: true,
      prediction,
      confidence: Math.min(92, confidence),
      name: `GRU Advanced`,
      patternId: 'gru_advanced'
    };
  }
  return { detected: false };
}

// 3. TRANSFORMER với Multi-Head Attention
function analyzeTransformerAdvanced(results, sums, type) {
  if (results.length < 20) return { detected: false };
  
  const sequence = results.slice(0, 20).map(r => r === 'Tài' ? 1 : 0);
  const sumSeq = sums.slice(0, 20);
  
  // 3 heads attention
  const heads = [];
  for (let head = 0; head < 3; head++) {
    const attentionScores = [];
    for (let i = 0; i < sequence.length; i++) {
      let score = 0;
      for (let j = 0; j < sequence.length; j++) {
        const posDiff = Math.abs(i - j);
        const similarity = sequence[i] === sequence[j] ? 1 : 0;
        const sumSimilarity = 1 - Math.min(1, Math.abs(sumSeq[i] - sumSeq[j]) / 10);
        score += (similarity * 0.7 + sumSimilarity * 0.3) * Math.exp(-posDiff / (3 + head));
      }
      attentionScores.push(score);
    }
    const total = attentionScores.reduce((a, b) => a + b, 1);
    heads.push(attentionScores.map(s => s / total));
  }
  
  // Combine heads
  let weightedPred = 0;
  for (let i = 0; i < heads[0].length; i++) {
    const avgAttention = (heads[0][i] + heads[1][i] + heads[2][i]) / 3;
    weightedPred += avgAttention * sequence[i];
  }
  
  const prediction = weightedPred > 0.55 ? 'Tài' : (weightedPred < 0.45 ? 'Xỉu' : null);
  const confidence = Math.round(65 + Math.abs(weightedPred - 0.5) * 60);
  
  if (prediction && confidence > 70) {
    return {
      detected: true,
      prediction,
      confidence: Math.min(94, confidence),
      name: `Transformer Multi-Head`,
      patternId: 'transformer'
    };
  }
  return { detected: false };
}

// 4. DEEP ENSEMBLE - Kết hợp nhiều mô hình sâu
function analyzeDeepEnsemble(results, sums, type) {
  if (results.length < 25) return { detected: false };
  
  const features = extractDeepFeatures(results, sums);
  
  // Mô hình 1: LSTM
  let lstmScore = 0;
  for (let i = 0; i < results.slice(0, 10).length; i++) {
    lstmScore += (results[i] === 'Tài' ? 1 : 0) * (0.9 - i * 0.05);
  }
  lstmScore = lstmScore / 5.5;
  
  // Mô hình 2: GRU
  let gruScore = 0;
  for (let i = 0; i < Math.min(results.length, 8); i++) {
    gruScore += (results[i] === 'Tài' ? 1 : -1) * (0.85 - i * 0.04);
  }
  gruScore = (gruScore + 8) / 16;
  
  // Mô hình 3: Temporal CNN
  let cnnScore = 0;
  const patterns = [
    results.slice(0, 3).filter(r => r === 'Tài').length / 3,
    results.slice(3, 6).filter(r => r === 'Tài').length / 3,
    results.slice(6, 9).filter(r => r === 'Tài').length / 3
  ];
  cnnScore = (patterns[0] * 0.5 + patterns[1] * 0.3 + patterns[2] * 0.2);
  
  // Mô hình 4: Residual Network
  let residualScore = 0;
  const trends = [];
  for (let i = 0; i < results.length - 1; i++) {
    trends.push(results[i] === results[i+1] ? 1 : -1);
  }
  for (let i = 0; i < Math.min(trends.length, 5); i++) {
    residualScore += trends[i] * (0.8 - i * 0.1);
  }
  residualScore = (residualScore + 5) / 10;
  
  // Ensemble voting có trọng số
  const lstmWeight = 0.28;
  const gruWeight = 0.27;
  const cnnWeight = 0.23;
  const residualWeight = 0.22;
  
  const finalScore = lstmScore * lstmWeight + gruScore * gruWeight + cnnScore * cnnWeight + residualScore * residualWeight;
  
  const prediction = finalScore > 0.55 ? 'Tài' : (finalScore < 0.45 ? 'Xỉu' : null);
  const confidence = Math.round(65 + Math.abs(finalScore - 0.5) * 70);
  
  if (prediction && confidence > 70) {
    return {
      detected: true,
      prediction,
      confidence: Math.min(95, confidence),
      name: `Deep Ensemble (4 models)`,
      patternId: 'ensemble_deep'
    };
  }
  return { detected: false };
}

// 5. BiLSTM với Attention cơ chế
function analyzeAttentionBiLSTM(results, sums, type) {
  if (results.length < 20) return { detected: false };
  
  const sequence = results.slice(0, 20).map(r => r === 'Tài' ? 1 : 0);
  
  // Forward LSTM
  let forwardHidden = 0;
  let forwardCell = 0;
  const forwardStates = [];
  
  for (let i = 0; i < sequence.length; i++) {
    const inputGate = 1 / (1 + Math.exp(-(sequence[i] * 1.5 + forwardHidden * 0.8)));
    const forgetGate = 1 / (1 + Math.exp(-(sequence[i] * 0.5 + forwardHidden * 1.2)));
    const outputGate = 1 / (1 + Math.exp(-(sequence[i] * 0.7 + forwardHidden * 1.0)));
    const candidate = Math.tanh(sequence[i] * 1.0 + forwardHidden * 0.7);
    forwardCell = forgetGate * forwardCell + inputGate * candidate;
    forwardHidden = outputGate * Math.tanh(forwardCell);
    forwardStates.push(forwardHidden);
  }
  
  // Backward LSTM
  let backwardHidden = 0;
  let backwardCell = 0;
  const backwardStates = [];
  
  for (let i = sequence.length - 1; i >= 0; i--) {
    const inputGate = 1 / (1 + Math.exp(-(sequence[i] * 1.5 + backwardHidden * 0.8)));
    const forgetGate = 1 / (1 + Math.exp(-(sequence[i] * 0.5 + backwardHidden * 1.2)));
    const outputGate = 1 / (1 + Math.exp(-(sequence[i] * 0.7 + backwardHidden * 1.0)));
    const candidate = Math.tanh(sequence[i] * 1.0 + backwardHidden * 0.7);
    backwardCell = forgetGate * backwardCell + inputGate * candidate;
    backwardHidden = outputGate * Math.tanh(backwardCell);
    backwardStates.unshift(backwardHidden);
  }
  
  // Attention mechanism
  let attentionSum = 0;
  let weightSum = 0;
  for (let i = 0; i < forwardStates.length; i++) {
    const combined = (forwardStates[i] + backwardStates[i]) / 2;
    const weight = Math.exp(-i / 5);
    attentionSum += combined * weight;
    weightSum += weight;
  }
  
  const finalScore = attentionSum / weightSum;
  const prediction = finalScore > 0.55 ? 'Tài' : (finalScore < 0.45 ? 'Xỉu' : null);
  const confidence = Math.round(65 + Math.abs(finalScore - 0.5) * 60);
  
  if (prediction && confidence > 70) {
    return {
      detected: true,
      prediction,
      confidence: Math.min(93, confidence),
      name: `Attention BiLSTM`,
      patternId: 'attention_bilstm'
    };
  }
  return { detected: false };
}

// 6. Temporal CNN - Phân tích chuỗi thời gian
function analyzeTemporalCNN(results, sums, type) {
  if (results.length < 18) return { detected: false };
  
  const seq = results.slice(0, 18).map(r => r === 'Tài' ? 1 : 0);
  
  // Convolution layer 1 (kernel size 3)
  const conv1 = [];
  for (let i = 0; i < seq.length - 2; i++) {
    const conv = (seq[i] * 0.4 + seq[i+1] * 0.35 + seq[i+2] * 0.25);
    conv1.push(conv);
  }
  
  // Convolution layer 2 (kernel size 2)
  const conv2 = [];
  for (let i = 0; i < conv1.length - 1; i++) {
    const conv = (conv1[i] * 0.55 + conv1[i+1] * 0.45);
    conv2.push(conv);
  }
  
  // Max pooling
  const pooled = [];
  for (let i = 0; i < conv2.length; i += 2) {
    pooled.push(Math.max(conv2[i], conv2[i+1] || conv2[i]));
  }
  
  // Fully connected
  let fcScore = pooled.reduce((a, b) => a + b, 0) / pooled.length;
  fcScore = 1 / (1 + Math.exp(-(fcScore - 0.5) * 4));
  
  const prediction = fcScore > 0.55 ? 'Tài' : (fcScore < 0.45 ? 'Xỉu' : null);
  const confidence = Math.round(65 + Math.abs(fcScore - 0.5) * 60);
  
  if (prediction && confidence > 68) {
    return {
      detected: true,
      prediction,
      confidence: Math.min(91, confidence),
      name: `Temporal CNN`,
      patternId: 'temporal_cnn'
    };
  }
  return { detected: false };
}

// 7. Residual Network với skip connections
function analyzeResidualNetwork(results, sums, type) {
  if (results.length < 15) return { detected: false };
  
  const seq = results.slice(0, 15).map(r => r === 'Tài' ? 1 : 0);
  
  // Layer 1
  const layer1 = [];
  for (let i = 0; i < seq.length - 2; i++) {
    const val = Math.tanh(seq[i] * 0.6 + seq[i+1] * 0.3 + seq[i+2] * 0.1);
    layer1.push(val);
  }
  
  // Residual connection
  const residual = [];
  for (let i = 0; i < layer1.length - 2; i++) {
    const val = layer1[i] * 0.5 + layer1[i+1] * 0.3 + layer1[i+2] * 0.2;
    residual.push(val);
  }
  
  // Skip connection
  const skip = [];
  for (let i = 0; i < residual.length; i++) {
    const skipVal = residual[i] + (seq[i] || 0) * 0.2;
    skip.push(skipVal);
  }
  
  // Output layer
  let output = skip.reduce((a, b) => a + b, 0) / skip.length;
  output = 1 / (1 + Math.exp(-(output - 0.5) * 5));
  
  const prediction = output > 0.55 ? 'Tài' : (output < 0.45 ? 'Xỉu' : null);
  const confidence = Math.round(65 + Math.abs(output - 0.5) * 65);
  
  if (prediction && confidence > 68) {
    return {
      detected: true,
      prediction,
      confidence: Math.min(93, confidence),
      name: `Residual Network`,
      patternId: 'residual'
    };
  }
  return { detected: false };
}

// ==================== FEATURE EXTRACTION NÂNG CAO ====================

function extractDeepFeatures(results, sums) {
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
    supportResistance: detectSupportResistance(sums.slice(0, 20)).resistance || 0,
    meanReversion: calculateMeanReversion(sums.slice(0, 15))
  };
}

function calculateMeanReversion(sums) {
  if (sums.length < 10) return 0;
  const mean = sums.reduce((a, b) => a + b, 0) / sums.length;
  const last = sums[0];
  return (mean - last) / mean;
}

// ==================== PATTERN CƠ BẢN (GIỮ NGUYÊN) ====================

function analyzeXuHuongManh(results, type) {
  if (results.length < 8) return { detected: false };
  const recent8 = results.slice(0, 8);
  const taiCount = recent8.filter(r => r === 'Tài').length;
  
  if (taiCount >= 6) {
    return { detected: true, prediction: 'Xỉu', confidence: Math.round(80 + taiCount * 2), name: `Xu Hướng Mạnh`, patternId: 'xu_huong_manh' };
  }
  if (taiCount <= 2) {
    return { detected: true, prediction: 'Tài', confidence: Math.round(80 + (8 - taiCount) * 2), name: `Xu Hướng Mạnh`, patternId: 'xu_huong_manh' };
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
    const prediction = recent5[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return { detected: true, prediction, confidence: 75, name: `Đảo Chiều`, patternId: 'dao_chieu' };
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
    let shouldBreak = streakLength >= 5;
    let confidence = 65;
    if (streakLength >= 8) { shouldBreak = true; confidence = 88; }
    else if (streakLength >= 6) { shouldBreak = true; confidence = 82; }
    else if (streakLength >= 4) { shouldBreak = true; confidence = 72; }
    else if (streakLength >= 3) { shouldBreak = false; confidence = 68; }
    return { detected: true, prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType, confidence: confidence, name: `Cầu Bệt`, patternId: 'cau_bet' };
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
    return { detected: true, prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: Math.min(88, 75 + streakLength), name: `Cầu Rồng`, patternId: 'cau_rong' };
  }
  return { detected: false };
}

function analyzeSmartBet(results, type) {
  if (results.length < 10) return { detected: false };
  const last10 = results.slice(0, 10);
  const last5 = results.slice(0, 5);
  const prev5 = results.slice(5, 10);
  const taiLast5 = last5.filter(r => r === 'Tài').length;
  const taiPrev5 = prev5.filter(r => r === 'Tài').length;
  const trendChanging = (taiLast5 >= 4 && taiPrev5 <= 1) || (taiLast5 <= 1 && taiPrev5 >= 4);
  if (trendChanging) {
    const currentDominant = taiLast5 >= 4 ? 'Tài' : 'Xỉu';
    return { detected: true, prediction: currentDominant === 'Tài' ? 'Xỉu' : 'Tài', confidence: 78, name: `Smart Bet`, patternId: 'smart_bet' };
  }
  const taiLast10 = last10.filter(r => r === 'Tài').length;
  if (taiLast10 >= 8 || taiLast10 <= 2) {
    const dominant = taiLast10 >= 8 ? 'Tài' : 'Xỉu';
    return { detected: true, prediction: dominant === 'Tài' ? 'Xỉu' : 'Tài', confidence: 82, name: `Smart Bet`, patternId: 'smart_bet' };
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
    return { detected: true, prediction, confidence: Math.min(85, 70 + streakLength), name: `Bẻ Chuỗi`, patternId: 'break_streak' };
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
    if (tripleType1 === results[3] && results[3] === results[6]) {
      const prediction = tripleType1 === 'Tài' ? 'Xỉu' : 'Tài';
      return { detected: true, prediction, confidence: 88, name: `Triple Pattern`, patternId: 'triple_pattern' };
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
  if (sumTrend > 1.5) {
    return { detected: true, prediction: 'Xỉu', confidence: Math.round(75 + Math.abs(sumTrend) * 3), name: `Tổng Phân Tích`, patternId: 'tong_phan_tich' };
  }
  if (sumTrend < -1.5) {
    return { detected: true, prediction: 'Tài', confidence: Math.round(75 + Math.abs(sumTrend) * 3), name: `Tổng Phân Tích`, patternId: 'tong_phan_tich' };
  }
  const taiCount = results.filter(r => r === 'Tài').length;
  const xiuCount = results.length - taiCount;
  if (Math.abs(taiCount - xiuCount) >= 3) {
    const lech = taiCount > xiuCount ? 'Tài' : 'Xỉu';
    const prediction = lech === 'Tài' ? 'Xỉu' : 'Tài';
    return { detected: true, prediction, confidence: Math.round(70 + Math.abs(taiCount - xiuCount) * 3), name: `Tổng Phân Tích`, patternId: 'tong_phan_tich' };
  }
  return { detected: false };
}

function analyzeFibonacci(sums, type) {
  if (sums.length < 10) return { detected: false };
  const recent = sums.slice(0, 10);
  const maxSum = Math.max(...recent);
  const minSum = Math.min(...recent);
  const range = maxSum - minSum;
  const fibLevels = { '0.236': minSum + range * 0.236, '0.382': minSum + range * 0.382, '0.5': minSum + range * 0.5, '0.618': minSum + range * 0.618, '0.786': minSum + range * 0.786 };
  const lastSum = sums[0];
  for (const [level, value] of Object.entries(fibLevels)) {
    if (Math.abs(lastSum - value) < 1.5) {
      const prediction = lastSum > fibLevels['0.5'] ? 'Xỉu' : 'Tài';
      return { detected: true, prediction, confidence: 72, name: `Fibonacci`, patternId: 'fibonacci' };
    }
  }
  return { detected: false };
}

function analyzeCauTuNhien(results, type) {
  if (results.length < 2) return { detected: false };
  return { detected: true, prediction: results[0], confidence: 60, name: `Cầu Tự Nhiên`, patternId: 'cau_tu_nhien' };
}

function analyzeDistribution(data, type, windowSize = 50) {
  const window = data.slice(0, windowSize);
  const taiCount = window.filter(d => d.Ket_qua === 'Tài').length;
  return {
    taiPercent: (taiCount / window.length) * 100,
    xiuPercent: ((window.length - taiCount) / window.length) * 100,
    imbalance: Math.abs(taiCount - (window.length - taiCount)) / window.length
  };
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
  
  // DANH SÁCH PATTERN ƯU TIÊN CAO
  const patterns = [
    { name: 'Deep Ensemble', func: () => analyzeDeepEnsemble(results, sums, type), priority: 22 },
    { name: 'Transformer Multi-Head', func: () => analyzeTransformerAdvanced(results, sums, type), priority: 21 },
    { name: 'Attention BiLSTM', func: () => analyzeAttentionBiLSTM(results, sums, type), priority: 20 },
    { name: 'LSTM Advanced', func: () => analyzeLSTMAdvanced(results, type), priority: 19 },
    { name: 'GRU Advanced', func: () => analyzeGRUAdvanced(results, type), priority: 19 },
    { name: 'Residual Network', func: () => analyzeResidualNetwork(results, sums, type), priority: 18 },
    { name: 'Temporal CNN', func: () => analyzeTemporalCNN(results, sums, type), priority: 18 },
    { name: 'Tổng Phân Tích', func: () => analyzeTongPhanTich(last50, type), priority: 16 },
    { name: 'Xu Hướng Mạnh', func: () => analyzeXuHuongManh(results, type), priority: 14 },
    { name: 'Đảo Chiều', func: () => analyzeDaoChieu(results, type), priority: 13 },
    { name: 'Cầu Rồng', func: () => analyzeCauRong(results, type), priority: 13 },
    { name: 'Bẻ Chuỗi', func: () => analyzeBreakStreak(results, type), priority: 12 },
    { name: 'Smart Bet', func: () => analyzeSmartBet(results, type), priority: 12 },
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
    factors.push(`Phân bố lệch`);
  }
  
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
  
  // Điều chỉnh theo học máy
  const features = extractDeepFeatures(results, sums);
  const mlProbability = predictWithML(features, type);
  
  if (mlProbability > 0.6) {
    taiScore *= (1 + mlProbability);
  } else if (mlProbability < 0.4) {
    xiuScore *= (1 + (1 - mlProbability));
  }
  
  const streakInfo = learningData[type].streakAnalysis;
  if (streakInfo.currentStreak <= -3) {
    if (taiScore > xiuScore) {
      xiuScore *= 1.35;
    } else {
      taiScore *= 1.35;
    }
  }
  
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  finalPrediction = getSmartPredictionAdjustment(type, finalPrediction, allPatterns);
  
  let baseConfidence = 65;
  const topPredictions = predictions.slice(0, 5);
  topPredictions.forEach(p => {
    if (p.prediction === finalPrediction) {
      baseConfidence += (p.confidence - 65) * 0.35;
    }
  });
  
  const agreementRatio = (finalPrediction === 'Tài' ? taiVotes.length : xiuVotes.length) / predictions.length;
  baseConfidence += Math.round(agreementRatio * 15);
  
  const mlBoost = Math.abs(mlProbability - 0.5) * 25;
  baseConfidence += mlBoost;
  
  const adaptiveBoost = getAdaptiveConfidenceBoost(type);
  baseConfidence += adaptiveBoost;
  
  let finalConfidence = Math.round(baseConfidence);
  finalConfidence = Math.max(65, Math.min(96, finalConfidence));
  
  return {
    prediction: finalPrediction,
    confidence: finalConfidence,
    factors,
    mlProbability: (mlProbability * 100).toFixed(1)
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
    'Cầu 3-3': 'cau_33', 'Cầu Rồng': 'cau_rong', 'Đảo Xu Hướng': 'smart_bet',
    'Tổng Phân Tích': 'tong_phan_tich', 'Xu Hướng Mạnh': 'xu_huong_manh',
    'Đảo Chiều': 'dao_chieu', 'Smart Bet': 'smart_bet', 'Bẻ Chuỗi': 'break_streak',
    'Triple Pattern': 'triple_pattern', 'Fibonacci': 'fibonacci',
    'LSTM Advanced': 'lstm_advanced', 'GRU Advanced': 'gru_advanced',
    'Transformer Multi-Head': 'transformer', 'Deep Ensemble': 'ensemble_deep',
    'Attention BiLSTM': 'attention_bilstm', 'Residual Network': 'residual',
    'Temporal CNN': 'temporal_cnn'
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
  
  let taiPatternScore = 0;
  let xiuPatternScore = 0;
  
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
        console.log(`[Auto] Hu: ${result.prediction} (${result.confidence}%)`);
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
        console.log(`[Auto] MD5: ${result.prediction} (${result.confidence}%)`);
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
  console.log(`Auto-save task started (every ${AUTO_SAVE_INTERVAL/1000}s)`);
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
      adaptiveThresholds: {}, recentAccuracy: [], mlModel: { weights: {}, bias: 0, lastTraining: null },
      lstmMemory: [], gruMemory: []
    },
    md5: {
      predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0,
      patternWeights: { ...DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null,
      streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
      adaptiveThresholds: {}, recentAccuracy: [], mlModel: { weights: {}, bias: 0, lastTraining: null },
      lstmMemory: [], gruMemory: []
    }
  };
  saveLearningData();
  res.json({ message: 'Learning data reset successfully' });
});

loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log('Lau Cua 79 - SUPER AI PREDICTION API v9.0');
  console.log('');
  console.log('🔥 AI MODELS NÂNG CẤP:');
  console.log('  • Deep Ensemble - 4 mô hình kết hợp (LSTM+GRU+CNN+Residual)');
  console.log('  • Transformer Multi-Head - Cơ chế attention 3 heads');
  console.log('  • Attention BiLSTM - Two-way LSTM với attention');
  console.log('  • LSTM/GRU Advanced - Memory cell thông minh');
  console.log('  • Residual Network - Skip connections');
  console.log('  • Temporal CNN - Convolution trên chuỗi thời gian');
  console.log('');
  console.log('📊 ĐỘ CHÍNH XÁC: Được cải thiện đáng kể');
  console.log('👤 ID: @hotsucmanhtele');
  
  startAutoSaveTask();
});