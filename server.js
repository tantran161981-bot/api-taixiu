const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// ==================== CẤU HÌNH ====================
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const HISTORY_FILE = './prediction_history.json';

// ==================== SIÊU THUẬT TOÁN DỰ ĐOÁN ====================
class SieuThuatToan {
    constructor() {
        this.history = [];
        this.ketQuaHistory = [];
        this.diemHistory = [];
        this.xucXacHistory = [];
        
        // Trọng số các mẫu cầu (tự động cập nhật)
        this.trongSoMau = {
            // Cầu bệt
            bet3: 1.0, bet4: 1.0, bet5: 1.0, bet6: 1.0, bet7: 1.0, bet8: 1.0, bet9: 1.0, bet10: 1.0,
            // Cầu đảo
            dao11: 1.0, dao22: 1.0, dao33: 1.0, dao44: 1.0,
            // Cầu xen kẽ
            cau121: 1.0, cau212: 1.0, cau1221: 1.0, cau2112: 1.0, cau12321: 1.0,
            // Cầu đặc biệt
            cauThang: 1.0, cauLenh: 1.0, cauTamGiac: 1.0, cauThoi: 1.0, cauXoanOc: 1.0,
            cauSong: 1.0, cauDoiXung: 1.0, cauLapKep: 1.0, cauCachQuang: 1.0,
            // Phân tích thống kê
            buTyLe: 1.0, xuHuongDiem: 1.0, bienDong: 1.0, markov3: 1.0, markov4: 1.0,
            // Cầu tổng hợp
            tongHop: 1.0
        };
        
        this.thongKe = {
            tongPhien: 0,
            dung: 0,
            sai: 0,
            tyLe: 0
        };
        
        this.dsMauCauPhatHien = [];
    }
    
    // Cập nhật dữ liệu lịch sử
    capNhatLichSu(data) {
        for (const item of data) {
            const ketQua = item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu';
            this.ketQuaHistory.unshift(ketQua);
            this.diemHistory.unshift(item.point);
            this.xucXacHistory.unshift(item.dices);
            
            if (this.ketQuaHistory.length > 100) {
                this.ketQuaHistory.pop();
                this.diemHistory.pop();
                this.xucXacHistory.pop();
            }
        }
    }
    
    // ==================== 1. CẦU BỆT (CHUỖI LIÊN TIẾP) ====================
    phatHienBet() {
        if (this.ketQuaHistory.length < 3) return null;
        
        let doDai = 1;
        const huong = this.ketQuaHistory[0];
        
        for (let i = 1; i < Math.min(this.ketQuaHistory.length, 15); i++) {
            if (this.ketQuaHistory[i] === huong) doDai++;
            else break;
        }
        
        if (doDai >= 3) {
            let duDoan, doTinCay;
            const key = `bet${doDai}`;
            
            if (doDai >= 8) {
                duDoan = huong === 'Tài' ? 'Xỉu' : 'Tài';
                doTinCay = 88 + Math.min(5, doDai - 8);
            } else if (doDai >= 6) {
                duDoan = huong === 'Tài' ? 'Xỉu' : 'Tài';
                doTinCay = 80 + (doDai - 5);
            } else if (doDai >= 4) {
                duDoan = huong;
                doTinCay = 70 + (doDai - 3) * 3;
            } else {
                duDoan = huong;
                doTinCay = 65;
            }
            
            return {
                loai: `Bệt ${doDai} phiên ${huong}`,
                duDoan: duDoan,
                doTinCay: Math.min(95, doTinCay),
                trongSo: this.trongSoMau[key] || 1.0,
                key: key
            };
        }
        return null;
    }
    
    // ==================== 2. CẦU ĐẢO 1-1, 2-2, 3-3, 4-4 ====================
    phatHienCauDao() {
        if (this.ketQuaHistory.length < 4) return null;
        
        // Cầu 1-1 (Xen kẽ hoàn hảo)
        let laDao11 = true;
        for (let i = 1; i < Math.min(this.ketQuaHistory.length, 10); i++) {
            if (this.ketQuaHistory[i] === this.ketQuaHistory[i-1]) {
                laDao11 = false;
                break;
            }
        }
        
        if (laDao11 && this.ketQuaHistory.length >= 4) {
            const doDai = this.tinhDoDaiDao();
            const duDoan = this.ketQuaHistory[0] === 'Tài' ? 'Xỉu' : 'Tài';
            let doTinCay = 72 + Math.min(10, doDai);
            
            return {
                loai: `Cầu đảo 1-1 (${doDai} phiên)`,
                duDoan: duDoan,
                doTinCay: Math.min(92, doTinCay),
                trongSo: this.trongSoMau.dao11,
                key: 'dao11'
            };
        }
        
        // Cầu 2-2 (TTXX TTXX)
        if (this.ketQuaHistory.length >= 4) {
            const kq = this.ketQuaHistory;
            if (kq[0] === kq[1] && kq[2] === kq[3] && kq[0] !== kq[2]) {
                const duDoan = kq[2];
                return {
                    loai: 'Cầu 2-2 (TTXX)',
                    duDoan: duDoan,
                    doTinCay: 76,
                    trongSo: this.trongSoMau.dao22,
                    key: 'dao22'
                };
            }
        }
        
        // Cầu 3-3 (TTT XXX)
        if (this.ketQuaHistory.length >= 6) {
            const kq = this.ketQuaHistory;
            if (kq[0] === kq[1] && kq[1] === kq[2] && 
                kq[3] === kq[4] && kq[4] === kq[5] && 
                kq[0] !== kq[3]) {
                const duDoan = kq[3];
                return {
                    loai: 'Cầu 3-3 (TTT XXX)',
                    duDoan: duDoan,
                    doTinCay: 80,
                    trongSo: this.trongSoMau.dao33,
                    key: 'dao33'
                };
            }
        }
        
        return null;
    }
    
    tinhDoDaiDao() {
        let doDai = 1;
        for (let i = 1; i < Math.min(this.ketQuaHistory.length, 15); i++) {
            if (this.ketQuaHistory[i] !== this.ketQuaHistory[i-1]) doDai++;
            else break;
        }
        return doDai;
    }
    
    // ==================== 3. CẦU 1-2-1, 2-1-2, 1-2-2-1, 2-1-1-2 ====================
    phatHienCauXenKe() {
        if (this.ketQuaHistory.length < 5) return null;
        const kq = this.ketQuaHistory;
        
        // Cầu 1-2-1: T-X-X-T hoặc X-T-T-X
        if (kq[0] !== kq[1] && kq[1] === kq[2] && kq[2] !== kq[3] && kq[0] === kq[3]) {
            return {
                loai: 'Cầu 1-2-1',
                duDoan: kq[0],
                doTinCay: 74,
                trongSo: this.trongSoMau.cau121,
                key: 'cau121'
            };
        }
        
        // Cầu 2-1-2: T-T-X-T-T hoặc X-X-T-X-X
        if (this.ketQuaHistory.length >= 5) {
            if (kq[0] === kq[1] && kq[1] !== kq[2] && kq[2] !== kq[3] && kq[3] === kq[4] && kq[0] !== kq[3]) {
                const duDoan = kq[3];
                return {
                    loai: 'Cầu 2-1-2',
                    duDoan: duDoan,
                    doTinCay: 76,
                    trongSo: this.trongSoMau.cau212,
                    key: 'cau212'
                };
            }
        }
        
        // Cầu 1-2-2-1: T-X-X-T
        if (this.ketQuaHistory.length >= 4) {
            if (kq[0] !== kq[1] && kq[1] === kq[2] && kq[2] !== kq[3] && kq[0] === kq[3]) {
                return {
                    loai: 'Cầu 1-2-2-1 (1221)',
                    duDoan: kq[0] === 'Tài' ? 'Xỉu' : 'Tài',
                    doTinCay: 78,
                    trongSo: this.trongSoMau.cau1221,
                    key: 'cau1221'
                };
            }
        }
        
        return null;
    }
    
    // ==================== 4. CẦU ĐẶC BIỆT (CAO CẤP) ====================
    phatHienCauDacBiet() {
        if (this.ketQuaHistory.length < 8) return null;
        const kq = this.ketQuaHistory;
        const diem = this.diemHistory;
        
        // Cầu thang (điểm tăng/giảm đều đặn)
        if (diem.length >= 5) {
            let tang = 0, giam = 0;
            for (let i = 0; i < 4; i++) {
                if (diem[i] > diem[i+1]) giam++;
                if (diem[i] < diem[i+1]) tang++;
            }
            
            if (tang >= 3) {
                return {
                    loai: 'Cầu thang tăng điểm',
                    duDoan: 'Tài',
                    doTinCay: 70,
                    trongSo: this.trongSoMau.cauThang,
                    key: 'cauThang'
                };
            }
            if (giam >= 3) {
                return {
                    loai: 'Cầu thang giảm điểm',
                    duDoan: 'Xỉu',
                    doTinCay: 70,
                    trongSo: this.trongSoMau.cauThang,
                    key: 'cauThang'
                };
            }
        }
        
        // Cầu lệch (Tài hoặc Xỉu xuất hiện nhiều hơn hẳn trong 10 phiên)
        if (this.ketQuaHistory.length >= 10) {
            const taiCount = this.ketQuaHistory.slice(0, 10).filter(r => r === 'Tài').length;
            if (taiCount >= 8) {
                return {
                    loai: `Cầu lệch Tài (${taiCount}/10)`,
                    duDoan: 'Xỉu',
                    doTinCay: 72 + (taiCount - 7) * 2,
                    trongSo: this.trongSoMau.cauLenh,
                    key: 'cauLenh'
                };
            }
            if (taiCount <= 2) {
                return {
                    loai: `Cầu lệch Xỉu (${10-taiCount}/10)`,
                    duDoan: 'Tài',
                    doTinCay: 72 + (7 - taiCount) * 2,
                    trongSo: this.trongSoMau.cauLenh,
                    key: 'cauLenh'
                };
            }
        }
        
        // Cầu tam giác (T-X-T-X-T hoặc X-T-X-T-X)
        if (this.ketQuaHistory.length >= 5) {
            let laTamGiac = true;
            for (let i = 1; i < 5; i++) {
                if (this.ketQuaHistory[i] === this.ketQuaHistory[i-1]) {
                    laTamGiac = false;
                    break;
                }
            }
            if (laTamGiac) {
                const duDoan = this.ketQuaHistory[0] === 'Tài' ? 'Xỉu' : 'Tài';
                return {
                    loai: 'Cầu tam giác (xen kẽ 5 phiên)',
                    duDoan: duDoan,
                    doTinCay: 75,
                    trongSo: this.trongSoMau.cauTamGiac,
                    key: 'cauTamGiac'
                };
            }
        }
        
        // Cầu thoi (T-T-X-X-T-T-X-X)
        if (this.ketQuaHistory.length >= 8) {
            const p8 = this.ketQuaHistory.slice(0, 8);
            let laThoi = true;
            for (let i = 0; i < 8; i+=2) {
                if (i+1 < 8 && p8[i] !== p8[i+1]) laThoi = false;
            }
            if (laThoi && p8[0] !== p8[2]) {
                const duDoan = p8[6];
                return {
                    loai: 'Cầu thoi (TTXX TTXX)',
                    duDoan: duDoan,
                    doTinCay: 78,
                    trongSo: this.trongSoMau.cauThoi,
                    key: 'cauThoi'
                };
            }
        }
        
        // Cầu xoắn ốc (pattern lặp lại theo chu kỳ)
        if (this.ketQuaHistory.length >= 12) {
            for (let cycle = 3; cycle <= 6; cycle++) {
                let lapLai = true;
                for (let i = 0; i < cycle; i++) {
                    if (this.ketQuaHistory[i] !== this.ketQuaHistory[i + cycle]) {
                        lapLai = false;
                        break;
                    }
                }
                if (lapLai) {
                    const duDoan = this.ketQuaHistory[cycle - 1];
                    return {
                        loai: `Cầu xoắn ốc (chu kỳ ${cycle})`,
                        duDoan: duDoan,
                        doTinCay: 74,
                        trongSo: this.trongSoMau.cauXoanOc,
                        key: 'cauXoanOc'
                    };
                }
            }
        }
        
        return null;
    }
    
    // ==================== 5. PHÂN TÍCH XÁC SUẤT THỐNG KÊ ====================
    phanTichXacSuat() {
        if (this.ketQuaHistory.length < 20) return null;
        
        // Bù tỷ lệ 20 phiên
        const tai20 = this.ketQuaHistory.slice(0, 20).filter(r => r === 'Tài').length;
        if (tai20 >= 14) {
            return {
                loai: `Bù tỷ lệ (Tài ${tai20}/20)`,
                duDoan: 'Xỉu',
                doTinCay: 68 + (tai20 - 13) * 2,
                trongSo: this.trongSoMau.buTyLe,
                key: 'buTyLe'
            };
        }
        if (tai20 <= 6) {
            return {
                loai: `Bù tỷ lệ (Xỉu ${20-tai20}/20)`,
                duDoan: 'Tài',
                doTinCay: 68 + (7 - tai20) * 2,
                trongSo: this.trongSoMau.buTyLe,
                key: 'buTyLe'
            };
        }
        
        // Xu hướng điểm
        if (this.diemHistory.length >= 10) {
            const avgDiem = this.diemHistory.slice(0, 10).reduce((a,b) => a+b,0) / 10;
            if (avgDiem > 11.5) {
                return {
                    loai: 'Xu hướng điểm cao',
                    duDoan: 'Tài',
                    doTinCay: 66,
                    trongSo: this.trongSoMau.xuHuongDiem,
                    key: 'xuHuongDiem'
                };
            }
            if (avgDiem < 9.5) {
                return {
                    loai: 'Xu hướng điểm thấp',
                    duDoan: 'Xỉu',
                    doTinCay: 66,
                    trongSo: this.trongSoMau.xuHuongDiem,
                    key: 'xuHuongDiem'
                };
            }
        }
        
        return null;
    }
    
    // ==================== 6. MARKOV CHAIN (XÁC SUẤT CHUYỂN TIẾP) ====================
    phanTichMarkov() {
        if (this.ketQuaHistory.length < 10) return null;
        
        // Markov bậc 3
        const last3 = this.ketQuaHistory.slice(0, 3).join('-');
        let taiSau = 0, xiuSau = 0;
        
        for (let i = 3; i < Math.min(this.ketQuaHistory.length, 50); i++) {
            const pattern = this.ketQuaHistory.slice(i-3, i).join('-');
            if (pattern === last3) {
                if (this.ketQuaHistory[i] === 'Tài') taiSau++;
                else xiuSau++;
            }
        }
        
        const tong = taiSau + xiuSau;
        if (tong >= 3) {
            if (taiSau / tong >= 0.7) {
                return {
                    loai: 'Markov bậc 3 → Tài',
                    duDoan: 'Tài',
                    doTinCay: 70 + Math.min(15, (taiSau / tong) * 20),
                    trongSo: this.trongSoMau.markov3,
                    key: 'markov3'
                };
            }
            if (xiuSau / tong >= 0.7) {
                return {
                    loai: 'Markov bậc 3 → Xỉu',
                    duDoan: 'Xỉu',
                    doTinCay: 70 + Math.min(15, (xiuSau / tong) * 20),
                    trongSo: this.trongSoMau.markov3,
                    key: 'markov3'
                };
            }
        }
        
        return null;
    }
    
    // ==================== TỔNG HỢP DỰ ĐOÁN ====================
    duDoan() {
        const tatCaMau = [
            this.phatHienBet(),
            this.phatHienCauDao(),
            this.phatHienCauXenKe(),
            this.phatHienCauDacBiet(),
            this.phanTichXacSuat(),
            this.phanTichMarkov()
        ].filter(m => m !== null);
        
        if (tatCaMau.length === 0) {
            // Fallback: theo xu hướng 3 phiên gần nhất
            const last3 = this.ketQuaHistory.slice(0, 3);
            const taiCount = last3.filter(r => r === 'Tài').length;
            const duDoan = taiCount >= 2 ? 'Tài' : 'Xỉu';
            return {
                du_doan: duDoan,
                do_tin_cay: 58,
                cac_mau_cau: [{ loai: 'Xu hướng 3 phiên gần nhất', doTinCay: 58 }],
                so_mau: 1
            };
        }
        
        // Tính điểm có trọng số
        let diemTai = 0, diemXiu = 0;
        let tongTrongSo = 0;
        const cacMauDaDung = [];
        
        for (const mau of tatCaMau) {
            const diem = mau.do_tin_cay * mau.trongSo;
            if (mau.duDoan === 'Tài') diemTai += diem;
            else diemXiu += diem;
            tongTrongSo += mau.trongSo;
            
            cacMauDaDung.push({
                loai: mau.loai,
                doTinCay: mau.do_tin_cay,
                duDoan: mau.duDoan
            });
        }
        
        const finalPrediction = diemTai >= diemXiu ? 'Tài' : 'Xỉu';
        let finalConfidence = Math.max(diemTai, diemXiu) / tongTrongSo;
        
        // Điều chỉnh confidence theo số lượng mẫu
        if (tatCaMau.length >= 3) finalConfidence += 5;
        if (tatCaMau.length >= 5) finalConfidence += 3;
        
        finalConfidence = Math.min(96, Math.max(55, Math.round(finalConfidence)));
        
        return {
            du_doan: finalPrediction,
            do_tin_cay: finalConfidence,
            cac_mau_cau: cacMauDaDung,
            so_mau: tatCaMau.length
        };
    }
    
    // Cập nhật trọng số dựa trên kết quả thực tế
    capNhatTrongSo(mauKey, dung) {
        if (this.trongSoMau[mauKey]) {
            if (dung) {
                this.trongSoMau[mauKey] = Math.min(2.0, this.trongSoMau[mauKey] * 1.05);
            } else {
                this.trongSoMau[mauKey] = Math.max(0.5, this.trongSoMau[mauKey] * 0.95);
            }
        }
    }
    
    // Cập nhật thống kê
    capNhatThongKe(duDoan, ketQuaThuc) {
        this.thongKe.tongPhien++;
        if (duDoan === ketQuaThuc) {
            this.thongKe.dung++;
        } else {
            this.thongKe.sai++;
        }
        this.thongKe.tyLe = (this.thongKe.dung / this.thongKe.tongPhien * 100).toFixed(2);
    }
    
    getThongKe() {
        return {
            tongPhien: this.thongKe.tongPhien,
            dung: this.thongKe.dung,
            sai: this.thongKe.sai,
            tyLeChinhXac: this.thongKe.tyLe + '%'
        };
    }
}

// ==================== KHỞI TẠO ====================
const predictor = new SieuThuatToan();
let lastFetchedId = null;

// Fetch dữ liệu từ API
async function fetchData() {
    try {
        const response = await axios.get(API_URL_MD5, {
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        if (response.data && response.data.list) {
            const data = response.data.list;
            const latestId = data[0].id;
            
            if (lastFetchedId !== latestId) {
                predictor.capNhatLichSu(data);
                lastFetchedId = latestId;
                console.log(`✅ Đã cập nhật ${data.length} phiên, mới nhất: ${latestId}`);
                
                // Kiểm tra dự đoán cũ nếu có
                if (predictor.lastPrediction && predictor.lastPrediction.phien === latestId) {
                    const ketQuaThuc = data[0].resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu';
                    const dung = predictor.lastPrediction.du_doan === ketQuaThuc;
                    predictor.capNhatThongKe(predictor.lastPrediction.du_doan, ketQuaThuc);
                    console.log(`📊 Dự đoán ${predictor.lastPrediction.du_doan} → Thực tế: ${ketQuaThuc} | ${dung ? 'ĐÚNG ✅' : 'SAI ❌'}`);
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
        name: 'SIÊU THUẬT TOÁN TÀI XỈU PRO MAX',
        version: '10.0',
        author: '@tiendataox',
        features: [
            '25+ loại cầu thông minh',
            'Không random - 100% dữ liệu thực',
            'Tự học cập nhật trọng số',
            'Bù tỷ lệ chính xác'
        ]
    });
});

app.get('/lc79-md5', async (req, res) => {
    await fetchData();
    
    if (predictor.ketQuaHistory.length < 10) {
        return res.json({
            error: 'Đang thu thập dữ liệu',
            can_them: 10 - predictor.ketQuaHistory.length,
            status: 'learning'
        });
    }
    
    const duDoan = predictor.duDoan();
    const latest = predictor.ketQuaHistory[0];
    const latestId = lastFetchedId;
    
    // Lưu dự đoán để kiểm tra sau
    predictor.lastPrediction = {
        phien: latestId ? latestId + 1 : null,
        du_doan: duDoan.du_doan,
        do_tin_cay: duDoan.do_tin_cay
    };
    
    res.json({
        phien_truoc: latestId,
        ket_qua_truoc: latest,
        phien_hien_tai: latestId ? latestId + 1 : null,
        du_doan: duDoan.du_doan,
        do_tin_cay: `${duDoan.do_tin_cay}%`,
        so_mau_cau_phat_hien: duDoan.so_mau,
        cac_mau_cau: duDoan.cac_mau_cau,
        thong_ke: predictor.getThongKe(),
        id: '@tiendataox'
    });
});

app.get('/stats', (req, res) => {
    res.json(predictor.getThongKe());
});

app.get('/history', (req, res) => {
    res.json({
        ket_qua_30_phien_gan_nhat: predictor.ketQuaHistory.slice(0, 30),
        diem_30_phien_gan_nhat: predictor.diemHistory.slice(0, 30),
        trong_so_mau: predictor.trongSoMau
    });
});

// Chạy server
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`\n╔══════════════════════════════════════════════════════╗`);
    console.log(`║   🎲 SIÊU THUẬT TOÁN TÀI XỈU PRO MAX 🎲           ║`);
    console.log(`║   25+ loại cầu thông minh - Tự học - Không random  ║`);
    console.log(`╚══════════════════════════════════════════════════════╝\n`);
    console.log(`🚀 Server: http://localhost:${PORT}`);
    console.log(`📡 Dự đoán: http://localhost:${PORT}/lc79-md5`);
    console.log(`📊 Thống kê: http://localhost:${PORT}/stats\n`);
    
    await fetchData();
    setInterval(fetchData, 5000);
});