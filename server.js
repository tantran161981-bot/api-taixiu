const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 8000;

const POLL_INTERVAL = 5000;
const MAX_HISTORY = 1000;
const ID_TAG = "@tiendataox";
const MIN_PHIEN_TO_PREDICT = 15; // Cần 15 phiên mới dự đoán

// ==================== API URLs ====================
const API_URLS = {
    lc79_hu: 'https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5',
    lc79_md5: 'https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=3959701241b686f12e01bfe9c3a319b8',
    betvip_hu: 'https://wtx.macminim6.online/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=f69c1c37e9ffbfea5b655ed312604b40',
    betvip_md5: 'https://wtxmd52.macminim6.online/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=7aa1c7e7ea0160fd97524740774a4c61'
};

// ==================== LƯU NHIỀU PHIÊN ====================
let gameHistory = {
    lc79_hu: [],
    lc79_md5: [],
    betvip_hu: [],
    betvip_md5: []
};

let latestResult = {
    lc79_hu: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong_diem: 0, Pattern: "Chưa có", Phien_hien_tai: 0, Du_doan: "Chưa có", Du_doan_confidence: 0, Tong_du_doan: 0, Tong_thang: 0, Tong_thua: 0, Status: "Chờ dữ liệu...", Id: ID_TAG },
    lc79_md5: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong_diem: 0, Pattern: "Chưa có", Phien_hien_tai: 0, Du_doan: "Chưa có", Du_doan_confidence: 0, Tong_du_doan: 0, Tong_thang: 0, Tong_thua: 0, Status: "Chờ dữ liệu...", Id: ID_TAG },
    betvip_hu: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong_diem: 0, Pattern: "Chưa có", Phien_hien_tai: 0, Du_doan: "Chưa có", Du_doan_confidence: 0, Tong_du_doan: 0, Tong_thang: 0, Tong_thua: 0, Status: "Chờ dữ liệu...", Id: ID_TAG },
    betvip_md5: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong_diem: 0, Pattern: "Chưa có", Phien_hien_tai: 0, Du_doan: "Chưa có", Du_doan_confidence: 0, Tong_du_doan: 0, Tong_thang: 0, Tong_thua: 0, Status: "Chờ dữ liệu...", Id: ID_TAG }
};

let gameStats = {
    lc79_hu: { totalPredictions: 0, totalWins: 0, totalLosses: 0 },
    lc79_md5: { totalPredictions: 0, totalWins: 0, totalLosses: 0 },
    betvip_hu: { totalPredictions: 0, totalWins: 0, totalLosses: 0 },
    betvip_md5: { totalPredictions: 0, totalWins: 0, totalLosses: 0 }
};

let lastProcessed = {
    lc79_hu: null,
    lc79_md5: null,
    betvip_hu: null,
    betvip_md5: null
};

// ==================== PHÂN TÍCH CẦU XỊN ====================
function analyzePattern(history) {
    if (history.length < 5) return null;
    
    const results = history.map(h => h.Ket_qua);
    const patterns = [];
    
    // 1. PHÁT HIỆN CẦU BỆT
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[0]) streak++;
        else break;
    }
    
    if (streak >= 3) {
        patterns.push({
            name: streak >= 5 ? 'CẦU BỆT DÀI' : 'CẦU BỆT',
            description: `${streak} phiên ${results[0]} liên tiếp`,
            nextPrediction: streak >= 5 ? (results[0] === 'Tài' ? 'Xỉu' : 'Tài') : results[0],
            confidence: Math.min(85, 65 + streak * 3),
            type: 'streak'
        });
    }
    
    // 2. PHÁT HIỆN CẦU 1-1 (PING PONG)
    let isPingPong = true;
    for (let i = 0; i < Math.min(5, results.length - 1); i++) {
        if (results[i] === results[i + 1]) {
            isPingPong = false;
            break;
        }
    }
    
    if (isPingPong && results.length >= 6) {
        let pingpongLen = 1;
        for (let i = 1; i < results.length; i++) {
            if (results[i] !== results[i - 1]) pingpongLen++;
            else break;
        }
        patterns.push({
            name: 'CẦU 1-1 (PING PONG)',
            description: `Đan xen ${pingpongLen} phiên: ${results.slice(0, 6).join(' → ')}`,
            nextPrediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
            confidence: Math.min(88, 70 + pingpongLen),
            type: 'pingpong'
        });
    }
    
    // 3. PHÁT HIỆN CẦU 2-2
    if (results.length >= 8) {
        let is22 = true;
        for (let i = 0; i < 6; i += 2) {
            if (results[i] !== results[i + 1]) is22 = false;
            if (i + 2 < 6 && results[i] === results[i + 2]) is22 = false;
        }
        if (is22) {
            patterns.push({
                name: 'CẦU 2-2',
                description: `Cặp đôi: ${results[0]}${results[1]} ${results[2]}${results[3]} ${results[4]}${results[5]}`,
                nextPrediction: results[4] === 'Tài' ? 'Xỉu' : 'Tài',
                confidence: 84,
                type: 'double'
            });
        }
    }
    
    // 4. PHÁT HIỆN CẦU 3-3
    if (results.length >= 9) {
        let is33 = true;
        for (let i = 0; i < 9; i += 3) {
            if (!(results[i] === results[i + 1] && results[i + 1] === results[i + 2])) is33 = false;
            if (i + 3 < 9 && results[i] === results[i + 3]) is33 = false;
        }
        if (is33) {
            patterns.push({
                name: 'CẦU 3-3',
                description: `Bộ ba: ${results[0]}${results[1]}${results[2]} ${results[3]}${results[4]}${results[5]}`,
                nextPrediction: results[6] === 'Tài' ? 'Xỉu' : 'Tài',
                confidence: 86,
                type: 'triple'
            });
        }
    }
    
    // 5. PHÁT HIỆN CẦU ĐỐI XỨNG
    if (results.length >= 6) {
        let isSymmetric = true;
        for (let i = 0; i < 3; i++) {
            if (results[i] !== results[5 - i]) isSymmetric = false;
        }
        if (isSymmetric) {
            patterns.push({
                name: 'CẦU ĐỐI XỨNG GƯƠNG',
                description: `${results[0]} ${results[1]} ${results[2]} | ${results[3]} ${results[4]} ${results[5]}`,
                nextPrediction: results[3],
                confidence: 82,
                type: 'symmetry'
            });
        }
    }
    
    // 6. PHÁT HIỆN CHU KỲ
    if (results.length >= 12) {
        for (let cycle of [2, 3, 4]) {
            let isCycle = true;
            for (let i = cycle; i < cycle * 3 && i < results.length; i++) {
                if (results[i] !== results[i % cycle]) {
                    isCycle = false;
                    break;
                }
            }
            if (isCycle) {
                patterns.push({
                    name: `CHU KỲ ${cycle}`,
                    description: `Lặp lại mỗi ${cycle} phiên: ${results.slice(0, cycle).join(' → ')}`,
                    nextPrediction: results[results.length % cycle],
                    confidence: 78 + cycle * 2,
                    type: 'cycle'
                });
                break;
            }
        }
    }
    
    // 7. THỐNG KÊ TẦN SUẤT
    const recent = results.slice(0, Math.min(20, results.length));
    const taiCount = recent.filter(r => r === 'Tài').length;
    const xiuCount = recent.length - taiCount;
    const diff = Math.abs(taiCount - xiuCount);
    
    if (diff >= 4) {
        patterns.push({
            name: 'LỆCH PHA',
            description: `${recent.length} phiên: ${taiCount}T - ${xiuCount}X`,
            nextPrediction: taiCount > xiuCount ? 'Xỉu' : 'Tài',
            confidence: 70 + diff,
            type: 'imbalance'
        });
    }
    
    return patterns;
}

// ==================== TỔNG HỢP DỰ ĐOÁN ====================
function predictFromPatterns(patterns, history) {
    if (!patterns || patterns.length === 0) {
        // Fallback khi chưa có pattern rõ ràng
        if (history.length < MIN_PHIEN_TO_PREDICT) {
            return { prediction: null, confidence: 0, reason: `Chờ đủ ${MIN_PHIEN_TO_PREDICT} phiên để phân tích` };
        }
        return { prediction: null, confidence: 0, reason: "Chưa phát hiện cầu rõ ràng" };
    }
    
    // Tính điểm có trọng số (cân bằng)
    let taiScore = 0, xiuScore = 0;
    let bestPattern = null;
    
    for (const p of patterns) {
        if (p.nextPrediction === 'Tài') taiScore += p.confidence;
        else xiuScore += p.confidence;
        
        if (!bestPattern || p.confidence > bestPattern.confidence) {
            bestPattern = p;
        }
    }
    
    const total = taiScore + xiuScore;
    let finalPrediction = taiScore > xiuScore ? 'Tài' : 'Xỉu';
    let finalConfidence = total > 0 ? Math.round((Math.max(taiScore, xiuScore) / total) * 100) : 65;
    finalConfidence = Math.min(94, Math.max(60, finalConfidence));
    
    return {
        prediction: finalPrediction,
        confidence: finalConfidence,
        bestPattern: bestPattern,
        allPatterns: patterns,
        scores: { tai: Math.round((taiScore / total) * 100), xiu: Math.round((xiuScore / total) * 100) }
    };
}

// ==================== HÀM XỬ LÝ CHÍNH ====================
function processGame(gameId, newData) {
    const history = gameHistory[gameId];
    const lastResult = latestResult[gameId];
    const stats = gameStats[gameId];
    
    // Lưu dữ liệu mới vào lịch sử
    const newEntry = {
        Phien: newData.phien,
        Xuc_xac_1: newData.dice[0],
        Xuc_xac_2: newData.dice[1],
        Xuc_xac_3: newData.dice[2],
        Tong_diem: newData.sum,
        Ket_qua: newData.result,
        Du_doan: null,
        Danh_gia: null,
        Id: ID_TAG
    };
    
    history.unshift(newEntry);
    if (history.length > MAX_HISTORY) history.pop();
    
    // Cập nhật kết quả hiện tại
    lastResult.Phien = newData.phien;
    lastResult.Xuc_xac_1 = newData.dice[0];
    lastResult.Xuc_xac_2 = newData.dice[1];
    lastResult.Xuc_xac_3 = newData.dice[2];
    lastResult.Tong_diem = newData.sum;
    lastResult.Pattern = newData.result;
    
    // ĐÁNH GIÁ DỰ ĐOÁN TRƯỚC ĐÓ (nếu có)
    if (history.length >= 2 && history[1].Du_doan) {
        const prevEntry = history[1];
        if (!prevEntry.Danh_gia) {
            stats.totalPredictions++;
            const wasCorrect = prevEntry.Du_doan === newData.result;
            if (wasCorrect) stats.totalWins++;
            else stats.totalLosses++;
            prevEntry.Danh_gia = wasCorrect ? 'Đúng ✅' : 'Sai ❌';
            console.log(`[${gameId.toUpperCase()}] Đánh giá phiên ${prevEntry.Phien}: Dự đoán ${prevEntry.Du_doan} → Thực tế ${newData.result} | ${wasCorrect ? '✅' : '❌'}`);
        }
    }
    
    // CHỈ DỰ ĐOÁN KHI ĐỦ 15 PHIÊN
    if (history.length >= MIN_PHIEN_TO_PREDICT) {
        // Phân tích cầu từ lịch sử
        const patterns = analyzePattern(history);
        const prediction = predictFromPatterns(patterns, history);
        
        if (prediction.prediction) {
            lastResult.Du_doan = prediction.prediction;
            lastResult.Du_doan_confidence = prediction.confidence;
            lastResult.Phien_hien_tai = newData.phien + 1;
            lastResult.Tong_du_doan = stats.totalPredictions;
            lastResult.Tong_thang = stats.totalWins;
            lastResult.Tong_thua = stats.totalLosses;
            lastResult.Status = `Đã phân tích ${history.length} phiên`;
            
            // Lưu dự đoán để đánh giá sau
            history[0].Du_doan = prediction.prediction;
            
            console.log(`[${gameId.toUpperCase()}] 🎯 Dự đoán phiên ${newData.phien + 1}: ${prediction.prediction} (${prediction.confidence}%)`);
            console.log(`   📊 Cầu phát hiện: ${prediction.bestPattern?.name || 'Không rõ'} | Độ tin: ${prediction.bestPattern?.confidence || 0}%`);
        } else {
            lastResult.Du_doan = "Chưa có";
            lastResult.Du_doan_confidence = 0;
            lastResult.Phien_hien_tai = newData.phien + 1;
            lastResult.Status = `Đã có ${history.length} phiên nhưng chưa phát hiện cầu rõ ràng`;
        }
    } else {
        // CHƯA ĐỦ 15 PHIÊN - KHÔNG DỰ ĐOÁN
        lastResult.Du_doan = "Chưa có";
        lastResult.Du_doan_confidence = 0;
        lastResult.Phien_hien_tai = newData.phien + 1;
        lastResult.Status = `Đang thu thập dữ liệu... (${history.length}/${MIN_PHIEN_TO_PREDICT} phiên)`;
    }
    
    lastResult.Tong_du_doan = stats.totalPredictions;
    lastResult.Tong_thang = stats.totalWins;
    lastResult.Tong_thua = stats.totalLosses;
    lastResult.Id = ID_TAG;
    
    console.log(`[${gameId.toUpperCase()}] 📥 Phiên ${newData.phien}: ${newData.dice[0]}+${newData.dice[1]}+${newData.dice[2]}=${newData.sum} (${newData.result}) | Đã có ${history.length}/${MIN_PHIEN_TO_PREDICT} phiên`);
}

// ==================== LẤY DỮ LIỆU API ====================
async function fetchData(apiUrl, gameName) {
    try {
        const response = await axios.get(apiUrl, { timeout: 15000 });
        const list = response.data?.list || [];
        if (!list.length) return null;
        
        return list.map(item => ({
            phien: item.id,
            result: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
            dice: [item.dices?.[0] || 0, item.dices?.[1] || 0, item.dices?.[2] || 0],
            sum: item.point || 0
        }));
    } catch (error) {
        return null;
    }
}

async function pollGames() {
    while (true) {
        for (const [gameId, url] of Object.entries(API_URLS)) {
            try {
                const data = await fetchData(url, gameId);
                if (data && data.length > 0) {
                    const latest = data[0];
                    if (lastProcessed[gameId] !== latest.phien) {
                        lastProcessed[gameId] = latest.phien;
                        processGame(gameId, latest);
                    }
                }
            } catch (err) {}
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
}

// ==================== API ENDPOINTS ====================
app.get('/', (req, res) => {
    res.json({
        name: "🎲 LC79 & BETVIP CAU ANALYZER",
        author: ID_TAG,
        status: "running",
        min_phien_to_predict: MIN_PHIEN_TO_PREDICT,
        games: ["lc79_hu", "lc79_md5", "betvip_hu", "betvip_md5"],
        endpoints: {
            "/api/:game": "Dự đoán (chỉ khi đủ 15 phiên)",
            "/api/:game/history": "Lịch sử",
            "/api/:game/stats": "Thống kê",
            "/api/:game/patterns": "Phân tích cầu hiện tại"
        }
    });
});

app.get('/api/:game', (req, res) => {
    const game = req.params.game;
    if (!latestResult[game]) return res.status(404).json({ error: "Game not found" });
    res.json(latestResult[game]);
});

app.get('/api/:game/history', (req, res) => {
    const game = req.params.game;
    if (!gameHistory[game]) return res.status(404).json({ error: "Game not found" });
    res.json({
        game: game,
        totalPhien: gameHistory[game].length,
        minRequired: MIN_PHIEN_TO_PREDICT,
        canPredict: gameHistory[game].length >= MIN_PHIEN_TO_PREDICT,
        totalPredictions: gameStats[game].totalPredictions,
        wins: gameStats[game].totalWins,
        losses: gameStats[game].totalLosses,
        accuracy: gameStats[game].totalPredictions > 0 ? ((gameStats[game].totalWins / gameStats[game].totalPredictions) * 100).toFixed(1) + '%' : '0%',
        history: gameHistory[game]
    });
});

app.get('/api/:game/stats', (req, res) => {
    const game = req.params.game;
    if (!gameStats[game]) return res.status(404).json({ error: "Game not found" });
    res.json({
        game: game,
        totalPhien: gameHistory[game].length,
        minRequired: MIN_PHIEN_TO_PREDICT,
        canPredict: gameHistory[game].length >= MIN_PHIEN_TO_PREDICT,
        totalPredictions: gameStats[game].totalPredictions,
        wins: gameStats[game].totalWins,
        losses: gameStats[game].totalLosses,
        accuracy: gameStats[game].totalPredictions > 0 ? ((gameStats[game].totalWins / gameStats[game].totalPredictions) * 100).toFixed(1) + '%' : '0%',
        currentPrediction: latestResult[game].Du_doan,
        status: latestResult[game].Status
    });
});

app.get('/api/:game/patterns', (req, res) => {
    const game = req.params.game;
    if (!gameHistory[game]) return res.status(404).json({ error: "Game not found" });
    
    if (gameHistory[game].length < MIN_PHIEN_TO_PREDICT) {
        return res.json({
            game: game,
            canAnalyze: false,
            message: `Cần ${MIN_PHIEN_TO_PREDICT} phiên để phân tích cầu. Hiện có: ${gameHistory[game].length}`,
            currentPhien: gameHistory[game].length
        });
    }
    
    const patterns = analyzePattern(gameHistory[game]);
    const prediction = predictFromPatterns(patterns, gameHistory[game]);
    
    res.json({
        game: game,
        canAnalyze: true,
        totalPhien: gameHistory[game].length,
        patterns: patterns,
        prediction: prediction.prediction ? {
            du_doan: prediction.prediction,
            do_tin_cay: prediction.confidence + '%',
            best_pattern: prediction.bestPattern,
            voting: prediction.scores
        } : null
    });
});

// ==================== KHỞI ĐỘNG ====================
console.log("🚀 Khởi động LC79 & BETVIP Cầu Analyzer API...");
console.log(`📊 Yêu cầu tối thiểu: ${MIN_PHIEN_TO_PREDICT} phiên để bắt đầu dự đoán`);
console.log("🔄 Bắt đầu thu thập dữ liệu...");

pollGames();

app.listen(PORT, () => {
    console.log(`\n✅ Server running on port ${PORT}`);
    console.log(`📌 ID: ${ID_TAG}`);
    console.log(`\n📡 CÁC API:\n`);
    console.log(`   🎰 LC79 HŨ: http://localhost:${PORT}/api/lc79_hu`);
    console.log(`   🔑 LC79 MD5: http://localhost:${PORT}/api/lc79_md5`);
    console.log(`   💎 BETVIP HŨ: http://localhost:${PORT}/api/betvip_hu`);
    console.log(`   🔐 BETVIP MD5: http://localhost:${PORT}/api/betvip_md5`);
    console.log(`\n📊 PHÂN TÍCH CẦU: http://localhost:${PORT}/api/lc79_hu/patterns`);
    console.log(`\n⏳ Cần ${MIN_PHIEN_TO_PREDICT} phiên để bắt đầu dự đoán!\n`);
});
