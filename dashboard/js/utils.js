/**
 * Shared utilities for the dashboard.
 */

const Utils = {
  formatCurrency(value) {
    if (value == null) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value);
  },

  formatDate(value) {
    if (!value) return '—';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value; // already YYYY-MM-DD
    // "Month-D-YYYY" → replace hyphens with spaces so Date can parse it
    const normalized = /^[A-Za-z]/.test(value) ? value.replace(/-/g, ' ') : value;
    const d = new Date(normalized);
    if (isNaN(d)) return value; // unparseable — return raw
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  formatNumber(value, decimals = 0) {
    if (value == null) return '—';
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: decimals,
    }).format(value);
  },

  median(arr) {
    const nums = arr.filter(v => v != null && !isNaN(v)).sort((a, b) => a - b);
    if (nums.length === 0) return null;
    const mid = Math.floor(nums.length / 2);
    return nums.length % 2 !== 0 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
  },

  /**
   * Ray-casting point-in-polygon test.
   * polygon: array of [lat, lng] pairs (closed or unclosed).
   */
  pointInPolygon(lat, lng, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const yi = polygon[i][0], xi = polygon[i][1];
      const yj = polygon[j][0], xj = polygon[j][1];
      if (((yi > lat) !== (yj > lat)) &&
          (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  },

  filterByArea(homes, areaConfig) {
    // Spatial filtering via polygon (preferred)
    if (areaConfig.polygon && areaConfig.polygon.length >= 3) {
      return homes.filter(h =>
        h.latitude != null && h.longitude != null &&
        this.pointInPolygon(h.latitude, h.longitude, areaConfig.polygon)
      );
    }
    if (areaConfig.type === 'city') {
      return homes.filter(h =>
        h.city && h.city.toLowerCase() === areaConfig.name.toLowerCase()
      );
    }
    if (areaConfig.type === 'neighborhood') {
      const nbNames = (areaConfig.neighborhoods || []).map(n => n.toLowerCase());
      return homes.filter(h =>
        h.neighborhood && nbNames.some(nb => h.neighborhood.toLowerCase().includes(nb))
      );
    }
    return [];
  },

  colors: [
    '#2563eb', '#dc2626', '#16a34a', '#9333ea',
    '#ea580c', '#0891b2', '#be185d', '#4f46e5',
  ],

  colorFor(index) {
    return this.colors[index % this.colors.length];
  },

  baselineColor: '#6b7280',

  // --- Trend line computations ---

  TREND_TYPES: ['off', 'linear', 'ma-3', 'ma-6', 'ma-12'],
  TREND_LABELS: { off: 'Off', linear: 'Linear', 'ma-3': 'MA (3)', 'ma-6': 'MA (6)', 'ma-12': 'MA (12)' },

  linearRegression(xs, ys) {
    const nums = [];
    for (let i = 0; i < xs.length; i++) {
      const y = ys[i];
      if (y == null || isNaN(y)) continue;
      const x = typeof xs[i] === 'string' ? new Date(xs[i]).getTime() : xs[i];
      if (isNaN(x)) continue;
      nums.push({ x, y });
    }
    if (nums.length < 2) return null;

    const n = nums.length;
    const sumX = nums.reduce((s, p) => s + p.x, 0);
    const sumY = nums.reduce((s, p) => s + p.y, 0);
    const sumXY = nums.reduce((s, p) => s + p.x * p.y, 0);
    const sumX2 = nums.reduce((s, p) => s + p.x * p.x, 0);

    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return null;

    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    return { slope, intercept, predict(x) { return slope * x + intercept; } };
  },

  movingAverage(xs, ys, window) {
    const outX = [], outY = [];
    for (let i = 0; i < ys.length; i++) {
      const start = Math.max(0, i - window + 1);
      let sum = 0, count = 0;
      for (let j = start; j <= i; j++) {
        if (ys[j] != null && !isNaN(ys[j])) { sum += ys[j]; count++; }
      }
      if (count > 0) { outX.push(xs[i]); outY.push(sum / count); }
    }
    return { x: outX, y: outY };
  },

  /**
   * Build trend line traces for a given dataset.
   * trendType: 'off' | 'linear' | 'ma-3' | 'ma-6'
   * Returns an array of Plotly traces (0 or 1).
   */
  buildTrendTraces(xVals, yVals, trendType, color) {
    if (trendType === 'off' || !trendType) return [];

    if (trendType === 'linear') {
      const reg = this.linearRegression(xVals, yVals);
      if (!reg) return [];
      const isDate = typeof xVals[0] === 'string';
      const x0 = xVals[0], x1 = xVals[xVals.length - 1];
      const t0 = isDate ? new Date(x0).getTime() : x0;
      const t1 = isDate ? new Date(x1).getTime() : x1;
      return [{
        x: [x0, x1],
        y: [reg.predict(t0), reg.predict(t1)],
        mode: 'lines',
        line: { color, dash: 'dot', width: 2 },
        showlegend: false,
        hoverinfo: 'skip',
      }];
    }

    const window = trendType === 'ma-12' ? 12 : trendType === 'ma-6' ? 6 : 3;
    const ma = this.movingAverage(xVals, yVals, window);
    if (ma.x.length < 2) return [];
    return [{
      x: ma.x,
      y: ma.y,
      mode: 'lines',
      line: { color, dash: 'dash', width: 2 },
      showlegend: false,
      hoverinfo: 'skip',
    }];
  },

  /**
   * Resolve the effective trend type for a chart.
   * chartOverride: per-chart setting ('global' means use globalType).
   */
  resolveTrend(globalType, chartOverride) {
    if (!chartOverride || chartOverride === 'global') return globalType;
    return chartOverride;
  },

  _plotlyDefaults: {
    font: { family: 'Inter, system-ui, sans-serif', size: 12 },
    paper_bgcolor: 'transparent',
    plot_bgcolor: '#f9fafb',
    margin: { t: 10, r: 20, b: 60, l: 60 },
    hovermode: 'x unified',
    legend: { orientation: 'h', y: -0.2, x: 0.5, xanchor: 'center' },
    xaxis: { gridcolor: '#e5e7eb', tickangle: -45, dtick: 'M12', tickformat: '%-m/%Y' },
    yaxis: { gridcolor: '#e5e7eb' },
  },

  get plotlyDefaults() {
    return JSON.parse(JSON.stringify(this._plotlyDefaults));
  },
};

// --- Preferences persistence via localStorage ---

const Prefs = {
  _key: 'housing-dashboard',

  _cache: null,

  _defaults: {
    activeTab: 'market-pulse',
    mp: {
      globalTrend: 'off',
      chartTrends: {},
      activeAreas: null, // null = all active
    },
    ac: {
      globalTrend: 'off',
      chartTrends: {},
    },
    pe: {
      area: 'all',
      beds: '',
      baths: '',
      sqftMin: '',
      sqftMax: '',
      priceMax: '',
      type: '',
    },
  },

  _load() {
    if (this._cache) return this._cache;
    try {
      const raw = localStorage.getItem(this._key);
      this._cache = raw ? JSON.parse(raw) : {};
    } catch {
      this._cache = {};
    }
    return this._cache;
  },

  get(path, fallback) {
    const parts = path.split('.');
    let obj = this._load();
    for (const p of parts) {
      if (obj == null || typeof obj !== 'object') return fallback;
      obj = obj[p];
    }
    return obj !== undefined ? obj : fallback;
  },

  set(path, value) {
    const data = this._load();
    const parts = path.split('.');
    let obj = data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (obj[parts[i]] == null || typeof obj[parts[i]] !== 'object') {
        obj[parts[i]] = {};
      }
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
    try { localStorage.setItem(this._key, JSON.stringify(data)); } catch {}
  },
};
