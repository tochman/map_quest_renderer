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
const zoomUtilsCode = await readFile(join(__dirname, 'js', 'zoom-utils.js'), 'utf-8');
const animationCoreCode = await readFile(join(__dirname, 'js', 'animation-core.js'), 'utf-8');

// Configuration
const FPS = 30;
const FRAME_DIR = join(__dirname, 'frames');

// Load destinations from JSON
const jsonArg = process.argv.find(arg => arg.endsWith('.json'));
const destinationsPath = jsonArg 
    ? (jsonArg.startsWith('/') ? jsonArg : join(__dirname, jsonArg))
    : join(__dirname, 'destinations.json');

const resumeMode = process.argv.includes('--resume');

console.log(`Loading destinations from: ${basename(destinationsPath)}`);
const destinationsConfig = JSON.parse(await readFile(destinationsPath, 'utf-8'));

// Tile layer configurations
const TILE_LAYERS = {
    osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', options: { maxZoom: 19 } },
    watercolor: { url: 'https://watercolormaps.collection.cooperhewitt.org/tile/watercolor/{z}/{x}/{y}.jpg', options: { maxZoom: 15 } },
    terrain: { url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png', options: { maxZoom: 17 } },
    toner: { url: 'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', options: { maxZoom: 20 } },
    dark: { url: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', options: { maxZoom: 20 } },
    voyager: { url: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', options: { maxZoom: 20 } },
    'toner-nolabels': { url: 'https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png', options: { maxZoom: 20 } },
    'voyager-nolabels': { url: 'https://a.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png', options: { maxZoom: 20 } },
    humanitarian: { url: 'https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', options: { maxZoom: 19 } }
};

// Parse --tile argument
const tileArg = process.argv.find(arg => arg.startsWith('--tile'));
let selectedTile = 'osm';
if (tileArg) {
    const tileIndex = process.argv.indexOf(tileArg);
    if (tileArg.includes('=')) selectedTile = tileArg.split('=')[1];
    else if (process.argv[tileIndex + 1] && !process.argv[tileIndex + 1].startsWith('-')) selectedTile = process.argv[tileIndex + 1];
}
if (!TILE_LAYERS[selectedTile]) {
    console.error(`Unknown tile: ${selectedTile}. Available: ${Object.keys(TILE_LAYERS).join(', ')}`);
    process.exit(1);
}
console.log(`Using tile layer: ${selectedTile}`);

// Geocode address
async function geocodeAddress(address) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    try {
        const response = await fetch(url, { headers: { 'User-Agent': 'MapAnimation/1.0' } });
        const data = await response.json();
        if (data.length > 0) {
            console.log(`Found: ${data[0].display_name}`);
            return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
        }
    } catch (error) { console.error('Geocoding error:', error); }
    return null;
}

// Get hiking route from GraphHopper
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
            console.log(`Hiking route: ${coords.length} waypoints`);
            return coords;
        }
    } catch (error) { console.error('Hiking route error:', error); }
    return getRouteCoordinates(start, end, 'foot', viaPoints);
}

// Get route from OSRM
async function getRouteCoordinates(start, end, profile = 'driving', viaPoints = []) {
    let coordsString = `${start[1]},${start[0]}`;
    for (const via of viaPoints) coordsString += `;${via[1]},${via[0]}`;
    coordsString += `;${end[1]},${end[0]}`;
    
    const url = `https://router.project-osrm.org/route/v1/${profile}/${coordsString}?overview=full&geometries=geojson`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.routes && data.routes.length > 0) {
            const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
            console.log(`Route: ${coords.length} waypoints`);
            return coords;
        }
    } catch (error) { console.error('Route error:', error); }
    return [start, end];
}

// Build route segments
console.log(`Geocoding ${destinationsConfig.start.address}...`);
const startPoint = await geocodeAddress(destinationsConfig.start.address);
if (!startPoint) { console.error('Could not geocode start'); process.exit(1); }

const routeSegments = [];
let currentPoint = startPoint;
let previousLabel = destinationsConfig.start.label;

console.log(`Building route with ${destinationsConfig.stops.length} stops...`);
for (const stop of destinationsConfig.stops) {
    let nextPoint = stop.coordinates;
    if (!nextPoint && stop.address) {
        console.log(`Geocoding: ${stop.address}...`);
        nextPoint = await geocodeAddress(stop.address);
        if (!nextPoint) { console.error(`Could not geocode: ${stop.address}`); process.exit(1); }
    }
    
    let coords;
    if (stop.travelMode === 'direct') {
        coords = [];
        for (let j = 0; j <= 50; j++) {
            const t = j / 50;
            coords.push([currentPoint[0] + (nextPoint[0] - currentPoint[0]) * t, currentPoint[1] + (nextPoint[1] - currentPoint[1]) * t]);
        }
    } else if (stop.travelMode === 'hike') {
        console.log(`Getting hike route to "${stop.label}"...`);
        coords = await getHikingRoute(currentPoint, nextPoint, stop.viaPoints || []);
    } else {
        console.log(`Getting ${stop.travelMode} route to "${stop.label}"...`);
        coords = await getRouteCoordinates(currentPoint, nextPoint, stop.travelMode, stop.viaPoints || []);
    }
    
    routeSegments.push({
        coordinates: coords,
        icon: stop.icon,
        fromLabel: previousLabel,
        toLabel: stop.label,
        travelMode: stop.travelMode,
        zoomLevel: stop.zoomLevel || null,
        pause: stop.pause || 0.5
    });
    
    currentPoint = nextPoint;
    if (stop.label) previousLabel = stop.label;
}

const allCoordinates = routeSegments.flatMap(seg => seg.coordinates);

// Timing configuration
const TITLE_DURATION = 3;
const PAN_DURATION = 2.5;
const ROUTE_DURATION = 25;
const END_DURATION = 2;

const totalPauseTime = routeSegments.reduce((sum, seg) => sum + (seg.pause || 0.5), 0);
const totalDuration = TITLE_DURATION + PAN_DURATION + ROUTE_DURATION + totalPauseTime + END_DURATION;
const totalFrames = Math.ceil(totalDuration * FPS);

// Frame ranges
const TITLE_END_FRAME = Math.floor(TITLE_DURATION * FPS);
const PAN_END_FRAME = Math.floor((TITLE_DURATION + PAN_DURATION) * FPS);
const ROUTE_END_FRAME = Math.floor((TITLE_DURATION + PAN_DURATION + ROUTE_DURATION + totalPauseTime) * FPS);

// Pause frames per segment
const segmentPauseFrames = routeSegments.map(seg => Math.floor((seg.pause || 0.5) * FPS));
const totalPauseFrames = segmentPauseFrames.reduce((a, b) => a + b, 0);
const routeOnlyFrames = ROUTE_END_FRAME - PAN_END_FRAME - totalPauseFrames;

console.log(`\n📊 Animation Plan:`);
console.log(`   Duration: ${totalDuration}s, Frames: ${totalFrames}, FPS: ${FPS}`);
console.log(`   Phases: Title (0-${TITLE_END_FRAME}), Pan (${TITLE_END_FRAME}-${PAN_END_FRAME}), Route (${PAN_END_FRAME}-${ROUTE_END_FRAME}), End (${ROUTE_END_FRAME}-${totalFrames})`);

const options = {
    lineColor: destinationsConfig.animation?.lineColor || '#8B4513',
    lineWidth: destinationsConfig.animation?.lineWidth || 4,
    finalDestination: destinationsConfig.stops[destinationsConfig.stops.length - 1].label,
    title: destinationsConfig.title || 'ADVENTURE',
    date: destinationsConfig.date || '',
    startZoomLevel: destinationsConfig.start.zoomLevel || null,
    tileLayer: TILE_LAYERS[selectedTile]
};

async function createFrameByFrameAnimation() {
    if (!resumeMode) {
        try { await rm(FRAME_DIR, { recursive: true, force: true }); } catch (e) {}
    }
    await mkdir(FRAME_DIR, { recursive: true });
    
    console.log('\n🚀 Launching browser...');
    const browser = await puppeteer.launch({
        headless: 'new',
        defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
    });
    
    const page = await browser.newPage();
    const htmlPath = 'file://' + join(__dirname, 'map.html');
    console.log('Loading map...');
    await page.goto(htmlPath, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.L !== undefined);
    await new Promise(r => setTimeout(r, 1000));
    
    console.log('Initializing map...');
    await page.evaluate((segments, opts) => window.initMap(segments, opts), routeSegments, options);
    
    console.log('Waiting for tiles...');
    await new Promise(r => setTimeout(r, 5000));
    
    // Inject shared modules
    console.log('Loading modules...');
    await page.evaluate((code) => eval(code), zoomUtilsCode);
    await page.evaluate((code) => eval(code), animationCoreCode);
    
    // Setup frame renderer using shared AnimationCore
    console.log('Setting up frame renderer...');
    await page.evaluate((totalFrames, titleEndFrame, panEndFrame, routeEndFrame, segmentPauseFrames, routeOnlyFrames) => {
        const { routeSegments, lineColor, lineWidth, finalDestination, title, date, startZoomLevel } = window.mapData;
        
        // Initialize using shared module
        window.animState = window.AnimationCore.createAnimationState();
        window.animConfig = window.AnimationCore.createAnimationConfig(map, routeSegments, {
            startZoomLevel, lineColor, lineWidth, title, date, finalDestination
        });
        
        // DOM elements
        window.animElements = {
            titleCard: document.getElementById('title-card'),
            dateStamp: document.getElementById('date-stamp'),
            destinationCard: document.getElementById('destination-card'),
            motorcycle: document.getElementById('motorcycle'),
            person: document.getElementById('person'),
            car: document.getElementById('car'),
            backpacker: document.getElementById('backpacker')
        };
        
        // Smoothing for frame-by-frame (no Leaflet animation)
        window.animSmoothing = { position: 0.12, zoom: 0.06, animate: false };
        
        // Pause tracking
        window.pauseState = {
            isPaused: false,
            pauseFramesRemaining: 0,
            lastPausedAfterSegment: -1
        };
        
        // Cumulative pause frames
        window.cumulativePauseFrames = [];
        let sum = 0;
        for (let i = 0; i < segmentPauseFrames.length; i++) {
            window.cumulativePauseFrames.push(sum);
            sum += segmentPauseFrames[i];
        }
        
        window.renderCinematicFrame = function(frameNumber) {
            const ps = window.pauseState;
            
            // Handle pause
            if (ps.isPaused) {
                ps.pauseFramesRemaining--;
                if (ps.pauseFramesRemaining <= 0) ps.isPaused = false;
                return;
            }
            
            // Determine phase and progress
            let phase, phaseProgress;
            
            if (frameNumber < titleEndFrame) {
                phase = 'title';
                phaseProgress = frameNumber / titleEndFrame;
            } else if (frameNumber < panEndFrame) {
                phase = 'pan';
                phaseProgress = (frameNumber - titleEndFrame) / (panEndFrame - titleEndFrame);
            } else if (frameNumber < routeEndFrame) {
                phase = 'route';
                // Account for pauses in route progress
                const routeFrameNumber = frameNumber - panEndFrame;
                const pauseFramesSoFar = window.cumulativePauseFrames[ps.lastPausedAfterSegment + 1] || 0;
                const effectiveFrame = routeFrameNumber - pauseFramesSoFar;
                phaseProgress = Math.min(effectiveFrame / routeOnlyFrames, 1);
            } else {
                phase = 'end';
                phaseProgress = (frameNumber - routeEndFrame) / (totalFrames - routeEndFrame);
            }
            
            // Render using shared module
            const result = window.AnimationCore.renderFrame({
                phase,
                phaseProgress: Math.min(1, Math.max(0, phaseProgress)),
                state: window.animState,
                config: window.animConfig,
                map: window.map,
                routeSegments: routeSegments,
                elements: window.animElements,
                smoothing: window.animSmoothing
            });
            
            // Handle pause request
            if (result.shouldPause && result.pauseDuration > 0) {
                ps.lastPausedAfterSegment = result.pauseAtSegment;
                ps.isPaused = true;
                ps.pauseFramesRemaining = Math.floor(result.pauseDuration * 30); // 30 FPS
            }
        };
        
    }, totalFrames, TITLE_END_FRAME, PAN_END_FRAME, ROUTE_END_FRAME, segmentPauseFrames, routeOnlyFrames);
    
    await new Promise(r => setTimeout(r, 2000));
    
    // Capture frames
    console.log('\n🎬 Capturing frames...');
    const startTime = Date.now();
    let skippedFrames = 0, capturedFrames = 0;
    
    for (let frame = 0; frame < totalFrames; frame++) {
        const framePath = join(FRAME_DIR, `frame_${String(frame).padStart(5, '0')}.png`);
        
        if (resumeMode && existsSync(framePath)) {
            skippedFrames++;
            try { await page.evaluate(f => window.renderCinematicFrame(f), frame); } catch (e) {}
            continue;
        }
        
        try {
            await page.evaluate(f => window.renderCinematicFrame(f), frame);
        } catch (e) {
            console.error(`\n⚠️ Frame ${frame} error: ${e.message}`);
            continue;
        }
        
        await new Promise(r => setTimeout(r, 15));
        await page.screenshot({ path: framePath, type: 'png' });
        capturedFrames++;
        
        if (frame % 30 === 0 || frame === totalFrames - 1) {
            const elapsed = (Date.now() - startTime) / 1000;
            const rate = capturedFrames > 0 ? elapsed / capturedFrames : 1;
            const eta = Math.max(0, rate * (totalFrames - frame - 1 - skippedFrames)).toFixed(0);
            process.stdout.write(`\r   Frame ${frame + 1}/${totalFrames} (${(100 * (frame + 1) / totalFrames).toFixed(1)}%) - ETA: ${eta}s   `);
        }
    }
    
    console.log('\n\n✅ Frames captured!');
    await browser.close();
    
    // Encode video
    console.log('\n🎥 Encoding video...');
    try {
        execSync(`ffmpeg -y -framerate ${FPS} -i "${FRAME_DIR}/frame_%05d.png" -c:v libx264 -pix_fmt yuv420p -preset slow -crf 18 -movflags +faststart "${join(__dirname, 'map-animation.mp4')}"`, { stdio: 'inherit' });
        console.log('\n✅ Video saved as map-animation.mp4');
        await rm(FRAME_DIR, { recursive: true, force: true });
    } catch (e) {
        console.error('FFmpeg error:', e.message);
        console.log(`Frames kept in ${FRAME_DIR}`);
    }
    
    console.log('\n🎉 Done!');
}

createFrameByFrameAnimation().catch(console.error);
