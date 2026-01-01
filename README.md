# Map Animation with Puppeteer

Creates Indiana Jones style animated map routes using Puppeteer and Leaflet.

## Installation

```bash
npm install
```

## Usage

### Preview Mode (Recommended First Step)

Preview your animation in a browser window before rendering:

```bash
# Preview with default destinations.json
npm run preview

# Preview with custom JSON file
npm run preview stannum-ljungslätt.json

# Preview with different tile style
npm run preview stannum-ljungslätt.json --tile watercolor
```

The browser stays open after playback so you can inspect the result.

### Render to Video

When happy with the preview, render to MP4:

```bash
# Render with default destinations.json
npm run render

# Render with custom JSON file
npm run render gulf-campino.json

# Render with different tile style
npm run render gulf-campino.json --tile watercolor
```

This creates a `map-animation.mp4` video file using frame-by-frame capture for guaranteed smooth playback.

### Post-Processing (Optional)

```bash
# Smooth 60fps version with motion interpolation (slow, CPU intensive)
npm run smooth

# Old film effect (grain, sepia, vintage look)
npm run oldfilm
```

## Tile Layers

Choose different map styles with the `--tile` flag:

| Name | Description |
|------|-------------|
| `osm` | OpenStreetMap (default) |
| `watercolor` | Stamen Watercolor - artistic, painterly style |
| `terrain` | OpenTopoMap - topographic with elevation |
| `toner` | CartoDB Positron - light, clean, minimal |
| `dark` | CartoDB Dark Matter - dark mode style |
| `voyager` | CartoDB Voyager - colorful, modern |
| `humanitarian` | Humanitarian OSM - clear, high contrast |

**Examples:**
```bash
npm run preview trip.json --tile watercolor
npm run render trip.json --tile terrain
npm run preview trip.json --tile=dark
```

## Configuration

All route and animation settings are configured in a JSON file:

```json
{
  "title": "Solo trip Vättlefjäll",
  "date": "December 31, 2025",
  "start": {
    "address": "Stannums Byväg 20, Lerum, Sweden",
    "label": "START: STANNUM"
  },
  "stops": [
    {
      "coordinates": [57.81356, 12.1706],
      "label": "BERGUMS KYRKA",
      "travelMode": "driving",
      "icon": "bike"
    },
    {
      "coordinates": [57.845, 12.142],
      "label": "MOLLSJÖVÄGEN PARKING",
      "travelMode": "driving",
      "icon": "bike"
    },
    {
      "coordinates": [57.844625, 12.111491],
      "label": "DESTINATION: GRILLPLATS",
      "travelMode": "direct",
      "icon": "person"
    }
  ],
  "animation": {
    "lineColor": "#8B4513",
    "lineWidth": 4
  }
}
```

### Configuration Options

| Field | Description |
|-------|-------------|
| `title` | Main title shown on the animated title card |
| `date` | Date displayed under the title and in corner stamp |
| `start.address` | Starting location (geocoded automatically) |
| `start.label` | Label shown at starting point |
| `stops[].coordinates` | `[latitude, longitude]` of each waypoint |
| `stops[].address` | Alternative to coordinates - will be geocoded |
| `stops[].label` | Label for the waypoint (use `null` for unlabeled waypoints) |
| `stops[].travelMode` | `"driving"`, `"cycling"`, `"walking"`, or `"direct"` |
| `stops[].icon` | `"bike"`, `"person"`, `"car"`, or `"backpacker"` |
| `stops[].viaPoints` | Optional `[[lat, lng], ...]` to force route through specific points |
| `animation.lineColor` | Route line color (hex) |
| `animation.lineWidth` | Route line thickness in pixels |

### Travel Modes

- **`driving`**: Uses OSRM routing API to follow roads (car routes)
- **`cycling`**: Uses OSRM cycling profile for bike-friendly routes
- **`walking`**: Uses OSRM walking profile for pedestrian routes
- **`direct`**: Draws a straight line (useful for hiking trails, off-road paths)

### Icons

Icons are stored in the `icons/` folder:
- `bike.png` - Motorcycle/bike icon (rotates to follow route direction)
- `car.png` - Car icon (rotates to follow route direction)
- `person.png` - Walking person icon (mirrors left/right based on direction)
- `backpack.png` - Backpacker icon (mirrors left/right based on direction)

## Animation Timing

The animation has four phases (32.5 seconds total):

| Phase | Duration | Description |
|-------|----------|-------------|
| Title Card | 3s | Shows title and date centered |
| Pan to Start | 2.5s | Zooms and pans to starting point |
| Route Animation | 25s | Animated journey along the route |
| End Card | 2s | Shows destination card |

## Features

- **Vintage Map Styling**: Sepia-toned map with parchment overlay
- **Multiple Tile Layers**: Choose from watercolor, terrain, toner, and more
- **Animated Title Card**: Shows title and date, then transitions to corner stamp
- **Smart Label Fade-in**: Waypoint labels fade in when approaching
- **Multi-segment Routes**: Multiple stops with different transport modes and icons
- **Smooth Icon Animation**: Icons rotate/mirror smoothly to follow direction
- **Cinematic Camera**: Smooth zoom transitions (zooms out mid-journey, back in at end)
- **Frame-by-Frame Capture**: Guarantees smooth video output regardless of system performance

## Animation Sequence

1. **Title Card** - Title and date appear centered (3s)
2. **Pan to Start** - Camera smoothly pans to starting point
3. **Route Animation** - Icon follows the route with smooth zoom transitions
4. **Waypoint Labels** - Fade in as you approach each stop
5. **End Card** - Destination card appears at journey's end

## Project Structure

```
map_experiments/
├── animate.js          # Preview mode (browser window)
├── animate-frames.js   # Render mode (frame-by-frame capture)
├── map.html            # Map template with Leaflet
├── package.json        # Dependencies and scripts
├── icons/
│   ├── icon-renderer.js  # Icon transform calculations
│   ├── bike.png
│   ├── car.png
│   ├── person.png
│   └── backpack.png
└── *.json              # Trip configuration files
```

## Dependencies

- **Puppeteer**: Headless browser for rendering and capture
- **Leaflet**: Interactive map library
- **OSRM**: Open Source Routing Machine (public API)
- **Nominatim**: OpenStreetMap geocoding service
- **FFmpeg**: Video encoding (must be installed separately)

## Requirements

- Node.js 18+
- FFmpeg (for video encoding)

```bash
# Install FFmpeg on macOS
brew install ffmpeg
```
