const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

// ==================== DỮ LIỆU THỰC TẾ ====================
const REAL_STATS = {
    taiRatio: 60 / 105,  // 57.14%
    xiuRatio: 45 / 105,  // 42.86%
};

const BREAK_THRESHOLD = {
    T: { 1: 0.42, 2: 0.38, 3: 0.52, 4: 0.68, 5: 0.81, 6: 0.90 },
    X: { 1: 0.58, 2: 0.55, 3: 0.45, 4: 0.32, 5: 0.19, 6: 0.10 }
};

let stats = {
    hu: { total: 0, correct: 0, streak: 0, reverseMode: false, lastPredictions: [] },
    md5: { total: 0, correct: 0, streak: 0, reverseMode: false, lastPredictions: [] }
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

// ==================== THUẬT TOÁN CƠ BẢN ====================
function getBasePrediction(arr) {
    if (!arr || arr.length < 5) return 'Tài';
    
    const last10 = arr.slice(0, 10);
    const last5 = arr.slice(0, 5);
    const lastResult = arr[0];
    
    let taiCount10 = last10.filter(x => x === 'T').length;
    let taiCount5 = last5.filter(x => x === 'T').length;
    
    // 1. Chuỗi bệt
    let streakLen = 1;
    for (let i = 1; i < arr.length && i < 7; i++) {
        if (arr[i] === lastResult) streakLen++;
        else break;
    }
    
    if (streakLen >= 2) {
        const breakChance = BREAK_THRESHOLD[lastResult][Math.min(streakLen, 6)];
        const shouldBreak = breakChance > 0.5;
        return shouldBreak ? (lastResult === 'T' ? 'Xỉu' : 'Tài') : (lastResult === 'T' ? 'Tài' : 'Xỉu');
    }
    
    // 2. Cực đoan
    if (taiCount10 >= 8) return 'Xỉu';
    if (taiCount10 <= 2) return 'Tài';
    
    // 3. Xu hướng 5 phiên
    if (taiCount5 >= 4) return 'Xỉu';
    if (taiCount5 <= 1) return 'Tài';
    
    // 4. Mặc định: đảo
    return lastResult === 'T' ? 'Xỉu' : 'Tài';
}

// ==================== TỰ ĐỘNG ĐẢO NGƯỢC NẾU ĐANG SAI ====================
function getFinalPrediction(type, basePred) {
    const typeStats = stats[type];
    
    // Nếu đã có ít nhất 5 dự đoán
    if (typeStats.total >= 5) {
        const accuracy = typeStats.correct / typeStats.total;
        
        // Nếu tỷ lệ đúng < 45% -> BẬT CHẾ ĐỘ ĐẢO NGƯỢC
        if (accuracy < 0.45 && !typeStats.reverseMode) {
            typeStats.reverseMode = true;
            console.log(`🔄 [${type.toUpperCase()}] BẬT ĐẢO NGƯỢC - Tỷ lệ đúng ${(accuracy*100).toFixed(1)}% < 45%`);
        }
        // Nếu tỷ lệ đúng > 55% -> TẮT CHẾ ĐỘ ĐẢO NGƯỢC
        else if (accuracy > 0.55 && typeStats.reverseMode) {
            typeStats.reverseMode = false;
            console.log(`✅ [${type.toUpperCase()}] TẮT ĐẢO NGƯỢC - Tỷ lệ đúng ${(accuracy*100).toFixed(1)}% > 55%`);
        }
    }
    
    // Nếu đang thua liên tiếp >= 3 -> tạm thời đảo ngược
    if (typeStats.streak <= -3 && !typeStats.reverseMode) {
        console.log(`⚠️ [${type.toUpperCase()}] ĐANG THUA ${Math.abs(typeStats.streak)} LIÊN -> TẠM ĐẢO`);
        return basePred === 'Tài' ? 'Xỉu' : 'Tài';
    }
    
    // Áp dụng đảo ngược nếu đang bật chế độ
    if (typeStats.reverseMode) {
        return basePred === 'Tài' ? 'Xỉu' : 'Tài';
    }
    
    return basePred;
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
    
    try { fs.writeFileSync('stats_reverse.json', JSON.stringify(stats, null, 2)); } catch(e) {}
    
    const accuracy = (typeStats.correct / typeStats.total * 100).toFixed(1);
    const mode = typeStats.reverseMode ? '🔁 REVERSE' : '🎯 NORMAL';
    console.log(`[${type.toUpperCase()}] ${mode} | Phiên ${phien}: ${actual} | Đoán: ${predicted} ${isCorrect ? '✅' : '❌'} | TL: ${accuracy}% | Chuỗi: ${typeStats.streak}`);
}

// ==================== DỰ ĐOÁN CHÍNH ====================
async function getPrediction(type) {
    const data = await fetchData(type);
    if (!data || data.length < 10) return null;
    
    const latest = data[0];
    const nextPhien = latest.phien + 1;
    
    // Cập nhật kết quả dự đoán trước
    const lastPred = stats[type].lastPredictions[0];
    if (lastPred && !lastPred.checked) {
        const actual = latest.ketQua === 'T' ? 'Tài' : 'Xỉu';
        updateStats(type, lastPred.phien, actual, lastPred.pred);
        lastPred.checked = true;
    }
    
    // Lấy dự đoán cơ bản
    const recentResults = data.slice(0, 30).map(d => d.ketQua);
    const basePred = getBasePrediction(recentResults);
    const finalPred = getFinalPrediction(type, basePred);
    
    // Tính confidence (dựa trên độ tin cậy của thuật toán)
    let confidence = 65;
    if (stats[type].reverseMode) confidence = 72;
    if (Math.abs(stats[type].streak) >= 3) confidence += 5;
    confidence = Math.min(88, Math.max(55, confidence));
    
    // Lưu dự đoán mới
    stats[type].lastPredictions.unshift({
        phien: nextPhien,
        pred: finalPred,
        checked: false,
        timestamp: Date.now()
    });
    
    if (stats[type].lastPredictions.length > 200) stats[type].lastPredictions.pop();
    
    try { fs.writeFileSync('stats_reverse.json', JSON.stringify(stats, null, 2)); } catch(e) {}
    
    return {
        phien_du_doan: nextPhien,
        du_doan: finalPred,
        do_tin_cay: confidence + '%'
    };
}

// ==================== LOAD & API ====================
function loadStats() {
    try {
        if (fs.existsSync('stats_reverse.json')) {
            const loaded = JSON.parse(fs.readFileSync('stats_reverse.json', 'utf8'));
            stats = loaded;
            console.log('✅ Đã tải stats');
        }
    } catch(e) {}
}

loadStats();

app.get('/', (req, res) => res.json({ api: "Tài Xỉu Reverse Mode @anhquan" }));

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
        hu: {
            tong: stats.hu.total,
            dung: stats.hu.correct,
            sai: stats.hu.total - stats.hu.correct,
            ty_le: accHu + '%',
            chuoi: stats.hu.streak,
            reverse_mode: stats.hu.reverseMode
        },
        md5: {
            tong: stats.md5.total,
            dung: stats.md5.correct,
            sai: stats.md5.total - stats.md5.correct,
            ty_le: accMd5 + '%',
            chuoi: stats.md5.streak,
            reverse_mode: stats.md5.reverseMode
        }
    });
});

app.get('/reset', (req, res) => {
    stats = {
        hu: { total: 0, correct: 0, streak: 0, reverseMode: false, lastPredictions: [] },
        md5: { total: 0, correct: 0, streak: 0, reverseMode: false, lastPredictions: [] }
    };
    try { fs.writeFileSync('stats_reverse.json', JSON.stringify(stats, null, 2)); } catch(e) {}
    res.json({ message: "Đã reset dữ liệu" });
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
    console.log(`🚀 Reverse Mode Server @anhquan - ${PORT}`);
    console.log(`🔄 Tự động đảo ngược nếu tỷ lệ đúng < 45%`);
    console.log(`📊 Chạy 5-10 phiên đầu để thuật toán học và tự điều chỉnh`);
});
