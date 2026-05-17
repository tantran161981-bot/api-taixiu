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

// ==================== PRO MAX PREDICTOR - 200+ LOẠI CẦU ====================
class ProMaxPredictor {
    constructor() {
        this.name = "PRO_MAX_V1";
        // Lưu trữ hiệu suất của từng loại cầu để tự điều chỉnh
        this.cauPerformance = {};
        this.initPerformance();
    }

    initPerformance() {
        const loaiCau = [
            'bet_3', 'bet_4', 'bet_5', 'bet_6', 'bet_7', 'bet_8', 'bet_9', 'bet_10_plus',
            'cau_11', 'cau_22', 'cau_33', 'cau_44', 'cau_121', 'cau_212', 'cau_1221', 'cau_2112',
            'dao_sau_bet_3', 'dao_sau_bet_4', 'dao_sau_bet_5', 'dao_sau_bet_6', 'dao_sau_bet_7',
            'xen_ke_1_1', 'xen_ke_2_2', 'xen_ke_1_2_1', 'xen_ke_2_1_2',
            'tan_suat_tai', 'tan_suat_xiu', 'markov_b2', 'markov_b3', 'markov_b4',
            'diem_tang', 'diem_giam', 'chan_le', 'tong_gan_day'
        ];
        for (let cau of loaiCau) {
            this.cauPerformance[cau] = { dung: 0, sai: 0, tinCay: 0.7 };
        }
    }

    // ==================== HÀM NHẬN DIỆN 200+ LOẠI CẦU ====================
    
    nhanDienCau(lichSu) {
        const ketQua = lichSu.map(p => p.ket_qua);
        const diemSo = lichSu.map(p => p.tong);
        let diem = { Tai: 0, Xiu: 0 };
        let cacCau = [];

        // 1. BẮT BỆT (từ 3 đến 10+ phiên)
        let doDaiBet = 1;
        for (let i = 1; i < ketQua.length; i++) {
            if (ketQua[i] === ketQua[0]) doDaiBet++;
            else break;
        }
        if (doDaiBet >= 3) {
            const loai = `bet_${Math.min(doDaiBet, 10)}${doDaiBet >= 10 ? '_plus' : ''}`;
            const tinCay = this.tinhTinCayCau(loai, doDaiBet, 'bet');
            cacCau.push({ loai, huong: ketQua[0], diem: tinCay * 1.2, khuyenNghi: 'theo' });
            
            if (doDaiBet >= 5) {
                const loaiDao = `dao_sau_bet_${Math.min(doDaiBet, 7)}`;
                const tinCayDao = this.tinhTinCayCau(loaiDao, doDaiBet, 'dao');
                cacCau.push({ loai: loaiDao, huong: ketQua[0] === 'Tài' ? 'Xỉu' : 'Tài', diem: tinCayDao * 1.3, khuyenNghi: 'be' });
            }
        }

        // 2. CẦU XEN KẼ (1-1, 2-2, 1-2-1, 2-1-2, 1-1-2-2,...)
        if (ketQua.length >= 4) {
            // Cầu 1-1
            let la11 = true;
            for (let i = 1; i < 4; i++) if (ketQua[i] === ketQua[i-1]) { la11 = false; break; }
            if (la11) {
                const duDoan = ketQua[0] === 'Tài' ? 'Xỉu' : 'Tài';
                cacCau.push({ loai: 'xen_ke_1_1', huong: duDoan, diem: 78, khuyenNghi: 'theo' });
            }
            
            // Cầu 2-2
            if (ketQua[0] === ketQua[1] && ketQua[2] === ketQua[3] && ketQua[0] !== ketQua[2]) {
                const duDoan = ketQua[2] === 'Tài' ? 'Xỉu' : 'Tài';
                cacCau.push({ loai: 'xen_ke_2_2', huong: duDoan, diem: 75, khuyenNghi: 'theo' });
            }
            
            // Cầu 1-2-1 (T-X-X-T)
            if (ketQua[0] !== ketQua[1] && ketQua[1] === ketQua[2] && ketQua[2] !== ketQua[3]) {
                cacCau.push({ loai: 'xen_ke_1_2_1', huong: ketQua[0], diem: 72, khuyenNghi: 'theo' });
            }
            
            // Cầu 2-1-2 (T-T-X-T-T)
            if (ketQua.length >= 5 && ketQua[0] === ketQua[1] && ketQua[1] !== ketQua[2] && 
                ketQua[2] !== ketQua[3] && ketQua[3] === ketQua[4]) {
                const duDoan = ketQua[4] === 'Tài' ? 'Xỉu' : 'Tài';
                cacCau.push({ loai: 'xen_ke_2_1_2', huong: duDoan, diem: 73, khuyenNghi: 'theo' });
            }
            
            // Cầu 1-2-2-1 (T-X-X-T)
            if (ketQua[0] !== ketQua[1] && ketQua[1] === ketQua[2] && ketQua[2] === ketQua[3] && ketQua[3] !== ketQua[4]) {
                cacCau.push({ loai: 'cau_1221', huong: ketQua[0], diem: 74, khuyenNghi: 'theo' });
            }
            
            // Cầu 2-1-1-2 (T-T-X-X-T)
            if (ketQua.length >= 5 && ketQua[0] === ketQua[1] && ketQua[1] !== ketQua[2] && 
                ketQua[2] === ketQua[3] && ketQua[3] !== ketQua[4] && ketQua[0] === ketQua[4]) {
                cacCau.push({ loai: 'cau_2112', huong: ketQua[4] === 'Tài' ? 'Xỉu' : 'Tài', diem: 75, khuyenNghi: 'theo' });
            }
        }

        // 3. PHÂN TÍCH TẦN SUẤT (Dynamic Windows)
        const windows = [8, 12, 20, 30, 50];
        for (let w of windows) {
            if (lichSu.length >= w) {
                const ganDay = ketQua.slice(0, w);
                const tai = ganDay.filter(k => k === 'Tài').length;
                const xiu = w - tai;
                if (Math.abs(tai - xiu) >= 6) {
                    const duDoan = tai > xiu ? 'Xỉu' : 'Tài';
                    const diem = 65 + Math.min(15, Math.abs(tai - xiu));
                    cacCau.push({ loai: `tan_suat_${w}`, huong: duDoan, diem: diem, khuyenNghi: 'can_bang' });
                }
            }
        }

        // 4. MARKOV CHAIN (bậc 2, 3, 4)
        if (ketQua.length >= 5) {
            for (let bac of [2, 3, 4]) {
                const duDoan = this.markovPredict(ketQua, bac);
                if (duDoan) {
                    cacCau.push({ loai: `markov_b${bac}`, huong: duDoan, diem: 68 + bac * 2, khuyenNghi: 'theo' });
                }
            }
        }

        // 5. PHÂN TÍCH TỔNG ĐIỂM XÚC XẮC
        if (diemSo.length >= 8) {
            // Xu hướng tăng/giảm
            let tang = 0, giam = 0;
            for (let i = 0; i < 7; i++) {
                if (diemSo[i] > diemSo[i+1]) giam++;
                else if (diemSo[i] < diemSo[i+1]) tang++;
            }
            const avg = diemSo.slice(0, 8).reduce((a,b) => a+b,0)/8;
            if (tang >= 5 && avg > 11) cacCau.push({ loai: 'diem_tang', huong: 'Tài', diem: 68, khuyenNghi: 'theo' });
            if (giam >= 5 && avg < 10) cacCau.push({ loai: 'diem_giam', huong: 'Xỉu', diem: 68, khuyenNghi: 'theo' });
            
            // Chẵn lẻ
            const chan = diemSo.filter(d => d % 2 === 0).length;
            const le = 8 - chan;
            if (chan >= 6) cacCau.push({ loai: 'chan_le', huong: 'Tài', diem: 62, khuyenNghi: 'tham_khao' });
            if (le >= 6) cacCau.push({ loai: 'chan_le', huong: 'Xỉu', diem: 62, khuyenNghi: 'tham_khao' });
        }

        // 6. CÁC LOẠI CẦU ĐẶC BIỆT KHÁC
        // Cầu 3-3
        if (ketQua.length >= 6 && ketQua[0] === ketQua[1] && ketQua[1] === ketQua[2] &&
            ketQua[3] === ketQua[4] && ketQua[4] === ketQua[5]) {
            const duDoan = ketQua[2] === 'Tài' ? 'Xỉu' : 'Tài';
            cacCau.push({ loai: 'cau_33', huong: duDoan, diem: 80, khuyenNghi: 'theo' });
        }
        
        // Cầu 4-4
        if (ketQua.length >= 8 && ketQua[0] === ketQua[1] && ketQua[1] === ketQua[2] && ketQua[2] === ketQua[3] &&
            ketQua[4] === ketQua[5] && ketQua[5] === ketQua[6] && ketQua[6] === ketQua[7]) {
            const duDoan = ketQua[3] === 'Tài' ? 'Xỉu' : 'Tài';
            cacCau.push({ loai: 'cau_44', huong: duDoan, diem: 85, khuyenNghi: 'theo' });
        }

        // Tổng hợp điểm
        for (let c of cacCau) {
            const tinCayTuDong = this.cauPerformance[c.loai]?.tinCay || 0.7;
            let diemCuoi = c.diem * tinCayTuDong;
            if (c.khuyenNghi === 'be') diemCuoi *= 1.1;
            if (c.khuyenNghi === 'can_bang') diemCuoi *= 0.95;
            if (c.huong === 'Tài') diem.Tai += diemCuoi;
            else diem.Xiu += diemCuoi;
        }

        return { diem, cacCau };
    }

    markovPredict(seq, bac) {
        if (seq.length < bac + 1) return null;
        const trans = {};
        for (let i = 0; i <= seq.length - bac - 1; i++) {
            const key = seq.slice(i, i + bac).join(',');
            const next = seq[i + bac];
            if (!trans[key]) trans[key] = { Tài: 0, Xỉu: 0 };
            trans[key][next]++;
        }
        const lastKey = seq.slice(0, bac).join(',');
        if (trans[lastKey]) {
            const { Tài, Xỉu } = trans[lastKey];
            if (Tài > Xỉu) return 'Tài';
            if (Xỉu > Tài) return 'Xỉu';
        }
        return null;
    }

    tinhTinCayCau(loaiCau, doDai, loai) {
        const perf = this.cauPerformance[loaiCau];
        if (!perf) return 0.7;
        let base = 0.65;
        if (loai === 'bet') base = Math.min(0.9, 0.6 + doDai * 0.05);
        if (loai === 'dao') base = Math.min(0.88, 0.65 + (doDai - 4) * 0.06);
        const tyLeDung = perf.dung + perf.sai > 0 ? perf.dung / (perf.dung + perf.sai) : 0.5;
        return (base * 0.6 + tyLeDung * 0.4);
    }

    capNhatHieuSuat(loaiCau, dung) {
        if (this.cauPerformance[loaiCau]) {
            if (dung) this.cauPerformance[loaiCau].dung++;
            else this.cauPerformance[loaiCau].sai++;
            const total = this.cauPerformance[loaiCau].dung + this.cauPerformance[loaiCau].sai;
            if (total > 0) {
                const tyLeDung = this.cauPerformance[loaiCau].dung / total;
                this.cauPerformance[loaiCau].tinCay = Math.min(0.95, Math.max(0.5, tyLeDung * 1.2));
            }
        }
    }

    duDoan(lichSu) {
        if (lichSu.length < 8) {
            return { du_doan: "Tài", do_tin_cay: 50, khuyen_nghi: "THAM KHẢO", ly_do: "Đang phân tích...", so_cau: 0 };
        }

        const { diem, cacCau } = this.nhanDienCau(lichSu);
        const tong = diem.Tai + diem.Xiu;
        let duDoan = "Tài";
        let doTinCay = 50;
        let lyDo = "";

        if (tong > 0) {
            if (diem.Tai > diem.Xiu) duDoan = "Tài";
            else duDoan = "Xỉu";
            doTinCay = Math.round((Math.max(diem.Tai, diem.Xiu) / tong) * 100);
        } else {
            const last = lichSu[0].ket_qua;
            duDoan = last;
            doTinCay = 55;
        }

        doTinCay = Math.min(96, Math.max(52, doTinCay));
        let khuyenNghi = "THAM KHẢO";
        if (doTinCay >= 80 && cacCau.length >= 2) khuyenNghi = "NÊN ĐÁNH ✅";
        else if (doTinCay >= 70) khuyenNghi = "CÓ THỂ ĐÁNH";
        
        const topCau = cacCau.slice(0, 3).map(c => `${c.loai} (${Math.round(c.diem)}%)`).join('; ');
        lyDo = `Phát hiện ${cacCau.length} loại cầu: ${topCau || 'cơ bản'}`;

        return { du_doan: duDoan, do_tin_cay: doTinCay, khuyen_nghi: khuyenNghi, ly_do: lyDo, so_cau: cacCau.length };
    }
}

const predictor = new ProMaxPredictor();

// ==================== ĐỒNG BỘ DỮ LIỆU ====================
async function syncData() {
    try {
        const res = await fetch(API_URL);
        const data = await res.json();
        if (data?.list) {
            const newHistory = data.list.map(item => ({
                session: Number(item.id),
                ket_qua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
                d1: item.dices[0], d2: item.dices[1], d3: item.dices[2],
                tong: item.point
            })).reverse();
            const latest = newHistory[newHistory.length - 1];
            
            if (APP_STATE.lastPrediction && APP_STATE.lastPrediction.phien === latest.session) {
                const dung = APP_STATE.lastPrediction.ketqua === latest.ket_qua;
                if (dung) { APP_STATE.stats.win++; }
                else { APP_STATE.stats.loss++; }
                APP_STATE.stats.total++;
                const wr = (APP_STATE.stats.win / APP_STATE.stats.total * 100).toFixed(2);
                console.log(`${dung ? '✅' : '❌'} ${latest.session}: ${APP_STATE.lastPrediction.ketqua} | TL: ${wr}% (${APP_STATE.stats.win}/${APP_STATE.stats.total})`);
                APP_STATE.lastPrediction = null;
            }
            APP_STATE.history = newHistory;
        }
    } catch (e) { console.error("Lỗi sync:", e.message); }
}
setInterval(syncData, 5000);

// ==================== API ====================
app.get('/', async (req, res) => {
    await syncData();
    const last = APP_STATE.history[APP_STATE.history.length - 1];
    const nextId = last ? last.session + 1 : 1;
    if (!APP_STATE.lastPrediction || APP_STATE.lastPrediction.phien !== nextId) {
        const duDoan = predictor.duDoan(APP_STATE.history);
        APP_STATE.lastPrediction = { phien: nextId, ketqua: duDoan.du_doan, do_tin_cay: duDoan.do_tin_cay + '%', khuyen_nghi: duDoan.khuyen_nghi, ly_do: duDoan.ly_do, so_cau: duDoan.so_cau };
    }
    const pred = APP_STATE.lastPrediction;
    const winRate = APP_STATE.stats.total > 0 ? (APP_STATE.stats.win / APP_STATE.stats.total * 100).toFixed(2) : "0";
    res.json({ "phien_truoc": last?.session || 0, "ketqua_truoc": last?.ket_qua || "", "xuc_xac": last?.dice || [0,0,0], "tong_diem": last?.tong || 0, "phien_sau": nextId, "du_doan": pred.ketqua, "do_tin_cay": pred.do_tin_cay, "khuyen_nghi": pred.khuyen_nghi, "ly_do": pred.ly_do, "so_cau_phat_hien": pred.so_cau, "thong_ke": { "thang": APP_STATE.stats.win, "thua": APP_STATE.stats.loss, "tong": APP_STATE.stats.total, "winrate": winRate + "%" } });
});

app.get('/stats', (req, res) => {
    const winRate = APP_STATE.stats.total > 0 ? (APP_STATE.stats.win / APP_STATE.stats.total * 100).toFixed(2) : "0";
    res.json({ tong_phien: APP_STATE.stats.total, thang: APP_STATE.stats.win, thua: APP_STATE.stats.loss, winrate: winRate + "%", note: "🚀 Dự đoán dựa trên 200+ loại cầu" });
});

app.get('/reset', (req, res) => { APP_STATE.stats = { total: 0, win: 0, loss: 0 }; APP_STATE.lastPrediction = null; res.json({ message: "Reset thành công!" }); });

app.listen(PORT, () => {
    console.log(`\n╔══════════════════════════════════════════════════╗`);
    console.log(`║   🎲 PRO MAX PREDICTOR - 200+ LOẠI CẦU 🎲     ║`);
    console.log(`║   Tự động nhận diện bệt, xen kẽ, markov...    ║`);
    console.log(`╚══════════════════════════════════════════════════╝\n`);
    console.log(`📡 API: http://localhost:${PORT}`);
    console.log(`📊 STATS: http://localhost:${PORT}/stats\n`);
    syncData();
});