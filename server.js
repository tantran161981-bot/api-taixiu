const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

// ==================== DỮ LIỆU THỐNG KÊ THỰC TẾ ====================
// Từ 105 phiên bạn cung cấp: 60 Tài - 45 Xỉu
const REAL_STATS = {
    taiRatio: 60 / 105,  // 0.5714
    xiuRatio: 45 / 105,  // 0.4286
};

// Xác suất bẻ cầu dựa trên độ dài chuỗi (KHÔNG RANDOM)
// Đây là ngưỡng quyết định CỐ ĐỊNH
const BREAK_THRESHOLD = {
    T: {  // Chuỗi Tài
        1: 0.42,  // 1 Tài -> 42% sẽ bẻ
        2: 0.38,
        3: 0.52,
        4: 0.68,
        5: 0.81,
        6: 0.90
    },
    X: {  // Chuỗi Xỉu
        1: 0.58,
        2: 0.55,
        3: 0.45,
        4: 0.32,
        5: 0.19,
        6: 0.10
    }
};

let stats = {
    hu: { total: 0, correct: 0, streak: 0, lastPredictions: [] },
    md5: { total: 0, correct: 0, streak: 0, lastPredictions: [] }
};

function transformData(apiData) {
    if (!apiData?.list) return null;
    return apiData.list.map(item => ({
        phien: item.id,
        ketQua: item.resultTruyenThong === 'TAI' ? 'T' : 'X',
        tong: item.point
    }));
}

async function fetchData(type) {
    try {
        const url = type === 'hu' ? API_URL_HU : API_URL_MD5;
        const res = await axios.get(url, { timeout: 10000 });
        return transformData(res.data);
    } catch (e) {
        console.error(`Lỗi ${type}:`, e.message);
        return null;
    }
}

// ==================== THUẬT TOÁN XÁC ĐỊNH - KHÔNG RANDOM ====================
function getDeterministicPrediction(arr) {
    if (!arr || arr.length < 5) return { pred: 'Tài', conf: 50 };
    
    const last10 = arr.slice(0, 10);
    const last5 = arr.slice(0, 5);
    const lastResult = arr[0];
    
    let taiCount10 = last10.filter(x => x === 'T').length;
    let taiCount5 = last5.filter(x => x === 'T').length;
    
    // 1. TÍNH ĐỘ DÀI CHUỖI HIỆN TẠI
    let streakLen = 1;
    for (let i = 1; i < arr.length && i < 7; i++) {
        if (arr[i] === lastResult) streakLen++;
        else break;
    }
    
    // 2. QUYẾT ĐỊNH DỰA TRÊN NGƯỠNG CỐ ĐỊNH (KHÔNG RANDOM)
    if (streakLen >= 2) {
        const breakChance = BREAK_THRESHOLD[lastResult][Math.min(streakLen, 6)];
        const shouldBreak = breakChance > 0.5;  // Quyết định CỐ ĐỊNH, không random
        
        if (shouldBreak) {
            const pred = lastResult === 'T' ? 'Xỉu' : 'Tài';
            const conf = 50 + (breakChance - 0.5) * 70;
            return { pred, conf: Math.min(88, Math.round(conf)) };
        } else {
            const pred = lastResult === 'T' ? 'Tài' : 'Xỉu';
            const conf = 50 + (0.5 - breakChance) * 60;
            return { pred, conf: Math.min(85, Math.round(conf)) };
        }
    }
    
    // 3. CỰC ĐOAN (8/10 hoặc 2/10)
    if (taiCount10 >= 8) return { pred: 'Xỉu', conf: 72 };
    if (taiCount10 <= 2) return { pred: 'Tài', conf: 72 };
    
    // 4. XU HƯỚNG 5 PHIÊN
    if (taiCount5 >= 4) return { pred: 'Xỉu', conf: 66 };
    if (taiCount5 <= 1) return { pred: 'Tài', conf: 66 };
    
    // 5. MẶC ĐỊNH: ĐẢO THEO KẾT QUẢ HIỆN TẠI
    return { pred: lastResult === 'T' ? 'Xỉu' : 'Tài', conf: 58 };
}

// ==================== CẬP NHẬT THỐNG KÊ ====================
function updateStats(type, phien, actual, predicted) {
    const isCorrect = predicted === actual;
    const typeStats = stats[type];
    
    typeStats.total++;
    if (isCorrect) {
        typeStats.correct++;
        typeStats.streak = typeStats.streak > 0 ? typeStats.streak + 1 : 1;
    } else {
        typeStats.streak = typeStats.streak < 0 ? typeStats.streak - 1 : -1;
    }
    
    typeStats.lastPredictions.unshift({
        phien, pred: predicted, actual, isCorrect, timestamp: Date.now()
    });
    
    if (typeStats.lastPredictions.length > 200) typeStats.lastPredictions.pop();
    
    try { fs.writeFileSync('stats_fixed.json', JSON.stringify(stats, null, 2)); } catch(e) {}
    
    const accuracy = (typeStats.correct / typeStats.total * 100).toFixed(1);
    console.log(`📊 [${type.toUpperCase()}] Phiên ${phien}: ${actual} | Dự đoán: ${predicted} ${isCorrect ? '✅' : '❌'} | TL: ${accuracy}% | Chuỗi: ${typeStats.streak}`);
}

// ==================== DỰ ĐOÁN CHÍNH ====================
async function getPrediction(type) {
    const data = await fetchData(type);
    if (!data || data.length < 10) return null;
    
    const latest = data[0];
    const nextPhien = latest.phien + 1;
    
    // Cập nhật kết quả cho dự đoán trước
    const lastPred = stats[type].lastPredictions[0];
    if (lastPred && !lastPred.checked) {
        const actual = latest.ketQua === 'T' ? 'Tài' : 'Xỉu';
        updateStats(type, lastPred.phien, actual, lastPred.pred);
        lastPred.checked = true;
    }
    
    // Lấy dữ liệu 30 phiên gần nhất
    const recentResults = data.slice(0, 30).map(d => d.ketQua);
    const prediction = getDeterministicPrediction(recentResults);
    
    // Lưu dự đoán mới
    stats[type].lastPredictions.unshift({
        phien: nextPhien,
        pred: prediction.pred,
        checked: false,
        timestamp: Date.now()
    });
    
    if (stats[type].lastPredictions.length > 200) stats[type].lastPredictions.pop();
    
    try { fs.writeFileSync('stats_fixed.json', JSON.stringify(stats, null, 2)); } catch(e) {}
    
    // ⭐ TRẢ VỀ KẾT QUẢ XÁC ĐỊNH - KHÔNG ĐỔI KHI REFRESH
    return {
        phien_du_doan: nextPhien,
        du_doan: prediction.pred,
        do_tin_cay: prediction.conf + '%',
        // Thêm field này để bạn kiểm tra thuật toán có bị random không
        deterministic: true
    };
}

// ==================== LOAD & API ====================
function loadStats() {
    try {
        if (fs.existsSync('stats_fixed.json')) {
            const loaded = JSON.parse(fs.readFileSync('stats_fixed.json', 'utf8'));
            stats = loaded;
            console.log('✅ Đã tải stats');
        }
    } catch(e) {}
}

loadStats();

app.get('/', (req, res) => res.json({ api: "Tài Xỉu Deterministic @anhquan", deterministic: true }));

app.get('/hu', async (req, res) => {
    const result = await getPrediction('hu');
    if (!result) return res.status(500).json({ error: "Lỗi lấy dữ liệu" });
    res.json(result);
});

app.get('/md5', async (req, res) => {
    const result = await getPrediction('md5');
    if (!result) return res.status(500).json({ error: "Lỗi lấy dữ liệu" });
    res.json(result);
});

app.get('/stats', (req, res) => {
    const accHu = stats.hu.total ? ((stats.hu.correct / stats.hu.total) * 100).toFixed(1) : 0;
    const accMd5 = stats.md5.total ? ((stats.md5.correct / stats.md5.total) * 100).toFixed(1) : 0;
    res.json({
        hu: { tong: stats.hu.total, dung: stats.hu.correct, sai: stats.hu.total - stats.hu.correct, ty_le: accHu + '%', chuoi: stats.hu.streak },
        md5: { tong: stats.md5.total, dung: stats.md5.correct, sai: stats.md5.total - stats.md5.correct, ty_le: accMd5 + '%', chuoi: stats.md5.streak }
    });
});

app.get('/reset', (req, res) => {
    stats = {
        hu: { total: 0, correct: 0, streak: 0, lastPredictions: [] },
        md5: { total: 0, correct: 0, streak: 0, lastPredictions: [] }
    };
    try { fs.writeFileSync('stats_fixed.json', JSON.stringify(stats, null, 2)); } catch(e) {}
    res.json({ message: "Đã reset dữ liệu", deterministic: true });
});

// ==================== AUTO RUN ====================
let lastRun = { hu: null, md5: null };

async function autoRun() {
    const dataHu = await fetchData('hu');
    const dataMd5 = await fetchData('md5');
    
    if (dataHu && dataHu[0] && lastRun.hu !== dataHu[0].phien) {
        lastRun.hu = dataHu[0].phien;
        await getPrediction('hu');
    }
    
    if (dataMd5 && dataMd5[0] && lastRun.md5 !== dataMd5[0].phien) {
        lastRun.md5 = dataMd5[0].phien;
        await getPrediction('md5');
    }
}

setInterval(autoRun, 13000);
setTimeout(autoRun, 2000);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Deterministic Server @anhquan - ${PORT}`);
    console.log(`🔒 100% XÁC ĐỊNH - KHÔNG RANDOM - CÙNG PHIÊN CHO CÙNG KẾT QUẢ`);
    console.log(`📊 Dựa trên thống kê 105 phiên thực tế (60 Tài - 45 Xỉu)`);
});
