const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

let stats = {
  hu: { total: 0, correct: 0, streak: 0, lastPredictions: [], patternAccuracy: {} },
  md5: { total: 0, correct: 0, streak: 0, lastPredictions: [], patternAccuracy: {} }
};

// ==================== LẤY DỮ LIỆU ====================
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

// ==================== THUẬT TOÁN PRO MAX ====================

// 1. Phân tích chuỗi bệt siêu thông minh
function analyzeBet(arr) {
  let len = 1;
  for (let i = 1; i < arr.length && i < 20; i++) {
    if (arr[i] === arr[0]) len++;
    else break;
  }
  
  if (len < 2) return null;
  
  // Bệt càng dài càng dễ bẻ
  let breakChance = 0;
  if (len >= 7) breakChance = 95;
  else if (len >= 6) breakChance = 88;
  else if (len >= 5) breakChance = 78;
  else if (len >= 4) breakChance = 65;
  else if (len === 3) breakChance = 48;
  else breakChance = 35;
  
  const shouldBreak = Math.random() * 100 < breakChance;
  const pred = shouldBreak ? (arr[0] === 'T' ? 'X' : 'T') : arr[0];
  let conf = 60 + len * 2.5;
  if (len >= 5) conf += 8;
  if (len >= 7) conf += 5;
  
  return { pred, conf: Math.min(92, conf), name: `bệt_${len}` };
}

// 2. Phân tích cầu đảo 1-1
function analyzeDao(arr) {
  let len = 1;
  for (let i = 1; i < arr.length && i < 15; i++) {
    if (arr[i] !== arr[i-1]) len++;
    else break;
  }
  
  if (len < 3) return null;
  
  const pred = arr[0] === 'T' ? 'X' : 'T';
  let conf = 62 + len * 2.8;
  if (len >= 6) conf += 10;
  if (len >= 8) conf += 5;
  
  return { pred, conf: Math.min(90, conf), name: `dao_${len}` };
}

// 3. Cầu 2-2, 3-3, 4-4
function analyzePairTriple(arr) {
  // Cặp đôi
  let pairs = [];
  for (let i = 0; i < arr.length - 1; i += 2) {
    if (arr[i] === arr[i+1]) pairs.push(arr[i]);
    else break;
  }
  
  if (pairs.length >= 2) {
    const last = pairs[pairs.length - 1];
    const pred = last === 'T' ? 'X' : 'T';
    let conf = 66 + pairs.length * 4;
    return { pred, conf: Math.min(88, conf), name: `cap_${pairs.length}` };
  }
  
  // Bộ ba
  let triples = [];
  for (let i = 0; i < arr.length - 2; i += 3) {
    if (arr[i] === arr[i+1] && arr[i+1] === arr[i+2]) triples.push(arr[i]);
    else break;
  }
  
  if (triples.length >= 1) {
    const last = triples[triples.length - 1];
    const remainder = arr.length % 3;
    let pred = (remainder === 0) ? (last === 'T' ? 'X' : 'T') : last;
    let conf = 68 + triples.length * 5;
    return { pred, conf: Math.min(87, conf), name: `bo_ba_${triples.length}` };
  }
  
  return null;
}

// 4. Xu hướng 5 phiên - đọc vị thị trường
function analyzeTrend5(arr) {
  if (arr.length < 5) return null;
  
  const last5 = arr.slice(0, 5);
  const tCount = last5.filter(x => x === 'T').length;
  const xCount = 5 - tCount;
  
  // Lệch mạnh 4-1 hoặc 5-0
  if (tCount >= 4) {
    let conf = 70 + (tCount - 3) * 6;
    return { pred: 'X', conf: Math.min(90, conf), name: `trend_tai_${tCount}` };
  }
  if (xCount >= 4) {
    let conf = 70 + (xCount - 3) * 6;
    return { pred: 'T', conf: Math.min(90, conf), name: `trend_xiu_${xCount}` };
  }
  
  // 3-2 nghiêng nhẹ
  if (tCount === 3) {
    return { pred: 'X', conf: 64, name: `trend_le_3t` };
  }
  if (xCount === 3) {
    return { pred: 'T', conf: 64, name: `trend_le_3x` };
  }
  
  return null;
}

// 5. Xu hướng 10 phiên - cực đoan
function analyzeTrend10(arr) {
  if (arr.length < 10) return null;
  
  const last10 = arr.slice(0, 10);
  const tCount = last10.filter(x => x === 'T').length;
  
  if (tCount >= 7) {
    let conf = 75 + (tCount - 6) * 4;
    return { pred: 'X', conf: Math.min(94, conf), name: `cuc_doan_tai_${tCount}` };
  }
  if (tCount <= 3) {
    let conf = 75 + (4 - tCount) * 4;
    return { pred: 'T', conf: Math.min(94, conf), name: `cuc_doan_xiu_${10-tCount}` };
  }
  
  return null;
}

// 6. Cầu 1-2-1, 1-2-3 thông minh
function analyzeSmartPattern(arr) {
  if (arr.length < 4) return null;
  
  // Pattern 1-2-1: T X X T
  if (arr[0] !== arr[1] && arr[1] === arr[2] && arr[2] !== arr[3] && arr[0] === arr[3]) {
    return { pred: arr[0], conf: 76, name: 'pattern_121' };
  }
  
  // Pattern T X X T X X T (1-2-1-2-1)
  if (arr.length >= 7) {
    if (arr[0] !== arr[1] && arr[1] === arr[2] && arr[2] !== arr[3] &&
        arr[3] === arr[4] && arr[4] !== arr[5] && arr[5] === arr[6]) {
      const pred = arr[6] === 'T' ? 'X' : 'T';
      return { pred, conf: 80, name: 'pattern_12121' };
    }
  }
  
  return null;
}

// 7. Cầu nhảy cóc
function analyzeSkip(arr) {
  if (arr.length < 6) return null;
  
  const skip = [arr[0], arr[2], arr[4]];
  const allSame = skip.every(v => v === skip[0]);
  
  if (allSame) {
    let conf = 68 + (skip.length - 2) * 4;
    return { pred: skip[0], conf: Math.min(85, conf), name: 'nhay_coc' };
  }
  
  // Nhảy cóc đảo
  let isAlt = true;
  for (let i = 1; i < skip.length; i++) {
    if (skip[i] === skip[i-1]) isAlt = false;
  }
  if (isAlt && skip.length >= 3) {
    const pred = skip[0] === 'T' ? 'X' : 'T';
    return { pred, conf: 72, name: 'nhay_coc_dao' };
  }
  
  return null;
}

// 8. Phân tích tổng điểm Fibonacci
function analyzeTotal(sums) {
  if (sums.length < 8) return null;
  
  const last4 = sums.slice(0, 4);
  const prev4 = sums.slice(4, 8);
  const avgLast4 = last4.reduce((a,b) => a+b, 0) / 4;
  const avgPrev4 = prev4.reduce((a,b) => a+b, 0) / 4;
  const diff = avgLast4 - avgPrev4;
  
  // Tổng tăng dần -> xu hướng Xỉu (tổng khó tăng tiếp)
  if (diff > 1.5) {
    return { pred: 'X', conf: 74, name: 'tong_tang' };
  }
  // Tổng giảm dần -> xu hướng Tài
  if (diff < -1.5) {
    return { pred: 'T', conf: 74, name: 'tong_giam' };
  }
  
  // Tổng đang ở vùng cao > 12
  const lastSum = sums[0];
  if (lastSum >= 13) {
    return { pred: 'X', conf: 68, name: 'tong_cao' };
  }
  if (lastSum <= 8) {
    return { pred: 'T', conf: 68, name: 'tong_thap' };
  }
  
  return null;
}

// 9. Cầu điện tử - pattern đặc biệt
function analyzeElectronic(arr) {
  if (arr.length < 6) return null;
  
  // T X X T X X
  if (arr[0] === 'T' && arr[1] === 'X' && arr[2] === 'X' && 
      arr[3] === 'T' && arr[4] === 'X' && arr[5] === 'X') {
    return { pred: 'T', conf: 82, name: 'dien_tu_txx' };
  }
  
  // X T T X T T
  if (arr[0] === 'X' && arr[1] === 'T' && arr[2] === 'T' && 
      arr[3] === 'X' && arr[4] === 'T' && arr[5] === 'T') {
    return { pred: 'X', conf: 82, name: 'dien_tu_xtt' };
  }
  
  return null;
}

// 10. Bẻ cầu dựa trên lịch sử pattern
function analyzeHistoryPattern(arr, type) {
  if (arr.length < 6) return null;
  
  const pattern = arr.slice(0, 4).join('');
  const history = stats[type].lastPredictions.slice(0, 50);
  
  let matchCount = 0;
  let nextResults = [];
  
  for (let i = 0; i < history.length - 4; i++) {
    const histPattern = history.slice(i, i+4).map(p => p.actualResult).join('');
    if (histPattern === pattern && history[i+4]?.actualResult) {
      matchCount++;
      nextResults.push(history[i+4].actualResult);
    }
  }
  
  if (matchCount >= 2 && nextResults.length > 0) {
    const tCount = nextResults.filter(r => r === 'Tài').length;
    const ratio = tCount / nextResults.length;
    
    if (ratio >= 0.7) {
      return { pred: 'T', conf: 70 + ratio * 10, name: 'lich_su_pattern' };
    }
    if (ratio <= 0.3) {
      return { pred: 'X', conf: 70 + (1-ratio) * 10, name: 'lich_su_pattern' };
    }
  }
  
  return null;
}

// ==================== TỔNG HỢP DỰ ĐOÁN ====================

function analyzeAll(data, type) {
  const arr = data.map(d => d.ketQua);
  const sums = data.map(d => d.tong);
  
  const analyzers = [
    analyzeBet,
    analyzeDao,
    analyzePairTriple,
    analyzeTrend5,
    analyzeTrend10,
    analyzeSmartPattern,
    analyzeSkip,
    (a) => analyzeTotal(sums),
    analyzeElectronic,
    (a) => analyzeHistoryPattern(a, type)
  ];
  
  let results = [];
  for (const fn of analyzers) {
    const res = fn(arr);
    if (res) results.push(res);
  }
  
  // Tính điểm
  let taiScore = 0, xiuScore = 0;
  let taiConfTotal = 0, xiuConfTotal = 0;
  
  for (const r of results) {
    if (r.pred === 'T') {
      taiScore += r.conf;
      taiConfTotal += r.conf;
    } else {
      xiuScore += r.conf;
      xiuConfTotal += r.conf;
    }
  }
  
  // Thêm trọng số cho các pattern từng chính xác
  for (const r of results) {
    const patternAcc = stats[type].patternAccuracy[r.name] || 50;
    const weight = patternAcc / 50;
    if (r.pred === 'T') taiScore += r.conf * weight;
    else xiuScore += r.conf * weight;
  }
  
  let finalPred, finalConf;
  const totalScore = taiScore + xiuScore;
  
  if (totalScore > 0) {
    const taiRatio = taiScore / totalScore;
    if (taiRatio > 0.55) {
      finalPred = 'T';
      finalConf = 55 + taiRatio * 35;
    } else if (taiRatio < 0.45) {
      finalPred = 'X';
      finalConf = 55 + (1 - taiRatio) * 35;
    } else {
      // Hòa: theo cầu đảo
      finalPred = arr[0] === 'T' ? 'X' : 'T';
      finalConf = 65;
    }
  } else {
    finalPred = arr[0] === 'T' ? 'X' : 'T';
    finalConf = 62;
  }
  
  return {
    pred: finalPred === 'T' ? 'Tài' : 'Xỉu',
    conf: Math.min(94, Math.max(58, Math.round(finalConf))),
    patternCount: results.length,
    topPattern: results[0]?.name || 'none'
  };
}

// ==================== CẬP NHẬT THỐNG KÊ ====================

function updateStats(type, phien, actualResult, predictedResult, patternName) {
  const isCorrect = predictedResult === actualResult;
  
  stats[type].total++;
  if (isCorrect) {
    stats[type].correct++;
    stats[type].streak = stats[type].streak > 0 ? stats[type].streak + 1 : 1;
  } else {
    stats[type].streak = stats[type].streak < 0 ? stats[type].streak - 1 : -1;
  }
  
  // Cập nhật độ chính xác của pattern
  if (patternName) {
    if (!stats[type].patternAccuracy[patternName]) {
      stats[type].patternAccuracy[patternName] = { total: 0, correct: 0 };
    }
    stats[type].patternAccuracy[patternName].total++;
    if (isCorrect) stats[type].patternAccuracy[patternName].correct++;
  }
  
  // Lưu dự đoán
  stats[type].lastPredictions.unshift({
    phien: phien,
    pred: predictedResult,
    actualResult: actualResult,
    isCorrect: isCorrect,
    timestamp: Date.now()
  });
  
  if (stats[type].lastPredictions.length > 200) {
    stats[type].lastPredictions.pop();
  }
  
  // Lưu file
  try {
    fs.writeFileSync('stats_pro.json', JSON.stringify(stats, null, 2));
  } catch(e) {}
}

// ==================== DỰ ĐOÁN CHÍNH ====================

async function getPrediction(type) {
  const data = await fetchData(type);
  if (!data || data.length < 5) return null;
  
  const latest = data[0];
  const nextPhien = latest.phien + 1;  // ← PHIÊN DỰ ĐOÁN
  
  // Kiểm tra kết quả của dự đoán trước
  const lastPred = stats[type].lastPredictions[0];
  if (lastPred && !lastPred.checked) {
    updateStats(type, lastPred.phien, latest.ketQua === 'T' ? 'Tài' : 'Xỉu', lastPred.pred, lastPred.patternName);
    lastPred.checked = true;
  }
  
  // Phân tích dữ liệu hiện tại
  const analysis = analyzeAll(data, type);
  
  // Áp dụng bẻ cầu dựa trên streak
  let finalPred = analysis.pred;
  let finalConf = analysis.conf;
  
  // Streak thua >= 3 -> bẻ cầu mạnh
  if (stats[type].streak <= -3) {
    finalPred = finalPred === 'Tài' ? 'Xỉu' : 'Tài';
    finalConf = Math.min(90, finalConf + 12);
  }
  
  // Streak thắng >= 4 -> cẩn thận, giảm nhẹ
  if (stats[type].streak >= 4) {
    finalConf = Math.max(60, finalConf - 6);
  }
  
  // Lưu dự đoán
  stats[type].lastPredictions.unshift({
    phien: nextPhien,
    pred: finalPred,
    patternName: analysis.topPattern,
    checked: false,
    timestamp: Date.now()
  });
  
  if (stats[type].lastPredictions.length > 200) {
    stats[type].lastPredictions.pop();
  }
  
  try {
    fs.writeFileSync('stats_pro.json', JSON.stringify(stats, null, 2));
  } catch(e) {}
  
  // ✅ TRẢ VỀ JSON CHUẨN: phiên dự đoán = phiên hiện tại + 1
  return {
    phien_du_doan: nextPhien,
    du_doan: finalPred,
    do_tin_cay: finalConf + '%'
  };
}

// ==================== LOAD DATA ====================

function loadStats() {
  try {
    if (fs.existsSync('stats_pro.json')) {
      const loaded = JSON.parse(fs.readFileSync('stats_pro.json', 'utf8'));
      stats = loaded;
      console.log('✅ Đã tải stats pro');
    }
  } catch(e) {}
}

loadStats();

// ==================== API ====================

app.get('/', (req, res) => {
  res.json({
    api: "Tài Xỉu Pro Max @anhquan",
    endpoints: ["/hu", "/md5", "/stats", "/reset"]
  });
});

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
    hu: { total: 0, correct: 0, streak: 0, lastPredictions: [], patternAccuracy: {} },
    md5: { total: 0, correct: 0, streak: 0, lastPredictions: [], patternAccuracy: {} }
  };
  try { fs.writeFileSync('stats_pro.json', JSON.stringify(stats, null, 2)); } catch(e) {}
  res.json({ message: "Đã reset dữ liệu", tac_gia: "@anhquan" });
});

// ==================== AUTO RUN ====================
let lastRun = { hu: null, md5: null };

async function autoRun() {
  const dataHu = await fetchData('hu');
  const dataMd5 = await fetchData('md5');
  
  if (dataHu && dataHu[0]) {
    const current = dataHu[0].phien;
    if (lastRun.hu !== current) {
      lastRun.hu = current;
      const res = await getPrediction('hu');
      if (res) console.log(`🤖 HU: ${res.phien_du_doan} → ${res.du_doan} (${res.do_tin_cay})`);
    }
  }
  
  if (dataMd5 && dataMd5[0]) {
    const current = dataMd5[0].phien;
    if (lastRun.md5 !== current) {
      lastRun.md5 = current;
      const res = await getPrediction('md5');
      if (res) console.log(`🤖 MD5: ${res.phien_du_doan} → ${res.du_doan} (${res.do_tin_cay})`);
    }
  }
}

setInterval(autoRun, 15000);
setTimeout(autoRun, 2000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Pro Max Server @anhquan - ${PORT}`);
  console.log(`📊 JSON: { "phien_du_doan": 123456, "du_doan": "Tài", "do_tin_cay": "85%" }`);
});
