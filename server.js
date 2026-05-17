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
    stats: { total: 0, win: 0, loss: 0 }
};

// ==================== THUẬT TOÁN TÀI XỈU THÔNG MINH ====================
class SmartTaiXiuPredictor {
    constructor() {
        this.nguongManh = 75; // Trên 75% là "NÊN ĐÁNH"
        this.nguongTrungBinh = 55; // 55-75% là "THAM KHẢO"
    }

    // Phân tích cầu bệt
    phanTichBet(lichSu) {
        const ketQua = lichSu.map(p => p.ket_qua);
        let doDai = 1;
        for (let i = 1; i < ketQua.length && i < 15; i++) {
            if (ketQua[i] === ketQua[0]) doDai++;
            else break;
        }
        
        if (doDai >= 8) {
            return { co: true, huong: ketQua[0], doDai, khuyenNghi: 'bẻ', doTinCay: 92 };
        }
        if (doDai >= 5) {
            return { co: true, huong: ketQua[0], doDai, khuyenNghi: 'bẻ', doTinCay: 82 };
        }
        if (doDai >= 3) {
            return { co: true, huong: ketQua[0], doDai, khuyenNghi: 'theo', doTinCay: 68 };
        }
        return { co: false };
    }

    // Phân tích cầu 1-1
    phanTichCau11(lichSu) {
        const ketQua = lichSu.map(p => p.ket_qua);
        if (ketQua.length < 4) return { co: false };
        
        let la11 = true;
        for (let i = 1; i < 4; i++) {
            if (ketQua[i] === ketQua[i-1]) {
                la11 = false;
                break;
            }
        }
        
        if (la11) {
            const duDoan = ketQua[0] === 'Tài' ? 'Xỉu' : 'Tài';
            return { co: true, duDoan, doTinCay: 78, loai: '1-1' };
        }
        return { co: false };
    }

    // Phân tích cầu 2-2
    phanTichCau22(lichSu) {
        const ketQua = lichSu.map(p => p.ket_qua);
        if (ketQua.length < 4) return { co: false };
        
        if (ketQua[0] === ketQua[1] && ketQua[2] === ketQua[3] && ketQua[0] !== ketQua[2]) {
            const duDoan = ketQua[2] === 'Tài' ? 'Xỉu' : 'Tài';
            return { co: true, duDoan, doTinCay: 75, loai: '2-2' };
        }
        return { co: false };
    }

    // Phân tích cầu 1-2-1
    phanTichCau121(lichSu) {
        const ketQua = lichSu.map(p => p.ket_qua);
        if (ketQua.length < 4) return { co: false };
        
        if (ketQua[0] !== ketQua[1] && ketQua[1] === ketQua[2] && ketQua[2] !== ketQua[3]) {
            const duDoan = ketQua[0];
            return { co: true, duDoan, doTinCay: 72, loai: '1-2-1' };
        }
        return { co: false };
    }

    // Phân tích cầu 2-1-2
    phanTichCau212(lichSu) {
        const ketQua = lichSu.map(p => p.ket_qua);
        if (ketQua.length < 5) return { co: false };
        
        if (ketQua[0] === ketQua[1] && ketQua[1] !== ketQua[2] && 
            ketQua[2] !== ketQua[3] && ketQua[3] === ketQua[4]) {
            const duDoan = ketQua[4] === 'Tài' ? 'Xỉu' : 'Tài';
            return { co: true, duDoan, doTinCay: 73, loai: '2-1-2' };
        }
        return { co: false };
    }

    // Phân tích pattern 3T hoặc 3X
    phanTichPattern3(lichSu) {
        const ketQua = lichSu.map(p => p.ket_qua);
        if (ketQua.length < 3) return { co: false };
        
        if (ketQua[0] === 'Tài' && ketQua[1] === 'Tài' && ketQua[2] === 'Tài') {
            return { co: true, duDoan: 'Xỉu', doTinCay: 70, loai: '3T' };
        }
        if (ketQua[0] === 'Xỉu' && ketQua[1] === 'Xỉu' && ketQua[2] === 'Xỉu') {
            return { co: true, duDoan: 'Tài', doTinCay: 70, loai: '3X' };
        }
        return { co: false };
    }

    // Phân tích xu hướng điểm
    phanTichDiemSo(lichSu) {
        if (lichSu.length < 5) return { co: false };
        
        const diemSo = lichSu.slice(0, 5).map(p => p.d1 + p.d2 + p.d3);
        let tang = 0, giam = 0;
        
        for (let i = 0; i < 4; i++) {
            if (diemSo[i] > diemSo[i+1]) giam++;
            else if (diemSo[i] < diemSo[i+1]) tang++;
        }
        
        const avgDiem = diemSo.reduce((a,b) => a+b, 0) / 5;
        
        if (tang >= 3 && avgDiem > 11) {
            return { co: true, duDoan: 'Tài', doTinCay: 65, loai: 'diem_tang' };
        }
        if (giam >= 3 && avgDiem < 10) {
            return { co: true, duDoan: 'Xỉu', doTinCay: 65, loai: 'diem_giam' };
        }
        return { co: false };
    }

    // Phân tích tần suất
    phanTichTanSuat(lichSu, last_n = 20) {
        const ketQua = lichSu.slice(0, Math.min(last_n, lichSu.length)).map(p => p.ket_qua);
        const taiCount = ketQua.filter(k => k === 'Tài').length;
        const xiuCount = ketQua.length - taiCount;
        
        if (taiCount > xiuCount + 5) {
            return { co: true, duDoan: 'Xỉu', doTinCay: 65, loai: 'tan_suat' };
        }
        if (xiuCount > taiCount + 5) {
            return { co: true, duDoan: 'Tài', doTinCay: 65, loai: 'tan_suat' };
        }
        return { co: false };
    }

    // Dự đoán chính
    duDoan(lichSu) {
        if (lichSu.length < 5) {
            return {
                du_doan: "Tài",
                do_tin_cay: 50,
                khuyen_nghi: "THAM KHẢO",
                ly_do: "Chưa đủ dữ liệu (cần 5 phiên)",
                chi_tiet: {}
            };
        }

        // Lấy tất cả các phân tích
        const cacPhanTich = [
            this.phanTichBet(lichSu),
            this.phanTichCau11(lichSu),
            this.phanTichCau22(lichSu),
            this.phanTichCau121(lichSu),
            this.phanTichCau212(lichSu),
            this.phanTichPattern3(lichSu),
            this.phanTichDiemSo(lichSu),
            this.phanTichTanSuat(lichSu)
        ];

        // Lọc các phân tích có tín hiệu
        const tinHieu = cacPhanTich.filter(p => p.co === true);
        
        // Nếu không có tín hiệu nào, dùng xu hướng 3 phiên gần nhất
        if (tinHieu.length === 0) {
            const last3 = lichSu.slice(0, 3).map(p => p.ket_qua);
            const taiCount = last3.filter(k => k === 'Tài').length;
            const duDoan = taiCount >= 2 ? 'Tài' : 'Xỉu';
            return {
                du_doan: duDoan,
                do_tin_cay: 52,
                khuyen_nghi: "THAM KHẢO",
                ly_do: "Không có tín hiệu rõ ràng, theo xu hướng 3 phiên",
                chi_tiet: { xu_huong_3_phien: last3 }
            };
        }

        // Tổng hợp điểm cho Tài và Xỉu
        let diemTai = 0, diemXiu = 0;
        let cacDuDoan = [];
        
        for (const th of tinHieu) {
            if (th.khuyenNghi === 'theo') {
                if (th.huong === 'Tài') diemTai += th.doTinCay;
                else diemXiu += th.doTinCay;
                cacDuDoan.push(`${th.loai || 'bet'}: theo ${th.huong} (${th.doTinCay}%)`);
            }
            else if (th.khuyenNghi === 'bẻ') {
                const duDoanBe = th.huong === 'Tài' ? 'Xỉu' : 'Tài';
                if (duDoanBe === 'Tài') diemTai += th.doTinCay;
                else diemXiu += th.doTinCay;
                cacDuDoan.push(`${th.loai || 'bet'}: bẻ ${th.huong} -> ${duDoanBe} (${th.doTinCay}%)`);
            }
            else {
                if (th.duDoan === 'Tài') diemTai += th.doTinCay;
                else diemXiu += th.doTinCay;
                cacDuDoan.push(`${th.loai}: ${th.duDoan} (${th.doTinCay}%)`);
            }
        }

        // Tính tổng điểm và độ tin cậy
        const tongDiem = diemTai + diemXiu;
        let duDoan = diemTai > diemXiu ? 'Tài' : 'Xỉu';
        let doTinCay = tongDiem > 0 ? Math.max(diemTai, diemXiu) / tongDiem * 100 : 50;
        
        // Điều chỉnh độ tin cậy
        doTinCay = Math.min(96, Math.max(50, Math.round(doTinCay)));
        
        // Xác định khuyến nghị
        let khuyenNghi = "THAM KHẢO";
        if (doTinCay >= 75 && tinHieu.length >= 2) {
            khuyenNghi = "NÊN ĐÁNH ✅";
        } else if (doTinCay >= 70) {
            khuyenNghi = "CÓ THỂ ĐÁNH";
        } else if (doTinCay <= 55) {
            khuyenNghi = "THAM KHẢO ⚠️";
        }

        return {
            du_doan: duDoan,
            do_tin_cay: doTinCay,
            khuyen_nghi: khuyenNghi,
            ly_do: cacDuDoan.join('; ') || "Phân tích tổng hợp",
            chi_tiet: {
                so_tin_hieu: tinHieu.length,
                diem_tai: Math.round(diemTai),
                diem_xiu: Math.round(diemXiu)
            }
        };
    }
}

const predictor = new SmartTaiXiuPredictor();

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
        const duDoan = predictor.duDoan(APP_STATE.history);
        APP_STATE.lastPrediction = {
            phien: nextId,
            ketqua: duDoan.du_doan,
            do_tin_cay: duDoan.do_tin_cay + '%',
            khuyen_nghi: duDoan.khuyen_nghi,
            ly_do: duDoan.ly_do,
            chi_tiet: duDoan.chi_tiet
        };
    }
    
    const pred = APP_STATE.lastPrediction;
    const winRate = APP_STATE.stats.total > 0 ? (APP_STATE.stats.win / APP_STATE.stats.total * 100).toFixed(2) : "0";
    
    res.json({
        "phien_truoc": last?.session || 0,
        "ketqua_truoc": last?.ket_qua || "",
        "xuc_xac": last?.dice || [0, 0, 0],
        "tong_diem": last?.tong || 0,
        "phien_sau": nextId,
        "du_doan": pred.ketqua,
        "do_tin_cay": pred.do_tin_cay,
        "khuyen_nghi": pred.khuyen_nghi,
        "ly_do": pred.ly_do,
        "chi_tiet": pred.chi_tiet,
        "thong_ke": {
            "thang": APP_STATE.stats.win,
            "thua": APP_STATE.stats.loss,
            "tong": APP_STATE.stats.total,
            "winrate": winRate + "%"
        }
    });
});

app.get('/stats', (req, res) => {
    const winRate = APP_STATE.stats.total > 0 ? (APP_STATE.stats.win / APP_STATE.stats.total * 100).toFixed(2) : 0;
    res.json({
        tong_phien: APP_STATE.stats.total,
        thang: APP_STATE.stats.win,
        thua: APP_STATE.stats.loss,
        winrate: winRate + "%",
        note: "🚀 'NÊN ĐÁNH' = tín hiệu mạnh, 'THAM KHẢO' = tín hiệu yếu"
    });
});

app.get('/reset', (req, res) => {
    APP_STATE.stats = { total: 0, win: 0, loss: 0 };
    APP_STATE.lastPrediction = null;
    res.json({ message: "Reset thống kê thành công!" });
});

app.listen(PORT, () => {
    console.log(`\n╔══════════════════════════════════════════════════╗`);
    console.log(`║   🎲 SMART TÀI XỈU PREDICTOR 🎲               ║`);
    console.log(`║   Luôn có dự đoán + Khuyến nghị               ║`);
    console.log(`║   ✅ NÊN ĐÁNH | ⚠️ THAM KHẢO                  ║`);
    console.log(`╚══════════════════════════════════════════════════╝\n`);
    console.log(`📡 API: http://localhost:${PORT}`);
    console.log(`📊 STATS: http://localhost:${PORT}/stats\n`);
    syncData();
});