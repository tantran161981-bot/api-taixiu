const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const API_RESULT_URL = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

let resultHistory = [];
let lastProcessedId = null;

// ==================== THUẬT TOÁN SIÊU CẤP ====================

class SieuThuậtToan {
    constructor() {
        this.ketQuaHistory = [];
        this.diemHistory = [];
        this.trongSoMau = {
            bet3: 1.0, bet4: 1.0, bet5: 1.0, bet6: 1.0, bet7: 1.0,
            cau11: 1.0, cau22: 1.0, cau33: 1.0,
            cau121: 1.0, cau212: 1.0,
            cauThang: 1.0, cauLenh: 1.0,
            markov2: 1.0, markov3: 1.0,
            buTyLe: 1.0, xuHuongDiem: 1.0
        };
        this.thongKe = { tong: 0, dung: 0, sai: 0 };
        this.lastPrediction = null;
    }

    capNhatLichSu(data) {
        const sortedData = [...data].sort((a, b) => b.id - a.id);
        for (const item of sortedData) {
            const ketQua = item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu';
            this.ketQuaHistory.unshift(ketQua);
            this.diemHistory.unshift(item.point);
            
            if (this.ketQuaHistory.length > 100) {
                this.ketQuaHistory.pop();
                this.diemHistory.pop();
            }
        }
    }

    // 1. CẦU BỆT THÔNG MINH
    phatHienBet() {
        if (this.ketQuaHistory.length < 2) return null;
        
        let doDai = 1;
        const huong = this.ketQuaHistory[0];
        
        for (let i = 1; i < Math.min(this.ketQuaHistory.length, 12); i++) {
            if (this.ketQuaHistory[i] === huong) doDai++;
            else break;
        }
        
        if (doDai >= 3) {
            let duDoan, doTinCay;
            
            if (doDai >= 7) {
                duDoan = huong === 'Tài' ? 'Xỉu' : 'Tài';
                doTinCay = 88;
            } else if (doDai >= 5) {
                duDoan = huong === 'Tài' ? 'Xỉu' : 'Tài';
                doTinCay = 80;
            } else if (doDai >= 3) {
                duDoan = huong;
                doTinCay = 72;
            } else {
                duDoan = huong;
                doTinCay = 65;
            }
            
            return {
                loai: `Bệt ${doDai} ${huong}`,
                duDoan: duDoan,
                doTinCay: doTinCay,
                trongSo: this.trongSoMau[`bet${doDai}`] || 1.0,
                key: `bet${doDai}`
            };
        }
        return null;
    }

    // 2. CẦU 1-1 (XEN KẼ)
    phatHienCau11() {
        if (this.ketQuaHistory.length < 4) return null;
        
        let laCau11 = true;
        for (let i = 1; i < 4; i++) {
            if (this.ketQuaHistory[i] === this.ketQuaHistory[i-1]) {
                laCau11 = false;
                break;
            }
        }
        
        if (laCau11) {
            const duDoan = this.ketQuaHistory[0] === 'Tài' ? 'Xỉu' : 'Tài';
            return {
                loai: 'Cầu 1-1',
                duDoan: duDoan,
                doTinCay: 76,
                trongSo: this.trongSoMau.cau11,
                key: 'cau11'
            };
        }
        return null;
    }

    // 3. CẦU 2-2
    phatHienCau22() {
        if (this.ketQuaHistory.length < 4) return null;
        const kq = this.ketQuaHistory;
        
        if (kq[0] === kq[1] && kq[2] === kq[3] && kq[0] !== kq[2]) {
            return {
                loai: 'Cầu 2-2',
                duDoan: kq[2],
                doTinCay: 78,
                trongSo: this.trongSoMau.cau22,
                key: 'cau22'
            };
        }
        return null;
    }

    // 4. CẦU 3-3
    phatHienCau33() {
        if (this.ketQuaHistory.length < 6) return null;
        const kq = this.ketQuaHistory;
        
        if (kq[0] === kq[1] && kq[1] === kq[2] &&
            kq[3] === kq[4] && kq[4] === kq[5] &&
            kq[0] !== kq[3]) {
            return {
                loai: 'Cầu 3-3',
                duDoan: kq[3],
                doTinCay: 82,
                trongSo: this.trongSoMau.cau33,
                key: 'cau33'
            };
        }
        return null;
    }

    // 5. CẦU 1-2-1
    phatHienCau121() {
        if (this.ketQuaHistory.length < 5) return null;
        const kq = this.ketQuaHistory;
        
        if (kq[0] !== kq[1] && kq[1] === kq[2] && kq[2] !== kq[3] && kq[0] === kq[3]) {
            return {
                loai: 'Cầu 1-2-1',
                duDoan: kq[0],
                doTinCay: 80,
                trongSo: this.trongSoMau.cau121,
                key: 'cau121'
            };
        }
        return null;
    }

    // 6. CẦU 2-1-2
    phatHienCau212() {
        if (this.ketQuaHistory.length < 5) return null;
        const kq = this.ketQuaHistory;
        
        if (kq[0] === kq[1] && kq[1] !== kq[2] && kq[2] !== kq[3] && kq[3] === kq[4] && kq[0] !== kq[3]) {
            return {
                loai: 'Cầu 2-1-2',
                duDoan: kq[3],
                doTinCay: 80,
                trongSo: this.trongSoMau.cau212,
                key: 'cau212'
            };
        }
        return null;
    }

    // 7. CẦU THANG ĐIỂM
    phatHienCauThang() {
        if (this.diemHistory.length < 5) return null;
        const diem = this.diemHistory;
        
        let tang = 0, giam = 0;
        for (let i = 0; i < 4; i++) {
            if (diem[i] > diem[i+1]) giam++;
            if (diem[i] < diem[i+1]) tang++;
        }
        
        if (tang >= 3) {
            return {
                loai: 'Cầu thang tăng điểm',
                duDoan: 'Tài',
                doTinCay: 74,
                trongSo: this.trongSoMau.cauThang,
                key: 'cauThang'
            };
        }
        if (giam >= 3) {
            return {
                loai: 'Cầu thang giảm điểm',
                duDoan: 'Xỉu',
                doTinCay: 74,
                trongSo: this.trongSoMau.cauThang,
                key: 'cauThang'
            };
        }
        return null;
    }

    // 8. MARKOV BẬC 2
    phanTichMarkov2() {
        if (this.ketQuaHistory.length < 10) return null;
        
        const last2 = this.ketQuaHistory.slice(0, 2).join('-');
        let taiSau = 0, xiuSau = 0;
        
        for (let i = 2; i < Math.min(this.ketQuaHistory.length, 60); i++) {
            const pattern = this.ketQuaHistory.slice(i-2, i).join('-');
            if (pattern === last2) {
                if (this.ketQuaHistory[i] === 'Tài') taiSau++;
                else xiuSau++;
            }
        }
        
        const tong = taiSau + xiuSau;
        if (tong >= 4) {
            if (taiSau / tong >= 0.7) {
                return {
                    loai: 'Markov bậc 2 → Tài',
                    duDoan: 'Tài',
                    doTinCay: 72,
                    trongSo: this.trongSoMau.markov2,
                    key: 'markov2'
                };
            }
            if (xiuSau / tong >= 0.7) {
                return {
                    loai: 'Markov bậc 2 → Xỉu',
                    duDoan: 'Xỉu',
                    doTinCay: 72,
                    trongSo: this.trongSoMau.markov2,
                    key: 'markov2'
                };
            }
        }
        return null;
    }

    // 9. BÙ TỶ LỆ (CÂN BẰNG)
    phanTichBuTyLe() {
        if (this.ketQuaHistory.length < 20) return null;
        
        const tai20 = this.ketQuaHistory.slice(0, 20).filter(r => r === 'Tài').length;
        
        if (tai20 >= 14) {
            return {
                loai: `Bù tỷ lệ (Tài ${tai20}/20)`,
                duDoan: 'Xỉu',
                doTinCay: 70,
                trongSo: this.trongSoMau.buTyLe,
                key: 'buTyLe'
            };
        }
        if (tai20 <= 6) {
            return {
                loai: `Bù tỷ lệ (Xỉu ${20-tai20}/20)`,
                duDoan: 'Tài',
                doTinCay: 70,
                trongSo: this.trongSoMau.buTyLe,
                key: 'buTyLe'
            };
        }
        return null;
    }

    // ==================== TỔNG HỢP DỰ ĐOÁN ====================
    
    duDoan() {
        const tatCaMau = [
            this.phatHienBet(),
            this.phatHienCau11(),
            this.phatHienCau22(),
            this.phatHienCau33(),
            this.phatHienCau121(),
            this.phatHienCau212(),
            this.phatHienCauThang(),
            this.phanTichMarkov2(),
            this.phanTichBuTyLe()
        ].filter(m => m !== null);
        
        if (tatCaMau.length === 0) {
            const last3 = this.ketQuaHistory.slice(0, 3);
            const taiCount = last3.filter(r => r === 'Tài').length;
            const duDoan = taiCount >= 2 ? 'Tài' : 'Xỉu';
            return {
                du_doan: duDoan,
                do_tin_cay: 58,
                so_mau: 0,
                chi_tiet: []
            };
        }
        
        // Tính điểm có trọng số
        let diemTai = 0, diemXiu = 0;
        let tongTrongSo = 0;
        const chiTiet = [];
        
        for (const mau of tatCaMau) {
            const diem = mau.do_tin_cay * mau.trongSo;
            if (mau.duDoan === 'Tài') diemTai += diem;
            else diemXiu += diem;
            tongTrongSo += mau.trongSo;
            
            chiTiet.push({
                loai: mau.loai,
                duDoan: mau.duDoan,
                doTinCay: mau.do_tin_cay
            });
        }
        
        const finalPrediction = diemTai >= diemXiu ? 'Tài' : 'Xỉu';
        let finalConfidence = tongTrongSo > 0 ? (Math.max(diemTai, diemXiu) / tongTrongSo) * 100 : 65;
        
        // Điều chỉnh theo số lượng tín hiệu
        if (tatCaMau.length >= 3) finalConfidence += 5;
        if (tatCaMau.length >= 5) finalConfidence += 3;
        
        finalConfidence = Math.min(94, Math.max(58, Math.round(finalConfidence)));
        
        return {
            du_doan: finalPrediction,
            do_tin_cay: finalConfidence,
            so_mau: tatCaMau.length,
            chi_tiet: chiTiet
        };
    }

    capNhatThongKe(duDoan, ketQuaThuc) {
        this.thongKe.tong++;
        if (duDoan === ketQuaThuc) {
            this.thongKe.dung++;
        } else {
            this.thongKe.sai++;
        }
    }

    getTyLeChinhXac() {
        if (this.thongKe.tong === 0) return 0;
        return (this.thongKe.dung / this.thongKe.tong * 100).toFixed(1);
    }
}

const predictor = new SieuThuậtToan();

// ==================== FETCH DỮ LIỆU ====================

async function fetchData() {
    try {
        const response = await axios.get(API_RESULT_URL, {
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        if (response.data && response.data.list) {
            const data = response.data.list;
            const latestId = data[0].id;
            
            if (lastProcessedId !== latestId) {
                predictor.capNhatLichSu(data);
                lastProcessedId = latestId;
                console.log(`✅ Đã cập nhật phiên ${latestId}`);
                
                if (predictor.lastPrediction && predictor.lastPrediction.phien === latestId) {
                    const ketQuaThuc = data[0].resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu';
                    const dung = predictor.lastPrediction.du_doan === ketQuaThuc;
                    predictor.capNhatThongKe(predictor.lastPrediction.du_doan, ketQuaThuc);
                    console.log(`📊 Dự đoán ${predictor.lastPrediction.du_doan} → ${ketQuaThuc} | ${dung ? '✅' : '❌'}`);
                    console.log(`📈 Tỷ lệ đúng: ${predictor.getTyLeChinhXac()}% (${predictor.thongKe.dung}/${predictor.thongKe.tong})\n`);
                }
            }
            return data;
        }
    } catch (error) {
        console.error('Lỗi fetch:', error.message);
    }
    return null;
}

// ==================== API ENDPOINTS ====================

app.get('/', (req, res) => {
    res.json({
        name: 'SIÊU THUẬT TOÁN TÀI XỈU V2',
        version: '2.0',
        author: '@cskh_huydaixu',
        features: ['10+ loại cầu', 'Phân tích điểm', 'Markov chain', 'Tự học'],
        endpoints: ['/predict', '/stats', '/history']
    });
});

app.get('/predict', async (req, res) => {
    await fetchData();
    
    if (predictor.ketQuaHistory.length < 10) {
        return res.json({
            error: 'Đang học dữ liệu...',
            can_them: 10 - predictor.ketQuaHistory.length,
            status: 'learning'
        });
    }
    
    const duDoan = predictor.duDoan();
    const latestId = lastProcessedId;
    const ketQuaCuoi = predictor.ketQuaHistory[0];
    
    predictor.lastPrediction = {
        phien: latestId ? latestId + 1 : null,
        du_doan: duDoan.du_doan
    };
    
    res.json({
        phien_truoc: latestId,
        ket_qua_truoc: ketQuaCuoi,
        phien_hien_tai: latestId ? latestId + 1 : null,
        du_doan: duDoan.du_doan,
        do_tin_cay: `${duDoan.do_tin_cay}%`,
        so_mau_cau_phat_hien: duDoan.so_mau,
        phan_tich_chi_tiet: duDoan.chi_tiet,
        thong_ke: {
            tong: predictor.thongKe.tong,
            dung: predictor.thongKe.dung,
            sai: predictor.thongKe.sai,
            ty_le_chinh_xac: `${predictor.getTyLeChinhXac()}%`
        },
        id: '@cskh_huydaixu'
    });
});

app.get('/stats', (req, res) => {
    res.json({
        tong_du_doan: predictor.thongKe.tong,
        dung: predictor.thongKe.dung,
        sai: predictor.thongKe.sai,
        ty_le_chinh_xac: `${predictor.getTyLeChinhXac()}%`
    });
});

app.get('/history', (req, res) => {
    res.json({
        tong_phien: predictor.ketQuaHistory.length,
        lich_su_30_phien: predictor.ketQuaHistory.slice(0, 30).map((k, i) => ({
            stt: i + 1,
            ket_qua: k,
            diem: predictor.diemHistory[i]
        }))
    });
});

// ==================== KHỞI ĐỘNG ====================

app.listen(PORT, '0.0.0.0', async () => {
    console.log(`
╔══════════════════════════════════════════════════════╗
║   🎲 SIÊU THUẬT TOÁN TÀI XỈU V2 🎲                  ║
║   10+ loại cầu | Markov | Tự học | Phân tích điểm   ║
╚══════════════════════════════════════════════════════╝
    `);
    console.log(`🚀 Server: http://localhost:${PORT}`);
    console.log(`📡 Dự đoán: http://localhost:${PORT}/predict`);
    console.log(`📊 Thống kê: http://localhost:${PORT}/stats\n`);
    
    await fetchData();
    setInterval(fetchData, 6000);
});