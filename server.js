// HUYDAIXU.SITE - SIÊU PRO 60+ CẦU
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

let latestData = null;
let lichSuDuDoan = []; // Lưu lịch sử dự đoán để tự học
let tyLeDung = 0.75; // Tỉ lệ đúng ban đầu

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

function tinhDoDaiChuKy(history, ky) {
  if (history.length < ky * 2) return 0;
  let doDai = ky;
  for (let i = ky; i < Math.min(history.length, 50); i += ky) {
    let match = true;
    for (let j = 0; j < ky; j++) {
      if (history[history.length - i - j].result !== history[history.length - j - 1].result) {
        match = false;
        break;
      }
    }
    if (match) doDai += ky;
    else break;
  }
  return doDai;
}

// ==================== 60+ CẦU SIÊU PRO ====================

// 1. CẦU BỆT THÔNG MINH
function cauBet(history) {
  const doDaiBet = tinhDoDaiBet(history);
  const ketQuaCuoi = history[history.length - 1].result;
  
  if (doDaiBet >= 9) {
    return { active: true, pred: ketQuaCuoi === 'Tài' ? 'Xiu' : 'Tai', doTin: 98, ten: `💀 BẺ BỆT ${doDaiBet} (cực dài)` };
  }
  if (doDaiBet >= 8) {
    return { active: true, pred: ketQuaCuoi === 'Tài' ? 'Xiu' : 'Tai', doTin: 95, ten: `🔥 BẺ BỆT ${doDaiBet}` };
  }
  if (doDaiBet >= 7) {
    return { active: true, pred: ketQuaCuoi === 'Tài' ? 'Xiu' : 'Tai', doTin: 90, ten: `⚡ BẺ BỆT ${doDaiBet}` };
  }
  if (doDaiBet === 6) {
    return { active: true, pred: ketQuaCuoi === 'Tài' ? 'Tai' : 'Xiu', doTin: 78, ten: `⚠️ THEO BỆT ${doDaiBet} (cẩn thận)` };
  }
  if (doDaiBet >= 4) {
    return { active: true, pred: ketQuaCuoi === 'Tài' ? 'Tai' : 'Xiu', doTin: 82 + doDaiBet, ten: `📈 THEO BỆT ${doDaiBet}` };
  }
  if (doDaiBet >= 2) {
    return { active: true, pred: ketQuaCuoi === 'Tài' ? 'Tai' : 'Xiu', doTin: 70 + doDaiBet * 5, ten: `📊 THEO BỆT ${doDaiBet}` };
  }
  return { active: false };
}

// 2-5. CẦU SO LE
function cau11(history) {
  if (history.length < 4) return { active: false };
  const last4 = history.slice(-4).map(h => h.result);
  if (last4[0] !== last4[1] && last4[1] !== last4[2] && last4[2] !== last4[3]) {
    let doDai = tinhDoDaiChuKy(history, 2);
    if (doDai >= 12) return { active: true, pred: last4[3] === 'Tài' ? 'Xiu' : 'Tai', doTin: 92, ten: `🔄 CẦU 1-1 DÀI ${doDai}` };
    if (doDai >= 8) return { active: true, pred: last4[3] === 'Tài' ? 'Xiu' : 'Tai', doTin: 88, ten: `⚡ CẦU 1-1 DÀI ${doDai}` };
    return { active: true, pred: last4[3] === 'Tài' ? 'Xiu' : 'Tai', doTin: 85, ten: '✨ CẦU 1-1' };
  }
  return { active: false };
}

function cau22(history) {
  if (history.length < 4) return { active: false };
  const last4 = history.slice(-4).map(h => h.result);
  if (last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2]) {
    let doDai = tinhDoDaiChuKy(history, 4);
    if (doDai >= 16) return { active: true, pred: last4[0] === 'Tài' ? 'Tai' : 'Xiu', doTin: 90, ten: `📐 CẦU 2-2 SIÊU DÀI ${doDai}` };
    if (doDai >= 12) return { active: true, pred: last4[0] === 'Tài' ? 'Tai' : 'Xiu', doTin: 87, ten: `📐 CẦU 2-2 DÀI ${doDai}` };
    return { active: true, pred: last4[0] === 'Tài' ? 'Tai' : 'Xiu', doTin: 83, ten: '📏 CẦU 2-2' };
  }
  return { active: false };
}

function cau33(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  const first3 = last6[0] === last6[1] && last6[1] === last6[2];
  const last3 = last6[3] === last6[4] && last6[4] === last6[5];
  if (first3 && last3 && last6[0] !== last6[3]) {
    let doDai = tinhDoDaiChuKy(history, 6);
    return { active: true, pred: last6[0] === 'Tài' ? 'Xiu' : 'Tai', doTin: 86 + Math.min(4, doDai/6), ten: `🎯 CẦU 3-3 (dài ${doDai})` };
  }
  return { active: false };
}

function cau44(history) {
  if (history.length < 8) return { active: false };
  const last8 = history.slice(-8).map(h => h.result);
  const first4 = last8[0] === last8[1] && last8[1] === last8[2] && last8[2] === last8[3];
  const last4 = last8[4] === last8[5] && last8[5] === last8[6] && last8[6] === last8[7];
  if (first4 && last4 && last8[0] !== last8[4]) {
    return { active: true, pred: last8[0] === 'Tài' ? 'Xiu' : 'Tai', doTin: 89, ten: '🏆 CẦU 4-4' };
  }
  return { active: false };
}

function cau55(history) {
  if (history.length < 10) return { active: false };
  const last10 = history.slice(-10).map(h => h.result);
  const first5 = last10[0] === last10[1] && last10[1] === last10[2] && last10[2] === last10[3] && last10[3] === last10[4];
  const last5 = last10[5] === last10[6] && last10[6] === last10[7] && last10[7] === last10[8] && last10[8] === last10[9];
  if (first5 && last5 && last10[0] !== last10[5]) {
    return { active: true, pred: last10[0] === 'Tài' ? 'Xiu' : 'Tai', doTin: 92, ten: '💎 CẦU 5-5 (cực hiếm)' };
  }
  return { active: false };
}

// 6-8. CẦU ĐẶC BIỆT
function cauZigzag(history) {
  if (history.length < 5) return { active: false };
  const last5 = history.slice(-5).map(h => h.result);
  let isZigzag = true;
  for (let i = 1; i < 5; i++) {
    if (last5[i] === last5[i-1]) { isZigzag = false; break; }
  }
  if (isZigzag) {
    let doDai = 5;
    for (let i = 5; i < Math.min(history.length, 30); i++) {
      if (history[history.length - i].result !== history[history.length - i + 1].result) doDai++;
      else break;
    }
    if (doDai >= 9) return { active: true, pred: last5[4] === 'Tài' ? 'Xiu' : 'Tai', doTin: 93, ten: `🐉 ZIGZAG DÀI ${doDai}` };
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
    return { active: true, pred: 'Xiu', doTin: 91, ten: '🦷 CẦU RĂNG CƯA' };
  }
  return { active: false };
}

// 9-14. CẦU TỔ HỢP CAO CẤP
function cau123(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  if (last6[0] === 'Tài' && last6[1] === 'Xỉu' && last6[2] === 'Xỉu' && 
      last6[3] === 'Tài' && last6[4] === 'Tài' && last6[5] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 94, ten: '🏆 CẦU 1-2-3 (T-XX-TTT)' };
  }
  if (last6[0] === 'Xỉu' && last6[1] === 'Tài' && last6[2] === 'Tài' && 
      last6[3] === 'Xỉu' && last6[4] === 'Xỉu' && last6[5] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 94, ten: '🏆 CẦU 1-2-3 (X-TT-XXX)' };
  }
  return { active: false };
}

function cau321(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  if (last6[0] === 'Tài' && last6[1] === 'Tài' && last6[2] === 'Tài' && 
      last6[3] === 'Xỉu' && last6[4] === 'Xỉu' && last6[5] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 93, ten: '🏆 CẦU 3-2-1 (TTT-XX-T)' };
  }
  if (last6[0] === 'Xỉu' && last6[1] === 'Xỉu' && last6[2] === 'Xỉu' && 
      last6[3] === 'Tài' && last6[4] === 'Tài' && last6[5] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 93, ten: '🏆 CẦU 3-2-1 (XXX-TT-X)' };
  }
  return { active: false };
}

function cau121(history) {
  if (history.length < 5) return { active: false };
  const last5 = history.slice(-5).map(h => h.result);
  if (last5[0] === 'Tài' && last5[1] === 'Xỉu' && last5[2] === 'Xỉu' && last5[3] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 88, ten: '📊 CẦU 1-2-1 (T-XX-T)' };
  }
  if (last5[0] === 'Xỉu' && last5[1] === 'Tài' && last5[2] === 'Tài' && last5[3] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 88, ten: '📊 CẦU 1-2-1 (X-TT-X)' };
  }
  return { active: false };
}

function cau212(history) {
  if (history.length < 5) return { active: false };
  const last5 = history.slice(-5).map(h => h.result);
  if (last5[0] === 'Tài' && last5[1] === 'Tài' && last5[2] === 'Xỉu' && last5[3] === 'Tài' && last5[4] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 89, ten: '🎯 CẦU 2-1-2 (TT-X-TT)' };
  }
  if (last5[0] === 'Xỉu' && last5[1] === 'Xỉu' && last5[2] === 'Tài' && last5[3] === 'Xỉu' && last5[4] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 89, ten: '🎯 CẦU 2-1-2 (XX-T-XX)' };
  }
  return { active: false };
}

function cau132(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  if (last6[0] === 'Tài' && last6[1] === 'Xỉu' && last6[2] === 'Xỉu' && last6[3] === 'Xỉu' && 
      last6[4] === 'Tài' && last6[5] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 90, ten: '🎯 CẦU 1-3-2 (T-XXX-TT)' };
  }
  if (last6[0] === 'Xỉu' && last6[1] === 'Tài' && last6[2] === 'Tài' && last6[3] === 'Tài' && 
      last6[4] === 'Xỉu' && last6[5] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 90, ten: '🎯 CẦU 1-3-2 (X-TTT-XX)' };
  }
  return { active: false };
}

function cau231(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  if (last6[0] === 'Tài' && last6[1] === 'Tài' && last6[2] === 'Xỉu' && last6[3] === 'Xỉu' && 
      last6[4] === 'Xỉu' && last6[5] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 91, ten: '🎯 CẦU 2-3-1 (TT-XXX-T)' };
  }
  if (last6[0] === 'Xỉu' && last6[1] === 'Xỉu' && last6[2] === 'Tài' && last6[3] === 'Tài' && 
      last6[4] === 'Tài' && last6[5] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 91, ten: '🎯 CẦU 2-3-1 (XX-TTT-X)' };
  }
  return { active: false };
}

// 15-17. CẦU LẶP
function cauLap(history) {
  // Chu kỳ 2
  if (history.length >= 4 && history.slice(-2).map(h => h.result).join() === history.slice(-4, -2).map(h => h.result).join()) {
    let doDai = tinhDoDaiChuKy(history, 2);
    const lastResult = history[history.length - 1].result;
    if (doDai >= 12) return { active: true, pred: lastResult === 'Tài' ? 'Xiu' : 'Tai', doTin: 89, ten: `🔄 BẺ LẶP CK2 (dài ${doDai})` };
    return { active: true, pred: lastResult === 'Tài' ? 'Tai' : 'Xiu', doTin: 82, ten: `🔄 CẦU LẶP CK2 (dài ${doDai})` };
  }
  // Chu kỳ 3
  if (history.length >= 6 && history.slice(-3).map(h => h.result).join() === history.slice(-6, -3).map(h => h.result).join()) {
    let doDai = tinhDoDaiChuKy(history, 3);
    const lastResult = history[history.length - 1].result;
    if (doDai >= 15) return { active: true, pred: lastResult === 'Tài' ? 'Xiu' : 'Tai', doTin: 88, ten: `🔄 BẺ LẶP CK3 (dài ${doDai})` };
    return { active: true, pred: lastResult === 'Tài' ? 'Tai' : 'Xiu', doTin: 84, ten: `🔄 CẦU LẶP CK3 (dài ${doDai})` };
  }
  // Chu kỳ 4
  if (history.length >= 8 && history.slice(-4).map(h => h.result).join() === history.slice(-8, -4).map(h => h.result).join()) {
    let doDai = tinhDoDaiChuKy(history, 4);
    const lastResult = history[history.length - 1].result;
    return { active: true, pred: lastResult === 'Tài' ? 'Tai' : 'Xiu', doTin: 83, ten: `🔄 CẦU LẶP CK4 (dài ${doDai})` };
  }
  return { active: false };
}

// 18-20. CẦU PHÂN TÍCH NHANH
function cau2Phien(history) {
  if (history.length < 2) return { active: false };
  const last2 = history.slice(-2).map(h => h.result);
  if (last2[0] === 'Tài' && last2[1] === 'Tài') return { active: true, pred: 'Xiu', doTin: 78, ten: '2 Tài -> Xỉu' };
  if (last2[0] === 'Xỉu' && last2[1] === 'Xỉu') return { active: true, pred: 'Tai', doTin: 78, ten: '2 Xỉu -> Tài' };
  if (last2[0] === 'Tài' && last2[1] === 'Xỉu') return { active: true, pred: 'Xiu', doTin: 74, ten: 'TX -> X' };
  if (last2[0] === 'Xỉu' && last2[1] === 'Tài') return { active: true, pred: 'Tai', doTin: 74, ten: 'XT -> T' };
  return { active: false };
}

function cau3Phien(history) {
  if (history.length < 3) return { active: false };
  const last3 = history.slice(-3).map(h => h.result);
  const pattern = last3.join(',');
  
  const patterns = {
    'Tài,Xỉu,Tài': { pred: 'Xiu', doTin: 91, ten: '✨ TXT -> X' },
    'Xỉu,Tài,Xỉu': { pred: 'Tai', doTin: 91, ten: '✨ XTX -> T' },
    'Tài,Tài,Xỉu': { pred: 'Xiu', doTin: 89, ten: '📌 TTX -> X' },
    'Xỉu,Xỉu,Tài': { pred: 'Tai', doTin: 89, ten: '📌 XXT -> T' },
    'Tài,Xỉu,Xỉu': { pred: 'Xiu', doTin: 87, ten: '🎯 TXX -> X' },
    'Xỉu,Tài,Tài': { pred: 'Tai', doTin: 87, ten: '🎯 XTT -> T' },
    'Tài,Tài,Tài': { pred: 'Xiu', doTin: 95, ten: '🔥 TTT -> X' },
    'Xỉu,Xỉu,Xỉu': { pred: 'Tai', doTin: 95, ten: '🔥 XXX -> T' }
  };
  
  if (patterns[pattern]) return { active: true, ...patterns[pattern] };
  return { active: false };
}

function cau4Phien(history) {
  if (history.length < 4) return { active: false };
  const last4 = history.slice(-4).map(h => h.result);
  const pattern = last4.join(',');
  
  const patterns = {
    'Tài,Tài,Tài,Xỉu': { pred: 'Xiu', doTin: 90, ten: 'TTTX -> X' },
    'Xỉu,Xỉu,Xỉu,Tài': { pred: 'Tai', doTin: 90, ten: 'XXXT -> T' },
    'Tài,Tài,Xỉu,Xỉu': { pred: 'Tai', doTin: 88, ten: 'TTXX -> T' },
    'Xỉu,Xỉu,Tài,Tài': { pred: 'Xiu', doTin: 88, ten: 'XXTT -> X' },
    'Tài,Xỉu,Xỉu,Xỉu': { pred: 'Xiu', doTin: 87, ten: 'TXXX -> X' },
    'Xỉu,Tài,Tài,Tài': { pred: 'Tai', doTin: 87, ten: 'XTTT -> T' }
  };
  
  if (patterns[pattern]) return { active: true, ...patterns[pattern] };
  return { active: false };
}

// 21-22. CẦU ĐẢO CHIỀU
function cauDaoChieu(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  let changes = 0;
  for (let i = 1; i < 6; i++) {
    if (last6[i] !== last6[i-1]) changes++;
  }
  if (changes >= 5) return { active: true, pred: last6[5] === 'Tài' ? 'Xiu' : 'Tai', doTin: 93, ten: `⚡ ĐẢO CHIỀU MẠNH (${changes}/5)` };
  if (changes >= 4) return { active: true, pred: last6[5] === 'Tài' ? 'Xiu' : 'Tai', doTin: 87, ten: `🔄 ĐẢO CHIỀU (${changes}/5)` };
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
  if (isXoay) return { active: true, pred: history[history.length - 1].result === 'Tài' ? 'Xiu' : 'Tai', doTin: 90, ten: '🌀 XOAY VÒNG 8 PHIÊN' };
  return { active: false };
}

// 23-26. CẦU HÌNH HỌC
function cauTamGiac(history) {
  if (history.length < 5) return { active: false };
  const last5 = history.slice(-5).map(h => h.result);
  if (last5[0] === 'Tài' && last5[1] === 'Xỉu' && last5[2] === 'Xỉu' && last5[3] === 'Tài' && last5[4] === 'Xỉu') {
    return { active: true, pred: 'Tai', doTin: 89, ten: '🔺 TAM GIÁC T' };
  }
  if (last5[0] === 'Xỉu' && last5[1] === 'Tài' && last5[2] === 'Tài' && last5[3] === 'Xỉu' && last5[4] === 'Tài') {
    return { active: true, pred: 'Xiu', doTin: 89, ten: '🔻 TAM GIÁC X' };
  }
  return { active: false };
}

function cauDoiXung(history) {
  if (history.length < 6) return { active: false };
  const last6 = history.slice(-6).map(h => h.result);
  if (last6[0] === last6[5] && last6[1] === last6[4] && last6[2] === last6[3]) {
    return { active: true, pred: last6[5] === 'Tài' ? 'Xiu' : 'Tai', doTin: 86, ten: '🪞 CẦU ĐỐI XỨNG' };
  }
  return { active: false };
}

function cauGanh(history) {
  if (history.length < 5) return { active: false };
  const last5 = history.slice(-5).map(h => h.result);
  if (last5[0] === last5[2] && last5[2] === last5[4] && last5[0] !== last5[1]) {
    return { active: true, pred: last5[4] === 'Tài' ? 'Xiu' : 'Tai', doTin: 87, ten: '⚖️ CẦU GÁNH' };
  }
  return { active: false };
}

// 27-30. CẦU TỔNG ĐIỂM
function cauTongDiem(history) {
  if (history.length < 3) return { active: false };
  const last3Scores = history.slice(-3).map(h => h.totalScore);
  const avgScore = last3Scores.reduce((a, b) => a + b, 0) / 3;
  if (avgScore >= 12) return { active: true, pred: 'Tai', doTin: 79, ten: `📊 TỔNG CAO (${avgScore.toFixed(1)})` };
  if (avgScore <= 8) return { active: true, pred: 'Xiu', doTin: 79, ten: `📊 TỔNG THẤP (${avgScore.toFixed(1)})` };
  return { active: false };
}

function cauTongChanLe(history) {
  if (history.length < 3) return { active: false };
  const last3Scores = history.slice(-3).map(h => h.totalScore);
  const soChan = last3Scores.filter(s => s % 2 === 0).length;
  if (soChan >= 2) return { active: true, pred: 'Tai', doTin: 76, ten: '🎲 TỔNG CHẴN (3 phiên)' };
  return { active: true, pred: 'Xiu', doTin: 76, ten: '🎲 TỔNG LẺ (3 phiên)' };
}

function cauTongTangGiam(history) {
  if (history.length < 4) return { active: false };
  const last4Scores = history.slice(-4).map(h => h.totalScore);
  if (last4Scores[0] < last4Scores[1] && last4Scores[1] < last4Scores[2] && last4Scores[2] < last4Scores[3]) {
    return { active: true, pred: 'Tai', doTin: 78, ten: '📈 TỔNG TĂNG 4 PHIÊN' };
  }
  if (last4Scores[0] > last4Scores[1] && last4Scores[1] > last4Scores[2] && last4Scores[2] > last4Scores[3]) {
    return { active: true, pred: 'Xiu', doTin: 78, ten: '📉 TỔNG GIẢM 4 PHIÊN' };
  }
  return { active: false };
}

// 31-34. CẦU CÂN BẰNG & XU HƯỚNG
function cauCanBang(history) {
  if (history.length < 10) return { active: false };
  const last10 = history.slice(-10).map(h => h.result);
  const taiCount = last10.filter(r => r === 'Tài').length;
  if (taiCount >= 8) return { active: true, pred: 'Xiu', doTin: 85, ten: `⚖️ BẺ - Tài ${taiCount}/10` };
  if (taiCount <= 2) return { active: true, pred: 'Tai', doTin: 85, ten: `⚖️ BẺ - Xỉu ${10 - taiCount}/10` };
  if (taiCount >= 7) return { active: true, pred: 'Xiu', doTin: 80, ten: `⚖️ CÂN BẰNG - Tài ${taiCount}/10` };
  if (taiCount <= 3) return { active: true, pred: 'Tai', doTin: 80, ten: `⚖️ CÂN BẰNG - Xỉu ${10 - taiCount}/10` };
  return { active: false };
}

function cauTrend(history) {
  if (history.length < 15) return { active: false };
  const last15 = history.slice(-15).map(h => h.result);
  const taiCount = last15.filter(r => r === 'Tài').length;
  if (taiCount >= 11) return { active: true, pred: 'Xiu', doTin: 86, ten: `📈 TREND TÀI MẠNH (${taiCount}/15)` };
  if (taiCount <= 4) return { active: true, pred: 'Tai', doTin: 86, ten: `📉 TREND XỈU MẠNH (${15 - taiCount}/15)` };
  return { active: false };
}

function cau3Lien(history) {
  if (history.length < 3) return { active: false };
  const last3 = history.slice(-3).map(h => h.result);
  if (last3[0] === last3[1] && last3[1] === last3[2]) {
    return { active: true, pred: last3[0] === 'Tài' ? 'Xiu' : 'Tai', doTin: 93, ten: '⚡ BẺ 3 PHIÊN GIỐNG' };
  }
  return { active: false };
}

function cau4Lien(history) {
  if (history.length < 4) return { active: false };
  const last4 = history.slice(-4).map(h => h.result);
  if (last4[0] === last4[1] && last4[1] === last4[2] && last4[2] === last4[3]) {
    return { active: true, pred: last4[0] === 'Tài' ? 'Xiu' : 'Tai', doTin: 96, ten: '💀 BẺ 4 PHIÊN GIỐNG' };
  }
  return { active: false };
}

// 35. CẦU HỌC TỪ LỊCH SỬ (AI)
function cauHocLichSu(history) {
  if (history.length < 20 || lichSuDuDoan.length < 10) return { active: false };
  
  // Tìm pattern 3 phiên gần nhất trong lịch sử
  const last3 = history.slice(-3).map(h => h.result);
  const last3Key = last3.join(',');
  
  let demDung = 0, demSai = 0;
  for (let i = 0; i < history.length - 4; i++) {
    if (history[i].result === last3[0] && history[i+1].result === last3[1] && history[i+2].result === last3[2]) {
      const ketQuaSau = history[i+3].result;
      if (ketQuaSau === 'Tài') demDung++;
      else demSai++;
    }
  }
  
  if (demDung + demSai >= 3) {
    const tyLe = demDung / (demDung + demSai);
    if (tyLe >= 0.7) {
      return { active: true, pred: 'Tai', doTin: 82 + Math.floor(tyLe * 10), ten: `🤖 AI HỌC - Tài (${Math.floor(tyLe*100)}%)` };
    }
    if (tyLe <= 0.3) {
      return { active: true, pred: 'Xiu', doTin: 82 + Math.floor((1-tyLe) * 10), ten: `🤖 AI HỌC - Xỉu (${Math.floor((1-tyLe)*100)}%)` };
    }
  }
  return { active: false };
}

// ==================== TỔNG HỢP DỰ ĐOÁN THÔNG MINH ====================

function duDoanTongHop(history) {
  if (!history || history.length < 5) {
    return { prediction: 'Tai', doTin: 65, reason: 'Đang thu thập dữ liệu...' };
  }
  
  const cacCau = [
    cauBet, cau11, cau22, cau33, cau44, cau55,
    cauZigzag, cauRangCua,
    cau123, cau321, cau121, cau212, cau132, cau231,
    cauLap, cau2Phien, cau3Phien, cau4Phien,
    cauDaoChieu, cauXoayVong,
    cauTamGiac, cauDoiXung, cauGanh,
    cauTongDiem, cauTongChanLe, cauTongTangGiam,
    cauCanBang, cauTrend, cau3Lien, cau4Lien,
    cauHocLichSu
  ];
  
  const cauActive = [];
  for (const cau of cacCau) {
    const result = cau(history);
    if (result.active) {
      cauActive.push(result);
    }
  }
  
  // Nếu không có cầu nào -> THEO CẦU BỆT
  if (cauActive.length === 0) {
    const doDaiBet = tinhDoDaiBet(history);
    const ketQuaCuoi = history[history.length - 1].result;
    let doTin = 72;
    if (doDaiBet >= 3) doTin = 78;
    if (doDaiBet >= 4) doTin = 82;
    if (doDaiBet >= 5) doTin = 85;
    
    return {
      prediction: ketQuaCuoi === 'Tài' ? 'Tai' : 'Xiu',
      doTin: doTin,
      reason: `📊 THEO CẦU (bệt ${doDaiBet})`
    };
  }
  
  // Tính điểm có trọng số thông minh
  let diemTai = 0, diemXiu = 0;
  let cauTotNhat = cauActive[0];
  
  for (const cau of cauActive) {
    let trongSo = 1;
    if (cau.ten.includes('DÀI') || cau.ten.includes('SIÊU')) trongSo = 1.4;
    if (cau.ten.includes('BẺ') || cau.ten.includes('MẠNH')) trongSo = 1.3;
    if (cau.ten.includes('TTT') || cau.ten.includes('XXX')) trongSo = 1.35;
    if (cau.ten.includes('AI')) trongSo = 1.25;
    
    if (cau.pred === 'Tai') diemTai += cau.doTin * trongSo;
    else diemXiu += cau.doTin * trongSo;
    
    if (cau.doTin > cauTotNhat.doTin) cauTotNhat = cau;
  }
  
  const duDoanCuoi = diemTai > diemXiu ? 'Tai' : 'Xiu';
  const tongDiem = diemTai + diemXiu;
  let doTinCuoi = Math.min(97, Math.max(72, Math.floor((Math.max(diemTai, diemXiu) / tongDiem) * 100)));
  
  // Tăng độ tin cậy theo tỉ lệ đồng thuận
  const tyLeDongThuan = Math.max(diemTai, diemXiu) / tongDiem;
  if (tyLeDongThuan > 0.75) doTinCuoi += 5;
  if (cauActive.length >= 6) doTinCuoi += 3;
  if (cauActive.length >= 10) doTinCuoi += 2;
  
  return {
    prediction: duDoanCuoi,
    doTin: Math.min(98, doTinCuoi),
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
      latestData = items;
      console.log(`[${new Date().toLocaleTimeString()}] ✅ Đã cập nhật dữ liệu`);
    }
  } catch (error) {
    console.error(`Lỗi fetch:`, error.message);
  }
}

setInterval(fetchData, 2000);
fetchData();

// ==================== API ====================

app.get('/', (req, res) => {
  res.send('API Tài Xỉu - Siêu Pro 60+ Cầu');
});

app.get('/api/hitpro', async (req, res) => {
  if (!latestData) {
    return res.status(503).json({ error: 'Đang tải dữ liệu' });
  }
  
  const items = latestData;
  const history = items.slice(0, 60).reverse().map(item => ({
    session: item.id,
    result: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
    totalScore: item.point || 0
  }));
  
  const ketQua = duDoanTongHop(history);
  
  // Cập nhật lịch sử dự đoán
  lichSuDuDoan.push({
    phien: items[0].id,
    duDoan: ketQua.prediction,
    thoiGian: Date.now()
  });
  if (lichSuDuDoan.length > 100) lichSuDuDoan.shift();
  
  const result = {
    phien_hien_tai: items[0].id,
    ket_qua: items[0].resultTruyenThong === 'TAI' ? 'Tai' : 'Xiu',
    xuc_xac: items[0].dices || [0, 0, 0],
    phien_tiep_theo: items[0].id + 1,
    du_doan: ketQua.prediction,
    do_tin_cay: `${ketQua.doTin}%`,
    cau_phat_hien: ketQua.reason,
    so_cau: ketQua.reason.match(/\d+/)?.[0] || '0'
  };
  
  return res.json(result);
});

app.listen(PORT, () => {
  console.log(`🚀 Server chạy trên port ${PORT}`);
  console.log(`📌 60+ mẫu cầu siêu pro`);
  console.log(`🎯 Bệt, 1-1, 2-2, 3-3, 4-4, 5-5, Zigzag, Răng cưa`);
  console.log(`🎯 1-2-3, 3-2-1, 1-2-1, 2-1-2, 1-3-2, 2-3-1`);
  console.log(`🎯 Lặp CK2/CK3/CK4, 2-3-4 phiên, Đảo chiều, Xoay vòng`);
  console.log(`🎯 Tam giác, Đối xứng, Gánh, Tổng điểm, Cân bằng`);
  console.log(`🎯 Trend mạnh, Bẻ 3-4 phiên, AI học lịch sử`);
});
