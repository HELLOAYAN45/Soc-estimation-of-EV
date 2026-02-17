const API_BASE_URL = "http://127.0.0.1:5000"; 
let selectedModel = 'fast';
let chartInstance = null;

function setModel(type) {
    selectedModel = type;
    document.getElementById('fastModeBtn').classList.toggle('active', type === 'fast');
    document.getElementById('proModeBtn').classList.toggle('active', type === 'pro');
}

async function calculatePrediction() {
    const realMax = parseFloat(document.getElementById('maxVoltageInput').value);
    const targetSoc = parseFloat(document.getElementById('targetSocInput').value);
    
    // 1. Calculate the Real Voltage we want to check
    // Logic: 9.0V is 0%, realMax is 100%
    const targetRealV = 9.0 + ((targetSoc / 100) * (realMax - 9.0));

    // 2. Convert REAL to RAW (Because backend applies correction again)
    // Formula: Raw = (Real - 2.7903) / 0.8301
    const targetRawV = (targetRealV - 2.7903) / 0.8301;

    try {
        const response = await fetch(`${API_BASE_URL}/predict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                voltage: targetRawV,
                current: 0.6,
                temp: 25.0,
                model_type: selectedModel
            })
        });

        const data = await response.json();
        
        if (data.error) { alert(data.error); return; }

        const resultBox = document.getElementById('resultBox');
        const predictionText = document.getElementById('predictionText');
        
        resultBox.style.display = 'block';
        predictionText.innerHTML = `
            <div style="font-size:0.9rem; color:#aaa; margin-bottom:10px;">ESTIMATED REMAINING AT ${targetSoc}%</div>
            <span style="color:#10b981">${data.time_remaining_min} Minutes</span>
            <div style="font-size:0.8rem; color:#3b82f6; margin-top:5px;">Mode: ${selectedModel.toUpperCase()} AI</div>
        `;

    } catch (e) {
        alert("❌ Backend not responding. Is app.py running?");
    }
}

// Graphing Logic
document.getElementById('csvInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = function(event) {
        const lines = event.target.result.split('\n');
        const labels = [];
        const socData = [];
        
        for (let i = 1; i < lines.length; i++) {
            const row = lines[i].split(',');
            if (row.length < 5) continue;
            labels.push((parseFloat(row[0])/60).toFixed(1)); // Min
            socData.push(parseFloat(row[4])); // SoC%
        }
        updateChart(labels, socData);
    };
    reader.readAsText(file);
});

function updateChart(labels, data) {
    const ctx = document.getElementById('socChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'State of Charge (%)',
                data: data,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}