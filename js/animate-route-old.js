/**
 * Main Animation Function
 * Orchestrates the entire route animation
 */

async function animateRoute() {
    const { 
        routeSegments, 
        lineColor, 
        lineWidth, 
        animationDuration, 
        finalDestination, 
        title, 
        date,
        startZoomLevel 
    } = window.mapData;
    
    const map = window.getMap();
    const allCoordinates = routeSegments.flatMap(seg => seg.coordinates);
    const startCoord = allCoordinates[0];
    
    // ========================================
    // SETUP: Position map at start location BEFORE title shows
    // ========================================
    const overviewZoom = 11;
    map.setView(startCoord, overviewZoom, { animate: false });
    
    // Add start marker immediately so it's visible behind the title
    // Using divIcon for zoom-independent size
    const startMarker = L.marker(startCoord, {
        icon: L.divIcon({
            className: 'start-marker',
            html: '<div style="width:20px;height:20px;background:#8B0000;border:3px solid #3d2817;border-radius:50%;"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        })
    }).addTo(map);
    
    const startLabel = L.marker(startCoord, {
        icon: L.divIcon({
            className: 'location-label',
            html: routeSegments[0].fromLabel,
            iconSize: [160, 30],
            iconAnchor: [80, -20]
        })
    }).addTo(map);
    
    // ========================================
    // STAGE 1: Show title card with date (quick fade in)
    // ========================================
    const titleCard = document.getElementById('title-card');
    titleCard.innerHTML = `<div class="title-text">${title}</div><div class="date-text">${date}</div>`;
    
    // Quick fade in
    await wait(200);
    titleCard.style.opacity = '1';
    
    await wait(2000);  // Show title for 2 seconds
    
    // Fade out title card
    titleCard.style.opacity = '0';
    await wait(800);
    
    // Show title stamp in corner
    const dateStamp = document.getElementById('date-stamp');
    dateStamp.textContent = title.toUpperCase();
    dateStamp.style.opacity = '1';
    
    // ========================================
    // STAGE 2: Zoom IN to starting point
    // ========================================
    // Calculate segment zoom levels - respects per-stop zoomLevel from config
    const segmentZoomLevels = window.ZoomUtils.calculateSegmentZoomLevels(map, routeSegments, allCoordinates, {
        maxZoom: 15,
        defaultCloseZoom: 13
    });
    
    // Starting zoom level (from start.zoomLevel or first segment)
    const closeZoom = startZoomLevel || segmentZoomLevels[0] || 13;
    
    // Cinematic zoom IN from overview (11) to close-up
    console.log(`Zooming from ${overviewZoom} to ${closeZoom}...`);
    map.flyTo(startCoord, closeZoom, { 
        duration: 4,        // 4 seconds for the zoom-in
        easeLinearity: 0.1  // Slow ease for cinematic feel
    });
    
    await wait(4500);  // Wait for flyTo to complete
    
    // Add end marker (hidden) - using divIcon for zoom-independent size
    const endCoord = allCoordinates[allCoordinates.length - 1];
    const endMarker = L.marker(endCoord, {
        icon: L.divIcon({
            className: 'end-marker',
            html: '<div class="end-marker-dot" style="width:20px;height:20px;background:#006400;border:3px solid #3d2817;border-radius:50%;opacity:0;transition:opacity 0.5s;"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        })
    }).addTo(map);
    
    // Helper to show end marker
    const showEndMarker = () => {
        const dot = document.querySelector('.end-marker-dot');
        if (dot) dot.style.opacity = '1';
    };
    
    // Add end label (initially hidden)
    const endLabel = L.marker(allCoordinates[allCoordinates.length - 1], {
        icon: L.divIcon({
            className: 'location-label',
            html: finalDestination,
            iconSize: [260, 30],
            iconAnchor: [130, -20]
        }),
        opacity: 0
    }).addTo(map);
    
    window.endLabel = endLabel;
    
    // Show icons (initially hidden)
    const motorcycle = document.getElementById('motorcycle');
    const person = document.getElementById('person');
    const car = document.getElementById('car');
    const backpacker = document.getElementById('backpacker');
    motorcycle.style.display = 'block';
    person.style.display = 'block';
    car.style.display = 'block';
    backpacker.style.display = 'block';
    motorcycle.style.opacity = '1'; // Show motorcycle initially
    
    // ========================================
    // STAGE 3: Animate route WITH cinematic zoom
    // ========================================
    const startTime = performance.now();
    let animatedLine = null;
    let lastAngle = 0;
    
    // Initialize camera state from ACTUAL current map position/zoom
    const currentMapCenter = map.getCenter();
    let cameraLat = currentMapCenter.lat;
    let cameraLng = currentMapCenter.lng;
    let cameraZoom = map.getZoom();
    
    // Pre-create all waypoint markers and labels (hidden) for fade-in effect
    const waypointMarkers = [];
    const waypointLabels = [];
    const waypointShown = [];
    
    // Calculate cumulative distances for each segment endpoint
    const segmentEndpoints = [];
    let cumulativeWaypoints = 0;
    for (let i = 0; i < routeSegments.length; i++) {
        cumulativeWaypoints += routeSegments[i].coordinates.length;
        const segEndCoord = routeSegments[i].coordinates[routeSegments[i].coordinates.length - 1];
        segmentEndpoints.push({
            coord: segEndCoord,
            waypointIndex: cumulativeWaypoints - 1,
            label: routeSegments[i].toLabel,
            showMarker: routeSegments[i].showMarker !== false
        });
        
        // Create hidden marker and label for each waypoint (except last - that's the destination)
        if (i < routeSegments.length - 1 && routeSegments[i].toLabel) {
            const marker = L.circleMarker(segEndCoord, {
                radius: 10,
                fillColor: '#FF8C00',
                color: '#3d2817',
                weight: 3,
                fillOpacity: 0
            }).addTo(map);
            
            const label = L.marker(segEndCoord, {
                icon: L.divIcon({
                    className: 'location-label',
                    html: routeSegments[i].toLabel,
                    iconSize: [200, 30],
                    iconAnchor: [100, -20]
                }),
                opacity: 0
            }).addTo(map);
            
            waypointMarkers.push(marker);
            waypointLabels.push(label);
            waypointShown.push(false);
        }
    }
    
    // Track which waypoints have been faded out after visiting
    const waypointFadedOut = new Array(waypointMarkers.length).fill(false);
    // Track when we entered each segment (for delayed fade-out)
    let segmentEnteredAt = -1;
    let lastSegment = 0;
    
    // Calculate segment progress thresholds for determining which segment we're in
    const segmentProgressThresholds = window.ZoomUtils.calculateSegmentProgressThresholds(routeSegments);
    
    // Create zoom keyframes for smooth interpolation between per-segment zoom levels
    const zoomKeyframes = window.ZoomUtils.createZoomKeyframes(segmentZoomLevels, segmentProgressThresholds);
    
    // Extract pause durations for each segment (in ms) - default 500ms if not specified
    const segmentPauses = routeSegments.map(seg => 
        seg.pause !== undefined ? seg.pause * 1000 : 500
    );
    
    // Wrap animation in a Promise
    await new Promise((animationResolve) => {
        let lastPausedAfterSegment = -1;  // Track which segment we last paused after
        let isPaused = false;
        let pauseStartTime = 0;
        let totalPausedTime = 0;  // Accumulate all pause time
        
        function drawFrame(currentTime) {
            // Handle pausing between segments
            if (isPaused) {
                const pauseElapsed = currentTime - pauseStartTime;
                const pauseDuration = segmentPauses[lastPausedAfterSegment] || 500;
                
                if (pauseElapsed >= pauseDuration) {
                    // Resume animation
                    isPaused = false;
                    totalPausedTime += pauseDuration;
                } else {
                    // Still paused, keep requesting frames
                    requestAnimationFrame(drawFrame);
                    return;
                }
            }
            
            // Calculate progress accounting for paused time
            const elapsed = currentTime - startTime - totalPausedTime;
            const progress = Math.min(elapsed / animationDuration, 1);
            
            // Use shared utility to determine segment info
            const segInfo = window.ZoomUtils.getSegmentInfo(progress, segmentProgressThresholds);
            const { currentSegment, segmentProgress } = segInfo;
            
            // Check if we need to pause at the start of a new segment
            // Only pause if: we're in segment > 0, and we haven't paused after the previous segment yet
            if (currentSegment > 0 && lastPausedAfterSegment < currentSegment - 1) {
                // Pause after completing the previous segment
                lastPausedAfterSegment = currentSegment - 1;
                isPaused = true;
                pauseStartTime = currentTime;
                requestAnimationFrame(drawFrame);
                return;
            }
            
            // Fade in waypoint labels when 1/3 of distance away
            for (let i = 0; i < waypointMarkers.length; i++) {
                if (!waypointShown[i]) {
                    const showThreshold = i === 0 
                        ? segmentProgressThresholds[0] * 0.33 
                        : segmentProgressThresholds[i] - (segmentProgressThresholds[i] - (segmentProgressThresholds[i-1] || 0)) * 0.67;
                    
                    if (progress >= showThreshold) {
                        waypointMarkers[i].setStyle({ fillOpacity: 0.9 });
                        waypointLabels[i].setOpacity(1);
                        waypointShown[i] = true;
                    }
                }
                
                // Fade out waypoint labels after we've been in the next segment for a bit (20% through)
                // This gives time to see the label before it fades
                if (waypointShown[i] && !waypointFadedOut[i] && currentSegment > i && segmentProgress > 0.2) {
                    waypointMarkers[i].setStyle({ fillOpacity: 0 });
                    waypointLabels[i].setOpacity(0);
                    waypointFadedOut[i] = true;
                }
            }
            
            // Handle icon visibility and fading
            const currentIconType = routeSegments[currentSegment].icon;
            const nextSegment = currentSegment + 1;
            const nextIconType = nextSegment < routeSegments.length ? routeSegments[nextSegment].icon : null;
            const iconWillChange = nextIconType && nextIconType !== currentIconType;
            
            // Fade out icon early if approaching a stop where icon will change
            // Start fading when we're 95% through the current segment
            const fadeOutThreshold = 0.95;
            const shouldFadeOutEarly = iconWillChange && segmentProgress > fadeOutThreshold;
            
            let currentIcon;
            
            // Hide all icons first
            motorcycle.style.opacity = '0';
            person.style.opacity = '0';
            car.style.opacity = '0';
            backpacker.style.opacity = '0';
            
            // Show current icon (unless 'none' or fading out early)
            if (currentIconType === 'none' || shouldFadeOutEarly) {
                currentIcon = null;  // No icon for this segment or fading out
            } else if (currentIconType === 'bike') {
                currentIcon = motorcycle;
                motorcycle.style.opacity = '1';
            } else if (currentIconType === 'car') {
                currentIcon = car;
                car.style.opacity = '1';
            } else if (currentIconType === 'backpacker') {
                currentIcon = backpacker;
                backpacker.style.opacity = '1';
            } else {
                currentIcon = person;
                person.style.opacity = '1';
            }
            
            // Safety check for coordinates
            if (!routeSegments[currentSegment] || !routeSegments[currentSegment].coordinates) {
                console.error('Missing coordinates for segment', currentSegment);
                animationResolve();
                return;
            }
            
            const coordinates = routeSegments[currentSegment].coordinates;
            const eased = segmentProgress;
            
            // === ZOOM: Interpolate between per-segment zoom levels from config ===
            // This respects the zoomLevel set on each stop in destinations.json
            const targetZoom = window.ZoomUtils.getInterpolatedZoom(progress, zoomKeyframes);
            
            // Calculate vehicle position within segment
            const totalPoints = coordinates.length - 1;
            const currentFloat = eased * totalPoints;
            const currentIndex = Math.floor(currentFloat);
            const fraction = currentFloat - currentIndex;
            
            // Get vehicle position with interpolation
            const safeIndex = Math.max(0, Math.min(currentIndex, coordinates.length - 1));
            const safeNextIndex = Math.min(safeIndex + 1, coordinates.length - 1);
            
            let vehiclePos;
            if (safeIndex < coordinates.length - 1 && fraction > 0) {
                const current = coordinates[safeIndex];
                const next = coordinates[safeNextIndex];
                vehiclePos = [
                    current[0] + (next[0] - current[0]) * fraction,
                    current[1] + (next[1] - current[1]) * fraction
                ];
            } else {
                vehiclePos = coordinates[safeIndex];
            }
            
            // === CINEMATIC CAMERA: Look ahead of vehicle ===
            const lookAheadDistance = Math.min(30, coordinates.length - safeIndex - 1);
            const lookAheadIndex = Math.min(safeIndex + lookAheadDistance, coordinates.length - 1);
            const lookAheadPos = coordinates[lookAheadIndex];
            
            // Blend between vehicle position and look-ahead
            // More look-ahead when zoomed out (lower zoom number)
            const zoomOutFactor = Math.max(0, (14 - targetZoom) / 4);
            const lookAheadBlend = 0.1 * zoomOutFactor;
            const targetLat = vehiclePos[0] + (lookAheadPos[0] - vehiclePos[0]) * lookAheadBlend;
            const targetLng = vehiclePos[1] + (lookAheadPos[1] - vehiclePos[1]) * lookAheadBlend;
            
            // Smooth camera POSITION tracking
            const positionSmoothing = 0.08;
            cameraLat += (targetLat - cameraLat) * positionSmoothing;
            cameraLng += (targetLng - cameraLng) * positionSmoothing;
            
            // Smooth ZOOM tracking (lower = slower/more cinematic)
            const zoomSmoothing = 0.8;
            cameraZoom += (targetZoom - cameraZoom) * zoomSmoothing;
            
            // Set camera with animation for smooth transitions
            map.setView([cameraLat, cameraLng], cameraZoom, { 
                animate: true,
                duration: 0.9
            });
            
            // Get visible coordinates for line drawing
            const visibleCoords = coordinates.slice(0, safeIndex + 1);
            if (safeIndex < coordinates.length - 1 && fraction > 0) {
                visibleCoords.push([
                    coordinates[safeIndex][0] + (coordinates[safeNextIndex][0] - coordinates[safeIndex][0]) * fraction,
                    coordinates[safeIndex][1] + (coordinates[safeNextIndex][1] - coordinates[safeIndex][1]) * fraction
                ]);
            }
            
            // Remove old line
            if (animatedLine) {
                map.removeLayer(animatedLine);
            }
            
            // Build complete line including all previous segments
            let allVisibleCoords = [];
            for (let i = 0; i < currentSegment; i++) {
                allVisibleCoords.push(...routeSegments[i].coordinates);
            }
            allVisibleCoords.push(...visibleCoords);
            
            // Draw new line (dashed for vintage look)
            if (allVisibleCoords.length > 1) {
                animatedLine = L.polyline(allVisibleCoords, {
                    color: lineColor,
                    weight: lineWidth,
                    opacity: 0.9,
                    smoothFactor: 1,
                    dashArray: '10, 8',
                    className: 'route-line'
                }).addTo(map);
            }
            
            // Update icon position with smooth rotation (skip if no icon)
            if (visibleCoords.length > 0 && currentIcon) {
                const currentPos = visibleCoords[visibleCoords.length - 1];
                const point = map.latLngToContainerPoint(currentPos);
                
                // Center the icon on the point
                let iconSize;
                if (currentIconType === 'bike' || currentIconType === 'car') {
                    iconSize = 60;
                } else if (currentIconType === 'backpacker') {
                    iconSize = 35;
                } else {
                    iconSize = 40;
                }
                const iconOffset = iconSize / 2;
                currentIcon.style.left = (point.x - iconOffset) + 'px';
                currentIcon.style.top = (point.y - iconOffset) + 'px';
                
                // =====================================================
                // ICON ORIENTATION LOGIC
                // =====================================================
                // Icon default orientations (VERIFIED):
                //   - car.png: faces LEFT ← (hood on left)
                //   - bike.png: faces LEFT ← (handlebars on left)
                //   - backpack.png: faces LEFT ← 
                //   - person.png: faces RIGHT →
                // =====================================================
                
                // Look VERY FAR ahead on the route for stable direction (less sensitive to turns)
                // Use a large look-ahead to prevent jittery tilts at stops
                const lookAhead = Math.min(coordinates.length - 1, safeIndex + 300);
                const fromPos = coordinates[safeIndex];
                const toPos = coordinates[lookAhead];
                
                // Convert to screen coordinates
                const fromPoint = map.latLngToContainerPoint(fromPos);
                const toPoint = map.latLngToContainerPoint(toPos);
                
                // Calculate direction vector
                const dx = toPoint.x - fromPoint.x;
                const dy = toPoint.y - fromPoint.y;
                
                // atan2 gives: 0°=right, 90°=down, ±180°=left, -90°=up
                const direction = Math.atan2(dy, dx) * 180 / Math.PI;
                
                if (currentIconType === 'car') {
                    // CAR is SIDE VIEW facing RIGHT
                    const goingLeft = Math.abs(direction) > 90;
                    const scaleX = goingLeft ? -1 : 1;
                    
                    let tilt;
                    if (goingLeft) {
                        tilt = direction > 0 ? -(direction - 180) : -(direction + 180);
                    } else {
                        tilt = direction;
                    }
                    
                    // Smooth interpolation - very gradual to avoid jitter
                    let angleDiff = tilt - lastAngle;
                    while (angleDiff > 180) angleDiff -= 360;
                    while (angleDiff < -180) angleDiff += 360;
                    // Only update if change is significant (> 5 degrees) and use very slow interpolation
                    if (Math.abs(angleDiff) > 5) {
                        lastAngle = lastAngle + angleDiff * 0.03;
                    }
                    
                    currentIcon.style.transform = `scaleX(${scaleX}) rotate(${lastAngle}deg)`;
                    currentIcon.style.transformOrigin = 'center center';
                    
                } else if (currentIconType === 'bike') {
                    // BIKE is SIDE VIEW facing LEFT
                    const goingRight = Math.abs(direction) <= 90;
                    const scaleX = goingRight ? -1 : 1;
                    
                    let tilt;
                    if (goingRight) {
                        tilt = -direction;
                    } else {
                        tilt = direction > 0 ? direction - 180 : direction + 180;
                    }
                    
                    // Smooth interpolation - very gradual to avoid jitter
                    let angleDiff = tilt - lastAngle;
                    while (angleDiff > 180) angleDiff -= 360;
                    while (angleDiff < -180) angleDiff += 360;
                    // Only update if change is significant (> 5 degrees) and use very slow interpolation
                    if (Math.abs(angleDiff) > 5) {
                        lastAngle = lastAngle + angleDiff * 0.03;
                    }
                    
                    currentIcon.style.transform = `scaleX(${scaleX}) rotate(${lastAngle}deg)`;
                    currentIcon.style.transformOrigin = 'center center';
                    
                } else {
                    // PERSON and BACKPACKER - stay upright, flip horizontally
                    const travelingLeft = dx < 0;
                    
                    if (currentIconType === 'backpacker') {
                        currentIcon.style.transform = travelingLeft ? 'scaleX(1)' : 'scaleX(-1)';
                    } else {
                        currentIcon.style.transform = travelingLeft ? 'scaleX(-1)' : 'scaleX(1)';
                    }
                    currentIcon.style.transformOrigin = 'center center';
                }
            }
            
            // Fade out icon as we approach destination (last 5%) - only if icon exists
            if (currentIcon && progress >= 0.95) {
                const fadeProgress = (progress - 0.95) / 0.05;  // 0 to 1 over last 5%
                currentIcon.style.opacity = String(1 - fadeProgress);
            }
            
            // Show end marker when complete
            if (progress >= 0.98) {
                showEndMarker();
            }
            
            if (progress < 1) {
                requestAnimationFrame(drawFrame);
            } else {
                // Show destination label with animation after arrival
                showEndMarker();
                setTimeout(() => {
                    if (window.endLabel) {
                        window.endLabel.setOpacity(1);
                    }
                    setTimeout(() => animationResolve(), 1000);
                }, 500);
            }
        }
        
        requestAnimationFrame(drawFrame);
    });
}

// Utility function
function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Export
if (typeof window !== 'undefined') {
    window.animateRoute = animateRoute;
}
