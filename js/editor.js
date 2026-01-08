// Editor State
let routes = [];
let currentRouteIndex = -1;
let currentStopIndex = -1;
let hasUnsavedChanges = false;
let fileHandle = null;
let currentFileName = 'routes.json';
let map = null;
let markers = [];
let routeLine = null;

// DOM Elements
const routeList = document.getElementById('routeList');
const emptyState = document.getElementById('emptyState');
const routeEditor = document.getElementById('routeEditor');
const stopList = document.getElementById('stopList');
const mapPreview = document.getElementById('mapPreview');
const previewInfo = document.getElementById('previewInfo');

// File controls
const currentFileDisplay = document.getElementById('currentFileDisplay');
const currentFileNameEl = document.getElementById('currentFileName');
const openFileBtn = document.getElementById('openFileBtn');
const newFileBtn = document.getElementById('newFileBtn');
const newRouteBtn = document.getElementById('newRouteBtn');

// Route form elements
const routeTitle = document.getElementById('routeTitle');
const routeDate = document.getElementById('routeDate');
const startAddress = document.getElementById('startAddress');
const startLabel = document.getElementById('startLabel');
const startZoom = document.getElementById('startZoom');
const startPause = document.getElementById('startPause');
const animDuration = document.getElementById('animDuration');
const animLineColor = document.getElementById('animLineColor');
const animLineWidth = document.getElementById('animLineWidth');

// Stop modal
const stopModal = document.getElementById('stopModal');
const stopModalTitle = document.getElementById('stopModalTitle');
const stopCoords = document.getElementById('stopCoords');
const stopLabel = document.getElementById('stopLabel');
const stopTravelMode = document.getElementById('stopTravelMode');
const stopIcon = document.getElementById('stopIcon');
const stopZoom = document.getElementById('stopZoom');
const stopPause = document.getElementById('stopPause');
const stopModalSave = document.getElementById('stopModalSave');
const stopModalCancel = document.getElementById('stopModalCancel');

// Confirm modal
const confirmModal = document.getElementById('confirmModal');
const confirmModalTitle = document.getElementById('confirmModalTitle');
const confirmModalBody = document.getElementById('confirmModalBody');
const confirmModalConfirm = document.getElementById('confirmModalConfirm');
const confirmModalCancel = document.getElementById('confirmModalCancel');

// Buttons
const addStopBtn = document.getElementById('addStopBtn');
const saveRouteBtn = document.getElementById('saveRouteBtn');
const saveAsBtn = document.getElementById('saveAsBtn');
const exportJsonBtn = document.getElementById('exportJsonBtn');

// Initialize
async function init() {
    initMap();
    await loadRoutes();
    setupEventListeners();
    console.log('Route Editor initialized! 🗺️');
}

// Initialize Leaflet map
function initMap() {
    map = L.map('mapPreview').setView([57.8, 12.1], 11);
    
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19
    }).addTo(map);
    
    // Allow clicking on map to set stop coordinates
    map.on('click', (e) => {
        if (stopModal.classList.contains('active')) {
            stopCoords.value = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
        }
    });
}

// Load routes
async function loadRoutes() {
    try {
        // Try localStorage first (from editor session)
        const storedData = localStorage.getItem('routes_data');
        if (storedData) {
            const data = JSON.parse(storedData);
            routes = data.routes || [];
            console.log('Loaded routes from localStorage');
        } else {
            // Load default route files
            routes = [];
            const defaultFiles = ['destinations.json', 'stannum-ljungslätt.json', 'gulf-campino.json', 'vättlefjäll.json'];
            
            for (const file of defaultFiles) {
                try {
                    const response = await fetch(file);
                    if (response.ok) {
                        const data = await response.json();
                        data._filename = file;
                        routes.push(data);
                    }
                } catch (err) {
                    console.warn(`Could not load ${file}:`, err);
                }
            }
            
            // Sync to localStorage
            syncToRecorder();
        }
        
        updateFileDisplay();
        renderRouteList();
    } catch (error) {
        console.error('Failed to load routes:', error);
        routes = [];
    }
}

// Sync to localStorage for recorder
function syncToRecorder() {
    localStorage.setItem('routes_data', JSON.stringify({ routes }));
    console.log('Synced routes to localStorage');
}

// Render route list
function renderRouteList() {
    if (routes.length === 0) {
        routeList.innerHTML = '<li style="padding: 20px; text-align: center; color: #888;">No routes yet</li>';
        return;
    }
    
    routeList.innerHTML = routes.map((route, index) => `
        <li class="route-item ${index === currentRouteIndex ? 'active' : ''}" data-index="${index}">
            <span>${route.title || `Route ${index + 1}`}</span>
            <span class="route-item-delete" data-index="${index}">🗑️</span>
        </li>
    `).join('');
    
    // Add click listeners
    document.querySelectorAll('.route-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (!e.target.classList.contains('route-item-delete')) {
                loadRoute(parseInt(item.dataset.index));
            }
        });
    });
    
    document.querySelectorAll('.route-item-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteRoute(parseInt(btn.dataset.index));
        });
    });
}

// Load route into editor
function loadRoute(index) {
    currentRouteIndex = index;
    const route = routes[index];
    
    // Show editor
    emptyState.style.display = 'none';
    routeEditor.style.display = 'block';
    
    // Populate form
    routeTitle.value = route.title || '';
    routeDate.value = route.date || '';
    startAddress.value = route.start?.address || '';
    startLabel.value = route.start?.label || '';
    startZoom.value = route.start?.zoomLevel || 13;
    startPause.value = route.start?.pause || 1;
    animDuration.value = route.animation?.totalDuration || 25000;
    animLineColor.value = route.animation?.lineColor || '#8B4513';
    animLineWidth.value = route.animation?.lineWidth || 4;
    
    // Render stops
    renderStopList();
    
    // Update map preview
    updateMapPreview();
    
    // Update sidebar
    renderRouteList();
}

// Render stop list
function renderStopList() {
    const route = routes[currentRouteIndex];
    if (!route || !route.stops || route.stops.length === 0) {
        stopList.innerHTML = '<li style="padding: 20px; text-align: center; color: #888;">No stops yet. Click + Add Stop</li>';
        return;
    }
    
    stopList.innerHTML = route.stops.map((stop, index) => {
        const coords = stop.coordinates ? `${stop.coordinates[0]}, ${stop.coordinates[1]}` : stop.address || '';
        return `
            <li class="stop-item" data-index="${index}">
                <div class="stop-item-info">
                    <div class="stop-item-label">${stop.label || `Stop ${index + 1}`}</div>
                    <div class="stop-item-details">${coords} • ${stop.travelMode || 'driving'} • ${stop.icon || 'car'}</div>
                </div>
                <div class="stop-item-actions">
                    <button class="stop-item-btn edit-stop" data-index="${index}">✏️</button>
                    <button class="stop-item-btn danger delete-stop" data-index="${index}">🗑️</button>
                </div>
            </li>
        `;
    }).join('');
    
    // Add event listeners
    document.querySelectorAll('.edit-stop').forEach(btn => {
        btn.addEventListener('click', () => editStop(parseInt(btn.dataset.index)));
    });
    
    document.querySelectorAll('.delete-stop').forEach(btn => {
        btn.addEventListener('click', () => deleteStop(parseInt(btn.dataset.index)));
    });
}

// Update map preview
function updateMapPreview() {
    // Clear existing markers and lines
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    if (routeLine) {
        map.removeLayer(routeLine);
        routeLine = null;
    }
    
    const route = routes[currentRouteIndex];
    if (!route) return;
    
    const allPoints = [];
    
    // Add start marker
    if (route.start?.coordinates) {
        const marker = L.marker(route.start.coordinates).addTo(map);
        marker.bindPopup(`<b>${route.start.label || 'START'}</b>`);
        markers.push(marker);
        allPoints.push(route.start.coordinates);
    }
    
    // Add stop markers
    if (route.stops) {
        route.stops.forEach((stop, index) => {
            if (stop.coordinates) {
                const marker = L.marker(stop.coordinates).addTo(map);
                marker.bindPopup(`<b>${stop.label || `Stop ${index + 1}`}</b>`);
                markers.push(marker);
                allPoints.push(stop.coordinates);
            }
        });
    }
    
    // Draw line
    if (allPoints.length > 1) {
        const color = route.animation?.lineColor || '#8B4513';
        const weight = route.animation?.lineWidth || 4;
        routeLine = L.polyline(allPoints, { color, weight }).addTo(map);
        map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });
    } else if (allPoints.length === 1) {
        map.setView(allPoints[0], 13);
    }
    
    previewInfo.textContent = `${allPoints.length} point(s) • ${route.stops?.length || 0} stop(s)`;
}

// Update route from form
function updateRouteFromForm() {
    const route = routes[currentRouteIndex];
    if (!route) return;
    
    route.title = routeTitle.value;
    route.date = routeDate.value;
    
    // Update start
    if (!route.start) route.start = {};
    route.start.address = startAddress.value;
    route.start.label = startLabel.value;
    route.start.zoomLevel = parseInt(startZoom.value);
    route.start.pause = parseFloat(startPause.value);
    
    // Update animation
    if (!route.animation) route.animation = {};
    route.animation.totalDuration = parseInt(animDuration.value);
    route.animation.lineColor = animLineColor.value;
    route.animation.lineWidth = parseInt(animLineWidth.value);
    
    markUnsaved();
    syncToRecorder();
}

// Event listeners
function setupEventListeners() {
    // File management
    openFileBtn.addEventListener('click', openFile);
    newFileBtn.addEventListener('click', createNewFile);
    newRouteBtn.addEventListener('click', createNewRoute);
    
    // Stop management
    addStopBtn.addEventListener('click', () => openStopModal());
    stopModalSave.addEventListener('click', saveStop);
    stopModalCancel.addEventListener('click', closeStopModal);
    
    // Route actions
    saveRouteBtn.addEventListener('click', saveRoute);
    saveAsBtn.addEventListener('click', saveAsRoute);
    exportJsonBtn.addEventListener('click', exportJson);
    
    // Track changes
    [routeTitle, routeDate, startAddress, startLabel, startZoom, startPause, 
     animDuration, animLineColor, animLineWidth].forEach(input => {
        input.addEventListener('input', () => {
            updateRouteFromForm();
            updateMapPreview();
        });
    });
    
    // Confirm modal
    confirmModalCancel.addEventListener('click', closeConfirmModal);
    
    // Close modals on overlay click
    stopModal.addEventListener('click', (e) => {
        if (e.target === stopModal) closeStopModal();
    });
    confirmModal.addEventListener('click', (e) => {
        if (e.target === confirmModal) closeConfirmModal();
    });
}

// File management
function updateFileDisplay() {
    currentFileNameEl.textContent = currentFileName;
    if (hasUnsavedChanges) {
        currentFileDisplay.classList.add('unsaved');
    } else {
        currentFileDisplay.classList.remove('unsaved');
    }
}

function markUnsaved() {
    hasUnsavedChanges = true;
    updateFileDisplay();
}

function markSaved() {
    hasUnsavedChanges = false;
    updateFileDisplay();
}

async function openFile() {
    if ('showOpenFilePicker' in window) {
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{
                    description: 'JSON Files',
                    accept: { 'application/json': ['.json'] }
                }]
            });
            
            fileHandle = handle;
            currentFileName = handle.name;
            
            const file = await handle.getFile();
            const contents = await file.text();
            const data = JSON.parse(contents);
            
            // Single route file or multi-route file
            if (data.routes) {
                routes = data.routes;
            } else {
                routes = [data];
            }
            
            currentRouteIndex = -1;
            hasUnsavedChanges = false;
            
            updateFileDisplay();
            renderRouteList();
            emptyState.style.display = 'block';
            routeEditor.style.display = 'none';
            
            syncToRecorder();
            
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Open failed:', err);
                alert('Failed to open file. Make sure it\'s a valid JSON file.');
            }
        }
    } else {
        alert('File System Access API not supported. Use a modern browser like Chrome.');
    }
}

function createNewFile() {
    if (hasUnsavedChanges) {
        if (!confirm('You have unsaved changes. Create new file anyway?')) return;
    }
    
    routes = [];
    currentRouteIndex = -1;
    fileHandle = null;
    currentFileName = 'Untitled.json';
    hasUnsavedChanges = false;
    
    updateFileDisplay();
    renderRouteList();
    emptyState.style.display = 'block';
    routeEditor.style.display = 'none';
}

function createNewRoute() {
    const newRoute = {
        title: 'New Route',
        date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        start: {
            address: '',
            label: 'START',
            zoomLevel: 13,
            pause: 1
        },
        stops: [],
        animation: {
            totalDuration: 25000,
            lineColor: '#8B4513',
            lineWidth: 4
        }
    };
    
    routes.push(newRoute);
    markUnsaved();
    syncToRecorder();
    renderRouteList();
    loadRoute(routes.length - 1);
}

async function saveRoute() {
    if (fileHandle) {
        // Save to existing file
        try {
            const writable = await fileHandle.createWritable();
            const data = routes.length === 1 ? routes[0] : { routes };
            await writable.write(JSON.stringify(data, null, 2));
            await writable.close();
            
            markSaved();
            alert('Route saved successfully! ✅');
        } catch (err) {
            console.error('Save failed:', err);
            alert('Failed to save file: ' + err.message);
        }
    } else {
        // No file handle, trigger Save As
        saveAsRoute();
    }
}

async function saveAsRoute() {
    if ('showSaveFilePicker' in window) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: currentFileName,
                types: [{
                    description: 'JSON Files',
                    accept: { 'application/json': ['.json'] }
                }]
            });
            
            fileHandle = handle;
            currentFileName = handle.name;
            
            const writable = await handle.createWritable();
            const data = routes.length === 1 ? routes[0] : { routes };
            await writable.write(JSON.stringify(data, null, 2));
            await writable.close();
            
            markSaved();
            updateFileDisplay();
            alert('Route saved successfully! ✅');
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Save As failed:', err);
                alert('Failed to save file: ' + err.message);
            }
        }
    } else {
        alert('File System Access API not supported. Use a modern browser like Chrome.');
    }
}

function exportJson() {
    const route = routes[currentRouteIndex];
    if (!route) return;
    
    const json = JSON.stringify(route, null, 2);
    navigator.clipboard.writeText(json).then(() => {
        alert('JSON copied to clipboard! 📋');
    }).catch(err => {
        console.error('Copy failed:', err);
        alert('Failed to copy to clipboard');
    });
}

async function deleteRoute(index) {
    const confirmed = await showConfirm(
        'Delete Route',
        `Are you sure you want to delete "${routes[index].title || `Route ${index + 1}`}"?`
    );
    
    if (confirmed) {
        routes.splice(index, 1);
        
        if (currentRouteIndex === index) {
            currentRouteIndex = -1;
            emptyState.style.display = 'block';
            routeEditor.style.display = 'none';
        } else if (currentRouteIndex > index) {
            currentRouteIndex--;
        }
        
        markUnsaved();
        syncToRecorder();
        renderRouteList();
    }
}

// Stop management
function openStopModal(index = -1) {
    currentStopIndex = index;
    
    if (index >= 0) {
        // Edit existing stop
        const stop = routes[currentRouteIndex].stops[index];
        stopModalTitle.textContent = 'Edit Stop';
        
        if (stop.coordinates) {
            stopCoords.value = `${stop.coordinates[0]}, ${stop.coordinates[1]}`;
        } else {
            stopCoords.value = stop.address || '';
        }
        
        stopLabel.value = stop.label || '';
        stopTravelMode.value = stop.travelMode || 'driving';
        stopIcon.value = stop.icon || 'car';
        stopZoom.value = stop.zoomLevel || 14;
        stopPause.value = stop.pause || 1;
    } else {
        // New stop
        stopModalTitle.textContent = 'Add Stop';
        stopCoords.value = '';
        stopLabel.value = '';
        stopTravelMode.value = 'driving';
        stopIcon.value = 'car';
        stopZoom.value = 14;
        stopPause.value = 1;
    }
    
    stopModal.classList.add('active');
}

function closeStopModal() {
    stopModal.classList.remove('active');
    currentStopIndex = -1;
}

function saveStop() {
    const route = routes[currentRouteIndex];
    if (!route) return;
    
    const coordsValue = stopCoords.value.trim();
    let stop = {
        label: stopLabel.value,
        travelMode: stopTravelMode.value,
        icon: stopIcon.value,
        zoomLevel: parseInt(stopZoom.value),
        pause: parseFloat(stopPause.value)
    };
    
    // Parse coordinates
    if (coordsValue.includes(',')) {
        const [lat, lon] = coordsValue.split(',').map(s => parseFloat(s.trim()));
        if (!isNaN(lat) && !isNaN(lon)) {
            stop.coordinates = [lat, lon];
        }
    } else {
        stop.address = coordsValue;
    }
    
    if (!route.stops) route.stops = [];
    
    if (currentStopIndex >= 0) {
        // Update existing
        route.stops[currentStopIndex] = stop;
    } else {
        // Add new
        route.stops.push(stop);
    }
    
    markUnsaved();
    syncToRecorder();
    renderStopList();
    updateMapPreview();
    closeStopModal();
}

function editStop(index) {
    openStopModal(index);
}

async function deleteStop(index) {
    const confirmed = await showConfirm(
        'Delete Stop',
        'Are you sure you want to delete this stop?'
    );
    
    if (confirmed) {
        const route = routes[currentRouteIndex];
        route.stops.splice(index, 1);
        
        markUnsaved();
        syncToRecorder();
        renderStopList();
        updateMapPreview();
    }
}

// Confirm modal
function showConfirm(title, message) {
    return new Promise((resolve) => {
        confirmModalTitle.textContent = title;
        confirmModalBody.textContent = message;
        
        const handleConfirm = () => {
            cleanup();
            resolve(true);
        };
        
        const handleCancel = () => {
            cleanup();
            resolve(false);
        };
        
        const cleanup = () => {
            confirmModal.classList.remove('active');
            confirmModalConfirm.removeEventListener('click', handleConfirm);
            confirmModalCancel.removeEventListener('click', handleCancel);
        };
        
        confirmModalConfirm.addEventListener('click', handleConfirm);
        confirmModalCancel.addEventListener('click', handleCancel);
        
        confirmModal.classList.add('active');
    });
}

function closeConfirmModal() {
    confirmModal.classList.remove('active');
}

// Initialize
init();
