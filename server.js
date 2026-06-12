const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

let history = { hu: [], md5: [] };
let stats = {
  hu: { total: 0, correct: 0, streak: 0, lastPredictions: [] },
  md5: { total: 0, correct: 0, streak: 0, lastPredictions: [] }
};

// ==================== THUẬT TOÁN DỰ ĐOÁN CỐT LÕI ====================

// Lấy dữ liệu
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

// ==================== THUẬT TOÁN PHÂN TÍCH SIÊU CẤP ====================

function analyzeAll(data) {
  const arr = data.map(d => d.ketQua);
  const sums = data.map(d => d.tong);
  
  let taiVotes = 0, xiuVotes = 0;
  let taiConf = 0, xiuConf = 0;
  
  // ========== 1. CẦU BỆT - BẺ THÔNG MINH ==========
  let betLength = 1;
  for (let i = 1; i < arr.length && i < 15; i++) {
    if (arr[i] === arr[0]) betLength++;
    else break;
  }
  
  if (betLength >= 2) {
    let shouldBreak = betLength >= 4 || (betLength === 3 && arr.length >= 8);
    let pred = shouldBreak ? (arr[0] === 'T' ? 'X' : 'T') : arr[0];
    let conf = 65 + Math.min(20, betLength * 3);
    if (betLength >= 6) conf = 82;
    if (pred === 'T') { taiVotes += 3; taiConf += conf; }
    else { xiuVotes += 3; xiuConf += conf; }
  }
  
  // ========== 2. CẦU ĐẢO 1-1 ==========
  let daoLength = 1;
  for (let i = 1; i < arr.length && i < 12; i++) {
    if (arr[i] !== arr[i-1]) daoLength++;
    else break;
  }
  if (daoLength >= 3) {
    let pred = arr[0] === 'T' ? 'X' : 'T';
    let conf = 63 + Math.min(22, daoLength * 3);
    if (daoLength >= 6) conf = 80;
    if (pred === 'T') { taiVotes += 2; taiConf += conf; }
    else { xiuVotes += 2; xiuConf += conf; }
  }
  
  // ========== 3. CẦU 2-2 (cặp đôi) ==========
  let pairs = [];
  for (let i = 0; i < arr.length - 1; i += 2) {
    if (arr[i] === arr[i+1]) pairs.push(arr[i]);
    else break;
  }
  if (pairs.length >= 2) {
    let last = pairs[pairs.length - 1];
    let pred = last === 'T' ? 'X' : 'T';
    let conf = 68 + Math.min(15, pairs.length * 4);
    if (pred === 'T') { taiVotes += 2; taiConf += conf; }
    else { xiuVotes += 2; xiuConf += conf; }
  }
  
  // ========== 4. CẦU 3-3 (bộ ba) ==========
  let triples = [];
  for (let i = 0; i < arr.length - 2; i += 3) {
    if (arr[i] === arr[i+1] && arr[i+1] === arr[i+2]) triples.push(arr[i]);
    else break;
  }
  if (triples.length >= 1) {
    let last = triples[triples.length - 1];
    let remaining = arr.length % 3;
    let pred = (remaining === 0) ? (last === 'T' ? 'X' : 'T') : last;
    let conf = 70 + triples.length * 5;
    if (pred === 'T') { taiVotes += 2; taiConf += conf; }
    else { xiuVotes += 2; xiuConf += conf; }
  }
  
  // ========== 5. XU HƯỚNG 5 PHIÊN GẦN NHẤT ==========
  if (arr.length >= 5) {
    const last5 = arr.slice(0, 5);
    const t5 = last5.filter(x => x === 'T').length;
    if (t5 >= 4) {
      let conf = 72 + t5 * 2;
      if (t5 === 5) { xiuVotes += 4; xiuConf += conf + 5; }
      else { xiuVotes += 3; xiuConf += conf; }
    } else if (t5 <= 1) {
      let conf = 72 + (5 - t5) * 2;
      if (t5 === 0) { taiVotes += 4; taiConf += conf + 5; }
      else { taiVotes += 3; taiConf += conf; }
    }
  }
  
  // ========== 6. XU HƯỚNG 10 PHIÊN (CỰC ĐOAN) ==========
  if (arr.length >= 10) {
    const last10 = arr.slice(0, 10);
    const t10 = last10.filter(x => x === 'T').length;
    if (t10 >= 7) {
      let conf = 78 + (t10 - 6) * 3;
      xiuVotes += 5;
      xiuConf += conf;
    } else if (t10 <= 3) {
      let conf = 78 + (4 - t10) * 3;
      taiVotes += 5;
      taiConf += conf;
    }
  }
  
  // ========== 7. CẦU NHẢY CÓC ==========
  if (arr.length >= 6) {
    const skip = [arr[0], arr[2], arr[4]];
    if (skip.length >= 3 && skip.every(v => v === skip[0])) {
      let pred = skip[0];
      let conf = 70;
      if (pred === 'T') { taiVotes += 2; taiConf += conf; }
      else { xiuVotes += 2; xiuConf += conf; }
    }
  }
  
  // ========== 8. PHÂN TÍCH TỔNG ĐIỂM ==========
  if (sums.length >= 6) {
    const last3 = sums.slice(0, 3);
    const prev3 = sums.slice(3, 6);
    const avgLast3 = last3.reduce((a, b) => a + b, 0) / 3;
    const avgPrev3 = prev3.reduce((a, b) => a + b, 0) / 3;
    const diff = avgLast3 - avgPrev3;
    
    if (diff > 1.2) {
      xiuVotes += 2;
      xiuConf += 72;
    } else if (diff < -1.2) {
      taiVotes += 2;
      taiConf += 72;
    }
  }
  
  // ========== 9. PATTERN 1-2-1 ==========
  if (arr.length >= 4) {
    if (arr[0] !== arr[1] && arr[1] === arr[2] && arr[2] !== arr[3] && arr[0] === arr[3]) {
      let pred = arr[0];
      let conf = 74;
      if (pred === 'T') { taiVotes += 2; taiConf += conf; }
      else { xiuVotes += 2; xiuConf += conf; }
    }
  }
  
  // ========== 10. CHUỖI THUA - BẺ CẦU CỨNG ==========
  // Đọc từ lịch sử dự đoán để biết đang thua hay thắng
  // Logic này sẽ được tích hợp ở hàm chính
  
  // ========== TỔNG HỢP ==========
  let finalPred = 'T';
  let finalConf = 65;
  
  const totalTaiVotes = taiVotes + (taiConf / 20);
  const totalXiuVotes = xiuVotes + (xiuConf / 20);
  
  if (totalTaiVotes > totalXiuVotes) {
    finalPred = 'T';
    finalConf = Math.min(92, 60 + (totalTaiVotes - totalXiuVotes) * 4 + (taiConf / 10));
  } else if (totalXiuVotes > totalTaiVotes) {
    finalPred = 'X';
    finalConf = Math.min(92, 60 + (totalXiuVotes - totalTaiVotes) * 4 + (xiuConf / 10));
  } else {
    // Hòa thì theo cầu hiện tại
    finalPred = arr[0] === 'T' ? 'X' : 'T';
    finalConf = 65;
  }
  
  return {
    pred: finalPred === 'T' ? 'Tài' : 'Xỉu',
    conf: Math.round(finalConf)
  };
}

// ==================== KIỂM TRA KẾT QUẢ THỰC TẾ ====================

function updateStats(type, lastPhien, actualResult) {
  // Tìm dự đoán gần nhất chưa có kết quả
  const lastPredictions = stats[type].lastPredictions;
  for (let i = 0; i < lastPredictions.length; i++) {
    if (lastPredictions[i].phien === lastPhien && !lastPredictions[i].checked) {
      const isCorrect = lastPredictions[i].pred === actualResult;
      lastPredictions[i].checked = true;
      lastPredictions[i].result = isCorrect;
      
      stats[type].total++;
      if (isCorrect) {
        stats[type].correct++;
        stats[type].streak = Math.max(1, stats[type].streak + 1);
      } else {
        stats[type].streak = Math.min(-1, stats[type].streak - 1);
      }
      break;
    }
  }
  
  // Giới hạn lịch sử
  if (stats[type].lastPredictions.length > 100) {
    stats[type].lastPredictions = stats[type].lastPredictions.slice(0, 100);
  }
  
  // Lưu file
  try {
    fs.writeFileSync('stats.json', JSON.stringify(stats, null, 2));
  } catch(e) {}
}

// ==================== DỰ ĐOÁN CHÍNH ====================

async function getPrediction(type) {
  const data = await fetchData(type);
  if (!data || data.length === 0) return null;
  
  const latest = data[0];
  const nextPhien = latest.phien + 1;
  
  // Cập nhật kết quả cho dự đoán trước
  const lastPrediction = stats[type].lastPredictions[0];
  if (lastPrediction && !lastPrediction.checked) {
    updateStats(type, lastPrediction.phien, latest.ketQua === 'T' ? 'Tài' : 'Xỉu');
  }
  
  // Phân tích từ dữ liệu hiện tại
  const analysis = analyzeAll(data);
  
  // Áp dụng bẻ cầu dựa trên streak thực tế
  let finalPred = analysis.pred;
  let finalConf = analysis.conf;
  
  // Nếu đang thua liên tiếp >= 3, ưu tiên bẻ cầu mạnh
  if (stats[type].streak <= -3) {
    const opposite = finalPred === 'Tài' ? 'Xỉu' : 'Tài';
    finalPred = opposite;
    finalConf = Math.min(88, finalConf + 10);
  }
  
  // Nếu đang thắng liên tiếp >= 3, giảm nhẹ confidence (cẩn thận)
  if (stats[type].streak >= 3) {
    finalConf = Math.max(60, finalConf - 5);
  }
  
  // Lưu dự đoán
  stats[type].lastPredictions.unshift({
    phien: nextPhien,
    pred: finalPred,
    conf: finalConf,
    checked: false,
    timestamp: Date.now()
  });
  
  // Tự động lưu
  try {
    fs.writeFileSync('stats.json', JSON.stringify(stats, null, 2));
  } catch(e) {}
  
  return {
    phien_hien_tai: latest.phien,
    du_doan: finalPred,
    do_tin_cay: finalConf + '%'
  };
}

// ==================== LOAD DATA ====================

function loadStats() {
  try {
    if (fs.existsSync('stats.json')) {
      const loaded = JSON.parse(fs.readFileSync('stats.json', 'utf8'));
      stats = loaded;
      console.log('✅ Đã tải stats');
    }
  } catch(e) {}
}

loadStats();

// ==================== API ====================

app.get('/', (req, res) => {
  res.json({
    api: "Tài Xỉu Pro @anhquan",
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
    hu: {
      tong_du_doan: stats.hu.total,
      dung: stats.hu.correct,
      sai: stats.hu.total - stats.hu.correct,
      ty_le: accHu + '%',
      chuoi_hien_tai: stats.hu.streak
    },
    md5: {
      tong_du_doan: stats.md5.total,
      dung: stats.md5.correct,
      sai: stats.md5.total - stats.md5.correct,
      ty_le: accMd5 + '%',
      chuoi_hien_tai: stats.md5.streak
    }
  });
});

app.get('/reset', (req, res) => {
  stats = {
    hu: { total: 0, correct: 0, streak: 0, lastPredictions: [] },
    md5: { total: 0, correct: 0, streak: 0, lastPredictions: [] }
  };
  try { fs.writeFileSync('stats.json', JSON.stringify(stats, null, 2)); } catch(e) {}
  res.json({ message: "Đã reset", tac_gia: "@anhquan" });
});

// ==================== AUTO RUN ====================
let lastRun = { hu: null, md5: null };

async function autoRun() {
  const dataHu = await fetchData('hu');
  const dataMd5 = await fetchData('md5');
  
  if (dataHu && dataHu[0]) {
    const currentPhien = dataHu[0].phien;
    if (lastRun.hu !== currentPhien) {
      lastRun.hu = currentPhien;
      const result = await getPrediction('hu');
      if (result) console.log(`[Auto HU] ${result.phien_hien_tai} → ${result.du_doan} (${result.do_tin_cay})`);
    }
  }
  
  if (dataMd5 && dataMd5[0]) {
    const currentPhien = dataMd5[0].phien;
    if (lastRun.md5 !== currentPhien) {
      lastRun.md5 = currentPhien;
      const result = await getPrediction('md5');
      if (result) console.log(`[Auto MD5] ${result.phien_hien_tai} → ${result.du_doan} (${result.do_tin_cay})`);
    }
  }
}

setInterval(autoRun, 15000);
setTimeout(autoRun, 3000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Pro Server @anhquan - ${PORT}`);
  console.log(`✅ JSON: { phien_hien_tai, du_doan, do_tin_cay }`);
});
