const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

// State variables
let win;
let ffmpegProc;
let currentSdpFile = null;
let isWindowDestroyed = false;

// Generate SDP file content for RTP stream
function generateSdpContent(address, port) {
  return `v=0
o=- 0 0 IN IP4 ${address}
s=RTP Multicast Stream
c=IN IP4 ${address}/32
t=0 0
m=audio ${port} RTP/AVP 96
a=rtpmap:96 opus/48000/1
a=ptime:20
a=maxptime:40`;
}

// Create temporary SDP file
function createSdpFile(address, port) {
  const sdpContent = generateSdpContent(address, port);
  const tempDir = os.tmpdir();
  const sdpFileName = `stream_${Date.now()}.sdp`;
  const sdpFilePath = path.join(tempDir, sdpFileName);
  
  try {
    fs.writeFileSync(sdpFilePath, sdpContent);
    console.log('SDP file created:', sdpFilePath);
    console.log('SDP content:', sdpContent);
    return sdpFilePath;
  } catch (error) {
    console.error('Failed to create SDP file:', error);
    throw error;
  }
}

// Clean up SDP file
function cleanupSdpFile() {
  if (currentSdpFile && fs.existsSync(currentSdpFile)) {
    try {
      fs.unlinkSync(currentSdpFile);
      console.log('SDP file cleaned up:', currentSdpFile);
      currentSdpFile = null;
    } catch (error) {
      console.error('Failed to cleanup SDP file:', error);
    }
  }
}

// Get correct ffmpeg path depending on dev or packaged mode
function getFFmpegPath() {
  if (app.isPackaged) {
    // When packaged, ffmpeg.exe will be inside resources/ffmpeg/
    return path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe');
  } else {
    // In development, use local ffmpeg/ffmpeg.exe (or system ffmpeg on Linux)
    // For testing on Ubuntu, you can keep 'ffmpeg' to use system binary
    return process.platform === 'win32'
      ? path.join(__dirname, 'ffmpeg', 'ffmpeg.exe')
      : 'ffmpeg';
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200, // maybe increase size for better UI space
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile('index.html');
  
  // Track window destruction
  win.on('closed', () => {
    isWindowDestroyed = true;
    win = null;
  });
}

app.whenReady().then(createWindow);

ipcMain.handle('start-stream', (_, { address, port }) => {
  stopStream();

  try {
    // Create SDP file for the stream
    currentSdpFile = createSdpFile(address, port);
    
    const args = [
      '-protocol_whitelist', 'file,udp,rtp',
      '-i', currentSdpFile,
      '-acodec', 'pcm_s16le',
      '-ar', '48000',
      '-ac', '1',
      '-f', 's16le',
      'pipe:1'
    ];

    const ffmpegPath = getFFmpegPath();
    console.log('Platform:', process.platform);
    console.log('Is Packaged:', app.isPackaged);
    console.log('Launching ffmpeg from:', ffmpegPath);
    console.log('Using SDP file:', currentSdpFile);

    // Send log to renderer
    safeSendToRenderer('log', 'Launching ffmpeg...');

    ffmpegProc = spawn(ffmpegPath, args);

    ffmpegProc.stdout.on('data', chunk => {
      safeSendToRenderer('audio-chunk', chunk.toString('base64'));
    });

    ffmpegProc.stderr.on('data', data => {
      safeSendToRenderer('log', data.toString());
    });

    ffmpegProc.on('error', (error) => {
      console.error('FFmpeg spawn error:', error);
      safeSendToRenderer('log', `FFmpeg Error: ${error.message}`);
      cleanupSdpFile();
    });

    ffmpegProc.on('close', () => {
      safeSendToRenderer('log', 'Stream stopped');
      cleanupSdpFile();
    });
    
  } catch (error) {
    console.error('Failed to start stream:', error);
    safeSendToRenderer('log', `Failed to start stream: ${error.message}`);
    cleanupSdpFile();
  }
});

ipcMain.handle('stop-stream', () => {
  stopStream();
});

function stopStream() {
  if (ffmpegProc) {
    ffmpegProc.kill();
    ffmpegProc = null;
  }
  cleanupSdpFile();
}

app.on('window-all-closed', () => {
  // Clean up before quitting
  stopStream();
  app.quit();
});

// Handle app quit
app.on('before-quit', () => {
  stopStream();
});

// Handle process termination
process.on('SIGINT', () => {
  stopStream();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopStream();
  process.exit(0);
});

// Safe function to send messages to renderer
function safeSendToRenderer(channel, data) {
  if (win && !win.isDestroyed() && !isWindowDestroyed) {
    try {
      win.webContents.send(channel, data);
    } catch (error) {
      console.log('Window destroyed, cannot send message');
    }
  }
}
