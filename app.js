console.log("app.js loaded");

document.addEventListener('DOMContentLoaded', function() {
    console.log("DOM ready, initializing app...");

    // -- Report Crime Dropdown Toggle --
    const reportCrimeBox = document.getElementById('reportCrimeBox');
    const reportCrimeDropdown = document.getElementById('reportCrimeDropdown');

    if (reportCrimeBox && reportCrimeDropdown) {
        reportCrimeBox.addEventListener('click', function(e) {
            if (e.target.tagName === 'A') return;
            reportCrimeDropdown.classList.toggle('active');
        });
        
        document.addEventListener('click', function(e) {
            if (!reportCrimeBox.contains(e.target)) {
                reportCrimeDropdown.classList.remove('active');
            }
        });
        
        console.log("✅ Report crime dropdown enabled");
    }

    // Initialize Map
    const map = L.map("map").setView([41.8781, -87.6298], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    // Globals
    let crimeData = [];
    let markers = [];
    let heatLayer = null;
    let selectedCrimeTypes = new Set();
    let routeLines = [];
    let routeMarkers = [];
    let allCrimeData = [];
    let dateRange = { start: null, end: null };
    let availableDates = [];
    let notificationTimeout;
    let allRoutes = [];
    let selectedRouteIndex = 0;

    // Show Error Notification
    function showError(message) {
        const notification = document.getElementById('errorNotification');
        const messageSpan = document.getElementById('errorMessage');
        
        messageSpan.textContent = message;
        notification.classList.add('active');
        
        if (notificationTimeout) clearTimeout(notificationTimeout);
        
        notificationTimeout = setTimeout(() => {
            notification.classList.remove('active');
        }, 5000);
    }

    const closeNotification = document.getElementById('closeNotification');
    if (closeNotification) {
        closeNotification.addEventListener('click', function() {
            document.getElementById('errorNotification').classList.remove('active');
            if (notificationTimeout) clearTimeout(notificationTimeout);
        });
    }

    // Crime Colors
    const crimeColors = {
        THEFT: "#ff4444",
        BATTERY: "#ff8844",
        ASSAULT: "#ffcc00",
        ROBBERY: "#cc0000",
        HATE_CRIME: "#9900ff"
    };

    // Fetch Crime Data
    async function fetchCrime() {
        try {
            console.log("Fetching crime data...");
            const res = await fetch("/api/crime");
            const json = await res.json();
            allCrimeData = json.points;
            
            const dates = allCrimeData
                .map(p => p.rawDate || p.date)
                .filter(d => d)
                .map(d => new Date(d))
                .filter(d => !isNaN(d.getTime()))
                .sort((a, b) => a - b);
            
            if (dates.length > 0) {
                availableDates = dates;
                dateRange.start = dates[0];
                dateRange.end = dates[dates.length - 1];
                console.log(`📅 Date range: ${dateRange.start.toLocaleDateString()} to ${dateRange.end.toLocaleDateString()}`);
                setupDateSliders();
            }
            
            crimeData = allCrimeData;
            console.log(`✅ Loaded ${crimeData.length} crime points`);
            renderCrime();
        } catch(e) {
            console.error("❌ Error fetching crime data:", e);
            showError("Failed to load crime data. Make sure the server is running!");
        }
    }

    // Render Crime
    function renderCrime() {
        console.log("Rendering crime data...");
        
        markers.forEach(m => map.removeLayer(m));
        markers = [];

        let heatPoints = [];

        crimeData.forEach(p => {
            if (selectedCrimeTypes.size === 0) return;
            if (!selectedCrimeTypes.has(p.type)) return;

            const marker = L.circleMarker([Number(p.lat), Number(p.lng)], {
                radius: 6,
                color: crimeColors[p.type] || "#999",
                fillColor: crimeColors[p.type] || "#999",
                fillOpacity: 0.6
            }).addTo(map);
            marker.bindPopup(`<b>${p.type}</b><br>${p.desc || ''}<br><small>${p.date || ''}</small>`);
            markers.push(marker);

            let intensity = (p.type === "HATE_CRIME" ? 1 : 0.6);
            heatPoints.push([Number(p.lat), Number(p.lng), intensity]);
        });

        if (heatLayer) map.removeLayer(heatLayer);
        if (heatPoints.length > 0) {
            heatLayer = L.heatLayer(heatPoints, { 
                radius: 25, 
                blur: 15, 
                maxZoom: 17, 
                gradient: {0.2: 'yellow', 0.4: 'orange', 0.6: 'red', 1: 'purple'}
            }).addTo(map);
            console.log(`✅ Rendered ${markers.length} markers and heatmap`);
        }
    }

    // Filter Checkboxes
    const filterCheckboxes = document.querySelectorAll(".crime-filter");
    filterCheckboxes.forEach(box => {
        box.checked = true;
        selectedCrimeTypes.add(box.value);

        box.addEventListener("change", () => {
            if (box.checked) selectedCrimeTypes.add(box.value);
            else selectedCrimeTypes.delete(box.value);
            renderCrime();
        });
    });

    // Geocode Function
    async function geocode(address) {
        if (!address) return null;
        
        try {
            // Try with Chicago, IL first
            let res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address + ", Chicago, IL, USA")}&limit=1`, {
                headers: {
                    'User-Agent': 'SafeRoute-App'
                }
            });
            let data = await res.json();
            
            // If no results, try without Chicago (in case they already included it)
            if (data.length === 0) {
                res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`, {
                    headers: {
                        'User-Agent': 'SafeRoute-App'
                    }
                });
                data = await res.json();
            }
            
            if (data.length === 0) {
                console.error(`❌ No geocoding results for: ${address}`);
                return null;
            }
            
            console.log(`✅ Geocoded "${address}" to:`, data[0].lat, data[0].lon);
            return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        } catch(e) {
            console.error("Geocoding error:", e);
            return null;
        }
    }

    // Autocomplete
    let autocompleteTimeout;
    async function searchAddress(query) {
        if (!query || query.length < 3) return [];
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ", Chicago, IL, USA")}&limit=5`, {
                headers: {
                    'User-Agent': 'SafeRoute-App'
                }
            });
            const results = await res.json();
            console.log(`🔍 Autocomplete found ${results.length} results for "${query}"`);
            return results;
        } catch(e) {
            console.error("Autocomplete error:", e);
            return [];
        }
    }

    function setupAutocomplete(inputElement, suggestionsElement) {
        let selectedFromDropdown = false;
        
        inputElement.addEventListener('input', function() {
            clearTimeout(autocompleteTimeout);
            selectedFromDropdown = false; // Reset flag when typing
            const query = this.value.trim();
            
            if (query.length < 3) {
                suggestionsElement.classList.remove('active');
                suggestionsElement.innerHTML = '';
                return;
            }
            
            autocompleteTimeout = setTimeout(async () => {
                const results = await searchAddress(query);
                
                if (results.length === 0) {
                    suggestionsElement.classList.remove('active');
                    return;
                }
                
                suggestionsElement.innerHTML = results.map(result => `
                    <div class="autocomplete-item" data-lat="${result.lat}" data-lon="${result.lon}" data-display="${result.display_name}">
                        <div class="address-main">${result.display_name.split(',')[0]}</div>
                        <div class="address-detail">${result.display_name.split(',').slice(1).join(',')}</div>
                    </div>
                `).join('');
                
                suggestionsElement.classList.add('active');
                
                suggestionsElement.querySelectorAll('.autocomplete-item').forEach(item => {
                    item.addEventListener('click', function() {
                        const displayName = this.dataset.display;
                        const lat = parseFloat(this.dataset.lat);
                        const lon = parseFloat(this.dataset.lon);
                        
                        inputElement.value = displayName;
                        inputElement.dataset.lat = lat;
                        inputElement.dataset.lon = lon;
                        selectedFromDropdown = true;
                        
                        suggestionsElement.classList.remove('active');
                        suggestionsElement.innerHTML = '';
                        
                        console.log(`✅ Selected from dropdown: ${displayName} (${lat}, ${lon})`);
                    });
                });
            }, 300);
        });
        
        document.addEventListener('click', function(e) {
            if (!inputElement.contains(e.target) && !suggestionsElement.contains(e.target)) {
                suggestionsElement.classList.remove('active');
            }
        });
    }

    // Crime danger score
    function getCrimeDangerScore(lat, lng) {
        let score = 0;
        const dangerRadius = 0.003;
        
        crimeData.forEach(crime => {
            if (selectedCrimeTypes.size === 0) return;
            if (!selectedCrimeTypes.has(crime.type)) return;
            
            const distance = Math.sqrt(
                Math.pow(lat - crime.lat, 2) + Math.pow(lng - crime.lng, 2)
            );
            
            if (distance < dangerRadius) {
                const weights = {
                    HATE_CRIME: 10,
                    ROBBERY: 8,
                    ASSAULT: 7,
                    BATTERY: 5,
                    THEFT: 3
                };
                const weight = weights[crime.type] || 3;
                score += weight * (1 - distance / dangerRadius);
            }
        });
        
        return score;
    }

    // Get route alternatives (3 routes)
    async function getRouteAlternatives(start, end) {
        const mainUrl = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&alternatives=2`;
        
        try {
            const res = await fetch(mainUrl);
            const data = await res.json();
            
            if (data.code === 'Ok' && data.routes) {
                // Return up to 3 routes
                return data.routes.slice(0, 3);
            }
        } catch(e) {
            console.error("Routing error:", e);
        }
        
        return null;
    }

    // Calculate route safety
    function calculateRouteSafety(coordinates) {
        let totalDanger = 0;
        let samples = Math.min(coordinates.length, 50);
        let step = Math.floor(coordinates.length / samples);
        
        for (let i = 0; i < coordinates.length; i += step) {
            const [lng, lat] = coordinates[i];
            totalDanger += getCrimeDangerScore(lat, lng);
        }
        
        return totalDanger;
    }

    // Clear routes
    function clearRoutes() {
        routeLines.forEach(line => map.removeLayer(line));
        routeMarkers.forEach(marker => map.removeLayer(marker));
        routeLines = [];
        routeMarkers = [];
        allRoutes = [];
        
        const routeInfoBox = document.getElementById('routeInfoBox');
        if (routeInfoBox) routeInfoBox.classList.remove('active');
    }

    // Draw multiple routes
    function drawRoutes(routes, startCoord, endCoord) {
        clearRoutes();
        
        // Add start/end markers
        const startMarker = L.marker([startCoord.lat, startCoord.lng], {
            icon: L.icon({
                iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
                shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41]
            })
        }).addTo(map).bindPopup("<b>Start</b>");
        
        const endMarker = L.marker([endCoord.lat, endCoord.lng], {
            icon: L.icon({
                iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
                shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41]
            })
        }).addTo(map).bindPopup("<b>Destination</b>");
        
        routeMarkers.push(startMarker, endMarker);
        
        // Calculate safety for each route
        const routesWithSafety = routes.map((route, index) => {
            const safety = calculateRouteSafety(route.geometry.coordinates);
            return { ...route, safety, index };
        });
        
        // Sort by safety (lowest = safest)
        routesWithSafety.sort((a, b) => a.safety - b.safety);
        
        allRoutes = routesWithSafety;
        
        // Draw all routes with different colors
        routesWithSafety.forEach((route, displayIndex) => {
            const latlngs = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);
            
            // Colors: Dark blue for safest, lighter blues for alternatives
            const colors = ['#003d99', '#6699cc', '#99bbdd'];
            const weights = [6, 5, 4];
            
            const line = L.polyline(latlngs, {
                color: colors[displayIndex] || '#99bbdd',
                weight: weights[displayIndex] || 4,
                opacity: displayIndex === 0 ? 0.9 : 0.6
            }).addTo(map);
            
            routeLines.push(line);
            
            // Click handler to select route
            line.on('click', () => selectRoute(displayIndex));
        });
        
        // Show route options panel
        displayRouteOptions(routesWithSafety);
        
        // Fit map to show all routes
        if (routeLines.length > 0) {
            const group = L.featureGroup(routeLines);
            map.fitBounds(group.getBounds(), { padding: [50, 50] });
        }
        
        console.log(`✅ Drew ${routeLines.length} routes`);
    }

    // Display route options in info box
    function displayRouteOptions(routes) {
        const routeOptions = document.getElementById('routeOptions');
        const routeInfoBox = document.getElementById('routeInfoBox');
        
        routeOptions.innerHTML = routes.map((route, index) => {
            const distanceKm = (route.distance / 1000).toFixed(1);
            const distanceMiles = (route.distance / 1609.34).toFixed(1);
            const durationMin = Math.round(route.duration / 60);
            const safetyRating = route.safety < 20 ? "Safe ✓" : route.safety < 50 ? "Moderate ⚠" : "High Risk ⚠⚠";
            const isSafest = index === 0;
            
            return `
                <div class="route-option ${index === selectedRouteIndex ? 'selected' : ''}" data-index="${index}">
                    <div class="route-option-header">
                        <span class="route-option-title">Route ${index + 1}</span>
                        <span class="route-option-badge ${isSafest ? 'safest' : 'alternative'}">
                            ${isSafest ? 'SAFEST' : 'ALT'}
                        </span>
                    </div>
                    <div class="route-option-details">
                        <span>${distanceKm}km (${distanceMiles}mi)</span>
                        <span>${durationMin}min</span>
                        <span>${safetyRating}</span>
                    </div>
                </div>
            `;
        }).join('');
        
        // Add click handlers to route options
        routeOptions.querySelectorAll('.route-option').forEach(option => {
            option.addEventListener('click', function() {
                const index = parseInt(this.dataset.index);
                selectRoute(index);
            });
        });
        
        routeInfoBox.classList.add('active');
    }

    // Select a specific route
    function selectRoute(index) {
        selectedRouteIndex = index;
        
        // Update visual emphasis on map
        routeLines.forEach((line, i) => {
            if (i === index) {
                line.setStyle({ opacity: 0.9, weight: 6 });
                line.bringToFront();
            } else {
                line.setStyle({ opacity: 0.6, weight: i === 0 ? 5 : 4 });
            }
        });
        
        // Update selection in UI
        document.querySelectorAll('.route-option').forEach((option, i) => {
            if (i === index) {
                option.classList.add('selected');
            } else {
                option.classList.remove('selected');
            }
        });
        
        console.log(`✅ Selected route ${index + 1}`);
    }

    // Route Button Handler
    const routeBtn = document.getElementById("routeBtn");
    const startInput = document.getElementById("startInput");
    const endInput = document.getElementById("endInput");
    const startSuggestions = document.getElementById("startSuggestions");
    const endSuggestions = document.getElementById("endSuggestions");

    // Setup autocomplete for both inputs
    if (startInput && startSuggestions) setupAutocomplete(startInput, startSuggestions);
    if (endInput && endSuggestions) setupAutocomplete(endInput, endSuggestions);

    if (routeBtn && startInput && endInput) {
        routeBtn.addEventListener("click", async () => {
            const start = startInput.value.trim();
            const end = endInput.value.trim();

            if (!start || !end) {
                showError("Enter both start and end addresses.");
                return;
            }

            routeBtn.textContent = "Finding Routes...";
            routeBtn.disabled = true;

            try {
                console.log(`🔍 Finding routes from "${start}" to "${end}"`);
                
                // Add a small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));
                
                const startCoord = await geocode(start);
                
                if (!startCoord) {
                    showError(`Could not find start address: "${start}". Try: "123 Main St" or "Millennium Park"`);
                    routeBtn.textContent = "Find Safe Route";
                    routeBtn.disabled = false;
                    return;
                }
                
                // Add another small delay
                await new Promise(resolve => setTimeout(resolve, 500));
                
                const endCoord = await geocode(end);

                if (!endCoord) {
                    showError(`Could not find end address: "${end}". Try: "456 State St" or "Navy Pier"`);
                    routeBtn.textContent = "Find Safe Route";
                    routeBtn.disabled = false;
                    return;
                }

                console.log("✅ Geocoding successful:", startCoord, endCoord);

                // Get up to 3 alternative routes
                const routes = await getRouteAlternatives(startCoord, endCoord);
                
                if (!routes || routes.length === 0) {
                    showError("Could not calculate routes. Try different addresses.");
                    routeBtn.textContent = "Find Safe Route";
                    routeBtn.disabled = false;
                    return;
                }

                console.log(`✅ Found ${routes.length} routes`);
                
                // Draw all routes on the map
                drawRoutes(routes, startCoord, endCoord);
                
            } catch(e) {
                console.error("❌ Error creating routes:", e);
                showError("Failed to create routes. Please try again.");
            } finally {
                routeBtn.textContent = "Find Safe Route";
                routeBtn.disabled = false;
            }
        });
    }

    // Sidebar Draggable & Resizable
    const sidebar = document.getElementById('sidebar');
    const sidebarHeader = document.querySelector('.sidebar-header');
    const resizeHandle = document.getElementById('resizeHandle');
    const resetBtn = document.getElementById('resetBtn');
    
    let isDragging = false;
    let isResizing = false;
    let dragStartX, dragStartY, initialLeft, initialTop, initialWidth, initialHeight;

    const defaultPosition = { left: '10px', bottom: '10px', top: 'auto', width: '260px', height: 'auto' };

    resetBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        sidebar.style.left = defaultPosition.left;
        sidebar.style.bottom = defaultPosition.bottom;
        sidebar.style.top = defaultPosition.top;
        sidebar.style.width = defaultPosition.width;
        sidebar.style.height = defaultPosition.height;
    });

    sidebarHeader.addEventListener('mousedown', function(e) {
        if (e.target === resizeHandle || resizeHandle.contains(e.target)) return;
        
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        
        const rect = sidebar.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        
        sidebar.style.bottom = 'auto';
        e.preventDefault();
    });

    resizeHandle.addEventListener('mousedown', function(e) {
        isResizing = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        
        const rect = sidebar.getBoundingClientRect();
        initialWidth = rect.width;
        initialHeight = rect.height;
        
        e.stopPropagation();
        e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
        if (isDragging) {
            const deltaX = e.clientX - dragStartX;
            const deltaY = e.clientY - dragStartY;
            
            sidebar.style.left = (initialLeft + deltaX) + 'px';
            sidebar.style.top = (initialTop + deltaY) + 'px';
        }
        
        if (isResizing) {
            const deltaX = e.clientX - dragStartX;
            const deltaY = e.clientY - dragStartY;
            
            const newWidth = initialWidth + deltaX;
            const newHeight = initialHeight + deltaY;
            
            if (newWidth >= 260 && newWidth <= 600) {
                sidebar.style.width = newWidth + 'px';
            }
            if (newHeight >= 200) {
                sidebar.style.height = newHeight + 'px';
            }
        }
    });

    document.addEventListener('mouseup', function() {
        isDragging = false;
        isResizing = false;
    });

    // Date Filter Setup
    const dateFilterBtn = document.getElementById('dateFilterBtn');
    const dateFilterPopup = document.getElementById('dateFilterPopup');
    const startDateSlider = document.getElementById('startDateSlider');
    const endDateSlider = document.getElementById('endDateSlider');
    const startDateValue = document.getElementById('startDateValue');
    const endDateValue = document.getElementById('endDateValue');
    const applyDateBtn = document.getElementById('applyDateBtn');
    const cancelDateBtn = document.getElementById('cancelDateBtn');
    
    let tempStartDate, tempEndDate;

    function setupDateSliders() {
        if (availableDates.length === 0) return;
        
        const minDate = availableDates[0];
        const maxDate = availableDates[availableDates.length - 1];
        
        startDateSlider.min = 0;
        startDateSlider.max = availableDates.length - 1;
        startDateSlider.value = 0;
        
        endDateSlider.min = 0;
        endDateSlider.max = availableDates.length - 1;
        endDateSlider.value = availableDates.length - 1;
        
        tempStartDate = minDate;
        tempEndDate = maxDate;
        
        startDateValue.textContent = minDate.toLocaleDateString();
        endDateValue.textContent = maxDate.toLocaleDateString();
    }
    
    dateFilterBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        dateFilterPopup.classList.toggle('active');
    });
    
    startDateSlider.addEventListener('input', function() {
        const index = parseInt(this.value);
        tempStartDate = availableDates[index];
        startDateValue.textContent = tempStartDate.toLocaleDateString();
        
        if (index > parseInt(endDateSlider.value)) {
            endDateSlider.value = index;
            tempEndDate = availableDates[index];
            endDateValue.textContent = tempEndDate.toLocaleDateString();
        }
    });
    
    endDateSlider.addEventListener('input', function() {
        const index = parseInt(this.value);
        tempEndDate = availableDates[index];
        endDateValue.textContent = tempEndDate.toLocaleDateString();
        
        if (index < parseInt(startDateSlider.value)) {
            startDateSlider.value = index;
            tempStartDate = availableDates[index];
            startDateValue.textContent = tempStartDate.toLocaleDateString();
        }
    });
    
    applyDateBtn.addEventListener('click', function() {
        dateRange.start = tempStartDate;
        dateRange.end = tempEndDate;
        
        crimeData = allCrimeData.filter(crime => {
            if (!crime.rawDate && !crime.date) return true;
            const crimeDate = new Date(crime.rawDate || crime.date);
            return crimeDate >= dateRange.start && crimeDate <= dateRange.end;
        });
        
        console.log(`✅ Filtered to ${crimeData.length} crimes between ${dateRange.start.toLocaleDateString()} and ${dateRange.end.toLocaleDateString()}`);
        renderCrime();
        dateFilterPopup.classList.remove('active');
    });
    
    cancelDateBtn.addEventListener('click', function() {
        dateFilterPopup.classList.remove('active');
        setupDateSliders();
    });

    // Route Info Box Close Button
    const closeRouteInfo = document.getElementById('closeRouteInfo');
    if (closeRouteInfo) {
        closeRouteInfo.addEventListener('click', function() {
            document.getElementById('routeInfoBox').classList.remove('active');
        });
    }

    // Initialize - Fetch crime data
    console.log("Starting initial data fetch...");
    fetchCrime();
});
