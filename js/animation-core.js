/**
 * Shared Animation Core
 * Used by both preview (animate-route.js) and frame export (animate-frames.js)
 * 
 * This module contains ALL animation logic - zoom, position, icons, labels, pauses, etc.
 * The only difference between preview and frames is HOW they call this (time-based vs frame-based)
 */

(function() {
    'use strict';
    
    /**
     * Calculate total hiking distance from route segments
     * Uses Haversine formula for accurate distance calculation
     */
    function calculateTotalHikingDistance(routeSegments) {
        let totalDistance = 0;
        let hikeCount = 0;
        
        routeSegments.forEach((segment, index) => {
            // Only count hiking segments
            if (segment.travelMode === 'hike') {
                hikeCount++;
                const coords = segment.coordinates;
                let segmentDistance = 0;
                
                for (let i = 0; i < coords.length - 1; i++) {
                    const [lat1, lon1] = coords[i];
                    const [lat2, lon2] = coords[i + 1];
                    
                    // Haversine formula
                    const R = 6371; // Earth radius in km
                    const dLat = (lat2 - lat1) * Math.PI / 180;
                    const dLon = (lon2 - lon1) * Math.PI / 180;
                    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                            Math.sin(dLon/2) * Math.sin(dLon/2);
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                    segmentDistance += R * c;
                }
                
                console.log(`Hike segment ${index}: ${segmentDistance.toFixed(2)} km`);
                totalDistance += segmentDistance;
            }
        });
        
        console.log(`Total hiking distance across ${hikeCount} segments: ${totalDistance.toFixed(2)} km`);
        return totalDistance;
    }
    
    /**
     * Initialize animation state
     */
    function createAnimationState() {
        return {
            // Icon rotation tracking
            lastAngles: { bike: 0, car: 0, person: 0, backpacker: 0 },
            
            // Smooth camera tracking
            cameraLat: null,
            cameraLng: null,
            cameraZoom: null,
            
            // Map elements
            animatedLine: null,
            startMarker: null,
            startLabel: null,
            endMarker: null,
            endLabel: null,
            waypointMarkers: [],
            waypointLabels: [],
            waypointShown: [],
            waypointFadedOut: [],
            
            // Phase tracking
            titleCardShown: false,
            dateStampShown: false,
            startMarkerPlaced: false,
            endMarkerPlaced: false,
            iconsSetup: false,
            
            // Pause tracking
            lastPausedAfterSegment: -1,
            isPaused: false,
            pauseProgress: 0,  // 0 to 1 within current pause
            currentPauseDuration: 0
        };
    }
    
    /**
     * Calculate animation config from route data
     */
    function createAnimationConfig(map, routeSegments, options) {
        const allCoordinates = routeSegments.flatMap(seg => seg.coordinates);
        const bounds = L.latLngBounds(allCoordinates);
        
        // Calculate segment progress thresholds
        const segmentProgressThresholds = window.ZoomUtils.calculateSegmentProgressThresholds(routeSegments);
        
        // Calculate segment zoom levels
        const segmentZoomLevels = window.ZoomUtils.calculateSegmentZoomLevels(map, routeSegments, allCoordinates, {
            maxZoom: 15,
            defaultCloseZoom: 13
        });
        
        // Create zoom keyframes
        const zoomKeyframes = window.ZoomUtils.createZoomKeyframes(segmentZoomLevels, segmentProgressThresholds);
        
        // Starting zoom level
        const closeZoom = options.startZoomLevel || segmentZoomLevels[0] || 13;
        
        // Overview zoom
        const overviewZoom = map.getBoundsZoom(bounds, false, [50, 50]);
        const overviewCenter = bounds.getCenter();
        
        // Pause durations per segment (in seconds)
        const segmentPauses = routeSegments.map(seg => seg.pause !== undefined ? seg.pause : 0.5);
        
        return {
            allCoordinates,
            bounds,
            segmentProgressThresholds,
            segmentZoomLevels,
            zoomKeyframes,
            closeZoom,
            overviewZoom,
            overviewCenter,
            segmentPauses,
            lineColor: options.lineColor || '#8B4513',
            lineWidth: options.lineWidth || 4,
            title: options.title || 'ADVENTURE',
            date: options.date || '',
            finalDestination: options.finalDestination || 'DESTINATION',
            startLabel: routeSegments[0]?.fromLabel || 'START'
        };
    }
    
    /**
     * Render animation at a given progress (0-1 for each phase)
     * 
     * @param {Object} params
     * @param {string} params.phase - 'title', 'pan', 'route', or 'end'
     * @param {number} params.phaseProgress - Progress within current phase (0-1)
     * @param {Object} params.state - Animation state object
     * @param {Object} params.config - Animation config
     * @param {Object} params.map - Leaflet map instance
     * @param {Array} params.routeSegments - Route segment data
     * @param {Object} params.elements - DOM elements { titleCard, dateStamp, destinationCard, motorcycle, person, car, backpacker }
     * @param {Object} params.smoothing - Smoothing values { position, zoom } (different for preview vs frames)
     * 
     * @returns {Object} { shouldPause, pauseDuration } - if animation should pause
     */
    function renderFrame(params) {
        const { phase, phaseProgress, state, config, map, routeSegments, elements, smoothing } = params;
        const { titleCard, dateStamp, destinationCard, motorcycle, person, car, backpacker } = elements;
        
        // === PHASE: TITLE ===
        if (phase === 'title') {
            // Fade in/out title card
            if (phaseProgress < 0.15) {
                titleCard.style.opacity = String(phaseProgress / 0.15);
            } else if (phaseProgress > 0.85) {
                titleCard.style.opacity = String((1 - phaseProgress) / 0.15);
            } else {
                titleCard.style.opacity = '1';
            }
            titleCard.innerHTML = `<div class="title-text">${config.title}</div><div class="date-text">${config.date}</div>`;
            
            // Show overview (only on first call)
            if (phaseProgress === 0 || !state.titleCardShown) {
                map.fitBounds(config.bounds, { padding: [50, 50], animate: false });
                state.titleCardShown = true;
            }
            
            return { shouldPause: false };
        }
        
        // Hide title card after title phase
        titleCard.style.opacity = '0';
        
        // Show corner title stamp
        if (!state.dateStampShown) {
            dateStamp.textContent = config.title.toUpperCase();
            dateStamp.style.opacity = '1';
            state.dateStampShown = true;
        }
        
        // === PHASE: PAN ===
        if (phase === 'pan') {
            // Place start marker if not done
            if (!state.startMarkerPlaced) {
                state.startMarker = L.circleMarker(config.allCoordinates[0], {
                    radius: 10,
                    fillColor: '#8B0000',
                    color: '#3d2817',
                    weight: 3,
                    fillOpacity: 0.9
                }).addTo(map);
                
                state.startLabel = L.marker(config.allCoordinates[0], {
                    icon: L.divIcon({
                        className: 'location-label',
                        html: config.startLabel,
                        iconSize: [160, 30],
                        iconAnchor: [80, -20]
                    })
                }).addTo(map);
                
                state.startMarkerPlaced = true;
                
                // Initialize camera at overview
                state.cameraLat = config.overviewCenter.lat;
                state.cameraLng = config.overviewCenter.lng;
                state.cameraZoom = config.overviewZoom;
            }
            
            // Target: start point at close zoom
            const startCoord = config.allCoordinates[0];
            
            // Smooth ease-out cubic for cinematic feel
            const easeProgress = 1 - Math.pow(1 - phaseProgress, 3);
            
            // Calculate target positions
            const targetLat = config.overviewCenter.lat + (startCoord[0] - config.overviewCenter.lat) * easeProgress;
            const targetLng = config.overviewCenter.lng + (startCoord[1] - config.overviewCenter.lng) * easeProgress;
            const targetZoom = config.overviewZoom + (config.closeZoom - config.overviewZoom) * easeProgress;
            
            // Smooth camera interpolation
            state.cameraLat += (targetLat - state.cameraLat) * smoothing.position;
            state.cameraLng += (targetLng - state.cameraLng) * smoothing.position;
            state.cameraZoom += (targetZoom - state.cameraZoom) * smoothing.zoom;
            
            // Use animate option (true for preview, false for frame export)
            const animateOption = smoothing.animate !== false;
            map.setView([state.cameraLat, state.cameraLng], state.cameraZoom, { 
                animate: animateOption,
                duration: animateOption ? 0.3 : 0
            });
            
            return { shouldPause: false };
        }
        
        // === SETUP FOR ROUTE (once) ===
        if (!state.endMarkerPlaced) {
            // Add end marker (hidden)
            state.endMarker = L.circleMarker(config.allCoordinates[config.allCoordinates.length - 1], {
                radius: 10,
                fillColor: '#006400',
                color: '#3d2817',
                weight: 3,
                fillOpacity: 0
            }).addTo(map);
            
            state.endLabel = L.marker(config.allCoordinates[config.allCoordinates.length - 1], {
                icon: L.divIcon({
                    className: 'location-label',
                    html: config.finalDestination,
                    iconSize: [260, 30],
                    iconAnchor: [130, -20]
                }),
                opacity: 0
            }).addTo(map);
            
            // Pre-create waypoint markers (hidden)
            for (let i = 0; i < routeSegments.length - 1; i++) {
                if (routeSegments[i].toLabel) {
                    const endCoord = routeSegments[i].coordinates[routeSegments[i].coordinates.length - 1];
                    
                    const marker = L.circleMarker(endCoord, {
                        radius: 10,
                        fillColor: '#FF8C00',
                        color: '#3d2817',
                        weight: 3,
                        fillOpacity: 0
                    }).addTo(map);
                    
                    const label = L.marker(endCoord, {
                        icon: L.divIcon({
                            className: 'location-label',
                            html: routeSegments[i].toLabel,
                            iconSize: [200, 30],
                            iconAnchor: [100, -20]
                        }),
                        opacity: 0
                    }).addTo(map);
                    
                    state.waypointMarkers.push(marker);
                    state.waypointLabels.push(label);
                    state.waypointShown.push(false);
                    state.waypointFadedOut.push(false);
                }
            }
            
            state.endMarkerPlaced = true;
        }
        
        // Setup icons (once)
        if (!state.iconsSetup) {
            motorcycle.style.display = 'block';
            person.style.display = 'block';
            car.style.display = 'block';
            backpacker.style.display = 'block';
            state.iconsSetup = true;
        }
        
        // === PHASE: ROUTE ===
        if (phase === 'route') {
            const routeProgress = phaseProgress;
            
            // Get segment info
            const segInfo = window.ZoomUtils.getSegmentInfo(routeProgress, config.segmentProgressThresholds);
            const { currentSegment, segmentProgress } = segInfo;
            
            // Check if we need to pause at segment boundary
            if (currentSegment > 0 && state.lastPausedAfterSegment < currentSegment - 1) {
                state.lastPausedAfterSegment = currentSegment - 1;
                const pauseDuration = config.segmentPauses[currentSegment - 1] || 0.5;
                return { 
                    shouldPause: true, 
                    pauseDuration: pauseDuration,
                    pauseAtSegment: currentSegment - 1
                };
            }
            
            // Fade in waypoint labels when approaching
            for (let i = 0; i < state.waypointMarkers.length; i++) {
                if (!state.waypointShown[i]) {
                    const showThreshold = i === 0 
                        ? config.segmentProgressThresholds[0] * 0.33 
                        : config.segmentProgressThresholds[i] - (config.segmentProgressThresholds[i] - (config.segmentProgressThresholds[i-1] || 0)) * 0.67;
                    
                    if (routeProgress >= showThreshold) {
                        state.waypointMarkers[i].setStyle({ fillOpacity: 0.9 });
                        state.waypointLabels[i].setOpacity(1);
                        state.waypointShown[i] = true;
                    }
                }
                
                // Fade out after visiting (20% into next segment)
                if (state.waypointShown[i] && !state.waypointFadedOut[i] && currentSegment > i && segmentProgress > 0.2) {
                    state.waypointMarkers[i].setStyle({ fillOpacity: 0 });
                    state.waypointLabels[i].setOpacity(0);
                    state.waypointFadedOut[i] = true;
                }
            }
            
            // Icon handling
            const currentIconType = routeSegments[currentSegment].icon;
            const nextSegment = currentSegment + 1;
            const nextIconType = nextSegment < routeSegments.length ? routeSegments[nextSegment].icon : null;
            const iconWillChange = nextIconType && nextIconType !== currentIconType;
            
            // Fade out icon early if approaching a stop where icon will change
            const fadeOutThreshold = 0.95;
            const shouldFadeOutEarly = iconWillChange && segmentProgress > fadeOutThreshold;
            
            let currentIcon = null;
            
            // Hide all icons
            motorcycle.style.opacity = '0';
            person.style.opacity = '0';
            car.style.opacity = '0';
            backpacker.style.opacity = '0';
            
            // Show current icon (unless fading out or 'none')
            if (currentIconType !== 'none' && !shouldFadeOutEarly) {
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
            }
            
            const coordinates = routeSegments[currentSegment].coordinates;
            
            // Zoom interpolation
            const targetZoom = window.ZoomUtils.getInterpolatedZoom(routeProgress, config.zoomKeyframes);
            
            // Calculate position within segment
            const totalPoints = coordinates.length - 1;
            const currentFloat = segmentProgress * totalPoints;
            const currentIndex = Math.floor(currentFloat);
            const fraction = currentFloat - currentIndex;
            
            const safeIndex = Math.max(0, Math.min(currentIndex, coordinates.length - 1));
            const safeNextIndex = Math.min(safeIndex + 1, coordinates.length - 1);
            
            // Vehicle position with interpolation
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
            
            // Camera look-ahead
            const lookAheadDistance = Math.min(30, coordinates.length - safeIndex - 1);
            const lookAheadIndex = Math.min(safeIndex + lookAheadDistance, coordinates.length - 1);
            const lookAheadPos = coordinates[lookAheadIndex];
            
            const zoomOutFactor = Math.max(0, (14 - targetZoom) / 4);
            const lookAheadBlend = 0.1 * zoomOutFactor;
            const targetLat = vehiclePos[0] + (lookAheadPos[0] - vehiclePos[0]) * lookAheadBlend;
            const targetLng = vehiclePos[1] + (lookAheadPos[1] - vehiclePos[1]) * lookAheadBlend;
            
            // Initialize camera if needed
            if (state.cameraLat === null) {
                state.cameraLat = targetLat;
                state.cameraLng = targetLng;
                state.cameraZoom = targetZoom;
            }
            
            // Smooth camera tracking
            state.cameraLat += (targetLat - state.cameraLat) * smoothing.position;
            state.cameraLng += (targetLng - state.cameraLng) * smoothing.position;
            state.cameraZoom += (targetZoom - state.cameraZoom) * smoothing.zoom;
            
            // Use animate option (true for preview, false for frame export)
            const animateOption = smoothing.animate !== false;
            map.setView([state.cameraLat, state.cameraLng], state.cameraZoom, { 
                animate: animateOption,
                duration: animateOption ? 0.3 : 0
            });
            
            // Build visible line coordinates
            const visibleCoords = coordinates.slice(0, safeIndex + 1);
            if (safeIndex < coordinates.length - 1 && fraction > 0) {
                visibleCoords.push([
                    coordinates[safeIndex][0] + (coordinates[safeNextIndex][0] - coordinates[safeIndex][0]) * fraction,
                    coordinates[safeIndex][1] + (coordinates[safeNextIndex][1] - coordinates[safeIndex][1]) * fraction
                ]);
            }
            
            // Remove old line
            if (state.animatedLine) {
                map.removeLayer(state.animatedLine);
            }
            
            // Build complete line including previous segments
            let allVisibleCoords = [];
            for (let i = 0; i < currentSegment; i++) {
                allVisibleCoords.push(...routeSegments[i].coordinates);
            }
            allVisibleCoords.push(...visibleCoords);
            
            // Draw line
            if (allVisibleCoords.length > 1) {
                state.animatedLine = L.polyline(allVisibleCoords, {
                    color: config.lineColor,
                    weight: config.lineWidth,
                    opacity: 0.9,
                    smoothFactor: 1,
                    dashArray: '10, 8',
                    className: 'route-line'
                }).addTo(map);
            }
            
            // Position and rotate icon
            if (visibleCoords.length > 0 && currentIcon) {
                const currentPos = visibleCoords[visibleCoords.length - 1];
                const point = map.latLngToContainerPoint(currentPos);
                
                // Icon size
                let iconSize = 40;
                if (currentIconType === 'bike' || currentIconType === 'car') iconSize = 60;
                else if (currentIconType === 'backpacker') iconSize = 35;
                
                const iconOffset = iconSize / 2;
                currentIcon.style.left = (point.x - iconOffset) + 'px';
                currentIcon.style.top = (point.y - iconOffset) + 'px';
                
                // Direction calculation - look far ahead for stability
                const lookAhead = Math.min(coordinates.length - 1, safeIndex + 300);
                const fromPos = coordinates[safeIndex];
                const toPos = coordinates[lookAhead];
                
                const fromPoint = map.latLngToContainerPoint(fromPos);
                const toPoint = map.latLngToContainerPoint(toPos);
                
                const dx = toPoint.x - fromPoint.x;
                const dy = toPoint.y - fromPoint.y;
                
                if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                    const direction = Math.atan2(dy, dx) * 180 / Math.PI;
                    
                    if (currentIconType === 'car') {
                        const goingLeft = Math.abs(direction) > 90;
                        const scaleX = goingLeft ? -1 : 1;
                        let tilt = goingLeft 
                            ? (direction > 0 ? -(direction - 180) : -(direction + 180))
                            : direction;
                        
                        // Smooth rotation
                        let angleDiff = tilt - state.lastAngles.car;
                        while (angleDiff > 180) angleDiff -= 360;
                        while (angleDiff < -180) angleDiff += 360;
                        if (Math.abs(angleDiff) > 5) {
                            state.lastAngles.car += angleDiff * 0.03;
                        }
                        
                        currentIcon.style.transform = `scaleX(${scaleX}) rotate(${state.lastAngles.car}deg)`;
                        
                    } else if (currentIconType === 'bike') {
                        const goingRight = Math.abs(direction) <= 90;
                        const scaleX = goingRight ? -1 : 1;
                        let tilt = goingRight 
                            ? -direction 
                            : (direction > 0 ? direction - 180 : direction + 180);
                        
                        let angleDiff = tilt - state.lastAngles.bike;
                        while (angleDiff > 180) angleDiff -= 360;
                        while (angleDiff < -180) angleDiff += 360;
                        if (Math.abs(angleDiff) > 5) {
                            state.lastAngles.bike += angleDiff * 0.03;
                        }
                        
                        currentIcon.style.transform = `scaleX(${scaleX}) rotate(${state.lastAngles.bike}deg)`;
                        
                    } else {
                        // Person and backpacker - just flip horizontally
                        const travelingLeft = dx < 0;
                        if (currentIconType === 'backpacker') {
                            currentIcon.style.transform = travelingLeft ? 'scaleX(1)' : 'scaleX(-1)';
                        } else {
                            currentIcon.style.transform = travelingLeft ? 'scaleX(-1)' : 'scaleX(1)';
                        }
                    }
                    currentIcon.style.transformOrigin = 'center center';
                }
            }
            
            // Show end marker near completion
            if (routeProgress >= 0.98 && state.endMarker) {
                state.endMarker.setStyle({ fillOpacity: 0.9 });
            }
            
            return { shouldPause: false };
        }
        
        // === PHASE: END ===
        if (phase === 'end') {
            // Hide all icons
            motorcycle.style.opacity = '0';
            person.style.opacity = '0';
            car.style.opacity = '0';
            backpacker.style.opacity = '0';
            
            // Show end marker
            if (state.endMarker) {
                state.endMarker.setStyle({ fillOpacity: 0.9 });
            }
            
            // Show end label
            if (state.endLabel && phaseProgress > 0.2) {
                state.endLabel.setOpacity(1);
            }
            
            // Fade in destination card
            if (phaseProgress > 0.3) {
                const fadeProgress = Math.min(1, (phaseProgress - 0.3) / 0.3);
                destinationCard.style.opacity = String(fadeProgress);
                const destText = destinationCard.querySelector('.destination-text');
                if (destText) {
                    // Calculate total hiking distance
                    const totalHikingDistance = calculateTotalHikingDistance(routeSegments);
                    if (totalHikingDistance > 0) {
                        destText.innerHTML = `${config.finalDestination}<br><span style="font-size: 0.6em;">hiking distance: ${totalHikingDistance.toFixed(2)} km</span>`;
                    } else {
                        destText.textContent = config.finalDestination;
                    }
                }
            }
            
            return { shouldPause: false };
        }
        
        return { shouldPause: false };
    }
    
    // Export
    window.AnimationCore = {
        createAnimationState,
        createAnimationConfig,
        renderFrame
    };
    
})();
