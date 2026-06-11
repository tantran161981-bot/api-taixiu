// HUYDAIXU.SITE - THEO CẦU ĐƠN GIẢN
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

let lastPhien = 0;
let cachedResult = null;

// ==================== THUẬT TOÁN ĐƠN GIẢN ====================

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

function duDoanTheoCau(history) {
  if (!history || history.length === 0) {
    return { prediction: 'Tai', doTin: 60, reason: 'Chưa có lịch sử' };
  }
  
  const doDaiBet = tinhDoDaiBet(history);
  const ketQuaPhienTruoc = history[history.length - 1].result; // 'Tài' hoặc 'Xỉu'
  
  // ==== CHỈ BẺ CẦU KHI BỆT >= 7 PHIÊN ====
  if (doDaiBet >= 7) {
    // Bẻ cầu: đánh ngược lại
    const duDoan = ketQuaPhienTruoc === 'Tài' ? 'Xiu' : 'Tai';
    const doTin = Math.min(90, 70 + doDaiBet);
    return {
      prediction: duDoan,
      doTin: doTin,
      reason: `BẺ CẦU - Bệt ${doDaiBet} phiên ${ketQuaPhienTruoc === 'Tài' ? 'Tài' : 'Xỉu'}`
    };
  }
  
  // ==== MẶC ĐỊNH: THEO CẦU (đánh giống phiên trước) ====
  const duDoan = ketQuaPhienTruoc === 'Tài' ? 'Tai' : 'Xiu';
  let doTin = 65;
  
  // Tăng độ tin cậy nếu bệt càng dài
  if (doDaiBet >= 4) doTin = 75;
  if (doDaiBet >= 5) doTin = 80;
  if (doDaiBet >= 6) doTin = 85;
  
  return {
    prediction: duDoan,
    doTin: doTin,
    reason: `THEO CẦU - ${ketQuaPhienTruoc === 'Tài' ? 'Tài' : 'Xỉu'} (bệt ${doDaiBet})`
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
      
      // Chỉ xử lý khi có phiên mới
      if (phienHienTai !== lastPhien) {
        lastPhien = phienHienTai;
        
        // Lấy lịch sử 30 phiên gần nhất (đảo ngược để cũ ở đầu, mới ở cuối)
        const history = items.slice(0, 50).reverse().map(item => ({
          session: item.id,
          result: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
          totalScore: item.point || 0
        }));
        
        // Dự đoán
        const ketQua = duDoanTheoCau(history);
        
        cachedResult = {
          phien_hien_tai: items[0].id,
          ket_qua: items[0].resultTruyenThong === 'TAI' ? 'Tai' : 'Xiu',
          xuc_xac: items[0].dices || [0, 0, 0],
          phien_tiep_theo: items[0].id + 1,
          du_doan: ketQua.prediction,
          do_tin_cay: `${ketQua.doTin}%`,
          phuong_phap: ketQua.reason
        };
        
        console.log(`[${new Date().toLocaleTimeString()}] ✅ Phiên: ${phienHienTai}`);
        console.log(`   Kết quả: ${cachedResult.ket_qua} | Dự đoán: ${cachedResult.du_doan}`);
        console.log(`   ${ketQua.reason} | Tin cậy: ${ketQua.doTin}%`);
        console.log('---');
      }
    }
  } catch (error) {
    console.error(`Lỗi fetch:`, error.message);
  }
}

// Chạy fetch dữ liệu mỗi 2 giây
setInterval(fetchData, 2000);
fetchData();

// ==================== API ====================

app.get('/', (req, res) => {
  res.send('API Tài Xỉu - Theo cầu đơn giản | Bẻ cầu khi bệt >=7');
});

app.get('/api/hitpro', async (req, res) => {
  if (cachedResult) {
    return res.json(cachedResult);
  }
  return res.status(503).json({ error: 'Đang tải dữ liệu, vui lòng thử lại sau' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy trên port ${PORT}`);
  console.log(`📌 Chiến thuật: THEO CẦU - Chỉ bẻ khi bệt >=7 phiên`);
});
