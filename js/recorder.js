/**
 * Map Animation Recorder UI
 * Preview animation and trigger Puppeteer recording via server API
 * Outputs WebM, with optional FreeConvert MP4 conversion
 */

// FreeConvert API
const FREE_CONVERT_API_KEY = import.meta.env.VITE_FREE_CONVERT_API_KEY;
const FREE_CONVERT_API_URL = 'https://api.freeconvert.com/v1';

// Tile layer configurations (must match server.js)
const TILE_LAYERS = {
    osm: { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', options: { maxZoom: 19, subdomains: 'abc' } },
    watercolor: { url: 'https://watercolormaps.collection.cooperhewitt.org/tile/watercolor/{z}/{x}/{y}.jpg', options: { maxZoom: 15 } },
    terrain: { url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png', options: { maxZoom: 17 } },
    toner: { url: 'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', options: { maxZoom: 20 } },
    dark: { url: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', options: { maxZoom: 20 } },
    voyager: { url: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', options: { maxZoom: 20 } },
    humanitarian: { url: 'https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', options: { maxZoom: 19 } }
};

// DOM Elements
let routeSelect, tileSelect, reloadBtn, previewBtn, recordBtn, downloadBtn, statusEl;
let progressContainer, progressBarFill, progressLabel, progressSublabel, progressPercent, progressSpinnerFill;
let stageLoad, stageEncode, stageFinalize;

// Download modal elements
let downloadModal, downloadWebmBtn, downloadMp4Btn, mp4Options, mp4Quality, mp4Codec, confirmMp4Btn, closeDownloadModal;

// Alert/Confirm modal elements
let alertModal, alertModalTitle, alertModalMessage, alertModalOk, alertModalCancel;
let alertResolve = null; // Promise resolver for confirm dialogs

// Map elements
let elements = {};

// State
let routes = [];
let currentRoute = null;
let currentRouteData = null;
let routeSegments = [];
let map = null;
let isPreviewRunning = false;
let pollInterval = null;
let currentWebmBlob = null; // Store WebM blob for conversion
let recordingStartTime = null; // Track recording start time for elapsed display
let isRecordingMode = false; // Track if we're in recording vs converting mode

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    routeSelect = document.getElementById('routeSelect');
    tileSelect = document.getElementById('tileSelect');
    reloadBtn = document.getElementById('reloadBtn');
    previewBtn = document.getElementById('previewBtn');
    recordBtn = document.getElementById('recordBtn');
    downloadBtn = document.getElementById('downloadBtn');
    statusEl = document.getElementById('status');
    
    // Progress UI elements
    progressContainer = document.getElementById('progressContainer');
    progressBarFill = document.getElementById('progressBarFill');
    progressLabel = document.getElementById('progressLabel');
    progressSublabel = document.getElementById('progressSublabel');
    progressPercent = document.getElementById('progressPercent');
    progressSpinnerFill = document.getElementById('progressSpinnerFill');
    stageLoad = document.getElementById('stageLoad');
    stageEncode = document.getElementById('stageEncode');
    stageFinalize = document.getElementById('stageFinalize');
    
    // Download modal elements
    downloadModal = document.getElementById('downloadModal');
    downloadWebmBtn = document.getElementById('downloadWebmBtn');
    downloadMp4Btn = document.getElementById('downloadMp4Btn');
    mp4Options = document.getElementById('mp4Options');
    mp4Quality = document.getElementById('mp4Quality');
    mp4Codec = document.getElementById('mp4Codec');
    confirmMp4Btn = document.getElementById('confirmMp4Btn');
    closeDownloadModal = document.getElementById('closeDownloadModal');
    
    // Alert/Confirm modal elements
    alertModal = document.getElementById('alertModal');
    alertModalTitle = document.getElementById('alertModalTitle');
    alertModalMessage = document.getElementById('alertModalMessage');
    alertModalOk = document.getElementById('alertModalOk');
    alertModalCancel = document.getElementById('alertModalCancel');
    
    elements = {
        titleCard: document.getElementById('title-card'),
        dateStamp: document.getElementById('date-stamp'),
        destinationCard: document.getElementById('destination-card'),
        motorcycle: document.getElementById('motorcycle'),
        person: document.getElementById('person'),
        car: document.getElementById('car'),
        backpacker: document.getElementById('backpacker')
    };
    
    init();
});

async function init() {
    await loadRoutes();
    setupEventListeners();
    
    // Listen for storage changes from editor (cross-tab sync)
    window.addEventListener('storage', (e) => {
        if (e.key === 'routes_data') {
            console.log('Routes updated from editor, reloading...');
            loadRoutes();
        }
    });
    
    updateStatus('Ready - Select a route');
}

// Load routes - prioritize localStorage (editor data), fallback to JSON files
async function loadRoutes() {
    routes = [];
    
    // First, try to load from localStorage (synced from editor)
    const storedData = localStorage.getItem('routes_data');
    if (storedData) {
        try {
            const data = JSON.parse(storedData);
            const storedRoutes = data.routes || [];
            
            if (storedRoutes.length > 0) {
                for (let i = 0; i < storedRoutes.length; i++) {
                    const route = storedRoutes[i];
                    routes.push({
                        id: `route-${i}`,
                        file: route._filename || `route-${i}.json`,
                        name: route.title || `Route ${i + 1}`,
                        data: route
                    });
                }
                console.log(`Loaded ${routes.length} routes from localStorage`);
            }
        } catch (e) {
            console.warn('Failed to parse localStorage routes:', e);
        }
    }
    
    // If no routes from localStorage, load from JSON files as fallback
    if (routes.length === 0) {
        const routeFiles = [
            { id: 'vattlefjall', file: 'vättlefjäll.json' },
            { id: 'stannum', file: 'stannum-ljungslätt.json' },
            { id: 'gulf', file: 'gulf-campino.json' },
            { id: 'destinations', file: 'destinations.json' }
        ];
        
        for (const route of routeFiles) {
            try {
                const response = await fetch(route.file);
                if (response.ok) {
                    const data = await response.json();
                    routes.push({
                        id: route.id,
                        file: route.file,
                        name: data.title || route.file,
                        data: data
                    });
                }
            } catch (e) {
                console.warn(`Could not load ${route.file}`);
            }
        }
        console.log(`Loaded ${routes.length} routes from JSON files`);
    }
    
    if (routeSelect) {
        routeSelect.innerHTML = routes.map((r, i) => `<option value="${i}">${r.name}</option>`).join('');
        if (routes.length > 0) await selectRoute(0);
    }
}

async function selectRoute(index) {
    if (index < 0 || index >= routes.length) return;
    
    currentRoute = routes[index];
    currentRouteData = currentRoute.data;
    
    updateStatus(`Loading: ${currentRoute.name}...`);
    
    routeSegments = await processRouteData(currentRouteData);
    if (routeSegments.length > 0) {
        await initializeMap();
        updateStatus(`Loaded: ${currentRoute.name} (${routeSegments.length} segments)`);
    } else {
        updateStatus('Error: Could not process route');
    }
}

// Process route data
async function processRouteData(data) {
    const segments = [];
    
    let startCoords = data.start?.coordinates;
    if (!startCoords && data.start?.address) {
        startCoords = await geocodeAddress(data.start.address);
    }
    if (!startCoords) return [];
    
    let prevCoords = startCoords;
    let prevLabel = data.start?.label || 'START';
    
    for (const stop of (data.stops || [])) {
        let stopCoords = stop.coordinates;
        if (!stopCoords && stop.address) {
            stopCoords = await geocodeAddress(stop.address);
        }
        if (!stopCoords) continue;
        
        let routeCoords = [prevCoords, stopCoords];
        const travelMode = stop.travelMode || 'walk';
        
        // Determine routing profile based on travel mode
        let profile = null;
        if (travelMode === 'hike' || travelMode === 'walk' || travelMode === 'foot') {
            profile = 'foot';
        } else if (travelMode === 'driving' || travelMode === 'car') {
            profile = 'car';
        } else if (travelMode === 'cycling' || travelMode === 'bike') {
            profile = 'bike';
        }
        
        // Fetch actual route if we have a profile
        if (profile) {
            const fetched = await getRoute(prevCoords, stopCoords, profile);
            if (fetched?.length > 2) {
                routeCoords = fetched;
                console.log(`Route fetched for ${stop.label}: ${fetched.length} points`);
            } else {
                console.warn(`Could not fetch route for ${stop.label}, using straight line`);
            }
        }
        
        segments.push({
            coordinates: routeCoords,
            fromLabel: prevLabel,
            toLabel: stop.label || '',
            travelMode: travelMode,
            icon: stop.icon || 'person',
            zoomLevel: stop.zoomLevel || null,
            pause: stop.pause ?? 0.5
        });
        
        prevCoords = stopCoords;
        prevLabel = stop.label || '';
    }
    
    return segments;
}

async function geocodeAddress(address) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`, {
            headers: { 'User-Agent': 'MapRecorder/1.0' }
        });
        const data = await response.json();
        if (data.length > 0) return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
    } catch (e) {}
    return null;
}

async function getRoute(start, end, profile = 'foot') {
    const apiKey = import.meta.env.VITE_GRAPHHOPPER_API_KEY || '';
    if (!apiKey) {
        console.warn('No GraphHopper API key - using straight line');
        return null;
    }
    
    try {
        const url = `https://graphhopper.com/api/1/route?point=${start[0]},${start[1]}&point=${end[0]},${end[1]}&profile=${profile}&points_encoded=false&key=${apiKey}`;
        console.log(`Fetching route: ${profile} from [${start}] to [${end}]`);
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.message) {
            console.warn('GraphHopper API error:', data.message);
            return null;
        }
        
        if (data.paths?.[0]?.points?.coordinates) {
            const coords = data.paths[0].points.coordinates.map(c => [c[1], c[0]]);
            console.log(`Route received: ${coords.length} points`);
            return coords;
        }
        
        console.warn('No route path in response:', data);
    } catch (e) {
        console.warn('Route fetch error:', e);
    }
    return null;
}

// Initialize map
async function initializeMap() {
    resetAnimationUI();
    
    if (map) { map.remove(); map = null; }
    
    const allCoords = routeSegments.flatMap(seg => seg.coordinates);
    const bounds = L.latLngBounds(allCoords);
    
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false,
        zoomAnimation: true,
        fadeAnimation: true
    });
    
    const tileKey = tileSelect?.value || 'osm';
    const tileConfig = TILE_LAYERS[tileKey] || TILE_LAYERS.osm;
    L.tileLayer(tileConfig.url, tileConfig.options).addTo(map);
    
    map.fitBounds(bounds, { padding: [50, 50], animate: false });
    
    window.mapData = {
        routeSegments,
        lineColor: currentRouteData.animation?.lineColor || '#8B4513',
        lineWidth: currentRouteData.animation?.lineWidth || 4,
        animationDuration: currentRouteData.animation?.duration || 15000,
        finalDestination: routeSegments[routeSegments.length - 1]?.toLabel || 'DESTINATION',
        title: currentRouteData.title || 'ADVENTURE',
        date: currentRouteData.date || '',
        startZoomLevel: currentRouteData.start?.zoomLevel || 13
    };
    
    window.map = map;
    window.getMap = () => map;
    
    drawRoutePreview();
}

function resetAnimationUI() {
    Object.values(elements).forEach(el => { if (el) el.style.opacity = '0'; });
}

function drawRoutePreview() {
    if (!map || !routeSegments.length) return;
    
    const allCoords = routeSegments.flatMap(seg => seg.coordinates);
    L.polyline(allCoords, { color: '#8B4513', weight: 3, opacity: 0.5, dashArray: '10, 10' }).addTo(map);
    L.circleMarker(allCoords[0], { radius: 8, fillColor: '#8B0000', color: '#3d2817', weight: 2, fillOpacity: 0.8 }).addTo(map);
    L.circleMarker(allCoords[allCoords.length - 1], { radius: 8, fillColor: '#006400', color: '#3d2817', weight: 2, fillOpacity: 0.8 }).addTo(map);
}

// Event listeners
function setupEventListeners() {
    routeSelect?.addEventListener('change', e => selectRoute(parseInt(e.target.value)));
    tileSelect?.addEventListener('change', () => initializeMap());
    reloadBtn?.addEventListener('click', async () => { reloadBtn.disabled = true; await loadRoutes(); reloadBtn.disabled = false; });
    previewBtn?.addEventListener('click', runPreview);
    recordBtn?.addEventListener('click', startRecording);
    downloadBtn?.addEventListener('click', showDownloadDialog);
    
    // Download modal event listeners
    setupDownloadModalListeners();
}

function setupDownloadModalListeners() {
    // Close modal
    closeDownloadModal?.addEventListener('click', hideDownloadDialog);
    downloadModal?.addEventListener('click', (e) => {
        if (e.target === downloadModal) hideDownloadDialog();
    });
    
    // WebM download - direct download
    downloadWebmBtn?.addEventListener('click', () => {
        downloadWebmBtn.classList.add('selected');
        downloadMp4Btn.classList.remove('selected');
        mp4Options.style.display = 'none';
        hideDownloadDialog();
        window.location.href = '/api/download';
    });
    
    // MP4 download - show quality options
    downloadMp4Btn?.addEventListener('click', () => {
        downloadMp4Btn.classList.add('selected');
        downloadWebmBtn.classList.remove('selected');
        mp4Options.style.display = 'block';
    });
    
    // Confirm MP4 conversion
    confirmMp4Btn?.addEventListener('click', () => {
        hideDownloadDialog();
        downloadAsMP4();
    });
}

function showDownloadDialog() {
    // Reset state
    downloadWebmBtn?.classList.remove('selected');
    downloadMp4Btn?.classList.remove('selected');
    if (mp4Options) mp4Options.style.display = 'none';
    
    downloadModal?.classList.add('active');
}

function hideDownloadDialog() {
    downloadModal?.classList.remove('active');
}

function updateStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
}

// Download as MP4 via FreeConvert
async function downloadAsMP4() {
    if (!FREE_CONVERT_API_KEY) {
        updateStatus('Error: FreeConvert API key not configured');
        await showAlert('API Key Missing', 'FreeConvert API key not found. Add VITE_FREE_CONVERT_API_KEY to your .env file.');
        return;
    }
    
    // Get quality settings from dialog
    const videoCrf = parseInt(mp4Quality?.value || '23');
    const videoCodec = mp4Codec?.value || 'h264';
    
    downloadBtn.disabled = true;
    showProgress('Converting to MP4...', 'Fetching WebM file');
    setProgressStage('load');
    
    try {
        // Step 1: Fetch the WebM blob from server
        updateProgress(5, 'Fetching video...', 'Downloading WebM from server');
        const webmResponse = await fetch('/api/video-blob');
        if (!webmResponse.ok) throw new Error('Failed to fetch video');
        const webmBlob = await webmResponse.blob();
        
        updateProgress(10, 'Creating conversion job...', 'Connecting to FreeConvert API');
        
        // Step 2: Create FreeConvert job with minimal options for QuickTime compatibility
        // Use simple format - FreeConvert handles codec details automatically
        const conversionOptions = {};
        
        // Only add CRF quality if not default
        if (videoCrf && videoCrf !== 23) {
            conversionOptions.crf = videoCrf;
        }
        
        const jobResponse = await fetch(`${FREE_CONVERT_API_URL}/process/jobs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${FREE_CONVERT_API_KEY}`
            },
            body: JSON.stringify({
                tag: 'map-animation',
                tasks: {
                    'upload-video': { operation: 'import/upload' },
                    'convert-to-mp4': {
                        operation: 'convert',
                        input: 'upload-video',
                        input_format: 'webm',
                        output_format: 'mp4',
                        ...(Object.keys(conversionOptions).length > 0 ? { options: conversionOptions } : {})
                    },
                    'export-result': {
                        operation: 'export/url',
                        input: 'convert-to-mp4'
                    }
                }
            })
        });
        
        if (!jobResponse.ok) {
            const errorText = await jobResponse.text();
            throw new Error(`Failed to create job: ${jobResponse.status} - ${errorText}`);
        }
        
        const job = await jobResponse.json();
        const uploadTask = job.tasks.find(t => t.operation === 'import/upload');
        if (!uploadTask?.result?.form) throw new Error('Upload task not found');
        
        setProgressStage('encode');
        updateProgress(20, 'Uploading video...', 'Sending to FreeConvert');
        
        // Step 3: Upload WebM
        const formData = new FormData();
        Object.entries(uploadTask.result.form.parameters).forEach(([key, value]) => {
            formData.append(key, value);
        });
        formData.append('file', webmBlob, 'video.webm');
        
        const uploadResponse = await fetch(uploadTask.result.form.url, {
            method: 'POST',
            body: formData
        });
        
        if (!uploadResponse.ok) throw new Error(`Upload failed: ${uploadResponse.status}`);
        
        updateProgress(40, 'Converting video...', `Processing (${videoCodec.toUpperCase()}, CRF ${videoCrf})`);
        
        // Step 4: Poll for completion
        let downloadUrl = null;
        let attempts = 0;
        const maxAttempts = 120; // 2 minutes max
        
        while (!downloadUrl && attempts < maxAttempts) {
            await new Promise(r => setTimeout(r, 1000));
            attempts++;
            
            const statusResponse = await fetch(`${FREE_CONVERT_API_URL}/process/jobs/${job.id}`, {
                headers: { 'Authorization': `Bearer ${FREE_CONVERT_API_KEY}` }
            });
            const jobStatus = await statusResponse.json();
            
            if (jobStatus.status === 'completed') {
                const exportTask = jobStatus.tasks?.find(t => t.operation === 'export/url');
                downloadUrl = exportTask?.result?.url;
                break;
            } else if (jobStatus.status === 'failed') {
                throw new Error('Conversion failed on FreeConvert');
            }
            
            // Update progress based on job status
            const percent = Math.min(40 + attempts, 85);
            updateProgress(percent, 'Converting video...', `Processing... (${attempts}s)`);
        }
        
        if (!downloadUrl) throw new Error('Conversion timeout');
        
        setProgressStage('finalize');
        updateProgress(90, 'Downloading MP4...', 'Fetching converted file');
        
        // Step 5: Download MP4
        const mp4Response = await fetch(downloadUrl);
        if (!mp4Response.ok) throw new Error('Failed to download MP4');
        const mp4Blob = await mp4Response.blob();
        
        updateProgress(100, 'Complete!', 'Video ready');
        
        // Trigger download
        const url = URL.createObjectURL(mp4Blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `map-animation-${Date.now()}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        setTimeout(() => {
            hideProgress();
            updateStatus('MP4 downloaded! 🎉');
            downloadBtn.disabled = false;
        }, 1000);
        
    } catch (err) {
        console.error('MP4 conversion error:', err);
        hideProgress();
        updateStatus('Conversion failed: ' + err.message);
        downloadBtn.disabled = false;
        
        // Offer WebM as fallback
        const fallback = await showConfirm('Conversion Failed', 'MP4 conversion failed. Download as WebM instead?', 'Download WebM', 'Cancel');
        if (fallback) {
            window.location.href = '/api/download';
        }
    }
}
async function runPreview() {
    if (isPreviewRunning || !routeSegments.length) return;
    
    isPreviewRunning = true;
    previewBtn.disabled = true;
    recordBtn.disabled = true;
    updateStatus('▶️ Running preview...');
    
    // Re-init map
    await initializeMap();
    await new Promise(r => setTimeout(r, 1000));
    
    // Clear preview markers
    map.eachLayer(layer => {
        if (layer instanceof L.Polyline || layer instanceof L.Marker || layer instanceof L.CircleMarker) {
            map.removeLayer(layer);
        }
    });
    
    // Re-add tiles
    const tileKey = tileSelect?.value || 'osm';
    const tileConfig = TILE_LAYERS[tileKey] || TILE_LAYERS.osm;
    L.tileLayer(tileConfig.url, tileConfig.options).addTo(map);
    
    await new Promise(r => setTimeout(r, 500));
    
    // Run animation using AnimationCore
    const { lineColor, lineWidth, animationDuration, finalDestination, title, date, startZoomLevel } = window.mapData;
    
    const state = window.AnimationCore.createAnimationState();
    const config = window.AnimationCore.createAnimationConfig(map, routeSegments, {
        startZoomLevel, lineColor, lineWidth, title, date, finalDestination
    });
    
    const smoothing = { position: 0.08, zoom: 0.04, animate: true, duration: 1.5 };
    
    const TITLE_DURATION = 3000;
    const PAN_DURATION = 4000;
    const ROUTE_DURATION = animationDuration;
    const END_DURATION = 3000;
    
    const totalPauseTime = config.segmentPauses.reduce((sum, p) => sum + p * 1000, 0);
    const phases = [
        { name: 'title', duration: TITLE_DURATION },
        { name: 'pan', duration: PAN_DURATION },
        { name: 'route', duration: ROUTE_DURATION + totalPauseTime },
        { name: 'end', duration: END_DURATION }
    ];
    
    let startTime = null;
    let pausedTime = 0;
    let isPaused = false;
    let pauseStartTime = 0;
    let currentPauseDuration = 0;
    
    await new Promise(resolve => {
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
            let phaseStart = 0, currentPhase = null, phaseProgress = 0;
            
            for (const phase of phases) {
                if (elapsed < phaseStart + phase.duration) {
                    currentPhase = phase.name;
                    phaseProgress = (elapsed - phaseStart) / phase.duration;
                    break;
                }
                phaseStart += phase.duration;
            }
            
            if (!currentPhase) { resolve(); return; }
            
            const result = window.AnimationCore.renderFrame({
                phase: currentPhase,
                phaseProgress: Math.min(1, Math.max(0, phaseProgress)),
                state, config, map, routeSegments, elements, smoothing
            });
            
            if (result.shouldPause && result.pauseDuration > 0) {
                isPaused = true;
                pauseStartTime = currentTime;
                currentPauseDuration = result.pauseDuration * 1000;
            }
            
            requestAnimationFrame(animate);
        }
        requestAnimationFrame(animate);
    });
    
    isPreviewRunning = false;
    previewBtn.disabled = false;
    recordBtn.disabled = false;
    updateStatus('Preview complete');
}

// Start recording via server API
async function startRecording() {
    if (!routeSegments.length) {
        updateStatus('Please select a route first');
        return;
    }
    
    recordBtn.disabled = true;
    previewBtn.disabled = true;
    downloadBtn.disabled = true;
    showProgress('Starting recording...', 'Launching Puppeteer', 'record');
    setProgressStage('load');
    
    try {
        const response = await fetch('/api/record', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                routeSegments,
                options: {
                    lineColor: window.mapData.lineColor,
                    lineWidth: window.mapData.lineWidth,
                    title: window.mapData.title,
                    date: window.mapData.date,
                    finalDestination: window.mapData.finalDestination,
                    startZoomLevel: window.mapData.startZoomLevel,
                    animationDuration: window.mapData.animationDuration
                },
                tile: tileSelect?.value || 'osm'
            })
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Recording failed');
        }
        
        // Poll for status
        pollInterval = setInterval(pollStatus, 1000);
        
    } catch (err) {
        console.error('Recording error:', err);
        hideProgress();
        updateStatus('Error: ' + err.message);
        recordBtn.disabled = false;
        previewBtn.disabled = false;
    }
}

async function pollStatus() {
    try {
        const response = await fetch('/api/status');
        const { isRecording, progress } = await response.json();
        
        if (progress.status === 'recording') {
            // Update stage based on phase
            if (progress.phase === 'launching' || progress.phase === 'loading' || progress.phase === 'tiles') {
                setProgressStage('load');
            } else if (progress.phase === 'capturing') {
                setProgressStage('encode');
            } else if (progress.phase === 'encoding') {
                setProgressStage('finalize');
            }
            
            const sublabel = progress.frame ? `Frame ${progress.frame}/${progress.totalFrames}` : progress.phase;
            updateProgress(progress.percent, `${progress.phase}: ${progress.percent}%`, sublabel);
        } else if (progress.status === 'complete') {
            clearInterval(pollInterval);
            setProgressStage('finalize');
            updateProgress(100, 'Recording complete!', 'WebM ready for download');
            
            setTimeout(() => {
                hideProgress();
                updateStatus('Recording complete! Click Download 🎉');
                recordBtn.disabled = false;
                previewBtn.disabled = false;
                downloadBtn.disabled = false;
            }, 1500);
        } else if (progress.status === 'error') {
            clearInterval(pollInterval);
            hideProgress();
            updateStatus('Error: ' + (progress.error || 'Recording failed'));
            recordBtn.disabled = false;
            previewBtn.disabled = false;
        }
    } catch (e) {
        console.error('Poll error:', e);
    }
}

// Progress UI
function showProgress(label, sublabel = '', mode = 'convert') {
    isRecordingMode = (mode === 'record');
    if (isRecordingMode) {
        recordingStartTime = Date.now();
    }
    if (progressContainer) progressContainer.classList.add('active');
    updateProgress(0, label, sublabel);
    setProgressStage(null);
}

function hideProgress() {
    if (progressContainer) progressContainer.classList.remove('active');
    isRecordingMode = false;
    recordingStartTime = null;
}

function updateProgress(percent, label, sublabel = '') {
    if (progressBarFill) progressBarFill.style.width = `${percent}%`;
    if (progressLabel) progressLabel.textContent = label;
    if (progressSublabel) progressSublabel.textContent = sublabel;
    
    // Show elapsed time during recording, percentage during conversion
    if (progressPercent) {
        if (isRecordingMode && recordingStartTime) {
            const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
            const mins = Math.floor(elapsed / 60);
            const secs = elapsed % 60;
            progressPercent.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        } else {
            progressPercent.textContent = `${Math.round(percent)}%`;
        }
    }
    
    // Update circular progress
    if (progressSpinnerFill) {
        const circumference = 2 * Math.PI * 20; // r=20
        const offset = circumference - (percent / 100) * circumference;
        progressSpinnerFill.style.strokeDashoffset = offset;
    }
}

function setProgressStage(stage) {
    [stageLoad, stageEncode, stageFinalize].forEach(el => {
        if (el) el.classList.remove('active');
    });
    
    if (stage === 'load' && stageLoad) stageLoad.classList.add('active');
    else if (stage === 'encode' && stageEncode) stageEncode.classList.add('active');
    else if (stage === 'finalize' && stageFinalize) stageFinalize.classList.add('active');
}

// Alert/Confirm Modal Functions
function showAlert(title, message) {
    return new Promise((resolve) => {
        alertModalTitle.textContent = title;
        alertModalMessage.textContent = message;
        alertModalCancel.style.display = 'none';
        alertModalOk.textContent = 'OK';
        
        const handleOk = () => {
            cleanup();
            resolve();
        };
        
        const cleanup = () => {
            alertModal.classList.remove('active');
            alertModalOk.removeEventListener('click', handleOk);
        };
        
        alertModalOk.addEventListener('click', handleOk);
        alertModal.classList.add('active');
    });
}

function showConfirm(title, message, confirmText = 'Confirm', cancelText = 'Cancel') {
    return new Promise((resolve) => {
        alertModalTitle.textContent = title;
        alertModalMessage.textContent = message;
        alertModalCancel.style.display = 'inline-block';
        alertModalCancel.textContent = cancelText;
        alertModalOk.textContent = confirmText;
        
        const handleOk = () => {
            cleanup();
            resolve(true);
        };
        
        const handleCancel = () => {
            cleanup();
            resolve(false);
        };
        
        const cleanup = () => {
            alertModal.classList.remove('active');
            alertModalOk.removeEventListener('click', handleOk);
            alertModalCancel.removeEventListener('click', handleCancel);
        };
        
        alertModalOk.addEventListener('click', handleOk);
        alertModalCancel.addEventListener('click', handleCancel);
        alertModal.classList.add('active');
    });
}
