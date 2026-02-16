// Select DOM elements
const socDisplay = document.getElementById('socDisplay');
const socBar = document.getElementById('socBar');
const tempDisplay = document.getElementById('tempDisplay');
const durationDisplay = document.getElementById('durationDisplay');

// Initial State
let soc = 82;
let temp = 34.0;
let durationSeconds = 2700; // Starts at 45 minutes (for demo)

function updateDashboard() {
    // 1. Update Duration
    durationSeconds++;
    const hours = Math.floor(durationSeconds / 3600);
    const minutes = Math.floor((durationSeconds % 3600) / 60);
    
    // Format time as HH:MM
    const formattedTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    durationDisplay.innerText = formattedTime;

    // 2. Simulate Temperature Fluctuation (Random small changes)
    if (Math.random() > 0.7) {
        // Change temp by small amount (-0.2 to +0.2)
        let change = (Math.random() - 0.5) * 0.4;
        temp = temp + change;
        
        // Keep temp within realistic bounds (e.g., 30C to 45C)
        if (temp < 30) temp = 30;
        if (temp > 45) temp = 45;

        tempDisplay.innerText = temp.toFixed(1);
    }

    // 3. Update Visual Battery Bar
    // In a real app, this would come from the API.
    // We simply sync the width of the bar to the SOC percentage.
    socBar.style.width = soc + "%";
    
    // Optional: Change bar color if SOC is low
    if (soc < 20) {
        socBar.style.backgroundColor = '#ef4444'; // Red
        socDisplay.style.color = '#ef4444';
    } else {
        socBar.style.backgroundColor = '#10b981'; // Green
        socDisplay.style.color = '#10b981';
    }
}

// Run updateDashboard every 1000 milliseconds (1 second)
setInterval(updateDashboard, 1000);

// Run once immediately so we don't wait 1 second for first render
updateDashboard();
// Sidebar Toggle Logic
const menuToggle = document.getElementById('menuToggle');
const sidebar = document.getElementById('sidebar');

menuToggle.addEventListener('click', () => {
    sidebar.classList.toggle('active');
    
    // Optional: Animate hamburger into an 'X'
    const spans = menuToggle.querySelectorAll('.hamburger span');
    sidebar.classList.contains('active') ? transformToX(spans) : resetHamburger(spans);
});

function transformToX(spans) {
    spans[0].style.transform = "rotate(45deg) translate(5px, 6px)";
    spans[1].style.opacity = "0";
    spans[2].style.transform = "rotate(-45deg) translate(5px, -6px)";
}

function resetHamburger(spans) {
    spans[0].style.transform = "none";
    spans[1].style.opacity = "1";
    spans[2].style.transform = "none";
}

// Close sidebar when clicking outside
document.addEventListener('click', (e) => {
    if (!sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
        sidebar.classList.remove('active');
        resetHamburger(menuToggle.querySelectorAll('.hamburger span'));
    }
});