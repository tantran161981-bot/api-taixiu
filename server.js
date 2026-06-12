const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

// Dữ liệu huấn luyện từ 105 phiên thực tế (60 Tài - 45 Xỉu)
const GROUND_TRUTH = {
    baseTaiRatio: 60 / 105,
    baseXiuRatio: 45 / 105,
    breakProbability: {
        T: { 1: 0.42, 2: 0.38, 3: 0.52, 4: 0.68, 5: 0.81, 6: 0.90 },
        X: { 1: 0.58, 2: 0.55, 3: 0.45, 4: 0.32, 5: 0.19, 6: 0.10 }
    }
};

let stats = {
    hu: { total: 0, correct: 0, streak: 0, lastPredictions: [], autoReverse: false },
    md5: { total: 0, correct: 0, streak: 0, lastPredictions: [], autoReverse: false }
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

// ==================== THUẬT TOÁN DỰ ĐOÁN CƠ BẢN ====================
function getBasePrediction(arr) {
    if (!arr || arr.length < 5) return { pred: 'Tài', conf: 50 };
    
    const last10 = arr.slice(0, 10);
    const last5 = arr.slice(0, 5);
    const lastResult = arr[0];
    
    let taiCount10 = last10.filter(x => x === 'T').length;
    let taiCount5 = last5.filter(x => x === 'T').length;
    
    // 1. Xử lý chuỗi bệt dựa trên xác suất thực tế
    let streakLen = 1;
    for (let i = 1; i < arr.length && i < 7; i++) {
        if (arr[i] === lastResult) streakLen++;
        else break;
    }
    
    if (streakLen >= 2) {
        const breakChance = GROUND_TRUTH.breakProbability[lastResult][Math.min(streakLen, 6)];
        const shouldBreak = breakChance > 0.5;
        if (shouldBreak) {
            return { pred: lastResult === 'T' ? 'Xỉu' : 'Tài', conf: 50 + (breakChance - 0.5) * 70 };
        } else {
            return { pred: lastResult === 'T' ? 'Tài' : 'Xỉu', conf: 50 + (0.5 - breakChance) * 60 };
        }
    }
    
    // 2. Xử lý cực đoan
    if (taiCount10 >= 8) return { pred: 'Xỉu', conf: 72 };
    if (taiCount10 <= 2) return { pred: 'Tài', conf: 72 };
    
    // 3. Xu hướng 5 phiên
    if (taiCount5 >= 4) return { pred: 'Xỉu', conf: 66 };
    if (taiCount5 <= 1) return { pred: 'Tài', conf: 66 };
    
    // 4. Mặc định: đảo theo kết quả hiện tại
    return { pred: lastResult === 'T' ? 'Xỉu' : 'Tài', conf: 55 };
}

// ==================== THUẬT TOÁN TỰ HỌC - ĐẢO NGƯỢC NẾU ĐANG SAI ====================
function getFinalPrediction(type, basePred, baseConf) {
    const typeStats = stats[type];
    
    // Tự động bật chế độ đảo ngược nếu đang sai nhiều
    // Nếu đã dự đoán >= 5 lần và tỷ lệ đúng < 40% -> BẬT ĐẢO NGƯỢC
    if (typeStats.total >= 5) {
        const accuracy = typeStats.correct / typeStats.total;
        if (accuracy < 0.4 && !typeStats.autoReverse) {
            typeStats.autoReverse = true;
            console.log(`🔄 [${type.toUpperCase()}] BẬT CHẾ ĐỘ ĐẢO NGƯỢC - Tỷ lệ đúng ${(accuracy*100).toFixed(1)}% < 40%`);
        } else if (accuracy >= 0.5 && typeStats.autoReverse) {
            typeStats.autoReverse = false;
            console.log(`✅ [${type.toUpperCase()}] TẮT CHẾ ĐỘ ĐẢO NGƯỢC - Tỷ lệ đúng đã cải thiện lên ${(accuracy*100).toFixed(1)}%`);
        }
    }
    
    // Nếu đang thua liên tiếp >= 3, cũng bật đảo ngược tạm thời
    const isReverse = typeStats.autoReverse || typeStats.streak <= -3;
    
    if (isReverse) {
        const reversedPred = basePred === 'Tài' ? 'Xỉu' : 'Tài';
        // Tăng confidence khi đang ở chế độ đảo ngược
        const adjustedConf = Math.min(88, baseConf + 8);
        return { pred: reversedPred, conf: adjustedConf, isReversed: true };
    }
    
    return { pred: basePred, conf: baseConf, isReversed: false };
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
        phien, pred: predicted, actual, isCorrect,
        timestamp: Date.now()
    });
    
    if (typeStats.lastPredictions.length > 200) typeStats.lastPredictions.pop();
    
    // Lưu file
    try {
        fs.writeFileSync('stats_real.json', JSON.stringify(stats, null, 2));
    } catch(e) {}
    
    // Log realtime
    const accuracy = (typeStats.correct / typeStats.total * 100).toFixed(1);
    console.log(`📊 [${type.toUpperCase()}] ${actual} | Dự đoán: ${predicted} ${isCorrect ? '✅' : '❌'} | Tỷ lệ: ${accuracy}% | Chuỗi: ${typeStats.streak}`);
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
    const base = getBasePrediction(recentResults);
    const final = getFinalPrediction(type, base.pred, base.conf);
    
    // Lưu dự đoán mới
    stats[type].lastPredictions.unshift({
        phien: nextPhien,
        pred: final.pred,
        checked: false,
        timestamp: Date.now()
    });
    
    if (stats[type].lastPredictions.length > 200) stats[type].lastPredictions.pop();
    
    try { fs.writeFileSync('stats_real.json', JSON.stringify(stats, null, 2)); } catch(e) {}
    
    return {
        phien_du_doan: nextPhien,
        du_doan: final.pred,
        do_tin_cay: final.conf + '%'
    };
}

// ==================== LOAD & API ====================
function loadStats() {
    try {
        if (fs.existsSync('stats_real.json')) {
            const loaded = JSON.parse(fs.readFileSync('stats_real.json', 'utf8'));
            stats = loaded;
            console.log('✅ Đã tải stats');
            console.log(`📈 HU: ${stats.hu.total} dự đoán, ${((stats.hu.correct/stats.hu.total||0)*100).toFixed(1)}% đúng`);
            console.log(`📈 MD5: ${stats.md5.total} dự đoán, ${((stats.md5.correct/stats.md5.total||0)*100).toFixed(1)}% đúng`);
        }
    } catch(e) {}
}

loadStats();

app.get('/', (req, res) => res.json({ api: "Tài Xỉu Auto-Learn @anhquan", endpoints: ["/hu", "/md5", "/stats", "/reset"] }));

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
            auto_reverse: stats.hu.autoReverse
        },
        md5: {
            tong: stats.md5.total,
            dung: stats.md5.correct,
            sai: stats.md5.total - stats.md5.correct,
            ty_le: accMd5 + '%',
            chuoi: stats.md5.streak,
            auto_reverse: stats.md5.autoReverse
        }
    });
});

app.get('/reset', (req, res) => {
    stats = {
        hu: { total: 0, correct: 0, streak: 0, lastPredictions: [], autoReverse: false },
        md5: { total: 0, correct: 0, streak: 0, lastPredictions: [], autoReverse: false }
    };
    try { fs.writeFileSync('stats_real.json', JSON.stringify(stats, null, 2)); } catch(e) {}
    res.json({ message: "Đã reset dữ liệu", tac_gia: "@anhquan" });
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
    console.log(`🚀 Auto-Learn Server @anhquan - ${PORT}`);
    console.log(`🧠 Chế độ tự động đảo ngược nếu đang sai nhiều`);
});
