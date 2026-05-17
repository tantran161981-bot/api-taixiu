const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8000;
app.use(cors());
app.use(express.json());

// ==================== CẤU HÌNH ====================
const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

let APP_STATE = {
    history: [],
    lastPrediction: null,
    stats: { total: 0, win: 0, loss: 0 }
};

// ==================== THUẬT TOÁN TÀI XỈU - ĐA TẦNG LINH HOẠT ====================
class ThuatToanTaiXiu {
    constructor() {
        this.tenThuatToan = "DA_TANG_LINH_HOAT_V1";
        this.lichSuDuDoan = [];
        this.trongSoThuatToan = {
            batBet: { trongSo: 1.5, hieuSuat: 0.5, soLanSuDung: 0 },
            beBet: { trongSo: 1.3, hieuSuat: 0.5, soLanSuDung: 0 },
            giongPhienTruoc: { trongSo: 1.0, hieuSuat: 0.5, soLanSuDung: 0 },
            xenKeMacDinh: { trongSo: 1.2, hieuSuat: 0.5, soLanSuDung: 0 }
        };
        this.cauHinhBeBet = {
            doNhayThap: 6,
            doNhayTrungBinh: 8,
            doNhayCao: 10,
            doNhaySieuCao: 12
        };
    }

    duDoan(lichSu) {
        if (!lichSu || lichSu.length < 5) {
            return this.duDoanKhongDuLieu();
        }

        // PHÂN TÍCH ĐA TẦNG - KHÔNG MÂU THUẪN
        const phanTich = {
            nhanDienCau: this.AI_TranBinh_NhanDien(lichSu),
            bet: this.AI_BatBet(lichSu),
            coSo: this.duDoanCoSo(lichSu)
        };

        // TẠO CÁC PHƯƠNG ÁN DỰ ĐOÁN LINH HOẠT
        const cacPhuongAn = this.taoPhuongAnLinhHoat(phanTich, lichSu);
        
        // CHỌN PHƯƠNG ÁN TỐT NHẤT
        const phuongAnTotNhat = this.chonPhuongAnTotNhat(cacPhuongAn);
        
        // CẬP NHẬT THỐNG KÊ
        this.capNhatTrongSo(phuongAnTotNhat.loai);

        return {
            du_doan: phuongAnTotNhat.duDoan,
            pattern: phuongAnTotNhat.pattern,
            do_tin_cay: phuongAnTotNhat.doTinCay,
            thong_tin_cau: phanTich.nhanDienCau
        };
    }

    AI_TranBinh_NhanDien(lichSu) {
        const lichSuGan = lichSu.slice(0, 8);
        const ketQua = lichSuGan.map(p => p.ket_qua);
        const diemSo = lichSuGan.map(p => p.d1 + p.d2 + p.d3);

        const nhanDien = {
            loaiCau: "chua_ro",
            doOndinh: this.tinhDoOndinh(ketQua),
            doManhCuaBet: 0,
            patternPhatHien: []
        };

        if (this.kiemTraPattern1_1(ketQua)) {
            nhanDien.patternPhatHien.push("1_1");
            nhanDien.loaiCau = "xen_ke_1_1";
        }
        if (this.kiemTraPattern2_2(ketQua)) {
            nhanDien.patternPhatHien.push("2_2");
            nhanDien.loaiCau = "xen_ke_2_2";
        }
        if (this.kiemTraPattern1_2_1(ketQua)) {
            nhanDien.patternPhatHien.push("1_2_1");
            nhanDien.loaiCau = "xen_ke_1_2_1";
        }
        if (this.kiemTraPattern2_1_2(ketQua)) {
            nhanDien.patternPhatHien.push("2_1_2");
            nhanDien.loaiCau = "xen_ke_2_1_2";
        }

        const betAnalysis = this.AI_BatBet(lichSu);
        if (betAnalysis.coBet) {
            nhanDien.doManhCuaBet = betAnalysis.doManh;
            nhanDien.loaiCau = `bet_${betAnalysis.huong.toLowerCase()}`;
        }

        nhanDien.xuHuongDiem = this.nhanDienXuHuongDiem(diemSo);
        return nhanDien;
    }

    AI_BatBet(lichSu) {
        const lichSuGan = lichSu.slice(0, 15);
        let doDai = 1;
        let ketQuaDau = lichSuGan[0].ket_qua;
        
        for (let i = 1; i < lichSuGan.length; i++) {
            if (lichSuGan[i].ket_qua === ketQuaDau) {
                doDai++;
            } else {
                break;
            }
        }

        if (doDai >= 2) {
            const diemTrungBinh = this.tinhDiemTrungBinhBet(lichSuGan, doDai);
            const doManh = this.tinhDoManhBet(doDai, diemTrungBinh, ketQuaDau);
            
            return {
                coBet: true,
                huong: ketQuaDau,
                doDai: doDai,
                doManh: doManh,
                diemTrungBinh: diemTrungBinh
            };
        }
        return { coBet: false };
    }

    taoPhuongAnLinhHoat(phanTich, lichSu) {
        const cacPhuongAn = [];
        const { nhanDienCau, bet, coSo } = phanTich;

        if (bet.coBet) {
            cacPhuongAn.push({
                duDoan: bet.huong,
                diem: this.tinhDiemBatBet(bet),
                loai: 'batBet',
                pattern: `bat_bet_${bet.doDai}`,
                doTinCay: bet.doManh
            });

            if (this.AI_BeBet_LinhHoat(bet, nhanDienCau)) {
                cacPhuongAn.push({
                    duDoan: bet.huong === "Tài" ? "Xỉu" : "Tài",
                    diem: this.tinhDiemBeBet(bet, nhanDienCau),
                    loai: 'beBet',
                    pattern: `be_bet_${bet.doDai}`,
                    doTinCay: 0.7
                });
            }
        }

        const phuongAnTheoCau = this.taoPhuongAnTheoLoaiCau(nhanDienCau, lichSu);
        if (phuongAnTheoCau) cacPhuongAn.push(phuongAnTheoCau);

        cacPhuongAn.push({
            duDoan: coSo.duDoan,
            diem: this.tinhDiemCoSo(coSo),
            loai: 'giongPhienTruoc',
            pattern: 'giong_phien_truoc',
            doTinCay: 0.6
        });

        return cacPhuongAn;
    }

    AI_BeBet_LinhHoat(betAnalysis, nhanDienCau) {
        const { doDai, doManh, huong } = betAnalysis;
        let nguongBeBet = this.cauHinhBeBet.doNhayTrungBinh;

        if (doManh < 0.6) nguongBeBet = this.cauHinhBeBet.doNhayThap;
        else if (doManh > 0.8) nguongBeBet = this.cauHinhBeBet.doNhayCao;
        else if (doManh > 0.9) nguongBeBet = this.cauHinhBeBet.doNhaySieuCao;

        if (nhanDienCau.loaiCau.includes('xen_ke')) nguongBeBet -= 1;

        if (nhanDienCau.xuHuongDiem === 'dang_giam' && huong === "Tài") return true;
        if (nhanDienCau.xuHuongDiem === 'dang_tang' && huong === "Xỉu") return true;

        return doDai >= nguongBeBet;
    }

    taoPhuongAnTheoLoaiCau(nhanDienCau, lichSu) {
        const ketQuaGanNhat = lichSu[0].ket_qua;

        switch(nhanDienCau.loaiCau) {
            case 'xen_ke_1_1':
                return {
                    duDoan: ketQuaGanNhat === "Tài" ? "Xỉu" : "Tài",
                    diem: 75,
                    loai: 'xenKeMacDinh',
                    pattern: 'xen_ke_1_1',
                    doTinCay: 0.8
                };
            case 'xen_ke_2_2':
                return {
                    duDoan: ketQuaGanNhat === "Tài" ? "Xỉu" : "Tài",
                    diem: 70,
                    loai: 'xenKeMacDinh',
                    pattern: 'xen_ke_2_2',
                    doTinCay: 0.75
                };
            case 'xen_ke_1_2_1':
                return {
                    duDoan: "Tài",
                    diem: 65,
                    loai: 'xenKeMacDinh',
                    pattern: 'xen_ke_1_2_1',
                    doTinCay: 0.7
                };
            case 'xen_ke_2_1_2':
                return {
                    duDoan: "Xỉu",
                    diem: 65,
                    loai: 'xenKeMacDinh',
                    pattern: 'xen_ke_2_1_2',
                    doTinCay: 0.7
                };
            default:
                return null;
        }
    }

    // CÁC PHƯƠNG THỨC HỖ TRỢ
    tinhDoOndinh(ketQua) {
        if (ketQua.length < 3) return 0.5;
        let thayDoi = 0;
        for (let i = 1; i < ketQua.length; i++) {
            if (ketQua[i] !== ketQua[i-1]) thayDoi++;
        }
        const tyLeThayDoi = thayDoi / (ketQua.length - 1);
        return 1 - Math.abs(tyLeThayDoi - 0.5);
    }

    nhanDienXuHuongDiem(diemSo) {
        if (diemSo.length < 3) return 'khong_ro';
        let tang = 0, giam = 0;
        for (let i = 0; i < diemSo.length - 1; i++) {
            if (diemSo[i] < diemSo[i + 1]) tang++;
            else if (diemSo[i] > diemSo[i + 1]) giam++;
        }
        if (tang >= diemSo.length - 2) return 'dang_tang';
        if (giam >= diemSo.length - 2) return 'dang_giam';
        return 'on_dinh';
    }

    kiemTraPattern1_1(ketQua) {
        if (ketQua.length < 4) return false;
        for (let i = 0; i < ketQua.length - 1; i++) {
            if (ketQua[i] === ketQua[i + 1]) return false;
        }
        return true;
    }

    kiemTraPattern2_2(ketQua) {
        if (ketQua.length < 4) return false;
        for (let i = 0; i < ketQua.length - 2; i += 2) {
            if (i + 1 < ketQua.length && ketQua[i] !== ketQua[i + 1]) return false;
            if (i + 3 < ketQua.length && ketQua[i + 2] !== ketQua[i + 3]) return false;
        }
        return true;
    }

    kiemTraPattern1_2_1(ketQua) {
        if (ketQua.length < 4) return false;
        return ketQua[0] !== ketQua[1] && ketQua[1] === ketQua[2] && ketQua[2] !== ketQua[3];
    }

    kiemTraPattern2_1_2(ketQua) {
        if (ketQua.length < 5) return false;
        return ketQua[0] === ketQua[1] && ketQua[1] !== ketQua[2] && ketQua[2] !== ketQua[3] && ketQua[3] === ketQua[4];
    }

    tinhDiemBatBet(betAnalysis) {
        return betAnalysis.doManh * 80 * this.trongSoThuatToan.batBet.trongSo;
    }

    tinhDiemBeBet(betAnalysis, nhanDienCau) {
        let baseScore = 70;
        if (nhanDienCau.xuHuongDiem !== 'khong_ro') baseScore *= 1.1;
        return baseScore * this.trongSoThuatToan.beBet.trongSo;
    }

    tinhDiemCoSo(coSoAnalysis) {
        return 60 * this.trongSoThuatToan.giongPhienTruoc.trongSo;
    }

    duDoanCoSo(lichSu) {
        return { duDoan: lichSu[0].ket_qua };
    }

    chonPhuongAnTotNhat(cacPhuongAn) {
        cacPhuongAn.sort((a, b) => b.diem - a.diem);
        return cacPhuongAn[0];
    }

    capNhatTrongSo(loaiThuatToan) {
        if (this.trongSoThuatToan[loaiThuatToan]) {
            this.trongSoThuatToan[loaiThuatToan].soLanSuDung++;
            this.canBangTrongSo();
        }
    }

    canBangTrongSo() {
        const tongTrongSo = Object.values(this.trongSoThuatToan).reduce((sum, tt) => sum + tt.trongSo, 0);
        const trungBinh = tongTrongSo / Object.keys(this.trongSoThuatToan).length;
        
        Object.keys(this.trongSoThuatToan).forEach(loai => {
            const tt = this.trongSoThuatToan[loai];
            if (tt.trongSo > trungBinh * 1.3) tt.trongSo *= 0.95;
            else if (tt.trongSo < trungBinh * 0.7) tt.trongSo *= 1.05;
        });
    }

    duDoanKhongDuLieu() {
        return {
            du_doan: Math.random() > 0.5 ? "Tài" : "Xỉu",
            pattern: "khong_du_du_lieu",
            do_tin_cay: 0.1
        };
    }

    capNhatDanhGia(phien, ketQuaThucTe) {
        for (let i = 0; i < this.lichSuDuDoan.length; i++) {
            if (this.lichSuDuDoan[i].danhGia === "chờ_kết_quả") {
                const dung = this.lichSuDuDoan[i].du_doan === ketQuaThucTe;
                this.lichSuDuDoan[i].danhGia = dung ? "đúng" : "sai";
                
                if (this.lichSuDuDoan[i].pattern) {
                    const loai = this.xacDinhLoaiThuatToan(this.lichSuDuDoan[i].pattern);
                    if (this.trongSoThuatToan[loai]) {
                        const tt = this.trongSoThuatToan[loai];
                        if (dung) {
                            tt.hieuSuat = (tt.hieuSuat * tt.soLanSuDung + 1) / (tt.soLanSuDung + 1);
                        } else {
                            tt.hieuSuat = (tt.hieuSuat * tt.soLanSuDung) / (tt.soLanSuDung + 1);
                        }
                    }
                }
                break;
            }
        }
    }

    xacDinhLoaiThuatToan(pattern) {
        if (pattern.includes('bat_bet')) return 'batBet';
        if (pattern.includes('be_bet')) return 'beBet';
        if (pattern.includes('xen_ke')) return 'xenKeMacDinh';
        return 'giongPhienTruoc';
    }

    tinhDiemTrungBinhBet(lichSu, doDai) {
        const diemSo = lichSu.slice(0, doDai).map(p => (p.d1 + p.d2 + p.d3) || 0);
        return diemSo.reduce((sum, d) => sum + d, 0) / doDai;
    }

    tinhDoManhBet(doDai, diemTrungBinh, huong) {
        let doManh = 0.5 + (doDai - 2) * 0.1;
        if (huong === "Tài" && diemTrungBinh > 13) doManh += 0.2;
        if (huong === "Xỉu" && diemTrungBinh < 8) doManh += 0.2;
        if (huong === "Tài" && diemTrungBinh < 11) doManh -= 0.1;
        if (huong === "Xỉu" && diemTrungBinh > 10) doManh -= 0.1;
        return Math.min(0.95, Math.max(0.3, doManh));
    }
}

const thuatToan = new ThuatToanTaiXiu();

// ==================== ĐỒNG BỌ DỮ LIỆU ====================
async function syncData() {
    try {
        const res = await fetch(API_URL);
        const data = await res.json();
        
        if (data?.list) {
            const newHistory = data.list.map(item => ({
                session: Number(item.id),
                ket_qua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
                d1: item.dices[0],
                d2: item.dices[1],
                d3: item.dices[2],
                dice: item.dices
            })).reverse();
            
            const latest = newHistory[newHistory.length - 1];
            
            if (APP_STATE.lastPrediction && APP_STATE.lastPrediction.phien === latest.session) {
                APP_STATE.stats.total++;
                if (APP_STATE.lastPrediction.ketqua === latest.ket_qua) {
                    APP_STATE.stats.win++;
                    thuatToan.capNhatDanhGia(latest.session, latest.ket_qua);
                    console.log(`✅ THẮNG ${latest.session}: ${APP_STATE.lastPrediction.ketqua}`);
                } else {
                    APP_STATE.stats.loss++;
                    thuatToan.capNhatDanhGia(latest.session, latest.ket_qua);
                    console.log(`❌ THUA ${latest.session}: ${APP_STATE.lastPrediction.ketqua} vs ${latest.ket_qua}`);
                }
                const wr = (APP_STATE.stats.win / APP_STATE.stats.total * 100).toFixed(2);
                console.log(`📊 WINRATE: ${wr}% (${APP_STATE.stats.win}/${APP_STATE.stats.total})`);
                APP_STATE.lastPrediction = null;
            }
            
            APP_STATE.history = newHistory;
        }
    } catch (e) {
        console.error("Lỗi sync:", e.message);
    }
}

setInterval(syncData, 5000);

// ==================== API ====================
app.get('/', async (req, res) => {
    await syncData();
    
    const last = APP_STATE.history[APP_STATE.history.length - 1];
    const nextId = last ? last.session + 1 : 1;
    
    if (!APP_STATE.lastPrediction || APP_STATE.lastPrediction.phien !== nextId) {
        const prediction = thuatToan.duDoan(APP_STATE.history);
        APP_STATE.lastPrediction = {
            phien: nextId,
            ketqua: prediction.du_doan,
            do_tin_cay: Math.round(prediction.do_tin_cay * 100) + '%',
            pattern: prediction.pattern,
            thong_tin_cau: prediction.thong_tin_cau
        };
        
        thuatToan.lichSuDuDoan.push({
            phien: nextId,
            du_doan: prediction.du_doan,
            pattern: prediction.pattern,
            danhGia: "chờ_kết_quả",
            thoiGian: new Date().toISOString()
        });
    }
    
    const pred = APP_STATE.lastPrediction;
    const winRate = APP_STATE.stats.total > 0 ? (APP_STATE.stats.win / APP_STATE.stats.total * 100).toFixed(2) : "0";
    
    res.json({
        "phien_truoc": last?.session || 0,
        "ketqua_truoc": last?.ket_qua || "",
        "xuc_xac": last?.dice || [0, 0, 0],
        "phien_sau": nextId,
        "du_doan": pred.ketqua,
        "do_tin_cay": pred.do_tin_cay,
        "pattern": pred.pattern,
        "thong_tin_cau": {
            "loai_cau": pred.thong_tin_cau?.loaiCau || "chua_ro",
            "do_manh_bet": pred.thong_tin_cau?.doManhCuaBet || 0
        },
        "thong_ke": {
            "thang": APP_STATE.stats.win,
            "thua": APP_STATE.stats.loss,
            "tong": APP_STATE.stats.total,
            "winrate": winRate + "%"
        }
    });
});

app.get('/stats', (req, res) => {
    res.json({
        thuat_toan: "DA_TANG_LINH_HOAT_V1",
        trong_so: thuatToan.trongSoThuatToan,
        tong_phien: APP_STATE.stats.total,
        winrate: APP_STATE.stats.total > 0 ? (APP_STATE.stats.win / APP_STATE.stats.total * 100).toFixed(2) + '%' : '0%'
    });
});

app.get('/history', (req, res) => {
    res.json({
        lich_su_du_doan: thuatToan.lichSuDuDoan.slice(-30),
        ket_qua_thuc_te: APP_STATE.history.slice(0, 30)
    });
});

app.get('/reset', (req, res) => {
    APP_STATE.stats = { total: 0, win: 0, loss: 0 };
    thuatToan.lichSuDuDoan = [];
    res.json({ message: "Reset thành công" });
});

app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`🎲 THUẬT TOÁN TÀI XỈU - ĐA TẦNG LINH HOẠT`);
    console.log(`📊 Bắt bệt | Bẻ bệt | Xen kẽ | Tự học`);
    console.log(`🔄 Cập nhật mỗi 5 giây`);
    console.log(`========================================\n`);
    syncData();
});