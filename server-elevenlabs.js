require("dotenv").config();
const express = require("express");
const axios = require("axios");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");
const {
    RTCPeerConnection,
    RTCSessionDescription,
    RTCIceCandidate,
    MediaStream,
    nonstandard: { RTCAudioSink, RTCAudioSource }
} = require("@roamhq/wrtc");

// STUN server for NAT traversal
const ICE_SERVERS = [{ urls: "stun:stun.relay.metered.ca:80" }];

// AiSensy API Configuration
const AISENSY_BASE_URL = "https://apis.aisensy.com/project-apis/v1";
const PROJECT_ID = process.env.AISENSY_PROJECT_ID;
const API_KEY = process.env.AISENSY_API_KEY;

const AISENSY_HEADERS = {
    "x-aisensy-project-api-pwd": API_KEY,
    "Content-Type": "application/json"
};

// ElevenLabs Conversational AI Configuration
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID;

// Audio configuration - ElevenLabs requires 16kHz PCM
const ELEVENLABS_SAMPLE_RATE = 16000;
const WHATSAPP_SAMPLE_RATE = 48000;

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Health check route
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "OK",
        message: "AiSensy WhatsApp Calling Server with ElevenLabs AI is running",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || "development",
        aiProvider: "ElevenLabs Conversational AI"
    });
});

// State variables per call session
let whatsappPc = null;
let whatsappStream = null;
let whatsappOfferSdp = null;
let currentCallId = null;
let elevenLabsWs = null;
let conversationId = null;
let audioSink = null;       // RTCAudioSink for extracting audio from WhatsApp
let audioSource = null;     // RTCAudioSource for sending audio to WhatsApp
let audioSendCount = 0;
let audioSendEnabled = true; // Re-enabled after fixing ping response
let audioSenderTrack = null; // Track for sending audio back to WhatsApp

/**
 * AiSensy Webhook - handles all call events
 */
app.post("/aisensy-webhook", async (req, res) => {
    try {
        console.log("========================================");
        console.log("📥 Received AiSensy webhook");
        console.log("Request body:", JSON.stringify(req.body, null, 2));
        console.log("========================================");

        // Validate basic webhook structure
        if (!req.body) {
            console.error("❌ Empty request body");
            return res.status(400).json({ error: "Empty request body" });
        }

        // Parse AiSensy's webhook format
        const { object, entry, topic } = req.body;

        if (!topic) {
            console.warn("⚠️ Missing 'topic' in webhook payload");
            return res.status(200).json({ received: true, message: "Missing topic" });
        }

        if (!entry || !Array.isArray(entry) || entry.length === 0) {
            console.warn("⚠️ Missing or empty 'entry' array in webhook payload");
            return res.status(200).json({ received: true, message: "Missing entry data" });
        }

        // Extract call data from AiSensy's format: entry[0].changes[0].value.calls[0]
        const changes = entry[0]?.changes;
        if (!changes || !Array.isArray(changes) || changes.length === 0) {
            console.warn("⚠️ No changes found in entry");
            return res.status(200).json({ received: true, message: "No changes data" });
        }

        const value = changes[0]?.value;
        if (!value) {
            console.warn("⚠️ No value found in changes");
            return res.status(200).json({ received: true, message: "No value data" });
        }

        const calls = value.calls;
        if (!calls || !Array.isArray(calls) || calls.length === 0) {
            console.warn("⚠️ No calls found in value");
            return res.status(200).json({ received: true, message: "No calls data" });
        }

        const call = calls[0];
        console.log("✅ Call data extracted:", JSON.stringify(call, null, 2));

        const callId = call.id;
        if (!callId) {
            console.error("❌ No call ID found in webhook data");
            return res.status(200).json({ received: true, message: "Missing call ID" });
        }

        currentCallId = callId;
        console.log(`✅ Processing call ID: ${callId}`);

        const callEvent = call.event;
        const callStatus = call.status;
        const callerNumber = call.from;
        const receiverNumber = call.to;

        console.log(`📞 Call event: ${callEvent}, Status: ${callStatus || 'N/A'}`);
        console.log(`📞 From: ${callerNumber}, To: ${receiverNumber}`);

        // Handle different call events
        if (callEvent === "connect") {
            console.log("📞 Processing incoming call 'connect' event");
            try {
                console.log(`Incoming call from ${callerNumber}`);

                // Extract SDP from session object
                if (call.session && call.session.sdp) {
                    whatsappOfferSdp = call.session.sdp;
                    console.log("✅ SDP extracted from call.session.sdp");
                } else {
                    console.warn("⚠️ No SDP found in call.session");
                    return res.status(200).json({ received: true, message: "Missing SDP" });
                }

                // Get caller name from contacts
                const contacts = value.contacts;
                let callerName = "Unknown";
                if (contacts && Array.isArray(contacts) && contacts.length > 0) {
                    callerName = contacts[0].profile?.name || "Unknown";
                }

                console.log(`📞 Caller: ${callerName} (${callerNumber})`);

                // Initialize automated call handling with ElevenLabs
                await handleIncomingCall(callId, callerName, callerNumber);

            } catch (error) {
                console.error("❌ Error in 'connect' event handler:", error);
                throw error;
            }
        } else if (callEvent === "terminate") {
            console.log("📴 Processing call 'terminate' event");
            try {
                console.log(`Call terminated. Status: ${callStatus}`);

                // Cleanup
                cleanupConnections();
                console.log("✅ Cleaned up all connections");
            } catch (error) {
                console.error("❌ Error in 'terminate' event handler:", error);
                throw error;
            }
        } else {
            console.log(`⚠️ Unhandled call event: ${callEvent}`);
        }

        console.log("✅ Webhook processed successfully");
        res.status(200).json({ received: true, topic, callId, event: callEvent });
    } catch (err) {
        console.error("========================================");
        console.error("❌ ERROR processing AiSensy webhook");
        console.error("Error message:", err.message);
        console.error("Error stack:", err.stack);
        console.error("========================================");

        res.status(500).json({
            error: "Internal server error",
            message: err.message
        });
    }
});

/**
 * Handle incoming WhatsApp call - fully automated with ElevenLabs
 */
async function handleIncomingCall(callId, callerName, callerNumber) {
    try {
        console.log("🤖 Starting automated call handling with ElevenLabs...");

        // Step 1: Setup WhatsApp WebRTC connection
        console.log("🌉 Setting up WhatsApp WebRTC connection...");
        await setupWhatsAppWebRTC();

        // Step 2: Connect to ElevenLabs Conversational AI
        console.log("🔌 Connecting to ElevenLabs Conversational AI...");
        await connectToElevenLabs(callerName, callerNumber);

        // Step 3: Setup audio bridge
        console.log("🌉 Setting up audio bridge...");
        setupAudioBridge();

        // Step 4: Pre-accept and accept the call
        console.log("📤 Sending pre-accept to AiSensy...");
        const preAcceptSuccess = await preAcceptCall(callId, whatsappPc.localDescription.sdp);

        if (!preAcceptSuccess) {
            throw new Error("Pre-accept failed");
        }

        console.log("✅ Pre-accept successful, waiting 1s before accept...");

        setTimeout(async () => {
            console.log("📤 Sending accept to AiSensy...");
            const acceptSuccess = await acceptCall(callId, whatsappPc.localDescription.sdp);

            if (acceptSuccess) {
                console.log("✅ Call accepted! ElevenLabs AI agent is now active.");
                console.log("🎉 Automated call setup complete!");
            } else {
                console.error("❌ Accept failed!");
            }
        }, 1000);

    } catch (error) {
        console.error("❌ Error in handleIncomingCall:", error);
        cleanupConnections();
        throw error;
    }
}

/**
 * Setup WhatsApp WebRTC peer connection
 */
async function setupWhatsAppWebRTC() {
    return new Promise(async (resolve, reject) => {
        try {
            whatsappPc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
            whatsappStream = new MediaStream();

            // Track received from WhatsApp
            const trackPromise = new Promise((resolveTrack, rejectTrack) => {
                const timeout = setTimeout(() => {
                    rejectTrack(new Error("Timed out waiting for WhatsApp track"));
                }, 10000);

                whatsappPc.ontrack = (event) => {
                    clearTimeout(timeout);
                    console.log("📞 Audio track received from WhatsApp");
                    whatsappStream = event.streams[0];
                    event.streams[0].getTracks().forEach((track) => {
                        console.log(`WhatsApp track: ${track.kind}, enabled: ${track.enabled}`);
                    });
                    resolveTrack();
                };
            });

            whatsappPc.onicecandidate = (event) => {
                if (event.candidate) {
                    console.log("WhatsApp ICE candidate generated");
                }
            };

            whatsappPc.oniceconnectionstatechange = () => {
                if (whatsappPc) {
                    console.log(`WhatsApp ICE state: ${whatsappPc.iceConnectionState}`);
                }
            };

            whatsappPc.onconnectionstatechange = () => {
                if (whatsappPc) {
                    console.log(`WhatsApp connection state: ${whatsappPc.connectionState}`);
                }
            };

            // Set remote description (WhatsApp's offer)
            await whatsappPc.setRemoteDescription(new RTCSessionDescription({
                type: "offer",
                sdp: whatsappOfferSdp
            }));
            console.log("✅ WhatsApp offer SDP set as remote description");

            // Wait for WhatsApp audio track
            await trackPromise;
            console.log("✅ WhatsApp audio track received");

            // Create RTCAudioSource for sending audio to WhatsApp
            // IMPORTANT: This must be done BEFORE createAnswer so the track is in the SDP
            audioSource = new RTCAudioSource();
            audioSenderTrack = audioSource.createTrack();
            whatsappPc.addTrack(audioSenderTrack);
            console.log("✅ RTCAudioSource track added to peer connection");

            // Create answer (now includes our outgoing audio track)
            const answer = await whatsappPc.createAnswer();
            await whatsappPc.setLocalDescription(answer);

            // Fix setup attribute for WhatsApp
            const finalSdp = answer.sdp.replace("a=setup:actpass", "a=setup:active");
            console.log("✅ WhatsApp answer SDP prepared (with audio track)");

            resolve();
        } catch (error) {
            console.error("❌ Error in setupWhatsAppWebRTC:", error);
            reject(error);
        }
    });
}

/**
 * Connect to ElevenLabs Conversational AI via WebSocket
 * 
 * KEY ADVANTAGE: ElevenLabs supports Opus at 48kHz - same as WhatsApp!
 * No audio decoding/encoding required!
 */
async function connectToElevenLabs(callerName, callerNumber) {
    return new Promise((resolve, reject) => {
        try {
            // ElevenLabs Conversational AI WebSocket URL
            const wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${ELEVENLABS_AGENT_ID}`;
            console.log(`🔌 Connecting to ElevenLabs WebSocket...`);

            elevenLabsWs = new WebSocket(wsUrl);

            elevenLabsWs.on("open", () => {
                console.log("✅ ElevenLabs WebSocket connected");

                // Simple initialization - ElevenLabs rejects most config overrides
                // The audio format is determined by the agent's dashboard settings
                const initMessage = {
                    type: "conversation_initiation_client_data",
                    custom_llm_extra_body: {
                        caller_name: callerName,
                        caller_number: callerNumber
                    }
                };

                elevenLabsWs.send(JSON.stringify(initMessage));
                console.log("📤 Sent simple init (no config overrides)");

                resolve();
            });

            elevenLabsWs.on("message", (data) => {
                // Handle messages from ElevenLabs
                // Note: ElevenLabs may send JSON as Buffer, not just string

                let messageData;
                if (Buffer.isBuffer(data)) {
                    messageData = data;
                } else {
                    messageData = Buffer.from(data);
                }

                // Check if it's JSON (starts with '{')
                const firstByte = messageData[0];
                const isJson = firstByte === 0x7b; // '{'

                if (isJson) {
                    // Parse as JSON
                    try {
                        const message = JSON.parse(messageData.toString());
                        handleElevenLabsMessage(message);
                    } catch (e) {
                        console.log("📩 Failed to parse JSON:", messageData.toString().substring(0, 100));
                    }
                } else {
                    // Binary audio data
                    const firstBytes = messageData.slice(0, 4).toString('hex');

                    if (elevenLabsAudioCount < 5) {
                        console.log(`🔊 ACTUAL Audio: ${messageData.length} bytes, first bytes: ${firstBytes}`);
                    }

                    handleElevenLabsAudio(messageData);
                }
            });

            elevenLabsWs.on("error", (error) => {
                console.error("❌ ElevenLabs WebSocket error:", error);
                reject(error);
            });

            elevenLabsWs.on("close", (code, reason) => {
                console.log(`📴 ElevenLabs WebSocket closed. Code: ${code}, Reason: ${reason}`);
            });

        } catch (error) {
            console.error("❌ Error connecting to ElevenLabs:", error);
            reject(error);
        }
    });
}

/**
 * Handle control/text messages from ElevenLabs
 */
function handleElevenLabsMessage(message) {

    console.log("📩 ElevenLabs message:", message);
    switch (message.type) {
        case "conversation_initiation_metadata":
            // Correct path: message.conversation_initiation_metadata_event.conversation_id
            conversationId = message.conversation_initiation_metadata_event?.conversation_id || message.conversation_id;
            console.log(`📋 ElevenLabs conversation started: ${conversationId}`);
            console.log(`   Output format: ${message.conversation_initiation_metadata_event?.agent_output_audio_format}`);
            console.log(`   Input format: ${message.conversation_initiation_metadata_event?.user_input_audio_format}`);
            break;

        case "user_transcript":
            // Check both possible paths
            const userText = message.user_transcript_event?.user_transcript || message.user_transcript?.text;
            if (userText) {
                console.log(`🎤 Caller said: "${userText}"`);
            }
            break;

        case "agent_response":
            // Check both possible paths
            const agentText = message.agent_response_event?.agent_response || message.agent_response?.text;
            if (agentText) {
                console.log(`🤖 AI Agent: "${agentText}"`);
            }
            break;

        case "audio":
            // Audio is sent as base64 in JSON messages
            if (message.audio) {
                const audioData = Buffer.from(message.audio, 'base64');
                if (elevenLabsAudioCount < 5) {
                    console.log(`🔊 Audio in JSON: ${audioData.length} bytes (decoded from base64)`);
                }
                handleElevenLabsAudio(audioData);
            } else if (message.audio_event?.audio_base_64) {
                const audioData = Buffer.from(message.audio_event.audio_base_64, 'base64');
                if (elevenLabsAudioCount < 5) {
                    console.log(`🔊 Audio event: ${audioData.length} bytes (decoded from base64)`);
                }
                handleElevenLabsAudio(audioData);
            }
            break;

        case "ping":
            // Respond to keep-alive pings with matching event_id
            if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                const pingEventId = message.ping_event?.event_id;
                const pongMessage = {
                    type: "pong",
                    event_id: pingEventId
                };
                elevenLabsWs.send(JSON.stringify(pongMessage));
                console.log(`🏓 Sent pong for event_id: ${pingEventId}`);
            }
            break;

        case "interruption":
            console.log("🔇 User interrupted the agent");
            break;

        case "agent_response_correction":
            console.log("🔄 Agent response corrected");
            break;

        default:
            console.log(`📩 ElevenLabs message type: ${message.type}`);
    }
}

// Buffer for ElevenLabs audio (to send in correct frame sizes)
let elevenLabsAudioBuffer = new Int16Array(0);
const FRAME_SIZE = 480; // 10ms at 48kHz
let audioPlaybackTimer = null; // Timer for paced audio playback

/**
 * Start paced audio playback - sends frames at 10ms intervals for real-time speed
 */
function startAudioPlayback() {
    // Already running
    if (audioPlaybackTimer) {
        return;
    }

    // Send frames at 10ms intervals (real-time playback)
    audioPlaybackTimer = setInterval(() => {
        if (!audioSource) {
            return;
        }

        // Send one frame per tick
        if (elevenLabsAudioBuffer.length >= FRAME_SIZE) {
            const frame = elevenLabsAudioBuffer.slice(0, FRAME_SIZE);
            elevenLabsAudioBuffer = elevenLabsAudioBuffer.slice(FRAME_SIZE);

            audioSource.onData({
                samples: frame,
                sampleRate: WHATSAPP_SAMPLE_RATE,
                bitsPerSample: 16,
                channelCount: 1,
                numberOfFrames: FRAME_SIZE
            });
        } else if (elevenLabsAudioBuffer.length === 0) {
            // Buffer empty, stop timer until more audio arrives
            clearInterval(audioPlaybackTimer);
            audioPlaybackTimer = null;
        }
    }, 7); // 10ms = real-time for 480 samples at 48kHz
}

/**
 * μ-law to linear PCM decoder (kept for backwards compatibility)
 */
const MULAW_DECODE_TABLE = new Int16Array(256);
(function initMulawTable() {
    for (let i = 0; i < 256; i++) {
        let mulaw = ~i;
        let sign = (mulaw & 0x80) ? -1 : 1;
        let exponent = (mulaw >> 4) & 0x07;
        let mantissa = mulaw & 0x0F;
        let sample = ((mantissa << 3) + 0x84) << exponent;
        sample = (sample - 0x84) * sign;
        MULAW_DECODE_TABLE[i] = sample;
    }
})();

function decodeMulaw(mulawData) {
    const pcmSamples = new Int16Array(mulawData.length);
    for (let i = 0; i < mulawData.length; i++) {
        pcmSamples[i] = MULAW_DECODE_TABLE[mulawData[i]];
    }
    return pcmSamples;
}

/**
 * Handle audio data from ElevenLabs
 * 
 * We configured ElevenLabs to send PCM 16kHz (output_format: pcm_16000)
 * Binary data is raw 16-bit PCM samples
 * Upsample to 48kHz for WhatsApp
 */
let elevenLabsAudioCount = 0;

function handleElevenLabsAudio(audioData) {
    try {
        if (!audioSource) {
            console.log("⚠️ No audioSource - skipping ElevenLabs audio");
            return;
        }

        elevenLabsAudioCount++;

        // Get buffer data
        let pcmData;
        if (Buffer.isBuffer(audioData)) {
            pcmData = audioData;
        } else {
            pcmData = Buffer.from(audioData, 'base64');
        }

        // Log audio info periodically
        if (elevenLabsAudioCount % 20 === 1) {
            console.log(`🔊 ElevenLabs audio #${elevenLabsAudioCount}: ${pcmData.length} bytes (PCM 48kHz - direct!)`);
        }

        // Ensure even byte length for 16-bit samples
        if (pcmData.length % 2 !== 0) {
            pcmData = pcmData.slice(0, pcmData.length - 1);
        }

        if (pcmData.length < 2) {
            return;
        }

        // Copy to aligned buffer and convert to Int16Array
        const alignedBuffer = Buffer.alloc(pcmData.length);
        pcmData.copy(alignedBuffer);

        // ElevenLabs sends PCM 48kHz - same as WhatsApp! No upsampling needed!
        const samples48k = new Int16Array(alignedBuffer.buffer, alignedBuffer.byteOffset, alignedBuffer.length / 2);

        // Add to playback buffer (global buffer for paced playback)
        const newBuffer = new Int16Array(elevenLabsAudioBuffer.length + samples48k.length);
        newBuffer.set(elevenLabsAudioBuffer);
        newBuffer.set(samples48k, elevenLabsAudioBuffer.length);
        elevenLabsAudioBuffer = newBuffer;

        // Start the playback timer if not already running
        startAudioPlayback();

    } catch (error) {
        console.error("❌ Error handling ElevenLabs audio:", error.message);
    }
}

/**
 * Setup bidirectional audio bridge between WhatsApp and ElevenLabs
 * 
 * Uses RTCAudioSink to extract raw PCM audio from WebRTC
 * Audio is resampled from 48kHz to 16kHz for ElevenLabs
 */
function setupAudioBridge() {
    console.log("🌉 Setting up audio bridge with RTCAudioSink...");

    try {
        // Get audio tracks from WhatsApp
        const audioTracks = whatsappStream.getAudioTracks();
        console.log(`📊 WhatsApp has ${audioTracks.length} audio track(s)`);

        if (audioTracks.length > 0) {
            const audioTrack = audioTracks[0];
            console.log(`✅ Audio track found: ${audioTrack.kind}, enabled: ${audioTrack.enabled}`);

            // Create RTCAudioSink to extract audio from the track
            audioSink = new RTCAudioSink(audioTrack);

            let sampleCount = 0;
            let audioBuffer = Buffer.alloc(0);
            const CHUNK_SIZE = 4000; // ~250ms of audio at 16kHz mono (16-bit)

            audioSink.ondata = (data) => {
                // data contains:
                // - samples: Int16Array of audio samples
                // - sampleRate: number (usually 48000)
                // - bitsPerSample: number (usually 16)
                // - channelCount: number (1 for mono, 2 for stereo)
                // - numberOfFrames: number

                if (!elevenLabsWs || elevenLabsWs.readyState !== WebSocket.OPEN) {
                    return;
                }

                sampleCount++;

                // Log every 100 chunks to avoid spam
                if (sampleCount % 100 === 1) {
                    console.log(`🎤 Audio chunk #${sampleCount}: ${data.samples.length} samples @ ${data.sampleRate}Hz, ${data.channelCount}ch`);
                }

                try {
                    // Get PCM samples
                    const samples = data.samples;
                    const sampleRate = data.sampleRate || 48000;
                    const channels = data.channelCount || 1;

                    // Resample from 48kHz to 16kHz if needed
                    let resampledSamples;
                    if (sampleRate === 48000 && ELEVENLABS_SAMPLE_RATE === 16000) {
                        // Simple downsampling: take every 3rd sample (48000/16000 = 3)
                        const ratio = sampleRate / ELEVENLABS_SAMPLE_RATE;
                        const newLength = Math.floor(samples.length / ratio / channels);
                        resampledSamples = new Int16Array(newLength);

                        for (let i = 0; i < newLength; i++) {
                            // If stereo, take left channel; otherwise just downsample
                            const srcIndex = Math.floor(i * ratio) * channels;
                            resampledSamples[i] = samples[srcIndex];
                        }
                    } else {
                        // No resampling needed or different sample rate
                        resampledSamples = samples;
                    }

                    // Convert Int16Array to Buffer
                    const buffer = Buffer.from(resampledSamples.buffer);

                    // Accumulate audio chunks
                    audioBuffer = Buffer.concat([audioBuffer, buffer]);

                    // Send when we have enough audio (avoid sending too frequently)
                    if (audioBuffer.length >= CHUNK_SIZE) {
                        sendAudioToElevenLabs(audioBuffer);
                        audioBuffer = Buffer.alloc(0);
                    }

                } catch (err) {
                    console.error("❌ Error processing audio chunk:", err.message);
                }
            };

            console.log("✅ RTCAudioSink created and listening for audio");
            console.log(`🔄 Will resample from ${WHATSAPP_SAMPLE_RATE}Hz to ${ELEVENLABS_SAMPLE_RATE}Hz`);

            // Note: Audio source is already created in setupWhatsAppWebRTC before createAnswer
            console.log("✅ Audio bridge ready (audioSource already configured)");

        } else {
            console.warn("⚠️ No audio tracks found from WhatsApp");
        }

    } catch (error) {
        console.error("❌ Error in setupAudioBridge:", error);
    }
}

// Note: setupAudioSource is now done in setupWhatsAppWebRTC before createAnswer

/**
 * Send audio from WhatsApp to ElevenLabs
 * 
 * ElevenLabs Conversational AI accepts audio as base64 in JSON
 * Note: audioSendCount is declared at top of file
 */
function sendAudioToElevenLabs(audioData) {
    if (!elevenLabsWs || elevenLabsWs.readyState !== WebSocket.OPEN) {
        return;
    }

    audioSendCount++;

    // Log first few sends
    if (audioSendCount <= 3) {
        console.log(`📤 Sending audio to ElevenLabs: ${audioData.length} bytes`);
    }

    // ElevenLabs Conversational AI expects audio in this format
    const audioMessage = {
        user_audio_chunk: audioData.toString('base64')
    };

    try {
        elevenLabsWs.send(JSON.stringify(audioMessage));
    } catch (err) {
        console.error("❌ Error sending audio:", err.message);
    }
}

/**
 * AiSensy API Functions
 */

// Pre-accept incoming call
async function preAcceptCall(callId, sdp, callbackData = null) {
    const body = {
        callId,
        sdp,
        ...(callbackData && { callbackData })
    };

    try {
        const url = `${AISENSY_BASE_URL}/project/${PROJECT_ID}/wa-calling/call/pre-accept`;
        const response = await axios.post(url, body, { headers: AISENSY_HEADERS });

        if (response.data.success) {
            console.log(`Call ${callId} pre-accepted successfully.`);
            return true;
        }

        return false;
    } catch (error) {
        console.error("Failed to pre-accept call:", error.message);
        return false;
    }
}

// Accept incoming call
async function acceptCall(callId, sdp, callbackData = null) {
    const body = {
        callId,
        sdp,
        ...(callbackData && { callbackData })
    };

    try {
        const url = `${AISENSY_BASE_URL}/project/${PROJECT_ID}/wa-calling/call/accept`;
        const response = await axios.post(url, body, { headers: AISENSY_HEADERS });

        if (response.data.success) {
            console.log(`Call ${callId} accepted successfully.`);
            return true;
        }

        return false;
    } catch (error) {
        console.error("Failed to accept call:", error.message);
        return false;
    }
}

// Cleanup all connections
function cleanupConnections() {
    console.log("🧹 Cleaning up connections...");

    // Stop audio sink
    if (audioSink) {
        audioSink.stop();
        audioSink = null;
    }

    // Stop audio source track
    if (audioSenderTrack) {
        audioSenderTrack.stop();
        audioSenderTrack = null;
    }
    audioSource = null;

    if (whatsappPc) {
        whatsappPc.close();
        whatsappPc = null;
    }

    if (elevenLabsWs) {
        elevenLabsWs.close();
        elevenLabsWs = null;
    }

    whatsappStream = null;
    whatsappOfferSdp = null;
    currentCallId = null;
    conversationId = null;

    console.log("✅ All connections cleaned up");
}

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('⚠️ SIGTERM received, cleaning up...');
    cleanupConnections();
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('⚠️ SIGINT received, cleaning up...');
    cleanupConnections();
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

// Start the server
const PORT = process.env.PORT || 19000;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`========================================`);
    console.log(`🚀 AiSensy + ElevenLabs AI Call Server`);
    console.log(`========================================`);
    console.log(`✅ Server running at http://0.0.0.0:${PORT}`);
    console.log(`📥 Webhook endpoint: /aisensy-webhook`);
    console.log(`🤖 AI Agent: ElevenLabs Conversational AI`);
    console.log(`🔊 Audio: Opus 48kHz (native support)`);
    console.log(`📞 Mode: Fully Automated Server-Side`);
    console.log(`========================================`);
    console.log(`⚙️  Agent ID: ${ELEVENLABS_AGENT_ID ? '✅ Configured' : '❌ Missing'}`);
    console.log(`🔑 API Key: ${ELEVENLABS_API_KEY ? '✅ Configured' : '❌ Missing'}`);
    console.log(`========================================`);
});
