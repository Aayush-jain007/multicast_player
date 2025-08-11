// DOM Elements
const logEl = document.getElementById('log');
const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const addressEl = document.getElementById('address');
const portEl = document.getElementById('port');
const deviceSelect = document.getElementById('outputDevice');
const statusIndicator = document.getElementById('statusIndicator');
const streamStatus = document.getElementById('streamStatus');
const streamDuration = document.getElementById('streamDuration');
const packetCount = document.getElementById('packetCount');
const bitrate = document.getElementById('bitrate');
const volumeSlider = document.getElementById('volumeSlider');
const volumeValue = document.getElementById('volumeValue');
const audioMeter = document.getElementById('audioMeter');
const clearLogBtn = document.getElementById('clearLog');
const toggleAutoScrollBtn = document.getElementById('toggleAutoScroll');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettingsBtn = document.getElementById('closeSettings');

// State variables
let audioCtx;
let sourceNode;
let audioBufferQueue = [];
let audioElement;
let isStreaming = false;
let streamStartTime = null;
let packetCounter = 0;
let autoScroll = true;
let volume = 1.0;
let audioAnalyser;
let dataArray;
let animationId;

// Initialize audio context and analyser
function initAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioAnalyser = audioCtx.createAnalyser();
    audioAnalyser.fftSize = 256;
    dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
  }
}

// Update status indicator
function updateStatus(connected, message) {
  const indicator = statusIndicator.querySelector('div');
  const text = statusIndicator.querySelector('span');
  
  if (connected) {
    statusIndicator.className = 'status-indicator flex items-center space-x-2 px-3 py-2 rounded-full bg-green-500/20 border border-green-500/30';
    indicator.className = 'w-2 h-2 rounded-full bg-green-500 pulse';
    text.textContent = message || 'Connected';
  } else {
    statusIndicator.className = 'status-indicator flex items-center space-x-2 px-3 py-2 rounded-full bg-red-500/20 border border-red-500/30';
    indicator.className = 'w-2 h-2 rounded-full bg-red-500';
    text.textContent = message || 'Disconnected';
  }
}

// Update statistics
function updateStatistics() {
  if (isStreaming && streamStartTime) {
    const duration = Date.now() - streamStartTime;
    const hours = Math.floor(duration / 3600000);
    const minutes = Math.floor((duration % 3600000) / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);
    streamDuration.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
}

// Update audio meter
function updateAudioMeter() {
  if (audioAnalyser && isStreaming) {
    audioAnalyser.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
    const percentage = (average / 255) * 100;
    audioMeter.style.width = `${Math.min(percentage, 100)}%`;
    
    // Update bitrate (simplified calculation)
    const estimatedBitrate = Math.round(percentage * 128); // Rough estimation
    bitrate.textContent = `${estimatedBitrate} kbps`;
  }
}

// Enhanced logging with timestamps and formatting
function addLogEntry(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = document.createElement('div');
  logEntry.className = `log-entry mb-1 ${type === 'error' ? 'text-red-400' : type === 'warning' ? 'text-yellow-400' : 'text-gray-300'}`;
  logEntry.innerHTML = `<span class="text-gray-500">[${timestamp}]</span> ${message}`;
  
  // Remove placeholder if it exists
  const placeholder = logEl.querySelector('.text-gray-500.italic');
  if (placeholder) {
    placeholder.remove();
  }
  
  logEl.appendChild(logEntry);
  
  if (autoScroll) {
    logEl.scrollTop = logEl.scrollHeight;
  }
}

// Initialize audio devices
navigator.mediaDevices.enumerateDevices().then(devices => {
  devices.filter(d => d.kind === 'audiooutput').forEach(d => {
    let opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Device ${deviceSelect.children.length}`;
    deviceSelect.appendChild(opt);
  });
});

// Volume control
volumeSlider.addEventListener('input', (e) => {
  volume = e.target.value / 100;
  volumeValue.textContent = `${e.target.value}%`;
  if (audioElement) {
    audioElement.volume = volume;
  }
});

// Clear log
clearLogBtn.addEventListener('click', () => {
  logEl.innerHTML = '<div class="text-gray-500 italic">[Logs will appear here...]</div>';
});

// Toggle auto-scroll
toggleAutoScrollBtn.addEventListener('click', () => {
  autoScroll = !autoScroll;
  toggleAutoScrollBtn.innerHTML = autoScroll ? 
    '<i class="fas fa-scroll mr-1"></i>Auto-scroll' : 
    '<i class="fas fa-lock mr-1"></i>Manual';
  toggleAutoScrollBtn.className = autoScroll ? 
    'px-3 py-1 rounded bg-accent hover:bg-cyan-600 text-sm transition-colors' :
    'px-3 py-1 rounded bg-gray-600 hover:bg-gray-500 text-sm transition-colors';
});

// Settings modal
settingsBtn.addEventListener('click', () => {
  settingsModal.classList.remove('hidden');
  settingsModal.classList.add('flex');
});

closeSettingsBtn.addEventListener('click', () => {
  settingsModal.classList.add('hidden');
  settingsModal.classList.remove('flex');
});

// Close modal on outside click
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) {
    settingsModal.classList.add('hidden');
    settingsModal.classList.remove('flex');
  }
});

// IPC event handlers
window.api.onLog(msg => {
  addLogEntry(msg, msg.toLowerCase().includes('error') ? 'error' : 'info');
});

window.api.onAudioChunk(base64Data => {
  if (!isStreaming) return;
  
  packetCounter++;
  packetCount.textContent = packetCounter;
  
  const byteArray = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
  const blob = new Blob([byteArray], { type: 'audio/wav' });

  if (!audioElement) {
    initAudioContext();
    audioElement = new Audio();
    audioElement.autoplay = true;
    audioElement.volume = volume;
    
    if (deviceSelect.value) {
      audioElement.setSinkId(deviceSelect.value);
    }
    
    // Connect to analyser for audio meter
    const source = audioCtx.createMediaElementSource(audioElement);
    source.connect(audioAnalyser);
    audioAnalyser.connect(audioCtx.destination);
  }
  
  audioElement.src = URL.createObjectURL(blob);
});

// Start stream
startBtn.addEventListener('click', () => {
  if (isStreaming) return;
  
  const address = addressEl.value.trim();
  const port = portEl.value.trim();
  
  if (!address || !port) {
    addLogEntry('Please enter both address and port', 'error');
    return;
  }
  
  isStreaming = true;
  streamStartTime = Date.now();
  packetCounter = 0;
  
  updateStatus(true, 'Connecting...');
  streamStatus.textContent = 'Connecting';
  startBtn.disabled = true;
  startBtn.className = 'flex items-center justify-center space-x-2 py-3 px-4 rounded-lg bg-gray-600 text-gray-400 font-semibold cursor-not-allowed';
  
  addLogEntry(`Starting stream to ${address}:${port}`, 'info');
  
  window.api.startStream({
    address: address,
    port: port
  });
  
  // Start statistics update loop
  const statsInterval = setInterval(() => {
    if (isStreaming) {
      updateStatistics();
      updateAudioMeter();
    } else {
      clearInterval(statsInterval);
    }
  }, 1000);
});

// Stop stream
stopBtn.addEventListener('click', () => {
  if (!isStreaming) return;
  
  isStreaming = false;
  streamStartTime = null;
  
  updateStatus(false, 'Disconnected');
  streamStatus.textContent = 'Idle';
  startBtn.disabled = false;
  startBtn.className = 'flex items-center justify-center space-x-2 py-3 px-4 rounded-lg bg-success hover:bg-green-600 text-white font-semibold transition-all transform hover:scale-105';
  
  addLogEntry('Stream stopped', 'info');
  
  window.api.stopStream();
});

// Handle stream events
window.api.onLog(msg => {
  if (msg.includes('Stream stopped')) {
    isStreaming = false;
    streamStartTime = null;
    updateStatus(false, 'Disconnected');
    streamStatus.textContent = 'Idle';
    startBtn.disabled = false;
    startBtn.className = 'flex items-center justify-center space-x-2 py-3 px-4 rounded-lg bg-success hover:bg-green-600 text-white font-semibold transition-all transform hover:scale-105';
  } else if (msg.includes('Launching ffmpeg')) {
    updateStatus(true, 'Connected');
    streamStatus.textContent = 'Streaming';
  }
  
  addLogEntry(msg, msg.toLowerCase().includes('error') ? 'error' : 'info');
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        if (!isStreaming) {
          startBtn.click();
        } else {
          stopBtn.click();
        }
        break;
      case 'l':
        e.preventDefault();
        clearLogBtn.click();
        break;
    }
  }
});

// Initialize
addLogEntry('RTP Multicast Player initialized', 'info');
addLogEntry('Press Ctrl+Enter to start/stop stream', 'info');
