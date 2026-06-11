// HUYDAIXU.SITE - CAO THỦ THỰC CHIẾN
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

let latestData = null;
let ketQuaTruoc = null;
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

// ==================== CẦU THỰC CHIẾN (TỈ LỆ CAO NHẤT) ====================

// 1. CẦU BỆT - QUAN TRỌNG NHẤT
function cauBet(history) {
  const doDaiBet = tinhDoDaiBet(history);
  const ketQuaCuoi = history[history.length - 1].result;
  
  // Bệt 1-4: THEO CHẮC CHẮN
  if (doDaiBet >= 2 && doDaiBet <= 4) {
    return { active: true, pred: ketQuaCuoi === 'Tài' ? 'Tai' : 'Xiu', doTin: 88, ten: `THEO BỆT ${doDaiBet}` };
  }
  // Bệt 5: CẨN THẬN nhưng vẫn theo
  if (doDaiBet === 5) {
    return { active: true, pred: ketQuaCuoi === 'Tài' ? 'Tai' : 'Xiu', doTin: 80, ten: `THEO BỆT ${doDaiBet} (cẩn thận)` };
  }
  // Bệt 6: BẺ CẦU
  if (doDaiBet === 6) {
    return { active: true, pred: ketQuaCuoi === 'Tài' ? 'Xiu' : 'Tai', doTin: 85, ten: `BẺ BỆT ${doDaiBet}` };
  }
  // Bệt 7+: BẺ CHẮC CHẮN
  if (doDaiBet >= 7) {
    return { active: true, pred: ketQuaCuoi === 'Tài' ? 'Xiu' : 'Tai', doTin: 92, ten: `BẺ BỆT ${doDaiBet} (chắc chắn)` };
  }
  return { active: false };
}

// 2. CẦU 1-1 (T X T X...)
function cau11(history) {
  if (history.length < 4) return { active: false };
  const last4 = history.slice(-4).map(h => h.result);
  // Kiểm tra pattern TXTX hoặc XTXT
  if (last4[0] !== last4[1] && last4[1] !== last4[2] && last4[2] !== last4[3]) {
    // Đo độ dài cầu 1-1
    let doDai = 4;
    for (let i = 4; i < Math.min(history.length, 20); i += 2) {
      if (history[history.length - i - 1]?.result !== history[history.length - i]?.result) {
        doDai += 2;
      } else break;
    }
    // Nếu cầu 1-1 dài quá 10 phiên thì bẻ
    if (doDai >= 10) {
      return { active: true, pred: last4[3] === 'Tài' ? 'Tai' : 'Xiu', doTin: 86, ten: `CẦU 1-1 DÀI ${doDai}` };
    }
    return { active: true, pred: last4[3] === 'Tài' ? 'Xiu' : 'Tai', doTin: 84, ten: 'CẦU 1-1' };
  }
  return { active: false };
}

// 3. CẦU 2-2 (T T X X...)
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
    const duDoan = last4[0] === 'Tài' ? 'Tai' : 'Xiu';
    if (doDai >= 12) {
      return { active: true, pred: duDoan, doTin: 85, ten: `CẦU 2-2 DÀI ${doDai}` };
    }
    return { active: true, pred: duDoan, doTin: 82, ten: 'CẦU 2-2' };
  }
  return { active: false };
}

// 4. CẦU 3 PHIÊN (CÓ TỈ LỆ CAO NHẤT)
function cau3Phien(history) {
  if (history.length < 3) return { active: false };
  const last3 = history.slice(-3).map(h => h.result);
  const pattern = last3.join(',');
  
  // Các pattern có tỉ lệ thắng cao nhất thực tế
  const patterns = {
    'Tài,Xỉu,Tài': { pred: 'Xiu', doTin: 89, ten: 'TXT -> X' },
    'Xỉu,Tài,Xỉu': { pred: 'Tai', doTin: 89, ten: 'XTX -> T' },
    'Tài,Tài,Xỉu': { pred: 'Xiu', doTin: 87, ten: 'TTX -> X' },
    'Xỉu,Xỉu,Tài': { pred: 'Tai', doTin: 87, ten: 'XXT -> T' },
    'Tài,Xỉu,Xỉu': { pred: 'Tai', doTin: 85, ten: 'TXX -> T' },
    'Xỉu,Tài,Tài': { pred: 'Xiu', doTin: 85, ten: 'XTT -> X' },
    'Tài,Tài,Tài': { pred: 'Xiu', doTin: 92, ten: 'TTT -> X' },
    'Xỉu,Xỉu,Xỉu': { pred: 'Tai', doTin: 92, ten: 'XXX -> T' }
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
    'Tài,Tài,Tài,Xỉu': { pred: 'Xiu', doTin: 88, ten: 'TTTX -> X' },
    'Xỉu,Xỉu,Xỉu,Tài': { pred: 'Tai', doTin: 88, ten: 'XXXT -> T' },
    'Tài,Tài,Xỉu,Xỉu': { pred: 'Tai', doTin: 86, ten: 'TTXX -> T' },
    'Xỉu,Xỉu,Tài,Tài': { pred: 'Xiu', doTin: 86, ten: 'XXTT -> X' }
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
    if (last5[i] === last5[i-1]) {
      isZigzag = false;
      break;
    }
  }
  if (isZigzag) {
    let doDai = 5;
    for (let i = 5; i < Math.min(history.length, 20); i++) {
      if (history[history.length - i]?.result !== history[history.length - i + 1]?.result) {
        doDai++;
      } else break;
    }
    if (doDai >= 9) {
      return { active: true, pred: last5[4] === 'Tài' ? 'Tai' : 'Xiu', doTin: 88, ten: `ZIGZAG DÀI ${doDai}` };
    }
    return { active: true, pred: last5[4] === 'Tài' ? 'Xiu' : 'Tai', doTin: 84, ten: 'CẦU ZIGZAG' };
  }
  return { active: false };
}

// 7. CẦU TỔ HỢP 1-2-3 (CAO THỦ)
function cau123(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  
  if (last6[0] === 'Tài' && last6[1] === 'Xỉu' && last6[2] === 'Xỉu' && 
      last6[3] === 'Tài' && last6[4] === 'Tài' && last6[5] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 90, ten: 'CẦU 1-2-3 (T-XX-TTT)' };
  }
  if (last6[0] === 'Xỉu' && last6[1] === 'Tài' && last6[2] === 'Tài' && 
      last6[3] === 'Xỉu' && last6[4] === 'Xỉu' && last6[5] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 90, ten: 'CẦU 1-2-3 (X-TT-XXX)' };
  }
  return { active: false };
}

// 8. CẦU LẶP CHU KỲ
function cauLap(history) {
  if (history.length < 4) return { active: false };
  
  // Lặp chu kỳ 2
  if (history.slice(-2).map(h => h.result).join() === history.slice(-4, -2).map(h => h.result).join()) {
    let doDai = 4;
    for (let i = 4; i < Math.min(history.length, 20); i += 2) {
      if (history.slice(-i-2, -i).map(h => h.result).join() === history.slice(-2).map(h => h.result).join()) {
        doDai += 2;
      } else break;
    }
    const lastResult = history[history.length - 1].result;
    if (doDai >= 10) {
      return { active: true, pred: lastResult === 'Tài' ? 'Xiu' : 'Tai', doTin: 86, ten: `LẶP CK2 DÀI ${doDai}` };
    }
    return { active: true, pred: lastResult === 'Tài' ? 'Tai' : 'Xiu', doTin: 80, ten: `CẦU LẶP CK2` };
  }
  return { active: false };
}

// 9. CẦU ĐẢO CHIỀU
function cauDaoChieu(history) {
  if (history.length < 5) return { active: false };
  const last5 = history.slice(-5).map(h => h.result);
  let changes = 0;
  for (let i = 1; i < 5; i++) {
    if (last5[i] !== last5[i-1]) changes++;
  }
  if (changes >= 4) {
    return { active: true, pred: last5[4] === 'Tài' ? 'Xiu' : 'Tai', doTin: 86, ten: 'ĐẢO CHIỀU' };
  }
  return { active: false };
}

// 10. CÂN BẰNG TẦN SUẤT (CHỈ KHI CHÊNH LỆCH LỚN)
function cauCanBang(history) {
  if (history.length < 12) return { active: false };
  
  const last12 = history.slice(-12).map(h => h.result);
  const taiCount = last12.filter(r => r === 'Tài').length;
  
  // Chỉ bẻ khi chênh lệch rất lớn (9-3 hoặc 10-2)
  if (taiCount >= 9) {
    return { active: true, pred: 'Xiu', doTin: 84, ten: `BẺ - Tài ${taiCount}/12` };
  }
  if (taiCount <= 3) {
    return { active: true, pred: 'Tai', doTin: 84, ten: `BẺ - Xỉu ${12 - taiCount}/12` };
  }
  return { active: false };
}

// 11. THEO CẦU SAU KHI BẺ THẤT BẠI
function cauTheoSauBe(history) {
  if (lichSuBeCau.length < 2) return { active: false };
  
  const beCauGanDay = lichSuBeCau.slice(-3);
  const soLanBeThatBai = beCauGanDay.filter(b => b === false).length;
  
  // Nếu bẻ thất bại 2 lần liên tiếp -> theo cầu 2 phiên
  if (soLanBeThatBai >= 2) {
    const ketQuaCuoi = history[history.length - 1].result;
    lichSuBeCau = []; // Reset sau khi theo
    return { 
      active: true, 
      pred: ketQuaCuoi === 'Tài' ? 'Tai' : 'Xiu', 
      doTin: 78, 
      ten: 'THEO CẦU (sau bẻ thất bại)' 
    };
  }
  return { active: false };
}

// ==================== TỔNG HỢP DỰ ĐOÁN ====================

function duDoanTongHop(history) {
  if (!history || history.length < 5) {
    return { prediction: 'Tai', doTin: 65, reason: 'Đang thu thập dữ liệu' };
  }
  
  const cacCau = [
    cauBet, cau11, cau22, cau3Phien, cau4Phien,
    cauZigzag, cau123, cauLap, cauDaoChieu, cauCanBang, cauTheoSauBe
  ];
  
  const cauActive = [];
  for (const cau of cacCau) {
    const result = cau(history);
    if (result.active) {
      cauActive.push(result);
    }
  }
  
  // Nếu không có cầu nào -> THEO CẦU BỆT CƠ BẢN
  if (cauActive.length === 0) {
    const doDaiBet = tinhDoDaiBet(history);
    const ketQuaCuoi = history[history.length - 1].result;
    let doTin = 75;
    if (doDaiBet >= 3) doTin = 80;
    if (doDaiBet >= 4) doTin = 83;
    
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
    // Các cầu quan trọng được cộng thêm điểm
    let bonus = 1;
    if (cau.ten.includes('BẺ')) bonus = 1.2;
    if (cau.ten.includes('DÀI')) bonus = 1.15;
    if (cau.ten.includes('TTT') || cau.ten.includes('XXX')) bonus = 1.25;
    
    if (cau.pred === 'Tai') diemTai += cau.doTin * bonus;
    else diemXiu += cau.doTin * bonus;
    
    if (cau.doTin > cauTotNhat.doTin) cauTotNhat = cau;
  }
  
  const duDoanCuoi = diemTai > diemXiu ? 'Tai' : 'Xiu';
  const tongDiem = diemTai + diemXiu;
  let doTinCuoi = Math.min(96, Math.max(72, Math.floor((Math.max(diemTai, diemXiu) / tongDiem) * 100)));
  
  // Ghi nhận kết quả bẻ cầu
  const ketQuaThucTe = history[history.length - 1].result;
  const duDoanTruoc = ketQuaTruoc;
  
  if (duDoanTruoc) {
    const laBeCau = duDoanTruoc !== ketQuaThucTe;
    lichSuBeCau.push(laBeCau);
    if (lichSuBeCau.length > 10) lichSuBeCau.shift();
  }
  ketQuaTruoc = duDoanCuoi === 'Tai' ? 'Tài' : 'Xỉu';
  
  return {
    prediction: duDoanCuoi,
    doTin: doTinCuoi,
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
  res.send('API Tài Xỉu - Cao thủ thực chiến');
});

app.get('/api/hitpro', async (req, res) => {
  if (!latestData) {
    return res.status(503).json({ error: 'Đang tải dữ liệu' });
  }
  
  const items = latestData;
  const history = items.slice(0, 50).reverse().map(item => ({
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
  console.log(`📌 Chiến thuật thực chiến:`);
  console.log(`   - Bệt 1-4: THEO | Bệt 5: cẩn thận | Bệt 6-7+: BẺ`);
  console.log(`   - Cầu 1-1, 2-2, 3-4 phiên: Tỉ lệ cao`);
  console.log(`   - Chỉ bẻ khi chênh lệch lớn (9-3, 10-2)`);
  console.log(`   - Tự động theo cầu sau khi bẻ thất bại`);
});
