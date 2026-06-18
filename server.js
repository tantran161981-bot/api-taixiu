const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'Tskhang.json';
const HISTORY_FILE = 'Tskhang1.json';
const AI_MODEL_FILE = 'ai_model.json';

let predictionHistory = { hu: [], md5: [] };
const MAX_HISTORY = 200;
const AUTO_SAVE_INTERVAL = 25000;
let lastProcessedPhien = { hu: null, md5: null };

// ==================== AI ENGINE NÂNG CẤP ====================
let learningData = {
  hu: initializeAIModel(),
  md5: initializeAIModel()
};

function initializeAIModel() {
  return {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [],
    reversalState: { active: false, streakTrigger: 0 },
    markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 },
    markov2Matrix: {},
    markov3Matrix: {},
    volatility: 0,
    // NÂNG CẤP: Deep Learning Pattern Memory
    deepPatternMemory: {},
    cauHistory: [],
    cauSuccessRates: {},
    confidenceCalibration: {},
    timeBasedStats: {},
    fibonacciLevels: [],
    pivotPoints: [],
    trendStrength: 0,
    adaptiveWeights: {},
    smartBetHistory: [],
    hybridPredictions: [],
    neuralNetworkWeights: {
      recentBias: 0.35,
      patternBias: 0.30,
      markovBias: 0.20,
      trendBias: 0.15
    }
  };
}

// === HÀM LOAD/SAVE NÂNG CẤP ===
function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = fs.readFileSync(LEARNING_FILE, 'utf8');
      const parsed = JSON.parse(data);
      for (let type of ['hu', 'md5']) {
        if (parsed[type]) {
          learningData[type] = deepMerge(learningData[type], parsed[type]);
        }
      }
      console.log('✅ Đã load AI model từ', LEARNING_FILE);
    }
    // Load AI model nâng cao
    if (fs.existsSync(AI_MODEL_FILE)) {
      const aiData = JSON.parse(fs.readFileSync(AI_MODEL_FILE, 'utf8'));
      for (let type of ['hu', 'md5']) {
        if (aiData[type]) {
          learningData[type] = deepMerge(learningData[type], aiData[type]);
        }
      }
      console.log('✅ Đã load AI advanced model từ', AI_MODEL_FILE);
    }
  } catch (error) {
    console.error('Error loading AI data:', error.message);
  }
}

function deepMerge(target, source) {
  const output = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      output[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      output[key] = source[key];
    }
  }
  return output;
}

function saveLearningData() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
    // Lưu AI model riêng
    const aiModel = {
      hu: {
        deepPatternMemory: learningData.hu.deepPatternMemory,
        cauHistory: learningData.hu.cauHistory.slice(-500),
        cauSuccessRates: learningData.hu.cauSuccessRates,
        neuralNetworkWeights: learningData.hu.neuralNetworkWeights,
        adaptiveWeights: learningData.hu.adaptiveWeights
      },
      md5: {
        deepPatternMemory: learningData.md5.deepPatternMemory,
        cauHistory: learningData.md5.cauHistory.slice(-500),
        cauSuccessRates: learningData.md5.cauSuccessRates,
        neuralNetworkWeights: learningData.md5.neuralNetworkWeights,
        adaptiveWeights: learningData.md5.adaptiveWeights
      }
    };
    fs.writeFileSync(AI_MODEL_FILE, JSON.stringify(aiModel, null, 2));
  } catch (error) {
    console.error('Error saving AI data:', error.message);
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

// === HÀM LẤY DỮ LIỆU API ===
function transformApiData(apiData) {
  if (!apiData || !apiData.list || !Array.isArray(apiData.list)) return null;
  return apiData.list.map(item => ({
    Phien: item.id,
    Ket_qua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
    Xuc_xac_1: item.dices[0],
    Xuc_xac_2: item.dices[1],
    Xuc_xac_3: item.dices[2],
    Tong: item.point,
    ChanLe: item.point % 2 === 0 ? 'Chẵn' : 'Lẻ',
    isDouble: (item.dices[0] === item.dices[1] || item.dices[1] === item.dices[2] || item.dices[0] === item.dices[2]),
    isTriple: (item.dices[0] === item.dices[1] && item.dices[1] === item.dices[2])
  }));
}

async function fetchDataHu() {
  try {
    const response = await axios.get(API_URL_HU, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    console.error('Error fetching HU:', error.message);
    return null;
  }
}

async function fetchDataMd5() {
  try {
    const response = await axios.get(API_URL_MD5, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    console.error('Error fetching MD5:', error.message);
    return null;
  }
}

// ==================== THUẬT TOÁN BÁM CẦU SIÊU THÔNG MINH ====================

// 1. PHÂN TÍCH CẤU TRÚC CẦU PHỨC TẠP
function analyzeComplexPattern(results, data) {
  const patterns = [];
  
  // Cầu bệt siêu dài (bám theo đến khi gãy)
  let streakType = results[0];
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) streakLength++;
    else break;
  }
  if (streakLength >= 2) {
    const shouldBreak = analyzeStreakBreakProbability(streakLength, results);
    patterns.push({
      name: `Cầu Bệt ${streakLength}`,
      prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
      confidence: calculateBamCauConfidence(streakLength, shouldBreak),
      priority: 10,
      type: 'bam_cau'
    });
  }

  // Cầu đảo 1-1 thông minh
  const alternatingPattern = detectAlternatingPattern(results);
  if (alternatingPattern.length >= 4) {
    patterns.push({
      name: `Cầu Đảo ${alternatingPattern.length}`,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: 65 + alternatingPattern.length * 2,
      priority: 9,
      type: 'bam_cau'
    });
  }

  // Cầu 2-2, 3-3 nâng cao
  const complexPattern = detectComplexSequencePattern(results);
  if (complexPattern) {
    patterns.push(complexPattern);
  }

  // Cầu Fibonacci (mới)
  const fiboPattern = detectFibonacciPattern(results);
  if (fiboPattern) {
    patterns.push(fiboPattern);
  }

  // Cầu sóng Elliott nâng cao
  const elliottPattern = detectAdvancedElliott(results, data);
  if (elliottPattern) {
    patterns.push(elliottPattern);
  }

  // Cầu theo tổng điểm
  const sumPattern = analyzeSumTrend(data);
  if (sumPattern) {
    patterns.push(sumPattern);
  }

  return patterns;
}

// 2. PHÂN TÍCH XÁC SUẤT GÃY CẦU
function analyzeStreakBreakProbability(streakLength, results) {
  if (streakLength >= 8) return true;  // Bệt quá dài -> gãy
  if (streakLength >= 6 && Math.random() > 0.4) return true;
  
  // Kiểm tra pattern trong quá khứ
  const pattern = results.slice(0, streakLength).join('');
  const historyCount = results.join('').split(pattern).length - 1;
  if (historyCount >= 3) return true;
  
  return false;
}

// 3. PHÁT HIỆN CẦU NÂNG CAO
function detectComplexSequencePattern(results) {
  // Cầu 2-2
  let pairPattern = [];
  for (let i = 0; i < results.length - 1; i += 2) {
    if (results[i] === results[i + 1]) {
      pairPattern.push(results[i]);
    } else break;
  }
  if (pairPattern.length >= 3) {
    const isAlternating = pairPattern.every((p, i) => i === 0 || p !== pairPattern[i-1]);
    if (isAlternating) {
      return {
        name: `Cầu 2-2 (${pairPattern.length} cặp)`,
        prediction: pairPattern[pairPattern.length - 1] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: 70 + pairPattern.length * 3,
        priority: 8,
        type: 'bam_cau'
      };
    }
  }

  // Cầu 3-3
  let triplePattern = [];
  for (let i = 0; i < results.length - 2; i += 3) {
    if (results[i] === results[i+1] && results[i+1] === results[i+2]) {
      triplePattern.push(results[i]);
    } else break;
  }
  if (triplePattern.length >= 2) {
    return {
      name: `Cầu 3-3 (${triplePattern.length} bộ)`,
      prediction: triplePattern[triplePattern.length - 1] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: 75 + triplePattern.length * 4,
      priority: 8,
      type: 'bam_cau'
    };
  }

  // Cầu 1-2-1
  if (results.length >= 4) {
    const p1 = results.slice(0, 4);
    if (p1[0] !== p1[1] && p1[1] === p1[2] && p1[2] !== p1[3] && p1[0] === p1[3]) {
      return {
        name: 'Cầu 1-2-1',
        prediction: p1[0],
        confidence: 72,
        priority: 7,
        type: 'bam_cau'
      };
    }
  }

  return null;
}

// 4. PHÁT HIỆN CẦU FIBONACCI
function detectFibonacciPattern(results) {
  if (results.length < 8) return null;
  
  // Tìm chuỗi Fibonacci trong độ dài các đoạn cầu
  let segments = [];
  let currentType = results[0];
  let count = 1;
  
  for (let i = 1; i < results.length; i++) {
    if (results[i] === currentType) count++;
    else {
      segments.push(count);
      currentType = results[i];
      count = 1;
    }
  }
  segments.push(count);

  // Fibonacci sequence: 1,1,2,3,5,8
  const fibo = [1, 1, 2, 3, 5, 8];
  for (let i = 0; i <= segments.length - 4; i++) {
    const slice = segments.slice(i, i + 4);
    if (fibo.some((_, idx) => 
      slice[0] === fibo[idx] && 
      slice[1] === fibo[idx+1] && 
      slice[2] === fibo[idx+2] && 
      slice[3] === fibo[idx+3]
    )) {
      const nextType = (i % 2 === 0) ? results[0] : (results[0] === 'Tài' ? 'Xỉu' : 'Tài');
      return {
        name: 'Cầu Fibonacci',
        prediction: nextType,
        confidence: 78,
        priority: 9,
        type: 'bam_cau'
      };
    }
  }
  return null;
}

// 5. ELLIOTT WAVE NÂNG CAO
function detectAdvancedElliott(results, data) {
  if (results.length < 21) return null;
  
  // Phân tích 5 sóng Elliott
  let waves = [];
  let currentWave = { direction: results[0], length: 1 };
  
  for (let i = 1; i < results.length; i++) {
    if (results[i] === currentWave.direction) {
      currentWave.length++;
    } else {
      waves.push(currentWave);
      currentWave = { direction: results[i], length: 1 };
    }
  }
  waves.push(currentWave);

  // Tìm pattern 5 sóng (Impulse)
  for (let i = 0; i <= waves.length - 5; i++) {
    const waveSet = waves.slice(i, i + 5);
    if (waveSet[0].direction === waveSet[2].direction && 
        waveSet[0].direction === waveSet[4].direction &&
        waveSet[1].direction !== waveSet[0].direction &&
        waveSet[3].direction !== waveSet[0].direction) {
      
      // Sóng 3 thường dài nhất
      if (waveSet[2].length >= Math.max(waveSet[0].length, waveSet[4].length)) {
        const correction = waveSet[4].direction === 'Tài' ? 'Xỉu' : 'Tài';
        return {
          name: 'Sóng Elliott 5 (Impulse)',
          prediction: correction,
          confidence: 80,
          priority: 10,
          type: 'bam_cau'
        };
      }
    }
  }
  return null;
}

// 6. PHÂN TÍCH TỔNG ĐIỂM
function analyzeSumTrend(data) {
  if (data.length < 10) return null;
  
  const recentSums = data.slice(0, 10).map(d => d.Tong);
  const avg = recentSums.reduce((a, b) => a + b, 0) / recentSums.length;
  
  // Phân tích xu hướng tổng
  const firstHalf = recentSums.slice(5, 10).reduce((a, b) => a + b, 0) / 5;
  const secondHalf = recentSums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const trend = secondHalf - firstHalf;
  
  if (Math.abs(trend) > 2) {
    return {
      name: `Xu hướng tổng ${trend > 0 ? 'tăng' : 'giảm'}`,
      prediction: trend > 0 ? 'Xỉu' : 'Tài',
      confidence: 73,
      priority: 7,
      type: 'tong_diem'
    };
  }
  
  // Kiểm tra đảo chiều tổng
  if (avg > 12) {
    return { name: 'Tổng cao -> Xỉu', prediction: 'Xỉu', confidence: 70, priority: 7, type: 'tong_diem' };
  } else if (avg < 8) {
    return { name: 'Tổng thấp -> Tài', prediction: 'Tài', confidence: 70, priority: 7, type: 'tong_diem' };
  }
  
  return null;
}

// 7. PHÂN TÍCH VOLUME VÀ BIẾN ĐỘNG
function analyzeVolatility(data) {
  if (data.length < 10) return { volatility: 0, prediction: null };
  
  const sums = data.slice(0, 20).map(d => d.Tong);
  const changes = [];
  for (let i = 1; i < sums.length; i++) {
    changes.push(Math.abs(sums[i] - sums[i-1]));
  }
  const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
  const maxChange = Math.max(...changes);
  
  // Biến động cao -> khó đoán
  if (maxChange > 10) {
    return {
      volatility: avgChange,
      prediction: null,
      warning: 'Biến động cực mạnh'
    };
  }
  
  return { volatility: avgChange, prediction: null };
}

// 8. MACHINE LEARNING ENSEMBLE
function ensembleMLPredictions(patterns, data, type) {
  let taiScore = 0;
  let xiuScore = 0;
  const weights = learningData[type].neuralNetworkWeights;
  
  // Trọng số động dựa trên hiệu suất
  for (const pattern of patterns) {
    const successRate = learningData[type].cauSuccessRates[pattern.name] || 0.5;
    const adjustedWeight = weights.patternBias * (successRate * 2);
    
    if (pattern.prediction === 'Tài') {
      taiScore += pattern.confidence * adjustedWeight * pattern.priority;
    } else {
      xiuScore += pattern.confidence * adjustedWeight * pattern.priority;
    }
  }
  
  // Thêm Markov chain score
  if (data.length >= 2) {
    const markovScore = calculateMarkovScore(data, type);
    if (markovScore > 0) taiScore += markovScore * weights.markovBias * 100;
    else xiuScore += Math.abs(markovScore) * weights.markovBias * 100;
  }
  
  // Thêm trend score
  const trendScore = calculateTrendScore(data);
  if (trendScore > 0) taiScore += trendScore * weights.trendBias * 100;
  else xiuScore += Math.abs(trendScore) * weights.trendBias * 100;
  
  // Cập nhật trọng số thích nghi
  updateAdaptiveWeights(type, taiScore, xiuScore);
  
  return {
    prediction: taiScore > xiuScore ? 'Tài' : 'Xỉu',
    confidence: calculateFinalConfidence(taiScore, xiuScore),
    taiScore,
    xiuScore
  };
}

// 9. TÍNH TOÁN MARKOV SCORE
function calculateMarkovScore(data, type) {
  if (data.length < 2) return 0;
  
  const results = data.map(d => d.Ket_qua);
  const lastTwo = results.slice(0, 2);
  
  // Cập nhật ma trận Markov
  updateMarkovMatrices(type, results);
  
  const matrix = learningData[type].markovMatrix;
  const key = lastTwo[1] + lastTwo[0];
  
  if (key === 'TàiTài') return matrix.TT - 0.5;
  if (key === 'TàiXỉu') return matrix.TX - 0.5;
  if (key === 'XỉuTài') return matrix.XT - 0.5;
  if (key === 'XỉuXỉu') return matrix.XX - 0.5;
  
  return 0;
}

// 10. TÍNH TREND SCORE
function calculateTrendScore(data) {
  if (data.length < 5) return 0;
  
  const results = data.slice(0, 5).map(d => d.Ket_qua);
  const taiCount = results.filter(r => r === 'Tài').length;
  
  if (taiCount >= 4) return -0.3; // Đảo chiều
  if (taiCount <= 1) return 0.3;  // Đảo chiều
  
  return 0;
}

// 11. CẬP NHẬT TRỌNG SỐ THÍCH NGHI
function updateAdaptiveWeights(type, taiScore, xiuScore) {
  const currentWeights = learningData[type].neuralNetworkWeights;
  const successRate = learningData[type].correctPredictions / Math.max(1, learningData[type].totalPredictions);
  
  // Điều chỉnh trọng số dựa trên độ chính xác
  if (successRate > 0.6) {
    currentWeights.patternBias = Math.min(0.45, currentWeights.patternBias + 0.02);
    currentWeights.recentBias = Math.max(0.2, currentWeights.recentBias - 0.01);
  } else {
    currentWeights.patternBias = Math.max(0.2, currentWeights.patternBias - 0.02);
    currentWeights.recentBias = Math.min(0.5, currentWeights.recentBias + 0.01);
  }
}

// 12. TÍNH CONFIDENCE CUỐI CÙNG
function calculateFinalConfidence(taiScore, xiuScore) {
  const total = taiScore + xiuScore;
  if (total === 0) return 50;
  
  const maxScore = Math.max(taiScore, xiuScore);
  const confidence = (maxScore / total) * 100;
  
  return Math.min(95, Math.max(55, Math.round(confidence)));
}

// === HÀM PHÂN TÍCH CHÍNH ===
function calculateAdvancedPrediction(data, type) {
  if (!data || data.length < 5) {
    return {
      prediction: Math.random() > 0.5 ? 'Tài' : 'Xỉu',
      confidence: 50,
      factors: ['Không đủ dữ liệu'],
      allPatterns: [],
      detailedAnalysis: { totalPatterns: 0, taiVotes: 0, xiuVotes: 0 }
    };
  }

  const results = data.map(d => d.Ket_qua);
  
  // Cập nhật ma trận Markov
  updateMarkovMatrices(type, results);
  
  // Phân tích tất cả pattern
  const patterns = analyzeComplexPattern(results, data);
  
  // Phân tích biến động
  const volatility = analyzeVolatility(data);
  
  // Ensemble ML predictions
  const ensemble = ensembleMLPredictions(patterns, data, type);
  
  // Xác định reversal mode
  const streak = learningData[type].streakAnalysis;
  let finalPrediction = ensemble.prediction;
  
  if (streak.currentStreak <= -3 && !learningData[type].reversalState.active) {
    finalPrediction = finalPrediction === 'Tài' ? 'Xỉu' : 'Tài';
    learningData[type].reversalState = { active: true, streakTrigger: streak.currentStreak };
  } else if (streak.currentStreak > 0 && learningData[type].reversalState.active) {
    learningData[type].reversalState.active = false;
  }
  
  // Lấy top patterns
  const topPatterns = patterns.sort((a, b) => b.priority - a.priority).slice(0, 5);
  
  return {
    prediction: finalPrediction,
    confidence: ensemble.confidence,
    factors: topPatterns.map(p => `${p.name} → ${p.prediction}`),
    allPatterns: topPatterns.map(p => p.name),
    detailedAnalysis: {
      totalPatterns: patterns.length,
      taiVotes: patterns.filter(p => p.prediction === 'Tài').length,
      xiuVotes: patterns.filter(p => p.prediction === 'Xỉu').length,
      topPattern: topPatterns[0]?.name || 'N/A',
      ensembleScores: { tai: ensemble.taiScore.toFixed(2), xiu: ensemble.xiuScore.toFixed(2) },
      volatility: volatility.volatility.toFixed(2),
      learningStats: {
        accuracy: learningData[type].totalPredictions ? 
          (learningData[type].correctPredictions / learningData[type].totalPredictions * 100).toFixed(1) + '%' : 'N/A',
        currentStreak: streak.currentStreak,
        totalCorrect: learningData[type].correctPredictions
      }
    }
  };
}

// === CẬP NHẬT MA TRẬN MARKOV ===
function updateMarkovMatrices(type, results) {
  if (results.length < 10) return;
  
  // Markov bậc 1
  let tt = 0, tx = 0, xt = 0, xx = 0;
  for (let i = 0; i < results.length - 1; i++) {
    if (results[i] === 'Tài' && results[i + 1] === 'Tài') tt++;
    else if (results[i] === 'Tài' && results[i + 1] === 'Xỉu') tx++;
    else if (results[i] === 'Xỉu' && results[i + 1] === 'Tài') xt++;
    else if (results[i] === 'Xỉu' && results[i + 1] === 'Xỉu') xx++;
  }
  const total = tt + tx + xt + xx || 1;
  learningData[type].markovMatrix = { 
    TT: tt / total, TX: tx / total, XT: xt / total, XX: xx / total 
  };
  
  // Markov bậc 2
  const markov2 = {};
  for (let i = 0; i < results.length - 2; i++) {
    const key = results[i] + results[i + 1];
    const next = results[i + 2];
    markov2[key + next] = (markov2[key + next] || 0) + 1;
  }
  learningData[type].markov2Matrix = markov2;
  
  // Markov bậc 3
  const markov3 = {};
  for (let i = 0; i < results.length - 3; i++) {
    const key = results[i] + results[i + 1] + results[i + 2];
    const next = results[i + 3];
    markov3[key + next] = (markov3[key + next] || 0) + 1;
  }
  learningData[type].markov3Matrix = markov3;
}

// === HÀM PHỤ TRỢ ===
function detectAlternatingPattern(results) {
  let count = 1;
  for (let i = 1; i < Math.min(results.length, 15); i++) {
    if (results[i] !== results[i - 1]) count++;
    else break;
  }
  return Array(count).fill(0).map((_, i) => i % 2 === 0 ? results[0] : (results[0] === 'Tài' ? 'Xỉu' : 'Tài'));
}

function calculateBamCauConfidence(streakLength, shouldBreak) {
  if (shouldBreak) return Math.min(85, 68 + streakLength);
  return Math.min(90, 65 + streakLength * 1.5);
}

// === VERIFY & RECORD ===
async function verifyPredictions(type, currentData) {
  let updated = false;
  for (let pred of learningData[type].predictions) {
    if (pred.verified) continue;
    const actual = currentData.find(d => d.Phien.toString() === pred.phien);
    if (actual) {
      pred.verified = true;
      pred.actual = actual.Ket_qua;
      pred.isCorrect = (pred.prediction === pred.actual);
      
      if (pred.isCorrect) {
        learningData[type].correctPredictions++;
        learningData[type].streakAnalysis.currentStreak = 
          Math.max(1, learningData[type].streakAnalysis.currentStreak + 1);
      } else {
        learningData[type].streakAnalysis.currentStreak = 
          Math.min(-1, learningData[type].streakAnalysis.currentStreak - 1);
      }
      
      // Cập nhật tỷ lệ thành công cho từng loại cầu
      if (pred.patterns) {
        pred.patterns.forEach(pattern => {
          if (!learningData[type].cauSuccessRates[pattern]) {
            learningData[type].cauSuccessRates[pattern] = { success: 0, total: 0 };
          }
          learningData[type].cauSuccessRates[pattern].total++;
          if (pred.isCorrect) {
            learningData[type].cauSuccessRates[pattern].success++;
          }
        });
      }
      
      learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 100) {
        learningData[type].recentAccuracy.shift();
      }
      
      updated = true;
    }
  }
  
  // Cập nhật streak records
  const streak = learningData[type].streakAnalysis;
  if (streak.currentStreak > streak.bestStreak) streak.bestStreak = streak.currentStreak;
  if (streak.currentStreak < streak.worstStreak) streak.worstStreak = streak.currentStreak;
  
  if (updated) saveLearningData();
}

function recordPrediction(type, phien, prediction, confidence, patterns) {
  learningData[type].predictions.unshift({
    phien: phien.toString(),
    prediction,
    confidence,
    patterns,
    timestamp: new Date().toISOString(),
    verified: false,
    actual: null,
    isCorrect: null
  });
  learningData[type].totalPredictions++;
  
  if (learningData[type].predictions.length > 500) {
    learningData[type].predictions.pop();
  }
  
  // Lưu vào cầu history
  learningData[type].cauHistory.push({
    phien: phien.toString(),
    prediction,
    confidence,
    patterns: patterns.slice(0, 3),
    timestamp: new Date().toISOString()
  });
  if (learningData[type].cauHistory.length > 500) {
    learningData[type].cauHistory.shift();
  }
  
  saveLearningData();
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
    id: '@Tskhang',
    timestamp: new Date().toISOString()
  };
  
  predictionHistory[type].unshift(record);
  if (predictionHistory[type].length > MAX_HISTORY) {
    predictionHistory[type].pop();
  }
  
  return record;
}

async function updateHistoryStatus(type) {
  let data = (type === 'hu') ? await fetchDataHu() : await fetchDataMd5();
  if (!data) return;
  
  for (let record of predictionHistory[type]) {
    if (record.ket_qua_du_doan && record.ket_qua_du_doan !== '') continue;
    const actual = data.find(d => d.Phien.toString() === record.Phien_hien_tai);
    if (actual) {
      record.ket_qua_du_doan = (record.Du_doan === actual.Ket_qua) ? 'Đúng ✅' : 'Sai ❌';
    }
  }
  savePredictionHistory();
}

// === AUTO PROCESS ===
async function autoProcessPredictions() {
  try {
    console.log('\n🔄 [Auto] Bắt đầu phân tích phiên mới...');
    
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      const nextPhien = dataHu[0].Phien + 1;
      if (lastProcessedPhien.hu !== nextPhien) {
        await verifyPredictions('hu', dataHu);
        const result = calculateAdvancedPrediction(dataHu, 'hu');
        savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, dataHu[0]);
        recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.allPatterns);
        lastProcessedPhien.hu = nextPhien;
        
        console.log(`🎯 [HU] Phiên ${nextPhien}: ${result.prediction} (${result.confidence}%)`);
        console.log(`   📊 Patterns: ${result.allPatterns.slice(0, 3).join(', ')}`);
        console.log(`   🎲 Độ chính xác: ${result.detailedAnalysis.learningStats.accuracy}`);
      }
    }
    
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      const nextPhien = dataMd5[0].Phien + 1;
      if (lastProcessedPhien.md5 !== nextPhien) {
        await verifyPredictions('md5', dataMd5);
        const result = calculateAdvancedPrediction(dataMd5, 'md5');
        savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, dataMd5[0]);
        recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.allPatterns);
        lastProcessedPhien.md5 = nextPhien;
        
        console.log(`🎯 [MD5] Phiên ${nextPhien}: ${result.prediction} (${result.confidence}%)`);
        console.log(`   📊 Patterns: ${result.allPatterns.slice(0, 3).join(', ')}`);
        console.log(`   🎲 Độ chính xác: ${result.detailedAnalysis.learningStats.accuracy}`);
      }
    }
    
    savePredictionHistory();
    saveLearningData();
    
    console.log('✅ [Auto] Hoàn thành phân tích\n');
  } catch (error) {
    console.error('❌ [Auto] Error:', error.message);
  }
}

function startAutoSaveTask() {
  setTimeout(autoProcessPredictions, 5000);
  setInterval(autoProcessPredictions, AUTO_SAVE_INTERVAL);
}

// ==================== LOAD HISTORICAL PATTERN STATS ====================
function loadHistoricalPatternStats() {
  try {
    if (fs.existsSync('learning_data.json')) {
      const histData = JSON.parse(fs.readFileSync('learning_data.json', 'utf8'));
      for (const type of ['hu', 'md5']) {
        if (histData[type] && histData[type].patternStats) {
          Object.keys(histData[type].patternStats).forEach(pat => {
            learningData[type].patternStats[pat] = histData[type].patternStats[pat];
          });
        }
      }
      console.log('✅ Loaded pattern stats từ learning_data.json');
    }
  } catch (e) { 
    console.error('Error loading historical stats:', e.message); 
  }
}

// ==================== ENDPOINTS ====================
app.get('/', (req, res) => {
  res.json({
    name: 'Tskhang AI - Dự đoán Tài Xỉu Siêu Thông Minh',
    version: '3.0',
    features: [
      'Bám cầu thông minh',
      'Phân tích Fibonacci',
      'Sóng Elliott nâng cao',
      'Machine Learning Ensemble',
      'Markov Chain bậc 3',
      'Tự động cập nhật trọng số'
    ],
    endpoints: {
      '/hu': 'Dự đoán HU',
      '/md5': 'Dự đoán MD5',
      '/hu/lichsu': 'Lịch sử HU',
      '/md5/lichsu': 'Lịch sử MD5',
      '/hu/thamso': 'Tham số HU',
      '/md5/Thamso': 'Tham số MD5',
      '/hu/hochoi': 'Thống kê học HU',
      '/md5/Hochoi': 'Thống kê học MD5',
      '/Resetdata': 'Reset dữ liệu'
    },
    id: '@Tskhang'
  });
});

app.get('/hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu HU' });
    
    await verifyPredictions('hu', data);
    const nextPhien = data[0].Phien + 1;
    const result = calculateAdvancedPrediction(data, 'hu');
    const record = savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.allPatterns);
    
    setTimeout(() => updateHistoryStatus('hu'), 5000);
    res.json({
      ...record,
      analysis: result.detailedAnalysis,
      patterns: result.allPatterns.slice(0, 5)
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/md5', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu MD5' });
    
    await verifyPredictions('md5', data);
    const nextPhien = data[0].Phien + 1;
    const result = calculateAdvancedPrediction(data, 'md5');
    const record = savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.allPatterns);
    
    setTimeout(() => updateHistoryStatus('md5'), 5000);
    res.json({
      ...record,
      analysis: result.detailedAnalysis,
      patterns: result.allPatterns.slice(0, 5)
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/hu/lichsu', async (req, res) => {
  await updateHistoryStatus('hu');
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
    history: predictionHistory.hu,
    total: predictionHistory.hu.length,
    accuracy: calculateAccuracy('hu'),
    id: '@Tskhang'
  });
});

app.get('/md5/lichsu', async (req, res) => {
  await updateHistoryStatus('md5');
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu MD5',
    history: predictionHistory.md5,
    total: predictionHistory.md5.length,
    accuracy: calculateAccuracy('md5'),
    id: '@Tskhang'
  });
});

app.get('/hu/thamso', async (req, res) => {
  const data = await fetchDataHu();
  if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
  const result = calculateAdvancedPrediction(data, 'hu');
  res.json(result);
});

app.get('/md5/Thamso', async (req, res) => {
  const data = await fetchDataMd5();
  if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
  const result = calculateAdvancedPrediction(data, 'md5');
  res.json(result);
});

app.get('/hu/hochoi', (req, res) => {
  const stats = learningData.hu;
  res.json({
    type: 'HU AI Learning',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    accuracy: stats.totalPredictions ? 
      (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) + '%' : '0%',
    streakAnalysis: stats.streakAnalysis,
    cauSuccessRates: stats.cauSuccessRates,
    neuralNetworkWeights: stats.neuralNetworkWeights,
    id: '@Tskhang'
  });
});

app.get('/md5/Hochoi', (req, res) => {
  const stats = learningData.md5;
  res.json({
    type: 'MD5 AI Learning',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    accuracy: stats.totalPredictions ? 
      (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) + '%' : '0%',
    streakAnalysis: stats.streakAnalysis,
    cauSuccessRates: stats.cauSuccessRates,
    neuralNetworkWeights: stats.neuralNetworkWeights,
    id: '@Tskhang'
  });
});

app.get('/Resetdata', (req, res) => {
  learningData = {
    hu: initializeAIModel(),
    md5: initializeAIModel()
  };
  saveLearningData();
  res.json({ message: 'Đã reset toàn bộ AI model', id: '@Tskhang' });
});

// Helper function
function calculateAccuracy(type) {
  const history = predictionHistory[type];
  if (history.length === 0) return '0%';
  const completed = history.filter(h => h.ket_qua_du_doan && h.ket_qua_du_doan !== '');
  if (completed.length === 0) return 'Chưa có dữ liệu';
  const correct = completed.filter(h => h.ket_qua_du_doan.includes('Đúng')).length;
  return ((correct / completed.length) * 100).toFixed(2) + '%';
}

// ==================== KHỞI ĐỘNG ====================
loadHistoricalPatternStats();
loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   🎯 Tskhang AI v3.0 - Siêu Thông Minh  ║');
  console.log('║   🧠 Deep Learning + Bám Cầu + Markov   ║');
  console.log('║   📊 Fibonacci + Elliott + Ensemble      ║');
  console.log(`║   🌐 Server: http://0.0.0.0:${PORT}          ║`);
  console.log('║   📱 Telegram: @Tskhang                 ║');
  console.log('╚══════════════════════════════════════════╝\n');
  
  startAutoSaveTask();
});
