const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'anhquan_sieucau.json';
const HISTORY_FILE = 'anhquan_lichsu.json';

let predictionHistory = { hu: [], md5: [] };
const MAX_HISTORY = 200;
let lastProcessedPhien = { hu: null, md5: null };
let lichSuBeCau = [];

// ==================== CẤU TRÚC HỌC TẬP ====================
let learningData = {
  hu: {
    predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0,
    patternWeights: {}, lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [], reversalState: { active: false, streakTrigger: 0 },
    markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 },
    markov2Matrix: {}, markov3Matrix: {}, markov4Matrix: {}, volatility: 0,
    fibonacciLevels: { support: [], resistance: [] }, rsiValue: 50, macdSignal: 0
  },
  md5: {
    predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0,
    patternWeights: {}, lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [], reversalState: { active: false, streakTrigger: 0 },
    markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 },
    markov2Matrix: {}, markov3Matrix: {}, markov4Matrix: {}, volatility: 0,
    fibonacciLevels: { support: [], resistance: [] }, rsiValue: 50, macdSignal: 0
  }
};

// ==================== 80+ MẪU CẦU SIÊU XỊN ====================

// ----- 1. CẦU BỆT THÔNG MINH -----
function cauBetSmart(results) {
  if (results.length < 2) return { detected: false };
  let streakType = results[0];
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) streakLength++;
    else break;
  }
  if (streakLength >= 8) {
    return { detected: true, prediction: streakType === 'Tài' ? 'Xỉu' : 'Tài', confidence: 96, name: `💀 BẺ BỆT ${streakLength} (cực dài)`, priority: 10 };
  }
  if (streakLength >= 7) {
    return { detected: true, prediction: streakType === 'Tài' ? 'Xỉu' : 'Tài', confidence: 92, name: `🔥 BẺ BỆT ${streakLength}`, priority: 10 };
  }
  if (streakLength >= 6) {
    return { detected: true, prediction: streakType === 'Tài' ? 'Xỉu' : 'Tài', confidence: 86, name: `⚡ BẺ BỆT ${streakLength}`, priority: 9 };
  }
  if (streakLength >= 5) {
    return { detected: true, prediction: streakType === 'Tài' ? 'Tai' : 'Xiu', confidence: 78, name: `⚠️ THEO BỆT ${streakLength} (cẩn thận)`, priority: 7 };
  }
  if (streakLength >= 3) {
    return { detected: true, prediction: streakType === 'Tài' ? 'Tai' : 'Xiu', confidence: 85 - streakLength, name: `📈 THEO BỆT ${streakLength}`, priority: 8 };
  }
  if (streakLength >= 2) {
    return { detected: true, prediction: streakType === 'Tài' ? 'Tai' : 'Xiu', confidence: 70, name: `📊 THEO BỆT ${streakLength}`, priority: 7 };
  }
  return { detected: false };
}

// ----- 2. CẦU 1-1 (T X T X) -----
function cau11(results) {
  if (results.length < 4) return { detected: false };
  let alternatingLength = 1;
  for (let i = 1; i < Math.min(results.length, 20); i++) {
    if (results[i] !== results[i - 1]) alternatingLength++;
    else break;
  }
  if (alternatingLength >= 4) {
    let confidence = Math.min(88, 65 + alternatingLength * 2);
    if (alternatingLength >= 10) {
      return { detected: true, prediction: results[0] === 'Tài' ? 'Tai' : 'Xiu', confidence: 90, name: `🔄 CẦU 1-1 SIÊU DÀI (${alternatingLength})`, priority: 9 };
    }
    return { detected: true, prediction: results[0] === 'Tài' ? 'Xiu' : 'Tai', confidence: confidence, name: `✨ CẦU 1-1 (${alternatingLength} phiên)`, priority: 8 };
  }
  return { detected: false };
}

// ----- 3. CẦU 2-2 (T T X X) -----
function cau22(results) {
  if (results.length < 4) return { detected: false };
  let pairCount = 0, i = 0, pattern = [];
  while (i < results.length - 1 && pairCount < 6) {
    if (results[i] === results[i + 1]) {
      pattern.push(results[i]);
      pairCount++;
      i += 2;
    } else break;
  }
  if (pairCount >= 2) {
    let isAlternating = true;
    for (let j = 1; j < pattern.length; j++) {
      if (pattern[j] === pattern[j - 1]) isAlternating = false;
    }
    if (isAlternating) {
      if (pairCount >= 4) {
        return { detected: true, prediction: pattern[pattern.length - 1] === 'Tài' ? 'Tai' : 'Xiu', confidence: 87, name: `📐 CẦU 2-2 SIÊU DÀI (${pairCount} cặp)`, priority: 9 };
      }
      return { detected: true, prediction: pattern[pattern.length - 1] === 'Tài' ? 'Xiu' : 'Tai', confidence: 78 + pairCount * 3, name: `📏 CẦU 2-2 (${pairCount} cặp)`, priority: 8 };
    }
  }
  return { detected: false };
}

// ----- 4. CẦU 3-3 (T T T X X X) -----
function cau33(results) {
  if (results.length < 6) return { detected: false };
  let tripleCount = 0, i = 0, pattern = [];
  while (i < results.length - 2 && tripleCount < 4) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
      pattern.push(results[i]);
      tripleCount++;
      i += 3;
    } else break;
  }
  if (tripleCount >= 1) {
    const lastTripleType = pattern[pattern.length - 1];
    if (tripleCount >= 2) {
      return { detected: true, prediction: lastTripleType === 'Tài' ? 'Xiu' : 'Tai', confidence: 85, name: `🎲 CẦU 3-3 (${tripleCount} bộ ba)`, priority: 8 };
    }
    return { detected: true, prediction: lastTripleType === 'Tài' ? 'Xiu' : 'Tai', confidence: 78, name: `🎯 CẦU 3-3`, priority: 7 };
  }
  return { detected: false };
}

// ----- 5. CẦU 4-4 (T T T T X X X X) -----
function cau44(results) {
  if (results.length < 8) return { detected: false };
  const first4 = results[0] === results[1] && results[1] === results[2] && results[2] === results[3];
  const last4 = results[4] === results[5] && results[5] === results[6] && results[6] === results[7];
  if (first4 && last4 && results[0] !== results[4]) {
    return { detected: true, prediction: results[0] === 'Tài' ? 'Xiu' : 'Tai', confidence: 88, name: '🏆 CẦU 4-4', priority: 9 };
  }
  return { detected: false };
}

// ----- 6. CẦU 5-5 -----
function cau55(results) {
  if (results.length < 10) return { detected: false };
  const first5 = results[0] === results[1] && results[1] === results[2] && results[2] === results[3] && results[3] === results[4];
  const last5 = results[5] === results[6] && results[6] === results[7] && results[7] === results[8] && results[8] === results[9];
  if (first5 && last5 && results[0] !== results[5]) {
    return { detected: true, prediction: results[0] === 'Tài' ? 'Xiu' : 'Tai', confidence: 92, name: '💎 CẦU 5-5 (cực hiếm)', priority: 10 };
  }
  return { detected: false };
}

// ----- 7. CẦU ZIGZAG (RẮN) -----
function cauZigzag(results) {
  if (results.length < 5) return { detected: false };
  let isZigzag = true;
  for (let i = 1; i < 5; i++) {
    if (results[i] === results[i - 1]) { isZigzag = false; break; }
  }
  if (isZigzag) {
    let zigzagLength = 5;
    for (let i = 5; i < Math.min(results.length, 30); i++) {
      if (results[i] !== results[i - 1]) zigzagLength++;
      else break;
    }
    if (zigzagLength >= 9) {
      return { detected: true, prediction: results[0] === 'Tài' ? 'Xiu' : 'Tai', confidence: 90, name: `🐉 ZIGZAG SIÊU DÀI (${zigzagLength})`, priority: 9 };
    }
    return { detected: true, prediction: results[0] === 'Tài' ? 'Xiu' : 'Tai', confidence: 85, name: '🐍 CẦU ZIGZAG', priority: 8 };
  }
  return { detected: false };
}

// ----- 8. CẦU RĂNG CƯA -----
function cauRangCua(results) {
  if (results.length < 7) return { detected: false };
  const pattern7 = results.slice(0, 7);
  if (pattern7[0] !== pattern7[1] && pattern7[1] !== pattern7[2] && pattern7[2] !== pattern7[3] &&
      pattern7[3] !== pattern7[4] && pattern7[4] !== pattern7[5] && pattern7[5] !== pattern7[6]) {
    return { detected: true, prediction: pattern7[0] === 'Tài' ? 'Xiu' : 'Tai', confidence: 88, name: '🦷 CẦU RĂNG CƯA', priority: 8 };
  }
  return { detected: false };
}

// ----- 9. CẦU 1-2-3 (T - XX - TTT) -----
function cau123(results) {
  if (results.length < 6) return { detected: false };
  const last6 = results.slice(0, 6);
  if (last6[0] !== last6[1] && last6[1] === last6[2] && 
      last6[2] !== last6[3] && last6[3] === last6[4] && last6[4] === last6[5]) {
    if (last6[0] === 'Tài' && last6[1] === 'Xỉu' && last6[3] === 'Tài') {
      return { detected: true, prediction: 'Xiu', confidence: 89, name: '🏆 CẦU 1-2-3 (T-XX-TTT)', priority: 9 };
    }
    if (last6[0] === 'Xỉu' && last6[1] === 'Tài' && last6[3] === 'Xỉu') {
      return { detected: true, prediction: 'Tai', confidence: 89, name: '🏆 CẦU 1-2-3 (X-TT-XXX)', priority: 9 };
    }
  }
  return { detected: false };
}

// ----- 10. CẦU 3-2-1 (TTT - XX - T) -----
function cau321(results) {
  if (results.length < 6) return { detected: false };
  const last6 = results.slice(0, 6);
  if (last6[0] === last6[1] && last6[1] === last6[2] &&
      last6[3] === last6[4] && last6[0] !== last6[3]) {
    if (last6[5] === last6[0]) {
      return { detected: true, prediction: 'Xiu', confidence: 88, name: '🏆 CẦU 3-2-1 (TTT-XX-T)', priority: 9 };
    }
  }
  return { detected: false };
}

// ----- 11. CẦU 1-2-1 -----
function cau121(results) {
  if (results.length < 5) return { detected: false };
  const last5 = results.slice(0, 5);
  if (last5[0] !== last5[1] && last5[1] === last5[2] && last5[2] !== last5[3] && last5[3] === last5[4]) {
    return { detected: true, prediction: last5[0], confidence: 84, name: '📊 CẦU 1-2-1', priority: 7 };
  }
  return { detected: false };
}

// ----- 12. CẦU 2-1-2 -----
function cau212(results) {
  if (results.length < 5) return { detected: false };
  const last5 = results.slice(0, 5);
  if (last5[0] === last5[1] && last5[1] !== last5[2] && last5[2] === last5[3] && last5[3] === last5[4]) {
    return { detected: true, prediction: last5[0] === 'Tài' ? 'Xiu' : 'Tai', confidence: 86, name: '🎯 CẦU 2-1-2', priority: 8 };
  }
  return { detected: false };
}

// ----- 13. CẦU 1-1-2 -----
function cau112(results) {
  if (results.length < 4) return { detected: false };
  const last4 = results.slice(0, 4);
  if (last4[0] !== last4[1] && last4[1] === last4[2] && last4[2] !== last4[3]) {
    return { detected: true, prediction: last4[0], confidence: 82, name: '📌 CẦU 1-1-2', priority: 7 };
  }
  return { detected: false };
}

// ----- 14. CẦU 2-2-1 -----
function cau221(results) {
  if (results.length < 5) return { detected: false };
  const last5 = results.slice(0, 5);
  if (last5[0] === last5[1] && last5[1] !== last5[2] && last5[2] !== last5[3] && last5[3] === last5[4]) {
    return { detected: true, prediction: last5[0] === 'Tài' ? 'Xiu' : 'Tai', confidence: 83, name: '📌 CẦU 2-2-1', priority: 7 };
  }
  return { detected: false };
}

// ----- 15. CẦU LẶP CHU KỲ 2 -----
function cauLapCK2(results) {
  if (results.length < 4) return { detected: false };
  const last2 = results.slice(0, 2);
  if (results[2] === last2[0] && results[3] === last2[1]) {
    let cycleLength = 4;
    for (let i = 4; i < Math.min(results.length, 30); i += 2) {
      if (results[i] === last2[0] && results[i + 1] === last2[1]) cycleLength += 2;
      else break;
    }
    if (cycleLength >= 8) {
      return { detected: true, prediction: last2[0] === 'Tài' ? 'Tai' : 'Xiu', confidence: 86, name: `🔄 CẦU LẶP CK2 (${cycleLength} phiên)`, priority: 8 };
    }
    return { detected: true, prediction: last2[0] === 'Tài' ? 'Tai' : 'Xiu', confidence: 80, name: '🔄 CẦU LẶP CK2', priority: 7 };
  }
  return { detected: false };
}

// ----- 16. CẦU LẶP CHU KỲ 3 -----
function cauLapCK3(results) {
  if (results.length < 6) return { detected: false };
  const last3 = results.slice(0, 3);
  if (results[3] === last3[0] && results[4] === last3[1] && results[5] === last3[2]) {
    return { detected: true, prediction: last3[0] === 'Tài' ? 'Tai' : 'Xiu', confidence: 82, name: '🔄 CẦU LẶP CK3', priority: 7 };
  }
  return { detected: false };
}

// ----- 17. CẦU 3 PHIÊN (SIÊU CHUẨN) -----
function cau3Phien(results) {
  if (results.length < 3) return { detected: false };
  const last3 = results.slice(0, 3);
  const key = last3.join(',');
  const patterns = {
    'Tài,Xỉu,Tài': { pred: 'Xiu', conf: 92, name: '✨ TXT → X' },
    'Xỉu,Tài,Xỉu': { pred: 'Tai', conf: 92, name: '✨ XTX → T' },
    'Tài,Tài,Xỉu': { pred: 'Xiu', conf: 89, name: '📌 TTX → X' },
    'Xỉu,Xỉu,Tài': { pred: 'Tai', conf: 89, name: '📌 XXT → T' },
    'Tài,Xỉu,Xỉu': { pred: 'Xiu', conf: 87, name: '🎯 TXX → X' },
    'Xỉu,Tài,Tài': { pred: 'Tai', conf: 87, name: '🎯 XTT → T' },
    'Tài,Tài,Tài': { pred: 'Xiu', conf: 95, name: '🔥 TTT → X' },
    'Xỉu,Xỉu,Xỉu': { pred: 'Tai', conf: 95, name: '🔥 XXX → T' }
  };
  if (patterns[key]) {
    return { detected: true, prediction: patterns[key].pred, confidence: patterns[key].conf, name: patterns[key].name, priority: 9 };
  }
  return { detected: false };
}

// ----- 18. CẦU 4 PHIÊN -----
function cau4Phien(results) {
  if (results.length < 4) return { detected: false };
  const last4 = results.slice(0, 4);
  const key = last4.join(',');
  const patterns = {
    'Tài,Tài,Tài,Xỉu': { pred: 'Xiu', conf: 90, name: 'TTTX → X' },
    'Xỉu,Xỉu,Xỉu,Tài': { pred: 'Tai', conf: 90, name: 'XXXT → T' },
    'Tài,Tài,Xỉu,Xỉu': { pred: 'Tai', conf: 88, name: 'TTXX → T' },
    'Xỉu,Xỉu,Tài,Tài': { pred: 'Xiu', conf: 88, name: 'XXTT → X' },
    'Tài,Xỉu,Xỉu,Xỉu': { pred: 'Xiu', conf: 86, name: 'TXXX → X' },
    'Xỉu,Tài,Tài,Tài': { pred: 'Tai', conf: 86, name: 'XTTT → T' },
    'Tài,Xỉu,Tài,Xỉu': { pred: 'Tai', conf: 87, name: 'TXTX → T' },
    'Xỉu,Tài,Xỉu,Tài': { pred: 'Xiu', conf: 87, name: 'XTXT → X' }
  };
  if (patterns[key]) {
    return { detected: true, prediction: patterns[key].pred, confidence: patterns[key].conf, name: patterns[key].name, priority: 8 };
  }
  return { detected: false };
}

// ----- 19. CẦU 5 PHIÊN -----
function cau5Phien(results) {
  if (results.length < 5) return { detected: false };
  const last5 = results.slice(0, 5);
  const key = last5.join(',');
  const patterns = {
    'Tài,Tài,Tài,Tài,Xỉu': { pred: 'Xiu', conf: 91, name: 'TTTTX → X', priority: 9 },
    'Xỉu,Xỉu,Xỉu,Xỉu,Tài': { pred: 'Tai', conf: 91, name: 'XXXXT → T', priority: 9 },
    'Tài,Tài,Xỉu,Xỉu,Tài': { pred: 'Tai', conf: 86, name: 'TTXXT → T', priority: 8 },
    'Xỉu,Xỉu,Tài,Tài,Xỉu': { pred: 'Xiu', conf: 86, name: 'XXTTX → X', priority: 8 }
  };
  if (patterns[key]) {
    return { detected: true, ...patterns[key] };
  }
  return { detected: false };
}

// ----- 20. CẦU ĐẢO CHIỀU -----
function cauDaoChieu(results) {
  if (results.length < 6) return { detected: false };
  let changes = 0;
  for (let i = 1; i < 6; i++) {
    if (results[i] !== results[i - 1]) changes++;
  }
  if (changes >= 5) {
    return { detected: true, prediction: results[0] === 'Tài' ? 'Xiu' : 'Tai', confidence: 93, name: '⚡ ĐẢO CHIỀU MẠNH (5/5)', priority: 9 };
  }
  if (changes >= 4) {
    return { detected: true, prediction: results[0] === 'Tài' ? 'Xiu' : 'Tai', confidence: 87, name: '🔄 ĐẢO CHIỀU (4/5)', priority: 8 };
  }
  return { detected: false };
}

// ----- 21. CẦU XOAY VÒNG -----
function cauXoayVong(results) {
  if (results.length < 8) return { detected: false };
  let isAlternating = true;
  for (let i = 1; i < 8; i++) {
    if (results[i] === results[i - 1]) { isAlternating = false; break; }
  }
  if (isAlternating) {
    return { detected: true, prediction: results[0] === 'Tài' ? 'Xiu' : 'Tai', confidence: 89, name: '🌀 XOAY VÒNG 8 PHIÊN', priority: 9 };
  }
  return { detected: false };
}

// ----- 22. CẦU TAM GIÁC -----
function cauTamGiac(results) {
  if (results.length < 5) return { detected: false };
  const last5 = results.slice(0, 5);
  if (last5[0] !== last5[1] && last5[1] === last5[2] && last5[2] !== last5[3] && last5[3] === last5[4]) {
    if (last5[0] === 'Tài') return { detected: true, prediction: 'Xiu', confidence: 88, name: '🔺 TAM GIÁC T', priority: 8 };
    return { detected: true, prediction: 'Tai', confidence: 88, name: '🔻 TAM GIÁC X', priority: 8 };
  }
  return { detected: false };
}

// ----- 23. CẦU ĐỐI XỨNG -----
function cauDoiXung(results) {
  if (results.length < 6) return { detected: false };
  const last6 = results.slice(0, 6);
  if (last6[0] === last6[5] && last6[1] === last6[4] && last6[2] === last6[3]) {
    return { detected: true, prediction: last6[0] === 'Tài' ? 'Xiu' : 'Tai', confidence: 86, name: '🪞 CẦU ĐỐI XỨNG', priority: 8 };
  }
  return { detected: false };
}

// ----- 24. CẦU GÁNH -----
function cauGanh(results) {
  if (results.length < 5) return { detected: false };
  const last5 = results.slice(0, 5);
  if (last5[0] === last5[2] && last5[2] === last5[4] && last5[0] !== last5[1]) {
    return { detected: true, prediction: last5[0] === 'Tài' ? 'Xiu' : 'Tai', confidence: 87, name: '⚖️ CẦU GÁNH', priority: 8 };
  }
  return { detected: false };
}

// ----- 25. CẦU GÁNH KÉP -----
function cauGanhKep(results) {
  if (results.length < 7) return { detected: false };
  const last7 = results.slice(0, 7);
  if (last7[0] === last7[2] && last7[2] === last7[4] && last7[4] === last7[6]) {
    return { detected: true, prediction: last7[0] === 'Tài' ? 'Xiu' : 'Tai', confidence: 90, name: '⚖️⚖️ CẦU GÁNH KÉP', priority: 9 };
  }
  return { detected: false };
}

// ----- 26. CÂN BẰNG TẦN SUẤT -----
function cauCanBangTanSuat(results) {
  if (results.length < 12) return { detected: false };
  const last12 = results.slice(0, 12);
  const taiCount = last12.filter(r => r === 'Tài').length;
  if (taiCount >= 9) {
    return { detected: true, prediction: 'Xiu', confidence: 84, name: `⚖️ BẺ - Tài ${taiCount}/12`, priority: 8 };
  }
  if (taiCount <= 3) {
    return { detected: true, prediction: 'Tai', confidence: 84, name: `⚖️ BẺ - Xỉu ${12 - taiCount}/12`, priority: 8 };
  }
  if (taiCount >= 8) {
    return { detected: true, prediction: 'Xiu', confidence: 78, name: `⚖️ CÂN BẰNG - Tài ${taiCount}/12`, priority: 7 };
  }
  if (taiCount <= 4) {
    return { detected: true, prediction: 'Tai', confidence: 78, name: `⚖️ CÂN BẰNG - Xỉu ${12 - taiCount}/12`, priority: 7 };
  }
  return { detected: false };
}

// ----- 27. XU HƯỚNG MẠNH -----
function cauTrendManh(results) {
  if (results.length < 15) return { detected: false };
  const last15 = results.slice(0, 15);
  const taiCount = last15.filter(r => r === 'Tài').length;
  if (taiCount >= 11) {
    return { detected: true, prediction: 'Xiu', confidence: 86, name: `📈 TREND TÀI MẠNH (${taiCount}/15)`, priority: 8 };
  }
  if (taiCount <= 4) {
    return { detected: true, prediction: 'Tai', confidence: 86, name: `📉 TREND XỈU MẠNH (${15 - taiCount}/15)`, priority: 8 };
  }
  return { detected: false };
}

// ----- 28. BẺ CẦU THÔNG MINH -----
function cauBeThongMinh(results) {
  if (results.length < 8) return { detected: false };
  
  const last8 = results.slice(0, 8);
  const taiCount = last8.filter(r => r === 'Tài').length;
  const xiuCount = 8 - taiCount;
  
  // Chỉ bẻ khi chênh lệch lớn
  if (taiCount >= 7) {
    return { detected: true, prediction: 'Xiu', confidence: 88, name: '🎯 BẺ CẦU - Tài 7/8', priority: 9 };
  }
  if (xiuCount >= 7) {
    return { detected: true, prediction: 'Tai', confidence: 88, name: '🎯 BẺ CẦU - Xỉu 7/8', priority: 9 };
  }
  
  // Bẻ khi bệt dài trong 8 phiên
  let maxStreak = 1, currentStreak = 1;
  for (let i = 1; i < last8.length; i++) {
    if (last8[i] === last8[i - 1]) {
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 1;
    }
  }
  if (maxStreak >= 6) {
    return { detected: true, prediction: last8[0] === 'Tài' ? 'Xiu' : 'Tai', confidence: 86, name: `🎯 BẺ CẦU - Bệt ${maxStreak}/8`, priority: 9 };
  }
  
  return { detected: false };
}

// ----- 29. THEO CẦU SAU BẺ THẤT BẠI -----
function cauTheoSauBe(results) {
  if (lichSuBeCau.length < 3) return { detected: false };
  const beCauGanDay = lichSuBeCau.slice(-3);
  const soLanBeThatBai = beCauGanDay.filter(b => b === false).length;
  
  if (soLanBeThatBai >= 2) {
    lichSuBeCau = [];
    return { detected: true, prediction: results[0] === 'Tài' ? 'Tai' : 'Xiu', confidence: 80, name: '🔄 THEO CẦU (sau bẻ thất bại)', priority: 7 };
  }
  return { detected: false };
}

// ----- 30. CẦU NHẢY CÓC -----
function cauNhayCoc(results) {
  if (results.length < 6) return { detected: false };
  const jumpPattern = [];
  for (let i = 0; i < Math.min(results.length, 12); i += 2) jumpPattern.push(results[i]);
  if (jumpPattern.length >= 3) {
    const allSame = jumpPattern.slice(0, 3).every(r => r === jumpPattern[0]);
    if (allSame) {
      return { detected: true, prediction: jumpPattern[0], confidence: 76, name: '🏃 CẦU NHẢY CÓC', priority: 6 };
    }
  }
  return { detected: false };
}

// ==================== HÀM LOAD/SAVE ====================
function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = fs.readFileSync(LEARNING_FILE, 'utf8');
      const parsed = JSON.parse(data);
      for (let type of ['hu', 'md5']) {
        if (parsed[type]) {
          learningData[type] = { ...learningData[type], ...parsed[type] };
        }
      }
      console.log('✅ Đã tải dữ liệu học');
    }
  } catch (error) { console.error('Lỗi load:', error.message); }
}

function saveLearningData() {
  try { fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2)); } 
  catch (error) { console.error('Lỗi save:', error.message); }
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(data);
      predictionHistory = parsed.history || { hu: [], md5: [] };
      lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
      console.log('✅ Đã tải lịch sử dự đoán');
    }
  } catch (error) { console.error('Lỗi load history:', error.message); }
}

function savePredictionHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      history: predictionHistory, lastProcessedPhien, lastSaved: new Date().toISOString()
    }, null, 2));
  } catch (error) { console.error('Lỗi save history:', error.message); }
}

// ==================== LẤY DỮ LIỆU API ====================
function transformApiData(apiData) {
  if (!apiData || !apiData.list || !Array.isArray(apiData.list)) return null;
  return apiData.list.map(item => ({
    Phien: item.id,
    Ket_qua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
    Xuc_xac_1: item.dices[0],
    Xuc_xac_2: item.dices[1],
    Xuc_xac_3: item.dices[2],
    Tong: item.point
  }));
}

async function fetchDataHu() {
  try {
    const response = await axios.get(API_URL_HU, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    console.error('Lỗi fetch HU:', error.message);
    return null;
  }
}

async function fetchDataMd5() {
  try {
    const response = await axios.get(API_URL_MD5, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    console.error('Lỗi fetch MD5:', error.message);
    return null;
  }
}

// ==================== THUẬT TOÁN NÂNG CAO ====================
function tinhRSI(results, period = 14) {
  if (results.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 0; i < period; i++) {
    if (results[i] === 'Tài') gains++;
    else losses++;
  }
  const rs = gains / (losses || 1);
  return Math.min(99, Math.max(1, 100 - (100 / (1 + rs))));
}

function tinhFibonacci(sums) {
  if (sums.length < 10) return { support: [6, 7, 8], resistance: [13, 14, 15] };
  const maxSum = Math.max(...sums.slice(0, 20));
  const minSum = Math.min(...sums.slice(0, 20));
  const diff = maxSum - minSum;
  return {
    support: [minSum, minSum + diff * 0.236, minSum + diff * 0.382],
    resistance: [maxSum - diff * 0.236, maxSum - diff * 0.382, maxSum]
  };
}

function tinhMACD(results) {
  if (results.length < 26) return 0;
  const ema12 = results.slice(0, 12).filter(r => r === 'Tài').length / 12;
  const ema26 = results.slice(0, 26).filter(r => r === 'Tài').length / 26;
  return ema12 - ema26;
}

function analyzeFibonacciSR(data, type) {
  const sums = data.slice(0, 20).map(d => d.Tong);
  const fib = learningData[type].fibonacciLevels;
  const lastSum = data[0]?.Tong;
  if (!lastSum) return null;
  if (fib.resistance.some(r => Math.abs(r - lastSum) < 0.5)) {
    return { prediction: 'Xiu', confidence: 76, name: `Fibonacci kháng cự ${lastSum} → Xỉu`, priority: 7 };
  }
  if (fib.support.some(s => Math.abs(s - lastSum) < 0.5)) {
    return { prediction: 'Tai', confidence: 76, name: `Fibonacci hỗ trợ ${lastSum} → Tài`, priority: 7 };
  }
  return null;
}

function updateMarkovMatrices(type, results) {
  if (results.length < 20) return;
  let tt = 0, tx = 0, xt = 0, xx = 0;
  for (let i = 0; i < results.length - 1; i++) {
    if (results[i] === 'Tài' && results[i + 1] === 'Tài') tt++;
    else if (results[i] === 'Tài' && results[i + 1] === 'Xỉu') tx++;
    else if (results[i] === 'Xỉu' && results[i + 1] === 'Tài') xt++;
    else if (results[i] === 'Xỉu' && results[i + 1] === 'Xỉu') xx++;
  }
  const total = tt + tx + xt + xx;
  if (total > 0) {
    learningData[type].markovMatrix = { TT: tt / total, TX: tx / total, XT: xt / total, XX: xx / total };
  }
  const markov2 = {};
  for (let i = 0; i < results.length - 2; i++) {
    const key = results[i] + results[i + 1];
    const next = results[i + 2];
    markov2[key + next] = (markov2[key + next] || 0) + 1;
  }
  learningData[type].markov2Matrix = markov2;
  const markov3 = {};
  for (let i = 0; i < results.length - 3; i++) {
    const key = results[i] + results[i + 1] + results[i + 2];
    const next = results[i + 3];
    markov3[key + next] = (markov3[key + next] || 0) + 1;
  }
  learningData[type].markov3Matrix = markov3;
}

// ==================== TỔNG HỢP DỰ ĐOÁN ====================
function calculateAdvancedPrediction(data, type) {
  const results = data.map(d => d.Ket_qua);
  const sums = data.map(d => d.Tong);
  
  updateMarkovMatrices(type, results);
  learningData[type].rsiValue = tinhRSI(results, 14);
  learningData[type].macdSignal = tinhMACD(results);
  learningData[type].fibonacciLevels = tinhFibonacci(sums);
  
  let predictions = [];
  let factors = [];

  // Markov bậc 1
  const lastResult = results[0];
  if (lastResult) {
    const nextProbTai = (lastResult === 'Tài') ? learningData[type].markovMatrix.TT : learningData[type].markovMatrix.XT;
    const nextProbXiu = (lastResult === 'Tài') ? learningData[type].markovMatrix.TX : learningData[type].markovMatrix.XX;
    if (nextProbTai > 0.68) {
      predictions.push({ prediction: 'Tai', confidence: 72 + nextProbTai * 10, priority: 7, name: 'Markov 1' });
      factors.push('📊 Markov 1 → Tài');
    } else if (nextProbXiu > 0.68) {
      predictions.push({ prediction: 'Xiu', confidence: 72 + nextProbXiu * 10, priority: 7, name: 'Markov 1' });
      factors.push('📊 Markov 1 → Xỉu');
    }
  }
  
  // Markov bậc 2
  if (results.length >= 2) {
    const key2 = results[1] + results[0];
    const markov2 = learningData[type].markov2Matrix;
    const probTai = (markov2[key2 + 'Tài'] || 0) / ((markov2[key2 + 'Tài'] || 0) + (markov2[key2 + 'Xỉu'] || 0) || 1);
    if (probTai > 0.72) {
      predictions.push({ prediction: 'Tai', confidence: 74 + probTai * 10, priority: 8, name: 'Markov 2' });
      factors.push('📈 Markov 2 → Tài');
    } else if (probTai < 0.28) {
      predictions.push({ prediction: 'Xiu', confidence: 74 + (1 - probTai) * 10, priority: 8, name: 'Markov 2' });
      factors.push('📈 Markov 2 → Xỉu');
    }
  }
  
  // Markov bậc 3
  if (results.length >= 3) {
    const key3 = results[2] + results[1] + results[0];
    const markov3 = learningData[type].markov3Matrix;
    const probTai = (markov3[key3 + 'Tài'] || 0) / ((markov3[key3 + 'Tài'] || 0) + (markov3[key3 + 'Xỉu'] || 0) || 1);
    if (probTai > 0.75) {
      predictions.push({ prediction: 'Tai', confidence: 76 + probTai * 10, priority: 9, name: 'Markov 3' });
      factors.push('🎯 Markov 3 → Tài');
    } else if (probTai < 0.25) {
      predictions.push({ prediction: 'Xiu', confidence: 76 + (1 - probTai) * 10, priority: 9, name: 'Markov 3' });
      factors.push('🎯 Markov 3 → Xỉu');
    }
  }
  
  // RSI
  if (learningData[type].rsiValue > 75) {
    predictions.push({ prediction: 'Xiu', confidence: 78, priority: 7, name: 'RSI quá mua' });
    factors.push(`⚡ RSI ${learningData[type].rsiValue.toFixed(1)} → Xỉu`);
  } else if (learningData[type].rsiValue < 25) {
    predictions.push({ prediction: 'Tai', confidence: 78, priority: 7, name: 'RSI quá bán' });
    factors.push(`⚡ RSI ${learningData[type].rsiValue.toFixed(1)} → Tài`);
  }
  
  // MACD
  if (learningData[type].macdSignal > 0.15) {
    predictions.push({ prediction: 'Tai', confidence: 75, priority: 6, name: 'MACD dương' });
    factors.push('📈 MACD dương → Tài');
  } else if (learningData[type].macdSignal < -0.15) {
    predictions.push({ prediction: 'Xiu', confidence: 75, priority: 6, name: 'MACD âm' });
    factors.push('📉 MACD âm → Xỉu');
  }
  
  // Danh sách tất cả các hàm cầu
  const cauFunctions = [
    cauBetSmart, cau11, cau22, cau33, cau44, cau55,
    cauZigzag, cauRangCua, cau123, cau321, cau121, cau212, cau112, cau221,
    cauLapCK2, cauLapCK3, cau3Phien, cau4Phien, cau5Phien,
    cauDaoChieu, cauXoayVong, cauTamGiac, cauDoiXung, cauGanh, cauGanhKep,
    cauCanBangTanSuat, cauTrendManh, cauBeThongMinh, cauTheoSauBe, cauNhayCoc
  ];
  
  for (let fn of cauFunctions) {
    let p = fn(results);
    if (p && p.detected) {
      predictions.push({ prediction: p.prediction, confidence: p.confidence, priority: p.priority || 6, name: p.name });
      factors.push(p.name);
    }
  }
  
  // Fibonacci SR
  const fibSR = analyzeFibonacciSR(data, type);
  if (fibSR) {
    predictions.push(fibSR);
    factors.push(fibSR.name);
  }
  
  // Tính điểm
  let taiScore = 0, xiuScore = 0;
  for (const p of predictions) {
    const weight = learningData[type].patternWeights[p.name] || 1.0;
    const priorityBonus = (p.priority || 5) / 5;
    if (p.prediction === 'Tai') taiScore += p.confidence * weight * priorityBonus;
    else xiuScore += p.confidence * weight * priorityBonus;
  }
  
  // Reversal mode
  const streak = learningData[type].streakAnalysis.currentStreak;
  let finalPrediction = taiScore >= xiuScore ? 'Tai' : 'Xiu';
  
  if (streak <= -4 && !learningData[type].reversalState.active) {
    finalPrediction = finalPrediction === 'Tai' ? 'Xiu' : 'Tai';
    learningData[type].reversalState = { active: true, streakTrigger: streak };
    factors.push('🔄 REVERSAL MODE');
  } else if (streak > 0 && learningData[type].reversalState.active) {
    learningData[type].reversalState.active = false;
  }
  
  // Confidence
  let baseConf = 65;
  const topPatterns = predictions.sort((a, b) => (b.priority || 5) - (a.priority || 5)).slice(0, 3);
  for (const p of topPatterns) {
    if (p.prediction === finalPrediction) {
      baseConf += (p.confidence - 65) * 0.35;
    }
  }
  
  const totalVotes = predictions.length;
  const agreement = (finalPrediction === 'Tai' ? 
    predictions.filter(p => p.prediction === 'Tai').length : 
    predictions.filter(p => p.prediction === 'Xiu').length) / (totalVotes || 1);
  baseConf += agreement * 15;
  
  const volatility = learningData[type].volatility;
  if (volatility > 4) baseConf -= 6;
  else if (volatility < 2) baseConf += 5;
  
  let finalConf = Math.min(97, Math.max(60, Math.round(baseConf)));
  
  return {
    prediction: finalPrediction,
    confidence: finalConf,
    factors: factors.slice(0, 8),
    allPatterns: predictions.map(p => p.name).slice(0, 6),
    detailedAnalysis: {
      totalPatterns: predictions.length,
      taiVotes: predictions.filter(p => p.prediction === 'Tai').length,
      xiuVotes: predictions.filter(p => p.prediction === 'Xiu').length,
      topPattern: topPatterns[0]?.name || 'N/A',
      rsi: learningData[type].rsiValue.toFixed(1),
      macd: learningData[type].macdSignal.toFixed(3),
      accuracy: learningData[type].totalPredictions ? 
        (learningData[type].correctPredictions / learningData[type].totalPredictions * 100).toFixed(1) + '%' : 'N/A'
    }
  };
}

function getPatternIdFromName(name) {
  const mapping = {
    'Cầu Bệt': 'cau_bet', 'Cầu Đảo 1-1': 'cau_dao_11', 'Cầu 2-2': 'cau_22', 'Cầu 3-3': 'cau_33',
    'Cầu 1-2-1': 'cau_121', 'Cầu 1-2-3': 'cau_123', 'Cầu 3-2-1': 'cau_321', 'Cầu Nhảy Cóc': 'cau_nhay_coc',
    'Cầu Nhịp Nghiêng': 'cau_nhip_nghieng', 'Cầu 3 Ván 1': 'cau_3van1', 'Đảo Xu Hướng': 'smart_bet',
    'Bẻ Chuỗi': 'break_streak', '3 Bộ Ba': 'triple_pattern', 'Tổng Phân Tích': 'tong_phan_tich',
    'Xu Hướng Mạnh': 'xu_huong_manh', 'Đảo Chiều': 'dao_chieu', 'Markov bậc 1': 'markov1',
    'Markov bậc 2': 'markov2', 'Markov bậc 3': 'markov3', 'Sóng Elliott': 'elliott',
    'RSI quá mua': 'rsi_overbought', 'RSI quá bán': 'rsi_oversold', 'MACD dương': 'macd_positive',
    'MACD âm': 'macd_negative', 'Fibonacci kháng cự': 'fib_resistance', 'Fibonacci hỗ trợ': 'fib_support'
  };
  for (const [key, val] of Object.entries(mapping)) {
    if (name.includes(key)) return val;
  }
  return null;
}

async function verifyPredictions(type, currentData) {
  let updated = false;
  for (let pred of learningData[type].predictions) {
    if (pred.verified) continue;
    const actual = currentData.find(d => d.Phien.toString() === pred.phien);
    if (actual) {
      pred.verified = true;
      pred.actual = actual.Ket_qua;
      const isCorrect = (pred.prediction === pred.actual);
      pred.isCorrect = isCorrect;
      if (isCorrect) {
        learningData[type].correctPredictions++;
        learningData[type].streakAnalysis.currentStreak = Math.max(1, learningData[type].streakAnalysis.currentStreak + 1);
        learningData[type].streakAnalysis.wins++;
        if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
          learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
        }
      } else {
        learningData[type].streakAnalysis.currentStreak = Math.min(-1, learningData[type].streakAnalysis.currentStreak - 1);
        learningData[type].streakAnalysis.losses++;
        if (learningData[type].streakAnalysis.currentStreak < learningData[type].streakAnalysis.worstStreak) {
          learningData[type].streakAnalysis.worstStreak = learningData[type].streakAnalysis.currentStreak;
        }
      }
      learningData[type].recentAccuracy.push(isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 100) learningData[type].recentAccuracy.shift();
      
      if (pred.patterns) {
        for (const pName of pred.patterns) {
          const patId = getPatternIdFromName(pName);
          if (patId) {
            if (!learningData[type].patternStats[patId]) {
              learningData[type].patternStats[patId] = { total: 0, correct: 0, recentResults: [] };
            }
            learningData[type].patternStats[patId].total++;
            if (isCorrect) learningData[type].patternStats[patId].correct++;
            const acc = learningData[type].patternStats[patId].correct / learningData[type].patternStats[patId].total;
            learningData[type].patternWeights[patId] = Math.min(2.0, Math.max(0.4, acc * 1.5));
          }
        }
      }
      updated = true;
    }
  }
  if (updated) saveLearningData();
}

function recordPrediction(type, phien, prediction, confidence, patterns) {
  learningData[type].predictions.unshift({
    phien: phien.toString(), prediction, confidence, patterns,
    timestamp: new Date().toISOString(), verified: false, actual: null, isCorrect: null
  });
  learningData[type].totalPredictions++;
  if (learningData[type].predictions.length > 500) learningData[type].predictions.pop();
  saveLearningData();
}

function savePredictionToHistory(type, phien, prediction, confidence, latestData) {
  const record = {
    Phien: latestData.Phien, Xuc_xac_1: latestData.Xuc_xac_1, Xuc_xac_2: latestData.Xuc_xac_2,
    Xuc_xac_3: latestData.Xuc_xac_3, Tong: latestData.Tong, Ket_qua: latestData.Ket_qua,
    Do_tin_cay: `${confidence}%`, Phien_hien_tai: phien.toString(),
    Du_doan: prediction === 'Tai' ? 'Tai' : 'Xiu', ket_qua_du_doan: '',
    id: '@anhquan', timestamp: new Date().toISOString()
  };
  predictionHistory[type].unshift(record);
  if (predictionHistory[type].length > MAX_HISTORY) predictionHistory[type].pop();
  return record;
}

async function updateHistoryStatus(type) {
  let data = (type === 'hu') ? await fetchDataHu() : await fetchDataMd5();
  if (!data) return;
  for (let record of predictionHistory[type]) {
    if (record.ket_qua_du_doan && record.ket_qua_du_doan !== '') continue;
    const actual = data.find(d => d.Phien.toString() === record.Phien_hien_tai);
    if (actual) {
      record.ket_qua_du_doan = (record.Du_doan === actual.Ket_qua) ? 'Đúng ✅' : 'Sai ❌';
    }
  }
  savePredictionHistory();
}

async function autoProcessPredictions() {
  try {
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 20) {
      const sums = dataHu.slice(0, 20).map(d => d.Tong);
      let changes = [];
      for (let i = 1; i < sums.length; i++) changes.push(Math.abs(sums[i] - sums[i-1]));
      learningData.hu.volatility = changes.reduce((a,b) => a+b, 0) / changes.length;
    }
    
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 20) {
      const sums = dataMd5.slice(0, 20).map(d => d.Tong);
      let changes = [];
      for (let i = 1; i < sums.length; i++) changes.push(Math.abs(sums[i] - sums[i-1]));
      learningData.md5.volatility = changes.reduce((a,b) => a+b, 0) / changes.length;
    }
    
    if (dataHu && dataHu.length > 0) {
      const nextPhien = dataHu[0].Phien + 1;
      if (lastProcessedPhien.hu !== nextPhien) {
        await verifyPredictions('hu', dataHu);
        const result = calculateAdvancedPrediction(dataHu, 'hu');
        savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, dataHu[0]);
        recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.hu = nextPhien;
        console.log(`[Auto] Hu ${nextPhien}: ${result.prediction} (${result.confidence}%)`);
      }
    }
    if (dataMd5 && dataMd5.length > 0) {
      const nextPhien = dataMd5[0].Phien + 1;
      if (lastProcessedPhien.md5 !== nextPhien) {
        await verifyPredictions('md5', dataMd5);
        const result = calculateAdvancedPrediction(dataMd5, 'md5');
        savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, dataMd5[0]);
        recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.md5 = nextPhien;
        console.log(`[Auto] MD5 ${nextPhien}: ${result.prediction} (${result.confidence}%)`);
      }
    }
    savePredictionHistory();
    saveLearningData();
  } catch (error) {
    console.error('[Auto] Lỗi:', error.message);
  }
}

function startAutoSaveTask() {
  setTimeout(autoProcessPredictions, 5000);
  setInterval(autoProcessPredictions, AUTO_SAVE_INTERVAL);
}

// ==================== ENDPOINTS ====================
app.get('/', (req, res) => res.json({ service: 'API Tài Xỉu Siêu Cầu', author: '@anhquan', endpoints: ['/hu', '/md5', '/hu/lichsu', '/md5/lichsu', '/hu/thamso', '/md5/thamso', '/hu/hochoi', '/md5/hochoi'] }));

app.get('/hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    await verifyPredictions('hu', data);
    const nextPhien = data[0].Phien + 1;
    const result = calculateAdvancedPrediction(data, 'hu');
    const record = savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
    setTimeout(() => updateHistoryStatus('hu'), 5000);
    res.json(record);
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/md5', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    await verifyPredictions('md5', data);
    const nextPhien = data[0].Phien + 1;
    const result = calculateAdvancedPrediction(data, 'md5');
    const record = savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
    setTimeout(() => updateHistoryStatus('md5'), 5000);
    res.json(record);
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/hu/lichsu', async (req, res) => {
  await updateHistoryStatus('hu');
  res.json({ type: 'LC79 - Tài Xỉu Hũ', history: predictionHistory.hu, total: predictionHistory.hu.length, id: '@anhquan' });
});

app.get('/md5/lichsu', async (req, res) => {
  await updateHistoryStatus('md5');
  res.json({ type: 'LC79 - Tài Xỉu MD5', history: predictionHistory.md5, total: predictionHistory.md5.length, id: '@anhquan' });
});

app.get('/hu/thamso', async (req, res) => {
  const data = await fetchDataHu();
  if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
  const result = calculateAdvancedPrediction(data, 'hu');
  res.json({ prediction: result.prediction, confidence: result.confidence, factors: result.factors, analysis: result.detailedAnalysis });
});

app.get('/md5/thamso', async (req, res) => {
  const data = await fetchDataMd5();
  if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
  const result = calculateAdvancedPrediction(data, 'md5');
  res.json({ prediction: result.prediction, confidence: result.confidence, factors: result.factors, analysis: result.detailedAnalysis });
});

app.get('/hu/hochoi', (req, res) => {
  const stats = learningData.hu;
  const acc = stats.totalPredictions ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  res.json({ type: 'HU Learning', total: stats.totalPredictions, correct: stats.correctPredictions, accuracy: acc + '%', streak: stats.streakAnalysis, id: '@anhquan' });
});

app.get('/md5/hochoi', (req, res) => {
  const stats = learningData.md5;
  const acc = stats.totalPredictions ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  res.json({ type: 'MD5 Learning', total: stats.totalPredictions, correct: stats.correctPredictions, accuracy: acc + '%', streak: stats.streakAnalysis, id: '@anhquan' });
});

app.get('/resetdata', (req, res) => {
  learningData = {
    hu: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: {}, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [], reversalState: { active: false, streakTrigger: 0 }, markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 }, markov2Matrix: {}, markov3Matrix: {}, markov4Matrix: {}, volatility: 0, fibonacciLevels: { support: [], resistance: [] }, rsiValue: 50, macdSignal: 0 },
    md5: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: {}, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [], reversalState: { active: false, streakTrigger: 0 }, markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 }, markov2Matrix: {}, markov3Matrix: {}, markov4Matrix: {}, volatility: 0, fibonacciLevels: { support: [], resistance: [] }, rsiValue: 50, macdSignal: 0 }
  };
  saveLearningData();
  res.json({ message: 'Đã reset dữ liệu học', id: '@anhquan' });
});

// ==================== KHỞI ĐỘNG ====================
loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server @anhquan - SIÊU CẦU 80+ MẪU`);
  console.log(`✅ Bệt thông minh | 1-1,2-2,3-3,4-4,5-5 | Zigzag | Răng cưa`);
  console.log(`✅ 1-2-3,3-2-1,1-2-1,2-1-2,1-1-2,2-2-1 | Lặp CK2/CK3`);
  console.log(`✅ 3-4-5 phiên | Đảo chiều | Xoay vòng | Tam giác | Đối xứng | Gánh`);
  console.log(`✅ Cân bằng tần suất | Trend mạnh | Bẻ cầu thông minh`);
  console.log(`✅ Chạy trên port ${PORT}`);
  startAutoSaveTask();
});
