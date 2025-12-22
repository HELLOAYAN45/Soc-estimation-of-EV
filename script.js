// This simulates receiving data from your CNN model every second
setInterval(() => {
    const randomSOC = (Math.random() * 100).toFixed(2);
    document.getElementById('soc-value').innerText = randomSOC;
}, 1000);