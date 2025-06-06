function initMap() {
    if (!window.state) {
        console.error('window.state is not initialized. Ensure init.js is loaded before map.js.');
        return;
    }

    // Check if a map instance already exists and remove it
    if (window.state.map) {
        window.state.map.remove();
        window.state.map = null;
    }

    // Initialize the map
    window.state.map = L.map('map', {
        minZoom: 2,  // Prevent zooming out too far
        maxZoom: 8,  // Prevent zooming in too far
        maxBounds: L.latLngBounds(
            L.latLng(-85, -180), // Southwest corner
            L.latLng(85, 180)    // Northeast corner
        ),
        maxBoundsViscosity: 1.0,
        wheelDebounceTime: 150,
        wheelPxPerZoomLevel: 120,
        preferCanvas: true,
        zoomSnap: 0.5,
        zoomDelta: 0.5,
        bounceAtZoomLimits: true,
        worldCopyJump: true,
        fadeAnimation: true,
        markerZoomAnimation: true,
        zoomAnimation: true,
        renderer: L.canvas({
            padding: 0.5,
            tolerance: 10
        })
    }).setView([20, 0], 3);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
        attribution: '©OpenStreetMap, ©CartoDB',
        maxZoom: 19,
        keepBuffer: 2,
        updateWhenIdle: true,
        updateWhenZooming: false
    }).addTo(window.state.map);

    loadGeoJSON();
}

async function loadGeoJSON(retryCount = 3) {
    const loadingEl = document.getElementById('map-loading');
    loadingEl.classList.add('active');
    loadingEl.textContent = 'Loading map data...';

    const PRIMARY_URL = 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';
    const BACKUP_URL = 'https://datahub.io/core/geo-countries/r/countries.geojson';
    const HEALTH_API_URL = 'https://disease.sh/v3/covid-19/countries';

    try {
        // Fetch health data
        const healthResponse = await fetch(HEALTH_API_URL);
        if (!healthResponse.ok) throw new Error(`Health API error: ${healthResponse.status}`);
        const healthData = await healthResponse.json();

        // Map health data by country
        const healthMap = {};
        healthData.forEach(country => {
            healthMap[country.countryInfo.iso3] = {
                cases: country.cases,
                deaths: country.deaths,
                recovered: country.recovered
            };
        });

        // Debugging: Log health data mapping
        console.log('Health data mapping:', healthMap);

        for (let i = 0; i < retryCount; i++) {
            try {
                const response = await fetch(i === 0 ? PRIMARY_URL : BACKUP_URL);
                if (!response.ok) throw new Error(`GeoJSON error: ${response.status}`);

                const data = await response.json();
                if (!data || !data.features) throw new Error('Invalid GeoJSON data');

                // Update GeoJSON with health data and assign risk levels
                data.features.forEach(feature => {
                    const isoCode = feature.properties['ISO3166-1-Alpha-3']; // Corrected property name
                    const healthData = healthMap[isoCode] || { cases: 0, deaths: 0, recovered: 0 };
                    feature.properties.cases = healthData.cases;
                    feature.properties.deaths = healthData.deaths;
                    feature.properties.recovered = healthData.recovered;

                    // Assign risk level based on cases
                    if (healthData.cases > 1000000) {
                        feature.properties.riskLevel = 'high';
                    } else if (healthData.cases > 50000) {
                        feature.properties.riskLevel = 'medium';
                    } else {
                        feature.properties.riskLevel = 'low';
                    }

                    // Debugging: Log each feature's properties
                    console.log('Feature properties after update:', feature.properties);
                });

                // Apply styles based on cases
                window.state.geojsonLayer = L.geoJSON(data, {
                    style: (feature) => {
                        const cases = feature.properties.cases;
                        let fillColor;
                        if (cases > 1000000) fillColor = '#800026'; // High cases
                        else if (cases > 500000) fillColor = '#BD0026';
                        else if (cases > 100000) fillColor = '#E31A1C';
                        else if (cases > 50000) fillColor = '#FC4E2A';
                        else if (cases > 10000) fillColor = '#FD8D3C';
                        else if (cases > 1000) fillColor = '#FEB24C';
                        else fillColor = '#FFEDA0'; // Low cases

                        return {
                            fillColor,
                            weight: 1,
                            opacity: 1,
                            color: 'white',
                            dashArray: '3',
                            fillOpacity: 0.7
                        };
                    },
                    onEachFeature: onEachFeature,
                    bubblingMouseEvents: false
                }).addTo(window.state.map);

                filterCountries('all');
                loadingEl.classList.remove('active');
                return;

            } catch (error) {
                console.error(`Attempt ${i + 1} failed:`, error);
                loadingEl.textContent = `Retrying... (${i + 1}/${retryCount})`;
                await new Promise(resolve => setTimeout(resolve, 1000)); // 1 sec wait
            }
        }

    } catch (error) {
        console.error('Failed to load health data:', error);
    }

    // if no workie, show error and enable manual retry
    loadingEl.innerHTML = `
        Failed to load map data. 
        <button onclick="loadGeoJSON()" class="retry-btn">Try Again</button>
    `;
}

// Map styles and utilities
function getCountryStyle(riskLevel) {
    return {
        weight: 1.5,        // Slightly thicker borders
        opacity: 0.8,       // More opaque borders
        color: '#fff',      // White borders
        dashArray: '',      // No dashes
        fillOpacity: 0.7,
        fillColor: {
            high: '#ff4444',
            medium: '#ffa726',
            low: '#66bb6a'
        }[riskLevel] || '#90a4ae'
    };
}

// Map interaction handlers
function onEachFeature(feature, layer) {
    layer.bindTooltip(feature.properties.ADMIN || feature.properties.name, {
        permanent: false,
        direction: 'center',
        className: 'country-label',
        opacity: 0.8,
        sticky: true,
        offset: [0, 0],
        interactive: false
    });

    layer.on({
        click: onFeatureClick
    });
}

function onFeatureClick(e) {
    // Reset all country styles first
    window.state.geojsonLayer.eachLayer(layer => {
        window.state.geojsonLayer.resetStyle(layer);
    });

    // Then highlight the selected country
    const layer = e.target;
    const bounds = layer.getBounds();
    const country = layer.feature.properties.ADMIN || layer.feature.properties.name;
    const cases = layer.feature.properties.cases || 0;
    const deaths = layer.feature.properties.deaths || 0;
    const recovered = layer.feature.properties.recovered || 0;

    layer.setStyle({
        weight: 2,
        color: document.body.classList.contains('dark-mode') ? '#fff' : '#000',
        fillOpacity: 0.9
    });

    // Update the info panel
    const elements = {
        location: document.querySelector('.info-value.location'),
        disease: document.querySelector('.info-value.disease'),
        cases: document.querySelector('.info-value.cases')
    };

    elements.location.textContent = country;
    elements.disease.textContent = 'COVID-19';
    elements.cases.textContent = `Cases: ${cases}`;

    // Adjust map bounds
    if (country === "United States of America" || country === "United States") {
        // Custom bounds for USA to exclude Alaska and Hawaii
        window.state.map.fitBounds([
            [24.396308, -125.000000], // Southwest point
            [49.384358, -66.934570]   // Northeast point
        ], {
            maxZoom: 4,
            padding: [50, 50],
            animate: true,
            duration: 1
        });
    } else {
        const boundsArea = Math.abs(bounds.getNorth() - bounds.getSouth()) * 
                          Math.abs(bounds.getEast() - bounds.getWest());
        
        // Check if country crosses the international date line
        const crossesDateLine = bounds.getWest() > bounds.getEast();
        
        if (crossesDateLine) {
            // Handle countries crossing the date line
            const adjustedBounds = L.latLngBounds(
                L.latLng(bounds.getSouth(), bounds.getWest()),
                L.latLng(bounds.getNorth(), bounds.getEast() + 360)
            );
            window.state.map.fitBounds(adjustedBounds, {
                maxZoom: Math.min(6, Math.max(2, 10 - Math.log2(boundsArea))),
                padding: [50, 50],
                animate: true,
                duration: 1
            });
        } else {
            window.state.map.fitBounds(bounds, {
                maxZoom: Math.min(6, Math.max(2, 10 - Math.log2(boundsArea))),
                padding: [50, 50],
                animate: true,
                duration: 1
            });
        }
    }
}

function filterCountries(riskLevel) {
    if (!window.state.geojsonLayer) return;
    window.state.currentRiskFilter = riskLevel;
    
    const highlightColor = document.body.classList.contains('dark-mode') ? '#fff' : '#000';
    
    window.state.geojsonLayer.eachLayer((layer) => {
        const countryRisk = layer.feature.properties.riskLevel;
        const styles = riskLevel === 'all' 
            ? { opacity: 1, fillOpacity: 0.7 }
            : countryRisk === riskLevel 
                ? { opacity: 1, fillOpacity: 0.9, weight: 2, color: highlightColor, dashArray: '' }
                : { opacity: 0.2, fillOpacity: 0.1, weight: 1, color: 'white', dashArray: '3' };
        
        layer.setStyle(styles);
    });
}

function updateInfoPanel(properties) {
    const countryName = properties.ADMIN || properties.name || 'Unknown';
    document.querySelector('.info-value.location').textContent = countryName;
    document.querySelector('.info-value.disease').textContent = properties.disease || 'No data';
    document.querySelector('.info-value.cases').textContent = properties.cases || '0';
    updateNewsPanel(countryName);
}

async function loadHealthEvents() {
    const API_URL = 'https://disease.sh/v3/covid-19/countries'; // Example API for health data

    try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const healthData = await response.json();

        // Instead of creating markers, map the data to the GeoJSON layer or info panel
        const healthMap = {};
        healthData.forEach(event => {
            healthMap[event.countryInfo.iso3] = {
                cases: event.cases,
                deaths: event.deaths,
                recovered: event.recovered
            };
        });

        // Update GeoJSON layer or info panel with this data
        // (This logic should already exist in loadGeoJSON or similar functions)
    } catch (error) {
        console.error('Failed to load health events:', error);
    }
}

// Call the function after initializing the map
initMap();
loadHealthEvents();
