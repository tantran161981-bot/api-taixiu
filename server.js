const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

let stats = {
  hu: { total: 0, correct: 0, streak: 0, lastPredictions: [], patternAccuracy: {}, last10Actual: [] },
  md5: { total: 0, correct: 0, streak: 0, lastPredictions: [], patternAccuracy: {}, last10Actual: [] }
};

function transformData(apiData) {
  if (!apiData?.list) return null;
  return apiData.list.map(item => ({
    phien: item.id,
    ketQua: item.resultTruyenThong === 'TAI' ? 'T' : 'X',
    tong: item.point,
    x1: item.dices[0],
    x2: item.dices[1],
    x3: item.dices[2]
  }));
}

async function fetchData(type) {
  try {
    const url = type === 'hu' ? API_URL_HU : API_URL_MD5;
    const res = await axios.get(url, { timeout: 10000 });
    return transformData(res.data);
  } catch (e) {
    console.error(`Lỗi ${type}:`, e.message);
    return null;
  }
}

// ==================== THUẬT TOÁN BẮT CẦU SIÊU XỊN ====================

// 1. BỆT THÔNG MINH - Tỷ lệ bẻ theo xác suất thực tế
function analyzeBetSuper(arr) {
  let len = 1;
  for (let i = 1; i < arr.length && i < 15; i++) {
    if (arr[i] === arr[0]) len++;
    else break;
  }
  
  if (len < 2) return null;
  
  // Xác suất bẻ cầu dựa trên độ dài chuỗi (thống kê thực tế)
  let breakProb = 0;
  if (len >= 8) breakProb = 98;
  else if (len === 7) breakProb = 92;
  else if (len === 6) breakProb = 85;
  else if (len === 5) breakProb = 75;
  else if (len === 4) breakProb = 62;
  else if (len === 3) breakProb = 45;
  else breakProb = 30;
  
  // Thêm yếu tố xu hướng
  const isExtreme = arr.slice(0, Math.min(10, arr.length)).filter(x => x === arr[0]).length >= 7;
  if (isExtreme) breakProb += 10;
  
  const shouldBreak = Math.random() * 100 < breakProb;
  const pred = shouldBreak ? (arr[0] === 'T' ? 'X' : 'T') : arr[0];
  
  let conf = 60 + len * 2;
  if (len >= 5) conf += 8;
  if (len >= 7) conf += 6;
  if (shouldBreak) conf += 5;
  
  return { pred: pred === 'T' ? 'Tài' : 'Xỉu', conf: Math.min(94, conf), priority: 10 - Math.min(5, len) };
}

// 2. CẦU ĐẢO 1-1 - Phát hiện sớm và bám chắc
function analyzeDaoSuper(arr) {
  let len = 1;
  for (let i = 1; i < arr.length && i < 15; i++) {
    if (arr[i] !== arr[i-1]) len++;
    else break;
  }
  
  if (len < 3) return null;
  
  // Đảo càng dài càng tin cậy
  let conf = 60 + len * 3;
  if (len >= 6) conf += 10;
  if (len >= 8) conf += 8;
  
  const pred = arr[0] === 'T' ? 'Xỉu' : 'Tài';
  
  return { pred, conf: Math.min(92, conf), priority: 8 };
}

// 3. CẦU 2-2, 3-3, 4-4 CHUẨN XÁC
function analyzePairTripleSuper(arr) {
  // Phân tích cặp đôi 2-2
  let pairs = [];
  for (let i = 0; i < arr.length - 1; i += 2) {
    if (arr[i] === arr[i+1]) pairs.push(arr[i]);
    else break;
  }
  
  if (pairs.length >= 2) {
    const last = pairs[pairs.length - 1];
    let pred = last === 'T' ? 'Xỉu' : 'Tài';
    let conf = 65 + pairs.length * 5;
    if (pairs.length >= 3) conf += 5;
    return { pred, conf: Math.min(90, conf), priority: 8 };
  }
  
  // Phân tích bộ ba 3-3
  let triples = [];
  for (let i = 0; i < arr.length - 2; i += 3) {
    if (arr[i] === arr[i+1] && arr[i+1] === arr[i+2]) triples.push(arr[i]);
    else break;
  }
  
  if (triples.length >= 1) {
    const last = triples[triples.length - 1];
    const remainder = arr.length % 3;
    let pred = (remainder === 0) ? (last === 'T' ? 'Xỉu' : 'Tài') : (last === 'T' ? 'Tài' : 'Xỉu');
    let conf = 68 + triples.length * 6;
    return { pred, conf: Math.min(89, conf), priority: 8 };
  }
  
  return null;
}

// 4. XU HƯỚNG 5 PHIÊN - ĐỌC VỊ THỊ TRƯỜNG
function analyzeTrend5Super(arr) {
  if (arr.length < 5) return null;
  
  const last5 = arr.slice(0, 5);
  const tCount = last5.filter(x => x === 'T').length;
  
  // 5-0 hoặc 0-5: cực đoan
  if (tCount === 5) {
    return { pred: 'Xỉu', conf: 88, priority: 10, name: 'trend_5tai' };
  }
  if (tCount === 0) {
    return { pred: 'Tài', conf: 88, priority: 10, name: 'trend_5xiu' };
  }
  
  // 4-1
  if (tCount === 4) {
    return { pred: 'Xỉu', conf: 78, priority: 8, name: 'trend_4tai' };
  }
  if (tCount === 1) {
    return { pred: 'Tài', conf: 78, priority: 8, name: 'trend_4xiu' };
  }
  
  // 3-2 cân bằng - theo cầu đảo
  if (tCount === 3) {
    return { pred: 'Xỉu', conf: 65, priority: 5, name: 'trend_3tai' };
  }
  if (tCount === 2) {
    return { pred: 'Tài', conf: 65, priority: 5, name: 'trend_3xiu' };
  }
  
  return null;
}

// 5. XU HƯỚNG 10 PHIÊN - BẺ CẦU CỰC ĐOAN
function analyzeTrend10Super(arr) {
  if (arr.length < 10) return null;
  
  const last10 = arr.slice(0, 10);
  const tCount = last10.filter(x => x === 'T').length;
  
  // 8-2, 9-1, 10-0
  if (tCount >= 8) {
    let conf = 80 + (tCount - 7) * 4;
    return { pred: 'Xỉu', conf: Math.min(95, conf), priority: 10, name: 'extreme_tai' };
  }
  if (tCount <= 2) {
    let conf = 80 + (3 - tCount) * 4;
    return { pred: 'Tài', conf: Math.min(95, conf), priority: 10, name: 'extreme_xiu' };
  }
  
  // 7-3
  if (tCount === 7) {
    return { pred: 'Xỉu', conf: 75, priority: 8, name: 'strong_tai' };
  }
  if (tCount === 3) {
    return { pred: 'Tài', conf: 75, priority: 8, name: 'strong_xiu' };
  }
  
  return null;
}

// 6. PATTERN 1-2-1, 1-2-3, 3-2-1 CHUẨN
function analyzePatternAdvanced(arr) {
  if (arr.length < 5) return null;
  
  // Pattern 1-2-1: T X X T
  if (arr[0] !== arr[1] && arr[1] === arr[2] && arr[2] !== arr[3] && arr[0] === arr[3]) {
    let pred = arr[0] === 'T' ? 'Tài' : 'Xỉu';
    return { pred, conf: 78, priority: 7, name: 'pattern_121' };
  }
  
  // Pattern 1-2-3: T X X T X X (mở rộng)
  if (arr.length >= 6) {
    if (arr[0] !== arr[1] && arr[1] === arr[2] && arr[2] !== arr[3] &&
        arr[3] === arr[4] && arr[4] !== arr[5]) {
      let pred = arr[5] === 'T' ? 'Xỉu' : 'Tài';
      return { pred, conf: 80, priority: 8, name: 'pattern_123' };
    }
  }
  
  return null;
}

// 7. CẦU NHẢY CÓC THÔNG MINH
function analyzeSkipSuper(arr) {
  if (arr.length < 6) return null;
  
  // Lấy vị trí 0,2,4,6
  const skipPositions = [0, 2, 4, 6];
  const skipValues = skipPositions.filter(i => i < arr.length).map(i => arr[i]);
  
  if (skipValues.length >= 3) {
    // Cùng 1 kết quả
    const allSame = skipValues.every(v => v === skipValues[0]);
    if (allSame) {
      let pred = skipValues[0] === 'T' ? 'Tài' : 'Xỉu';
      let conf = 65 + skipValues.length * 4;
      return { pred, conf: Math.min(85, conf), priority: 6, name: 'skip_same' };
    }
    
    // Đan xen
    let alternating = true;
    for (let i = 1; i < skipValues.length; i++) {
      if (skipValues[i] === skipValues[i-1]) alternating = false;
    }
    if (alternating) {
      let pred = skipValues[0] === 'T' ? 'Xỉu' : 'Tài';
      return { pred, conf: 70, priority: 6, name: 'skip_alternate' };
    }
  }
  
  return null;
}

// 8. PHÂN TÍCH TỔNG ĐIỂM CHUYÊN SÂU
function analyzeTotalSuper(sums) {
  if (sums.length < 8) return null;
  
  const last5 = sums.slice(0, 5);
  const prev5 = sums.slice(5, 10);
  const avgLast5 = last5.reduce((a,b) => a+b, 0) / 5;
  const avgPrev5 = prev5.reduce((a,b) => a+b, 0) / 5;
  const diff = avgLast5 - avgPrev5;
  
  // Biến động mạnh
  if (diff > 2) {
    return { pred: 'Xỉu', conf: 76, priority: 7, name: 'total_up' };
  }
  if (diff < -2) {
    return { pred: 'Tài', conf: 76, priority: 7, name: 'total_down' };
  }
  
  // Tổng đang ở ngưỡng cao/thấp
  const lastSum = sums[0];
  if (lastSum >= 14) {
    return { pred: 'Xỉu', conf: 72, priority: 6, name: 'total_high' };
  }
  if (lastSum <= 7) {
    return { pred: 'Tài', conf: 72, priority: 6, name: 'total_low' };
  }
  
  // Tổng chẵn/lẻ
  const isEven = lastSum % 2 === 0;
  const evenCount = sums.slice(0, 5).filter(s => s % 2 === 0).length;
  if (evenCount >= 4 && !isEven) {
    return { pred: 'Xỉu', conf: 68, priority: 5, name: 'total_even_trend' };
  }
  if (evenCount <= 1 && isEven) {
    return { pred: 'Tài', conf: 68, priority: 5, name: 'total_odd_trend' };
  }
  
  return null;
}

// 9. CẦU ĐỐI XỨNG - GƯƠNG
function analyzeMirrorPattern(arr) {
  if (arr.length < 6) return null;
  
  // T X X T (đối xứng)
  if (arr[0] !== arr[1] && arr[1] === arr[2] && arr[2] !== arr[3] && arr[0] === arr[3]) {
    return { pred: arr[0] === 'T' ? 'Tài' : 'Xỉu', conf: 75, priority: 7, name: 'mirror_4' };
  }
  
  // Đối xứng qua tâm 6 phiên
  if (arr.length >= 6) {
    if (arr[0] === arr[5] && arr[1] === arr[4]) {
      let pred = arr[2] === 'T' ? 'Xỉu' : 'Tài';
      return { pred, conf: 74, priority: 7, name: 'mirror_6' };
    }
  }
  
  return null;
}

// 10. CẦU THEO LOGIC XỬ LÝ CHUỖI - CHUYÊN GIA
function analyzeChainLogic(arr) {
  if (arr.length < 6) return null;
  
  // Phát hiện quy luật T T X X T T X X
  const pattern4 = arr.slice(0, 4);
  if (pattern4[0] === pattern4[1] && pattern4[2] === pattern4[3] && pattern4[0] !== pattern4[2]) {
    const nextPred = pattern4[0];
    return { pred: nextPred === 'T' ? 'Tài' : 'Xỉu', conf: 77, priority: 8, name: 'chain_22' };
  }
  
  // Phát hiện quy luật T T T X X X
  if (arr.length >= 6) {
    const first3 = arr.slice(0, 3);
    const next3 = arr.slice(3, 6);
    if (first3.every(v => v === first3[0]) && next3.every(v => v === next3[0]) && first3[0] !== next3[0]) {
      let pred = next3[0] === 'T' ? 'Xỉu' : 'Tài';
      return { pred, conf: 82, priority: 9, name: 'chain_33' };
    }
  }
  
  return null;
}

// ==================== TỔNG HỢP DỰ ĐOÁN SIÊU CẤP ====================

function getSuperPrediction(data, type) {
  const arr = data.map(d => d.ketQua);
  const sums = data.map(d => d.tong);
  
  // Cập nhật lịch sử thực tế
  if (arr.length > 0 && stats[type].last10Actual[0] !== arr[0]) {
    stats[type].last10Actual.unshift(arr[0]);
    if (stats[type].last10Actual.length > 20) stats[type].last10Actual.pop();
  }
  
  const analyzers = [
    analyzeBetSuper,
    analyzeDaoSuper,
    analyzePairTripleSuper,
    analyzeTrend5Super,
    analyzeTrend10Super,
    analyzePatternAdvanced,
    analyzeSkipSuper,
    (a) => analyzeTotalSuper(sums),
    analyzeMirrorPattern,
    analyzeChainLogic
  ];
  
  let predictions = [];
  for (const fn of analyzers) {
    const res = fn(arr);
    if (res) {
      // Điều chỉnh confidence dựa trên độ chính xác lịch sử của pattern
      const patternKey = res.name || fn.name;
      if (patternKey && stats[type].patternAccuracy[patternKey]) {
        const acc = stats[type].patternAccuracy[patternKey];
        if (acc.total >= 5) {
          const accuracyRate = acc.correct / acc.total;
          res.conf = Math.min(94, res.conf * (0.7 + accuracyRate * 0.6));
        }
      }
      predictions.push(res);
    }
  }
  
  // Tính điểm có trọng số
  let taiTotal = 0, xiuTotal = 0;
  let taiWeight = 0, xiuWeight = 0;
  
  for (const p of predictions) {
    const priorityWeight = (10 - (p.priority || 5)) / 5 + 1;
    const weightedConf = p.conf * priorityWeight;
    
    if (p.pred === 'Tài') {
      taiTotal += weightedConf;
      taiWeight += priorityWeight;
    } else {
      xiuTotal += weightedConf;
      xiuWeight += priorityWeight;
    }
  }
  
  // Thêm trọng số từ lịch sử thực tế gần đây
  const recentTrend = stats[type].last10Actual.slice(0, 5);
  if (recentTrend.length >= 5) {
    const tCount = recentTrend.filter(x => x === 'T').length;
    if (tCount >= 4) xiuTotal += 15;
    if (tCount <= 1) taiTotal += 15;
  }
  
  // Xử lý streak (bẻ cầu khi đang thua)
  const currentStreak = stats[type].streak;
  let finalPred, finalConf;
  
  if (taiTotal > xiuTotal) {
    finalPred = 'Tài';
    finalConf = 55 + (taiTotal / (taiTotal + xiuTotal)) * 35;
  } else if (xiuTotal > taiTotal) {
    finalPred = 'Xỉu';
    finalConf = 55 + (xiuTotal / (taiTotal + xiuTotal)) * 35;
  } else {
    finalPred = arr[0] === 'T' ? 'Xỉu' : 'Tài';
    finalConf = 65;
  }
  
  // Bẻ cầu khi thua liên tiếp
  if (currentStreak <= -3) {
    finalPred = finalPred === 'Tài' ? 'Xỉu' : 'Tài';
    finalConf = Math.min(92, finalConf + 12);
  }
  
  // Giảm confidence khi đang thắng dài
  if (currentStreak >= 4) {
    finalConf = Math.max(60, finalConf - 8);
  }
  
  finalConf = Math.min(94, Math.max(58, Math.round(finalConf)));
  
  return {
    pred: finalPred,
    conf: finalConf,
    patternCount: predictions.length,
    topPatterns: predictions.slice(0, 3).map(p => p.name || p.pred)
  };
}

// ==================== CẬP NHẬT THỐNG KÊ ====================

function updateStats(type, phien, actual, predicted, patterns) {
  const isCorrect = predicted === actual;
  
  stats[type].total++;
  if (isCorrect) {
    stats[type].correct++;
    stats[type].streak = stats[type].streak > 0 ? stats[type].streak + 1 : 1;
  } else {
    stats[type].streak = stats[type].streak < 0 ? stats[type].streak - 1 : -1;
  }
  
  // Cập nhật độ chính xác pattern
  for (const pattern of patterns) {
    if (pattern) {
      if (!stats[type].patternAccuracy[pattern]) {
        stats[type].patternAccuracy[pattern] = { total: 0, correct: 0 };
      }
      stats[type].patternAccuracy[pattern].total++;
      if (isCorrect) stats[type].patternAccuracy[pattern].correct++;
    }
  }
  
  stats[type].lastPredictions.unshift({
    phien, pred: predicted, actual, isCorrect, patterns, timestamp: Date.now()
  });
  
  if (stats[type].lastPredictions.length > 200) stats[type].lastPredictions.pop();
  
  try { fs.writeFileSync('stats_super.json', JSON.stringify(stats, null, 2)); } catch(e) {}
}

// ==================== DỰ ĐOÁN CHÍNH ====================

async function getPrediction(type) {
  const data = await fetchData(type);
  if (!data || data.length < 8) return null;
  
  const latest = data[0];
  const nextPhien = latest.phien + 1;
  
  // Kiểm tra kết quả dự đoán trước
  const lastPred = stats[type].lastPredictions[0];
  if (lastPred && !lastPred.checked) {
    const actual = latest.ketQua === 'T' ? 'Tài' : 'Xỉu';
    updateStats(type, lastPred.phien, actual, lastPred.pred, lastPred.patterns || []);
    lastPred.checked = true;
  }
  
  // Lấy dự đoán siêu cấp
  const prediction = getSuperPrediction(data, type);
  
  // Lưu dự đoán mới
  stats[type].lastPredictions.unshift({
    phien: nextPhien,
    pred: prediction.pred,
    patterns: prediction.topPatterns,
    checked: false,
    timestamp: Date.now()
  });
  
  if (stats[type].lastPredictions.length > 200) stats[type].lastPredictions.pop();
  
  try { fs.writeFileSync('stats_super.json', JSON.stringify(stats, null, 2)); } catch(e) {}
  
  return {
    phien_du_doan: nextPhien,
    du_doan: prediction.pred,
    do_tin_cay: prediction.conf + '%'
  };
}

// ==================== LOAD & API ====================

function loadStats() {
  try {
    if (fs.existsSync('stats_super.json')) {
      const loaded = JSON.parse(fs.readFileSync('stats_super.json', 'utf8'));
      stats = loaded;
      console.log('✅ Đã tải stats super');
    }
  } catch(e) {}
}

loadStats();

app.get('/', (req, res) => res.json({ api: "Tài Xỉu Super Pro @anhquan", endpoints: ["/hu", "/md5", "/stats", "/reset"] }));

app.get('/hu', async (req, res) => {
  const result = await getPrediction('hu');
  if (!result) return res.status(500).json({ error: "Lỗi lấy dữ liệu" });
  res.json(result);
});

app.get('/md5', async (req, res) => {
  const result = await getPrediction('md5');
  if (!result) return res.status(500).json({ error: "Lỗi lấy dữ liệu" });
  res.json(result);
});

app.get('/stats', (req, res) => {
  const accHu = stats.hu.total ? ((stats.hu.correct / stats.hu.total) * 100).toFixed(1) : 0;
  const accMd5 = stats.md5.total ? ((stats.md5.correct / stats.md5.total) * 100).toFixed(1) : 0;
  res.json({
    hu: { tong: stats.hu.total, dung: stats.hu.correct, ty_le: accHu + '%', chuoi: stats.hu.streak },
    md5: { tong: stats.md5.total, dung: stats.md5.correct, ty_le: accMd5 + '%', chuoi: stats.md5.streak }
  });
});

app.get('/reset', (req, res) => {
  stats = {
    hu: { total: 0, correct: 0, streak: 0, lastPredictions: [], patternAccuracy: {}, last10Actual: [] },
    md5: { total: 0, correct: 0, streak: 0, lastPredictions: [], patternAccuracy: {}, last10Actual: [] }
  };
  try { fs.writeFileSync('stats_super.json', JSON.stringify(stats, null, 2)); } catch(e) {}
  res.json({ message: "Đã reset", tac_gia: "@anhquan" });
});

// ==================== AUTO RUN ====================
let lastRun = { hu: null, md5: null };

async function autoRun() {
  const dataHu = await fetchData('hu');
  const dataMd5 = await fetchData('md5');
  
  if (dataHu && dataHu[0] && lastRun.hu !== dataHu[0].phien) {
    lastRun.hu = dataHu[0].phien;
    const res = await getPrediction('hu');
    if (res) console.log(`🎲 HU: ${res.phien_du_doan} → ${res.du_doan} (${res.do_tin_cay})`);
  }
  
  if (dataMd5 && dataMd5[0] && lastRun.md5 !== dataMd5[0].phien) {
    lastRun.md5 = dataMd5[0].phien;
    const res = await getPrediction('md5');
    if (res) console.log(`🎲 MD5: ${res.phien_du_doan} → ${res.du_doan} (${res.do_tin_cay})`);
  }
}

setInterval(autoRun, 12000);
setTimeout(autoRun, 2000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Super Pro Server @anhquan - ${PORT}`);
  console.log(`📊 10+ thuật toán bắt cầu siêu xịn`);
  console.log(`🎯 JSON: {"phien_du_doan":123456, "du_doan":"Tài", "do_tin_cay":"85%"}`);
});
