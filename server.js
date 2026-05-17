const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

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
    mlModel: { weights: {}, bias: 0, lastTraining: null }
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
    mlModel: { weights: {}, bias: 0, lastTraining: null }
  }
};

const DEFAULT_PATTERN_WEIGHTS = {
  'cau_bet': 1.2, 'cau_dao_11': 1.1, 'cau_22': 1.0, 'cau_33': 1.0,
  'cau_121': 1.0, 'cau_123': 1.0, 'cau_321': 1.0, 'cau_nhay_coc': 0.9,
  'cau_nhip_nghieng': 1.0, 'cau_3van1': 1.0, 'cau_be_cau': 1.1,
  'cau_chu_ky': 1.0, 'distribution': 1.0, 'dice_pattern': 1.0,
  'sum_trend': 1.0, 'edge_cases': 1.0, 'momentum': 1.0, 'cau_tu_nhien': 0.8,
  'dice_trend_line': 1.0, 'dice_trend_line_md5': 1.0, 'break_pattern_hu': 1.0,
  'break_pattern_md5': 1.0, 'fibonacci': 1.1, 'resistance_support': 1.0,
  'wave': 1.0, 'golden_ratio': 1.1, 'day_gay': 1.0, 'day_gay_md5': 1.0,
  'cau_44': 1.0, 'cau_55': 1.0, 'cau_212': 1.0, 'cau_1221': 1.0,
  'cau_2112': 1.0, 'cau_gap': 1.0, 'cau_ziczac': 1.0, 'cau_doi': 1.0,
  'cau_rong': 1.2, 'smart_bet': 1.1, 'break_pattern_advanced': 1.0,
  'break_streak': 1.1, 'alternating_break': 1.0, 'double_pair_break': 1.0,
  'triple_pattern': 1.0, 'tong_phan_tich': 1.5, 'xu_huong_manh': 1.4,
  'dao_chieu': 1.4, 'lstm_pattern': 1.3, 'markov_chain': 1.2,
  'neural_boost': 1.3, 'sentiment_analysis': 1.2, 'harmonic_pattern': 1.2,
  // ========== PATTERN MỚI NÂNG CẤP ==========
  'cau_thoi_gian': 1.1,      // Phân tích theo khung giờ
  'cau_doi_xung': 1.15,      // Cầu đối xứng
  'cau_thuan_nghich': 1.1,   // Cầu thuận nghịch
  'cau_tang_truong': 1.2,    // Cầu tăng trưởng
  'thuat_toan_genetic': 1.25, // Giải thuật di truyền
  'fuzzy_logic': 1.2,        // Logic mờ
  'reinforcement': 1.3,      // Học tăng cường
  'knn_pattern': 1.15,       // K-láng giềng gần nhất
  'bayesian_inference': 1.2, // Suy luận Bayes
  'entropy_analysis': 1.1,   // Phân tích entropy
  'chaos_theory': 1.15       // Lý thuyết hỗn loạn
};

// ==================== THUẬT TOÁN MỚI NÂNG CẤP ====================

// 1. Phân tích cầu đối xứng
function analyzeCauDoiXung(results, type) {
  if (results.length < 10) return { detected: false };
  
  const weight = getPatternWeight(type, 'cau_doi_xung');
  const recent = results.slice(0, 10);
  
  // Kiểm tra đối xứng qua tâm
  let isSymmetric = true;
  for (let i = 0; i < 5; i++) {
    if (recent[i] !== recent[9 - i]) {
      isSymmetric = false;
      break;
    }
  }
  
  if (isSymmetric) {
    const center = recent[4];
    const prediction = center === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: 76,
      name: `🪞 Cầu đối xứng (${recent.slice(0,5).map(r => r === 'Tài' ? 'T' : 'X').join('')}|${recent.slice(5).map(r => r === 'Tài' ? 'T' : 'X').join('')}) → ${prediction}`,
      patternId: 'cau_doi_xung'
    };
  }
  
  return { detected: false };
}

// 2. Phân tích cầu thuận nghịch
function analyzeCauThuanNghich(results, type) {
  if (results.length < 8) return { detected: false };
  
  const weight = getPatternWeight(type, 'cau_thuan_nghich');
  const recent = results.slice(0, 8);
  
  // Tìm chuỗi thuận nghịch: T-T-X-X-T-T-X-X
  let isReversible = true;
  for (let i = 0; i < 4; i++) {
    if (recent[i] !== recent[i + 4]) {
      isReversible = false;
      break;
    }
  }
  
  if (isReversible) {
    const prediction = recent[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: 74,
      name: `🔄 Cầu thuận nghịch (${recent.slice(0,4).map(r => r === 'Tài' ? 'T' : 'X').join('')} lặp lại) → ${prediction}`,
      patternId: 'cau_thuan_nghich'
    };
  }
  
  return { detected: false };
}

// 3. Phân tích cầu tăng trưởng (số lần xuất hiện tăng dần)
function analyzeCauTangTruong(results, type) {
  if (results.length < 15) return { detected: false };
  
  const weight = getPatternWeight(type, 'cau_tang_truong');
  
  // Đếm số lần Tài trong từng khối 5 phiên
  const block1 = results.slice(0, 5).filter(r => r === 'Tài').length;
  const block2 = results.slice(5, 10).filter(r => r === 'Tài').length;
  const block3 = results.slice(10, 15).filter(r => r === 'Tài').length;
  
  // Xu hướng tăng dần
  if (block1 < block2 && block2 < block3) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: 72,
      name: `📈 Cầu tăng trưởng (${block1}→${block2}→${block3} Tài) → Tài`,
      patternId: 'cau_tang_truong'
    };
  }
  
  // Xu hướng giảm dần
  if (block1 > block2 && block2 > block3) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: 72,
      name: `📉 Cầu tăng trưởng (${block1}→${block2}→${block3} Tài) → Xỉu`,
      patternId: 'cau_tang_truong'
    };
  }
  
  return { detected: false };
}

// 4. Giải thuật di truyền (Genetic Algorithm)
function analyzeGeneticAlgorithm(results, type) {
  if (results.length < 30) return { detected: false };
  
  const weight = getPatternWeight(type, 'thuat_toan_genetic');
  
  // Tìm chuỗi con lặp lại nhiều nhất
  const sequences = {};
  for (let len = 3; len <= 6; len++) {
    for (let i = 0; i <= results.length - len; i++) {
      const seq = results.slice(i, i + len).join(',');
      sequences[seq] = (sequences[seq] || 0) + 1;
    }
  }
  
  // Tìm chuỗi phổ biến nhất
  let bestSeq = null;
  let bestCount = 0;
  for (const [seq, count] of Object.entries(sequences)) {
    if (count > bestCount && count >= 2) {
      bestCount = count;
      bestSeq = seq.split(',').map(s => s === 'Tài' ? 'Tài' : 'Xỉu');
    }
  }
  
  if (bestSeq && bestCount >= 2) {
    const prediction = bestSeq[bestSeq.length - 1];
    return {
      detected: true,
      prediction,
      confidence: 68 + bestCount * 2,
      name: `🧬 Di truyền (chuỗi ${bestSeq.slice(0,3).join('-')}... lặp ${bestCount} lần) → ${prediction}`,
      patternId: 'thuat_toan_genetic'
    };
  }
  
  return { detected: false };
}

// 5. Logic mờ (Fuzzy Logic)
function analyzeFuzzyLogic(results, sums, type) {
  if (results.length < 10) return { detected: false };
  
  const weight = getPatternWeight(type, 'fuzzy_logic');
  
  // Tính các chỉ số mờ
  const taiRatio = results.slice(0, 10).filter(r => r === 'Tài').length / 10;
  const avgSum = sums.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
  const volatility = calculateVolatility(sums.slice(0, 10));
  
  // Luật mờ
  let taiScore = 0;
  let xiuScore = 0;
  
  // Luật 1: Tỷ lệ Tài cao → Xỉu
  if (taiRatio > 0.7) xiuScore += 30;
  else if (taiRatio > 0.6) xiuScore += 20;
  else if (taiRatio > 0.5) xiuScore += 10;
  
  // Luật 2: Tổng điểm cao → Tài
  if (avgSum > 12) taiScore += 25;
  else if (avgSum > 11) taiScore += 15;
  else if (avgSum < 9) xiuScore += 25;
  else if (avgSum < 10) xiuScore += 15;
  
  // Luật 3: Biến động cao → Đảo chiều
  if (volatility > 3) {
    const lastResult = results[0];
    if (lastResult === 'Tài') xiuScore += 20;
    else taiScore += 20;
  }
  
  if (Math.abs(taiScore - xiuScore) > 20) {
    const prediction = taiScore > xiuScore ? 'Tài' : 'Xỉu';
    const confidence = 65 + Math.abs(taiScore - xiuScore) / 4;
    return {
      detected: true,
      prediction,
      confidence: Math.min(85, confidence),
      name: `🧠 Logic mờ (T:${taiScore.toFixed(0)} X:${xiuScore.toFixed(0)}) → ${prediction}`,
      patternId: 'fuzzy_logic'
    };
  }
  
  return { detected: false };
}

// 6. Học tăng cường (Reinforcement Learning)
let qTable = {};
function analyzeReinforcementLearning(results, type) {
  if (results.length < 15) return { detected: false };
  
  const weight = getPatternWeight(type, 'reinforcement');
  
  // Trạng thái: 3 kết quả gần nhất
  const state = results.slice(0, 3).map(r => r === 'Tài' ? 1 : 0).join('');
  
  // Khởi tạo Q-value nếu chưa có
  if (!qTable[state]) {
    qTable[state] = { Tài: 0, Xỉu: 0 };
  }
  
  // Chọn action có Q-value cao nhất
  const prediction = qTable[state].Tài >= qTable[state].Xỉu ? 'Tài' : 'Xỉu';
  const confidence = 65 + Math.abs(qTable[state].Tài - qTable[state].Xỉu) * 2;
  
  return {
    detected: true,
    prediction,
    confidence: Math.min(85, confidence),
    name: `🤖 Học tăng cường (${state}) → ${prediction}`,
    patternId: 'reinforcement'
  };
}

// Cập nhật Q-value sau mỗi kết quả
function updateQTable(state, action, reward) {
  if (!qTable[state]) {
    qTable[state] = { Tài: 0, Xỉu: 0 };
  }
  const learningRate = 0.1;
  const discountFactor = 0.9;
  const oldQ = qTable[state][action];
  qTable[state][action] = oldQ + learningRate * (reward + discountFactor * Math.max(...Object.values(qTable[state] || {Tài:0, Xỉu:0})) - oldQ);
}

// 7. K-láng giềng gần nhất (KNN)
function analyzeKNN(results, type) {
  if (results.length < 20) return { detected: false };
  
  const weight = getPatternWeight(type, 'knn_pattern');
  const k = 5;
  
  // Tìm k mẫu giống nhất
  const currentPattern = results.slice(0, 5);
  const distances = [];
  
  for (let i = 5; i < results.length - 1; i++) {
    const pattern = results.slice(i, i + 5);
    let distance = 0;
    for (let j = 0; j < 5; j++) {
      if (pattern[j] !== currentPattern[j]) distance++;
    }
    distances.push({ distance, nextResult: results[i - 1] });
  }
  
  distances.sort((a, b) => a.distance - b.distance);
  const nearest = distances.slice(0, k);
  
  const taiCount = nearest.filter(n => n.nextResult === 'Tài').length;
  const xiuCount = k - taiCount;
  
  if (taiCount > xiuCount + 2) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: 70,
      name: `👥 KNN (${taiCount}/${k} mẫu gần nhất ra Tài) → Tài`,
      patternId: 'knn_pattern'
    };
  } else if (xiuCount > taiCount + 2) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: 70,
      name: `👥 KNN (${xiuCount}/${k} mẫu gần nhất ra Xỉu) → Xỉu`,
      patternId: 'knn_pattern'
    };
  }
  
  return { detected: false };
}

// 8. Suy luận Bayes
function analyzeBayesianInference(results, type) {
  if (results.length < 30) return { detected: false };
  
  const weight = getPatternWeight(type, 'bayesian_inference');
  
  // Tính xác suất tiên nghiệm
  const priorTai = results.filter(r => r === 'Tài').length / results.length;
  const priorXiu = 1 - priorTai;
  
  // Tính xác suất có điều kiện dựa trên 3 kết quả gần nhất
  const last3 = results.slice(0, 3);
  let matchCount = { Tai: 0, Xiu: 0 };
  let totalMatch = 0;
  
  for (let i = 3; i < results.length - 1; i++) {
    if (results[i] === last3[0] && results[i+1] === last3[1] && results[i+2] === last3[2]) {
      totalMatch++;
      if (results[i-1] === 'Tài') matchCount.Tai++;
      else matchCount.Xiu++;
    }
  }
  
  if (totalMatch >= 3) {
    const posteriorTai = (matchCount.Tai / totalMatch) * priorTai;
    const posteriorXiu = (matchCount.Xiu / totalMatch) * priorXiu;
    const prediction = posteriorTai > posteriorXiu ? 'Tài' : 'Xỉu';
    const confidence = 65 + Math.abs(posteriorTai - posteriorXiu) * 20;
    
    return {
      detected: true,
      prediction,
      confidence: Math.min(88, confidence),
      name: `📊 Bayes (P(${prediction}) = ${(Math.max(posteriorTai, posteriorXiu) * 100).toFixed(0)}%) → ${prediction}`,
      patternId: 'bayesian_inference'
    };
  }
  
  return { detected: false };
}

// 9. Phân tích Entropy (độ hỗn loạn)
function analyzeEntropy(results, type) {
  if (results.length < 15) return { detected: false };
  
  const weight = getPatternWeight(type, 'entropy_analysis');
  
  // Tính entropy của chuỗi
  const taiCount = results.slice(0, 15).filter(r => r === 'Tài').length;
  const pTai = taiCount / 15;
  const pXiu = 1 - pTai;
  
  let entropy = 0;
  if (pTai > 0) entropy -= pTai * Math.log2(pTai);
  if (pXiu > 0) entropy -= pXiu * Math.log2(pXiu);
  
  // Entropy cao (hỗn loạn) → khó đoán, entropy thấp (có quy luật) → dễ đoán
  if (entropy < 0.8) {
    const prediction = pTai > 0.6 ? 'Tài' : (pXiu > 0.6 ? 'Xỉu' : null);
    if (prediction) {
      return {
        detected: true,
        prediction,
        confidence: 75,
        name: `📐 Entropy thấp (${entropy.toFixed(2)}bit, có quy luật) → ${prediction}`,
        patternId: 'entropy_analysis'
      };
    }
  }
  
  if (entropy > 0.95) {
    // Hỗn loạn cao, dự đoán đảo ngược xu hướng gần nhất
    const lastResult = results[0];
    const prediction = lastResult === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: 68,
      name: `🌀 Entropy cao (${entropy.toFixed(2)}bit, hỗn loạn) → Đảo ${prediction}`,
      patternId: 'entropy_analysis'
    };
  }
  
  return { detected: false };
}

// 10. Lý thuyết hỗn loạn (Chaos Theory)
function analyzeChaosTheory(results, sums, type) {
  if (results.length < 25) return { detected: false };
  
  const weight = getPatternWeight(type, 'chaos_theory');
  
  // Tìm điểm hấp dẫn (attractor)
  const recentResults = results.slice(0, 10);
  const recentSums = sums.slice(0, 10);
  
  // Tính điểm hấp dẫn từ tổng điểm
  const attractor = recentSums.reduce((a, b) => a + b, 0) / 10;
  
  // Nếu tổng điểm gần attractor, dự đoán theo xu hướng hiện tại
  const lastSum = sums[0];
  const distanceToAttractor = Math.abs(lastSum - attractor);
  
  if (distanceToAttractor < 1.5) {
    const prediction = recentResults[0];
    return {
      detected: true,
      prediction,
      confidence: 72,
      name: `🌀 Điểm hấp dẫn (${attractor.toFixed(1)}) → Theo ${prediction}`,
      patternId: 'chaos_theory'
    };
  }
  
  if (distanceToAttractor > 4) {
    const prediction = recentResults[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: 70,
      name: `💥 Thoát khỏi attractor → Đảo ${prediction}`,
      patternId: 'chaos_theory'
    };
  }
  
  return { detected: false };
}

// ==================== CÁC HÀM PHÂN TÍCH CẢI TIẾN ====================

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
      name: `📊 Tổng Phân Tích (Tổng tăng ${sumTrend.toFixed(1)} → Xỉu)`,
      patternId: 'tong_phan_tich'
    };
  }
  
  if (sumTrend < -1.5) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: Math.round(75 + Math.abs(sumTrend) * 3),
      name: `📊 Tổng Phân Tích (Tổng giảm ${Math.abs(sumTrend).toFixed(1)} → Tài)`,
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
      name: `📊 Tổng Phân Tích (Lệch ${Math.abs(taiCount - xiuCount)} về ${lech} → ${prediction})`,
      patternId: 'tong_phan_tich'
    };
  }
  
  return { detected: false };
}

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
      name: `🔥 Xu Hướng Mạnh (${taiCount}/8 Tài → Đảo Xỉu)`,
      patternId: 'xu_huong_manh'
    };
  }
  
  if (taiCount <= 2) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: Math.round(80 + (8 - taiCount) * 2),
      name: `🔥 Xu Hướng Mạnh (${8 - taiCount}/8 Xỉu → Đảo Tài)`,
      patternId: 'xu_huong_manh'
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
    
    if (streakLength >= 7) {
      shouldBreak = true;
      confidence = 88;
    } else if (streakLength >= 5) {
      shouldBreak = true;
      confidence = 80;
    } else if (streakLength >= 3) {
      shouldBreak = false;
      confidence = 70;
    }
    
    return { 
      detected: true, 
      type: streakType, 
      length: streakLength,
      prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
      confidence: Math.round(confidence * weight),
      name: `💰 Cầu Bệt ${streakLength} phiên ${streakType}`,
      patternId: 'cau_bet'
    };
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
      name: `🐉 Cầu Rồng ${streakLength} phiên (Bẻ mạnh)`,
      patternId: 'cau_rong'
    };
  }
  
  return { detected: false };
}

// ==================== HÀM TÍNH TOÁN DỰ ĐOÁN CHÍNH (NÂNG CẤP) ====================

function calculateAdvancedPrediction(data, type) {
  const last50 = data.slice(0, 50);
  const results = last50.map(d => d.Ket_qua);
  const sums = last50.map(d => d.Tong);
  
  initializePatternStats(type);
  
  let predictions = [];
  let factors = [];
  let allPatterns = [];
  
  // ========== DANH SÁCH PATTERN NÂNG CẤP ==========
  const patterns = [
    // Pattern ưu tiên cao nhất
    { name: 'Tổng Phân Tích', func: () => analyzeTongPhanTich(last50, type), priority: 20 },
    { name: 'Học tăng cường', func: () => analyzeReinforcementLearning(results, type), priority: 19 },
    { name: 'Suy luận Bayes', func: () => analyzeBayesianInference(results, type), priority: 18 },
    { name: 'Giải thuật di truyền', func: () => analyzeGeneticAlgorithm(results, type), priority: 17 },
    { name: 'LSTM Pattern', func: () => analyzeLSTMPattern(results, type), priority: 16 },
    { name: 'Neural Boost', func: () => analyzeNeuralBoost(results, sums, type), priority: 16 },
    
    // Pattern trung bình cao
    { name: 'Xu Hướng Mạnh', func: () => analyzeXuHuongManh(results, type), priority: 15 },
    { name: 'Logic mờ', func: () => analyzeFuzzyLogic(results, sums, type), priority: 15 },
    { name: 'Cầu Rồng', func: () => analyzeCauRong(results, type), priority: 14 },
    { name: 'Cầu Bệt', func: () => analyzeCauBet(results, type), priority: 14 },
    { name: 'Cầu đối xứng', func: () => analyzeCauDoiXung(results, type), priority: 13 },
    { name: 'Cầu thuận nghịch', func: () => analyzeCauThuanNghich(results, type), priority: 13 },
    { name: 'KNN Pattern', func: () => analyzeKNN(results, type), priority: 13 },
    { name: 'Entropy', func: () => analyzeEntropy(results, type), priority: 12 },
    { name: 'Lý thuyết hỗn loạn', func: () => analyzeChaosTheory(results, sums, type), priority: 12 },
    
    // Pattern cơ bản
    { name: 'Markov Chain', func: () => analyzeMarkovChain(results, type), priority: 11 },
    { name: 'Harmonic Pattern', func: () => analyzeHarmonicPattern(results, sums, type), priority: 11 },
    { name: 'Sentiment', func: () => analyzeSentiment(results, sums, type), priority: 11 },
    { name: 'Cầu tăng trưởng', func: () => analyzeCauTangTruong(results, type), priority: 10 },
    { name: 'Cầu Đảo 1-1', func: () => analyzeCauDao11(results, type), priority: 10 },
    { name: 'Cầu Bẻ Cầu', func: () => analyzeCauBeCau(results, type), priority: 9 },
    { name: 'Cầu 2-2', func: () => analyzeCau22(results, type), priority: 9 },
    { name: 'Cầu 3-3', func: () => analyzeCau33(results, type), priority: 9 },
    { name: 'Fibonacci', func: () => analyzeFibonacci(sums, type), priority: 9 },
    { name: 'Golden Ratio', func: () => analyzeGoldenRatio(results, sums, type), priority: 9 },
    { name: 'Smart Bet', func: () => analyzeSmartBet(results, type), priority: 8 },
    { name: 'Bẻ Chuỗi', func: () => analyzeBreakStreak(results, type), priority: 8 },
    { name: 'Triple Pattern', func: () => analyzeTriplePattern(results, type), priority: 8 },
    { name: 'Double Pair Break', func: () => analyzeDoublePairBreak(results, type), priority: 8 },
    { name: 'Cầu 1-2-1', func: () => analyzeCau121(results, type), priority: 7 },
    { name: 'Wave Pattern', func: () => analyzeWavePattern(results, sums, type), priority: 7 },
    { name: 'Đảo Chiều', func: () => analyzeDaoChieu(results, type), priority: 7 },
    { name: 'Alternating Break', func: () => analyzeAlternatingBreak(results, type), priority: 7 },
    { name: 'Cầu Nhịp Nghiêng', func: () => analyzeCauNhipNghieng(results, type), priority: 6 },
    { name: 'Cầu 3 Ván 1', func: () => analyzeCau3Van1(results, type), priority: 6 },
    { name: 'Cầu Nhảy Cóc', func: () => analyzeCauNhayCoc(results, type), priority: 5 }
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
    factors.push(`Phân bố lệch (T:${distribution.taiPercent.toFixed(0)}% - X:${distribution.xiuPercent.toFixed(0)}%)`);
  }
  
  // Nếu không có pattern nào, dùng cầu tự nhiên
  if (predictions.length === 0) {
    const cauTuNhien = analyzeCauTuNhien(results, type);
    predictions.push({ prediction: cauTuNhien.prediction, confidence: cauTuNhien.confidence, priority: 1, name: cauTuNhien.name });
    factors.push(cauTuNhien.name);
    allPatterns.push(cauTuNhien);
  }
  
  // Sắp xếp theo priority và confidence
  predictions.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
  
  // Tính điểm cho Tài và Xỉu (có trọng số)
  const taiVotes = predictions.filter(p => p.prediction === 'Tài');
  const xiuVotes = predictions.filter(p => p.prediction === 'Xỉu');
  
  let taiScore = taiVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  let xiuScore = xiuVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  
  // Điều chỉnh theo ML
  const features = extractFeatures(results, sums);
  const mlProbability = predictWithML(features, type);
  
  if (mlProbability > 0.6) {
    taiScore *= (1 + mlProbability * 0.5);
  } else if (mlProbability < 0.4) {
    xiuScore *= (1 + (1 - mlProbability) * 0.5);
  }
  
  // Điều chỉnh theo lịch sử thắng/thua
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
  
  const topPredictions = predictions.slice(0, 5);
  topPredictions.forEach(p => {
    if (p.prediction === finalPrediction) {
      baseConfidence += (p.confidence - 65) * 0.25;
    }
  });
  
  const agreementRatio = (finalPrediction === 'Tài' ? taiVotes.length : xiuVotes.length) / predictions.length;
  baseConfidence += Math.round(agreementRatio * 12);
  
  // Thêm boost từ ML
  const mlBoost = Math.abs(mlProbability - 0.5) * 25;
  baseConfidence += mlBoost;
  
  const adaptiveBoost = getAdaptiveConfidenceBoost(type);
  baseConfidence += adaptiveBoost;
  
  let finalConfidence = Math.round(baseConfidence);
  
  // Giới hạn confidence 60-92%
  finalConfidence = Math.max(60, Math.min(92, finalConfidence));
  
  return {
    prediction: finalPrediction,
    confidence: finalConfidence,
    factors,
    allPatterns,
    mlProbability: (mlProbability * 100).toFixed(1),
    detailedAnalysis: {
      totalPatterns: predictions.length,
      taiVotes: taiVotes.length,
      xiuVotes: xiuVotes.length,
      taiScore: Math.round(taiScore),
      xiuScore: Math.round(xiuScore),
      topPattern: predictions[0]?.name || 'N/A',
      distribution,
      learningStats: {
        totalPredictions: learningData[type].totalPredictions,
        correctPredictions: learningData[type].correctPredictions,
        accuracy: learningData[type].totalPredictions > 0 
          ? (learningData[type].correctPredictions / learningData[type].totalPredictions * 100).toFixed(1) + '%'
          : 'N/A',
        currentStreak: learningData[type].streakAnalysis.currentStreak
      }
    }
  };
}

// ==================== CÁC HÀM HỖ TRỢ KHÁC (GIỮ NGUYÊN) ====================

// ... (giữ nguyên các hàm hỗ trợ: loadLearningData, saveLearningData, 
// fetchDataHu, fetchDataMd5, transformApiData, v.v.)

// Cập nhật Q-table khi có kết quả thực tế
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
      
      // Cập nhật Q-table cho Reinforcement Learning
      const state = learningData[type].predictions
        .filter(p => p.verified)
        .slice(0, 3)
        .map(p => p.actual === 'Tài' ? 1 : 0)
        .join('');
      const action = pred.prediction;
      const reward = pred.isCorrect ? 1 : -1;
      updateQTable(state, action, reward);
      
      // ... (phần còn lại giữ nguyên)
      
      updated = true;
    }
  }
  
  if (updated) {
    learningData[type].lastUpdate = new Date().toISOString();
    saveLearningData();
  }
}

// ==================== ENDPOINTS ====================

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send('t.me/CuTools - Tai Xiu Predictor Pro v8.0');
});

app.get('/lc79-md5', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data || data.length === 0) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('md5', data);
    
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    
    const result = calculateAdvancedPrediction(data, 'md5');
    
    const record = savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
    
    setTimeout(async () => {
      await updateHistoryStatus('md5');
    }, 5000);
    
    res.json({
      Phien: record.Phien,
      Xuc_xac_1: record.Xuc_xac_1,
      Xuc_xac_2: record.Xuc_xac_2,
      Xuc_xac_3: record.Xuc_xac_3,
      Tong: record.Tong,
      Ket_qua: record.Ket_qua,
      Do_tin_cay: `${result.confidence}%`,
      Phien_hien_tai: record.Phien_hien_tai,
      Du_doan: record.Du_doan,
      ket_qua_du_doan: record.ket_qua_du_doan || '',
      id: record.id,
      ml_probability: result.mlProbability,
      algorithms_used: result.detailedAnalysis.totalPatterns
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// ... (các endpoint khác giữ nguyên)

// Khởi động server
// loadLearningData();
// loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔════════════════════════════════════════════════════════════╗`);
  console.log(`║     🎲 TÀI XỈU PREDICTOR PRO v8.0 - NÂNG CẤP TOÀN DIỆN 🎲     ║`);
  console.log(`╠════════════════════════════════════════════════════════════╣`);
  console.log(`║  Server: http://0.0.0.0:${PORT}                              ║`);
  console.log(`║  Author: @tiendataox                                       ║`);
  console.log(`╠════════════════════════════════════════════════════════════╣`);
  console.log(`║  🆕 THUẬT TOÁN MỚI NÂNG CẤP:                               ║`);
  console.log(`║  • Giải thuật di truyền (Genetic Algorithm)                ║`);
  console.log(`║  • Logic mờ (Fuzzy Logic)                                  ║`);
  console.log(`║  • Học tăng cường (Reinforcement Learning)                 ║`);
  console.log(`║  • K-láng giềng gần nhất (KNN)                             ║`);
  console.log(`║  • Suy luận Bayes (Bayesian Inference)                     ║`);
  console.log(`║  • Phân tích Entropy                                       ║`);
  console.log(`║  • Lý thuyết hỗn loạn (Chaos Theory)                       ║`);
  console.log(`║  • Cầu đối xứng & thuận nghịch                             ║`);
  console.log(`║  • Cầu tăng trưởng                                         ║`);
  console.log(`╠════════════════════════════════════════════════════════════╣`);
  console.log(`║  📁 Files: tiendat.json, tiendat1.json                     ║`);
  console.log(`║  🚀 Tổng số pattern: ${Object.keys(DEFAULT_PATTERN_WEIGHTS).length}+     ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝\n`);
  
  startAutoSaveTask();
});