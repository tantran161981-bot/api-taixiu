const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ==================== CẤU HÌNH ====================
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

let history = [];
let lastFetchedId = null;

// ==================== THUẬT TOÁN PHÂN TÍCH THÔNG MINH ====================

class ThongMinhPredictor {
    constructor() {
        this.ketQua = [];     // Lưu kết quả Tài/Xỉu
        this.diem = [];       // Lưu tổng điểm
        this.xucXac = [];     // Lưu 3 mặt xúc xắc
        this.lichSuDuDoan = [];
        this.thongKe = { tong: 0, dung: 0, sai: 0 };
    }

    // Cập nhật dữ liệu lịch sử
    capNhatLichSu(data) {
        for (const item of data) {
            const ketQua = item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu';
            this.ketQua.unshift(ketQua);
            this.diem.unshift(item.point);
            this.xucXac.unshift(item.dices);
            
            if (this.ketQua.length > 100) {
                this.ketQua.pop();
                this.diem.pop();
                this.xucXac.pop();
            }
        }
    }

    // 1. PHÁT HIỆN CẦU BỆT
    phatHienBet() {
        if (this.ketQua.length < 3) return null;
        
        let doDai = 1;
        const huong = this.ketQua[0];
        
        for (let i = 1; i < Math.min(this.ketQua.length, 15); i++) {
            if (this.ketQua[i] === huong) doDai++;
            else break;
        }
        
        if (doDai >= 2) {
            let duDoan, doTinCay, lyDo;
            
            if (doDai >= 5) {
                duDoan = huong === 'Tài' ? 'Xỉu' : 'Tài';
                doTinCay = 80 + Math.min(10, doDai - 4);
                lyDo = `💰 Cầu bệt ${doDai} phiên ${huong} → Dự đoán BẺ thành ${duDoan}`;
            } else if (doDai >= 3) {
                duDoan = huong === 'Tài' ? 'Xỉu' : 'Tài';
                doTinCay = 70 + (doDai - 2) * 4;
                lyDo = `💰 Cầu bệt ${doDai} phiên ${huong} → Có thể bẻ thành ${duDoan}`;
            } else {
                duDoan = huong;
                doTinCay = 62;
                lyDo = `💰 Cầu bệt ${doDai} phiên ${huong} → Tiếp tục theo ${duDoan}`;
            }
            
            return { duDoan, doTinCay, lyDo, loai: 'bet', doDai, huong };
        }
        return null;
    }

    // 2. PHÁT HIỆN SAU KHI BẺ CẦU (1 Tài sau 3 Xỉu hoặc ngược lại)
    phatHienSauKhiBe() {
        if (this.ketQua.length < 4) return null;
        
        // Lấy 4 phiên gần nhất
        const p1 = this.ketQua[0];  // mới nhất
        const p2 = this.ketQua[1];
        const p3 = this.ketQua[2];
        const p4 = this.ketQua[3];
        
        // Trường hợp: Xỉu-Xỉu-Xỉu-Tài (3 Xỉu rồi 1 Tài)
        if (p2 === 'Xỉu' && p3 === 'Xỉu' && p4 === 'Xỉu' && p1 === 'Tài') {
            return {
                duDoan: 'Tài',
                doTinCay: 68,
                lyDo: `🔄 Sau 3 Xỉu → 1 Tài, xu hướng có thể hình thành cầu Tài mới`,
                loai: 'sau_khi_be',
                mau: 'XXXT'
            };
        }
        
        // Trường hợp: Tài-Tài-Tài-Xỉu (3 Tài rồi 1 Xỉu)
        if (p2 === 'Tài' && p3 === 'Tài' && p4 === 'Tài' && p1 === 'Xỉu') {
            return {
                duDoan: 'Xỉu',
                doTinCay: 68,
                lyDo: `🔄 Sau 3 Tài → 1 Xỉu, xu hướng có thể hình thành cầu Xỉu mới`,
                loai: 'sau_khi_be',
                mau: 'TTTX'
            };
        }
        
        return null;
    }

    // 3. PHÂN TÍCH ĐIỂM SỐ XÚC XẮC
    phanTichDiemSo() {
        if (this.diem.length < 5) return null;
        
        const diemTb5 = this.diem.slice(0, 5).reduce((a,b) => a+b, 0) / 5;
        const diemTb10 = this.diem.slice(0, 10).reduce((a,b) => a+b, 0) / 10;
        
        // Xu hướng tăng/giảm điểm
        let tang = 0, giam = 0;
        for (let i = 0; i < 4; i++) {
            if (this.diem[i] > this.diem[i+1]) giam++;
            if (this.diem[i] < this.diem[i+1]) tang++;
        }
        
        // Điểm quá thấp (dưới 8) → khả năng về Tài
        if (this.diem[0] <= 8) {
            return {
                duDoan: 'Tài',
                doTinCay: 65,
                lyDo: `📈 Điểm số phiên trước quá thấp (${this.diem[0]} điểm), khả năng hồi phục lên Tài`,
                loai: 'diem_so'
            };
        }
        
        // Điểm quá cao (trên 14) → khả năng về Xỉu
        if (this.diem[0] >= 14) {
            return {
                duDoan: 'Xỉu',
                doTinCay: 65,
                lyDo: `📉 Điểm số phiên trước quá cao (${this.diem[0]} điểm), khả năng giảm xuống Xỉu`,
                loai: 'diem_so'
            };
        }
        
        // Xu hướng tăng điểm mạnh → Tài
        if (tang >= 3 && diemTb5 > 11) {
            return {
                duDoan: 'Tài',
                doTinCay: 68,
                lyDo: `📈 Xu hướng điểm đang tăng mạnh (${tang}/4 phiên), theo Tài`,
                loai: 'diem_so'
            };
        }
        
        // Xu hướng giảm điểm mạnh → Xỉu
        if (giam >= 3 && diemTb5 < 10) {
            return {
                duDoan: 'Xỉu',
                doTinCay: 68,
                lyDo: `📉 Xu hướng điểm đang giảm mạnh (${giam}/4 phiên), theo Xỉu`,
                loai: 'diem_so'
            };
        }
        
        return null;
    }

    // 4. CÂN BẰNG TỶ LỆ (BÙ KẾT QUẢ)
    phanTichCanBang() {
        if (this.ketQua.length < 20) return null;
        
        const taiCount = this.ketQua.slice(0, 20).filter(k => k === 'Tài').length;
        const chenhLech = Math.abs(taiCount - 10);
        
        if (chenhLech >= 3) {
            const duDoan = taiCount > 10 ? 'Xỉu' : 'Tài';
            return {
                duDoan: duDoan,
                doTinCay: 65 + Math.min(10, chenhLech),
                lyDo: `⚖️ Cân bằng tỷ lệ (Tài ${taiCount}/20 phiên, chênh ${chenhLech}) → Dự đoán ${duDoan}`,
                loai: 'can_bang'
            };
        }
        return null;
    }

    // 5. PHÁT HIỆN CẦU ĐẢO 1-1
    phatHienCauDao() {
        if (this.ketQua.length < 4) return null;
        
        let laDao = true;
        for (let i = 1; i < 4; i++) {
            if (this.ketQua[i] === this.ketQua[i-1]) {
                laDao = false;
                break;
            }
        }
        
        if (laDao) {
            const duDoan = this.ketQua[0] === 'Tài' ? 'Xỉu' : 'Tài';
            return {
                duDoan: duDoan,
                doTinCay: 72,
                lyDo: `🔄 Cầu đảo 1-1 (${this.ketQua[0]} → ${duDoan})`,
                loai: 'cau_dao'
            };
        }
        return null;
    }

    // 6. PHÁT HIỆN CẦU 2-2
    phatHienCau22() {
        if (this.ketQua.length < 4) return null;
        
        const kq = this.ketQua;
        if (kq[0] === kq[1] && kq[2] === kq[3] && kq[0] !== kq[2]) {
            const duDoan = kq[2];
            return {
                duDoan: duDoan,
                doTinCay: 74,
                lyDo: `📊 Cầu 2-2 (${kq[0]}${kq[1]} → ${kq[2]}${kq[3]}) → Theo ${duDoan}`,
                loai: 'cau_22'
            };
        }
        return null;
    }

    // 7. DỰ ĐOÁN TỔNG HỢP
    duDoan() {
        const tatCaPhanTich = [
            this.phatHienBet(),
            this.phatHienSauKhiBe(),
            this.phanTichDiemSo(),
            this.phanTichCanBang(),
            this.phatHienCauDao(),
            this.phatHienCau22()
        ].filter(p => p !== null);
        
        if (tatCaPhanTich.length === 0) {
            // Fallback: theo kết quả phiên trước
            return {
                duDoan: this.ketQua[0] || 'Tài',
                doTinCay: 55,
                lyDo: `📌 Không đủ tín hiệu rõ ràng, theo xu hướng phiên trước`,
                loai: 'fallback'
            };
        }
        
        // Tính điểm có trọng số
        let diemTai = 0, diemXiu = 0, tongTinCay = 0;
        const chiTiet = [];
        
        for (const p of tatCaPhanTich) {
            if (p.duDoan === 'Tài') diemTai += p.do_tin_cay;
            else diemXiu += p.do_tin_cay;
            tongTinCay += p.do_tin_cay;
            chiTiet.push(p);
        }
        
        const finalPrediction = diemTai >= diemXiu ? 'Tài' : 'Xỉu';
        let finalConfidence = Math.max(diemTai, diemXiu) / tongTinCay * 100;
        finalConfidence = Math.min(92, Math.max(60, Math.round(finalConfidence)));
        
        // Lấy lý do từ phân tích có độ tin cậy cao nhất
        const bestReason = chiTiet.sort((a,b) => b.do_tin_cay - a.do_tin_cay)[0];
        
        return {
            du_doan: finalPrediction,
            do_tin_cay: finalConfidence,
            ly_do: bestReason.lyDo,
            chi_tiet: chiTiet.map(c => `${c.lyDo} (${c.do_tin_cay}%)`),
            so_tin_hieu: chiTiet.length
        };
    }
    
    // Cập nhật thống kê sau mỗi phiên
    capNhatThongKe(duDoan, ketQuaThuc) {
        this.thongKe.tong++;
        if (duDoan === ketQuaThuc) {
            this.thongKe.dung++;
        } else {
            this.thongKe.sai++;
        }
    }
    
    getThongKe() {
        const tyLe = this.thongKe.tong > 0 ? (this.thongKe.dung / this.thongKe.tong * 100).toFixed(2) : 0;
        return {
            tong_phien: this.thongKe.tong,
            dung: this.thongKe.dung,
            sai: this.thongKe.sai,
            ty_le_chinh_xac: `${tyLe}%`
        };
    }
}

const predictor = new ThongMinhPredictor();
let lastProcessedId = null;

// ==================== FETCH DỮ LIỆU ====================
async function fetchData() {
    try {
        const response = await axios.get(API_URL_MD5, {
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        if (response.data && response.data.list) {
            const data = response.data.list;
            const latest = data[0];
            
            if (lastProcessedId !== latest.id) {
                predictor.capNhatLichSu(data);
                
                // Kiểm tra dự đoán cũ
                if (predictor.lastPrediction && predictor.lastPrediction.phien === latest.id) {
                    const thucTe = latest.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu';
                    const dung = predictor.lastPrediction.duDoan === thucTe;
                    predictor.capNhatThongKe(predictor.lastPrediction.duDoan, thucTe);
                    console.log(`📊 Phiên ${latest.id}: Dự đoán ${predictor.lastPrediction.duDoan} → Thực tế: ${thucTe} | ${dung ? '✅ ĐÚNG' : '❌ SAI'}`);
                    console.log(`📈 Thống kê: ${predictor.getThongKe().ty_le_chinh_xac} (${predictor.thongKe.dung}/${predictor.thongKe.tong})\n`);
                }
                
                lastProcessedId = latest.id;
            }
            return data;
        }
    } catch (error) {
        console.error('Lỗi fetch:', error.message);
    }
    return null;
}

// Chạy fetch định kỳ mỗi 5 giây
setInterval(fetchData, 5000);

// ==================== API ENDPOINTS ====================

app.get('/', (req, res) => {
    res.json({
        name: 'Tài Xỉu MD5 - AI Thông Minh',
        version: '3.0',
        author: '@anhquan',
        endpoints: ['/predict', '/stats', '/history']
    });
});

// Dự đoán
app.get('/predict', async (req, res) => {
    await fetchData(); // Đảm bảo dữ liệu mới nhất
    
    if (predictor.ketQua.length < 10) {
        return res.json({
            error: 'Đang phân tích dữ liệu',
            can_them: 10 - predictor.ketQua.length,
            status: 'learning'
        });
    }
    
    const duDoan = predictor.duDoan();
    const latestId = lastProcessedId;
    const ketQuaCuoi = predictor.ketQua[0] || '?';
    
    // Lưu dự đoán để kiểm tra sau
    predictor.lastPrediction = {
        phien: latestId ? latestId + 1 : null,
        duDoan: duDoan.du_doan,
        doTinCay: duDoan.do_tin_cay
    };
    
    res.json({
        phien_truoc: latestId,
        ket_qua_truoc: ketQuaCuoi,
        phien_hien_tai: latestId ? latestId + 1 : null,
        du_doan: duDoan.du_doan,
        do_tin_cay: `${duDoan.do_tin_cay}%`,
        ly_do: duDoan.ly_do,
        chi_tiet_phan_tich: duDoan.chi_tiet,
        so_tin_hieu: duDoan.so_tin_hieu,
        thong_ke: predictor.getThongKe(),
        id: '@anhquan'
    });
});

// Thống kê
app.get('/stats', (req, res) => {
    res.json(predictor.getThongKe());
});

// Lịch sử
app.get('/history', (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const ketQuaGanDay = predictor.ketQua.slice(0, limit);
    const diemGanDay = predictor.diem.slice(0, limit);
    
    const lichSu = [];
    for (let i = 0; i < ketQuaGanDay.length; i++) {
        lichSu.push({
            ket_qua: ketQuaGanDay[i],
            tong_diem: diemGanDay[i]
        });
    }
    
    res.json({
        tong_phien: predictor.ketQua.length,
        lich_su: lichSu,
        chuoi_ket_qua: ketQuaGanDay.join(' → ')
    });
});

// Khởi động server
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`
╔══════════════════════════════════════════════════════╗
║   🎲 TÀI XỈU MD5 - AI THÔNG MINH 🎲                 ║
║   Phân tích cầu bệt | Điểm số | Cân bằng | Đảo cầu  ║
╚══════════════════════════════════════════════════════╝
    `);
    console.log(`🚀 Server: http://localhost:${PORT}`);
    console.log(`📡 Dự đoán: http://localhost:${PORT}/predict`);
    console.log(`📊 Thống kê: http://localhost:${PORT}/stats`);
    console.log(`📜 Lịch sử: http://localhost:${PORT}/history\n`);
    
    await fetchData();
});