let liveChart = null;
let lastDataTime = 0;

// --- STRICT MONOTONIC MEMORY VARIABLES ---
let displaySoc = 100.0;
let displayDuration = 9999;
let aiLiveEnabled = false;
let liveUid = null;

// Initialize Live Chart
function initLiveChart() {
    const ctx = document.getElementById('liveChart').getContext('2d');
    liveChart = new Chart(ctx, {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'Predicted SoC %', data: [], borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.2)', fill: true, tension: 0.4 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { title: { display: true, text: 'Mins Remaining' } } } }
    });
}

// Fetch Live Curve
async function updateLiveCurve() {
    try {
        const res = await fetch('/live_curve_data');
        const d = await res.json();
        liveChart.data.labels = d.times;
        liveChart.data.datasets[0].data = d.socs;
        liveChart.update();
    } catch (e) {}
}

// --- NEW: LIVE AI UPLOAD & TRAIN ---
document.getElementById('liveCsvFile').addEventListener('change', async (e) => {
    const fd = new FormData();
    fd.append('file', e.target.files[0]);
    const res = await fetch('/upload', { method: 'POST', body: fd });
    const data = await res.json();
    
    liveUid = data.user_id;
    document.getElementById('liveMapperSection').style.display = 'block';
    
    const selects = ['liveMapTime', 'liveMapVolts', 'liveMapAmps', 'liveMapTemp', 'liveMapSoc'];
    selects.forEach(id => {
        const sel = document.getElementById(id);
        sel.innerHTML = "";
        data.headers.forEach(h => sel.add(new Option(h, h)));
        
        const h = data.headers.map(val => val.toLowerCase());
        if(id==='liveMapTime') sel.selectedIndex = h.findIndex(val => val.includes('time'));
        if(id==='liveMapVolts') sel.selectedIndex = h.findIndex(val => val.includes('volt') || val === 'v');
        if(id==='liveMapAmps') sel.selectedIndex = h.findIndex(val => val.includes('curr') || val === 'i');
        if(id==='liveMapTemp') sel.selectedIndex = h.findIndex(val => val.includes('temp'));
        if(id==='liveMapSoc') sel.selectedIndex = h.findIndex(val => val.includes('soc'));
    });
});

async function trainLiveAI() {
    const mapping = {
        time: document.getElementById('liveMapTime').value,
        voltage: document.getElementById('liveMapVolts').value,
        current: document.getElementById('liveMapAmps').value,
        temp: document.getElementById('liveMapTemp').value,
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
            displaySoc = 100.0; // Reset Memory on new model
            displayDuration = 9999;
        }
    } catch (err) { statusMsg.innerText = "❌ Error connecting AI."; }
}

// --- LIVE UPDATE LOOP ---
async function update() {
    try {
        const res = await fetch('/get_data');
        const data = await res.json();
        
        // Connection Check
        lastDataTime = Date.now();
        document.getElementById('connStatus').innerText = "🟢 Connected";
        document.getElementById('connStatus').className = "status-badge connected";

        let rawSoc = data.soc;
        let rawDuration = 9999;

        // Alerts
        let alertHTML = "";
        if (data.soc < 10.0) alertHTML += `<div class="alert alert-danger">⚠️ LOW VOLTAGE ALERT: Battery SoC is below 10%. Please charge!</div>`;
        if (data.temp >= 40.0) alertHTML += `<div class="alert alert-warning">🔥 OVERTEMP ALERT: Battery is overheating at ${data.temp.toFixed(1)}°C!</div>`;
        document.getElementById('alertContainer').innerHTML = alertHTML;

        // --- AI PREDICTION OVERRIDE ---
        if (aiLiveEnabled && liveUid) {
            const pRes = await fetch('/predict', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    user_id: liveUid,
                    model_type: document.getElementById('liveMType').value,
                    voltage: data.voltage,
                    current: data.current,
                    temp: data.temp
                })
            });
            const pData = await pRes.json();
            if (pData.soc !== undefined) {
                rawSoc = pData.soc;
                rawDuration = pData.time_remaining_min;
            }
        }

        // --- STRICT MONOTONIC MEMORY LOGIC (No Shuffling/Bouncing) ---
        if (rawSoc <= displaySoc) displaySoc = rawSoc;
        if (rawDuration <= displayDuration && rawDuration !== 9999) displayDuration = rawDuration;

        // UI Updates
        document.getElementById('socDisplay').innerText = displaySoc.toFixed(1);
        document.getElementById('socBar').style.width = displaySoc + "%";
        document.getElementById('voltDisplay').innerText = data.voltage.toFixed(2);
        document.getElementById('tempDisplay').innerText = data.temp.toFixed(1);
        
        document.getElementById('durationDisplay').innerText = (displayDuration === 9999) ? "--" : displayDuration;

        updateLiveCurve();
    } catch (e) {}
}

setInterval(() => {
    if (Date.now() - lastDataTime > 3000) {
        document.getElementById('connStatus').innerText = "🔴 Disconnected";
        document.getElementById('connStatus').className = "status-badge disconnected";
    }
}, 1000);

async function toggleGeneration() {
    const minV = document.getElementById('minV').value || 9.0;
    const res = await fetch('/toggle_gen', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ min_v: minV }) });
    const status = await res.json();
    const btn = document.getElementById('genBtn');
    if (status.is_recording) { btn.innerText = "Stop Recording"; btn.classList.add('recording'); dlBtn.style.display = "none"; } 
    else { btn.innerText = "Start Recording"; btn.classList.remove('recording'); document.getElementById('dlBtn').style.display = "block"; }
}

initLiveChart();
setInterval(update, 1000);