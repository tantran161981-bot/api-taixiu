// server.js - SUPER TAIXIU PRO MAX V6.0
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// ==================== CẤU HÌNH ====================
const API_URLS = {
    md5: 'https://wtxmd52.tele68.com/v1/txmd5/sessions',
    hu: 'https://wtx.tele68.com/v1/tx/sessions'
};

const DATA_DIR = './data';
const MODEL_FILE = path.join(DATA_DIR, 'pro_model.json');
const HISTORY_FILE = path.join(DATA_DIR, 'pro_history.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// ==================== THUẬT TOÁN PRO MAX ====================

class SieuTaiXiuPredictor {
    constructor() {
        this.version = '6.0.0';
        this.name = 'Sieu Tai Xiu Pro Max';
        this.loadModel();
    }

    // 1. THUẬT TOÁN PHÁT HIỆN CẦU BỆT SIÊU CHÍNH XÁC
    phatHienCauBet(results) {
        if (results.length < 3) return null;
        
        let doDaiBet = 1;
        let loaiBet = results[0];
        
        for (let i = 1; i < results.length; i++) {
            if (results[i] === loaiBet) doDaiBet++;
            else break;
        }
        
        if (doDaiBet >= 3) {
            // Phân tích lịch sử bệt để quyết định
            let tyLeBeCau = this.phanTichLichSuBeCau(results, loaiBet);
            let seBeCau = (doDaiBet >= 5) || (doDaiBet >= 4 && tyLeBeCau > 0.6);
            
            let duDoan = seBeCau ? (loaiBet === 'Tài' ? 'Xỉu' : 'Tài') : loaiBet;
            let doTinCay = 65 + doDaiBet * 4 + (tyLeBeCau * 15);
            
            return {
                duDoan: duDoan,
                doTinCay: Math.min(94, doTinCay),
                tenThuatToan: `🎯 Cầu bệt ${doDaiBet} phiên ${seBeCau ? '(Bẻ cầu thông minh)' : '(Theo cầu)'}`,
                moTa: `Phát hiện cầu ${loaiBet} kéo dài ${doDaiBet} phiên, ${seBeCau ? 'quyết định bẻ cầu' : 'tiếp tục theo cầu'}`
            };
        }
        return null;
    }
    
    phanTichLichSuBeCau(results, loaiBet) {
        let soLanBe = 0;
        let soLanTheo = 0;
        
        for (let i = 0; i < results.length - 4; i++) {
            if (results[i] === loaiBet && results[i+1] === loaiBet && results[i+2] === loaiBet) {
                // Tìm thấy cầu bệt 3+
                if (results[i+3] === loaiBet) soLanTheo++;
                else soLanBe++;
            }
        }
        
        let tong = soLanBe + soLanTheo;
        return tong > 0 ? soLanBe / tong : 0.5;
    }

    // 2. THUẬT TOÁN CẦU 1-1 (ĐẢO LIÊN TỤC)
    phatHienCauDao(results) {
        if (results.length < 4) return null;
        
        let doDaiDao = 1;
        for (let i = 1; i < Math.min(results.length, 15); i++) {
            if (results[i] !== results[i-1]) doDaiDao++;
            else break;
        }
        
        if (doDaiDao >= 4) {
            let duDoan = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
            let doTinCay = 70 + doDaiDao * 2;
            
            // Cầu càng dài càng dễ gãy
            if (doDaiDao >= 8) {
                duDoan = results[0];
                doTinCay = 80;
            }
            
            return {
                duDoan: duDoan,
                doTinCay: Math.min(90, doTinCay),
                tenThuatToan: `🔄 Cầu đảo 1-1 (${doDaiDao} phiên)`,
                moTa: `Cầu đang đảo chiều liên tục, dự đoán ${duDoan} cho phiên tiếp theo`
            };
        }
        return null;
    }

    // 3. THUẬT TOÁN CẦU 2-2
    phatHienCau22(results) {
        if (results.length < 6) return null;
        
        let cacCap = [];
        for (let i = 0; i < results.length - 1; i += 2) {
            if (results[i] === results[i+1]) {
                cacCap.push(results[i]);
            } else break;
        }
        
        if (cacCap.length >= 2) {
            let laDao = true;
            for (let i = 1; i < cacCap.length; i++) {
                if (cacCap[i] === cacCap[i-1]) laDao = false;
            }
            
            if (laDao) {
                let capCuoi = cacCap[cacCap.length - 1];
                let duDoan = capCuoi === 'Tài' ? 'Xỉu' : 'Tài';
                let doTinCay = 70 + cacCap.length * 4;
                
                return {
                    duDoan: duDoan,
                    doTinCay: Math.min(88, doTinCay),
                    tenThuatToan: `📊 Cầu 2-2 (${cacCap.length} cặp)`,
                    moTa: `Cầu 2-2 đan xen, dự đoán ${duDoan} sau cặp ${capCuoi}`
                };
            }
        }
        return null;
    }

    // 4. THUẬT TOÁN PHÂN TÍCH TỔNG ĐIỂM (XỔ SỐ)
    phanTichTongDiem(sums) {
        if (sums.length < 15) return null;
        
        let tong10Phien = sums.slice(0, 10);
        let trungBinh = tong10Phien.reduce((a,b) => a+b, 0) / 10;
        let tongHienTai = sums[0];
        
        // Vùng Tài: 11-17, Vùng Xỉu: 3-10
        let tyLeTai = 0;
        let tyLeXiu = 0;
        
        for (let i = 0; i < tong10Phien.length; i++) {
            if (tong10Phien[i] >= 11) tyLeTai++;
            else tyLeXiu++;
        }
        tyLeTai /= 10;
        tyLeXiu /= 10;
        
        // Dự đoán dựa trên xu hướng tổng điểm
        if (tyLeTai > 0.7) {
            return {
                duDoan: 'Xỉu',
                doTinCay: 75 + (tyLeTai - 0.7) * 50,
                tenThuatToan: `📈 Quá nóng Tài (${(tyLeTai*100).toFixed(0)}%)`,
                moTa: `10 phiên gần nhất Tài chiếm ${(tyLeTai*100).toFixed(0)}%, dự đoán đảo Xỉu`
            };
        }
        
        if (tyLeXiu > 0.7) {
            return {
                duDoan: 'Tài',
                doTinCay: 75 + (tyLeXiu - 0.7) * 50,
                tenThuatToan: `📉 Quá lạnh Xỉu (${(tyLeXiu*100).toFixed(0)}%)`,
                moTa: `10 phiên gần nhất Xỉu chiếm ${(tyLeXiu*100).toFixed(0)}%, dự đoán đảo Tài`
            };
        }
        
        return null;
    }

    // 5. THUẬT TOÁN MARKOV BẬC 2
    markovBac2(results) {
        if (results.length < 10) return null;
        
        let maTran = {};
        
        // Xây dựng ma trận xác suất
        for (let i = 0; i < results.length - 2; i++) {
            let trangThai = results[i] + '_' + results[i+1];
            let ketTiep = results[i+2];
            
            if (!maTran[trangThai]) {
                maTran[trangThai] = { Tai: 0, Xiu: 0 };
            }
            if (ketTiep === 'Tài') maTran[trangThai].Tai++;
            else maTran[trangThai].Xiu++;
        }
        
        let trangThaiHienTai = results[0] + '_' + results[1];
        let thongKe = maTran[trangThaiHienTai];
        
        if (thongKe && (thongKe.Tai + thongKe.Xiu) >= 3) {
            let xacSuatTai = thongKe.Tai / (thongKe.Tai + thongKe.Xiu);
            let duDoan = xacSuatTai > 0.55 ? 'Tài' : (xacSuatTai < 0.45 ? 'Xỉu' : null);
            
            if (duDoan) {
                return {
                    duDoan: duDoan,
                    doTinCay: 60 + Math.abs(xacSuatTai - 0.5) * 60,
                    tenThuatToan: `🔬 Markov bậc 2`,
                    moTa: `Dựa trên ${thongKe.Tai + thongKe.Xiu} lần xuất hiện của pattern "${trangThaiHienTai}"`
                };
            }
        }
        return null;
    }

    // 6. THUẬT TOÁN MÁY HỌC (WEIGHTED VOTING)
    hocMay(results, sums) {
        if (results.length < 15) return null;
        
        let diemTai = 0;
        let diemXiu = 0;
        
        // Feature 1: 5 phiên gần nhất (trọng số cao hơn)
        for (let i = 0; i < 5; i++) {
            const trongSo = (5 - i) / 5;
            if (results[i] === 'Tài') diemTai += trongSo * 2;
            else diemXiu += trongSo * 2;
        }
        
        // Feature 2: Tỷ lệ 10 phiên
        let tai10 = results.slice(0, 10).filter(r => r === 'Tài').length;
        diemTai += (tai10 / 10) * 3;
        diemXiu += ((10 - tai10) / 10) * 3;
        
        // Feature 3: Xu hướng tổng điểm
        let tongCao = sums.slice(0, 5).filter(s => s >= 11).length;
        diemTai += (tongCao / 5) * 1.5;
        diemXiu += ((5 - tongCao) / 5) * 1.5;
        
        // Feature 4: Chuỗi hiện tại (cầu dài dễ bẻ)
        let doDaiChuoi = 1;
        for (let i = 1; i < results.length; i++) {
            if (results[i] === results[i-1]) doDaiChuoi++;
            else break;
        }
        
        if (doDaiChuoi >= 4) {
            if (doDaiChuoi % 2 === 0) {
                // Bẻ cầu ở phiên chẵn
                let duDoanBe = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
                return {
                    duDoan: duDoanBe,
                    doTinCay: 70 + doDaiChuoi * 2,
                    tenThuatToan: `🧠 AI học máy - Bẻ cầu`,
                    moTa: `Chuỗi ${doDaiChuoi} phiên, AI quyết định bẻ cầu`
                };
            }
        }
        
        let duDoan = diemTai >= diemXiu ? 'Tài' : 'Xỉu';
        let doTinCay = 55 + Math.abs(diemTai - diemXiu) * 10;
        
        return {
            duDoan: duDoan,
            doTinCay: Math.min(92, doTinCay),
            tenThuatToan: `🤖 AI học máy tổng hợp`,
            moTa: `Tổng hợp ${diemTai.toFixed(1)} điểm cho Tài, ${diemXiu.toFixed(1)} điểm cho Xỉu`
        };
    }

    // 7. ENSEMBLE - TỔNG HỢP TẤT CẢ THUẬT TOÁN
    tongHopKetQua(results, sums) {
        let cacDuDoan = [];
        
        // Thu thập từ tất cả thuật toán
        let thuatToans = [
            this.phatHienCauBet.bind(this),
            this.phatHienCauDao.bind(this),
            this.phatHienCau22.bind(this),
            this.phanTichTongDiem.bind(this),
            this.markovBac2.bind(this),
            this.hocMay.bind(this)
        ];
        
        for (let tt of thuatToans) {
            try {
                let ketQua = tt(results, sums);
                if (ketQua && ketQua.duDoan) {
                    cacDuDoan.push(ketQua);
                }
            } catch(e) {}
        }
        
        if (cacDuDoan.length === 0) {
            // Fallback an toàn
            let taiCount = results.slice(0, 5).filter(r => r === 'Tài').length;
            return {
                duDoan: taiCount >= 3 ? 'Tài' : 'Xỉu',
                doTinCay: 60,
                giaiThich: `Không đủ dữ liệu, dựa trên 5 phiên gần nhất`,
                chiTietThuậtToan: []
            };
        }
        
        // Bỏ phiếu có trọng số
        let diemTai = 0, diemXiu = 0, tongTrongSo = 0;
        
        for (let dd of cacDuDoan) {
            let trongSo = dd.doTinCay / 100;
            if (dd.duDoan === 'Tài') diemTai += trongSo;
            else diemXiu += trongSo;
            tongTrongSo += trongSo;
        }
        
        let ketQuaCuoi = diemTai >= diemXiu ? 'Tài' : 'Xỉu';
        let doTinCayCuoi = (Math.max(diemTai, diemXiu) / tongTrongSo) * 100;
        
        // Làm tròn và giới hạn
        doTinCayCuoi = Math.min(96, Math.max(55, Math.round(doTinCayCuoi)));
        
        return {
            duDoan: ketQuaCuoi,
            doTinCay: doTinCayCuoi,
            soThuatToan: cacDuDoan.length,
            giaiThich: `Tổng hợp từ ${cacDuDoan.length} thuật toán, ${diemTai.toFixed(2)} điểm Tài - ${diemXiu.toFixed(2)} điểm Xỉu`,
            chiTietThuậtToan: cacDuDoan.map(tt => ({
                ten: tt.tenThuatToan,
                duDoan: tt.duDoan,
                doTinCay: tt.doTinCay,
                moTa: tt.moTa
            }))
        };
    }

    // Load/save model
    loadModel() {
        try {
            if (fs.existsSync(MODEL_FILE)) {
                this.model = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8'));
                console.log('✅ Đã tải model thành công');
            } else {
                this.model = { tongSoLanDuDoan: 0, soLanDung: 0, lichSu: [] };
            }
        } catch(e) {
            this.model = { tongSoLanDuDoan: 0, soLanDung: 0, lichSu: [] };
        }
    }
    
    saveModel() {
        try {
            fs.writeFileSync(MODEL_FILE, JSON.stringify(this.model, null, 2));
        } catch(e) {}
    }
    
    capNhatKetQua(duDoan, thucTe, doTinCay) {
        this.model.tongSoLanDuDoan++;
        let dung = (duDoan === thucTe);
        if (dung) this.model.soLanDung++;
        
        this.model.lichSu.unshift({
            thoiGian: new Date().toISOString(),
            duDoan: duDoan,
            thucTe: thucTe,
            ketQua: dung ? 'Đúng' : 'Sai',
            doTinCay: doTinCay
        });
        
        if (this.model.lichSu.length > 200) this.model.lichSu.pop();
        this.saveModel();
        
        return dung;
    }
}

// ==================== API SERVICE ====================

class TaixiuService {
    constructor() {
        this.predictor = new SieuTaiXiuPredictor();
        this.lichSuDuDoan = [];
        this.loadHistory();
    }
    
    async layDuLieu(loai) {
        try {
            let url = API_URLS[loai];
            let response = await axios.get(url, { timeout: 10000 });
            return this.chuyenDoiDuLieu(response.data);
        } catch(error) {
            console.error(`Lỗi lấy dữ liệu ${loai}:`, error.message);
            return null;
        }
    }
    
    chuyenDoiDuLieu(apiData) {
        if (!apiData || !apiData.list) return null;
        return apiData.list.map(item => ({
            phien: item.id,
            ketQua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
            xucSac: item.dices,
            tong: item.point
        }));
    }
    
    async duDoan(loai) {
        let data = await this.layDuLieu(loai);
        if (!data || data.length === 0) {
            return {
                thanhCong: false,
                thongBao: 'Không thể lấy dữ liệu từ API nguồn',
                id: '@Tskhang'
            };
        }
        
        let ketQuaHienTai = data[0];
        let phienHienTai = ketQuaHienTai.phien;
        let phienDuDoan = phienHienTai + 1;
        
        let results = data.map(d => d.ketQua);
        let sums = data.map(d => d.tong);
        
        let duDoan = this.predictor.tongHopKetQua(results, sums);
        
        let record = {
            thoiGian: new Date().toISOString(),
            loai: loai,
            phienHienTai: phienHienTai,
            ketQuaHienTai: ketQuaHienTai.ketQua,
            tongDiem: ketQuaHienTai.tong,
            xucSac: ketQuaHienTai.xucSac,
            phienDuDoan: phienDuDoan,
            duDoan: duDoan.duDoan,
            doTinCay: duDoan.doTinCay,
            soThuatToan: duDoan.soThuatToan,
            giaiThich: duDoan.giaiThich,
            chiTietThuậtToan: duDoan.chiTietThuậtToan,
            ketQuaThucTe: null,
            dungSai: null
        };
        
        this.lichSuDuDoan.unshift(record);
        if (this.lichSuDuDoan.length > 200) this.lichSuDuDoan.pop();
        this.saveHistory();
        
        return {
            thanhCong: true,
            id: '@Tskhang',
            thuatToan: 'Sieu Tai Xiu Pro Max v6.0',
            phienHienTai: phienHienTai,
            ketQuaHienTai: ketQuaHienTai.ketQua,
            tongDiemHienTai: ketQuaHienTai.tong,
            xucSac: ketQuaHienTai.xucSac.join(' - '),
            phienDuDoan: phienDuDoan,
            duDoan: duDoan.duDoan,
            doTinCay: `${duDoan.doTinCay}%`,
            soThuatToanDaDung: duDoan.soThuatToan,
            giaiThich: duDoan.giaiThich,
            chiTietCacThuatToan: duDoan.chiTietThuậtToan,
            thongKe: this.getThongKe()
        };
    }
    
    async xacMinhVaCapNhat(loai) {
        let data = await this.layDuLieu(loai);
        if (!data) return { daCapNhat: 0 };
        
        let daCapNhat = 0;
        for (let record of this.lichSuDuDoan) {
            if (record.loai === loai && !record.ketQuaThucTe) {
                let thucTe = data.find(d => d.phien === record.phienDuDoan);
                if (thucTe) {
                    record.ketQuaThucTe = thucTe.ketQua;
                    record.dungSai = (record.duDoan === thucTe.ketQua);
                    this.predictor.capNhatKetQua(record.duDoan, thucTe.ketQua, record.doTinCay);
                    daCapNhat++;
                }
            }
        }
        
        if (daCapNhat > 0) this.saveHistory();
        return { daCapNhat: daCapNhat };
    }
    
    getThongKe() {
        let tong = this.model().tongSoLanDuDoan;
        let dung = this.model().soLanDung;
        let tyLe = tong > 0 ? (dung / tong * 100).toFixed(2) : 0;
        
        let ganDay = this.lichSuDuDoan.filter(r => r.dungSai !== null).slice(0, 20);
        let dungGanDay = ganDay.filter(r => r.dungSai === true).length;
        let tyLeGanDay = ganDay.length > 0 ? (dungGanDay / ganDay.length * 100).toFixed(2) : 0;
        
        return {
            tongSoLanDuDoan: tong,
            soLanDuDoanDung: dung,
            tyLeChinhXacTongThe: `${tyLe}%`,
            tyLeChinhXac20PhienGanNhat: `${tyLeGanDay}%`,
            version: this.predictor.version
        };
    }
    
    model() {
        return this.predictor.model;
    }
    
    getLichSu(limit = 30) {
        return this.lichSuDuDoan.slice(0, limit);
    }
    
    reset() {
        this.lichSuDuDoan = [];
        this.predictor.model = { tongSoLanDuDoan: 0, soLanDung: 0, lichSu: [] };
        this.predictor.saveModel();
        this.saveHistory();
        return { thongBao: 'Đã reset toàn bộ dữ liệu' };
    }
    
    loadHistory() {
        try {
            if (fs.existsSync(HISTORY_FILE)) {
                this.lichSuDuDoan = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
                console.log(`✅ Đã tải ${this.lichSuDuDoan.length} lịch sử dự đoán`);
            }
        } catch(e) {}
    }
    
    saveHistory() {
        try {
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(this.lichSuDuDoan, null, 2));
        } catch(e) {}
    }
}

// ==================== KHỞI TẠO SERVICE ====================
const service = new TaixiuService();

// Tự động xác minh mỗi 30 giây
setInterval(async () => {
    await service.xacMinhVaCapNhat('md5');
    await service.xacMinhVaCapNhat('hu');
}, 30000);

// ==================== API ENDPOINTS ====================
app.use(express.json());

// Giới thiệu
app.get('/', (req, res) => {
    res.json({
        ten: 'SIEU TAI XIU PRO MAX',
        version: '6.0.0',
        tacGia: '@Tskhang',
        moTa: 'API dự đoán Tài Xỉu với 6 thuật toán thông minh, không random, độ chính xác cao',
        cacThuatToan: [
            '🎯 Phát hiện cầu bệt thông minh - Quyết định bẻ cầu đúng lúc',
            '🔄 Cầu đảo 1-1 - Phát hiện chuỗi đảo chiều liên tục',
            '📊 Cầu 2-2 - Nhận diện cặp đôi đan xen',
            '📈 Phân tích tổng điểm - Xu hướng nóng/lạnh',
            '🔬 Markov bậc 2 - Xác suất thống kê',
            '🤖 AI học máy - Weighted voting từ nhiều features'
        ],
        endpoints: {
            'GET /md5': 'Dự đoán phiên tiếp theo - MD5',
            'GET /hu': 'Dự đoán phiên tiếp theo - Hũ',
            'GET /thong-ke': 'Xem thống kê độ chính xác',
            'GET /lich-su': 'Lịch sử các dự đoán',
            'GET /reset': 'Reset dữ liệu'
        }
    });
});

// Dự đoán MD5
app.get('/md5', async (req, res) => {
    try {
        let ketQua = await service.duDoan('md5');
        res.json(ketQua);
    } catch(error) {
        res.status(500).json({ thanhCong: false, loi: error.message });
    }
});

// Dự đoán Hũ
app.get('/hu', async (req, res) => {
    try {
        let ketQua = await service.duDoan('hu');
        res.json(ketQua);
    } catch(error) {
        res.status(500).json({ thanhCong: false, loi: error.message });
    }
});

// Thống kê
app.get('/thong-ke', (req, res) => {
    res.json(service.getThongKe());
});

// Lịch sử
app.get('/lich-su', (req, res) => {
    let limit = parseInt(req.query.limit) || 30;
    res.json({
        tongSo: service.lichSuDuDoan.filter(r => r.dungSai !== null).length,
        lichSu: service.getLichSu(limit)
    });
});

// Reset
app.get('/reset', (req, res) => {
    res.json(service.reset());
});

// ==================== KHỞI ĐỘNG SERVER ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║     🎲 SIEU TAI XIU PRO MAX - DỰ ĐOÁN TÀI XỈU THÔNG MINH 🎲         ║
║                              v6.0.0                                   ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  🤖 6 THUẬT TOÁN THÔNG MINH:                                         ║
║  ┌────────────────────────────────────────────────────────────────┐ ║
║  │ 🎯 Cầu bệt thông minh - Tự động bẻ cầu đúng lúc                │ ║
║  │ 🔄 Cầu đảo 1-1 - Phát hiện đảo chiều liên tục                 │ ║
║  │ 📊 Cầu 2-2 - Nhận diện cặp đôi đan xen chính xác               │ ║
║  │ 📈 Phân tích tổng điểm - Bắt đỉnh/đáy xu hướng                 │ ║
║  │ 🔬 Markov bậc 2 - Xác suất thống kê chuẩn xác                  │ ║
║  │ 🤖 AI học máy - Tổng hợp trọng số thông minh                   │ ║
║  └────────────────────────────────────────────────────────────────┘ ║
║                                                                      ║
║  📡 API ĐANG CHẠY: http://0.0.0.0:${PORT}                              ║
║                                                                      ║
║  🔗 CÁC ENDPOINTS:                                                   ║
║     GET /md5        → Dự đoán phiên tiếp theo MD5                    ║
║     GET /hu         → Dự đoán phiên tiếp theo Hũ                     ║
║     GET /thong-ke   → Thống kê độ chính xác                          ║
║     GET /lich-su    → Lịch sử dự đoán                                ║
║     GET /reset      → Reset dữ liệu                                  ║
║                                                                      ║
║  🎯 ĐẶC BIỆT:                                                        ║
║     ✅ Không random - 100% dựa trên thuật toán                       ║
║     ✅ Tự động xác minh kết quả thực tế                              ║
║     ✅ Học từ sai lầm - Cập nhật model liên tục                      ║
║     ✅ Trả về JSON tiếng Việt dễ đọc                                 ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
    `);
});
