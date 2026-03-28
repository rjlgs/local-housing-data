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
        <div class="filter-cluster">
          <div class="filter-cluster-label">Area</div>
          <div class="filter-cluster-row">
            <div class="filter-group">
              <label>&nbsp;</label>
              <select id="filter-area">
                <option value="all">All Areas</option>
                ${focusAreas.map(fa => `<option value="${fa.name}">${fa.name}</option>`).join('')}
                <option value="custom">Custom (Draw on Map)</option>
              </select>
            </div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Beds</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="filter-beds-min" placeholder="2" min="0" step="1"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="filter-beds-max" placeholder="5" min="0" step="1"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Baths</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="filter-baths-min" placeholder="2" min="0" step="0.5"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="filter-baths-max" placeholder="4" min="0" step="0.5"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Sq Ft</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="filter-sqft-min" placeholder="1500" step="100"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="filter-sqft-max" placeholder="3000" step="100"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Price</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="filter-price-min" placeholder="200k" step="10000"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="filter-price-max" placeholder="500k" step="10000"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Year Built</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="filter-year-min" placeholder="1990" step="1"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="filter-year-max" placeholder="2020" step="1"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">HOA</div>
          <div class="filter-cluster-row">
            <div class="filter-group">
              <label>&nbsp;</label>
              <select id="filter-hoa">
                <option value="">Any</option>
                <option value="none">No HOA</option>
                <option value="has">Has HOA</option>
              </select>
            </div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Type</div>
          <div class="filter-cluster-row">
            <div class="filter-group">
              <label>&nbsp;</label>
              <select id="filter-type">
                <option value="">Any</option>
                <option value="Single Family Residential">Single Family</option>
                <option value="Townhouse">Townhouse</option>
                <option value="Condo/Co-op">Condo</option>
              </select>
            </div>
          </div>
        </div>
        <div class="filter-cluster filter-actions">
          <button id="filter-apply" class="btn-primary">Apply</button>
          <button id="filter-clear" class="btn-secondary">Clear</button>
        </div>
      </div>
      <div id="explorer-map" class="explorer-map"></div>
      <div id="results-summary" class="results-summary"></div>
      <div id="results-table-wrap" class="table-scroll"></div>
      <div id="comp-hover-backdrop" class="comp-hover-backdrop" style="display:none"></div>
      <div id="comp-hover-card" class="comp-hover-card" style="display:none">
        <button class="comp-hover-close" id="comp-hover-close">&times;</button>
        <div id="comp-hover-content"></div>
      </div>
    `;

    // Learn More modal
    const peModal = document.getElementById('pe-modal');
    document.getElementById('pe-learn-more').addEventListener('click', () => peModal.style.display = 'flex');
    document.getElementById('pe-modal-close').addEventListener('click', () => peModal.style.display = 'none');
    peModal.addEventListener('click', (e) => { if (e.target === peModal) peModal.style.display = 'none'; });

    // Comp hover card dismiss
    document.getElementById('comp-hover-close').addEventListener('click', () => this._hideComps());
    document.getElementById('comp-hover-backdrop').addEventListener('click', () => this._hideComps());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this._hideComps(); });

    // Restore saved filters
    const saved = Prefs.get('pe', {});
    if (saved.area) document.getElementById('filter-area').value = saved.area;
    if (saved.bedsMin) document.getElementById('filter-beds-min').value = saved.bedsMin;
    if (saved.bedsMax) document.getElementById('filter-beds-max').value = saved.bedsMax;
    if (saved.bathsMin) document.getElementById('filter-baths-min').value = saved.bathsMin;
    if (saved.bathsMax) document.getElementById('filter-baths-max').value = saved.bathsMax;
    if (saved.sqftMin) document.getElementById('filter-sqft-min').value = saved.sqftMin;
    if (saved.sqftMax) document.getElementById('filter-sqft-max').value = saved.sqftMax;
    if (saved.priceMin) document.getElementById('filter-price-min').value = saved.priceMin;
    if (saved.priceMax) document.getElementById('filter-price-max').value = saved.priceMax;
    if (saved.hoa) document.getElementById('filter-hoa').value = saved.hoa;
    if (saved.yearMin) document.getElementById('filter-year-min').value = saved.yearMin;
    if (saved.yearMax) document.getElementById('filter-year-max').value = saved.yearMax;
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
      bedsMin: document.getElementById('filter-beds-min').value,
      bedsMax: document.getElementById('filter-beds-max').value,
      bathsMin: document.getElementById('filter-baths-min').value,
      bathsMax: document.getElementById('filter-baths-max').value,
      sqftMin: document.getElementById('filter-sqft-min').value,
      sqftMax: document.getElementById('filter-sqft-max').value,
      priceMin: document.getElementById('filter-price-min').value,
      priceMax: document.getElementById('filter-price-max').value,
      hoa: document.getElementById('filter-hoa').value,
      yearMin: document.getElementById('filter-year-min').value,
      yearMax: document.getElementById('filter-year-max').value,
      type: document.getElementById('filter-type').value,
    };
  },

  _clearFilters(focusAreas) {
    document.getElementById('filter-area').value = 'all';
    document.getElementById('filter-beds-min').value = '';
    document.getElementById('filter-beds-max').value = '';
    document.getElementById('filter-baths-min').value = '';
    document.getElementById('filter-baths-max').value = '';
    document.getElementById('filter-sqft-min').value = '';
    document.getElementById('filter-sqft-max').value = '';
    document.getElementById('filter-price-min').value = '';
    document.getElementById('filter-price-max').value = '';
    document.getElementById('filter-hoa').value = '';
    document.getElementById('filter-year-min').value = '';
    document.getElementById('filter-year-max').value = '';
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
    if (f.bedsMin) homes = homes.filter(h => h.beds != null && h.beds >= Number(f.bedsMin));
    if (f.bedsMax) homes = homes.filter(h => h.beds != null && h.beds <= Number(f.bedsMax));
    if (f.bathsMin) homes = homes.filter(h => h.baths != null && h.baths >= Number(f.bathsMin));
    if (f.bathsMax) homes = homes.filter(h => h.baths != null && h.baths <= Number(f.bathsMax));
    if (f.sqftMin) homes = homes.filter(h => h.sqft && h.sqft >= Number(f.sqftMin));
    if (f.sqftMax) homes = homes.filter(h => h.sqft && h.sqft <= Number(f.sqftMax));
    if (f.priceMin) homes = homes.filter(h => h.sale_price && h.sale_price >= Number(f.priceMin));
    if (f.priceMax) homes = homes.filter(h => h.sale_price && h.sale_price <= Number(f.priceMax));
    if (f.hoa === 'none') homes = homes.filter(h => !h.hoa_monthly);
    if (f.hoa === 'has') homes = homes.filter(h => h.hoa_monthly && h.hoa_monthly > 0);
    if (f.yearMin) homes = homes.filter(h => h.year_built != null && h.year_built >= Number(f.yearMin));
    if (f.yearMax) homes = homes.filter(h => h.year_built != null && h.year_built <= Number(f.yearMax));
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
      { col: 'price_per_sqft', label: '$/SqFt' },
      { col: 'sqft', label: 'SqFt' },
      { col: 'lot_size_sqft', label: 'Lot SqFt' },
      { col: null, label: 'House:Lot', sortable: false },
      { col: 'beds', label: 'Bd' },
      { col: 'baths', label: 'Ba' },
      { col: 'year_built', label: 'Year' },
      { col: 'total_assessed', label: 'Assessed' },
    ];

    const headerHtml = headers.map(h =>
      h.sortable === false
        ? `<th>${h.label}</th>`
        : `<th class="sortable" data-col="${h.col}">${h.label}${sortIcon(h.col)}</th>`
    ).join('');

    const rowsHtml = display.map(h => `
      <tr class="clickable-row" data-addr="${(h.address || '').replace(/"/g, '&quot;')}">
        <td>${h.sold_date || '—'}</td>
        <td class="addr-cell">${h.address || '—'}</td>
        <td>${h.city || '—'}</td>
        <td>${h.neighborhood || '—'}</td>
        <td>${Utils.formatCurrency(h.sale_price)}</td>
        <td>${Utils.formatCurrency(h.price_per_sqft)}</td>
        <td>${Utils.formatNumber(h.sqft)}</td>
        <td>${Utils.formatNumber(h.lot_size_sqft)}</td>
        <td>${h.sqft && h.lot_size_sqft ? '1\u00a0:\u00a0' + (h.lot_size_sqft / h.sqft).toFixed(1) : '—'}</td>
        <td>${h.beds ?? '—'}</td>
        <td>${h.baths ?? '—'}</td>
        <td>${h.year_built ?? '—'}</td>
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

    document.getElementById('comp-hover-content').innerHTML = `
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
            <th>Address</th><th>Price</th><th>$/SqFt</th><th>SqFt</th><th>Bd/Ba</th><th>Sold</th>
          </tr></thead>
          <tbody>
            ${comps.slice(0, 15).map(c => `
              <tr>
                <td>${c.address}</td>
                <td>${Utils.formatCurrency(c.sale_price)}</td>
                <td>${Utils.formatCurrency(c.price_per_sqft)}</td>
                <td>${Utils.formatNumber(c.sqft)}</td>
                <td>${c.beds}/${c.baths}</td>
                <td>${c.sold_date || '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<p class="empty-state">No comparable sales found in the same zip code with similar specs.</p>'}
    `;

    document.getElementById('comp-hover-card').style.display = 'block';
    document.getElementById('comp-hover-backdrop').style.display = 'block';
  },

  _hideComps() {
    document.getElementById('comp-hover-card').style.display = 'none';
    document.getElementById('comp-hover-backdrop').style.display = 'none';
  },
};
