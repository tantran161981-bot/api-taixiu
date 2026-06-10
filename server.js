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

// === CẤU TRÚC LEARNING DATA ===
let learningData = {
  hu: {
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    markovMatrix: { T: { T: 0.5, X: 0.5 }, X: { T: 0.5, X: 0.5 } },
    lastResults: [],
    streakAnalysis: { currentStreak: 0 },
    predictions: []
  },
  md5: {
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    markovMatrix: { T: { T: 0.5, X: 0.5 }, X: { T: 0.5, X: 0.5 } },
    lastResults: [],
    streakAnalysis: { currentStreak: 0 },
    predictions: []
  }
};

// === LOAD/SAVE ===
function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'));
      for (let type of ['hu', 'md5']) {
        if (data[type]) {
          learningData[type] = { ...learningData[type], ...data[type] };
        }
      }
      console.log('✅ Loaded learning data');
    }
  } catch(e) { console.error('Load error:', e.message); }
}

function saveLearningData() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch(e) { console.error('Save error:', e.message); }
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      predictionHistory = data.history || { hu: [], md5: [] };
      lastProcessedPhien = data.lastProcessedPhien || { hu: null, md5: null };
      console.log('✅ Loaded history');
    }
  } catch(e) { console.error('Load history error:', e.message); }
}

function savePredictionHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      history: predictionHistory,
      lastProcessedPhien
    }, null, 2));
  } catch(e) { console.error('Save history error:', e.message); }
}

// === TRANSFORM API DATA ===
function transformApiData(apiData) {
  if (!apiData || !apiData.list || !Array.isArray(apiData.list)) return null;
  return apiData.list.map(item => ({
    Phien: item.id,
    Ket_qua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
    Xuc_xac_1: item.dices?.[0] || 0,
    Xuc_xac_2: item.dices?.[1] || 0,
    Xuc_xac_3: item.dices?.[2] || 0,
    Tong: item.point || 0
  }));
}

async function fetchDataHu() {
  try {
    const response = await axios.get(API_URL_HU, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    console.error('HU fetch error:', error.message);
    return null;
  }
}

async function fetchDataMd5() {
  try {
    const response = await axios.get(API_URL_MD5, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    console.error('MD5 fetch error:', error.message);
    return null;
  }
}

// ==================== HELPER FUNCTIONS ====================
function getPatternIdFromName(name) {
  const map = {
    'Cầu Bệt': 'cauBet', 'Cầu Đảo 1-1': 'cauDao11', 'Cầu 2-2': 'cau22',
    'Cầu 3-3': 'cau33', 'Cầu 1-2-1': 'cau121', 'Cầu 1-2-3': 'cau123',
    'Cầu 3-2-1': 'cau321', 'Cầu Nhảy Cóc': 'cauNhayCoc',
    'Cầu Nhịp Nghiêng': 'cauNhipNghieng', 'Cầu 3 Ván 1': 'cau3Van1',
    'Smart Bet': 'smartBet', 'Break Streak': 'breakStreak',
    'Triple Pattern': 'triplePattern', 'Tổng Phân Tích': 'tongPhanTich',
    'Xu Hướng Mạnh': 'xuHuongManh', 'Đảo Chiều': 'daoChieu'
  };
  for (const [key, val] of Object.entries(map)) {
    if (name.includes(key)) return val;
  }
  return name;
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
  return Math.round((diffSum / Math.min(9, sums.length - 1)) * 10) / 10;
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

// ==================== CÁC HÀM PHÂN TÍCH CẦU ====================
function analyzeCauBet(results, type) {
  if (results.length < 3) return { detected: false };
  let streak = 1;
  for (let i = 1; i < Math.min(10, results.length); i++) {
    if (results[i] === results[0]) streak++;
    else break;
  }
  if (streak >= 3) {
    let shouldBreak = streak >= 5;
    return {
      detected: true,
      prediction: shouldBreak ? (results[0] === 'Tài' ? 'Xỉu' : 'Tài') : results[0],
      confidence: streak >= 7 ? 85 : (streak >= 5 ? 75 : 68),
      name: 'Cầu Bệt',
      priority: 9
    };
  }
  return { detected: false };
}

function analyzeCauDao11(results, type) {
  if (results.length < 4) return { detected: false };
  let altLen = 1;
  for (let i = 1; i < Math.min(results.length, 10); i++) {
    if (results[i] !== results[i-1]) altLen++;
    else break;
  }
  if (altLen >= 4) {
    return {
      detected: true,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.min(80, 65 + altLen * 2),
      name: 'Cầu Đảo 1-1',
      priority: 8
    };
  }
  return { detected: false };
}

function analyzeCau22(results, type) {
  if (results.length < 6) return { detected: false };
  let pairs = 0, i = 0, pattern = [];
  while (i < results.length - 1 && pairs < 4) {
    if (results[i] === results[i+1]) {
      pattern.push(results[i]);
      pairs++;
      i += 2;
    } else break;
  }
  if (pairs >= 2) {
    let alternating = true;
    for (let j = 1; j < pattern.length; j++) {
      if (pattern[j] === pattern[j-1]) alternating = false;
    }
    if (alternating) {
      return {
        detected: true,
        prediction: pattern[pattern.length-1] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.min(78, 65 + pairs * 3),
        name: 'Cầu 2-2',
        priority: 7
      };
    }
  }
  return { detected: false };
}

function analyzeCau33(results, type) {
  if (results.length < 6) return { detected: false };
  let triples = 0, i = 0, pattern = [];
  while (i < results.length - 2 && triples < 3) {
    if (results[i] === results[i+1] && results[i+1] === results[i+2]) {
      pattern.push(results[i]);
      triples++;
      i += 3;
    } else break;
  }
  if (triples >= 1) {
    const pos = results.length % 3;
    const last = pattern[pattern.length-1];
    let prediction = pos === 0 ? (last === 'Tài' ? 'Xỉu' : 'Tài') : last;
    return {
      detected: true,
      prediction: prediction,
      confidence: Math.min(80, 68 + triples * 4),
      name: 'Cầu 3-3',
      priority: 7
    };
  }
  return { detected: false };
}

function analyzeCau121(results, type) {
  if (results.length < 4) return { detected: false };
  const p = results.slice(0, 4);
  if (p[0] !== p[1] && p[1] === p[2] && p[2] !== p[3] && p[0] === p[3]) {
    return { detected: true, prediction: p[0], confidence: 72, name: 'Cầu 1-2-1', priority: 6 };
  }
  return { detected: false };
}

function analyzeCau123(results, type) {
  if (results.length < 6) return { detected: false };
  const first = results[5], nextTwo = results.slice(3, 5), lastThree = results.slice(0, 3);
  if (nextTwo[0] === nextTwo[1] && nextTwo[0] !== first) {
    const allSame = lastThree.every(r => r === lastThree[0]);
    if (allSame && lastThree[0] !== nextTwo[0]) {
      return { detected: true, prediction: first, confidence: 74, name: 'Cầu 1-2-3', priority: 6 };
    }
  }
  return { detected: false };
}

function analyzeCau321(results, type) {
  if (results.length < 6) return { detected: false };
  const first3 = results.slice(3, 6), next2 = results.slice(1, 3), last1 = results[0];
  const first3Same = first3.every(r => r === first3[0]);
  const next2Same = next2.every(r => r === next2[0]);
  if (first3Same && next2Same && first3[0] !== next2[0] && last1 !== next2[0]) {
    return { detected: true, prediction: next2[0], confidence: 76, name: 'Cầu 3-2-1', priority: 6 };
  }
  return { detected: false };
}

function analyzeCauNhayCoc(results, type) {
  if (results.length < 6) return { detected: false };
  const skip = [];
  for (let i = 0; i < Math.min(results.length, 12); i += 2) skip.push(results[i]);
  if (skip.length >= 3) {
    const allSame = skip.slice(0, 3).every(r => r === skip[0]);
    if (allSame) return { detected: true, prediction: skip[0], confidence: 68, name: 'Cầu Nhảy Cóc', priority: 5 };
    let alt = true;
    for (let i = 1; i < skip.length - 1; i++) if (skip[i] === skip[i-1]) alt = false;
    if (alt && skip.length >= 3) {
      return { detected: true, prediction: skip[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 66, name: 'Cầu Nhảy Cóc Đảo', priority: 5 };
    }
  }
  return { detected: false };
}

function analyzeCauNhipNghieng(results, type) {
  if (results.length < 5) return { detected: false };
  const last5 = results.slice(0, 5);
  const taiCount = last5.filter(r => r === 'Tài').length;
  if (taiCount >= 4) return { detected: true, prediction: 'Tài', confidence: 70, name: 'Cầu Nhịp Nghiêng', priority: 5 };
  if (taiCount <= 1) return { detected: true, prediction: 'Xỉu', confidence: 70, name: 'Cầu Nhịp Nghiêng', priority: 5 };
  return { detected: false };
}

function analyzeCau3Van1(results, type) {
  if (results.length < 4) return { detected: false };
  const last4 = results.slice(0, 4);
  const taiCount = last4.filter(r => r === 'Tài').length;
  if (taiCount === 3) return { detected: true, prediction: 'Xỉu', confidence: 68, name: 'Cầu 3 Ván 1', priority: 5 };
  if (taiCount === 1) return { detected: true, prediction: 'Tài', confidence: 68, name: 'Cầu 3 Ván 1', priority: 5 };
  return { detected: false };
}

function analyzeSmartBet(results, type) {
  if (results.length < 10) return { detected: false };
  const last5 = results.slice(0, 5), prev5 = results.slice(5, 10);
  const taiLast5 = last5.filter(r => r === 'Tài').length;
  const taiPrev5 = prev5.filter(r => r === 'Tài').length;
  const trendChange = (taiLast5 >= 4 && taiPrev5 <= 1) || (taiLast5 <= 1 && taiPrev5 >= 4);
  if (trendChange) {
    const dominant = taiLast5 >= 4 ? 'Tài' : 'Xỉu';
    return { detected: true, prediction: dominant === 'Tài' ? 'Xỉu' : 'Tài', confidence: 78, name: 'Smart Bet', priority: 8 };
  }
  const taiLast10 = results.slice(0, 10).filter(r => r === 'Tài').length;
  if (taiLast10 >= 8 || taiLast10 <= 2) {
    const dominant = taiLast10 >= 8 ? 'Tài' : 'Xỉu';
    return { detected: true, prediction: dominant === 'Tài' ? 'Xỉu' : 'Tài', confidence: 82, name: 'Smart Bet', priority: 8 };
  }
  return { detected: false };
}

function analyzeBreakStreak(results, type) {
  if (results.length < 5) return { detected: false };
  let streak = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) streak++;
    else break;
  }
  if (streak >= 5) {
    return {
      detected: true,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.min(85, 70 + streak),
      name: 'Break Streak',
      priority: 10
    };
  }
  return { detected: false };
}

function analyzeTriplePattern(results, type) {
  if (results.length < 9) return { detected: false };
  const t1 = results[0] === results[1] && results[1] === results[2];
  const t2 = results[3] === results[4] && results[4] === results[5];
  const t3 = results[6] === results[7] && results[7] === results[8];
  if (t1 && t2 && t3) {
    if (results[0] === results[3] && results[3] === results[6]) {
      return { detected: true, prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 88, name: 'Triple Pattern', priority: 10 };
    }
    if (results[0] !== results[3] && results[3] !== results[6]) {
      return { detected: true, prediction: results[0], confidence: 80, name: 'Triple Pattern', priority: 10 };
    }
  }
  return { detected: false };
}

function analyzeTongPhanTich(results, type) {
  return { detected: false };
}

function analyzeXuHuongManh(results, type) {
  if (results.length < 8) return { detected: false };
  const taiCount = results.slice(0, 8).filter(r => r === 'Tài').length;
  if (taiCount >= 6) return { detected: true, prediction: 'Xỉu', confidence: 80, name: 'Xu Hướng Mạnh', priority: 11 };
  if (taiCount <= 2) return { detected: true, prediction: 'Tài', confidence: 80, name: 'Xu Hướng Mạnh', priority: 11 };
  return { detected: false };
}

function analyzeDaoChieu(results, type) {
  if (results.length < 5) return { detected: false };
  let alt = true;
  for (let i = 0; i < 4; i++) if (results[i] === results[i+1]) { alt = false; break; }
  if (alt) {
    return { detected: true, prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 75, name: 'Đảo Chiều', priority: 10 };
  }
  return { detected: false };
}

function analyzeSupportResistance(results, type) {
  return { detected: false };
}

// ==================== SUPER ADVANCED PREDICTION ====================
function superAdvancedPrediction(data, type) {
  const results = data.map(d => d.Ket_qua);
  const sums = data.map(d => d.Tong);

  let taiScore = 0, xiuScore = 0;
  let factors = [];

  // 1. Markov + Weighted Ensemble
  updateMarkovMatrices(type, results);
  const markovPred = markovPrediction(type, results);
  if (markovPred) {
    markovPred.prediction === 'Tài' ? taiScore += markovPred.confidence * 1.4 : xiuScore += markovPred.confidence * 1.4;
    factors.push(`${markovPred.name} (${markovPred.confidence}%)`);
  }

  // 2. Deep Pattern Chain
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

  // 3. Self-Learning Reversal + Volatility + Sum Trend
  const volatility = calculateVolatility(sums);
  const sumTrend = analyzeSumTrend(sums);
  if (sumTrend) {
    sumTrend.prediction === 'Tài' ? taiScore += sumTrend.confidence * 1.3 : xiuScore += sumTrend.confidence * 1.3;
    factors.push(sumTrend.name);
  }

  // 4. Final Ensemble + Confidence Calibration
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  let finalConf = Math.min(98, Math.max(65, Math.round((Math.max(taiScore, xiuScore) / (taiScore + xiuScore + 0.01)) * 95)));

  // Auto adjust reversal
  if (learningData[type].streakAnalysis.currentStreak <= -4) {
    finalPrediction = finalPrediction === 'Tài' ? 'Xỉu' : 'Tài';
    finalConf = Math.min(96, finalConf + 8);
    factors.push('🔥 REVERSAL OVERRIDE');
  }

  return {
    prediction: finalPrediction,
    confidence: finalConf,
    factors: factors.slice(0, 10),
    detailed: { taiScore: Math.round(taiScore), xiuScore: Math.round(xiuScore), volatility }
  };
}

// === VERIFY & RECORD ===
async function verifyPredictions(type, currentData) {
  let updated = false;
  for (let pred of learningData[type].predictions || []) {
    if (pred.verified) continue;
    const actual = currentData.find(d => d.Phien.toString() === pred.phien);
    if (actual) {
      pred.verified = true;
      pred.actual = actual.Ket_qua;
      pred.isCorrect = (pred.prediction === pred.actual);
      if (pred.isCorrect) {
        learningData[type].correctPredictions++;
        learningData[type].streakAnalysis.currentStreak = Math.max(1, (learningData[type].streakAnalysis.currentStreak || 0) + 1);
      } else {
        learningData[type].streakAnalysis.currentStreak = Math.min(-1, (learningData[type].streakAnalysis.currentStreak || 0) - 1);
      }
      updated = true;
    }
  }
  if (updated) saveLearningData();
}

function recordPrediction(type, phien, prediction, confidence, patterns) {
  if (!learningData[type].predictions) learningData[type].predictions = [];
  learningData[type].predictions.unshift({
    phien: phien.toString(),
    prediction, confidence, patterns,
    timestamp: new Date().toISOString(),
    verified: false, actual: null, isCorrect: null
  });
  learningData[type].totalPredictions = (learningData[type].totalPredictions || 0) + 1;
  if (learningData[type].predictions.length > 500) learningData[type].predictions.pop();
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
  if (predictionHistory[type].length > MAX_HISTORY) predictionHistory[type].pop();
  savePredictionHistory();
  return record;
}

async function autoProcessPredictions() {
  try {
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      const nextPhien = dataHu[0].Phien + 1;
      if (lastProcessedPhien.hu !== nextPhien) {
        await verifyPredictions('hu', dataHu);
        const result = superAdvancedPrediction(dataHu, 'hu');
        savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, dataHu[0]);
        recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.hu = nextPhien;
        console.log(`[Auto] Hu phiên ${nextPhien}: ${result.prediction} (${result.confidence}%)`);
      }
    }
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      const nextPhien = dataMd5[0].Phien + 1;
      if (lastProcessedPhien.md5 !== nextPhien) {
        await verifyPredictions('md5', dataMd5);
        const result = superAdvancedPrediction(dataMd5, 'md5');
        savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, dataMd5[0]);
        recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.md5 = nextPhien;
        console.log(`[Auto] MD5 phiên ${nextPhien}: ${result.prediction} (${result.confidence}%)`);
      }
    }
    savePredictionHistory();
    saveLearningData();
  } catch (error) {
    console.error('[Auto] Error:', error.message);
  }
}

// ==================== ENDPOINTS ====================
app.get('/', (req, res) => res.send('t.me/Tskhang'));

app.get('/hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    await verifyPredictions('hu', data);
    const nextPhien = data[0].Phien + 1;
    const result = superAdvancedPrediction(data, 'hu');
    const record = savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
    res.json(record);
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/md5', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    await verifyPredictions('md5', data);
    const nextPhien = data[0].Phien + 1;
    const result = superAdvancedPrediction(data, 'md5');
    const record = savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
    res.json(record);
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/hu/lichsu', async (req, res) => {
  res.json({ type: 'Lẩu Cua 79 - Tài Xỉu Hũ', history: predictionHistory.hu, total: predictionHistory.hu.length, id: '@Tskhang' });
});

app.get('/md5/lichsu', async (req, res) => {
  res.json({ type: 'Lẩu Cua 79 - Tài Xỉu MD5', history: predictionHistory.md5, total: predictionHistory.md5.length, id: '@Tskhang' });
});

app.get('/hu/thamso', async (req, res) => {
  const data = await fetchDataHu();
  if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
  const result = superAdvancedPrediction(data, 'hu');
  res.json({ prediction: result.prediction, confidence: result.confidence, factors: result.factors, detailed: result.detailed });
});

app.get('/md5/Thamso', async (req, res) => {
  const data = await fetchDataMd5();
  if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
  const result = superAdvancedPrediction(data, 'md5');
  res.json({ prediction: result.prediction, confidence: result.confidence, factors: result.factors, detailed: result.detailed });
});

app.get('/hu/hochoi', (req, res) => {
  const stats = learningData.hu;
  const acc = stats.totalPredictions ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  res.json({ type: 'HU Learning', totalPredictions: stats.totalPredictions, correctPredictions: stats.correctPredictions, accuracy: acc + '%', streakAnalysis: stats.streakAnalysis, id: '@Tskhang' });
});

app.get('/md5/Hochoi', (req, res) => {
  const stats = learningData.md5;
  const acc = stats.totalPredictions ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  res.json({ type: 'MD5 Learning', totalPredictions: stats.totalPredictions, correctPredictions: stats.correctPredictions, accuracy: acc + '%', streakAnalysis: stats.streakAnalysis, id: '@Tskhang' });
});

app.get('/Resetdata', (req, res) => {
  learningData = {
    hu: { totalPredictions: 0, correctPredictions: 0, patternWeights: {}, markovMatrix: { T: { T: 0.5, X: 0.5 }, X: { T: 0.5, X: 0.5 } }, lastResults: [], streakAnalysis: { currentStreak: 0 }, predictions: [] },
    md5: { totalPredictions: 0, correctPredictions: 0, patternWeights: {}, markovMatrix: { T: { T: 0.5, X: 0.5 }, X: { T: 0.5, X: 0.5 } }, lastResults: [], streakAnalysis: { currentStreak: 0 }, predictions: [] }
  };
  saveLearningData();
  res.json({ message: 'Learning data reset', id: '@Tskhang' });
});

// ==================== KHỞI ĐỘNG ====================
loadLearningData();
loadPredictionHistory();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[TSKHANG] Super Algo 100% v2 running on port ${PORT}`);
  setInterval(autoProcessPredictions, AUTO_SAVE_INTERVAL);
});
