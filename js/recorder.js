import { io } from 'socket.io-client';

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

// DOM Elements
const routeSelect = document.getElementById('routeSelect');
const reloadBtn = document.getElementById('reloadBtn');
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

// State
let routes = [];
let currentRoute = null;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let isConverting = false;
let startTime = null;
let currentSocket = null;
let animationCompleted = false;

// Map container for canvas capture
const mapContainer = document.getElementById('map');

// Initialize
async function init() {
    await loadRoutes();
    setupEventListeners();
    console.log('Map Recorder initialized! 🎬');
}

// Load available routes
async function loadRoutes() {
    try {
        // Try to load from localStorage (edited in editor)
        const storedData = localStorage.getItem('routes_data');
        if (storedData) {
            const data = JSON.parse(storedData);
            routes = data.routes || [];
            sourceFile.textContent = '📝 From Editor';
            console.log('Loaded routes from editor');
        } else {
            // Fallback: load default JSON files
            routes = [
                { id: 'destinations', name: 'Default Destinations', file: 'destinations.json' },
                { id: 'stannum', name: 'Stannum to Ljungslätt', file: 'stannum-ljungslätt.json' },
                { id: 'gulf', name: 'Gulf Campino', file: 'gulf-campino.json' },
                { id: 'vattlefjall', name: 'Vättlefjäll', file: 'vättlefjäll.json' }
            ];
            sourceFile.textContent = '📄 Default files';
            console.log('Loaded default route files');
        }
        
        // Populate dropdown
        routeSelect.innerHTML = routes.map((route, index) => 
            `<option value="${index}">${route.name || route.title || `Route ${index + 1}`}</option>`
        ).join('');
        
        if (routes.length > 0) {
            routeSelect.selectedIndex = 0;
            await loadRouteData(0);
        }
    } catch (error) {
        console.error('Failed to load routes:', error);
        updateStatus('Error loading routes');
    }
}

// Load specific route data
async function loadRouteData(index) {
    try {
        currentRoute = routes[index];
        console.log('Selected route:', currentRoute.name || currentRoute.title);
        
        // If route has data already (from editor), use it
        if (!currentRoute.data && currentRoute.file) {
            // Load from file
            const response = await fetch(currentRoute.file);
            currentRoute.data = await response.json();
        }
        
        // TODO: Initialize map preview with route data
        // This will be handled by the existing map initialization code
        
        updateStatus(`Loaded: ${currentRoute.name || currentRoute.title}`);
    } catch (error) {
        console.error('Failed to load route data:', error);
        updateStatus('Error loading route data');
    }
}

// Event Listeners
function setupEventListeners() {
    routeSelect.addEventListener('change', async (e) => {
        await loadRouteData(parseInt(e.target.value));
    });
    
    reloadBtn.addEventListener('click', async () => {
        reloadBtn.disabled = true;
        reloadBtn.textContent = '⏳';
        await loadRoutes();
        reloadBtn.textContent = '🔄';
        reloadBtn.disabled = false;
        updateStatus('Routes reloaded! ✅');
    });
    
    startBtn.addEventListener('click', startRecording);
    stopBtn.addEventListener('click', stopRecording);
}

// Update status message
function updateStatus(message) {
    statusDiv.textContent = message;
}

// Progress UI
function showProgress() {
    progressContainer.classList.add('active');
}

function hideProgress() {
    progressContainer.classList.remove('active');
}

function updateProgress(percent, label, sublabel) {
    const circumference = 126; // 2 * π * 20
    const offset = circumference - (percent / 100) * circumference;
    
    progressPercent.textContent = `${Math.round(percent)}%`;
    progressSpinnerFill.style.strokeDashoffset = offset;
    progressBarFill.style.width = `${percent}%`;
    progressLabel.textContent = label;
    progressSublabel.textContent = sublabel;
    
    if (percent > 0) {
        progressBarWrapper.classList.add('active');
    } else {
        progressBarWrapper.classList.remove('active');
    }
}

function setProgressStage(stage) {
    [stageLoad, stageEncode, stageFinalize].forEach(el => el.classList.remove('active'));
    
    if (stage === 'load') stageLoad.classList.add('active');
    else if (stage === 'encode') stageEncode.classList.add('active');
    else if (stage === 'finalize') stageFinalize.classList.add('active');
}

// Setup MediaRecorder
function setupMediaRecorder() {
    // For Leaflet maps, we need to capture the entire map container
    // We'll use html2canvas or similar approach, but for now let's use canvas.captureStream
    // Note: Leaflet uses HTML/CSS, not canvas, so we need a different approach
    
    // Check if we can capture the display media
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        alert('Screen recording not supported in your browser!');
        return null;
    }
    
    // For now, we'll use getDisplayMedia to capture the map area
    // In production, you might want to use a library like html2canvas for frame capture
    
    const selectedQuality = qualitySelect.value || 'medium';
    const preset = qualityPresets[selectedQuality] || qualityPresets.medium;
    
    // Start display capture
    navigator.mediaDevices.getDisplayMedia({
        video: {
            mediaSource: 'screen',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 }
        },
        audio: false
    }).then(stream => {
        const mimeTypes = [
            { mime: 'video/webm;codecs=vp9', ext: 'webm' },
            { mime: 'video/webm;codecs=vp8', ext: 'webm' },
            { mime: 'video/webm', ext: 'webm' },
        ];

        let selectedMimeType = '';
        
        for (const { mime } of mimeTypes) {
            if (MediaRecorder.isTypeSupported(mime)) {
                selectedMimeType = mime;
                break;
            }
        }

        if (!selectedMimeType) {
            alert('Your browser does not support video recording!');
            return;
        }

        console.log('Using MIME type:', selectedMimeType);
        console.log('Recording at bitrate:', preset.bitrate);

        mediaRecorder = new MediaRecorder(stream, {
            mimeType: selectedMimeType,
            videoBitsPerSecond: preset.bitrate
        });

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            // Stop all tracks
            stream.getTracks().forEach(track => track.stop());
            
            const webmBlob = new Blob(recordedChunks, {
                type: selectedMimeType
            });
            
            const routeName = currentRoute?.name || currentRoute?.title || 'map-animation';
            const timestamp = Date.now();
            const selectedFormat = formatSelect.value || 'mp4';
            const quality = qualitySelect.value || 'medium';

            downloadBtn.disabled = false;
            
            if (selectedFormat === 'mp4') {
                updateStatus('Recording complete! Click download to convert & save as MP4. ✅');
                
                downloadBtn.onclick = async () => {
                    downloadBtn.disabled = true;
                    updateStatus('Converting to MP4... Please wait.');
                    
                    const mp4Blob = await convertToMP4(webmBlob, quality);
                    
                    if (mp4Blob) {
                        const url = URL.createObjectURL(mp4Blob);
                        const a = document.createElement('a');
                        a.style.display = 'none';
                        a.href = url;
                        a.download = `${routeName}-${quality}-${timestamp}.mp4`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        updateStatus('Video downloaded as MP4! 💾');
                        downloadBtn.disabled = false;
                    } else {
                        // Fallback to WebM
                        const url = URL.createObjectURL(webmBlob);
                        const a = document.createElement('a');
                        a.style.display = 'none';
                        a.href = url;
                        a.download = `${routeName}-${quality}-${timestamp}.webm`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        updateStatus('MP4 conversion failed - downloaded as WebM instead. 💾');
                        downloadBtn.disabled = false;
                    }
                };
            } else {
                // Keep as WebM
                updateStatus('Recording complete! Click download to save WebM. ✅');
                
                downloadBtn.onclick = () => {
                    const url = URL.createObjectURL(webmBlob);
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = url;
                    a.download = `${routeName}-${quality}-${timestamp}.webm`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    updateStatus('Video downloaded as WebM! 💾');
                };
            }
        };

        // Start recording
        mediaRecorder.start(100);
        isRecording = true;
        startTime = Date.now();

        startBtn.disabled = true;
        stopBtn.disabled = false;
        downloadBtn.disabled = true;
        statusDiv.classList.add('recording');
        updateStatus('🔴 Recording in progress... Select the map window in the screen picker.');
        
        console.log('Recording started');
    }).catch(error => {
        console.error('Failed to start recording:', error);
        updateStatus('Failed to start recording. ' + error.message);
    });
}

// Connect to FreeConvert WebSocket
async function connectToJobSocket(jobId) {
    return new Promise((resolve, reject) => {
        const socket = io('wss://api.freeconvert.com', {
            transports: ['websocket'],
            auth: {
                token: FREE_CONVERT_API_KEY
            }
        });
        
        socket.on('connect', () => {
            console.log('WebSocket connected');
            socket.emit('subscribe', { job_id: jobId });
            currentSocket = socket;
            resolve(socket);
        });
        
        socket.on('connect_error', (error) => {
            console.error('WebSocket connection error:', error);
            reject(error);
        });
    });
}

// Convert WebM to MP4 using FreeConvert API
async function convertToMP4(webmBlob, quality = 'medium') {
    if (!FREE_CONVERT_API_KEY || FREE_CONVERT_API_KEY === 'your_api_key_here') {
        updateStatus('❌ FreeConvert API key not configured. Add VITE_FREE_CONVERT_API_KEY to .env file.');
        return null;
    }
    
    console.log('Starting FreeConvert conversion, blob size:', webmBlob.size);
    isConverting = true;
    
    const preset = qualityPresets[quality] || qualityPresets.medium;
    console.log('Using quality preset:', quality, preset);
    
    try {
        showProgress();
        setProgressStage('load');
        updateProgress(5, 'Creating conversion job...', 'Connecting to FreeConvert API');
        statusDiv.classList.add('converting');
        updateStatus(`🔄 Converting to MP4 (${preset.label} quality)...`);
        
        // Step 1: Create a job
        const jobResponse = await fetch(`${FREE_CONVERT_API_URL}/process/jobs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${FREE_CONVERT_API_KEY}`
            },
            body: JSON.stringify({
                tag: 'map-animation',
                tasks: {
                    'upload-video': {
                        operation: 'import/upload'
                    },
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
            const errorText = await jobResponse.text();
            throw new Error(`Failed to create job: ${jobResponse.status} - ${errorText}`);
        }
        
        const job = await jobResponse.json();
        console.log('Job created:', job);
        
        updateProgress(10, 'Uploading video...', 'Preparing upload');
        
        // Find upload task
        const uploadTask = job.tasks.find(t => t.operation === 'import/upload');
        if (!uploadTask || !uploadTask.result?.form) {
            throw new Error('Upload task not found in job response');
        }
        
        const uploadUrl = uploadTask.result.form.url;
        const uploadParams = uploadTask.result.form.parameters;
        
        console.log('Upload URL:', uploadUrl);
        
        // Step 2: Connect to WebSocket
        setProgressStage('encode');
        updateProgress(15, 'Uploading video...', 'Sending file to server');
        
        let downloadUrl = null;
        
        const socket = await connectToJobSocket(job.id);
        
        // Set up event listeners
        const jobCompletePromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Conversion timeout - took longer than 5 minutes'));
            }, 5 * 60 * 1000);
            
            socket.on('job_completed', (data) => {
                console.log('Job completed:', data);
                clearTimeout(timeout);
                
                const exportTask = data.tasks?.find(t => t.operation === 'export/url');
                if (exportTask?.result?.url) {
                    downloadUrl = exportTask.result.url;
                }
                resolve(data);
            });
            
            socket.on('job_failed', (data) => {
                console.error('Job failed:', data);
                clearTimeout(timeout);
                reject(new Error(`Conversion failed: ${data.result?.msg || 'Unknown error'}`));
            });
            
            socket.on('task_completed', (data) => {
                console.log('Task completed:', data);
                
                if (data.operation === 'import/upload') {
                    updateProgress(40, 'Converting video...', 'Upload complete, encoding started');
                } else if (data.operation === 'convert') {
                    updateProgress(80, 'Exporting video...', 'Conversion complete');
                    setProgressStage('finalize');
                } else if (data.operation === 'export/url') {
                    updateProgress(95, 'Preparing download...', 'Getting download link');
                    if (data.result?.url) {
                        downloadUrl = data.result.url;
                    }
                }
            });
            
            socket.on('task_min_update', (data) => {
                console.log('Task progress:', data);
                if (data.operation === 'convert' && data.progress) {
                    const percent = Math.round(40 + data.progress * 40);
                    updateProgress(percent, 'Converting video...', `Encoding: ${Math.round(data.progress * 100)}%`);
                }
            });
        });
        
        // Step 3: Upload file
        const formData = new FormData();
        Object.entries(uploadParams).forEach(([key, value]) => {
            formData.append(key, value);
        });
        formData.append('file', webmBlob, 'video.webm');
        
        console.log('Uploading file...');
        const uploadResponse = await fetch(uploadUrl, {
            method: 'POST',
            body: formData
        });
        
        if (!uploadResponse.ok) {
            throw new Error(`Upload failed: ${uploadResponse.status}`);
        }
        
        console.log('Upload complete, waiting for conversion...');
        updateProgress(35, 'Converting video...', 'Processing on server');
        
        // Step 4: Wait for completion
        await jobCompletePromise;
        
        // Cleanup socket
        if (currentSocket) {
            currentSocket.disconnect();
            currentSocket = null;
        }
        
        if (!downloadUrl) {
            // Try to get download URL from job status
            const jobStatusResponse = await fetch(`${FREE_CONVERT_API_URL}/process/jobs/${job.id}`, {
                headers: {
                    'Authorization': `Bearer ${FREE_CONVERT_API_KEY}`
                }
            });
            const jobStatus = await jobStatusResponse.json();
            const exportTask = jobStatus.tasks?.find(t => t.operation === 'export/url');
            downloadUrl = exportTask?.result?.url;
        }
        
        if (!downloadUrl) {
            throw new Error('No download URL received');
        }
        
        console.log('Download URL:', downloadUrl);
        updateProgress(98, 'Downloading MP4...', 'Fetching converted file');
        
        // Step 5: Download the converted file
        const mp4Response = await fetch(downloadUrl);
        if (!mp4Response.ok) {
            throw new Error(`Failed to download MP4: ${mp4Response.status}`);
        }
        
        const mp4Blob = await mp4Response.blob();
        console.log('MP4 blob downloaded, size:', mp4Blob.size);
        
        updateProgress(100, 'Complete!', 'Video ready for download');
        setProgressStage('complete');
        
        setTimeout(() => {
            hideProgress();
            statusDiv.classList.remove('converting');
            isConverting = false;
        }, 1000);
        
        return mp4Blob;
        
    } catch (err) {
        console.error('Conversion failed:', err);
        
        if (currentSocket) {
            currentSocket.disconnect();
            currentSocket = null;
        }
        
        hideProgress();
        statusDiv.classList.remove('converting');
        isConverting = false;
        updateStatus('Conversion failed: ' + err.message);
        return null;
    }
}

// Start recording
function startRecording() {
    if (!currentRoute) {
        updateStatus('Please select a route first');
        return;
    }
    
    recordedChunks = [];
    setupMediaRecorder();
}

// Stop recording
function stopRecording() {
    isRecording = false;
    
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    
    const duration = (Date.now() - startTime) / 1000;
    
    startBtn.disabled = false;
    stopBtn.disabled = true;
    statusDiv.classList.remove('recording');
    updateStatus(`Recording stopped. Duration: ${duration.toFixed(2)}s ⏱️`);
}

// Initialize when DOM is ready
init();
