/**
 * Shared zoom utilities for map animation
 * Used by both preview (animate.js) and frame export (animate-frames.js)
 */

/**
 * Calculate zoom levels for each route segment
 * @param {Object} map - Leaflet map instance
 * @param {Array} routeSegments - Array of route segments with coordinates and optional zoomLevel
 * @param {Object} options - Configuration options
 * @param {number} options.maxZoom - Maximum allowed zoom level (default: 15)
 * @param {number} options.defaultCloseZoom - Default close zoom when not specified (default: 14)
 * @param {Array} options.padding - Padding for bounds calculation (default: [100, 100])
 * @returns {Array} Array of zoom levels for each segment
 */
function calculateSegmentZoomLevels(map, routeSegments, allCoordinates, options = {}) {
    const maxZoom = options.maxZoom || 15;
    const defaultCloseZoom = Math.min(options.defaultCloseZoom || 14, maxZoom);
    const padding = options.padding || [100, 100];
    
    const bounds = L.latLngBounds(allCoordinates);
    const overviewZoom = map.getBoundsZoom(bounds, false, [80, 80]);
    
    return routeSegments.map((seg, idx) => {
        let zoom;
        if (seg.zoomLevel !== null && seg.zoomLevel !== undefined) {
            // Use explicitly set zoom level from config
            zoom = seg.zoomLevel;
        } else {
            // Auto-calculate based on segment bounds
            const segBounds = L.latLngBounds(seg.coordinates);
            const autoZoom = map.getBoundsZoom(segBounds, false, padding);
            zoom = Math.max(autoZoom, overviewZoom, defaultCloseZoom);
        }
        return Math.min(zoom, maxZoom);
    });
}

/**
 * Create zoom keyframes for smooth interpolation between segments
 * @param {Array} segmentZoomLevels - Array of zoom levels per segment
 * @param {Array} segmentProgressThresholds - Array of progress thresholds (0-1) for each segment end
 * @returns {Array} Array of keyframe objects { progress, zoom }
 */
function createZoomKeyframes(segmentZoomLevels, segmentProgressThresholds) {
    const keyframes = [];
    
    // Start keyframe
    keyframes.push({ progress: 0, zoom: segmentZoomLevels[0] });
    
    // Add keyframe at each segment boundary
    for (let i = 0; i < segmentProgressThresholds.length; i++) {
        keyframes.push({ 
            progress: segmentProgressThresholds[i], 
            zoom: segmentZoomLevels[i]
        });
    }
    
    return keyframes;
}

/**
 * Calculate the target zoom level at a given progress point using smooth interpolation
 * @param {number} progress - Current animation progress (0-1)
 * @param {Array} zoomKeyframes - Array of keyframe objects { progress, zoom }
 * @returns {number} Interpolated zoom level
 */
function getInterpolatedZoom(progress, zoomKeyframes) {
    // Find surrounding keyframes
    let prevKeyframe = zoomKeyframes[0];
    let nextKeyframe = zoomKeyframes[zoomKeyframes.length - 1];
    
    for (let i = 0; i < zoomKeyframes.length - 1; i++) {
        if (progress >= zoomKeyframes[i].progress && progress <= zoomKeyframes[i + 1].progress) {
            prevKeyframe = zoomKeyframes[i];
            nextKeyframe = zoomKeyframes[i + 1];
            break;
        }
    }
    
    // Smooth interpolation between keyframes using smoothstep
    const keyframeRange = nextKeyframe.progress - prevKeyframe.progress;
    const keyframeT = keyframeRange > 0 ? (progress - prevKeyframe.progress) / keyframeRange : 0;
    const smoothT = keyframeT * keyframeT * (3 - 2 * keyframeT); // smoothstep
    
    return prevKeyframe.zoom + (nextKeyframe.zoom - prevKeyframe.zoom) * smoothT;
}

/**
 * Calculate segment progress thresholds based on coordinate counts
 * @param {Array} routeSegments - Array of route segments
 * @returns {Array} Array of cumulative progress thresholds (0-1)
 */
function calculateSegmentProgressThresholds(routeSegments) {
    const segmentLengths = routeSegments.map(seg => seg.coordinates.length);
    const totalLength = segmentLengths.reduce((a, b) => a + b, 0);
    
    const thresholds = [];
    let cumulativeProgress = 0;
    
    for (let i = 0; i < segmentLengths.length; i++) {
        cumulativeProgress += segmentLengths[i] / totalLength;
        thresholds.push(cumulativeProgress);
    }
    
    return thresholds;
}

/**
 * Determine which segment we're in based on overall progress
 * @param {number} progress - Current animation progress (0-1)
 * @param {Array} segmentProgressThresholds - Array of progress thresholds
 * @returns {Object} { currentSegment, segmentStartProgress, segmentProgress }
 */
function getSegmentInfo(progress, segmentProgressThresholds) {
    let currentSegment = segmentProgressThresholds.length - 1;
    let segmentStartProgress = 0;
    
    for (let i = 0; i < segmentProgressThresholds.length; i++) {
        if (progress < segmentProgressThresholds[i]) {
            currentSegment = i;
            break;
        }
        segmentStartProgress = segmentProgressThresholds[i];
    }
    
    // Calculate progress within current segment
    const segmentEndProgress = segmentProgressThresholds[currentSegment] || 1;
    const segmentDuration = segmentEndProgress - segmentStartProgress;
    const segmentProgress = segmentDuration > 0 
        ? Math.min((progress - segmentStartProgress) / segmentDuration, 1) 
        : 1;
    
    return { currentSegment, segmentStartProgress, segmentProgress };
}

// Export for browser usage (will be evaluated via eval() in puppeteer)
if (typeof window !== 'undefined') {
    window.ZoomUtils = {
        calculateSegmentZoomLevels,
        createZoomKeyframes,
        getInterpolatedZoom,
        calculateSegmentProgressThresholds,
        getSegmentInfo
    };
}

// Export for Node.js module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        calculateSegmentZoomLevels,
        createZoomKeyframes,
        getInterpolatedZoom,
        calculateSegmentProgressThresholds,
        getSegmentInfo
    };
}
