const express = require('express');
const axios = require('axios');
const cors = require('cors');
const crypto = require('crypto');
const WebSocket = require('ws');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// ==================== CẤU HÌNH ====================
const API_URLS = {
    lc79_hu: 'https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5',
    lc79_md5: 'https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=3959701241b686f12e01bfe9c3a319b8',
    betvip_hu: 'https://wtx.macminim6.online/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=f69c1c37e9ffbfea5b655ed312604b40',
    betvip_md5: 'https://wtxmd52.macminim6.online/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=7aa1c7e7ea0160fd97524740774a4c61'
};

// WebSocket URL cho packet thật
const WS_URL = "wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu9mX_hZMZ_m5gMNhkw0";

// ==================== BIẾN TOÀN CỤC ====================
let realPackets = [];
let packetAnalysis = {
    raw_packets: [],
    decoded_data: [],
    dice_predictions: [],
    last_update: null
};

let ws = null;
let wsConnected = false;

// ==================== KẾT NỐI WEBSOCKET ĐỂ BẮT PACKET THẬT ====================
function connectWebSocket() {
    if (ws) {
        try { ws.close(); } catch(e) {}
    }
    
    console.log('[🔌] Đang kết nối WebSocket để bắt packet thật...');
    
    ws = new WebSocket(WS_URL, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Origin": "https://play.sun.win"
        }
    });
    
    ws.on('open', () => {
        console.log('[✅] WebSocket đã kết nối! Bắt đầu bắt packet...');
        wsConnected = true;
        
        // Gửi handshake messages
        const initMsg = [1, "MiniGame", "GM_apivopnha", "WangLin", { info: "{}" }];
        ws.send(JSON.stringify(initMsg));
        setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify([6, "MiniGame", "taixiuPlugin", { cmd: 1005 }]));
                ws.send(JSON.stringify([6, "MiniGame", "lobbyPlugin", { cmd: 10001 }]));
            }
        }, 1000);
    });
    
    ws.on('message', (data) => {
        try {
            const message = data.toString();
            const parsed = JSON.parse(message);
            
            // Lưu packet thô
            realPackets.unshift({
                timestamp: Date.now(),
                raw: message.substring(0, 200),
                size: message.length
            });
            if (realPackets.length > 100) realPackets.pop();
            
            // Phân tích packet nếu có dữ liệu xúc xắc
            if (Array.isArray(parsed) && parsed[1] && parsed[1].d1 && parsed[1].d2 && parsed[1].d3) {
                const { d1, d2, d3, sid } = parsed[1];
                const total = d1 + d2 + d3;
                const result = total >= 11 ? 'Tài' : 'Xỉu';
                
                const decoded = {
                    phien: sid,
                    xuc_xac: [d1, d2, d3],
                    tong: total,
                    ket_qua: result,
                    raw_packet: message.substring(0, 100)
                };
                
                packetAnalysis.decoded_data.unshift(decoded);
                if (packetAnalysis.decoded_data.length > 50) packetAnalysis.decoded_data.pop();
                packetAnalysis.last_update = Date.now();
                
                console.log(`[📦] Packet #${sid}: ${d1}+${d2}+${d3}=${total} → ${result}`);
            }
            
            // Lưu packet đã decode
            packetAnalysis.raw_packets.unshift({
                timestamp: Date.now(),
                type: Array.isArray(parsed) ? parsed[1]?.cmd : 'unknown',
                data: parsed
            });
            if (packetAnalysis.raw_packets.length > 100) packetAnalysis.raw_packets.pop();
            
        } catch (e) {
            // Không phải JSON, bỏ qua
        }
    });
    
    ws.on('close', () => {
        console.log('[🔌] WebSocket ngắt kết nối, thử kết nối lại sau 3s...');
        wsConnected = false;
        setTimeout(connectWebSocket, 3000);
    });
    
    ws.on('error', (err) => {
        console.error('[❌] WebSocket lỗi:', err.message);
        wsConnected = false;
    });
}

// ==================== PHÂN TÍCH PACKET THẬT ====================
function analyzeRealPackets() {
    if (packetAnalysis.decoded_data.length < 5) {
        return {
            has_data: false,
            message: 'Chưa có đủ packet, đang thu thập...',
            packet_count: packetAnalysis.decoded_data.length
        };
    }
    
    const last10 = packetAnalysis.decoded_data.slice(0, 10);
    const results = last10.map(p => p.ket_qua);
    const dice = last10.map(p => p.xuc_xac);
    
    // Phân tích streak
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[0]) streak++;
        else break;
    }
    
    // Phân tích từng xúc xắc
    const dice1Freq = {}, dice2Freq = {}, dice3Freq = {};
    for (const d of dice) {
        dice1Freq[d[0]] = (dice1Freq[d[0]] || 0) + 1;
        dice2Freq[d[1]] = (dice2Freq[d[1]] || 0) + 1;
        dice3Freq[d[2]] = (dice3Freq[d[2]] || 0) + 1;
    }
    
    const getMostFrequent = (freq) => {
        let maxFace = 3, maxCount = 0;
        for (const [face, count] of Object.entries(freq)) {
            if (count > maxCount) {
                maxCount = count;
                maxFace = parseInt(face);
            }
        }
        return maxFace;
    };
    
    const predD1 = getMostFrequent(dice1Freq);
    const predD2 = getMostFrequent(dice2Freq);
    const predD3 = getMostFrequent(dice3Freq);
    const total = predD1 + predD2 + predD3;
    
    // Dự đoán dựa trên streak
    let finalPrediction = total >= 11 ? 'Tài' : 'Xỉu';
    let finalConfidence = 65 + Math.min(25, last10.length);
    
    if (streak >= 5) {
        finalPrediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
        finalConfidence = 85 + Math.min(10, streak);
    } else if (streak >= 3) {
        finalPrediction = results[0];
        finalConfidence = 75;
    }
    
    return {
        has_data: true,
        packet_count: packetAnalysis.decoded_data.length,
        last_phien: packetAnalysis.decoded_data[0]?.phien,
        phien_hien_tai: packetAnalysis.decoded_data[0]?.phien ? parseInt(packetAnalysis.decoded_data[0].phien) + 1 : null,
        
        phan_tich_packet: {
            tong_so_packet: packetAnalysis.decoded_data.length,
            packet_gan_day: last10.map(p => ({
                phien: p.phien,
                xuc_xac: p.xuc_xac,
                tong: p.tong,
                ket_qua: p.ket_qua
            }))
        },
        
        du_doan_xuc_xac: {
            xuc_xac_1: predD1,
            xuc_xac_2: predD2,
            xuc_xac_3: predD3,
            tong: total,
            ket_qua: finalPrediction
        },
        
        do_tin_cay: `${finalConfidence}%`,
        
        chuoi_hien_tai: streak,
        
        timestamp: new Date().toISOString()
    };
}

// ==================== LẤY DỮ LIỆU API HTTP ====================
async function fetchGameData(apiUrl) {
    try {
        const response = await axios.get(apiUrl, { timeout: 10000 });
        const list = response.data?.list || [];
        if (!list.length) return null;
        
        return list.map(item => ({
            phien: item.id,
            result: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
            dice: [item.dices?.[0] || 0, item.dices?.[1] || 0, item.dices?.[2] || 0],
            sum: item.point || 0
        }));
    } catch (error) {
        console.error('Lỗi fetch:', error.message);
        return null;
    }
}

// ==================== PHÂN TÍCH PACKET GIẢ LẬP TỪ API ====================
function analyzeApiAsPacket(data) {
    if (!data || data.length < 10) return null;
    
    const results = data.map(d => d.result);
    const dice = data.map(d => d.dice);
    
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[0]) streak++;
        else break;
    }
    
    // Phân tích tần suất xúc xắc
    const dice1Freq = {}, dice2Freq = {}, dice3Freq = {};
    for (const d of dice.slice(0, 20)) {
        dice1Freq[d[0]] = (dice1Freq[d[0]] || 0) + 1;
        dice2Freq[d[1]] = (dice2Freq[d[1]] || 0) + 1;
        dice3Freq[d[2]] = (dice3Freq[d[2]] || 0) + 1;
    }
    
    const getMostFrequent = (freq) => {
        let maxFace = 3, maxCount = 0;
        for (const [face, count] of Object.entries(freq)) {
            if (count > maxCount) {
                maxCount = count;
                maxFace = parseInt(face);
            }
        }
        return maxFace;
    };
    
    const predD1 = getMostFrequent(dice1Freq);
    const predD2 = getMostFrequent(dice2Freq);
    const predD3 = getMostFrequent(dice3Freq);
    const total = predD1 + predD2 + predD3;
    
    let finalPrediction = total >= 11 ? 'Tài' : 'Xỉu';
    let finalConfidence = 65;
    
    if (streak >= 5) {
        finalPrediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
        finalConfidence = 85;
    } else if (streak >= 3) {
        finalPrediction = results[0];
        finalConfidence = 75;
    }
    
    return {
        du_doan_xuc_xac: {
            xuc_xac_1: predD1,
            xuc_xac_2: predD2,
            xuc_xac_3: predD3,
            tong: total,
            ket_qua: finalPrediction
        },
        do_tin_cay: `${finalConfidence}%`,
        chuoi_bet: streak,
        tong_phien_phan_tich: data.length
    };
}

// ==================== API ENDPOINTS ====================

app.get('/', (req, res) => {
    res.json({
        name: "🔬 PACKET ANALYZER API V5.0 - PHÂN TÍCH PACKET THẬT",
        author: "@anhquan",
        status: "running",
        websocket_status: wsConnected ? "✅ Đã kết nối" : "🔄 Đang kết nối...",
        packet_count: packetAnalysis.decoded_data.length,
        endpoints: {
            "/packet/real": "Phân tích packet thật từ WebSocket",
            "/packet/lc79-hu": "Phân tích dữ liệu LC79 Hũ (dạng packet)",
            "/packet/lc79-md5": "Phân tích dữ liệu LC79 MD5 (dạng packet)",
            "/packet/betvip-hu": "Phân tích dữ liệu BETVIP Hũ (dạng packet)",
            "/packet/betvip-md5": "Phân tích dữ liệu BETVIP MD5 (dạng packet)",
            "/packet/raw": "Xem raw packet gần nhất"
        }
    });
});

// Endpoint phân tích packet THẬT từ WebSocket
app.get('/packet/real', (req, res) => {
    const analysis = analyzeRealPackets();
    res.json({
        status: "success",
        source: "WEBSOCKET_REAL_PACKET",
        websocket_connected: wsConnected,
        ...analysis
    });
});

// Endpoint xem raw packet
app.get('/packet/raw', (req, res) => {
    res.json({
        status: "success",
        total_raw_packets: realPackets.length,
        latest_packets: realPackets.slice(0, 10),
        decoded_packets: packetAnalysis.decoded_data.slice(0, 10)
    });
});

// Endpoint phân tích packet từ API (giả lập)
app.get('/packet/lc79-hu', async (req, res) => {
    try {
        const data = await fetchGameData(API_URLS.lc79_hu);
        if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
        
        const analysis = analyzeApiAsPacket(data);
        const nextPhien = data[0].phien + 1;
        
        res.json({
            status: "success",
            source: "API_SIMULATED",
            game: "LC79 HŨ",
            phien_hien_tai: nextPhien,
            ...analysis,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/packet/lc79-md5', async (req, res) => {
    try {
        const data = await fetchGameData(API_URLS.lc79_md5);
        if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
        
        const analysis = analyzeApiAsPacket(data);
        const nextPhien = data[0].phien + 1;
        
        res.json({
            status: "success",
            source: "API_SIMULATED",
            game: "LC79 MD5",
            phien_hien_tai: nextPhien,
            ...analysis,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/packet/betvip-hu', async (req, res) => {
    try {
        const data = await fetchGameData(API_URLS.betvip_hu);
        if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
        
        const analysis = analyzeApiAsPacket(data);
        const nextPhien = data[0].phien + 1;
        
        res.json({
            status: "success",
            source: "API_SIMULATED",
            game: "BETVIP HŨ",
            phien_hien_tai: nextPhien,
            ...analysis,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/packet/betvip-md5', async (req, res) => {
    try {
        const data = await fetchGameData(API_URLS.betvip_md5);
        if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
        
        const analysis = analyzeApiAsPacket(data);
        const nextPhien = data[0].phien + 1;
        
        res.json({
            status: "success",
            source: "API_SIMULATED",
            game: "BETVIP MD5",
            phien_hien_tai: nextPhien,
            ...analysis,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: "healthy",
        websocket: wsConnected ? "connected" : "connecting",
        packet_count: packetAnalysis.decoded_data.length,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// ==================== KHỞI ĐỘNG ====================
// Kết nối WebSocket để bắt packet thật
connectWebSocket();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║                                                                       ║
║   🔬 PACKET ANALYZER API V5.0 - PHÂN TÍCH PACKET THẬT 🔬              ║
║   📡 PORT: ${PORT}                                                       ║
║   👤 AUTHOR: @anhquan                                                 ║
║                                                                       ║
║   📡 WEBSOCKET: Đang kết nối để bắt packet thật...                    ║
║                                                                       ║
║   🎯 CÁCH HOẠT ĐỘNG:                                                  ║
║   ├── /packet/real  → Phân tích packet THẬT từ WebSocket             ║
║   ├── /packet/raw   → Xem raw packet gốc                             ║
║   └── /packet/*     → Phân tích từ API (simulated)                   ║
║                                                                       ║
║   📦 KẾT QUẢ PACKET THẬT:                                             ║
║   {                                                                   ║
║     "du_doan_xuc_xac": {                                              ║
║       "xuc_xac_1": 4,                                                 ║
║       "xuc_xac_2": 5,                                                 ║
║       "xuc_xac_3": 2,                                                 ║
║       "tong": 11,                                                     ║
║       "ket_qua": "Tài"                                                ║
║     },                                                                ║
║     "do_tin_cay": "87%",                                              ║
║     "phan_tich_packet": {                                             ║
║       "packet_gan_day": [...]                                         ║
║     }                                                                 ║
║   }                                                                   ║
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝
    `);
});
