import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import { readFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load destinations from JSON (support custom file via CLI argument)
const jsonArg = process.argv[2];
const destinationsPath = jsonArg 
    ? (jsonArg.startsWith('/') ? jsonArg : join(__dirname, jsonArg))
    : join(__dirname, 'destinations.json');

console.log(`Loading destinations from: ${basename(destinationsPath)}`);
const destinationsConfig = JSON.parse(await readFile(destinationsPath, 'utf-8'));

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
console.log(`Geocoding ${destinationsConfig.start.address}...`);
const startPoint = await geocodeAddress(destinationsConfig.start.address);

if (!startPoint) {
    console.error('Could not geocode start address');
    process.exit(1);
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
    const nextPoint = stop.coordinates;
    
    let coords;
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
    } else {
        // Get via points if specified
        const viaPoints = stop.viaPoints || [];
        if (viaPoints.length > 0) {
            console.log(`Getting ${stop.travelMode} route (${stop.icon}) from "${previousLabel}" to "${stop.label || 'waypoint'}" via ${viaPoints.length} waypoints...`);
        } else {
            console.log(`Getting ${stop.travelMode} route (${stop.icon}) from "${previousLabel}" to "${stop.label || 'waypoint'}"...`);
        }
        coords = await getRouteCoordinates(currentPoint, nextPoint, stop.travelMode, viaPoints);
    }
    
    routeSegments.push({
        coordinates: coords,
        icon: stop.icon,
        fromLabel: previousLabel,
        toLabel: stop.label,
        travelMode: stop.travelMode,
        showMarker: stop.label !== null  // Only show marker if there's a label
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

// Calculate total waypoints for proportional timing
const totalWaypoints = allCoordinates.length;
const secondsPerWaypoint = 0.08; // Slower speed for better viewing (0.08 = ~12 waypoints per second)
const calculatedDuration = Math.max(30000, totalWaypoints * secondsPerWaypoint * 1000); // Min 30 seconds
console.log(`Animation duration: ${calculatedDuration/1000} seconds for ${totalWaypoints} waypoints`);

// Animation options
const options = {
    zoom: calculateZoom(allCoordinates),
    lineColor: destinationsConfig.animation.lineColor,
    lineWidth: destinationsConfig.animation.lineWidth,
    animationDuration: calculatedDuration,
    useSmoothing: true,
    finalDestination: destinationsConfig.stops[destinationsConfig.stops.length - 1].label,
    title: destinationsConfig.title || 'ADVENTURE',
    date: destinationsConfig.date || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
};

async function createMapAnimation() {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({
        headless: false, // Show browser for better frame capture
        defaultViewport: {
            width: 1920,
            height: 1080,
            deviceScaleFactor: 1
        },
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security'
        ]
    });
    
    const page = await browser.newPage();
    
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
    
    // Start high-quality video recording using Puppeteer screencast
    console.log('Starting animation and recording...');
    
    // Use Puppeteer's built-in screencast for recording
    const recorder = await page.screencast({ 
        path: 'raw-recording.webm',
        speed: 1
    });
    
    // Wait for animation function to be ready
    await page.waitForFunction(() => typeof window.animateRoute === 'function', { timeout: 5000 });
    
    // Animate the route with error handling
    try {
        await page.evaluate(async () => {
            if (typeof window.animateRoute === 'function') {
                await window.animateRoute();
            } else {
                throw new Error('animateRoute function not found');
            }
        });
    } catch (error) {
        console.error('Animation error:', error);
        // Continue to try to save what we have
    }
    
    // Wait a moment at the end
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Stop recording
    await recorder.stop();
    
    console.log('Recording saved. Converting to MP4...');
    
    // Use ffmpeg to create MP4 (fast encoding without interpolation)
    const { execSync } = await import('child_process');
    
    try {
        // Fast encoding to MP4
        console.log('Encoding MP4...');
        execSync(`ffmpeg -y -i raw-recording.webm -c:v libx264 -pix_fmt yuv420p -preset fast -crf 18 -movflags +faststart map-animation.mp4`, {
            stdio: 'inherit',
            cwd: __dirname
        });
        console.log('MP4 saved as map-animation.mp4');
        
        // Clean up raw recording
        const { unlinkSync } = await import('fs');
        try {
            unlinkSync(join(__dirname, 'raw-recording.webm'));
        } catch (e) {}
        
        console.log('\nFor smoother 60fps version, run: npm run smooth');
        
    } catch (ffmpegError) {
        console.error('FFmpeg error:', ffmpegError.message);
        console.log('Raw recording kept as raw-recording.webm');
    }
    
    console.log('Animation complete!');
    
    await browser.close();
}

createMapAnimation().catch(console.error);
