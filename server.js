// HUYDAIXU.SITE - BẮT CẦU XỊN
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

let lastPhien = 0;
let cachedResult = null;

// ==================== 20+ MẪU CẦU XỊN ====================

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

// 1. CẦU BỆT (THEO HOẶC BẺ)
function cauBet(history) {
  const doDaiBet = tinhDoDaiBet(history);
  const ketQuaCuoi = history[history.length - 1].result;
  
  if (doDaiBet >= 7) {
    return { 
      active: true, 
      pred: ketQuaCuoi === 'Tài' ? 'Xiu' : 'Tai', 
      doTin: 90, 
      ten: `🔥 BẺ BỆT ${doDaiBet} (quá dài)` 
    };
  }
  if (doDaiBet >= 4) {
    return { 
      active: true, 
      pred: ketQuaCuoi === 'Tài' ? 'Tai' : 'Xiu', 
      doTin: 75 + doDaiBet, 
      ten: `📈 THEO BỆT ${doDaiBet}` 
    };
  }
  if (doDaiBet >= 2) {
    return { 
      active: true, 
      pred: ketQuaCuoi === 'Tài' ? 'Tai' : 'Xiu', 
      doTin: 65 + doDaiBet * 5, 
      ten: `📊 THEO BỆT ${doDaiBet}` 
    };
  }
  return { active: false };
}

// 2. CẦU 1-1 (T X T X)
function cau11(history) {
  if (history.length < 4) return { active: false };
  const last4 = history.slice(-4).map(h => h.result);
  if (last4[0] !== last4[1] && last4[1] !== last4[2] && last4[2] !== last4[3]) {
    return { 
      active: true, 
      pred: last4[3] === 'Tài' ? 'Xiu' : 'Tai', 
      doTin: 85, 
      ten: '⚡ CẦU 1-1 (so le)' 
    };
  }
  return { active: false };
}

// 3. CẦU 2-2 (T T X X)
function cau22(history) {
  if (history.length < 4) return { active: false };
  const last4 = history.slice(-4).map(h => h.result);
  if (last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2]) {
    return { 
      active: true, 
      pred: last4[0] === 'Tài' ? 'Xiu' : 'Tai', 
      doTin: 82, 
      ten: '📐 CẦU 2-2 (kép)' 
    };
  }
  return { active: false };
}

// 4. CẦU 3-3 (T T T X X X)
function cau33(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  const first3 = last6[0] === last6[1] && last6[1] === last6[2];
  const last3 = last6[3] === last6[4] && last6[4] === last6[5];
  if (first3 && last3 && last6[0] !== last6[3]) {
    return { 
      active: true, 
      pred: last6[0] === 'Tài' ? 'Xiu' : 'Tai', 
      doTin: 85, 
      ten: '🎲 CẦU 3-3' 
    };
  }
  return { active: false };
}

// 5. CẦU 4-4 (T T T T X X X X)
function cau44(history) {
  if (history.length < 8) return { active: false };
  const last8 = history.slice(-8).map(h => h.result);
  const first4 = last8[0] === last8[1] && last8[1] === last8[2] && last8[2] === last8[3];
  const last4 = last8[4] === last8[5] && last8[5] === last8[6] && last8[6] === last8[7];
  if (first4 && last4 && last8[0] !== last8[4]) {
    return { 
      active: true, 
      pred: last8[0] === 'Tài' ? 'Xiu' : 'Tai', 
      doTin: 88, 
      ten: '🏆 CẦU 4-4' 
    };
  }
  return { active: false };
}

// 6. CẦU ZIGZAG (T X T X T)
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
    return { 
      active: true, 
      pred: last5[4] === 'Tài' ? 'Xiu' : 'Tai', 
      doTin: 87, 
      ten: '🐍 CẦU ZIGZAG' 
    };
  }
  return { active: false };
}

// 7. CẦU TAM GIÁC (T X X T X)
function cauTamGiac(history) {
  if (history.length < 5) return { active: false };
  const last5 = history.slice(-5).map(h => h.result);
  if (last5[0] === 'Tài' && last5[1] === 'Xiu' && last5[2] === 'Xiu' && last5[3] === 'Tài' && last5[4] === 'Xiu') {
    return { active: true, pred: 'Tai', doTin: 86, ten: '🔺 CẦU TAM GIÁC T' };
  }
  if (last5[0] === 'Xiu' && last5[1] === 'Tài' && last5[2] === 'Tài' && last5[3] === 'Xiu' && last5[4] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 86, ten: '🔻 CẦU TAM GIÁC X' };
  }
  return { active: false };
}

// 8. CẦU LẶP CHU KỲ 2
function cauLap2(history) {
  if (history.length < 4) return { active: false };
  if (history.slice(-2).map(h => h.result).join() === history.slice(-4, -2).map(h => h.result).join()) {
    const lastResult = history[history.length - 1].result;
    return { 
      active: true, 
      pred: lastResult === 'Tài' ? 'Tai' : 'Xiu', 
      doTin: 80, 
      ten: '🔄 CẦU LẶP CK2' 
    };
  }
  return { active: false };
}

// 9. CẦU LẶP CHU KỲ 3
function cauLap3(history) {
  if (history.length < 6) return { active: false };
  if (history.slice(-3).map(h => h.result).join() === history.slice(-6, -3).map(h => h.result).join()) {
    const lastResult = history[history.length - 1].result;
    return { 
      active: true, 
      pred: lastResult === 'Tài' ? 'Tai' : 'Xiu', 
      doTin: 82, 
      ten: '🔄 CẦU LẶP CK3' 
    };
  }
  return { active: false };
}

// 10. PHÂN TÍCH 3 PHIÊN
function cau3Phien(history) {
  if (history.length < 3) return { active: false };
  const last3 = history.slice(-3).map(h => h.result);
  const pattern = last3.join(',');
  
  const patterns = {
    'Tài,Xỉu,Tài': { pred: 'Xiu', doTin: 85, ten: '✨ TXT -> X' },
    'Xỉu,Tài,Xỉu': { pred: 'Tai', doTin: 85, ten: '✨ XTX -> T' },
    'Tài,Tài,Xỉu': { pred: 'Xiu', doTin: 83, ten: '📌 TTX -> X' },
    'Xỉu,Xỉu,Tài': { pred: 'Tai', doTin: 83, ten: '📌 XXT -> T' },
    'Tài,Xỉu,Xỉu': { pred: 'Xiu', doTin: 80, ten: '🎯 TXX -> X' },
    'Xỉu,Tài,Tài': { pred: 'Tai', doTin: 80, ten: '🎯 XTT -> T' }
  };
  
  if (patterns[pattern]) {
    return { active: true, ...patterns[pattern] };
  }
  return { active: false };
}

// 11. CẦU ĐẢO CHIỀU (đan xen nhiều)
function cauDaoChieu(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  let changes = 0;
  for (let i = 1; i < 6; i++) {
    if (last6[i] !== last6[i-1]) changes++;
  }
  if (changes >= 4) {
    return { 
      active: true, 
      pred: last6[5] === 'Tài' ? 'Xiu' : 'Tai', 
      doTin: 84, 
      ten: `🔄 ĐẢO CHIỀU (${changes}/5)` 
    };
  }
  return { active: false };
}

// 12. CẦU THEO TỔNG (chẵn/lẻ)
function cauTongChanLe(history) {
  if (history.length < 3) return { active: false };
  const last3Scores = history.slice(-3).map(h => h.totalScore);
  const soChan = last3Scores.filter(s => s % 2 === 0).length;
  if (soChan >= 2) {
    return { active: true, pred: 'Tai', doTin: 72, ten: '🎲 TỔNG CHẴN -> TÀI' };
  } else {
    return { active: true, pred: 'Xiu', doTin: 72, ten: '🎲 TỔNG LẺ -> XỈU' };
  }
}

// 13. CẦU TỔNG TĂNG/GIẢM
function cauTongTangGiam(history) {
  if (history.length < 4) return { active: false };
  const last4Scores = history.slice(-4).map(h => h.totalScore);
  if (last4Scores[0] < last4Scores[1] && last4Scores[1] < last4Scores[2] && last4Scores[2] < last4Scores[3]) {
    return { active: true, pred: 'Tai', doTin: 74, ten: '📈 TỔNG TĂNG -> TÀI' };
  }
  if (last4Scores[0] > last4Scores[1] && last4Scores[1] > last4Scores[2] && last4Scores[2] > last4Scores[3]) {
    return { active: true, pred: 'Xiu', doTin: 74, ten: '📉 TỔNG GIẢM -> XỈU' };
  }
  return { active: false };
}

// 14. CẦU GÁNH (T X T)
function cauGanh(history) {
  if (history.length < 5) return { active: false };
  const last5 = history.slice(-5).map(h => h.result);
  if (last5[0] === last5[2] && last5[2] === last5[4] && last5[0] !== last5[1]) {
    return { 
      active: true, 
      pred: last5[4] === 'Tài' ? 'Xiu' : 'Tai', 
      doTin: 83, 
      ten: '⚖️ CẦU GÁNH' 
    };
  }
  return { active: false };
}

// 15. CẦU ĐỐI XỨNG
function cauDoiXung(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  if (last6[0] === last6[5] && last6[1] === last6[4] && last6[2] === last6[3]) {
    return { 
      active: true, 
      pred: last6[5] === 'Tài' ? 'Xiu' : 'Tai', 
      doTin: 82, 
      ten: '🪞 CẦU ĐỐI XỨNG' 
    };
  }
  return { active: false };
}

// 16. KIỂM TRA 3 PHIÊN GIỐNG NHAU
function cau3Lien(history) {
  if (history.length < 3) return { active: false };
  const last3 = history.slice(-3).map(h => h.result);
  if (last3[0] === last3[1] && last3[1] === last3[2]) {
    return { 
      active: true, 
      pred: last3[0] === 'Tài' ? 'Xiu' : 'Tai', 
      doTin: 88, 
      ten: '⚡ BẺ 3 PHIÊN GIỐNG NHAU' 
    };
  }
  return { active: false };
}

// 17. CÂN BẰNG TẦN SUẤT (đánh cửa ít hơn)
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

// ==================== TỔNG HỢP DỰ ĐOÁN ====================

function duDoanTongHop(history) {
  if (!history || history.length === 0) {
    return { prediction: 'Tai', doTin: 60, reason: 'Chưa có lịch sử' };
  }
  
  // Danh sách tất cả các cầu
  const cacCau = [
    cauBet(history),
    cau11(history),
    cau22(history),
    cau33(history),
    cau44(history),
    cauZigzag(history),
    cauTamGiac(history),
    cauLap2(history),
    cauLap3(history),
    cau3Phien(history),
    cauDaoChieu(history),
    cauGanh(history),
    cauDoiXung(history),
    cau3Lien(history),
    cauCanBangTanSuat(history),
    cauTongChanLe(history),
    cauTongTangGiam(history)
  ];
  
  // Lọc các cầu active
  const cauActive = cacCau.filter(c => c.active === true);
  
  // Nếu không có cầu nào active -> THEO CẦU BỆT CƠ BẢN
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
  
  // Tính tổng điểm Tài và Xỉu từ các cầu
  let diemTai = 0;
  let diemXiu = 0;
  let cauTotNhat = cauActive[0];
  
  for (const cau of cauActive) {
    if (cau.pred === 'Tai') {
      diemTai += cau.doTin;
    } else {
      diemXiu += cau.doTin;
    }
    if (cau.doTin > cauTotNhat.doTin) {
      cauTotNhat = cau;
    }
  }
  
  const tongDiem = diemTai + diemXiu;
  let doTinCuoi = 0;
  let duDoanCuoi = '';
  
  if (diemTai > diemXiu) {
    duDoanCuoi = 'Tai';
    doTinCuoi = Math.min(92, Math.max(65, Math.floor((diemTai / tongDiem) * 100)));
  } else {
    duDoanCuoi = 'Xiu';
    doTinCuoi = Math.min(92, Math.max(65, Math.floor((diemXiu / tongDiem) * 100)));
  }
  
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
      const phienHienTai = items[0].id;
      
      if (phienHienTai !== lastPhien) {
        lastPhien = phienHienTai;
        
        // Lấy lịch sử 50 phiên (cũ ở đầu, mới ở cuối)
        const history = items.slice(0, 50).reverse().map(item => ({
          session: item.id,
          result: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
          totalScore: item.point || 0
        }));
        
        // Dự đoán
        const ketQua = duDoanTongHop(history);
        
        cachedResult = {
          phien_hien_tai: items[0].id,
          ket_qua: items[0].resultTruyenThong === 'TAI' ? 'Tai' : 'Xiu',
          xuc_xac: items[0].dices || [0, 0, 0],
          phien_tiep_theo: items[0].id + 1,
          du_doan: ketQua.prediction,
          do_tin_cay: `${ketQua.doTin}%`,
          cau_phat_hien: ketQua.reason
        };
        
        console.log(`[${new Date().toLocaleTimeString()}] 📌 Phiên: ${phienHienTai}`);
        console.log(`   Kết quả: ${cachedResult.ket_qua} → Dự đoán: ${cachedResult.du_doan}`);
        console.log(`   🎯 ${ketQua.reason} | Độ tin cậy: ${ketQua.doTin}%`);
        console.log('---');
      }
    }
  } catch (error) {
    console.error(`Lỗi fetch:`, error.message);
  }
}

// Chạy fetch mỗi 2 giây
setInterval(fetchData, 2000);
fetchData();

// ==================== API ====================

app.get('/', (req, res) => {
  res.send('API Tài Xỉu - 20+ mẫu cầu | Bẻ khi bệt >=7');
});

app.get('/api/hitpro', async (req, res) => {
  if (cachedResult) {
    return res.json(cachedResult);
  }
  return res.status(503).json({ error: 'Đang tải dữ liệu' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server chạy trên port ${PORT}`);
  console.log(`📌 20+ mẫu cầu: Bệt, 1-1, 2-2, 3-3, 4-4, Zigzag, Tam giác, Lặp, Gánh, Đối xứng, Tổng...`);
});
