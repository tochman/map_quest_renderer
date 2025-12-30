import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// Get exact coordinates
console.log('Geocoding Stannums Byväg 20...');
const startPoint = await geocodeAddress('Stannums Byväg 20, Lerum, Sweden');
const endPoint = [57.81356, 12.1706]; // Bergum

if (!startPoint) {
    console.error('Could not geocode start address, using approximate coordinates');
    startPoint = [57.7, 12.3];
}

// Function to get route waypoints from OSRM (free routing service)
async function getRouteCoordinates(start, end) {
    const url = `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`;
    
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

// Get road-based coordinates
const coordinates = await getRouteCoordinates(startPoint, endPoint);

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

// Animation options
const options = {
    zoom: calculateZoom(coordinates),
    lineColor: '#8B4513',  // Saddle brown
    lineWidth: 4,
    animationDuration: 10000, // 10 seconds for route drawing portion
    useSmoothing: true
};

async function createMapAnimation() {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({
        headless: false, // Set to true for production
        defaultViewport: {
            width: 1920,
            height: 1080
        }
    });
    
    const page = await browser.newPage();
    
    // Load the map HTML
    const htmlPath = 'file://' + join(__dirname, 'map.html');
    console.log('Loading map page...');
    await page.goto(htmlPath, { waitUntil: 'networkidle0' });
    
    // Wait for map to be ready
    await page.waitForFunction(() => window.L !== undefined);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Initialize map with coordinates
    console.log('Initializing map...');
    await page.evaluate((coords, opts) => {
        window.initMap(coords, opts);
    }, coordinates, options);
    
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
    
    // Start video recording
    console.log('Starting animation and recording...');
    const recorder = await page.screencast({ path: 'map-animation.webm' });
    
    // Animate the route
    await page.evaluate(() => window.animateRoute());
    
    // Wait a moment at the end
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Stop recording
    await recorder.stop();
    
    console.log('Animation complete! Video saved as map-animation.webm');
    
    await browser.close();
}

createMapAnimation().catch(console.error);
