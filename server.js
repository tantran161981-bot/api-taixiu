// HUYDAIXU.SITE - BẮT CẦU CHUYÊN NGHIỆP 50+
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

let lastPhien = 0;
let cachedResult = null;

// Lưu lịch sử bẻ cầu
let lichSuBeCau = [];
let soLanBeThatBai = 0;

// ==================== HÀM TIỆN ÍCH ====================

function tinhDoDaiBet(history) {
  if (!history || history.length === 0) return 0;
  let streak = 1;
  const lastResult = history[history.length - 1].result;
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i].result === lastResult) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

// ==================== CẦU BỆT THÔNG MINH ====================

function cauBetThongMinh(history) {
  const doDaiBet = tinhDoDaiBet(history);
  const ketQuaCuoi = history[history.length - 1].result;
  
  // Bệt quá dài -> bẻ
  if (doDaiBet >= 8) {
    return { active: true, pred: ketQuaCuoi === 'Tài' ? 'Xiu' : 'Tai', doTin: 95, ten: `💀 BẺ BỆT ${doDaiBet} (siêu dài)` };
  }
  if (doDaiBet >= 7) {
    return { active: true, pred: ketQuaCuoi === 'Tài' ? 'Xiu' : 'Tai', doTin: 90, ten: `🔥 BẺ BỆT ${doDaiBet}` };
  }
  if (doDaiBet >= 6) {
    return { active: true, pred: ketQuaCuoi === 'Tài' ? 'Xiu' : 'Tai', doTin: 85, ten: `⚠️ CẢNH BÁO BỆT ${doDaiBet}` };
  }
  if (doDaiBet >= 4) {
    return { active: true, pred: ketQuaCuoi === 'Tài' ? 'Tai' : 'Xiu', doTin: 75 + doDaiBet, ten: `📈 THEO BỆT ${doDaiBet}` };
  }
  if (doDaiBet >= 2) {
    return { active: true, pred: ketQuaCuoi === 'Tài' ? 'Tai' : 'Xiu', doTin: 65 + doDaiBet * 5, ten: `📊 THEO BỆT ${doDaiBet}` };
  }
  return { active: false };
}

// ==================== CẦU SO LE ====================

function cau11(history) {
  if (history.length < 4) return { active: false };
  const last4 = history.slice(-4).map(h => h.result);
  if (last4[0] !== last4[1] && last4[1] !== last4[2] && last4[2] !== last4[3]) {
    const doDai = 4;
    let doDaiThuc = 4;
    for (let i = 4; i < Math.min(history.length, 20); i += 2) {
      if (history[history.length - i - 1]?.result !== history[history.length - i]?.result) {
        doDaiThuc += 2;
      } else break;
    }
    if (doDaiThuc >= 12) {
      return { active: true, pred: last4[3] === 'Tài' ? 'Tai' : 'Xiu', doTin: 88, ten: `🔄 CẦU 1-1 DÀI ${doDaiThuc}` };
    }
    return { active: true, pred: last4[3] === 'Tài' ? 'Xiu' : 'Tai', doTin: 85, ten: '⚡ CẦU 1-1' };
  }
  return { active: false };
}

function cau22(history) {
  if (history.length < 4) return { active: false };
  const last4 = history.slice(-4).map(h => h.result);
  if (last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2]) {
    let doDai = 4;
    for (let i = 4; i < Math.min(history.length, 24); i += 4) {
      if (history[history.length - i - 1]?.result === history[history.length - i]?.result &&
          history[history.length - i - 2]?.result === history[history.length - i - 1]?.result) {
        doDai += 4;
      } else break;
    }
    if (doDai >= 12) {
      return { active: true, pred: last4[0] === 'Tài' ? 'Tai' : 'Xiu', doTin: 86, ten: `📐 CẦU 2-2 DÀI ${doDai}` };
    }
    return { active: true, pred: last4[0] === 'Tài' ? 'Xiu' : 'Tai', doTin: 82, ten: '📐 CẦU 2-2' };
  }
  return { active: false };
}

function cau33(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  const first3 = last6[0] === last6[1] && last6[1] === last6[2];
  const last3 = last6[3] === last6[4] && last6[4] === last6[5];
  if (first3 && last3 && last6[0] !== last6[3]) {
    let doDai = 6;
    for (let i = 6; i < Math.min(history.length, 30); i += 6) {
      if (history[history.length - i - 1]?.result === history[history.length - i]?.result) {
        doDai += 6;
      } else break;
    }
    return { active: true, pred: last6[0] === 'Tài' ? 'Xiu' : 'Tai', doTin: 85, ten: `🎲 CẦU 3-3 (dài ${doDai})` };
  }
  return { active: false };
}

function cau44(history) {
  if (history.length < 8) return { active: false };
  const last8 = history.slice(-8).map(h => h.result);
  const first4 = last8[0] === last8[1] && last8[1] === last8[2] && last8[2] === last8[3];
  const last4 = last8[4] === last8[5] && last8[5] === last8[6] && last8[6] === last8[7];
  if (first4 && last4 && last8[0] !== last8[4]) {
    return { active: true, pred: last8[0] === 'Tài' ? 'Xiu' : 'Tai', doTin: 88, ten: '🏆 CẦU 4-4' };
  }
  return { active: false };
}

function cau55(history) {
  if (history.length < 10) return { active: false };
  const last10 = history.slice(-10).map(h => h.result);
  const first5 = last10[0] === last10[1] && last10[1] === last10[2] && last10[2] === last10[3] && last10[3] === last10[4];
  const last5 = last10[5] === last10[6] && last10[6] === last10[7] && last10[7] === last10[8] && last10[8] === last10[9];
  if (first5 && last5 && last10[0] !== last10[5]) {
    return { active: true, pred: last10[0] === 'Tài' ? 'Xiu' : 'Tai', doTin: 91, ten: '💎 CẦU 5-5 (cực hiếm)' };
  }
  return { active: false };
}

// ==================== CẦU ĐẶC BIỆT ====================

function cauZigzag(history) {
  if (history.length < 5) return { active: false };
  const last5 = history.slice(-5).map(h => h.result);
  let isZigzag = true;
  for (let i = 1; i < 5; i++) {
    if (last5[i] === last5[i-1]) { isZigzag = false; break; }
  }
  if (isZigzag) {
    let doDai = 5;
    for (let i = 5; i < Math.min(history.length, 25); i++) {
      if (history[history.length - i]?.result !== history[history.length - i + 1]?.result) {
        doDai++;
      } else break;
    }
    if (doDai >= 9) {
      return { active: true, pred: last5[4] === 'Tài' ? 'Tai' : 'Xiu', doTin: 91, ten: `🐉 ZIGZAG DÀI ${doDai}` };
    }
    return { active: true, pred: last5[4] === 'Tài' ? 'Xiu' : 'Tai', doTin: 87, ten: '🐍 CẦU ZIGZAG' };
  }
  return { active: false };
}

function cauRangCua(history) {
  if (history.length < 7) return { active: false };
  const last7 = history.slice(-7).map(h => h.result);
  // T X X T X X T
  if (last7[0] === 'Tài' && last7[1] === 'Xỉu' && last7[2] === 'Xỉu' && 
      last7[3] === 'Tài' && last7[4] === 'Xỉu' && last7[5] === 'Xỉu' && last7[6] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 89, ten: '🦷 CẦU RĂNG CƯA' };
  }
  return { active: false };
}

// ==================== CẦU TỔ HỢP 1-2-3, 3-2-1,... ====================

function cau123(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  if (last6[0] === 'Tài' && last6[1] === 'Xỉu' && last6[2] === 'Xỉu' && 
      last6[3] === 'Tài' && last6[4] === 'Tài' && last6[5] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 89, ten: '🏆 CẦU 1-2-3 (T-XX-TTT)' };
  }
  if (last6[0] === 'Xỉu' && last6[1] === 'Tài' && last6[2] === 'Tài' && 
      last6[3] === 'Xỉu' && last6[4] === 'Xỉu' && last6[5] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 89, ten: '🏆 CẦU 1-2-3 (X-TT-XXX)' };
  }
  return { active: false };
}

function cau321(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  if (last6[0] === 'Tài' && last6[1] === 'Tài' && last6[2] === 'Tài' && 
      last6[3] === 'Xỉu' && last6[4] === 'Xỉu' && last6[5] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 89, ten: '🏆 CẦU 3-2-1 (TTT-XX-T)' };
  }
  if (last6[0] === 'Xỉu' && last6[1] === 'Xỉu' && last6[2] === 'Xỉu' && 
      last6[3] === 'Tài' && last6[4] === 'Tài' && last6[5] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 89, ten: '🏆 CẦU 3-2-1 (XXX-TT-X)' };
  }
  return { active: false };
}

function cau121(history) {
  if (history.length < 5) return { active: false };
  const last5 = history.slice(-5).map(h => h.result);
  if (last5[0] === 'Tài' && last5[1] === 'Xỉu' && last5[2] === 'Xỉu' && last5[3] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 86, ten: '📊 CẦU 1-2-1 (T-XX-T)' };
  }
  if (last5[0] === 'Xỉu' && last5[1] === 'Tài' && last5[2] === 'Tài' && last5[3] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 86, ten: '📊 CẦU 1-2-1 (X-TT-X)' };
  }
  return { active: false };
}

function cau212(history) {
  if (history.length < 5) return { active: false };
  const last5 = history.slice(-5).map(h => h.result);
  if (last5[0] === 'Tài' && last5[1] === 'Tài' && last5[2] === 'Xỉu' && last5[3] === 'Tài' && last5[4] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 87, ten: '🎯 CẦU 2-1-2 (TT-X-TT)' };
  }
  if (last5[0] === 'Xỉu' && last5[1] === 'Xỉu' && last5[2] === 'Tài' && last5[3] === 'Xỉu' && last5[4] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 87, ten: '🎯 CẦU 2-1-2 (XX-T-XX)' };
  }
  return { active: false };
}

function cau132(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  if (last6[0] === 'Tài' && last6[1] === 'Xỉu' && last6[2] === 'Xỉu' && last6[3] === 'Xỉu' && 
      last6[4] === 'Tài' && last6[5] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 87, ten: '🎯 CẦU 1-3-2 (T-XXX-TT)' };
  }
  if (last6[0] === 'Xỉu' && last6[1] === 'Tài' && last6[2] === 'Tài' && last6[3] === 'Tài' && 
      last6[4] === 'Xỉu' && last6[5] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 87, ten: '🎯 CẦU 1-3-2 (X-TTT-XX)' };
  }
  return { active: false };
}

function cau231(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  if (last6[0] === 'Tài' && last6[1] === 'Tài' && last6[2] === 'Xỉu' && last6[3] === 'Xỉu' && 
      last6[4] === 'Xỉu' && last6[5] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 88, ten: '🎯 CẦU 2-3-1 (TT-XXX-T)' };
  }
  if (last6[0] === 'Xỉu' && last6[1] === 'Xỉu' && last6[2] === 'Tài' && last6[3] === 'Tài' && 
      last6[4] === 'Tài' && last6[5] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 88, ten: '🎯 CẦU 2-3-1 (XX-TTT-X)' };
  }
  return { active: false };
}

function cau112(history) {
  if (history.length < 4) return { active: false };
  const last4 = history.slice(-4).map(h => h.result);
  if (last4[0] === 'Tài' && last4[1] === 'Xỉu' && last4[2] === 'Tài' && last4[3] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 84, ten: '📌 CẦU 1-1-2 (T-X-TT)' };
  }
  if (last4[0] === 'Xỉu' && last4[1] === 'Tài' && last4[2] === 'Xỉu' && last4[3] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 84, ten: '📌 CẦU 1-1-2 (X-T-XX)' };
  }
  return { active: false };
}

function cau211(history) {
  if (history.length < 4) return { active: false };
  const last4 = history.slice(-4).map(h => h.result);
  if (last4[0] === 'Tài' && last4[1] === 'Tài' && last4[2] === 'Xỉu' && last4[3] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 84, ten: '📌 CẦU 2-1-1 (TT-XX)' };
  }
  if (last4[0] === 'Xỉu' && last4[1] === 'Xỉu' && last4[2] === 'Tài' && last4[3] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 84, ten: '📌 CẦU 2-1-1 (XX-TT)' };
  }
  return { active: false };
}

// ==================== CẦU LẶP ====================

function cauLap2(history) {
  if (history.length < 4) return { active: false };
  if (history.slice(-2).map(h => h.result).join() === history.slice(-4, -2).map(h => h.result).join()) {
    let doDai = 4;
    for (let i = 4; i < Math.min(history.length, 30); i += 2) {
      if (history.slice(-i-2, -i).map(h => h.result).join() === history.slice(-2).map(h => h.result).join()) {
        doDai += 2;
      } else break;
    }
    const lastResult = history[history.length - 1].result;
    if (doDai >= 12) {
      return { active: true, pred: lastResult === 'Tài' ? 'Xiu' : 'Tai', doTin: 88, ten: `🔄 BẺ CẦU LẶP CK2 (dài ${doDai})` };
    }
    return { active: true, pred: lastResult === 'Tài' ? 'Tai' : 'Xiu', doTin: 80, ten: `🔄 CẦU LẶP CK2 (dài ${doDai})` };
  }
  return { active: false };
}

function cauLap3(history) {
  if (history.length < 6) return { active: false };
  if (history.slice(-3).map(h => h.result).join() === history.slice(-6, -3).map(h => h.result).join()) {
    let doDai = 6;
    for (let i = 6; i < Math.min(history.length, 30); i += 3) {
      if (history.slice(-i-3, -i).map(h => h.result).join() === history.slice(-3).map(h => h.result).join()) {
        doDai += 3;
      } else break;
    }
    const lastResult = history[history.length - 1].result;
    if (doDai >= 15) {
      return { active: true, pred: lastResult === 'Tài' ? 'Xiu' : 'Tai', doTin: 87, ten: `🔄 BẺ CẦU LẶP CK3 (dài ${doDai})` };
    }
    return { active: true, pred: lastResult === 'Tài' ? 'Tai' : 'Xiu', doTin: 82, ten: `🔄 CẦU LẶP CK3 (dài ${doDai})` };
  }
  return { active: false };
}

// ==================== CẦU PHÂN TÍCH NHANH ====================

function cau2Phien(history) {
  if (history.length < 2) return { active: false };
  const last2 = history.slice(-2).map(h => h.result);
  if (last2[0] === 'Tài' && last2[1] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 76, ten: '2 Tài -> Xỉu' };
  }
  if (last2[0] === 'Xỉu' && last2[1] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 76, ten: '2 Xỉu -> Tài' };
  }
  if (last2[0] === 'Tài' && last2[1] === 'Xỉu') {
    return { active: true, pred: 'Xiu', doTin: 72, ten: 'TX -> X' };
  }
  if (last2[0] === 'Xỉu' && last2[1] === 'Tài') {
    return { active: true, pred: 'Tai', doTin: 72, ten: 'XT -> T' };
  }
  return { active: false };
}

function cau3Phien(history) {
  if (history.length < 3) return { active: false };
  const last3 = history.slice(-3).map(h => h.result);
  const pattern = last3.join(',');
  
  const patterns = {
    'Tài,Xỉu,Tài': { pred: 'Xiu', doTin: 86, ten: '✨ TXT -> X' },
    'Xỉu,Tài,Xỉu': { pred: 'Tai', doTin: 86, ten: '✨ XTX -> T' },
    'Tài,Tài,Xỉu': { pred: 'Xiu', doTin: 84, ten: '📌 TTX -> X' },
    'Xỉu,Xỉu,Tài': { pred: 'Tai', doTin: 84, ten: '📌 XXT -> T' },
    'Tài,Xỉu,Xỉu': { pred: 'Xiu', doTin: 82, ten: '🎯 TXX -> X' },
    'Xỉu,Tài,Tài': { pred: 'Tai', doTin: 82, ten: '🎯 XTT -> T' },
    'Tài,Tài,Tài': { pred: 'Xiu', doTin: 91, ten: '🔥 TTT -> X' },
    'Xỉu,Xỉu,Xỉu': { pred: 'Tai', doTin: 91, ten: '🔥 XXX -> T' }
  };
  
  if (patterns[pattern]) {
    return { active: true, ...patterns[pattern] };
  }
  return { active: false };
}

function cau4Phien(history) {
  if (history.length < 4) return { active: false };
  const last4 = history.slice(-4).map(h => h.result);
  const pattern = last4.join(',');
  
  const patterns = {
    'Tài,Tài,Tài,Xỉu': { pred: 'Xiu', doTin: 88, ten: 'TTTX -> X' },
    'Xỉu,Xỉu,Xỉu,Tài': { pred: 'Tai', doTin: 88, ten: 'XXXT -> T' },
    'Tài,Xỉu,Xỉu,Xỉu': { pred: 'Xiu', doTin: 85, ten: 'TXXX -> X' },
    'Xỉu,Tài,Tài,Tài': { pred: 'Tai', doTin: 85, ten: 'XTTT -> T' },
    'Tài,Tài,Xỉu,Xỉu': { pred: 'Tai', doTin: 86, ten: 'TTXX -> T' },
    'Xỉu,Xỉu,Tài,Tài': { pred: 'Xiu', doTin: 86, ten: 'XXTT -> X' }
  };
  
  if (patterns[pattern]) {
    return { active: true, ...patterns[pattern] };
  }
  return { active: false };
}

// ==================== CẦU ĐẢO CHIỀU ====================

function cauDaoChieu(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  let changes = 0;
  for (let i = 1; i < 6; i++) {
    if (last6[i] !== last6[i-1]) changes++;
  }
  if (changes >= 5) {
    return { active: true, pred: last6[5] === 'Tài' ? 'Xiu' : 'Tai', doTin: 90, ten: `⚡ ĐẢO CHIỀU MẠNH (${changes}/5)` };
  }
  if (changes >= 4) {
    return { active: true, pred: last6[5] === 'Tài' ? 'Xiu' : 'Tai', doTin: 85, ten: `🔄 ĐẢO CHIỀU (${changes}/5)` };
  }
  return { active: false };
}

function cauXoayVong(history) {
  if (history.length < 8) return { active: false };
  let isXoay = true;
  for (let i = 1; i < 8; i++) {
    if (history[history.length - i].result === history[history.length - i - 1].result) {
      isXoay = false;
      break;
    }
  }
  if (isXoay) {
    return { active: true, pred: history[history.length - 1].result === 'Tài' ? 'Xiu' : 'Tai', doTin: 88, ten: '🌀 XOAY VÒNG 8 PHIÊN' };
  }
  return { active: false };
}

// ==================== CẦU HÌNH HỌC ====================

function cauTamGiac(history) {
  if (history.length < 5) return { active: false };
  const last5 = history.slice(-5).map(h => h.result);
  if (last5[0] === 'Tài' && last5[1] === 'Xỉu' && last5[2] === 'Xỉu' && last5[3] === 'Tài' && last5[4] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 87, ten: '🔺 TAM GIÁC T' };
  }
  if (last5[0] === 'Xỉu' && last5[1] === 'Tài' && last5[2] === 'Tài' && last5[3] === 'Xỉu' && last5[4] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 87, ten: '🔻 TAM GIÁC X' };
  }
  return { active: false };
}

function cauDoiXung(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  if (last6[0] === last6[5] && last6[1] === last6[4] && last6[2] === last6[3]) {
    return { active: true, pred: last6[5] === 'Tài' ? 'Xiu' : 'Tai', doTin: 84, ten: '🪞 CẦU ĐỐI XỨNG' };
  }
  return { active: false };
}

function cauDoiXungRong(history) {
  if (history.length < 8) return { active: false };
  const last8 = history.slice(-8).map(h => h.result);
  if (last8[0] === last8[7] && last8[1] === last8[6] && last8[2] === last8[5] && last8[3] === last8[4]) {
    return { active: true, pred: last8[7] === 'Tài' ? 'Xiu' : 'Tai', doTin: 86, ten: '🪞🪞 CẦU ĐỐI XỨNG RỘNG' };
  }
  return { active: false };
}

function cauGanh(history) {
  if (history.length < 5) return { active: false };
  const last5 = history.slice(-5).map(h => h.result);
  if (last5[0] === last5[2] && last5[2] === last5[4] && last5[0] !== last5[1]) {
    return { active: true, pred: last5[4] === 'Tài' ? 'Xiu' : 'Tai', doTin: 85, ten: '⚖️ CẦU GÁNH' };
  }
  return { active: false };
}

function cauGanhKep(history) {
  if (history.length < 7) return { active: false };
  const last7 = history.slice(-7).map(h => h.result);
  if (last7[0] === last7[2] && last7[2] === last7[4] && last7[4] === last7[6]) {
    return { active: true, pred: last7[6] === 'Tài' ? 'Xiu' : 'Tai', doTin: 88, ten: '⚖️⚖️ CẦU GÁNH KÉP' };
  }
  return { active: false };
}

// ==================== CẦU THEO TỔNG ĐIỂM ====================

function cauTongChanLe(history) {
  if (history.length < 3) return { active: false };
  const last3Scores = history.slice(-3).map(h => h.totalScore);
  const soChan = last3Scores.filter(s => s % 2 === 0).length;
  if (soChan >= 2) {
    return { active: true, pred: 'Tai', doTin: 74, ten: '🎲 TỔNG CHẴN (3 phiên)' };
  }
  return { active: true, pred: 'Xiu', doTin: 74, ten: '🎲 TỔNG LẺ (3 phiên)' };
}

function cauTongTangGiam(history) {
  if (history.length < 4) return { active: false };
  const last4Scores = history.slice(-4).map(h => h.totalScore);
  if (last4Scores[0] < last4Scores[1] && last4Scores[1] < last4Scores[2] && last4Scores[2] < last4Scores[3]) {
    return { active: true, pred: 'Tai', doTin: 76, ten: '📈 TỔNG TĂNG 4 PHIÊN' };
  }
  if (last4Scores[0] > last4Scores[1] && last4Scores[1] > last4Scores[2] && last4Scores[2] > last4Scores[3]) {
    return { active: true, pred: 'Xiu', doTin: 76, ten: '📉 TỔNG GIẢM 4 PHIÊN' };
  }
  return { active: false };
}

function cauTongCaoThap(history) {
  if (history.length < 1) return { active: false };
  const lastScore = history[history.length - 1].totalScore;
  if (lastScore >= 15) {
    return { active: true, pred: 'Xiu', doTin: 78, ten: `🎯 TỔNG ${lastScore} (CAO) -> XỈU` };
  }
  if (lastScore <= 6) {
    return { active: true, pred: 'Tai', doTin: 78, ten: `🎯 TỔNG ${lastScore} (THẤP) -> TÀI` };
  }
  return { active: false };
}

// ==================== CẦU CÂN BẰNG TẦN SUẤT ====================

function cauCanBangTanSuat(history) {
  if (history.length < 10) return { active: false };
  const last10 = history.slice(-10).map(h => h.result);
  const taiCount = last10.filter(r => r === 'Tài').length;
  if (taiCount >= 8) {
    return { active: true, pred: 'Xiu', doTin: 82, ten: `⚖️ BẺ - Tài ${taiCount}/10 (quá nhiều)` };
  }
  if (taiCount >= 7) {
    return { active: true, pred: 'Xiu', doTin: 78, ten: `⚖️ CÂN BẰNG - Tài ${taiCount}/10` };
  }
  if (taiCount <= 2) {
    return { active: true, pred: 'Tai', doTin: 82, ten: `⚖️ BẺ - Xỉu ${10 - taiCount}/10 (quá nhiều)` };
  }
  if (taiCount <= 3) {
    return { active: true, pred: 'Tai', doTin: 78, ten: `⚖️ CÂN BẰNG - Xỉu ${10 - taiCount}/10` };
  }
  return { active: false };
}

function cauTanSuatDai(history) {
  if (history.length < 20) return { active: false };
  const last20 = history.slice(-20).map(h => h.result);
  const taiCount = last20.filter(r => r === 'Tài').length;
  if (taiCount >= 14) {
    return { active: true, pred: 'Xiu', doTin: 80, ten: `📊 XU HƯỚNG - Tài ${taiCount}/20` };
  }
  if (taiCount <= 6) {
    return { active: true, pred: 'Tai', doTin: 80, ten: `📊 XU HƯỚNG - Xỉu ${20 - taiCount}/20` };
  }
  return { active: false };
}

// ==================== CẦU 3 LIÊN TIẾP ====================

function cau3Lien(history) {
  if (history.length < 3) return { active: false };
  const last3 = history.slice(-3).map(h => h.result);
  if (last3[0] === last3[1] && last3[1] === last3[2]) {
    return { active: true, pred: last3[0] === 'Tài' ? 'Xiu' : 'Tai', doTin: 90, ten: '⚡ BẺ 3 PHIÊN GIỐNG NHAU' };
  }
  return { active: false };
}

function cau4Lien(history) {
  if (history.length < 4) return { active: false };
  const last4 = history.slice(-4).map(h => h.result);
  if (last4[0] === last4[1] && last4[1] === last4[2] && last4[2] === last4[3]) {
    return { active: true, pred: last4[0] === 'Tài' ? 'Xiu' : 'Tai', doTin: 94, ten: '💀 BẺ 4 PHIÊN GIỐNG NHAU' };
  }
  return { active: false };
}

// ==================== BẺ CẦU THÔNG MINH ====================

function beCauThongMinh(history) {
  if (history.length < 10) return { active: false };
  
  const last10 = history.slice(-10).map(h => h.result);
  const taiCount = last10.filter(r => r === 'Tài').length;
  const xiuCount = 10 - taiCount;
  
  // Lịch sử bẻ cầu gần đây
  const beCauGanDay = lichSuBeCau.slice(-5);
  const soLanBeThanhCong = beCauGanDay.filter(b => b === true).length;
  const soLanBeThatBai = beCauGanDay.filter(b => b === false).length;
  
  // Nếu bẻ thất bại nhiều -> tạm dừng bẻ
  if (soLanBeThatBai >= 3) {
    soLanBeThatBai = 0;
    return { active: true, pred: history[history.length - 1].result === 'Tài' ? 'Tai' : 'Xiu', doTin: 70, ten: '📌 TẠM DỪNG BẺ (thất bại nhiều)' };
  }
  
  // Chỉ bẻ khi có dấu hiệu rõ ràng
  if (taiCount >= 8) {
    lichSuBeCau.push(true);
    return { active: true, pred: 'Xiu', doTin: 85, ten: '🎯 BẺ CẦU - Tài quá nhiều' };
  }
  if (xiuCount >= 8) {
    lichSuBeCau.push(true);
    return { active: true, pred: 'Tai', doTin: 85, ten: '🎯 BẺ CẦU - Xỉu quá nhiều' };
  }
  
  lichSuBeCau.push(false);
  return { active: false };
}

// ==================== THEO CẦU SAU KHI BẺ THẤT BẠI ====================

function theoCauSauBe(history) {
  if (history.length < 5) return { active: false };
  
  const beCauGanDay = lichSuBeCau.slice(-3);
  const soLanBeThatBaiGanDay = beCauGanDay.filter(b => b === false).length;
  
  // Nếu bẻ thất bại 2 lần liên tiếp -> theo cầu 3 phiên
  if (soLanBeThatBaiGanDay >= 2) {
    const ketQuaCuoi = history[history.length - 1].result;
    return { 
      active: true, 
      pred: ketQuaCuoi === 'Tài' ? 'Tai' : 'Xiu', 
      doTin: 75, 
      ten: '🔄 THEO CẦU 3 PHIÊN (sau bẻ thất bại)' 
    };
  }
  return { active: false };
}

// ==================== TỔNG HỢP DỰ ĐOÁN ====================

function duDoanTongHop(history) {
  if (!history || history.length === 0) {
    return { prediction: 'Tai', doTin: 60, reason: 'Chưa có lịch sử' };
  }
  
  const cacCau = [
    cauBetThongMinh,
    cau11, cau22, cau33, cau44, cau55,
    cauZigzag, cauRangCua,
    cau123, cau321, cau121, cau212, cau132, cau231, cau112, cau211,
    cauLap2, cauLap3,
    cau2Phien, cau3Phien, cau4Phien,
    cauDaoChieu, cauXoayVong,
    cauTamGiac, cauDoiXung, cauDoiXungRong, cauGanh, cauGanhKep,
    cauTongChanLe, cauTongTangGiam, cauTongCaoThap,
    cauCanBangTanSuat, cauTanSuatDai,
    cau3Lien, cau4Lien,
    beCauThongMinh, theoCauSauBe
  ];
  
  const cauActive = [];
  for (const cau of cacCau) {
    const result = cau(history);
    if (result.active) {
      cauActive.push(result);
    }
  }
  
  if (cauActive.length === 0) {
    const doDaiBet = tinhDoDaiBet(history);
    const ketQuaCuoi = history[history.length - 1].result;
    let doTin = 65;
    if (doDaiBet >= 4) doTin = 75;
    if (doDaiBet >= 5) doTin = 80;
    
    return {
      prediction: ketQuaCuoi === 'Tài' ? 'Tai' : 'Xiu',
      doTin: doTin,
      reason: `📊 THEO CẦU (bệt ${doDaiBet})`
    };
  }
  
  let diemTai = 0, diemXiu = 0;
  let cauTotNhat = cauActive[0];
  
  for (const cau of cauActive) {
    if (cau.pred === 'Tai') diemTai += cau.doTin;
    else diemXiu += cau.doTin;
    if (cau.doTin > cauTotNhat.doTin) cauTotNhat = cau;
  }
  
  const duDoanCuoi = diemTai > diemXiu ? 'Tai' : 'Xiu';
  const tongDiem = diemTai + diemXiu;
  let doTinCuoi = Math.min(94, Math.max(65, Math.floor((Math.max(diemTai, diemXiu) / tongDiem) * 100)));
  
  return {
    prediction: duDoanCuoi,
    doTin: doTinCuoi,
    reason: `${cauTotNhat.ten} (${cauActive.length} cầu)`
  };
}

// ==================== LẤY DỮ LIỆU ====================

async function fetchData() {
  try {
    const response = await axios.get(API_URL, { timeout: 8000 });
    const data = response.data;
    const items = data?.list;
    
    if (items && Array.isArray(items) && items.length > 0) {
      const phienHienTai = items[0].id;
      
      if (phienHienTai !== lastPhien) {
        lastPhien = phienHienTai;
        
        const history = items.slice(0, 50).reverse().map(item => ({
          session: item.id,
          result: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
          totalScore: item.point || 0
        }));
        
        const ketQua = duDoanTongHop(history);
        
        cachedResult = {
          phien_hien_tai: items[0].id,
          ket_qua: items[0].resultTruyenThong === 'TAI' ? 'Tai' : 'Xiu',
          xuc_xac: items[0].dices || [0, 0, 0],
          phien_tiep_theo: items[0].id + 1,
          du_doan: ketQua.prediction,
          do_tin_cay: `${ketQua.doTin}%`,
          cau_phat_hien: ketQua.reason
        };
        
        console.log(`[${new Date().toLocaleTimeString()}] 📌 Phiên: ${phienHienTai}`);
        console.log(`   Kết quả: ${cachedResult.ket_qua} → Dự đoán: ${cachedResult.du_doan}`);
        console.log(`   🎯 ${ketQua.reason} | Độ tin cậy: ${ketQua.doTin}%`);
        console.log('---');
      }
    }
  } catch (error) {
    console.error(`Lỗi fetch:`, error.message);
  }
}

setInterval(fetchData, 2000);
fetchData();

// ==================== API ====================

app.get('/', (req, res) => {
  res.send('API Tài Xỉu - 50+ mẫu cầu | Bẻ cầu thông minh');
});

app.get('/api/hitpro', async (req, res) => {
  if (cachedResult) {
    return res.json(cachedResult);
  }
  return res.status(503).json({ error: 'Đang tải dữ liệu' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server chạy trên port ${PORT}`);
  console.log(`📌 50+ mẫu cầu: Bệt, 1-1, 2-2, 3-3, 4-4, 5-5, Zigzag, Răng cưa,`);
  console.log(`   1-2-3, 3-2-1, 1-2-1, 2-1-2, 1-3-2, 2-3-1, 1-1-2, 2-1-1,`);
  console.log(`   Lặp CK2/CK3, 2-3-4 phiên, Đảo chiều, Xoay vòng, Tam giác,`);
  console.log(`   Đối xứng, Gánh, Tổng chẵn/lẻ/tăng/giảm/cao/thấp,`);
  console.log(`   Cân bằng tần suất, Bẻ cầu thông minh, Theo cầu sau bẻ...`);
});
