/**
 * Icon Renderer Module
 * 
 * Handles rendering logic for all vehicle/character icons in the map animation.
 * 
 * VERIFIED ICON ORIENTATIONS (from test-icons.html):
 * - car.png at rotate(0deg): faces LEFT
 * - bike.png at rotate(0deg): faces LEFT
 * - person.png at rotate(0deg): stands UPRIGHT
 * - backpack.png at rotate(0deg): stands UPRIGHT
 * 
 * IMPORTANT: Person and backpack should NEVER rotate - they stay upright
 * and only flip horizontally based on travel direction.
 */

const ICON_CONFIG = {
    bike: {
        defaultFacing: 'left',  // At CSS rotate(0), icon faces left
        rotates: true,
        size: 60
    },
    car: {
        defaultFacing: 'left',  // At CSS rotate(0), icon faces left
        rotates: true,
        size: 60
    },
    person: {
        defaultFacing: 'right',
        rotates: false,  // NEVER rotate - stay upright
        size: 40
    },
    backpacker: {
        defaultFacing: 'right',
        rotates: false,  // NEVER rotate - stay upright
        size: 35
    }
};

/**
 * Calculate the transform for an icon based on direction of travel.
 * 
 * For ROTATING icons (car, bike):
 *   - Rotate to point in direction of travel
 *   - Left-facing icons: CSS = 180 - directionAngle
 * 
 * For NON-ROTATING icons (person, backpacker):
 *   - Stay upright (no rotation)
 *   - Flip horizontally (scaleX) based on travel direction
 */
function calculateIconTransform(iconType, dx, dy, lastAngle, interpolationFactor = 0.15) {
    const config = ICON_CONFIG[iconType] || ICON_CONFIG.person;
    
    // Direction of travel in degrees using atan2
    // atan2(dy, dx): 0° = east, 90° = south, ±180° = west, -90° = north
    const directionAngle = Math.atan2(dy, dx) * 180 / Math.PI;
    
    let targetAngle = 0;
    let scaleX = 1;
    
    if (config.rotates) {
        // ROTATING ICONS (bike, car)
        // These icons rotate to follow the direction of travel
        
        // Car and bike face LEFT at rotate(0deg)
        // To make them point in travel direction:
        // - Travel EAST (0°): need rotate(180deg) to flip them to face right
        // - Travel SOUTH (90°): need rotate(90deg) 
        // - Travel WEST (180°): need rotate(0deg) - already facing left
        // - Travel NORTH (-90°): need rotate(-90deg)
        // Formula: CSS_rotation = 180 - directionAngle
        targetAngle = 180 - directionAngle;
        
        // Normalize to -180 to 180 range
        while (targetAngle > 180) targetAngle -= 360;
        while (targetAngle < -180) targetAngle += 360;
        
        // Smooth interpolation for rotation
        let angleDiff = targetAngle - lastAngle;
        // Handle wrap-around
        while (angleDiff > 180) angleDiff -= 360;
        while (angleDiff < -180) angleDiff += 360;
        
        if (Math.abs(angleDiff) > 1) {
            targetAngle = lastAngle + angleDiff * interpolationFactor;
        } else {
            targetAngle = lastAngle; // Keep last angle if change is tiny
        }
        
    } else {
        // NON-ROTATING ICONS (person, backpacker)
        // These ALWAYS stay upright - never rotate
        // Only flip horizontally based on travel direction
        
        targetAngle = 0;  // Always upright
        
        // Flip based on horizontal movement direction
        const travelingLeft = dx < 0;
        
        if (config.defaultFacing === 'right') {
            // Icon faces right by default
            // Mirror (scaleX = -1) when traveling left
            scaleX = travelingLeft ? -1 : 1;
        } else {
            // Icon faces left by default
            // Mirror when traveling right
            scaleX = travelingLeft ? 1 : -1;
        }
    }
    
    return { 
        angle: targetAngle, 
        scaleX: scaleX, 
        newLastAngle: targetAngle 
    };
}

/**
 * Get the CSS transform string for an icon
 */
function getIconTransformCSS(angle, scaleX) {
    // For non-rotating icons (scaleX may be -1), just return scaleX
    // For rotating icons (scaleX = 1), just return rotation
    if (scaleX !== 1) {
        return "scaleX(" + scaleX + ")";
    }
    return "rotate(" + angle + "deg)";
}

/**
 * Get the configuration for an icon type
 */
function getIconConfig(iconType) {
    return ICON_CONFIG[iconType] || ICON_CONFIG.person;
}

// Export for use in browser and Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { calculateIconTransform, getIconTransformCSS, getIconConfig, ICON_CONFIG };
}
if (typeof window !== 'undefined') {
    window.IconRenderer = { calculateIconTransform, getIconTransformCSS, getIconConfig, ICON_CONFIG };
}
