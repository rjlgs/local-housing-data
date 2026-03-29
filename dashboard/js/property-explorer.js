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
  _selectedAreas: new Set(), // names of selected focus areas (empty = all)
  _markersByAddr: {}, // address -> Leaflet marker, for bidirectional hover
  _photoTooltip: null,
  _photoTimeout: null,
  _compMap: null,
  _compMarkersByAddr: {},

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
        ${data.data_freshness && data.data_freshness.sold_homes ? `<span class="freshness-badge">Sold data updated ${this._formatAge(data.data_freshness.sold_homes)}</span>` : ''}
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
              <div id="pe-area-select" class="multiselect">
                <button type="button" class="multiselect-trigger" id="pe-area-trigger">
                  <span class="multiselect-label">All Areas</span>
                  <span class="multiselect-arrow">&#9662;</span>
                </button>
                <div class="multiselect-dropdown" id="pe-area-dropdown">
                  <div class="multiselect-options" id="pe-area-options"></div>
                </div>
              </div>
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
    if (Array.isArray(saved.areas)) this._selectedAreas = new Set(saved.areas);
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

    // Also apply on Enter in any input
    container.querySelectorAll('input').forEach(el => {
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter') this._applyFilters(focusAreas);
      });
    });

    this._initMap();
    this._initPhotoTooltip();
    this._initAreaMultiSelect(focusAreas);

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
      this._applyFilters(this._focusAreas);
    });

    // Handle polygon deletion
    this._map.on(L.Draw.Event.DELETED, () => {
      this._customPolygon = null;
      this._selectedAreas.delete('custom');
      const customCb = document.querySelector('#pe-area-options [data-key="custom"] input');
      if (customCb) customCb.checked = false;
      this._updateAreaTrigger(this._focusAreas);
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

  _showAreaPolygons(areaNames, focusAreas, filteredHomes) {
    this._areaPolygonsLayer.clearLayers();
    if (!areaNames.length) return;

    areaNames.forEach(name => {
      const fa = focusAreas.find(a => a.name === name);
      if (fa && fa.polygon && fa.polygon.length >= 3) {
        this._areaPolygonsLayer.addLayer(L.polygon(fa.polygon, {
          color: '#2563eb', weight: 2, fillOpacity: 0.08, dashArray: '6 4', interactive: false,
        }));
      }
    });

    if (this._areaPolygonsLayer.getLayers().length > 0) {
      this._map.fitBounds(this._areaPolygonsLayer.getBounds(), { padding: [40, 40] });
    } else if (filteredHomes) {
      // No defined polygons — derive bounding box from filtered homes
      const pts = filteredHomes.filter(h => h.latitude != null && h.longitude != null);
      if (pts.length < 2) return;
      const lats = pts.map(h => h.latitude);
      const lngs = pts.map(h => h.longitude);
      const pad = 0.005;
      const rect = L.rectangle([
        [Math.min(...lats) - pad, Math.min(...lngs) - pad],
        [Math.max(...lats) + pad, Math.max(...lngs) + pad],
      ], { color: '#2563eb', weight: 2, fillOpacity: 0.08, dashArray: '6 4', interactive: false });
      this._areaPolygonsLayer.addLayer(rect);
      this._map.fitBounds(rect.getBounds(), { padding: [40, 40] });
    }
  },

  _renderMarkers(homes) {
    this._markersLayer.clearLayers();
    this._markersByAddr = {};
    homes.forEach(h => {
      if (h.latitude == null || h.longitude == null) return;
      const marker = L.circleMarker([h.latitude, h.longitude], {
        radius: 5,
        fillColor: '#2563eb',
        color: '#1d4ed8',
        weight: 1,
        fillOpacity: 0.6,
      });
      // Map hover → highlight corresponding table row + show photo
      marker.on('mouseover', (e) => {
        marker.setRadius(9);
        marker.setStyle({ fillOpacity: 0.95 });
        marker.bringToFront();
        const row = Array.from(document.querySelectorAll('.clickable-row'))
          .find(r => r.dataset.addr === h.address);
        if (row) row.classList.add('row-map-highlight');
        const me = e.originalEvent;
        if (me) this._showPhoto(h, me.clientX, me.clientY);
      });
      marker.on('mouseout', () => {
        marker.setRadius(5);
        marker.setStyle({ fillOpacity: 0.6 });
        const row = Array.from(document.querySelectorAll('.clickable-row'))
          .find(r => r.dataset.addr === h.address);
        if (row) row.classList.remove('row-map-highlight');
        this._hidePhoto();
      });

      if (h.address) this._markersByAddr[h.address] = marker;
      this._markersLayer.addLayer(marker);
    });
  },

  _getFilters() {
    return {
      areas: [...this._selectedAreas],
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
    this._selectedAreas = new Set();
    document.querySelectorAll('#pe-area-options input[type="checkbox"]').forEach(cb => cb.checked = false);
    this._updateAreaTrigger(focusAreas);
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
    if (f.areas.includes('custom') && this._customPolygon) {
      homes = Utils.filterByArea(homes, { polygon: this._customPolygon });
    } else if (f.areas.length > 0 && !f.areas.includes('custom')) {
      const matched = new Set();
      f.areas.forEach(areaName => {
        const areaConfig = focusAreas.find(fa => fa.name === areaName);
        if (areaConfig) Utils.filterByArea(homes, areaConfig).forEach(h => matched.add(h));
      });
      homes = homes.filter(h => matched.has(h));
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

    const namedAreas = f.areas.filter(a => a !== 'custom');
    if (namedAreas.length > 0) {
      this._showAreaPolygons(namedAreas, focusAreas, homes);
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
      { col: null, label: '\u0394 Assessed', sortable: false },
      { col: 'hoa_monthly', label: 'HOA/mo' },
      { col: 'price_per_sqft', label: '$/SqFt' },
      { col: 'sqft', label: 'SqFt' },
      { col: 'beds', label: 'Bd' },
      { col: 'baths', label: 'Ba' },
      { col: 'year_built', label: 'Year' },
    ];

    const headerHtml = headers.map(h =>
      h.sortable === false
        ? `<th>${h.label}</th>`
        : `<th class="sortable" data-col="${h.col}">${h.label}${sortIcon(h.col)}</th>`
    ).join('');

    const rowsHtml = display.map(h => `
      <tr class="clickable-row" data-addr="${(h.address || '').replace(/"/g, '&quot;')}">
        <td>${Utils.formatDate(h.sold_date)}</td>
        <td class="addr-cell"><a href="${this._zillowUrl(h)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${h.address || '—'}</a></td>
        <td>${h.city || '—'}</td>
        <td>${h.neighborhood || '—'}</td>
        <td>${Utils.formatCurrency(h.sale_price)}</td>
        <td>${(() => {
          if (h.sale_price == null || !h.total_assessed) return '—';
          const diff = h.sale_price - h.total_assessed;
          const pct = (diff / h.total_assessed * 100).toFixed(1);
          const sign = diff >= 0 ? '+' : '';
          return `${sign}${Utils.formatCurrency(diff)} (${sign}${pct}%)`;
        })()}</td>
        <td>${h.hoa_monthly != null ? Utils.formatCurrency(h.hoa_monthly) : '—'}</td>
        <td>${Utils.formatCurrency(h.price_per_sqft)}</td>
        <td>${Utils.formatNumber(h.sqft)}</td>
        <td>${h.beds ?? '—'}</td>
        <td>${h.baths ?? '—'}</td>
        <td>${h.year_built ?? '—'}</td>
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

    // Row hover -> swell map marker; row click -> show comps
    document.querySelectorAll('.clickable-row').forEach(tr => {
      const addr = tr.dataset.addr;
      tr.addEventListener('mouseenter', (e) => {
        const marker = this._markersByAddr[addr];
        if (marker) { marker.setRadius(9); marker.setStyle({ fillOpacity: 0.95 }); marker.bringToFront(); }
        const home = homes.find(h => h.address === addr);
        if (home) this._showPhoto(home, e.clientX, e.clientY);
      });
      tr.addEventListener('mouseleave', () => {
        const marker = this._markersByAddr[addr];
        if (marker) { marker.setRadius(5); marker.setStyle({ fillOpacity: 0.6 }); }
        this._hidePhoto();
      });
      tr.addEventListener('click', () => {
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
          ${home.photo_url ? `<img class="comp-subject-photo" src="${home.photo_url}" alt="${home.address}">` : ''}
          <div class="comp-subject-info">
            <h4><a href="${this._zillowUrl(home)}" target="_blank" rel="noopener">${home.address}</a></h4>
            <p>${home.city} ${home.zip_code} · ${home.beds}bd/${home.baths}ba · ${Utils.formatNumber(home.sqft)} sqft</p>
            <p class="comp-price">Sold: ${Utils.formatCurrency(home.sale_price)} ${home.sold_date ? `on ${Utils.formatDate(home.sold_date)}` : ''}</p>
          </div>
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
      <div id="comp-hover-map" class="comp-map"></div>
      ${comps.length > 0 ? `
        <table class="data-table comp-table">
          <thead><tr>
            <th>Sold</th><th>Address</th><th>Price</th><th>$/SqFt</th><th>SqFt</th><th>Bd/Ba</th>
          </tr></thead>
          <tbody>
            ${comps.slice(0, 15).map(c => `
              <tr>
                <td>${Utils.formatDate(c.sold_date)}</td>
                <td><a href="${this._zillowUrl(c)}" target="_blank" rel="noopener">${c.address}</a></td>
                <td>${Utils.formatCurrency(c.sale_price)}</td>
                <td>${Utils.formatCurrency(c.price_per_sqft)}</td>
                <td>${Utils.formatNumber(c.sqft)}</td>
                <td>${c.beds}/${c.baths}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<p class="empty-state">No comparable sales found in the same zip code with similar specs.</p>'}
    `;

    document.getElementById('comp-hover-card').style.display = 'block';
    document.getElementById('comp-hover-backdrop').style.display = 'block';
    this._initCompMap(home, comps);
    this._initCompTableHovers(comps.slice(0, 15), document.getElementById('comp-hover-content'));
  },

  _hideComps() {
    document.getElementById('comp-hover-card').style.display = 'none';
    document.getElementById('comp-hover-backdrop').style.display = 'none';
    if (this._compMap) { this._compMap.remove(); this._compMap = null; }
  },

  _initCompTableHovers(comps, contentEl) {
    contentEl.querySelectorAll('.comp-table tbody tr').forEach((row, i) => {
      const comp = comps[i];
      if (!comp) return;
      row.addEventListener('mouseenter', (e) => {
        this._showPhoto(comp, e.clientX, e.clientY);
        const m = this._compMarkersByAddr[comp.address];
        if (m) { m.setRadius(9); m.setStyle({ fillOpacity: 0.95 }); m.bringToFront(); }
      });
      row.addEventListener('mouseleave', () => {
        this._hidePhoto();
        const m = this._compMarkersByAddr[comp.address];
        if (m) { m.setRadius(5); m.setStyle({ fillOpacity: 0.7 }); }
      });
    });
  },

  _initCompMap(home, comps) {
    if (this._compMap) { this._compMap.remove(); this._compMap = null; }
    this._compMarkersByAddr = {};
    const mapEl = document.getElementById('comp-hover-map');
    if (!mapEl) return;

    const compPts = comps.filter(c => c.latitude != null && c.longitude != null);
    const hasSubject = home.latitude != null && home.longitude != null;

    if (!hasSubject && compPts.length === 0) {
      mapEl.style.display = 'none';
      return;
    }

    const map = L.map(mapEl, { zoomControl: true, scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    // Comp markers — blue
    compPts.forEach(c => {
      const m = L.circleMarker([c.latitude, c.longitude], {
        radius: 5, fillColor: '#2563eb', color: '#1d4ed8', weight: 1, fillOpacity: 0.7,
      }).addTo(map);
      m.on('mouseover', (e) => {
        m.setRadius(8); m.setStyle({ fillOpacity: 0.95 }); m.bringToFront();
        const me = e.originalEvent;
        if (me) this._showPhoto(c, me.clientX, me.clientY);
      });
      m.on('mouseout', () => { m.setRadius(5); m.setStyle({ fillOpacity: 0.7 }); this._hidePhoto(); });
      if (c.address) this._compMarkersByAddr[c.address] = m;
    });

    // Subject marker — red, slightly larger
    if (hasSubject) {
      L.circleMarker([home.latitude, home.longitude], {
        radius: 8, fillColor: '#ef4444', color: '#dc2626', weight: 2, fillOpacity: 0.9,
      }).bindTooltip(`${home.address || ''} (subject)`, { permanent: false }).addTo(map);
    }

    // Fit bounds to all points
    const allPts = [
      ...(hasSubject ? [[home.latitude, home.longitude]] : []),
      ...compPts.map(c => [c.latitude, c.longitude]),
    ];
    if (allPts.length === 1) {
      map.setView(allPts[0], 14);
    } else {
      map.fitBounds(L.latLngBounds(allPts), { padding: [24, 24] });
    }

    this._compMap = map;
  },

  _initPhotoTooltip() {
    const el = document.createElement('div');
    el.className = 'photo-tooltip';
    el.innerHTML = `<img class="photo-tooltip-img" src="" alt="">
      <div class="photo-tooltip-body">
        <div class="photo-tooltip-address"></div>
        <div class="photo-tooltip-price"></div>
        <div class="photo-tooltip-specs"></div>
        <div class="photo-tooltip-location"></div>
      </div>`;
    el.style.display = 'none';
    document.body.appendChild(el);
    this._photoTooltip = el;
  },

  _showPhoto(home, x, y) {
    clearTimeout(this._photoTimeout);
    if (!home.photo_url) return;
    this._photoTimeout = setTimeout(() => {
      const tip = this._photoTooltip;
      tip.querySelector('.photo-tooltip-img').src = home.photo_url;
      tip.querySelector('.photo-tooltip-address').textContent = home.address || '';
      tip.querySelector('.photo-tooltip-price').textContent = Utils.formatCurrency(home.sale_price || home.list_price);
      const specs = [
        home.beds != null ? `${home.beds}bd` : null,
        home.baths != null ? `${home.baths}ba` : null,
        home.sqft ? `${Utils.formatNumber(home.sqft)} sqft` : null,
      ].filter(Boolean).join(' · ');
      tip.querySelector('.photo-tooltip-specs').textContent = specs;
      tip.querySelector('.photo-tooltip-location').textContent =
        [home.neighborhood, home.city, home.zip_code].filter(Boolean).join(' ');
      const tw = 340, th = 300;
      let left = x + 16, top = y - th / 2;
      if (left + tw > window.innerWidth - 10) left = x - tw - 16;
      if (top < 10) top = 10;
      if (top + th > window.innerHeight - 10) top = window.innerHeight - th - 10;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
      tip.style.display = 'block';
    }, 300);
  },

  _hidePhoto() {
    clearTimeout(this._photoTimeout);
    if (this._photoTooltip) this._photoTooltip.style.display = 'none';
  },

  _initAreaMultiSelect(focusAreas) {
    const options = document.getElementById('pe-area-options');
    const dropdown = document.getElementById('pe-area-dropdown');
    const trigger = document.getElementById('pe-area-trigger');

    focusAreas.forEach(fa => {
      const label = document.createElement('label');
      label.className = 'multiselect-option';
      label.dataset.key = fa.name;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = fa.name;
      cb.checked = this._selectedAreas.has(fa.name);
      const text = document.createElement('span');
      text.textContent = fa.name;
      label.append(cb, text);
      options.appendChild(label);

      cb.addEventListener('change', () => {
        if (cb.checked) {
          if (this._selectedAreas.has('custom')) {
            this._selectedAreas.delete('custom');
            const customCb = options.querySelector('[data-key="custom"] input');
            if (customCb) customCb.checked = false;
            this._disableDraw();
            this._customPolygon = null;
          }
          this._selectedAreas.add(fa.name);
        } else {
          this._selectedAreas.delete(fa.name);
        }
        this._updateAreaTrigger(focusAreas);
        this._applyFilters(focusAreas);
      });
    });

    // Custom draw option
    const customLabel = document.createElement('label');
    customLabel.className = 'multiselect-option';
    customLabel.dataset.key = 'custom';
    const customCb = document.createElement('input');
    customCb.type = 'checkbox';
    customCb.value = 'custom';
    customCb.checked = this._selectedAreas.has('custom');
    const customText = document.createElement('span');
    customText.textContent = 'Custom (Draw on Map)';
    customLabel.append(customCb, customText);
    options.appendChild(customLabel);

    customCb.addEventListener('change', () => {
      if (customCb.checked) {
        this._selectedAreas.forEach(name => { if (name !== 'custom') this._selectedAreas.delete(name); });
        options.querySelectorAll('input[type="checkbox"]').forEach(c => { if (c !== customCb) c.checked = false; });
        this._selectedAreas.add('custom');
        this._enableDraw();
      } else {
        this._selectedAreas.delete('custom');
        this._disableDraw();
        this._customPolygon = null;
      }
      this._updateAreaTrigger(focusAreas);
      this._applyFilters(focusAreas);
    });

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#pe-area-select')) dropdown.classList.remove('open');
    });

    if (this._selectedAreas.has('custom')) this._enableDraw();
    this._updateAreaTrigger(focusAreas);
  },

  _updateAreaTrigger(focusAreas) {
    const label = document.querySelector('#pe-area-trigger .multiselect-label');
    if (!label) return;
    const hasCustom = this._selectedAreas.has('custom');
    const namedAreas = [...this._selectedAreas].filter(a => a !== 'custom');
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

  _formatAge(isoString) {
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

  _zillowUrl(h) {
    const parts = [h.address, h.city, 'NC', h.zip_code]
      .filter(Boolean)
      .join(' ')
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    return `https://www.zillow.com/homes/${parts}_rb/`;
  },
};
