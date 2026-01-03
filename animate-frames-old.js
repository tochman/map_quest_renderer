import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import { readFile, mkdir, rm } from 'fs/promises';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load shared modules
const iconRendererCode = await readFile(join(__dirname, 'icons', 'icon-renderer.js'), 'utf-8');
const zoomUtilsCode = await readFile(join(__dirname, 'js', 'zoom-utils.js'), 'utf-8');
const animationCoreCode = await readFile(join(__dirname, 'js', 'animation-core.js'), 'utf-8');

// Configuration
const FPS = 30;  // Output frame rate
const FRAME_DIR = join(__dirname, 'frames');

// Load destinations from JSON (support custom file via CLI argument)
const jsonArg = process.argv.find(arg => arg.endsWith('.json'));
const destinationsPath = jsonArg 
    ? (jsonArg.startsWith('/') ? jsonArg : join(__dirname, jsonArg))
    : join(__dirname, 'destinations.json');

// Check for --resume flag
const resumeMode = process.argv.includes('--resume');

console.log(`Loading destinations from: ${basename(destinationsPath)}`);
const destinationsConfig = JSON.parse(await readFile(destinationsPath, 'utf-8'));

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
            return [lat, lon];
        }
    } catch (error) {
        console.error('Geocoding error:', error);
    }
    
    return null;
}

// Get start coordinates
console.log(`Geocoding ${destinationsConfig.start.address}...`);
const startPoint = await geocodeAddress(destinationsConfig.start.address);

if (!startPoint) {
    console.error('Could not geocode start address');
    process.exit(1);
}

// Function to get hiking route from GraphHopper API
async function getHikingRoute(start, end, viaPoints = []) {
    const points = [start, ...viaPoints, end];
    const pointsParam = points.map(p => `point=${p[0]},${p[1]}`).join('&');
    
    const apiKey = process.env.GRAPHHOPPER_API_KEY || '';
    const url = `https://graphhopper.com/api/1/route?${pointsParam}&profile=foot&points_encoded=false&key=${apiKey}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.paths && data.paths.length > 0) {
            const coords = data.paths[0].points.coordinates.map(c => [c[1], c[0]]);
            console.log(`Hiking route found with ${coords.length} waypoints`);
            return coords;
        } else if (data.message) {
            console.warn('GraphHopper API:', data.message);
        }
    } catch (error) {
        console.error('Error fetching hiking route:', error);
    }
    
    console.log('Falling back to OSRM foot profile...');
    return getRouteCoordinates(start, end, 'foot', viaPoints);
}

// Function to get route waypoints from OSRM
async function getRouteCoordinates(start, end, profile = 'driving', viaPoints = []) {
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
            const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
            console.log(`Route found with ${coords.length} waypoints`);
            return coords;
        }
    } catch (error) {
        console.error('Error fetching route:', error);
    }
    
    console.log('Using direct line between points');
    return [start, end];
}

// Build route segments
const routeSegments = [];
let currentPoint = startPoint;
let previousLabel = destinationsConfig.start.label;

console.log(`Building route with ${destinationsConfig.stops.length} stops...`);
for (let i = 0; i < destinationsConfig.stops.length; i++) {
    const stop = destinationsConfig.stops[i];
    
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
    if (stop.travelMode === 'direct') {
        console.log(`Creating direct route (${stop.icon}) from "${previousLabel}" to "${stop.label || 'waypoint'}"...`);
        const numPoints = 50;
        coords = [];
        for (let j = 0; j <= numPoints; j++) {
            const t = j / numPoints;
            coords.push([
                currentPoint[0] + (nextPoint[0] - currentPoint[0]) * t,
                currentPoint[1] + (nextPoint[1] - currentPoint[1]) * t
            ]);
        }
    } else if (stop.travelMode === 'hike') {
        const viaPoints = stop.viaPoints || [];
        if (viaPoints.length > 0) {
            console.log(`Getting hike route (${stop.icon}) from "${previousLabel}" to "${stop.label || 'waypoint'}" via ${viaPoints.length} waypoints...`);
        } else {
            console.log(`Getting hike route (${stop.icon}) from "${previousLabel}" to "${stop.label || 'waypoint'}"...`);
        }
        coords = await getHikingRoute(currentPoint, nextPoint, viaPoints);
    } else {
        const viaPoints = stop.viaPoints || [];
        if (viaPoints.length > 0) {
            console.log(`Getting ${stop.travelMode} route (${stop.icon}) from "${previousLabel}" to "${stop.label || 'waypoint'}" via ${viaPoints.length} waypoints...`);
        } else {
            console.log(`Getting ${stop.travelMode} route (${stop.icon}) from "${previousLabel}" to "${stop.label || 'waypoint'}"...`);
        }
        coords = await getRouteCoordinates(currentPoint, nextPoint, stop.travelMode, viaPoints);
    }

    if (!coords || coords.length === 0) {
        console.error(`ERROR: No coordinates returned for segment ${i + 1}`);
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
    
    routeSegments.push({
        coordinates: coords,
        icon: stop.icon,
        fromLabel: previousLabel,
        toLabel: stop.label,
        travelMode: stop.travelMode,
        showMarker: stop.label !== null,
        zoomLevel: stop.zoomLevel || null,  // null means auto-calculate
        pause: stop.pause || 0.5  // pause duration in seconds (default 0.5s)
    });
    
    currentPoint = nextPoint;
    if (stop.label) {
        previousLabel = stop.label;
    }
}

const allCoordinates = routeSegments.flatMap(seg => seg.coordinates);

function calculateZoom(coords) {
    const lats = coords.map(c => c[0]);
    const lngs = coords.map(c => c[1]);
    const latSpan = Math.max(...lats) - Math.min(...lats);
    const lngSpan = Math.max(...lngs) - Math.min(...lngs);
    const maxSpan = Math.max(latSpan, lngSpan);
    
    if (maxSpan > 5) return 6;
    if (maxSpan > 2) return 8;
    if (maxSpan > 1) return 9;
    if (maxSpan > 0.5) return 10;
    if (maxSpan > 0.2) return 11;
    if (maxSpan > 0.1) return 12;
    return 13;
}

// Animation timing configuration
const TITLE_DURATION = 3;      // seconds for title card
const PAN_DURATION = 2.5;      // seconds to pan to start
const ROUTE_DURATION = 25;     // seconds for route animation
const END_DURATION = 2;        // seconds for end card

// Calculate total pause time from all segments
const totalPauseTime = routeSegments.reduce((sum, seg) => sum + (seg.pause || 0.5), 0);
console.log(`   Total pause time: ${totalPauseTime}s`);

const totalDuration = TITLE_DURATION + PAN_DURATION + ROUTE_DURATION + totalPauseTime + END_DURATION;
const totalFrames = Math.ceil(totalDuration * FPS);

// Frame ranges for each phase (including pauses in route phase)
const TITLE_END_FRAME = Math.floor(TITLE_DURATION * FPS);
const PAN_END_FRAME = Math.floor((TITLE_DURATION + PAN_DURATION) * FPS);
const ROUTE_END_FRAME = Math.floor((TITLE_DURATION + PAN_DURATION + ROUTE_DURATION + totalPauseTime) * FPS);

// Calculate pause frame ranges for each segment
const segmentPauseFrames = routeSegments.map(seg => Math.floor((seg.pause || 0.5) * FPS));
const totalPauseFrames = segmentPauseFrames.reduce((a, b) => a + b, 0);
const routeOnlyFrames = ROUTE_END_FRAME - PAN_END_FRAME - totalPauseFrames; // Frames for actual movement

console.log(`\n📊 Animation Plan:`);
console.log(`   Total duration: ${totalDuration}s`);
console.log(`   Frame rate: ${FPS} fps`);
console.log(`   Total frames: ${totalFrames}`);
console.log(`   Phases: Title (0-${TITLE_END_FRAME}), Pan (${TITLE_END_FRAME}-${PAN_END_FRAME}), Route (${PAN_END_FRAME}-${ROUTE_END_FRAME}), End (${ROUTE_END_FRAME}-${totalFrames})`);

const options = {
    zoom: calculateZoom(allCoordinates),
    lineColor: destinationsConfig.animation?.lineColor || '#8B4513',
    lineWidth: destinationsConfig.animation?.lineWidth || 4,
    finalDestination: destinationsConfig.stops[destinationsConfig.stops.length - 1].label,
    title: destinationsConfig.title || 'ADVENTURE',
    date: destinationsConfig.date || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    startZoomLevel: destinationsConfig.start.zoomLevel || null,  // Zoom level for start point
    // Tile layer
    tileLayer: TILE_LAYERS[selectedTile]
};

async function createFrameByFrameAnimation() {
    // Create frames directory (don't delete if resuming)
    if (!resumeMode) {
        try {
            await rm(FRAME_DIR, { recursive: true, force: true });
        } catch (e) {}
    }
    await mkdir(FRAME_DIR, { recursive: true });
    
    console.log('\n🚀 Launching browser...');
    const browser = await puppeteer.launch({
        headless: 'new',
        defaultViewport: {
            width: 1280,
            height: 720,
            deviceScaleFactor: 2
        },
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-dev-shm-usage'
        ]
    });
    
    const page = await browser.newPage();
    
    // Load the map
    const htmlPath = 'file://' + join(__dirname, 'map.html');
    console.log('Loading map page...');
    await page.goto(htmlPath, { waitUntil: 'networkidle0' });
    
    await page.waitForFunction(() => window.L !== undefined);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Initialize map
    console.log('Initializing map...');
    await page.evaluate((segments, opts) => {
        window.initMap(segments, opts);
    }, routeSegments, options);
    
    // Wait for tiles to fully load
    console.log('Waiting for map tiles to load...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
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
    
    // Setup the frame-by-frame animation controller with FULL cinematic features
    console.log('Setting up cinematic frame-by-frame animation...');
    await page.evaluate((totalFrames, fps, titleEndFrame, panEndFrame, routeEndFrame, routeDuration, segmentPauseFrames, routeOnlyFrames) => {
        
        const { routeSegments, lineColor, lineWidth, finalDestination, title, date, startZoomLevel } = window.mapData;
        const allCoordinates = routeSegments.flatMap(seg => seg.coordinates);
        
        // Calculate segment progress thresholds for determining which segment we're in
        const segmentProgressThresholds = window.ZoomUtils.calculateSegmentProgressThresholds(routeSegments);
        
        // Calculate segment zoom levels - respects per-stop zoomLevel from config
        const segmentZoomLevels = window.ZoomUtils.calculateSegmentZoomLevels(map, routeSegments, allCoordinates, {
            maxZoom: 15,
            defaultCloseZoom: 13
        });
        
        // Create zoom keyframes for smooth interpolation between per-segment zoom levels
        const zoomKeyframes = window.ZoomUtils.createZoomKeyframes(segmentZoomLevels, segmentProgressThresholds);
        
        // Starting zoom level (from start.zoomLevel or first segment)
        const closeZoom = startZoomLevel || segmentZoomLevels[0] || 13;
        
        // Calculate bounds for positioning
        const bounds = L.latLngBounds(allCoordinates);
        
        // Animation state (persistent across frames)
        window.animState = {
            // Track angle per icon type to avoid issues when switching icons
            lastAngles: { bike: 0, car: 0, person: 0, backpacker: 0 },
            // Smooth camera tracking
            cameraLat: null,
            cameraLng: null,
            cameraZoom: null,
            animatedLine: null,
            startMarker: null,
            endMarker: null,
            waypointMarkers: [],
            waypointLabels: [],
            waypointShown: [],
            titleCardShown: false,
            dateStampShown: false,
            startMarkerPlaced: false,
            endMarkerPlaced: false,
            iconsSetup: false,
            // Pause tracking
            lastPausedAfterSegment: -1,
            pauseFramesRemaining: 0,
            isPaused: false,
            // Track the "effective" frame number (excluding pause frames)
            effectiveRouteFrame: 0
        };
        
        // Calculate cumulative pause frames for each segment
        const cumulativePauseFrames = [];
        let pauseSum = 0;
        for (let i = 0; i < segmentPauseFrames.length; i++) {
            cumulativePauseFrames.push(pauseSum);
            pauseSum += segmentPauseFrames[i];
        }
        
        // Render a specific frame with full cinematic features
        window.renderCinematicFrame = function(frameNumber) {
            const state = window.animState;
            
            const titleCard = document.getElementById('title-card');
            const dateStamp = document.getElementById('date-stamp');
            const destinationCard = document.getElementById('destination-card');
            const motorcycle = document.getElementById('motorcycle');
            const person = document.getElementById('person');
            const car = document.getElementById('car');
            const backpacker = document.getElementById('backpacker');
            
            // === PHASE 1: TITLE CARD (0 to titleEndFrame) ===
            if (frameNumber < titleEndFrame) {
                const titleProgress = frameNumber / titleEndFrame;
                
                // Fade in/out title card
                if (titleProgress < 0.15) {
                    titleCard.style.opacity = titleProgress / 0.15;
                } else if (titleProgress > 0.85) {
                    titleCard.style.opacity = (1 - titleProgress) / 0.15;
                } else {
                    titleCard.style.opacity = '1';
                }
                titleCard.innerHTML = `<div class="title-text">${title}</div><div class="date-text">${date}</div>`;
                
                // Show overview of route (only once on first frame to avoid flicker)
                if (frameNumber === 0) {
                    map.fitBounds(bounds, { padding: [50, 50], animate: false });
                }
                
                return; // Don't process other phases
            }
            
            // Hide title card after phase 1
            titleCard.style.opacity = '0';
            
            // Show corner title stamp
            if (!state.dateStampShown) {
                dateStamp.textContent = title.toUpperCase();
                dateStamp.style.opacity = '1';
                state.dateStampShown = true;
            }
            
            // === PHASE 2: PAN TO START (titleEndFrame to panEndFrame) ===
            if (frameNumber < panEndFrame) {
                const panProgress = (frameNumber - titleEndFrame) / (panEndFrame - titleEndFrame);
                
                // Place start marker if not done
                if (!state.startMarkerPlaced) {
                    state.startMarker = L.circleMarker(allCoordinates[0], {
                        radius: 10,
                        fillColor: '#8B0000',
                        color: '#3d2817',
                        weight: 3,
                        fillOpacity: 0.9
                    }).addTo(map);
                    
                    L.marker(allCoordinates[0], {
                        icon: L.divIcon({
                            className: 'location-label',
                            html: routeSegments[0].fromLabel || 'START',
                            iconSize: [160, 30],
                            iconAnchor: [80, -20]
                        })
                    }).addTo(map);
                    
                    state.startMarkerPlaced = true;
                    
                    // Initialize camera position at overview
                    const overviewCenter = bounds.getCenter();
                    const overviewZoom = map.getBoundsZoom(bounds, false, [50, 50]);
                    state.cameraLat = overviewCenter.lat;
                    state.cameraLng = overviewCenter.lng;
                    state.cameraZoom = overviewZoom;
                }
                
                // Target: start point at close zoom
                const startCoord = allCoordinates[0];
                const targetZoom = closeZoom;
                
                // Smooth ease-out cubic for cinematic feel
                const easeProgress = 1 - Math.pow(1 - panProgress, 3);
                
                // Calculate target positions
                const overviewCenter = bounds.getCenter();
                const overviewZoom = map.getBoundsZoom(bounds, false, [50, 50]);
                const targetLat = overviewCenter.lat + (startCoord[0] - overviewCenter.lat) * easeProgress;
                const targetLng = overviewCenter.lng + (startCoord[1] - overviewCenter.lng) * easeProgress;
                const targetZoomInterp = overviewZoom + (targetZoom - overviewZoom) * easeProgress;
                
                // Smooth camera interpolation (creates fluid motion)
                const smoothing = 0.15;
                state.cameraLat += (targetLat - state.cameraLat) * smoothing;
                state.cameraLng += (targetLng - state.cameraLng) * smoothing;
                state.cameraZoom += (targetZoomInterp - state.cameraZoom) * smoothing;
                
                map.setView([state.cameraLat, state.cameraLng], state.cameraZoom, { animate: false });
                
                return;
            }
            
            // === Setup for route animation (once) ===
            if (!state.endMarkerPlaced) {
                // Add end marker (hidden)
                state.endMarker = L.circleMarker(allCoordinates[allCoordinates.length - 1], {
                    radius: 10,
                    fillColor: '#006400',
                    color: '#3d2817',
                    weight: 3,
                    fillOpacity: 0
                }).addTo(map);
                
                window.endLabel = L.marker(allCoordinates[allCoordinates.length - 1], {
                    icon: L.divIcon({
                        className: 'location-label',
                        html: finalDestination || 'DESTINATION',
                        iconSize: [260, 30],
                        iconAnchor: [130, -20]
                    }),
                    opacity: 0
                }).addTo(map);
                
                // Pre-create waypoint markers (hidden)
                for (let i = 0; i < routeSegments.length - 1; i++) {
                    if (routeSegments[i].toLabel) {
                        const endCoord = routeSegments[i].coordinates[routeSegments[i].coordinates.length - 1];
                        
                        const marker = L.circleMarker(endCoord, {
                            radius: 10,
                            fillColor: '#FF8C00',
                            color: '#3d2817',
                            weight: 3,
                            fillOpacity: 0
                        }).addTo(map);
                        
                        const label = L.marker(endCoord, {
                            icon: L.divIcon({
                                className: 'location-label',
                                html: routeSegments[i].toLabel,
                                iconSize: [200, 30],
                                iconAnchor: [100, -20]
                            }),
                            opacity: 0
                        }).addTo(map);
                        
                        state.waypointMarkers.push(marker);
                        state.waypointLabels.push(label);
                        state.waypointShown.push(false);
                    }
                }
                
                // Track faded out waypoints
                state.waypointFadedOut = new Array(state.waypointMarkers.length).fill(false);
                
                state.endMarkerPlaced = true;
            }
            
            // Setup icons (once)
            if (!state.iconsSetup) {
                motorcycle.style.display = 'block';
                person.style.display = 'block';
                car.style.display = 'block';
                backpacker.style.display = 'block';
                state.iconsSetup = true;
            }
            
            // === PHASE 3: ROUTE ANIMATION (panEndFrame to routeEndFrame) ===
            if (frameNumber < routeEndFrame) {
                // Calculate which frame within the route phase we're at
                const routeFrameNumber = frameNumber - panEndFrame;
                
                // Handle pausing: check if we're in a pause period
                if (state.isPaused) {
                    state.pauseFramesRemaining--;
                    if (state.pauseFramesRemaining <= 0) {
                        state.isPaused = false;
                    }
                    // During pause, keep the current view frozen - don't update anything
                    return;
                }
                
                // Calculate effective progress (excluding pause frames already taken)
                const pauseFramesSoFar = cumulativePauseFrames[state.lastPausedAfterSegment + 1] || 0;
                const effectiveFrame = routeFrameNumber - pauseFramesSoFar;
                const routeProgress = Math.min(effectiveFrame / routeOnlyFrames, 1);
                
                // Use shared utility to determine segment info
                const segInfo = window.ZoomUtils.getSegmentInfo(routeProgress, segmentProgressThresholds);
                const { currentSegment, segmentProgress } = segInfo;
                
                // Check if we need to pause at the END of a segment (when entering a new segment)
                if (currentSegment > 0 && state.lastPausedAfterSegment < currentSegment - 1) {
                    // We just finished segment (currentSegment - 1), time to pause
                    state.lastPausedAfterSegment = currentSegment - 1;
                    state.isPaused = true;
                    state.pauseFramesRemaining = segmentPauseFrames[currentSegment - 1] || 15;
                    // Return to freeze this frame during pause
                    return;
                }
                
                // Fade in waypoint labels when approaching
                for (let i = 0; i < state.waypointMarkers.length; i++) {
                    if (!state.waypointShown[i]) {
                        const showThreshold = i === 0 
                            ? segmentProgressThresholds[0] * 0.33 
                            : segmentProgressThresholds[i] - (segmentProgressThresholds[i] - (segmentProgressThresholds[i-1] || 0)) * 0.67;
                        
                        if (routeProgress >= showThreshold) {
                            state.waypointMarkers[i].setStyle({ fillOpacity: 0.9 });
                            state.waypointLabels[i].setOpacity(1);
                            state.waypointShown[i] = true;
                        }
                    }
                    
                    // Fade out waypoint labels after we've been in the next segment for a bit (20% through)
                    if (state.waypointShown[i] && !state.waypointFadedOut[i] && currentSegment > i && segmentProgress > 0.2) {
                        state.waypointMarkers[i].setStyle({ fillOpacity: 0 });
                        state.waypointLabels[i].setOpacity(0);
                        state.waypointFadedOut[i] = true;
                    }
                }
                
                // Get current icon type and check for upcoming icon change
                const currentIconType = routeSegments[currentSegment].icon;
                const nextSegment = currentSegment + 1;
                const nextIconType = nextSegment < routeSegments.length ? routeSegments[nextSegment].icon : null;
                const iconWillChange = nextIconType && nextIconType !== currentIconType;
                
                // Fade out icon early if approaching a stop where icon will change (95% through segment)
                const fadeOutThreshold = 0.95;
                const shouldFadeOutEarly = iconWillChange && segmentProgress > fadeOutThreshold;
                
                let currentIcon;
                
                // Hide all icons, show current (unless fading out early or icon is 'none')
                motorcycle.style.opacity = '0';
                person.style.opacity = '0';
                car.style.opacity = '0';
                backpacker.style.opacity = '0';
                
                if (currentIconType === 'none' || shouldFadeOutEarly) {
                    currentIcon = null;
                } else if (currentIconType === 'bike') {
                    currentIcon = motorcycle;
                    motorcycle.style.opacity = '1';
                } else if (currentIconType === 'car') {
                    currentIcon = car;
                    car.style.opacity = '1';
                } else if (currentIconType === 'backpacker') {
                    currentIcon = backpacker;
                    backpacker.style.opacity = '1';
                } else {
                    currentIcon = person;
                    person.style.opacity = '1';
                }
                
                const coordinates = routeSegments[currentSegment].coordinates;
                
                // === ZOOM: Interpolate between per-segment zoom levels from config ===
                // This respects the zoomLevel set on each stop in destinations.json
                const targetZoom = window.ZoomUtils.getInterpolatedZoom(routeProgress, zoomKeyframes);
                
                // Calculate position within current segment
                const totalPoints = coordinates.length - 1;
                const currentFloat = segmentProgress * totalPoints;
                const currentIndex = Math.floor(currentFloat);
                const fraction = currentFloat - currentIndex;
                
                // Get vehicle position with interpolation
                const safeIndex = Math.max(0, Math.min(currentIndex, coordinates.length - 1));
                const safeNextIndex = Math.min(safeIndex + 1, coordinates.length - 1);
                
                let vehiclePos;
                if (safeIndex < coordinates.length - 1 && fraction > 0) {
                    const current = coordinates[safeIndex];
                    const next = coordinates[safeNextIndex];
                    vehiclePos = [
                        current[0] + (next[0] - current[0]) * fraction,
                        current[1] + (next[1] - current[1]) * fraction
                    ];
                } else {
                    vehiclePos = coordinates[safeIndex];
                }
                
                // === CINEMATIC CAMERA: Look ahead of vehicle ===
                // Camera leads the vehicle by looking at a point ahead on the route
                const lookAheadDistance = Math.min(30, coordinates.length - safeIndex - 1);
                const lookAheadIndex = Math.min(safeIndex + lookAheadDistance, coordinates.length - 1);
                const lookAheadPos = coordinates[lookAheadIndex];
                
                // Blend between vehicle position and look-ahead
                // More look-ahead when zoomed out (lower zoom number)
                const zoomOutFactor = Math.max(0, (14 - targetZoom) / 4);
                const lookAheadBlend = 0.2 * zoomOutFactor;
                const targetLat = vehiclePos[0] + (lookAheadPos[0] - vehiclePos[0]) * lookAheadBlend;
                const targetLng = vehiclePos[1] + (lookAheadPos[1] - vehiclePos[1]) * lookAheadBlend;
                
                // Initialize camera if needed (first frame of route phase)
                if (state.cameraLat === null) {
                    state.cameraLat = targetLat;
                    state.cameraLng = targetLng;
                    state.cameraZoom = targetZoom;
                }
                
                // Smooth camera POSITION tracking
                const positionSmoothing = 0.12;
                
                state.cameraLat += (targetLat - state.cameraLat) * positionSmoothing;
                state.cameraLng += (targetLng - state.cameraLng) * positionSmoothing;
                
                // Smooth ZOOM tracking - use higher value for frames since we don't have Leaflet's animate
                const zoomSmoothing = 0.06;
                state.cameraZoom += (targetZoom - state.cameraZoom) * zoomSmoothing;
                
                // Set camera with smoothed position and zoom
                map.setView([state.cameraLat, state.cameraLng], state.cameraZoom, { animate: false });
                
                // Build visible coordinates for line
                const visibleCoords = coordinates.slice(0, safeIndex + 1);
                if (safeIndex < coordinates.length - 1 && fraction > 0) {
                    visibleCoords.push([
                        coordinates[safeIndex][0] + (coordinates[safeNextIndex][0] - coordinates[safeIndex][0]) * fraction,
                        coordinates[safeIndex][1] + (coordinates[safeNextIndex][1] - coordinates[safeIndex][1]) * fraction
                    ]);
                }
                
                // Remove old line
                if (state.animatedLine) {
                    map.removeLayer(state.animatedLine);
                }
                
                // Build complete line including previous segments
                let allVisibleCoords = [];
                for (let i = 0; i < currentSegment; i++) {
                    allVisibleCoords.push(...routeSegments[i].coordinates);
                }
                allVisibleCoords.push(...visibleCoords);
                
                // Draw line
                if (allVisibleCoords.length > 1) {
                    state.animatedLine = L.polyline(allVisibleCoords, {
                        color: lineColor,
                        weight: lineWidth,
                        opacity: 0.9,
                        smoothFactor: 1,
                        dashArray: '10, 8',
                        className: 'route-line'
                    }).addTo(map);
                }
                
                // Position icon (only if we have one)
                if (visibleCoords.length > 0 && currentIcon) {
                    const currentPos = visibleCoords[visibleCoords.length - 1];
                    const point = map.latLngToContainerPoint(currentPos);
                    
                    // Get icon size from renderer
                    const iconSize = window.IconRenderer.getIconSize(currentIconType);
                    const iconOffset = iconSize / 2;
                    currentIcon.style.left = (point.x - iconOffset) + 'px';
                    currentIcon.style.top = (point.y - iconOffset) + 'px';
                    
                    // === ICON TRANSFORM (rotation + mirroring) ===
                    // Look VERY far ahead for stable direction (300+ waypoints to prevent jitter)
                    const lookAhead = Math.min(coordinates.length - 1, safeIndex + 300);
                    const fromPos = coordinates[safeIndex];
                    const toPos = coordinates[lookAhead];
                    
                    const fromPoint = map.latLngToContainerPoint(fromPos);
                    const toPoint = map.latLngToContainerPoint(toPos);
                    
                    const dx = toPoint.x - fromPoint.x;
                    const dy = toPoint.y - fromPoint.y;
                    
                    // Use IconRenderer for transform calculation
                    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                        const iconLastAngle = state.lastAngles[currentIconType] || 0;
                        
                        const transform = window.IconRenderer.calculateIconTransform(
                            currentIconType,
                            dx,
                            dy,
                            iconLastAngle,
                            0.03  // Very slow interpolation to prevent jitter
                        );
                        
                        state.lastAngles[currentIconType] = transform.newLastAngle;
                        
                        // Build transform string
                        const transformStr = window.IconRenderer.getIconTransformCSS(
                            transform.angle,
                            transform.scaleX
                        );
                        
                        currentIcon.style.transform = transformStr;
                        currentIcon.style.transformOrigin = 'center center';
                    }
                }
                
                // Show end marker near completion
                if (routeProgress >= 0.98 && state.endMarker) {
                    state.endMarker.setStyle({ fillOpacity: 0.9 });
                }
                
                return;
            }
            
            // === PHASE 4: END CARD (routeEndFrame to end) ===
            const endProgress = (frameNumber - routeEndFrame) / (totalFrames - routeEndFrame);
            
            // Hide vehicle icons
            motorcycle.style.opacity = '0';
            person.style.opacity = '0';
            car.style.opacity = '0';
            backpacker.style.opacity = '0';
            
            // Show end marker
            if (state.endMarker) {
                state.endMarker.setStyle({ fillOpacity: 0.9 });
            }
            
            // Show end label
            if (window.endLabel && endProgress > 0.2) {
                window.endLabel.setOpacity(1);
            }
            
            // Fade in destination card
            if (endProgress > 0.3) {
                const fadeProgress = Math.min(1, (endProgress - 0.3) / 0.3);
                destinationCard.style.opacity = fadeProgress;
                const destText = destinationCard.querySelector('.destination-text');
                if (destText) {
                    destText.textContent = finalDestination || 'ARRIVED';
                }
            }
        };
        
    }, totalFrames, FPS, TITLE_END_FRAME, PAN_END_FRAME, ROUTE_END_FRAME, ROUTE_DURATION, segmentPauseFrames, routeOnlyFrames);
    
    // Wait for setup
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Capture frames
    console.log('\n🎬 Capturing frames...');
    if (resumeMode) {
        console.log('   (Resume mode - skipping existing frames)');
    }
    const startTime = Date.now();
    let skippedFrames = 0;
    let capturedFrames = 0;
    
    for (let frame = 0; frame < totalFrames; frame++) {
        const framePath = join(FRAME_DIR, `frame_${String(frame).padStart(5, '0')}.png`);
        
        // Skip if frame exists and we're in resume mode
        if (resumeMode && existsSync(framePath)) {
            skippedFrames++;
            // Still render to advance state
            try {
                await page.evaluate((f) => window.renderCinematicFrame(f), frame);
            } catch (e) {}
            continue;
        }
        
        // Render this frame
        try {
            await page.evaluate((f) => window.renderCinematicFrame(f), frame);
        } catch (renderError) {
            console.error(`\n⚠️  Error rendering frame ${frame}: ${renderError.message}`);
            continue;
        }
        
        // Small delay for rendering
        await new Promise(resolve => setTimeout(resolve, 15));
        
        // Capture screenshot
        await page.screenshot({ path: framePath, type: 'png' });
        capturedFrames++;
        
        // Progress update
        if (frame % 30 === 0 || frame === totalFrames - 1) {
            const elapsed = (Date.now() - startTime) / 1000;
            const progress = ((frame + 1) / totalFrames * 100).toFixed(1);
            const rate = capturedFrames > 0 ? elapsed / capturedFrames : 1;
            const eta = Math.max(0, rate * (totalFrames - frame - 1 - skippedFrames)).toFixed(0);
            const skipInfo = skippedFrames > 0 ? ` (${skippedFrames} skipped)` : '';
            process.stdout.write(`\r   Frame ${frame + 1}/${totalFrames} (${progress}%)${skipInfo} - ETA: ${eta}s   `);
        }
    }
    
    console.log('\n\n✅ All frames captured!');
    
    await browser.close();
    
    // Encode video
    console.log('\n🎥 Encoding video with ffmpeg...');
    
    try {
        execSync(`ffmpeg -y -framerate ${FPS} -i "${FRAME_DIR}/frame_%05d.png" -c:v libx264 -pix_fmt yuv420p -preset slow -crf 18 -movflags +faststart "${join(__dirname, 'map-animation.mp4')}"`, {
            stdio: 'inherit'
        });
        
        console.log('\n✅ Video saved as map-animation.mp4');
        
        // Cleanup
        console.log('Cleaning up frames...');
        await rm(FRAME_DIR, { recursive: true, force: true });
        
        console.log('\n🎉 Done! Your cinematic animation is ready.');
        
    } catch (error) {
        console.error('FFmpeg error:', error.message);
        console.log(`Frames kept in ${FRAME_DIR}`);
    }
}

createFrameByFrameAnimation().catch(console.error);
