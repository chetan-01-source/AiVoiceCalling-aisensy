# WhatsApp AI Voice Calling with ElevenLabs Conversational AI

A fully automated AI voice agent that answers WhatsApp voice calls using **AiSensy** for WhatsApp integration and **ElevenLabs Conversational AI** for intelligent voice interactions.

---

## 🎯 What This Project Does

When someone calls your WhatsApp Business number:
1. **AiSensy** captures the incoming call and sends a webhook to your server
2. Your server **automatically accepts** the call (no human intervention)
3. **ElevenLabs AI Agent** handles the conversation - listening, understanding, and responding
4. The caller hears the AI's voice responses in **real-time**

---

## 🏗️ Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   WhatsApp      │────▶│   Your Server   │────▶│   ElevenLabs    │
│   Caller        │◀────│ (server-eleven  │◀────│   AI Agent      │
│                 │     │   labs.js)      │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                      │                        │
         │  WebRTC 48kHz PCM    │    WebSocket           │
         │                      │    16kHz↑ / 48kHz↓     │
         │                      │                        │
         ▼                      ▼                        ▼
  User speaks 48kHz ──▶ Downsample to 16kHz ──▶ AI processes speech
  Hears AI 48kHz ◀──── Direct passthrough ◀──── AI responds 48kHz
```

---

## 🔊 Audio Format Summary

| Direction | Flow | Input Format | Output Format | Conversion |
|-----------|------|--------------|---------------|------------|
| **Caller → AI** | WhatsApp → Server → ElevenLabs | 48kHz PCM | 16kHz PCM | ✅ Downsample (÷3) |
| **AI → Caller** | ElevenLabs → Server → WhatsApp | 48kHz PCM | 48kHz PCM | ❌ None (direct!) |

> **Key Advantage**: ElevenLabs outputs 48kHz PCM - the same as WhatsApp! This means AI audio goes **directly** to the caller without any conversion, ensuring crystal-clear voice quality.

---

## 📁 Project Structure

```
whatsapp-calling-ultravox/
├── src/
│   ├── index.js              # Server entry point
│   ├── app.js                # Express app setup
│   ├── config/
│   │   ├── index.js          # Config aggregator
│   │   ├── aisensy.config.js # AiSensy API config
│   │   ├── elevenlabs.config.js # ElevenLabs config
│   │   └── audio.config.js   # Audio sample rates
│   ├── routes/
│   │   ├── index.js          # Route aggregator
│   │   ├── health.routes.js  # Health endpoint
│   │   └── webhook.routes.js # AiSensy webhook
│   ├── services/
│   │   ├── aisensy.service.js    # AiSensy API calls
│   │   ├── elevenlabs.service.js # ElevenLabs WebSocket
│   │   └── webrtc.service.js     # WhatsApp WebRTC setup
│   ├── handlers/
│   │   ├── call.handler.js       # Call orchestration
│   │   └── elevenlabs.handler.js # Message/audio handlers
│   ├── audio/
│   │   ├── bridge.js         # Audio bridge (WhatsApp ↔ ElevenLabs)
│   │   └── playback.js       # Paced audio playback
│   └── state/
│       └── session.js        # Call session state
├── server-elevenlabs.js      # Legacy single-file version
├── .env                      # Environment variables
├── .env-example              # Template for .env
├── package.json              # Dependencies
├── public/                   # Static files
└── README.md                 # Documentation
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- AiSensy account with WhatsApp Calling enabled
- ElevenLabs account with Conversational AI access

### Installation

```bash
# 1. Clone the repository
git clone <your-repo-url>
cd whatsapp-calling-ultravox

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env-example .env
# Edit .env with your API keys

# 4. Start the server
npm start
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `AISENSY_PROJECT_ID` | Your AiSensy project ID |
| `AISENSY_API_KEY` | Your AiSensy API key |
| `ELEVENLABS_API_KEY` | Your ElevenLabs API key |
| `ELEVENLABS_AGENT_ID` | Your ElevenLabs Conversational AI agent ID |
| `PORT` | Server port (default: 3000) |
| `NODE_ENV` | Environment mode (development/production) |

---

## 📞 Complete Voice Call Flow (Step by Step)

### Phase 1: Server Initialization (Lines 1-66)

When you run `npm start`, the server initializes:

```javascript
// Load environment variables from .env file
require("dotenv").config();

// Import required modules
const express = require("express");           // Web server framework
const axios = require("axios");               // HTTP client for AiSensy API
const WebSocket = require("ws");              // WebSocket for ElevenLabs
const { RTCPeerConnection, ... } = require("@roamhq/wrtc");  // WebRTC for audio
```

**Key Audio Configuration:**
```javascript
// Audio configuration
// - WhatsApp WebRTC: 48kHz PCM (both input and output)
// - ElevenLabs INPUT: 16kHz PCM (user audio sent to AI)
// - ElevenLabs OUTPUT: 48kHz PCM (AI audio, direct to WhatsApp!)
const ELEVENLABS_INPUT_SAMPLE_RATE = 16000;  // For sending TO ElevenLabs
const WHATSAPP_SAMPLE_RATE = 48000;           // WhatsApp & ElevenLabs output
```

---

### Phase 2: Webhook Reception (Lines 70-196)

When a WhatsApp call comes in, AiSensy sends a POST request to `/aisensy-webhook`:

```javascript
app.post("/aisensy-webhook", async (req, res) => {
    // 1. Parse the webhook payload
    const { entry, topic } = req.body;
    
    // 2. Extract call data from nested structure
    // entry[0].changes[0].value.calls[0]
    const call = calls[0];
    const callId = call.id;
    const callEvent = call.event;  // "connect" or "terminate"
    
    // 3. Handle based on event type
    if (callEvent === "connect") {
        // New incoming call - extract SDP and caller info
        whatsappOfferSdp = call.session.sdp;
        await handleIncomingCall(callId, callerName, callerNumber);
    } else if (callEvent === "terminate") {
        // Call ended - cleanup
        cleanupConnections();
    }
});
```

**Webhook Payload Structure:**
```json
{
  "topic": "...",
  "entry": [{
    "changes": [{
      "value": {
        "calls": [{
          "id": "call_123",
          "event": "connect",
          "from": "919876543210",
          "session": { "sdp": "..." }
        }],
        "contacts": [{ "profile": { "name": "John" } }]
      }
    }]
  }]
}
```

---

### Phase 3: Call Handling Orchestration (Lines 201-244)

The `handleIncomingCall` function orchestrates the entire call setup:

```javascript
async function handleIncomingCall(callId, callerName, callerNumber) {
    // Step 1: Setup WebRTC connection to receive WhatsApp audio
    await setupWhatsAppWebRTC();
    
    // Step 2: Connect to ElevenLabs AI via WebSocket
    await connectToElevenLabs(callerName, callerNumber);
    
    // Step 3: Bridge audio between WhatsApp and ElevenLabs
    setupAudioBridge();
    
    // Step 4: Accept the call via AiSensy API
    await preAcceptCall(callId, sdp);
    setTimeout(() => acceptCall(callId, sdp), 1000);
}
```

---

### Phase 4: WebRTC Setup (Lines 249-322)

Establishes the audio connection with WhatsApp:

```javascript
async function setupWhatsAppWebRTC() {
    // 1. Create peer connection with STUN server
    whatsappPc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    
    // 2. Listen for incoming audio track from WhatsApp
    whatsappPc.ontrack = (event) => {
        whatsappStream = event.streams[0];  // Caller's audio (48kHz)
    };
    
    // 3. Set WhatsApp's offer as remote description
    await whatsappPc.setRemoteDescription({
        type: "offer",
        sdp: whatsappOfferSdp
    });
    
    // 4. Create audio source for sending AI voice BACK to WhatsApp
    audioSource = new RTCAudioSource();
    audioSenderTrack = audioSource.createTrack();
    whatsappPc.addTrack(audioSenderTrack);
    
    // 5. Create answer SDP
    const answer = await whatsappPc.createAnswer();
    await whatsappPc.setLocalDescription(answer);
}
```

**What is SDP?**
- SDP (Session Description Protocol) describes media capabilities
- Contains: codecs, IP addresses, ports, encryption keys
- WhatsApp sends OFFER, your server sends ANSWER

---

### Phase 5: ElevenLabs Connection (Lines 330-407)

Connects to ElevenLabs Conversational AI via WebSocket:

```javascript
/**
 * Audio Format:
 * - INPUT (User → AI): We resample 48kHz → 16kHz before sending
 * - OUTPUT (AI → User): ElevenLabs sends 48kHz PCM - DIRECT to WhatsApp!
 */
async function connectToElevenLabs(callerName, callerNumber) {
    // 1. Connect to ElevenLabs WebSocket
    const wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${ELEVENLABS_AGENT_ID}`;
    elevenLabsWs = new WebSocket(wsUrl);
    
    // 2. On connection, send initialization data
    elevenLabsWs.on("open", () => {
        elevenLabsWs.send(JSON.stringify({
            type: "conversation_initiation_client_data",
            custom_llm_extra_body: {
                caller_name: callerName,
                caller_number: callerNumber
            }
        }));
    });
    
    // 3. Listen for messages from ElevenLabs
    elevenLabsWs.on("message", (data) => {
        if (isJson) {
            handleElevenLabsMessage(message);  // Control messages
        } else {
            handleElevenLabsAudio(data);       // 48kHz PCM audio (direct!)
        }
    });
}
```

---

### Phase 6: ElevenLabs Message Handling (Lines 412-481)

Handles different message types from ElevenLabs:

```javascript
function handleElevenLabsMessage(message) {
    switch (message.type) {
        case "conversation_initiation_metadata":
            // Conversation started - get conversation ID
            break;
            
        case "user_transcript":
            // What the caller said (speech-to-text)
            console.log(`🎤 Caller said: "${message.user_transcript}"`);
            break;
            
        case "agent_response":
            // What the AI is saying
            console.log(`🤖 AI Agent: "${message.agent_response}"`);
            break;
            
        case "audio":
            // AI's voice (48kHz PCM - direct to WhatsApp)
            handleElevenLabsAudio(audioData);
            break;
            
        case "ping":
            // Keep-alive - respond with pong
            elevenLabsWs.send(JSON.stringify({
                type: "pong",
                event_id: message.ping_event.event_id
            }));
            break;
            
        case "interruption":
            // User interrupted the AI
            break;
    }
}
```

---

### Phase 7: Audio Processing - ElevenLabs to WhatsApp (Lines 483-606)

Receives AI voice from ElevenLabs and sends to WhatsApp caller - **NO CONVERSION NEEDED!**

```javascript
// Buffer and frame configuration
let elevenLabsAudioBuffer = new Int16Array(0);
const FRAME_SIZE = 480;  // 10ms of audio at 48kHz

// Paced playback - sends audio at real-time speed
function startAudioPlayback() {
    audioPlaybackTimer = setInterval(() => {
        if (elevenLabsAudioBuffer.length >= FRAME_SIZE) {
            // Get one frame (10ms of audio)
            const frame = elevenLabsAudioBuffer.slice(0, FRAME_SIZE);
            elevenLabsAudioBuffer = elevenLabsAudioBuffer.slice(FRAME_SIZE);
            
            // Send DIRECTLY to WhatsApp - both use 48kHz!
            audioSource.onData({
                samples: frame,
                sampleRate: 48000,  // Same as ElevenLabs output!
                bitsPerSample: 16,
                channelCount: 1,
                numberOfFrames: FRAME_SIZE
            });
        }
    }, 10);  // Every 10ms = real-time
}

/**
 * ElevenLabs outputs 48kHz PCM - same as WhatsApp!
 * NO CONVERSION NEEDED - direct passthrough
 */
function handleElevenLabsAudio(audioData) {
    // Binary data is raw 16-bit PCM samples at 48kHz
    const samples48k = new Int16Array(buffer);
    
    // Add to playback buffer (no conversion!)
    elevenLabsAudioBuffer = [...elevenLabsAudioBuffer, ...samples48k];
    
    // Start real-time playback
    startAudioPlayback();
}
```

**Why Paced Playback?**
- Audio must play at real-time speed (not too fast, not too slow)
- 10ms intervals ensure smooth, natural-sounding speech
- Buffer prevents gaps/stuttering

---

### Phase 8: Audio Processing - WhatsApp to ElevenLabs (Lines 614-738)

Captures caller's voice and **downsamples** for ElevenLabs:

```javascript
/**
 * - WhatsApp → ElevenLabs: Downsample 48kHz to 16kHz (ElevenLabs requires 16kHz input)
 * - ElevenLabs → WhatsApp: Direct 48kHz passthrough (no conversion!)
 */
function setupAudioBridge() {
    const audioTrack = whatsappStream.getAudioTracks()[0];
    audioSink = new RTCAudioSink(audioTrack);
    
    audioSink.ondata = (data) => {
        // data.samples = 48kHz PCM from WhatsApp
        // data.sampleRate = 48000
        
        // Downsample from 48kHz to 16kHz for ElevenLabs INPUT
        // Take every 3rd sample (48000 / 16000 = 3)
        const ratio = 48000 / 16000;  // = 3
        for (let i = 0; i < newLength; i++) {
            resampledSamples[i] = samples[i * 3];
        }
        
        // Send 16kHz audio to ElevenLabs
        sendAudioToElevenLabs(resampledSamples);
    };
}

function sendAudioToElevenLabs(audioData) {
    elevenLabsWs.send(JSON.stringify({
        user_audio_chunk: audioData.toString('base64')
    }));
}
```

**Downsampling Explained:**
- WhatsApp sends: 48,000 samples/second
- ElevenLabs needs: 16,000 samples/second
- Solution: Take every 3rd sample (48,000 ÷ 3 = 16,000)

---

### Phase 9: AiSensy API Calls (Lines 745-790)

Communicates with AiSensy to accept calls:

```javascript
// Pre-accept: Tells AiSensy we're ready
async function preAcceptCall(callId, sdp) {
    await axios.post(
        `${AISENSY_BASE_URL}/project/${PROJECT_ID}/wa-calling/call/pre-accept`,
        { callId, sdp },
        { headers: AISENSY_HEADERS }
    );
}

// Accept: Actually picks up the call
async function acceptCall(callId, sdp) {
    await axios.post(
        `${AISENSY_BASE_URL}/project/${PROJECT_ID}/wa-calling/call/accept`,
        { callId, sdp },
        { headers: AISENSY_HEADERS }
    );
}
```

**Two-Step Accept Process:**
1. `pre-accept`: Validates SDP, prepares connection
2. `accept`: Establishes the call (after 1 second delay)

---

### Phase 10: Cleanup (Lines 792-825)

Properly closes all connections when call ends:

```javascript
function cleanupConnections() {
    if (audioSink) audioSink.stop();
    if (audioSenderTrack) audioSenderTrack.stop();
    if (whatsappPc) whatsappPc.close();
    if (elevenLabsWs) elevenLabsWs.close();
    
    whatsappStream = null;
    currentCallId = null;
    conversationId = null;
}
```

---

### Phase 11: Server Startup (Lines 846-862)

```javascript
const PORT = process.env.PORT || 19000;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running at http://0.0.0.0:${PORT}`);
    console.log(`📥 Webhook endpoint: /aisensy-webhook`);
});
```

---

## 🎤 How Voice Processing Works

### Caller Speaking to AI (48kHz → 16kHz):
```
WhatsApp Audio (48kHz PCM)
    ↓
RTCAudioSink extracts raw samples
    ↓
Downsample to 16kHz (take every 3rd sample)
    ↓
Buffer into ~250ms chunks
    ↓
Base64 encode and send via WebSocket
    ↓
ElevenLabs processes speech → understands → generates response
```

### AI Responding to Caller (48kHz → 48kHz DIRECT):
```
ElevenLabs generates speech (48kHz PCM)
    ↓
Received via WebSocket (binary 48kHz PCM)
    ↓
NO CONVERSION! Direct passthrough ← KEY ADVANTAGE
    ↓
Added to playback buffer
    ↓
Paced playback timer (10ms intervals, 480 samples)
    ↓
RTCAudioSource sends to WhatsApp (48kHz)
    ↓
Caller hears crystal-clear AI voice
```

---

## 🔌 API Endpoints

### Health Check
```
GET /health
```
Returns server status, uptime, and AI provider info.

### AiSensy Webhook
```
POST /aisensy-webhook
```
Receives WhatsApp call events from AiSensy.

---

## 🛠️ Dependencies

| Package | Purpose |
|---------|---------|
| `express` | HTTP server framework |
| `axios` | HTTP client for AiSensy API calls |
| `ws` | WebSocket client for ElevenLabs |
| `@roamhq/wrtc` | WebRTC implementation for Node.js (audio handling) |
| `dotenv` | Environment variable management |

---

## 🐛 Troubleshooting

### No audio from AI
- Verify ElevenLabs agent outputs 48kHz PCM (check dashboard settings)
- Verify `ELEVENLABS_AGENT_ID` is correct
- Check server logs for audio chunk counts

### Call not connecting
- Ensure AiSensy webhook URL is correctly configured
- Check `AISENSY_PROJECT_ID` and `AISENSY_API_KEY`
- Look for SDP-related errors in logs

### WebSocket closing unexpectedly
- Check ElevenLabs quota/limits
- Ensure pong responses to ping messages
- Review ElevenLabs dashboard for agent errors

---

## 📝 License

MIT License
