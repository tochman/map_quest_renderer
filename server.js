/**
 * Map Animation Server
 * Serves the web UI and provides API endpoint for Puppeteer recording
 */

import express from 'express';
import { createServer as createViteServer } from 'vite';
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 3000;
const FPS = 30;

// Load shared modules
const zoomUtilsCode = await readFile(join(__dirname, 'js', 'zoom-utils.js'), 'utf-8');
const animationCoreCode = await readFile(join(__dirname, 'js', 'animation-core.js'), 'utf-8');

// Tile layer configurations
const TILE_LAYERS = {
    osm: { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', options: { maxZoom: 19, subdomains: 'abc' } },
    watercolor: { url: 'https://watercolormaps.collection.cooperhewitt.org/tile/watercolor/{z}/{x}/{y}.jpg', options: { maxZoom: 15 } },
    terrain: { url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png', options: { maxZoom: 17 } },
    toner: { url: 'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', options: { maxZoom: 20 } },
    dark: { url: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', options: { maxZoom: 20 } },
    voyager: { url: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', options: { maxZoom: 20 } },
    humanitarian: { url: 'https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', options: { maxZoom: 19 } }
};

// Recording state
let isRecording = false;
let recordingProgress = { phase: '', percent: 0, status: 'idle' };

async function startServer() {
    const app = express();
    app.use(express.json({ limit: '10mb' }));

    // Create Vite server in middleware mode
    const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa'
    });
    
    // API: Get recording status
    app.get('/api/status', (req, res) => {
        res.json({ isRecording, progress: recordingProgress });
    });

    // API: Start recording
    app.post('/api/record', async (req, res) => {
        if (isRecording) {
            return res.status(409).json({ error: 'Recording already in progress' });
        }

        const { routeSegments, options, tile = 'osm' } = req.body;
        
        if (!routeSegments || !routeSegments.length) {
            return res.status(400).json({ error: 'No route segments provided' });
        }

        isRecording = true;
        recordingProgress = { phase: 'starting', percent: 0, status: 'recording' };

        // Run recording in background
        recordAnimation(routeSegments, options, tile)
            .then(videoPath => {
                recordingProgress = { phase: 'complete', percent: 100, status: 'complete', videoPath };
            })
            .catch(err => {
                console.error('Recording error:', err);
                recordingProgress = { phase: 'error', percent: 0, status: 'error', error: err.message };
            })
            .finally(() => {
                isRecording = false;
            });

        res.json({ message: 'Recording started', status: 'recording' });
    });

    // API: Download video (WebM)
    app.get('/api/download', (req, res) => {
        const videoPath = join(__dirname, 'map-animation.webm');
        if (existsSync(videoPath)) {
            res.download(videoPath, 'map-animation.webm');
        } else {
            res.status(404).json({ error: 'Video not found' });
        }
    });

    // API: Get WebM blob for client-side FreeConvert conversion
    app.get('/api/video-blob', (req, res) => {
        const videoPath = join(__dirname, 'map-animation.webm');
        if (existsSync(videoPath)) {
            res.setHeader('Content-Type', 'video/webm');
            res.sendFile(videoPath);
        } else {
            res.status(404).json({ error: 'Video not found' });
        }
    });

    // Root route - redirect to recorder
    app.get('/', (req, res) => {
        res.redirect('/recorder.html');
    });

    // Use Vite's middleware for transforms (JS, CSS, etc.)
    app.use(vite.middlewares);
    
    // Serve static files (HTML, JSON, images, etc.)
    app.use(express.static(__dirname));

    app.listen(PORT, () => {
        console.log(`\n🗺️  Map Animation Server running at http://localhost:${PORT}`);
        console.log(`   - Recorder: http://localhost:${PORT}/recorder.html`);
        console.log(`   - Editor:   http://localhost:${PORT}/editor.html`);
        console.log(`   - Preview:  http://localhost:${PORT}/map.html\n`);
    });
}

async function recordAnimation(routeSegments, options, tileKey) {
    const {
        lineColor = '#8B4513',
        lineWidth = 4,
        title = 'ADVENTURE',
        date = '',
        finalDestination = 'DESTINATION',
        startZoomLevel = 13,
        animationDuration = 15000
    } = options || {};

    const tileLayer = TILE_LAYERS[tileKey] || TILE_LAYERS.osm;

    // Timing
    const TITLE_DURATION = 3;
    const PAN_DURATION = 2.5;
    const ROUTE_DURATION = animationDuration / 1000;
    const END_DURATION = 2;

    const totalPauseTime = routeSegments.reduce((sum, seg) => sum + (seg.pause || 0.5), 0);
    const totalDuration = TITLE_DURATION + PAN_DURATION + ROUTE_DURATION + totalPauseTime + END_DURATION;
    const totalFrames = Math.ceil(totalDuration * FPS);

    const TITLE_END_FRAME = Math.floor(TITLE_DURATION * FPS);
    const PAN_END_FRAME = Math.floor((TITLE_DURATION + PAN_DURATION) * FPS);
    const ROUTE_END_FRAME = Math.floor((TITLE_DURATION + PAN_DURATION + ROUTE_DURATION + totalPauseTime) * FPS);

    const segmentPauseFrames = routeSegments.map(seg => Math.floor((seg.pause || 0.5) * FPS));
    const totalPauseFrames = segmentPauseFrames.reduce((a, b) => a + b, 0);
    const routeOnlyFrames = ROUTE_END_FRAME - PAN_END_FRAME - totalPauseFrames;

    console.log(`\n📊 Recording: ${totalDuration.toFixed(1)}s (real-time screencast)`);

    recordingProgress = { phase: 'launching', percent: 5, status: 'recording' };

    const browser = await puppeteer.launch({
        headless: 'new',
        defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
    });

    const page = await browser.newPage();
    const htmlPath = 'file://' + join(__dirname, 'map.html');
    
    recordingProgress = { phase: 'loading', percent: 10, status: 'recording' };
    
    await page.goto(htmlPath, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.L !== undefined);
    await new Promise(r => setTimeout(r, 1000));

    // Initialize map
    await page.evaluate((segments, opts) => {
        window.initMap(segments, opts);
        // Make sure map is accessible globally
        window.map = window.getMap();
    }, routeSegments, {
        lineColor, lineWidth, title, date, finalDestination, startZoomLevel, tileLayer
    });

    recordingProgress = { phase: 'tiles', percent: 15, status: 'recording' };
    await new Promise(r => setTimeout(r, 5000));

    // Inject modules
    await page.evaluate((code) => eval(code), zoomUtilsCode);
    await page.evaluate((code) => eval(code), animationCoreCode);

    // Setup renderer
    await page.evaluate((totalFrames, titleEndFrame, panEndFrame, routeEndFrame, segmentPauseFrames, routeOnlyFrames) => {
        const { routeSegments, lineColor, lineWidth, finalDestination, title, date, startZoomLevel } = window.mapData;
        
        window.animState = window.AnimationCore.createAnimationState();
        window.animConfig = window.AnimationCore.createAnimationConfig(map, routeSegments, {
            startZoomLevel, lineColor, lineWidth, title, date, finalDestination
        });
        
        window.animElements = {
            titleCard: document.getElementById('title-card'),
            dateStamp: document.getElementById('date-stamp'),
            destinationCard: document.getElementById('destination-card'),
            motorcycle: document.getElementById('motorcycle'),
            person: document.getElementById('person'),
            car: document.getElementById('car'),
            backpacker: document.getElementById('backpacker')
        };
        
        window.animSmoothing = { position: 0.12, zoom: 0.06, animate: false };
        
        window.pauseState = {
            isPaused: false,
            pauseFramesRemaining: 0,
            lastPausedAfterSegment: -1
        };
        
        window.cumulativePauseFrames = [];
        let sum = 0;
        for (let i = 0; i < segmentPauseFrames.length; i++) {
            window.cumulativePauseFrames.push(sum);
            sum += segmentPauseFrames[i];
        }
        
        window.renderCinematicFrame = function(frameNumber) {
            const ps = window.pauseState;
            
            if (ps.isPaused) {
                ps.pauseFramesRemaining--;
                if (ps.pauseFramesRemaining <= 0) ps.isPaused = false;
                return;
            }
            
            let phase, phaseProgress;
            
            if (frameNumber < titleEndFrame) {
                phase = 'title';
                phaseProgress = frameNumber / titleEndFrame;
            } else if (frameNumber < panEndFrame) {
                phase = 'pan';
                phaseProgress = (frameNumber - titleEndFrame) / (panEndFrame - titleEndFrame);
            } else if (frameNumber < routeEndFrame) {
                phase = 'route';
                const routeFrameNumber = frameNumber - panEndFrame;
                const pauseFramesSoFar = window.cumulativePauseFrames[ps.lastPausedAfterSegment + 1] || 0;
                const effectiveFrame = routeFrameNumber - pauseFramesSoFar;
                phaseProgress = Math.min(effectiveFrame / routeOnlyFrames, 1);
            } else {
                phase = 'end';
                phaseProgress = (frameNumber - routeEndFrame) / (totalFrames - routeEndFrame);
            }
            
            const result = window.AnimationCore.renderFrame({
                phase,
                phaseProgress: Math.min(1, Math.max(0, phaseProgress)),
                state: window.animState,
                config: window.animConfig,
                map: window.getMap(),
                routeSegments: routeSegments,
                elements: window.animElements,
                smoothing: window.animSmoothing
            });
            
            if (result.shouldPause && result.pauseDuration > 0) {
                ps.lastPausedAfterSegment = result.pauseAtSegment;
                ps.isPaused = true;
                ps.pauseFramesRemaining = Math.floor(result.pauseDuration * 30);
            }
        };
        
    }, totalFrames, TITLE_END_FRAME, PAN_END_FRAME, ROUTE_END_FRAME, segmentPauseFrames, routeOnlyFrames);

    await new Promise(r => setTimeout(r, 2000));

    // Start screencast recording (records directly to WebM - much faster!)
    const outputPath = join(__dirname, 'map-animation.webm');
    console.log('🎬 Starting screencast recording...');
    const startTime = Date.now();
    
    recordingProgress = { phase: 'recording', percent: 20, status: 'recording' };
    
    const recorder = await page.screencast({ path: outputPath });
    
    // Run the animation in real-time
    const animationDurationMs = totalDuration * 1000;
    const updateInterval = 100; // Update progress every 100ms
    let elapsed = 0;
    
    // Start the animation loop in the browser
    await page.evaluate((durationMs) => {
        return new Promise(resolve => {
            let startTime = null;
            let pausedTime = 0;
            let isPaused = false;
            let pauseStartTime = 0;
            let currentPauseDuration = 0;
            
            function animate(currentTime) {
                if (!startTime) startTime = currentTime;
                
                if (isPaused) {
                    const pauseElapsed = currentTime - pauseStartTime;
                    if (pauseElapsed >= currentPauseDuration) {
                        isPaused = false;
                        pausedTime += currentPauseDuration;
                    } else {
                        requestAnimationFrame(animate);
                        return;
                    }
                }
                
                const elapsed = currentTime - startTime - pausedTime;
                
                if (elapsed >= durationMs) {
                    resolve();
                    return;
                }
                
                // Calculate frame number from elapsed time
                const frameNumber = Math.floor((elapsed / 1000) * 30); // 30 FPS
                
                try {
                    const result = window.renderCinematicFrame(frameNumber);
                    
                    // Handle pauses from renderFrame result
                    if (result && result.shouldPause && result.pauseDuration > 0) {
                        isPaused = true;
                        pauseStartTime = currentTime;
                        currentPauseDuration = result.pauseDuration * 1000;
                    }
                } catch (e) {
                    console.error('Frame error:', e);
                }
                
                requestAnimationFrame(animate);
            }
            
            requestAnimationFrame(animate);
        });
    }, animationDurationMs);
    
    // Stop recording
    await recorder.stop();
    
    console.log('✅ Recording complete!');
    await browser.close();

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n🎉 Done in ${duration}s (real-time recording)!`);
    
    recordingProgress = { phase: 'complete', percent: 100, status: 'complete' };
    
    return outputPath;
}

startServer().catch(console.error);
