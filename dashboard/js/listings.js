/**
 * Listings tab — browse active for-sale listings.
 * Similar to Property Explorer but focused on what you can buy right now.
 */

const Listings = {
  _filteredListings: [],
  _allListings: [],
  _allSold: [],
  _sortCol: 'first_seen',
  _sortAsc: false,
  _map: null,
  _markersLayer: null,
  _drawnItems: null,
  _drawControl: null,
  _areaPolygonsLayer: null,
  _customPolygon: null,
  _selectedAreas: new Set(),
  _markersByAddr: {},
  _photoTooltip: null,
  _photoTimeout: null,
  _compMap: null,
  _compMarkersByAddr: {},

  // How many days counts as "new"
  NEW_DAYS: 3,

  init(container, data) {
    this._allListings = data.active_listings || [];
    this._allSold = data.sold_homes || [];
    this._focusAreas = data.config.focus_areas;
    const focusAreas = this._focusAreas;

    const freshness = data.data_freshness || {};
    const lastUpdated = freshness.active_listings
      ? this._formatAge(freshness.active_listings)
      : 'unknown';

    container.innerHTML = `
      <div class="tab-header">
        <div class="tab-title-row">
          <h2>Listings</h2>
          <button id="ls-learn-more" class="btn-learn-more">Learn More</button>
          <span class="freshness-badge" title="Last data refresh">Active listings updated ${lastUpdated}</span>
        </div>
        <p class="subtitle">Browse active for-sale listings. Homes with recent price drops or new to market are flagged.</p>
      </div>
      <div id="ls-modal" class="modal-overlay" style="display:none">
        <div class="modal-content">
          <button class="modal-close" id="ls-modal-close">&times;</button>
          <h3>About Listings Data</h3>
          <p>Listings shows <strong>currently active for-sale homes</strong> pulled from Redfin. The data refreshes twice daily.</p>
          <h4>Badges</h4>
          <ul>
            <li><strong>NEW</strong> — Listed within the last ${this.NEW_DAYS} days</li>
            <li><strong>PRICE DROP</strong> — Asking price has been reduced since first listed</li>
          </ul>
          <h4>Value Analysis</h4>
          <p>Click any listing to see how its asking price compares to recent sold comps in the same zip code with similar specs. This helps answer: <em>"Is this asking price reasonable?"</em></p>
          <h4>Data sources</h4>
          <ul>
            <li><strong>Listing data:</strong> Redfin active listings API</li>
            <li><strong>Assessed values:</strong> Guilford County ArcGIS parcel data</li>
            <li><strong>Sold comps:</strong> Redfin sold listings (last ~90 days)</li>
          </ul>
        </div>
      </div>
      <div class="filter-bar">
        <div class="filter-cluster">
          <div class="filter-cluster-label">Area</div>
          <div class="filter-cluster-row">
            <div class="filter-group">
              <label>&nbsp;</label>
              <div id="ls-area-select" class="multiselect">
                <button type="button" class="multiselect-trigger" id="ls-area-trigger">
                  <span class="multiselect-label">All Areas</span>
                  <span class="multiselect-arrow">&#9662;</span>
                </button>
                <div class="multiselect-dropdown" id="ls-area-dropdown">
                  <div class="multiselect-options" id="ls-area-options"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Beds</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="ls-filter-beds-min" min="0" step="1"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="ls-filter-beds-max" min="0" step="1"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Baths</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="ls-filter-baths-min" min="0" step="0.5"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="ls-filter-baths-max" min="0" step="0.5"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Sq Ft</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="ls-filter-sqft-min" step="100"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="ls-filter-sqft-max" step="100"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Price</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="ls-filter-price-min" step="10000"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="ls-filter-price-max" step="10000"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Year Built</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="ls-filter-year-min" step="1"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="ls-filter-year-max" step="1"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">HOA</div>
          <div class="filter-cluster-row">
            <div class="filter-group">
              <label>&nbsp;</label>
              <select id="ls-filter-hoa">
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
              <select id="ls-filter-type">
                <option value="">Any</option>
                <option value="Single Family Residential">Single Family</option>
                <option value="Townhouse">Townhouse</option>
                <option value="Condo/Co-op">Condo</option>
              </select>
            </div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Status</div>
          <div class="filter-cluster-row">
            <div class="filter-group">
              <label>&nbsp;</label>
              <select id="ls-filter-status">
                <option value="">All</option>
                <option value="new">New Only</option>
                <option value="price-drop">Price Drops</option>
              </select>
            </div>
          </div>
        </div>
        <div class="filter-cluster filter-actions">
          <button id="ls-filter-apply" class="btn-primary">Apply</button>
          <button id="ls-filter-clear" class="btn-secondary">Clear</button>
        </div>
      </div>
      <div id="ls-map" class="explorer-map"></div>
      <div id="ls-results-summary" class="results-summary"></div>
      <div id="ls-results-table-wrap" class="table-scroll"></div>
      <div id="ls-comp-backdrop" class="comp-hover-backdrop" style="display:none"></div>
      <div id="ls-comp-card" class="comp-hover-card" style="display:none">
        <button class="comp-hover-close" id="ls-comp-close">&times;</button>
        <div id="ls-comp-content"></div>
      </div>
    `;

    // Learn More modal
    const modal = document.getElementById('ls-modal');
    document.getElementById('ls-learn-more').addEventListener('click', () => modal.style.display = 'flex');
    document.getElementById('ls-modal-close').addEventListener('click', () => modal.style.display = 'none');
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    // Comp card dismiss
    document.getElementById('ls-comp-close').addEventListener('click', () => this._hideComps());
    document.getElementById('ls-comp-backdrop').addEventListener('click', () => this._hideComps());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this._hideComps(); });

    // Restore saved filters
    const saved = Prefs.get('ls', {});
    if (Array.isArray(saved.areas)) this._selectedAreas = new Set(saved.areas);
    if (saved.bedsMin) document.getElementById('ls-filter-beds-min').value = saved.bedsMin;
    if (saved.bedsMax) document.getElementById('ls-filter-beds-max').value = saved.bedsMax;
    if (saved.bathsMin) document.getElementById('ls-filter-baths-min').value = saved.bathsMin;
    if (saved.bathsMax) document.getElementById('ls-filter-baths-max').value = saved.bathsMax;
    if (saved.sqftMin) document.getElementById('ls-filter-sqft-min').value = saved.sqftMin;
    if (saved.sqftMax) document.getElementById('ls-filter-sqft-max').value = saved.sqftMax;
    if (saved.priceMin) document.getElementById('ls-filter-price-min').value = saved.priceMin;
    if (saved.priceMax) document.getElementById('ls-filter-price-max').value = saved.priceMax;
    if (saved.hoa) document.getElementById('ls-filter-hoa').value = saved.hoa;
    if (saved.yearMin) document.getElementById('ls-filter-year-min').value = saved.yearMin;
    if (saved.yearMax) document.getElementById('ls-filter-year-max').value = saved.yearMax;
    if (saved.type) document.getElementById('ls-filter-type').value = saved.type;
    if (saved.status) document.getElementById('ls-filter-status').value = saved.status;

    // Bind events
    document.getElementById('ls-filter-apply').addEventListener('click', () => this._applyFilters(focusAreas));
    document.getElementById('ls-filter-clear').addEventListener('click', () => this._clearFilters(focusAreas));

    container.querySelectorAll('input').forEach(el => {
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter') this._applyFilters(focusAreas);
      });
    });

    this._initMap();
    this._initPhotoTooltip();
    this._initAreaMultiSelect(focusAreas);

    this._applyFilters(focusAreas);
  },

  _initAreaMultiSelect(focusAreas) {
    const options = document.getElementById('ls-area-options');
    const dropdown = document.getElementById('ls-area-dropdown');
    const trigger = document.getElementById('ls-area-trigger');

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
      if (!e.target.closest('#ls-area-select')) dropdown.classList.remove('open');
    });

    if (this._selectedAreas.has('custom')) this._enableDraw();
    this._updateAreaTrigger(focusAreas);
  },

  _updateAreaTrigger(focusAreas) {
    const label = document.querySelector('#ls-area-trigger .multiselect-label');
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

  _initMap() {
    const listings = this._allListings;
    const lats = listings.filter(h => h.latitude).map(h => h.latitude);
    const lngs = listings.filter(h => h.longitude).map(h => h.longitude);

    let center = [36.07, -79.79];
    if (lats.length > 0) {
      center = [
        lats.reduce((a, b) => a + b, 0) / lats.length,
        lngs.reduce((a, b) => a + b, 0) / lngs.length,
      ];
    }

    this._map = L.map('ls-map').setView(center, 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(this._map);

    this._areaPolygonsLayer = L.featureGroup().addTo(this._map);
    this._drawnItems = L.featureGroup().addTo(this._map);
    this._markersLayer = L.layerGroup().addTo(this._map);

    this._drawControl = new L.Control.Draw({
      draw: {
        polygon: { allowIntersection: false, shapeOptions: { color: '#2563eb', weight: 2, fillOpacity: 0.1 } },
        polyline: false,
        rectangle: { shapeOptions: { color: '#2563eb', weight: 2, fillOpacity: 0.1 } },
        circle: false, circlemarker: false, marker: false,
      },
      edit: { featureGroup: this._drawnItems, remove: true },
    });

    this._map.on(L.Draw.Event.CREATED, (e) => {
      this._drawnItems.clearLayers();
      this._drawnItems.addLayer(e.layer);
      this._customPolygon = e.layer.getLatLngs()[0].map(ll => [ll.lat, ll.lng]);
      this._applyFilters(this._focusAreas);
    });

    this._map.on(L.Draw.Event.DELETED, () => {
      this._customPolygon = null;
      this._selectedAreas.delete('custom');
      const customCb = document.querySelector('#ls-area-options [data-key="custom"] input');
      if (customCb) customCb.checked = false;
      this._updateAreaTrigger(this._focusAreas);
      this._applyFilters(this._focusAreas);
    });

    this._map.on(L.Draw.Event.EDITED, () => {
      const layers = this._drawnItems.getLayers();
      if (layers.length > 0) {
        this._customPolygon = layers[0].getLatLngs()[0].map(ll => [ll.lat, ll.lng]);
        this._applyFilters(this._focusAreas);
      }
    });

    this._renderMarkers(this._allListings);
  },

  _enableDraw() {
    if (!this._map.hasLayer(this._drawControl)) this._map.addControl(this._drawControl);
  },

  _disableDraw() {
    if (this._drawControl._map) this._map.removeControl(this._drawControl);
    this._drawnItems.clearLayers();
  },

  _showAreaPolygons(areaNames, focusAreas, filteredItems) {
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
      this._areaPolygonsLayer.addLayer(rect);
      this._map.fitBounds(rect.getBounds(), { padding: [40, 40] });
    }
  },

  _markerColor(listing) {
    if (listing.price_change && listing.price_change < 0) return '#16a34a'; // green for price drop
    if (this._isNew(listing)) return '#ea580c'; // orange for new
    return '#2563eb'; // default blue
  },

  _isNew(listing) {
    if (!listing.first_seen) return false;
    try {
      const seen = new Date(listing.first_seen);
      const now = new Date();
      return (now - seen) / 86400000 <= this.NEW_DAYS;
    } catch { return false; }
  },

  _renderMarkers(listings) {
    this._markersLayer.clearLayers();
    this._markersByAddr = {};
    listings.forEach(h => {
      if (h.latitude == null || h.longitude == null) return;
      const color = this._markerColor(h);
      const marker = L.circleMarker([h.latitude, h.longitude], {
        radius: 5, fillColor: color, color: color, weight: 1, fillOpacity: 0.6,
      });
      marker.on('mouseover', (e) => {
        marker.setRadius(9);
        marker.setStyle({ fillOpacity: 0.95 });
        marker.bringToFront();
        const row = Array.from(document.querySelectorAll('#ls-results-table-wrap .clickable-row'))
          .find(r => r.dataset.addr === h.address);
        if (row) row.classList.add('row-map-highlight');
        const me = e.originalEvent;
        if (me) this._showPhoto(h, me.clientX, me.clientY);
      });
      marker.on('mouseout', () => {
        marker.setRadius(5);
        marker.setStyle({ fillOpacity: 0.6 });
        const row = Array.from(document.querySelectorAll('#ls-results-table-wrap .clickable-row'))
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
      bedsMin: document.getElementById('ls-filter-beds-min').value,
      bedsMax: document.getElementById('ls-filter-beds-max').value,
      bathsMin: document.getElementById('ls-filter-baths-min').value,
      bathsMax: document.getElementById('ls-filter-baths-max').value,
      sqftMin: document.getElementById('ls-filter-sqft-min').value,
      sqftMax: document.getElementById('ls-filter-sqft-max').value,
      priceMin: document.getElementById('ls-filter-price-min').value,
      priceMax: document.getElementById('ls-filter-price-max').value,
      hoa: document.getElementById('ls-filter-hoa').value,
      yearMin: document.getElementById('ls-filter-year-min').value,
      yearMax: document.getElementById('ls-filter-year-max').value,
      type: document.getElementById('ls-filter-type').value,
      status: document.getElementById('ls-filter-status').value,
    };
  },

  _clearFilters(focusAreas) {
    this._selectedAreas = new Set();
    document.querySelectorAll('#ls-area-options input[type="checkbox"]').forEach(cb => cb.checked = false);
    this._updateAreaTrigger(focusAreas);
    document.getElementById('ls-filter-beds-min').value = '';
    document.getElementById('ls-filter-beds-max').value = '';
    document.getElementById('ls-filter-baths-min').value = '';
    document.getElementById('ls-filter-baths-max').value = '';
    document.getElementById('ls-filter-sqft-min').value = '';
    document.getElementById('ls-filter-sqft-max').value = '';
    document.getElementById('ls-filter-price-min').value = '';
    document.getElementById('ls-filter-price-max').value = '';
    document.getElementById('ls-filter-hoa').value = '';
    document.getElementById('ls-filter-year-min').value = '';
    document.getElementById('ls-filter-year-max').value = '';
    document.getElementById('ls-filter-type').value = '';
    document.getElementById('ls-filter-status').value = '';
    this._customPolygon = null;
    this._disableDraw();
    this._areaPolygonsLayer.clearLayers();
    this._applyFilters(focusAreas);
  },

  _applyFilters(focusAreas) {
    const f = this._getFilters();
    Prefs.set('ls', f);
    let listings = [...this._allListings];

    // Area filter
    if (f.areas.includes('custom') && this._customPolygon) {
      listings = Utils.filterByArea(listings, { polygon: this._customPolygon });
    } else if (f.areas.length > 0 && !f.areas.includes('custom')) {
      const matched = new Set();
      f.areas.forEach(areaName => {
        const areaConfig = focusAreas.find(fa => fa.name === areaName);
        if (areaConfig) Utils.filterByArea(listings, areaConfig).forEach(h => matched.add(h));
      });
      listings = listings.filter(h => matched.has(h));
    }

    // Numeric filters
    if (f.bedsMin) listings = listings.filter(h => h.beds != null && h.beds >= Number(f.bedsMin));
    if (f.bedsMax) listings = listings.filter(h => h.beds != null && h.beds <= Number(f.bedsMax));
    if (f.bathsMin) listings = listings.filter(h => h.baths != null && h.baths >= Number(f.bathsMin));
    if (f.bathsMax) listings = listings.filter(h => h.baths != null && h.baths <= Number(f.bathsMax));
    if (f.sqftMin) listings = listings.filter(h => h.sqft && h.sqft >= Number(f.sqftMin));
    if (f.sqftMax) listings = listings.filter(h => h.sqft && h.sqft <= Number(f.sqftMax));
    if (f.priceMin) listings = listings.filter(h => h.list_price && h.list_price >= Number(f.priceMin));
    if (f.priceMax) listings = listings.filter(h => h.list_price && h.list_price <= Number(f.priceMax));
    if (f.hoa === 'none') listings = listings.filter(h => !h.hoa_monthly);
    if (f.hoa === 'has') listings = listings.filter(h => h.hoa_monthly && h.hoa_monthly > 0);
    if (f.yearMin) listings = listings.filter(h => h.year_built != null && h.year_built >= Number(f.yearMin));
    if (f.yearMax) listings = listings.filter(h => h.year_built != null && h.year_built <= Number(f.yearMax));
    if (f.type) listings = listings.filter(h => h.property_type === f.type);

    // Status filters
    if (f.status === 'new') listings = listings.filter(h => this._isNew(h));
    if (f.status === 'price-drop') listings = listings.filter(h => h.price_change && h.price_change < 0);

    this._filteredListings = listings;
    this._renderMarkers(listings);

    const namedAreas = f.areas.filter(a => a !== 'custom');
    if (namedAreas.length > 0) {
      this._showAreaPolygons(namedAreas, focusAreas, listings);
    }

    this._renderResults(listings);
  },

  _renderResults(listings) {
    // Summary stats
    const prices = listings.map(h => h.list_price).filter(v => v != null);
    const sqfts = listings.map(h => h.sqft).filter(v => v != null);
    const medianPrice = Utils.median(prices);
    const medianSqft = Utils.median(sqfts);
    const medianPpsf = Utils.median(listings.map(h => h.price_per_sqft).filter(v => v != null));
    const newCount = listings.filter(h => this._isNew(h)).length;
    const dropCount = listings.filter(h => h.price_change && h.price_change < 0).length;

    document.getElementById('ls-results-summary').innerHTML = `
      <span><strong>${listings.length}</strong> listings</span>
      <span>Median: <strong>${Utils.formatCurrency(medianPrice)}</strong></span>
      <span>Median SqFt: <strong>${Utils.formatNumber(medianSqft)}</strong></span>
      <span>Median $/SqFt: <strong>${Utils.formatCurrency(medianPpsf)}</strong></span>
      ${newCount > 0 ? `<span class="badge badge-new">${newCount} new</span>` : ''}
      ${dropCount > 0 ? `<span class="badge badge-drop">${dropCount} price drops</span>` : ''}
    `;

    // Sort
    listings.sort((a, b) => {
      const va = a[this._sortCol], vb = b[this._sortCol];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return this._sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });

    const display = listings.slice(0, 200);
    const sortIcon = (col) => this._sortCol === col ? (this._sortAsc ? ' \u25b2' : ' \u25bc') : '';

    const headers = [
      { col: 'first_seen', label: 'Listed' },
      { col: 'address', label: 'Address' },
      { col: 'city', label: 'City' },
      { col: 'list_price', label: 'Price' },
      { col: null, label: 'Value', sortable: false },
      { col: 'price_change', label: 'Price \u0394' },
      { col: 'hoa_monthly', label: 'HOA/mo' },
      { col: 'price_per_sqft', label: '$/SqFt' },
      { col: 'sqft', label: 'SqFt' },
      { col: 'beds', label: 'Bd' },
      { col: 'baths', label: 'Ba' },
      { col: 'year_built', label: 'Year' },
      { col: 'days_on_market', label: 'DOM' },
    ];

    const headerHtml = headers.map(h =>
      h.sortable === false
        ? `<th>${h.label}</th>`
        : `<th class="sortable" data-col="${h.col}">${h.label}${sortIcon(h.col)}</th>`
    ).join('');

    const rowsHtml = display.map(h => {
      const badges = [];
      if (this._isNew(h)) badges.push('<span class="badge badge-new">NEW</span>');
      if (h.price_change && h.price_change < 0) badges.push('<span class="badge badge-drop">DROP</span>');

      // Value indicator: compare asking price to median of sold comps
      const valueHtml = this._valueIndicator(h);

      // Price change display
      let priceChangeHtml = '\u2014';
      if (h.price_change && h.price_change !== 0) {
        const sign = h.price_change > 0 ? '+' : '';
        const cls = h.price_change < 0 ? 'delta-down' : 'delta-up';
        priceChangeHtml = `<span class="${cls}">${sign}${Utils.formatCurrency(h.price_change)}</span>`;
      }

      return `
        <tr class="clickable-row" data-addr="${(h.address || '').replace(/"/g, '&quot;')}">
          <td>${Utils.formatDate(h.first_seen)} ${badges.join(' ')}</td>
          <td class="addr-cell"><a href="${h.redfin_url || '#'}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${h.address || '\u2014'}</a></td>
          <td>${h.city || '\u2014'}</td>
          <td>${Utils.formatCurrency(h.list_price)}</td>
          <td>${valueHtml}</td>
          <td>${priceChangeHtml}</td>
          <td>${h.hoa_monthly != null ? Utils.formatCurrency(h.hoa_monthly) : '\u2014'}</td>
          <td>${Utils.formatCurrency(h.price_per_sqft)}</td>
          <td>${Utils.formatNumber(h.sqft)}</td>
          <td>${h.beds ?? '\u2014'}</td>
          <td>${h.baths ?? '\u2014'}</td>
          <td>${h.year_built ?? '\u2014'}</td>
          <td>${h.days_on_market ?? '\u2014'}</td>
        </tr>
      `;
    }).join('');

    document.getElementById('ls-results-table-wrap').innerHTML = `
      <table class="data-table">
        <thead><tr>${headerHtml}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      ${listings.length > 200 ? `<p class="table-note">Showing 200 of ${listings.length} results</p>` : ''}
    `;

    // Sortable headers
    document.querySelectorAll('#ls-results-table-wrap .sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (this._sortCol === col) {
          this._sortAsc = !this._sortAsc;
        } else {
          this._sortCol = col;
          this._sortAsc = col === 'address' || col === 'first_seen';
        }
        this._renderResults(this._filteredListings);
      });
    });

    // Row hover + click
    document.querySelectorAll('#ls-results-table-wrap .clickable-row').forEach(tr => {
      const addr = tr.dataset.addr;
      tr.addEventListener('mouseenter', (e) => {
        const marker = this._markersByAddr[addr];
        if (marker) { marker.setRadius(9); marker.setStyle({ fillOpacity: 0.95 }); marker.bringToFront(); }
        const home = listings.find(h => h.address === addr);
        if (home) this._showPhoto(home, e.clientX, e.clientY);
      });
      tr.addEventListener('mouseleave', () => {
        const marker = this._markersByAddr[addr];
        if (marker) { marker.setRadius(5); marker.setStyle({ fillOpacity: 0.6 }); }
        this._hidePhoto();
      });
      tr.addEventListener('click', () => {
        const listing = listings.find(h => h.address === addr);
        if (listing) this._showComps(listing);
      });
    });
  },

  _valueIndicator(listing) {
    if (!listing.list_price || !listing.zip_code) return '\u2014';

    // Find sold comps: same zip, similar beds (±1), similar sqft (±25%)
    const sqft = listing.sqft || 0;
    const beds = listing.beds || 0;
    const comps = this._allSold.filter(h =>
      h.zip_code === listing.zip_code &&
      h.beds != null && Math.abs(h.beds - beds) <= 1 &&
      h.sqft != null && sqft > 0 && h.sqft >= sqft * 0.75 && h.sqft <= sqft * 1.25 &&
      h.sale_price != null
    );

    if (comps.length < 2) return '\u2014';

    const medianSold = Utils.median(comps.map(h => h.sale_price));
    if (!medianSold) return '\u2014';

    const diff = ((listing.list_price - medianSold) / medianSold * 100).toFixed(0);
    const sign = diff >= 0 ? '+' : '';
    const cls = diff <= -3 ? 'delta-down' : diff >= 3 ? 'delta-up' : '';
    return `<span class="${cls}" title="vs median of ${comps.length} sold comps">${sign}${diff}%</span>`;
  },

  _showComps(listing) {
    const sqft = listing.sqft || 0;
    const beds = listing.beds || 0;
    const comps = this._allSold.filter(h =>
      h.zip_code === listing.zip_code &&
      h.beds != null && Math.abs(h.beds - beds) <= 1 &&
      h.sqft != null && sqft > 0 && h.sqft >= sqft * 0.75 && h.sqft <= sqft * 1.25 &&
      h.sale_price != null
    );

    const compPrices = comps.map(h => h.sale_price);
    const medianComp = Utils.median(compPrices);

    const assessedDiff = listing.total_assessed && listing.list_price
      ? ((listing.list_price - listing.total_assessed) / listing.total_assessed * 100).toFixed(1)
      : null;

    const compDiff = medianComp && listing.list_price
      ? ((listing.list_price - medianComp) / medianComp * 100).toFixed(1)
      : null;

    const priceDropInfo = listing.price_change && listing.price_change < 0
      ? `<div class="metric">
           <span class="metric-label">Price Drops</span>
           <span class="metric-value delta-down">${Utils.formatCurrency(listing.price_change)}</span>
           <span class="metric-delta">${listing.price_drop_count || 1} reduction${(listing.price_drop_count || 1) > 1 ? 's' : ''}</span>
         </div>`
      : '';

    document.getElementById('ls-comp-content').innerHTML = `
      <h3>Is This Price Reasonable?</h3>
      <div class="comp-header">
        <div class="comp-subject">
          ${listing.photo_url ? `<img class="comp-subject-photo" src="${listing.photo_url}" alt="${listing.address}">` : ''}
          <div class="comp-subject-info">
            <h4><a href="${listing.redfin_url || '#'}" target="_blank" rel="noopener">${listing.address}</a></h4>
            <p>${listing.city} ${listing.zip_code} \u00b7 ${listing.beds}bd/${listing.baths}ba \u00b7 ${Utils.formatNumber(listing.sqft)} sqft</p>
            <p class="comp-price">Asking: ${Utils.formatCurrency(listing.list_price)}</p>
          </div>
        </div>
        <div class="comp-metrics">
          <div class="metric">
            <span class="metric-label">vs. Assessed Value</span>
            <span class="metric-value">${listing.total_assessed ? Utils.formatCurrency(listing.total_assessed) : '\u2014'}</span>
            ${assessedDiff ? `<span class="metric-delta ${Number(assessedDiff) > 0 ? 'delta-up' : 'delta-down'}">${assessedDiff > 0 ? '+' : ''}${assessedDiff}%</span>` : ''}
          </div>
          <div class="metric">
            <span class="metric-label">vs. Median Sold Comp</span>
            <span class="metric-value">${medianComp ? Utils.formatCurrency(medianComp) : '\u2014'}</span>
            ${compDiff ? `<span class="metric-delta ${Number(compDiff) > 0 ? 'delta-up' : 'delta-down'}">${compDiff > 0 ? '+' : ''}${compDiff}%</span>` : ''}
          </div>
          <div class="metric">
            <span class="metric-label">Sold Comps</span>
            <span class="metric-value">${comps.length}</span>
          </div>
          ${priceDropInfo}
        </div>
      </div>
      <div id="ls-comp-map" class="comp-map"></div>
      ${comps.length > 0 ? `
        <table class="data-table comp-table">
          <thead><tr>
            <th>Sold</th><th>Address</th><th>Price</th><th>$/SqFt</th><th>SqFt</th><th>Bd/Ba</th>
          </tr></thead>
          <tbody>
            ${comps.slice(0, 15).map(c => `
              <tr>
                <td>${Utils.formatDate(c.sold_date)}</td>
                <td class="addr-cell"><a href="${c.redfin_url || '#'}" target="_blank" rel="noopener">${c.address}</a></td>
                <td>${Utils.formatCurrency(c.sale_price)}</td>
                <td>${Utils.formatCurrency(c.price_per_sqft)}</td>
                <td>${Utils.formatNumber(c.sqft)}</td>
                <td>${c.beds}/${c.baths}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<p class="empty-state">No comparable recent sales found in the same zip code with similar specs.</p>'}
    `;

    document.getElementById('ls-comp-card').style.display = 'block';
    document.getElementById('ls-comp-backdrop').style.display = 'block';
    this._initCompMap(listing, comps);
    this._initCompTableHovers(comps.slice(0, 15), document.getElementById('ls-comp-content'));
  },

  _initCompMap(listing, comps) {
    if (this._compMap) { this._compMap.remove(); this._compMap = null; }
    this._compMarkersByAddr = {};
    const mapEl = document.getElementById('ls-comp-map');
    if (!mapEl) return;

    const compPts = comps.filter(c => c.latitude != null && c.longitude != null);
    const hasSubject = listing.latitude != null && listing.longitude != null;

    if (!hasSubject && compPts.length === 0) { mapEl.style.display = 'none'; return; }

    const map = L.map(mapEl, { zoomControl: true, scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 19,
    }).addTo(map);

    // Comp markers — blue (sold homes)
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

    // Subject marker — red (active listing)
    if (hasSubject) {
      L.circleMarker([listing.latitude, listing.longitude], {
        radius: 8, fillColor: '#ef4444', color: '#dc2626', weight: 2, fillOpacity: 0.9,
      }).bindTooltip(`${listing.address || ''} (listing)`, { permanent: false }).addTo(map);
    }

    const allPts = [
      ...(hasSubject ? [[listing.latitude, listing.longitude]] : []),
      ...compPts.map(c => [c.latitude, c.longitude]),
    ];
    if (allPts.length === 1) { map.setView(allPts[0], 14); }
    else { map.fitBounds(L.latLngBounds(allPts), { padding: [24, 24] }); }

    this._compMap = map;
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

  _hideComps() {
    document.getElementById('ls-comp-card').style.display = 'none';
    document.getElementById('ls-comp-backdrop').style.display = 'none';
    if (this._compMap) { this._compMap.remove(); this._compMap = null; }
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

  _showPhoto(listing, x, y) {
    clearTimeout(this._photoTimeout);
    if (!listing.photo_url) return;
    this._photoTimeout = setTimeout(() => {
      const tip = this._photoTooltip;
      tip.querySelector('.photo-tooltip-img').src = listing.photo_url;
      tip.querySelector('.photo-tooltip-address').textContent = listing.address || '';
      tip.querySelector('.photo-tooltip-price').textContent = Utils.formatCurrency(listing.list_price || listing.sale_price);
      const specs = [
        listing.beds != null ? `${listing.beds}bd` : null,
        listing.baths != null ? `${listing.baths}ba` : null,
        listing.sqft ? `${Utils.formatNumber(listing.sqft)} sqft` : null,
      ].filter(Boolean).join(' · ');
      tip.querySelector('.photo-tooltip-specs').textContent = specs;
      tip.querySelector('.photo-tooltip-location').textContent =
        [listing.neighborhood, listing.city, listing.zip_code].filter(Boolean).join(' ');
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
};
