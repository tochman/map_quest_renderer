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
    
    // ========================================
    // STAGE 1: Show title card with date
    // ========================================
    const titleCard = document.getElementById('title-card');
    titleCard.innerHTML = `<div class="title-text">${title}</div><div class="date-text">${date}</div>`;
    titleCard.style.opacity = '1';
    
    await wait(2500);
    
    // Fade out title card
    titleCard.style.opacity = '0';
    await wait(1000);
    
    // Show title stamp in corner
    const dateStamp = document.getElementById('date-stamp');
    dateStamp.textContent = title.toUpperCase();
    dateStamp.style.opacity = '1';
    
    // ========================================
    // STAGE 2: Pan and zoom to starting point
    // ========================================
    const startCoord = allCoordinates[0];
    const endCoord = allCoordinates[allCoordinates.length - 1];
    
    // First show overview of entire route
    const routeBounds = L.latLngBounds(allCoordinates);
    map.fitBounds(routeBounds, { padding: [50, 50], animate: false });
    
    // Add start marker and label IMMEDIATELY (visible during pan)
    const startMarker = L.circleMarker(allCoordinates[0], {
        radius: 10,
        fillColor: '#8B0000',
        color: '#3d2817',
        weight: 3,
        fillOpacity: 0.9
    }).addTo(map);
    
    const startLabel = L.marker(allCoordinates[0], {
        icon: L.divIcon({
            className: 'location-label',
            html: routeSegments[0].fromLabel,
            iconSize: [160, 30],
            iconAnchor: [80, -20]
        })
    }).addTo(map);
    
    await wait(1000);
    
    // Calculate zoom levels using shared utility
    const maxZoom = 15; // Watercolor tile limit
    const segmentZoomLevels = window.ZoomUtils.calculateSegmentZoomLevels(map, routeSegments, allCoordinates, {
        maxZoom,
        defaultCloseZoom: 14
    });
    
    const startZoom = startZoomLevel || segmentZoomLevels[0] || 14;
    
    // Cinematic flyTo from overview (zoom 11) to start position
    map.flyTo(startCoord, startZoom, { 
        duration: 3,
        easeLinearity: 0.1
    });
    
    await wait(3500);
    
    // Add end marker (hidden)
    const endMarker = L.circleMarker(allCoordinates[allCoordinates.length - 1], {
        radius: 10,
        fillColor: '#006400',
        color: '#3d2817',
        weight: 3,
        fillOpacity: 0
    }).addTo(map);
    
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
    // STAGE 3: Animate route WITH simultaneous zoom
    // ========================================
    const endZoom = segmentZoomLevels[segmentZoomLevels.length - 1] || defaultCloseZoom;

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
    
    // Calculate segment durations based on their lengths
    const segmentProgressThresholds = window.ZoomUtils.calculateSegmentProgressThresholds(routeSegments);
    
    // Create zoom keyframes for smooth interpolation between segments
    const zoomKeyframes = window.ZoomUtils.createZoomKeyframes(segmentZoomLevels, segmentProgressThresholds);
    
    // Wrap animation in a Promise
    await new Promise((animationResolve) => {
        function drawFrame(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / animationDuration, 1);
            
            // Use shared utility to determine segment info
            const segInfo = window.ZoomUtils.getSegmentInfo(progress, segmentProgressThresholds);
            const { currentSegment, segmentProgress } = segInfo;
            
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
            }
            
            // Handle icon visibility and fading
            const currentIconType = routeSegments[currentSegment].icon;
            let currentIcon;
            
            // Hide all icons first
            motorcycle.style.opacity = '0';
            person.style.opacity = '0';
            car.style.opacity = '0';
            backpacker.style.opacity = '0';
            
            // Show current icon
            if (currentIconType === 'bike') {
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
            
            // === DYNAMIC ZOOM from JSON config (using shared utility) ===
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
            const zoomOutFactor = Math.max(0, (16 - targetZoom) / 6);
            const lookAheadBlend = 0.25 * zoomOutFactor;
            const targetLat = vehiclePos[0] + (lookAheadPos[0] - vehiclePos[0]) * lookAheadBlend;
            const targetLng = vehiclePos[1] + (lookAheadPos[1] - vehiclePos[1]) * lookAheadBlend;
            
            // Smooth camera POSITION tracking
            const positionSmoothing = 0.08;
            cameraLat += (targetLat - cameraLat) * positionSmoothing;
            cameraLng += (targetLng - cameraLng) * positionSmoothing;
            
            // VERY slow ZOOM tracking for cinematic effect
            const zoomSmoothing = 0.008;
            cameraZoom += (targetZoom - cameraZoom) * zoomSmoothing;
            
            // Set camera
            map.setView([cameraLat, cameraLng], cameraZoom, { 
                animate: true,
                duration: 0.5
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
                    dashArray: '10, 8'
                }).addTo(map);
            }
            
            // Update icon position with smooth rotation
            if (visibleCoords.length > 0) {
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
                
                // Look FAR ahead on the route for stable direction
                const lookAhead = Math.min(coordinates.length - 1, safeIndex + 60);
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
                    
                    // Smooth interpolation
                    let angleDiff = tilt - lastAngle;
                    while (angleDiff > 180) angleDiff -= 360;
                    while (angleDiff < -180) angleDiff += 360;
                    if (Math.abs(angleDiff) > 2) {
                        lastAngle = lastAngle + angleDiff * 0.1;
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
                    
                    // Smooth interpolation
                    let angleDiff = tilt - lastAngle;
                    while (angleDiff > 180) angleDiff -= 360;
                    while (angleDiff < -180) angleDiff += 360;
                    if (Math.abs(angleDiff) > 2) {
                        lastAngle = lastAngle + angleDiff * 0.1;
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
            
            // Show end marker when complete
            if (progress >= 0.98) {
                endMarker.setStyle({ fillOpacity: 0.9 });
            }
            
            if (progress < 1) {
                requestAnimationFrame(drawFrame);
            } else {
                // Show destination label with animation after arrival
                endMarker.setStyle({ fillOpacity: 0.9 });
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
