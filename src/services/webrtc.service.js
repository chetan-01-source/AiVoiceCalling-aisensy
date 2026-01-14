/**
 * WebRTC Service
 * 
 * Handles WhatsApp WebRTC peer connection setup
 */

const {
    RTCPeerConnection,
    RTCSessionDescription,
    MediaStream,
    nonstandard: { RTCAudioSource }
} = require('@roamhq/wrtc');

const { ICE_SERVERS } = require('../config');
const session = require('../state/session');

/**
 * Setup WhatsApp WebRTC peer connection
 */
async function setupWhatsAppWebRTC() {
    return new Promise(async (resolve, reject) => {
        try {
            const whatsappPc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
            session.setWhatsappPc(whatsappPc);
            session.setWhatsappStream(new MediaStream());

            // Track received from WhatsApp
            const trackPromise = new Promise((resolveTrack, rejectTrack) => {
                const timeout = setTimeout(() => {
                    rejectTrack(new Error("Timed out waiting for WhatsApp track"));
                }, 10000);

                whatsappPc.ontrack = (event) => {
                    clearTimeout(timeout);
                    console.log("📞 Audio track received from WhatsApp");
                    session.setWhatsappStream(event.streams[0]);
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
                const pc = session.getWhatsappPc();
                if (pc) {
                    console.log(`WhatsApp ICE state: ${pc.iceConnectionState}`);
                }
            };

            whatsappPc.onconnectionstatechange = () => {
                const pc = session.getWhatsappPc();
                if (pc) {
                    console.log(`WhatsApp connection state: ${pc.connectionState}`);
                }
            };

            // Set remote description (WhatsApp's offer)
            const whatsappOfferSdp = session.getWhatsappOfferSdp();
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
            const audioSource = new RTCAudioSource();
            session.setAudioSource(audioSource);

            const audioSenderTrack = audioSource.createTrack();
            session.setAudioSenderTrack(audioSenderTrack);

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

module.exports = {
    setupWhatsAppWebRTC
};
