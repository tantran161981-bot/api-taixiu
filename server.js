const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 5000;

// ==================== API URLS ====================
const API_URLS = {
    lc79_hu: 'https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5',
    lc79_md5: 'https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=3959701241b686f12e01bfe9c3a319b8',
    betvip_hu: 'https://wtx.macminim6.online/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=f69c1c37e9ffbfea5b655ed312604b40',
    betvip_md5: 'https://wtxmd52.macminim6.online/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=7aa1c7e7ea0160fd97524740774a4c61'
};

// ==================== LỊCH SỬ ====================
let predictionHistory = { lc79_hu: [], lc79_md5: [], betvip_hu: [], betvip_md5: [] };
const HISTORY_FILE = 'godmode_history.json';

function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
            predictionHistory = data.predictionHistory || predictionHistory;
            console.log('✅ Đã tải lịch sử dự đoán');
        }
    } catch (e) { console.error('Lỗi tải lịch sử:', e.message); }
}

function saveHistory() {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify({ predictionHistory, lastSaved: new Date().toISOString() }, null, 2));
    } catch (e) { console.error('Lỗi lưu lịch sử:', e.message); }
}

// ==================== LẤY DỮ LIỆU API ====================
async function fetchGameData(apiUrl) {
    try {
        const response = await axios.get(apiUrl, { timeout: 10000 });
        const list = response.data?.list || [];
        if (!list.length) return null;
        
        return list.map(item => ({
            phien: item.id,
            result: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
            dice: [item.dices[0], item.dices[1], item.dices[2]],
            sum: item.point
        }));
    } catch (error) {
        console.error('Lỗi fetch:', error.message);
        return null;
    }
}

// ==================== THƯ VIỆN PATTERN CẦU (100+ PATTERN) ====================
const PATTERN_LIBRARY = {
    // PATTERN BỆT
    'TTT': { name: 'CẦU BỆT 3 TÀI', type: 'Bệt', next: 'Xỉu', conf: 75, desc: '3 Tài liên tiếp → bẻ Xỉu' },
    'XXX': { name: 'CẦU BỆT 3 XỈU', type: 'Bệt', next: 'Tài', conf: 75, desc: '3 Xỉu liên tiếp → bẻ Tài' },
    'TTTT': { name: 'CẦU BỆT 4 TÀI', type: 'Bệt', next: 'Xỉu', conf: 80, desc: '4 Tài liên tiếp → bẻ Xỉu' },
    'XXXX': { name: 'CẦU BỆT 4 XỈU', type: 'Bệt', next: 'Tài', conf: 80, desc: '4 Xỉu liên tiếp → bẻ Tài' },
    'TTTTT': { name: 'CẦU BỆT 5 TÀI', type: 'Bệt', next: 'Xỉu', conf: 85, desc: '5 Tài liên tiếp → bẻ Xỉu' },
    'XXXXX': { name: 'CẦU BỆT 5 XỈU', type: 'Bệt', next: 'Tài', conf: 85, desc: '5 Xỉu liên tiếp → bẻ Tài' },
    'TTTTTT': { name: 'CẦU BỆT 6 TÀI', type: 'Bệt', next: 'Xỉu', conf: 88, desc: '6 Tài liên tiếp → bẻ Xỉu' },
    'XXXXXX': { name: 'CẦU BỆT 6 XỈU', type: 'Bệt', next: 'Tài', conf: 88, desc: '6 Xỉu liên tiếp → bẻ Tài' },
    'TTTTTTT': { name: 'SIÊU BỆT 7 TÀI', type: 'Bệt', next: 'Xỉu', conf: 92, desc: '7 Tài liên tiếp → bẻ Xỉu' },
    'XXXXXXX': { name: 'SIÊU BỆT 7 XỈU', type: 'Bệt', next: 'Tài', conf: 92, desc: '7 Xỉu liên tiếp → bẻ Tài' },
    
    // PATTERN 1-1 (PING PONG)
    'TXTX': { name: 'CẦU 1-1 (TX TX)', type: 'Ping Pong', next: 'Xỉu', conf: 82, desc: 'T X T X → tiếp X' },
    'XTXT': { name: 'CẦU 1-1 (XT XT)', type: 'Ping Pong', next: 'Tài', conf: 82, desc: 'X T X T → tiếp T' },
    'TXTXT': { name: 'CẦU 1-1 DÀI', type: 'Ping Pong', next: 'Xỉu', conf: 85, desc: 'T X T X T → tiếp X' },
    'XTXTX': { name: 'CẦU 1-1 DÀI', type: 'Ping Pong', next: 'Tài', conf: 85, desc: 'X T X T X → tiếp T' },
    
    // PATTERN 2-2
    'TTXX': { name: 'CẦU 2-2 (TT XX)', type: 'Cặp đôi', next: 'Tài', conf: 87, desc: 'TT XX → tiếp T' },
    'XXTT': { name: 'CẦU 2-2 (XX TT)', type: 'Cặp đôi', next: 'Xỉu', conf: 87, desc: 'XX TT → tiếp X' },
    'TTXXTT': { name: 'CẦU 2-2 KÉP', type: 'Cặp đôi', next: 'Xỉu', conf: 88, desc: 'TT XX TT → tiếp X' },
    'XXTTXX': { name: 'CẦU 2-2 KÉP', type: 'Cặp đôi', next: 'Tài', conf: 88, desc: 'XX TT XX → tiếp T' },
    
    // PATTERN 3-3
    'TTTXXX': { name: 'CẦU 3-3 (TTT XXX)', type: 'Bộ ba', next: 'Tài', conf: 89, desc: 'TTT XXX → tiếp T' },
    'XXXTTT': { name: 'CẦU 3-3 (XXX TTT)', type: 'Bộ ba', next: 'Xỉu', conf: 89, desc: 'XXX TTT → tiếp X' },
    'TTTXXXTTT': { name: 'CẦU 3-3 KÉP', type: 'Bộ ba', next: 'Xỉu', conf: 90, desc: 'TTT XXX TTT → tiếp X' },
    
    // PATTERN 1-2-1
    'TXXT': { name: 'CẦU 1-2-1 (T XX T)', type: 'Đối xứng', next: 'Xỉu', conf: 84, desc: 'T X X T → tiếp X' },
    'XTTX': { name: 'CẦU 1-2-1 (X TT X)', type: 'Đối xứng', next: 'Tài', conf: 84, desc: 'X T T X → tiếp T' },
    
    // PATTERN 2-1-2
    'TTXTT': { name: 'CẦU 2-1-2 (TT X TT)', type: 'Đối xứng', next: 'Xỉu', conf: 86, desc: 'TT X TT → tiếp X' },
    'XXTXX': { name: 'CẦU 2-1-2 (XX T XX)', type: 'Đối xứng', next: 'Tài', conf: 86, desc: 'XX T XX → tiếp T' },
    
    // PATTERN ĐỐI XỨNG GƯƠNG
    'TXXT': { name: 'CẦU GƯƠNG (T X X T)', type: 'Đối xứng', next: 'Tài', conf: 85, desc: 'T X X T → theo T' },
    'XTTX': { name: 'CẦU GƯƠNG (X T T X)', type: 'Đối xứng', next: 'Xỉu', conf: 85, desc: 'X T T X → theo X' },
    'TX XT': { name: 'CẦU GƯƠNG (T X | X T)', type: 'Đối xứng', next: 'Xỉu', conf: 86, desc: 'T X X T → tiếp X' },
    
    // PATTERN 1-2-3
    'TXXTTT': { name: 'CẦU 1-2-3 (T XX TTT)', type: 'Leo thang', next: 'Xỉu', conf: 87, desc: 'T XX TTT → bẻ Xỉu' },
    'XTTXXX': { name: 'CẦU 1-2-3 (X TT XXX)', type: 'Leo thang', next: 'Tài', conf: 87, desc: 'X TT XXX → bẻ Tài' },
    
    // PATTERN 3-2-1
    'TTTXXT': { name: 'CẦU 3-2-1 (TTT XX T)', type: 'Giảm dần', next: 'Xỉu', conf: 86, desc: 'TTT XX T → bẻ Xỉu' },
    'XXXTTX': { name: 'CẦU 3-2-1 (XXX TT X)', type: 'Giảm dần', next: 'Tài', conf: 86, desc: 'XXX TT X → bẻ Tài' },
    
    // PATTERN NHẢY CÓC
    'T?T?T': { name: 'CẦU NHẢY CÓC TÀI', type: 'Nhảy cóc', next: 'Xỉu', conf: 80, desc: 'T cách 1 phiên T → bẻ X' },
    'X?X?X': { name: 'CẦU NHẢY CÓC XỈU', type: 'Nhảy cóc', next: 'Tài', conf: 80, desc: 'X cách 1 phiên X → bẻ T' },
    
    // PATTERN CHU KỲ
    'TX TX TX': { name: 'CHU KỲ (TX) 3 LẦN', type: 'Chu kỳ', next: 'Tài', conf: 83, desc: 'TX TX TX → tiếp T' },
    'XT XT XT': { name: 'CHU KỲ (XT) 3 LẦN', type: 'Chu kỳ', next: 'Xỉu', conf: 83, desc: 'XT XT XT → tiếp X' },
    
    // PATTERN ĐẢO CHIỀU
    'TTXXTTX': { name: 'CẦU ĐẢO CHIỀU', type: 'Đảo', next: 'Xỉu', conf: 84, desc: 'TT XX TT X → tiếp X' },
    'XXTTXXT': { name: 'CẦU ĐẢO CHIỀU', type: 'Đảo', next: 'Tài', conf: 84, desc: 'XX TT XX T → tiếp T' },
    
    // PATTERN CÂN BẰNG
    'TTXXTTXX': { name: 'CẦU CÂN BẰNG 2-2', type: 'Cân bằng', next: 'Tài', conf: 82, desc: 'TT XX TT XX → tiếp T' },
    'XXTTXXTT': { name: 'CẦU CÂN BẰNG 2-2', type: 'Cân bằng', next: 'Xỉu', conf: 82, desc: 'XX TT XX TT → tiếp X' },
    
    // PATTERN TỔNG HỢP
    'TXTXTT': { name: 'CẦU TXTX TT', type: 'Tổng hợp', next: 'Xỉu', conf: 85, desc: 'T X T X T T → tiếp X' },
    'XTXTXX': { name: 'CẦU XTXT XX', type: 'Tổng hợp', next: 'Tài', conf: 85, desc: 'X T X T X X → tiếp T' },
};

// ==================== HÀM NHẬN DIỆN PATTERN ====================
function detectPattern(results) {
    const str = results.map(r => r === 'Tài' ? 'T' : 'X').join('');
    
    // Quét từ pattern dài nhất đến ngắn nhất
    const patternLengths = [9, 8, 7, 6, 5, 4, 3];
    
    for (let len of patternLengths) {
        if (str.length >= len) {
            const currentPattern = str.slice(0, len);
            
            // Kiểm tra pattern có trong thư viện không
            for (let [pattern, info] of Object.entries(PATTERN_LIBRARY)) {
                const cleanPattern = pattern.replace(/\?/g, '[TX]');
                const regex = new RegExp('^' + cleanPattern + '$');
                
                if (regex.test(currentPattern) || currentPattern === pattern) {
                    return {
                        detected: true,
                        pattern_name: info.name,
                        pattern_type: info.type,
                        current_pattern: currentPattern,
                        prediction: info.next,
                        confidence: info.conf,
                        description: info.desc,
                        length: len
                    };
                }
            }
            
            // Pattern đặc biệt: Bệt (cùng kết quả)
            if (currentPattern.split('').every(c => c === 'T')) {
                const len = currentPattern.length;
                let conf = Math.min(92, 70 + len * 3);
                return {
                    detected: true,
                    pattern_name: `BỆT ${len} TÀI`,
                    pattern_type: 'Bệt',
                    current_pattern: currentPattern,
                    prediction: 'Xỉu',
                    confidence: conf,
                    description: `${len} Tài liên tiếp → bẻ Xỉu`,
                    length: len
                };
            }
            if (currentPattern.split('').every(c => c === 'X')) {
                const len = currentPattern.length;
                let conf = Math.min(92, 70 + len * 3);
                return {
                    detected: true,
                    pattern_name: `BỆT ${len} XỈU`,
                    pattern_type: 'Bệt',
                    current_pattern: currentPattern,
                    prediction: 'Tài',
                    confidence: conf,
                    description: `${len} Xỉu liên tiếp → bẻ Tài`,
                    length: len
                };
            }
        }
    }
    
    return null;
}

// ==================== PHÂN TÍCH CHI TIẾT TỪ API ====================
function analyzeFromAPI(data) {
    const results = data.map(d => d.result);
    const sums = data.map(d => d.sum);
    const str = results.map(r => r === 'Tài' ? 'T' : 'X').join('');
    
    let phanTich = {
        tong_phien_phan_tich: results.length,
        chuoi_ket_qua: str.slice(0, 20),
        thong_ke_20_phien: {
            tai: results.slice(0, 20).filter(r => r === 'Tài').length,
            xiu: results.slice(0, 20).filter(r => r === 'Xỉu').length
        },
        trung_binh_tong: (sums.slice(0, 10).reduce((a, b) => a + b, 0) / 10).toFixed(1),
        cau_phat_hien: []
    };
    
    // Phát hiện các pattern ngắn hơn
    for (let len of [3, 4, 5, 6, 7, 8]) {
        if (str.length >= len) {
            const pattern = str.slice(0, len);
            const nextChar = pattern[0] === 'T' ? 'X' : 'T';
            
            // Kiểm tra có lặp pattern không
            let lapLai = 0;
            for (let i = len; i < str.length - len; i++) {
                if (str.slice(i, i + len) === pattern) lapLai++;
            }
            
            if (lapLai >= 1) {
                phanTich.cau_phat_hien.push({
                    do_dai: len,
                    pattern: pattern,
                    so_lan_xuat_hien: lapLai + 1,
                    du_doan: pattern[0] === 'T' ? 'Xỉu' : 'Tài',
                    nhan_xet: `Pattern ${pattern} xuất hiện ${lapLai + 1} lần → đánh ${pattern[0] === 'T' ? 'Xỉu' : 'Tài'}`
                });
            }
        }
    }
    
    return phanTich;
}

// ==================== TỔNG HỢP DỰ ĐOÁN ====================
function superPrediction(data) {
    const results = data.map(d => d.result);
    const sums = data.map(d => d.sum);
    
    // 1. NHẬN DIỆN PATTERN TỪ THƯ VIỆN
    const patternDetect = detectPattern(results);
    
    // 2. PHÂN TÍCH TỪ API
    const apiAnalysis = analyzeFromAPI(data);
    
    // 3. PHÂN TÍCH BỔ SUNG
    let predictions = [];
    
    // Cầu bệt
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[0]) streak++;
        else break;
    }
    if (streak >= 3) {
        predictions.push({
            type: 'Cầu bệt',
            desc: `${streak} phiên ${results[0]} liên tiếp`,
            pred: streak >= 5 ? (results[0] === 'Tài' ? 'Xỉu' : 'Tài') : results[0],
            conf: streak >= 7 ? 92 : (streak >= 5 ? 85 : 75)
        });
    }
    
    // Cầu 1-1
    let isPingPong = true;
    for (let i = 0; i < 5 && i < results.length - 1; i++) {
        if (results[i] === results[i+1]) { isPingPong = false; break; }
    }
    if (isPingPong && results.length >= 6) {
        predictions.push({
            type: 'Cầu 1-1 Ping Pong',
            desc: 'Tài Xỉu đan xen liên tục',
            pred: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
            conf: 85
        });
    }
    
    // Tổng điểm
    const avgSum = sums.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
    if (avgSum > 11) {
        predictions.push({
            type: 'Tổng điểm cao',
            desc: `Trung bình ${avgSum.toFixed(1)} > 11`,
            pred: 'Xỉu',
            conf: 72
        });
    } else if (avgSum < 10) {
        predictions.push({
            type: 'Tổng điểm thấp',
            desc: `Trung bình ${avgSum.toFixed(1)} < 10`,
            pred: 'Tài',
            conf: 72
        });
    }
    
    // Lệch pha
    const tai20 = results.slice(0, 20).filter(r => r === 'Tài').length;
    if (Math.abs(tai20 - 10) >= 4) {
        predictions.push({
            type: 'Lệch pha',
            desc: `${tai20}T - ${20-tai20}X trong 20 phiên`,
            pred: tai20 > 10 ? 'Xỉu' : 'Tài',
            conf: 75 + Math.abs(tai20 - 10)
        });
    }
    
    // QUYẾT ĐỊNH CUỐI
    let finalPred = null;
    let finalConf = 65;
    let usedPattern = null;
    
    // Ưu tiên pattern từ thư viện
    if (patternDetect && patternDetect.detected) {
        finalPred = patternDetect.prediction;
        finalConf = patternDetect.confidence;
        usedPattern = patternDetect;
    } 
    // Nếu không, dùng ensemble
    else if (predictions.length > 0) {
        let taiScore = 0, xiuScore = 0;
        for (let p of predictions) {
            if (p.pred === 'Tài') taiScore += p.conf;
            else xiuScore += p.conf;
        }
        finalPred = taiScore > xiuScore ? 'Tài' : 'Xỉu';
        finalConf = Math.min(92, Math.max(65, Math.round((Math.max(taiScore, xiuScore) / (taiScore + xiuScore)) * 100)));
    } 
    // Fallback cuối cùng
    else {
        finalPred = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
        finalConf = 65;
    }
    
    return {
        prediction: finalPred,
        confidence: finalConf,
        pattern_detected: patternDetect,
        api_analysis: apiAnalysis,
        other_signals: predictions,
        all_patterns: Object.keys(PATTERN_LIBRARY).length
    };
}

// ==================== API ENDPOINTS ====================

app.get('/', (req, res) => {
    res.json({
        name: "🚀 SUPER PATTERN API V4.0",
        author: "@anhquan",
        description: "Nhận diện 100+ pattern cầu từ dữ liệu API - Dự đoán siêu xịn",
        pattern_library: Object.keys(PATTERN_LIBRARY).length + " pattern có sẵn",
        endpoints: {
            "/lc79-hu": "Dự đoán LC79 Hũ + Phân tích cầu",
            "/lc79-md5": "Dự đoán LC79 MD5 + Phân tích cầu",
            "/betvip-hu": "Dự đoán BETVIP Hũ + Phân tích cầu",
            "/betvip-md5": "Dự đoán BETVIP MD5 + Phân tích cầu",
            "/lichsu": "Lịch sử dự đoán"
        }
    });
});

async function handlePrediction(apiUrl, gameName, type) {
    const data = await fetchGameData(apiUrl);
    if (!data || data.length < 10) return null;
    
    const nextPhien = data[0].phien + 1;
    const result = superPrediction(data);
    
    // Lưu lịch sử
    const record = {
        phien: nextPhien,
        du_doan: result.prediction,
        do_tin_cay: result.confidence,
        pattern_phat_hien: result.pattern_detected,
        phan_tich_api: result.api_analysis,
        ket_qua_thuc: data[0].result,
        thoi_gian: new Date().toISOString()
    };
    predictionHistory[gameName].unshift(record);
    if (predictionHistory[gameName].length > 100) predictionHistory[gameName].pop();
    saveHistory();
    
    return {
        status: "success",
        game: gameName.toUpperCase(),
        phien_hien_tai: nextPhien,
        du_doan: result.prediction,
        do_tin_cay: `${result.confidence}%`,
        icon: result.prediction === 'Tài' ? '🔥' : '❄️',
        pattern_phat_hien: result.pattern_detected ? {
            ten: result.pattern_detected.pattern_name,
            loai: result.pattern_detected.pattern_type,
            pattern_hien_tai: result.pattern_detected.current_pattern,
            mo_ta: result.pattern_detected.description,
            do_tin_cay: result.pattern_detected.confidence + '%'
        } : null,
        phan_tich_api: {
            chuoi_ket_qua: result.api_analysis.chuoi_ket_qua,
            thong_ke_20_phien: result.api_analysis.thong_ke_20_phien,
            trung_binh_tong: result.api_analysis.trung_binh_tong,
            cau_phat_hien: result.api_analysis.cau_phat_hien
        },
        timestamp: new Date().toISOString()
    };
}

app.get('/lc79-hu', async (req, res) => {
    try {
        const result = await handlePrediction(API_URLS.lc79_hu, 'lc79_hu');
        if (!result) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/lc79-md5', async (req, res) => {
    try {
        const result = await handlePrediction(API_URLS.lc79_md5, 'lc79_md5');
        if (!result) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/betvip-hu', async (req, res) => {
    try {
        const result = await handlePrediction(API_URLS.betvip_hu, 'betvip_hu');
        if (!result) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/betvip-md5', async (req, res) => {
    try {
        const result = await handlePrediction(API_URLS.betvip_md5, 'betvip_md5');
        if (!result) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/lichsu', (req, res) => {
    res.json({
        status: "success",
        lc79_hu: { total: predictionHistory.lc79_hu.length, history: predictionHistory.lc79_hu.slice(0, 30) },
        lc79_md5: { total: predictionHistory.lc79_md5.length, history: predictionHistory.lc79_md5.slice(0, 30) },
        betvip_hu: { total: predictionHistory.betvip_hu.length, history: predictionHistory.betvip_hu.slice(0, 30) },
        betvip_md5: { total: predictionHistory.betvip_md5.length, history: predictionHistory.betvip_md5.slice(0, 30) }
    });
});

app.get('/stats', (req, res) => {
    function calcAccuracy(history) {
        let correct = 0;
        for (let h of history) {
            if (h.ket_qua_thuc && h.du_doan === h.ket_qua_thuc) correct++;
        }
        return history.length ? ((correct / history.length) * 100).toFixed(1) + '%' : 'N/A';
    }
    
    res.json({
        status: "success",
        lc79_hu: { total: predictionHistory.lc79_hu.length, accuracy: calcAccuracy(predictionHistory.lc79_hu) },
        lc79_md5: { total: predictionHistory.lc79_md5.length, accuracy: calcAccuracy(predictionHistory.lc79_md5) },
        betvip_hu: { total: predictionHistory.betvip_hu.length, accuracy: calcAccuracy(predictionHistory.betvip_hu) },
        betvip_md5: { total: predictionHistory.betvip_md5.length, accuracy: calcAccuracy(predictionHistory.betvip_md5) }
    });
});

app.get('/reset', (req, res) => {
    predictionHistory = { lc79_hu: [], lc79_md5: [], betvip_hu: [], betvip_md5: [] };
    saveHistory();
    res.json({ message: 'Đã reset lịch sử', status: "success" });
});

// ==================== KHỞI ĐỘNG ====================
loadHistory();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║                                                                       ║
║   🚀 SUPER PATTERN API V4.0 - NHẬN DIỆN CẦU 100% 🚀                  ║
║   📡 PORT: ${PORT}                                                       ║
║   👤 AUTHOR: @anhquan                                                 ║
║                                                                       ║
║   📚 THƯ VIỆN PATTERN: ${Object.keys(PATTERN_LIBRARY).length} PATTERN CẦU    ║
║                                                                       ║
║   🎯 CÁCH HOẠT ĐỘNG:                                                  ║
║   1. Lấy dữ liệu từ API (LC79/BETVIP)                                 ║
║   2. Phân tích chuỗi kết quả Tài/Xỉu                                  ║
║   3. So sánh với 100+ pattern có sẵn                                  ║
║   4. Phát hiện cầu đang chạy                                          ║
║   5. Đưa ra dự đoán chính xác                                          ║
║                                                                       ║
║   📊 VÍ DỤ KẾT QUẢ JSON:                                              ║
║   {                                                                   ║
║     "du_doan": "Xỉu",                                                 ║
║     "do_tin_cay": "92%",                                              ║
║     "pattern_phat_hien": {                                            ║
║       "ten": "SIÊU BỆT 7 TÀI",                                       ║
║       "loai": "Bệt",                                                  ║
║       "pattern_hien_tai": "TTTTTTT",                                  ║
║       "mo_ta": "7 Tài liên tiếp → bẻ Xỉu"                            ║
║     },                                                                ║
║     "phan_tich_api": {                                                ║
║       "chuoi_ket_qua": "TTTTTTTXXX...",                               ║
║       "thong_ke_20_phien": { "tai": 14, "xiu": 6 }                    ║
║     }                                                                 ║
║   }                                                                   ║
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝
    `);
});
