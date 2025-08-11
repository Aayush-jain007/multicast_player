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
let gainNode;
let audioAnalyser;
let dataArray;
let isStreaming = false;
let streamStartTime = null;
let packetCounter = 0;
let autoScroll = true;
let volume = 1.0;
let animationId;
let audioBufferQueue = [];
let isPlaying = false;
let audioSource = null;
let currentTime = 0;
let bufferDuration = 0.1; // 100ms buffers

// Initialize audio context and analyser
async function initAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Resume audio context if suspended
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    
    gainNode = audioCtx.createGain();
    gainNode.gain.value = volume;
    
    audioAnalyser = audioCtx.createAnalyser();
    audioAnalyser.fftSize = 256;
    dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
    
    // Connect nodes
    gainNode.connect(audioAnalyser);
    audioAnalyser.connect(audioCtx.destination);
  }
}

// Process audio buffer queue with proper timing
function processAudioQueue() {
  if (audioBufferQueue.length === 0) return;
  
  const audioBuffer = audioBufferQueue.shift();
  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(gainNode);
  
  // Schedule to play at the correct time
  const playTime = Math.max(audioCtx.currentTime, currentTime);
  source.start(playTime);
  currentTime = playTime + audioBuffer.duration;
  
  source.onended = () => {
    // Clean up
  };
}

// Convert raw PCM data to AudioBuffer
async function pcmToAudioBuffer(pcmData) {
  try {
    // Raw PCM data: 16-bit signed little-endian, 48kHz, mono
    const samples = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength / 2);
    const audioBuffer = audioCtx.createBuffer(1, samples.length, 48000);
    const channelData = audioBuffer.getChannelData(0);
    
    // Convert Int16 to Float32 (-1.0 to 1.0)
    for (let i = 0; i < samples.length; i++) {
      channelData[i] = samples[i] / 32768.0;
    }
    
    return audioBuffer;
  } catch (error) {
    console.error('Error creating audio buffer from PCM:', error);
    return null;
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
async function initializeAudioDevices() {
  try {
    // Request permission for audio devices
    await navigator.mediaDevices.getUserMedia({ audio: true });
    
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
    
    // Clear existing options except the first one
    while (deviceSelect.children.length > 1) {
      deviceSelect.removeChild(deviceSelect.lastChild);
    }
    
    audioOutputs.forEach(d => {
      let opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Device ${deviceSelect.children.length}`;
      deviceSelect.appendChild(opt);
    });
    
    addLogEntry(`Found ${audioOutputs.length} audio output devices`, 'info');
  } catch (error) {
    addLogEntry(`Error initializing audio devices: ${error.message}`, 'error');
  }
}

// Volume control
volumeSlider.addEventListener('input', (e) => {
  volume = e.target.value / 100;
  volumeValue.textContent = `${e.target.value}%`;
  if (gainNode) {
    gainNode.gain.value = volume;
  }
});

// Audio device change handler
deviceSelect.addEventListener('change', async (e) => {
  const deviceId = e.target.value;
  if (deviceId && audioCtx) {
    try {
      // For Web Audio API, we need to handle device switching differently
      // This is a simplified approach - in a real app you might need to recreate the context
      addLogEntry(`Audio device changed to: ${e.target.options[e.target.selectedIndex].text}`, 'info');
    } catch (error) {
      addLogEntry(`Error changing audio device: ${error.message}`, 'error');
    }
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

window.api.onAudioChunk(async (base64Data) => {
  if (!isStreaming) return;
  
  packetCounter++;
  packetCount.textContent = packetCounter;
  
  try {
    const byteArray = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    
    // Debug: Log first few chunks
    if (packetCounter <= 5) {
      addLogEntry(`Received audio chunk ${packetCounter}, size: ${byteArray.length} bytes`, 'info');
    }
    
    // Initialize audio context if not already done
    if (!audioCtx) {
      await initAudioContext();
      addLogEntry('Audio context initialized', 'info');
    }
    
    // Convert WAV data to AudioBuffer
    const audioBuffer = await pcmToAudioBuffer(byteArray);
    if (audioBuffer) {
      audioBufferQueue.push(audioBuffer);
      processAudioQueue();
      
      // Debug: Log first few successful conversions
      if (packetCounter <= 5) {
        addLogEntry(`Audio buffer created, duration: ${audioBuffer.duration.toFixed(3)}s, queue length: ${audioBufferQueue.length}`, 'info');
      }
    } else {
      if (packetCounter <= 5) {
        addLogEntry('Failed to create audio buffer', 'error');
      }
    }
  } catch (error) {
    addLogEntry(`Error processing audio chunk: ${error.message}`, 'error');
  }
});

// Start stream
startBtn.addEventListener('click', async () => {
  if (isStreaming) return;
  
  const address = addressEl.value.trim();
  const port = portEl.value.trim();
  
  if (!address || !port) {
    addLogEntry('Please enter both address and port', 'error');
    return;
  }
  
  try {
    // Initialize audio context
    await initAudioContext();
    
    isStreaming = true;
    streamStartTime = Date.now();
    packetCounter = 0;
    audioBufferQueue = [];
    isPlaying = false;
    currentTime = audioCtx.currentTime;
    
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
  } catch (error) {
    addLogEntry(`Error starting stream: ${error.message}`, 'error');
    isStreaming = false;
    updateStatus(false, 'Error');
  }
});

// Stop stream
stopBtn.addEventListener('click', () => {
  if (!isStreaming) return;
  
  isStreaming = false;
  streamStartTime = null;
  audioBufferQueue = [];
  isPlaying = false;
  currentTime = 0;
  
  updateStatus(false, 'Disconnected');
  streamStatus.textContent = 'Idle';
  startBtn.disabled = false;
  startBtn.className = 'flex items-center justify-center space-x-2 py-3 px-4 rounded-lg bg-success hover:bg-green-600 text-white font-semibold transition-all transform hover:scale-105';
  
  addLogEntry('Stream stopped', 'info');
  
  window.api.stopStream();
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
initializeAudioDevices();
addLogEntry('RTP Multicast Player initialized', 'info');
addLogEntry('Press Ctrl+Enter to start/stop stream', 'info');
