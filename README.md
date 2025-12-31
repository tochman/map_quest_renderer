# Map Animation with Puppeteer

Creates Indiana Jones style animated map routes using Puppeteer and Leaflet.

## Installation

```bash
npm install
```

## Usage

```bash
# Run with default destinations.json
npm run animate

# Run with custom JSON file
npm run animate -- gulf-campino.json
```

This will create a `map-animation.mp4` video file.

### Smooth 60fps Version (Optional)

For a smoother video with motion interpolation (slow, CPU intensive):

```bash
npm run smooth
```

This creates `map-animation-smooth.mp4` with 60fps interpolation.

## Configuration

All route and animation settings are configured in `destinations.json`:

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
    "totalDuration": 25000,
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
| `stops[].label` | Label for the waypoint |
| `stops[].travelMode` | `"driving"` (uses OSRM routing) or `"direct"` (straight line) |
| `stops[].icon` | `"bike"`, `"person"`, `"car"`, or `"backpacker"` - icon shown during this segment |
| `stops[].viaPoints` | Optional `[[lat, lng], ...]` to force route through specific points |
| `animation.lineColor` | Route line color (hex) |
| `animation.lineWidth` | Route line thickness in pixels |

### Travel Modes

- **`driving`**: Uses OSRM routing API to follow actual roads
- **`direct`**: Draws a straight line (useful for hiking trails, off-road paths)

### Icons

Place your icon images in the project root:
- `bike.png` - Motorcycle/bike icon (rotates to follow route direction, faces left)
- `person.png` - Walking person icon (stays upright)
- `car.png` - Car icon (rotates to follow route direction, faces right)
- `backpacker.png` - Backpacker icon (rotates to follow route direction, faces left)

## Features

- **Vintage Map Styling**: Sepia-toned OpenStreetMap with parchment overlay
- **Animated Title Card**: Shows title and date, then transitions to corner
- **Smart Label Fade-in**: 
  - Start label visible immediately during initial pan
  - Waypoint labels fade in when 1/3 of distance away
- **Multi-segment Routes**: Support for multiple stops with different transport modes
- **Smooth Icon Rotation**: Bike icon smoothly rotates to follow road direction
- **Cinematic Camera**: Zooms out to show route overview, then follows the journey

## Animation Sequence

1. Title card appears with title and date (2.5s)
2. Title fades, date stamp moves to corner
3. Overview of entire route shown
4. Camera pans to starting point
5. Route animates with icon following the path
6. Waypoint labels fade in as you approach
7. Final destination marker and label appear

## Dependencies

- **Puppeteer**: Browser automation for recording
- **Leaflet**: Interactive map library
- **OSRM**: Open Source Routing Machine (public API)
- **Nominatim**: OpenStreetMap geocoding service
