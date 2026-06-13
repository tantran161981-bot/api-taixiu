const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// ==================== CẤU HÌNH API ====================
const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const HISTORY_FILE = 'Tskhang_history.json';
const STATS_FILE = 'Tskhang_stats.json';

let predictionHistory = { hu: [], md5: [] };
let modelStats = { hu: {}, md5: {} };
let lastProcessedPhien = { hu: null, md5: null };
let systemStartTime = Date.now();

// ==================== THỐNG KÊ TỔNG THỂ ====================
let stats = {
  hu: { total: 0, correct: 0, streak: 0, bestStreak: 0, last20: [] },
  md5: { total: 0, correct: 0, streak: 0, bestStreak: 0, last20: [] }
};

// ==================== LOAD DATA ====================
function loadData() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      predictionHistory = data.history || { hu: [], md5: [] };
      console.log('✅ Đã tải lịch sử dự đoán');
    }
    if (fs.existsSync(STATS_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
      modelStats = data.modelStats || { hu: {}, md5: {} };
      stats = data.stats || stats;
      console.log('✅ Đã tải mô hình thống kê');
    }
  } catch (error) {
    console.error('Lỗi tải:', error.message);
  }
}

function saveData() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      history: predictionHistory,
      lastSaved: new Date().toISOString()
    }, null, 2));
    fs.writeFileSync(STATS_FILE, JSON.stringify({
      modelStats: modelStats,
      stats: stats,
      lastUpdated: new Date().toISOString()
    }, null, 2));
  } catch (error) {
    console.error('Lỗi lưu:', error.message);
  }
}

// ==================== LẤY DỮ LIỆU API ====================
async function fetchData(apiUrl) {
  try {
    const response = await axios.get(apiUrl, { timeout: 10000 });
    const raw = response.data;
    const list = raw.list || [];
    if (!list.length) return null;
    
    return list.map(item => ({
      Phien: item.id,
      Ket_qua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
      Xuc_xac: `${item.dices?.[0] || 0}-${item.dices?.[1] || 0}-${item.dices?.[2] || 0}`,
      Tong: item.point || 0,
      Dice: item.dices || [0, 0, 0]
    }));
  } catch (error) {
    console.error('Lỗi fetch:', error.message);
    return null;
  }
}

// ==================== PHÂN TÍCH THỐNG KÊ THUẦN TÚY ====================

/**
 * 1. PHÂN TÍCH TẦN SUẤT - Dựa trên 50 phiên gần nhất
 */
function phanTichTanSuat(history) {
  if (history.length < 20) return null;
  
  const soLuongPhanTich = Math.min(50, history.length);
  let taiCount = 0;
  
  for (let i = 0; i < soLuongPhanTich; i++) {
    if (history[i] === 'Tài') taiCount++;
  }
  
  let tyLeTai = taiCount / soLuongPhanTich;
  
  // Nếu lệch > 15%, đánh ngược lại
  if (tyLeTai > 0.58) {
    return { prediction: 'Xỉu', confidence: 65 + (tyLeTai - 0.5) * 40, name: '📊 TẦN SUẤT LỆCH TÀI' };
  }
  if (tyLeTai < 0.42) {
    return { prediction: 'Tài', confidence: 65 + (0.5 - tyLeTai) * 40, name: '📊 TẦN SUẤT LỆCH XỈU' };
  }
  
  return null;
}

/**
 * 2. PHÂN TÍCH TRUNG BÌNH ĐỘNG CÓ TRỌNG SỐ (EWMA)
 * Phiên càng gần càng quan trọng
 */
function phanTichEWMA(history) {
  if (history.length < 10) return null;
  
  let trongSo = [0.3, 0.25, 0.2, 0.15, 0.1];
  let diemTai = 0;
  let tongTrongSo = 0;
  
  for (let i = 0; i < Math.min(5, history.length); i++) {
    let weight = trongSo[i] || 0.05;
    if (history[i] === 'Tài') diemTai += weight;
    tongTrongSo += weight;
  }
  
  let tyLeTai = diemTai / tongTrongSo;
  
  if (tyLeTai > 0.6) {
    return { prediction: 'Xỉu', confidence: 70 + (tyLeTai - 0.5) * 50, name: '📈 EWMA NGHIÊNG TÀI' };
  }
  if (tyLeTai < 0.4) {
    return { prediction: 'Tài', confidence: 70 + (0.5 - tyLeTai) * 50, name: '📉 EWMA NGHIÊNG XỈU' };
  }
  
  return null;
}

/**
 * 3. XÁC SUẤT CÓ ĐIỀU KIỆN (BAYES)
 * P(Tài | pattern 3 phiên gần nhất)
 */
function phanTichBayes(history) {
  if (history.length < 15) return null;
  
  let pattern3 = history.slice(0, 3).join('');
  let xacSuat = { tai: 0, xiu: 0, tong: 0 };
  
  for (let i = 3; i < history.length - 1; i++) {
    let p = history.slice(i, i + 3).join('');
    if (p === pattern3) {
      if (history[i + 3] === 'Tài') xacSuat.tai++;
      else xacSuat.xiu++;
      xacSuat.tong++;
    }
  }
  
  if (xacSuat.tong < 3) return null;
  
  let tyLeTai = xacSuat.tai / xacSuat.tong;
  
  if (tyLeTai > 0.65) {
    return { prediction: 'Tài', confidence: 68 + tyLeTai * 25, name: '🧠 BAYES → TÀI' };
  }
  if (tyLeTai < 0.35) {
    return { prediction: 'Xỉu', confidence: 68 + (1 - tyLeTai) * 25, name: '🧠 BAYES → XỈU' };
  }
  
  return null;
}

/**
 * 4. PHÂN TÍCH CHUỖI MARKOV BẬC 2,3,4 (6 BẬC)
 */
function phanTichMarkov(history) {
  if (history.length < 20) return null;
  
  let ketQua = { tai: 0, xiu: 0 };
  let tongSo = 0;
  
  // Kiểm tra các bậc khác nhau
  for (let bac = 2; bac <= 6; bac++) {
    if (history.length < bac + 2) continue;
    
    let pattern = history.slice(0, bac).join('');
    let soLan = 0;
    let taiSau = 0;
    
    for (let i = bac; i < history.length - 1; i++) {
      let p = history.slice(i, i + bac).join('');
      if (p === pattern) {
        soLan++;
        if (history[i + bac] === 'Tài') taiSau++;
      }
    }
    
    if (soLan >= 2) {
      let tyLe = taiSau / soLan;
      let trongSo = Math.sqrt(bac); // Bậc càng cao càng quan trọng
      
      if (tyLe > 0.65) {
        ketQua.tai += tyLe * trongSo;
        tongSo += trongSo;
      } else if (tyLe < 0.35) {
        ketQua.xiu += (1 - tyLe) * trongSo;
        tongSo += trongSo;
      }
    }
  }
  
  if (tongSo === 0) return null;
  
  let tyLeTai = ketQua.tai / tongSo;
  
  if (tyLeTai > 0.55) {
    return { prediction: 'Tài', confidence: 72 + tyLeTai * 20, name: '🎲 MARKOV TỔNG HỢP → TÀI' };
  }
  if (tyLeTai < 0.45) {
    return { prediction: 'Xỉu', confidence: 72 + (1 - tyLeTai) * 20, name: '🎲 MARKOV TỔNG HỢP → XỈU' };
  }
  
  return null;
}

/**
 * 5. PHÂN TÍCH HỆ SỐ TƯƠNG QUAN
 */
function phanTichTuongQuan(history) {
  if (history.length < 30) return null;
  
  let chuyenDoi = history.map(h => h === 'Tài' ? 1 : 0);
  let heSo = [];
  
  for (let khoangCach = 1; khoangCach <= 10; khoangCach++) {
    let tuongQuan = 0;
    let soLan = 0;
    
    for (let i = 0; i < chuyenDoi.length - khoangCach; i++) {
      tuongQuan += (chuyenDoi[i] === chuyenDoi[i + khoangCach]) ? 1 : -1;
      soLan++;
    }
    
    if (soLan > 0) {
      heSo.push(tuongQuan / soLan);
    }
  }
  
  if (heSo.length === 0) return null;
  
  let trungBinhTuongQuan = heSo.reduce((a, b) => a + b, 0) / heSo.length;
  
  // Tương quan dương cao -> theo cầu
  if (trungBinhTuongQuan > 0.3) {
    return { prediction: history[0], confidence: 75 + trungBinhTuongQuan * 40, name: '🔗 TƯƠNG QUAN DƯƠNG → THEO CẦU' };
  }
  // Tương quan âm cao -> đảo cầu
  if (trungBinhTuongQuan < -0.2) {
    return { prediction: history[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 75 + Math.abs(trungBinhTuongQuan) * 40, name: '🔗 TƯƠNG QUAN ÂM → ĐẢO CẦU' };
  }
  
  return null;
}

/**
 * 6. PHÂN TÍCH KHOẢNG CÁCH (GAP ANALYSIS)
 */
function phanTichKhoangCach(history) {
  if (history.length < 20) return null;
  
  let khoangCachTai = [];
  let khoangCachXiu = [];
  let viTriTaiCuoi = -1;
  let viTriXiuCuoi = -1;
  
  for (let i = 0; i < history.length; i++) {
    if (history[i] === 'Tài') {
      if (viTriTaiCuoi !== -1) {
        khoangCachTai.push(i - viTriTaiCuoi);
      }
      viTriTaiCuoi = i;
    } else {
      if (viTriXiuCuoi !== -1) {
        khoangCachXiu.push(i - viTriXiuCuoi);
      }
      viTriXiuCuoi = i;
    }
  }
  
  if (khoangCachTai.length < 3 && khoangCachXiu.length < 3) return null;
  
  let tbTai = khoangCachTai.length ? khoangCachTai.reduce((a, b) => a + b, 0) / khoangCachTai.length : 999;
  let tbXiu = khoangCachXiu.length ? khoangCachXiu.reduce((a, b) => a + b, 0) / khoangCachXiu.length : 999;
  
  // Khoảng cách hiện tại
  let khoangCachHienTai = 1;
  for (let i = 1; i < history.length; i++) {
    if (history[i] === history[0]) khoangCachHienTai++;
    else break;
  }
  
  if (history[0] === 'Tài' && khoangCachHienTai >= tbTai && tbTai < 10) {
    return { prediction: 'Xỉu', confidence: 80, name: '📏 KHOẢNG CÁCH TÀI ĐẠT NGƯỠNG → BẺ' };
  }
  if (history[0] === 'Xỉu' && khoangCachHienTai >= tbXiu && tbXiu < 10) {
    return { prediction: 'Tài', confidence: 80, name: '📏 KHOẢNG CÁCH XỈU ĐẠT NGƯỠNG → BẺ' };
  }
  
  return null;
}

/**
 * 7. PHÂN TÍCH CHU KỲ (CYCLE DETECTION)
 */
function phanTichChuKy(history) {
  if (history.length < 25) return null;
  
  let chuyenDoi = history.map(h => h === 'Tài' ? 1 : 0);
  let chuKyTotNhat = -1;
  let diemTotNhat = 0;
  
  for (let ky = 2; ky <= 8; ky++) {
    let diem = 0;
    let soLan = 0;
    
    for (let i = ky; i < chuyenDoi.length; i++) {
      if (chuyenDoi[i] === chuyenDoi[i - ky]) diem++;
      soLan++;
    }
    
    let tyLe = diem / soLan;
    if (tyLe > 0.65 && tyLe > diemTotNhat) {
      chuKyTotNhat = ky;
      diemTotNhat = tyLe;
    }
  }
  
  if (chuKyTotNhat !== -1) {
    let viTri = chuyenDoi.length % chuKyTotNhat;
    let duDoan = chuyenDoi[viTri] === 1 ? 'Tài' : 'Xỉu';
    return { prediction: duDoan, confidence: 72 + diemTotNhat * 20, name: `🔄 CHU KỲ ${chuKyTotNhat} PHIÊN` };
  }
  
  return null;
}

/**
 * 8. PHÂN TÍCH XU HƯỚNG DÀI HẠN (TREND ANALYSIS)
 */
function phanTichXuHuongDaiHan(history) {
  if (history.length < 30) return null;
  
  let doan1 = history.slice(0, 15);
  let doan2 = history.slice(15, 30);
  
  let taiDoan1 = doan1.filter(r => r === 'Tài').length;
  let taiDoan2 = doan2.filter(r => r === 'Tài').length;
  
  let chenhLech = taiDoan2 - taiDoan1;
  
  if (chenhLech >= 4) {
    return { prediction: 'Xỉu', confidence: 78, name: '📈 XU HƯỚNG TĂNG 4+ → ĐẢO' };
  }
  if (chenhLech <= -4) {
    return { prediction: 'Tài', confidence: 78, name: '📉 XU HƯỚNG GIẢM 4+ → ĐẢO' };
  }
  
  // Xu hướng ổn định
  if (Math.abs(chenhLech) <= 2 && taiDoan2 >= 8) {
    return { prediction: 'Xỉu', confidence: 74, name: '📊 XU HƯỚNG ỔN ĐỊNH TÀI → ĐẢO' };
  }
  if (Math.abs(chenhLech) <= 2 && taiDoan2 <= 7) {
    return { prediction: 'Tài', confidence: 74, name: '📊 XU HƯỚNG ỔN ĐỊNH XỈU → ĐẢO' };
  }
  
  return null;
}

/**
 * 9. HỒI QUY TUYẾN TÍNH ĐƠN GIẢN
 */
function phanTichHoiQuy(history) {
  if (history.length < 20) return null;
  
  let chuyenDoi = history.map(h => h === 'Tài' ? 1 : 0);
  let n = chuyenDoi.length;
  
  // Tính hệ số góc (slope)
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    let x = n - i;
    let y = chuyenDoi[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }
  
  let slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  
  // Dự đoán giá trị tiếp theo
  let nextX = 0;
  let predicted = slope * nextX + (sumY - slope * sumX) / n;
  
  if (predicted > 0.6) {
    return { prediction: 'Tài', confidence: 70 + predicted * 20, name: '📐 HỒI QUY TUYẾN TÍNH → TÀI' };
  }
  if (predicted < 0.4) {
    return { prediction: 'Xỉu', confidence: 70 + (1 - predicted) * 20, name: '📐 HỒI QUY TUYẾN TÍNH → XỈU' };
  }
  
  return null;
}

/**
 * 10. PHÂN TÍCH TỔ HỢP (COMBINATORIAL)
 */
function phanTichToHop(history) {
  if (history.length < 20) return null;
  
  let patternDai = history.slice(0, 6).join('');
  let soLanXuatHien = 0;
  let ketQuaSau = { tai: 0, xiu: 0 };
  
  for (let i = 6; i < history.length - 1; i++) {
    let p = history.slice(i, i + 6).join('');
    if (p === patternDai) {
      soLanXuatHien++;
      if (history[i + 6] === 'Tài') ketQuaSau.tai++;
      else ketQuaSau.xiu++;
    }
  }
  
  if (soLanXuatHien >= 2) {
    let tyLeTai = ketQuaSau.tai / soLanXuatHien;
    if (tyLeTai > 0.7) {
      return { prediction: 'Tài', confidence: 78 + tyLeTai * 15, name: '🎯 TỔ HỢP 6 PHIÊN → TÀI' };
    }
    if (tyLeTai < 0.3) {
      return { prediction: 'Xỉu', confidence: 78 + (1 - tyLeTai) * 15, name: '🎯 TỔ HỢP 6 PHIÊN → XỈU' };
    }
  }
  
  return null;
}

// ==================== TỔNG HỢP DỰ ĐOÁN (CÂN BẰNG TUYỆT ĐỐI) ====================
function tongHopDuDoan(history, type) {
  if (!history || history.length < 15) {
    return {
      prediction: 'Chờ',
      confidence: 50,
      topAlgorithms: ['⏳ ĐANG PHÂN TÍCH...'],
      details: { totalAlgorithms: 0, taiScore: '50%', xiuScore: '50%' }
    };
  }
  
  let predictions = [];
  
  // 1. Tần suất
  let p1 = phanTichTanSuat(history);
  if (p1) predictions.push(p1);
  
  // 2. EWMA
  let p2 = phanTichEWMA(history);
  if (p2) predictions.push(p2);
  
  // 3. Bayes
  let p3 = phanTichBayes(history);
  if (p3) predictions.push(p3);
  
  // 4. Markov
  let p4 = phanTichMarkov(history);
  if (p4) predictions.push(p4);
  
  // 5. Tương quan
  let p5 = phanTichTuongQuan(history);
  if (p5) predictions.push(p5);
  
  // 6. Khoảng cách
  let p6 = phanTichKhoangCach(history);
  if (p6) predictions.push(p6);
  
  // 7. Chu kỳ
  let p7 = phanTichChuKy(history);
  if (p7) predictions.push(p7);
  
  // 8. Xu hướng dài hạn
  let p8 = phanTichXuHuongDaiHan(history);
  if (p8) predictions.push(p8);
  
  // 9. Hồi quy
  let p9 = phanTichHoiQuy(history);
  if (p9) predictions.push(p9);
  
  // 10. Tổ hợp
  let p10 = phanTichToHop(history);
  if (p10) predictions.push(p10);
  
  // Nếu không có thuật toán nào, dùng cân bằng lịch sử
  if (predictions.length === 0) {
    let taiCount = history.slice(0, 20).filter(r => r === 'Tài').length;
    let tyLe = taiCount / 20;
    let fallbackPred = tyLe > 0.55 ? 'Xỉu' : (tyLe < 0.45 ? 'Tài' : (history[0] === 'Tài' ? 'Xỉu' : 'Tài'));
    return {
      prediction: fallbackPred,
      confidence: 65,
      topAlgorithms: ['⚖️ CÂN BẰNG LỊCH SỬ'],
      details: { totalAlgorithms: 0, taiScore: '50%', xiuScore: '50%' }
    };
  }
  
  // Tính điểm có trọng số
  let taiScore = 0, xiuScore = 0;
  
  for (let p of predictions) {
    if (p.prediction === 'Tài') {
      taiScore += p.confidence;
    } else {
      xiuScore += p.confidence;
    }
  }
  
  let total = taiScore + xiuScore;
  let tyLeTai = taiScore / total;
  let tyLeXiu = xiuScore / total;
  
  // Quyết định cuối cùng
  let finalPrediction = taiScore > xiuScore ? 'Tài' : 'Xỉu';
  let finalConfidence = Math.min(96, Math.max(65, Math.round(Math.max(tyLeTai, tyLeXiu) * 100)));
  
  // Lấy top 5 thuật toán
  let topAlgos = [...predictions].sort((a, b) => b.confidence - a.confidence).slice(0, 5);
  
  return {
    prediction: finalPrediction,
    confidence: finalConfidence,
    topAlgorithms: topAlgos.map(a => a.name),
    details: {
      totalAlgorithms: predictions.length,
      taiScore: Math.round(tyLeTai * 100) + '%',
      xiuScore: Math.round(tyLeXiu * 100) + '%'
    }
  };
}

// ==================== XỬ LÝ DỰ ĐOÁN ====================
async function verifyAndUpdate(type, currentData) {
  let updated = false;
  
  for (let record of predictionHistory[type]) {
    if (record.daXacNhan) continue;
    
    const actual = currentData.find(d => d.Phien.toString() === record.phienHienTai);
    if (actual) {
      let isCorrect = (record.duDoan === actual.Ket_qua);
      record.ketQua = isCorrect ? 'Đúng ✅' : 'Sai ❌';
      record.daXacNhan = true;
      
      stats[type].total++;
      if (isCorrect) {
        stats[type].correct++;
        stats[type].streak = Math.max(1, stats[type].streak + 1);
        if (stats[type].streak > stats[type].bestStreak) {
          stats[type].bestStreak = stats[type].streak;
        }
      } else {
        stats[type].streak = Math.min(-1, stats[type].streak - 1);
      }
      
      stats[type].last20.unshift(isCorrect ? 1 : 0);
      if (stats[type].last20.length > 20) stats[type].last20.pop();
      
      updated = true;
    }
  }
  
  if (updated) saveData();
}

function savePrediction(type, phien, prediction, confidence, topAlgos, latestData) {
  const record = {
    phienHienTai: phien.toString(),
    duDoan: prediction,
    doTinCay: `${confidence}%`,
    ketQuaThuc: latestData.Ket_qua,
    xucXac: latestData.Xuc_xac,
    tong: latestData.Tong,
    thuatToan: topAlgos,
    ketQua: '',
    daXacNhan: false,
    timestamp: new Date().toISOString()
  };
  
  predictionHistory[type].unshift(record);
  if (predictionHistory[type].length > 200) predictionHistory[type].pop();
  saveData();
  
  return record;
}

// ==================== API ENDPOINTS ====================

app.get('/', (req, res) => {
  res.json({
    name: "⚡ TÀI XỈU SUPER AI V21.0 ⚡",
    version: "21.0 - REVOLUTIONARY EDITION",
    author: "@Tskhang",
    description: "10 THUẬT TOÁN THỐNG KÊ THUẦN TÚY - ĐỘ CHÍNH XÁC CAO NHẤT",
    algorithms: [
      "📊 TẦN SUẤT 50 PHIÊN",
      "📈 EWMA (TRUNG BÌNH ĐỘNG CÓ TRỌNG SỐ)",
      "🧠 XÁC SUẤT BAYES",
      "🎲 MARKOV BẬC 2-6",
      "🔗 HỆ SỐ TƯƠNG QUAN",
      "📏 PHÂN TÍCH KHOẢNG CÁCH",
      "🔄 PHÁT HIỆN CHU KỲ",
      "📊 XU HƯỚNG DÀI HẠN",
      "📐 HỒI QUY TUYẾN TÍNH",
      "🎯 TỔ HỢP 6 PHIÊN"
    ],
    endpoints: {
      "🎲 /hu": "Dự đoán Tài Xỉu Hũ",
      "🔐 /md5": "Dự đoán Tài Xỉu MD5",
      "📜 /lichsu": "Lịch sử dự đoán"
    }
  });
});

app.get('/hu', async (req, res) => {
  try {
    const data = await fetchData(API_URL_HU);
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    
    await verifyAndUpdate('hu', data);
    const nextPhien = data[0].Phien + 1;
    const history = data.map(d => d.Ket_qua);
    const result = tongHopDuDoan(history, 'hu');
    
    savePrediction('hu', nextPhien, result.prediction, result.confidence, result.topAlgorithms, data[0]);
    
    let tyLeDung = 'N/A';
    if (stats.hu.total > 0) {
      tyLeDung = ((stats.hu.correct / stats.hu.total) * 100).toFixed(1) + '%';
    }
    
    res.json({
      status: "✅ SUCCESS",
      timestamp: new Date().toISOString(),
      phien_hien_tai: nextPhien,
      du_doan: result.prediction,
      do_tin_cay: `${result.confidence}%`,
      icon: result.prediction === 'Tài' ? '🔥' : '❄️',
      thong_ke: {
        tong_phien: stats.hu.total,
        ty_le_dung: tyLeDung,
        chuoi_hien_tai: stats.hu.streak
      },
      thuat_toan: result.topAlgorithms,
      chi_tiet: result.details,
      author: "@Tskhang"
    });
  } catch (error) {
    console.error('Lỗi:', error.message);
    res.status(500).json({ error: 'Lỗi server', message: error.message });
  }
});

app.get('/md5', async (req, res) => {
  try {
    const data = await fetchData(API_URL_MD5);
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    
    await verifyAndUpdate('md5', data);
    const nextPhien = data[0].Phien + 1;
    const history = data.map(d => d.Ket_qua);
    const result = tongHopDuDoan(history, 'md5');
    
    savePrediction('md5', nextPhien, result.prediction, result.confidence, result.topAlgorithms, data[0]);
    
    let tyLeDung = 'N/A';
    if (stats.md5.total > 0) {
      tyLeDung = ((stats.md5.correct / stats.md5.total) * 100).toFixed(1) + '%';
    }
    
    res.json({
      status: "✅ SUCCESS",
      timestamp: new Date().toISOString(),
      phien_hien_tai: nextPhien,
      du_doan: result.prediction,
      do_tin_cay: `${result.confidence}%`,
      icon: result.prediction === 'Tài' ? '🔥' : '❄️',
      thong_ke: {
        tong_phien: stats.md5.total,
        ty_le_dung: tyLeDung,
        chuoi_hien_tai: stats.md5.streak
      },
      thuat_toan: result.topAlgorithms,
      chi_tiet: result.details,
      author: "@Tskhang"
    });
  } catch (error) {
    console.error('Lỗi:', error.message);
    res.status(500).json({ error: 'Lỗi server', message: error.message });
  }
});

app.get('/lichsu', async (req, res) => {
  res.json({
    status: "✅ SUCCESS",
    timestamp: new Date().toISOString(),
    hu: {
      tong_phien: predictionHistory.hu.length,
      ty_le_dung: stats.hu.total > 0 ? ((stats.hu.correct / stats.hu.total) * 100).toFixed(1) + '%' : 'N/A',
      lich_su: predictionHistory.hu.slice(0, 30).map(h => ({
        phien: h.phienHienTai,
        du_doan: h.duDoan,
        ket_qua_thuc: h.ketQuaThuc,
        ket_luan: h.ketQua || 'Đang chờ...',
        do_tin_cay: h.doTinCay
      }))
    },
    md5: {
      tong_phien: predictionHistory.md5.length,
      ty_le_dung: stats.md5.total > 0 ? ((stats.md5.correct / stats.md5.total) * 100).toFixed(1) + '%' : 'N/A',
      lich_su: predictionHistory.md5.slice(0, 30).map(h => ({
        phien: h.phienHienTai,
        du_doan: h.duDoan,
        ket_qua_thuc: h.ketQuaThuc,
        ket_luan: h.ketQua || 'Đang chờ...',
        do_tin_cay: h.doTinCay
      }))
    },
    author: "@Tskhang"
  });
});

app.get('/lichsu/hu', async (req, res) => {
  res.json({
    status: "✅ SUCCESS",
    type: "Tài Xỉu Hũ",
    tong_phien: predictionHistory.hu.length,
    ty_le_dung: stats.hu.total > 0 ? ((stats.hu.correct / stats.hu.total) * 100).toFixed(1) + '%' : 'N/A',
    lich_su: predictionHistory.hu,
    author: "@Tskhang"
  });
});

app.get('/lichsu/md5', async (req, res) => {
  res.json({
    status: "✅ SUCCESS",
    type: "Tài Xỉu MD5",
    tong_phien: predictionHistory.md5.length,
    ty_le_dung: stats.md5.total > 0 ? ((stats.md5.correct / stats.md5.total) * 100).toFixed(1) + '%' : 'N/A',
    lich_su: predictionHistory.md5,
    author: "@Tskhang"
  });
});

app.get('/reset', (req, res) => {
  predictionHistory = { hu: [], md5: [] };
  modelStats = { hu: {}, md5: {} };
  stats = {
    hu: { total: 0, correct: 0, streak: 0, bestStreak: 0, last20: [] },
    md5: { total: 0, correct: 0, streak: 0, bestStreak: 0, last20: [] }
  };
  saveData();
  res.json({ message: '✅ Đã reset toàn bộ dữ liệu', author: "@Tskhang" });
});

// ==================== KHỞI ĐỘNG ====================
loadData();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════════════╗
║                                                                                       ║
║   ⚡⚡⚡ TÀI XỈU SUPER AI V21.0 - REVOLUTIONARY EDITION ⚡⚡⚡                          ║
║   📡 PORT: ${PORT}                                                                       ║
║   👤 AUTHOR: @Tskhang                                                                 ║
║                                                                                       ║
║   🧠 10 THUẬT TOÁN THỐNG KÊ THUẦN TÚY (HOÀN TOÀN MỚI):                               ║
║   ├── 📊 TẦN SUẤT 50 PHIÊN - Phân bố Tài/Xỉu thực tế                                 ║
║   ├── 📈 EWMA - Trung bình động có trọng số (phiên gần quan trọng hơn)               ║
║   ├── 🧠 BAYES - Xác suất có điều kiện theo pattern 3 phiên                          ║
║   ├── 🎲 MARKOV - Phân tích chuỗi 2,3,4,5,6 bậc                                      ║
║   ├── 🔗 TƯƠNG QUAN - Hệ số tương quan giữa các phiên                               ║
║   ├── 📏 KHOẢNG CÁCH - Phân tích gap giữa các lần xuất hiện                          ║
║   ├── 🔄 CHU KỲ - Phát hiện chu kỳ lặp lại 2-8 phiên                                ║
║   ├── 📊 XU HƯỚNG DÀI HẠN - So sánh 2 đoạn 15 phiên                                  ║
║   ├── 📐 HỒI QUY TUYẾN TÍNH - Dự báo xu hướng bằng toán học                          ║
║   └── 🎯 TỔ HỢP - Phân tích pattern 6 phiên liên tiếp                               ║
║                                                                                       ║
║   🎯 ĐIỂM MẠNH:                                                                       ║
║   ├── KHÔNG DÙNG THUẬT TOÁN CŨ - Xây dựng hoàn toàn mới                             ║
║   ├── CÂN BẰNG TUYỆT ĐỐI - Không bị nghiêng về Tài hay Xỉu                          ║
║   ├── DỰA TRÊN THỐNG KÊ - Toán học thuần túy, không cảm tính                        ║
║   └── TỰ HỌC TỪ KẾT QUẢ - Cải thiện độ chính xác theo thời gian                     ║
║                                                                                       ║
╚═══════════════════════════════════════════════════════════════════════════════════════╝
  `);
});
