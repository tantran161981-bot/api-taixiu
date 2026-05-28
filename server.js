const express = require('express');
const axios = require('axios');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();
const app = express();

// Cấu hình CORS
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Config tất cả các API endpoints
const API_CONFIGS = {
  // BetVIP
  'betvip-hu': {
    path: '/api/betvip-hu',
    target: 'https://toolgamephuxuan.site/betvip-hu.php'
  },
  'betvip-md5': {
    path: '/api/betvip-md5',
    target: 'https://toolgamephuxuan.site/betvip-md5.php'
  },
  
  // Sun
  'sun': {
    path: '/api/sun',
    target: 'https://toolgamephuxuan.site/sun.php'
  },
  'sun-sicbo': {
    path: '/api/sun-sicbo',
    target: 'https://toolgamephuxuan.site/sun-sicbo.php'
  },
  
  // LC79
  'lc79-hu': {
    path: '/api/lc79-hu',
    target: 'https://toolgamephuxuan.site/lc79-hu.php'
  },
  'lc79-md5': {
    path: '/api/lc79-md5',
    target: 'https://toolgamephuxuan.site/lc79-md5.php'
  },
  
  // 79 Club
  '789': {
    path: '/api/789',
    target: 'https://toolgamephuxuan.site/789.php'
  },
  
  // XocDia88
  'xocdia88-hu': {
    path: '/api/xocdia88-hu',
    target: 'https://toolgamephuxuan.site/xocdia88-hu.php'
  },
  'xocdia88-md5': {
    path: '/api/xocdia88-md5',
    target: 'https://toolgamephuxuan.site/xocdia88-md5.php'
  },
  
  // 68GB
  '68': {
    path: '/api/68',
    target: 'https://toolgamephuxuan.site/68.php'
  }
};

// Hàm tạo headers proxy
function createProxyHeaders(req) {
  // User-Agent ngẫu nhiên để tránh bị chặn
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/120.0'
  ];
  
  const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
  
  const headers = {
    'Host': 'toolgamephuxuan.site',
    'Origin': 'https://toolgamephuxuan.site',
    'Referer': 'https://toolgamephuxuan.site/',
    'User-Agent': req.headers['user-agent'] || randomUserAgent,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  };

  // Thêm các headers đặc biệt để tránh bị chặn
  headers['X-Requested-With'] = 'XMLHttpRequest';
  headers['DNT'] = '1';
  
  // Thêm cookie nếu có
  if (req.headers.cookie) {
    headers['Cookie'] = req.headers.cookie;
  }

  return headers;
}

// Hàm xử lý proxy chung
async function handleProxyRequest(req, res, apiConfig) {
  try {
    const { target } = apiConfig;
    
    // Lấy tất cả query parameters
    const params = { ...req.query };
    
    // Tạo headers
    const headers = createProxyHeaders(req);
    
    console.log(`Proxying to: ${target}`);
    console.log(`Params:`, params);

    // Gọi API
    const response = await axios.get(target, {
      params: params,
      headers: headers,
      timeout: parseInt(process.env.API_TIMEOUT) || 30000,
      validateStatus: null // Không throw error với status code lỗi
    });

    // Trả về response
    res.status(response.status).json(response.data);
    
  } catch (error) {
    handleAxiosError(error, res, apiConfig.target);
  }
}

// Hàm xử lý lỗi
function handleAxiosError(error, res, apiName) {
  console.error(`[${apiName}] Proxy error:`, error.message);
  
  if (error.response) {
    res.status(error.response.status).json({
      error: true,
      api: apiName,
      message: error.response.data?.message || 'API Error',
      status: error.response.status,
      data: error.response.data
    });
  } else if (error.request) {
    res.status(504).json({
      error: true,
      api: apiName,
      message: 'Gateway Timeout - No response from target API',
      code: 'PROXY_TIMEOUT'
    });
  } else {
    res.status(500).json({
      error: true,
      api: apiName,
      message: error.message,
      code: 'PROXY_ERROR'
    });
  }
}

// Tạo routes từ config
Object.values(API_CONFIGS).forEach(config => {
  // GET requests
  app.get(config.path, (req, res) => {
    handleProxyRequest(req, res, config);
  });
  
  // POST requests
  app.post(config.path, async (req, res) => {
    try {
      const { target } = config;
      
      const headers = createProxyHeaders(req);
      headers['Content-Type'] = req.headers['content-type'] || 'application/x-www-form-urlencoded';
      
      // Kết hợp params từ query string
      const params = { ...req.query };
      
      // Đối với POST, thường gửi dữ liệu dạng form-urlencoded
      let data = req.body;
      if (headers['Content-Type'] === 'application/x-www-form-urlencoded' && typeof data === 'object') {
        data = new URLSearchParams(data).toString();
      }
      
      const response = await axios.post(target, data, {
        params: params,
        headers: headers,
        timeout: parseInt(process.env.API_TIMEOUT) || 30000,
        validateStatus: null
      });

      res.status(response.status).json(response.data);
      
    } catch (error) {
      handleAxiosError(error, res, target);
    }
  });
});

// Dynamic endpoint cho tất cả API
app.get('/api/:type', (req, res) => {
  const { type } = req.params;
  
  const config = API_CONFIGS[type];
  
  if (!config) {
    return res.status(404).json({
      error: true,
      message: 'API type not found',
      availableTypes: Object.keys(API_CONFIGS)
    });
  }
  
  handleProxyRequest(req, res, config);
});

// Route test tất cả endpoints
app.get('/api/test-all', async (req, res) => {
  const results = {};
  
  for (const [key, config] of Object.entries(API_CONFIGS)) {
    try {
      const testResponse = await axios.get(config.target, {
        params: { test: 'ping' },
        headers: createProxyHeaders(req),
        timeout: 5000,
        validateStatus: null
      });
      
      results[key] = {
        status: testResponse.status,
        success: testResponse.status === 200,
        endpoint: config.path,
        target: config.target
      };
    } catch (error) {
      results[key] = {
        status: error.response?.status || 'ERROR',
        success: false,
        endpoint: config.path,
        target: config.target,
        error: error.message
      };
    }
  }
  
  res.json({
    timestamp: new Date().toISOString(),
    results: results,
    summary: {
      total: Object.keys(results).length,
      success: Object.values(results).filter(r => r.success).length,
      failed: Object.values(results).filter(r => !r.success).length
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    totalApis: Object.keys(API_CONFIGS).length
  });
});

// Route chính - hiển thị endpoints
app.get('/', (req, res) => {
  const endpoints = Object.entries(API_CONFIGS).map(([key, config]) => ({
    name: key,
    path: config.path,
    target: config.target
  }));
  
  res.json({
    name: 'ToolGamePhuXuan Proxy Server',
    version: '1.0.0',
    totalApis: endpoints.length,
    endpoints: endpoints,
    usage: {
      test_all: '/api/test-all',
      health: '/health',
      dynamic: '/api/{type}'
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: true,
    message: 'Route not found',
    totalEndpoints: Object.keys(API_CONFIGS).length,
    availableRoutes: [
      ...Object.values(API_CONFIGS).map(config => config.path),
      '/api/:type',
      '/api/test-all',
      '/health',
      '/'
    ]
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error:', err);
  res.status(500).json({
    error: true,
    message: 'Internal server error'
  });
});

// Khởi động server
const PORT = process.env.PORT || 3002;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`🚀 ToolGamePhuXuan Proxy Server running on http://${HOST}:${PORT}`);
  console.log(`\n📡 Available Endpoints (${Object.keys(API_CONFIGS).length} APIs):`);
  
  // Hiển thị theo nhóm cho dễ đọc
  const groups = {
    'BetVIP': ['betvip-hu', 'betvip-md5'],
    'Sun': ['sun', 'sun-sicbo'],
    'LC79': ['lc79-hu', 'lc79-md5'],
    '79 Club': ['789'],
    'XocDia88': ['xocdia88-hu', 'xocdia88-md5'],
    '68GB': ['68']
  };
  
  Object.entries(groups).forEach(([groupName, apis]) => {
    console.log(`\n   ${groupName}:`);
    apis.forEach(apiName => {
      if (API_CONFIGS[apiName]) {
        console.log(`     ${API_CONFIGS[apiName].path} -> ${API_CONFIGS[apiName].target}`);
      }
    });
  });
  
  console.log(`\n🏥 Health check: http://${HOST}:${PORT}/health`);
  console.log(`🔧 Test all APIs: http://${HOST}:${PORT}/api/test-all`);
  console.log(`🔗 Dynamic endpoint: http://${HOST}:${PORT}/api/{type}`);
  console.log(`\n📊 Total APIs: ${Object.keys(API_CONFIGS).length}`);
});