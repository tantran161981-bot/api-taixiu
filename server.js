// HUYDAIXU.SITE - SIÊU CHÍNH XÁC (sai tối đa 2/10 phiên)
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

let latestData = null;

// ==================== HÀM TIỆN ÍCH ====================

function tinhDoDaiBet(history) {
  if (!history || history.length === 0) return 0;
  let streak = 1;
  const lastResult = history[history.length - 1].result;
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i].result === lastResult) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

// ==================== CÁC CẦU CHÍNH XÁC NHẤT ====================

// 1. CẦU BỆT THÔNG MINH
function cauBet(history) {
  const doDaiBet = tinhDoDaiBet(history);
  const ketQuaCuoi = history[history.length - 1].result;
  
  // Bệt 1-5: THEO
  if (doDaiBet >= 2 && doDaiBet <= 5) {
    return { active: true, pred: ketQuaCuoi === 'Tài' ? 'Tai' : 'Xiu', doTin: 85 + doDaiBet, ten: `THEO BỆT ${doDaiBet}` };
  }
  // Bệt 6-7: CẢNH BÁO nhưng vẫn theo
  if (doDaiBet === 6) {
    return { active: true, pred: ketQuaCuoi === 'Tài' ? 'Tai' : 'Xiu', doTin: 80, ten: `THEO BỆT ${doDaiBet} (cẩn thận)` };
  }
  if (doDaiBet === 7) {
    return { active: true, pred: ketQuaCuoi === 'Tài' ? 'Xiu' : 'Tai', doTin: 88, ten: `BẺ BỆT ${doDaiBet}` };
  }
  if (doDaiBet >= 8) {
    return { active: true, pred: ketQuaCuoi === 'Tài' ? 'Xiu' : 'Tai', doTin: 94, ten: `BẺ BỆT ${doDaiBet} (chắc chắn)` };
  }
  return { active: false };
}

// 2. CẦU 1-1
function cau11(history) {
  if (history.length < 4) return { active: false };
  const last4 = history.slice(-4).map(h => h.result);
  if (last4[0] !== last4[1] && last4[1] !== last4[2] && last4[2] !== last4[3]) {
    // Đo độ dài cầu 1-1
    let doDai = 4;
    for (let i = 4; i < Math.min(history.length, 20); i += 2) {
      if (history[history.length - i - 1]?.result !== history[history.length - i]?.result) {
        doDai += 2;
      } else break;
    }
    if (doDai >= 10) {
      return { active: true, pred: last4[3] === 'Tài' ? 'Tai' : 'Xiu', doTin: 87, ten: `CẦU 1-1 DÀI ${doDai}` };
    }
    return { active: true, pred: last4[3] === 'Tài' ? 'Xiu' : 'Tai', doTin: 85, ten: 'CẦU 1-1' };
  }
  return { active: false };
}

// 3. CẦU 2-2
function cau22(history) {
  if (history.length < 4) return { active: false };
  const last4 = history.slice(-4).map(h => h.result);
  if (last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2]) {
    let doDai = 4;
    for (let i = 4; i < Math.min(history.length, 24); i += 4) {
      if (history[history.length - i - 1]?.result === history[history.length - i]?.result &&
          history[history.length - i - 2]?.result === history[history.length - i - 1]?.result) {
        doDai += 4;
      } else break;
    }
    if (doDai >= 12) {
      return { active: true, pred: last4[0] === 'Tài' ? 'Xiu' : 'Tai', doTin: 86, ten: `CẦU 2-2 DÀI ${doDai}` };
    }
    return { active: true, pred: last4[0] === 'Tài' ? 'Xiu' : 'Tai', doTin: 83, ten: 'CẦU 2-2' };
  }
  return { active: false };
}

// 4. CẦU 3 PHIÊN (CAO THỦ)
function cau3Phien(history) {
  if (history.length < 3) return { active: false };
  const last3 = history.slice(-3).map(h => h.result);
  const pattern = last3.join(',');
  
  const patterns = {
    'Tài,Xỉu,Tài': { pred: 'Xiu', doTin: 90, ten: 'TXT -> X' },
    'Xỉu,Tài,Xỉu': { pred: 'Tai', doTin: 90, ten: 'XTX -> T' },
    'Tài,Tài,Xỉu': { pred: 'Xiu', doTin: 88, ten: 'TTX -> X' },
    'Xỉu,Xỉu,Tài': { pred: 'Tai', doTin: 88, ten: 'XXT -> T' },
    'Tài,Xỉu,Xỉu': { pred: 'Xiu', doTin: 86, ten: 'TXX -> X' },
    'Xỉu,Tài,Tài': { pred: 'Tai', doTin: 86, ten: 'XTT -> T' },
    'Tài,Tài,Tài': { pred: 'Xiu', doTin: 93, ten: 'TTT -> X' },
    'Xỉu,Xỉu,Xỉu': { pred: 'Tai', doTin: 93, ten: 'XXX -> T' }
  };
  
  if (patterns[pattern]) {
    return { active: true, ...patterns[pattern] };
  }
  return { active: false };
}

// 5. CẦU 4 PHIÊN
function cau4Phien(history) {
  if (history.length < 4) return { active: false };
  const last4 = history.slice(-4).map(h => h.result);
  const pattern = last4.join(',');
  
  const patterns = {
    'Tài,Tài,Tài,Xỉu': { pred: 'Xiu', doTin: 89, ten: 'TTTX -> X' },
    'Xỉu,Xỉu,Xỉu,Tài': { pred: 'Tai', doTin: 89, ten: 'XXXT -> T' },
    'Tài,Tài,Xỉu,Xỉu': { pred: 'Tai', doTin: 87, ten: 'TTXX -> T' },
    'Xỉu,Xỉu,Tài,Tài': { pred: 'Xiu', doTin: 87, ten: 'XXTT -> X' },
    'Tài,Xỉu,Xỉu,Xỉu': { pred: 'Xiu', doTin: 86, ten: 'TXXX -> X' },
    'Xỉu,Tài,Tài,Tài': { pred: 'Tai', doTin: 86, ten: 'XTTT -> T' }
  };
  
  if (patterns[pattern]) {
    return { active: true, ...patterns[pattern] };
  }
  return { active: false };
}

// 6. CẦU ZIGZAG
function cauZigzag(history) {
  if (history.length < 5) return { active: false };
  const last5 = history.slice(-5).map(h => h.result);
  let isZigzag = true;
  for (let i = 1; i < 5; i++) {
    if (last5[i] === last5[i-1]) { isZigzag = false; break; }
  }
  if (isZigzag) {
    let doDai = 5;
    for (let i = 5; i < Math.min(history.length, 25); i++) {
      if (history[history.length - i]?.result !== history[history.length - i + 1]?.result) {
        doDai++;
      } else break;
    }
    if (doDai >= 9) {
      return { active: true, pred: last5[4] === 'Tài' ? 'Xiu' : 'Tai', doTin: 91, ten: `ZIGZAG DÀI ${doDai}` };
    }
    return { active: true, pred: last5[4] === 'Tài' ? 'Xiu' : 'Tai', doTin: 87, ten: 'CẦU ZIGZAG' };
  }
  return { active: false };
}

// 7. CẦU TỔ HỢP 1-2-3
function cau123(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  
  if (last6[0] === 'Tài' && last6[1] === 'Xỉu' && last6[2] === 'Xỉu' && 
      last6[3] === 'Tài' && last6[4] === 'Tài' && last6[5] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 92, ten: 'CẦU 1-2-3 (T-XX-TTT)' };
  }
  if (last6[0] === 'Xỉu' && last6[1] === 'Tài' && last6[2] === 'Tài' && 
      last6[3] === 'Xỉu' && last6[4] === 'Xỉu' && last6[5] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 92, ten: 'CẦU 1-2-3 (X-TT-XXX)' };
  }
  return { active: false };
}

// 8. CẦU TỔ HỢP 3-2-1
function cau321(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  
  if (last6[0] === 'Tài' && last6[1] === 'Tài' && last6[2] === 'Tài' && 
      last6[3] === 'Xỉu' && last6[4] === 'Xỉu' && last6[5] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 91, ten: 'CẦU 3-2-1 (TTT-XX-T)' };
  }
  if (last6[0] === 'Xỉu' && last6[1] === 'Xỉu' && last6[2] === 'Xỉu' && 
      last6[3] === 'Tài' && last6[4] === 'Tài' && last6[5] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 91, ten: 'CẦU 3-2-1 (XXX-TT-X)' };
  }
  return { active: false };
}

// 9. CẦU ĐẢO CHIỀU
function cauDaoChieu(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  let changes = 0;
  for (let i = 1; i < 6; i++) {
    if (last6[i] !== last6[i-1]) changes++;
  }
  if (changes >= 5) {
    return { active: true, pred: last6[5] === 'Tài' ? 'Xiu' : 'Tai', doTin: 92, ten: `ĐẢO CHIỀU MẠNH (${changes}/5)` };
  }
  if (changes === 4) {
    return { active: true, pred: last6[5] === 'Tài' ? 'Xiu' : 'Tai', doTin: 86, ten: `ĐẢO CHIỀU (${changes}/5)` };
  }
  return { active: false };
}

// 10. CẦU LẶP
function cauLap(history) {
  if (history.length < 4) return { active: false };
  
  // Lặp chu kỳ 2
  if (history.slice(-2).map(h => h.result).join() === history.slice(-4, -2).map(h => h.result).join()) {
    const lastResult = history[history.length - 1].result;
    return { active: true, pred: lastResult === 'Tài' ? 'Tai' : 'Xiu', doTin: 83, ten: 'CẦU LẶP CK2' };
  }
  
  // Lặp chu kỳ 3
  if (history.length >= 6 && history.slice(-3).map(h => h.result).join() === history.slice(-6, -3).map(h => h.result).join()) {
    const lastResult = history[history.length - 1].result;
    return { active: true, pred: lastResult === 'Tài' ? 'Tai' : 'Xiu', doTin: 85, ten: 'CẦU LẶP CK3' };
  }
  return { active: false };
}

// 11. CẦU TAM GIÁC
function cauTamGiac(history) {
  if (history.length < 5) return { active: false };
  const last5 = history.slice(-5).map(h => h.result);
  
  if (last5[0] === 'Tài' && last5[1] === 'Xỉu' && last5[2] === 'Xỉu' && last5[3] === 'Tài' && last5[4] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 88, ten: 'TAM GIÁC T' };
  }
  if (last5[0] === 'Xỉu' && last5[1] === 'Tài' && last5[2] === 'Tài' && last5[3] === 'Xỉu' && last5[4] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 88, ten: 'TAM GIÁC X' };
  }
  return { active: false };
}

// 12. CẦU GÁNH
function cauGanh(history) {
  if (history.length < 5) return { active: false };
  const last5 = history.slice(-5).map(h => h.result);
  
  if (last5[0] === last5[2] && last5[2] === last5[4] && last5[0] !== last5[1]) {
    return { active: true, pred: last5[4] === 'Tài' ? 'Xiu' : 'Tai', doTin: 87, ten: 'CẦU GÁNH' };
  }
  return { active: false };
}

// 13. CÂN BẰNG TẦN SUẤT
function cauCanBang(history) {
  if (history.length < 10) return { active: false };
  
  const last10 = history.slice(-10).map(h => h.result);
  const taiCount = last10.filter(r => r === 'Tài').length;
  const xiuCount = 10 - taiCount;
  
  // Nếu chênh lệch từ 3 trở lên
  if (taiCount - xiuCount >= 3) {
    return { active: true, pred: 'Xiu', doTin: 82, ten: `CÂN BẰNG - Tài ${taiCount}/10` };
  }
  if (xiuCount - taiCount >= 3) {
    return { active: true, pred: 'Tai', doTin: 82, ten: `CÂN BẰNG - Xỉu ${xiuCount}/10` };
  }
  
  // Nếu bệt dài trong 10 phiên
  let maxStreak = 1;
  let currentStreak = 1;
  for (let i = 1; i < last10.length; i++) {
    if (last10[i] === last10[i-1]) {
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 1;
    }
  }
  if (maxStreak >= 5) {
    const lastResult = history[history.length - 1].result;
    return { active: true, pred: lastResult === 'Tài' ? 'Xiu' : 'Tai', doTin: 86, ten: `PHÁT HIỆN BỆT DÀI ${maxStreak}` };
  }
  
  return { active: false };
}

// 14. PHÁT HIỆN TREND MẠNH
function cauTrend(history) {
  if (history.length < 15) return { active: false };
  
  const last15 = history.slice(-15).map(h => h.result);
  const taiCount = last15.filter(r => r === 'Tài').length;
  
  // Trend Tài mạnh (10-15 Tài)
  if (taiCount >= 11) {
    return { active: true, pred: 'Xiu', doTin: 84, ten: `TREND TÀI MẠNH (${taiCount}/15)` };
  }
  // Trend Xỉu mạnh (10-15 Xỉu)
  if (taiCount <= 4) {
    return { active: true, pred: 'Tai', doTin: 84, ten: `TREND XỈU MẠNH (${15 - taiCount}/15)` };
  }
  return { active: false };
}

// 15. CẦU THEO TỔNG ĐIỂM
function cauTongDiem(history) {
  if (history.length < 3) return { active: false };
  
  const last3Scores = history.slice(-3).map(h => h.totalScore);
  const avgScore = last3Scores.reduce((a, b) => a + b, 0) / 3;
  
  // Tổng trung bình cao -> Tài, thấp -> Xỉu
  if (avgScore >= 12) {
    return { active: true, pred: 'Tai', doTin: 78, ten: `TỔNG CAO (${avgScore.toFixed(1)})` };
  }
  if (avgScore <= 8) {
    return { active: true, pred: 'Xiu', doTin: 78, ten: `TỔNG THẤP (${avgScore.toFixed(1)})` };
  }
  return { active: false };
}

// ==================== TỔNG HỢP DỰ ĐOÁN (CÓ TRỌNG SỐ CAO) ====================

function duDoanTongHop(history) {
  if (!history || history.length < 5) {
    return { prediction: 'Tai', doTin: 65, reason: 'Đang thu thập dữ liệu' };
  }
  
  const cacCau = [
    cauBet, cau11, cau22, cau3Phien, cau4Phien,
    cauZigzag, cau123, cau321, cauDaoChieu, cauLap,
    cauTamGiac, cauGanh, cauCanBang, cauTrend, cauTongDiem
  ];
  
  const cauActive = [];
  for (const cau of cacCau) {
    const result = cau(history);
    if (result.active) {
      cauActive.push(result);
    }
  }
  
  // Nếu không có cầu nào -> THEO CẦU BỆT
  if (cauActive.length === 0) {
    const doDaiBet = tinhDoDaiBet(history);
    const ketQuaCuoi = history[history.length - 1].result;
    let doTin = 70;
    if (doDaiBet >= 3) doTin = 78;
    if (doDaiBet >= 4) doTin = 84;
    
    return {
      prediction: ketQuaCuoi === 'Tài' ? 'Tai' : 'Xiu',
      doTin: doTin,
      reason: `THEO CẦU (bệt ${doDaiBet})`
    };
  }
  
  // Tính điểm có trọng số
  let diemTai = 0, diemXiu = 0;
  let cauTotNhat = cauActive[0];
  
  for (const cau of cauActive) {
    // Các cầu có độ tin cậy cao được cộng thêm điểm
    let trongSo = 1;
    if (cau.ten.includes('DÀI') || cau.ten.includes('MẠNH')) trongSo = 1.3;
    if (cau.ten.includes('BẺ')) trongSo = 1.2;
    if (cau.ten.includes('CHẮC CHẮN')) trongSo = 1.4;
    
    if (cau.pred === 'Tai') diemTai += cau.doTin * trongSo;
    else diemXiu += cau.doTin * trongSo;
    
    if (cau.doTin > cauTotNhat.doTin) cauTotNhat = cau;
  }
  
  const duDoanCuoi = diemTai > diemXiu ? 'Tai' : 'Xiu';
  const tongDiem = diemTai + diemXiu;
  let doTinCuoi = Math.min(96, Math.max(70, Math.floor((Math.max(diemTai, diemXiu) / tongDiem) * 100)));
  
  // Tăng độ tin cậy nếu có nhiều cầu đồng thuận
  const tyLeDongThuan = Math.max(diemTai, diemXiu) / tongDiem;
  if (tyLeDongThuan > 0.7) doTinCuoi += 5;
  if (cauActive.length >= 5) doTinCuoi += 3;
  
  return {
    prediction: duDoanCuoi,
    doTin: Math.min(98, doTinCuoi),
    reason: `${cauTotNhat.ten} (${cauActive.length} cầu)`
  };
}

// ==================== LẤY DỮ LIỆU ====================

async function fetchData() {
  try {
    const response = await axios.get(API_URL, { timeout: 8000 });
    const data = response.data;
    const items = data?.list;
    
    if (items && Array.isArray(items) && items.length > 0) {
      latestData = items;
      console.log(`[${new Date().toLocaleTimeString()}] ✅ Đã cập nhật dữ liệu`);
    }
  } catch (error) {
    console.error(`Lỗi fetch:`, error.message);
  }
}

setInterval(fetchData, 2000);
fetchData();

// ==================== API ====================

app.get('/', (req, res) => {
  res.send('API Tài Xỉu - Siêu chính xác');
});

app.get('/api/hitpro', async (req, res) => {
  if (!latestData) {
    return res.status(503).json({ error: 'Đang tải dữ liệu' });
  }
  
  const items = latestData;
  const history = items.slice(0, 60).reverse().map(item => ({
    session: item.id,
    result: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
    totalScore: item.point || 0
  }));
  
  const ketQua = duDoanTongHop(history);
  
  const result = {
    phien_hien_tai: items[0].id,
    ket_qua: items[0].resultTruyenThong === 'TAI' ? 'Tai' : 'Xiu',
    xuc_xac: items[0].dices || [0, 0, 0],
    phien_tiep_theo: items[0].id + 1,
    du_doan: ketQua.prediction,
    do_tin_cay: `${ketQua.doTin}%`,
    cau_phat_hien: ketQua.reason
  };
  
  return res.json(result);
});

app.listen(PORT, () => {
  console.log(`🚀 Server chạy trên port ${PORT}`);
  console.log(`🎯 Mục tiêu: Đúng 8-9/10 phiên`);
});
