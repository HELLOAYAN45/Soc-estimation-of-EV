let liveChart = null;
let lastDataTime = 0; // To track connection

// Initialize the Live Chart
function initLiveChart() {
    const ctx = document.getElementById('liveChart').getContext('2d');
    liveChart = new Chart(ctx, {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'Predicted SoC %', data: [], borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.2)', fill: true, tension: 0.4 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { title: { display: true, text: 'Mins Remaining' } } } }
    });
}

// Fetch the projected curve data
async function updateLiveCurve() {
    try {
        const res = await fetch('/live_curve_data');
        const d = await res.json();
        liveChart.data.labels = d.times;
        liveChart.data.datasets[0].data = d.socs;
        liveChart.update();
    } catch (e) {}
}

// Fetch real-time hardware data
async function update() {
    try {
        const res = await fetch('/get_data');
        const data = await res.json();
        
        // Update Connection Status (Green)
        lastDataTime = Date.now();
        document.getElementById('connStatus').innerText = "🟢 Connected";
        document.getElementById('connStatus').className = "status-badge connected";

        // Update UI Numbers
        document.getElementById('socDisplay').innerText = data.soc.toFixed(1);
        document.getElementById('socBar').style.width = data.soc + "%";
        document.getElementById('voltDisplay').innerText = data.voltage.toFixed(2);
        document.getElementById('tempDisplay').innerText = data.temp.toFixed(1);

        // --- ALERTS ENGINE ---
        let alertHTML = "";
        if (data.soc < 10.0) {
            alertHTML += `<div class="alert alert-danger">⚠️ LOW VOLTAGE ALERT: Battery SoC is below 10%. Please charge the battery immediately!</div>`;
        }
        if (data.temp >= 40.0) {
            alertHTML += `<div class="alert alert-warning">🔥 OVERTEMP ALERT: Battery is overheating at ${data.temp.toFixed(1)}°C!</div>`;
        }
        document.getElementById('alertContainer').innerHTML = alertHTML;

        // Fetch new curve data every cycle
        updateLiveCurve();

    } catch (e) {}
}

// Connection Timeout Checker
setInterval(() => {
    if (Date.now() - lastDataTime > 3000) {
        document.getElementById('connStatus').innerText = "🔴 Disconnected";
        document.getElementById('connStatus').className = "status-badge disconnected";
    }
}, 1000);

async function toggleGeneration() {
    const minV = document.getElementById('minV').value || 9.0;
    const res = await fetch('/toggle_gen', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ min_v: minV })
    });
    const status = await res.json();
    const btn = document.getElementById('genBtn');
    if (status.is_recording) {
        btn.innerText = "Stop Recording";
        btn.classList.add('recording');
    } else {
        btn.innerText = "Start Recording";
        btn.classList.remove('recording');
        document.getElementById('dlBtn').style.display = "block";
    }
}

// Start everything
initLiveChart();
setInterval(update, 1000);