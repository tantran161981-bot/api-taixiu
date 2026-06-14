const WebSocket = require('ws');
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3001;

// ==================== API HTTP CHO LC79 & BETVIP ====================
const API_URLS = {
    lc79_hu: 'https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5',
    lc79_md5: 'https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=3959701241b686f12e01bfe9c3a319b8',
    betvip_hu: 'https://wtx.macminim6.online/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=f69c1c37e9ffbfea5b655ed312604b40',
    betvip_md5: 'https://wtxmd52.macminim6.online/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=7aa1c7e7ea0160fd97524740774a4c61'
};

// ==================== FILE STORAGE ====================
const HISTORY_FILE = './history.json';
const PATTERNS_FILE = './patterns.json';
const MODEL_WEIGHTS_FILE = './model_weights.json';

// Load history if exists
let resultHistory = [];
if (fs.existsSync(HISTORY_FILE)) {
    try {
        resultHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        console.log(`[📂] Đã tải ${resultHistory.length} phiên từ history.json`);
    } catch (e) {
        console.error('[❌] Lỗi đọc history.json:', e.message);
    }
}

// Load model weights if exists
let modelWeights = {
    'model1': 1.0, 'model2': 1.0, 'model3': 1.0, 'model4': 1.0,
    'model5': 1.0, 'model6': 1.0, 'model7': 1.0, 'model8': 1.0,
    'model9': 1.0, 'model10': 1.0, 'model11': 1.0, 'model12': 1.0,
    'model13': 1.0, 'model14': 1.0, 'model15': 1.0, 'model16': 1.0,
    'model17': 1.0, 'model18': 1.0, 'model19': 1.0, 'model20': 1.0,
    'model21': 1.0
};

// Load sub model weights
let subModelWeights = {};
for (let i = 1; i <= 42; i++) {
    subModelWeights[`sub_model_${i}`] = 1.0;
}

// Load mini model weights
let miniModelWeights = {};
for (let i = 1; i <= 21; i++) {
    miniModelWeights[`mini_model_${i}`] = 1.0;
}

if (fs.existsSync(MODEL_WEIGHTS_FILE)) {
    try {
        const savedWeights = JSON.parse(fs.readFileSync(MODEL_WEIGHTS_FILE, 'utf8'));
        modelWeights = savedWeights.modelWeights || modelWeights;
        subModelWeights = savedWeights.subModelWeights || subModelWeights;
        miniModelWeights = savedWeights.miniModelWeights || miniModelWeights;
        console.log('[📂] Đã tải model_weights.json');
    } catch (e) {
        console.error('[❌] Lỗi đọc model_weights.json:', e.message);
    }
}

// Save history
function saveHistory(entry) {
    resultHistory.push(entry);
    if (resultHistory.length > 1000) resultHistory.shift();
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(resultHistory, null, 2));
}

// Save model weights
function saveModelWeights() {
    const weights = {
        modelWeights,
        subModelWeights,
        miniModelWeights
    };
    fs.writeFileSync(MODEL_WEIGHTS_FILE, JSON.stringify(weights, null, 2));
}

// ==================== NEW ALGORITHM DATASET ====================
const NEW_ALGORITHM_PATTERNS = {
  "TXT": { "prediction": "Xỉu", "confidence": 68 },
  "TTXX": { "prediction": "Tài", "confidence": 87 },
  "XXTXX": { "prediction": "Tài", "confidence": 59 },
  "TTX": { "prediction": "Xỉu", "confidence": 73 },
  "XTT": { "prediction": "Tài", "confidence": 92 },
  "TXX": { "prediction": "Tài", "confidence": 55 },
  "XTX": { "prediction": "Xỉu", "confidence": 81 },
  "TXTX": { "prediction": "Tài", "confidence": 64 },
  "XTXX": { "prediction": "Tài", "confidence": 77 },
  "XXTX": { "prediction": "Tài", "confidence": 96 },
  "TXTT": { "prediction": "Xỉu", "confidence": 71 },
  "TTT": { "prediction": "Tài", "confidence": 83 },
  "XXX": { "prediction": "Tài", "confidence": 52 },
  "TXXT": { "prediction": "Tài", "confidence": 94 },
  "XTXT": { "prediction": "Xỉu", "confidence": 63 },
  "XXTT": { "prediction": "Tài", "confidence": 79 },
  "XTTX": { "prediction": "Tài", "confidence": 88 },
  "XTXTX": { "prediction": "Xỉu", "confidence": 72 },
  "TTXXX": { "prediction": "Tài", "confidence": 61 },
  "XTTXT": { "prediction": "Tài", "confidence": 69 },
  "XXTXT": { "prediction": "Xỉu", "confidence": 84 },
  "TXTTX": { "prediction": "Tài", "confidence": 53 },
  "XTXXT": { "prediction": "Tài", "confidence": 91 },
  "TTTXX": { "prediction": "Xỉu", "confidence": 72 },
  "XXTTT": { "prediction": "Tài", "confidence": 65 },
  "XTXTT": { "prediction": "Tài", "confidence": 97 },
  "TXTXT": { "prediction": "Tài", "confidence": 56 },
  "TTXTX": { "prediction": "Xỉu", "confidence": 78 },
  "TXTTT": { "prediction": "Xỉu", "confidence": 62 },
  "XXTXTX": { "prediction": "Tài", "confidence": 85 },
  "XTXXTX": { "prediction": "Tài", "confidence": 74 },
  "TXTTTX": { "prediction": "Tài", "confidence": 66 },
  "TTTTXX": { "prediction": "Xỉu", "confidence": 89 },
  "XTXTTX": { "prediction": "Tài", "confidence": 51 },
  "XTXXTT": { "prediction": "Tài", "confidence": 82 },
  "TXXTXX": { "prediction": "Tài", "confidence": 93 },
  "XXTXXT": { "prediction": "Tài", "confidence": 76 },
  "TXTTXX": { "prediction": "Xỉu", "confidence": 67 },
  "TTTXTX": { "prediction": "Xỉu", "confidence": 58 },
  "TTXTTT": { "prediction": "Tài", "confidence": 95 },
  "TXXTTX": { "prediction": "Tài", "confidence": 54 },
  "XXTTTX": { "prediction": "Tài", "confidence": 86 },
  "XTTTTX": { "prediction": "Xỉu", "confidence": 70 },
  "TXTXTT": { "prediction": "Tài", "confidence": 60 },
  "TXTXTX": { "prediction": "Tài", "confidence": 80 },
  "TTTTX": { "prediction": "Tài", "confidence": 90 },
  "XXXTX": { "prediction": "Tài", "confidence": 84 },
  "XTXXXT": { "prediction": "Tài", "confidence": 67 },
  "XXTTXX": { "prediction": "Tài", "confidence": 79 },
  "TTTXXT": { "prediction": "Xỉu", "confidence": 62 },
  "XXTXXX": { "prediction": "Tài", "confidence": 91 },
  "XTXTXT": { "prediction": "Tài", "confidence": 55 },
  "TTXXTX": { "prediction": "Tài", "confidence": 88 },
  "TTXXT": { "prediction": "Tài", "confidence": 77 },
  "TXXTX": { "prediction": "Xỉu", "confidence": 69 },
  "XTXXX": { "prediction": "Tài", "confidence": 83 },
  "TTXT": { "prediction": "Xỉu", "confidence": 61 },
  "TTTXT": { "prediction": "Xỉu", "confidence": 75 },
  "TTTT": { "prediction": "Tài", "confidence": 94 },
  "TTTTT": { "prediction": "Tài", "confidence": 57 },
  "TTTTTT": { "prediction": "Xỉu", "confidence": 86 },
  "TTTTTTT": { "prediction": "Tài", "confidence": 65 },
  "TTTTTTX": { "prediction": "Xỉu", "confidence": 78 },
  "TTTTTX": { "prediction": "Xỉu", "confidence": 53 },
  "TTTTTXT": { "prediction": "Xỉu", "confidence": 89 },
  "TTTTTXX": { "prediction": "Tài", "confidence": 70 },
  "TTTTXT": { "prediction": "Xỉu", "confidence": 81 },
  "TTTTXTT": { "prediction": "Tài", "confidence": 63 },
  "TTTTXTX": { "prediction": "Xỉu", "confidence": 92 },
  "TTTTXXT": { "prediction": "Xỉu", "confidence": 56 },
  "TTTTXXX": { "prediction": "Tài", "confidence": 85 },
  "TTTX": { "prediction": "Xỉu", "confidence": 74 },
  "TTTXTT": { "prediction": "Tài", "confidence": 66 },
  "TTTXTTT": { "prediction": "Xỉu", "confidence": 97 },
  "TTTXTTX": { "prediction": "Xỉu", "confidence": 59 },
  "TTTXTXT": { "prediction": "Tài", "confidence": 82 },
  "TTTXTXX": { "prediction": "Tài", "confidence": 71 },
  "TTTXXTT": { "prediction": "Tài", "confidence": 60 },
  "TTTXXTX": { "prediction": "Tài", "confidence": 90 },
  "TTTXXX": { "prediction": "Xỉu", "confidence": 64 },
  "TTTXXXT": { "prediction": "Tài", "confidence": 87 },
  "TTTXXXX": { "prediction": "Xỉu", "confidence": 76 },
  "TTXTT": { "prediction": "Xỉu", "confidence": 93 },
  "TTXTTTT": { "prediction": "Xỉu", "confidence": 68 },
  "TTXTTTX": { "prediction": "Xỉu", "confidence": 80 },
  "TTXTTX": { "prediction": "Tài", "confidence": 58 },
  "TTXTTXT": { "prediction": "Tài", "confidence": 95 },
  "TTXTTXX": { "prediction": "Xỉu", "confidence": 54 },
  "TTXTXT": { "prediction": "Xỉu", "confidence": 83 },
  "TTXTXTT": { "prediction": "Tài", "confidence": 72 },
  "TTXTXTX": { "prediction": "Tài", "confidence": 61 },
  "TTXTXX": { "prediction": "Xỉu", "confidence": 89 },
  "TTXTXXT": { "prediction": "Tài", "confidence": 70 },
  "TTXTXXX": { "prediction": "Xỉu", "confidence": 79 },
  "TTXXTT": { "prediction": "Tài", "confidence": 57 },
  "TTXXTTT": { "prediction": "Xỉu", "confidence": 84 },
  "TTXXTTX": { "prediction": "Tài", "confidence": 67 },
  "TTXXTXT": { "prediction": "Tài", "confidence": 96 },
  "TTXXTXX": { "prediction": "Xỉu", "confidence": 51 },
  "TTXXXT": { "prediction": "Xỉu", "confidence": 75 },
  "TTXXXTT": { "prediction": "Tài", "confidence": 62 },
  "TTXXXTX": { "prediction": "Tài", "confidence": 91 },
  "TTXXXX": { "prediction": "Xỉu", "confidence": 73 },
  "TTXXXXT": { "prediction": "Tài", "confidence": 82 },
  "TTXXXXX": { "prediction": "Xỉu", "confidence": 66 },
  "TXTTTT": { "prediction": "Xỉu", "confidence": 94 },
  "TXTTTTT": { "prediction": "Xỉu", "confidence": 59 },
  "TXTTTTX": { "prediction": "Xỉu", "confidence": 85 },
  "TXTTTXT": { "prediction": "Xỉu", "confidence": 77 },
  "TXTTTXX": { "prediction": "Tài", "confidence": 68 },
  "TXTTXT": { "prediction": "Tài", "confidence": 86 },
  "TXTTXTT": { "prediction": "Tài", "confidence": 55 },
  "TXTTXTX": { "prediction": "Tài", "confidence": 74 },
  "TXTTXXT": { "prediction": "Tài", "confidence": 92 },
  "TXTTXXX": { "prediction": "Tài", "confidence": 63 },
  "TXTXTTT": { "prediction": "Tài", "confidence": 81 },
  "TXTXTTX": { "prediction": "Tài", "confidence": 70 },
  "TXTXTXT": { "prediction": "Xỉu", "confidence": 89 },
  "TXTXTXX": { "prediction": "Tài", "confidence": 58 },
  "TXTXX": { "prediction": "Tài", "confidence": 97 },
  "TXTXXT": { "prediction": "Tài", "confidence": 64 },
  "TXTXXTT": { "prediction": "Tài", "confidence": 83 },
  "TXTXXTX": { "prediction": "Xỉu", "confidence": 72 },
  "TXTXXX": { "prediction": "Xỉu", "confidence": 61 },
  "TXTXXXT": { "prediction": "Xỉu", "confidence": 90 },
  "TXTXXXX": { "prediction": "Xỉu", "confidence": 53 },
  "TXXTT": { "prediction": "Tài", "confidence": 87 },
  "TXXTTT": { "prediction": "Tài", "confidence": 76 },
  "TXXTTTT": { "prediction": "Tài", "confidence": 65 },
  "TXXTTTX": { "prediction": "Tài", "confidence": 54 },
  "TXXTTXT": { "prediction": "Xỉu", "confidence": 93 },
  "TXXTTXX": { "prediction": "Xỉu", "confidence": 82 },
  "TXXTXT": { "prediction": "Tài", "confidence": 71 },
  "TXXTXTT": { "prediction": "Tài", "confidence": 60 },
  "TXXTXTX": { "prediction": "Tài", "confidence": 95 },
  "TXXTXXT": { "prediction": "Tài", "confidence": 84 },
  "TXXTXXX": { "prediction": "Xỉu", "confidence": 73 },
  "TXXX": { "prediction": "Tài", "confidence": 62 },
  "TXXXT": { "prediction": "Tài", "confidence": 91 },
  "TXXXTT": { "prediction": "Xỉu", "confidence": 57 },
  "TXXXTTT": { "prediction": "Tài", "confidence": 86 },
  "TXXXTTX": { "prediction": "Xỉu", "confidence": 75 },
  "TXXXTX": { "prediction": "Xỉu", "confidence": 64 },
  "TXXXTXT": { "prediction": "Tài", "confidence": 97 },
  "TXXXTXX": { "prediction": "Xỉu", "confidence": 66 },
  "TXXXX": { "prediction": "Xỉu", "confidence": 85 },
  "TXXXXT": { "prediction": "Tài", "confidence": 74 },
  "TXXXXTT": { "prediction": "Xỉu", "confidence": 63 },
  "TXXXXTX": { "prediction": "Xỉu", "confidence": 92 },
  "TXXXXX": { "prediction": "Tài", "confidence": 51 },
  "TXXXXXT": { "prediction": "Xỉu", "confidence": 80 },
  "TXXXXXX": { "prediction": "Xỉu", "confidence": 69 },
  "XTTT": { "prediction": "Xỉu", "confidence": 88 },
  "XTTTT": { "prediction": "Xỉu", "confidence": 77 },
  "XTTTTT": { "prediction": "Tài", "confidence": 56 },
  "XTTTTTT": { "prediction": "Tài", "confidence": 95 },
  "XTTTTTX": { "prediction": "Tài", "confidence": 64 },
  "XTTTTXT": { "prediction": "Tài", "confidence": 83 },
  "XTTTTXX": { "prediction": "Xỉu", "confidence": 72 },
  "XTTTX": { "prediction": "Tài", "confidence": 61 },
  "XTTTXT": { "prediction": "Xỉu", "confidence": 90 },
  "XTTTXTT": { "prediction": "Tài", "confidence": 59 },
  "XTTTXTX": { "prediction": "Xỉu", "confidence": 78 },
  "XTTTXX": { "prediction": "Tài", "confidence": 87 },
  "XTTTXXT": { "prediction": "Tài", "confidence": 66 },
  "XTTTXXX": { "prediction": "Tài", "confidence": 55 },
  "XTTXTT": { "prediction": "Tài", "confidence": 94 },
  "XTTXTTT": { "prediction": "Tài", "confidence": 73 },
  "XTTXTTX": { "prediction": "Tài", "confidence": 82 },
  "XTTXTX": { "prediction": "Xỉu", "confidence": 71 },
  "XTTXTXT": { "prediction": "Tài", "confidence": 60 },
  "XTTXTXX": { "prediction": "Xỉu", "confidence": 89 },
  "XTTXX": { "prediction": "Xỉu", "confidence": 58 },
  "XTTXXT": { "prediction": "Xỉu", "confidence": 97 },
  "XTTXXTT": { "prediction": "Tài", "confidence": 76 },
  "XTTXXTX": { "prediction": "Xỉu", "confidence": 65 },
  "XTTXXX": { "prediction": "Tài", "confidence": 84 },
  "XTTXXXT": { "prediction": "Xỉu", "confidence": 53 },
  "XTTXXXX": { "prediction": "Tài", "confidence": 92 },
  "XTXTTT": { "prediction": "Tài", "confidence": 81 },
  "XTXTTTT": { "prediction": "Tài", "confidence": 70 },
  "XTXTTTX": { "prediction": "Xỉu", "confidence": 99 },
  "XTXTTXT": { "prediction": "Xỉu", "confidence": 68 },
  "XTXTTXX": { "prediction": "Tài", "confidence": 87 },
  "XTXTXTT": { "prediction": "Tài", "confidence": 56 },
  "XTXTXTX": { "prediction": "Xỉu", "confidence": 95 },
  "XTXTXX": { "prediction": "Tài", "confidence": 74 },
  "XTXTXXT": { "prediction": "Tài", "confidence": 83 },
  "XTXTXXX": { "prediction": "Tài", "confidence": 62 },
  "XTXXTTT": { "prediction": "Tài", "confidence": 91 },
  "XTXXTTX": { "prediction": "Xỉu", "confidence": 60 },
  "XTXXTXT": { "prediction": "Tài", "confidence": 79 },
  "XTXXTXX": { "prediction": "Tài", "confidence": 68 },
  "XTXXXTT": { "prediction": "Xỉu", "confidence": 97 },
  "XTXXXTX": { "prediction": "Tài", "confidence": 86 },
  "XTXXXX": { "prediction": "Xỉu", "confidence": 75 },
  "XTXXXXT": { "prediction": "Tài", "confidence": 64 },
  "XTXXXXX": { "prediction": "Tài", "confidence": 93 },
  "XXT": { "prediction": "Xỉu", "confidence": 82 },
  "XXTTTT": { "prediction": "Tài", "confidence": 71 },
  "XXTTTTT": { "prediction": "Xỉu", "confidence": 60 },
  "XXTTTTX": { "prediction": "Tài", "confidence": 89 },
  "XXTTTXT": { "prediction": "Xỉu", "confidence": 78 },
  "XXTTTXX": { "prediction": "Xỉu", "confidence": 67 },
  "XXTTX": { "prediction": "Tài", "confidence": 96 },
  "XXTTXT": { "prediction": "Xỉu", "confidence": 55 },
  "XXTTXTT": { "prediction": "Xỉu", "confidence": 94 },
  "XXTTXTX": { "prediction": "Tài", "confidence": 73 },
  "XXTTXXT": { "prediction": "Xỉu", "confidence": 62 },
  "XXTTXXX": { "prediction": "Tài", "confidence": 81 },
  "XXTXTT": { "prediction": "Tài", "confidence": 70 },
  "XXTXTTT": { "prediction": "Tài", "winning_streak": 99, "confidence": 99 },
  "XXTXTTX": { "prediction": "Xỉu", "confidence": 58 },
  "XXTXTXT": { "prediction": "Tài", "confidence": 87 },
  "XXTXTXX": { "prediction": "Tài", "confidence": 76 },
  "XXTXXTT": { "prediction": "Xỉu", "confidence": 65 },
  "XXTXXTX": { "prediction": "Xỉu", "confidence": 94 },
  "XXTXXXT": { "prediction": "Tài", "confidence": 83 },
  "XXTXXXX": { "prediction": "Tài", "confidence": 72 },
  "XXXT": { "prediction": "Tài", "confidence": 61 },
  "XXXTT": { "prediction": "Xỉu", "confidence": 90 },
  "XXXTTT": { "prediction": "Xỉu", "confidence": 79 },
  "XXXTTTT": { "prediction": "Xỉu", "confidence": 68 },
  "XXXTTTX": { "prediction": "Xỉu", "confidence": 97 },
  "XXXTTX": { "prediction": "Tài", "confidence": 56 },
  "XXXTTXT": { "prediction": "Xỉu", "confidence": 85 },
  "XXXTTXX": { "prediction": "Xỉu", "confidence": 74 },
  "XXXTXT": { "prediction": "Tài", "confidence": 63 },
  "XXXTXTT": { "prediction": "Tài", "confidence": 92 },
  "XXXTXTX": { "prediction": "Xỉu", "confidence": 51 },
  "XXXTXX": { "prediction": "Tài", "confidence": 80 },
  "XXXTXXT": { "prediction": "Xỉu", "confidence": 69 },
  "XXXTXXX": { "prediction": "Tài", "confidence": 98 },
  "XXXX": { "prediction": "Tài", "confidence": 57 },
  "XXXXT": { "prediction": "Xỉu", "confidence": 86 },
  "XXXXTT": { "prediction": "Xỉu", "confidence": 75 },
  "XXXXTTT": { "prediction": "Tài", "confidence": 64 },
  "XXXXTTX": { "prediction": "Tài", "confidence": 93 },
  "XXXXTX": { "prediction": "Tài", "confidence": 82 },
  "XXXXTXT": { "prediction": "Tài", "confidence": 71 },
  "XXXXTXX": { "prediction": "Tài", "confidence": 60 },
  "XXXXX": { "prediction": "Tài", "confidence": 89 },
  "XXXXXT": { "prediction": "Xỉu", "confidence": 78 },
  "XXXXXTT": { "prediction": "Tài", "confidence": 67 },
  "XXXXXTX": { "prediction": "Tài", "confidence": 96 },
  "XXXXXX": { "prediction": "Tài", "confidence": 55 },
  "XXXXXXT": { "prediction": "Tài", "confidence": 94 },
  "XXXXXXX": { "prediction": "Tài", "confidence": 83 }
};

// ==================== TAI XIU ANALYZER ====================
class TaiXiuAnalyzer {
    constructor() {
        this.modelWeights = modelWeights;
        this.subModelWeights = subModelWeights;
        this.miniModelWeights = miniModelWeights;
        
        this.subModels = {};
        this.initSubModels();
        
        this.miniModels = {};
        this.initMiniModels();
        
        this.performanceHistory = {};
        this.patternLibrary = this.loadPatternLibrary();
    }
    
    loadPatternLibrary() {
        if (fs.existsSync(PATTERNS_FILE)) {
            try {
                return JSON.parse(fs.readFileSync(PATTERNS_FILE, 'utf8'));
            } catch (e) {
                console.error('[❌] Lỗi đọc patterns.json:', e.message);
            }
        }
        return {
            '1-1': [], '2-2': [], '3-3': [], '1-2': [], '2-1': [],
            '2-1-2': [], '1-2-1': [], 'bệt': [], 'loạn': []
        };
    }
    
    savePatternLibrary() {
        fs.writeFileSync(PATTERNS_FILE, JSON.stringify(this.patternLibrary, null, 2));
    }
    
    initSubModels() {
        const subModelSpecialties = {
            1: { name: '1-1 thuần', type: '1-1', logic: 'pure', minLength: 4, threshold: 0.9 },
            2: { name: '1-1 biến thể', type: '1-1', logic: 'variant', minLength: 5, threshold: 0.8 },
            3: { name: '1-1 dài hạn', type: '1-1', logic: 'long', minLength: 8, threshold: 0.75 },
            4: { name: '1-1 kết hợp', type: '1-1', logic: 'hybrid', minLength: 6, threshold: 0.7 },
            5: { name: '1-1 gãy', type: '1-1', logic: 'break', minLength: 6, threshold: 0.8 },
            6: { name: '1-1 phục hồi', type: '1-1', logic: 'recovery', minLength: 7, threshold: 0.7 },
            
            7: { name: '2-2 chuẩn', type: '2-2', logic: 'pure', minLength: 6, threshold: 0.9 },
            8: { name: '2-2 lệch', type: '2-2', logic: 'offset', minLength: 7, threshold: 0.8 },
            9: { name: '2-2 biến tướng', type: '2-2', logic: 'variant', minLength: 8, threshold: 0.75 },
            10: { name: '2-2 kết hợp 1-1', type: '2-2', logic: 'hybrid', minLength: 8, threshold: 0.7 },
            11: { name: '2-2 dài', type: '2-2', logic: 'long', minLength: 10, threshold: 0.8 },
            12: { name: '2-2 bẻ', type: '2-2', logic: 'break', minLength: 7, threshold: 0.85 },
            
            13: { name: 'bệt ngắn', type: 'bệt', logic: 'short', minLength: 3, threshold: 0.8 },
            14: { name: 'bệt trung', type: 'bệt', logic: 'medium', minLength: 5, threshold: 0.85 },
            15: { name: 'bệt dài', type: 'bệt', logic: 'long', minLength: 7, threshold: 0.9 },
            16: { name: 'bệt gãy', type: 'bệt', logic: 'break', minLength: 5, threshold: 0.8 },
            17: { name: 'bệt xen kẽ', type: 'bệt', logic: 'hybrid', minLength: 6, threshold: 0.7 },
            18: { name: 'siêu bệt', type: 'bệt', logic: 'super', minLength: 10, threshold: 0.95 },
            
            19: { name: '3-3 chuẩn', type: '3-3', logic: 'pure', minLength: 9, threshold: 0.9 },
            20: { name: '3-3 biến thể', type: '3-3', logic: 'variant', minLength: 10, threshold: 0.8 },
            21: { name: '3-3 ngắn', type: '3-3', logic: 'short', minLength: 6, threshold: 0.7 },
            22: { name: '3-3 kết hợp', type: '3-3', logic: 'hybrid', minLength: 9, threshold: 0.75 },
            23: { name: '3-3 bẻ', type: '3-3', logic: 'break', minLength: 8, threshold: 0.8 },
            24: { name: '3-3 dài', type: '3-3', logic: 'long', minLength: 12, threshold: 0.85 },
            
            25: { name: '2-1-2 chuẩn', type: '2-1-2', logic: 'pure', minLength: 5, threshold: 0.9 },
            26: { name: '2-1-2 biến thể', type: '2-1-2', logic: 'variant', minLength: 6, threshold: 0.8 },
            27: { name: '2-1-2 dài', type: '2-1-2', logic: 'long', minLength: 8, threshold: 0.8 },
            28: { name: '1-2-1 chuẩn', type: '1-2-1', logic: 'pure', minLength: 5, threshold: 0.9 },
            29: { name: '1-2-1 biến thể', type: '1-2-1', logic: 'variant', minLength: 6, threshold: 0.8 },
            30: { name: '1-2-1 dài', type: '1-2-1', logic: 'long', minLength: 8, threshold: 0.8 },
            
            31: { name: 'bẻ cầu 1-1', type: 'break', logic: 'break11', minLength: 4, threshold: 0.85 },
            32: { name: 'bẻ cầu 2-2', type: 'break', logic: 'break22', minLength: 5, threshold: 0.85 },
            33: { name: 'bẻ cầu bệt', type: 'break', logic: 'breakStreak', minLength: 4, threshold: 0.8 },
            34: { name: 'chuyển tiếp 1-1 sang 2-2', type: 'transition', logic: '11to22', minLength: 6, threshold: 0.75 },
            35: { name: 'chuyển tiếp 2-2 sang 1-1', type: 'transition', logic: '22to11', minLength: 6, threshold: 0.75 },
            36: { name: 'chuyển tiếp bệt sang 1-1', type: 'transition', logic: 'streakTo11', minLength: 5, threshold: 0.7 },
            
            37: { name: 'phân tích tần suất', type: 'frequency', logic: 'frequency', minLength: 10, threshold: 0.7 },
            38: { name: 'phân tích chu kỳ', type: 'cycle', logic: 'cycle', minLength: 12, threshold: 0.7 },
            39: { name: 'phân tích đối xứng', type: 'symmetry', logic: 'symmetry', minLength: 8, threshold: 0.75 },
            40: { name: 'phân tích Fibonacci', type: 'fibonacci', logic: 'fibonacci', minLength: 8, threshold: 0.7 },
            41: { name: 'phân tích xu hướng dài', type: 'trend', logic: 'longTrend', minLength: 15, threshold: 0.8 },
            42: { name: 'tổng hợp siêu cầu', type: 'super', logic: 'super', minLength: 20, threshold: 0.85 }
        };
        
        for (let i = 1; i <= 42; i++) {
            this.subModels[`sub_model_${i}`] = {
                ...subModelSpecialties[i],
                weight: this.subModelWeights[`sub_model_${i}`] || 1.0,
                accuracy: 0.5,
                predictions: []
            };
        }
    }
    
    initMiniModels() {
        const specialties = {
            1: 'phat_hien_cau_dep', 2: 'du_doan_bien_dong', 3: 'phan_tich_so_sanh',
            4: 'nhan_dien_xu_huong_cuc_bo', 5: 'tinh_toan_xac_suat_cao', 6: 'phat_hien_diem_gay',
            7: 'du_doan_nguong', 8: 'phan_tich_chuoi', 9: 'nhan_dien_mau_lap',
            10: 'tinh_he_so_tuong_quan', 11: 'du_doan_doan_nhiet', 12: 'phan_tich_pha',
            13: 'nhan_dien_song', 14: 'tinh_toan_momentum', 15: 'du_doan_hoi_phuc',
            16: 'phat_hien_dot_bien', 17: 'phan_tich_can_bang', 18: 'nhan_dien_tan_so',
            19: 'du_doan_chu_ky', 20: 'tinh_toan_ma_tran', 21: 'phan_tich_tong_hop'
        };
        
        for (let i = 1; i <= 21; i++) {
            this.miniModels[`mini_model_${i}`] = {
                weight: this.miniModelWeights[`mini_model_${i}`] || 1.0,
                accuracy: 0.5,
                specialty: specialties[i] || 'chung',
                predictions: []
            };
        }
    }
    
    getResultArray(history) {
        return history.map(h => h.Ket_qua || (h.score >= 11 ? 'Tài' : 'Xỉu'));
    }
    
    runSubModel11(results, model) {
        if (results.length < model.minLength) return null;
        const last = results[results.length - 1];
        const last4 = results.slice(-4);
        
        switch (model.logic) {
            case 'pure':
                if (this.isPerfectAlternating(results, 4)) {
                    return { prediction: last === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.9, reason: 'Phát hiện cầu 1-1 thuần túy' };
                }
                break;
            case 'variant':
                if (this.isAlternatingWithTolerance(results, 1)) {
                    return { prediction: last === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.8, reason: 'Phát hiện cầu 1-1 biến thể' };
                }
                break;
            case 'long':
                const longResults = results.slice(-12);
                const altCount = this.countAlternating(longResults);
                if (altCount >= 8) {
                    return { prediction: last === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.7 + (altCount / 20), reason: `Cầu 1-1 dài hạn với ${altCount}/11 cặp đúng` };
                }
                break;
            case 'hybrid':
                const recent = results.slice(-5);
                if (recent[0] !== recent[1] && recent[1] !== recent[2] && recent[3] !== recent[4]) {
                    return { prediction: last === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.7, reason: 'Phát hiện cầu 1-1 kết hợp' };
                }
                break;
            case 'break':
                if (last4[0] !== last4[1] && last4[1] !== last4[2] && last4[2] !== last4[3]) {
                    const streak = this.getStreak(results.slice(0, -1));
                    if (streak > 4) {
                        return { prediction: last, confidence: 0.8, reason: 'Cầu 1-1 dài sắp gãy, dự đoán giữ nguyên' };
                    }
                }
                break;
            case 'recovery':
                if (last4[0] === last4[1] && last4[1] !== last4[2] && last4[2] !== last4[3]) {
                    return { prediction: last4[3] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.7, reason: 'Cầu 1-1 đang phục hồi sau gãy' };
                }
                break;
        }
        return null;
    }
    
    runSubModel22(results, model) {
        if (results.length < model.minLength) return null;
        const last = results[results.length - 1];
        const last6 = results.slice(-6);
        const last8 = results.slice(-8);
        
        switch (model.logic) {
            case 'pure':
                if (last6.length === 6 && last6[0] === last6[1] && last6[1] !== last6[2] && last6[2] === last6[3] && last6[3] !== last6[4] && last6[4] === last6[5]) {
                    return { prediction: last6[4] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.9, reason: 'Phát hiện cầu 2-2 chuẩn' };
                }
                break;
            case 'offset':
                if (last6.length === 6 && last6[0] === last6[1] && last6[1] !== last6[2] && last6[2] !== last6[3] && last6[3] === last6[4] && last6[4] !== last6[5]) {
                    return { prediction: last6[4] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.8, reason: 'Phát hiện cầu 2-2 lệch' };
                }
                break;
            case 'variant':
                if (last8.length === 8 && last8[0] === last8[1] && last8[1] !== last8[2] && last8[2] === last8[3] && last8[3] !== last8[4] && last8[4] === last8[5] && last8[5] !== last8[6] && last8[6] === last8[7]) {
                    return { prediction: last8[6] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.75, reason: 'Phát hiện cầu 2-2 biến tướng' };
                }
                break;
            case 'hybrid':
                if (last6.length === 6 && last6[0] === last6[1] && last6[1] !== last6[2] && last6[2] !== last6[3] && last6[3] !== last6[4] && last6[4] === last6[5]) {
                    return { prediction: last6[4] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.7, reason: 'Cầu 2-2 kết hợp 1-1' };
                }
                break;
            case 'long':
                if (last8.length === 8) {
                    let score = 0;
                    for (let i = 0; i < 7; i+=2) { if (last8[i] === last8[i+1]) score++; }
                    if (score >= 3) { return { prediction: last === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.7 + (score * 0.05), reason: `Cầu 2-2 dài với ${score}/4 cặp đúng` }; }
                }
                break;
            case 'break':
                if (last6.length === 6 && last6[0] === last6[1] && last6[1] !== last6[2] && last6[2] === last6[3] && last6[3] !== last6[4] && last6[4] !== last6[5]) {
                    return { prediction: last6[4], confidence: 0.85, reason: 'Phát hiện bẻ cầu 2-2' };
                }
                break;
        }
        return null;
    }
    
    runSubModelStreak(results, model) {
        if (results.length < model.minLength) return null;
        const last = results[results.length - 1];
        const other = last === 'Tài' ? 'Xỉu' : 'Tài';
        let streak = this.getStreak(results);
        
        switch (model.logic) {
            case 'short':
                if (streak >= 2 && streak <= 3) return { prediction: last, confidence: 0.7 + (streak * 0.05), reason: `Bệt ngắn ${streak} phiên` };
                break;
            case 'medium':
                if (streak >= 4 && streak <= 5) return { prediction: last, confidence: 0.75 + ((streak - 4) * 0.05), reason: `Bệt trung ${streak} phiên` };
                break;
            case 'long':
                if (streak >= 6) return { prediction: last, confidence: 0.8 + (Math.min(streak, 10) * 0.01), reason: `Bệt dài ${streak} phiên` };
                break;
            case 'break':
                if (streak >= 4) return { prediction: other, confidence: 0.6 + (streak * 0.03), reason: `Bệt ${streak} phiên, dự đoán sắp gãy` };
                break;
            case 'hybrid':
                if (streak >= 3) {
                    const prev = results[results.length - streak - 1];
                    if (prev && prev !== last) return { prediction: last, confidence: 0.7, reason: `Bệt sau khi đảo từ ${prev}` };
                }
                break;
            case 'super':
                if (streak >= 8) return { prediction: last, confidence: 0.9, reason: `Siêu bệt ${streak} phiên` };
                break;
        }
        return null;
    }
    
    runSubModel33(results, model) {
        if (results.length < model.minLength) return null;
        const last = results[results.length - 1];
        const last9 = results.slice(-9);
        const last12 = results.slice(-12);
        
        switch (model.logic) {
            case 'pure':
                if (last9.length === 9 && last9[0] === last9[1] && last9[1] === last9[2] && last9[3] === last9[4] && last9[4] === last9[5] && last9[6] === last9[7] && last9[7] === last9[8] && last9[0] !== last9[3] && last9[3] !== last9[6]) {
                    return { prediction: last9[6] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.9, reason: 'Phát hiện cầu 3-3 chuẩn' };
                }
                break;
            case 'variant':
                if (last12.length === 12) {
                    let score = 0;
                    for (let i = 0; i < 12; i+=3) { if (i+2 < 12 && last12[i] === last12[i+1] && last12[i+1] === last12[i+2]) score++; }
                    if (score >= 3) return { prediction: last === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.7 + (score * 0.05), reason: `Cầu 3-3 biến thể với ${score}/4 bộ ba` };
                }
                break;
            case 'short':
                if (results.length >= 6) {
                    const last6 = results.slice(-6);
                    if (last6[0] === last6[1] && last6[1] === last6[2] && last6[3] === last6[4] && last6[4] === last6[5]) {
                        return { prediction: last6[3] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.7, reason: 'Cầu 3-3 ngắn (6 phiên)' };
                    }
                }
                break;
            case 'hybrid':
                if (last9.length === 9 && last9[0] === last9[1] && last9[1] === last9[2] && last9[3] !== last9[4] && last9[5] === last9[6] && last9[6] === last9[7]) {
                    return { prediction: last9[6] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.75, reason: 'Cầu 3-3 kết hợp' };
                }
                break;
            case 'break':
                if (last9.length === 9 && last9[0] === last9[1] && last9[1] === last9[2] && last9[3] === last9[4] && last9[4] === last9[5] && last9[6] !== last9[7]) {
                    return { prediction: last9[6], confidence: 0.8, reason: 'Phát hiện bẻ cầu 3-3' };
                }
                break;
            case 'long':
                if (results.length >= 15) {
                    const last15 = results.slice(-15);
                    let pattern = [];
                    for (let i = 0; i < 15; i+=3) { if (i+2 < 15 && last15[i] === last15[i+1] && last15[i+1] === last15[i+2]) pattern.push(last15[i]); }
                    if (pattern.length >= 4 && pattern[0] !== pattern[1] && pattern[1] !== pattern[2]) {
                        return { prediction: pattern[pattern.length-1] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.8, reason: 'Cầu 3-3 dài hạn' };
                    }
                }
                break;
        }
        return null;
    }
    
    runSubModel212(results, model) {
        if (results.length < model.minLength) return null;
        const last5 = results.slice(-5);
        const last7 = results.slice(-7);
        
        switch (model.logic) {
            case 'pure':
                if (last5.length === 5 && last5[0] === last5[1] && last5[1] !== last5[2] && last5[2] !== last5[3] && last5[3] === last5[4] && last5[0] === last5[3]) {
                    return { prediction: last5[4] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.9, reason: 'Phát hiện cầu 2-1-2 chuẩn' };
                }
                break;
            case 'variant':
                if (last7.length === 7 && last7[0] === last7[1] && last7[1] !== last7[2] && last7[3] === last7[4] && last7[4] !== last7[5] && last7[0] === last7[3]) {
                    return { prediction: last7[5] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.8, reason: 'Phát hiện cầu 2-1-2 biến thể' };
                }
                break;
            case 'long':
                if (results.length >= 10) {
                    const last10 = results.slice(-10);
                    let count = 0;
                    for (let i = 0; i < 5; i+=2) { if (i+4 < 10 && last10[i] === last10[i+1] && last10[i+1] !== last10[i+2] && last10[i+3] === last10[i+4]) count++; }
                    if (count >= 2) return { prediction: results[results.length - 1] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.75, reason: 'Cầu 2-1-2 dài hạn' };
                }
                break;
        }
        return null;
    }
    
    runSubModel121(results, model) {
        if (results.length < model.minLength) return null;
        const last5 = results.slice(-5);
        const last7 = results.slice(-7);
        
        switch (model.logic) {
            case 'pure':
                if (last5.length === 5 && last5[0] !== last5[1] && last5[1] === last5[2] && last5[2] !== last5[3] && last5[3] === last5[4] && last5[0] === last5[3]) {
                    return { prediction: last5[4] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.9, reason: 'Phát hiện cầu 1-2-1 chuẩn' };
                }
                break;
            case 'variant':
                if (last7.length === 7 && last7[0] !== last7[1] && last7[1] === last7[2] && last7[3] !== last7[4] && last7[4] === last7[5] && last7[0] === last7[3]) {
                    return { prediction: last7[5] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.8, reason: 'Phát hiện cầu 1-2-1 biến thể' };
                }
                break;
            case 'long':
                if (results.length >= 10) {
                    const last10 = results.slice(-10);
                    let count = 0;
                    for (let i = 0; i < 5; i+=2) { if (i+4 < 10 && last10[i] !== last10[i+1] && last10[i+1] === last10[i+2] && last10[i+3] === last10[i+4]) count++; }
                    if (count >= 2) return { prediction: results[results.length - 1] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.75, reason: 'Cầu 1-2-1 dài hạn' };
                }
                break;
        }
        return null;
    }
    
    runSubModelBreak(results, model) {
        if (results.length < model.minLength) return null;
        const last = results[results.length - 1];
        const last4 = results.slice(-4);
        const last5 = results.slice(-5);
        const last6 = results.slice(-6);
        
        switch (model.logic) {
            case 'break11':
                if (last4.length === 4 && last4[0] !== last4[1] && last4[1] !== last4[2] && last4[2] === last4[3]) return { prediction: last4[3], confidence: 0.85, reason: 'Phát hiện bẻ cầu 1-1' };
                break;
            case 'break22':
                if (last5.length === 5 && last5[0] === last5[1] && last5[1] !== last5[2] && last5[2] === last5[3] && last5[3] !== last5[4] && last5[0] === last5[4]) return { prediction: last5[4], confidence: 0.85, reason: 'Phát hiện bẻ cầu 2-2' };
                break;
            case 'breakStreak':
                const streak = this.getStreak(results.slice(0, -1));
                if (streak >= 3 && last !== results[results.length - 2]) return { prediction: last, confidence: 0.8, reason: `Phát hiện bẻ cầu bệt sau ${streak} phiên` };
                break;
            case '11to22':
                if (last6.length === 6 && last6[0] !== last6[1] && last6[1] !== last6[2] && last6[2] === last6[3] && last6[3] !== last6[4] && last6[4] === last6[5]) return { prediction: last6[4] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.75, reason: 'Chuyển từ cầu 1-1 sang 2-2' };
                break;
            case '22to11':
                if (last6.length === 6 && last6[0] === last6[1] && last6[1] !== last6[2] && last6[2] !== last6[3] && last6[3] !== last6[4] && last6[4] !== last6[5]) return { prediction: last6[4] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.75, reason: 'Chuyển từ cầu 2-2 sang 1-1' };
                break;
            case 'streakTo11':
                if (last5.length === 5 && last5[0] === last5[1] && last5[1] === last5[2] && last5[2] !== last5[3] && last5[3] !== last5[4]) return { prediction: last5[4] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.7, reason: 'Chuyển từ bệt sang cầu 1-1' };
                break;
        }
        return null;
    }
    
    runSubModelAdvanced(results, model) {
        if (results.length < model.minLength) return null;
        switch (model.logic) {
            case 'frequency':
                const freq = this.analyzeFrequency(results);
                if (freq.dominant && freq.ratio > 0.6) return { prediction: freq.dominant, confidence: 0.6 + (freq.ratio * 0.2), reason: `Tần suất ${freq.dominant} chiếm ${(freq.ratio*100).toFixed(0)}%` };
                break;
            case 'cycle':
                const cycle = this.detectCycle(results);
                if (cycle.found) return { prediction: cycle.next, confidence: 0.7, reason: `Phát hiện chu kỳ ${cycle.length} phiên` };
                break;
            case 'symmetry':
                const symmetry = this.checkSymmetry(results);
                if (symmetry.found) return { prediction: symmetry.prediction, confidence: 0.75, reason: 'Phát hiện cầu đối xứng' };
                break;
            case 'fibonacci':
                const fib = this.checkFibonacci(results);
                if (fib.found) return { prediction: fib.prediction, confidence: 0.7, reason: 'Phát hiện cầu Fibonacci' };
                break;
            case 'longTrend':
                const trend = this.getLongTrend(results);
                if (trend.strength > 0.7) return { prediction: trend.direction, confidence: 0.7 + (trend.strength * 0.1), reason: `Xu hướng dài ${trend.direction} với độ mạnh ${(trend.strength*100).toFixed(0)}%` };
                break;
            case 'super':
                const superAnalysis = this.superAnalysis(results);
                if (superAnalysis.confidence > 0.8) return superAnalysis;
                break;
        }
        return null;
    }
    
    isPerfectAlternating(results, length) {
        const last = results.slice(-length);
        for (let i = 0; i < last.length - 1; i++) { if (last[i] === last[i+1]) return false; }
        return true;
    }
    isAlternatingWithTolerance(results, tolerance) {
        const last = results.slice(-6);
        let errors = 0;
        for (let i = 0; i < last.length - 1; i++) { if (last[i] === last[i+1]) errors++; }
        return errors <= tolerance;
    }
    countAlternating(results) {
        let count = 0;
        for (let i = 0; i < results.length - 1; i++) { if (results[i] !== results[i+1]) count++; }
        return count;
    }
    getStreak(results) {
        if (results.length === 0) return 0;
        const last = results[results.length - 1];
        let streak = 1;
        for (let i = results.length - 2; i >= 0; i--) { if (results[i] === last) streak++; else break; }
        return streak;
    }
    analyzeFrequency(results) {
        const recent = results.slice(-20);
        const taiCount = recent.filter(r => r === 'Tài').length;
        const xiuCount = recent.length - taiCount;
        return { dominant: taiCount > xiuCount ? 'Tài' : 'Xỉu', ratio: Math.max(taiCount, xiuCount) / recent.length };
    }
    detectCycle(results) {
        for (let cycleLen of [2, 3, 4]) {
            if (results.length < cycleLen * 2) continue;
            if (JSON.stringify(results.slice(-cycleLen)) === JSON.stringify(results.slice(-cycleLen*2, -cycleLen))) return { found: true, length: cycleLen, next: results.slice(-cycleLen)[0] };
        }
        return { found: false };
    }
    checkSymmetry(results) {
        if (results.length < 6) return { found: false };
        const last3 = results.slice(-3), prev3 = results.slice(-6, -3);
        if (last3[0] === prev3[2] && last3[1] === prev3[1] && last3[2] === prev3[0]) return { found: true, prediction: last3[1] };
        return { found: false };
    }
    checkFibonacci(results) {
        if (results.length < 5) return { found: false };
        for (let fib of [1, 2, 3, 5]) {
            if (results.length >= fib * 2 && JSON.stringify(results.slice(-fib)) === JSON.stringify(results.slice(-fib*2, -fib))) return { found: true, prediction: results.slice(-fib)[0] };
        }
        return { found: false };
    }
    getLongTrend(results) {
        if (results.length < 10) return { strength: 0, direction: null };
        const firstTai = results.slice(0, 5).filter(r => r === 'Tài').length, lastTai = results.slice(-5).filter(r => r === 'Tài').length;
        if (lastTai > firstTai + 2) return { strength: 0.8, direction: 'Tài' };
        if (lastTai < firstTai - 2) return { strength: 0.8, direction: 'Xỉu' };
        return { strength: 0.5, direction: lastTai > 2 ? 'Tài' : 'Xỉu' };
    }
    superAnalysis(results) {
        const freq = this.analyzeFrequency(results), trend = this.getLongTrend(results), cycle = this.detectCycle(results);
        let score = 0, predictions = [];
        if (freq.ratio > 0.6) { predictions.push({ pred: freq.dominant, weight: freq.ratio }); score++; }
        if (trend.strength > 0.7) { predictions.push({ pred: trend.direction, weight: trend.strength }); score++; }
        if (cycle.found) { predictions.push({ pred: cycle.next, weight: 0.7 }); score++; }
        if (score >= 2) {
            const tW = predictions.filter(p => p.pred === 'Tài').reduce((s, p) => s + p.weight, 0);
            const xW = predictions.filter(p => p.pred === 'Xỉu').reduce((s, p) => s + p.weight, 0);
            if (tW > xW * 1.5) return { prediction: 'Tài', confidence: 0.85, reason: 'Siêu phân tích đồng thuận Tài' };
            if (xW > tW * 1.5) return { prediction: 'Xỉu', confidence: 0.85, reason: 'Siêu phân tích đồng thuận Xỉu' };
        }
        return { confidence: 0 };
    }
    
    runSubModel(index, history) {
        if (history.length < 3) return null;
        const results = this.getResultArray(history);
        const model = this.subModels[`sub_model_${index}`];
        if (!model) return null;
        let result = null;
        switch (model.type) {
            case '1-1': result = this.runSubModel11(results, model); break;
            case '2-2': result = this.runSubModel22(results, model); break;
            case 'bệt': result = this.runSubModelStreak(results, model); break;
            case '3-3': result = this.runSubModel33(results, model); break;
            case '2-1-2': result = this.runSubModel212(results, model); break;
            case '1-2-1': result = this.runSubModel121(results, model); break;
            case 'break':
            case 'transition': result = this.runSubModelBreak(results, model); break;
            default: result = this.runSubModelAdvanced(results, model);
        }
        if (result) { result.model_name = model.name; return result; }
        return null;
    }
    
    runMiniModel(index, history) {
        if (history.length < 2) return null;
        const results = this.getResultArray(history);
        const miniModel = this.miniModels[`mini_model_${index}`];
        let prediction, confidence, reason;
        switch (miniModel.specialty) {
            case 'phat_hien_cau_dep':
                const pattern = this.analyzeBasicPatterns(history);
                prediction = pattern.prediction; confidence = pattern.confidence * 0.9; reason = pattern.reason;
                break;
            case 'du_doan_bien_dong':
                const dice = this.analyzeDiceVolatility(history);
                prediction = dice.prediction; confidence = dice.confidence * 0.8; reason = dice.reason;
                break;
            case 'nhan_dien_xu_huong_cuc_bo':
                const short = this.analyzeShortTerm(history);
                prediction = short.prediction; confidence = short.confidence * 0.85; reason = short.reason;
                break;
            case 'tinh_toan_xac_suat_cao':
                const tC = results.filter(r => r === 'Tài').length, xC = results.length - tC;
                if (tC > xC * 1.5) { prediction = 'Xỉu'; confidence = 0.7; reason = 'Xác suất Tài cao'; }
                else if (xC > tC * 1.5) { prediction = 'Tài'; confidence = 0.7; reason = 'Xác suất Xỉu cao'; }
                else { prediction = results[results.length - 1]; confidence = 0.5; reason = 'Xác suất cân bằng'; }
                break;
            case 'phan_tich_so_sanh':
                const currentPattern = results.slice(-5).join('');
                let matchFound = false;
                for (let [type, patterns] of Object.entries(this.patternLibrary)) {
                    if (patterns.includes(currentPattern)) { matchFound = true; prediction = results[results.length - 1] === 'Tài' ? 'Xỉu' : 'Tài'; confidence = 0.75; reason = `Khớp mẫu ${type}`; break; }
                }
                if (!matchFound) { prediction = results[results.length - 1]; confidence = 0.4; reason = 'Không tìm thấy mẫu'; }
                break;
            default:
                prediction = results[results.length - 1]; confidence = 0.5; reason = `Mini model ${index}`;
        }
        return { prediction, confidence: Math.min(confidence, 0.95), reason, model_name: `mini_${index}_${miniModel.specialty}` };
    }
    
    analyzeBasicPatterns(history) {
        if (history.length < 3) return { prediction: null, confidence: 0, reason: 'Không đủ dữ liệu' };
        const Math_max = Math.max;
        const results = this.getResultArray(history);
        const checkAlternating = (res) => { const last = res[res.length - 1]; let conf = 0.5; for (let i = res.length - 2; i >= Math_max(res.length - 6, 0); i -= 2) { if (res[i] === last) conf += 0.1; else break; } return { prediction: last === 'Tài' ? 'Xỉu' : 'Tài', confidence: Math.min(conf, 0.95) }; };
        
        const patterns = {
            '1-1': checkAlternating(results),
            '1-2-1': results[results.length - 3] === results[results.length - 1] && results[results.length - 2] !== results[results.length - 1] ? { prediction: results[results.length - 1], confidence: 0.7 } : { prediction: results[results.length - 1], confidence: 0.3 },
            '2-1-2': results[results.length - 3] !== results[results.length - 1] && results[results.length - 2] === results[results.length - 1] ? { prediction: results[results.length - 2], confidence: 0.7 } : { prediction: results[results.length - 1], confidence: 0.3 },
            '3-1': results[results.length - 4] === results[results.length - 3] && results[results.length - 3] === results[results.length - 2] && results[results.length - 2] !== results[results.length - 1] ? { prediction: results[results.length - 1], confidence: 0.8 } : { prediction: results[results.length - 1], confidence: 0.2 },
            '1-3': results[results.length - 4] !== results[results.length - 3] && results[results.length - 3] === results[results.length - 2] && results[results.length - 2] === results[results.length - 1] ? { prediction: results[results.length - 1], confidence: 0.8 } : { prediction: results[results.length - 1], confidence: 0.2 },
            '2-2': results[results.length - 4] === results[results.length - 3] && results[results.length - 2] === results[results.length - 1] && results[results.length - 3] !== results[results.length - 2] ? { prediction: results[results.length - 1], confidence: 0.75 } : { prediction: results[results.length - 1], confidence: 0.25 },
            'cầu_bệt': (() => { let streak = this.getStreak(results); if (streak >= 3) return { prediction: results[results.length - 1], confidence: Math.min(0.6 + (streak * 0.05), 0.9) }; return { prediction: results[results.length - 1], confidence: 0.4 }; })(),
            'cầu_đảo': results[results.length - 2] !== results[results.length - 1] ? { prediction: results[results.length - 1], confidence: 0.5 } : { prediction: results[results.length - 1] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.4 }
        };
        let bestPattern = null, bestConfidence = 0, bestKey = '';
        for (let [key, value] of Object.entries(patterns)) { if (value && value.confidence > bestConfidence) { bestConfidence = value.confidence; bestPattern = value; bestKey = key; } }
        if (bestConfidence === 0) return { prediction: results[results.length - 1], confidence: 0.3, reason: 'Không rõ pattern' };
        return { prediction: bestPattern.prediction, confidence: bestPattern.confidence, pattern_type: bestKey, reason: `Cầu ${bestKey} (${(bestPattern.confidence * 100).toFixed(0)}%)` };
    }
    
    analyzeTrend(history) {
        if (history.length < 5) return { prediction: null, confidence: 0, reason: 'Không đủ dữ liệu' };
        const results = this.getResultArray(history);
        const shortTrend = this.getMostCommon(this.countResults(results.slice(-3))), longTrend = this.getMostCommon(this.countResults(results.slice(-10))), momentum = this.calculateMomentum(results);
        if (shortTrend.count >= 2 && longTrend.count >= 6) return { prediction: shortTrend.value, confidence: Math.min(0.7 + momentum * 0.1, 0.95), reason: `Xu hướng đồng thuận ${shortTrend.value}` };
        if (shortTrend.count >= 2) return { prediction: shortTrend.value, confidence: Math.min(0.6 + momentum * 0.1, 0.95), reason: `Trend ngắn ${shortTrend.value}` };
        return { prediction: results[results.length - 1] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.5, reason: "Không rõ xu hướng, đánh đảo chiều" };
    }
    countResults(results) { const counts = { 'Tài': 0, 'Xỉu': 0 }; results.forEach(r => counts[r]++); return counts; }
    getMostCommon(counts) { return counts['Tài'] >= counts['Xỉu'] ? { value: 'Tài', count: counts['Tài'] } : { value: 'Xỉu', count: counts['Xỉu'] }; }
    calculateMomentum(results) { if (results.length < 5) return 0; const tC = results.slice(-5).filter(r => r === 'Tài').length; return (tC === 5 || tC === 0) ? 0.3 : 0.15; }
    
    analyzeImbalance(history) {
        if (history.length < 12) return { prediction: null, confidence: 0, reason: 'Không đủ phiên' };
        const results = this.getResultArray(history.slice(-12)), tC = results.filter(r => r === 'Tài').length, xC = results.length - tC, ratio = Math.abs(tC - xC) / 12;
        if (ratio > 0.4) return { prediction: tC > xC ? 'Xỉu' : 'Tài', confidence: Math.min(0.7 + ratio * 0.2, 0.95), reason: `Lệch lớn ${tC}T - ${xC}X` };
        return { prediction: results[results.length - 1], confidence: 0.5, reason: "Cân bằng, bám trend" };
    }
    analyzeShortTerm(history) {
        if (history.length < 3) return { prediction: null, confidence: 0, reason: 'Thiếu dữ liệu' };
        const results = this.getResultArray(history), last3 = results.slice(-3), patterns = [];
        if (last3[0] === last3[1] && last3[1] === last3[2]) patterns.push({ type: 'bệt', prediction: last3[0], confidence: 0.75 });
        if (last3[0] === last3[1] && last3[1] !== last3[2]) patterns.push({ type: '2-1', prediction: last3[2], confidence: 0.7 });
        if (results.length >= 4 && results.slice(-4)[0] !== results.slice(-4)[1] && results.slice(-4)[1] !== results.slice(-4)[2] && results.slice(-4)[2] !== results.slice(-4)[3]) patterns.push({ type: 'xen_kẽ', prediction: last3[2] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.8 });
        if (patterns.length > 0) { const best = patterns.reduce((b, c) => c.confidence > b.confidence ? c : b); return { prediction: best.prediction, confidence: best.confidence, reason: `Pattern ${best.type} ngắn hạn` }; }
        return { prediction: results[results.length - 1], confidence: 0.4, reason: "Hỗn loạn ngắn hạn" };
    }
    analyzeDiceVolatility(history) {
        if (history.length < 5) return { prediction: null, confidence: 0, reason: 'Thiếu dữ liệu' };
        const recentFaces = []; history.slice(-5).forEach(h => { if (h.Xuc_xac_1) recentFaces.push(h.Xuc_xac_1, h.Xuc_xac_2, h.Xuc_xac_3); });
        const recentFreq = {1:0, 2:0, 3:0, 4:0, 5:0, 6:0}; recentFaces.forEach(f => recentFreq[f]++);
        const predictions = []; for (let f = 1; f <= 6; f++) { if (recentFreq[f] < 2) predictions.push({ face: f, prob: 0.3 + (2 - recentFreq[f]) * 0.1 }); }
        if (predictions.length > 0) {
            predictions.sort((a, b) => b.prob - a.prob); const top = predictions.slice(0, 3).map(p => p.face);
            const scoreAvg = top.reduce((a, b) => a + b, 0) / (top.length || 1) * 3;
            return { prediction: scoreAvg >= 11 ? 'Tài' : 'Xỉu', confidence: 0.65, reason: `Xúc xắc đẩy nhịp mặt hot` };
        }
        return { prediction: history[history.length - 1].Ket_qua, confidence: 0.4, reason: "Bình ổn mặt xúc xắc" };
    }
    
    ensembleModels(history) {
        const resultsArray = this.getResultArray(history);
        const resultsStr = resultsArray.map(r => r === 'Tài' ? 'T' : 'X').join('');
        
        // --- QUÉT THUẬT TOÁN MỚI (ƯU TIÊN TUYỆT ĐỐI) ---
        let newAlgoMatch = null;
        let matchedPattern = '';
        const maxLen = Math.min(7, resultsStr.length);
        
        for (let len = maxLen; len >= 3; len--) {
            const currentSuffix = resultsStr.slice(-len);
            if (NEW_ALGORITHM_PATTERNS[currentSuffix]) {
                newAlgoMatch = NEW_ALGORITHM_PATTERNS[currentSuffix];
                matchedPattern = currentSuffix;
                break;
            }
        }
        
        if (newAlgoMatch) {
            const finalPrediction = newAlgoMatch.prediction;
            const finalConfidence = newAlgoMatch.confidence / 100;
            const finalReason = `Khớp Thuật Toán Mới nâng cao [${matchedPattern}]`;
            return {
                prediction: finalPrediction,
                confidence: finalConfidence,
                reason: finalReason,
                pattern_type: `THUẬT TOÁN MỚI [${matchedPattern}]`,
                pattern: matchedPattern,
                details: [{ model: 'NEW_ALGO', prediction: finalPrediction, confidence: finalConfidence, weight: 10, reason: finalReason }]
            };
        }
        
        // Chạy hệ thống 84 nền tảng nếu không khớp bộ quy tắc mới
        const modelResults = {};
        modelResults.model1 = this.analyzeBasicPatterns(history);
        modelResults.model2 = this.analyzeTrend(history);
        modelResults.model3 = this.analyzeImbalance(history);
        modelResults.model4 = this.analyzeShortTerm(history);
        modelResults.model11 = this.analyzeDiceVolatility(history);
        
        for (let i = 1; i <= 42; i++) { const res = this.runSubModel(i, history); if (res && res.prediction) modelResults[`sub_model_${i}`] = res; }
        for (let i = 1; i <= 21; i++) { const res = this.runMiniModel(i, history); if (res && res.prediction) modelResults[`mini_model_${i}`] = res; }
        
        let tW = 0, xW = 0, totW = 0, details = [];
        for (let [mName, result] of Object.entries(modelResults)) {
            if (result && result.prediction && result.confidence > 0.3) {
                let w = mName.startsWith('sub') ? (this.subModelWeights[mName] || 1.0) : (mName.startsWith('mini') ? (this.miniModelWeights[mName] || 1.0) : (this.modelWeights[mName] || 1.0));
                let wConf = w * result.confidence;
                if (result.prediction === 'Tài') tW += wConf; else xW += wConf;
                totW += wConf;
                details.push({ model: result.model_name || mName, prediction: result.prediction, confidence: result.confidence, weight: w, reason: result.reason });
            }
        }
        details.sort((a, b) => b.confidence - a.confidence);
        
        let fPred, fConf, fReason;
        if (totW > 0) {
            const tR = tW / totW, xR = xW / totW;
            if (tR > 0.55) { fPred = 'Tài'; fConf = tR; fReason = `${details.length} khối đồng thuận Tài`; }
            else if (xR > 0.55) { fPred = 'Xỉu'; fConf = xR; fReason = `${details.length} khối đồng thuận Xỉu`; }
            else { const best = details[0]; fPred = best ? best.prediction : 'Tài'; fConf = 0.5; fReason = 'Cân bằng pha, lấy Core max'; }
        } else {
            fPred = history.length > 0 ? this.getResultArray(history.slice(-1))[0] : 'Tài'; fConf = 0.5; fReason = "Thiếu dữ liệu model nền";
        }
        
        return {
            prediction: fPred,
            confidence: fConf,
            reason: fReason,
            pattern_type: details.length > 0 ? details[0].model : 'Ma Trận Cân Bằng',
            pattern: history.length > 0 ? this.getResultArray(history.slice(-5)).join('') : '',
            details: details.slice(0, 5)
        };
    }
    
    updateModelWeights(actual, predicted, confidence) {
        const correct = (actual === predicted) ? 1 : 0;
        for (let m in this.modelWeights) this.modelWeights[m] = correct ? Math.min(this.modelWeights[m] * 1.01, 2.0) : Math.max(this.modelWeights[m] * 0.99, 0.5);
        for (let m in this.subModelWeights) this.subModelWeights[m] = correct ? Math.min(this.subModelWeights[m] * 1.005, 1.5) : Math.max(this.subModelWeights[m] * 0.995, 0.7);
        for (let m in this.miniModelWeights) this.miniModelWeights[m] = correct ? Math.min(this.miniModelWeights[m] * 1.003, 1.3) : Math.max(this.miniModelWeights[m] * 0.997, 0.8);
        saveModelWeights();
    }
}

const analyzer = new TaiXiuAnalyzer();

// ==================== API HTTP CHO LC79 & BETVIP ====================
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
        console.error('[❌] Fetch error:', error.message);
        return null;
    }
}

async function predictGame(apiUrl, gameName) {
    const data = await fetchGameData(apiUrl);
    if (!data || data.length < 10) {
        return { error: "Không thể lấy dữ liệu", game: gameName };
    }
    
    const latest = data[0];
    const nextPhien = latest.phien + 1;
    
    const historyForAnalyzer = data.map(item => ({
        Ket_qua: item.result,
        Xuc_xac_1: item.dice[0],
        Xuc_xac_2: item.dice[1],
        Xuc_xac_3: item.dice[2],
        Tong: item.sum
    }));
    
    const ensembleResult = analyzer.ensembleModels(historyForAnalyzer);
    const finalConfidence = Math.round(ensembleResult.confidence * 100);
    
    let confidenceLabel = '';
    if (finalConfidence >= 85) confidenceLabel = 'RẤT CAO 🔥';
    else if (finalConfidence >= 75) confidenceLabel = 'CAO ✅';
    else if (finalConfidence >= 65) confidenceLabel = 'TRUNG BÌNH ⚠️';
    else confidenceLabel = 'THẤP ⚡';
    
    return {
        status: "success",
        game: gameName,
        phien_hien_tai: nextPhien,
        du_doan: ensembleResult.prediction,
        do_tin_cay: `${finalConfidence}%`,
        nhan_xet: confidenceLabel,
        loai_cau: ensembleResult.pattern_type,
        mau_cau: ensembleResult.pattern || '',
        ket_qua_thuc_te: latest.result,
        tong_diem: latest.sum,
        xuc_xac: latest.dice,
        timestamp: new Date().toISOString(),
        author: "@tranhoang2286"
    };
}

// ==================== EXPRESS ROUTING APIS ====================
app.get('/', (req, res) => res.json({
    name: "LC79 & BETVIP PREDICTION API",
    author: "@tranhoang2286",
    description: "Thuật toán dự đoán Tài Xỉu với 84 models + 200+ patterns",
    endpoints: {
        "/lc79-hu": "LC79 Tài Xỉu Hũ",
        "/lc79-md5": "LC79 Tài Xỉu MD5",
        "/betvip-hu": "BETVIP Tài Xỉu Hũ",
        "/betvip-md5": "BETVIP Tài Xỉu MD5"
    }
}));

app.get('/lc79-hu', async (req, res) => {
    try {
        const result = await predictGame(API_URLS.lc79_hu, "LC79 HŨ");
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/lc79-md5', async (req, res) => {
    try {
        const result = await predictGame(API_URLS.lc79_md5, "LC79 MD5");
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/betvip-hu', async (req, res) => {
    try {
        const result = await predictGame(API_URLS.betvip_hu, "BETVIP HŨ");
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/betvip-md5', async (req, res) => {
    try {
        const result = await predictGame(API_URLS.betvip_md5, "BETVIP MD5");
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log(`[🌐] Server is running at http://localhost:${PORT}`);
    console.log(`[🎲] Endpoints: /lc79-hu, /lc79-md5, /betvip-hu, /betvip-md5`);
    console.log(`[🤖] Total models: 84 Models + Advanced Pattern Matrix`);
});
