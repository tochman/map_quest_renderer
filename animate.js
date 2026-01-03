import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import { readFile } from 'fs/promises';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load destinations from JSON (support custom file via CLI argument)
const jsonArg = process.argv[2];
const destinationsPath = jsonArg 
    ? (jsonArg.startsWith('/') ? jsonArg : join(__dirname, jsonArg))
    : join(__dirname, 'destinations.json');

console.log(`Loading destinations from: ${basename(destinationsPath)}`);
const destinationsConfig = JSON.parse(await readFile(destinationsPath, 'utf-8'));

// Load icon renderer module
const iconRendererCode = await readFile(join(__dirname, 'icons', 'icon-renderer.js'), 'utf-8');

// Load zoom utilities module
const zoomUtilsCode = await readFile(join(__dirname, 'js', 'zoom-utils.js'), 'utf-8');

// Tile layer configurations (all free, no API key required)
const TILE_LAYERS = {
    osm: {
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        options: { maxZoom: 19, attribution: '© OpenStreetMap contributors' }
    },
    watercolor: {
        // Stamen Watercolor hosted by Smithsonian
        url: 'https://watercolormaps.collection.cooperhewitt.org/tile/watercolor/{z}/{x}/{y}.jpg',
        options: { minZoom: 1, maxZoom: 15, attribution: '© Stamen Design © OpenStreetMap' }
    },
    terrain: {
        // OpenTopoMap - free terrain tiles
        url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
        options: { maxZoom: 17, attribution: '© OpenTopoMap © OpenStreetMap' }
    },
    // CartoDB tiles - with labels
    toner: {
        url: 'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        options: { maxZoom: 20, attribution: '© CARTO © OpenStreetMap' }
    },
    dark: {
        url: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        options: { maxZoom: 20, attribution: '© CARTO © OpenStreetMap' }
    },
    voyager: {
        url: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
        options: { maxZoom: 20, attribution: '© CARTO © OpenStreetMap' }
    },
    // CartoDB tiles - NO labels (cleaner look)
    'toner-nolabels': {
        url: 'https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
        options: { maxZoom: 20, attribution: '© CARTO © OpenStreetMap' }
    },
    'dark-nolabels': {
        url: 'https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
        options: { maxZoom: 20, attribution: '© CARTO © OpenStreetMap' }
    },
    'voyager-nolabels': {
        url: 'https://a.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png',
        options: { maxZoom: 20, attribution: '© CARTO © OpenStreetMap' }
    },
    humanitarian: {
        url: 'https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
        options: { maxZoom: 19, attribution: '© HOT © OpenStreetMap' }
    }
};

// Parse --tile argument
const tileArg = process.argv.find(arg => arg.startsWith('--tile'));
let selectedTile = 'osm'; // default
if (tileArg) {
    const tileIndex = process.argv.indexOf(tileArg);
    if (tileArg.includes('=')) {
        selectedTile = tileArg.split('=')[1];
    } else if (process.argv[tileIndex + 1] && !process.argv[tileIndex + 1].startsWith('-')) {
        selectedTile = process.argv[tileIndex + 1];
    }
}

if (!TILE_LAYERS[selectedTile]) {
    console.error(`Unknown tile layer: ${selectedTile}`);
    console.error(`Available tiles: ${Object.keys(TILE_LAYERS).join(', ')}`);
    process.exit(1);
}

console.log(`Using tile layer: ${selectedTile}`);

// Function to geocode an address
async function geocodeAddress(address) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    
    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'MapAnimation/1.0' }
        });
        const data = await response.json();
        
        if (data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lon = parseFloat(data[0].lon);
            console.log(`Found: ${data[0].display_name}`);
            console.log(`Coordinates: ${lat}, ${lon}`);
            return [lat, lon];
        }
    } catch (error) {
        console.error('Geocoding error:', error);
    }
    
    return null;
}

// Get start coordinates
let startPoint;
if (destinationsConfig.start.coordinates) {
    // Use coordinates directly if provided
    startPoint = destinationsConfig.start.coordinates;
    console.log(`Start coordinates: ${startPoint[0]}, ${startPoint[1]}`);
} else if (destinationsConfig.start.address) {
    // Geocode address
    console.log(`Geocoding ${destinationsConfig.start.address}...`);
    startPoint = await geocodeAddress(destinationsConfig.start.address);
    
    if (!startPoint) {
        console.error('Could not geocode start address');
        process.exit(1);
    }
} else {
    console.error('Start point must have either "coordinates" or "address" property');
    process.exit(1);
}

// Function to get hiking route from GraphHopper API
// Uses 'foot' profile (supported on free tier) which routes on paths/trails
// Returns object: { primary: coords, alternatives: [{coords, color, distance, time}] }
async function getHikingRoute(currentPoint, nextPoint, viaPoints = [], options = {}) {
    // Build coordinates array: [start, via1, via2, ..., end]
    const points = [currentPoint, ...viaPoints, nextPoint];
    const pointsParam = points.map(p => `point=${p[0]},${p[1]}`).join('&');
    
    // Get API key from environment variable
    const apiKey = process.env.GRAPHHOPPER_API_KEY || '';
    // Use 'foot' profile - free tier supported, routes on pedestrian paths/trails
    // Add alternative_route.max_paths to try getting alternatives (may require paid plan)
    const altParam = options.showAlternatives ? '&alternative_route.max_paths=3&algorithm=alternative_route' : '';
    const url = `https://graphhopper.com/api/1/route?${pointsParam}&profile=foot&points_encoded=false&key=${apiKey}${altParam}`;
    
    console.log(`  GraphHopper URL: ${url.replace(apiKey, 'API_KEY')}`);
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        console.log(`  GraphHopper response: ${JSON.stringify({
            pathCount: data.paths?.length || 0,
            message: data.message,
            hints: data.hints
        })}`);
        
        if (data.paths && data.paths.length > 0) {
            // Log details of all paths returned
            console.log(`  ✓ GraphHopper returned ${data.paths.length} path(s):`);
            data.paths.forEach((path, i) => {
                console.log(`    Path ${i}: ${path.points.coordinates.length} waypoints, ${(path.distance/1000).toFixed(2)}km, ${Math.round(path.time/60000)}min`);
            });
            
            // GraphHopper returns [lng, lat], we need [lat, lng]
            const primaryCoords = data.paths[0].points.coordinates.map(c => [c[1], c[0]]);
            
            const result = { primary: primaryCoords, alternatives: [] };
            
            // If alternatives requested, try to find nearby trails using Overpass API
            if (options.showAlternatives) {
                console.log(`  Requesting nearby trails from Overpass API...`);
                const trails = await findNearbyTrailsBetween(currentPoint, nextPoint);
                if (trails.length > 0) {
                    result.alternatives = trails;
                    console.log(`  ✓ Added ${trails.length} alternative trail segments`);
                } else {
                    console.log(`  ✗ No alternative trails found in area`);
                }
            }
            
            return result;
        } else if (data.message) {
            console.warn('  ✗ GraphHopper API:', data.message);
        }
    } catch (error) {
        console.error('  ✗ Error fetching hiking route:', error.message);
    }
    
    // Fallback to OSRM foot profile
    console.log('  Falling back to OSRM foot profile...');
    const coords = await getRouteCoordinates(currentPoint, nextPoint, 'foot', viaPoints);
    return { primary: coords, alternatives: [] };
}

// Function to query Overpass API for hiking trails between two points
// Returns trail segments that can be displayed as alternative routes
async function findNearbyTrailsBetween(start, end) {
    // Calculate bounding box and center point
    const minLat = Math.min(start[0], end[0]) - 0.02;
    const maxLat = Math.max(start[0], end[0]) + 0.02;
    const minLon = Math.min(start[1], end[1]) - 0.02;
    const maxLon = Math.max(start[1], end[1]) + 0.02;
    
    // Overpass query to find hiking trails in the bounding box
    const query = `
        [out:json][timeout:25];
        (
          way(${minLat},${minLon},${maxLat},${maxLon})["highway"~"^(path|footway|track)$"];
          way(${minLat},${minLon},${maxLat},${maxLon})["sac_scale"];
          way(${minLat},${minLon},${maxLat},${maxLon})["route"="hiking"];
        );
        out geom;
    `;
    
    const url = 'https://overpass-api.de/api/interpreter';
    
    console.log(`    Querying Overpass for trails in bbox: ${minLat.toFixed(4)},${minLon.toFixed(4)} to ${maxLat.toFixed(4)},${maxLon.toFixed(4)}`);
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            body: query
        });
        const data = await response.json();
        
        if (data.elements && data.elements.length > 0) {
            console.log(`    Overpass returned ${data.elements.length} trail segments in area`);
            
            // Convert trail ways to coordinate arrays
            const colors = ['#FF6B6B', '#4ECDC4', '#95E1D3', '#F38181', '#FFA07A'];
            const trails = [];
            
            // Limit to first 5 trails to avoid clutter
            const trailsToShow = Math.min(5, data.elements.length);
            
            for (let i = 0; i < trailsToShow; i++) {
                const element = data.elements[i];
                if (element.geometry && element.geometry.length > 1) {
                    const coords = element.geometry.map(node => [node.lat, node.lon]);
                    
                    // Calculate approximate distance
                    let distance = 0;
                    for (let j = 0; j < coords.length - 1; j++) {
                        const lat1 = coords[j][0], lon1 = coords[j][1];
                        const lat2 = coords[j + 1][0], lon2 = coords[j + 1][1];
                        const R = 6371000; // Earth radius in meters
                        const dLat = (lat2 - lat1) * Math.PI / 180;
                        const dLon = (lon2 - lon1) * Math.PI / 180;
                        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                                Math.sin(dLon/2) * Math.sin(dLon/2);
                        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                        distance += R * c;
                    }
                    
                    trails.push({
                        coords: coords,
                        color: colors[i % colors.length],
                        distance: distance,
                        time: distance / 1.2 * 1000, // Assume 1.2 m/s hiking speed
                        name: element.tags?.name || `Trail ${i + 1}`
                    });
                }
            }
            
            return trails;
        }
    } catch (error) {
        console.error('Error querying Overpass API:', error);
    }
    
    return [];
}

// Function to query Overpass API for hiking trails near a point
// Returns trail waypoints that can be used as via points
async function findNearbyTrails(lat, lon, radiusMeters = 2000) {
    // Overpass query to find hiking trails within radius
    // Looking for paths with hiking tags
    const query = `
        [out:json];
        (
          way(around:${radiusMeters},${lat},${lon})["highway"~"^(path|footway|track)$"];
          way(around:${radiusMeters},${lat},${lon})["sac_scale"];
        );
        out geom;
    `;
    
    const url = 'https://overpass-api.de/api/interpreter';
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            body: query
        });
        const data = await response.json();
        
        if (data.elements && data.elements.length > 0) {
            console.log(`Found ${data.elements.length} trails nearby`);
            // Return sample coordinates from the trails for use as waypoints
            const trails = data.elements.map(el => ({
                id: el.id,
                tags: el.tags,
                geometry: el.geometry || el.nodes
            }));
            return trails;
        }
    } catch (error) {
        console.error('Error querying Overpass API:', error);
    }
    
    return [];
}

// Function to get route waypoints from OSRM (free routing service)
// Supports via waypoints to force the route through specific points
async function getRouteCoordinates(start, end, profile = 'driving', viaPoints = []) {
    // Build coordinates string: start;via1;via2;...;end
    let coordsString = `${start[1]},${start[0]}`;
    for (const via of viaPoints) {
        coordsString += `;${via[1]},${via[0]}`;
    }
    coordsString += `;${end[1]},${end[0]}`;
    
    const url = `https://router.project-osrm.org/route/v1/${profile}/${coordsString}?overview=full&geometries=geojson`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.routes && data.routes.length > 0) {
            // OSRM returns [lng, lat], we need [lat, lng]
            const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
            console.log(`Route found with ${coords.length} waypoints`);
            return coords;
        }
    } catch (error) {
        console.error('Error fetching route:', error);
    }
    
    // Fallback to direct line if routing fails
    console.log('Using direct line between points');
    return [start, end];
}

// Build route segments from configuration
// Each segment represents travel FROM one point TO the next
const routeSegments = [];
let currentPoint = startPoint;
let previousLabel = destinationsConfig.start.label;

console.log(`Building route with ${destinationsConfig.stops.length} stops...`);
for (let i = 0; i < destinationsConfig.stops.length; i++) {
    const stop = destinationsConfig.stops[i];
    
    // Support both coordinates and address for stops
    let nextPoint;
    if (stop.coordinates) {
        nextPoint = stop.coordinates;
    } else if (stop.address) {
        console.log(`Geocoding stop: ${stop.address}...`);
        nextPoint = await geocodeAddress(stop.address);
        if (!nextPoint) {
            console.error(`Could not geocode stop address: ${stop.address}`);
            process.exit(1);
        }
    } else {
        console.error(`Stop ${i + 1} has neither coordinates nor address`);
        process.exit(1);
    }
    
    let coords;
    let alternativeRoutes = [];  // Track alternatives for this segment
    
    if (stop.travelMode === 'direct') {
        // Direct line (as the crow flies) for hiking through woods
        // Interpolate points for smooth animation
        console.log(`Creating direct route (${stop.icon}) from "${previousLabel}" to "${stop.label || 'waypoint'}"...`);
        const numPoints = 50; // Add intermediate points for smooth animation
        coords = [];
        for (let j = 0; j <= numPoints; j++) {
            const t = j / numPoints;
            coords.push([
                currentPoint[0] + (nextPoint[0] - currentPoint[0]) * t,
                currentPoint[1] + (nextPoint[1] - currentPoint[1]) * t
            ]);
        }
        console.log(`Direct route created with ${coords.length} interpolated points`);
    } else if (stop.travelMode === 'hike') {
        // Use GraphHopper's hiking profile (prefers trails over roads)
        const viaPoints = stop.viaPoints || [];
        const showAlternatives = stop.showAlternatives !== undefined ? stop.showAlternatives : false;
        
        if (viaPoints.length > 0) {
            console.log(`Getting hiking route (${stop.icon}) from "${previousLabel}" to "${stop.label || 'waypoint'}" via ${viaPoints.length} waypoints...`);
        } else {
            console.log(`Getting hiking route (${stop.icon}) from "${previousLabel}" to "${stop.label || 'waypoint'}"...`);
        }
        
        const result = await getHikingRoute(currentPoint, nextPoint, viaPoints, { showAlternatives });
        coords = result.primary;
        
        // Store alternatives if any
        if (result.alternatives && result.alternatives.length > 0) {
            alternativeRoutes = result.alternatives;
            console.log(`  Found ${alternativeRoutes.length} alternative routes for this segment`);
        }
    } else {
        // Use OSRM for driving, feet, etc.
        const viaPoints = stop.viaPoints || [];
        if (viaPoints.length > 0) {
            console.log(`Getting ${stop.travelMode} route (${stop.icon}) from "${previousLabel}" to "${stop.label || 'waypoint'}" via ${viaPoints.length} waypoints...`);
        } else {
            console.log(`Getting ${stop.travelMode} route (${stop.icon}) from "${previousLabel}" to "${stop.label || 'waypoint'}"...`);
        }
        coords = await getRouteCoordinates(currentPoint, nextPoint, stop.travelMode, viaPoints);
    }
    
    // Validate coords
    if (!coords || coords.length === 0) {
        console.error(`ERROR: No coordinates returned for segment ${i + 1}`);
        console.error('Creating fallback direct route...');
        // Create fallback direct line
        const numPoints = 50;
        coords = [];
        for (let j = 0; j <= numPoints; j++) {
            const t = j / numPoints;
            coords.push([
                currentPoint[0] + (nextPoint[0] - currentPoint[0]) * t,
                currentPoint[1] + (nextPoint[1] - currentPoint[1]) * t
            ]);
        }
    }
    
    console.log(`Segment ${i + 1}: ${coords.length} coordinates`);
    
    routeSegments.push({
        coordinates: coords,
        icon: stop.icon,
        fromLabel: previousLabel,
        toLabel: stop.label,
        travelMode: stop.travelMode,
        showMarker: stop.label !== null,  // Only show marker if there's a label
        zoomLevel: stop.zoomLevel || null,  // null means auto-calculate
        pause: stop.pause,  // Pause duration in seconds (undefined = default 500ms)
        alternativeRoutes: alternativeRoutes  // Alternative trail routes with colors
    });
    
    currentPoint = nextPoint;
    if (stop.label) {
        previousLabel = stop.label;
    }
}

// Combine all coordinates for zoom calculation
const allCoordinates = routeSegments.flatMap(seg => seg.coordinates);

// Calculate smart zoom level based on distance
function calculateZoom(coords) {
    const lats = coords.map(c => c[0]);
    const lngs = coords.map(c => c[1]);
    const latSpan = Math.max(...lats) - Math.min(...lats);
    const lngSpan = Math.max(...lngs) - Math.min(...lngs);
    const maxSpan = Math.max(latSpan, lngSpan);
    
    // Zoom levels: smaller span = higher zoom
    if (maxSpan > 5) return 6;
    if (maxSpan > 2) return 8;
    if (maxSpan > 1) return 9;
    if (maxSpan > 0.5) return 10;
    if (maxSpan > 0.2) return 11;
    if (maxSpan > 0.1) return 12;
    return 13;
}

// Animation timing (same as animate-frames.js for consistency)
const TITLE_DURATION = 3;
const PAN_DURATION = 2.5;
const ROUTE_DURATION = 25;
const END_DURATION = 2;
const totalDuration = TITLE_DURATION + PAN_DURATION + ROUTE_DURATION + END_DURATION;

console.log(`Animation duration: ${totalDuration} seconds`);

// Animation options
const options = {
    zoom: calculateZoom(allCoordinates),
    lineColor: destinationsConfig.animation?.lineColor || '#8B4513',
    lineWidth: destinationsConfig.animation?.lineWidth || 4,
    animationDuration: ROUTE_DURATION * 1000,
    useSmoothing: true,
    finalDestination: destinationsConfig.stops[destinationsConfig.stops.length - 1].label,
    title: destinationsConfig.title || 'ADVENTURE',
    date: destinationsConfig.date || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    startZoomLevel: destinationsConfig.start.zoomLevel || null,  // Zoom level for flyTo to start
    // Pass timing info for consistent rendering
    titleDuration: TITLE_DURATION,
    panDuration: PAN_DURATION,
    routeDuration: ROUTE_DURATION,
    endDuration: END_DURATION,
    // Tile layer
    tileLayer: TILE_LAYERS[selectedTile]
};

async function previewAnimation() {
    console.log('\n🎬 PREVIEW MODE - Animation will play in browser window');
    console.log(`   Total duration: ${totalDuration}s`);
    console.log('   Close browser window when done, or press Ctrl+C to exit.\n');
    
    console.log('Launching browser...');
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: {
            width: 1280,
            height: 720,
            deviceScaleFactor: 2
        },
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security'
        ]
    });
    
    const page = await browser.newPage();
    
    // Listen to console logs from the browser
    page.on('console', msg => console.log('PAGE:', msg.text()));
    page.on('pageerror', error => console.error('PAGE ERROR:', error.message));
    
    // Load the map HTML
    const htmlPath = 'file://' + join(__dirname, 'map.html');
    console.log('Loading map page...');
    await page.goto(htmlPath, { waitUntil: 'networkidle0' });
    
    // Wait for map to be ready
    await page.waitForFunction(() => window.L !== undefined);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Initialize map with route segments
    console.log('Initializing map...');
    await page.evaluate((segments, opts) => {
        window.initMap(segments, opts);
    }, routeSegments, options);
    
    // Wait for tiles to load with multiple checks
    console.log('Waiting for map tiles to load...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Wait for all images to be loaded
    await page.evaluate(() => {
        return new Promise((resolve) => {
            const images = document.querySelectorAll('img');
            let loaded = 0;
            const total = images.length;
            
            if (total === 0) {
                resolve();
                return;
            }
            
            images.forEach(img => {
                if (img.complete) {
                    loaded++;
                    if (loaded === total) resolve();
                } else {
                    img.addEventListener('load', () => {
                        loaded++;
                        if (loaded === total) resolve();
                    });
                    img.addEventListener('error', () => {
                        loaded++;
                        if (loaded === total) resolve();
                    });
                }
            });
            
            // Timeout after 10 seconds
            setTimeout(resolve, 10000);
        });
    });
    
    // Inject the icon renderer module
    console.log('Loading icon renderer module...');
    await page.evaluate((code) => {
        eval(code);
    }, iconRendererCode);
    
    // Inject the zoom utilities module
    console.log('Loading zoom utilities module...');
    await page.evaluate((code) => {
        eval(code);
    }, zoomUtilsCode);
    
    // Wait for animation function to be ready
    await page.waitForFunction(() => typeof window.animateRoute === 'function', { timeout: 5000 });
    
    console.log('\n▶️  Starting animation preview...\n');
    
    // Start the animation (single pass - no recording, just preview)
    await page.evaluate(() => window.animateRoute());
    
    // Wait for animation to complete
    const totalWaitTime = (totalDuration + 2) * 1000;
    await new Promise(resolve => setTimeout(resolve, totalWaitTime));
    
    console.log('\n✅ Preview complete!');
    console.log('   If the animation looks good, run: npm run frames <config.json>');
    console.log('   Browser window will stay open - close it when done.\n');
    
    // Keep browser open for inspection - user can close it manually
    browser.on('disconnected', () => {
        console.log('Browser closed. Exiting.');
        process.exit(0);
    });
}

previewAnimation().catch(console.error);
