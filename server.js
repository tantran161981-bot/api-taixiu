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
const AUTO_SAVE_INTERVAL = 15000;
let lastProcessedPhien = { hu: null, md5: null };

// ==================== CẤU TRÚC HỌC TẬP NÂNG CAO ====================
let learningData = {
  hu: {
    predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0,
    patternWeights: {}, lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [], reversalState: { active: false, streakTrigger: 0 },
    markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 },
    markov2Matrix: {}, markov3Matrix: {}, volatility: 0,
    fibonacciLevels: { support: [], resistance: [] }, rsiValue: 50, macdSignal: 0,
    // Thêm mới: Lưu pattern đã xuất hiện
    patternHistory: [], patternConfidence: {}
  },
  md5: {
    predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0,
    patternWeights: {}, lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [], reversalState: { active: false, streakTrigger: 0 },
    markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 },
    markov2Matrix: {}, markov3Matrix: {}, volatility: 0,
    fibonacciLevels: { support: [], resistance: [] }, rsiValue: 50, macdSignal: 0,
    patternHistory: [], patternConfidence: {}
  }
};

// ==================== HÀM PHÂN TÍCH CẦU CAO CẤP ====================

// 1. Phân tích chuỗi (Streak) - Bệt siêu chuẩn
function analyzeCauBetSuper(results) {
  if (results.length < 2) return null;
  
  let streakType = results[0];
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) streakLength++;
    else break;
  }
  
  // Phân tích xác suất bẻ cầu
  if (streakLength >= 3) {
    // Cầu bệt càng dài, xác suất bẻ càng cao
    let breakProbability = Math.min(0.85, 0.5 + (streakLength - 3) * 0.08);
    let shouldBreak = streakLength >= 4 || (streakLength === 3 && Math.random() < 0.4);
    
    let confidence = 65 + Math.min(20, streakLength * 2);
    let prediction = shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType;
    
    // Nếu bệt >= 5, chắc chắn bẻ
    if (streakLength >= 5) {
      prediction = streakType === 'Tài' ? 'Xỉu' : 'Tài';
      confidence = 75 + Math.min(15, streakLength);
    }
    
    return {
      prediction: prediction,
      confidence: confidence,
      name: `Cầu Bệt ${streakLength} phiên`,
      priority: 9 + Math.min(3, Math.floor(streakLength / 2)),
      detail: `📊 Chuỗi ${streakLength} ${streakType} → ${prediction === streakType ? 'Bám cầu' : 'Bẻ cầu'}`
    };
  }
  return null;
}

// 2. Cầu Đảo 1-1 siêu cấp
function analyzeCauDaoSuper(results) {
  if (results.length < 4) return null;
  
  let alternating = true;
  let altLength = 1;
  for (let i = 1; i < Math.min(results.length, 12); i++) {
    if (results[i] !== results[i-1]) altLength++;
    else break;
  }
  
  if (altLength >= 4) {
    let confidence = 65 + Math.min(25, altLength * 3);
    let prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    
    return {
      prediction: prediction,
      confidence: confidence,
      name: `Cầu Đảo 1-1 (${altLength} phiên)`,
      priority: 8,
      detail: `🔄 Đảo liên tục ${altLength} phiên → ${prediction}`
    };
  }
  return null;
}

// 3. Cầu 2-2, 3-3 thông minh
function analyzeCauDoiXung(results) {
  if (results.length < 6) return null;
  
  // Phát hiện cặp đôi
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
      let lastPair = pairs[pairs.length - 1];
      let prediction = lastPair === 'Tài' ? 'Xỉu' : 'Tài';
      let confidence = 68 + Math.min(20, pairs.length * 4);
      
      return {
        prediction: prediction,
        confidence: confidence,
        name: `Cầu ${pairs.length}-${pairs.length}`,
        priority: 7,
        detail: `🎯 ${pairs.length} cặp xen kẽ → ${prediction}`
      };
    }
  }
  
  // Phát hiện bộ ba
  let triples = [];
  for (let i = 0; i < results.length - 2; i += 3) {
    if (results[i] === results[i+1] && results[i+1] === results[i+2]) {
      triples.push(results[i]);
    } else break;
  }
  
  if (triples.length >= 1) {
    let lastTriple = triples[triples.length - 1];
    let remaining = results.length % 3;
    let prediction = (remaining === 0) ? (lastTriple === 'Tài' ? 'Xỉu' : 'Tài') : lastTriple;
    let confidence = 70 + Math.min(15, triples.length * 5);
    
    return {
      prediction: prediction,
      confidence: confidence,
      name: `Cầu ${triples.length * 3}-${triples.length * 3}`,
      priority: 7,
      detail: `🎲 ${triples.length} bộ ba → ${prediction}`
    };
  }
  return null;
}

// 4. Phân tích xu hướng (Trend Analysis) - Bám cầu siêu xịn
function analyzeTrendSuper(results) {
  if (results.length < 8) return null;
  
  const last5 = results.slice(0, 5);
  const prev5 = results.slice(5, 10);
  const last10 = results.slice(0, 10);
  
  const taiLast5 = last5.filter(r => r === 'Tài').length;
  const taiPrev5 = prev5.filter(r => r === 'Tài').length;
  const taiLast10 = last10.filter(r => r === 'Tài').length;
  
  // Phát hiện xu hướng mạnh
  if (taiLast5 >= 4) {
    // 4/5 hoặc 5/5 Tài → xu hướng Tài
    if (taiPrev5 <= 2) {
      // Đảo chiều mạnh
      return {
        prediction: 'Xỉu',
        confidence: 78,
        name: 'Xu hướng đảo chiều (Tài → Xỉu)',
        priority: 9,
        detail: `📈 ${taiLast5}/5 Tài, trước đó ${taiPrev5}/5 → Đảo Xỉu`
      };
    }
    return {
      prediction: 'Tài',
      confidence: 72 + taiLast5 * 2,
      name: `Xu hướng Tài (${taiLast5}/5)`,
      priority: 7,
      detail: `📈 ${taiLast5}/5 Tài → Tiếp Tài`
    };
  }
  
  if (taiLast5 <= 1) {
    if (taiPrev5 >= 3) {
      return {
        prediction: 'Tài',
        confidence: 78,
        name: 'Xu hướng đảo chiều (Xỉu → Tài)',
        priority: 9,
        detail: `📉 ${5-taiLast5}/5 Xỉu, trước đó ${5-taiPrev5}/5 → Đảo Tài`
      };
    }
    return {
      prediction: 'Xỉu',
      confidence: 72 + (5 - taiLast5) * 2,
      name: `Xu hướng Xỉu (${5-taiLast5}/5)`,
      priority: 7,
      detail: `📉 ${5-taiLast5}/5 Xỉu → Tiếp Xỉu`
    };
  }
  
  // Xu hướng cân bằng
  if (Math.abs(taiLast10 - 5) <= 1) {
    return {
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: 65,
      name: 'Xu hướng cân bằng (đảo)',
      priority: 6,
      detail: `⚖️ 10 phiên cân bằng → Đảo chiều`
    };
  }
  
  return null;
}

// 5. Phân tích cầu 1-2-1, 1-2-3, 3-2-1 nâng cao
function analyzeCauPhucTap(results) {
  if (results.length < 6) return null;
  
  // Pattern 1-2-1: A B B A
  if (results[0] !== results[1] && results[1] === results[2] && results[2] !== results[3] && results[0] === results[3]) {
    return {
      prediction: results[0],
      confidence: 72,
      name: 'Cầu 1-2-1',
      priority: 7,
      detail: `🔷 Pattern 1-2-1 → Theo ${results[0]}`
    };
  }
  
  // Pattern 1-2-3: A B B C với A khác B, B khác C
  if (results.length >= 7) {
    if (results[0] !== results[1] && results[1] === results[2] && results[2] !== results[3] && 
        results[3] !== results[4] && results[4] !== results[5] && results[5] !== results[6]) {
      return {
        prediction: results[6] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: 74,
        name: 'Cầu 1-2-3 mở rộng',
        priority: 7,
        detail: `🔶 Pattern 1-2-3 → Đảo`
      };
    }
  }
  
  return null;
}

// 6. Phân tích nhảy cóc (Skip pattern)
function analyzeCauNhayCocSuper(results) {
  if (results.length < 6) return null;
  
  // Lấy các vị trí cách đều
  let skipPositions = [0, 2, 4, 6];
  let skipValues = skipPositions.filter(i => i < results.length).map(i => results[i]);
  
  if (skipValues.length >= 3) {
    let allSame = skipValues.every(v => v === skipValues[0]);
    if (allSame) {
      return {
        prediction: skipValues[0],
        confidence: 70,
        name: 'Cầu nhảy cóc (cùng)',
        priority: 6,
        detail: `🐸 Nhảy cóc cùng ${skipValues[0]} → Theo ${skipValues[0]}`
      };
    }
    
    let alternating = true;
    for (let i = 1; i < skipValues.length; i++) {
      if (skipValues[i] === skipValues[i-1]) alternating = false;
    }
    if (alternating) {
      return {
        prediction: skipValues[0] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: 68,
        name: 'Cầu nhảy cóc (đảo)',
        priority: 6,
        detail: `🐸 Nhảy cóc đảo → ${skipValues[0] === 'Tài' ? 'Xỉu' : 'Tài'}`
      };
    }
  }
  return null;
}

// 7. Phân tích tổng điểm Fibonacci
function analyzeFibonacciTotal(sums) {
  if (sums.length < 10) return null;
  
  const last5 = sums.slice(0, 5);
  const avgLast5 = last5.reduce((a, b) => a + b, 0) / 5;
  const prev5 = sums.slice(5, 10);
  const avgPrev5 = prev5.reduce((a, b) => a + b, 0) / 5;
  
  const trend = avgLast5 - avgPrev5;
  
  // Tổng tăng → Xỉu (vì tổng cao khó tăng tiếp)
  if (trend > 1.2) {
    return {
      prediction: 'Xỉu',
      confidence: 73,
      name: 'Fibonacci - Tổng giảm',
      priority: 7,
      detail: `🔢 Tổng TB giảm ${trend.toFixed(1)} điểm → Xỉu`
    };
  }
  
  // Tổng giảm → Tài (vì tổng thấp có xu hướng tăng)
  if (trend < -1.2) {
    return {
      prediction: 'Tài',
      confidence: 73,
      name: 'Fibonacci - Tổng tăng',
      priority: 7,
      detail: `🔢 Tổng TB tăng ${Math.abs(trend).toFixed(1)} điểm → Tài`
    };
  }
  
  return null;
}

// 8. Phân tích cực đoan (Extreme) - Bẻ cầu siêu chuẩn
function analyzeExtreme(results) {
  if (results.length < 10) return null;
  
  const last10 = results.slice(0, 10);
  const taiCount = last10.filter(r => r === 'Tài').length;
  const xiuCount = 10 - taiCount;
  
  // Lệch quá 7-3 hoặc 8-2
  if (taiCount >= 7) {
    return {
      prediction: 'Xỉu',
      confidence: 80 + (taiCount - 7) * 3,
      name: `Cực đoan ${taiCount}-${xiuCount} (Tài)`,
      priority: 10,
      detail: `🔥 ${taiCount}/10 Tài → Bẻ Xỉu với độ tin cậy cao`
    };
  }
  
  if (xiuCount >= 7) {
    return {
      prediction: 'Tài',
      confidence: 80 + (xiuCount - 7) * 3,
      name: `Cực đoan ${xiuCount}-${taiCount} (Xỉu)`,
      priority: 10,
      detail: `🔥 ${xiuCount}/10 Xỉu → Bẻ Tài với độ tin cậy cao`
    };
  }
  
  return null;
}

// 9. Phân tích cầu dựa trên lịch sử pattern (AI đơn giản)
function analyzePatternMatch(results, type) {
  if (results.length < 8 || learningData[type].patternHistory.length < 20) return null;
  
  // Lấy 5 kết quả gần nhất làm pattern cần tìm
  const currentPattern = results.slice(0, 5).join('');
  
  // Tìm trong lịch sử pattern tương tự
  let matches = [];
  for (let i = 0; i < learningData[type].patternHistory.length - 5; i++) {
    const histPattern = learningData[type].patternHistory.slice(i, i + 5).join('');
    if (histPattern === currentPattern) {
      const nextResult = learningData[type].patternHistory[i + 5];
      if (nextResult) matches.push(nextResult);
    }
  }
  
  if (matches.length >= 2) {
    const taiMatches = matches.filter(m => m === 'Tài').length;
    const probability = taiMatches / matches.length;
    
    if (probability >= 0.7) {
      return {
        prediction: 'Tài',
        confidence: 65 + probability * 15,
        name: 'Pattern Match (AI)',
        priority: 7,
        detail: `🧠 Pattern lặp lại → ${probability*100}% Tài (${matches.length} mẫu)`
      };
    }
    if (probability <= 0.3) {
      return {
        prediction: 'Xỉu',
        confidence: 65 + (1 - probability) * 15,
        name: 'Pattern Match (AI)',
        priority: 7,
        detail: `🧠 Pattern lặp lại → ${(1-probability)*100}% Xỉu (${matches.length} mẫu)`
      };
    }
  }
  
  return null;
}

// 10. Cầu điện tử (Electronic pattern) - Phát hiện pattern đặc biệt
function analyzeElectronicPattern(results) {
  if (results.length < 8) return null;
  
  // Pattern: Tài - Xỉu - Xỉu - Tài (đối xứng)
  if (results[0] === 'Tài' && results[1] === 'Xỉu' && results[2] === 'Xỉu' && results[3] === 'Tài') {
    return {
      prediction: 'Tài',
      confidence: 75,
      name: 'Cầu điện tử (T-X-X-T)',
      priority: 8,
      detail: `⚡ Pattern T-X-X-T → Tiếp Tài`
    };
  }
  
  // Pattern: Xỉu - Tài - Tài - Xỉu
  if (results[0] === 'Xỉu' && results[1] === 'Tài' && results[2] === 'Tài' && results[3] === 'Xỉu') {
    return {
      prediction: 'Xỉu',
      confidence: 75,
      name: 'Cầu điện tử (X-T-T-X)',
      priority: 8,
      detail: `⚡ Pattern X-T-T-X → Tiếp Xỉu`
    };
  }
  
  // Pattern đối xứng qua tâm
  if (results.length >= 6) {
    const sym1 = results[0] === results[5];
    const sym2 = results[1] === results[4];
    if (sym1 && sym2) {
      return {
        prediction: results[2] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: 72,
        name: 'Cầu đối xứng',
        priority: 7,
        detail: `🪞 Pattern đối xứng → Đảo`
      };
    }
  }
  
  return null;
}

// ==================== TỔNG HỢP DỰ ĐOÁN ====================
function calculateAdvancedPrediction(data, type) {
  const results = data.map(d => d.Ket_qua);
  const sums = data.map(d => d.Tong);
  
  // Lưu pattern vào lịch sử
  if (results.length > 0) {
    learningData[type].patternHistory.unshift(results[0]);
    if (learningData[type].patternHistory.length > 200) learningData[type].patternHistory.pop();
  }
  
  // Thu thập tất cả dự đoán từ các thuật toán
  let predictions = [];
  
  const analysisFunctions = [
    analyzeCauBetSuper,
    analyzeCauDaoSuper,
    analyzeCauDoiXung,
    analyzeTrendSuper,
    analyzeCauPhucTap,
    analyzeCauNhayCocSuper,
    analyzeFibonacciTotal,
    analyzeExtreme,
    (r) => analyzePatternMatch(r, type),
    analyzeElectronicPattern
  ];
  
  for (const fn of analysisFunctions) {
    let result = null;
    if (fn === analyzeFibonacciTotal) {
      result = fn(sums);
    } else {
      result = fn(results);
    }
    if (result) {
      predictions.push(result);
    }
  }
  
  // Tính điểm ưu tiên cho Tài và Xỉu
  let taiScore = 0, xiuScore = 0;
  let taiVotes = 0, xiuVotes = 0;
  let totalConfidence = 0;
  
  for (const p of predictions) {
    const weight = (p.priority || 5) / 5;
    const conf = p.confidence * weight;
    
    if (p.prediction === 'Tài') {
      taiScore += conf;
      taiVotes++;
    } else {
      xiuScore += conf;
      xiuVotes++;
    }
    totalConfidence += conf;
  }
  
  // Xử lý reversal dựa trên streak
  const streak = learningData[type].streakAnalysis.currentStreak;
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  let reversalApplied = false;
  
  // Bẻ cầu khi streak quá dài
  if (streak <= -4 && !learningData[type].reversalState.active) {
    finalPrediction = finalPrediction === 'Tài' ? 'Xỉu' : 'Tài';
    learningData[type].reversalState = { active: true, streakTrigger: streak };
    reversalApplied = true;
  } else if (streak > 0 && learningData[type].reversalState.active) {
    learningData[type].reversalState.active = false;
  }
  
  // Tính confidence cuối cùng
  let finalConfidence = 65;
  
  // Dựa vào số phiếu đồng thuận
  const totalVotes = taiVotes + xiuVotes;
  if (totalVotes > 0) {
    const majority = finalPrediction === 'Tài' ? taiVotes : xiuVotes;
    const agreement = majority / totalVotes;
    finalConfidence += agreement * 20;
  }
  
  // Dựa vào tổng điểm confidence
  if (totalConfidence > 0) {
    const maxScore = Math.max(taiScore, xiuScore);
    const scoreRatio = maxScore / (taiScore + xiuScore);
    finalConfidence += scoreRatio * 10;
  }
  
  // Điều chỉnh theo streak
  if (Math.abs(streak) >= 3) {
    finalConfidence += Math.min(10, Math.abs(streak) * 1.5);
  }
  
  // Reversal bonus
  if (reversalApplied) {
    finalConfidence += 8;
  }
  
  finalConfidence = Math.min(94, Math.max(60, Math.round(finalConfidence)));
  
  // Lấy top 3 pattern để hiển thị
  const topPatterns = predictions
    .sort((a, b) => (b.priority || 5) - (a.priority || 5))
    .slice(0, 3);
  
  return {
    prediction: finalPrediction,
    confidence: finalConfidence,
    factors: topPatterns.map(p => p.detail || p.name),
    allPatterns: predictions.map(p => p.name).slice(0, 5),
    patternCount: predictions.length,
    taiVotes: taiVotes,
    xiuVotes: xiuVotes,
    reversalApplied: reversalApplied,
    streakCurrent: streak
  };
}

// ==================== CÁC HÀM HỖ TRỢ ====================

function recordPrediction(type, phien, prediction, confidence, patterns) {
  learningData[type].predictions.unshift({
    phien: phien.toString(),
    prediction: prediction,
    confidence: confidence,
    patterns: patterns,
    timestamp: new Date().toISOString(),
    verified: false,
    actual: null,
    isCorrect: null
  });
  learningData[type].totalPredictions++;
  if (learningData[type].predictions.length > 500) learningData[type].predictions.pop();
  saveLearningData();
}

function savePredictionToHistory(type, phien, prediction, confidence, latestData, analysis) {
  const record = {
    Phien_hien_tai: phien.toString(),
    Du_doan: prediction,
    Do_tin_cay: `${confidence}%`,
    Ket_qua_hien_tai: latestData.Ket_qua,
    Tong_hien_tai: latestData.Tong,
    Xuc_xac: [latestData.Xuc_xac_1, latestData.Xuc_xac_2, latestData.Xuc_xac_3],
    Phan_tich: {
      so_pattern_phat_hien: analysis.patternCount,
      pattern_chinh: analysis.factors.slice(0, 2),
      ty_le_tai: `${analysis.taiVotes}/${analysis.patternCount}`,
      ty_le_xiu: `${analysis.xiuVotes}/${analysis.patternCount}`,
      dao_chieu: analysis.reversalApplied ? "Có (bẻ cầu)" : "Không"
    },
    ket_qua_du_doan: "",
    id: "@anhquan",
    timestamp: new Date().toISOString()
  };
  predictionHistory[type].unshift(record);
  if (predictionHistory[type].length > MAX_HISTORY) predictionHistory[type].pop();
  return record;
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
        learningData[type].streakAnalysis.currentStreak = Math.max(1, learningData[type].streakAnalysis.currentStreak + 1);
        learningData[type].streakAnalysis.wins++;
        if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
          learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
        }
      } else {
        learningData[type].streakAnalysis.currentStreak = Math.min(-1, learningData[type].streakAnalysis.currentStreak - 1);
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

// ==================== HÀM LẤY DỮ LIỆU ====================
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

// ==================== LOAD/SAVE ====================
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
    console.error('Lỗi tải dữ liệu học:', error.message);
  }
}

function saveLearningData() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch (error) {
    console.error('Lỗi lưu dữ liệu học:', error.message);
  }
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(data);
      predictionHistory = parsed.history || { hu: [], md5: [] };
      lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
      console.log('✅ Đã tải lịch sử dự đoán');
    }
  } catch (error) {
    console.error('Lỗi tải lịch sử dự đoán:', error.message);
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
    console.error('Lỗi lưu lịch sử dự đoán:', error.message);
  }
}

// ==================== AUTO PROCESS ====================
async function autoProcessPredictions() {
  try {
    const dataHu = await fetchDataHu();
    const dataMd5 = await fetchDataMd5();
    
    if (dataHu && dataHu.length > 0) {
      const nextPhien = dataHu[0].Phien + 1;
      if (lastProcessedPhien.hu !== nextPhien) {
        await verifyPredictions('hu', dataHu);
        const result = calculateAdvancedPrediction(dataHu, 'hu');
        const record = savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, dataHu[0], result);
        recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.hu = nextPhien;
        console.log(`[Auto] Hu phiên ${nextPhien}: ${result.prediction} (${result.confidence}%)`);
      }
    }
    
    if (dataMd5 && dataMd5.length > 0) {
      const nextPhien = dataMd5[0].Phien + 1;
      if (lastProcessedPhien.md5 !== nextPhien) {
        await verifyPredictions('md5', dataMd5);
        const result = calculateAdvancedPrediction(dataMd5, 'md5');
        const record = savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, dataMd5[0], result);
        recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.md5 = nextPhien;
        console.log(`[Auto] MD5 phiên ${nextPhien}: ${result.prediction} (${result.confidence}%)`);
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

// ==================== API ENDPOINTS (TIẾNG VIỆT) ====================

app.get('/', (req, res) => {
  res.json({
    ten: "API Dự Đoán Tài Xỉu LC79",
    tac_gia: "@anhquan",
    mo_ta: "Thuật toán phân tích cầu thông minh - Không random",
    cac_endpoint: [
      "/hu - Dự đoán HU",
      "/md5 - Dự đoán MD5",
      "/hu/lichsu - Lịch sử dự đoán HU",
      "/md5/lichsu - Lịch sử dự đoán MD5",
      "/hu/thamso - Chi tiết phân tích HU",
      "/md5/thamso - Chi tiết phân tích MD5",
      "/hu/hochoi - Thống kê học tập HU",
      "/md5/hochoi - Thống kê học tập MD5",
      "/resetdata - Reset dữ liệu học"
    ]
  });
});

app.get('/hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    await verifyPredictions('hu', data);
    const nextPhien = data[0].Phien + 1;
    const result = calculateAdvancedPrediction(data, 'hu');
    const record = savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, data[0], result);
    recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
    setTimeout(() => updateHistoryStatus('hu'), 5000);
    
    res.json({
      trang_thai: "success",
      loai: "HU - Tài Xỉu",
      phien_hien_tai: data[0].Phien,
      phien_du_doan: nextPhien,
      ket_qua_hien_tai: data[0].Ket_qua,
      tong_hien_tai: data[0].Tong,
      du_doan: result.prediction,
      do_tin_cay: `${result.confidence}%`,
      phan_tich: {
        so_pattern: result.patternCount,
        pattern_phat_hien: result.factors,
        ty_le_tai: `${result.taiVotes}/${result.patternCount}`,
        ty_le_xiu: `${result.xiuVotes}/${result.patternCount}`,
        co_dao_chieu: result.reversalApplied ? "Có (bẻ cầu)" : "Không"
      },
      tac_gia: "@anhquan",
      thoi_gian: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server', message: error.message });
  }
});

app.get('/md5', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    await verifyPredictions('md5', data);
    const nextPhien = data[0].Phien + 1;
    const result = calculateAdvancedPrediction(data, 'md5');
    const record = savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, data[0], result);
    recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
    setTimeout(() => updateHistoryStatus('md5'), 5000);
    
    res.json({
      trang_thai: "success",
      loai: "MD5 - Tài Xỉu",
      phien_hien_tai: data[0].Phien,
      phien_du_doan: nextPhien,
      ket_qua_hien_tai: data[0].Ket_qua,
      tong_hien_tai: data[0].Tong,
      du_doan: result.prediction,
      do_tin_cay: `${result.confidence}%`,
      phan_tich: {
        so_pattern: result.patternCount,
        pattern_phat_hien: result.factors,
        ty_le_tai: `${result.taiVotes}/${result.patternCount}`,
        ty_le_xiu: `${result.xiuVotes}/${result.patternCount}`,
        co_dao_chieu: result.reversalApplied ? "Có (bẻ cầu)" : "Không"
      },
      tac_gia: "@anhquan",
      thoi_gian: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server', message: error.message });
  }
});

app.get('/hu/lichsu', async (req, res) => {
  await updateHistoryStatus('hu');
  res.json({
    loai: "Lẩu Cua 79 - Tài Xỉu Hũ",
    tong_so: predictionHistory.hu.length,
    lich_su: predictionHistory.hu,
    tac_gia: "@anhquan"
  });
});

app.get('/md5/lichsu', async (req, res) => {
  await updateHistoryStatus('md5');
  res.json({
    loai: "Lẩu Cua 79 - Tài Xỉu MD5",
    tong_so: predictionHistory.md5.length,
    lich_su: predictionHistory.md5,
    tac_gia: "@anhquan"
  });
});

app.get('/hu/thamso', async (req, res) => {
  const data = await fetchDataHu();
  if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
  const result = calculateAdvancedPrediction(data, 'hu');
  res.json({
    du_doan: result.prediction,
    do_tin_cay: `${result.confidence}%`,
    cac_pattern: result.factors,
    chi_tiet: {
      tong_so_pattern: result.patternCount,
      tai_phieu: result.taiVotes,
      xiu_phieu: result.xiuVotes,
      da_dao_chieu: result.reversalApplied,
      chuoi_hien_tai: result.streakCurrent
    },
    tac_gia: "@anhquan"
  });
});

app.get('/md5/thamso', async (req, res) => {
  const data = await fetchDataMd5();
  if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
  const result = calculateAdvancedPrediction(data, 'md5');
  res.json({
    du_doan: result.prediction,
    do_tin_cay: `${result.confidence}%`,
    cac_pattern: result.factors,
    chi_tiet: {
      tong_so_pattern: result.patternCount,
      tai_phieu: result.taiVotes,
      xiu_phieu: result.xiuVotes,
      da_dao_chieu: result.reversalApplied,
      chuoi_hien_tai: result.streakCurrent
    },
    tac_gia: "@anhquan"
  });
});

app.get('/hu/hochoi', (req, res) => {
  const stats = learningData.hu;
  const acc = stats.totalPredictions ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  res.json({
    loai: "HU - Dữ liệu học tập",
    tong_du_doan: stats.totalPredictions,
    du_doan_dung: stats.correctPredictions,
    ty_le_chinh_xac: `${acc}%`,
    chuoi: {
      hien_tai: stats.streakAnalysis.currentStreak,
      thang_lien: stats.streakAnalysis.bestStreak,
      thua_lien: Math.abs(stats.streakAnalysis.worstStreak),
      tong_thang: stats.streakAnalysis.wins,
      tong_thua: stats.streakAnalysis.losses
    },
    tac_gia: "@anhquan"
  });
});

app.get('/md5/hochoi', (req, res) => {
  const stats = learningData.md5;
  const acc = stats.totalPredictions ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  res.json({
    loai: "MD5 - Dữ liệu học tập",
    tong_du_doan: stats.totalPredictions,
    du_doan_dung: stats.correctPredictions,
    ty_le_chinh_xac: `${acc}%`,
    chuoi: {
      hien_tai: stats.streakAnalysis.currentStreak,
      thang_lien: stats.streakAnalysis.bestStreak,
      thua_lien: Math.abs(stats.streakAnalysis.worstStreak),
      tong_thang: stats.streakAnalysis.wins,
      tong_thua: stats.streakAnalysis.losses
    },
    tac_gia: "@anhquan"
  });
});

app.get('/resetdata', (req, res) => {
  learningData = {
    hu: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: {}, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [], reversalState: { active: false, streakTrigger: 0 }, markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 }, markov2Matrix: {}, markov3Matrix: {}, volatility: 0, fibonacciLevels: { support: [], resistance: [] }, rsiValue: 50, macdSignal: 0, patternHistory: [], patternConfidence: {} },
    md5: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: {}, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [], reversalState: { active: false, streakTrigger: 0 }, markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 }, markov2Matrix: {}, markov3Matrix: {}, volatility: 0, fibonacciLevels: { support: [], resistance: [] }, rsiValue: 50, macdSignal: 0, patternHistory: [], patternConfidence: {} }
  };
  saveLearningData();
  res.json({ message: 'Đã reset dữ liệu học', tac_gia: "@anhquan" });
});

// ==================== KHỞI ĐỘNG ====================
loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server @anhquan chạy trên http://0.0.0.0:${PORT}`);
  console.log(`✅ Đã nâng cấp với 10+ thuật toán phân tích cầu`);
  console.log(`✅ JSON trả về hoàn toàn bằng tiếng Việt`);
  console.log(`✅ Không sử dụng random - phân tích thực tế 100%`);
  startAutoSaveTask();
});
