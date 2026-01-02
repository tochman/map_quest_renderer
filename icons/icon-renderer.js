/**
 * Icon Renderer Module
 * 
 * Handles rendering logic for all vehicle/character icons in the map animation.
 * 
 * VERIFIED ICON ORIENTATIONS at rotate(0deg):
 * - car.png: faces LEFT ← (hood on left) - but we treat as RIGHT with scaleX flip
 * - bike.png: faces LEFT ← (handlebars on left)
 * - person.png: stands UPRIGHT, faces RIGHT →
 * - backpack.png: stands UPRIGHT, faces LEFT ←
 * 
 * IMPORTANT: Person and backpack should NEVER rotate - they stay upright
 * and only flip horizontally based on travel direction.
 */

const ICON_CONFIG = {
    bike: {
        defaultFacing: 'left',
        rotates: true,
        size: 60
    },
    car: {
        defaultFacing: 'left',  // Actually faces left, but we flip it
        rotates: true,
        size: 60
    },
    person: {
        defaultFacing: 'right',
        rotates: false,
        size: 40
    },
    backpacker: {
        defaultFacing: 'left',
        rotates: false,
        size: 35
    }
};

/**
 * Calculate the transform for an icon based on direction of travel.
 * 
 * @param {string} iconType - 'car', 'bike', 'person', or 'backpacker'
 * @param {number} dx - horizontal movement (positive = right)
 * @param {number} dy - vertical movement (positive = down)
 * @param {number} lastAngle - previous angle for smooth interpolation
 * @param {number} interpolationFactor - smoothing factor (0.1 = slow, 0.3 = fast)
 * @returns {object} { angle, scaleX, newLastAngle }
 */
function calculateIconTransform(iconType, dx, dy, lastAngle, interpolationFactor = 0.1) {
    // atan2 gives: 0°=right, 90°=down, ±180°=left, -90°=up
    const direction = Math.atan2(dy, dx) * 180 / Math.PI;
    
    let targetAngle = 0;
    let scaleX = 1;
    let newLastAngle = lastAngle;
    
    if (iconType === 'car') {
        // CAR: Side view, we flip with scaleX when going left
        // Icon faces LEFT at 0deg, so flip when going RIGHT direction
        const goingLeft = Math.abs(direction) > 90;
        scaleX = goingLeft ? -1 : 1;
        
        // Calculate tilt angle
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
            newLastAngle = lastAngle + angleDiff * interpolationFactor;
        }
        targetAngle = newLastAngle;
        
    } else if (iconType === 'bike') {
        // BIKE: Side view facing LEFT
        // Flip when going RIGHT
        const goingRight = Math.abs(direction) <= 90;
        scaleX = goingRight ? -1 : 1;
        
        // Calculate tilt angle
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
            newLastAngle = lastAngle + angleDiff * interpolationFactor;
        }
        targetAngle = newLastAngle;
        
    } else {
        // PERSON and BACKPACKER: Stay upright, only flip horizontally
        targetAngle = 0;
        const travelingLeft = dx < 0;
        
        if (iconType === 'backpacker') {
            // Backpacker faces LEFT by default, flip when going RIGHT
            scaleX = travelingLeft ? 1 : -1;
        } else {
            // Person faces RIGHT by default, flip when going LEFT
            scaleX = travelingLeft ? -1 : 1;
        }
        newLastAngle = 0;
    }
    
    return { 
        angle: targetAngle, 
        scaleX: scaleX, 
        newLastAngle: newLastAngle 
    };
}

/**
 * Get the CSS transform string for an icon
 */
function getIconTransformCSS(angle, scaleX) {
    // Always apply scaleX first, then rotation
    return `scaleX(${scaleX}) rotate(${angle}deg)`;
}

/**
 * Get the configuration for an icon type
 */
function getIconConfig(iconType) {
    return ICON_CONFIG[iconType] || ICON_CONFIG.person;
}

/**
 * Get the size for an icon type
 */
function getIconSize(iconType) {
    const config = ICON_CONFIG[iconType] || ICON_CONFIG.person;
    return config.size;
}

// Export for use in browser and Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { calculateIconTransform, getIconTransformCSS, getIconConfig, getIconSize, ICON_CONFIG };
}
if (typeof window !== 'undefined') {
    window.IconRenderer = { calculateIconTransform, getIconTransformCSS, getIconConfig, getIconSize, ICON_CONFIG };
}
