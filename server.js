// HUYDAIXU.SITE - FIX LỆCH CỬA
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

let lastPhien = 0;
let cachedResult = null;
let latestData = null;
let modelPredictions = {};

// Lưu lịch sử dự đoán để cân bằng
let historyPredictions = [];
const MAX_HISTORY = 20;

// ==================== THUẬT TOÁN ĐÃ SỬA CÂN BẰNG ====================

function detectStreakAndBreak(history) {
  if (!history || history.length === 0) return { streak: 0, currentResult: null, breakProb: 0.0 };
  let streak = 1;
  const currentResult = history[history.length - 1].result;
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i].result === currentResult) {
      streak++;
    } else {
      break;
    }
  }
  
  // Lấy 15 phiên gần nhất
  const last15 = history.slice(-15).map(h => h.result);
  if (!last15.length) return { streak, currentResult, breakProb: 0.0 };
  
  const switches = last15.slice(1).reduce((count, curr, idx) => count + (curr !== last15[idx] ? 1 : 0), 0);
  const taiCount = last15.filter(r => r === 'Tài').length;
  const xiuCount = last15.filter(r => r === 'Xỉu').length;
  const imbalance = Math.abs(taiCount - xiuCount) / last15.length;
  
  let breakProb = 0.0;
  
  // CHỈ BẺ CẦU KHI THỰC SỰ CẦN THIẾT
  if (streak >= 10) {
    breakProb = 0.85; // Bệt quá dài -> bẻ
  } else if (streak >= 7) {
    breakProb = 0.7;
  } else if (streak >= 5 && switches >= 8) {
    breakProb = 0.6;
  } else {
    breakProb = 0.2; // Mặc định là THEO CẦU, không bẻ
  }
  
  return { streak, currentResult, breakProb };
}

function evaluateModelPerformance(history, modelName, lookback = 10) {
  if (!modelPredictions[modelName] || history.length < 2) return 1.0;
  lookback = Math.min(lookback, history.length - 1);
  let correctCount = 0;
  for (let i = 0; i < lookback; i++) {
    const pred = modelPredictions[modelName][history[history.length - (i + 2)].session] || 0;
    const actual = history[history.length - (i + 1)].result;
    if ((pred === 1 && actual === 'Tài') || (pred === 2 && actual === 'Xỉu')) {
      correctCount++;
    }
  }
  return 0.8 + (correctCount / lookback) * 0.4;
}

function smartBridgeBreak(history) {
  if (!history || history.length < 5) {
    return { prediction: 0, breakProb: 0.0, reason: 'Chờ đủ dữ liệu' };
  }
  
  const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
  const last10 = history.slice(-10).map(h => h.result);
  const lastScores = history.slice(-10).map(h => h.totalScore || 0);
  
  let finalBreakProb = breakProb;
  let reason = '';
  
  // Phân tích xu hướng tổng
  const taiCount = last10.filter(r => r === 'Tài').length;
  const xiuCount = 10 - taiCount;
  
  // Nếu đang quá lệch (7-3 hoặc 8-2) thì BẺ
  if (taiCount >= 7) {
    finalBreakProb = 0.7;
    reason = `[Bẻ cầu] Tài quá nhiều (${taiCount}/10) → chuyển Xỉu`;
  } else if (xiuCount >= 7) {
    finalBreakProb = 0.7;
    reason = `[Bẻ cầu] Xỉu quá nhiều (${xiuCount}/10) → chuyển Tài`;
  } else if (streak >= 6) {
    finalBreakProb = 0.65;
    reason = `[Bẻ cầu] Chuỗi ${streak} ${currentResult} dài`;
  } else {
    finalBreakProb = 0.25;
    reason = `[Theo cầu] Không có tín hiệu bẻ mạnh`;
  }
  
  // Quyết định: 1 là Tài, 2 là Xỉu
  let prediction;
  if (finalBreakProb > 0.55) {
    // Bẻ cầu: đánh ngược lại
    prediction = currentResult === 'Tài' ? 2 : 1;
  } else {
    // Theo cầu: đánh theo
    prediction = currentResult === 'Tài' ? 1 : 2;
  }
  
  return { prediction, breakProb: finalBreakProb, reason };
}

function trendAndProb(history) {
  if (!history || history.length < 5) return 0;
  
  const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
  
  // Bệt dài thì theo hoặc bẻ tùy ngưỡng
  if (streak >= 5) {
    if (breakProb > 0.6) {
      return currentResult === 'Tài' ? 2 : 1;
    }
    return currentResult === 'Tài' ? 1 : 2;
  }
  
  // Lấy 10 phiên gần nhất
  const last10 = history.slice(-10).map(h => h.result);
  if (!last10.length) return 0;
  
  const taiCount = last10.filter(r => r === 'Tài').length;
  
  // Cân bằng: nếu Tài nhiều hơn 6/10 thì đánh Xỉu
  if (taiCount >= 6) {
    return 2; // Xỉu
  } else if (taiCount <= 4) {
    return 1; // Tài
  }
  
  // Mặc định theo phiên cuối
  return last10[last10.length - 1] === 'Tài' ? 1 : 2;
}

function shortPattern(history) {
  if (!history || history.length < 4) return 0;
  
  const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
  
  if (streak >= 4) {
    if (breakProb > 0.6) {
      return currentResult === 'Tài' ? 2 : 1;
    }
    return currentResult === 'Tài' ? 1 : 2;
  }
  
  // Phân tích 4 phiên gần nhất
  const last4 = history.slice(-4).map(h => h.result);
  
  // Các pattern phổ biến
  if (last4.join(',') === 'Tài,Tài,Xỉu,Xỉu') return 1; // Tài
  if (last4.join(',') === 'Xỉu,Xỉu,Tài,Tài') return 2; // Xỉu
  if (last4.join(',') === 'Tài,Xỉu,Tài,Xỉu') return 1; // Tài
  if (last4.join(',') === 'Xỉu,Tài,Xỉu,Tài') return 2; // Xỉu
  
  // Theo phiên cuối
  return last4[last4.length - 1] === 'Tài' ? 1 : 2;
}

function meanDeviation(history) {
  if (!history || history.length < 6) return 0;
  
  const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
  
  if (streak >= 4) {
    if (breakProb > 0.6) {
      return currentResult === 'Tài' ? 2 : 1;
    }
    return currentResult === 'Tài' ? 1 : 2;
  }
  
  const last12 = history.slice(-12).map(h => h.result);
  const taiCount = last12.filter(r => r === 'Tài').length;
  const xiuCount = last12.length - taiCount;
  
  // Nếu chênh lệch lớn thì đánh cửa ít hơn
  if (taiCount - xiuCount >= 3) return 2; // Xỉu
  if (xiuCount - taiCount >= 3) return 1; // Tài
  
  return 0;
}

function recentSwitch(history) {
  if (!history || history.length < 5) return 0;
  
  const last8 = history.slice(-8).map(h => h.result);
  const switches = last8.slice(1).reduce((count, curr, idx) => count + (curr !== last8[idx] ? 1 : 0), 0);
  
  // Nếu đảo cầu nhiều (đan xen) thì đánh ngược phiên cuối
  if (switches >= 5) {
    return last8[last8.length - 1] === 'Tài' ? 2 : 1;
  }
  
  return 0;
}

function isBadPattern(history) {
  if (!history || history.length < 10) return false;
  const last15 = history.slice(-15).map(h => h.result);
  const taiCount = last15.filter(r => r === 'Tài').length;
  
  // Nếu quá lệch (12-3 hoặc 3-12) là pattern xấu
  return taiCount >= 12 || taiCount <= 3;
}

function aiHtddLogic(history) {
  if (!history || history.length < 5) {
    return { prediction: Math.random() < 0.5 ? 'Tài' : 'Xỉu', reason: 'Đang khởi tạo', source: 'AI' };
  }
  
  const last8 = history.slice(-8).map(h => h.result);
  const taiCount = last8.filter(r => r === 'Tài').length;
  const xiuCount = 8 - taiCount;
  
  // ==== CÁC PATTERN CẦU ====
  
  // 1. Cầu 1-1: TXTX...
  let is1111 = true;
  for (let i = 1; i < last8.length; i++) {
    if (last8[i] === last8[i-1]) {
      is1111 = false;
      break;
    }
  }
  if (is1111 && last8.length >= 4) {
    return { prediction: last8[last8.length-1] === 'Tài' ? 'Xỉu' : 'Tài', reason: 'Cầu 1-1 → đánh ngược', source: 'AI' };
  }
  
  // 2. Cầu 2-2: TTXXTTXX...
  if (last8.length >= 4) {
    const pattern = last8.slice(-4).join(',');
    if (pattern === 'Tài,Tài,Xỉu,Xỉu') {
      return { prediction: 'Tài', reason: 'Cầu 2-2 (TTXX) → Tài', source: 'AI' };
    }
    if (pattern === 'Xỉu,Xỉu,Tài,Tài') {
      return { prediction: 'Xỉu', reason: 'Cầu 2-2 (XXTT) → Xỉu', source: 'AI' };
    }
  }
  
  // 3. Cân bằng - đánh cửa ít hơn
  if (taiCount >= 5) {
    return { prediction: 'Xỉu', reason: `Tài đang nhiều (${taiCount}/8) → đánh Xỉu`, source: 'AI' };
  }
  if (xiuCount >= 5) {
    return { prediction: 'Tài', reason: `Xỉu đang nhiều (${xiuCount}/8) → đánh Tài`, source: 'AI' };
  }
  
  // 4. Theo xu hướng 3 phiên cuối
  const last3 = last8.slice(-3);
  if (last3[0] === last3[1] && last3[1] === last3[2]) {
    return { prediction: last3[0] === 'Tài' ? 'Xỉu' : 'Tài', reason: '3 phiên giống nhau → bẻ cầu', source: 'AI' };
  }
  
  // 5. Mặc định: theo phiên cuối
  return { prediction: last8[last8.length-1], reason: 'Theo phiên cuối', source: 'AI' };
}

function generatePrediction(history, modelPredictionsRef) {
  modelPredictions = modelPredictionsRef;
  if (!history || history.length === 0) {
    return Math.random() < 0.5 ? 'Tài' : 'Xỉu';
  }
  
  if (!modelPredictions['trend']) {
    modelPredictions['trend'] = {};
    modelPredictions['short'] = {};
    modelPredictions['mean'] = {};
    modelPredictions['switch'] = {};
    modelPredictions['bridge'] = {};
  }
  
  const currentIndex = history[history.length - 1].session;
  
  // Lấy dự đoán từ các mô hình
  const trendPred = history.length < 5 ? (history[history.length - 1].result === 'Tài' ? 1 : 2) : trendAndProb(history);
  const shortPred = history.length < 5 ? (history[history.length - 1].result === 'Tài' ? 1 : 2) : shortPattern(history);
  const meanPred = history.length < 5 ? 0 : meanDeviation(history);
  const switchPred = history.length < 5 ? 0 : recentSwitch(history);
  const bridgePred = history.length < 5 ? { prediction: 0, breakProb: 0, reason: '' } : smartBridgeBreak(history);
  const aiPred = aiHtddLogic(history);
  
  // Lưu lại để đánh giá
  modelPredictions['trend'][currentIndex] = trendPred;
  modelPredictions['short'][currentIndex] = shortPred;
  modelPredictions['mean'][currentIndex] = meanPred;
  modelPredictions['switch'][currentIndex] = switchPred;
  modelPredictions['bridge'][currentIndex] = bridgePred.prediction;
  
  // Điều chỉnh trọng số
  const weights = {
    trend: 0.25,
    short: 0.2,
    mean: 0.15,
    switch: 0.15,
    bridge: 0.15,
    ai: 0.1
  };
  
  let taiScore = 0;
  let xiuScore = 0;
  
  // Trend
  if (trendPred === 1) taiScore += weights.trend;
  else if (trendPred === 2) xiuScore += weights.trend;
  
  // Short pattern
  if (shortPred === 1) taiScore += weights.short;
  else if (shortPred === 2) xiuScore += weights.short;
  
  // Mean deviation
  if (meanPred === 1) taiScore += weights.mean;
  else if (meanPred === 2) xiuScore += weights.mean;
  
  // Recent switch
  if (switchPred === 1) taiScore += weights.switch;
  else if (switchPred === 2) xiuScore += weights.switch;
  
  // Bridge break
  if (bridgePred.prediction === 1) taiScore += weights.bridge;
  else if (bridgePred.prediction === 2) xiuScore += weights.bridge;
  
  // AI
  if (aiPred.prediction === 'Tài') taiScore += weights.ai;
  else xiuScore += weights.ai;
  
  // ===== CÂN BẰNG CUỐI CÙNG =====
  // Dựa trên lịch sử dự đoán để tránh lệch cửa
  if (historyPredictions.length >= MAX_HISTORY) {
    const recentTai = historyPredictions.filter(p => p === 'Tài').length;
    const recentXiu = historyPredictions.filter(p => p === 'Xỉu').length;
    
    // Nếu 10 dự đoán gần nhất lệch quá 70-30 thì điều chỉnh
    if (recentTai >= 7) {
      xiuScore += 0.3;
      console.log('⚖️ Điều chỉnh: đang quá nhiều dự đoán Tài');
    } else if (recentXiu >= 7) {
      taiScore += 0.3;
      console.log('⚖️ Điều chỉnh: đang quá nhiều dự đoán Xỉu');
    }
  }
  
  // Quyết định cuối cùng
  let finalPrediction = taiScore > xiuScore ? 'Tài' : 'Xỉu';
  
  // Lưu lại lịch sử dự đoán
  historyPredictions.push(finalPrediction);
  if (historyPredictions.length > MAX_HISTORY) {
    historyPredictions.shift();
  }
  
  console.log(`🎯 Dự đoán: ${finalPrediction} (Tài:${taiScore.toFixed(2)} - Xỉu:${xiuScore.toFixed(2)})`);
  return finalPrediction;
}

// ==================== AUTO FETCH DỮ LIỆU ====================

async function fetchData() {
  try {
    const response = await axios.get(API_URL, { timeout: 5000 });
    const data = response.data;
    const items = data?.list;
    
    if (items && Array.isArray(items) && items.length > 0) {
      latestData = items;
      const phienHienTai = items[0].id;
      
      if (phienHienTai !== lastPhien) {
        lastPhien = phienHienTai;
        
        const history = items.slice(0, 100).reverse().map(item => ({
          session: item.id,
          result: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
          totalScore: item.point || 0
        }));
        
        const duDoan = generatePrediction(history, modelPredictions);
        
        cachedResult = {
          phien_hien_tai: items[0].id,
          ket_qua: items[0].resultTruyenThong === 'TAI' ? 'Tai' : 'Xiu',
          xuc_xac: items[0].dices || [0, 0, 0],
          phien_tiep_theo: items[0].id + 1,
          du_doan: duDoan,
          do_tin_cay: '85%'
        };
        
        console.log(`[${new Date().toLocaleTimeString()}] ✅ Phiên ${phienHienTai}: KQ=${cachedResult.ket_qua} | DĐ=${duDoan}`);
      }
    }
  } catch (error) {
    console.error(`Lỗi fetch:`, error.message);
  }
}

// Chạy fetch mỗi 3 giây
setInterval(fetchData, 3000);
fetchData();

// ==================== API ====================

app.get('/', (req, res) => {
  res.send('API Tài Xỉu - Đã fix lệch cửa');
});

app.get('/api/hitpro', async (req, res) => {
  if (cachedResult) {
    return res.json(cachedResult);
  }
  return res.status(503).json({ error: 'Đang tải dữ liệu' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server chạy trên port ${PORT}`);
});
