/**
 * Map Initialization Module
 * Handles map creation, tile layers, and initial setup
 */

// Global state
let map = null;
let allMarkers = [];
let allLines = [];

/**
 * Initialize the map with route data
 */
function initMap(routeSegments, options = {}) {
    const {
        zoom = 11,
        lineColor = '#8B4513',
        lineWidth = 3,
        animationDuration = 5000,
        useSmoothing = true,
        finalDestination = 'DESTINATION',
        title = 'ADVENTURE',
        date = '',
        tileLayer = null,
        startZoomLevel = null
    } = options;
    
    // Clean up existing map if present
    if (map) {
        allMarkers.forEach(m => m.remove());
        allMarkers = [];
        allLines.forEach(l => l.remove());
        allLines = [];
        map.remove();
        map = null;
    }
    
    // Reset UI elements
    const titleCard = document.getElementById('title-card');
    const destinationCard = document.getElementById('destination-card');
    if (titleCard) titleCard.style.opacity = '0';
    if (destinationCard) destinationCard.style.opacity = '0';
    
    // Flatten all coordinates for bounds calculation
    const allCoordinates = routeSegments.flatMap(seg => seg.coordinates);
    
    // Calculate center point
    const centerLat = (allCoordinates[0][0] + allCoordinates[allCoordinates.length - 1][0]) / 2;
    const centerLng = (allCoordinates[0][1] + allCoordinates[allCoordinates.length - 1][1]) / 2;
    
    // Create map
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false,
        zoomAnimation: true,
        fadeAnimation: true
    }).setView([centerLat, centerLng], zoom);
    
    // Add tile layer
    if (tileLayer && tileLayer.url) {
        L.tileLayer(tileLayer.url, tileLayer.options || {}).addTo(map);
    } else {
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18,
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);
    }
    
    // Fit bounds then set initial zoom to 11 (overview)
    const bounds = L.latLngBounds(allCoordinates.map(c => [c[0], c[1]]));
    map.fitBounds(bounds, { padding: [50, 50] });
    const center = bounds.getCenter();
    map.setView(center, 11);
    
    // Store for animation
    window.mapData = {
        routeSegments,
        lineColor,
        lineWidth,
        animationDuration,
        useSmoothing,
        finalDestination,
        title,
        date,
        startZoomLevel
    };
    
    return map;
}

function getMap() {
    return map;
}

function addMarker(marker) {
    allMarkers.push(marker);
}

function addLine(line) {
    allLines.push(line);
}

// Export for browser
if (typeof window !== 'undefined') {
    window.initMap = initMap;
    window.getMap = getMap;
    window.addMarker = addMarker;
    window.addLine = addLine;
}
