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
    
    // Start centered on the first coordinate (start position) at overview zoom
    const startCoord = allCoordinates[0];
    map.setView(startCoord, 11, { animate: false });
    
    // Display alternative routes if present (plotted in various colors)
    displayAlternativeRoutes(routeSegments);
    
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

/**
 * Display alternative hiking routes in various colors
 */
function displayAlternativeRoutes(routeSegments) {
    if (!map) {
        console.log('No map available for displaying alternatives');
        return;
    }
    
    console.log('Checking for alternative routes in', routeSegments.length, 'segments');
    
    routeSegments.forEach((segment, segIndex) => {
        if (segment.alternativeRoutes && segment.alternativeRoutes.length > 0) {
            console.log(`Segment ${segIndex}: Displaying ${segment.alternativeRoutes.length} alternative routes`);
            
            segment.alternativeRoutes.forEach((alt, index) => {
                console.log(`  Alt ${index + 1}: ${alt.coords.length} points, color: ${alt.color}`);
                
                const line = L.polyline(alt.coords, {
                    color: alt.color,
                    weight: 4,
                    opacity: 0.7,
                    dashArray: '8, 8',
                    smoothFactor: 1
                }).addTo(map);
                
                allLines.push(line);
                
                // Add tooltip with distance/time info
                const distanceKm = (alt.distance / 1000).toFixed(1);
                const timeMin = Math.round(alt.time / 60000);
                line.bindTooltip(`Alt ${index + 1}: ${distanceKm}km, ~${timeMin}min`, {
                    permanent: false,
                    direction: 'center'
                });
            });
        } else {
            console.log(`Segment ${segIndex}: No alternative routes`);
        }
    });
}

// Export for browser
if (typeof window !== 'undefined') {
    window.initMap = initMap;
    window.getMap = getMap;
    window.addMarker = addMarker;
    window.addLine = addLine;
}
