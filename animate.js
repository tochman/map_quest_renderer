import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Example coordinates: San Francisco to New York
const coordinates = [
    [37.7749, -122.4194], // San Francisco
    [39.7392, -104.9903], // Denver
    [41.8781, -87.6298],  // Chicago
    [40.7128, -74.0060]   // New York
];

// Animation options
const options = {
    zoom: 4,
    lineColor: '#8B4513',  // Saddle brown
    lineWidth: 4,
    animationDuration: 5000 // 5 seconds
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
    
    // Wait for tiles to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Start video recording
    console.log('Starting animation and recording...');
    await page.screencast({ path: 'map-animation.webm', fps: 30 });
    
    // Animate the route
    await page.evaluate(() => window.animateRoute());
    
    // Wait a moment at the end
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Stop recording
    await page.screencast({ path: null });
    
    console.log('Animation complete! Video saved as map-animation.webm');
    
    await browser.close();
}

createMapAnimation().catch(console.error);
