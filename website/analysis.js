const API_URL = "";
let currentUserId = null;
let currentMode = 'fast';
let chartInstance = null;

function setMode(mode) {
    currentMode = mode;
    document.getElementById('btnFast').classList.toggle('active', mode === 'fast');
    document.getElementById('btnPro').classList.toggle('active', mode === 'pro');
}

// 1. UPLOAD
document.getElementById('csvInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const uploadText = document.getElementById('uploadText');
    const originalText = uploadText.innerHTML;
    uploadText.innerText = "⏳ Uploading...";

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch(`${API_URL}/upload`, { method: 'POST', body: formData });
        const data = await res.json();
        
        if (!res.ok || data.error) throw new Error(data.error);
        
        if (data.user_id) {
            currentUserId = data.user_id;
            uploadText.innerHTML = `✅ Loaded: <b>${file.name}</b>`;
            populateMappers(data.headers);
            document.getElementById('mapperBox').style.display = 'block';
        }
    } catch (err) {
        alert("Upload Failed: " + err.message);
        uploadText.innerHTML = originalText;
    }
});

function populateMappers(headers) {
    const selects = ['mapTime', 'mapVolts', 'mapAmps', 'mapTemp', 'mapSoc'];
    selects.forEach(id => {
        const sel = document.getElementById(id);
        sel.innerHTML = "";
        headers.forEach(h => {
            const opt = document.createElement('option');
            opt.value = h;
            opt.text = h;
            sel.appendChild(opt);
        });
        const lowerId = id.toLowerCase();
        for (let i=0; i<headers.length; i++) {
            const h = headers[i].toLowerCase();
            if (lowerId.includes('time') || lowerId.includes('sec')) if (h.includes('time') || h.includes('sec')) sel.selectedIndex = i;
            if (lowerId.includes('volt')) if (h.includes('volt') || h.includes('v')) sel.selectedIndex = i;
            if (lowerId.includes('amp')) if (h.includes('amp') || h.includes('curr')) sel.selectedIndex = i;
            if (lowerId.includes('temp')) if (h.includes('temp') || h.includes('deg')) sel.selectedIndex = i;
            if (lowerId.includes('soc')) if (h.includes('soc') || h.includes('perc')) sel.selectedIndex = i;
        }
    });
}

// 2. TRAIN
async function trainModel() {
    const mapping = {
        time: document.getElementById('mapTime').value,
        voltage: document.getElementById('mapVolts').value,
        current: document.getElementById('mapAmps').value,
        temp: document.getElementById('mapTemp').value,
        soc: document.getElementById('mapSoc').value
    };

    document.getElementById('trainLoader').style.display = 'block';
    document.getElementById('trainStatus').innerText = `Training ${currentMode.toUpperCase()} Model...`;

    try {
        const res = await fetch(`${API_URL}/train`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: currentUserId,
                mapping: mapping,
                model_type: currentMode
            })
        });
        
        const data = await res.json();
        document.getElementById('trainLoader').style.display = 'none';

        if (data.status === 'success') {
            document.getElementById('trainStatus').innerText = "✅ Training Complete!";
            
            if (data.highlights) {
                document.getElementById('highlightsBox').style.display = 'grid';
                document.getElementById('hl-100').innerText = data.highlights['100%'] || "--";
                document.getElementById('hl-50').innerText = data.highlights['50%'] || "--";
                document.getElementById('hl-25').innerText = data.highlights['25%'] || "--";
                document.getElementById('hl-5').innerText = data.highlights['5%'] || "--";
            }

            if (data.graph_data && data.graph_data.time && data.graph_data.soc) {
                renderChart(data.graph_data.time, data.graph_data.soc);
            }

            document.getElementById('predictZone').style.display = 'block';
            
            if (data.max_voltage) {
                document.getElementById('predVolts').value = data.max_voltage;
            }
        } else {
            document.getElementById('trainStatus').innerText = "❌ Error: " + (data.error || "Unknown Error");
        }
    } catch (err) {
        console.error("Javascript Error:", err);
        document.getElementById('trainStatus').innerText = "❌ UI Error: " + err.message;
        document.getElementById('trainLoader').style.display = 'none';
    }
}

function renderChart(times, socs) {
    const ctx = document.getElementById('socGraph').getContext('2d');
    document.getElementById('chartContainer').style.display = 'block';

    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: times.map(t => (t/60).toFixed(1)), 
            datasets: [{
                label: 'SoC %',
                data: socs,
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                borderWidth: 2,
                pointRadius: 0,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { title: { display: true, text: 'Minutes', color:'#94a3b8' }, ticks: { color: '#94a3b8' } },
                y: { title: { display: true, text: 'SoC (%)', color:'#94a3b8' }, ticks: { color: '#94a3b8' } }
            },
            plugins: { legend: { labels: { color: 'white' } } }
        }
    });
}

// 3. PREDICT
async function predict(mode) {
    const payload = {
        user_id: currentUserId,
        model_type: currentMode
    };
    
    if (mode === 'manual') {
        payload.voltage = document.getElementById('predVolts').value;
        payload.current = document.getElementById('predAmps').value;
        payload.temp = document.getElementById('predTemp').value || 25.0;
        document.getElementById('predSoc').value = ''; 
    } else {
        payload.soc = document.getElementById('predSoc').value;
        if (!payload.soc) {
            alert("Please enter an SoC %");
            return;
        }
    }
    
    try {
        const res = await fetch(`${API_URL}/predict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.error) {
            alert("Prediction Error: " + data.error);
            return;
        }
        
        document.getElementById('predResult').style.display = 'block';
        document.getElementById('resTime').innerText = `${data.time_remaining_min} Mins`;
        document.getElementById('resSoc').innerHTML = `At <b>${data.soc}%</b> SoC <br><span style="font-size:0.8rem; color:#64748b">(${data.engine})</span>`;
        
    } catch (err) {
        alert("Network Error: " + err.message);
    }
}