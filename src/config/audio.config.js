/**
 * Audio Configuration
 * 
 * Sample rates for WhatsApp WebRTC and ElevenLabs Conversational AI
 */

// Audio configuration
// - WhatsApp WebRTC: 48kHz PCM (both input and output)
// - ElevenLabs INPUT: 16kHz PCM (user audio sent to AI)
// - ElevenLabs OUTPUT: 48kHz PCM (AI audio, direct to WhatsApp - no conversion!)
const ELEVENLABS_INPUT_SAMPLE_RATE = 16000;  // For sending user audio TO ElevenLabs
const WHATSAPP_SAMPLE_RATE = 48000;           // WhatsApp and ElevenLabs output both use 48kHz

// Frame size for audio playback (10ms at 48kHz)
const FRAME_SIZE = 480;

// Chunk size for sending audio to ElevenLabs (~250ms of audio at 16kHz mono 16-bit)
const CHUNK_SIZE = 4000;

module.exports = {
    ELEVENLABS_INPUT_SAMPLE_RATE,
    WHATSAPP_SAMPLE_RATE,
    FRAME_SIZE,
    CHUNK_SIZE
};
