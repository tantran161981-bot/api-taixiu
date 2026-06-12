const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'anhquan.json';
const HISTORY_FILE = 'anhquan1.json';

let predictionHistory = { hu: [], md5: [] };
const MAX_HISTORY = 200;
const AUTO_SAVE_INTERVAL = 30000;
let lastProcessedPhien = { hu: null, md5: null };

let learningData = {
  hu: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: {}, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [] },
  md5: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: {}, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [] }
};

// ==================== BỘ NHỚ CẦU ====================
let cauMemory = {
  lastPattern: null,
  patternStart: 0,
  currentTrend: null,
  trendStrength: 0
};

// ==================== THUẬT TOÁN BÁM CẦU ====================

// 1. PHÁT HIỆN XU HƯỚNG CHÍNH (QUAN TRỌNG NHẤT)
function detectMainTrend(results) {
  if (results.length < 10) return { trend: null, strength: 0 };
  
  const last10 = results.slice(0, 10);
  const taiCount = last10.filter(r => r === 'Tài').length;
  const xiuCount = 10 - taiCount;
  
  if (taiCount >= 7) return { trend: 'Tài', strength: taiCount / 10 };
  if (xiuCount >= 7) return { trend: 'Xỉu', strength: xiuCount / 10 };
  if (taiCount >= 6) return { trend: 'Tài', strength: 0.6 };
  if (xiuCount >= 6) return { trend: 'Xỉu', strength: 0.6 };
  
  return { trend: null, strength: 0 };
}

// 2. PHÁT HIỆN CẦU BỆT (THEO XU HƯỚNG)
function detectStreakPattern(results) {
  if (results.length < 2) return null;
  
  let streak = 1;
  let streakType = results[0];
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) streak++;
    else break;
  }
  
  if (streak >= 2) {
    let confidence = 60 + Math.min(streak, 10) * 2;
    let prediction = streakType; // THEO CẦU, KHÔNG BẺ VỘI
    
    // CHỈ BẺ KHI BỆT QUÁ DÀI (>=6)
    if (streak >= 6) {
      prediction = streakType === 'Tài' ? 'Xỉu' : 'Tài';
      confidence = 75 + (streak - 6) * 3;
    }
    
    return {
      prediction: prediction,
      confidence: Math.min(90, confidence),
      name: `🔥 Cầu bệt ${streak}p`,
      priority: 10,
      type: 'streak'
    };
  }
  return null;
}

// 3. PHÁT HIỆN CẦU 1-1 (XEN KẼ)
function detectAlternatingPattern(results) {
  if (results.length < 4) return null;
  
  let altLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] !== results[i-1]) altLength++;
    else break;
  }
  
  if (altLength >= 3) {
    let prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    let confidence = 65 + Math.min(altLength, 10) * 2;
    
    // 1-1 DÀI THÌ TIẾP TỤC ĐẢO
    if (altLength >= 5) {
      prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
      confidence = 75 + (altLength - 5) * 2;
    }
    
    return {
      prediction: prediction,
      confidence: Math.min(88, confidence),
      name: `🔄 Cầu 1-1 (${altLength}p)`,
      priority: 9,
      type: 'alternating'
    };
  }
  return null;
}

// 4. PHÁT HIỆN CẦU 2-2
function detectDoublePattern(results) {
  if (results.length < 6) return null;
  
  let pairs = [];
  for (let i = 0; i < results.length - 1; i += 2) {
    if (results[i] === results[i+1]) {
      pairs.push(results[i]);
    } else break;
  }
  
  if (pairs.length >= 2) {
    let isAlternating = true;
    for (let i = 1; i < pairs.length; i++) {
      if (pairs[i] === pairs[i-1]) isAlternating = false;
    }
    
    if (isAlternating) {
      let prediction = pairs[pairs.length-1] === 'Tài' ? 'Xỉu' : 'Tài';
      let confidence = 68 + pairs.length * 3;
      return {
        prediction: prediction,
        confidence: Math.min(85, confidence),
        name: `📊 Cầu 2-2 (${pairs.length} cặp)`,
        priority: 8,
        type: 'double'
      };
    }
  }
  return null;
}

// 5. PHÁT HIỆN CẦU 3-3
function detectTriplePattern(results) {
  if (results.length < 9) return null;
  
  let triples = [];
  for (let i = 0; i < results.length - 2; i += 3) {
    if (results[i] === results[i+1] && results[i+1] === results[i+2]) {
      triples.push(results[i]);
    } else break;
  }
  
  if (triples.length >= 2) {
    let isAlternating = triples[0] !== triples[1];
    if (isAlternating) {
      let prediction = triples[triples.length-1] === 'Tài' ? 'Xỉu' : 'Tài';
      let confidence = 70 + triples.length * 4;
      return {
        prediction: prediction,
        confidence: Math.min(87, confidence),
        name: `🎲 Cầu 3-3 (${triples.length} bộ)`,
        priority: 8,
        type: 'triple'
      };
    }
  }
  return null;
}

// 6. PHÁT HIỆN CẦU 1-2-1
function detect121Pattern(results) {
  if (results.length < 4) return null;
  const a = results[0], b = results[1], c = results[2], d = results[3];
  if (a !== b && b === c && c !== d && a === d) {
    return {
      prediction: a,
      confidence: 72,
      name: `✨ Cầu 1-2-1`,
      priority: 7,
      type: '121'
    };
  }
  return null;
}

// 7. PHÁT HIỆN CẦU 1-2-3
function detect123Pattern(results) {
  if (results.length < 6) return null;
  const a = results[0], b = results[1], c = results[2];
  const d = results[3], e = results[4], f = results[5];
  
  if (a === b && b === c && d === e && a !== d && d !== f) {
    return {
      prediction: f,
      confidence: 74,
      name: `🎯 Cầu 1-2-3`,
      priority: 7,
      type: '123'
    };
  }
  return null;
}

// 8. PHÁT HIỆN CẦU 3-2-1
function detect321Pattern(results) {
  if (results.length < 6) return null;
  const a = results[0], b = results[1], c = results[2];
  const d = results[3], e = results[4];
  
  if (a === b && b === c && d === e && a !== d) {
    return {
      prediction: d,
      confidence: 74,
      name: `🏆 Cầu 3-2-1`,
      priority: 7,
      type: '321'
    };
  }
  return null;
}

// 9. PHÂN TÍCH TỔNG ĐIỂM
function detectSumTrend(data) {
  if (data.length < 8) return null;
  
  const sums = data.slice(0, 8).map(d => d.Tong);
  let trend = 0;
  for (let i = 0; i < sums.length - 1; i++) {
    trend += sums[i] - sums[i+1];
  }
  
  if (trend > 4) {
    return { prediction: 'Xỉu', confidence: 70, name: `📉 Tổng giảm → Xỉu`, priority: 6 };
  }
  if (trend < -4) {
    return { prediction: 'Tài', confidence: 70, name: `📈 Tổng tăng → Tài`, priority: 6 };
  }
  
  const avgSum = sums.reduce((a,b) => a+b, 0) / 8;
  if (avgSum > 11.5) return { prediction: 'Xỉu', confidence: 68, name: `📊 Tổng cao (${avgSum.toFixed(1)}) → Xỉu`, priority: 6 };
  if (avgSum < 9.5) return { prediction: 'Tài', confidence: 68, name: `📊 Tổng thấp (${avgSum.toFixed(1)}) → Tài`, priority: 6 };
  
  return null;
}

// 10. ĐIỀU CHỈNH THEO LỊCH SỬ THẮNG THUA
function adjustByWinLoss(type, prediction, confidence) {
  const streak = learningData[type].streakAnalysis.currentStreak;
  
  // Thua 2 phiên liên tiếp -> chống đảo
  if (streak <= -2) {
    let adjustedPred = prediction === 'Tài' ? 'Xỉu' : 'Tài';
    let adjustedConf = Math.min(85, confidence + 8);
    return { prediction: adjustedPred, confidence: adjustedConf, adjusted: true };
  }
  
  // Thắng 2 phiên liên tiếp -> tự tin hơn
  if (streak >= 2) {
    let adjustedConf = Math.min(90, confidence + 5);
    return { prediction: prediction, confidence: adjustedConf, adjusted: true };
  }
  
  return { prediction, confidence, adjusted: false };
}

// ==================== TỔNG HỢP DỰ ĐOÁN ====================
function calculatePrediction(data, type) {
  const results = data.map(d => d.Ket_qua);
  
  // Lấy tất cả dự đoán từ các pattern
  let predictions = [];
  
  // Xu hướng chính (ưu tiên cao nhất)
  const mainTrend = detectMainTrend(results);
  if (mainTrend.trend) {
    predictions.push({
      prediction: mainTrend.trend,
      confidence: 65 + mainTrend.strength * 20,
      name: `📈 Xu hướng chính: ${mainTrend.trend}`,
      priority: 12
    });
  }
  
  // Các pattern cầu
  const patterns = [
    detectStreakPattern(results),
    detectAlternatingPattern(results),
    detectDoublePattern(results),
    detectTriplePattern(results),
    detect121Pattern(results),
    detect123Pattern(results),
    detect321Pattern(results),
    detectSumTrend(data)
  ];
  
  for (let p of patterns) {
    if (p) {
      predictions.push(p);
    }
  }
  
  // Nếu không có pattern nào, dùng kết quả phiên trước (theo cầu đơn giản)
  if (predictions.length === 0 && results.length > 0) {
    predictions.push({
      prediction: results[0],
      confidence: 60,
      name: `📋 Theo kết quả trước`,
      priority: 5
    });
  }
  
  // Tính điểm Tài/Xỉu (có trọng số)
  let taiScore = 0, xiuScore = 0;
  for (const p of predictions) {
    const priorityWeight = (p.priority || 5) / 5;
    const confidenceWeight = p.confidence / 100;
    const totalWeight = priorityWeight * confidenceWeight;
    
    if (p.prediction === 'Tài') taiScore += totalWeight;
    else xiuScore += totalWeight;
  }
  
  // Xác định dự đoán cuối
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  let finalConfidence = 60 + Math.abs(taiScore - xiuScore) * 15;
  
  // Điều chỉnh theo lịch sử thắng/thua
  const adjusted = adjustByWinLoss(type, finalPrediction, finalConfidence);
  finalPrediction = adjusted.prediction;
  finalConfidence = Math.min(92, Math.max(60, adjusted.confidence));
  
  // Lấy top patterns để hiển thị
  const topPatterns = predictions.sort((a,b) => b.priority - a.priority).slice(0, 3);
  
  return {
    prediction: finalPrediction,
    confidence: Math.round(finalConfidence),
    factors: topPatterns.map(p => p.name),
    allPatterns: predictions.map(p => p.name).slice(0, 5),
    detailedAnalysis: {
      totalPatterns: predictions.length,
      taiScore: Math.round(taiScore * 100),
      xiuScore: Math.round(xiuScore * 100),
      topPattern: topPatterns[0]?.name || 'N/A'
    }
  };
}

// ==================== HÀM LOAD/SAVE ====================
function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = fs.readFileSync(LEARNING_FILE, 'utf8');
      const parsed = JSON.parse(data);
      for (let type of ['hu', 'md5']) {
        if (parsed[type]) {
          learningData[type] = { ...learningData[type], ...parsed[type] };
        }
      }
      console.log('✅ Đã tải dữ liệu học');
    }
  } catch (error) {
    console.error('Lỗi tải:', error.message);
  }
}

function saveLearningData() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch (error) {
    console.error('Lỗi lưu:', error.message);
  }
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(data);
      predictionHistory = parsed.history || { hu: [], md5: [] };
      lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
      console.log('✅ Đã tải lịch sử');
    }
  } catch (error) {
    console.error('Lỗi tải lịch sử:', error.message);
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
    console.error('Lỗi lưu lịch sử:', error.message);
  }
}

// ==================== API FUNCTIONS ====================
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
        learningData[type].streakAnalysis.currentStreak = Math.max(1, (learningData[type].streakAnalysis.currentStreak || 0) + 1);
        learningData[type].streakAnalysis.wins++;
        if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
          learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
        }
      } else {
        learningData[type].streakAnalysis.currentStreak = Math.min(-1, (learningData[type].streakAnalysis.currentStreak || 0) - 1);
        learningData[type].streakAnalysis.losses++;
        if (learningData[type].streakAnalysis.currentStreak < learningData[type].streakAnalysis.worstStreak) {
          learningData[type].streakAnalysis.worstStreak = learningData[type].streakAnalysis.currentStreak;
        }
      }
      
      learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 100) learningData[type].recentAccuracy.shift();
      updated = true;
    }
  }
  if (updated) saveLearningData();
}

function recordPrediction(type, phien, prediction, confidence, patterns) {
  learningData[type].predictions.unshift({
    phien: phien.toString(),
    prediction, confidence, patterns,
    timestamp: new Date().toISOString(),
    verified: false, actual: null, isCorrect: null
  });
  learningData[type].totalPredictions++;
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
    id: '@anhquan',
    timestamp: new Date().toISOString()
  };
  predictionHistory[type].unshift(record);
  if (predictionHistory[type].length > MAX_HISTORY) predictionHistory[type].pop();
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

async function autoProcessPredictions() {
  try {
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      const nextPhien = dataHu[0].Phien + 1;
      if (lastProcessedPhien.hu !== nextPhien) {
        await verifyPredictions('hu', dataHu);
        const result = calculatePrediction(dataHu, 'hu');
        savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, dataHu[0]);
        recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.hu = nextPhien;
        console.log(`[Auto] Hu ${nextPhien}: ${result.prediction} (${result.confidence}%) | Các cầu: ${result.factors.slice(0,2).join(', ')}`);
      }
    }
    
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      const nextPhien = dataMd5[0].Phien + 1;
      if (lastProcessedPhien.md5 !== nextPhien) {
        await verifyPredictions('md5', dataMd5);
        const result = calculatePrediction(dataMd5, 'md5');
        savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, dataMd5[0]);
        recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.md5 = nextPhien;
        console.log(`[Auto] MD5 ${nextPhien}: ${result.prediction} (${result.confidence}%) | Các cầu: ${result.factors.slice(0,2).join(', ')}`);
      }
    }
    
    savePredictionHistory();
    saveLearningData();
  } catch (error) {
    console.error('[Auto] Lỗi:', error.message);
  }
}

function startAutoSaveTask() {
  setTimeout(autoProcessPredictions, 5000);
  setInterval(autoProcessPredictions, AUTO_SAVE_INTERVAL);
}

// ==================== ENDPOINTS ====================
app.get('/', (req, res) => res.send('t.me/anhquan'));

app.get('/hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    await verifyPredictions('hu', data);
    const nextPhien = data[0].Phien + 1;
    const result = calculatePrediction(data, 'hu');
    const record = savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
    setTimeout(() => updateHistoryStatus('hu'), 5000);
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
    const result = calculatePrediction(data, 'md5');
    const record = savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
    setTimeout(() => updateHistoryStatus('md5'), 5000);
    res.json(record);
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/hu/lichsu', async (req, res) => {
  await updateHistoryStatus('hu');
  res.json({ type: 'Tài Xỉu Hũ', history: predictionHistory.hu, total: predictionHistory.hu.length, id: '@anhquan' });
});

app.get('/md5/lichsu', async (req, res) => {
  await updateHistoryStatus('md5');
  res.json({ type: 'Tài Xỉu MD5', history: predictionHistory.md5, total: predictionHistory.md5.length, id: '@anhquan' });
});

app.get('/hu/phantich', async (req, res) => {
  const data = await fetchDataHu();
  if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
  const result = calculatePrediction(data, 'hu');
  res.json({ prediction: result.prediction, confidence: result.confidence, factors: result.factors, analysis: result.detailedAnalysis });
});

app.get('/md5/phantich', async (req, res) => {
  const data = await fetchDataMd5();
  if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
  const result = calculatePrediction(data, 'md5');
  res.json({ prediction: result.prediction, confidence: result.confidence, factors: result.factors, analysis: result.detailedAnalysis });
});

app.get('/hu/stat', (req, res) => {
  const stats = learningData.hu;
  const acc = stats.totalPredictions ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(1) : 0;
  res.json({ total: stats.totalPredictions, correct: stats.correctPredictions, accuracy: acc + '%', streak: stats.streakAnalysis.currentStreak });
});

app.get('/md5/stat', (req, res) => {
  const stats = learningData.md5;
  const acc = stats.totalPredictions ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(1) : 0;
  res.json({ total: stats.totalPredictions, correct: stats.correctPredictions, accuracy: acc + '%', streak: stats.streakAnalysis.currentStreak });
});

app.get('/reset', (req, res) => {
  learningData = {
    hu: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: {}, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [] },
    md5: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: {}, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [] }
  };
  saveLearningData();
  res.json({ message: 'Đã reset dữ liệu học' });
});

// ==================== KHỞI ĐỘNG ====================
loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔════════════════════════════════════════════════╗`);
  console.log(`║   🚀 API TÀI XỈU @ANHQUAN - BÁM CẦU TỐT   ║`);
  console.log(`║   📡 Port: ${PORT}                              ║`);
  console.log(`╚════════════════════════════════════════════════╝\n`);
  console.log(`✅ THUẬT TOÁN BÁM CẦU:`);
  console.log(`   🔥 Cầu bệt - THEO cho đến khi dài (>=6 mới bẻ)`);
  console.log(`   🔄 Cầu 1-1 - ĐẢO LIÊN TỤC`);
  console.log(`   📊 Cầu 2-2 - ĐẢO SAU MỖI CẶP`);
  console.log(`   🎲 Cầu 3-3 - ĐẢO SAU MỖI BỘ BA`);
  console.log(`   📈 Xu hướng chính - ƯU TIÊN CAO NHẤT`);
  console.log(`\n📊 Endpoints:`);
  console.log(`   GET /hu          - Dự đoán Hũ`);
  console.log(`   GET /md5         - Dự đoán MD5`);
  console.log(`   GET /hu/lichsu   - Lịch sử Hũ`);
  console.log(`   GET /md5/lichsu  - Lịch sử MD5`);
  console.log(`   GET /hu/stat     - Thống kê Hũ`);
  console.log(`   GET /md5/stat    - Thống kê MD5\n`);
  
  startAutoSaveTask();
});
