// server.js - Phiên bản nâng cấp v10.0
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

// ==================== CẤU TRÚC DỮ LIỆU HỌC NÂNG CẤP ====================
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
    // Thêm tracking cho cầu
    cauTracking: {
      currentCau: null,
      cauHistory: [],
      breakHistory: [],
      followHistory: []
    }
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
    cauTracking: {
      currentCau: null,
      cauHistory: [],
      breakHistory: [],
      followHistory: []
    }
  }
};

// ==================== TRỌNG SỐ MẶC ĐỊNH ====================
const DEFAULT_PATTERN_WEIGHTS = {
  'cau_bet': 1.2, 'cau_dao_11': 1.15, 'cau_22': 1.1, 'cau_33': 1.1,
  'cau_121': 1.05, 'cau_123': 1.05, 'cau_321': 1.05, 'cau_nhay_coc': 1.0,
  'cau_nhip_nghieng': 1.1, 'cau_3van1': 1.0, 'cau_be_cau': 1.3,
  'cau_chu_ky': 1.15, 'distribution': 1.0, 'dice_pattern': 0.9,
  'sum_trend': 1.1, 'edge_cases': 0.9, 'momentum': 1.0, 'cau_tu_nhien': 0.8,
  'dice_trend_line': 1.0, 'dice_trend_line_md5': 1.0, 'break_pattern_hu': 1.25,
  'break_pattern_md5': 1.25, 'fibonacci': 1.1, 'resistance_support': 1.05,
  'wave': 1.1, 'golden_ratio': 1.05, 'day_gay': 1.2, 'day_gay_md5': 1.2,
  'cau_44': 1.1, 'cau_55': 1.1, 'cau_212': 1.05, 'cau_1221': 1.05,
  'cau_2112': 1.05, 'cau_gap': 1.15, 'cau_ziczac': 1.1, 'cau_doi': 1.1,
  'cau_rong': 1.3, 'smart_bet': 1.2, 'break_pattern_advanced': 1.2,
  'break_streak': 1.35, 'alternating_break': 1.3, 'double_pair_break': 1.25,
  'triple_pattern': 1.25, 'tong_phan_tich': 1.5, 'xu_huong_manh': 1.4,
  'dao_chieu': 1.45, 'lstm_pattern': 1.35, 'markov_chain': 1.3,
  'neural_boost': 1.4, 'sentiment_analysis': 1.25, 'harmonic_pattern': 1.2,
  // Pattern bẻ cầu mới
  'break_at_peak': 1.5, 'break_at_5': 1.45, 'break_at_7': 1.55,
  'break_at_10': 1.6, 'break_after_double': 1.4, 'break_after_triple': 1.45,
  'follow_strength': 1.35, 'follow_alternating': 1.3, 'follow_after_break': 1.4
};

// ==================== PHÂN TÍCH CẦU CHUYÊN SÂU ====================

/**
 * Phân tích loại cầu hiện tại
 */
function analyzeCauType(results) {
  if (results.length < 4) return { type: 'unknown', strength: 0, nextPrediction: null };
  
  // 1. Cầu bệt (cùng kết quả liên tiếp)
  let betLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) betLength++;
    else break;
  }
  
  if (betLength >= 3) {
    return {
      type: 'bet',
      direction: results[0],
      length: betLength,
      strength: Math.min(95, 60 + betLength * 5),
      nextPrediction: betLength >= 5 ? (results[0] === 'Tài' ? 'Xỉu' : 'Tài') : results[0]
    };
  }
  
  // 2. Cầu đảo 1-1 (luân phiên)
  let alternatingLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] !== results[i-1]) alternatingLength++;
    else break;
  }
  
  if (alternatingLength >= 4) {
    return {
      type: 'alternating',
      direction: results[0],
      length: alternatingLength,
      strength: Math.min(85, 65 + alternatingLength * 2),
      nextPrediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài'
    };
  }
  
  // 3. Cầu 2-2 (cặp đôi)
  let pairCount = 0;
  let pairs = [];
  for (let i = 0; i < results.length - 1; i += 2) {
    if (results[i] === results[i+1]) {
      pairs.push(results[i]);
      pairCount++;
    } else break;
  }
  
  if (pairCount >= 2) {
    const lastPair = pairs[pairs.length - 1];
    const isAlternatingPairs = pairs.length >= 2 && pairs[0] !== pairs[1];
    
    return {
      type: 'pair',
      pattern: pairs,
      length: pairCount,
      strength: Math.min(80, 65 + pairCount * 3),
      nextPrediction: isAlternatingPairs ? (lastPair === 'Tài' ? 'Xỉu' : 'Tài') : lastPair
    };
  }
  
  // 4. Cầu 3-3 (bộ ba)
  let tripleCount = 0;
  let triples = [];
  for (let i = 0; i < results.length - 2; i += 3) {
    if (results[i] === results[i+1] && results[i+1] === results[i+2]) {
      triples.push(results[i]);
      tripleCount++;
    } else break;
  }
  
  if (tripleCount >= 1) {
    const lastTriple = triples[triples.length - 1];
    const positionInTriple = results.length % 3;
    
    let nextPrediction;
    if (positionInTriple === 0) {
      nextPrediction = lastTriple === 'Tài' ? 'Xỉu' : 'Tài';
    } else {
      nextPrediction = lastTriple;
    }
    
    return {
      type: 'triple',
      direction: lastTriple,
      length: tripleCount,
      strength: Math.min(85, 70 + tripleCount * 5),
      nextPrediction
    };
  }
  
  // 5. Cầu phức hợp (1-2-1, 1-2-3, 3-2-1)
  if (results.length >= 4) {
    // Cầu 1-2-1
    if (results[0] !== results[1] && results[1] === results[2] && results[2] !== results[3] && results[0] === results[3]) {
      return {
        type: '121',
        pattern: [results[0], results[1], results[2], results[3]],
        strength: 75,
        nextPrediction: results[0]
      };
    }
  }
  
  if (results.length >= 6) {
    // Cầu 1-2-3
    if (results[3] === results[4] && results[4] === results[5] && results[0] !== results[3]) {
      return {
        type: '123',
        pattern: results.slice(0, 6),
        strength: 78,
        nextPrediction: results[5]
      };
    }
    
    // Cầu 3-2-1
    if (results[0] === results[1] && results[1] === results[2] && 
        results[3] === results[4] && results[0] !== results[3]) {
      return {
        type: '321',
        pattern: results.slice(0, 6),
        strength: 78,
        nextPrediction: results[4]
      };
    }
  }
  
  return { type: 'unknown', strength: 55, nextPrediction: results[0] };
}

/**
 * QUYẾT ĐỊNH BẺ CẦU THÔNG MINH
 * Chỉ bẻ cầu khi có đủ tín hiệu mạnh
 */
function shouldBreakCau(results, cauInfo, type) {
  if (!cauInfo || cauInfo.type === 'unknown') return { shouldBreak: false, reason: '', confidence: 0 };
  
  const breakPatterns = [];
  let breakScore = 0;
  
  // 1. Bẻ cầu bệt dài
  if (cauInfo.type === 'bet') {
    if (cauInfo.length >= 7) {
      breakScore += 45;
      breakPatterns.push(`Bệt ${cauInfo.length} phiên - tỷ lệ gãy cực cao`);
    } else if (cauInfo.length >= 5) {
      breakScore += 30;
      breakPatterns.push(`Bệt ${cauInfo.length} phiên - ngưỡng bẻ`);
    } else if (cauInfo.length >= 4) {
      breakScore += 15;
      breakPatterns.push(`Bệt ${cauInfo.length} phiên - theo dõi`);
    }
  }
  
  // 2. Bẻ cầu đảo dài
  if (cauInfo.type === 'alternating' && cauInfo.length >= 7) {
    breakScore += 35;
    breakPatterns.push(`Đảo ${cauInfo.length} phiên - sắp gãy`);
  }
  
  // 3. Bẻ cầu cặp đôi
  if (cauInfo.type === 'pair' && cauInfo.length >= 3) {
    breakScore += 25;
    breakPatterns.push(`Cặp đôi ${cauInfo.length} cặp - bẻ sau cặp cuối`);
  }
  
  // 4. Bẻ cầu bộ ba
  if (cauInfo.type === 'triple' && cauInfo.length >= 2) {
    breakScore += 30;
    breakPatterns.push(`Bộ ba ${cauInfo.length} lần - bẻ sau bộ ba`);
  }
  
  // 5. Phân tích lịch sử bẻ cầu
  const breakHistory = learningData[type].cauTracking.breakHistory.slice(-10);
  const breakSuccessRate = breakHistory.length > 0 
    ? breakHistory.filter(b => b.success).length / breakHistory.length 
    : 0.5;
  
  if (breakSuccessRate > 0.6) {
    breakScore += 10;
    breakPatterns.push(`Lịch sử bẻ cầu thành công ${Math.round(breakSuccessRate * 100)}%`);
  }
  
  // 6. Kiểm tra tổng điểm và đưa ra quyết định
  const shouldBreak = breakScore >= 35;
  const confidence = Math.min(90, 50 + breakScore);
  
  return {
    shouldBreak,
    reason: breakPatterns.join('; '),
    confidence,
    breakScore,
    prediction: shouldBreak ? (cauInfo.nextPrediction === 'Tài' ? 'Xỉu' : 'Tài') : cauInfo.nextPrediction
  };
}

/**
 * QUYẾT ĐỊNH THEO CẦU THÔNG MINH
 * Chỉ theo cầu khi xu hướng mạnh
 */
function shouldFollowCau(results, cauInfo, type) {
  if (!cauInfo || cauInfo.type === 'unknown') return { shouldFollow: true, reason: '', confidence: 55 };
  
  const followPatterns = [];
  let followScore = 20; // Base score
  
  // 1. Theo cầu bệt vừa phải (3-4 phiên)
  if (cauInfo.type === 'bet') {
    if (cauInfo.length >= 3 && cauInfo.length <= 4) {
      followScore += 35;
      followPatterns.push(`Bệt ${cauInfo.length} phiên - an toàn theo`);
    } else if (cauInfo.length === 5) {
      followScore += 15;
      followPatterns.push(`Bệt 5 phiên - rủi ro cao hơn`);
    } else if (cauInfo.length >= 6) {
      followScore -= 20;
      followPatterns.push(`Bệt quá dài - chờ bẻ`);
    }
  }
  
  // 2. Theo cầu đảo (an toàn)
  if (cauInfo.type === 'alternating') {
    if (cauInfo.length <= 5) {
      followScore += 30;
      followPatterns.push(`Đảo 1-1 - an toàn`);
    } else {
      followScore -= 10;
      followPatterns.push(`Đảo quá dài - cẩn trọng`);
    }
  }
  
  // 3. Theo cầu cặp đôi
  if (cauInfo.type === 'pair') {
    followScore += 25;
    followPatterns.push(`Cầu cặp đôi - theo`);
  }
  
  // 4. Theo cầu bộ ba
  if (cauInfo.type === 'triple' && cauInfo.length === 1) {
    followScore += 20;
    followPatterns.push(`Bộ ba đầu - theo tiếp`);
  }
  
  // 5. Lịch sử theo cầu
  const followHistory = learningData[type].cauTracking.followHistory.slice(-10);
  const followSuccessRate = followHistory.length > 0
    ? followHistory.filter(f => f.success).length / followHistory.length
    : 0.55;
  
  if (followSuccessRate > 0.55) {
    followScore += 10;
    followPatterns.push(`Lịch sử theo cầu tốt ${Math.round(followSuccessRate * 100)}%`);
  }
  
  const shouldFollow = followScore >= 35;
  const confidence = Math.min(88, 50 + followScore);
  
  return {
    shouldFollow,
    reason: followPatterns.join('; '),
    confidence,
    prediction: cauInfo.nextPrediction
  };
}

// ==================== DỰ ĐOÁN DỰA TRÊN TỔNG (KHÔNG RANDOM) ====================

/**
 * Phân tích xu hướng tổng điểm chi tiết
 */
function analyzeSumTrend(sums) {
  if (sums.length < 10) return { trend: 'unknown', strength: 0, nextRange: null };
  
  const recent10 = sums.slice(0, 10);
  const avgRecent = recent10.reduce((a, b) => a + b, 0) / 10;
  const last3 = sums.slice(0, 3);
  const avgLast3 = last3.reduce((a, b) => a + b, 0) / 3;
  
  // Xu hướng tăng/giảm
  let increasing = 0;
  let decreasing = 0;
  for (let i = 1; i < recent10.length; i++) {
    if (recent10[i] > recent10[i-1]) increasing++;
    else if (recent10[i] < recent10[i-1]) decreasing++;
  }
  
  if (increasing > decreasing + 3) {
    return {
      trend: 'increasing',
      strength: Math.min(85, 60 + (increasing - decreasing) * 3),
      nextRange: avgLast3 > 12 ? 'Xỉu' : (avgLast3 < 9 ? 'Tài' : null)
    };
  }
  
  if (decreasing > increasing + 3) {
    return {
      trend: 'decreasing',
      strength: Math.min(85, 60 + (decreasing - increasing) * 3),
      nextRange: avgLast3 < 9 ? 'Tài' : (avgLast3 > 12 ? 'Xỉu' : null)
    };
  }
  
  // Tổng ở vùng trung bình
  if (avgRecent > 10.2 && avgRecent < 10.8) {
    return {
      trend: 'neutral',
      strength: 50,
      nextRange: avgLast3 > 10.5 ? 'Xỉu' : 'Tài'
    };
  }
  
  return {
    trend: avgRecent > 10.5 ? 'high' : 'low',
    strength: Math.abs(avgRecent - 10.5) * 10,
    nextRange: avgRecent > 10.5 ? 'Xỉu' : 'Tài'
  };
}

/**
 * Phân tích xúc sắc chi tiết (không random)
 */
function analyzeDiceDetails(dices) {
  if (!dices || dices.length < 3) return { prediction: null, confidence: 0 };
  
  const last3DiceSets = dices.slice(0, 3);
  const allDiceValues = [];
  last3DiceSets.forEach(set => {
    if (set && typeof set === 'object') {
      allDiceValues.push(set.Xuc_xac_1, set.Xuc_xac_2, set.Xuc_xac_3);
    }
  });
  
  // Phân tích mặt xúc sắc xuất hiện nhiều
  const frequency = {};
  allDiceValues.forEach(v => {
    frequency[v] = (frequency[v] || 0) + 1;
  });
  
  const sortedValues = Object.entries(frequency).sort((a, b) => b[1] - a[1]);
  const dominantValue = sortedValues[0] ? parseInt(sortedValues[0][0]) : null;
  
  // Dự đoán dựa trên mặt hay xuất hiện
  if (dominantValue) {
    if (dominantValue >= 4) {
      return { prediction: 'Xỉu', confidence: 65, reason: `Xúc sắc ${dominantValue} xuất hiện nhiều` };
    } else if (dominantValue <= 3) {
      return { prediction: 'Tài', confidence: 65, reason: `Xúc sắc ${dominantValue} xuất hiện nhiều` };
    }
  }
  
  return { prediction: null, confidence: 0 };
}

/**
 * Phân tích lịch sử đúng/sai để điều chỉnh
 */
function analyzeAccuracyPattern(type) {
  const recentAccuracy = learningData[type].recentAccuracy.slice(-20);
  if (recentAccuracy.length < 10) return { adjustment: 0, shouldReverse: false };
  
  const correctCount = recentAccuracy.filter(a => a === 1).length;
  const accuracy = correctCount / recentAccuracy.length;
  
  // Nếu độ chính xác thấp liên tục, đảo ngược dự đoán
  if (accuracy < 0.35) {
    return { adjustment: -20, shouldReverse: true, reason: `Độ chính xác thấp ${Math.round(accuracy * 100)}%` };
  }
  
  // Nếu độ chính xác cao, tăng confidence
  if (accuracy > 0.65) {
    return { adjustment: 15, shouldReverse: false, reason: `Độ chính xác cao ${Math.round(accuracy * 100)}%` };
  }
  
  return { adjustment: 0, shouldReverse: false };
}

// ==================== CÁC HÀM PHÂN TÍCH CẦU NÂNG CẤP ====================

function analyzeBreakAtPeak(results, type) {
  if (results.length < 10) return { detected: false };
  
  // Tìm đỉnh cầu
  let currentStreak = 1;
  let maxStreak = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[i-1]) {
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 1;
    }
  }
  
  // Bẻ cầu khi đạt đỉnh lịch sử
  if (maxStreak >= 5 && results[0] === results[1]) {
    return {
      detected: true,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.min(88, 70 + maxStreak * 2),
      name: `Bẻ đỉnh cầu (kỷ lục ${maxStreak} phiên)`,
      patternId: 'break_at_peak'
    };
  }
  
  return { detected: false };
}

function analyzeFollowStrength(results, type) {
  if (results.length < 5) return { detected: false };
  
  // Đánh giá sức mạnh xu hướng
  let strength = 0;
  for (let i = 1; i < Math.min(results.length, 10); i++) {
    if (results[i] === results[i-1]) strength++;
    else strength--;
  }
  
  // Xu hướng mạnh thì theo
  if (strength >= 3) {
    return {
      detected: true,
      prediction: results[0],
      confidence: Math.min(82, 65 + strength * 3),
      name: `Theo xu hướng mạnh (điểm ${strength})`,
      patternId: 'follow_strength'
    };
  }
  
  return { detected: false };
}

function analyzeBreakAtSpecificLength(results, type) {
  if (results.length < 3) return { detected: false };
  
  // Bẻ cầu tại các mốc đặc biệt: 5, 7, 10
  let currentStreak = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[i-1]) currentStreak++;
    else break;
  }
  
  const breakPoints = [5, 7, 10];
  if (breakPoints.includes(currentStreak)) {
    const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    let confidence = 75;
    if (currentStreak === 10) confidence = 88;
    else if (currentStreak === 7) confidence = 82;
    else if (currentStreak === 5) confidence = 75;
    
    return {
      detected: true,
      prediction,
      confidence,
      name: `Bẻ cầu tại mốc ${currentStreak} phiên`,
      patternId: `break_at_${currentStreak}`
    };
  }
  
  return { detected: false };
}

function analyzeFollowAfterBreak(results, type) {
  if (results.length < 4) return { detected: false };
  
  // Kiểm tra xem có phải vừa bẻ cầu không
  const isBreak = results[0] !== results[1] && results[1] === results[2];
  
  if (isBreak) {
    // Sau khi bẻ, xu hướng mới thường kéo dài
    return {
      detected: true,
      prediction: results[1],
      confidence: 72,
      name: `Theo sau bẻ cầu (${results[1]})`,
      patternId: 'follow_after_break'
    };
  }
  
  return { detected: false };
}

// ==================== DỰ ĐOÁN CHÍNH (KHÔNG RANDOM) ====================

function calculateAdvancedPrediction(data, type) {
  const last50 = data.slice(0, 50);
  const results = last50.map(d => d.Ket_qua);
  const sums = last50.map(d => d.Tong);
  const dices = last50.map(d => ({ Xuc_xac_1: d.Xuc_xac_1, Xuc_xac_2: d.Xuc_xac_2, Xuc_xac_3: d.Xuc_xac_3 }));
  
  initializePatternStats(type);
  
  // 1. PHÂN TÍCH CẦU HIỆN TẠI
  const cauInfo = analyzeCauType(results);
  
  // 2. QUYẾT ĐỊNH BẺ CẦU
  const breakDecision = shouldBreakCau(results, cauInfo, type);
  
  // 3. QUYẾT ĐỊNH THEO CẦU
  const followDecision = shouldFollowCau(results, cauInfo, type);
  
  // 4. PHÂN TÍCH TỔNG ĐIỂM
  const sumTrend = analyzeSumTrend(sums);
  
  // 5. PHÂN TÍCH XÚC SẮC
  const diceAnalysis = analyzeDiceDetails(dices);
  
  // 6. PHÂN TÍCH ĐỘ CHÍNH XÁC LỊCH SỬ
  const accuracyPattern = analyzeAccuracyPattern(type);
  
  // 7. CHẠY CÁC PATTERN CHUYÊN SÂU
  let predictions = [];
  
  // Pattern bẻ cầu mới
  const breakAtPeak = analyzeBreakAtPeak(results, type);
  if (breakAtPeak.detected) predictions.push(breakAtPeak);
  
  const breakAtLength = analyzeBreakAtSpecificLength(results, type);
  if (breakAtLength.detected) predictions.push(breakAtLength);
  
  // Pattern theo cầu
  const followStrength = analyzeFollowStrength(results, type);
  if (followStrength.detected) predictions.push(followStrength);
  
  const followAfterBreak = analyzeFollowAfterBreak(results, type);
  if (followAfterBreak.detected) predictions.push(followAfterBreak);
  
  // Pattern cũ quan trọng
  const cauBet = analyzeCauBet(results, type);
  if (cauBet.detected) predictions.push(cauBet);
  
  const cauDao = analyzeCauDao11(results, type);
  if (cauDao.detected) predictions.push(cauDao);
  
  const cau22 = analyzeCau22(results, type);
  if (cau22.detected) predictions.push(cau22);
  
  const cau33 = analyzeCau33(results, type);
  if (cau33.detected) predictions.push(cau33);
  
  const smartBet = analyzeSmartBet(results, type);
  if (smartBet.detected) predictions.push(smartBet);
  
  const breakStreak = analyzeBreakStreak(results, type);
  if (breakStreak.detected) predictions.push(breakStreak);
  
  // 8. TỔNG HỢP VÀ TÍNH ĐIỂM
  let taiScore = 0;
  let xiuScore = 0;
  let totalWeight = 0;
  
  for (const pred of predictions) {
    const weight = getPatternWeight(type, pred.patternId);
    const score = pred.confidence * weight;
    
    if (pred.prediction === 'Tài') {
      taiScore += score;
    } else {
      xiuScore += score;
    }
    totalWeight += weight;
  }
  
  // Thêm phân tích cầu
  if (breakDecision.shouldBreak) {
    const breakWeight = getPatternWeight(type, 'break_pattern_advanced');
    if (breakDecision.prediction === 'Tài') {
      taiScore += breakDecision.confidence * breakWeight;
    } else {
      xiuScore += breakDecision.confidence * breakWeight;
    }
  } else if (followDecision.shouldFollow) {
    const followWeight = getPatternWeight(type, 'follow_strength');
    if (followDecision.prediction === 'Tài') {
      taiScore += followDecision.confidence * followWeight;
    } else {
      xiuScore += followDecision.confidence * followWeight;
    }
  }
  
  // Thêm phân tích tổng
  if (sumTrend.nextRange) {
    const sumWeight = getPatternWeight(type, 'sum_trend');
    if (sumTrend.nextRange === 'Tài') {
      taiScore += sumTrend.strength * sumWeight;
    } else if (sumTrend.nextRange === 'Xỉu') {
      xiuScore += sumTrend.strength * sumWeight;
    }
  }
  
  // Thêm phân tích xúc sắc
  if (diceAnalysis.prediction) {
    const diceWeight = getPatternWeight(type, 'dice_pattern');
    if (diceAnalysis.prediction === 'Tài') {
      taiScore += diceAnalysis.confidence * diceWeight;
    } else {
      xiuScore += diceAnalysis.confidence * diceWeight;
    }
  }
  
  // 9. XÁC ĐỊNH DỰ ĐOÁN CUỐI CÙNG
  let finalPrediction;
  let finalConfidence;
  
  if (accuracyPattern.shouldReverse) {
    // Đảo ngược nếu độ chính xác quá thấp
    finalPrediction = taiScore >= xiuScore ? 'Xỉu' : 'Tài';
    finalConfidence = Math.min(75, Math.max(60, Math.abs(taiScore - xiuScore) / (totalWeight + 1) + 55));
  } else {
    finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
    
    // Tính confidence dựa trên chênh lệch điểm
    const scoreDiff = Math.abs(taiScore - xiuScore);
    const maxPossibleScore = totalWeight * 100;
    let confidence = 60 + (scoreDiff / (maxPossibleScore + 1)) * 25;
    
    // Điều chỉnh theo độ mạnh của cầu
    if (cauInfo.strength > 70) {
      confidence += 5;
    }
    
    // Điều chỉnh theo accuracy pattern
    confidence += accuracyPattern.adjustment;
    
    finalConfidence = Math.min(92, Math.max(60, Math.round(confidence)));
  }
  
  // 10. CẬP NHẬT LỊCH SỬ CẦU
  learningData[type].cauTracking.currentCau = cauInfo;
  learningData[type].cauTracking.cauHistory.unshift({
    timestamp: new Date().toISOString(),
    cauInfo,
    breakDecision: breakDecision.shouldBreak,
    followDecision: followDecision.shouldFollow,
    finalPrediction
  });
  
  if (learningData[type].cauTracking.cauHistory.length > 100) {
    learningData[type].cauTracking.cauHistory = learningData[type].cauTracking.cauHistory.slice(0, 100);
  }
  
  // Tạo mô tả chi tiết
  const factors = [];
  if (breakDecision.shouldBreak) factors.push(`🔨 ${breakDecision.reason}`);
  if (followDecision.shouldFollow) factors.push(`📈 ${followDecision.reason}`);
  if (cauInfo.type !== 'unknown') factors.push(`🎯 Cầu ${cauInfo.type} (độ mạnh ${cauInfo.strength}%)`);
  if (sumTrend.nextRange) factors.push(`📊 Tổng: ${sumTrend.trend === 'increasing' ? 'tăng' : sumTrend.trend === 'decreasing' ? 'giảm' : sumTrend.trend}`);
  if (diceAnalysis.prediction) factors.push(`🎲 ${diceAnalysis.reason || 'Phân tích xúc sắc'}`);
  
  return {
    prediction: finalPrediction,
    confidence: finalConfidence,
    factors,
    cauAnalysis: {
      type: cauInfo.type,
      direction: cauInfo.direction,
      length: cauInfo.length,
      strength: cauInfo.strength,
      shouldBreak: breakDecision.shouldBreak,
      breakReason: breakDecision.reason,
      shouldFollow: followDecision.shouldFollow,
      followReason: followDecision.reason
    },
    sumTrend: sumTrend,
    detailedAnalysis: {
      totalPatterns: predictions.length,
      taiScore: Math.round(taiScore),
      xiuScore: Math.round(xiuScore),
      topPattern: predictions[0]?.name || 'Phân tích cầu',
      accuracyAdjustment: accuracyPattern.adjustment,
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

// ==================== CÁC HÀM HỖ TRỢ (GIỮ NGUYÊN TỪ PHIÊN BẢN TRƯỚC) ====================

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
  if (!patternId) return 1.0;
  initializePatternStats(type);
  return learningData[type].patternWeights[patternId] || 1.0;
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
      confidence = 85;
    } else if (streakLength >= 5) {
      shouldBreak = true;
      confidence = 75;
    } else if (streakLength >= 3) {
      shouldBreak = false;
      confidence = 68;
    }
    
    return { 
      detected: true, 
      type: streakType, 
      length: streakLength,
      prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
      confidence: Math.round(confidence * Math.min(1.2, weight)),
      name: `Cầu Bệt ${streakLength} phiên ${streakType}`,
      patternId: 'cau_bet'
    };
  }
  
  return { detected: false };
}

function analyzeCauDao11(results, type) {
  if (results.length < 4) return { detected: false };
  
  let alternatingLength = 1;
  for (let i = 1; i < Math.min(results.length, 10); i++) {
    if (results[i] !== results[i - 1]) {
      alternatingLength++;
    } else {
      break;
    }
  }
  
  if (alternatingLength >= 4) {
    const weight = getPatternWeight(type, 'cau_dao_11');
    const confidence = Math.min(80, 65 + alternatingLength * 2);
    
    return { 
      detected: true, 
      length: alternatingLength,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(confidence * Math.min(1.2, weight)),
      name: `Cầu Đảo 1-1 (${alternatingLength} phiên)`,
      patternId: 'cau_dao_11'
    };
  }
  
  return { detected: false };
}

function analyzeCau22(results, type) {
  if (results.length < 6) return { detected: false };
  
  let pairCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 1 && pairCount < 4) {
    if (results[i] === results[i + 1]) {
      pattern.push(results[i]);
      pairCount++;
      i += 2;
    } else {
      break;
    }
  }
  
  if (pairCount >= 2) {
    let isAlternating = true;
    for (let j = 1; j < pattern.length; j++) {
      if (pattern[j] === pattern[j - 1]) {
        isAlternating = false;
        break;
      }
    }
    
    if (isAlternating) {
      const lastPairType = pattern[pattern.length - 1];
      const weight = getPatternWeight(type, 'cau_22');
      
      return { 
        detected: true, 
        pairCount,
        prediction: lastPairType === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(Math.min(78, 65 + pairCount * 3) * Math.min(1.2, weight)),
        name: `Cầu 2-2 (${pairCount} cặp)`,
        patternId: 'cau_22'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCau33(results, type) {
  if (results.length < 6) return { detected: false };
  
  let tripleCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 2) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
      pattern.push(results[i]);
      tripleCount++;
      i += 3;
    } else {
      break;
    }
  }
  
  if (tripleCount >= 1) {
    const currentPosition = results.length % 3;
    const lastTripleType = pattern[pattern.length - 1];
    const weight = getPatternWeight(type, 'cau_33');
    
    let prediction;
    if (currentPosition === 0) {
      prediction = lastTripleType === 'Tài' ? 'Xỉu' : 'Tài';
    } else {
      prediction = lastTripleType;
    }
    
    return { 
      detected: true, 
      tripleCount,
      prediction,
      confidence: Math.round(Math.min(80, 68 + tripleCount * 4) * Math.min(1.2, weight)),
      name: `Cầu 3-3 (${tripleCount} bộ ba)`,
      patternId: 'cau_33'
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
      confidence: Math.round(78 * Math.min(1.2, weight)),
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
      confidence: Math.round(82 * Math.min(1.2, weight)),
      name: `Xu Hướng Cực (${taiLast10}T-${10-taiLast10}X) → Đảo`,
      patternId: 'smart_bet'
    };
  }
  
  return { detected: false };
}

function analyzeBreakStreak(results, type) {
  if (results.length < 5) return { detected: false };
  
  const weight = getPatternWeight(type, 'break_streak');
  
  let streakType = results[0];
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 5) {
    const prediction = streakType === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: Math.round(Math.min(85, 70 + streakLength) * Math.min(1.2, weight)),
      name: `Bẻ Chuỗi ${streakLength} (${streakType} → ${prediction})`,
      patternId: 'break_streak'
    };
  }
  
  return { detected: false };
}

// ==================== API ENDPOINTS ====================

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
    id: '@tiendataox',
    timestamp: new Date().toISOString()
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
        
        // Cập nhật lịch sử theo cầu thành công
        if (pred.prediction === learningData[type].cauTracking.currentCau?.nextPrediction) {
          learningData[type].cauTracking.followHistory.unshift({ success: true, timestamp: new Date() });
        } else {
          learningData[type].cauTracking.breakHistory.unshift({ success: true, timestamp: new Date() });
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
        
        // Cập nhật lịch sử thất bại
        if (pred.prediction === learningData[type].cauTracking.currentCau?.nextPrediction) {
          learningData[type].cauTracking.followHistory.unshift({ success: false, timestamp: new Date() });
        } else {
          learningData[type].cauTracking.breakHistory.unshift({ success: false, timestamp: new Date() });
        }
      }
      
      learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 50) {
        learningData[type].recentAccuracy.shift();
      }
      
      // Giới hạn lịch sử
      if (learningData[type].cauTracking.followHistory.length > 50) {
        learningData[type].cauTracking.followHistory = learningData[type].cauTracking.followHistory.slice(0, 50);
      }
      if (learningData[type].cauTracking.breakHistory.length > 50) {
        learningData[type].cauTracking.breakHistory = learningData[type].cauTracking.breakHistory.slice(0, 50);
      }
      
      updated = true;
    }
  }
  
  if (updated) {
    learningData[type].lastUpdate = new Date().toISOString();
    saveLearningData();
  }
}

function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = fs.readFileSync(LEARNING_FILE, 'utf8');
      const parsed = JSON.parse(data);
      learningData = { ...learningData, ...parsed };
      console.log('✅ Learning data loaded successfully');
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
      console.log('✅ Prediction history loaded successfully');
    }
  } catch (error) {
    console.error('Error loading prediction history:', error.message);
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
    console.error('Error saving prediction history:', error.message);
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
        savePredictionToHistory('hu', nextHuPhien, result.prediction, result.confidence, dataHu[0]);
        recordPrediction('hu', nextHuPhien, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.hu = nextHuPhien;
        console.log(`[Auto] HU phiên ${nextHuPhien}: ${result.prediction} (${result.confidence}%) - Cầu: ${result.cauAnalysis.type || 'unknown'}`);
      }
    }
    
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      const latestMd5Phien = dataMd5[0].Phien;
      const nextMd5Phien = latestMd5Phien + 1;
      
      if (lastProcessedPhien.md5 !== nextMd5Phien) {
        await verifyPredictions('md5', dataMd5);
        const result = calculateAdvancedPrediction(dataMd5, 'md5');
        savePredictionToHistory('md5', nextMd5Phien, result.prediction, result.confidence, dataMd5[0]);
        recordPrediction('md5', nextMd5Phien, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.md5 = nextMd5Phien;
        console.log(`[Auto] MD5 phiên ${nextMd5Phien}: ${result.prediction} (${result.confidence}%) - Cầu: ${result.cauAnalysis.type || 'unknown'}`);
      }
    }
    
    savePredictionHistory();
    saveLearningData();
  } catch (error) {
    console.error('[Auto] Error:', error.message);
  }
}

function startAutoSaveTask() {
  console.log(`🔄 Auto-save task started (every ${AUTO_SAVE_INTERVAL/1000}s)`);
  setTimeout(() => autoProcessPredictions(), 5000);
  setInterval(() => autoProcessPredictions(), AUTO_SAVE_INTERVAL);
}

// ==================== API ENDPOINTS ====================

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send('t.me/CuTools - Tài Xỉu Predictor v10.0');
});

app.get('/lc79-hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data || data.length === 0) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('hu', data);
    
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    
    const result = calculateAdvancedPrediction(data, 'hu');
    
    const record = savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
    
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
      ket_qua_du_doan: record.ket_qua_du_doan || '',
      id: record.id,
      cau_analysis: result.cauAnalysis,
      factors: result.factors
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
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
      ket_qua_du_doan: record.ket_qua_du_doan || '',
      id: record.id,
      cau_analysis: result.cauAnalysis,
      factors: result.factors
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-hu/lichsu', async (req, res) => {
  await updateHistoryStatus('hu');
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
    history: predictionHistory.hu,
    total: predictionHistory.hu.length
  });
});

app.get('/lc79-md5/lichsu', async (req, res) => {
  await updateHistoryStatus('md5');
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu MD5',
    history: predictionHistory.md5,
    total: predictionHistory.md5.length
  });
});

app.get('/lc79-hu/analysis', async (req, res) => {
  const data = await fetchDataHu();
  if (!data || data.length === 0) {
    return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
  }
  await verifyPredictions('hu', data);
  const result = calculateAdvancedPrediction(data, 'hu');
  res.json({
    prediction: result.prediction,
    confidence: result.confidence,
    factors: result.factors,
    cau_analysis: result.cauAnalysis,
    sum_trend: result.sumTrend,
    analysis: result.detailedAnalysis
  });
});

app.get('/lc79-md5/analysis', async (req, res) => {
  const data = await fetchDataMd5();
  if (!data || data.length === 0) {
    return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
  }
  await verifyPredictions('md5', data);
  const result = calculateAdvancedPrediction(data, 'md5');
  res.json({
    prediction: result.prediction,
    confidence: result.confidence,
    factors: result.factors,
    cau_analysis: result.cauAnalysis,
    sum_trend: result.sumTrend,
    analysis: result.detailedAnalysis
  });
});

async function updateHistoryStatus(type) {
  try {
    let data = type === 'hu' ? await fetchDataHu() : await fetchDataMd5();
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

// Khởi động server
loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║     LẨU CUA 79 - TÀI XỈU PREDICTOR PRO v10.0                ║
║     🎯 Bẻ cầu thông minh | Theo cầu chính xác               ║
║     📊 Phân tích dữ liệu thực | Không random                ║
╠══════════════════════════════════════════════════════════════╣
║  🌐 Server: http://0.0.0.0:${PORT}                            ║
║  📁 Files: tiendat.json, tiendat1.json                      ║
║  👤 ID: @tiendataox                                          ║
╠══════════════════════════════════════════════════════════════╣
║  CÁC CẢI TIẾN NÂNG CẤP:                                     ║
║  ✅ Bẻ cầu thông minh tại mốc 5,7,10 phiên                  ║
║  ✅ Theo cầu khi xu hướng mạnh (điểm >=3)                   ║
║  ✅ Phân tích tổng điểm xu hướng tăng/giảm                  ║
║  ✅ Phân tích mặt xúc sắc hay xuất hiện                     ║
║  ✅ Điều chỉnh dự đoán theo độ chính xác lịch sử            ║
║  ✅ Loại bỏ hoàn toàn yếu tố random                         ║
╚══════════════════════════════════════════════════════════════╝
  `);
  
  startAutoSaveTask();
});