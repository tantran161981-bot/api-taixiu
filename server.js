// server.js - TAI XIU PRO BALANCE V7.0
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
const MODEL_FILE = path.join(DATA_DIR, 'balance_model.json');
const HISTORY_FILE = path.join(DATA_DIR, 'balance_history.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// ==================== THUẬT TOÁN CÂN BẰNG - THEO CẦU ====================

class TaiXiuBalancePredictor {
    constructor() {
        this.version = '7.0.0';
        this.name = 'Tai Xiu Pro Balance';
        this.thongKeCau = {
            betTai: 0, betXiu: 0,
            dao11: 0, dao22: 0, dao33: 0,
            tyLeTrungBinh: 0.5
        };
        this.loadModel();
    }

    // 1. PHÂN TÍCH CẦU BỆT - THEO CẦU, KHÔNG BẺ
    phanTichCauBet(results) {
        if (results.length < 2) return null;
        
        let doDaiBet = 1;
        let loaiBet = results[0];
        
        for (let i = 1; i < results.length; i++) {
            if (results[i] === loaiBet) doDaiBet++;
            else break;
        }
        
        if (doDaiBet >= 2) {
            // THEO CẦU - không bẻ
            let doTinCay = 65 + Math.min(25, doDaiBet * 3);
            let mucDoManh = doDaiBet >= 5 ? 'Rất mạnh' : (doDaiBet >= 3 ? 'Mạnh' : 'Trung bình');
            
            return {
                duDoan: loaiBet,
                doTinCay: Math.min(92, doTinCay),
                tenThuatToan: `📈 Cầu bệt ${loaiBet}`,
                moTa: `Phát hiện cầu ${loaiBet} kéo dài ${doDaiBet} phiên (${mucDoManh}), tiếp tục theo cầu`,
                chiTiet: {
                    loaiCau: 'Bệt',
                    huong: loaiBet,
                    doDai: doDaiBet,
                }
            };
        }
        return null;
    }

    // 2. PHÂN TÍCH CẦU ĐẢO 1-1
    phanTichCauDao11(results) {
        if (results.length < 4) return null;
        
        let doDaiDao = 1;
        for (let i = 1; i < Math.min(results.length, 12); i++) {
            if (results[i] !== results[i-1]) doDaiDao++;
            else break;
        }
        
        if (doDaiDao >= 3) {
            let duDoan = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
            let doTinCay = 68 + Math.min(20, doDaiDao * 2);
            
            return {
                duDoan: duDoan,
                doTinCay: Math.min(88, doTinCay),
                tenThuatToan: `🔄 Cầu đảo 1-1`,
                moTa: `Cầu đang đảo chiều liên tục ${doDaiDao} phiên, dự đoán ${duDoan} tiếp theo`,
                chiTiet: {
                    loaiCau: 'Đảo 1-1',
                    doDai: doDaiDao,
                    quyLuat: `${doDaiDao} phiên đan xen`
                }
            };
        }
        return null;
    }

    // 3. PHÂN TÍCH CẦU 2-2
    phanTichCau22(results) {
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
                let doTinCay = 70 + cacCap.length * 3;
                
                return {
                    duDoan: duDoan,
                    doTinCay: Math.min(86, doTinCay),
                    tenThuatToan: `📊 Cầu 2-2`,
                    moTa: `Cầu 2-2 với ${cacCap.length} cặp đan xen, dự đoán ${duDoan}`,
                    chiTiet: {
                        loaiCau: '2-2',
                        soCap: cacCap.length,
                        cacCap: cacCap
                    }
                };
            }
        }
        return null;
    }

    // 4. PHÂN TÍCH CẦU 3-3
    phanTichCau33(results) {
        if (results.length < 9) return null;
        
        let cacBoBa = [];
        for (let i = 0; i < results.length - 2; i += 3) {
            if (results[i] === results[i+1] && results[i+1] === results[i+2]) {
                cacBoBa.push(results[i]);
            } else break;
        }
        
        if (cacBoBa.length >= 1) {
            let boBaCuoi = cacBoBa[cacBoBa.length - 1];
            let duDoan = boBaCuoi;
            let doTinCay = 72 + cacBoBa.length * 4;
            
            // Nếu có 2 bộ ba trở lên thì đan xen
            if (cacBoBa.length >= 2 && cacBoBa[0] !== cacBoBa[1]) {
                duDoan = boBaCuoi === 'Tài' ? 'Xỉu' : 'Tài';
                doTinCay = 78;
            }
            
            return {
                duDoan: duDoan,
                doTinCay: Math.min(90, doTinCay),
                tenThuatToan: `🎯 Cầu 3-3`,
                moTa: `Phát hiện ${cacBoBa.length} bộ ba, dự đoán ${duDoan}`,
                chiTiet: {
                    loaiCau: '3-3',
                    soBoBa: cacBoBa.length,
                    cacBoBa: cacBoBa
                }
            };
        }
        return null;
    }

    // 5. PHÂN TÍCH XU HƯỚNG TỔNG ĐIỂM
    phanTichXuHuongTong(sums) {
        if (sums.length < 10) return null;
        
        let tong10Phien = sums.slice(0, 10);
        let trungBinh = tong10Phien.reduce((a,b) => a+b, 0) / 10;
        let tongHienTai = sums[0];
        
        // Đếm số lần Tài/Xỉu trong 10 phiên
        let soLanTai = 0, soLanXiu = 0;
        for (let i = 0; i < tong10Phien.length; i++) {
            if (tong10Phien[i] >= 11) soLanTai++;
            else soLanXiu++;
        }
        
        // Tính xu hướng tổng điểm gần đây
        let xuHuong = 0;
        for (let i = 1; i <= 5; i++) {
            xuHuong += (sums[i-1] - sums[i]);
        }
        
        let duDoan = null;
        let doTinCay = 0;
        let lyDo = '';
        
        // Theo xu hướng tổng điểm
        if (Math.abs(xuHuong) > 3) {
            if (xuHuong > 0) {
                // Tổng đang tăng -> có xu hướng về Tài
                duDoan = 'Tài';
                doTinCay = 68;
                lyDo = `Tổng điểm đang tăng dần (${xuHuong.toFixed(1)} điểm)`;
            } else {
                // Tổng đang giảm -> có xu hướng về Xỉu
                duDoan = 'Xỉu';
                doTinCay = 68;
                lyDo = `Tổng điểm đang giảm dần (${Math.abs(xuHuong).toFixed(1)} điểm)`;
            }
        }
        
        // Hoặc theo tỷ lệ Tài/Xỉu
        else if (soLanTai >= 7) {
            duDoan = 'Tài';
            doTinCay = 72;
            lyDo = `${soLanTai}/10 phiên gần nhất là Tài, xu hướng mạnh`;
        }
        else if (soLanXiu >= 7) {
            duDoan = 'Xỉu';
            doTinCay = 72;
            lyDo = `${soLanXiu}/10 phiên gần nhất là Xỉu, xu hướng mạnh`;
        }
        
        if (duDoan) {
            return {
                duDoan: duDoan,
                doTinCay: doTinCay,
                tenThuatToan: `📊 Phân tích xu hướng`,
                moTa: lyDo,
                chiTiet: {
                    trungBinhTong: trungBinh.toFixed(1),
                    xuHuongTong: xuHuong.toFixed(1),
                    tyLeTai10Phien: `${soLanTai}/10`,
                    tyLeXiu10Phien: `${soLanXiu}/10`
                }
            };
        }
        return null;
    }

    // 6. THUẬT TOÁN MARKOV BẬC 1 (Cân bằng)
    markovBac1(results) {
        if (results.length < 20) return null;
        
        // Đếm tần suất chuyển tiếp
        let tt = 0, tx = 0, xt = 0, xx = 0;
        
        for (let i = 0; i < results.length - 1; i++) {
            if (results[i] === 'Tài' && results[i+1] === 'Tài') tt++;
            else if (results[i] === 'Tài' && results[i+1] === 'Xỉu') tx++;
            else if (results[i] === 'Xỉu' && results[i+1] === 'Tài') xt++;
            else if (results[i] === 'Xỉu' && results[i+1] === 'Xỉu') xx++;
        }
        
        let tong = tt + tx + xt + xx;
        if (tong === 0) return null;
        
        let ketQuaHienTai = results[0];
        let xacSuatTai, xacSuatXiu;
        
        if (ketQuaHienTai === 'Tài') {
            xacSuatTai = tt / (tt + tx);
            xacSuatXiu = tx / (tt + tx);
        } else {
            xacSuatTai = xt / (xt + xx);
            xacSuatXiu = xx / (xt + xx);
        }
        
        // Chỉ dự đoán khi xác suất đủ lớn (> 55%)
        if (xacSuatTai > 0.55) {
            return {
                duDoan: 'Tài',
                doTinCay: 60 + xacSuatTai * 20,
                tenThuatToan: `🎲 Markov bậc 1`,
                moTa: `Xác suất ${xacSuatTai.toFixed(2)}% Tài sau ${ketQuaHienTai}`,
                chiTiet: {
                    trangThaiHienTai: ketQuaHienTai,
                    xacSuatTai: (xacSuatTai * 100).toFixed(1) + '%',
                    xacSuatXiu: (xacSuatXiu * 100).toFixed(1) + '%'
                }
            };
        }
        
        if (xacSuatXiu > 0.55) {
            return {
                duDoan: 'Xỉu',
                doTinCay: 60 + xacSuatXiu * 20,
                tenThuatToan: `🎲 Markov bậc 1`,
                moTa: `Xác suất ${xacSuatXiu.toFixed(2)}% Xỉu sau ${ketQuaHienTai}`,
                chiTiet: {
                    trangThaiHienTai: ketQuaHienTai,
                    xacSuatTai: (xacSuatTai * 100).toFixed(1) + '%',
                    xacSuatXiu: (xacSuatXiu * 100).toFixed(1) + '%'
                }
            };
        }
        
        return null;
    }

    // 7. THỐNG KÊ TẦN SUẤT ĐƠN GIẢN
    thongKeTanSuat(results) {
        if (results.length < 15) return null;
        
        let taiCount = 0, xiuCount = 0;
        for (let i = 0; i < Math.min(20, results.length); i++) {
            if (results[i] === 'Tài') taiCount++;
            else xiuCount++;
        }
        
        let tyLeTai = taiCount / (taiCount + xiuCount);
        let tyLeXiu = xiuCount / (taiCount + xiuCount);
        
        // Chỉ dự đoán khi có sự chênh lệch rõ ràng
        if (tyLeTai > 0.6) {
            return {
                duDoan: 'Tài',
                doTinCay: 65 + (tyLeTai - 0.5) * 40,
                tenThuatToan: `📊 Thống kê tần suất`,
                moTa: `${taiCount}/${taiCount + xiuCount} phiên gần nhất là Tài (${(tyLeTai*100).toFixed(0)}%)`,
                chiTiet: {
                    soPhienPhanTich: taiCount + xiuCount,
                    soLanTai: taiCount,
                    soLanXiu: xiuCount,
                    tyLeTai: (tyLeTai * 100).toFixed(1) + '%',
                    tyLeXiu: (tyLeXiu * 100).toFixed(1) + '%'
                }
            };
        }
        
        if (tyLeXiu > 0.6) {
            return {
                duDoan: 'Xỉu',
                doTinCay: 65 + (tyLeXiu - 0.5) * 40,
                tenThuatToan: `📊 Thống kê tần suất`,
                moTa: `${xiuCount}/${taiCount + xiuCount} phiên gần nhất là Xỉu (${(tyLeXiu*100).toFixed(0)}%)`,
                chiTiet: {
                    soPhienPhanTich: taiCount + xiuCount,
                    soLanTai: taiCount,
                    soLanXiu: xiuCount,
                    tyLeTai: (tyLeTai * 100).toFixed(1) + '%',
                    tyLeXiu: (tyLeXiu * 100).toFixed(1) + '%'
                }
            };
        }
        
        return null;
    }

    // 8. TỔNG HỢP CÁC THUẬT TOÁN (ENSEMBLE CÂN BẰNG)
    tongHopKetQua(results, sums) {
        let cacDuDoan = [];
        
        let thuatToans = [
            this.phanTichCauBet.bind(this),
            this.phanTichCauDao11.bind(this),
            this.phanTichCau22.bind(this),
            this.phanTichCau33.bind(this),
            this.phanTichXuHuongTong.bind(this),
            this.markovBac1.bind(this),
            this.thongKeTanSuat.bind(this)
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
            // Fallback: dựa trên phiên gần nhất
            let phienGanNhat = results[0];
            return {
                duDoan: phienGanNhat,
                doTinCay: 55,
                soThuatToan: 0,
                giaiThich: `Không đủ dữ liệu, dự đoán theo phiên gần nhất`,
                chiTietThuậtToan: []
            };
        }
        
        // Bỏ phiếu có trọng số (cân bằng)
        let diemTai = 0, diemXiu = 0, tongTrongSo = 0;
        
        for (let dd of cacDuDoan) {
            let trongSo = dd.doTinCay / 100;
            if (dd.duDoan === 'Tài') diemTai += trongSo;
            else diemXiu += trongSo;
            tongTrongSo += trongSo;
        }
        
        let ketQuaCuoi = diemTai >= diemXiu ? 'Tài' : 'Xỉu';
        let doTinCayCuoi = (Math.max(diemTai, diemXiu) / tongTrongSo) * 100;
        doTinCayCuoi = Math.min(94, Math.max(58, Math.round(doTinCayCuoi)));
        
        // Thống kê số lượng thuật toán dự đoán mỗi bên
        let soThuatToanTai = cacDuDoan.filter(d => d.duDoan === 'Tài').length;
        let soThuatToanXiu = cacDuDoan.filter(d => d.duDoan === 'Xỉu').length;
        
        return {
            duDoan: ketQuaCuoi,
            doTinCay: doTinCayCuoi,
            soThuatToan: cacDuDoan.length,
            soThuatToanTai: soThuatToanTai,
            soThuatToanXiu: soThuatToanXiu,
            giaiThich: `Tổng hợp ${cacDuDoan.length} thuật toán: ${soThuatToanTai} thuật toán chọn Tài, ${soThuatToanXiu} thuật toán chọn Xỉu`,
            chiTietThuậtToan: cacDuDoan.map(tt => ({
                ten: tt.tenThuatToan,
                duDoan: tt.duDoan,
                doTinCay: tt.doTinCay,
                moTa: tt.moTa,
                chiTiet: tt.chiTiet || null
            }))
        };
    }

    // Load/save model
    loadModel() {
        try {
            if (fs.existsSync(MODEL_FILE)) {
                this.model = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8'));
                console.log('✅ Đã tải model cân bằng thành công');
            } else {
                this.model = {
                    tongSoLanDuDoan: 0,
                    soLanDung: 0,
                    soLanTai: 0,
                    soLanXiu: 0,
                    lichSu: []
                };
            }
        } catch(e) {
            this.model = { tongSoLanDuDoan: 0, soLanDung: 0, soLanTai: 0, soLanXiu: 0, lichSu: [] };
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
        if (duDoan === 'Tài') this.model.soLanTai++;
        else this.model.soLanXiu++;
        
        this.model.lichSu.unshift({
            thoiGian: new Date().toISOString(),
            duDoan: duDoan,
            thucTe: thucTe,
            ketQua: dung ? 'Đúng ✅' : 'Sai ❌',
            doTinCay: doTinCay
        });
        
        if (this.model.lichSu.length > 200) this.model.lichSu.pop();
        this.saveModel();
        
        return dung;
    }
}

// ==================== API SERVICE ====================

class TaiXiuService {
    constructor() {
        this.predictor = new TaiXiuBalancePredictor();
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
                success: false,
                message: 'Không thể lấy dữ liệu từ API nguồn',
                id: '@Tskhang'
            };
        }
        
        let phienHienTai = data[0].phien;
        let phienDuDoan = phienHienTai + 1;
        
        let results = data.map(d => d.ketQua);
        let sums = data.map(d => d.tong);
        
        let duDoan = this.predictor.tongHopKetQua(results, sums);
        
        // Lấy 10 phiên gần nhất để hiển thị
        let lichSu10Phien = data.slice(0, 10).map(d => ({
            phien: d.phien,
            ketQua: d.ketQua,
            tong: d.tong
        }));
        
        let record = {
            thoiGian: new Date().toISOString(),
            loai: loai,
            phienHienTai: phienHienTai,
            phienDuDoan: phienDuDoan,
            duDoan: duDoan.duDoan,
            doTinCay: duDoan.doTinCay,
            ketQuaThucTe: null,
            dungSai: null
        };
        
        this.lichSuDuDoan.unshift(record);
        if (this.lichSuDuDoan.length > 200) this.lichSuDuDoan.pop();
        this.saveHistory();
        
        // Trả về JSON đẹp
        return {
            status: 'success',
            id: '@Tskhang',
            timestamp: new Date().toISOString(),
            predictor: {
                name: 'Tai Xiu Pro Balance v7.0',
                version: '7.0.0',
                type: 'Theo cầu - Không bẻ cầu chủ quan'
            },
            current: {
                phien: phienHienTai,
                ketQua: data[0].ketQua,
                tongDiem: data[0].tong,
                xucSac: data[0].xucSac.join(' - ')
            },
            prediction: {
                phien: phienDuDoan,
                ketQua: duDoan.duDoan,
                doTinCay: `${duDoan.doTinCay}%`,
                mucDo: duDoan.doTinCay >= 80 ? 'Cao' : (duDoan.doTinCay >= 65 ? 'Trung bình' : 'Thấp')
            },
            analysis: {
                soThuatToanDaDung: duDoan.soThuatToan,
                bieuQuyet: {
                    tai: duDoan.soThuatToanTai || 0,
                    xiu: duDoan.soThuatToanXiu || 0
                },
                giaiThich: duDoan.giaiThich,
                chiTietThuatToan: duDoan.chiTietThuậtToan
            },
            history: {
                last10Sessions: lichSu10Phien,
                thongKe: this.getThongKe()
            }
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
        let tong = this.predictor.model.tongSoLanDuDoan;
        let dung = this.predictor.model.soLanDung;
        let tyLe = tong > 0 ? (dung / tong * 100).toFixed(2) : 0;
        
        let ganDay = this.lichSuDuDoan.filter(r => r.dungSai !== null).slice(0, 30);
        let dungGanDay = ganDay.filter(r => r.dungSai === true).length;
        let tyLeGanDay = ganDay.length > 0 ? (dungGanDay / ganDay.length * 100).toFixed(2) : 0;
        
        return {
            tongSoLanDuDoan: tong,
            soLanDuDoanDung: dung,
            tiLeChinhXacTongThe: `${tyLe}%`,
            tiLeChinhXac30PhienGanNhat: `${tyLeGanDay}%`,
            soLanDuDoanTai: this.predictor.model.soLanTai || 0,
            soLanDuDoanXiu: this.predictor.model.soLanXiu || 0,
            version: this.predictor.version
        };
    }
    
    getLichSu(limit = 30) {
        return this.lichSuDuDoan.slice(0, limit);
    }
    
    reset() {
        this.lichSuDuDoan = [];
        this.predictor.model = { tongSoLanDuDoan: 0, soLanDung: 0, soLanTai: 0, soLanXiu: 0, lichSu: [] };
        this.predictor.saveModel();
        this.saveHistory();
        return { message: 'Đã reset toàn bộ dữ liệu', id: '@Tskhang' };
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
const service = new TaiXiuService();

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
        name: 'TAI XIU PRO BALANCE',
        version: '7.0.0',
        author: '@Tskhang',
        description: 'API dự đoán Tài Xỉu - Theo cầu chuẩn, không bẻ cầu chủ quan',
        algorithms: [
            '📈 Cầu bệt - Theo cầu đến khi gãy',
            '🔄 Cầu đảo 1-1 - Đảo chiều liên tục',
            '📊 Cầu 2-2 - Cặp đôi đan xen',
            '🎯 Cầu 3-3 - Bộ ba liên tiếp',
            '📊 Phân tích xu hướng tổng điểm',
            '🎲 Markov bậc 1 - Xác suất chuyển tiếp',
            '📊 Thống kê tần suất đơn giản'
        ],
        endpoints: {
            'GET /md5': 'Dự đoán phiên tiếp theo - MD5',
            'GET /hu': 'Dự đoán phiên tiếp theo - Hũ',
            'GET /stats': 'Thống kê độ chính xác',
            'GET /history': 'Lịch sử dự đoán',
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
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Dự đoán Hũ
app.get('/hu', async (req, res) => {
    try {
        let ketQua = await service.duDoan('hu');
        res.json(ketQua);
    } catch(error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Thống kê
app.get('/stats', (req, res) => {
    res.json({
        status: 'success',
        id: '@Tskhang',
        ...service.getThongKe()
    });
});

// Lịch sử
app.get('/history', (req, res) => {
    let limit = parseInt(req.query.limit) || 30;
    res.json({
        status: 'success',
        id: '@Tskhang',
        total: service.lichSuDuDoan.filter(r => r.dungSai !== null).length,
        history: service.getLichSu(limit)
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
║     🎲 TAI XIU PRO BALANCE - DỰ ĐOÁN TÀI XỈU CHUẨN XÁC 🎲           ║
║                              v7.0.0                                   ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  🤖 THUẬT TOÁN CÂN BẰNG - THEO CẦU CHUẨN:                            ║
║  ┌────────────────────────────────────────────────────────────────┐ ║
║  │ 📈 Cầu bệt        → Theo cầu, KHÔNG bẻ chủ quan                │ ║
║  │ 🔄 Cầu đảo 1-1    → Đảo chiều liên tục, dự đoán chính xác      │ ║
║  │ 📊 Cầu 2-2        → Phát hiện cặp đôi đan xen                  │ ║
║  │ 🎯 Cầu 3-3        → Bộ ba liên tiếp, dự đoán chuẩn             │ ║
║  │ 📊 Xu hướng tổng  → Phân tích biến động tổng điểm              │ ║
║  │ 🎲 Markov bậc 1   → Xác suất thống kê chuyển tiếp              │ ║
║  │ 📊 Tần suất       → Thống kê đơn giản, dễ hiểu                 │ ║
║  └────────────────────────────────────────────────────────────────┘ ║
║                                                                      ║
║  ✅ ĐẶC BIỆT:                                                        ║
║     • KHÔNG BẺ CẦU CHỦ QUAN - Theo cầu tự nhiên                     ║
║     • CÂN BẰNG GIỮA TÀI VÀ XỈU - Không lệch về bên nào              ║
║     • JSON TRẢ VỀ ĐẸP - Rõ ràng, dễ đọc, tiếng Việt                 ║
║     • TỰ ĐỘNG XÁC MINH - Cập nhật kết quả thực tế                   ║
║                                                                      ║
║  📡 API ĐANG CHẠY: http://0.0.0.0:${PORT}                              ║
║                                                                      ║
║  🔗 ENDPOINTS:                                                       ║
║     GET /md5      → Dự đoán phiên tiếp theo MD5                      ║
║     GET /hu       → Dự đoán phiên tiếp theo Hũ                       ║
║     GET /stats    → Thống kê độ chính xác                            ║
║     GET /history  → Lịch sử dự đoán                                  ║
║     GET /reset    → Reset dữ liệu                                    ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
    `);
});
