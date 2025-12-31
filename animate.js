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
        headless: false,
        devtools: true, // Open devtools to see console
        defaultViewport: {
            width: 1280,
            height: 720,
            deviceScaleFactor: 2  // Higher quality rendering (2x resolution)
        },
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-gpu-vsync',
            '--disable-frame-rate-limit'
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
    
    // Wait for animation function to be ready
    await page.waitForFunction(() => typeof window.animateRoute === 'function', { timeout: 5000 });
    
    // Calculate total wait time (animation duration + buffer)
    const animationDuration = options.animationDuration || 30000;
    const totalWaitTime = animationDuration + 7000; // Animation + title cards + buffer
    
    // ===== WARM-UP PASS: Run animation first to cache everything =====
    console.log('\n🔥 WARM-UP PASS: Running animation to cache tiles and resources...');
    console.log('(This pass is NOT recorded - just warming up the cache)\n');
    
    // Run the animation once without recording
    await page.evaluate(() => window.animateRoute());
    
    // Wait for the warm-up animation to complete
    await new Promise(resolve => setTimeout(resolve, totalWaitTime));
    console.log('✓ Warm-up pass complete! All tiles and resources should be cached.\n');
    
    // Reset the map for the second pass
    console.log('Resetting map for recording pass...');
    await page.evaluate((segments, opts) => {
        // Reset the animation state
        window.initMap(segments, opts);
    }, routeSegments, options);
    
    // Give the map a moment to reset
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // ===== RECORDING PASS: Now record the smooth, cached animation =====
    console.log('🎬 RECORDING PASS: Starting animation with recording...');
    console.log('(Everything is cached now - should be much smoother!)\n');
    
    // Enable page casting with higher quality settings
    const recorder = await page.screencast({ 
        path: 'raw-recording.webm',
        speed: 1,
        format: 'webm',
        scale: 1  // Keep full resolution
    });
    
    // Small delay to ensure recorder is ready
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.log(`Running animation (${animationDuration / 1000}s + 7s for titles)...`);
    
    // Start the recorded animation
    page.evaluate(() => window.animateRoute());
    
    // Wait for the animation to complete
    await new Promise(resolve => setTimeout(resolve, totalWaitTime));
    console.log('Animation finished!');
    
    // Stop recording
    await recorder.stop();
    
    console.log('Recording saved. Converting to MP4...');
    
    // Use ffmpeg to create MP4 with better quality
    const { execSync } = await import('child_process');
    
    try {
        // High quality encoding with proper frame rate
        console.log('Encoding high-quality MP4...');
        execSync(`ffmpeg -y -i raw-recording.webm -vf "scale=1280:720:flags=lanczos,fps=30" -c:v libx264 -pix_fmt yuv420p -preset slow -crf 16 -movflags +faststart map-animation.mp4`, {
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
        console.log('For old film effect, run: npm run oldfilm');
        
    } catch (ffmpegError) {
        console.error('FFmpeg error:', ffmpegError.message);
        console.log('Raw recording kept as raw-recording.webm');
    }
    
    console.log('Animation complete!');
    
    await browser.close();
}

createMapAnimation().catch(console.error);
