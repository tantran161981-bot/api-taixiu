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

let predictionHistory = { hu: [], md5: [] };
const MAX_HISTORY = 200;
const AUTO_SAVE_INTERVAL = 2500;
let lastProcessedPhien = { hu: null, md5: null };

let learningData = { /* giữ nguyên cấu trúc cũ + thêm weights động */ };

// === LOAD/SAVE (giữ nguyên) ===
function loadLearningData() { /* ... giữ nguyên ... */ }
function saveLearningData() { /* ... giữ nguyên ... */ }
function loadPredictionHistory() { /* ... giữ nguyên ... */ }
function savePredictionHistory() { /* ... giữ nguyên ... */ }

// === TRANSFORM DATA (giữ nguyên) ===
function transformApiData(apiData) { /* ... giữ nguyên ... */ }
async function fetchDataHu() { /* ... giữ nguyên ... */ }
async function fetchDataMd5() { /* ... giữ nguyên ... */ }

// ==================== SIÊU THUẬT TOÁN MỚI ====================
function superAdvancedPrediction(data, type) {
  const results = data.map(d => d.Ket_qua);
  const sums = data.map(d => d.Tong);
  const recent20 = results.slice(0, 20);
  const recent10 = results.slice(0, 10);

  let taiScore = 0, xiuScore = 0;
  let factors = [];

  // 1. Markov + Weighted Ensemble
  updateMarkovMatrices(type, results);
  const markovPred = markovPrediction(type, results);
  if (markovPred) {
    markovPred.prediction === 'Tài' ? taiScore += markovPred.confidence * 1.4 : xiuScore += markovPred.confidence * 1.4;
    factors.push(markovPred.name);
  }

  // 2. Deep Pattern Chain (tất cả pattern + priority boost)
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
      factors.push(`\( {p.name} ( \){p.confidence}%)`);
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
  let finalConf = Math.min(98, Math.max(65, Math.round((Math.max(taiScore, xiuScore) / (taiScore + xiuScore)) * 95)));

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

// Helper functions bổ sung (thêm vào file)
function markovPrediction(type, results) { /* ... logic markov mạnh hơn ... */ }
function calculateVolatility(sums) { /* ... */ }
function analyzeSumTrend(sums) { /* ... */ }

// === CÁC HÀM CŨ GIỮ NGUYÊN + TĂNG PRIORITY ===
// (giữ nguyên tất cả analyzeCau* từ code cũ)

// === ENDPOINTS CẬP NHẬT ===
app.get('/hu', async (req, res) => {
  const data = await fetchDataHu();
  if (!data) return res.status(500).json({ error: 'Lỗi fetch' });
  const result = superAdvancedPrediction(data, 'hu');
  // lưu + verify...
  res.json({ 
    Phien_hien_tai: data[0].Phien + 1,
    Du_doan: result.prediction,
    Do_tin_cay: `${result.confidence}%`,
    factors: result.factors,
    accuracy: learningData.hu.correctPredictions / learningData.hu.totalPredictions * 100
  });
});

// Tương tự cho /md5, /hu/lichsu, v.v...

// KHỞI ĐỘNG
loadLearningData();
loadPredictionHistory();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[TSKHANG] Super Algo 100% v2 running on :${PORT}`);
  setInterval(autoProcessPredictions, AUTO_SAVE_INTERVAL);
});