"use strict";

(function languageFamilyAtlasModule(global) {
  const SCHEMA_VERSION = 1;
  const VALID_VIEWS = new Set(["compare", "traditional", "contemporary"]);

  function normalizeSearchTerm(value) {
    return String(value ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("en")
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizeLongitude(value) {
    let longitude = finiteNumber(value, 0);
    longitude = ((longitude + 180) % 360 + 360) % 360 - 180;
    return Math.abs(longitude) < 1e-9 ? 0 : longitude;
  }

  function parseHash(hash) {
    const raw = String(hash ?? "").replace(/^#/, "");
    const params = new URLSearchParams(raw);
    const requestedView = params.get("view") || "compare";
    const centerParts = (params.get("center") || "0,10").split(",");
    const center = [
      normalizeLongitude(centerParts[0]),
      Math.max(-85, Math.min(85, finiteNumber(centerParts[1], 10))),
    ];
    return {
      view: VALID_VIEWS.has(requestedView) ? requestedView : "compare",
      family: (params.get("family") || "").trim() || null,
      center,
      zoom: Math.max(1, Math.min(24, finiteNumber(params.get("zoom"), 1))),
      sign: params.get("sign") === "1",
      contact: params.get("contact") === "1",
    };
  }

  function compactNumber(value, digits = 3) {
    const rounded = Number(finiteNumber(value, 0).toFixed(digits));
    return Object.is(rounded, -0) ? "0" : String(rounded);
  }

  function serializeHash(state = {}) {
    const view = VALID_VIEWS.has(state.view) ? state.view : "compare";
    const center = Array.isArray(state.center) ? state.center : [0, 10];
    const family = String(state.family || "").trim();
    const fields = [
      `view=${view}`,
      `family=${encodeURIComponent(family)}`,
      `center=${compactNumber(normalizeLongitude(center[0]))},${compactNumber(Math.max(-85, Math.min(85, finiteNumber(center[1], 10))))}`,
      `zoom=${compactNumber(Math.max(1, Math.min(24, finiteNumber(state.zoom, 1))), 2)}`,
      `sign=${state.sign ? 1 : 0}`,
      `contact=${state.contact ? 1 : 0}`,
    ];
    return `#${fields.join("&")}`;
  }

  function lineageIdentifier(lineage) {
    return String(lineage?.id || lineage?.glottocode || lineage?.lineageId || "").trim();
  }

  function lineageDisplayName(lineage) {
    return String(lineage?.name || lineage?.title || lineageIdentifier(lineage) || "Unnamed lineage");
  }

  function searchScore(term, query) {
    if (!term || !query) return Infinity;
    if (term === query) return 0;
    if (term.startsWith(query)) return 10 + Math.min(term.length - query.length, 8) / 10;
    const wordIndex = term.indexOf(` ${query}`);
    if (wordIndex >= 0) return 20 + wordIndex / 100;
    const index = term.indexOf(query);
    if (index >= 0) return 30 + index / 100;
    const tokens = query.split(" ");
    if (tokens.length > 1 && tokens.every((token) => term.includes(token))) return 40;
    return Infinity;
  }

  function searchCatalogue(query, catalogue = {}, limit = 8) {
    const normalizedQuery = normalizeSearchTerm(query);
    if (!normalizedQuery) return [];

    const lineages = Array.isArray(catalogue.lineages) ? catalogue.lineages : [];
    const lineageById = new Map(lineages.map((lineage) => [lineageIdentifier(lineage), lineage]));
    const scored = new Map();
    const addLineageTerm = (lineageId, rawTerm, label) => {
      const lineage = lineageById.get(String(lineageId || ""));
      if (!lineage) return;
      const term = normalizeSearchTerm(rawTerm);
      const score = searchScore(term, normalizedQuery);
      if (!Number.isFinite(score)) return;
      const id = lineageIdentifier(lineage);
      const current = scored.get(id);
      if (!current || score < current.score) {
        scored.set(id, {
          kind: "lineage",
          lineageId: id,
          name: lineageDisplayName(lineage),
          type: lineage.type || (lineage.isolate ? "isolate" : "family"),
          matchedTerm: String(label || rawTerm || lineageDisplayName(lineage)),
          score,
        });
      }
    };

    for (const lineage of lineages) {
      const id = lineageIdentifier(lineage);
      addLineageTerm(id, lineageDisplayName(lineage));
      addLineageTerm(id, id);
      const aliases = lineage.aliases || lineage.alternateNames || [];
      for (const alias of Array.isArray(aliases) ? aliases : [aliases]) {
        addLineageTerm(id, alias);
      }
    }

    const searchRecords = Array.isArray(catalogue.search)
      ? catalogue.search
      : Object.entries(catalogue.search || {}).flatMap(([key, value]) => {
        if (typeof value === "string") return [{ term: key, lineageId: value }];
        if (Array.isArray(value)) {
          return value.map((item) => typeof item === "string"
            ? ({ term: key, lineageId: item })
            : ({ term: key, ...item }));
        }
        if (value && typeof value === "object") return [{ term: key, ...value }];
        return [];
      });
    for (const record of searchRecords) {
      const lineageId = record.lineageId || record.lineage_id || record.id || record.familyId;
      const terms = record.terms || [
        record.term,
        record.name,
        record.language,
        record.languageName,
        record.glottocode,
      ];
      for (const term of Array.isArray(terms) ? terms : [terms]) {
        if (term) addLineageTerm(lineageId, term, term);
      }
    }

    const disputed = [];
    const disputedRecords = Array.isArray(catalogue.disputedTerms)
      ? catalogue.disputedTerms
      : Object.entries(catalogue.disputedTerms || {}).map(([term, value]) => (
        typeof value === "string" ? { term, explanation: value } : { term, ...value }
      ));
    for (const record of disputedRecords) {
      const rawTerm = record.term || record.name || record.title;
      const score = searchScore(normalizeSearchTerm(rawTerm), normalizedQuery);
      if (!Number.isFinite(score)) continue;
      disputed.push({
        kind: "disputed",
        id: `disputed:${normalizeSearchTerm(rawTerm)}`,
        name: record.title || record.name || rawTerm,
        term: rawTerm,
        explanation: record.explanation || record.note || "This cover term is not treated as a demonstrated genealogical family.",
        score: score - (score === 0 ? 1 : 0),
      });
    }

    return [...scored.values(), ...disputed]
      .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
      .slice(0, Math.max(1, finiteNumber(limit, 8)));
  }

  const helpers = Object.freeze({
    SCHEMA_VERSION,
    normalizeSearchTerm,
    parseHash,
    serializeHash,
    searchCatalogue,
  });

  global.LanguageFamilyAtlas = helpers;
  global.LanguageAtlas = helpers;

  if (typeof document === "undefined" || typeof document.querySelector !== "function") return;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootAtlas, { once: true });
  } else {
    bootAtlas();
  }

  function bootAtlas() {
    const d3 = global.d3;
    const topojson = global.topojson;
    const mapSvgNode = document.getElementById("family-map");
    if (!mapSvgNode) return;

    const els = {
      map: mapSvgNode,
      mapFrame: document.getElementById("map-frame"),
      mapStatus: document.getElementById("map-status"),
      tooltip: document.getElementById("map-tooltip"),
      slider: document.getElementById("comparison-slider"),
      comparisonControl: document.getElementById("comparison-control"),
      seamHandle: document.querySelector(".seam-handle"),
      search: document.getElementById("lineage-search"),
      searchResults: document.getElementById("search-results"),
      viewButtons: {
        traditional: document.getElementById("view-traditional"),
        compare: document.getElementById("view-compare"),
        contemporary: document.getElementById("view-contemporary"),
      },
      zoomIn: document.getElementById("zoom-in"),
      zoomOut: document.getElementById("zoom-out"),
      resetView: document.getElementById("reset-view"),
      pacificView: document.getElementById("pacific-view"),
      countries: document.getElementById("toggle-countries"),
      points: document.getElementById("toggle-points"),
      historical: document.getElementById("toggle-historical"),
      sign: document.getElementById("toggle-sign"),
      contact: document.getElementById("toggle-contact"),
      layersButton: document.getElementById("layers-button"),
      layersPanel: document.getElementById("control-panel"),
      closeLayers: document.getElementById("close-layers"),
      detailPanel: document.getElementById("detail-panel"),
      detailEmpty: document.getElementById("detail-empty"),
      detailContent: document.getElementById("detail-content"),
      detailType: document.getElementById("detail-type"),
      detailName: document.getElementById("detail-name"),
      detailId: document.getElementById("detail-id"),
      detailFacts: document.getElementById("detail-facts"),
      detailNote: document.getElementById("detail-note"),
      detailAlso: document.getElementById("detail-also"),
      detailLink: document.getElementById("detail-link"),
      closeDetail: document.getElementById("close-detail"),
      sourcesButton: document.getElementById("sources-button"),
      sourcesDialog: document.getElementById("sources-dialog"),
      closeSources: document.getElementById("close-sources"),
      sourceSummary: document.getElementById("source-summary"),
      sourceList: document.getElementById("source-list"),
    };

    if (!d3 || !topojson) {
      setStatus("The local map runtime could not be loaded. The source notes remain available.", true);
      return;
    }

    const PALETTE = [
      "#4477aa", "#ee6677", "#228833", "#ccbb44", "#66ccee", "#aa3377",
      "#bbbbbb", "#e08b38", "#6b8e23", "#8c6bb1", "#3b9ab2", "#d95f02",
    ];
    const DATA_PATHS = {
      land: ["data/land.topo.json", "data/map.topojson"],
      traditional: ["data/traditional.topo.json", "data/map.topojson"],
      contemporary: ["data/contemporary.topo.json", "data/map.topojson"],
      catalogue: ["data/catalogue.json", "data/catalog.json"],
      manifest: ["data/source-manifest.json", "data/sources.json"],
    };

    const initialHash = parseHash(global.location?.hash || "");
    const state = {
      view: initialHash.view,
      seam: 50,
      center: initialHash.center,
      zoom: initialHash.zoom,
      centralMeridian: Math.abs(initialHash.center[0]) > 130 ? 160 : 0,
      selectedId: initialHash.family,
      selectedAlso: [],
      searchIndex: -1,
      searchResults: [],
      transform: d3.zoomIdentity,
      transformReady: false,
      draggingSeam: false,
      ignoreClick: false,
      pointerFrame: 0,
      hashTimer: 0,
      resizeFrame: 0,
      warned: [],
      data: {
        catalogue: { lineages: [], search: [], disputedTerms: [], points: [], signs: [], contacts: [] },
        manifest: null,
        land: [],
        countries: [],
        lakes: [],
        traditional: [],
        contemporary: [],
      },
      loaded: {
        land: false,
        traditional: false,
        contemporary: false,
        catalogue: false,
        manifest: false,
      },
      failed: new Set(),
      lineageById: new Map(),
      renderedPoints: [],
    };

    els.sign.checked = initialHash.sign;
    els.contact.checked = initialHash.contact;

    let width = 1;
    let height = 1;
    let projection = d3.geoEqualEarth();
    let path = d3.geoPath(projection);
    let zoomBehavior;

    const svg = d3.select(els.map);
    const defs = svg.append("defs");
    const leftClipRect = defs.append("clipPath")
      .attr("id", "traditional-clip")
      .attr("clipPathUnits", "userSpaceOnUse")
      .append("rect");
    const rightClipRect = defs.append("clipPath")
      .attr("id", "contemporary-clip")
      .attr("clipPathUnits", "userSpaceOnUse")
      .append("rect");

    const baseWorld = svg.append("g").attr("class", "base-world");
    const traditionalClip = svg.append("g").attr("clip-path", "url(#traditional-clip)");
    const traditionalWorld = traditionalClip.append("g").attr("class", "traditional-world");
    const contemporaryClip = svg.append("g").attr("clip-path", "url(#contemporary-clip)");
    const contemporaryWorld = contemporaryClip.append("g").attr("class", "contemporary-world");
    const referenceWorld = svg.append("g").attr("class", "reference-world");
    const overlayWorld = svg.append("g").attr("class", "overlay-world");
    const traditionalLabelsClip = svg.append("g").attr("clip-path", "url(#traditional-clip)");
    const traditionalLabels = traditionalLabelsClip.append("g").attr("class", "traditional-labels");
    const contemporaryLabelsClip = svg.append("g").attr("clip-path", "url(#contemporary-clip)");
    const contemporaryLabels = contemporaryLabelsClip.append("g").attr("class", "contemporary-labels");
    const allWorldGroups = [baseWorld, traditionalWorld, contemporaryWorld, referenceWorld, overlayWorld, traditionalLabels, contemporaryLabels];

    baseWorld.append("path").datum({ type: "Sphere" }).attr("class", "ocean-sphere");
    baseWorld.append("path").datum(d3.geoGraticule10()).attr("class", "graticule");

    const fetchCache = new Map();

    function setStatus(message, isError = false, hide = false) {
      if (!els.mapStatus) return;
      if (hide) {
        els.mapStatus.hidden = true;
        els.mapFrame.setAttribute("aria-busy", "false");
        return;
      }
      els.mapStatus.hidden = false;
      els.mapStatus.classList.toggle("is-error", isError);
      els.mapStatus.innerHTML = isError
        ? `<span aria-hidden="true">!</span> ${escapeHtml(message)}`
        : `<span class="spinner" aria-hidden="true"></span> ${escapeHtml(message)}`;
      els.mapFrame.setAttribute("aria-busy", isError ? "false" : "true");
    }

    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function loadJson(url) {
      if (!fetchCache.has(url)) {
        fetchCache.set(url, fetch(url, { credentials: "same-origin", cache: "no-cache" }).then((response) => {
          if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
          return response.json();
        }));
      }
      return fetchCache.get(url);
    }

    async function loadFirst(paths, validator) {
      const failures = [];
      for (const url of paths) {
        try {
          const value = await loadJson(url);
          if (!validator || validator(value)) return { value, url };
          failures.push(`${url}: required object missing`);
        } catch (error) {
          failures.push(error.message);
        }
      }
      throw new Error(failures.join("; "));
    }

    function topologyHasObject(preferred) {
      return (value) => Boolean(value?.objects && (value.objects[preferred] || (preferred === "areas" && Object.keys(value.objects).length === 1)));
    }

    function topologyFeatures(topology, objectName) {
      if (!topology?.objects) return [];
      let object = topology.objects[objectName];
      if (!object && objectName === "areas" && Object.keys(topology.objects).length === 1) {
        object = topology.objects[Object.keys(topology.objects)[0]];
      }
      if (!object) return [];
      const converted = topojson.feature(topology, object);
      return converted.type === "FeatureCollection" ? converted.features : [converted];
    }

    function combinedObjectFeatures(topology, requestedName) {
      if (!topology?.objects?.[requestedName]) return [];
      const converted = topojson.feature(topology, topology.objects[requestedName]);
      return converted.type === "FeatureCollection" ? converted.features : [converted];
    }

    function getTopologyFeatures(topology, requestedName, sourceUrl) {
      if (sourceUrl.endsWith("map.topojson")) return combinedObjectFeatures(topology, requestedName);
      return topologyFeatures(topology, requestedName === "traditional" || requestedName === "contemporary" ? "areas" : requestedName);
    }

    function schemaVersionOf(value) {
      return Number(value?.schemaVersion ?? value?.schema_version ?? value?.version);
    }

    function validateSchema(value, label) {
      const version = schemaVersionOf(value);
      if (version !== SCHEMA_VERSION) {
        throw new Error(`${label} uses schema ${Number.isFinite(version) ? version : "unknown"}; this atlas supports schema ${SCHEMA_VERSION}.`);
      }
    }

    function featureId(feature) {
      return String(feature?.properties?.id || feature?.properties?.glottocode || feature?.properties?.lineageId || feature?.id || "").trim();
    }

    function hashCode(value) {
      let hash = 2166136261;
      const string = String(value);
      for (let i = 0; i < string.length; i += 1) {
        hash ^= string.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    }

    function lineageForId(id) {
      return state.lineageById.get(String(id || "")) || null;
    }

    function featureName(feature) {
      const id = featureId(feature);
      return lineageDisplayName(lineageForId(id) || feature?.properties || { id });
    }

    function featureIsIsolate(feature) {
      const lineage = lineageForId(featureId(feature));
      return Boolean(feature?.properties?.isolate || lineage?.isolate || String(lineage?.type || "").toLowerCase() === "isolate");
    }

    function colorForId(id, feature) {
      const lineage = lineageForId(id);
      return feature?.properties?.color || lineage?.color || PALETTE[hashCode(id) % PALETTE.length];
    }

    function currentMapCenter() {
      if (!state.transformReady || !projection.invert) return state.center;
      const basePoint = state.transform.invert([width / 2, height / 2]);
      const center = projection.invert(basePoint);
      return center && center.every(Number.isFinite) ? center : state.center;
    }

    function transformForCenter(center, zoom = 1) {
      const projected = projection(center);
      if (!projected) return d3.zoomIdentity;
      return d3.zoomIdentity
        .translate(width / 2 - projected[0] * zoom, height / 2 - projected[1] * zoom)
        .scale(zoom);
    }

    function updateWorldTransforms(transform) {
      state.transform = transform;
      state.zoom = transform.k;
      for (const group of allWorldGroups) group.attr("transform", transform);
      svg.selectAll("text.lineage-label")
        .style("font-size", function labelSize() {
          return `${(this.classList.contains("is-minor") ? 7 : 9) / transform.k}px`;
        });
      overlayWorld.selectAll("g.point-item")
        .attr("transform", (item) => `translate(${item.projected[0]},${item.projected[1]}) scale(${1 / transform.k})`);
      state.renderedPoints = state.renderedPoints.map((item) => ({
        ...item,
        screen: transform.apply(item.projected),
      }));
      scheduleHashUpdate();
    }

    function configureProjection(preserveCenter = true) {
      const oldCenter = preserveCenter && state.transformReady ? currentMapCenter() : state.center;
      const oldZoom = state.transformReady ? state.transform.k : state.zoom;
      const rect = els.mapFrame.getBoundingClientRect();
      width = Math.max(240, Math.round(rect.width || 960));
      height = Math.max(240, Math.round(rect.height || 620));
      svg.attr("viewBox", `0 0 ${width} ${height}`);
      projection = d3.geoEqualEarth()
        .rotate([-state.centralMeridian, 0, 0])
        .precision(0.25)
        .fitExtent([[10, 10], [width - 10, height - 10]], { type: "Sphere" });
      path = d3.geoPath(projection);

      baseWorld.select(".ocean-sphere").attr("d", path);
      baseWorld.select(".graticule").attr("d", path);
      renderBaseGeometry();
      renderAreaLayer("traditional");
      renderAreaLayer("contemporary");
      updateClips();

      const nextTransform = transformForCenter(oldCenter, oldZoom);
      state.transformReady = true;
      svg.call(zoomBehavior.transform, nextTransform);
    }

    function renderBaseGeometry() {
      baseWorld.selectAll("path.land")
        .data(state.data.land)
        .join("path")
        .attr("class", "land")
        .attr("d", path);

      referenceWorld.selectAll("path.lake")
        .data(state.data.lakes)
        .join("path")
        .attr("class", "lake")
        .attr("d", path);

      referenceWorld.selectAll("path.country-boundary")
        .data(state.data.countries)
        .join("path")
        .attr("class", "country-boundary")
        .attr("d", path)
        .style("display", els.countries.checked ? null : "none");
    }

    function areaKey(feature, index) {
      return `${featureId(feature) || "unknown"}:${index}`;
    }

    function renderAreaLayer(layerName) {
      const features = state.data[layerName];
      const group = layerName === "traditional" ? traditionalWorld : contemporaryWorld;
      const haloData = features.filter(featureIsIsolate);

      group.selectAll("path.area-isolate-halo")
        .data(haloData, areaKey)
        .join("path")
        .attr("class", "area-isolate-halo")
        .attr("d", path);

      group.selectAll("path.area")
        .data(features, areaKey)
        .join("path")
        .attr("class", (feature) => `area${featureIsIsolate(feature) ? " is-isolate" : ""}`)
        .attr("data-lineage-id", featureId)
        .attr("data-layer", layerName)
        .attr("fill", (feature) => colorForId(featureId(feature), feature))
        .attr("d", path);

      updateSelectionStyles();
      renderLabels(layerName);
    }

    function preferredLabelCoordinate(feature) {
      const lineage = lineageForId(featureId(feature));
      const candidate = lineage?.label || feature?.properties?.label;
      if (Array.isArray(candidate) && candidate.length >= 2 && candidate.every(Number.isFinite)) return candidate;
      if (Number.isFinite(lineage?.labelLongitude) && Number.isFinite(lineage?.labelLatitude)) {
        return [lineage.labelLongitude, lineage.labelLatitude];
      }
      return d3.geoCentroid(feature);
    }

    function representativeLabelFeatures(features) {
      const representatives = new Map();
      for (const feature of features) {
        const id = featureId(feature);
        if (!id) continue;
        const area = d3.geoArea(feature);
        const previous = representatives.get(id);
        if (!previous || area > previous.area) representatives.set(id, { feature, area });
      }
      return [...representatives.values()].map(({ feature }) => feature);
    }

    function renderLabels(layerName) {
      if (!state.transformReady) return;
      const features = representativeLabelFeatures(state.data[layerName]);
      const group = layerName === "traditional" ? traditionalLabels : contemporaryLabels;
      const threshold = state.transform.k >= 3.5 ? 650 : state.transform.k >= 1.8 ? 1800 : 6000;
      const candidates = [];

      for (const feature of features) {
        const bounds = path.bounds(feature);
        const areaPixels = Math.max(0, bounds[1][0] - bounds[0][0])
          * Math.max(0, bounds[1][1] - bounds[0][1])
          * state.transform.k * state.transform.k;
        const selected = featureId(feature) === state.selectedId;
        if (!selected && areaPixels < threshold) continue;
        const coordinate = preferredLabelCoordinate(feature);
        const projected = projection(coordinate);
        if (!projected || !projected.every(Number.isFinite)) continue;
        const screen = state.transform.apply(projected);
        if (screen[0] < -30 || screen[0] > width + 30 || screen[1] < -20 || screen[1] > height + 20) continue;
        candidates.push({ feature, coordinate, projected, screen, areaPixels, selected });
      }

      candidates.sort((a, b) => Number(b.selected) - Number(a.selected) || b.areaPixels - a.areaPixels);
      const occupied = [];
      const accepted = [];
      for (const candidate of candidates) {
        const name = featureName(candidate.feature);
        const box = {
          x1: candidate.screen[0] - Math.min(72, 4.1 * name.length),
          x2: candidate.screen[0] + Math.min(72, 4.1 * name.length),
          y1: candidate.screen[1] - 7,
          y2: candidate.screen[1] + 7,
        };
        const collision = occupied.some((other) => box.x1 < other.x2 && box.x2 > other.x1 && box.y1 < other.y2 && box.y2 > other.y1);
        if (!collision || candidate.selected) {
          accepted.push(candidate);
          occupied.push(box);
        }
        if (accepted.length >= 55) break;
      }

      group.selectAll("text.lineage-label")
        .data(accepted, (candidate) => featureId(candidate.feature))
        .join("text")
        .attr("class", (candidate) => `lineage-label${candidate.areaPixels < 5000 ? " is-minor" : ""}`)
        .attr("x", (candidate) => candidate.projected[0])
        .attr("y", (candidate) => candidate.projected[1])
        .style("font-size", (candidate) => `${(candidate.areaPixels < 5000 ? 7 : 9) / state.transform.k}px`)
        .text((candidate) => featureName(candidate.feature));
    }

    function pointCoordinates(point) {
      const coordinates = point?.coordinates
        || (Array.isArray(point?.location) ? point.location : point?.location?.coordinates);
      const lon = point?.lon ?? point?.longitude ?? (Array.isArray(coordinates) ? coordinates[0] : undefined);
      const lat = point?.lat ?? point?.latitude ?? (Array.isArray(coordinates) ? coordinates[1] : undefined);
      return [Number(lon), Number(lat)];
    }

    function validPoint(point) {
      const [lon, lat] = pointCoordinates(point);
      return Number.isFinite(lon) && Number.isFinite(lat) && lat >= -90 && lat <= 90;
    }

    function normalizedPoint(point, category) {
      const coordinates = pointCoordinates(point);
      const candidateId = point.lineageId || point.lineage_id || point.familyId || point.lineage || "";
      const lineageId = String(candidateId || (lineageForId(point.id) ? point.id : ""));
      return {
        ...point,
        coordinates,
        category,
        lineageId,
        name: point.name || lineageDisplayName(lineageForId(lineageId) || { id: lineageId }),
      };
    }

    function selectedRawPoints() {
      const points = [];
      if (els.points.checked) {
        for (const point of state.data.catalogue.points || []) {
          const extinct = Boolean(point.extinct || point.historical || point.status === "extinct");
          const lineageId = point.lineageId || point.lineage_id || point.familyId || point.lineage;
          if (!extinct || els.historical.checked || lineageId === state.selectedId) {
            if (validPoint(point)) points.push(normalizedPoint(point, extinct ? "historical" : "lineage"));
          }
        }
      } else if (els.historical.checked) {
        for (const point of state.data.catalogue.points || []) {
          if ((point.extinct || point.historical || point.status === "extinct") && validPoint(point)) {
            points.push(normalizedPoint(point, "historical"));
          }
        }
      }
      if (els.sign.checked) {
        for (const point of state.data.catalogue.signs || state.data.catalogue.signLanguages || []) {
          if (validPoint(point)) points.push(normalizedPoint(point, "sign"));
        }
      }
      if (els.contact.checked) {
        for (const point of state.data.catalogue.contacts || state.data.catalogue.contactLanguages || []) {
          if (validPoint(point)) points.push(normalizedPoint(point, "contact"));
        }
      }
      return points;
    }

    function clusterPoints(points) {
      if (state.transform.k >= 2) {
        return points.map((point) => ({
          kind: "point",
          members: [point],
          category: point.category,
          projected: projection(point.coordinates),
        }));
      }
      const buckets = new Map();
      for (const point of points) {
        const projected = projection(point.coordinates);
        if (!projected) continue;
        const screen = state.transform.apply(projected);
        const key = `${point.category}:${Math.round(screen[0] / 42)}:${Math.round(screen[1] / 42)}`;
        if (!buckets.has(key)) buckets.set(key, { category: point.category, members: [], sumX: 0, sumY: 0 });
        const bucket = buckets.get(key);
        bucket.members.push(point);
        bucket.sumX += projected[0];
        bucket.sumY += projected[1];
      }
      return [...buckets.values()].map((bucket) => ({
        kind: bucket.members.length > 1 ? "cluster" : "point",
        members: bucket.members,
        category: bucket.category,
        projected: [bucket.sumX / bucket.members.length, bucket.sumY / bucket.members.length],
      }));
    }

    function renderPointOverlays() {
      if (!state.transformReady) return;
      const rendered = clusterPoints(selectedRawPoints()).filter((item) => item.projected?.every(Number.isFinite));
      const symbol = d3.symbol().type(d3.symbolDiamond).size(66);
      const points = overlayWorld.selectAll("g.point-item")
        .data(rendered, (item, index) => `${item.category}:${item.members.map((member) => member.id || member.name).join("|")}:${index}`)
        .join((enter) => enter.append("g").attr("class", "point-item"), (update) => update, (exit) => exit.remove())
        .attr("transform", (item) => `translate(${item.projected[0]},${item.projected[1]}) scale(${1 / state.transform.k})`);

      points.each(function drawPoint(item) {
        const group = d3.select(this);
        group.selectAll("*").remove();
        const categoryClass = `map-point--${item.kind === "cluster" ? "cluster" : item.category}`;
        if (item.kind === "cluster") {
          const radius = Math.min(13, 7 + Math.log2(item.members.length) * 1.5);
          group.append("circle").attr("class", `map-point ${categoryClass}`).attr("r", radius);
          group.append("text").attr("class", "cluster-count").attr("dy", "0.34em").text(item.members.length);
        } else if (item.category === "lineage" || item.category === "historical") {
          group.append("path").attr("class", `map-point ${categoryClass}`).attr("d", symbol());
        } else {
          group.append("circle").attr("class", `map-point ${categoryClass}`).attr("r", 4.7);
        }
      });

      state.renderedPoints = rendered.map((item) => ({
        ...item,
        screen: state.transform.apply(item.projected),
      }));
    }

    function updateSelectionStyles() {
      svg.selectAll("path.area")
        .classed("is-selected", (feature) => featureId(feature) === state.selectedId)
        .classed("is-dimmed", (feature) => Boolean(state.selectedId) && featureId(feature) !== state.selectedId);
    }

    function updateClips() {
      let split = state.seam / 100 * width;
      if (state.view === "traditional") split = width;
      if (state.view === "contemporary") split = 0;
      leftClipRect.attr("x", 0).attr("y", 0).attr("width", Math.max(0, split)).attr("height", height);
      rightClipRect.attr("x", Math.max(0, split)).attr("y", 0).attr("width", Math.max(0, width - split)).attr("height", height);
      els.mapFrame.dataset.view = state.view;
      els.mapFrame.style.setProperty("--seam", `${state.seam}%`);
      for (const [name, button] of Object.entries(els.viewButtons)) {
        button.setAttribute("aria-pressed", String(name === state.view));
      }
      const traditionalShare = Math.round(state.seam);
      els.slider.setAttribute("aria-valuetext", `Traditional ${traditionalShare} percent; Atlas-era contemporary ${100 - traditionalShare} percent`);
    }

    function activeFeaturesAtX(x) {
      if (state.view === "traditional") return { layer: "Traditional / homeland", features: state.data.traditional };
      if (state.view === "contemporary") return { layer: "Atlas-era contemporary", features: state.data.contemporary };
      return x <= width * state.seam / 100
        ? { layer: "Traditional / homeland", features: state.data.traditional }
        : { layer: "Atlas-era contemporary", features: state.data.contemporary };
    }

    function identifyAt(localPoint) {
      const [x, y] = localPoint;
      const basePoint = state.transform.invert([x, y]);
      const coordinate = projection.invert(basePoint);
      const active = activeFeaturesAtX(x);
      const hits = [];
      const seen = new Set();

      if (coordinate) {
        for (const feature of active.features) {
          try {
            if (!d3.geoContains(feature, coordinate)) continue;
          } catch (_error) {
            continue;
          }
          const id = featureId(feature);
          if (!id || seen.has(`lineage:${id}`)) continue;
          seen.add(`lineage:${id}`);
          hits.push({ kind: "lineage", id, name: featureName(feature), layer: active.layer, feature });
        }
      }

      for (const point of state.renderedPoints) {
        const distance = Math.hypot(point.screen[0] - x, point.screen[1] - y);
        if (distance > (point.kind === "cluster" ? 16 : 11)) continue;
        if (point.kind === "cluster") {
          hits.unshift({
            kind: "cluster",
            id: `cluster:${point.category}:${point.screen.join(":")}`,
            name: `${point.members.length} ${point.category === "sign" ? "signed languages" : point.category === "contact" ? "contact languages" : "language locations"}`,
            point,
          });
        } else {
          const member = point.members[0];
          const id = member.lineageId;
          const key = id && lineageForId(id) ? `lineage:${id}` : `point:${member.id || member.name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          hits.unshift({
            kind: id && lineageForId(id) ? "lineage" : "point",
            id: id || member.id || member.name,
            name: member.name,
            layer: point.category === "sign" ? "Signed language" : point.category === "contact" ? "APiCS contact-language sample" : point.category === "historical" ? "Historical point" : "Supplemental point",
            point,
          });
        }
      }

      hits.sort((a, b) => {
        if (a.kind === "cluster" && b.kind !== "cluster") return -1;
        if (a.kind !== "cluster" && b.kind === "cluster") return 1;
        if (a.id === state.selectedId) return -1;
        if (b.id === state.selectedId) return 1;
        return a.name.localeCompare(b.name);
      });
      return { hits, coordinate, layer: active.layer };
    }

    function pointerLocal(event) {
      return d3.pointer(event, els.map);
    }

    function positionTooltip(event) {
      const margin = 12;
      const box = els.tooltip.getBoundingClientRect();
      let left = event.clientX + 14;
      let top = event.clientY + 14;
      if (left + box.width > global.innerWidth - margin) left = event.clientX - box.width - 14;
      if (top + box.height > global.innerHeight - margin) top = event.clientY - box.height - 14;
      els.tooltip.style.left = `${Math.max(margin, left)}px`;
      els.tooltip.style.top = `${Math.max(margin, top)}px`;
    }

    function showTooltip(event, result) {
      const { hits, coordinate, layer } = result;
      if (!hits.length) {
        els.tooltip.hidden = true;
        return;
      }
      const names = hits.map((hit) => hit.name);
      const heading = names.length === 1 ? names[0] : `${names.length} lineages or records here`;
      const list = names.length > 1
        ? `<ul class="tooltip-list">${names.slice(0, 8).map((name) => `<li>${escapeHtml(name)}</li>`).join("")}${names.length > 8 ? `<li>and ${names.length - 8} more…</li>` : ""}</ul>`
        : "";
      const location = coordinate
        ? `${Math.abs(coordinate[1]).toFixed(1)}°${coordinate[1] < 0 ? "S" : "N"}, ${Math.abs(coordinate[0]).toFixed(1)}°${coordinate[0] < 0 ? "W" : "E"}`
        : "";
      els.tooltip.innerHTML = `<strong>${escapeHtml(heading)}</strong><span>${escapeHtml(hits[0].layer || layer)}${location ? ` · ${escapeHtml(location)}` : ""}</span>${list}`;
      els.tooltip.hidden = false;
      positionTooltip(event);
    }

    function handlePointerMove(event) {
      if (state.draggingSeam || event.buttons) {
        els.tooltip.hidden = true;
        return;
      }
      const clientX = event.clientX;
      const clientY = event.clientY;
      cancelAnimationFrame(state.pointerFrame);
      state.pointerFrame = requestAnimationFrame(() => {
        showTooltip({ clientX, clientY }, identifyAt(pointerLocal(event)));
      });
    }

    function selectLineage(id, also = [], openPanel = true) {
      const lineage = lineageForId(id);
      if (!lineage) return false;
      state.selectedId = lineageIdentifier(lineage);
      state.selectedAlso = also.filter((candidate) => candidate.kind === "lineage" && candidate.id !== state.selectedId);
      updateSelectionStyles();
      renderLabels("traditional");
      renderLabels("contemporary");
      renderPointOverlays();
      renderLineageDetail(lineage);
      if (openPanel && global.matchMedia("(max-width: 780px)").matches) openSheet(els.detailPanel);
      scheduleHashUpdate(true);
      return true;
    }

    function coverageText(value) {
      if (value === true) return "Mapped";
      if (value === false || value === null || value === undefined || value === "") return "No polygon";
      if (typeof value === "number") return value > 0 ? "Mapped" : "No polygon";
      if (typeof value === "object") {
        const mapped = value.mapped ?? value.hasPolygon ?? value.covered;
        const records = value.records ?? value.recordCount ?? value.areas;
        if (mapped === false) return "No polygon";
        if (mapped === true && Number.isFinite(Number(records))) return `Mapped (${Number(records).toLocaleString("en-US")} source areas)`;
        if (mapped === true) return "Mapped";
      }
      return String(value);
    }

    function appendFact(term, description) {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = term;
      dd.textContent = description;
      els.detailFacts.append(dt, dd);
    }

    function renderLineageDetail(lineage) {
      const id = lineageIdentifier(lineage);
      const isolate = Boolean(lineage.isolate || String(lineage.type).toLowerCase() === "isolate");
      els.detailEmpty.hidden = true;
      els.detailContent.hidden = false;
      els.detailType.textContent = isolate ? "Language isolate" : "Language family";
      els.detailName.textContent = lineageDisplayName(lineage);
      els.detailId.textContent = id;
      els.detailFacts.replaceChildren();
      appendFact("Status", lineage.status || "Spoken lineage");
      if (lineage.macroarea) appendFact("Macroarea", String(lineage.macroarea));
      const languageCount = lineage.languageCount ?? lineage.documentedLanguageCount ?? lineage.languages;
      if (Number.isFinite(Number(languageCount))) appendFact("Documented languages", Number(languageCount).toLocaleString("en-US"));
      appendFact("Traditional / homeland", coverageText(lineage.traditionalCoverage ?? lineage.traditionalMapped));
      appendFact("Atlas-era contemporary", coverageText(lineage.contemporaryCoverage ?? lineage.contemporaryMapped));
      const hasMappedArea = Boolean(
        lineage.traditionalCoverage
        || lineage.traditionalMapped
        || lineage.contemporaryCoverage
        || lineage.contemporaryMapped,
      );
      els.detailNote.textContent = lineage.notes || lineage.note || (hasMappedArea
        ? "Mapped areas are generalized source geometries and may overlap other lineages."
        : "No area polygon is available in these sources; the atlas may show only a documented reference location.");
      const glottologUrl = lineage.glottologUrl || `https://glottolog.org/resource/languoid/id/${encodeURIComponent(id)}`;
      els.detailLink.href = glottologUrl;
      els.detailLink.hidden = !id;
      renderAlsoHere();
    }

    function renderAlsoHere() {
      const also = state.selectedAlso;
      if (!also.length) {
        els.detailAlso.hidden = true;
        els.detailAlso.replaceChildren();
        return;
      }
      els.detailAlso.hidden = false;
      els.detailAlso.innerHTML = `<p>Also at this place</p>${also.slice(0, 8).map((hit) => `<button type="button" class="also-button" data-lineage-id="${escapeHtml(hit.id)}">${escapeHtml(hit.name)}</button>`).join("")}`;
    }

    function showDisputedDetail(result) {
      state.selectedId = null;
      state.selectedAlso = [];
      updateSelectionStyles();
      els.detailEmpty.hidden = true;
      els.detailContent.hidden = false;
      els.detailType.textContent = "Cover term / disputed proposal";
      els.detailName.textContent = result.name;
      els.detailId.textContent = result.term || "";
      els.detailFacts.replaceChildren();
      appendFact("Atlas treatment", "Not mapped as a family");
      els.detailNote.textContent = result.explanation;
      els.detailAlso.hidden = true;
      els.detailLink.hidden = true;
      if (global.matchMedia("(max-width: 780px)").matches) openSheet(els.detailPanel);
      scheduleHashUpdate(true);
    }

    function showPointDetail(hit) {
      const member = hit.point?.members?.[0] || {};
      state.selectedId = null;
      updateSelectionStyles();
      els.detailEmpty.hidden = true;
      els.detailContent.hidden = false;
      els.detailType.textContent = hit.layer || "Point record";
      els.detailName.textContent = hit.name;
      els.detailId.textContent = member.id || "";
      els.detailFacts.replaceChildren();
      if (member.status) appendFact("Status", member.status);
      if (member.classification) appendFact("Classification", member.classification);
      els.detailNote.textContent = member.note || (member.category === "contact" ? "This is part of the non-exhaustive APiCS sample and is not a genealogical territory." : "This point marks a documented location; it does not imply a territorial boundary.");
      const url = member.glottologUrl || member.url;
      els.detailLink.hidden = !url;
      if (url) els.detailLink.href = url;
      els.detailAlso.hidden = true;
      if (global.matchMedia("(max-width: 780px)").matches) openSheet(els.detailPanel);
    }

    function clearSelection() {
      state.selectedId = null;
      state.selectedAlso = [];
      updateSelectionStyles();
      els.detailContent.hidden = true;
      els.detailEmpty.hidden = false;
      els.detailPanel.classList.remove("is-open");
      document.body.classList.remove("sheet-open");
      renderLabels("traditional");
      renderLabels("contemporary");
      renderPointOverlays();
      scheduleHashUpdate(true);
    }

    function activateMapHit(event) {
      if (state.ignoreClick || state.draggingSeam) return;
      const result = identifyAt(pointerLocal(event));
      if (!result.hits.length) {
        clearSelection();
        return;
      }
      const primary = result.hits[0];
      if (primary.kind === "cluster") {
        const coordinates = projection.invert(primary.point.projected)
          || primary.point.members[0]?.coordinates;
        const target = coordinates || result.coordinate || currentMapCenter();
        setMapCenter(target, Math.max(2.2, state.transform.k * 1.8), true);
        return;
      }
      if (primary.kind === "lineage" && selectLineage(primary.id, result.hits.slice(1))) return;
      showPointDetail(primary);
    }

    function renderSearchResults() {
      const results = state.searchResults;
      els.searchResults.replaceChildren();
      if (!results.length) {
        els.searchResults.hidden = true;
        els.search.setAttribute("aria-expanded", "false");
        els.search.removeAttribute("aria-activedescendant");
        return;
      }
      const fragment = document.createDocumentFragment();
      results.forEach((result, index) => {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.id = `search-result-${index}`;
        li.setAttribute("aria-selected", String(index === state.searchIndex));
        const button = document.createElement("button");
        button.type = "button";
        button.className = "search-result";
        button.dataset.searchIndex = String(index);
        button.setAttribute("aria-selected", String(index === state.searchIndex));
        const secondary = result.kind === "disputed"
          ? "Not mapped as a demonstrated family"
          : result.matchedTerm !== result.name ? `${result.type || "Family"} · matched ${result.matchedTerm}` : (result.type || "Language family");
        button.innerHTML = `<strong>${escapeHtml(result.name)}</strong><small>${escapeHtml(secondary)}</small>`;
        li.append(button);
        fragment.append(li);
      });
      els.searchResults.append(fragment);
      els.searchResults.hidden = false;
      els.search.setAttribute("aria-expanded", "true");
      if (state.searchIndex >= 0) els.search.setAttribute("aria-activedescendant", `search-result-${state.searchIndex}`);
      else els.search.removeAttribute("aria-activedescendant");
    }

    function updateSearch() {
      state.searchResults = searchCatalogue(els.search.value, state.data.catalogue, 9);
      state.searchIndex = -1;
      renderSearchResults();
    }

    function activateSearchResult(index) {
      const result = state.searchResults[index];
      if (!result) return;
      els.search.value = result.name;
      state.searchResults = [];
      state.searchIndex = -1;
      renderSearchResults();
      if (result.kind === "disputed") showDisputedDetail(result);
      else if (selectLineage(result.lineageId, [], true)) zoomToLineage(result.lineageId);
    }

    function zoomToLineage(id) {
      const candidates = [...state.data.traditional, ...state.data.contemporary].filter((feature) => featureId(feature) === id);
      if (!candidates.length) {
        const point = (state.data.catalogue.points || []).find((candidate) => (candidate.lineageId || candidate.lineage_id) === id && validPoint(candidate));
        if (point) setMapCenter(pointCoordinates(point), Math.max(3, state.transform.k), true);
        return;
      }
      const collection = { type: "FeatureCollection", features: candidates };
      const [[x0, y0], [x1, y1]] = path.bounds(collection);
      const targetZoom = Math.max(1, Math.min(10, 0.7 / Math.max((x1 - x0) / width, (y1 - y0) / height)));
      const centerProjected = [(x0 + x1) / 2, (y0 + y1) / 2];
      const coordinate = projection.invert(centerProjected);
      if (coordinate) setMapCenter(coordinate, targetZoom, true);
    }

    function renderSources() {
      const manifest = state.data.manifest;
      if (!manifest) {
        els.sourceSummary.textContent = "The source manifest could not be loaded. The map itself may still be explored.";
        return;
      }
      const counts = manifest.counts || {};
      const families = counts.genealogicalFamilies ?? counts.families ?? 238;
      const isolates = counts.isolates ?? 183;
      const total = counts.mainLineages ?? counts.lineages ?? Number(families) + Number(isolates);
      els.sourceSummary.textContent = `${Number(total).toLocaleString("en-US")} independent spoken genealogical lineages are shown: ${Number(families).toLocaleString("en-US")} families and ${Number(isolates).toLocaleString("en-US")} isolates. Classification follows Glottolog 5.3; the Glottography 2.0 geometries were assembled against Glottolog 5.2. The retired Somahai ID soma1242 is explicitly remapped to the current Momuna isolate momu1241. Glottolog’s raw top-level family table also contains eight non-genealogical buckets, excluded here.`;
      const sources = Array.isArray(manifest.sources)
        ? manifest.sources
        : Object.entries(manifest.sources || {}).map(([name, source]) => ({ name, ...source }));
      els.sourceList.replaceChildren();
      for (const source of sources) {
        const li = document.createElement("li");
        const name = source.name || source.title || source.dataset || "Source dataset";
        const version = source.version ? ` ${source.version}` : "";
        const sourceUrl = source.landingUrl || source.homepage || source.url;
        if (sourceUrl && /^https?:\/\//.test(sourceUrl)) {
          const link = document.createElement("a");
          link.href = sourceUrl;
          link.target = "_blank";
          link.rel = "noopener";
          link.textContent = `${name}${version}`;
          li.append(link);
        } else {
          li.textContent = `${name}${version}`;
        }
        if (source.license) {
          li.append(" — ");
          if (typeof source.license === "object") {
            const licenseName = source.license.id || source.license.name || source.license.title || "licence";
            if (source.license.url && /^https?:\/\//.test(source.license.url)) {
              const licenseLink = document.createElement("a");
              licenseLink.href = source.license.url;
              licenseLink.target = "_blank";
              licenseLink.rel = "noopener";
              licenseLink.textContent = licenseName;
              li.append(licenseLink);
            } else {
              li.append(licenseName);
            }
          } else {
            li.append(String(source.license));
          }
        }
        els.sourceList.append(li);
      }
    }

    function scheduleHashUpdate(immediate = false) {
      if (!state.transformReady || !global.history?.replaceState) return;
      clearTimeout(state.hashTimer);
      const write = () => {
        const hash = serializeHash({
          view: state.view,
          family: state.selectedId,
          center: currentMapCenter(),
          zoom: state.transform.k,
          sign: els.sign.checked,
          contact: els.contact.checked,
        });
        if (global.location.hash !== hash) global.history.replaceState(null, "", hash);
      };
      if (immediate) write();
      else state.hashTimer = global.setTimeout(write, 140);
    }

    function setMapCenter(center, zoom, animate = false) {
      if (!center || !center.every(Number.isFinite)) return;
      const transform = transformForCenter(center, Math.max(1, Math.min(24, zoom)));
      const reduceMotion = global.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (animate && !reduceMotion) svg.transition().duration(420).call(zoomBehavior.transform, transform);
      else svg.call(zoomBehavior.transform, transform);
    }

    function setView(view, allowLoad = true) {
      if (!VALID_VIEWS.has(view)) return;
      state.view = view;
      updateClips();
      scheduleHashUpdate(true);
      if (allowLoad && (view === "compare" || view === "contemporary") && !state.loaded.contemporary && !state.failed.has("contemporary")) {
        setStatus("Loading the Atlas-era contemporary layer…");
        loadContemporary();
      }
    }

    function updateSeam(value) {
      state.seam = Math.max(0, Math.min(100, Number(value)));
      els.slider.value = String(state.seam);
      updateClips();
    }

    function seamFromClientX(clientX) {
      const rect = els.mapFrame.getBoundingClientRect();
      updateSeam((clientX - rect.left) / rect.width * 100);
    }

    function startSeamDrag(event) {
      if (state.view !== "compare") return;
      event.preventDefault();
      event.stopPropagation();
      state.draggingSeam = true;
      state.ignoreClick = true;
      els.seamHandle.setPointerCapture?.(event.pointerId);
      seamFromClientX(event.clientX);
    }

    function moveSeamDrag(event) {
      if (!state.draggingSeam) return;
      event.preventDefault();
      seamFromClientX(event.clientX);
    }

    function endSeamDrag(event) {
      if (!state.draggingSeam) return;
      state.draggingSeam = false;
      els.seamHandle.releasePointerCapture?.(event.pointerId);
      global.setTimeout(() => { state.ignoreClick = false; }, 0);
    }

    function openSheet(panel) {
      els.layersPanel.classList.toggle("is-open", panel === els.layersPanel);
      els.detailPanel.classList.toggle("is-open", panel === els.detailPanel);
      document.body.classList.add("sheet-open");
      els.layersButton.setAttribute("aria-expanded", String(panel === els.layersPanel));
    }

    function closeSheets() {
      els.layersPanel.classList.remove("is-open");
      els.detailPanel.classList.remove("is-open");
      document.body.classList.remove("sheet-open");
      els.layersButton.setAttribute("aria-expanded", "false");
    }

    function bindInteractions() {
      for (const [view, button] of Object.entries(els.viewButtons)) {
        button.addEventListener("click", () => setView(view));
      }

      els.slider.addEventListener("input", () => updateSeam(els.slider.value));
      els.seamHandle.addEventListener("pointerdown", startSeamDrag);
      els.seamHandle.addEventListener("pointermove", moveSeamDrag);
      els.seamHandle.addEventListener("pointerup", endSeamDrag);
      els.seamHandle.addEventListener("pointercancel", endSeamDrag);

      els.zoomIn.addEventListener("click", () => svg.transition().duration(180).call(zoomBehavior.scaleBy, 1.5));
      els.zoomOut.addEventListener("click", () => svg.transition().duration(180).call(zoomBehavior.scaleBy, 1 / 1.5));
      els.resetView.addEventListener("click", () => {
        state.centralMeridian = 0;
        state.center = [0, 10];
        state.zoom = 1;
        configureProjection(false);
      });
      els.pacificView.addEventListener("click", () => {
        state.centralMeridian = 160;
        state.center = [160, 5];
        state.zoom = 1;
        configureProjection(false);
      });

      els.countries.addEventListener("change", renderBaseGeometry);
      for (const input of [els.points, els.historical, els.sign, els.contact]) {
        input.addEventListener("change", () => {
          renderPointOverlays();
          scheduleHashUpdate(true);
        });
      }

      els.map.addEventListener("pointermove", handlePointerMove);
      els.map.addEventListener("pointerleave", () => { els.tooltip.hidden = true; });
      els.map.addEventListener("click", activateMapHit);
      els.map.addEventListener("keydown", (event) => {
        const step = event.shiftKey ? 100 : 42;
        if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          svg.call(zoomBehavior.scaleBy, 1.4);
        } else if (event.key === "-") {
          event.preventDefault();
          svg.call(zoomBehavior.scaleBy, 1 / 1.4);
        } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault();
          const dx = event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0;
          const dy = event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0;
          svg.call(zoomBehavior.translateBy, dx / state.transform.k, dy / state.transform.k);
        } else if (event.key === "Home" || event.key === "0") {
          event.preventDefault();
          state.centralMeridian = 0;
          state.center = [0, 10];
          state.zoom = 1;
          configureProjection(false);
        } else if (event.key === "Escape") {
          clearSelection();
          els.tooltip.hidden = true;
        }
      });

      els.search.addEventListener("input", updateSearch);
      els.search.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          state.searchIndex = Math.min(state.searchResults.length - 1, state.searchIndex + 1);
          renderSearchResults();
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          state.searchIndex = Math.max(0, state.searchIndex - 1);
          renderSearchResults();
        } else if (event.key === "Enter") {
          if (!state.searchResults.length) return;
          event.preventDefault();
          activateSearchResult(state.searchIndex >= 0 ? state.searchIndex : 0);
        } else if (event.key === "Escape") {
          state.searchResults = [];
          state.searchIndex = -1;
          renderSearchResults();
        }
      });
      els.search.addEventListener("blur", () => global.setTimeout(() => {
        if (!els.searchResults.contains(document.activeElement)) {
          state.searchResults = [];
          state.searchIndex = -1;
          renderSearchResults();
        }
      }, 120));
      els.searchResults.addEventListener("click", (event) => {
        const button = event.target.closest("[data-search-index]");
        if (button) activateSearchResult(Number(button.dataset.searchIndex));
      });

      els.detailAlso.addEventListener("click", (event) => {
        const button = event.target.closest("[data-lineage-id]");
        if (button) selectLineage(button.dataset.lineageId, state.selectedAlso.filter((hit) => hit.id !== button.dataset.lineageId));
      });
      els.closeDetail.addEventListener("click", clearSelection);

      els.layersButton.addEventListener("click", () => openSheet(els.layersPanel));
      els.closeLayers.addEventListener("click", closeSheets);

      els.sourcesButton.addEventListener("click", () => {
        if (typeof els.sourcesDialog.showModal === "function") els.sourcesDialog.showModal();
        else els.sourcesDialog.setAttribute("open", "");
      });
      els.closeSources.addEventListener("click", () => {
        if (typeof els.sourcesDialog.close === "function") els.sourcesDialog.close();
        else els.sourcesDialog.removeAttribute("open");
      });
      els.sourcesDialog.addEventListener("click", (event) => {
        if (event.target === els.sourcesDialog && typeof els.sourcesDialog.close === "function") els.sourcesDialog.close();
      });

      document.addEventListener("click", (event) => {
        if (!els.search.contains(event.target) && !els.searchResults.contains(event.target)) {
          state.searchResults = [];
          state.searchIndex = -1;
          renderSearchResults();
        }
      });

      global.addEventListener("hashchange", applyExternalHash);
    }

    function configureZoom() {
      zoomBehavior = d3.zoom()
        .scaleExtent([1, 24])
        .filter((event) => {
          if (state.draggingSeam) return false;
          if (event.target?.closest?.(".seam-handle, .comparison-control, button, input")) return false;
          return (!event.ctrlKey || event.type === "wheel") && !event.button;
        })
        .on("start", (event) => {
          const source = event.sourceEvent;
          state.zoomStart = source ? [source.clientX, source.clientY] : null;
          els.tooltip.hidden = true;
        })
        .on("zoom", (event) => {
          const source = event.sourceEvent;
          if (source && state.zoomStart && Math.hypot(source.clientX - state.zoomStart[0], source.clientY - state.zoomStart[1]) > 4) {
            state.ignoreClick = true;
          }
          updateWorldTransforms(event.transform);
        })
        .on("end", () => {
          state.center = currentMapCenter();
          renderLabels("traditional");
          renderLabels("contemporary");
          renderPointOverlays();
          global.setTimeout(() => { state.ignoreClick = false; }, 0);
        });
      svg.call(zoomBehavior).on("dblclick.zoom", null);
    }

    function applyExternalHash() {
      const next = parseHash(global.location.hash);
      state.view = next.view;
      els.sign.checked = next.sign;
      els.contact.checked = next.contact;
      const desiredMeridian = Math.abs(next.center[0]) > 130 ? 160 : 0;
      if (desiredMeridian !== state.centralMeridian) {
        state.centralMeridian = desiredMeridian;
        state.center = next.center;
        state.zoom = next.zoom;
        configureProjection(false);
      } else {
        setMapCenter(next.center, next.zoom, false);
      }
      updateClips();
      renderPointOverlays();
      if (next.family) selectLineage(next.family, [], false);
      else if (state.selectedId) clearSelection();
    }

    function noteFailure(kind, error) {
      state.failed.add(kind);
      console.warn(`[language-family-atlas] ${kind} failed`, error);
      refreshLoadStatus();
    }

    function refreshLoadStatus() {
      const workingLayers = Number(state.loaded.traditional) + Number(state.loaded.contemporary);
      const failedLayers = ["land", "traditional", "contemporary"].filter((kind) => state.failed.has(kind));
      if (failedLayers.length) {
        const labels = failedLayers.map((kind) => kind === "land" ? "base geography" : `${kind} areas`);
        const friendly = labels.length > 2
          ? `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`
          : labels.join(" and ");
        setStatus(`${friendly[0].toUpperCase()}${friendly.slice(1)} could not be loaded. ${workingLayers ? "The available layer remains usable." : "Please reload or check the local data files."}`, true);
      } else if (state.loaded.traditional && state.loaded.contemporary) {
        setStatus("", false, true);
      } else if (state.loaded.traditional) {
        setStatus("Traditional areas ready; loading the Atlas-era layer…");
      } else if (state.loaded.contemporary) {
        setStatus("Atlas-era areas ready; the traditional layer is unavailable.", true);
      }
    }

    async function loadCatalogue() {
      try {
        const { value } = await loadFirst(DATA_PATHS.catalogue, (candidate) => Array.isArray(candidate?.lineages));
        validateSchema(value, "Catalogue");
        state.data.catalogue = {
          ...value,
          points: value.points || [],
          signs: value.signs || value.signLanguages || [],
          contacts: value.contacts || value.contactLanguages || [],
        };
        state.lineageById = new Map(state.data.catalogue.lineages.map((lineage) => [lineageIdentifier(lineage), lineage]));
        state.loaded.catalogue = true;
        els.search.disabled = false;
        renderAreaLayer("traditional");
        renderAreaLayer("contemporary");
        renderPointOverlays();
        if (state.selectedId) selectLineage(state.selectedId, [], false);
      } catch (error) {
        els.search.disabled = true;
        els.search.placeholder = "Search unavailable: catalogue did not load";
        noteFailure("catalogue", error);
      }
    }

    async function loadManifest() {
      try {
        const { value } = await loadFirst(DATA_PATHS.manifest, (candidate) => candidate && typeof candidate === "object");
        validateSchema(value, "Source manifest");
        state.data.manifest = value;
        state.loaded.manifest = true;
        renderSources();
      } catch (error) {
        noteFailure("manifest", error);
        renderSources();
      }
    }

    async function loadLand() {
      try {
        const { value, url } = await loadFirst(DATA_PATHS.land, (candidate) => Boolean(candidate?.objects?.land));
        state.data.land = getTopologyFeatures(value, "land", url);
        state.data.countries = getTopologyFeatures(value, "countries", url);
        state.data.lakes = getTopologyFeatures(value, "lakes", url);
        state.loaded.land = true;
        renderBaseGeometry();
      } catch (error) {
        noteFailure("land", error);
      }
    }

    async function loadTraditional() {
      try {
        const { value, url } = await loadFirst(DATA_PATHS.traditional, (candidate) => Boolean(candidate?.objects?.areas || candidate?.objects?.traditional));
        state.data.traditional = getTopologyFeatures(value, "traditional", url);
        state.loaded.traditional = true;
        renderAreaLayer("traditional");
        refreshLoadStatus();
      } catch (error) {
        noteFailure("traditional", error);
      }
    }

    let contemporaryPromise = null;
    function loadContemporary() {
      if (contemporaryPromise) return contemporaryPromise;
      contemporaryPromise = (async () => {
        try {
          const { value, url } = await loadFirst(DATA_PATHS.contemporary, (candidate) => Boolean(candidate?.objects?.areas || candidate?.objects?.contemporary));
          state.data.contemporary = getTopologyFeatures(value, "contemporary", url);
          state.loaded.contemporary = true;
          renderAreaLayer("contemporary");
          refreshLoadStatus();
        } catch (error) {
          noteFailure("contemporary", error);
        }
      })();
      return contemporaryPromise;
    }

    function queueContemporaryLoad() {
      const start = () => {
        if (!state.loaded.contemporary && !state.failed.has("contemporary")) loadContemporary();
      };
      if (state.view === "compare" || state.view === "contemporary") global.setTimeout(start, 60);
      else if ("requestIdleCallback" in global) global.requestIdleCallback(start, { timeout: 1800 });
      else global.setTimeout(start, 700);
    }

    function observeResize() {
      const onResize = () => {
        cancelAnimationFrame(state.resizeFrame);
        state.resizeFrame = requestAnimationFrame(() => {
          const rect = els.mapFrame.getBoundingClientRect();
          const nextWidth = Math.max(240, Math.round(rect.width || 960));
          const nextHeight = Math.max(240, Math.round(rect.height || 620));
          if (state.transformReady && nextWidth === width && nextHeight === height) return;
          configureProjection(true);
        });
      };
      if ("ResizeObserver" in global) new ResizeObserver(onResize).observe(els.mapFrame);
      else global.addEventListener("resize", onResize);
    }

    configureZoom();
    configureProjection(false);
    updateSeam(50);
    setView(state.view, false);
    bindInteractions();
    observeResize();
    els.search.disabled = true;

    Promise.allSettled([loadCatalogue(), loadManifest(), loadLand(), loadTraditional()])
      .then(() => {
        if (state.loaded.traditional) queueContemporaryLoad();
        else loadContemporary();
        refreshLoadStatus();
      });
  }
})(typeof window !== "undefined" ? window : globalThis);
