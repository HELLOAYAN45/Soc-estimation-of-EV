let liveChart = null;
let lastDataTime = 0;

let displaySoc = 100.0;
let displayDuration = 9999;
let aiLiveEnabled = false;
let liveUid = null;

let map, carMarker, destMarker;

// UPDATED: Now points to your exact starting coordinates
let currentLat = 22.95347, currentLng = 88.3759; 
let mapInitialized = false;

function initLiveChart() {
    const ctx = document.getElementById('liveChart').getContext('2d');
    liveChart = new Chart(ctx, {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'Predicted SoC %', data: [], borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.2)', fill: true, tension: 0.4 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { title: { display: true, text: 'Mins Remaining' } } } }
    });
}

async function updateLiveCurve() {
    try {
        const res = await fetch('/live_curve_data');
        const d = await res.json();
        liveChart.data.labels = d.times;
        liveChart.data.datasets[0].data = d.socs;
        liveChart.update();
    } catch (e) {}
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; 
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function initMap(startLat, startLng) {
    if (mapInitialized) return;
    
    map = L.map('liveMap').setView([startLat, startLng], 15);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(map);

    carMarker = L.marker([startLat, startLng]).addTo(map).bindPopup("<b>RC Car Live Pos</b>").openPopup();

    map.on('click', function(e) {
        if (destMarker) map.removeLayer(destMarker);
        destMarker = L.marker(e.latlng).addTo(map).bindPopup("Target Destination").openPopup();
        updateRangeCalculator(e.latlng.lat, e.latlng.lng);
    });

    mapInitialized = true;
}

function triggerEstimation() {
    if (!destMarker) {
        alert("Please click on the map to drop a destination pin first!");
        return;
    }
    updateRangeCalculator(destMarker.getLatLng().lat, destMarker.getLatLng().lng);
}

function updateRangeCalculator(targetLat, targetLng) {
    const distMeters = calculateDistance(currentLat, currentLng, targetLat, targetLng);
    if(document.getElementById('destDist')) {
        document.getElementById('destDist').innerText = distMeters.toFixed(1);
    }

    let speedEl = document.getElementById('speedDisplay');
    let currentSpeedMps = speedEl ? parseFloat(speedEl.innerText) : 0;
    let assumedSpeed = currentSpeedMps > 0.5 ? currentSpeedMps : 2.0; 
    
    const timeToReachMinutes = (distMeters / assumedSpeed) / 60;
    let etaEl = document.getElementById('etaDisplay');
    if(etaEl) etaEl.innerText = timeToReachMinutes.toFixed(1) + " mins";

    const statusEl = document.getElementById('reachStatus');
    if (displayDuration === 9999 || !statusEl) {
        if(document.getElementById('maxRange')) document.getElementById('maxRange').innerText = "--";
        if(statusEl) {
            statusEl.innerText = "Waiting for AI Data...";
            statusEl.style.color = "var(--text-secondary)";
        }
        return; 
    }

    const maxRangeMeters = assumedSpeed * (displayDuration * 60);
    if(document.getElementById('maxRange')) {
        document.getElementById('maxRange').innerText = maxRangeMeters.toFixed(1);
    }

    if (displayDuration >= timeToReachMinutes) {
        const spareTime = displayDuration - timeToReachMinutes;
        statusEl.innerText = `✅ REACHABLE (Spare Battery: ${spareTime.toFixed(1)}m)`;
        statusEl.style.color = "var(--accent-green)"; 
    } else {
        const shortBy = timeToReachMinutes - displayDuration;
        statusEl.innerText = `❌ OUT OF RANGE (Short by: ${shortBy.toFixed(1)}m)`;
        statusEl.style.color = "var(--accent-red)"; 
    }
}

const fileInput = document.getElementById('liveCsvFile');
if(fileInput) {
    fileInput.addEventListener('change', async (e) => {
        const fd = new FormData();
        fd.append('file', e.target.files[0]);
        const res = await fetch('/upload', { method: 'POST', body: fd });
        const data = await res.json();
        
        liveUid = data.user_id;
        document.getElementById('liveMapperSection').style.display = 'block';
        
        const selects = ['liveMapTime', 'liveMapVolts', 'liveMapAmps', 'liveMapTemp', 'liveMapSpeed', 'liveMapSoc'];
        selects.forEach(id => {
            const sel = document.getElementById(id);
            if(!sel) return;
            sel.innerHTML = "";
            data.headers.forEach(h => sel.add(new Option(h, h)));
            
            const h = data.headers.map(val => val.toLowerCase());
            if(id==='liveMapTime') sel.selectedIndex = h.findIndex(val => val.includes('time'));
            if(id==='liveMapVolts') sel.selectedIndex = h.findIndex(val => val.includes('volt') || val === 'v');
            if(id==='liveMapAmps') sel.selectedIndex = h.findIndex(val => val.includes('curr') || val === 'i');
            if(id==='liveMapTemp') sel.selectedIndex = h.findIndex(val => val.includes('temp'));
            if(id==='liveMapSpeed') sel.selectedIndex = h.findIndex(val => val.includes('speed') || val === 's');
            if(id==='liveMapSoc') sel.selectedIndex = h.findIndex(val => val.includes('soc'));
        });
    });
}

async function trainLiveAI() {
    const mapping = {
        time: document.getElementById('liveMapTime').value,
        voltage: document.getElementById('liveMapVolts').value,
        current: document.getElementById('liveMapAmps').value,
        temp: document.getElementById('liveMapTemp').value,
        speed: document.getElementById('liveMapSpeed').value,
        soc: document.getElementById('liveMapSoc').value
    };
    const statusMsg = document.getElementById('liveStatusMsg');
    statusMsg.innerText = "⏳ Training Live AI Engine...";

    try {
        const res = await fetch('/train', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ user_id: liveUid, mapping, model_type: document.getElementById('liveMType').value })
        });
        const d = await res.json();
        if(d.status === 'success') {
            statusMsg.innerHTML = "✅ <span style='color:var(--accent-green)'>AI Connected & Predicting Live!</span>";
            aiLiveEnabled = true;
            displaySoc = 100.0; 
            displayDuration = 9999;
        }
    } catch (err) { statusMsg.innerText = "❌ Error connecting AI."; }
}

async function update() {
    try {
        const res = await fetch('/get_data');
        const data = await res.json();
        
        lastDataTime = Date.now();
        const connStatus = document.getElementById('connStatus');
        if(connStatus) {
            connStatus.innerText = "🟢 Connected";
            connStatus.className = "status-badge connected";
        }

        let rawSoc = data.soc;
        let rawDuration = 9999;

        let alertHTML = "";
        if (data.soc < 10.0) alertHTML += `<div class="alert alert-danger">⚠️ LOW VOLTAGE ALERT: Battery SoC is below 10%. Please charge!</div>`;
        if (data.temp >= 40.0) alertHTML += `<div class="alert alert-warning">🔥 OVERTEMP ALERT: Battery is overheating at ${data.temp.toFixed(1)}°C!</div>`;
        
        const alertContainer = document.getElementById('alertContainer');
        if(alertContainer) alertContainer.innerHTML = alertHTML;

        if (aiLiveEnabled && liveUid) {
            const pRes = await fetch('/predict', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    user_id: liveUid,
                    model_type: document.getElementById('liveMType').value,
                    voltage: data.voltage,
                    current: data.current,
                    temp: data.temp,
                    speed: data.speed
                })
            });
            const pData = await pRes.json();
            if (pData.soc !== undefined) {
                rawSoc = pData.soc;
                rawDuration = pData.time_remaining_min;
            }
        }

        if (rawSoc <= displaySoc) displaySoc = rawSoc;
        if (rawDuration <= displayDuration && rawDuration !== 9999) displayDuration = rawDuration;

        if(document.getElementById('socDisplay')) document.getElementById('socDisplay').innerText = displaySoc.toFixed(1);
        if(document.getElementById('socBar')) document.getElementById('socBar').style.width = displaySoc + "%";
        if(document.getElementById('voltDisplay')) document.getElementById('voltDisplay').innerText = data.voltage.toFixed(2);
        if(document.getElementById('tempDisplay')) document.getElementById('tempDisplay').innerText = data.temp.toFixed(1);
        
        if(document.getElementById('speedDisplay')) {
            document.getElementById('speedDisplay').innerText = data.speed.toFixed(2);
        }
        
        if(document.getElementById('latDisplay')) document.getElementById('latDisplay').innerText = data.lat.toFixed(6);
        if(document.getElementById('lngDisplay')) document.getElementById('lngDisplay').innerText = data.lng.toFixed(6);
        if(document.getElementById('satsDisplay')) document.getElementById('satsDisplay').innerText = data.sats;
        
        if(document.getElementById('durationDisplay')) {
            document.getElementById('durationDisplay').innerText = (displayDuration === 9999) ? "--" : displayDuration;
        }

        currentLat = data.lat;
        currentLng = data.lng;
        
        if (currentLat !== 0.0 && currentLng !== 0.0 && mapInitialized) {
            carMarker.setLatLng([currentLat, currentLng]);
            map.panTo([currentLat, currentLng]); 
            if (destMarker) {
                updateRangeCalculator(destMarker.getLatLng().lat, destMarker.getLatLng().lng);
            }
        }

        updateLiveCurve();
    } catch (e) {}
}

setInterval(() => {
    if (Date.now() - lastDataTime > 3000) {
        const connStatus = document.getElementById('connStatus');
        if(connStatus) {
            connStatus.innerText = "🔴 Disconnected";
            connStatus.className = "status-badge disconnected";
        }
    }
}, 1000);

async function toggleGeneration() {
    try {
        const minVEl = document.getElementById('minV');
        let minV = 9.0;
        
        if (minVEl && minVEl.value !== "") {
            minV = parseFloat(minVEl.value);
        }
        
        const res = await fetch('/toggle_gen', { 
            method: 'POST', 
            headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify({ min_v: minV }) 
        });
        
        if (!res.ok) throw new Error("Server disconnected");

        const status = await res.json();
        const btn = document.getElementById('genBtn');
        const dlBtn = document.getElementById('dlBtn');
        
        if (status.is_recording) { 
            if(btn) { 
                btn.innerText = "Stop Recording"; 
                btn.style.background = "#ef4444"; 
            }
            if(dlBtn) dlBtn.style.display = "none"; 
        } else { 
            if(btn) { 
                btn.innerText = "Start Recording"; 
                btn.style.background = "var(--accent-blue)"; 
            }
            if(dlBtn) dlBtn.style.display = "block"; 
        }
    } catch (err) {
        console.error("Recording error:", err);
        alert("Failed to start recording. Ensure the Python server is running and the car is connected.");
    }
}

initLiveChart();
initMap(currentLat, currentLng); 
setInterval(update, 1000);