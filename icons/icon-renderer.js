/**
 * Icon Renderer Module
 * 
 * Handles rendering logic for all vehicle/character icons in the map animation.
 * Each icon type has its own configuration for size, rotation behavior, and mirroring.
 */

// Icon configurations
// - defaultFacing: 'left' or 'right' - which way the icon faces in the source image
// - rotates: whether the icon should rotate to follow the path
// - mirrors: whether the icon should mirror (flip) based on travel direction
// - size: the display size in pixels
const ICON_CONFIG = {
    bike: {
        defaultFacing: 'left',
        rotates: true,
        mirrors: true,
        size: 60
    },
    car: {
        defaultFacing: 'right', 
        rotates: true,
        mirrors: true,
        size: 60
    },
    person: {
        defaultFacing: 'right',
        rotates: false,
        mirrors: true,
        size: 40
    },
    backpacker: {
        defaultFacing: 'right',
        rotates: false,
        mirrors: true,
        size: 35
    }
};

/**
 * Calculate the transform for an icon based on direction of travel
 * 
 * @param {string} iconType - 'bike', 'car', 'person', or 'backpacker'
 * @param {number} dx - Delta X in screen coordinates (positive = moving right/east)
 * @param {number} dy - Delta Y in screen coordinates (positive = moving down)
 * @param {number} lastAngle - Previous rotation angle for smooth interpolation
 * @param {number} interpolationFactor - How fast to interpolate (0-1, higher = faster)
 * @returns {object} - { angle, scaleX, newLastAngle }
 */
function calculateIconTransform(iconType, dx, dy, lastAngle, interpolationFactor = 0.15) {
    const config = ICON_CONFIG[iconType] || ICON_CONFIG.person;
    
    let angle = 0;
    let scaleX = 1;
    let newLastAngle = lastAngle;
    
    // Determine if traveling west (leftward on screen)
    const travelingWest = dx < 0;
    
    if (config.rotates) {
        // For rotating icons (bike, car), we need to:
        // 1. Calculate the direction angle
        // 2. Mirror horizontally when traveling west so vehicle faces direction of travel
        // 3. Adjust rotation based on whether mirrored or not
        
        // Calculate raw angle from movement direction
        const rawAngle = Math.atan2(dy, dx) * 180 / Math.PI;
        
        let targetAngle;
        
        if (travelingWest && config.mirrors) {
            // Traveling west - mirror the icon
            scaleX = -1;
            
            // When mirrored, we need to adjust the angle
            // The icon is flipped, so we compute angle differently
            if (config.defaultFacing === 'left') {
                // Bike: faces left by default, when mirrored faces right
                // We want it to face left (direction of travel), so rotate 180 from the mirrored state
                targetAngle = rawAngle;
            } else {
                // Car: faces right by default, when mirrored faces left (good!)
                // Just need to tilt it according to the slope
                targetAngle = -rawAngle; // Invert because of the mirror
            }
        } else {
            // Traveling east (or not mirroring) - normal orientation
            scaleX = 1;
            
            if (config.defaultFacing === 'left') {
                // Bike: faces left, but traveling right, so add 180°
                targetAngle = rawAngle + 180;
            } else {
                // Car: faces right, traveling right, just use the angle
                targetAngle = rawAngle;
            }
        }
        
        // Normalize angle to -180 to 180
        while (targetAngle > 180) targetAngle -= 360;
        while (targetAngle < -180) targetAngle += 360;
        
        // Calculate angle difference for smooth interpolation
        let angleDiff = targetAngle - lastAngle;
        while (angleDiff > 180) angleDiff -= 360;
        while (angleDiff < -180) angleDiff += 360;
        
        // Apply smooth interpolation
        if (Math.abs(angleDiff) > 2) {
            newLastAngle = lastAngle + angleDiff * interpolationFactor;
        } else {
            newLastAngle = lastAngle;
        }
        
        angle = newLastAngle;
        
    } else {
        // Non-rotating icons (person, backpacker)
        angle = 0;
        
        // Still apply mirroring based on travel direction
        if (config.mirrors && travelingWest) {
            scaleX = -1;
        }
    }
    
    return { angle, scaleX, newLastAngle };
}

/**
 * Get the CSS transform string for an icon
 * 
 * @param {number} angle - Rotation angle in degrees
 * @param {number} scaleX - Horizontal scale (1 = normal, -1 = mirrored)
 * @param {number} iconSize - Size of the icon for transform origin
 * @returns {string} - CSS transform value
 */
function getIconTransformCSS(angle, scaleX, iconSize) {
    const transforms = [];
    
    if (scaleX !== 1) {
        transforms.push(`scaleX(${scaleX})`);
    }
    
    if (angle !== 0) {
        transforms.push(`rotate(${angle}deg)`);
    }
    
    return transforms.length > 0 ? transforms.join(' ') : 'none';
}

/**
 * Get icon configuration
 * 
 * @param {string} iconType - The icon type
 * @returns {object} - Icon configuration
 */
function getIconConfig(iconType) {
    return ICON_CONFIG[iconType] || ICON_CONFIG.person;
}

/**
 * Get icon size
 * 
 * @param {string} iconType - The icon type
 * @returns {number} - Icon size in pixels
 */
function getIconSize(iconType) {
    const config = ICON_CONFIG[iconType] || ICON_CONFIG.person;
    return config.size;
}

// Export for use in browser (will be injected via page.evaluate)
if (typeof window !== 'undefined') {
    window.IconRenderer = {
        calculateIconTransform,
        getIconTransformCSS,
        getIconConfig,
        getIconSize,
        ICON_CONFIG
    };
}

// Export for Node.js (if needed)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        calculateIconTransform,
        getIconTransformCSS,
        getIconConfig,
        getIconSize,
        ICON_CONFIG
    };
}
