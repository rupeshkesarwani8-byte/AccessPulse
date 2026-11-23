
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  Activity, AlertCircle, ArrowRight, Check, CheckCircle2,
  ChevronDown, ClipboardList, Clock3, FileText, Footprints,
  Home, Info, Layers, LogIn, LogOut, Map as MapIcon, MapPin, Menu,
  Navigation, PlusCircle, RefreshCw, Search, ShieldCheck,
  SlidersHorizontal, X, BarChart3, Download
} from "lucide-react";
import {
  CircleMarker, LayersControl, MapContainer, Popup, TileLayer, useMap,
  useMapEvents
} from "react-leaflet";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip
} from "recharts";
import { api } from "./services/api";
import "./App.css";

const TYPES = [
  ["missing_ramp", "Missing curb ramp"],
  ["blocked_path", "Blocked footpath"],
  ["stairs", "Stairs or steps"],
  ["broken_sidewalk", "Broken sidewalk"],
  ["inaccessible_crossing", "Inaccessible crossing"],
  ["other", "Other barrier"],
];

const STATUS_COLORS = {
  verified: "#19d4a2",
  pending: "#ffbf47",
  rejected: "#ff4f70",
  resolved: "#7aa7ff",
};

const TYPE_COLORS = [
  "#20e0c0", "#22a9ff", "#ffbf47",
  "#ff874f", "#a78bfa", "#91afd0"
];

const ADMIN_TOKEN_KEY = "accesspulse_admin_token";

// A new report within this distance of an existing report of the same type
// triggers a duplicate warning before it is submitted.
const DUPLICATE_RADIUS_METERS = 50;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png"];

function distanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(a));
}

// UX-only check. Real security is enforced by the backend.
function isTokenExpired(token) {
  try {
    const payload = token.split(".")[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const data = JSON.parse(atob(padded));
    return typeof data.exp !== "number" || data.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

function readStoredToken() {
  const stored = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (!stored) return "";
  if (isTokenExpired(stored)) {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    return "";
  }
  return stored;
}

function StatusBadge({ status }) {
  return <span className={`status-badge ${status}`}>{status}</span>;
}

function Sidebar({
  page, setPage, mobileOpen, setMobileOpen, isAdmin, logout
}) {
  const nav = [
    { id: "dashboard", label: "Dashboard", icon: Home },
    { id: "map", label: "Explore Map", icon: MapIcon },
    { id: "report", label: "Report a Barrier", icon: PlusCircle },
    { id: "reports", label: "View Reports", icon: ClipboardList },
  ];

  return (
    <>
      {mobileOpen && (
        <button
          className="mobile-scrim"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        />
      )}

      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <button className="brand" onClick={() => setPage("dashboard")}>
          <span className="brand-mark">A</span>
          <span>
            <strong>Access<span>Pulse</span></strong>
            <small>More Accessible. Together.</small>
          </span>
        </button>

        <nav className="nav-list" aria-label="Main navigation">
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "active" : ""}`}
              aria-current={page === id ? "page" : undefined}
              onClick={() => {
                setPage(id);
                setMobileOpen(false);
              }}
            >
              <Icon size={20} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="nav-divider" />
        <div className="nav-label">ADMIN</div>

        <button
          className={`nav-item ${page === "admin" ? "active" : ""}`}
          aria-current={page === "admin" ? "page" : undefined}
          onClick={() => {
            setPage("admin");
            setMobileOpen(false);
          }}
        >
          <ShieldCheck size={20} />
          <span>{isAdmin ? "Admin Session" : "Admin Login"}</span>
        </button>

        {isAdmin && (
          <button className="nav-item" onClick={logout}>
            <LogOut size={19} />
            <span>Log out</span>
          </button>
        )}

        <div className="sidebar-bottom">
          <div className="access-art">
            <Footprints size={43} />
            <Navigation size={27} />
            <Activity size={34} />
          </div>
          <p>Accessible cities<br />are stronger cities.</p>
        </div>
      </aside>
    </>
  );
}

function Topbar({ search, setSearch, isAdmin, setPage, setMobileOpen }) {
  return (
    <header className="topbar">
      <button
        className="mobile-menu icon-button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
      >
        <Menu />
      </button>

      <label className="global-search">
        <Search size={18} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search reports, locations or descriptions..."
          aria-label="Search reports"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            aria-label="Clear search"
          >
            <X size={15} />
          </button>
        )}
      </label>

      <div className="topbar-right">
        <span className="health-dot" aria-hidden="true" />      
        <button className="profile-button" onClick={() => setPage("admin")}>
          <span className="avatar"><ShieldCheck size={17} /></span>
          <span>{isAdmin ? "Admin" : "Guest"}</span>
          <ChevronDown size={14} />
        </button>
      </div>
    </header>
  );
}

function StatCard({ title, value, caption, icon: Icon, tone }) {
  return (
    <article className="stat-card">
      <div className={`stat-icon ${tone}`}><Icon size={24} /></div>
      <div className="stat-copy">
        <span>{title}</span>
        <strong>{value}</strong>
        <small>{caption}</small>
      </div>
    </article>
  );
}

function MapClickHandler({ onSelect, enabled }) {
  useMapEvents({
    click(event) {
      if (enabled) {
        onSelect({
          latitude: event.latlng.lat,
          longitude: event.latlng.lng
        });
      }
    },
  });

  return null;
}

function MapSelectionController({ selected }) {
  const map = useMapEvents({});

  useEffect(() => {
    if (selected?.latitude != null && selected?.longitude != null) {
      map.flyTo(
        [selected.latitude, selected.longitude],
        Math.max(map.getZoom(), 16),
        { animate: true, duration: 0.8 }
      );
    }
  }, [map, selected]);

  return null;
}

// Short names -> list of full names to try in order (first one that is found wins).
const PLACE_ALIASES = {
  kmclu: [
    "Khwaja Moinuddin Chishti Language University, Lucknow",
    "Khwaja Moinuddin Chishti Urdu Arabi Farsi University, Lucknow",
    "Khwaja Moinuddin Chishti University, Lucknow",
    "Language University, Lucknow",
  ],
  "ambedkar park": ["Ambedkar Memorial Park, Lucknow"],
};

// Places that OpenStreetMap does not have. Search finds these first, with no network call.
// To add one: copy a line, change the key (lowercase), name and coordinates.
const CUSTOM_PLACES = {
  // kmclu: { label: "KMCLU, Lucknow", lat: 26.0000, lon: 80.0000 },
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findPlaces(text) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5" +
    "&countrycodes=in&viewbox=80.75,27.05,81.15,26.65&q=" +
    encodeURIComponent(text);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Search failed");
  return response.json();
}

// Place search for the map (OpenStreetMap Nominatim).
// Runs only when the user submits, never while typing, to respect its usage policy.
function MapPlaceSearch() {
  const map = useMap();
  const boxRef = useRef(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [pin, setPin] = useState(null);

  useEffect(() => {
    if (boxRef.current) {
      L.DomEvent.disableClickPropagation(boxRef.current);
      L.DomEvent.disableScrollPropagation(boxRef.current);
    }
  }, []);

  const goTo = (place) => {
    const lat = Number(place.lat);
    const lon = Number(place.lon);
    setPin({ lat, lon, label: place.display_name });
    setResults([]);
    setNote("");
    map.flyTo([lat, lon], 17, { animate: true, duration: 1 });
  };

  const search = async (event) => {
    event.preventDefault();
    const raw = query.trim();
    if (!raw) return;

    const custom = CUSTOM_PLACES[raw.toLowerCase()];
    if (custom) {
      goTo({ lat: custom.lat, lon: custom.lon, display_name: custom.label });
      return;
    }

    const aliases = PLACE_ALIASES[raw.toLowerCase()] || [];
    const attempts = [...new Set([...aliases, raw, `${raw}, Lucknow`])];
    setBusy(true);
    setNote("");
    setResults([]);

    try {
      let data = [];
      for (let i = 0; i < attempts.length && !data.length; i += 1) {
        if (i > 0) await wait(1100); // Nominatim allows 1 request per second
        data = await findPlaces(attempts[i]);
      }

      if (!data.length) {
        setNote("No place found. Try a fuller name, like the area and city.");
      } else if (data.length === 1) {
        goTo(data[0]);
      } else {
        setResults(data);
      }
    } catch {
      setNote("Search is not available right now. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const box = {
    position: "absolute", top: 12, left: 56, zIndex: 1000, width: "min(340px, calc(100% - 140px))"
  };
  const field = {
    display: "flex", gap: 6, background: "#071a33", border: "1px solid #1d4a6b",
    borderRadius: 10, padding: 4
  };
  const input = {
    flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none",
    color: "#e8f3ff", padding: "6px 8px", font: "inherit", fontSize: 13
  };
  const go = {
    background: "#20e0c0", color: "#041326", border: "none", borderRadius: 8,
    padding: "0 12px", fontWeight: 600, cursor: "pointer", fontSize: 13
  };
  const list = {
    marginTop: 6, background: "#071a33", border: "1px solid #1d4a6b", borderRadius: 10,
    overflow: "hidden", fontSize: 12.5, color: "#e8f3ff"
  };
  const item = {
    display: "block", width: "100%", textAlign: "left", background: "transparent",
    border: "none", borderBottom: "1px solid #12304d", color: "inherit",
    padding: "8px 10px", cursor: "pointer", font: "inherit"
  };

  return (
    <>
      <div ref={boxRef} style={box}>
        <form onSubmit={search} style={field} role="search">
          <input
            style={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a place, e.g. KMCLU"
            aria-label="Search a place on the map"
          />
          <button type="submit" style={go} disabled={busy}>
            {busy ? "..." : "Go"}
          </button>
        </form>

        {note && <div role="status" style={{ ...list, padding: "8px 10px" }}>{note}</div>}

        {results.length > 0 && (
          <div style={list} role="group" aria-label="Place search results">
            {results.map((place) => (
              <button
                type="button"
                key={place.place_id}
                style={item}
                onClick={() => goTo(place)}
              >
                {place.display_name}
              </button>
            ))}
          </div>
        )}
      </div>

      {pin && (
        <CircleMarker
          center={[pin.lat, pin.lon]}
          radius={9}
          pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#20e0c0", fillOpacity: 0.9 }}
        >
          <Popup>{pin.label}</Popup>
        </CircleMarker>
      )}
    </>
  );
}

// Leaflet draws circle markers as SVG paths, which cannot be focused by
// default. This makes each one reachable with Tab and openable with Enter or Space.
function makeMarkerKeyboardAccessible(layer, label, onActivate) {
  const el = layer.getElement && layer.getElement();
  if (!el) return;
  el.setAttribute("tabindex", "0");
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", label);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onActivate();
    }
  });
}

function AccessibilityMap({
  reports, selected, setSelected, page, setCoordinates
}) {
  const chooseLocation = page === "report";
  // Keyboard handlers are attached once per marker, so they read the newest
  // report object from here instead of a stale copy.
  const latestReports = useRef({});
  latestReports.current = Object.fromEntries(reports.map((r) => [r.id, r]));

  return (
    <section className="panel map-panel" id="accessibility-map">
      <div className="panel-heading">
        <div className="section-title">
          <MapPin size={19} />
          <h2>Accessibility Map</h2>
        </div>
        <span className="area-badge">
          <span /> Demo area · Lucknow
        </span>
      </div>

      {chooseLocation && (
        <p className="map-hint">
          Click the map to select report coordinates.
        </p>
      )}

      <p className="sr-only">
        The map markers can be reached with the Tab key and opened with Enter.
        The same reports are also listed on the View Reports page.
      </p>

      <div className="map-frame">
        <MapContainer
          center={[26.8467, 80.9462]}
          zoom={15}
          scrollWheelZoom={true}
          className="leaflet-map"
        >
          <LayersControl position="topright">
            <LayersControl.BaseLayer checked name="Street (Esri)">
              <TileLayer
                attribution="Tiles &copy; Esri, HERE, Garmin, OpenStreetMap contributors"
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
                maxZoom={19}
              />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="OpenStreetMap">
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                maxZoom={19}
              />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="Satellite">
              <TileLayer
                attribution="Tiles &copy; Esri, Maxar, Earthstar Geographics"
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                maxZoom={19}
              />
            </LayersControl.BaseLayer>
          </LayersControl>

          <MapPlaceSearch />

          <MapSelectionController selected={selected} />
          <MapClickHandler
            enabled={chooseLocation}
            onSelect={setCoordinates}
          />

          {reports.map((report) => (
            <CircleMarker
              key={`${report.id}-${report.status}`}
              center={[report.latitude, report.longitude]}
              radius={selected?.id === report.id ? 9 : 6}
              pathOptions={{
                color: STATUS_COLORS[report.status] || "#22a9ff",
                fillColor: STATUS_COLORS[report.status] || "#22a9ff",
                fillOpacity: 0.9,
                weight: selected?.id === report.id ? 3 : 1,
              }}
              eventHandlers={{
                click: () => setSelected(report),
                add: (event) => makeMarkerKeyboardAccessible(
                  event.target,
                  `${report.name}. ${TYPES.find(([id]) => id === report.type)?.[1] || report.type}. Status: ${report.status}. Press Enter to open details.`,
                  () => setSelected(latestReports.current[report.id] || report)
                )
              }}
            >
              <Popup>
                <strong>{report.name}</strong>
                <br />
                {TYPES.find(([id]) => id === report.type)?.[1] || report.type}
                <br />
                Status: {report.status}
                <br />
                {report.description}
                <br />
                {report.photo_url && (
                  <img
                    src={api.photoSrc(report.photo_url)}
                    alt={`Photo of ${report.name}`}
                    style={{ width: 160, maxHeight: 110, objectFit: "cover", borderRadius: 6, margin: "6px 0", display: "block" }}
                  />
                )}
                <button onClick={() => setSelected(report)}>
                  View details
                </button>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>

        <div className="map-legend" role="list" aria-label="Map legend: marker colour by status">
          {Object.entries(STATUS_COLORS).map(([status, color]) => (
            <span key={status} role="listitem">
              <i style={{ background: color }} aria-hidden="true" />
              {status}
            </span>
          ))}
        </div>
      </div>

      <div className="map-footnote">
        <Info size={14} />
        Markers show submitted reports, not certified accessible routes.
      </div>
    </section>
  );
}

function ReportList({
  reports, selected, setSelected,
  search, setSearch, status, setStatus,
  type, setType, refresh, loading,
  isAdmin, onExport, exporting
}) {
  const clear = () => {
    setSearch("");
    setStatus("all");
    setType("all");
  };

  return (
    <section className="panel report-list-panel" id="report-list">
      <div className="panel-heading">
        <div className="section-title">
          <ClipboardList size={20} />
          <h2>Accessibility Reports</h2>
        </div>

        <div className="action-buttons">
          {isAdmin && (
            <button
              className="button secondary compact"
              onClick={onExport}
              disabled={exporting}
              title="Download all reports as a CSV file"
            >
              <Download size={14} />
              {exporting ? "Exporting..." : "Export CSV"}
            </button>
          )}

          <button
            className="button secondary compact"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      <div className="filters">
        <label className="filter-search">
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reports..."
            aria-label="Search the report list"
          />
        </label>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="verified">Verified</option>
          <option value="rejected">Rejected</option>
          <option value="resolved">Resolved</option>
        </select>

        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label="Filter by barrier type"
        >
          <option value="all">All barrier types</option>
          {TYPES.map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>

        <button className="button secondary compact" onClick={clear}>
          <RefreshCw size={13} /> Clear
        </button>
      </div>

      <p className="result-count">
        Showing {reports.length} report{reports.length === 1 ? "" : "s"}
        {loading ? " · Refreshing…" : ""}
      </p>

      <div className="report-rows">
        {reports.map((report) => (
          <article
            key={report.id}
            className={`report-row ${selected?.id === report.id ? "selected" : ""}`}
          >
            <div className={`report-type-icon ${report.type}`}>
              <MapPin size={19} />
            </div>

            <div className="report-row-main">
              <strong>{report.name}</strong>
              <small>
                {TYPES.find(([id]) => id === report.type)?.[1] || report.type}
                {" · "}
                {report.latitude.toFixed(4)}, {report.longitude.toFixed(4)}
              </small>
              <small>{new Date(report.created_at).toLocaleString()}</small>
            </div>

            <StatusBadge status={report.status} />

            <button
              className="button secondary view-button"
              onClick={() => setSelected(report)}
            >
              View details <ArrowRight size={14} />
            </button>
          </article>
        ))}

        {!reports.length && (
          <div className="empty-state">
            <FileText size={26} />
            <strong>No reports found</strong>
            <p>Try clearing the filters or submit a new report.</p>
          </div>
        )}
      </div>
    </section>
  );
}

// Admin only. Lists every status change of one report with who and when.
function StatusTimeline({ report, token }) {
  const [history, setHistory] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setHistory(null);
    setFailed(false);
    api.getHistory(report.id, token)
      .then((rows) => { if (active) setHistory(rows); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [report.id, report.status, token]);

  // Oldest first, starting with the moment the report was submitted.
  const steps = [
    {
      key: "submitted",
      label: "Submitted",
      detail: report.source,
      at: report.created_at,
      status: "pending",
    },
    ...[...(history || [])].reverse().map((row) => ({
      key: row.id,
      label: row.from_status === "resolved" && row.to_status === "verified"
        ? "Reopened"
        : row.to_status.charAt(0).toUpperCase() + row.to_status.slice(1),
      detail: `by ${row.changed_by}`,
      at: row.changed_at,
      status: row.to_status,
    })),
  ];

  return (
    <div className="timeline-block">
      <p className="timeline-title">Status history</p>
      {failed && (
        <p className="timeline-note" role="status">
          History could not be loaded. Please refresh.
        </p>
      )}
      {!failed && history === null && (
        <p className="timeline-note" role="status">Loading history…</p>
      )}
      {!failed && history !== null && (
        <ol className="timeline" aria-label="Status history, oldest first">
          {steps.map((step) => (
            <li key={step.key} className={`timeline-step ${step.status}`}>
              <span className="timeline-dot" aria-hidden="true" />
              <div>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
                <small>{new Date(step.at).toLocaleString()}</small>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function SelectedReportDetails({
  report, isAdmin, changeStatus, onClear, token
}) {
  if (!report) {
    return (
      <section className="panel details-panel">
        <div className="panel-heading">
          <div className="section-title">
            <Info size={18} />
            <h2>Selected Report Details</h2>
          </div>
        </div>
        <div className="empty-state">
          <MapPin size={28} />
          <strong>Select a report</strong>
          <p>Choose a map marker or report from the list to see its details.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel details-panel">
      <div className="panel-heading">
        <div className="section-title">
          <Info size={18} />
          <h2>Selected Report Details</h2>
        </div>
        <StatusBadge status={report.status} />
      </div>

      <h3 className="detail-name">{report.name}</h3>

      <div className="detail-type">
        <Layers size={15} />
        {TYPES.find(([id]) => id === report.type)?.[1] || report.type}
      </div>

      <p className="detail-description">{report.description}</p>

      {report.photo_url && (
        <a
          href={api.photoSrc(report.photo_url)}
          target="_blank"
          rel="noreferrer"
          title="Open full photo"
        >
          <img
            src={api.photoSrc(report.photo_url)}
            alt={`Photo of ${report.name}`}
            style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 10, margin: "4px 0 12px", display: "block" }}
          />
        </a>
      )}

      <div className="detail-meta">
        <MapPin size={16} />
        <div>
          <small>Coordinates</small>
          <span>
            {report.latitude.toFixed(6)}, {report.longitude.toFixed(6)}
          </span>
        </div>
      </div>

      <div className="detail-meta">
        <FileText size={16} />
        <div>
          <small>Source</small>
          <span>{report.source}</span>
        </div>
      </div>

      <div className="detail-meta">
        <Clock3 size={16} />
        <div>
          <small>Submitted</small>
          <span>{new Date(report.created_at).toLocaleString()}</span>
        </div>
      </div>

      {isAdmin && report.status !== "rejected" && (
        <div className="admin-actions">
          <p>Admin Actions</p>
          <div className="action-buttons">
            {report.status === "pending" && (
              <>
                <button
                  className="button success"
                  onClick={() => changeStatus(report, "verified")}
                >
                  <Check size={16} /> Verify
                </button>
                <button
                  className="button danger"
                  onClick={() => changeStatus(report, "rejected")}
                >
                  <X size={16} /> Reject
                </button>
              </>
            )}
            {report.status === "verified" && (
              <button
                className="button success"
                onClick={() => changeStatus(report, "resolved")}
              >
                <Check size={16} /> Mark resolved
              </button>
            )}
            {report.status === "resolved" && (
              <button
                className="button secondary compact"
                onClick={() => changeStatus(report, "verified")}
              >
                Reopen
              </button>
            )}
          </div>
        </div>
      )}

      {isAdmin && token && <StatusTimeline report={report} token={token} />}

      <div className="notice">
        <Info size={16} />
        <span>
          Review decisions do not guarantee that a route is currently safe or accessible.
        </span>
      </div>

      {onClear && (
        <button
          className="button secondary compact"
          onClick={onClear}
          style={{ marginTop: 12 }}
        >
          <X size={14} /> Clear selection
        </button>
      )}
    </section>
  );
}

const TYPE_LABELS = Object.fromEntries(TYPES);

function priorityColor(score) {
  if (score >= 70) return "#ff4f70";
  if (score >= 55) return "#ff874f";
  return "#ffbf47";
}

// Admin only. Shows which barriers to fix first and why.
function PriorityPanel({ items, onSelect, selectedId }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div className="section-title">
          <Activity size={18} />
          <h2>Repair priority</h2>
        </div>
      </div>

      {items.length === 0 ? (
        <p style={{ opacity: 0.75, margin: 0 }}>
          No pending or verified reports to rank yet.
        </p>
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {items.map((item, index) => {
            const color = priorityColor(item.score);
            const parts = item.breakdown;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item.id)}
                  aria-label={`Open ${item.name}, priority score ${item.score}`}
                  style={{
                    width: "100%", textAlign: "left", cursor: "pointer", font: "inherit",
                    color: "inherit", background: "transparent", padding: "8px 10px",
                    borderRadius: 10,
                    border: `1px solid ${selectedId === item.id ? color : "rgba(255,255,255,0.12)"}`
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong>{index + 1}. {item.name}</strong>
                    <strong style={{ color }}>{item.score}</strong>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.75, margin: "2px 0 6px" }}>
                    {TYPE_LABELS[item.type] || item.type} · {item.status}
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.1)" }}>
                    <div style={{ width: `${Math.min(item.score, 100)}%`, height: "100%", borderRadius: 3, background: color }} />
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                    Severity {parts.severity} · Nearby {parts.nearby} ({item.nearby_count}) · Review {parts.review} · Waiting {parts.waiting} ({item.days_waiting} d)
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <details style={{ marginTop: 12, fontSize: 13, opacity: 0.85 }}>
        <summary style={{ cursor: "pointer" }}>How is this scored?</summary>
        <p style={{ margin: "8px 0 0" }}>
          Score out of 100 for pending and verified reports. Severity: up to 50,
          from the barrier type. Nearby: 4 points for each other active report
          within 100 m, up to 20. Review: 15 if verified, 5 if pending. Waiting:
          up to 15, reaching the maximum after 30 days. The severity weights are
          our own judgement for this prototype, not an official standard.
        </p>
      </details>
    </section>
  );
}

function QuickStats({ stats }) {
  const data = [
    {
      name: "Verified",
      value: stats?.verified_reports || 0,
      color: STATUS_COLORS.verified
    },
    {
      name: "Pending",
      value: stats?.pending_reports || 0,
      color: STATUS_COLORS.pending
    },
    {
      name: "Rejected",
      value: stats?.rejected_reports || 0,
      color: STATUS_COLORS.rejected
    },
    {
      name: "Resolved",
      value: stats?.resolved_reports || 0,
      color: STATUS_COLORS.resolved
    },
  ];

  const total = stats?.total_reports || 0;

  return (
    <section className="panel small-chart-panel">
      <div className="panel-heading">
        <div className="section-title">
          <BarChart3 size={18} />
          <h2>Quick Stats</h2>
        </div>
      </div>

      <div className="quick-stats-content">
        <div className="donut-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius="65%"
                outerRadius="88%"
                paddingAngle={total ? 3 : 0}
                stroke="none"
              >
                {data.map((item) => (
                  <Cell key={item.name} fill={item.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="donut-center">
            <strong>{total}</strong>
            <small>Total reports</small>
          </div>
        </div>

        <div className="chart-legend">
          {data.map((item) => (
            <div key={item.name}>
              <i style={{ background: item.color }} />
              <span>{item.name}</span>
              <strong>
                {item.value} {total ? `(${Math.round(item.value / total * 100)}%)` : "(0%)"}
              </strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function BarrierTypesChart({ stats }) {
  const counts = stats?.by_type || {};
  const max = Math.max(1, ...TYPES.map(([id]) => counts[id] || 0));

  return (
    <section className="panel barrier-panel">
      <div className="panel-heading">
        <div className="section-title">
          <SlidersHorizontal size={18} />
          <h2>Barrier Types</h2>
        </div>
      </div>

      <div className="barrier-bars">
        {TYPES.map(([id, label], index) => {
          const count = counts[id] || 0;
          const percent = stats?.total_reports
            ? Math.round(count / stats.total_reports * 100)
            : 0;

          return (
            <div className="barrier-row" key={id}>
              <span>{label}</span>
              <div className="bar-track">
                <i
                  style={{
                    width: `${count / max * 100}%`,
                    background: TYPE_COLORS[index]
                  }}
                />
              </div>
              <strong>
                {count} <small>({percent}%)</small>
              </strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ReportForm({
  coordinates, setCoordinates, onSubmit, saving, message, reports
}) {
  const [form, setForm] = useState({
    name: "",
    type: "blocked_path",
    description: "",
    latitude: "",
    longitude: "",
    source: "Community report"
  });

  const [warnedKey, setWarnedKey] = useState("");
  const [duplicates, setDuplicates] = useState([]);

  const [photo, setPhoto] = useState(null);
  const [photoError, setPhotoError] = useState("");
  const photoInput = useRef(null);
  const photoPreview = useMemo(
    () => (photo ? URL.createObjectURL(photo) : ""),
    [photo]
  );
  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  const choosePhoto = (event) => {
    const file = event.target.files?.[0];
    setPhotoError("");
    if (!file) return;

    if (!PHOTO_TYPES.includes(file.type)) {
      setPhotoError("Please choose a JPG or PNG photo.");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError("The photo is larger than 5 MB. Please choose a smaller one.");
      event.target.value = "";
      return;
    }
    setPhoto(file);
  };

  const removePhoto = () => {
    setPhoto(null);
    setPhotoError("");
    if (photoInput.current) photoInput.current.value = "";
  };

  const currentKey = `${form.latitude}|${form.longitude}|${form.type}`;
  const visibleDuplicates = warnedKey === currentKey ? duplicates : [];

  useEffect(() => {
    if (coordinates) {
      setForm((old) => ({
        ...old,
        latitude: coordinates.latitude.toFixed(6),
        longitude: coordinates.longitude.toFixed(6)
      }));
    }
  }, [coordinates]);


    const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");

  const useMyLocation = () => {
    setLocationError("");

    if (!navigator.geolocation) {
      setLocationError("Your browser does not support location access.");
      return;
    }

    setLocating(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        setCoordinates({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (error) => {
        setLocating(false);
        setLocationError(
          error.code === 1
            ? "Location permission was denied. You can still select a point on the map."
            : "Could not get your location. Please try again or select a point on the map."
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };
  
  const submit = async (event) => {
    event.preventDefault();

    const lat = Number(form.latitude);
    const lon = Number(form.longitude);

    const nearby = (reports || [])
      .filter((report) =>
        report.type === form.type &&
        report.status !== "rejected" &&
        report.status !== "resolved" &&
        distanceMeters(lat, lon, report.latitude, report.longitude)
          <= DUPLICATE_RADIUS_METERS
      )
      .map((report) => ({
        report,
        meters: Math.round(
          distanceMeters(lat, lon, report.latitude, report.longitude)
        ),
      }));

    // First click with nearby matches shows the warning.
    // A second click on the same location and type submits anyway.
    if (nearby.length && warnedKey !== currentKey) {
      setDuplicates(nearby);
      setWarnedKey(currentKey);
      return;
    }

    await onSubmit({
      name: form.name.trim(),
      type: form.type,
      description: form.description.trim(),
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
      source: form.source,
    }, () => {
      setForm({
        name: "",
        type: "blocked_path",
        description: "",
        latitude: "",
        longitude: "",
        source: "Community report"
      });
      removePhoto();
    }, photo);
  };

  return (
    <section className="panel form-panel">
      <div className="panel-heading">
        <div className="section-title">
          <PlusCircle size={20} />
          <h2>Report a Barrier</h2>
        </div>
      </div>

      <p className="form-intro">
        Help others understand accessibility barriers in public spaces.
        Reports begin as pending and are reviewed by an administrator.
      </p>

      {message && (
        <div className={`inline-message ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>
          <Info size={16} /> {message.text}
        </div>
      )}

      <form className="report-form" onSubmit={submit}>
        <label>
          Report title
          <input
            required minLength={3} maxLength={160}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Broken sidewalk near library"
          />
        </label>

        <label>
          Barrier type
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            {TYPES.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </label>

        <label>
          Description
          <textarea
            required minLength={10} maxLength={3000} rows={4}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Describe the barrier and its location..."
          />
        </label>

        <div className="coordinate-grid">
          <label>
            Latitude
            <input
              required type="number" step="any" min="-90" max="90"
              value={form.latitude}
              onChange={(e) => setForm({ ...form, latitude: e.target.value })}
              placeholder="26.846700"
            />
          </label>
          <label>
            Longitude
            <input
              required type="number" step="any" min="-180" max="180"
              value={form.longitude}
              onChange={(e) => setForm({ ...form, longitude: e.target.value })}
              placeholder="80.946200"
            />
          </label>
        </div>

               <p className="map-hint">
          Open Explore Map or use the map below to select coordinates.
        </p>

        <button
          type="button"
          className="button secondary compact"
          onClick={useMyLocation}
          disabled={locating}
        >
          <MapPin size={14} />
          {locating ? "Getting location…" : "Use my current location"}
        </button>

        {locationError && (
          <div className="inline-message error" role="alert">
            <AlertCircle size={16} /> {locationError}
          </div>
        )}

        <label>
          Source
          <select
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
          >
            <option>Community report</option>
            <option>Resident report</option>
            <option>Field observation</option>
          </select>
        </label>

        <div>
          <label>
            Photo (optional)
            <input
              ref={photoInput}
              type="file"
              accept="image/jpeg,image/png"
              aria-describedby="photo-hint"
              onChange={choosePhoto}
            />
          </label>
          <small id="photo-hint" style={{ opacity: 0.75 }}>
            JPG or PNG, up to 5 MB. Location data inside the photo is removed.
            Please avoid showing faces or number plates.
          </small>

          {photoError && (
            <div className="inline-message error" role="alert">
              <AlertCircle size={16} /> {photoError}
            </div>
          )}

          {photo && (
            <div style={{ marginTop: 8 }}>
              <img
                src={photoPreview}
                alt="Selected photo preview"
                style={{ width: "100%", maxHeight: 180, objectFit: "cover", borderRadius: 10, display: "block" }}
              />
              <button
                type="button"
                className="button secondary compact"
                style={{ marginTop: 6 }}
                onClick={removePhoto}
              >
                <X size={14} /> Remove photo
              </button>
            </div>
          )}
        </div>

        {visibleDuplicates.length > 0 && (
          <div className="inline-message error" role="alert">
            <AlertCircle size={16} />
            <div>
              <strong>
                {visibleDuplicates.length === 1
                  ? "A similar report already exists nearby."
                  : `${visibleDuplicates.length} similar reports already exist nearby.`}
              </strong>
              <ul>
                {visibleDuplicates.map(({ report, meters }) => (
                  <li key={report.id}>
                    {report.name} ({report.status}), about {meters} m away
                  </li>
                ))}
              </ul>
              <span>
                If this is a different barrier, select Submit anyway.
              </span>
            </div>
          </div>
        )}

        <button
          className="button primary submit-button"
          disabled={saving}
        >
          <PlusCircle size={17} />
          {saving
            ? "Submitting…"
            : visibleDuplicates.length
              ? "Submit anyway"
              : "Submit report"}
        </button>
      </form>
    </section>
  );
}

function AdminLogin({ isAdmin, login, logout, message, busy }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <section className="panel login-panel">
      <div className="panel-heading">
        <div className="section-title">
          <ShieldCheck size={20} />
          <h2>Administrator Access</h2>
        </div>
      </div>

      {isAdmin ? (
        <>
          <div className="inline-message success">
            <CheckCircle2 size={18} /> Admin session is active.
          </div>
          <button className="button danger" onClick={logout}>
            <LogOut size={16} /> Log out
          </button>
        </>
      ) : (
        <form
          className="report-form"
          onSubmit={(e) => {
            e.preventDefault();
            login(username, password);
          }}
        >
          <p className="form-intro">
            Sign in to review reports and change their status.
          </p>

          {message && (
            <div className="inline-message error" role="alert">
              <AlertCircle size={16} /> {message}
            </div>
          )}

          <label>
            Username
            <input
              required autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>

          <label>
            Password
            <input
              required type="password" autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <button
            className="button primary submit-button"
            disabled={busy}
          >
            <LogIn size={16} />
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      )}
    </section>
  );
}

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [reports, setReports] = useState([]);
  const [stats, setStats] = useState(null);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [priority, setPriority] = useState([]);
  const [coordinates, setCoordinates] = useState(null);

  const [token, setToken] = useState(readStoredToken);
  const [isAdmin, setIsAdmin] = useState(Boolean(token));

  const [apiHealth, setApiHealth] = useState("checking");
  const [message, setMessage] = useState(null);
  const [loginMessage, setLoginMessage] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);

  const loadDashboard = useCallback(async () => {
    setLoading(true);

    try {
      const [allReports, currentStats] = await Promise.all([
        api.getReports(),
        api.getStats()
      ]);

      setReports(allReports);
      setStats(currentStats);
      setApiHealth("online");

      setSelected((old) =>
        old ? allReports.find((r) => r.id === old.id) || null
          : allReports[0] || null
      );
    } catch (error) {
      setApiHealth("offline");
      setMessage({ kind: "error", text: error.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const filteredReports = useMemo(() => reports.filter((report) => {
    const q = search.trim().toLowerCase();

    const matchesSearch = !q || [
      report.name,
      report.description,
      report.type,
      report.source,
      `${report.latitude} ${report.longitude}`
    ].some((value) => String(value).toLowerCase().includes(q));

    return matchesSearch
      && (status === "all" || report.status === status)
      && (type === "all" || report.type === type);
  }), [reports, search, status, type]);

  const submitReport = async (payload, resetForm, photo) => {
    setSaving(true);
    setMessage(null);

    try {
      let created = await api.createReport(payload);
      let text = "Report submitted successfully and is pending review.";

      // The report is already saved. A failed photo must not undo it.
      if (photo) {
        try {
          created = await api.uploadPhoto(created.id, photo);
        } catch (photoProblem) {
          text =
            "Report submitted, but the photo could not be uploaded: " +
            photoProblem.message;
        }
      }

      resetForm();
      setCoordinates(null);
      setSelected(created);

      setMessage({ kind: "success", text });

      await loadDashboard();
      setPage("dashboard");
    } catch (error) {
      setMessage({ kind: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (report, nextStatus) => {
    const action =
      nextStatus === "resolved" ? "mark as resolved"
      : report.status === "resolved" ? "reopen"
      : nextStatus === "verified" ? "verify"
      : "reject";

    if (!window.confirm(`Are you sure you want to ${action} "${report.name}"?`)) {
      return;
    }

    try {
      await api.updateStatus(report.id, nextStatus, token);

      setMessage({
        kind: "success",
        text: `Report ${nextStatus} successfully.`
      });

            await loadDashboard();
    } catch (error) {
      if (error.status === 401) {
        expireSession();
        return;
      }
      setMessage({ kind: "error", text: error.message });
    }
  };

  const handleExport = async () => {
    if (!token) {
      setMessage({
        kind: "error",
        text: "Please log in as an administrator to export reports."
      });
      setPage("admin");
      return;
    }

    setExportBusy(true);
    setMessage(null);

    let downloadUrl;

    try {
      const blob = await api.exportReports(token);
      downloadUrl = window.URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = "accesspulse-reports.csv";

      document.body.appendChild(link);
      link.click();
      link.remove();

      setMessage({
        kind: "success",
        text: "Reports exported successfully."
      });
        } catch (error) {
      if (error.status === 401) {
        expireSession();
      } else {
        setMessage({
          kind: "error",
          text: error.message || "Unable to export reports."
        });
      }
    } finally {
      if (downloadUrl) {
        window.setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 1000);
      }
      setExportBusy(false);
    }
  };

  const login = async (username, password) => {
    setLoginBusy(true);
    setLoginMessage("");

    try {
      const result = await api.login(username, password);

      setToken(result.access_token);
      setIsAdmin(true);
      setLoginMessage("");
      setPage("dashboard");

      localStorage.setItem("accesspulse_admin_token", result.access_token);
    } catch (error) {
      setLoginMessage(error.message);
    } finally {
      setLoginBusy(false);
    }
  };

  const logout = () => {
    localStorage.removeItem("accesspulse_admin_token");
    setToken("");
    setIsAdmin(false);
    setPage("dashboard");
    setLoginMessage("");
  };
  
    const expireSession = () => {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    setToken("");
    setIsAdmin(false);
    setPage("admin");
    setLoginMessage("Your admin session has expired. Please log in again.");
  };

  // Repair priority list for admins. Refreshes whenever the reports change.
  useEffect(() => {
    if (!isAdmin || !token) {
      setPriority([]);
      return undefined;
    }

    let cancelled = false;
    api.getPriority(token, 8)
      .then((items) => { if (!cancelled) setPriority(items); })
      .catch((error) => {
        if (cancelled) return;
        if (error.status === 401) expireSession();
        else setPriority([]);
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, token, reports]);

  const setMapCoordinates = (point) => {
    setCoordinates(point);
    setMessage({
      kind: "success",
      text: `Location selected: ${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`
    });
  };

  // Tell screen reader users when the page changes: update the tab title
  // and move focus to the page heading (not on the first load).
  const headingRef = useRef(null);
  const firstPage = useRef(true);
  useEffect(() => {
    const names = {
      dashboard: "Dashboard", map: "Explore Map", report: "Report a Barrier",
      reports: "View Reports", admin: "Administrator access"
    };
    document.title = `${names[page] || "AccessPulse"} · AccessPulse`;
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [page]);

  const heading = {
    dashboard: [
      "ACCESSIBILITY INTELLIGENCE",
      "Navigate your city with confidence.",
      "Explore reported accessibility barriers and help build a more inclusive public environment."
    ],
    map: [
      "EXPLORE YOUR AREA",
      "Explore accessibility reports.",
      "Select report markers to review community-submitted information."
    ],
    reports: [
      "COMMUNITY REPORTS",
      "Accessibility Reports.",
      "Search, filter and inspect submitted accessibility barriers."
    ],
    report: [
      "COMMUNITY CONTRIBUTION",
      "Report a barrier.",
      "Share an observed barrier to help build a more inclusive public environment."
    ],
    admin: [
      "ADMINISTRATION",
      "Administrator access.",
      "Sign in to review community reports and manage their review status."
    ],
  }[page];

  const reportListProps = {
    reports: filteredReports,
    selected,
    setSelected,
    search,
    setSearch,
    status,
    setStatus,
    type,
    setType,
    refresh: loadDashboard,
    loading,
    isAdmin,
    onExport: handleExport,
    exporting: exportBusy
  };

  const selectedDetailsProps = {
    report: selected,
    isAdmin,
    changeStatus,
    token,
    onClear: () => setSelected(null)
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Sidebar
        page={page}
        setPage={setPage}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
        isAdmin={isAdmin}
        logout={logout}
      />

      <main className="main-area" id="main-content" tabIndex={-1}>
        <Topbar
          search={search}
          setSearch={setSearch}
          isAdmin={isAdmin}
          setPage={setPage}
          setMobileOpen={setMobileOpen}
        />

        <div className="page-content">
          <section className="page-heading">
            <div>
              <span className="eyebrow">{heading[0]}</span>
              <h1 ref={headingRef} tabIndex={-1}>
                {heading[1].includes("confidence.")
                  ? <>Navigate your city with <em>confidence.</em></>
                  : heading[1]}
              </h1>
              <p>{heading[2]}</p>
            </div>
            <span className="area-badge"><i /> Demo area · Lucknow</span>
          </section>

          {message && (
            <div
              className={`global-message ${message.kind}`}
              role={message.kind === "error" ? "alert" : "status"}
            >
              <Info size={16} />
              {message.text}
              <button
                onClick={() => setMessage(null)}
                aria-label="Dismiss"
              >
                <X size={15} />
              </button>
            </div>
          )}

          {page === "admin" ? (
            <AdminLogin
              isAdmin={isAdmin}
              login={login}
              logout={logout}
              message={loginMessage}
              busy={loginBusy}
            />
          ) : page === "report" ? (
            <div className="single-page-layout">
              <ReportForm
                coordinates={coordinates}
                setCoordinates={setCoordinates}
                onSubmit={submitReport}
                saving={saving}
                message={null}
                reports={reports}
              />
              <AccessibilityMap
                reports={reports}
                selected={selected}
                setSelected={setSelected}
                page={page}
                setCoordinates={setMapCoordinates}
              />
            </div>
          ) : page === "map" ? (
            <div className="single-page-layout">
              <AccessibilityMap
                reports={reports}
                selected={selected}
                setSelected={setSelected}
                page={page}
                setCoordinates={setMapCoordinates}
              />
              <SelectedReportDetails {...selectedDetailsProps} />
            </div>
          ) : page === "reports" ? (
            <div className="single-page-layout">
              <ReportList {...reportListProps} />
              <SelectedReportDetails {...selectedDetailsProps} />
            </div>
          ) : (
            <>
              <div className="stats-grid">
                <StatCard
                  title="Total reports"
                  value={stats?.total_reports ?? "—"}
                  caption="All submitted reports"
                  icon={FileText}
                  tone="blue"
                />
                <StatCard
                  title="Verified reports"
                  value={stats?.verified_reports ?? "—"}
                  caption="Reports verified by admin"
                  icon={CheckCircle2}
                  tone="green"
                />
                <StatCard
                  title="Pending review"
                  value={stats?.pending_reports ?? "—"}
                  caption="Awaiting admin review"
                  icon={Clock3}
                  tone="amber"
                />
                <StatCard
                  title="Rejected reports"
                  value={stats?.rejected_reports ?? "—"}
                  caption="Reports rejected by admin"
                  icon={X}
                  tone="red"
                />
              </div>

              <div className="dashboard-grid">
                <div className="left-column">
                  <AccessibilityMap
                    reports={reports}
                    selected={selected}
                    setSelected={setSelected}
                    page={page}
                    setCoordinates={setMapCoordinates}
                  />
                  <ReportList {...reportListProps} />
                </div>

                <div className="right-column">
                  <SelectedReportDetails {...selectedDetailsProps} />
                  {isAdmin && (
                    <PriorityPanel
                      items={priority}
                      selectedId={selected?.id}
                      onSelect={(id) => {
                        const found = reports.find((r) => r.id === id);
                        if (found) setSelected(found);
                      }}
                    />
                  )}
                  <QuickStats stats={stats} />
                  <BarrierTypesChart stats={stats} />
                </div>
              </div>
            </>
          )}

          <footer className="footer">
            <span>
              <strong>Access<span>Pulse</span></strong>
              {" · "}Building more accessible cities.
            </span>
            <span className={`api-health ${apiHealth}`}>
              <i />
              {apiHealth === "online"
                ? "System Online"
                : apiHealth === "offline"
                  ? "API Offline"
                  : "Checking API"}
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
