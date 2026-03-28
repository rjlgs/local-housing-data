/**
 * Property Explorer tab — search and compare individual sold homes.
 * Includes a Leaflet map with polygon drawing for spatial filtering.
 */

const PropertyExplorer = {
  _filteredHomes: [],
  _allHomes: [],
  _sortCol: 'sold_date',
  _sortAsc: false,
  _map: null,
  _markersLayer: null,
  _drawnItems: null,
  _drawControl: null,
  _areaPolygonsLayer: null,
  _customPolygon: null, // user-drawn polygon as [[lat,lng], ...]

  init(container, data) {
    this._allHomes = data.sold_homes;
    this._focusAreas = data.config.focus_areas;
    const focusAreas = this._focusAreas;

    container.innerHTML = `
      <div class="tab-header">
        <div class="tab-title-row">
          <h2>Property Explorer</h2>
          <button id="pe-learn-more" class="btn-learn-more">Learn More</button>
        </div>
        <p class="subtitle">Search recent sales. Filter by area, size, and price. Draw a polygon on the map to define a custom area.</p>
      </div>
      <div id="pe-modal" class="modal-overlay" style="display:none">
        <div class="modal-content">
          <button class="modal-close" id="pe-modal-close">&times;</button>
          <h3>About Property Explorer Data</h3>
          <p>Property Explorer shows <strong>individual recently sold homes</strong> pulled from Redfin's sold listings API. By default, this covers the last ~90 days of sales across ${data.config.focus_areas.length} focus areas in the Greensboro-High Point metro.</p>
          <h4>Filtering</h4>
          <p>Use the dropdown filters to narrow by area, bedrooms, bathrooms, square footage, price, and property type. For areas with polygon boundaries (like Irving Park and Sunset Hills), filtering uses <strong>spatial matching</strong> — a home is included only if its coordinates fall within the defined boundary.</p>
          <h4>Custom polygon drawing</h4>
          <p>Select <strong>"Custom (Draw on Map)"</strong> from the Area dropdown to draw your own polygon or rectangle on the map. All homes inside your shape will be filtered and analyzed with summary statistics.</p>
          <h4>Comparable sales</h4>
          <p>Click any row to see comparable sales — homes in the same zip code with similar bed count (&plusmn;1) and square footage (&plusmn;25%). The comp analysis shows how the sale price compares to the county's assessed value and to the median of comparable recent sales.</p>
          <h4>Data sources</h4>
          <ul>
            <li><strong>Sale data:</strong> Redfin sold listings API (last ~90 days)</li>
            <li><strong>Assessed values &amp; property details:</strong> Guilford County ArcGIS parcel data, joined by address</li>
          </ul>
        </div>
      </div>
      <div class="filter-bar">
        <div class="filter-group">
          <label>Area</label>
          <select id="filter-area">
            <option value="all">All Areas</option>
            ${focusAreas.map(fa => `<option value="${fa.name}">${fa.name}</option>`).join('')}
            <option value="custom">Custom (Draw on Map)</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Beds</label>
          <select id="filter-beds">
            <option value="">Any</option>
            <option value="2">2+</option>
            <option value="3">3+</option>
            <option value="4">4+</option>
            <option value="5">5+</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Baths</label>
          <select id="filter-baths">
            <option value="">Any</option>
            <option value="1.5">1.5+</option>
            <option value="2">2+</option>
            <option value="3">3+</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Min Sq Ft</label>
          <input type="number" id="filter-sqft-min" placeholder="e.g. 1500" step="100">
        </div>
        <div class="filter-group">
          <label>Max Sq Ft</label>
          <input type="number" id="filter-sqft-max" placeholder="e.g. 3000" step="100">
        </div>
        <div class="filter-group">
          <label>Max Price</label>
          <input type="number" id="filter-price-max" placeholder="e.g. 500000" step="10000">
        </div>
        <div class="filter-group">
          <label>Property Type</label>
          <select id="filter-type">
            <option value="">Any</option>
            <option value="Single Family Residential">Single Family</option>
            <option value="Townhouse">Townhouse</option>
            <option value="Condo/Co-op">Condo</option>
          </select>
        </div>
        <button id="filter-apply" class="btn-primary">Apply Filters</button>
        <button id="filter-clear" class="btn-secondary">Clear</button>
      </div>
      <div id="explorer-map" class="explorer-map"></div>
      <div id="results-summary" class="results-summary"></div>
      <div id="results-table-wrap" class="table-scroll"></div>
      <div id="comp-detail" class="comp-detail"></div>
    `;

    // Learn More modal
    const peModal = document.getElementById('pe-modal');
    document.getElementById('pe-learn-more').addEventListener('click', () => peModal.style.display = 'flex');
    document.getElementById('pe-modal-close').addEventListener('click', () => peModal.style.display = 'none');
    peModal.addEventListener('click', (e) => { if (e.target === peModal) peModal.style.display = 'none'; });

    // Restore saved filters
    const saved = Prefs.get('pe', {});
    if (saved.area) document.getElementById('filter-area').value = saved.area;
    if (saved.beds) document.getElementById('filter-beds').value = saved.beds;
    if (saved.baths) document.getElementById('filter-baths').value = saved.baths;
    if (saved.sqftMin) document.getElementById('filter-sqft-min').value = saved.sqftMin;
    if (saved.sqftMax) document.getElementById('filter-sqft-max').value = saved.sqftMax;
    if (saved.priceMax) document.getElementById('filter-price-max').value = saved.priceMax;
    if (saved.type) document.getElementById('filter-type').value = saved.type;

    // Bind events
    document.getElementById('filter-apply').addEventListener('click', () => this._applyFilters(focusAreas));
    document.getElementById('filter-clear').addEventListener('click', () => this._clearFilters(focusAreas));
    document.getElementById('filter-area').addEventListener('change', () => {
      const val = document.getElementById('filter-area').value;
      if (val === 'custom') {
        this._enableDraw();
      } else {
        this._disableDraw();
        this._customPolygon = null;
        this._showAreaPolygon(val, focusAreas);
      }
      this._applyFilters(focusAreas);
    });

    // Also apply on Enter in any input
    container.querySelectorAll('input').forEach(el => {
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter') this._applyFilters(focusAreas);
      });
    });

    this._initMap();

    // Show area polygon if a saved area is selected
    const areaVal = document.getElementById('filter-area').value;
    if (areaVal !== 'all' && areaVal !== 'custom') {
      this._showAreaPolygon(areaVal, focusAreas);
    }

    // Initial render with saved or default filters
    this._applyFilters(focusAreas);
  },

  _initMap() {
    // Compute center from all homes
    const lats = this._allHomes.map(h => h.latitude);
    const lngs = this._allHomes.map(h => h.longitude);
    const centerLat = lats.reduce((a, b) => a + b, 0) / lats.length;
    const centerLng = lngs.reduce((a, b) => a + b, 0) / lngs.length;

    this._map = L.map('explorer-map').setView([centerLat, centerLng], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(this._map);

    // Layer for area polygon outlines
    this._areaPolygonsLayer = L.featureGroup().addTo(this._map);

    // Layer for drawn items (user polygons)
    this._drawnItems = L.featureGroup().addTo(this._map);

    // Markers layer
    this._markersLayer = L.layerGroup().addTo(this._map);

    // Draw control (hidden by default)
    this._drawControl = new L.Control.Draw({
      draw: {
        polygon: {
          allowIntersection: false,
          shapeOptions: { color: '#2563eb', weight: 2, fillOpacity: 0.1 },
        },
        polyline: false,
        rectangle: {
          shapeOptions: { color: '#2563eb', weight: 2, fillOpacity: 0.1 },
        },
        circle: false,
        circlemarker: false,
        marker: false,
      },
      edit: {
        featureGroup: this._drawnItems,
        remove: true,
      },
    });

    // Handle polygon creation
    this._map.on(L.Draw.Event.CREATED, (e) => {
      this._drawnItems.clearLayers();
      this._drawnItems.addLayer(e.layer);
      this._customPolygon = e.layer.getLatLngs()[0].map(ll => [ll.lat, ll.lng]);
      document.getElementById('filter-area').value = 'custom';
      this._applyFilters(this._focusAreas);
    });

    // Handle polygon deletion
    this._map.on(L.Draw.Event.DELETED, () => {
      this._customPolygon = null;
      this._applyFilters(this._focusAreas);
    });

    // Handle polygon edit
    this._map.on(L.Draw.Event.EDITED, () => {
      const layers = this._drawnItems.getLayers();
      if (layers.length > 0) {
        this._customPolygon = layers[0].getLatLngs()[0].map(ll => [ll.lat, ll.lng]);
        this._applyFilters(this._focusAreas);
      }
    });

    this._renderMarkers(this._allHomes);
  },

  _enableDraw() {
    if (!this._map.hasLayer(this._drawControl)) {
      this._map.addControl(this._drawControl);
    }
  },

  _disableDraw() {
    if (this._drawControl._map) {
      this._map.removeControl(this._drawControl);
    }
    this._drawnItems.clearLayers();
  },

  _showAreaPolygon(areaName, focusAreas) {
    this._areaPolygonsLayer.clearLayers();
    if (areaName === 'all' || areaName === 'custom') return;
    const fa = focusAreas.find(a => a.name === areaName);
    if (!fa || !fa.polygon || fa.polygon.length < 3) return;

    const poly = L.polygon(fa.polygon, {
      color: '#2563eb',
      weight: 2,
      fillOpacity: 0.08,
      dashArray: '6 4',
    });
    this._areaPolygonsLayer.addLayer(poly);
    this._map.fitBounds(poly.getBounds(), { padding: [40, 40] });
  },

  _showBoundsFromHomes(homes) {
    this._areaPolygonsLayer.clearLayers();
    const pts = homes.filter(h => h.latitude != null && h.longitude != null);
    if (pts.length < 2) return;
    const lats = pts.map(h => h.latitude);
    const lngs = pts.map(h => h.longitude);
    const pad = 0.005;
    const bounds = [
      [Math.min(...lats) - pad, Math.min(...lngs) - pad],
      [Math.max(...lats) + pad, Math.max(...lngs) + pad],
    ];
    const rect = L.rectangle(bounds, {
      color: '#2563eb',
      weight: 2,
      fillOpacity: 0.08,
      dashArray: '6 4',
    });
    this._areaPolygonsLayer.addLayer(rect);
    this._map.fitBounds(rect.getBounds(), { padding: [40, 40] });
  },

  _renderMarkers(homes) {
    this._markersLayer.clearLayers();
    homes.forEach(h => {
      if (h.latitude == null || h.longitude == null) return;
      const marker = L.circleMarker([h.latitude, h.longitude], {
        radius: 5,
        fillColor: '#2563eb',
        color: '#1d4ed8',
        weight: 1,
        fillOpacity: 0.6,
      });
      marker.bindPopup(`
        <strong>${h.address || '—'}</strong><br>
        ${Utils.formatCurrency(h.sale_price)} · ${h.beds || '?'}bd/${h.baths || '?'}ba · ${Utils.formatNumber(h.sqft)} sqft<br>
        ${h.neighborhood || ''} ${h.city || ''} ${h.zip_code || ''}
      `, { maxWidth: 280 });
      this._markersLayer.addLayer(marker);
    });
  },

  _getFilters() {
    return {
      area: document.getElementById('filter-area').value,
      beds: document.getElementById('filter-beds').value,
      baths: document.getElementById('filter-baths').value,
      sqftMin: document.getElementById('filter-sqft-min').value,
      sqftMax: document.getElementById('filter-sqft-max').value,
      priceMax: document.getElementById('filter-price-max').value,
      type: document.getElementById('filter-type').value,
    };
  },

  _clearFilters(focusAreas) {
    document.getElementById('filter-area').value = 'all';
    document.getElementById('filter-beds').value = '';
    document.getElementById('filter-baths').value = '';
    document.getElementById('filter-sqft-min').value = '';
    document.getElementById('filter-sqft-max').value = '';
    document.getElementById('filter-price-max').value = '';
    document.getElementById('filter-type').value = '';
    this._customPolygon = null;
    this._disableDraw();
    this._areaPolygonsLayer.clearLayers();
    this._applyFilters(focusAreas);
  },

  _applyFilters(focusAreas) {
    const f = this._getFilters();
    Prefs.set('pe', f);
    let homes = [...this._allHomes];

    // Area filter
    if (f.area === 'custom' && this._customPolygon) {
      homes = Utils.filterByArea(homes, { polygon: this._customPolygon });
    } else if (f.area !== 'all' && f.area !== 'custom') {
      const areaConfig = focusAreas.find(fa => fa.name === f.area);
      if (areaConfig) {
        homes = Utils.filterByArea(homes, areaConfig);
      }
    }

    // Numeric filters
    if (f.beds) homes = homes.filter(h => h.beds && h.beds >= Number(f.beds));
    if (f.baths) homes = homes.filter(h => h.baths && h.baths >= Number(f.baths));
    if (f.sqftMin) homes = homes.filter(h => h.sqft && h.sqft >= Number(f.sqftMin));
    if (f.sqftMax) homes = homes.filter(h => h.sqft && h.sqft <= Number(f.sqftMax));
    if (f.priceMax) homes = homes.filter(h => h.sale_price && h.sale_price <= Number(f.priceMax));
    if (f.type) homes = homes.filter(h => h.property_type === f.type);

    this._filteredHomes = homes;
    this._renderMarkers(homes);

    // For areas filtered by city/neighborhood name (no polygon defined), derive a
    // bounding box from the filtered homes and show it on the map.
    if (f.area !== 'all' && f.area !== 'custom') {
      const areaConfig = focusAreas.find(fa => fa.name === f.area);
      if (areaConfig && (!areaConfig.polygon || areaConfig.polygon.length < 3)) {
        this._showBoundsFromHomes(homes);
      }
    }

    this._renderResults(homes);
  },

  _renderResults(homes) {
    // Summary stats
    const prices = homes.map(h => h.sale_price).filter(v => v != null);
    const sqfts = homes.map(h => h.sqft).filter(v => v != null);
    const medianPrice = Utils.median(prices);
    const medianSqft = Utils.median(sqfts);
    const medianPpsf = Utils.median(homes.map(h => h.price_per_sqft).filter(v => v != null));

    document.getElementById('results-summary').innerHTML = `
      <span><strong>${homes.length}</strong> properties</span>
      <span>Median: <strong>${Utils.formatCurrency(medianPrice)}</strong></span>
      <span>Median SqFt: <strong>${Utils.formatNumber(medianSqft)}</strong></span>
      <span>Median $/SqFt: <strong>${Utils.formatCurrency(medianPpsf)}</strong></span>
    `;

    // Sort
    homes.sort((a, b) => {
      const va = a[this._sortCol], vb = b[this._sortCol];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return this._sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });

    // Table (limit to 200 rows for performance)
    const display = homes.slice(0, 200);
    const sortIcon = (col) =>
      this._sortCol === col ? (this._sortAsc ? ' ▲' : ' ▼') : '';

    const headers = [
      { col: 'sold_date', label: 'Sold' },
      { col: 'address', label: 'Address' },
      { col: 'city', label: 'City' },
      { col: 'neighborhood', label: 'Neighborhood' },
      { col: 'sale_price', label: 'Price' },
      { col: 'beds', label: 'Bd' },
      { col: 'baths', label: 'Ba' },
      { col: 'sqft', label: 'SqFt' },
      { col: 'price_per_sqft', label: '$/SqFt' },
      { col: 'lot_size_sqft', label: 'Lot' },
      { col: 'year_built', label: 'Year' },
      { col: 'days_on_market', label: 'DOM' },
      { col: 'total_assessed', label: 'Assessed' },
    ];

    const headerHtml = headers.map(h =>
      `<th class="sortable" data-col="${h.col}">${h.label}${sortIcon(h.col)}</th>`
    ).join('');

    const rowsHtml = display.map(h => `
      <tr class="clickable-row" data-addr="${(h.address || '').replace(/"/g, '&quot;')}">
        <td>${h.sold_date || '—'}</td>
        <td class="addr-cell">${h.address || '—'}</td>
        <td>${h.city || '—'}</td>
        <td>${h.neighborhood || '—'}</td>
        <td>${Utils.formatCurrency(h.sale_price)}</td>
        <td>${h.beds ?? '—'}</td>
        <td>${h.baths ?? '—'}</td>
        <td>${Utils.formatNumber(h.sqft)}</td>
        <td>${Utils.formatCurrency(h.price_per_sqft)}</td>
        <td>${Utils.formatNumber(h.lot_size_sqft)}</td>
        <td>${h.year_built ?? '—'}</td>
        <td>${h.days_on_market ?? '—'}</td>
        <td>${Utils.formatCurrency(h.total_assessed)}</td>
      </tr>
    `).join('');

    document.getElementById('results-table-wrap').innerHTML = `
      <table class="data-table">
        <thead><tr>${headerHtml}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      ${homes.length > 200 ? `<p class="table-note">Showing 200 of ${homes.length} results</p>` : ''}
    `;

    // Sortable headers
    document.querySelectorAll('.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (this._sortCol === col) {
          this._sortAsc = !this._sortAsc;
        } else {
          this._sortCol = col;
          this._sortAsc = col === 'address' || col === 'sold_date';
        }
        this._renderResults(this._filteredHomes);
      });
    });

    // Row click -> show comps
    document.querySelectorAll('.clickable-row').forEach(tr => {
      tr.addEventListener('click', () => {
        const addr = tr.dataset.addr;
        const home = homes.find(h => h.address === addr);
        if (home) this._showComps(home);
      });
    });
  },

  _showComps(home) {
    // Find comparable sales: same zip, similar beds (±1), similar sqft (±25%)
    const sqft = home.sqft || 0;
    const beds = home.beds || 0;
    const comps = this._allHomes.filter(h =>
      h.address !== home.address &&
      h.zip_code === home.zip_code &&
      h.beds != null && Math.abs(h.beds - beds) <= 1 &&
      h.sqft != null && h.sqft >= sqft * 0.75 && h.sqft <= sqft * 1.25 &&
      h.sale_price != null
    );

    const compPrices = comps.map(h => h.sale_price);
    const medianComp = Utils.median(compPrices);

    const assessedDiff = home.total_assessed && home.sale_price
      ? ((home.sale_price - home.total_assessed) / home.total_assessed * 100).toFixed(1)
      : null;

    const compDiff = medianComp && home.sale_price
      ? ((home.sale_price - medianComp) / medianComp * 100).toFixed(1)
      : null;

    document.getElementById('comp-detail').innerHTML = `
      <h3>Comparable Sales Analysis</h3>
      <div class="comp-header">
        <div class="comp-subject">
          <h4>${home.address}</h4>
          <p>${home.city} ${home.zip_code} · ${home.beds}bd/${home.baths}ba · ${Utils.formatNumber(home.sqft)} sqft</p>
          <p class="comp-price">Sold: ${Utils.formatCurrency(home.sale_price)} ${home.sold_date ? `on ${home.sold_date}` : ''}</p>
        </div>
        <div class="comp-metrics">
          <div class="metric">
            <span class="metric-label">vs. Assessed Value</span>
            <span class="metric-value">${home.total_assessed ? Utils.formatCurrency(home.total_assessed) : '—'}</span>
            ${assessedDiff ? `<span class="metric-delta ${Number(assessedDiff) > 0 ? 'delta-up' : 'delta-down'}">${assessedDiff > 0 ? '+' : ''}${assessedDiff}%</span>` : ''}
          </div>
          <div class="metric">
            <span class="metric-label">vs. Median Comp</span>
            <span class="metric-value">${medianComp ? Utils.formatCurrency(medianComp) : '—'}</span>
            ${compDiff ? `<span class="metric-delta ${Number(compDiff) > 0 ? 'delta-up' : 'delta-down'}">${compDiff > 0 ? '+' : ''}${compDiff}%</span>` : ''}
          </div>
          <div class="metric">
            <span class="metric-label">Comps Found</span>
            <span class="metric-value">${comps.length}</span>
          </div>
        </div>
      </div>
      ${comps.length > 0 ? `
        <table class="data-table comp-table">
          <thead><tr>
            <th>Address</th><th>Price</th><th>Bd/Ba</th><th>SqFt</th><th>$/SqFt</th><th>Sold</th><th>DOM</th>
          </tr></thead>
          <tbody>
            ${comps.slice(0, 15).map(c => `
              <tr>
                <td>${c.address}</td>
                <td>${Utils.formatCurrency(c.sale_price)}</td>
                <td>${c.beds}/${c.baths}</td>
                <td>${Utils.formatNumber(c.sqft)}</td>
                <td>${Utils.formatCurrency(c.price_per_sqft)}</td>
                <td>${c.sold_date || '—'}</td>
                <td>${c.days_on_market ?? '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<p class="empty-state">No comparable sales found in the same zip code with similar specs.</p>'}
    `;

    // Scroll to comp detail
    document.getElementById('comp-detail').scrollIntoView({ behavior: 'smooth' });
  },
};
