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
    const d = JSON.parse(JSON.stringify(this._plotlyDefaults));
    if (window.innerWidth <= 480) {
      d.margin = { t: 8, r: 10, b: 45, l: 40 };
      d.font.size = 10;
      d.legend.font = { size: 9 };
    } else if (window.innerWidth <= 768) {
      d.margin = { t: 8, r: 15, b: 50, l: 50 };
      d.font.size = 11;
    }
    return d;
  },
};

// --- Shared map utilities ---

const MapUtils = {
  TILE_URL: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  TILE_ATTR: '&copy; OpenStreetMap contributors',

  PHOTO_BTN_HTML: '<td class="photo-preview-cell"><button class="photo-preview-btn" aria-label="Preview photos" onclick="event.stopPropagation()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></button></td>',

  _geojsonPromise: null,
  _geojsonCache: null,

  loadGeoJSON(url) {
    url = url || '../data/zcta_boundaries.geojson';
    if (this._geojsonCache) return Promise.resolve(this._geojsonCache);
    if (!this._geojsonPromise) {
      this._geojsonPromise = fetch(url)
        .then(r => r.json())
        .then(data => { this._geojsonCache = data; return data; });
    }
    return this._geojsonPromise;
  },

  createMap(elementId, dataPoints, defaultCenter, defaultZoom) {
    const pts = (dataPoints || []).filter(h => h.latitude != null && h.longitude != null);
    let center = defaultCenter || [36.07, -79.79];
    if (pts.length > 0) {
      center = [
        pts.reduce((s, h) => s + h.latitude, 0) / pts.length,
        pts.reduce((s, h) => s + h.longitude, 0) / pts.length,
      ];
    }
    const map = L.map(elementId).setView(center, defaultZoom || 11);
    L.tileLayer(this.TILE_URL, { attribution: this.TILE_ATTR, maxZoom: 19 }).addTo(map);
    return map;
  },

  createDrawControl(drawnItems) {
    return new L.Control.Draw({
      draw: {
        polygon: { allowIntersection: false, shapeOptions: { color: '#2563eb', weight: 2, fillOpacity: 0.1 } },
        polyline: false,
        rectangle: { shapeOptions: { color: '#2563eb', weight: 2, fillOpacity: 0.1 } },
        circle: false, circlemarker: false, marker: false,
      },
      edit: { featureGroup: drawnItems, remove: true },
    });
  },

  bindDrawEvents(map, drawnItems, callbacks) {
    map.on(L.Draw.Event.CREATED, (e) => {
      drawnItems.clearLayers();
      drawnItems.addLayer(e.layer);
      const polygon = e.layer.getLatLngs()[0].map(ll => [ll.lat, ll.lng]);
      callbacks.onCreated(polygon);
    });
    map.on(L.Draw.Event.DELETED, () => callbacks.onDeleted());
    map.on(L.Draw.Event.EDITED, () => {
      const layers = drawnItems.getLayers();
      if (layers.length > 0) {
        const polygon = layers[0].getLatLngs()[0].map(ll => [ll.lat, ll.lng]);
        callbacks.onEdited(polygon);
      }
    });
  },

  enableDraw(map, drawControl) {
    if (!map.hasLayer(drawControl)) map.addControl(drawControl);
  },

  disableDraw(map, drawControl, drawnItems) {
    if (drawControl._map) map.removeControl(drawControl);
    drawnItems.clearLayers();
  },

  showAreaPolygons(map, layer, areaNames, focusAreas, filteredItems) {
    layer.clearLayers();
    if (!areaNames.length) return;

    areaNames.forEach(name => {
      const fa = focusAreas.find(a => a.name === name);
      if (fa && fa.polygon && fa.polygon.length >= 3) {
        layer.addLayer(L.polygon(fa.polygon, {
          color: '#2563eb', weight: 2, fillOpacity: 0.08, dashArray: '6 4', interactive: false,
        }));
      }
    });

    if (layer.getLayers().length > 0) {
      map.fitBounds(layer.getBounds(), { padding: [40, 40] });
    } else if (filteredItems) {
      const pts = filteredItems.filter(h => h.latitude != null && h.longitude != null);
      if (pts.length < 2) return;
      const lats = pts.map(h => h.latitude);
      const lngs = pts.map(h => h.longitude);
      const pad = 0.005;
      const rect = L.rectangle([
        [Math.min(...lats) - pad, Math.min(...lngs) - pad],
        [Math.max(...lats) + pad, Math.max(...lngs) + pad],
      ], { color: '#2563eb', weight: 2, fillOpacity: 0.08, dashArray: '6 4', interactive: false });
      layer.addLayer(rect);
      map.fitBounds(rect.getBounds(), { padding: [40, 40] });
    }
  },

  // --- Linked map-table interaction ---

  renderMarkers(opts) {
    const { layer, data, rowSelector, colorFn, showPhoto, hidePhoto } = opts;
    layer.clearLayers();
    const byAddr = {};
    data.forEach(h => {
      if (h.latitude == null || h.longitude == null) return;
      const fillColor = colorFn ? colorFn(h) : '#2563eb';
      const strokeColor = colorFn ? fillColor : '#1d4ed8';
      const marker = L.circleMarker([h.latitude, h.longitude], {
        radius: 5, fillColor, color: strokeColor, weight: 1, fillOpacity: 0.6,
      });
      marker.on('mouseover', (e) => {
        marker.setRadius(9); marker.setStyle({ fillOpacity: 0.95 }); marker.bringToFront();
        if (rowSelector) {
          const row = Array.from(document.querySelectorAll(rowSelector))
            .find(r => r.dataset.addr === h.address);
          if (row) row.classList.add('row-map-highlight');
        }
        const me = e.originalEvent;
        if (me) showPhoto(h, me.clientX, me.clientY);
      });
      marker.on('mouseout', () => {
        marker.setRadius(5); marker.setStyle({ fillOpacity: 0.6 });
        if (rowSelector) {
          const row = Array.from(document.querySelectorAll(rowSelector))
            .find(r => r.dataset.addr === h.address);
          if (row) row.classList.remove('row-map-highlight');
        }
        hidePhoto();
      });
      if (h.address) byAddr[h.address] = marker;
      layer.addLayer(marker);
    });
    return byAddr;
  },

  bindTableMarkerHovers(opts) {
    const { rows, items, markersByAddr, showPhoto, hidePhoto, onRowClick, defaultOpacity } = opts;
    const rowEls = typeof rows === 'string' ? document.querySelectorAll(rows) : rows;
    const restoreOpacity = defaultOpacity || 0.6;
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    rowEls.forEach((tr, i) => {
      const addr = tr.dataset.addr;
      const item = addr ? items.find(h => h.address === addr) : items[i];
      if (!item) return;
      if (isTouch) {
        // On touch devices, use the camera button for photo preview
        // instead of hover (mouseenter/mouseleave interfere with tap)
        tr.addEventListener('mouseenter', () => {
          const m = markersByAddr[item.address];
          if (m) { m.setRadius(9); m.setStyle({ fillOpacity: 0.95 }); m.bringToFront(); }
        });
        tr.addEventListener('mouseleave', () => {
          const m = markersByAddr[item.address];
          if (m) { m.setRadius(5); m.setStyle({ fillOpacity: restoreOpacity }); }
        });
        const btn = tr.querySelector('.photo-preview-btn');
        if (btn) {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            hidePhoto();
            document.querySelectorAll('.photo-preview-btn.active').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const rect = btn.getBoundingClientRect();
            showPhoto(item, rect.left, rect.top);
          });
        }
      } else {
        tr.addEventListener('mouseenter', (e) => {
          const m = markersByAddr[item.address];
          if (m) { m.setRadius(9); m.setStyle({ fillOpacity: 0.95 }); m.bringToFront(); }
          showPhoto(item, e.clientX, e.clientY);
        });
        tr.addEventListener('mouseleave', () => {
          const m = markersByAddr[item.address];
          if (m) { m.setRadius(5); m.setStyle({ fillOpacity: restoreOpacity }); }
          hidePhoto();
        });
      }
      if (onRowClick) {
        tr.addEventListener('click', () => onRowClick(item));
      }
    });
  },

  sortData(data, col, asc) {
    data.sort((a, b) => {
      const va = a[col], vb = b[col];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return asc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });
  },

  renderHeaders(headers, sortCol, sortAsc) {
    const sortIcon = (col) => sortCol === col ? (sortAsc ? ' ▲' : ' ▼') : '';
    return headers.map(h =>
      h.sortable === false
        ? `<th>${h.label}</th>`
        : `<th class="sortable" data-col="${h.col}">${h.label}${sortIcon(h.col)}</th>`
    ).join('');
  },

  bindSortHeaders(selector, sortState, defaultAscCols, onSort) {
    document.querySelectorAll(selector).forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (sortState.col === col) {
          sortState.asc = !sortState.asc;
        } else {
          sortState.col = col;
          sortState.asc = defaultAscCols.includes(col);
        }
        onSort();
      });
    });
  },

  applyAreaFilter(items, areas, customPolygon, focusAreas) {
    if (areas.includes('custom') && customPolygon) {
      return Utils.filterByArea(items, { polygon: customPolygon });
    }
    if (areas.length > 0 && !areas.includes('custom')) {
      const matched = new Set();
      areas.forEach(areaName => {
        const areaConfig = focusAreas.find(fa => fa.name === areaName);
        if (areaConfig) Utils.filterByArea(items, areaConfig).forEach(h => matched.add(h));
      });
      return items.filter(h => matched.has(h));
    }
    return items;
  },

  applyCommonFilters(items, f, priceField) {
    let r = items;
    if (f.bedsMin) r = r.filter(h => h.beds != null && h.beds >= Number(f.bedsMin));
    if (f.bedsMax) r = r.filter(h => h.beds != null && h.beds <= Number(f.bedsMax));
    if (f.bathsMin) r = r.filter(h => h.baths != null && h.baths >= Number(f.bathsMin));
    if (f.bathsMax) r = r.filter(h => h.baths != null && h.baths <= Number(f.bathsMax));
    if (f.sqftMin) r = r.filter(h => h.sqft && h.sqft >= Number(f.sqftMin));
    if (f.sqftMax) r = r.filter(h => h.sqft && h.sqft <= Number(f.sqftMax));
    if (f.priceMin) r = r.filter(h => h[priceField] && h[priceField] >= Number(f.priceMin));
    if (f.priceMax) r = r.filter(h => h[priceField] && h[priceField] <= Number(f.priceMax));
    if (f.hoa === 'none') r = r.filter(h => !h.hoa_monthly);
    if (f.hoa === 'has') r = r.filter(h => h.hoa_monthly && h.hoa_monthly > 0);
    if (f.yearMin) r = r.filter(h => h.year_built != null && h.year_built >= Number(f.yearMin));
    if (f.yearMax) r = r.filter(h => h.year_built != null && h.year_built <= Number(f.yearMax));
    if (f.type) r = r.filter(h => h.property_type === f.type);
    return r;
  },

  createCompMap(mapElId, subject, comps, opts) {
    const mapEl = document.getElementById(mapElId);
    if (!mapEl) return null;

    const compPts = comps.filter(c => c.latitude != null && c.longitude != null);
    const hasSubject = subject.latitude != null && subject.longitude != null;

    if (!hasSubject && compPts.length === 0) {
      mapEl.style.display = 'none';
      return null;
    }

    const map = L.map(mapEl, { zoomControl: true, scrollWheelZoom: false });
    L.tileLayer(this.TILE_URL, { attribution: this.TILE_ATTR, maxZoom: 19 }).addTo(map);

    const markersByAddr = {};

    compPts.forEach(c => {
      const m = L.circleMarker([c.latitude, c.longitude], {
        radius: 5, fillColor: '#2563eb', color: '#1d4ed8', weight: 1, fillOpacity: 0.7,
      }).addTo(map);
      if (opts && opts.onCompHover) {
        m.on('mouseover', (e) => {
          m.setRadius(8); m.setStyle({ fillOpacity: 0.95 }); m.bringToFront();
          opts.onCompHover(c, e, true);
        });
        m.on('mouseout', (e) => {
          m.setRadius(5); m.setStyle({ fillOpacity: 0.7 });
          opts.onCompHover(c, e, false);
        });
      }
      if (c.address) markersByAddr[c.address] = m;
    });

    if (hasSubject) {
      const tooltipLabel = opts && opts.subjectLabel || 'subject';
      L.circleMarker([subject.latitude, subject.longitude], {
        radius: 8, fillColor: '#ef4444', color: '#dc2626', weight: 2, fillOpacity: 0.9,
      }).bindTooltip(`${subject.address || ''} (${tooltipLabel})`, { permanent: false }).addTo(map);
    }

    const allPts = [
      ...(hasSubject ? [[subject.latitude, subject.longitude]] : []),
      ...compPts.map(c => [c.latitude, c.longitude]),
    ];
    if (allPts.length === 1) map.setView(allPts[0], 14);
    else map.fitBounds(L.latLngBounds(allPts), { padding: [24, 24] });

    return { map, markersByAddr };
  },

  createPhotoTooltip() {
    const el = document.createElement('div');
    el.className = 'photo-tooltip';
    el.innerHTML = `<button class="photo-tooltip-close" aria-label="Close preview">&times;</button>
      <div class="photo-tooltip-carousel-wrap">
        <img class="photo-tooltip-img" src="" alt="">
        <span class="photo-tooltip-cycle-counter"></span>
      </div>
      <div class="photo-tooltip-body">
        <div class="photo-tooltip-address"></div>
        <div class="photo-tooltip-price"></div>
        <div class="photo-tooltip-specs"></div>
        <div class="photo-tooltip-location"></div>
      </div>`;
    el.style.display = 'none';
    el.querySelector('.photo-tooltip-close').addEventListener('click', (e) => {
      e.stopPropagation();
      clearInterval(el._cycleTimer);
      el._cycleTimer = null;
      el.style.display = 'none';
      document.querySelectorAll('.photo-preview-btn.active').forEach(b => b.classList.remove('active'));
    });
    document.body.appendChild(el);
    return el;
  },

  showPhoto(tooltip, timeoutRef, home, x, y, priceField) {
    clearTimeout(timeoutRef.id);
    const photos = home.photo_urls && home.photo_urls.length
      ? home.photo_urls
      : (home.photo_url ? [home.photo_url] : []);
    if (!photos.length) return;
    timeoutRef.id = setTimeout(() => {
      const img = tooltip.querySelector('.photo-tooltip-img');
      const counter = tooltip.querySelector('.photo-tooltip-cycle-counter');
      img.src = photos[0];

      // Preload all photos upfront (tooltips have short display windows)
      photos.forEach(url => { const i = new Image(); i.src = url; });

      // Auto-cycle through photos if multiple
      clearInterval(tooltip._cycleTimer);
      if (photos.length > 1) {
        let idx = 0;
        counter.textContent = `1 / ${photos.length}`;
        counter.style.display = '';
        tooltip._cycleTimer = setInterval(() => {
          idx = (idx + 1) % photos.length;
          img.src = photos[idx];
          counter.textContent = `${idx + 1} / ${photos.length}`;
        }, 2200);
      } else {
        counter.style.display = 'none';
        tooltip._cycleTimer = null;
      }

      tooltip.querySelector('.photo-tooltip-address').textContent = home.address || '';
      tooltip.querySelector('.photo-tooltip-price').textContent = Utils.formatCurrency(home[priceField || 'sale_price'] || home.sale_price || home.list_price);
      const specs = [
        home.beds != null ? `${home.beds}bd` : null,
        home.baths != null ? `${home.baths}ba` : null,
        home.sqft ? `${Utils.formatNumber(home.sqft)} sqft` : null,
      ].filter(Boolean).join(' · ');
      tooltip.querySelector('.photo-tooltip-specs').textContent = specs;
      tooltip.querySelector('.photo-tooltip-location').textContent =
        [home.neighborhood, home.city, home.zip_code].filter(Boolean).join(' ');
      const tw = Math.min(340, window.innerWidth * 0.85);
      const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      if (isTouch) {
        tooltip.style.left = ((window.innerWidth - tw) / 2) + 'px';
        tooltip.style.top = Math.max(10, window.innerHeight * 0.1) + 'px';
        tooltip.style.width = tw + 'px';
      } else {
        const th = 300;
        let left = x + 16, top = y - th / 2;
        if (left + tw > window.innerWidth - 10) left = x - tw - 16;
        if (left < 5) left = 5;
        if (top < 10) top = 10;
        if (top + th > window.innerHeight - 10) top = window.innerHeight - th - 10;
        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
      }
      tooltip.style.display = 'block';
    }, 300);
  },

  hidePhoto(tooltip, timeoutRef) {
    clearTimeout(timeoutRef.id);
    if (tooltip) {
      clearInterval(tooltip._cycleTimer);
      tooltip._cycleTimer = null;
      tooltip.style.display = 'none';
    }
  },

  /**
   * Returns HTML for the comp-subject photo area.
   * Single photo → bare <img>. Multiple photos → carousel wrapper.
   */
  compSubjectCarouselHTML(home) {
    const photos = home.photo_urls && home.photo_urls.length
      ? home.photo_urls
      : (home.photo_url ? [home.photo_url] : []);
    if (!photos.length) return '';
    const src = photos[0].replace(/"/g, '&quot;');
    const alt = (home.address || '').replace(/"/g, '&quot;');
    if (photos.length === 1) {
      return `<img class="comp-subject-photo" src="${src}" alt="${alt}">`;
    }
    return `<div class="comp-subject-carousel">
      <img class="comp-subject-photo" src="${src}" alt="${alt}">
      <button class="carousel-btn carousel-btn-prev" type="button" aria-label="Previous photo">&#8249;</button>
      <button class="carousel-btn carousel-btn-next" type="button" aria-label="Next photo">&#8250;</button>
      <span class="carousel-counter">1 / ${photos.length}</span>
    </div>`;
  },

  /**
   * Wires up prev/next buttons and preload-ahead logic for a comp carousel.
   * Call after the carousel HTML has been inserted into the DOM.
   */
  initCompCarousel(container, photos) {
    if (!container || !photos || photos.length <= 1) return;
    const img = container.querySelector('.comp-subject-photo');
    const counter = container.querySelector('.carousel-counter');
    let idx = 0;

    const preloadAhead = (from) => {
      for (let i = 1; i <= 2; i++) {
        const next = (from + i) % photos.length;
        const pre = new Image();
        pre.src = photos[next];
      }
    };
    preloadAhead(0);

    const goTo = (newIdx) => {
      idx = ((newIdx % photos.length) + photos.length) % photos.length;
      img.src = photos[idx];
      counter.textContent = `${idx + 1} / ${photos.length}`;
      preloadAhead(idx);
    };

    container.querySelector('.carousel-btn-prev').addEventListener('click', (e) => {
      e.stopPropagation();
      goTo(idx - 1);
    });
    container.querySelector('.carousel-btn-next').addEventListener('click', (e) => {
      e.stopPropagation();
      goTo(idx + 1);
    });
  },

  formatAge(isoString) {
    try {
      const then = new Date(isoString);
      const now = new Date();
      const hours = Math.floor((now - then) / 3600000);
      if (hours < 1) return 'just now';
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      return `${days}d ago`;
    } catch { return 'unknown'; }
  },

  initAreaMultiSelect(opts) {
    const { optionsElId, dropdownElId, triggerElId, selectElId, focusAreas, selectedAreas, onChanged, enableDraw, disableDraw } = opts;
    const options = document.getElementById(optionsElId);
    const dropdown = document.getElementById(dropdownElId);
    const trigger = document.getElementById(triggerElId);

    focusAreas.forEach(fa => {
      const label = document.createElement('label');
      label.className = 'multiselect-option';
      label.dataset.key = fa.name;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = fa.name;
      cb.checked = selectedAreas.has(fa.name);
      const text = document.createElement('span');
      text.textContent = fa.name;
      label.append(cb, text);
      options.appendChild(label);

      cb.addEventListener('change', () => {
        if (cb.checked) {
          if (selectedAreas.has('custom')) {
            selectedAreas.delete('custom');
            const customCb = options.querySelector('[data-key="custom"] input');
            if (customCb) customCb.checked = false;
            disableDraw();
          }
          selectedAreas.add(fa.name);
        } else {
          selectedAreas.delete(fa.name);
        }
        onChanged();
      });
    });

    const customLabel = document.createElement('label');
    customLabel.className = 'multiselect-option';
    customLabel.dataset.key = 'custom';
    const customCb = document.createElement('input');
    customCb.type = 'checkbox';
    customCb.value = 'custom';
    customCb.checked = selectedAreas.has('custom');
    const customText = document.createElement('span');
    customText.textContent = 'Custom (Draw on Map)';
    customLabel.append(customCb, customText);
    options.appendChild(customLabel);

    customCb.addEventListener('change', () => {
      if (customCb.checked) {
        selectedAreas.forEach(name => { if (name !== 'custom') selectedAreas.delete(name); });
        options.querySelectorAll('input[type="checkbox"]').forEach(c => { if (c !== customCb) c.checked = false; });
        selectedAreas.add('custom');
        enableDraw();
      } else {
        selectedAreas.delete('custom');
        disableDraw();
      }
      onChanged();
    });

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#' + selectElId)) dropdown.classList.remove('open');
    });

    if (selectedAreas.has('custom')) enableDraw();
  },

  updateAreaTrigger(triggerSelector, selectedAreas, focusAreas) {
    const label = document.querySelector(triggerSelector + ' .multiselect-label');
    if (!label) return;
    const hasCustom = selectedAreas.has('custom');
    const namedAreas = [...selectedAreas].filter(a => a !== 'custom');
    if (hasCustom) {
      label.textContent = 'Custom area';
    } else if (namedAreas.length === 0 || namedAreas.length === focusAreas.length) {
      label.textContent = 'All Areas';
    } else if (namedAreas.length === 1) {
      label.textContent = namedAreas[0];
    } else {
      label.textContent = `${namedAreas.length} areas`;
    }
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

// --- Touch interaction support ---
// Toggle tooltips on tap for touch devices (info icons, area score items)
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
  document.addEventListener('click', (e) => {
    // Info icon tap-to-show
    const icon = e.target.closest('.info-icon');
    if (icon) {
      e.preventDefault();
      e.stopPropagation();
      document.querySelectorAll('.info-icon.touch-active').forEach(el => {
        if (el !== icon) el.classList.remove('touch-active');
      });
      icon.classList.toggle('touch-active');
      return;
    }

    // Area score item tap-to-show
    const scoreItem = e.target.closest('.area-score-item');
    if (scoreItem) {
      e.preventDefault();
      document.querySelectorAll('.area-score-item.touch-active').forEach(el => {
        if (el !== scoreItem) el.classList.remove('touch-active');
      });
      scoreItem.classList.toggle('touch-active');
      return;
    }

    // Dismiss photo tooltip when tapping outside
    if (!e.target.closest('.photo-tooltip') && !e.target.closest('.photo-preview-btn')) {
      document.querySelectorAll('.photo-tooltip').forEach(el => {
        clearInterval(el._cycleTimer);
        el._cycleTimer = null;
        el.style.display = 'none';
      });
      document.querySelectorAll('.photo-preview-btn.active').forEach(b => b.classList.remove('active'));
    }

    // Dismiss all touch tooltips when tapping elsewhere
    document.querySelectorAll('.touch-active').forEach(el => el.classList.remove('touch-active'));
  });
}
