/**
 * Audio Playback Module
 * 
 * Handles buffering and paced playback of audio from ElevenLabs to WhatsApp
 */

const { WHATSAPP_SAMPLE_RATE, FRAME_SIZE } = require('../config');
const session = require('../state/session');

// Buffer for ElevenLabs audio (to send in correct frame sizes)
let elevenLabsAudioBuffer = new Int16Array(0);
let audioPlaybackTimer = null; // Timer for paced audio playback
let elevenLabsAudioCount = 0;

/**
 * Get audio count (for logging)
 */
const getElevenLabsAudioCount = () => elevenLabsAudioCount;
const incrementElevenLabsAudioCount = () => { elevenLabsAudioCount++; };
const resetElevenLabsAudioCount = () => { elevenLabsAudioCount = 0; };

/**
 * Start paced audio playback - sends frames at 10ms intervals for real-time speed
 */
function startAudioPlayback() {
    // Already running
    if (audioPlaybackTimer) {
        return;
    }

    const audioSource = session.getAudioSource();

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
    }, 10); // 10ms = real-time for 480 samples at 48kHz
}

/**
 * Add samples to playback buffer
 */
function addToPlaybackBuffer(samples) {
    const newBuffer = new Int16Array(elevenLabsAudioBuffer.length + samples.length);
    newBuffer.set(elevenLabsAudioBuffer);
    newBuffer.set(samples, elevenLabsAudioBuffer.length);
    elevenLabsAudioBuffer = newBuffer;
}

/**
 * Reset playback state
 */
function resetPlayback() {
    if (audioPlaybackTimer) {
        clearInterval(audioPlaybackTimer);
        audioPlaybackTimer = null;
    }
    elevenLabsAudioBuffer = new Int16Array(0);
    elevenLabsAudioCount = 0;
}

module.exports = {
    startAudioPlayback,
    addToPlaybackBuffer,
    resetPlayback,
    getElevenLabsAudioCount,
    incrementElevenLabsAudioCount,
    resetElevenLabsAudioCount
};
