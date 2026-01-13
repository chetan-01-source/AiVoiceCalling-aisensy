require("dotenv").config();
const express = require("express");
const axios = require("axios");
const path = require("path");
const http = require("http");
const socketIO = require("socket.io");
const {
    RTCPeerConnection,
    RTCSessionDescription,
    RTCIceCandidate,
    MediaStream,
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

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Health check route
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "OK",
        message: "AiSensy WhatsApp Calling Server is running",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || "development"
    });
});

// State variables per call session
let browserPc = null;
let browserStream = null;
let whatsappPc = null;
let whatsappStream = null;
let browserOfferSdp = null;
let whatsappOfferSdp = null;
let browserSocket = null;
let currentCallId = null;

/**
 * Socket.IO connection from browser client.
 */
io.on("connection", (socket) => {
    console.log(`Socket.IO connection established with browser: ${socket.id}`);

    // SDP offer from browser
    socket.on("browser-offer", async (sdp) => {
        console.log("Received SDP offer from browser.");
        browserOfferSdp = sdp;
        browserSocket = socket;
        await initiateWebRTCBridge();
    });

    // ICE candidate from browser
    socket.on("browser-candidate", async (candidate) => {
        if (!browserPc) {
            console.warn("Cannot add ICE candidate: browser peer connection not initialized.");
            return;
        }

        try {
            await browserPc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
            console.error("Failed to add ICE candidate from browser:", err);
        }
    });

    // Reject call from browser
    socket.on("reject-call", async (callId) => {
        const result = await rejectCall(callId);
        console.log("Reject call response:", result);
    });

    // Terminate call from browser
    socket.on("terminate-call", async (callId) => {
        const result = await terminateCall(callId);
        console.log("Terminate call response:", result);
    });

    // Initiate outbound call
    socket.on("initiate-call", async ({ to, callbackData }) => {
        if (!browserOfferSdp) {
            socket.emit("call-error", { error: "Browser SDP not ready" });
            return;
        }

        const result = await initiateCall(to, browserOfferSdp, callbackData);
        if (result.success) {
            currentCallId = result.calls[0].id;
            socket.emit("call-initiated", { callId: currentCallId });
        } else {
            socket.emit("call-error", { error: "Failed to initiate call" });
        }
    });

    // Check call permissions
    socket.on("check-permissions", async (userNumber) => {
        const permissions = await getCallPermissions(userNumber);
        socket.emit("permissions-status", permissions);
    });
});

/**
 * AiSensy Webhook - handles all call events
 * This replaces Meta's /call-events endpoint
 */
app.post("/aisensy-webhook", async (req, res) => {
    try {
        console.log("Received AiSensy webhook:", JSON.stringify(req.body, null, 2));

        const { topic, data } = req.body;

        if (!topic || !data || !data.call) {
            console.warn("Received invalid webhook payload.");
            return res.sendStatus(200);
        }

        const call = data.call;
        const callId = call.wa_call_id;
        currentCallId = callId;

        // Handle different webhook topics
        switch (topic) {
            case "call.connect":
                // Incoming call - user initiated
                console.log(`Incoming call from ${call.user_number}`);

                // Extract SDP from connection object
                if (call.connection && call.connection.sdp) {
                    whatsappOfferSdp = call.connection.sdp;
                }

                io.emit("call-is-coming", {
                    callId: callId,
                    callerName: call.caller || "Unknown",
                    callerNumber: call.user_number,
                    callType: call.type
                });

                await initiateWebRTCBridge();
                break;

            case "call.status":
                // Call status updates
                console.log(`Call status update: ${call.status}`);
                io.emit("call-status-update", {
                    callId: callId,
                    status: call.status,
                    duration: call.duration,
                    timestamps: {
                        ringing: call.ringing_at,
                        accepted: call.accepted_at,
                        preAccept: call.pre_accept_at
                    }
                });
                break;

            case "call.terminated":
                // Call ended
                console.log(`Call terminated. Duration: ${call.duration}s`);
                io.emit("call-ended", {
                    callId: callId,
                    duration: call.duration,
                    billedAmount: call.billed_amount,
                    recordingUrl: call.recording_url,
                    transcriptUrl: call.transcript_url,
                    callSummary: call.call_summary
                });

                // Cleanup
                cleanupPeerConnections();
                break;

            default:
                console.log(`Unhandled webhook topic: ${topic}`);
        }

        res.sendStatus(200);
    } catch (err) {
        console.error("Error processing AiSensy webhook:", err);
        res.sendStatus(500);
    }
});

/**
 * Handle call permission replies from users
 */
app.post("/aisensy-message-webhook", async (req, res) => {
    try {
        const messages = req.body.messages || [];

        for (const msg of messages) {
            if (msg.interactive && msg.interactive.type === "call_permission_reply") {
                const reply = msg.interactive.call_permission_reply;

                console.log(`Call permission ${reply.response} from user`);
                io.emit("permission-reply", {
                    response: reply.response,
                    isPermanent: reply.is_permanent,
                    expirationTimestamp: reply.expiration_timestamp,
                    responseSource: reply.response_source
                });
            }
        }

        res.sendStatus(200);
    } catch (err) {
        console.error("Error processing message webhook:", err);
        res.sendStatus(500);
    }
});

/**
 * Initiates WebRTC between browser and WhatsApp once both SDP offers are received.
 */
async function initiateWebRTCBridge() {
    if (!browserOfferSdp || !whatsappOfferSdp || !browserSocket) {
        console.log("⏳ Waiting for both SDPs...", {
            browserReady: !!browserOfferSdp,
            whatsappReady: !!whatsappOfferSdp,
            socketReady: !!browserSocket
        });
        return;
    }

    console.log("🌉 Both SDPs ready, establishing WebRTC bridge...");

    try {
        // --- Setup browser peer connection ---
        browserPc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        browserStream = new MediaStream();

        browserPc.ontrack = (event) => {
            console.log("🎤 Audio track received from browser.");
            event.streams[0].getTracks().forEach((track) => {
                browserStream.addTrack(track);
                console.log(`Added track: ${track.kind}, enabled: ${track.enabled}`);
            });
        };

        browserPc.onicecandidate = (event) => {
            if (event.candidate) {
                browserSocket.emit("browser-candidate", event.candidate);
                console.log("📤 Sent ICE candidate to browser");
            }
        };

        browserPc.oniceconnectionstatechange = () => {
            console.log(`Browser ICE state: ${browserPc.iceConnectionState}`);
        };

        browserPc.onconnectionstatechange = () => {
            console.log(`Browser connection state: ${browserPc.connectionState}`);
        };

        await browserPc.setRemoteDescription(new RTCSessionDescription({
            type: "offer",
            sdp: browserOfferSdp
        }));
        console.log("✅ Browser offer SDP set as remote description.");

        // --- Setup WhatsApp peer connection ---
        whatsappPc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

        const waTrackPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error("Timed out waiting for WhatsApp track"));
            }, 10000);

            whatsappPc.ontrack = (event) => {
                clearTimeout(timeout);
                console.log("📞 Audio track received from WhatsApp.");
                whatsappStream = event.streams[0];
                event.streams[0].getTracks().forEach((track) => {
                    console.log(`WhatsApp track: ${track.kind}, enabled: ${track.enabled}`);
                });
                resolve();
            };
        });

        whatsappPc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log("WhatsApp ICE candidate generated");
            }
        };

        whatsappPc.oniceconnectionstatechange = () => {
            console.log(`WhatsApp ICE state: ${whatsappPc.iceConnectionState}`);
        };

        whatsappPc.onconnectionstatechange = () => {
            console.log(`WhatsApp connection state: ${whatsappPc.connectionState}`);
        };

        await whatsappPc.setRemoteDescription(new RTCSessionDescription({
            type: "offer",
            sdp: whatsappOfferSdp
        }));
        console.log("✅ WhatsApp offer SDP set as remote description.");

        // Forward browser mic to WhatsApp
        const browserTracks = browserStream.getAudioTracks();
        console.log(`Browser has ${browserTracks.length} audio tracks`);

        browserTracks.forEach((track) => {
            whatsappPc.addTrack(track, browserStream);
            console.log(`✅ Forwarded browser audio track to WhatsApp`);
        });

        // Wait for WhatsApp to send audio
        console.log("⏳ Waiting for WhatsApp audio track...");
        await waTrackPromise;
        console.log("✅ WhatsApp audio track received");

        // Forward WhatsApp audio to browser
        const whatsappTracks = whatsappStream.getAudioTracks();
        console.log(`WhatsApp has ${whatsappTracks.length} audio tracks`);

        whatsappTracks.forEach((track) => {
            browserPc.addTrack(track, whatsappStream);
            console.log(`✅ Forwarded WhatsApp audio track to browser`);
        });

        // --- Create SDP answers for both peers ---
        const browserAnswer = await browserPc.createAnswer();
        await browserPc.setLocalDescription(browserAnswer);
        browserSocket.emit("browser-answer", browserAnswer.sdp);
        console.log("✅ Browser answer SDP created and sent.");

        const waAnswer = await whatsappPc.createAnswer();
        await whatsappPc.setLocalDescription(waAnswer);
        const finalWaSdp = waAnswer.sdp.replace("a=setup:actpass", "a=setup:active");
        console.log("✅ WhatsApp answer SDP prepared.");

        // Send pre-accept via AiSensy
        console.log("📤 Sending pre-accept to AiSensy...");
        const preAcceptSuccess = await preAcceptCall(currentCallId, finalWaSdp);

        if (preAcceptSuccess) {
            console.log("✅ Pre-accept successful, waiting 1s before accept...");
            setTimeout(async () => {
                console.log("📤 Sending accept to AiSensy...");
                const acceptSuccess = await acceptCall(currentCallId, finalWaSdp);

                if (acceptSuccess && browserSocket) {
                    console.log("✅ Call accepted! Starting call timer...");
                    browserSocket.emit("start-browser-timer");
                } else {
                    console.error("❌ Accept failed!");
                }
            }, 1000);
        } else {
            console.error("❌ Pre-accept failed. Aborting accept step.");
        }

        // Reset session state
        browserOfferSdp = null;
        whatsappOfferSdp = null;

        console.log("🎉 WebRTC bridge setup complete!");

    } catch (error) {
        console.error("❌ Error in initiateWebRTCBridge:", error);
        cleanupPeerConnections();
        if (browserSocket) {
            browserSocket.emit("call-error", { error: error.message });
        }
    }
}

/**
 * AiSensy API Functions
 */

// Get call settings
async function getCallSettings(includeSipCredentials = false) {
    try {
        const url = `${AISENSY_BASE_URL}/project/${PROJECT_ID}/wa-calling/settings?includeSipCredentials=${includeSipCredentials}`;
        const response = await axios.get(url, { headers: AISENSY_HEADERS });
        return response.data;
    } catch (error) {
        console.error("Failed to get call settings:", error.message);
        return null;
    }
}

// Update call settings
async function updateCallSettings(settings) {
    try {
        const url = `${AISENSY_BASE_URL}/project/${PROJECT_ID}/wa-calling/settings`;
        const response = await axios.put(url, settings, { headers: AISENSY_HEADERS });
        return response.data;
    } catch (error) {
        console.error("Failed to update call settings:", error.message);
        return null;
    }
}

// Get calling permissions for a user
async function getCallPermissions(userNumber) {
    try {
        const url = `${AISENSY_BASE_URL}/project/${PROJECT_ID}/wa-calling/call/permission?userNumber=${userNumber}`;
        const response = await axios.get(url, { headers: AISENSY_HEADERS });
        return response.data;
    } catch (error) {
        console.error("Failed to get call permissions:", error.message);
        return null;
    }
}

// Initiate a business-initiated call
async function initiateCall(to, sdp, callbackData = null) {
    const body = {
        to,
        sdp,
        ...(callbackData && { callbackData })
    };

    try {
        const url = `${AISENSY_BASE_URL}/project/${PROJECT_ID}/wa-calling/call/initiate`;
        const response = await axios.post(url, body, { headers: AISENSY_HEADERS });

        if (response.data.success) {
            console.log(`Call initiated successfully to ${to}`);
        }

        return response.data;
    } catch (error) {
        console.error("Failed to initiate call:", error.message);
        return { success: false, error: error.message };
    }
}

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

// Reject incoming call
async function rejectCall(callId) {
    const body = { callId };

    try {
        const url = `${AISENSY_BASE_URL}/project/${PROJECT_ID}/wa-calling/call/reject`;
        const response = await axios.post(url, body, { headers: AISENSY_HEADERS });

        if (response.data.success) {
            console.log(`Call ${callId} rejected successfully.`);
        }

        return response.data;
    } catch (error) {
        console.error("Failed to reject call:", error.message);
        return { success: false, error: error.message };
    }
}

// Terminate ongoing call
async function terminateCall(callId) {
    const body = { callId };

    try {
        const url = `${AISENSY_BASE_URL}/project/${PROJECT_ID}/wa-calling/call/terminate`;
        const response = await axios.post(url, body, { headers: AISENSY_HEADERS });

        if (response.data.success) {
            console.log(`Call ${callId} terminated successfully.`);
        }

        cleanupPeerConnections();
        return response.data;
    } catch (error) {
        console.error("Failed to terminate call:", error.message);
        return { success: false, error: error.message };
    }
}

// Cleanup peer connections
function cleanupPeerConnections() {
    if (browserPc) {
        browserPc.close();
        browserPc = null;
    }

    if (whatsappPc) {
        whatsappPc.close();
        whatsappPc = null;
    }

    browserStream = null;
    whatsappStream = null;
    currentCallId = null;
}

// Start the server
const PORT = process.env.PORT || 19000;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`AiSensy WhatsApp Calling Server is running at http://0.0.0.0:${PORT}`);
    console.log(`Webhook endpoint: http://0.0.0.0:${PORT}/aisensy-webhook`);
});