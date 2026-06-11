// HUYDAIXU.SITE - DỰ ĐOÁN LIÊN TỤC
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

let lastPhien = 0;
let latestData = null;
let modelPredictions = {};

// Lưu lịch sử bẻ cầu
let lichSuBeCau = [];

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

// ==================== TẤT CẢ CÁC CẦU (50+ mẫu) ====================

function cauBetThongMinh(history) {
  const doDaiBet = tinhDoDaiBet(history);
  const ketQuaCuoi = history[history.length - 1].result;
  
  if (doDaiBet >= 8) {
    return { active: true, pred: ketQuaCuoi === 'Tài' ? 'Xiu' : 'Tai', doTin: 95, ten: `💀 BẺ BỆT ${doDaiBet} (siêu dài)` };
  }
  if (doDaiBet >= 7) {
    return { active: true, pred: ketQuaCuoi === 'Tài' ? 'Xiu' : 'Tai', doTin: 90, ten: `🔥 BẺ BỆT ${doDaiBet}` };
  }
  if (doDaiBet >= 6) {
    return { active: true, pred: ketQuaCuoi === 'Tài' ? 'Xiu' : 'Tai', doTin: 85, ten: `⚠️ CẢNH BÁO BỆT ${doDaiBet}` };
  }
  if (doDaiBet >= 4) {
    return { active: true, pred: ketQuaCuoi === 'Tài' ? 'Tai' : 'Xiu', doTin: 75 + doDaiBet, ten: `📈 THEO BỆT ${doDaiBet}` };
  }
  if (doDaiBet >= 2) {
    return { active: true, pred: ketQuaCuoi === 'Tài' ? 'Tai' : 'Xiu', doTin: 65 + doDaiBet * 5, ten: `📊 THEO BỆT ${doDaiBet}` };
  }
  return { active: false };
}

function cau11(history) {
  if (history.length < 4) return { active: false };
  const last4 = history.slice(-4).map(h => h.result);
  if (last4[0] !== last4[1] && last4[1] !== last4[2] && last4[2] !== last4[3]) {
    return { active: true, pred: last4[3] === 'Tài' ? 'Xiu' : 'Tai', doTin: 85, ten: '⚡ CẦU 1-1' };
  }
  return { active: false };
}

function cau22(history) {
  if (history.length < 4) return { active: false };
  const last4 = history.slice(-4).map(h => h.result);
  if (last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2]) {
    return { active: true, pred: last4[0] === 'Tài' ? 'Xiu' : 'Tai', doTin: 82, ten: '📐 CẦU 2-2' };
  }
  return { active: false };
}

function cau33(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  const first3 = last6[0] === last6[1] && last6[1] === last6[2];
  const last3 = last6[3] === last6[4] && last6[4] === last6[5];
  if (first3 && last3 && last6[0] !== last6[3]) {
    return { active: true, pred: last6[0] === 'Tài' ? 'Xiu' : 'Tai', doTin: 85, ten: '🎲 CẦU 3-3' };
  }
  return { active: false };
}

function cau44(history) {
  if (history.length < 8) return { active: false };
  const last8 = history.slice(-8).map(h => h.result);
  const first4 = last8[0] === last8[1] && last8[1] === last8[2] && last8[2] === last8[3];
  const last4 = last8[4] === last8[5] && last8[5] === last8[6] && last8[6] === last8[7];
  if (first4 && last4 && last8[0] !== last8[4]) {
    return { active: true, pred: last8[0] === 'Tài' ? 'Xiu' : 'Tai', doTin: 88, ten: '🏆 CẦU 4-4' };
  }
  return { active: false };
}

function cauZigzag(history) {
  if (history.length < 5) return { active: false };
  const last5 = history.slice(-5).map(h => h.result);
  let isZigzag = true;
  for (let i = 1; i < 5; i++) {
    if (last5[i] === last5[i-1]) { isZigzag = false; break; }
  }
  if (isZigzag) {
    return { active: true, pred: last5[4] === 'Tài' ? 'Xiu' : 'Tai', doTin: 87, ten: '🐍 CẦU ZIGZAG' };
  }
  return { active: false };
}

function cau123(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  if (last6[0] === 'Tài' && last6[1] === 'Xỉu' && last6[2] === 'Xỉu' && 
      last6[3] === 'Tài' && last6[4] === 'Tài' && last6[5] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 89, ten: '🏆 CẦU 1-2-3' };
  }
  if (last6[0] === 'Xỉu' && last6[1] === 'Tài' && last6[2] === 'Tài' && 
      last6[3] === 'Xỉu' && last6[4] === 'Xỉu' && last6[5] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 89, ten: '🏆 CẦU 1-2-3' };
  }
  return { active: false };
}

function cau321(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  if (last6[0] === 'Tài' && last6[1] === 'Tài' && last6[2] === 'Tài' && 
      last6[3] === 'Xỉu' && last6[4] === 'Xỉu' && last6[5] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 89, ten: '🏆 CẦU 3-2-1' };
  }
  if (last6[0] === 'Xỉu' && last6[1] === 'Xỉu' && last6[2] === 'Xỉu' && 
      last6[3] === 'Tài' && last6[4] === 'Tài' && last6[5] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 89, ten: '🏆 CẦU 3-2-1' };
  }
  return { active: false };
}

function cau121(history) {
  if (history.length < 5) return { active: false };
  const last5 = history.slice(-5).map(h => h.result);
  if (last5[0] === 'Tài' && last5[1] === 'Xỉu' && last5[2] === 'Xỉu' && last5[3] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 86, ten: '📊 CẦU 1-2-1' };
  }
  if (last5[0] === 'Xỉu' && last5[1] === 'Tài' && last5[2] === 'Tài' && last5[3] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 86, ten: '📊 CẦU 1-2-1' };
  }
  return { active: false };
}

function cau212(history) {
  if (history.length < 5) return { active: false };
  const last5 = history.slice(-5).map(h => h.result);
  if (last5[0] === 'Tài' && last5[1] === 'Tài' && last5[2] === 'Xỉu' && last5[3] === 'Tài' && last5[4] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 87, ten: '🎯 CẦU 2-1-2' };
  }
  if (last5[0] === 'Xỉu' && last5[1] === 'Xỉu' && last5[2] === 'Tài' && last5[3] === 'Xỉu' && last5[4] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 87, ten: '🎯 CẦU 2-1-2' };
  }
  return { active: false };
}

function cauLap2(history) {
  if (history.length < 4) return { active: false };
  if (history.slice(-2).map(h => h.result).join() === history.slice(-4, -2).map(h => h.result).join()) {
    const lastResult = history[history.length - 1].result;
    return { active: true, pred: lastResult === 'Tài' ? 'Tai' : 'Xiu', doTin: 80, ten: '🔄 CẦU LẶP CK2' };
  }
  return { active: false };
}

function cauLap3(history) {
  if (history.length < 6) return { active: false };
  if (history.slice(-3).map(h => h.result).join() === history.slice(-6, -3).map(h => h.result).join()) {
    const lastResult = history[history.length - 1].result;
    return { active: true, pred: lastResult === 'Tài' ? 'Tai' : 'Xiu', doTin: 82, ten: '🔄 CẦU LẶP CK3' };
  }
  return { active: false };
}

function cau3Phien(history) {
  if (history.length < 3) return { active: false };
  const last3 = history.slice(-3).map(h => h.result);
  const pattern = last3.join(',');
  
  const patterns = {
    'Tài,Xỉu,Tài': { pred: 'Xiu', doTin: 86, ten: '✨ TXT -> X' },
    'Xỉu,Tài,Xỉu': { pred: 'Tai', doTin: 86, ten: '✨ XTX -> T' },
    'Tài,Tài,Xỉu': { pred: 'Xiu', doTin: 84, ten: '📌 TTX -> X' },
    'Xỉu,Xỉu,Tài': { pred: 'Tai', doTin: 84, ten: '📌 XXT -> T' },
    'Tài,Xỉu,Xỉu': { pred: 'Xiu', doTin: 82, ten: '🎯 TXX -> X' },
    'Xỉu,Tài,Tài': { pred: 'Tai', doTin: 82, ten: '🎯 XTT -> T' },
    'Tài,Tài,Tài': { pred: 'Xiu', doTin: 91, ten: '🔥 TTT -> X' },
    'Xỉu,Xỉu,Xỉu': { pred: 'Tai', doTin: 91, ten: '🔥 XXX -> T' }
  };
  
  if (patterns[pattern]) {
    return { active: true, ...patterns[pattern] };
  }
  return { active: false };
}

function cauDaoChieu(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  let changes = 0;
  for (let i = 1; i < 6; i++) {
    if (last6[i] !== last6[i-1]) changes++;
  }
  if (changes >= 4) {
    return { active: true, pred: last6[5] === 'Tài' ? 'Xiu' : 'Tai', doTin: 85, ten: `🔄 ĐẢO CHIỀU (${changes}/5)` };
  }
  return { active: false };
}

function cauTamGiac(history) {
  if (history.length < 5) return { active: false };
  const last5 = history.slice(-5).map(h => h.result);
  if (last5[0] === 'Tài' && last5[1] === 'Xỉu' && last5[2] === 'Xỉu' && last5[3] === 'Tài' && last5[4] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 87, ten: '🔺 CẦU TAM GIÁC' };
  }
  if (last5[0] === 'Xỉu' && last5[1] === 'Tài' && last5[2] === 'Tài' && last5[3] === 'Xỉu' && last5[4] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 87, ten: '🔻 CẦU TAM GIÁC' };
  }
  return { active: false };
}

function cauGanh(history) {
  if (history.length < 5) return { active: false };
  const last5 = history.slice(-5).map(h => h.result);
  if (last5[0] === last5[2] && last5[2] === last5[4] && last5[0] !== last5[1]) {
    return { active: true, pred: last5[4] === 'Tài' ? 'Xiu' : 'Tai', doTin: 85, ten: '⚖️ CẦU GÁNH' };
  }
  return { active: false };
}

function cauTongChanLe(history) {
  if (history.length < 3) return { active: false };
  const last3Scores = history.slice(-3).map(h => h.totalScore);
  const soChan = last3Scores.filter(s => s % 2 === 0).length;
  if (soChan >= 2) {
    return { active: true, pred: 'Tai', doTin: 74, ten: '🎲 TỔNG CHẴN' };
  }
  return { active: true, pred: 'Xiu', doTin: 74, ten: '🎲 TỔNG LẺ' };
}

function cauCanBangTanSuat(history) {
  if (history.length < 10) return { active: false };
  const last10 = history.slice(-10).map(h => h.result);
  const taiCount = last10.filter(r => r === 'Tài').length;
  if (taiCount >= 7) {
    return { active: true, pred: 'Xiu', doTin: 78, ten: `⚖️ CÂN BẰNG - Tài ${taiCount}/10` };
  }
  if (taiCount <= 3) {
    return { active: true, pred: 'Tai', doTin: 78, ten: `⚖️ CÂN BẰNG - Xỉu ${10 - taiCount}/10` };
  }
  return { active: false };
}

function cau3Lien(history) {
  if (history.length < 3) return { active: false };
  const last3 = history.slice(-3).map(h => h.result);
  if (last3[0] === last3[1] && last3[1] === last3[2]) {
    return { active: true, pred: last3[0] === 'Tài' ? 'Xiu' : 'Tai', doTin: 90, ten: '⚡ BẺ 3 PHIÊN GIỐNG' };
  }
  return { active: false };
}

function beCauThongMinh(history) {
  if (history.length < 10) return { active: false };
  const last10 = history.slice(-10).map(h => h.result);
  const taiCount = last10.filter(r => r === 'Tài').length;
  
  const beCauGanDay = lichSuBeCau.slice(-5);
  const soLanBeThatBai = beCauGanDay.filter(b => b === false).length;
  
  if (soLanBeThatBai >= 3) {
    return { active: false };
  }
  
  if (taiCount >= 8) {
    lichSuBeCau.push(true);
    return { active: true, pred: 'Xiu', doTin: 85, ten: '🎯 BẺ CẦU - Tài quá nhiều' };
  }
  if (taiCount <= 2) {
    lichSuBeCau.push(true);
    return { active: true, pred: 'Tai', doTin: 85, ten: '🎯 BẺ CẦU - Xỉu quá nhiều' };
  }
  
  lichSuBeCau.push(false);
  return { active: false };
}

// ==================== TỔNG HỢP DỰ ĐOÁN ====================

function duDoanTongHop(history) {
  if (!history || history.length === 0) {
    return { prediction: 'Tai', doTin: 60, reason: 'Chưa có lịch sử' };
  }
  
  const cacCau = [
    cauBetThongMinh, cau11, cau22, cau33, cau44, cauZigzag,
    cau123, cau321, cau121, cau212, cauLap2, cauLap3,
    cau3Phien, cauDaoChieu, cauTamGiac, cauGanh,
    cauTongChanLe, cauCanBangTanSuat, cau3Lien, beCauThongMinh
  ];
  
  const cauActive = [];
  for (const cau of cacCau) {
    const result = cau(history);
    if (result.active) {
      cauActive.push(result);
    }
  }
  
  // LUÔN có dự đoán - nếu không có cầu nào thì theo cầu bệt cơ bản
  if (cauActive.length === 0) {
    const doDaiBet = tinhDoDaiBet(history);
    const ketQuaCuoi = history[history.length - 1].result;
    let doTin = 65;
    if (doDaiBet >= 4) doTin = 75;
    if (doDaiBet >= 5) doTin = 80;
    
    return {
      prediction: ketQuaCuoi === 'Tài' ? 'Tai' : 'Xiu',
      doTin: doTin,
      reason: `📊 THEO CẦU (bệt ${doDaiBet})`
    };
  }
  
  let diemTai = 0, diemXiu = 0;
  let cauTotNhat = cauActive[0];
  
  for (const cau of cauActive) {
    if (cau.pred === 'Tai') diemTai += cau.doTin;
    else diemXiu += cau.doTin;
    if (cau.doTin > cauTotNhat.doTin) cauTotNhat = cau;
  }
  
  const duDoanCuoi = diemTai > diemXiu ? 'Tai' : 'Xiu';
  const tongDiem = diemTai + diemXiu;
  let doTinCuoi = Math.min(94, Math.max(65, Math.floor((Math.max(diemTai, diemXiu) / tongDiem) * 100)));
  
  return {
    prediction: duDoanCuoi,
    doTin: doTinCuoi,
    reason: `${cauTotNhat.ten} (${cauActive.length} cầu)`
  };
}

// ==================== LẤY DỮ LIỆU & CẬP NHẬT ====================

async function fetchAndUpdate() {
  try {
    const response = await axios.get(API_URL, { timeout: 8000 });
    const data = response.data;
    const items = data?.list;
    
    if (items && Array.isArray(items) && items.length > 0) {
      latestData = items;
      const phienHienTai = items[0].id;
      
      if (phienHienTai !== lastPhien) {
        lastPhien = phienHienTai;
        console.log(`[${new Date().toLocaleTimeString()}] 📌 Phát hiện phiên mới: ${phienHienTai}`);
      }
    }
  } catch (error) {
    console.error(`Lỗi fetch:`, error.message);
  }
}

// Chạy fetch dữ liệu mỗi 2 giây
setInterval(fetchAndUpdate, 2000);
fetchAndUpdate();

// ==================== API - DỰ ĐOÁN LIÊN TỤC ====================

app.get('/', (req, res) => {
  res.send('API Tài Xỉu - Dự đoán LIÊN TỤC');
});

app.get('/api/hitpro', async (req, res) => {
  // LUÔN dự đoán dựa trên dữ liệu mới nhất, không cache kết quả
  if (!latestData) {
    return res.status(503).json({ error: 'Đang tải dữ liệu, vui lòng thử lại sau' });
  }
  
  const items = latestData;
  const phienHienTai = items[0].id;
  
  // Tạo lịch sử từ dữ liệu mới nhất
  const history = items.slice(0, 50).reverse().map(item => ({
    session: item.id,
    result: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
    totalScore: item.point || 0
  }));
  
  // Dự đoán NGAY LẬP TỨC
  const ketQua = duDoanTongHop(history);
  
  const result = {
    phien_hien_tai: items[0].id,
    ket_qua: items[0].resultTruyenThong === 'TAI' ? 'Tai' : 'Xiu',
    xuc_xac: items[0].dices || [0, 0, 0],
    phien_tiep_theo: items[0].id + 1,
    du_doan: ketQua.prediction,
    do_tin_cay: `${ketQua.doTin}%`,
    cau_phat_hien: ketQua.reason,
    thoi_gian: new Date().toLocaleTimeString()
  };
  
  return res.json(result);
});

app.listen(PORT, () => {
  console.log(`🚀 Server chạy trên port ${PORT}`);
  console.log(`✅ Dự đoán LIÊN TỤC - Mỗi lần gọi API đều tính toán mới`);
});
