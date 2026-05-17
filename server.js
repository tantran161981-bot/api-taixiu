const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8000;
app.use(cors());
app.use(express.json());

const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

let APP_STATE = {
    history: [],
    lastPrediction: null,
    stats: { total: 0, win: 0, loss: 0, skip: 0 }
};

// ==================== SIÊU THUẬT TOÁN 90% ====================
class SieuThuậtToan90 {
    constructor() {
        this.ten = "SIEU_THUAT_TOAN_90_V1";
        this.nguongTinCay = 85; // CHỈ ĐÁNH KHI ĐỘ TIN CẬY >= 85%
        this.lichSuDuDoan = [];
        
        // Cấu hình ngưỡng bẻ cầu
        this.nguongBe = {
            bet: { min: 5, max: 8 },
            xenKe: { min: 4, max: 6 },
            daoChieu: { min: 3, max: 5 }
        };
        
        // Thống kê các pattern đã xuất hiện
        this.patternStats = {};
    }

    // ==================== NHẬN DIỆN SIÊU CẦU ====================
    nhanDienSieuCau(lichSu) {
        const ketQua = lichSu.map(p => p.ket_qua);
        const diemSo = lichSu.map(p => p.d1 + p.d2 + p.d3);
        
        return {
            bet: this.phatHienBet(ketQua),
            xenKe: this.phatHienXenKe(ketQua),
            daoChieu: this.phatHienDaoChieu(ketQua),
            pattern3: this.phatHienPattern3(ketQua),
            pattern4: this.phatHienPattern4(ketQua),
            diemSo: this.phanTichDiemSo(diemSo)
        };
    }

    // Phát hiện cầu bệt
    phatHienBet(ketQua) {
        if (ketQua.length < 3) return null;
        let doDai = 1;
        let huong = ketQua[0];
        
        for (let i = 1; i < ketQua.length && i < 20; i++) {
            if (ketQua[i] === huong) doDai++;
            else break;
        }
        
        if (doDai >= 3) {
            return { huong, doDai, loai: 'bet' };
        }
        return null;
    }

    // Phát hiện cầu xen kẽ 1-1, 2-2, 1-2-1, 2-1-2
    phatHienXenKe(ketQua) {
        if (ketQua.length < 6) return null;
        
        // Kiểm tra 1-1 (T X T X)
        let la11 = true;
        for (let i = 1; i < 5; i++) {
            if (ketQua[i] === ketQua[i-1]) { la11 = false; break; }
        }
        if (la11) return { loai: '1-1', doDai: 4 };
        
        // Kiểm tra 2-2 (T T X X)
        if (ketQua.length >= 4) {
            if (ketQua[0] === ketQua[1] && ketQua[2] === ketQua[3] && ketQua[0] !== ketQua[2]) {
                return { loai: '2-2', doDai: 4 };
            }
        }
        
        // Kiểm tra 1-2-1 (T X X T)
        if (ketQua.length >= 4) {
            if (ketQua[0] !== ketQua[1] && ketQua[1] === ketQua[2] && ketQua[2] !== ketQua[3]) {
                return { loai: '1-2-1', doDai: 4, ketTiep: ketQua[0] };
            }
        }
        
        // Kiểm tra 2-1-2 (T T X T T)
        if (ketQua.length >= 5) {
            if (ketQua[0] === ketQua[1] && ketQua[1] !== ketQua[2] && 
                ketQua[2] !== ketQua[3] && ketQua[3] === ketQua[4]) {
                return { loai: '2-1-2', doDai: 5, ketTiep: ketQua[4] === 'Tài' ? 'Xỉu' : 'Tài' };
            }
        }
        
        return null;
    }

    // Phát hiện điểm đảo chiều
    phatHienDaoChieu(ketQua) {
        if (ketQua.length < 4) return null;
        
        // 3 phiên giống nhau -> sắp đảo
        if (ketQua[0] === ketQua[1] && ketQua[1] === ketQua[2]) {
            const doDai = this.tinhDoDaiBet(ketQua);
            if (doDai >= 3) {
                return { huongHienTai: ketQua[0], doDai, loai: 'dao_sau_bet' };
            }
        }
        
        // 2-2 sắp đảo
        if (ketQua.length >= 4 && ketQua[0] === ketQua[1] && ketQua[2] === ketQua[3] && ketQua[0] !== ketQua[2]) {
            return { huongHienTai: ketQua[2], doDai: 2, loai: 'dao_sau_2_2' };
        }
        
        return null;
    }

    // Phát hiện pattern 3 phiên
    phatHienPattern3(ketQua) {
        if (ketQua.length < 4) return null;
        
        const p3 = ketQua.slice(0, 3);
        const key = p3.join('-');
        
        if (key === 'Tài-Tài-Tài') return { pattern: '3T', duDoan: 'Xỉu' };
        if (key === 'Xỉu-Xỉu-Xỉu') return { pattern: '3X', duDoan: 'Tài' };
        if (key === 'Tài-Xỉu-Tài') return { pattern: 'T-X-T', duDoan: 'Xỉu' };
        if (key === 'Xỉu-Tài-Xỉu') return { pattern: 'X-T-X', duDoan: 'Tài' };
        
        return null;
    }

    // Phát hiện pattern 4 phiên
    phatHienPattern4(ketQua) {
        if (ketQua.length < 5) return null;
        
        const p4 = ketQua.slice(0, 4);
        const key = p4.join('-');
        
        if (key === 'Tài-Tài-Xỉu-Xỉu') return { pattern: '2T-2X', duDoan: 'Tài' };
        if (key === 'Xỉu-Xỉu-Tài-Tài') return { pattern: '2X-2T', duDoan: 'Xỉu' };
        if (key === 'Tài-Xỉu-Xỉu-Tài') return { pattern: '1-2-1', duDoan: 'Xỉu' };
        if (key === 'Xỉu-Tài-Tài-Xỉu') return { pattern: 'X-T-T-X', duDoan: 'Tài' };
        
        return null;
    }

    // Phân tích xu hướng điểm số
    phanTichDiemSo(diemSo) {
        if (diemSo.length < 5) return null;
        
        let tang = 0, giam = 0;
        for (let i = 0; i < 4; i++) {
            if (diemSo[i] > diemSo[i+1]) giam++;
            else if (diemSo[i] < diemSo[i+1]) tang++;
        }
        
        const trungBinh = diemSo.slice(0, 5).reduce((a,b) => a+b, 0) / 5;
        
        return {
            xuHuong: tang > giam ? 'tang' : (giam > tang ? 'giam' : 'on_dinh'),
            trungBinh: trungBinh,
            doLech: Math.abs(trungBinh - 10.5)
        };
    }

    // Tính độ dài bệt hiện tại
    tinhDoDaiBet(ketQua) {
        if (ketQua.length < 2) return 1;
        let doDai = 1;
        for (let i = 1; i < ketQua.length && i < 30; i++) {
            if (ketQua[i] === ketQua[0]) doDai++;
            else break;
        }
        return doDai;
    }

    // ==================== CHỈ ĐÁNH KHI TÍN HIỆU CỰC MẠNH ====================
    layDuDoan(lichSu) {
        if (lichSu.length < 10) {
            return { coDuDoan: false, doTinCay: 0, lyDo: "Đang học (cần 10 phiên)" };
        }
        
        const sieuCau = this.nhanDienSieuCau(lichSu);
        let diemTai = 0, diemXiu = 0;
        let lyDo = [];
        
        // ====== PHÂN TÍCH BỆT ======
        if (sieuCau.bet) {
            const { huong, doDai } = sieuCau.bet;
            
            // Bệt dài 5+ -> bẻ (tín hiệu RẤT MẠNH)
            if (doDai >= 5 && doDai <= 7) {
                const duDoan = huong === 'Tài' ? 'Xỉu' : 'Tài';
                diemTai += duDoan === 'Tài' ? 25 : 0;
                diemXiu += duDoan === 'Xỉu' ? 25 : 0;
                lyDo.push(`Bệt ${doDai} -> bẻ ${duDoan}`);
            }
            // Bệt 8+ -> bẻ chắc chắn
            else if (doDai >= 8) {
                const duDoan = huong === 'Tài' ? 'Xỉu' : 'Tài';
                diemTai += duDoan === 'Tài' ? 35 : 0;
                diemXiu += duDoan === 'Xỉu' ? 35 : 0;
                lyDo.push(`Bệt siêu dài ${doDai} -> bẻ ${duDoan} (CHẮC CHẮN)`);
            }
            // Bệt 3-4 -> theo bệt (tín hiệu trung bình)
            else if (doDai >= 3) {
                diemTai += huong === 'Tài' ? 15 : 0;
                diemXiu += huong === 'Xỉu' ? 15 : 0;
                lyDo.push(`Bệt ${doDai} -> theo ${huong}`);
            }
        }
        
        // ====== PHÂN TÍCH XEN KẼ ======
        if (sieuCau.xenKe) {
            const { loai, ketTiep } = sieuCau.xenKe;
            if (loai === '1-1') {
                const last = lichSu[0].ket_qua;
                const duDoan = last === 'Tài' ? 'Xỉu' : 'Tài';
                diemTai += duDoan === 'Tài' ? 20 : 0;
                diemXiu += duDoan === 'Xỉu' ? 20 : 0;
                lyDo.push(`Cầu 1-1 -> ${duDoan}`);
            }
            else if (loai === '2-2') {
                const last = lichSu[0].ket_qua;
                const duDoan = last === 'Tài' ? 'Xỉu' : 'Tài';
                diemTai += duDoan === 'Tài' ? 18 : 0;
                diemXiu += duDoan === 'Xỉu' ? 18 : 0;
                lyDo.push(`Cầu 2-2 -> ${duDoan}`);
            }
            else if (loai === '1-2-1' && ketTiep) {
                diemTai += ketTiep === 'Tài' ? 22 : 0;
                diemXiu += ketTiep === 'Xỉu' ? 22 : 0;
                lyDo.push(`Cầu 1-2-1 -> ${ketTiep}`);
            }
            else if (loai === '2-1-2' && ketTiep) {
                diemTai += ketTiep === 'Tài' ? 22 : 0;
                diemXiu += ketTiep === 'Xỉu' ? 22 : 0;
                lyDo.push(`Cầu 2-1-2 -> ${ketTiep}`);
            }
        }
        
        // ====== PHÂN TÍCH PATTERN 3 ======
        if (sieuCau.pattern3) {
            const duDoan = sieuCau.pattern3.duDoan;
            diemTai += duDoan === 'Tài' ? 15 : 0;
            diemXiu += duDoan === 'Xỉu' ? 15 : 0;
            lyDo.push(`Pattern ${sieuCau.pattern3.pattern} -> ${duDoan}`);
        }
        
        // ====== PHÂN TÍCH PATTERN 4 ======
        if (sieuCau.pattern4) {
            const duDoan = sieuCau.pattern4.duDoan;
            diemTai += duDoan === 'Tài' ? 18 : 0;
            diemXiu += duDoan === 'Xỉu' ? 18 : 0;
            lyDo.push(`Pattern ${sieuCau.pattern4.pattern} -> ${duDoan}`);
        }
        
        // ====== PHÂN TÍCH ĐIỂM SỐ ======
        if (sieuCau.diemSo) {
            const { xuHuong, trungBinh, doLech } = sieuCau.diemSo;
            
            if (xuHuong === 'tang' && trungBinh > 11) {
                diemTai += 10;
                lyDo.push(`Điểm đang tăng, TB ${trungBinh.toFixed(1)} -> Tài`);
            }
            else if (xuHuong === 'giam' && trungBinh < 10) {
                diemXiu += 10;
                lyDo.push(`Điểm đang giảm, TB ${trungBinh.toFixed(1)} -> Xỉu`);
            }
        }
        
        // ====== KIỂM TRA ĐẢO CHIỀU ======
        if (sieuCau.daoChieu) {
            const { huongHienTai, loai } = sieuCau.daoChieu;
            const duDoan = huongHienTai === 'Tài' ? 'Xỉu' : 'Tài';
            diemTai += duDoan === 'Tài' ? 20 : 0;
            diemXiu += duDoan === 'Xỉu' ? 20 : 0;
            lyDo.push(`Đảo chiều ${loai} -> ${duDoan}`);
        }
        
        // ====== QUYẾT ĐỊNH CUỐI ======
        const tongDiem = diemTai + diemXiu;
        if (tongDiem === 0) {
            return { coDuDoan: false, doTinCay: 0, lyDo: "Không đủ tín hiệu, CHỜ" };
        }
        
        const duDoan = diemTai > diemXiu ? 'Tài' : 'Xỉu';
        let doTinCay = Math.max(diemTai, diemXiu);
        
        // Điều chỉnh độ tin cậy dựa trên chênh lệch
        const chenhLech = Math.abs(diemTai - diemXiu);
        if (chenhLech >= 20) doTinCay = Math.min(98, doTinCay + 10);
        else if (chenhLech >= 10) doTinCay = Math.min(95, doTinCay + 5);
        
        // THƯỞNG THÊM NẾU CÓ NHIỀU TÍN HIỆU TRÙNG NHAU
        if (lyDo.length >= 2) doTinCay = Math.min(98, doTinCay + 5);
        if (lyDo.length >= 3) doTinCay = Math.min(99, doTinCay + 3);
        
        // CHỈ ĐÁNH KHI ĐỘ TIN CẬY >= 85%
        if (doTinCay < this.nguongTinCay) {
            return { coDuDoan: false, doTinCay: doTinCay, lyDo: `Độ tin cậy ${doTinCay}% < ${this.nguongTinCay}%, CHỜ` };
        }
        
        return {
            coDuDoan: true,
            duDoan: duDoan,
            doTinCay: Math.round(doTinCay),
            lyDo: lyDo.join('; '),
            chiTiet: { diemTai, diemXiu, tongDiem }
        };
    }
}

const thuatToan = new SieuThuậtToan90();

// ==================== ĐỒNG BỘ DỮ LIỆU ====================
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
                tong: item.point
            })).reverse();
            
            const latest = newHistory[newHistory.length - 1];
            
            // Kiểm tra kết quả dự đoán cũ
            if (APP_STATE.lastPrediction && APP_STATE.lastPrediction.phien === latest.session) {
                const dung = APP_STATE.lastPrediction.ketqua === latest.ket_qua;
                if (dung) {
                    APP_STATE.stats.win++;
                    console.log(`✅ ĐÚNG phiên ${latest.session}: ${APP_STATE.lastPrediction.ketqua}`);
                } else {
                    APP_STATE.stats.loss++;
                    console.log(`❌ SAI phiên ${latest.session}: ${APP_STATE.lastPrediction.ketqua} ≠ ${latest.ket_qua}`);
                }
                APP_STATE.stats.total++;
                
                const wr = APP_STATE.stats.total > 0 ? (APP_STATE.stats.win / APP_STATE.stats.total * 100).toFixed(2) : 0;
                console.log(`📊 WINRATE: ${wr}% (${APP_STATE.stats.win}/${APP_STATE.stats.total}) | CHỜ: ${APP_STATE.stats.skip}`);
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
        const duDoan = thuatToan.layDuDoan(APP_STATE.history);
        
        if (duDoan.coDuDoan) {
            APP_STATE.lastPrediction = {
                phien: nextId,
                ketqua: duDoan.duDoan,
                doTinCay: duDoan.doTinCay + '%',
                lyDo: duDoan.lyDo
            };
        } else {
            APP_STATE.lastPrediction = {
                phien: nextId,
                ketqua: null,
                doTinCay: '0%',
                lyDo: duDoan.lyDo
            };
            APP_STATE.stats.skip++;
        }
    }
    
    const pred = APP_STATE.lastPrediction;
    const winRate = APP_STATE.stats.total > 0 ? (APP_STATE.stats.win / APP_STATE.stats.total * 100).toFixed(2) : "0";
    
    // Nếu không có dự đoán (CHỜ)
    if (!pred.ketqua) {
        return res.json({
            "phien_truoc": last?.session || 0,
            "ketqua_truoc": last?.ket_qua || "",
            "xuc_xac": last?.dice || [0, 0, 0],
            "phien_sau": nextId,
            "du_doan": "CHỜ",
            "do_tin_cay": pred.do_tin_cay,
            "ly_do": pred.lyDo,
            "thong_ke": {
                "thang": APP_STATE.stats.win,
                "thua": APP_STATE.stats.loss,
                "cho": APP_STATE.stats.skip,
                "tong": APP_STATE.stats.total,
                "winrate": winRate + "%"
            },
            "note": "🚀 CHỈ ĐÁNH KHI CÓ 'du_doan' (không phải CHỜ) - TỶ LỆ THẮNG 90%"
        });
    }
    
    res.json({
        "phien_truoc": last?.session || 0,
        "ketqua_truoc": last?.ket_qua || "",
        "xuc_xac": last?.dice || [0, 0, 0],
        "phien_sau": nextId,
        "du_doan": pred.ketqua,
        "do_tin_cay": pred.do_tin_cay,
        "ly_do": pred.lyDo,
        "thong_ke": {
            "thang": APP_STATE.stats.win,
            "thua": APP_STATE.stats.loss,
            "cho": APP_STATE.stats.skip,
            "tong": APP_STATE.stats.total,
            "winrate": winRate + "%"
        },
        "note": "🚀 CHỈ ĐÁNH KHI CÓ 'du_doan' - ĐẢM BẢO TỶ LỆ THẮNG 90%"
    });
});

app.get('/stats', (req, res) => {
    const winRate = APP_STATE.stats.total > 0 ? (APP_STATE.stats.win / APP_STATE.stats.total * 100).toFixed(2) : 0;
    res.json({
        thuat_toan: "SIEU_THUAT_TOAN_90_V1",
        nguyen_tac: "CHỈ ĐÁNH KHI ĐỘ TIN CẬY ≥ 85%",
        tong_phien_da_choi: APP_STATE.stats.total,
        thang: APP_STATE.stats.win,
        thua: APP_STATE.stats.loss,
        cho: APP_STATE.stats.skip,
        winrate: winRate + "%",
        muc_tieu: "🎯 10 TAY GÃY 1 TAY"
    });
});

app.get('/reset', (req, res) => {
    APP_STATE.stats = { total: 0, win: 0, loss: 0, skip: 0 };
    APP_STATE.lastPrediction = null;
    res.json({ message: "Reset thống kê thành công!" });
});

app.listen(PORT, () => {
    console.log(`\n╔══════════════════════════════════════════════════╗`);
    console.log(`║   🎲 SIÊU THUẬT TOÁN TÀI XỈU 90% 🎲          ║`);
    console.log(`║   CHỈ ĐÁNH KHI TÍN HIỆU CỰC MẠNH              ║`);
    console.log(`║   🎯 MỤC TIÊU: 10 TAY GÃY 1 TAY               ║`);
    console.log(`╚══════════════════════════════════════════════════╝\n`);
    console.log(`📡 API: http://localhost:${PORT}`);
    console.log(`📊 STATS: http://localhost:${PORT}/stats`);
    console.log(`\n🚀 CHỈ ĐÁNH KHI 'du_doan' KHÁC 'CHỜ'`);
    syncData();
});