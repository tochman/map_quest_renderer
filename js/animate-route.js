/**
 * Preview Animation Controller
 * Uses shared AnimationCore for all animation logic
 * This is for real-time browser preview
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
    
    // Get DOM elements
    const elements = {
        titleCard: document.getElementById('title-card'),
        dateStamp: document.getElementById('date-stamp'),
        destinationCard: document.getElementById('destination-card'),
        motorcycle: document.getElementById('motorcycle'),
        person: document.getElementById('person'),
        car: document.getElementById('car'),
        backpacker: document.getElementById('backpacker')
    };
    
    // Initialize using shared module
    const state = window.AnimationCore.createAnimationState();
    const config = window.AnimationCore.createAnimationConfig(map, routeSegments, {
        startZoomLevel,
        lineColor,
        lineWidth,
        title,
        date,
        finalDestination
    });
    
    // Smoothing values for real-time preview (with Leaflet's animate helping)
    const smoothing = {
        position: 0.08,
        zoom: 0.04,
        animate: true,  // Enable Leaflet animation for smooth preview
        duration: 1.5
    };
    
    // Phase timing (in ms)
    const TITLE_DURATION = 3000;
    const PAN_DURATION = 4000;
    const ROUTE_DURATION = animationDuration;
    const END_DURATION = 3000;
    
    // Calculate total pause time
    const totalPauseTime = config.segmentPauses.reduce((sum, p) => sum + p * 1000, 0);
    
    const phases = [
        { name: 'title', duration: TITLE_DURATION },
        { name: 'pan', duration: PAN_DURATION },
        { name: 'route', duration: ROUTE_DURATION + totalPauseTime },
        { name: 'end', duration: END_DURATION }
    ];
    
    // Animation state for time tracking
    let startTime = null;
    let pausedTime = 0;
    let isPaused = false;
    let pauseStartTime = 0;
    let currentPauseDuration = 0;
    
    return new Promise((resolve) => {
        function animate(currentTime) {
            if (!startTime) startTime = currentTime;
            
            // Handle pausing
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
            
            // Determine current phase and progress
            let phaseStartTime = 0;
            let currentPhase = null;
            let phaseProgress = 0;
            
            for (const phase of phases) {
                if (elapsed < phaseStartTime + phase.duration) {
                    currentPhase = phase.name;
                    phaseProgress = (elapsed - phaseStartTime) / phase.duration;
                    break;
                }
                phaseStartTime += phase.duration;
            }
            
            // Animation complete
            if (!currentPhase) {
                resolve();
                return;
            }
            
            // Render frame using shared module
            const result = window.AnimationCore.renderFrame({
                phase: currentPhase,
                phaseProgress: Math.min(1, Math.max(0, phaseProgress)),
                state,
                config,
                map,
                routeSegments,
                elements,
                smoothing
            });
            
            // Handle pause request from animation core
            if (result.shouldPause && result.pauseDuration > 0) {
                isPaused = true;
                pauseStartTime = currentTime;
                currentPauseDuration = result.pauseDuration * 1000;
            }
            
            requestAnimationFrame(animate);
        }
        
        requestAnimationFrame(animate);
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
