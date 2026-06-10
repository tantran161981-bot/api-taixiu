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
const PATTERN_FILE = 'Patterns.json';

let predictionHistory = { hu: [], md5: [] };
let patternDatabase = { hu: {}, md5: {} }; // Lưu lịch sử các cầu đã xuất hiện
const MAX_HISTORY = 200;
const AUTO_SAVE_INTERVAL = 3000;
const REQUIRED_PHIENS_BEFORE_PREDICT = 5; // Cần 5 phiên mới bắt đầu dự đoán
let lastProcessedPhien = { hu: null, md5: null };
let phiênCount = { hu: 0, md5: 0 };
let isReadyToPredict = { hu: false, md5: false };

// === CẤU TRÚC LEARNING DATA ===
let learningData = {
  hu: {
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    markovMatrix: { T: { T: 0.5, X: 0.5 }, X: { T: 0.5, X: 0.5 } },
    patternHistory: [], // Lưu các pattern đã xuất hiện
    currentPattern: null, // Pattern đang chạy
    patternConfidence: 0,
    lastResults: [],
    streakAnalysis: { currentStreak: 0, type: null },
    predictions: []
  },
  md5: {
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    markovMatrix: { T: { T: 0.5, X: 0.5 }, X: { T: 0.5, X: 0.5 } },
    patternHistory: [],
    currentPattern: null,
    patternConfidence: 0,
    lastResults: [],
    streakAnalysis: { currentStreak: 0, type: null },
    predictions: []
  }
};

// === LOAD PATTERN DATABASE ===
function loadPatternDatabase() {
  try {
    if (fs.existsSync(PATTERN_FILE)) {
      patternDatabase = JSON.parse(fs.readFileSync(PATTERN_FILE, 'utf8'));
      console.log('✅ Loaded pattern database');
    }
  } catch(e) { console.error('Load pattern error:', e.message); }
}

function savePatternDatabase() {
  try {
    fs.writeFileSync(PATTERN_FILE, JSON.stringify(patternDatabase, null, 2));
  } catch(e) { console.error('Save pattern error:', e.message); }
}

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

// ==================== PHÂN TÍCH CẦU NÂNG CAO ====================

// 1. Phát hiện cầu đang chạy dựa trên lịch sử
function detectCurrentPattern(results) {
  if (results.length < REQUIRED_PHIENS_BEFORE_PREDICT) return null;
  
  const patterns = [];
  
  // Kiểm tra cầu bệt
  let streak = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) streak++;
    else break;
  }
  if (streak >= 3) {
    patterns.push({
      name: `Cầu Bệt ${streak} ${results[0]}`,
      type: 'bệt',
      prediction: results[0],
      confidence: Math.min(90, 65 + streak * 3),
      length: streak
    });
  }
  
  // Kiểm tra cầu 1-1 (đan xen)
  let isAlternating = true;
  for (let i = 1; i < Math.min(results.length, 10); i++) {
    if (results[i] === results[i-1]) {
      isAlternating = false;
      break;
    }
  }
  if (isAlternating && results.length >= 4) {
    patterns.push({
      name: `Cầu 1-1 (${results.length} phiên)`,
      type: 'alternating',
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: 75 + Math.min(10, results.length),
      length: results.length
    });
  }
  
  // Kiểm tra cầu 2-2
  let hasPairPattern = false;
  let pairType = null;
  for (let i = 0; i < results.length - 1; i += 2) {
    if (i + 1 < results.length && results[i] === results[i+1]) {
      if (pairType === null) pairType = results[i];
      else if (results[i] !== pairType) hasPairPattern = true;
    } else {
      hasPairPattern = false;
      break;
    }
  }
  if (hasPairPattern && results.length >= 4) {
    patterns.push({
      name: `Cầu 2-2`,
      type: 'pair',
      prediction: pairType === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: 80,
      length: Math.floor(results.length / 2) * 2
    });
  }
  
  // Kiểm tra cầu 3-3
  let hasTriplePattern = false;
  let tripleType = null;
  for (let i = 0; i < results.length - 2; i += 3) {
    if (i + 2 < results.length && results[i] === results[i+1] && results[i+1] === results[i+2]) {
      if (tripleType === null) tripleType = results[i];
      else if (results[i] !== tripleType) hasTriplePattern = true;
    } else {
      hasTriplePattern = false;
      break;
    }
  }
  if (hasTriplePattern && results.length >= 6) {
    patterns.push({
      name: `Cầu 3-3`,
      type: 'triple',
      prediction: tripleType === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: 85,
      length: Math.floor(results.length / 3) * 3
    });
  }
  
  // Chọn pattern có confidence cao nhất
  if (patterns.length > 0) {
    patterns.sort((a, b) => b.confidence - a.confidence);
    return patterns[0];
  }
  
  // Nếu không có pattern rõ ràng, dựa vào xu hướng
  const taiCount = results.slice(0, Math.min(10, results.length)).filter(r => r === 'Tài').length;
  const total = Math.min(10, results.length);
  if (taiCount >= total - 2) {
    return {
      name: `Xu hướng Tài (${taiCount}/${total})`,
      type: 'trend',
      prediction: 'Xỉu',
      confidence: 65 + taiCount * 2,
      length: total
    };
  }
  if (taiCount <= 2) {
    return {
      name: `Xu hướng Xỉu (${total - taiCount}/${total})`,
      type: 'trend',
      prediction: 'Tài',
      confidence: 65 + (total - taiCount) * 2,
      length: total
    };
  }
  
  return null;
}

// 2. Phân tích cầu nâng cao với nhiều loại cầu hơn
function analyzeAdvancedPatterns(results, type) {
  const patterns = [];
  
  if (results.length < REQUIRED_PHIENS_BEFORE_PREDICT) return patterns;
  
  // Cầu bệt dài
  let streak = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) streak++;
    else break;
  }
  if (streak >= 3) {
    patterns.push({
      name: `🔥 Cầu Bệt ${streak} ${results[0]}`,
      prediction: streak >= 6 ? (results[0] === 'Tài' ? 'Xỉu' : 'Tài') : results[0],
      confidence: Math.min(92, 65 + streak * 4),
      priority: 10
    });
  }
  
  // Cầu đảo 1-1
  let isAlt = true;
  for (let i = 1; i < Math.min(results.length, 12); i++) {
    if (results[i] === results[i-1]) { isAlt = false; break; }
  }
  if (isAlt && results.length >= 4) {
    patterns.push({
      name: `🔄 Cầu 1-1 (${results.length} phiên)`,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: 75 + Math.min(12, results.length),
      priority: 9
    });
  }
  
  // Cầu 2-2
  let valid22 = true;
  let lastPair = null;
  for (let i = 0; i < Math.min(results.length, 8); i += 2) {
    if (i + 1 < results.length && results[i] === results[i+1]) {
      if (lastPair === null) lastPair = results[i];
      else if (results[i] === lastPair) { valid22 = false; break; }
      else lastPair = results[i];
    } else { valid22 = false; break; }
  }
  if (valid22 && results.length >= 4) {
    patterns.push({
      name: `📊 Cầu 2-2`,
      prediction: lastPair === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: 82,
      priority: 8
    });
  }
  
  // Cầu 3-3
  let valid33 = true;
  let lastTriple = null;
  for (let i = 0; i < Math.min(results.length, 9); i += 3) {
    if (i + 2 < results.length && results[i] === results[i+1] && results[i+1] === results[i+2]) {
      if (lastTriple === null) lastTriple = results[i];
      else if (results[i] === lastTriple) { valid33 = false; break; }
      else lastTriple = results[i];
    } else { valid33 = false; break; }
  }
  if (valid33 && results.length >= 6) {
    patterns.push({
      name: `🎲 Cầu 3-3`,
      prediction: lastTriple === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: 85,
      priority: 8
    });
  }
  
  // Cầu 1-2-1
  if (results.length >= 4 && results[0] !== results[1] && results[1] === results[2] && results[2] !== results[3] && results[0] === results[3]) {
    patterns.push({
      name: `📈 Cầu 1-2-1`,
      prediction: results[0],
      confidence: 78,
      priority: 7
    });
  }
  
  // Cầu 1-2-3
  if (results.length >= 6 && results[0] === results[1] && results[1] === results[2] && results[3] === results[4] && results[2] !== results[3]) {
    patterns.push({
      name: `📉 Cầu 1-2-3`,
      prediction: results[3],
      confidence: 80,
      priority: 7
    });
  }
  
  // Cầu nhảy cóc
  let hopPattern = [];
  for (let i = 0; i < Math.min(results.length, 10); i += 2) hopPattern.push(results[i]);
  if (hopPattern.length >= 3) {
    const allSame = hopPattern.every(r => r === hopPattern[0]);
    if (allSame) {
      patterns.push({
        name: `🐸 Cầu Nhảy Cóc (${hopPattern[0]})`,
        prediction: hopPattern[0],
        confidence: 72,
        priority: 6
      });
    }
  }
  
  return patterns;
}

// 3. Phân tích điểm số (Tổng)
function analyzeSumPattern(sums) {
  if (sums.length < 5) return null;
  
  const recent = sums.slice(0, 5);
  const avgRecent = recent.reduce((a, b) => a + b, 0) / 5;
  
  // Tổng tăng dần
  let isIncreasing = true;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i] <= recent[i-1]) { isIncreasing = false; break; }
  }
  if (isIncreasing) return { prediction: 'Xỉu', confidence: 70, name: '📈 Tổng tăng dần → Xỉu' };
  
  // Tổng giảm dần
  let isDecreasing = true;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i] >= recent[i-1]) { isDecreasing = false; break; }
  }
  if (isDecreasing) return { prediction: 'Tài', confidence: 70, name: '📉 Tổng giảm dần → Tài' };
  
  // Tổng quanh vùng trung bình
  if (avgRecent >= 9 && avgRecent <= 11) return { prediction: 'Xỉu', confidence: 65, name: '⚖️ Tổng trung bình → Xỉu' };
  if (avgRecent >= 12) return { prediction: 'Xỉu', confidence: 68, name: '🔴 Tổng cao → Xỉu' };
  if (avgRecent <= 8) return { prediction: 'Tài', confidence: 68, name: '🔵 Tổng thấp → Tài' };
  
  return null;
}

// 4. Học từ lịch sử pattern
function learnFromHistory(results, type) {
  if (results.length < 10) return null;
  
  // Tạo key từ 3-4 kết quả gần nhất
  const key = results.slice(0, 4).join('');
  const patternHistory = patternDatabase[type][key] || { next: {}, total: 0 };
  
  // Cập nhật database
  if (results.length > 4 && results[4]) {
    patternHistory.next[results[4]] = (patternHistory.next[results[4]] || 0) + 1;
    patternHistory.total++;
    patternDatabase[type][key] = patternHistory;
    savePatternDatabase();
  }
  
  // Dự đoán dựa trên lịch sử
  if (patternHistory.total >= 3) {
    const nextTai = patternHistory.next['Tài'] || 0;
    const nextXiu = patternHistory.next['Xỉu'] || 0;
    const total = nextTai + nextXiu;
    if (total >= 3) {
      const taiProb = nextTai / total;
      if (taiProb >= 0.7) return { prediction: 'Tài', confidence: 70 + taiProb * 15, name: '📚 Học từ lịch sử → Tài' };
      if (taiProb <= 0.3) return { prediction: 'Xỉu', confidence: 70 + (1 - taiProb) * 15, name: '📚 Học từ lịch sử → Xỉu' };
    }
  }
  
  return null;
}

// 5. Markov Chain nâng cao
function advancedMarkovPrediction(type, results) {
  if (results.length < 3) return null;
  
  // Cập nhật ma trận Markov
  for (let i = 0; i < results.length - 1; i++) {
    const current = results[i] === 'Tài' ? 'T' : 'X';
    const next = results[i+1] === 'Tài' ? 'T' : 'X';
    learningData[type].markovMatrix[current][next] = 
      (learningData[type].markovMatrix[current][next] || 0.5) * 0.95 + 0.05;
  }
  
  // Dự đoán dựa trên 2 bước gần nhất
  const last2 = results.slice(0, 2);
  let confidence = 65;
  
  // Bước 1
  const step1 = last2[0] === 'Tài' ? 'T' : 'X';
  const step1Prob = learningData[type].markovMatrix[step1];
  let pred1 = step1Prob.T >= step1Prob.X ? 'Tài' : 'Xỉu';
  let conf1 = Math.max(step1Prob.T, step1Prob.X) * 100;
  
  // Bước 2 (nếu có)
  if (results.length >= 2 && learningData[type].markov2Matrix) {
    const key = (last2[1] === 'Tài' ? 'T' : 'X') + (last2[0] === 'Tài' ? 'T' : 'X');
    const prob2 = learningData[type].markov2Matrix[key];
    if (prob2) {
      const pred2 = (prob2.T || 0) >= (prob2.X || 0) ? 'Tài' : 'Xỉu';
      const conf2 = Math.max(prob2.T || 0, prob2.X || 0) * 100;
      if (pred1 === pred2) {
        confidence = Math.min(90, (conf1 + conf2) / 2);
        return { prediction: pred1, confidence, name: '🎯 Markov kép' };
      }
    }
  }
  
  return { prediction: pred1, confidence: Math.min(85, conf1), name: '🎲 Markov bậc 1' };
}

// ==================== DỰ ĐOÁN CHÍNH (CÓ CHỜ 5 PHIÊN) ====================
function superAdvancedPrediction(data, type) {
  const results = data.map(d => d.Ket_qua);
  const sums = data.map(d => d.Tong);
  
  // CẬP NHẬT SỐ PHIÊN ĐÃ XEM
  phiênCount[type] = results.length;
  
  // KIỂM TRA: CHƯA ĐỦ 5 PHIÊN -> CHƯA DỰ ĐOÁN
  if (phiênCount[type] < REQUIRED_PHIENS_BEFORE_PREDICT) {
    isReadyToPredict[type] = false;
    return {
      prediction: null,
      confidence: 0,
      factors: [`⏳ Đang phân tích cầu... Cần ${REQUIRED_PHIENS_BEFORE_PREDICT - phiênCount[type]} phiên nữa`],
      detailed: { status: 'waiting', needed: REQUIRED_PHIENS_BEFORE_PREDICT - phiênCount[type] },
      isReady: false
    };
  }
  
  isReadyToPredict[type] = true;
  
  let taiScore = 0, xiuScore = 0;
  let factors = [];
  let allPredictions = [];
  
  // 1. Phát hiện cầu đang chạy (ưu tiên cao nhất)
  const currentPattern = detectCurrentPattern(results);
  if (currentPattern) {
    learningData[type].currentPattern = currentPattern;
    const weight = 1.5; // Trọng số cao cho pattern đang chạy
    if (currentPattern.prediction === 'Tài') taiScore += currentPattern.confidence * weight;
    else xiuScore += currentPattern.confidence * weight;
    factors.push(`🎯 ${currentPattern.name} (ĐỘ TIN CẬY: ${currentPattern.confidence}%)`);
    allPredictions.push(currentPattern);
  }
  
  // 2. Phân tích cầu nâng cao
  const advancedPatterns = analyzeAdvancedPatterns(results, type);
  for (const p of advancedPatterns) {
    if (p.prediction === 'Tài') taiScore += p.confidence * (p.priority / 10);
    else xiuScore += p.confidence * (p.priority / 10);
    factors.push(`${p.name} (${p.confidence}%)`);
    allPredictions.push(p);
  }
  
  // 3. Phân tích tổng điểm
  const sumPattern = analyzeSumPattern(sums);
  if (sumPattern) {
    if (sumPattern.prediction === 'Tài') taiScore += sumPattern.confidence;
    else xiuScore += sumPattern.confidence;
    factors.push(sumPattern.name);
    allPredictions.push(sumPattern);
  }
  
  // 4. Học từ lịch sử
  const historyPattern = learnFromHistory(results, type);
  if (historyPattern) {
    if (historyPattern.prediction === 'Tài') taiScore += historyPattern.confidence * 1.2;
    else xiuScore += historyPattern.confidence * 1.2;
    factors.push(historyPattern.name);
    allPredictions.push(historyPattern);
  }
  
  // 5. Markov Chain
  const markovPred = advancedMarkovPrediction(type, results);
  if (markovPred) {
    if (markovPred.prediction === 'Tài') taiScore += markovPred.confidence * 1.3;
    else xiuScore += markovPred.confidence * 1.3;
    factors.push(`${markovPred.name} (${markovPred.confidence}%)`);
    allPredictions.push(markovPred);
  }
  
  // 6. Reversal (bẻ cầu) - chỉ khi cầu đã dài
  const streak = learningData[type].streakAnalysis.currentStreak;
  if (Math.abs(streak) >= 5) {
    const reversalPred = streak > 0 ? 'Xỉu' : 'Tài';
    const reversalConf = 75 + Math.min(15, Math.abs(streak));
    if (reversalPred === 'Tài') taiScore += reversalConf;
    else xiuScore += reversalConf;
    factors.push(`🔄 BẺ CẦU SAU ${Math.abs(streak)} PHIÊN (${reversalConf}%)`);
  }
  
  // QUYẾT ĐỊNH CUỐI CÙNG
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  let totalScore = taiScore + xiuScore;
  let finalConf = totalScore > 0 ? Math.min(96, Math.max(68, Math.round((Math.max(taiScore, xiuScore) / totalScore) * 95))) : 65;
  
  // Ghi nhận pattern đang chạy
  learningData[type].patternHistory.unshift({
    pattern: learningData[type].currentPattern,
    timestamp: new Date().toISOString(),
    prediction: finalPrediction
  });
  if (learningData[type].patternHistory.length > 50) learningData[type].patternHistory.pop();
  
  return {
    prediction: finalPrediction,
    confidence: finalConf,
    factors: factors.slice(0, 10),
    currentPattern: learningData[type].currentPattern?.name || 'Đang phân tích...',
    patternConfidence: learningData[type].currentPattern?.confidence || 0,
    detailed: {
      taiScore: Math.round(taiScore),
      xiuScore: Math.round(xiuScore),
      totalPatterns: allPredictions.length,
      phiênDaPhânTích: phiênCount[type]
    },
    isReady: true
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
        learningData[type].streakAnalysis.type = 'win';
      } else {
        learningData[type].streakAnalysis.currentStreak = Math.min(-1, (learningData[type].streakAnalysis.currentStreak || 0) - 1);
        learningData[type].streakAnalysis.type = 'loss';
      }
      updated = true;
    }
  }
  if (updated) saveLearningData();
}

function recordPrediction(type, phien, prediction, confidence, patterns, currentPattern) {
  if (!learningData[type].predictions) learningData[type].predictions = [];
  learningData[type].predictions.unshift({
    phien: phien.toString(),
    prediction, confidence, patterns, currentPattern,
    timestamp: new Date().toISOString(),
    verified: false, actual: null, isCorrect: null
  });
  learningData[type].totalPredictions = (learningData[type].totalPredictions || 0) + 1;
  if (learningData[type].predictions.length > 500) learningData[type].predictions.pop();
  saveLearningData();
}

function savePredictionToHistory(type, phien, prediction, confidence, latestData, currentPattern) {
  const record = {
    Phien: latestData.Phien,
    Xuc_xac_1: latestData.Xuc_xac_1,
    Xuc_xac_2: latestData.Xuc_xac_2,
    Xuc_xac_3: latestData.Xuc_xac_3,
    Tong: latestData.Tong,
    Ket_qua: latestData.Ket_qua,
    Do_tin_cay: `${confidence}%`,
    Phien_hien_tai: phien.toString(),
    Du_doan: prediction || 'Đang phân tích cầu...',
    Current_Pattern: currentPattern || 'Chờ đủ dữ liệu',
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
        const record = savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, dataHu[0], result.currentPattern);
        if (result.isReady) {
          recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors, result.currentPattern);
        }
        lastProcessedPhien.hu = nextPhien;
        if (result.isReady) {
          console.log(`[Auto] Hu phiên ${nextPhien}: ${result.prediction} (${result.confidence}%) - ${result.currentPattern}`);
        } else {
          console.log(`[Auto] Hu: ${result.factors[0]}`);
        }
      }
    }
    
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      const nextPhien = dataMd5[0].Phien + 1;
      if (lastProcessedPhien.md5 !== nextPhien) {
        await verifyPredictions('md5', dataMd5);
        const result = superAdvancedPrediction(dataMd5, 'md5');
        const record = savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, dataMd5[0], result.currentPattern);
        if (result.isReady) {
          recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors, result.currentPattern);
        }
        lastProcessedPhien.md5 = nextPhien;
        if (result.isReady) {
          console.log(`[Auto] MD5 phiên ${nextPhien}: ${result.prediction} (${result.confidence}%) - ${result.currentPattern}`);
        } else {
          console.log(`[Auto] MD5: ${result.factors[0]}`);
        }
      }
    }
    savePredictionHistory();
    saveLearningData();
  } catch (error) {
    console.error('[Auto] Error:', error.message);
  }
}

// ==================== ENDPOINTS ====================
app.get('/', (req, res) => res.send('t.me/Tskhang - Advanced Pattern Analysis'));

app.get('/hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    await verifyPredictions('hu', data);
    const result = superAdvancedPrediction(data, 'hu');
    const record = savePredictionToHistory('hu', data[0].Phien + 1, result.prediction, result.confidence, data[0], result.currentPattern);
    if (result.isReady) {
      recordPrediction('hu', data[0].Phien + 1, result.prediction, result.confidence, result.factors, result.currentPattern);
    }
    res.json({
      ...record,
      current_pattern: result.currentPattern,
      pattern_confidence: result.patternConfidence,
      analysis: result.detailed,
      is_ready: result.isReady,
      required_phiens: REQUIRED_PHIENS_BEFORE_PREDICT,
      current_phiens: phiênCount.hu
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/md5', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    await verifyPredictions('md5', data);
    const result = superAdvancedPrediction(data, 'md5');
    const record = savePredictionToHistory('md5', data[0].Phien + 1, result.prediction, result.confidence, data[0], result.currentPattern);
    if (result.isReady) {
      recordPrediction('md5', data[0].Phien + 1, result.prediction, result.confidence, result.factors, result.currentPattern);
    }
    res.json({
      ...record,
      current_pattern: result.currentPattern,
      pattern_confidence: result.patternConfidence,
      analysis: result.detailed,
      is_ready: result.isReady,
      required_phiens: REQUIRED_PHIENS_BEFORE_PREDICT,
      current_phiens: phiênCount.md5
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/hu/lichsu', async (req, res) => {
  res.json({ 
    type: 'Lẩu Cua 79 - Tài Xỉu Hũ (Advanced)', 
    history: predictionHistory.hu, 
    total: predictionHistory.hu.length,
    current_pattern: learningData.hu.currentPattern,
    pattern_history: learningData.hu.patternHistory?.slice(0, 20),
    id: '@Tskhang' 
  });
});

app.get('/md5/lichsu', async (req, res) => {
  res.json({ 
    type: 'Lẩu Cua 79 - Tài Xỉu MD5 (Advanced)', 
    history: predictionHistory.md5, 
    total: predictionHistory.md5.length,
    current_pattern: learningData.md5.currentPattern,
    pattern_history: learningData.md5.patternHistory?.slice(0, 20),
    id: '@Tskhang' 
  });
});

app.get('/hu/status', (req, res) => {
  res.json({
    type: 'HU',
    is_ready: isReadyToPredict.hu,
    phiên_da_phan_tich: phiênCount.hu,
    required_phiens: REQUIRED_PHIENS_BEFORE_PREDICT,
    current_pattern: learningData.hu.currentPattern,
    streak: learningData.hu.streakAnalysis
  });
});

app.get('/md5/status', (req, res) => {
  res.json({
    type: 'MD5',
    is_ready: isReadyToPredict.md5,
    phiên_da_phan_tich: phiênCount.md5,
    required_phiens: REQUIRED_PHIENS_BEFORE_PREDICT,
    current_pattern: learningData.md5.currentPattern,
    streak: learningData.md5.streakAnalysis
  });
});

app.get('/Resetdata', (req, res) => {
  learningData = {
    hu: { totalPredictions: 0, correctPredictions: 0, patternWeights: {}, markovMatrix: { T: { T: 0.5, X: 0.5 }, X: { T: 0.5, X: 0.5 } }, patternHistory: [], currentPattern: null, patternConfidence: 0, lastResults: [], streakAnalysis: { currentStreak: 0, type: null }, predictions: [] },
    md5: { totalPredictions: 0, correctPredictions: 0, patternWeights: {}, markovMatrix: { T: { T: 0.5, X: 0.5 }, X: { T: 0.5, X: 0.5 } }, patternHistory: [], currentPattern: null, patternConfidence: 0, lastResults: [], streakAnalysis: { currentStreak: 0, type: null }, predictions: [] }
  };
  phiênCount = { hu: 0, md5: 0 };
  isReadyToPredict = { hu: false, md5: false };
  saveLearningData();
  res.json({ message: 'Learning data reset', id: '@Tskhang' });
});

// KHỞI ĐỘNG
loadPatternDatabase();
loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[TSKHANG] Advanced Pattern Analysis v3 running on port ${PORT}`);
  console.log(`📊 Cần ${REQUIRED_PHIENS_BEFORE_PREDICT} phiên để phân tích cầu trước khi dự đoán`);
  setInterval(autoProcessPredictions, AUTO_SAVE_INTERVAL);
});
