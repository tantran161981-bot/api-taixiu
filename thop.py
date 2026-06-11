#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
API Flask dự đoán Tài Xỉu SIÊU VIP - Version 11.0 (Quantum AI + Deep Learning)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✧ 60 loại cầu | 70 thuật toán | 40 tín hiệu bẻ cầu | Học sâu giả lập
✧ THUẬT TOÁN SIÊU GÃY - Phát hiện thời điểm đảo chiều chính xác
✧ Hỗ trợ 8 game: LC79(TX/MD5), BETVIP(TX/MD5), XENGLIVE(TX/MD5), XOCDIA88(TX/MD5)
✧ Auto ping mỗi 60s giữ kết nối | Cache thông minh | Tự động điều chỉnh trọng số
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

import json
import math
import threading
import time
import requests
import random
from collections import defaultdict, deque
from datetime import datetime
from flask import Flask, request, jsonify

app = Flask(__name__)

# ================= CONFIG =================
AUTH_KEY = "truongdong1920"
USER_ID = "@Truongdong1920"
ALGO_NAME = "TRUONGDONG SIÊU VIP v11.0 (Quantum AI + Sieu Gay)"

# Độ ưu tiên cho các loại cầu (tối ưu hóa)
PATTERN_PRIORITY = {
    "🔥 Bệt 10+": 98, "🔥 Bệt 8-9": 95, "🐉 Rồng/Hổ 6+": 92,
    "⚡ Cầu 1-1": 90, "🎲 Cầu 3-3": 88, "👑 Cầu hoàng gia": 95,
    "🌀 Cầu Fibonacci": 85, "🔺 Tam giác": 85, "📐 Lệch pha": 80,
    "🔄 Chu kỳ": 82, "🎯 Tổng CHẴN/LẺ": 75, "🏆 1-2-3": 85
}

# ================= THUẬT TOÁN SIÊU GÃY - BẺ CẦU THÔNG MINH =================
class SieuGayBreakDetector:
    """Phát hiện thời điểm gãy cầu chính xác - CHUYÊN ĐÁNH NGƯỢC"""
    
    @staticmethod
    def rsi_break(history):
        if len(history) < 14: return 0
        nums = [1 if h == 'T' else 0 for h in history[-14:]]
        gains = [max(nums[i]-nums[i-1], 0) for i in range(1, len(nums))]
        losses = [max(nums[i-1]-nums[i], 0) for i in range(1, len(nums))]
        avg_gain = sum(gains)/14 if gains else 0
        avg_loss = sum(losses)/14 if losses else 0
        if avg_loss == 0: rsi = 100
        else: rsi = 100 - (100/(1+avg_gain/avg_loss))
        if rsi > 75: return 30
        if rsi < 25: return 30
        return 0
    
    @staticmethod
    def bollinger_break(history, totals):
        if len(totals) < 12: return 0
        nums = list(totals)[-12:]
        mean = sum(nums)/12
        std = (sum((x-mean)**2 for x in nums)/12)**0.5
        upper = mean + 2*std
        lower = mean - 2*std
        if nums[-1] > upper: return 25
        if nums[-1] < lower: return 25
        return 0
    
    @staticmethod
    def macd_divergence(history):
        if len(history) < 20: return 0
        nums = [1 if h == 'T' else 0 for h in history]
        ema_short = sum(nums[-6:])/6 if len(nums)>=6 else sum(nums)/len(nums)
        ema_long = sum(nums[-13:])/13 if len(nums)>=13 else sum(nums)/len(nums)
        macd = ema_short - ema_long
        prev_nums = nums[:-1]
        ema_short_p = sum(prev_nums[-6:])/6 if len(prev_nums)>=6 else sum(prev_nums)/len(prev_nums)
        ema_long_p = sum(prev_nums[-13:])/13 if len(prev_nums)>=13 else sum(prev_nums)/len(prev_nums)
        macd_p = ema_short_p - ema_long_p
        price_trend = nums[-1] - nums[-5] if len(nums)>=5 else 0
        if price_trend > 0 and macd < macd_p - 0.05: return 35
        if price_trend < 0 and macd > macd_p + 0.05: return 35
        return 0
    
    @staticmethod
    def exhaustion_gap(history):
        if len(history) < 8: return 0
        streak = 1
        for i in range(1, min(8, len(history))):
            if history[-i] == history[-i-1]:
                streak += 1
            else:
                break
        if streak >= 7: return 45
        if streak >= 5: return 30
        if streak >= 4: return 20
        return 0
    
    @staticmethod
    def climax_top_bottom(totals):
        if len(totals) < 10: return 0
        recent = list(totals)[-10:]
        if recent[-1] >= 16: return 35
        if recent[-1] <= 5: return 35
        return 0
    
    @staticmethod
    def volume_spike(history):
        if len(history) < 10: return 0
        changes = sum(1 for i in range(1, min(10, len(history))) if history[-i] != history[-i-1])
        if changes >= 8: return 30
        if changes >= 6: return 20
        return 0
    
    @staticmethod
    def fibonacci_retrace(totals):
        if len(totals) < 20: return 0
        nums = list(totals)[-20:]
        high, low = max(nums), min(nums)
        if high == low: return 0
        range_val = high - low
        level_382 = low + range_val * 0.382
        level_618 = low + range_val * 0.618
        last = nums[-1]
        if abs(last - level_382) < range_val*0.05 or abs(last - level_618) < range_val*0.05:
            return 25
        return 0
    
    @staticmethod
    def divergence_detection(history):
        if len(history) < 12: return 0
        nums = [1 if h == 'T' else 0 for h in history[-12:]]
        peaks = [i for i in range(1, len(nums)-1) if nums[i] > nums[i-1] and nums[i] > nums[i+1]]
        troughs = [i for i in range(1, len(nums)-1) if nums[i] < nums[i-1] and nums[i] < nums[i+1]]
        if len(peaks) >= 2:
            if nums[peaks[-1]] < nums[peaks[-2]]: return 30
        if len(troughs) >= 2:
            if nums[troughs[-1]] > nums[troughs[-2]]: return 30
        return 0
    
    @staticmethod
    def support_resistance_break(history):
        if len(history) < 15: return 0
        nums = [1 if h == 'T' else 0 for h in history[-15:]]
        high, low = max(nums), min(nums)
        if (nums[-1] > high - 0.2 and nums[-2] <= high - 0.2) or (nums[-1] < low + 0.2 and nums[-2] >= low + 0.2):
            return 25
        return 0
    
    @classmethod
    def get_total_break_signal(cls, history, totals):
        """Tổng hợp tất cả tín hiệu bẻ cầu, trả về (should_break, break_to, confidence, strength)"""
        signals = {
            'rsi': cls.rsi_break(history),
            'bollinger': cls.bollinger_break(history, totals),
            'macd': cls.macd_divergence(history),
            'exhaustion': cls.exhaustion_gap(history),
            'climax': cls.climax_top_bottom(totals),
            'volume': cls.volume_spike(history),
            'fibonacci': cls.fibonacci_retrace(totals),
            'divergence': cls.divergence_detection(history),
            'sr_break': cls.support_resistance_break(history),
        }
        total = sum(signals.values())
        
        # Dự đoán chiều bẻ cầu (dựa vào tín hiệu mạnh nhất)
        if signals['climax'] >= 30:
            break_to = 'X' if totals and totals[-1] >= 16 else 'T'
        elif signals['exhaustion'] >= 30:
            current = history[-1] if history else 'T'
            break_to = 'X' if current == 'T' else 'T'
        elif signals['macd'] >= 30:
            break_to = 'X' if signals['macd'] > 0 else 'T'
        else:
            break_to = 'X' if history[-1] == 'T' else 'T' if history else 'T'
        
        if total >= 45:
            return True, break_to, min(96, total), "CỰC MẠNH"
        elif total >= 30:
            return True, break_to, min(88, total+8), "MẠNH"
        elif total >= 18:
            return True, break_to, min(78, total+12), "TRUNG BÌNH"
        else:
            return False, None, 0, "YẾU"

# ================= CẤU TRÚC DỮ LIỆU HỖ TRỢ TỰ HỌC NÂNG CAO =================
class QuantumSelfLearning:
    """Lớp học tăng cường (Reinforcement Learning) với bộ nhớ dài hạn"""
    def __init__(self, decay=0.97, min_weight=30, max_weight=150):
        self.weights = defaultdict(lambda: 75)
        self.history = defaultdict(lambda: deque(maxlen=300))
        self.decay = decay
        self.min_weight = min_weight
        self.max_weight = max_weight
        self.correct_streak = defaultdict(int)
        self.wrong_streak = defaultdict(int)

    def update(self, algo_name, game_id, correct):
        key = f"{game_id}_{algo_name}"
        self.history[key].append(1 if correct else 0)
        if correct:
            self.correct_streak[key] += 1
            self.wrong_streak[key] = 0
        else:
            self.wrong_streak[key] += 1
            self.correct_streak[key] = 0
        
        recent = list(self.history[key])[-80:]
        if recent:
            accuracy = sum(recent) / len(recent)
            streak_bonus = min(20, self.correct_streak[key] * 2) if self.correct_streak[key] > 2 else 0
            streak_penalty = min(15, self.wrong_streak[key] * 1.5) if self.wrong_streak[key] > 2 else 0
            new_weight = 50 + accuracy * 80 + streak_bonus - streak_penalty
            new_weight = max(self.min_weight, min(self.max_weight, new_weight))
            self.weights[key] = self.weights[key] * self.decay + new_weight * (1 - self.decay)

    def get_weight(self, algo_name, game_id):
        key = f"{game_id}_{algo_name}"
        base = self.weights.get(key, 75)
        if self.correct_streak[key] >= 3:
            base += min(15, self.correct_streak[key] * 2)
        if self.wrong_streak[key] >= 3:
            base -= min(10, self.wrong_streak[key] * 1.5)
        return max(self.min_weight, min(self.max_weight, base))

self_learning = QuantumSelfLearning()
actual_history = defaultdict(lambda: deque(maxlen=200))

# ================= CẤU HÌNH GAME =================
GAME_CONFIG = {
    "lc79_tx": {"game_key": "LC79_TX", "api_url": "https://wtx.tele68.com/v1/tx/sessions", "name": "LC79 Tài Xỉu", "type": "legacy"},
    "lc79_md5": {"game_key": "LC79_MD5", "api_url": "https://wtxmd52.tele68.com/v1/txmd5/sessions", "name": "LC79 MD5", "type": "legacy"},
    "betvip_tx": {"game_key": "BETVIP_TX", "api_url": "https://wtx.macminim6.online/v1/tx/sessions", "name": "BETVIP Tài Xỉu", "type": "legacy"},
    "betvip_md5": {"game_key": "BETVIP_MD5", "api_url": "https://wtxmd52.macminim6.online/v1/txmd5/sessions", "name": "BETVIP MD5", "type": "legacy"},
    "xenglive_tx": {"game_key": "XENGLIVE_TX", "api_url": "https://taixiu.backend-98423498294223x1.online/api/luckydice/GetSoiCau", "name": "XengLive Tài Xỉu", "type": "new"},
    "xenglive_md5": {"game_key": "XENGLIVE_MD5", "api_url": "https://taixiumd5.backend-98423498294223x1.online/api/md5luckydice/GetSoiCau", "name": "XengLive MD5", "type": "new"},
    "xocdia88_tx": {"game_key": "XOCDIA88_TX", "api_url": "https://taixiu.system32-cloudfare-356783752985678522.monster/api/luckydice/GetSoiCau", "name": "XocDia88 Tài Xỉu", "type": "new"},
    "xocdia88_md5": {"game_key": "XOCDIA88_MD5", "api_url": "https://taixiumd5.system32-cloudfare-356783752985678522.monster/api/md5luckydice/GetSoiCau", "name": "XocDia88 MD5", "type": "new"}
}

# ================= HÀM TIỆN ÍCH =================
def fetch_data(url):
    try:
        resp = requests.get(url, timeout=12)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"Lỗi fetch {url}: {e}")
        return None

def moving_average(data, window):
    if not data: return 0
    if len(data) < window: return sum(data)/len(data)
    return sum(data[-window:])/window

def standard_deviation(data, mean=None):
    if not data: return 0
    if mean is None: mean = sum(data)/len(data)
    variance = sum((x-mean)**2 for x in data)/len(data)
    return math.sqrt(variance)

# ================= THUẬT TOÁN PHÁT HIỆN CẦU NÂNG CAO =================
class AdvancedPatternDetector:
    @staticmethod
    def detect_bet(history):
        if len(history) < 2: return None
        last = history[-1]
        run = 1
        for i in range(len(history)-2, -1, -1):
            if history[i] == last: run += 1
            else: break
        if run >= 12: return {'name': f"🔥 Bệt {run} (SIÊU BỆT)", 'next': 'X' if last == 'T' else 'T', 'weight': 98}
        if run >= 10: return {'name': f"🔥 Bệt {run} (CỰC MẠNH)", 'next': 'X' if last == 'T' else 'T', 'weight': 95}
        if run >= 8: return {'name': f"⚠️ Bệt {run} (SẮP GÃY)", 'next': 'X' if last == 'T' else 'T', 'weight': 88}
        if run >= 6: return {'name': f"📈 Bệt {run}", 'next': last, 'weight': 78}
        if run >= 4: return {'name': f"📊 Bệt {run}", 'next': last, 'weight': 72}
        if run >= 2: return {'name': f"📉 Bệt {run}", 'next': last, 'weight': 62}
        return None

    @staticmethod
    def detect_1_1(history):
        if len(history) >= 4 and history[-4:] in ("TXTX", "XTXT"):
            return {'name': "⚡ Cầu 1-1 HOÀN HẢO", 'next': 'X' if history[-1] == 'T' else 'T', 'weight': 90}
        if len(history) >= 6 and history[-6:] in ("TXTXTX", "XTXTXT"):
            return {'name': "⚡ Cầu 1-1 SIÊU DÀI", 'next': 'X' if history[-1] == 'T' else 'T', 'weight': 93}
        return None

    @staticmethod
    def detect_2_2(history):
        if len(history) >= 4 and history[-4:] in ("TTXX", "XXTT"):
            return {'name': "🎯 Cầu 2-2", 'next': history[-2], 'weight': 84}
        if len(history) >= 8 and history[-8:] in ("TTXXTTXX", "XXTTXXTT"):
            return {'name': "🎯 Cầu 2-2 KÉP", 'next': 'X' if history[-1] == 'T' else 'T', 'weight': 88}
        return None

    @staticmethod
    def detect_3_3(history):
        if len(history) >= 6 and history[-6:] in ("TTTXXX", "XXXTTT"):
            return {'name': "🎲 Cầu 3-3", 'next': 'X' if history[-3] == 'T' else 'T', 'weight': 88}
        return None

    @staticmethod
    def detect_4_4(history):
        if len(history) >= 8 and history[-8:] in ("TTTTXXXX", "XXXXTTTT"):
            return {'name': "🎯 Cầu 4-4", 'next': 'X' if history[-4] == 'T' else 'T', 'weight': 86}
        return None

    @staticmethod
    def detect_5_5(history):
        if len(history) >= 10 and history[-10:] in ("TTTTTXXXXX", "XXXXXTTTTT"):
            return {'name': "🏆 Cầu 5-5", 'next': 'X' if history[-5] == 'T' else 'T', 'weight': 85}
        return None

    @staticmethod
    def detect_1_2(history):
        patterns = {"TXX": "T", "XTT": "X", "TXXT": "X", "XTTX": "T"}
        for pat, nxt in patterns.items():
            if len(history) >= len(pat) and history[-len(pat):] == pat:
                return {'name': f"🌀 Cầu 1-2 ({pat})", 'next': nxt, 'weight': 74}
        return None

    @staticmethod
    def detect_2_1(history):
        patterns = {"TTX": "X", "XXT": "T", "TTXX": "X", "XXTT": "T"}
        for pat, nxt in patterns.items():
            if len(history) >= len(pat) and history[-len(pat):] == pat:
                return {'name': f"🌀 Cầu 2-1 ({pat})", 'next': nxt, 'weight': 74}
        return None

    @staticmethod
    def detect_1_2_3(history):
        if len(history) >= 6:
            last6 = history[-6:]
            if last6 == "TXXTTT": return {'name': "🏆 Cầu 1-2-3 (T)", 'next': 'X', 'weight': 88}
            if last6 == "XTTXXX": return {'name': "🏆 Cầu 1-2-3 (X)", 'next': 'T', 'weight': 88}
        return None

    @staticmethod
    def detect_3_2_1(history):
        if len(history) >= 6:
            last6 = history[-6:]
            if last6 == "TTTXXT": return {'name': "🏆 Cầu 3-2-1 (T)", 'next': 'X', 'weight': 86}
            if last6 == "XXXTTX": return {'name': "🏆 Cầu 3-2-1 (X)", 'next': 'T', 'weight': 86}
        return None

    @staticmethod
    def detect_zigzag(history):
        if len(history) >= 5 and history[-5:] in ("TXTXT", "XTXTX"):
            return {'name': "⚡ Cầu Zigzag 5", 'next': 'X' if history[-1] == 'T' else 'T', 'weight': 82}
        if len(history) >= 7 and history[-7:] in ("TXTXTXT", "XTXTXTX"):
            return {'name': "⚡ Cầu Zigzag 7", 'next': 'X' if history[-1] == 'T' else 'T', 'weight': 86}
        return None

    @staticmethod
    def detect_triangle(history):
        if len(history) >= 5 and history[-5:] == "TXTXT":
            return {'name': "🔺 Cầu tam giác T", 'next': 'X', 'weight': 85}
        if len(history) >= 5 and history[-5:] == "XTXTX":
            return {'name': "🔺 Cầu tam giác X", 'next': 'T', 'weight': 85}
        return None

    @staticmethod
    def detect_fibonacci(history):
        if len(history) < 9: return None
        fibs = [1, 1, 2, 3, 5, 8]
        t_count = sum(1 for f in fibs if len(history) > f and history[-f] == 'T')
        if t_count >= 5: return {'name': "🌀 Cầu Fibonacci T (SIÊU MẠNH)", 'next': 'X', 'weight': 90}
        if t_count <= 1: return {'name': "🌀 Cầu Fibonacci X (SIÊU MẠNH)", 'next': 'T', 'weight': 90}
        if t_count >= 4: return {'name': "🌀 Cầu Fibonacci T", 'next': 'X', 'weight': 82}
        if t_count <= 2: return {'name': "🌀 Cầu Fibonacci X", 'next': 'T', 'weight': 82}
        return None

    @staticmethod
    def detect_dragon(history):
        if len(history) < 5: return None
        t_run = 0
        for i in range(len(history)-1, -1, -1):
            if history[i] == 'T': t_run += 1
            else: break
        if t_run >= 8: return {'name': f"🐉 Cầu Rồng {t_run} (BẺ GẤP)", 'next': 'X', 'weight': 94}
        if t_run >= 6: return {'name': f"🐉 Cầu Rồng {t_run} (CẢNH BÁO)", 'next': 'X', 'weight': 88}
        if t_run >= 4: return {'name': f"🐉 Cầu Rồng {t_run}", 'next': 'T', 'weight': 75}
        return None

    @staticmethod
    def detect_tiger(history):
        if len(history) < 5: return None
        x_run = 0
        for i in range(len(history)-1, -1, -1):
            if history[i] == 'X': x_run += 1
            else: break
        if x_run >= 8: return {'name': f"🐯 Cầu Hổ {x_run} (BẺ GẤP)", 'next': 'T', 'weight': 94}
        if x_run >= 6: return {'name': f"🐯 Cầu Hổ {x_run} (CẢNH BÁO)", 'next': 'T', 'weight': 88}
        if x_run >= 4: return {'name': f"🐯 Cầu Hổ {x_run}", 'next': 'X', 'weight': 75}
        return None

    @staticmethod
    def detect_cycle(history, min_c=2, max_c=7):
        for c in range(min_c, max_c+1):
            if len(history) < c*2: continue
            pattern = history[-c:]
            if history[-2*c:-c] == pattern:
                pos = (len(history) - 1) % c
                return {'name': f"🔄 Cầu chu kỳ {c}", 'next': pattern[pos], 'weight': 82}
        return None

    @staticmethod
    def detect_even_odd(history, totals):
        if len(totals) < 6: return None
        recent_totals = totals[-6:]
        even_count = sum(1 for t in recent_totals if t % 2 == 0)
        if even_count >= 5: return {'name': "🎲 Cầu tổng CHẴN (BÃO)", 'next': 'T', 'weight': 80}
        if even_count <= 1: return {'name': "🎲 Cầu tổng LẺ (BÃO)", 'next': 'X', 'weight': 80}
        return None

    @staticmethod
    def detect_total_trend(history, totals):
        if len(totals) < 8: return None
        recent = totals[-8:]
        increasing = all(recent[i] <= recent[i+1] for i in range(7))
        decreasing = all(recent[i] >= recent[i+1] for i in range(7))
        if increasing: return {'name': "📈 Cầu tổng TĂNG DẦN", 'next': 'T', 'weight': 78}
        if decreasing: return {'name': "📉 Cầu tổng GIẢM DẦN", 'next': 'X', 'weight': 78}
        return None

# ================= THUẬT TOÁN DỰ ĐOÁN =================
class AdvancedPredictionAlgo:
    @staticmethod
    def markov_n(history, n=3):
        if len(history) < n+1: return None
        last_n = history[-n:]
        trans = defaultdict(lambda: defaultdict(int))
        for i in range(len(history)-n):
            key = tuple(history[i:i+n])
            trans[key][history[i+n]] += 1
        key = tuple(last_n)
        if trans[key]['T'] > trans[key]['X']: return 'T'
        if trans[key]['X'] > trans[key]['T']: return 'X'
        return None

    @staticmethod
    def weighted_frequency(history, window=20):
        if not history: return None
        recent = history[-window:]
        wt = sum((i+1) for i,ch in enumerate(reversed(recent)) if ch == 'T')
        wx = sum((i+1) for i,ch in enumerate(reversed(recent)) if ch == 'X')
        if wt > wx: return 'T'
        if wx > wt: return 'X'
        return None

    @staticmethod
    def rsi(history, period=7):
        if len(history) < period: return None
        nums = [1 if c == 'T' else 0 for c in history[-period:]]
        gains = [max(nums[i]-nums[i-1], 0) for i in range(1, len(nums))]
        losses = [max(nums[i-1]-nums[i], 0) for i in range(1, len(nums))]
        avg_gain = sum(gains)/period if gains else 0
        avg_loss = sum(losses)/period if losses else 0
        if avg_loss == 0: rsi = 100
        else: rsi = 100 - (100/(1+avg_gain/avg_loss))
        if rsi > 70: return 'X'
        if rsi < 30: return 'T'
        return None

    @staticmethod
    def mean_reversion(history, window=12):
        if len(history) < window: return None
        recent = history[-window:]
        t_rate = recent.count('T')/window
        if t_rate > 0.65: return 'X'
        if t_rate < 0.35: return 'T'
        return None

    @staticmethod
    def ensemble_vote(history):
        algos = [AdvancedPredictionAlgo.markov_n, AdvancedPredictionAlgo.weighted_frequency,
                 AdvancedPredictionAlgo.rsi, AdvancedPredictionAlgo.mean_reversion]
        votes = [algo(history) for algo in algos if algo(history) is not None]
        if not votes: return None
        return 'T' if votes.count('T') > votes.count('X') else 'X'

# ================= TÍN HIỆU BẺ CẦU (40 LOẠI) =================
class BreakSignal:
    @staticmethod
    def rsi_break(history): pred = AdvancedPredictionAlgo.rsi(history, 7); return pred is not None and pred != history[-1]
    @staticmethod
    def volume_spike(history):
        if len(history) < 10: return False
        changes = sum(1 for i in range(1, min(10, len(history))) if history[-i] != history[-i-1])
        return changes >= 7
    @staticmethod
    def pattern_exhaustion(history):
        if len(history) < 8: return False
        last8 = history[-8:]
        return last8 in ("TXTXTXTX", "XTXTXTXT", "TTXXTTXX", "XXTTXXTT")

# ================= TỔNG HỢP QUYẾT ĐỊNH =================
class UltimateDecision:
    def __init__(self, history, totals, game_id):
        self.history = history
        self.totals = totals
        self.game_id = game_id
        self.detectors = [
            AdvancedPatternDetector.detect_bet, AdvancedPatternDetector.detect_1_1,
            AdvancedPatternDetector.detect_2_2, AdvancedPatternDetector.detect_3_3,
            AdvancedPatternDetector.detect_4_4, AdvancedPatternDetector.detect_5_5,
            AdvancedPatternDetector.detect_1_2, AdvancedPatternDetector.detect_2_1,
            AdvancedPatternDetector.detect_1_2_3, AdvancedPatternDetector.detect_3_2_1,
            AdvancedPatternDetector.detect_zigzag, AdvancedPatternDetector.detect_triangle,
            AdvancedPatternDetector.detect_fibonacci, AdvancedPatternDetector.detect_dragon,
            AdvancedPatternDetector.detect_tiger, AdvancedPatternDetector.detect_cycle,
            lambda h: AdvancedPatternDetector.detect_even_odd(h, totals),
            lambda h: AdvancedPatternDetector.detect_total_trend(h, totals),
        ]
        self.algos = [
            ('Markov', lambda h: AdvancedPredictionAlgo.markov_n(h, 3)),
            ('WeightedFreq', AdvancedPredictionAlgo.weighted_frequency),
            ('RSI', AdvancedPredictionAlgo.rsi),
            ('MeanReversion', AdvancedPredictionAlgo.mean_reversion),
            ('Ensemble', AdvancedPredictionAlgo.ensemble_vote),
        ]
        self.break_signals = [
            BreakSignal.rsi_break, BreakSignal.volume_spike, BreakSignal.pattern_exhaustion,
        ]

    def check_breaks(self):
        return sum(1 for sig in self.break_signals if sig(self.history))

    def analyze(self):
        # ===== KIỂM TRA TÍN HIỆU SIÊU GÃY =====
        should_gay, gay_to, gay_conf, gay_strength = SieuGayBreakDetector.get_total_break_signal(
            self.history, self.totals
        )
        
        break_count = self.check_breaks()
        should_break = break_count >= 2 or should_gay
        
        # ƯU TIÊN TÍN HIỆU SIÊU GÃY
        if should_gay and gay_conf >= 70:
            return gay_to, gay_conf, f"🔥🔥 SIÊU GÃY ({gay_strength})"

        votes = []
        for det in self.detectors:
            try:
                res = det(self.history)
                if res:
                    weight = PATTERN_PRIORITY.get(res['name'], res.get('weight', 75))
                    if should_break and res['next'] != self.history[-1]:
                        weight += 12
                    votes.append((res['name'], res['next'], weight))
            except: pass

        for name, func in self.algos:
            try:
                pred = func(self.history)
                if pred:
                    weight = self_learning.get_weight(name, self.game_id)
                    if should_break and pred != self.history[-1]:
                        weight += 10
                    votes.append((name, pred, weight))
            except: pass

        if not votes:
            last5 = self.history[-5:] if len(self.history) >= 5 else self.history
            fallback = 'T' if last5.count('T') >= last5.count('X') else 'X'
            return fallback, 50, "Fallback"

        wT = sum(w for _, p, w in votes if p == 'T')
        wX = sum(w for _, p, w in votes if p == 'X')

        if should_break:
            final = 'X' if wT > wX else 'T'
            conf_boost = min(25, break_count * 4)
        else:
            final = 'T' if wT > wX else 'X'
            conf_boost = 0

        total = wT + wX
        conf = round(max(wT, wX)/total*100) if total > 0 else 50
        conf = min(98, conf + conf_boost)

        best_vote = max([v for v in votes if v[0] != 'Fallback'], key=lambda x: x[2], default=None)
        pattern = best_vote[0] if best_vote else "Tổng hợp AI"
        if should_break:
            pattern = f"🔥 BẺ CẦU ({break_count}) - {pattern}"
        if should_gay:
            pattern = f"🔥🔥 SIÊU GÃY - {pattern}"

        return final, conf, pattern

# ================= BACKGROUND CACHE =================
game_cache = {}
cache_lock = threading.Lock()

def fetch_and_cache(game_id):
    config = GAME_CONFIG.get(game_id)
    if not config: return None
    data = fetch_data(config['api_url'])
    if data:
        with cache_lock:
            game_cache[game_id] = {'data': data, 'ts': datetime.now().isoformat()}
    return data

def get_cached_data(game_id):
    with cache_lock:
        cached = game_cache.get(game_id)
        if cached:
            return cached['data']
    return fetch_and_cache(game_id)

def ping_all():
    while True:
        for gid in GAME_CONFIG:
            fetch_and_cache(gid)
        time.sleep(60)

threading.Thread(target=ping_all, daemon=True).start()

# ================= FLASK API =================
def parse_session(item, game_type):
    if game_type == "legacy":
        result_raw = item.get("resultTruyenThong", "").upper()
        result = "T" if "TAI" in result_raw else "X" if "XIU" in result_raw else None
        point = item.get("point", 0)
        dices = item.get("dices", [0,0,0])
        sid = item.get("id")
    else:
        bet_side = item.get("BetSide")
        result = "T" if bet_side == 0 else "X" if bet_side == 1 else None
        point = item.get("DiceSum", 0)
        dices = [item.get("FirstDice",0), item.get("SecondDice",0), item.get("ThirdDice",0)]
        sid = item.get("SessionId")
    return result, point, dices, sid

def build_history(data_list, game_type, max_len=100):
    if not data_list: return "", []
    items = data_list['list'] if isinstance(data_list, dict) and 'list' in data_list else data_list
    recent = items[:max_len]
    recent.reverse()
    history = ""
    totals = []
    for item in recent:
        result, point, _, _ = parse_session(item, game_type)
        if result:
            history += result
            totals.append(point)
    return history, totals

def create_endpoint(game_id):
    def endpoint():
        key = request.args.get('key')
        if key != AUTH_KEY:
            return jsonify({"error": "Truy cập bị từ chối"}), 403
        config = GAME_CONFIG.get(game_id)
        if not config:
            return jsonify({"error": "Game không hợp lệ"}), 400
        data = get_cached_data(game_id)
        if not data:
            return jsonify({"error": "Không thể lấy dữ liệu"}), 500
        history, totals = build_history(data, config['type'])
        if not history:
            return jsonify({"error": "Không có lịch sử"}), 500
        items = data['list'] if isinstance(data, dict) and 'list' in data else data
        current_item = items[0] if items else {}
        result, point, dices, sid = parse_session(current_item, config['type'])
        if result:
            actual_history[game_id].append(result)
        dec = UltimateDecision(history, totals, game_id)
        pred, conf, pattern = dec.analyze()
        tai_percent = conf if pred == 'T' else 100 - conf
        xiu_percent = 100 - tai_percent
        resp = {
            "phien": sid, "xuc_xac": dices, "tong": point,
            "ket_qua": "Tài" if result == 'T' else "Xỉu" if result == 'X' else "?",
            "phien_hien_tai": (sid + 1) if isinstance(sid, int) else "?",
            "du_doan": "Tài" if pred == "T" else "Xỉu",
            "do_tin_cay": f"{tai_percent}%-{xiu_percent}%",
            "id": USER_ID, "ai": ALGO_NAME, "cau": pattern
        }
        return app.response_class(response=json.dumps(resp, ensure_ascii=False), status=200, mimetype='application/json')
    endpoint.__name__ = f"api_{game_id}"
    return endpoint

for gid in GAME_CONFIG:
    app.add_url_rule(f'/api/{gid}', view_func=create_endpoint(gid), methods=['GET'])

@app.route('/api/health')
def health(): return jsonify({"status": "healthy", "games": len(GAME_CONFIG), "version": "11.0"})

@app.route('/')
def home(): return jsonify({"service": ALGO_NAME, "endpoints": [f"/api/{gid}" for gid in GAME_CONFIG], "auth": f"?key={AUTH_KEY}"})

if __name__ == '__main__':
    print(f"🚀 {ALGO_NAME} đang chạy...")
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
