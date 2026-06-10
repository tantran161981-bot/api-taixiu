const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'Tskhang.json';
const HISTORY_FILE = 'Tskhang1.json';

let predictionHistory = { hu: [], md5: [] };
const MAX_HISTORY = 200;
const AUTO_SAVE_INTERVAL = 2500;
let lastProcessedPhien = { hu: null, md5: null };

let learningData = { 
  hu: { 
    totalPredictions: 0, 
    correctPredictions: 0, 
    patternWeights: {},
    markovMatrix: { T: { T: 0.5, X: 0.5 }, X: { T: 0.5, X: 0.5 } },
    lastResults: [],
    streakAnalysis: { currentStreak: 0 }
  },
  md5: { 
    totalPredictions: 0, 
    correctPredictions: 0, 
    patternWeights: {},
    markovMatrix: { T: { T: 0.5, X: 0.5 }, X: { T: 0.5, X: 0.5 } },
    lastResults: [],
    streakAnalysis: { currentStreak: 0 }
  }
};

function getPatternIdFromName(name) {
  const patternMap = {
    'Cầu Bệt': 'cauBet',
    'Cầu 1-1': 'cauDao11',
    'Cầu 2-2': 'cau22',
    'Cầu 3-3': 'cau33',
    'Cầu 1-2-1': 'cau121',
    'Cầu 1-2-3': 'cau123',
    'Cầu 3-2-1': 'cau321',
    'Cầu Nhảy Cóc': 'cauNhayCoc',
    'Cầu Nhip Nghiêng': 'cauNhipNghieng',
    'Cầu 3 Ván 1': 'cau3Van1',
    'Smart Bet': 'smartBet',
    'Break Streak': 'breakStreak',
    'Triple Pattern': 'triplePattern',
    'Tổng Phân Tích': 'tongPhanTich',
    'Xu Hướng Mạnh': 'xuHuongManh',
    'Đảo Chiều': 'daoChieu',
    'Support Resistance': 'supportResistance'
  };
  return patternMap[name] || name;
}

function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'));
      learningData = data;
    }
  } catch(e) {}
}

function saveLearningData() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch(e) {}
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      predictionHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
  } catch(e) {}
}

function savePredictionHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(predictionHistory, null, 2));
  } catch(e) {}
}

function transformApiData(apiData) {
  if (!apiData || !apiData.data) return [];
  return apiData.data.map(item => ({
    Phien: item.phien,
    Ket_qua: item.ket_qua === 'Tài' ? 'Tài' : 'Xỉu',
    Tong: parseInt(item.tong) || 0
  }));
}

async function fetchDataHu() {
  try {
    const response = await axios.post(API_URL_HU, {}, {
      headers: { 'Content-Type': 'application/json' }
    });
    return transformApiData(response.data);
  } catch(e) {
    return null;
  }
}

async function fetchDataMd5() {
  try {
    const response = await axios.post(API_URL_MD5, {}, {
      headers: { 'Content-Type': 'application/json' }
    });
    return transformApiData(response.data);
  } catch(e) {
    return null;
  }
}

function updateMarkovMatrices(type, results) {
  if (results.length < 2) return;
  for (let i = 0; i < results.length - 1; i++) {
    const current = results[i] === 'Tài' ? 'T' : 'X';
    const next = results[i+1] === 'Tài' ? 'T' : 'X';
    learningData[type].markovMatrix[current][next] = 
      (learningData[type].markovMatrix[current][next] || 0.5) * 0.9 + 0.1;
  }
}

function markovPrediction(type, results) {
  if (results.length === 0) return null;
  const last = results[0] === 'Tài' ? 'T' : 'X';
  const probs = learningData[type].markovMatrix[last];
  const prediction = probs.T >= probs.X ? 'Tài' : 'Xỉu';
  const confidence = Math.round(Math.max(probs.T, probs.X) * 95);
  return { prediction, confidence, name: 'Markov Chain' };
}

function calculateVolatility(sums) {
  if (sums.length < 5) return 0;
  let diffSum = 0;
  for (let i = 1; i < Math.min(10, sums.length); i++) {
    diffSum += Math.abs(sums[i] - sums[i-1]);
  }
  return diffSum / Math.min(9, sums.length - 1);
}

function analyzeSumTrend(sums) {
  if (sums.length < 10) return null;
  const recentAvg = sums.slice(0, 5).reduce((a,b) => a+b, 0) / 5;
  const olderAvg = sums.slice(5, 10).reduce((a,b) => a+b, 0) / 5;
  if (recentAvg > olderAvg + 2.5) {
    return { prediction: 'Tài', confidence: 75, name: 'Tổng Tăng' };
  } else if (recentAvg < olderAvg - 2.5) {
    return { prediction: 'Xỉu', confidence: 75, name: 'Tổng Giảm' };
  }
  return null;
}

function analyzeCauBet(results, type) {
  if (results.length < 4) return null;
  let streak = 1;
  for (let i = 1; i < Math.min(10, results.length); i++) {
    if (results[i] === results[0]) streak++;
    else break;
  }
  if (streak >= 3) {
    return { detected: true, prediction: results[0], confidence: 70 + streak, name: 'Cầu Bệt', priority: 8 };
  }
  return null;
}

function analyzeCauDao11(results, type) {
  if (results.length < 6) return null;
  let isPattern = true;
  for (let i = 0; i < 5; i++) {
    if (i % 2 === 0 && results[i] !== results[0]) isPattern = false;
    if (i % 2 === 1 && results[i] === results[0]) isPattern = false;
  }
  if (isPattern) {
    const next = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return { detected: true, prediction: next, confidence: 85, name: 'Cầu 1-1', priority: 9 };
  }
  return null;
}

function analyzeCau22(results, type) {
  if (results.length < 8) return null;
  if (results[0] === results[1] && results[2] === results[3] && results[4] === results[5] && results[6] === results[7]) {
    const next = results[7] === 'Tài' ? 'Tài' : 'Xỉu';
    return { detected: true, prediction: next, confidence: 80, name: 'Cầu 2-2', priority: 8 };
  }
  return null;
}

function analyzeCau33(results, type) {
  if (results.length < 9) return null;
  if (results[0] === results[1] && results[1] === results[2] &&
      results[3] === results[4] && results[4] === results[5] &&
      results[6] === results[7] && results[7] === results[8]) {
    const next = results[8] === 'Tài' ? 'Xỉu' : 'Tài';
    return { detected: true, prediction: next, confidence: 85, name: 'Cầu 3-3', priority: 9 };
  }
  return null;
}

function analyzeCau121(results, type) {
  if (results.length < 6) return null;
  if (results[0] === results[2] && results[2] === results[4] && results[0] !== results[1]) {
    const next = results[0];
    return { detected: true, prediction: next, confidence: 82, name: 'Cầu 1-2-1', priority: 8 };
  }
  return null;
}

function analyzeCau123(results, type) {
  if (results.length < 6) return null;
  if (results[0] !== results[1] && results[1] === results[2] && results[2] !== results[3]) {
    const next = results[3] === 'Tài' ? 'Xỉu' : 'Tài';
    return { detected: true, prediction: next, confidence: 75, name: 'Cầu 1-2-3', priority: 7 };
  }
  return null;
}

function analyzeCau321(results, type) {
  if (results.length < 6) return null;
  if (results[0] === results[1] && results[2] !== results[1] && results[3] === results[4]) {
    const next = results[4] === 'Tài' ? 'Xỉu' : 'Tài';
    return { detected: true, prediction: next, confidence: 75, name: 'Cầu 3-2-1', priority: 7 };
  }
  return null;
}

function analyzeCauNhayCoc(results, type) {
  if (results.length < 6) return null;
  let pattern = [];
  for (let i = 0; i < 5; i++) pattern.push(results[i] === results[i+1] ? 'dup' : 'alt');
  if (pattern.filter(p => p === 'alt').length >= 3) {
    const next = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return { detected: true, prediction: next, confidence: 70, name: 'Cầu Nhảy Cóc', priority: 6 };
  }
  return null;
}

function analyzeCauNhipNghieng(results, type) {
  if (results.length < 10) return null;
  const taiCount = results.slice(0, 8).filter(r => r === 'Tài').length;
  if (taiCount >= 5) {
    return { detected: true, prediction: 'Xỉu', confidence: 72, name: 'Cầu Nhip Nghiêng', priority: 7 };
  } else if (taiCount <= 3) {
    return { detected: true, prediction: 'Tài', confidence: 72, name: 'Cầu Nhip Nghiêng', priority: 7 };
  }
  return null;
}

function analyzeCau3Van1(results, type) {
  if (results.length < 4) return null;
  if (results[0] !== results[1] && results[1] !== results[2] && results[0] !== results[2]) {
    const next = results[2] === 'Tài' ? 'Xỉu' : 'Tài';
    return { detected: true, prediction: next, confidence: 78, name: 'Cầu 3 Ván 1', priority: 7 };
  }
  return null;
}

function analyzeSmartBet(results, type) {
  if (results.length < 12) return null;
  const recent = results.slice(0, 6);
  const older = results.slice(6, 12);
  const recentTai = recent.filter(r => r === 'Tài').length;
  const olderTai = older.filter(r => r === 'Tài').length;
  if (Math.abs(recentTai - olderTai) >= 3) {
    const next = recentTai > olderTai ? 'Xỉu' : 'Tài';
    return { detected: true, prediction: next, confidence: 80, name: 'Smart Bet', priority: 8 };
  }
  return null;
}

function analyzeBreakStreak(results, type) {
  if (results.length < 3) return null;
  let streak = 1;
  for (let i = 1; i < Math.min(5, results.length); i++) {
    if (results[i] === results[0]) streak++;
    else break;
  }
  if (streak >= 3) {
    const next = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return { detected: true, prediction: next, confidence: 75 + streak, name: 'Break Streak', priority: 7 };
  }
  return null;
}

function analyzeTriplePattern(results, type) {
  if (results.length < 6) return null;
  for (let i = 0; i < 3; i++) {
    if (results[i] === results[i+3] && results[i+1] === results[i+4]) {
      const next = results[2] === 'Tài' ? 'Tài' : 'Xỉu';
      return { detected: true, prediction: next, confidence: 80, name: 'Triple Pattern', priority: 8 };
    }
  }
  return null;
}

function analyzeTongPhanTich(results, type) {
  return null;
}

function analyzeXuHuongManh(results, type) {
  if (results.length < 15) return null;
  const taiCount = results.slice(0, 10).filter(r => r === 'Tài').length;
  if (taiCount >= 7) {
    return { detected: true, prediction: 'Xỉu', confidence: 68, name: 'Xu Hướng Mạnh', priority: 6 };
  } else if (taiCount <= 3) {
    return { detected: true, prediction: 'Tài', confidence: 68, name: 'Xu Hướng Mạnh', priority: 6 };
  }
  return null;
}

function analyzeDaoChieu(results, type) {
  if (results.length < 4) return null;
  let changes = 0;
  for (let i = 1; i < 4; i++) {
    if (results[i] !== results[i-1]) changes++;
  }
  if (changes === 3) {
    const next = results[3];
    return { detected: true, prediction: next, confidence: 85, name: 'Đảo Chiều', priority: 9 };
  }
  return null;
}

function analyzeSupportResistance(results, type) {
  if (results.length < 12) return null;
  const positions = [];
  for (let i = 1; i < 10; i++) {
    if (results[i] !== results[i-1]) positions.push(i);
  }
  if (positions.length >= 4) {
    const next = results[positions[positions.length-1]] === 'Tài' ? 'Xỉu' : 'Tài';
    return { detected: true, prediction: next, confidence: 74, name: 'Support Resistance', priority: 7 };
  }
  return null;
}

function superAdvancedPrediction(data, type) {
  const results = data.map(d => d.Ket_qua);
  const sums = data.map(d => d.Tong);
  
  let taiScore = 0, xiuScore = 0;
  let factors = [];

  updateMarkovMatrices(type, results);
  const markovPred = markovPrediction(type, results);
  if (markovPred) {
    markovPred.prediction === 'Tài' ? taiScore += markovPred.confidence * 1.4 : xiuScore += markovPred.confidence * 1.4;
    factors.push(`${markovPred.name} (${markovPred.confidence}%)`);
  }

  const patterns = [
    analyzeCauBet, analyzeCauDao11, analyzeCau22, analyzeCau33,
    analyzeCau121, analyzeCau123, analyzeCau321, analyzeCauNhayCoc,
    analyzeCauNhipNghieng, analyzeCau3Van1, analyzeSmartBet,
    analyzeBreakStreak, analyzeTriplePattern, analyzeTongPhanTich,
    analyzeXuHuongManh, analyzeDaoChieu, analyzeSupportResistance
  ];

  patterns.forEach(fn => {
    const p = fn(results, type);
    if (p && p.detected) {
      const weight = learningData[type].patternWeights[getPatternIdFromName(p.name)] || 1.0;
      const boostedConf = p.confidence * weight * (p.priority || 5) / 5;
      if (p.prediction === 'Tài') taiScore += boostedConf;
      else xiuScore += boostedConf;
      factors.push(`${p.name} (${p.confidence}%)`);
    }
  });

  const volatility = calculateVolatility(sums);
  const sumTrend = analyzeSumTrend(sums);
  if (sumTrend) {
    sumTrend.prediction === 'Tài' ? taiScore += sumTrend.confidence * 1.3 : xiuScore += sumTrend.confidence * 1.3;
    factors.push(sumTrend.name);
  }

  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  let finalConf = Math.min(98, Math.max(65, Math.round((Math.max(taiScore, xiuScore) / (taiScore + xiuScore + 0.01)) * 95)));

  if (learningData[type].streakAnalysis.currentStreak <= -4) {
    finalPrediction = finalPrediction === 'Tài' ? 'Xỉu' : 'Tài';
    finalConf = Math.min(96, finalConf + 8);
    factors.push('🔥 REVERSAL OVERRIDE');
  }

  return {
    prediction: finalPrediction,
    confidence: finalConf,
    factors: factors.slice(0, 10),
    detailed: { taiScore: Math.round(taiScore), xiuScore: Math.round(xiuScore), volatility: Math.round(volatility * 10) / 10 }
  };
}

async function autoProcessPredictions() {
  // Auto process logic nếu cần
}

app.get('/hu', async (req, res) => {
  const data = await fetchDataHu();
  if (!data || data.length === 0) return res.status(500).json({ error: 'Lỗi fetch dữ liệu' });
  const result = superAdvancedPrediction(data, 'hu');
  res.json({ 
    Phien_hien_tai: data[0].Phien + 1,
    Du_doan: result.prediction,
    Do_tin_cay: `${result.confidence}%`,
    factors: result.factors,
    accuracy: learningData.hu.totalPredictions > 0 ? 
      Math.round(learningData.hu.correctPredictions / learningData.hu.totalPredictions * 100) : 0
  });
});

app.get('/md5', async (req, res) => {
  const data = await fetchDataMd5();
  if (!data || data.length === 0) return res.status(500).json({ error: 'Lỗi fetch dữ liệu' });
  const result = superAdvancedPrediction(data, 'md5');
  res.json({ 
    Phien_hien_tai: data[0].Phien + 1,
    Du_doan: result.prediction,
    Do_tin_cay: `${result.confidence}%`,
    factors: result.factors,
    accuracy: learningData.md5.totalPredictions > 0 ? 
      Math.round(learningData.md5.correctPredictions / learningData.md5.totalPredictions * 100) : 0
  });
});

app.get('/hu/lichsu', (req, res) => {
  res.json(predictionHistory.hu.slice(0, 50));
});

app.get('/md5/lichsu', (req, res) => {
  res.json(predictionHistory.md5.slice(0, 50));
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[TSKHANG] Super Algo 100% v2 running on port ${PORT}`);
  setInterval(autoProcessPredictions, AUTO_SAVE_INTERVAL);
});
