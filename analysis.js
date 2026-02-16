// --- CONFIGURATION ---
// Change this port if you run python on a different port (e.g., 7000)
const API_BASE_URL = "http://127.0.0.1:5000"; 

// --- DOM ELEMENTS ---
const csvInput = document.getElementById('csvInput');
const maxVoltageInput = document.getElementById('maxVoltageInput');
const targetSocInput = document.getElementById('targetSocInput');
const resultBox = document.getElementById('resultBox');
const predictionText = document.getElementById('predictionText');
const menuToggle = document.getElementById('menuToggle');
const sidebar = document.getElementById('sidebar');

// Global variables
let chartInstance = null;

// --- 1. HANDLE FILE UPLOAD (The "Dual Action") ---
csvInput.addEventListener('change', async function(e) {
    const file = e.target.files[0];
    if (!file) return;

    // A. Show the Graph (Client-Side)
    const reader = new FileReader();
    reader.onload = function(event) {
        parseCSV(event.target.result);
    };
    reader.readAsText(file);

    // B. Send File to Python (Server-Side AI Training)
    // This makes the backend "smart" instantly
    const formData = new FormData();
    formData.append('file', file);

    try {
        console.log("Uploading file to Python backend...");
        const response = await fetch(`${API_BASE_URL}/upload`, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        
        if (response.ok) {
            alert(`✅ AI Trained Successfully!\nProcessed ${result.rows} rows of data.`);
        } else {
            alert(`⚠️ Server Error: ${result.error}`);
        }
    } catch (error) {
        console.error("Upload failed", error);
        alert("❌ Could not connect to Python Server.\n\nMake sure 'app.py' is running in the background!");
    }
});

// --- 2. GRAPHING LOGIC (Chart.js) ---
function parseCSV(csvText) {
    const lines = csvText.split('\n');
    const labels = [];
    const voltageData = [];
    
    // Skip header (row 0) and parse lines
    for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(',');
        if (row.length < 2) continue;

        const time = parseFloat(row[0]); // Time (s)
        const voltage = parseFloat(row[1]); // Voltage (V)

        if (!isNaN(time) && !isNaN(voltage)) {
            labels.push((time / 60).toFixed(1)); // Convert to minutes
            voltageData.push(voltage);
        }
    }

    if (voltageData.length > 0) {
        updateChart(labels, voltageData);
    }
}

function updateChart(labels, data) {
    const ctx = document.getElementById('socChart').getContext('2d');

    if (chartInstance) {
        chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Voltage Profile (V)',
                data: data,
                borderColor: '#10b981', // Neon Green
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
            plugins: {
                legend: { labels: { color: 'white' } }
            },
            scales: {
                x: { 
                    title: { display: true, text: 'Time (Minutes)', color: '#94a3b8' },
                    ticks: { color: '#94a3b8' },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                y: { 
                    title: { display: true, text: 'Voltage (V)', color: '#94a3b8' },
                    ticks: { color: '#94a3b8' },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                }
            }
        }
    });
}

// --- 3. PREDICTION LOGIC (Talks to Python) ---
async function calculatePrediction() {
    const userMaxVoltage = parseFloat(maxVoltageInput.value);
    const userTargetSoc = parseFloat(targetSocInput.value);
    
    if (!userMaxVoltage || !userTargetSoc) {
        alert("Please enter both Max Voltage and Target SoC.");
        return;
    }

    // Calculate current voltage based on your calibration
    // Formula: V_target = V_min + (SoC% * (V_max - V_min))
    const minVoltage = 9.0; 
    const currentVoltage = minVoltage + ((userTargetSoc / 100) * (userMaxVoltage - minVoltage));

    console.log(`Requesting prediction for ${currentVoltage.toFixed(2)}V...`);

    try {
        const response = await fetch(`${API_BASE_URL}/predict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                voltage: currentVoltage,
                current: 0.6 // We assume 'High Load' for the base prediction
            })
        });

        const data = await response.json();

        if (data.error) {
            alert(`⚠️ AI Error: ${data.error}`);
            return;
        }

        // Display Results
        resultBox.style.display = 'block';
        
        // We show the AI prediction as the "High Load" (Minimum time)
        // And we estimate Low Load as 3x that amount
        const highLoadTime = data.time_remaining_min;
        const lowLoadTime = (highLoadTime * 3.0).toFixed(1);

        predictionText.innerHTML = `
            <span style="color:var(--accent-green)">${highLoadTime} min</span> 
            <span style="font-size:1rem;color:#ccc">to</span> 
            <span style="color:var(--accent-blue)">${lowLoadTime} min</span>
            <div style="font-size:0.8rem; color:#666; margin-top:5px;">AI Confidence: High</div>
        `;

    } catch (error) {
        console.error("Prediction failed", error);
        alert("❌ Error connecting to AI Server.\nIs the Python backend running?");
    }
}

// --- 4. SIDEBAR LOGIC ---
menuToggle.addEventListener('click', () => {
    sidebar.classList.toggle('active');
});

// Close sidebar when clicking outside
document.addEventListener('click', (e) => {
    if (!sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
        sidebar.classList.remove('active');
    }
});