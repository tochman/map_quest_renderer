import { io } from 'socket.io-client';
import html2canvas from 'html2canvas';

// Get API key from environment
const FREE_CONVERT_API_KEY = import.meta.env.VITE_FREE_CONVERT_API_KEY;
const FREE_CONVERT_API_URL = 'https://api.freeconvert.com/v1';

// Quality presets
const qualityPresets = {
    ultra: { label: 'Ultra', bitrate: 15000000, video_codec: 'libx264', crf: 17 },
    high: { label: 'High', bitrate: 8000000, video_codec: 'libx264', crf: 20 },
    medium: { label: 'Medium', bitrate: 5000000, video_codec: 'libx264', crf: 23 },
    low: { label: 'Low', bitrate: 2500000, video_codec: 'libx264', crf: 28 }
};

// Tile layer configurations
const TILE_LAYERS = {
    osm: { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', options: { maxZoom: 19 } },
    watercolor: { url: 'https://watercolormaps.collection.cooperhewitt.org/tile/watercolor/{z}/{x}/{y}.jpg', options: { maxZoom: 15 } },
    terrain: { url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png', options: { maxZoom: 17 } },
    toner: { url: 'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', options: { maxZoom: 20 } },
    dark: { url: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', options: { maxZoom: 20 } },
    voyager: { url: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', options: { maxZoom: 20 } }
};

// DOM Elements
const routeSelect = document.getElementById('routeSelect');
const reloadBtn = document.getElementById('reloadBtn');
const fromEditorBtn = document.getElementById('fromEditorBtn');
const sourceFile = document.getElementById('sourceFile');
const formatSelect = document.getElementById('formatSelect');
const qualitySelect = document.getElementById('qualitySelect');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const downloadBtn = document.getElementById('downloadBtn');
const statusDiv = document.getElementById('status');
const progressContainer = document.getElementById('progressContainer');
const progressPercent = document.getElementById('progressPercent');
const progressLabel = document.getElementById('progressLabel');
const progressSublabel = document.getElementById('progressSublabel');
const progressBarFill = document.getElementById('progressBarFill');
const progressSpinnerFill = document.getElementById('progressSpinnerFill');
const progressBarWrapper = document.getElementById('progressBarWrapper');
const stageLoad = document.getElementById('stageLoad');
const stageEncode = document.getElementById('stageEncode');
const stageFinalize = document.getElementById('stageFinalize');
const mapWrapper = document.getElementById('mapWrapper');

// State
let routes = [];
let currentRoute = null;
let currentRouteData = null;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let isConverting = false;
let startTime = null;
let currentSocket = null;
let map = null;
let captureInterval = null;
let recordingCanvas = null;
let recordingCtx = null;

// Initialize
async function init() {
    await loadRoutes();
    setupEventListeners();
    updateStatus('Ready - Select a route and click Start Recording');
    console.log('Map Recorder initialized! 🎬');
}

// Load available routes from JSON files
async function loadRoutes() {
    try {
        routes = [];
        
        // First try to load from localStorage (synced from editor)
        const storedData = localStorage.getItem('routes_data');
        if (storedData) {
            try {
                const data = JSON.parse(storedData);
                const editorRoutes = data.routes || [];
                
                // Add each route from editor
                editorRoutes.forEach((routeData, index) => {
                    routes.push({
                        id: `editor-${index}`,
                        file: routeData._filename || null,
                        name: routeData.title || `Route ${index + 1}`,
                        data: routeData,
                        source: 'editor'
                    });
                });
                
                console.log(`Loaded ${routes.length} routes from editor`);
            } catch (e) {
                console.warn('Could not parse editor data:', e);
            }
        }
        
        // If no editor data, load from JSON files directly
        if (routes.length === 0) {
            const defaultRoutes = [
                { id: 'vattlefjall', file: 'vättlefjäll.json' },
                { id: 'stannum', file: 'stannum-ljungslätt.json' },
                { id: 'gulf', file: 'gulf-campino.json' },
                { id: 'destinations', file: 'destinations.json' }
            ];
            
            for (const route of defaultRoutes) {
                try {
                    const response = await fetch(route.file);
                    if (response.ok) {
                        const data = await response.json();
                        routes.push({
                            id: route.id,
                            file: route.file,
                            name: data.title || route.file,
                            data: data,
                            source: 'file'
                        });
                    }
                } catch (e) {
                    console.warn(`Could not load ${route.file}:`, e);
                }
            }
        }
        
        // Populate dropdown
        routeSelect.innerHTML = routes.map((route, index) => {
            const prefix = route.source === 'editor' ? '📝 ' : '📄 ';
            return `<option value="${index}">${prefix}${route.name}</option>`;
        }).join('');
        
        if (routes.length > 0) {
            routeSelect.selectedIndex = 0;
            await selectRoute(0);
        }
        
        sourceFile.textContent = `${routes.length} routes available`;
        
    } catch (error) {
        console.error('Failed to load routes:', error);
        updateStatus('Error loading routes');
    }
}

// Select and load a route
async function selectRoute(index) {
    if (index < 0 || index >= routes.length) return;
    
    currentRoute = routes[index];
    currentRouteData = currentRoute.data;
    
    updateStatus(`Selected: ${currentRoute.name}`);
    
    // Initialize map preview with this route
    await initializeMapPreview();
}

// Initialize the map with current route data
async function initializeMapPreview() {
    if (!currentRouteData) return;
    
    const mapContainer = document.getElementById('map');
    
    // Clear existing map
    if (map) {
        map.remove();
        map = null;
    }
    
    // Process route data to get coordinates
    const routeSegments = await processRouteData(currentRouteData);
    if (!routeSegments || routeSegments.length === 0) {
        updateStatus('Error: No route coordinates found');
        return;
    }
    
    // Get all coordinates for bounds
    const allCoords = routeSegments.flatMap(seg => seg.coordinates);
    const startCoord = allCoords[0];
    
    // Create map
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView(startCoord, 12);
    
    // Add tile layer
    const tileConfig = TILE_LAYERS[currentRouteData.tileLayer] || TILE_LAYERS.osm;
    L.tileLayer(tileConfig.url, tileConfig.options).addTo(map);
    
    // Fit to show entire route
    const bounds = L.latLngBounds(allCoords);
    map.fitBounds(bounds, { padding: [50, 50] });
    
    // Draw route preview
    drawRoutePreview(routeSegments);
    
    // Store route data for animation
    window.mapRecorderData = {
        map,
        routeSegments,
        routeData: currentRouteData,
        allCoords
    };
    
    updateStatus(`Map loaded: ${currentRoute.name}`);
}

// Draw a preview of the route on the map
function drawRoutePreview(segments) {
    if (!map) return;
    
    segments.forEach((segment, index) => {
        if (segment.coordinates && segment.coordinates.length > 1) {
            // Draw route line
            L.polyline(segment.coordinates, {
                color: '#8B4513',
                weight: 4,
                opacity: 0.8,
                dashArray: '10, 10'
            }).addTo(map);
            
            // Add marker at end of segment
            const lastCoord = segment.coordinates[segment.coordinates.length - 1];
            if (segment.label) {
                L.marker(lastCoord)
                    .bindPopup(segment.label)
                    .addTo(map);
            }
        }
    });
    
    // Add start marker
    const allCoords = segments.flatMap(seg => seg.coordinates);
    if (allCoords.length > 0) {
        L.circleMarker(allCoords[0], {
            radius: 8,
            fillColor: '#4CAF50',
            color: '#fff',
            weight: 2,
            fillOpacity: 1
        }).addTo(map).bindPopup('Start');
    }
}

// Process route data to extract coordinates
async function processRouteData(data) {
    const segments = [];
    
    // Get start coordinates
    let startCoords = data.start?.coordinates;
    if (!startCoords && data.start?.address) {
        startCoords = await geocodeAddress(data.start.address);
    }
    
    if (!startCoords) {
        console.error('No start coordinates found');
        return [];
    }
    
    // Process stops
    const stops = data.stops || [];
    let previousCoords = startCoords;
    
    for (const stop of stops) {
        let stopCoords = stop.coordinates;
        if (!stopCoords && stop.address) {
            stopCoords = await geocodeAddress(stop.address);
        }
        
        if (stopCoords) {
            // If route is provided, use it; otherwise create direct line
            const coordinates = stop.route || [previousCoords, stopCoords];
            
            segments.push({
                coordinates: coordinates,
                label: stop.label || '',
                icon: stop.icon || 'marker',
                pause: stop.pause || 0
            });
            
            previousCoords = stopCoords;
        }
    }
    
    // Handle end destination
    if (data.end) {
        let endCoords = data.end.coordinates;
        if (!endCoords && data.end.address) {
            endCoords = await geocodeAddress(data.end.address);
        }
        
        if (endCoords) {
            segments.push({
                coordinates: data.end.route || [previousCoords, endCoords],
                label: data.end.label || 'END',
                icon: data.end.icon || 'marker',
                pause: 0
            });
        }
    }
    
    return segments;
}

// Geocode address to coordinates
async function geocodeAddress(address) {
    try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'MapAnimationRecorder/1.0' }
        });
        const data = await response.json();
        if (data.length > 0) {
            return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
        }
    } catch (e) {
        console.error('Geocoding error:', e);
    }
    return null;
}

// Event Listeners
function setupEventListeners() {
    routeSelect.addEventListener('change', async (e) => {
        await selectRoute(parseInt(e.target.value));
    });
    
    reloadBtn.addEventListener('click', async () => {
        reloadBtn.disabled = true;
        reloadBtn.textContent = '⏳';
        await loadRoutes();
        reloadBtn.textContent = '🔄';
        reloadBtn.disabled = false;
        updateStatus('Routes reloaded! ✅');
    });
    
    if (fromEditorBtn) {
        fromEditorBtn.addEventListener('click', () => {
            // Find editor route and select it
            const editorIndex = routes.findIndex(r => r.id === 'editor');
            if (editorIndex >= 0) {
                routeSelect.value = editorIndex;
                selectRoute(editorIndex);
            } else {
                updateStatus('No route data from editor. Create one in the Editor tab first.');
            }
        });
    }
    
    startBtn.addEventListener('click', startRecording);
    stopBtn.addEventListener('click', stopRecording);
}

// Update status message
function updateStatus(message) {
    if (statusDiv) {
        statusDiv.textContent = message;
    }
}

// Progress UI
function showProgress() {
    if (progressContainer) progressContainer.classList.add('active');
}

function hideProgress() {
    if (progressContainer) progressContainer.classList.remove('active');
}

function updateProgress(percent, label, sublabel) {
    if (!progressPercent) return;
    
    const circumference = 126;
    const offset = circumference - (percent / 100) * circumference;
    
    progressPercent.textContent = `${Math.round(percent)}%`;
    if (progressSpinnerFill) progressSpinnerFill.style.strokeDashoffset = offset;
    if (progressBarFill) progressBarFill.style.width = `${percent}%`;
    if (progressLabel) progressLabel.textContent = label;
    if (progressSublabel) progressSublabel.textContent = sublabel;
}

function setProgressStage(stage) {
    [stageLoad, stageEncode, stageFinalize].forEach(el => {
        if (el) el.classList.remove('active');
    });
    
    if (stage === 'load' && stageLoad) stageLoad.classList.add('active');
    else if (stage === 'encode' && stageEncode) stageEncode.classList.add('active');
    else if (stage === 'finalize' && stageFinalize) stageFinalize.classList.add('active');
}

// Setup MediaRecorder with canvas capture
async function setupMediaRecorder() {
    // Create recording canvas (1920x1080)
    recordingCanvas = document.createElement('canvas');
    recordingCanvas.width = 1920;
    recordingCanvas.height = 1080;
    recordingCtx = recordingCanvas.getContext('2d');
    
    const selectedQuality = qualitySelect?.value || 'medium';
    const preset = qualityPresets[selectedQuality] || qualityPresets.medium;
    
    // Get canvas stream
    const stream = recordingCanvas.captureStream(30);
    
    // Start frame capture interval
    const startCapture = () => {
        captureInterval = setInterval(async () => {
            if (!isRecording) return;
            await captureFrame();
        }, 1000 / 30); // 30 FPS
    };
    
    const stopCapture = () => {
        if (captureInterval) {
            clearInterval(captureInterval);
            captureInterval = null;
        }
    };
    
    // Start capturing
    startCapture();
    
    // Find supported MIME type
    const mimeTypes = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm'
    ];
    
    let selectedMimeType = '';
    for (const mime of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mime)) {
            selectedMimeType = mime;
            break;
        }
    }
    
    if (!selectedMimeType) {
        alert('Your browser does not support video recording!');
        stopCapture();
        return null;
    }
    
    console.log('Using MIME type:', selectedMimeType);
    console.log('Bitrate:', preset.bitrate);
    
    // Create MediaRecorder
    const recorder = new MediaRecorder(stream, {
        mimeType: selectedMimeType,
        videoBitsPerSecond: preset.bitrate
    });
    
    recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
            recordedChunks.push(event.data);
        }
    };
    
    recorder.onstop = async () => {
        stopCapture();
        stream.getTracks().forEach(track => track.stop());
        
        const webmBlob = new Blob(recordedChunks, { type: selectedMimeType });
        const routeName = currentRoute?.name?.replace(/[^a-z0-9]/gi, '-') || 'map-animation';
        const timestamp = Date.now();
        const selectedFormat = formatSelect?.value || 'mp4';
        const quality = qualitySelect?.value || 'medium';
        
        downloadBtn.disabled = false;
        
        if (selectedFormat === 'mp4' && FREE_CONVERT_API_KEY) {
            updateStatus('Recording complete! Click download to convert to MP4. ✅');
            
            downloadBtn.onclick = async () => {
                downloadBtn.disabled = true;
                updateStatus('Converting to MP4... Please wait.');
                
                const mp4Blob = await convertToMP4(webmBlob, quality);
                
                if (mp4Blob) {
                    downloadFile(mp4Blob, `${routeName}-${quality}-${timestamp}.mp4`);
                    updateStatus('Video downloaded as MP4! 💾');
                } else {
                    downloadFile(webmBlob, `${routeName}-${quality}-${timestamp}.webm`);
                    updateStatus('MP4 conversion failed - downloaded as WebM. 💾');
                }
                downloadBtn.disabled = false;
            };
        } else {
            updateStatus('Recording complete! Click download to save. ✅');
            
            downloadBtn.onclick = () => {
                downloadFile(webmBlob, `${routeName}-${quality}-${timestamp}.webm`);
                updateStatus('Video downloaded as WebM! 💾');
            };
        }
    };
    
    return { recorder, stopCapture };
}

// Capture a frame from the map to the recording canvas
async function captureFrame() {
    if (!mapWrapper || !recordingCanvas || !recordingCtx) return;
    
    try {
        // Use html2canvas to capture the map wrapper
        const capturedCanvas = await html2canvas(mapWrapper, {
            useCORS: true,
            allowTaint: true,
            scale: 1,
            logging: false,
            width: mapWrapper.offsetWidth,
            height: mapWrapper.offsetHeight,
            backgroundColor: '#f5f0e6'
        });
        
        // Draw captured content to recording canvas, scaled to 1920x1080
        recordingCtx.fillStyle = '#f5f0e6';
        recordingCtx.fillRect(0, 0, 1920, 1080);
        
        // Calculate scaling to fit 1920x1080 while maintaining aspect ratio
        const scale = Math.min(
            1920 / capturedCanvas.width,
            1080 / capturedCanvas.height
        );
        const x = (1920 - capturedCanvas.width * scale) / 2;
        const y = (1080 - capturedCanvas.height * scale) / 2;
        
        recordingCtx.drawImage(
            capturedCanvas,
            x, y,
            capturedCanvas.width * scale,
            capturedCanvas.height * scale
        );
        
    } catch (err) {
        console.error('Frame capture error:', err);
    }
}

// Download file helper
function downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Start recording
async function startRecording() {
    if (!currentRouteData) {
        updateStatus('Please select a route first');
        return;
    }
    
    if (!map) {
        await initializeMapPreview();
    }
    
    recordedChunks = [];
    
    const recorderObj = await setupMediaRecorder();
    if (!recorderObj) {
        updateStatus('Failed to initialize recorder');
        return;
    }
    
    const { recorder, stopCapture } = recorderObj;
    mediaRecorder = recorder;
    mediaRecorder._stopCapture = stopCapture;
    
    // Start recording
    recorder.start(100);
    isRecording = true;
    startTime = Date.now();
    
    startBtn.disabled = true;
    stopBtn.disabled = false;
    downloadBtn.disabled = true;
    statusDiv.classList.add('recording');
    updateStatus('🔴 Recording... Move/zoom the map, then click Stop when done.');
    
    console.log('Recording started');
}

// Stop recording
function stopRecording() {
    isRecording = false;
    
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        if (mediaRecorder._stopCapture) {
            mediaRecorder._stopCapture();
        }
    }
    
    const duration = (Date.now() - startTime) / 1000;
    
    startBtn.disabled = false;
    stopBtn.disabled = true;
    statusDiv.classList.remove('recording');
    updateStatus(`Recording stopped. Duration: ${duration.toFixed(2)}s ⏱️`);
}

// FreeConvert API Integration
async function connectToJobSocket(jobId) {
    return new Promise((resolve, reject) => {
        const socket = io('wss://api.freeconvert.com', {
            transports: ['websocket'],
            auth: { token: FREE_CONVERT_API_KEY }
        });
        
        socket.on('connect', () => {
            console.log('WebSocket connected');
            socket.emit('subscribe', { job_id: jobId });
            currentSocket = socket;
            resolve(socket);
        });
        
        socket.on('connect_error', (error) => {
            console.error('WebSocket error:', error);
            reject(error);
        });
        
        setTimeout(() => reject(new Error('WebSocket timeout')), 10000);
    });
}

async function convertToMP4(webmBlob, quality = 'medium') {
    if (!FREE_CONVERT_API_KEY) {
        console.error('No FreeConvert API key');
        return null;
    }
    
    const preset = qualityPresets[quality] || qualityPresets.medium;
    
    try {
        showProgress();
        setProgressStage('load');
        updateProgress(5, 'Creating conversion job...', 'Connecting to FreeConvert');
        
        // Create job
        const jobResponse = await fetch(`${FREE_CONVERT_API_URL}/process/jobs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${FREE_CONVERT_API_KEY}`
            },
            body: JSON.stringify({
                tag: 'map-animation-recorder',
                tasks: {
                    'upload-video': { operation: 'import/upload' },
                    'convert-to-mp4': {
                        operation: 'convert',
                        input: 'upload-video',
                        input_format: 'webm',
                        output_format: 'mp4',
                        options: {
                            video_codec: preset.video_codec,
                            video_crf: preset.crf
                        }
                    },
                    'export-result': {
                        operation: 'export/url',
                        input: 'convert-to-mp4'
                    }
                }
            })
        });
        
        if (!jobResponse.ok) {
            throw new Error(`Job creation failed: ${jobResponse.status}`);
        }
        
        const job = await jobResponse.json();
        const uploadTask = job.tasks.find(t => t.operation === 'import/upload');
        
        if (!uploadTask?.result?.form) {
            throw new Error('Upload task not found');
        }
        
        updateProgress(15, 'Uploading video...', 'Sending to server');
        setProgressStage('encode');
        
        // Connect websocket for progress
        let downloadUrl = null;
        const socket = await connectToJobSocket(job.id);
        
        const jobCompletePromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Conversion timeout')), 5 * 60 * 1000);
            
            socket.on('job_completed', (data) => {
                clearTimeout(timeout);
                const exportTask = data.tasks?.find(t => t.operation === 'export/url');
                downloadUrl = exportTask?.result?.url;
                resolve(data);
            });
            
            socket.on('job_failed', (data) => {
                clearTimeout(timeout);
                reject(new Error('Conversion failed'));
            });
            
            socket.on('task_completed', (data) => {
                if (data.operation === 'import/upload') {
                    updateProgress(40, 'Converting...', 'Encoding video');
                } else if (data.operation === 'convert') {
                    updateProgress(80, 'Finalizing...', 'Preparing download');
                    setProgressStage('finalize');
                }
            });
        });
        
        // Upload file
        const formData = new FormData();
        Object.entries(uploadTask.result.form.parameters).forEach(([key, value]) => {
            formData.append(key, value);
        });
        formData.append('file', webmBlob, 'video.webm');
        
        await fetch(uploadTask.result.form.url, {
            method: 'POST',
            body: formData
        });
        
        updateProgress(35, 'Converting...', 'Processing on server');
        
        // Wait for completion
        await jobCompletePromise;
        
        if (currentSocket) {
            currentSocket.disconnect();
            currentSocket = null;
        }
        
        if (!downloadUrl) {
            throw new Error('No download URL');
        }
        
        updateProgress(95, 'Downloading...', 'Fetching converted file');
        
        const mp4Response = await fetch(downloadUrl);
        const mp4Blob = await mp4Response.blob();
        
        updateProgress(100, 'Complete!', 'Video ready');
        
        setTimeout(() => hideProgress(), 1000);
        
        return mp4Blob;
        
    } catch (err) {
        console.error('Conversion failed:', err);
        hideProgress();
        updateStatus('Conversion failed: ' + err.message);
        return null;
    }
}

// Initialize
init();
