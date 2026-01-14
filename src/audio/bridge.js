/**
 * Audio Bridge Module
 * 
 * Sets up bidirectional audio flow between WhatsApp and ElevenLabs
 * - WhatsApp → ElevenLabs: Downsample 48kHz to 16kHz
 * - ElevenLabs → WhatsApp: Direct 48kHz passthrough
 */

const WebSocket = require('ws');
const { nonstandard: { RTCAudioSink } } = require('@roamhq/wrtc');

const { WHATSAPP_SAMPLE_RATE, ELEVENLABS_INPUT_SAMPLE_RATE, CHUNK_SIZE } = require('../config');
const session = require('../state/session');

/**
 * Setup bidirectional audio bridge between WhatsApp and ElevenLabs
 * 
 * - WhatsApp → ElevenLabs: Downsample 48kHz to 16kHz (ElevenLabs input requirement)
 * - ElevenLabs → WhatsApp: Direct 48kHz passthrough (no conversion needed!)
 */
function setupAudioBridge() {
    console.log("🌉 Setting up audio bridge with RTCAudioSink...");

    try {
        // Get audio tracks from WhatsApp
        const whatsappStream = session.getWhatsappStream();
        const audioTracks = whatsappStream.getAudioTracks();
        console.log(`📊 WhatsApp has ${audioTracks.length} audio track(s)`);

        if (audioTracks.length > 0) {
            const audioTrack = audioTracks[0];
            console.log(`✅ Audio track found: ${audioTrack.kind}, enabled: ${audioTrack.enabled}`);

            // Create RTCAudioSink to extract audio from the track
            const audioSink = new RTCAudioSink(audioTrack);
            session.setAudioSink(audioSink);

            let sampleCount = 0;
            let audioBuffer = Buffer.alloc(0);

            audioSink.ondata = (data) => {
                // data contains:
                // - samples: Int16Array of audio samples
                // - sampleRate: number (usually 48000)
                // - bitsPerSample: number (usually 16)
                // - channelCount: number (1 for mono, 2 for stereo)
                // - numberOfFrames: number

                const elevenLabsWs = session.getElevenLabsWs();
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

                    // Downsample from 48kHz to 16kHz for ElevenLabs input
                    let resampledSamples;
                    if (sampleRate === 48000 && ELEVENLABS_INPUT_SAMPLE_RATE === 16000) {
                        // Simple downsampling: take every 3rd sample (48000/16000 = 3)
                        const ratio = sampleRate / ELEVENLABS_INPUT_SAMPLE_RATE;
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
            console.log(`🔄 Will downsample from ${WHATSAPP_SAMPLE_RATE}Hz to ${ELEVENLABS_INPUT_SAMPLE_RATE}Hz for ElevenLabs input`);

            // Note: Audio source is already created in setupWhatsAppWebRTC before createAnswer
            console.log("✅ Audio bridge ready (audioSource already configured)");

        } else {
            console.warn("⚠️ No audio tracks found from WhatsApp");
        }

    } catch (error) {
        console.error("❌ Error in setupAudioBridge:", error);
    }
}

/**
 * Send audio from WhatsApp to ElevenLabs
 * 
 * ElevenLabs Conversational AI accepts audio as base64 in JSON
 */
function sendAudioToElevenLabs(audioData) {
    const elevenLabsWs = session.getElevenLabsWs();

    if (!elevenLabsWs || elevenLabsWs.readyState !== WebSocket.OPEN) {
        return;
    }

    session.incrementAudioSendCount();
    const audioSendCount = session.getAudioSendCount();

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

module.exports = {
    setupAudioBridge,
    sendAudioToElevenLabs
};
