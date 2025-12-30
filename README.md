# Map Animation with Puppeteer

Creates Indiana Jones style animated map routes using Puppeteer and Leaflet.

## Installation

```bash
npm install
```

## Usage

```bash
npm run animate
```

This will create a `map-animation.webm` video file.

### Optional: StadiaMaps API Key

For production use or to avoid rate limits, sign up for a free API key at [stadiamaps.com](https://stadiamaps.com):

1. Create a free account (no credit card required)
2. Generate an API key
3. Create a `.env` file:
```bash
STADIAMAPS_API_KEY=your-api-key-here
```

Or add it directly to [animate.js](animate.js#L45):
```javascript
apiKey: 'your-api-key-here'
```

## Customization

Edit `animate.js` to change:

### Coordinates
```javascript
const coordinates = [
    [37.7749, -122.4194], // San Francisco
    [39.7392, -104.9903], // Denver
    // Add more waypoints...
];
```

### Styling Options
```javascript
const options = {
    zoom: 4,                    // Map zoom level
    lineColor: '#8B4513',       // Route line color
    lineWidth: 4,               // Route line thickness
    animationDuration: 5000     // Animation duration in ms
};
```

## Indiana Jones Styling

To achieve the classic Indiana Jones look, you can:

1. **Map Style**: Replace the tile layer in `map.html` with a vintage/sepia map style
2. **Line Style**: Use dashed lines with plane icon
3. **Colors**: Sepia tones, aged paper background (#f4e8d0)
4. **Font**: Use adventure-style fonts
5. **Effects**: Add film grain, vignette, or scan lines

### Next Steps for Indiana Jones Look:
- Use custom vintage map tiles (Stamen Watercolor or custom tiles)
- Add animated plane/vehicle icon following the route
- Add location labels with typewriter effect
- Add parchment texture overlay
- Include date stamps and compass rose

## Converting to MP4

If you need MP4 format:

```bash
ffmpeg -i map-animation.webm -c:v libx264 -preset slow -crf 22 map-animation.mp4
```
