// Test script to check for hiking trails in Sweden near your area

async function findTrails(lat, lon, radiusMeters = 3000) {
    console.log(`Searching for trails within ${radiusMeters}m of ${lat}, ${lon}...`);
    
    const query = `
        [out:json];
        (
          way(around:${radiusMeters},${lat},${lon})["highway"~"^(path|footway|track)$"];
          way(around:${radiusMeters},${lat},${lon})["sac_scale"];
        );
        out geom;
    `;
    
    const url = 'https://overpass-api.de/api/interpreter';
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            body: query
        });
        const data = await response.json();
        
        if (data.elements && data.elements.length > 0) {
            console.log(`\n✅ Found ${data.elements.length} trails nearby!\n`);
            
            // Show details of first 5 trails
            data.elements.slice(0, 5).forEach((trail, idx) => {
                console.log(`Trail ${idx + 1}:`);
                console.log(`  ID: ${trail.id}`);
                console.log(`  Type: ${trail.tags.highway || 'unknown'}`);
                console.log(`  Name: ${trail.tags.name || 'unnamed'}`);
                console.log(`  SAC Scale: ${trail.tags.sac_scale || 'not rated'}`);
                console.log(`  Surface: ${trail.tags.surface || 'unknown'}`);
                console.log(`  Points: ${trail.geometry ? trail.geometry.length : 'N/A'}`);
                console.log('');
            });
            
            return data.elements;
        } else {
            console.log('❌ No trails found in this area');
            return [];
        }
    } catch (error) {
        console.error('Error:', error.message);
        return [];
    }
}

// Test areas in your destinations
const testPoints = [
    { name: 'Mollsjövägen Parking', lat: 57.845, lon: 12.142 },
    { name: 'Grillplats', lat: 57.844625, lon: 12.111491 },
    { name: 'Varggropen', lat: 57.8363166667, lon: 12.1122 }
];

(async () => {
    for (const point of testPoints) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Testing: ${point.name}`);
        console.log('='.repeat(60));
        await findTrails(point.lat, point.lon);
    }
})();
