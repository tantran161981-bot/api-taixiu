const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const os = require('os');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3001;

let apiResponseData = {
    "Phien": null,
    "Xuc_xac_1": null,
    "Xuc_xac_2": null,
    "Xuc_xac_3": null,
    "Tong": null,
    "Ket_qua": "",
    "id": "@cskh_huydaixu",
    "server_time": new Date().toISOString()
};

let currentSessionId = null;
const patternHistory = []; // lưu tối đa 100 phiên

const WEBSOCKET_URL = "wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu9mX_hZMZ_m5gMNhkw0";
const WS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Origin": "https://play.sun.win"
};
const RECONNECT_DELAY = 2500;
const PING_INTERVAL = 15000;

const initialMessages = [
    [
        1,
        "MiniGame",
        "GM_apivopnhaan",
        "WangLin",
        {
            "info": "{\"ipAddress\":\"113.185.45.88\",\"wsToken\":\"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJwbGFtYW1hIiwiYm90IjowLCJpc01lcmNoYW50IjpmYWxzZSwidmVyaWZpZWRCYW5rQWNjb3VudCI6ZmFsc2UsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6MzMxNDgxMTYyLCJhZmZJZCI6IkdFTVdJTiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoiZ2VtIiwidGltZXN0YW1wIjoxNzY2NDc0NzgwMDA2LCJsb2NrR2FtZXMiOltdLCJhbW91bnQiOjAsImxvY2tDaGF0IjpmYWxzZSwicGhvbmVWZXJpZmllZCI6ZmFsc2UsImlwQWRkcmVzcyI6IjExMy4xODUuNDUuODgiLCJtdXRlIjpmYWxzZSwiYXZhdGFyIjoiaHR0cHM6Ly9pbWFnZXMuc3dpbnNob3AubmV0L2ltYWdlcy9hdmF0YXIvYXZhdGFyXzE4LnBuZyIsInBsYXRmb3JtSWQiOjUsInVzZXJJZCI6IjZhOGI0ZDM4LTFlYzEtNDUxYi1hYTA1LWYyZDkwYWFhNGM1MCIsInJlZ1RpbWUiOjE3NjY0NzQ3NTEzOTEsInBob25lIjoiIiwiZGVwb3NpdCI6ZmFsc2UsInVzZXJuYW1lIjoiR01fYXBpdm9wbmhhYW4ifQ.YFOscbeojWNlRo7490BtlzkDGYmwVpnlgOoh04oCJy4\",\"locale\":\"vi\",\"userId\":\"6a8b4d38-1ec1-451b-aa05-f2d90aaa4c50\",\"username\":\"GM_apivopnhaan\",\"timestamp\":1766474780007,\"refreshToken\":\"63d5c9be0c494b74b53ba150d69039fd.7592f06d63974473b4aaa1ea849b2940\"}",
            "signature": "66772A1641AA8B18BD99207CE448EA00ECA6D8A4D457C1FF13AB092C22C8DECF0C0014971639A0FBA9984701A91FCCBE3056ABC1BE1541D1C198AA18AF3C45595AF6601F8B048947ADF8F48A9E3E074162F9BA3E6C0F7543D38BD54FD4C0A2C56D19716CC5353BBC73D12C3A92F78C833F4EFFDC4AB99E55C77AD2CDFA91E296"
        }
    ],
    [6, "MiniGame", "taixiuPlugin", { cmd: 1005 }],
    [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }]
];

let ws = null;
let pingInterval = null;
let reconnectTimeout = null;

// Helper: lấy IP local
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const iface of Object.values(interfaces)) {
        for (const alias of iface) {
            if (alias.family === 'IPv4' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return '127.0.0.1';
}

// Kết nối WebSocket
function connectWebSocket() {
    if (ws) {
        ws.removeAllListeners();
        ws.close();
    }

    ws = new WebSocket(WEBSOCKET_URL, { headers: WS_HEADERS });

    ws.on('open', () => {
        console.log('[✅] WebSocket connected to Sun.Win');
        initialMessages.forEach((msg, i) => {
            setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(msg));
                }
            }, i * 600);
        });

        clearInterval(pingInterval);
        pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.ping();
        }, PING_INTERVAL);
    });

    ws.on('pong', () => console.log('[📶] Ping OK'));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (!Array.isArray(data) || typeof data[1] !== 'object') return;

            const { cmd, sid, d1, d2, d3, gBB } = data[1];

            if (cmd === 1008 && sid) currentSessionId = sid;
            if (cmd === 1003 && gBB && d1 && d2 && d3) {
                const total = d1 + d2 + d3;
                const result = total > 10 ? "Tài" : "Xỉu";

                apiResponseData = {
                    "Phien": currentSessionId,
                    "Xuc_xac_1": d1,
                    "Xuc_xac_2": d2,
                    "Xuc_xac_3": d3,
                    "Tong": total,
                    "Ket_qua": result,
                    "id": "@cskh_huydaixu",
                    "server_time": new Date().toISOString(),
                    "update_count": (apiResponseData.update_count || 0) + 1
                };

                console.log(`[🎲] Phiên ${currentSessionId}: ${d1}-${d2}-${d3} = ${total} (${result})`);

                // Lưu vào history (giữ 100 phiên)
                patternHistory.push({
                    session: currentSessionId,
                    dice: [d1, d2, d3],
                    total: total,
                    result: result,
                    timestamp: new Date().toISOString()
                });
                if (patternHistory.length > 100) patternHistory.shift();

                currentSessionId = null;
            }
        } catch (e) {
            console.error('[❌] Lỗi xử lý message:', e.message);
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`[🔌] WebSocket closed. Code: ${code}, Reason: ${reason.toString()}`);
        clearInterval(pingInterval);
        clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(connectWebSocket, RECONNECT_DELAY);
    });

    ws.on('error', (err) => {
        console.error('[❌] WebSocket error:', err.message);
        ws.close();
    });
}

// ========== THUẬT TOÁN DỰ ĐOÁN AI TỰ HỌC ==========
function getResultSequence(history) {
    return history.map(item => item.result === "Tài" ? "T" : "X").join('');
}

function markovPredict(sequence, order = 4) {
    if (sequence.length < order + 1) return null;
    const lastPattern = sequence.slice(-order);
    const transitions = {};
    for (let i = 0; i <= sequence.length - order - 1; i++) {
        const pattern = sequence.slice(i, i + order);
        const next = sequence[i + order];
        if (!transitions[pattern]) transitions[pattern] = { T: 0, X: 0 };
        transitions[pattern][next]++;
    }
    const possible = transitions[lastPattern];
    if (!possible) return null;
    const total = possible.T + possible.X;
    if (total === 0) return null;
    const probTai = possible.T / total;
    const prediction = probTai > 0.5 ? "Tài" : (probTai < 0.5 ? "Xỉu" : (Math.random() < 0.5 ? "Tài" : "Xỉu"));
    const confidence = (Math.max(possible.T, possible.X) / total) * 100;
    return { prediction, confidence: Math.round(confidence) };
}

function frequencyPredict(history, windowSize = 20) {
    const recent = history.slice(-windowSize);
    const taiCount = recent.filter(h => h.result === "Tài").length;
    const xiuCount = windowSize - taiCount;
    const total = taiCount + xiuCount;
    if (total === 0) return null;
    const probTai = taiCount / total;
    const prediction = probTai > 0.5 ? "Tài" : (probTai < 0.5 ? "Xỉu" : (Math.random() < 0.5 ? "Tài" : "Xỉu"));
    const confidence = Math.abs(probTai - 0.5) * 2 * 100;
    return { prediction, confidence: Math.min(95, Math.max(50, confidence)) };
}

function cyclePredict(sequence, maxCycle = 10) {
    for (let cycle = 3; cycle <= maxCycle; cycle++) {
        if (sequence.length < cycle * 2) continue;
        const recentCycle = sequence.slice(-cycle);
        let matches = 0;
        for (let i = 0; i <= sequence.length - cycle - 1; i++) {
            if (sequence.slice(i, i + cycle) === recentCycle) matches++;
        }
        if (matches >= 2) {
            const nextIndex = sequence.lastIndexOf(recentCycle) + cycle;
            if (nextIndex < sequence.length) {
                const nextResult = sequence[nextIndex];
                const prediction = nextResult === 'T' ? "Tài" : "Xỉu";
                return { prediction, confidence: 70 + Math.min(25, matches * 5) };
            }
        }
    }
    return null;
}

function combinedPredict(history) {
    if (history.length < 10) return { prediction: "Chưa đủ dữ liệu", confidence: 0 };
    const seq = getResultSequence(history);
    const markov = markovPredict(seq, 4);
    const freq = frequencyPredict(history, 20);
    const cycle = cyclePredict(seq, 8);
    
    let scores = { Tài: 0, Xỉu: 0 };
    let totalWeight = 0;
    if (markov) {
        scores[markov.prediction] += 0.5 * (markov.confidence / 100);
        totalWeight += 0.5;
    }
    if (freq) {
        scores[freq.prediction] += 0.3 * (freq.confidence / 100);
        totalWeight += 0.3;
    }
    if (cycle) {
        scores[cycle.prediction] += 0.2 * (cycle.confidence / 100);
        totalWeight += 0.2;
    }
    if (totalWeight === 0) return { prediction: "Xỉu", confidence: 50 };
    const finalPrediction = scores.Tài > scores.Xỉu ? "Tài" : "Xỉu";
    const confidence = Math.round((Math.max(scores.Tài, scores.Xỉu) / totalWeight) * 100);
    return { prediction: finalPrediction, confidence: Math.min(99, confidence) };
}

// Dự đoán cho một index cụ thể trong lịch sử (chỉ dùng dữ liệu trước đó)
function predictAtHistoryIndex(history, index) {
    if (index < 10) return { prediction: null, confidence: 0 };
    const pastHistory = history.slice(0, index);
    const seq = pastHistory.map(item => item.result === "Tài" ? "T" : "X").join('');
    const markov = markovPredict(seq, 4);
    const freq = frequencyPredict(pastHistory, 20);
    const cycle = cyclePredict(seq, 8);
    let scores = { Tài: 0, Xỉu: 0 };
    let totalWeight = 0;
    if (markov) { scores[markov.prediction] += 0.5 * (markov.confidence / 100); totalWeight += 0.5; }
    if (freq) { scores[freq.prediction] += 0.3 * (freq.confidence / 100); totalWeight += 0.3; }
    if (cycle) { scores[cycle.prediction] += 0.2 * (cycle.confidence / 100); totalWeight += 0.2; }
    if (totalWeight === 0) return { prediction: null, confidence: 0 };
    const finalPrediction = scores.Tài > scores.Xỉu ? "Tài" : "Xỉu";
    const confidence = Math.round((Math.max(scores.Tài, scores.Xỉu) / totalWeight) * 100);
    return { prediction: finalPrediction, confidence: Math.min(99, confidence) };
}

// ========== API ROUTES ==========
app.get('/api/ditmemaysun', (req, res) => res.json(apiResponseData));

app.get('/api/history', (req, res) => {
    res.json({
        current: apiResponseData,
        history: patternHistory.slice(-20),
        total_requests: apiResponseData.update_count || 0
    });
});

app.get('/api/sunwin/history', (req, res) => {
    const last100 = patternHistory
        .slice(-100)
        .reverse()
        .map(item => ({
            "Ket_qua": item.result,
            "Phien": item.session,
            "Tong": item.total,
            "Xuc_xac_1": item.dice[0],
            "Xuc_xac_2": item.dice[1],
            "Xuc_xac_3": item.dice[2],
            "id": "@cskh_huydaixu"
        }));
    res.json(last100);
});

app.get('/api/stats', (req, res) => {
    const taiCount = patternHistory.filter(item => item.result === "Tài").length;
    const xiuCount = patternHistory.length - taiCount;
    res.json({
        total_sessions: patternHistory.length,
        tai_count: taiCount,
        xiu_count: xiuCount,
        tai_percentage: patternHistory.length ? ((taiCount / patternHistory.length) * 100).toFixed(2) : 0,
        xiu_percentage: patternHistory.length ? ((xiuCount / patternHistory.length) * 100).toFixed(2) : 0,
        last_update: apiResponseData.server_time,
        server_uptime: process.uptime().toFixed(0) + 's'
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        websocket: ws ? ws.readyState === WebSocket.OPEN : false,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        connections: ws ? 'connected' : 'disconnected'
    });
});

// Dự đoán cho phiên tiếp theo (SIÊU VIP)
app.get('/api/predict', (req, res) => {
    if (patternHistory.length < 10) {
        return res.json({
            error: "Chưa đủ dữ liệu (cần ít nhất 10 phiên)",
            need_more: true,
            AIHDXSUNWIN: "Đang học..."
        });
    }
    const currentData = apiResponseData;
    if (!currentData.Phien) {
        return res.status(503).json({ error: "Chưa có phiên hiện tại", AIHDXSUNWIN: "Chờ dữ liệu..." });
    }
    const { prediction, confidence } = combinedPredict(patternHistory);
    const nextSession = currentData.Phien + 1;
    const recentPattern = patternHistory.slice(-9).map(p => p.result === "Tài" ? "T" : "X").join('');
    res.json({
        "Ket_qua": currentData.Ket_qua,
        "Phien": currentData.Phien,
        "Tong": currentData.Tong,
        "Xuc_xac_1": currentData.Xuc_xac_1,
        "Xuc_xac_2": currentData.Xuc_xac_2,
        "Xuc_xac_3": currentData.Xuc_xac_3,
        "phien_hien_tai": nextSession,
        "Pattern": recentPattern,
        "Du_doan": prediction,
        "Do_tin_cay": confidence + "%",
        "id": "@cskh_huydaixu",
        "AIHDXSUNWIN": `AI_HDPredict_${prediction}_${confidence}`
    });
});

// Độ chính xác tổng thể dựa trên lịch sử
app.get('/api/accuracy', (req, res) => {
    if (patternHistory.length < 10) {
        return res.json({ error: "Cần ít nhất 10 phiên", current_length: patternHistory.length });
    }
    let correct = 0;
    let total = 0;
    const details = [];
    for (let i = 10; i < patternHistory.length; i++) {
        const { prediction, confidence } = predictAtHistoryIndex(patternHistory, i);
        if (!prediction) continue;
        const actual = patternHistory[i].result;
        const isCorrect = (prediction === actual);
        if (isCorrect) correct++;
        total++;
        details.push({
            session: patternHistory[i].session,
            actual: actual,
            prediction: prediction,
            correct: isCorrect,
            confidence: confidence
        });
    }
    const accuracy = total > 0 ? (correct / total * 100).toFixed(2) : 0;
    res.json({
        total_predictions: total,
        correct: correct,
        wrong: total - correct,
        accuracy_percent: parseFloat(accuracy),
        details: details.slice(-50)
    });
});

// Lịch sử kèm dự đoán cho từng phiên (dùng cho web)
app.get('/api/history_with_predictions', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const start = Math.max(0, patternHistory.length - limit);
    const results = [];
    for (let i = start; i < patternHistory.length; i++) {
        const { prediction, confidence } = predictAtHistoryIndex(patternHistory, i);
        results.push({
            session: patternHistory[i].session,
            dice: patternHistory[i].dice,
            total: patternHistory[i].total,
            actual: patternHistory[i].result,
            prediction: prediction || "N/A",
            confidence: confidence || 0,
            correct: prediction ? (prediction === patternHistory[i].result) : null,
            timestamp: patternHistory[i].timestamp
        });
    }
    const recentResults = results.slice(-100).filter(r => r.prediction !== "N/A");
    const correctCount = recentResults.filter(r => r.correct === true).length;
    const accuracy = recentResults.length > 0 ? (correctCount / recentResults.length * 100).toFixed(2) : 0;
    res.json({
        total_history: patternHistory.length,
        predictions_available: results.filter(r => r.prediction !== "N/A").length,
        recent_accuracy: parseFloat(accuracy),
        data: results.reverse()
    });
});

// So sánh dự đoán vs thực tế cho phiên cuối cùng
app.get('/api/compare', (req, res) => {
    if (patternHistory.length < 1) {
        return res.json({ error: "Chưa có dữ liệu" });
    }
    const last = patternHistory[patternHistory.length - 1];
    const prevHistory = patternHistory.slice(0, -1);
    let prediction = null, confidence = 0;
    if (prevHistory.length >= 10) {
        const predResult = predictAtHistoryIndex(patternHistory, patternHistory.length - 1);
        prediction = predResult.prediction;
        confidence = predResult.confidence;
    }
    res.json({
        current_session: last.session,
        actual_result: last.result,
        dice: last.dice,
        total: last.total,
        ai_prediction: prediction,
        confidence: confidence,
        is_correct: prediction ? (prediction === last.result) : null
    });
});

// GIAO DIỆN WEB LỊCH SỬ DỰ ĐOÁN
app.get('/history', (req, res) => {
    const html = `<!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>SunWin AI - Lịch sử dự đoán siêu vip</title>
        <style>
            * { box-sizing: border-box; }
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0a0e1a; color: #e0e0e0; margin: 0; padding: 20px; }
            .container { max-width: 1400px; margin: 0 auto; }
            h1 { color: #ffd966; text-align: center; }
            .stats { display: flex; gap: 20px; justify-content: center; margin: 20px 0; flex-wrap: wrap; }
            .stat-card { background: #1e2a3a; padding: 15px 25px; border-radius: 12px; text-align: center; box-shadow: 0 4px 8px rgba(0,0,0,0.3); }
            .stat-card h3 { margin: 0 0 8px 0; font-size: 1.8rem; color: #ffaa44; }
            .stat-card p { margin: 0; font-size: 0.9rem; opacity: 0.8; }
            .accuracy-high { color: #4caf50; }
            .accuracy-medium { color: #ff9800; }
            .accuracy-low { color: #f44336; }
            table { width: 100%; border-collapse: collapse; background: #111a22; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.5); }
            th, td { padding: 12px 8px; text-align: center; border-bottom: 1px solid #2a3a44; }
            th { background: #0f1a24; color: #ffd966; font-weight: 600; }
            tr:hover { background: #1e2f3c; }
            .tai { color: #4caf50; font-weight: bold; }
            .xiu { color: #f44336; font-weight: bold; }
            .correct { background-color: rgba(76, 175, 80, 0.2); color: #8bc34a; }
            .wrong { background-color: rgba(244, 67, 54, 0.2); color: #ff8a80; }
            .pending { color: #ffaa44; }
            .refresh-btn { background: #2c3e50; border: none; color: white; padding: 8px 16px; border-radius: 8px; cursor: pointer; margin-bottom: 20px; }
            .refresh-btn:hover { background: #3e5a6b; }
            .footer { text-align: center; margin-top: 30px; font-size: 0.8rem; opacity: 0.6; }
            @media (max-width: 768px) { td, th { font-size: 12px; padding: 8px 4px; } }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🎲 SUNWIN AI PREDICTOR - LỊCH SỬ & ĐỘ CHÍNH XÁC</h1>
            <div style="text-align:center; margin-bottom:20px;">
                <button class="refresh-btn" onclick="fetchData()">⟳ Tải lại dữ liệu</button>
                <span id="update-time" style="margin-left: 15px;"></span>
            </div>
            <div class="stats" id="stats-area">Đang tải...</div>
            <div style="overflow-x: auto;">
                <table id="history-table">
                    <thead><tr><th>Phiên</th><th>Kết quả (Xúc xắc)</th><th>Tổng</th><th>Kết quả thực</th><th>Dự đoán</th><th>Độ tin cậy</th><th>Đúng/Sai</th></tr></thead>
                    <tbody id="history-body"><tr><td colspan="7">Đang tải dữ liệu...</td></tr></tbody>
                </table>
            </div>
            <div class="footer">🤖 AI tự học (Markov + Frequency + Cycle) | Dự đoán dựa trên 10+ phiên trước | Cập nhật realtime</div>
        </div>
        <script>
            async function fetchData() {
                try {
                    const res = await fetch('/api/history_with_predictions?limit=100');
                    const data = await res.json();
                    const statsDiv = document.getElementById('stats-area');
                    const tbody = document.getElementById('history-body');
                    let accuracyClass = '';
                    if (data.recent_accuracy >= 70) accuracyClass = 'accuracy-high';
                    else if (data.recent_accuracy >= 50) accuracyClass = 'accuracy-medium';
                    else accuracyClass = 'accuracy-low';
                    statsDiv.innerHTML = \`
                        <div class="stat-card"><h3>\${data.total_history}</h3><p>Tổng phiên</p></div>
                        <div class="stat-card"><h3>\${data.predictions_available}</h3><p>Đã dự đoán</p></div>
                        <div class="stat-card"><h3 class="\${accuracyClass}">\${data.recent_accuracy}%</h3><p>Độ chính xác (100 phiên gần)</p></div>
                    \`;
                    if (data.data.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="7">Chưa có dữ liệu lịch sử</td></tr>';
                        return;
                    }
                    tbody.innerHTML = data.data.map(item => {
                        let actualClass = item.actual === 'Tài' ? 'tai' : 'xiu';
                        let predClass = item.prediction === 'Tài' ? 'tai' : (item.prediction === 'Xỉu' ? 'xiu' : 'pending');
                        let statusHtml = '';
                        if (item.correct === true) statusHtml = '<span class="correct">✓ Đúng</span>';
                        else if (item.correct === false) statusHtml = '<span class="wrong">✗ Sai</span>';
                        else statusHtml = '<span class="pending">?</span>';
                        let diceStr = \`\${item.dice[0]} - \${item.dice[1]} - \${item.dice[2]}\`;
                        return \`
                            <tr>
                                <td>\${item.session}</td>
                                <td>\${diceStr}</td>
                                <td>\${item.total}</td>
                                <td class="\${actualClass}">\${item.actual}</td>
                                <td class="\${predClass}">\${item.prediction}</td>
                                <td>\${item.confidence}%</td>
                                <td>\${statusHtml}</td>
                            </tr>
                        \`;
                    }).join('');
                    document.getElementById('update-time').innerText = 'Cập nhật lúc: ' + new Date().toLocaleString();
                } catch (err) {
                    console.error(err);
                    document.getElementById('history-body').innerHTML = '<tr><td colspan="7">Lỗi tải dữ liệu</td></tr>';
                }
            }
            fetchData();
            setInterval(fetchData, 10000);
        </script>
    </body>
    </html>`;
    res.send(html);
});

// Trang chủ hiển thị các endpoint
app.get('/', (req, res) => {
    const localIP = getLocalIP();
    res.send(`<!DOCTYPE html>
    <html>
    <head><title>Sun.Win AI Predictor</title><meta charset="UTF-8"><style>body{background:#0a0a0a;color:#0f0;font-family:monospace;padding:20px}.card{background:#111;padding:20px;border-radius:10px;margin:10px 0}</style></head>
    <body>
        <h1>🎲 SUNWIN AI PREDICTOR (AIHDXSUNWIN)</h1>
        <div class="card">
            <h2>📡 API Endpoints</h2>
            <ul>
                <li><a href="/api/ditmemaysun" style="color:#0ff">/api/ditmemaysun</a> - Kết quả hiện tại</li>
                <li><a href="/api/sunwin/history" style="color:#0ff">/api/sunwin/history</a> - 100 phiên gần nhất (chuẩn)</li>
                <li><a href="/api/predict" style="color:#0ff">/api/predict</a> - Dự đoán siêu vip (AI)</li>
                <li><a href="/api/accuracy" style="color:#0ff">/api/accuracy</a> - Độ chính xác AI</li>
                <li><a href="/api/compare" style="color:#0ff">/api/compare</a> - So sánh dự đoán vs thực tế phiên cuối</li>
                <li><a href="/history" style="color:#0ff">/history</a> - Giao diện lịch sử dự đoán</li>
                <li><a href="/api/stats" style="color:#0ff">/api/stats</a> - Thống kê</li>
            </ul>
        </div>
        <div class="card">
            <h2>🤖 AI Model: Markov + Frequency + Cycle</h2>
            <p>Tự học từ 100 phiên gần nhất | Độ tin cậy động</p>
            <p>Server IP: ${localIP}:${PORT}</p>
        </div>
    </body>
    </html>`);
});

// Khởi động server
app.listen(PORT, '0.0.0.0', () => {
    const localIP = getLocalIP();
    console.log(`\n=========================================`);
    console.log(`🚀 SUNWIN AI PREDICTOR - AIHDXSUNWIN`);
    console.log(`=========================================`);
    console.log(`📡 Server: http://${localIP}:${PORT}`);
    console.log(`🔮 Dự đoán: http://${localIP}:${PORT}/api/predict`);
    console.log(`📜 Lịch sử 100 phiên: http://${localIP}:${PORT}/api/sunwin/history`);
    console.log(`📊 Độ chính xác: http://${localIP}:${PORT}/api/accuracy`);
    console.log(`🌐 Giao diện lịch sử: http://${localIP}:${PORT}/history`);
    console.log(`=========================================\n`);
    connectWebSocket();
});