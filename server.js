const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=62385f65eb49fcb34c72a7d6489ad91d';
const UPDATE_INTERVAL = 5000;
const HISTORY_FILE = path.join(__dirname, 'prediction_history.json');
let historyData = [];
let currentPrediction = null;
let lastPhienId = null;
let updateLock = false;
let tongDuDoan = 0;
let duDoanDung = 0;
let chuoiDungLienTiep = 0;
let chuoiSaiLienTiep = 0;
let predictionHistory = [];

class TaiXiuPredictor {
    constructor() {
        this.lichSu = [];
        this.thongKe = { tai: 0, xiu: 0, tong: 0, dung: 0, sai: 0 };
        this.chuoiHienTai = [];
        this.betMax = 0;
        this.cauDangChay = null;
    }
    themKetQua(ketQua) {
        if (ketQua !== "TAI" && ketQua !== "XIU") return false;
        this.lichSu.push(ketQua);
        this.thongKe[ketQua === "TAI" ? "tai" : "xiu"]++;
        this.thongKe.tong++;
        this.capNhatChuoi(ketQua);
        this.phatHienCau();
        return true;
    }
    capNhatChuoi(ketQua) {
        if (this.chuoiHienTai.length === 0 || this.chuoiHienTai[this.chuoiHienTai.length - 1] === ketQua) {
            this.chuoiHienTai.push(ketQua);
        } else {
            if (this.chuoiHienTai.length > this.betMax) this.betMax = this.chuoiHienTai.length;
            this.chuoiHienTai = [ketQua];
        }
    }
    phatHienCau() {
        if (this.lichSu.length < 10) return;
        let doan3cuoi = this.lichSu.slice(-3);
        let doan5cuoi = this.lichSu.slice(-5);
        let doan10cuoi = this.lichSu.slice(-10);
        if (doan3cuoi[0] === doan3cuoi[1] && doan3cuoi[1] === doan3cuoi[2]) {
            this.cauDangChay = { loai: "BET_3", giaTri: doan3cuoi[0], doTinCay: 85 };
        } else if (doan5cuoi[0] === doan5cuoi[1] && doan5cuoi[1] === doan5cuoi[2] && doan5cuoi[2] === doan5cuoi[3] && doan5cuoi[3] === doan5cuoi[4]) {
            this.cauDangChay = { loai: "BET_5", giaTri: doan5cuoi[0], doTinCay: 95 };
        } else {
            let taiCount = doan10cuoi.filter(x => x === "TAI").length;
            let xiuCount = 10 - taiCount;
            if (taiCount >= 7) {
                this.cauDangChay = { loai: "XU_HUONG_TAI", giaTri: "TAI", doTinCay: 70 + (taiCount - 7) * 5 };
            } else if (xiuCount >= 7) {
                this.cauDangChay = { loai: "XU_HUONG_XIU", giaTri: "XIU", doTinCay: 70 + (xiuCount - 7) * 5 };
            } else {
                this.cauDangChay = null;
            }
        }
    }
    tinhXacSuatTheoBet() {
        if (this.chuoiHienTai.length === 0) return 50;
        let doDaiBet = this.chuoiHienTai.length;
        let loaiBet = this.chuoiHienTai[0];
        if (doDaiBet >= 5) {
            return { duDoan: loaiBet === "TAI" ? "XIU" : "TAI", doTinCay: 90, lyDo: `BET ${doDaiBet} qua dai, bat dao` };
        } else if (doDaiBet >= 3) {
            return { duDoan: loaiBet === "TAI" ? "XIU" : "TAI", doTinCay: 75, lyDo: `BET ${doDaiBet} canh bao, danh dao` };
        } else if (doDaiBet === 2) {
            let tyLe = this.tinhTyLeGanDay(20);
            if (tyLe.tai > 60) {
                return { duDoan: "TAI", doTinCay: tyLe.tai, lyDo: "Xu huong TAI manh" };
            } else if (tyLe.xiu > 60) {
                return { duDoan: "XIU", doTinCay: tyLe.xiu, lyDo: "Xu huong XIU manh" };
            }
            return { duDoan: loaiBet, doTinCay: 55, lyDo: `BET 2, danh theo ${loaiBet}` };
        }
        return null;
    }
    tinhTyLeGanDay(soPhien) {
        let lay = this.lichSu.slice(-soPhien);
        let tai = lay.filter(x => x === "TAI").length;
        return { tai: (tai / lay.length) * 100, xiu: ((lay.length - tai) / lay.length) * 100 };
    }
    phanTichThongKeNangCao() {
        if (this.lichSu.length < 30) return null;
        let nua1 = this.lichSu.slice(0, Math.floor(this.lichSu.length / 2));
        let nua2 = this.lichSu.slice(Math.floor(this.lichSu.length / 2));
        let tyLe1 = nua1.filter(x => x === "TAI").length / nua1.length;
        let tyLe2 = nua2.filter(x => x === "TAI").length / nua2.length;
        let chenhLech = Math.abs(tyLe1 - tyLe2);
        if (chenhLech > 0.2) {
            let xuHuong = tyLe2 > tyLe1 ? "TAI" : "XIU";
            return { coSuThayDoi: true, xuHuongMoi: xuHuong, mucDoThayDoi: (chenhLech * 100).toFixed(1), doTinCay: 60 + Math.min(30, chenhLech * 100) };
        }
        return { coSuThayDoi: false };
    }
    phatHienMauPhucTap() {
        if (this.lichSu.length < 20) return null;
        let mau = {};
        for (let i = 0; i < this.lichSu.length - 3; i++) {
            let doan = this.lichSu.slice(i, i + 3);
            let key = doan.join("");
            mau[key] = (mau[key] || 0) + 1;
        }
        let doanCuoi = this.lichSu.slice(-3).join("");
        let tanSuat = mau[doanCuoi] || 0;
        if (tanSuat >= 3) {
            let ketQuaThuongGap = this.timKetQuaThuongGapSauMau(doanCuoi);
            if (ketQuaThuongGap) {
                return { mauPhatHien: doanCuoi, duDoan: ketQuaThuongGap, doTinCay: 70 + Math.min(20, tanSuat * 5), tanSuat: tanSuat };
            }
        }
        return null;
    }
    timKetQuaThuongGapSauMau(mau) {
        let dem = { TAI: 0, XIU: 0 };
        for (let i = 0; i < this.lichSu.length - 3; i++) {
            if (this.lichSu.slice(i, i + 3).join("") === mau) {
                let tiepTheo = this.lichSu[i + 3];
                if (tiepTheo) dem[tiepTheo]++;
            }
        }
        if (dem.TAI > dem.XIU && dem.TAI >= 2) return "TAI";
        if (dem.XIU > dem.TAI && dem.XIU >= 2) return "XIU";
        return null;
    }
    duDoanChinhXac() {
        if (this.lichSu.length < 15) {
            return { duDoan: "TAI", doTinCay: 50, lyDo: "Chua du du lieu" };
        }
        let betAnalysis = this.tinhXacSuatTheoBet();
        if (betAnalysis) return betAnalysis;
        let cauAnalysis = this.cauDangChay;
        if (cauAnalysis) {
            return { duDoan: cauAnalysis.giaTri === "TAI" ? "XIU" : "TAI", doTinCay: cauAnalysis.doTinCay, lyDo: `Phat hien ${cauAnalysis.loai}` };
        }
        let mauAnalysis = this.phatHienMauPhucTap();
        if (mauAnalysis) {
            return { duDoan: mauAnalysis.duDoan, doTinCay: mauAnalysis.doTinCay, lyDo: `Mau ${mauAnalysis.mauPhatHien} xuat hien ${mauAnalysis.tanSuat} lan` };
        }
        let thongKeNangCao = this.phanTichThongKeNangCao();
        if (thongKeNangCao && thongKeNangCao.coSuThayDoi) {
            return { duDoan: thongKeNangCao.xuHuongMoi, doTinCay: thongKeNangCao.doTinCay, lyDo: `Thay doi xu huong ${thongKeNangCao.mucDoThayDoi}%` };
        }
        let tyLe = this.tinhTyLeGanDay(20);
        if (tyLe.tai > 55) {
            return { duDoan: "TAI", doTinCay: tyLe.tai, lyDo: `TAI chiem ${tyLe.tai.toFixed(1)}% 20 phien gan day` };
        } else if (tyLe.xiu > 55) {
            return { duDoan: "XIU", doTinCay: tyLe.xiu, lyDo: `XIU chiem ${tyLe.xiu.toFixed(1)}% 20 phien gan day` };
        }
        let lastResult = this.lichSu[this.lichSu.length - 1];
        return { duDoan: lastResult, doTinCay: 51, lyDo: `Mac dinh theo ket qua cuoi: ${lastResult}` };
    }
}

function loadPredictionHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
            const data = JSON.parse(raw);
            predictionHistory = data.predictions || [];
            tongDuDoan = data.tongDuDoan || 0;
            duDoanDung = data.duDoanDung || 0;
            chuoiDungLienTiep = data.chuoiDungLienTiep || 0;
            chuoiSaiLienTiep = data.chuoiSaiLienTiep || 0;
        }
    } catch (e) {
        console.error('LOI DOC HISTORY:', e.message);
    }
}

function savePredictionHistory() {
    try {
        const data = {
            predictions: predictionHistory.slice(-500),
            tongDuDoan,
            duDoanDung,
            chuoiDungLienTiep,
            chuoiSaiLienTiep,
            lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('LOI LUU HISTORY:', e.message);
    }
}

async function checkPreviousPrediction() {
    if (predictionHistory.length === 0) return;
    const lastPrediction = predictionHistory[predictionHistory.length - 1];
    if (lastPrediction.verified) return;
    if (historyData.length === 0) return;
    const targetId = lastPrediction.phienId;
    const foundSession = historyData.find(s => String(s.id) === String(targetId));
    if (foundSession) {
        const actualResult = foundSession.resultTruyenThong;
        lastPrediction.verified = true;
        lastPrediction.ket_qua_thuc = actualResult;
        tongDuDoan++;
        if (lastPrediction.du_doan === actualResult) {
            duDoanDung++;
            chuoiDungLienTiep++;
            chuoiSaiLienTiep = 0;
        } else {
            chuoiSaiLienTiep++;
            chuoiDungLienTiep = 0;
        }
        savePredictionHistory();
        console.log(`DA KIEM TRA PHIEN #${targetId}: DU DOAN=${lastPrediction.du_doan}, THUC=${actualResult}, DUNG=${lastPrediction.du_doan === actualResult}`);
    }
}

async function fetchHistory() {
    try {
        const res = await axios.get(API_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
                'Referer': 'https://tele68.com/'
            },
            timeout: 10000
        });
        if (res?.data?.list && Array.isArray(res.data.list)) {
            historyData = res.data.list.sort((a, b) => b.id - a.id);
            return true;
        }
    } catch (e) {
        console.error('LOI FETCH API:', e.message);
    }
    return false;
}

async function updateData() {
    if (updateLock) return;
    updateLock = true;
    try {
        const success = await fetchHistory();
        if (!success) { updateLock = false; return; }
        const latest = historyData[0];
        if (latest && latest.id !== lastPhienId) {
            await checkPreviousPrediction();
            lastPhienId = latest.id;
            const predictor = new TaiXiuPredictor();
            const reversedHistory = [...historyData].reverse();
            for (let session of reversedHistory) {
                predictor.themKetQua(session.resultTruyenThong);
            }
            const analysis = predictor.duDoanChinhXac();
            const nextPhienId = latest.id + 1;
            currentPrediction = {
                id: 'ZukaNoPro2',
                Phien_truoc: latest.id,
                Xuc_xac: latest.dices ? `${latest.dices[0]} ${latest.dices[1]} ${latest.dices[2]}` : '0 0 0',
                Ket_qua: latest.resultTruyenThong || 'Chờ...',
                Phien_nay: nextPhienId,
                Du_doan: analysis.duDoan,
                Do_tin_cay: analysis.doTinCay
            };
            const existingPrediction = predictionHistory.find(p => p.phienId === nextPhienId);
            if (!existingPrediction) {
                predictionHistory.push({
                    phienId: nextPhienId,
                    du_doan: analysis.duDoan,
                    do_tin_cay: analysis.doTinCay,
                    ly_do: analysis.lyDo,
                    ket_qua_thuc: null,
                    verified: false,
                    timestamp: Date.now()
                });
                savePredictionHistory();
            }
            console.log(`PHIEN #${latest.id} | KQ: ${latest.resultTruyenThong} | DU DOAN #${nextPhienId}: ${analysis.duDoan} | CONFIDENCE: ${analysis.doTinCay}% | LY DO: ${analysis.lyDo}`);
        }
    } catch (e) {
        console.error('LOI UPDATE:', e.message);
    }
    updateLock = false;
}

async function initializeData() {
    const success = await fetchHistory();
    if (success && historyData.length > 0) {
        const latest = historyData[0];
        lastPhienId = latest.id;
        const predictor = new TaiXiuPredictor();
        const reversedHistory = [...historyData].reverse();
        for (let session of reversedHistory) {
            predictor.themKetQua(session.resultTruyenThong);
        }
        const analysis = predictor.duDoanChinhXac();
        const nextPhienId = latest.id + 1;
        currentPrediction = {
            id: 'ZukaNoPro2',
            Phien_truoc: latest.id,
            Xuc_xac: latest.dices ? `${latest.dices[0]} ${latest.dices[1]} ${latest.dices[2]}` : '0 0 0',
            Ket_qua: latest.resultTruyenThong || 'Chờ...',
            Phien_nay: nextPhienId,
            Du_doan: analysis.duDoan,
            Do_tin_cay: analysis.doTinCay
        };
        const existingPrediction = predictionHistory.find(p => p.phienId === nextPhienId);
        if (!existingPrediction) {
            predictionHistory.push({
                phienId: nextPhienId,
                du_doan: analysis.duDoan,
                do_tin_cay: analysis.doTinCay,
                ly_do: analysis.lyDo,
                ket_qua_thuc: null,
                verified: false,
                timestamp: Date.now()
            });
            savePredictionHistory();
        }
        console.log(`KHOI TAO THANH CONG | PHIEN #${latest.id} | DU DOAN #${nextPhienId}: ${analysis.duDoan} | LY DO: ${analysis.lyDo}`);
    }
}

app.get('/', async (req, res) => {
    await updateData();
    if (!currentPrediction) {
        return res.json({
            id: 'ZukaNoPro2',
            Phien_truoc: 0,
            Xuc_xac: '0 0 0',
            Ket_qua: 'Chờ...',
            Phien_nay: 0,
            Du_doan: 'Đang tải...',
            Do_tin_cay: 0
        });
    }
    res.json(currentPrediction);
});

app.get('/stats', (req, res) => {
    const verifiedPredictions = predictionHistory.filter(p => p.verified);
    const txAccuracy = verifiedPredictions.length > 0
        ? ((verifiedPredictions.filter(p => p.du_doan === p.ket_qua_thuc).length / verifiedPredictions.length) * 100).toFixed(1)
        : '0.0';
    res.json({
        tong_du_doan: tongDuDoan,
        du_doan_dung: duDoanDung,
        ty_le_chinh_xac: txAccuracy + '%',
        chuoi_dung_lien_tiep: chuoiDungLienTiep,
        chuoi_sai_lien_tiep: chuoiSaiLienTiep,
        lich_su_du_doan: predictionHistory.slice(-20).reverse()
    });
});

app.get('/history', (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    res.json({
        latest_phien: historyData.slice(0, limit),
        total_phien: historyData.length
    });
});

app.listen(PORT, () => {
    console.log('========================================');
    console.log('  TAI XIU MD5 LC79 API - ZukaNoPro2');
    console.log(`  SERVER CHAY TREN PORT ${PORT}`);
    console.log('  THUAT TOAN: COSPLAYTELE.COM');
    console.log('  API: NGON VCL');
    console.log('  SHARE SÚT MAY CHET');
    console.log('========================================\n');
    loadPredictionHistory();
    initializeData();
    setInterval(updateData, UPDATE_INTERVAL);
});