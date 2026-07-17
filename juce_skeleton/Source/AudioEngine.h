#pragma once

#if defined(JUCE_GLOBAL_MODULE_SETTINGS_INCLUDED) || __has_include(<JuceHeader.h>)
#define USE_JUCE 1
#include <JuceHeader.h>
#else
#define USE_JUCE 0
#endif

#include <iostream>
#include <vector>
#include <string>
#include <memory>
#include "Logging.h"
#include <mutex>
#include <atomic>
#include <condition_variable>
#include <deque>
#include <map>
#include <thread>
#include <functional>
#include <algorithm>
#include <cmath>
#include <utility>
#include <array>

#if USE_JUCE
#include "SoundTouch.h"
#include <juce_dsp/juce_dsp.h>

class InputRecorder : public juce::AudioIODeviceCallback
{
public:
    struct PeakPoint { juce::int64 endSample = 0; float min = 0.0f; float max = 0.0f; };
    InputRecorder() : writerThread("FocusDAW Recording Writer") { writerThread.startThread(); }
    ~InputRecorder() override { stop(); writerThread.stopThread(3000); }

    bool start(const juce::File& file, double sampleRate, int inputChannel, bool stereo,
               float gain, bool monitor, bool limiter);
    void configureInput(int inputChannel, bool stereo)
    {
        channel.store(juce::jmax(0, inputChannel));
        channelCount.store(stereo ? 2 : 1);
    }
    void setInputGain(float gain) { inputGain.store(juce::jlimit(0.1f, 4.0f, gain)); }
    void stop();
    void cancel();
    bool isRecording() const { return recording.load(); }
    float getLevel() const { return level.load(); }
    // Limiter gain reduction as a positive dB amount (0 = no reduction).
    float getGainReduction() const { return gainReduction.load(); }
    juce::int64 getSamplesWritten() const { return samplesWritten.load(); }
    // Sample rate the current take is actually being written at (== WAV header
    // rate). The live recording peaks must be timed with THIS, not the cached
    // engine sample rate, or the on-screen record bar drifts when the input
    // device runs at a different rate than the output device.
    double getRecordingSampleRate() const { return recordingSampleRate.load(); }
    std::vector<PeakPoint> drainPeaks();

    void audioDeviceIOCallbackWithContext(const float* const* input, int numInputs,
        float* const* output, int numOutputs, int numSamples,
        const juce::AudioIODeviceCallbackContext&) override;
    void audioDeviceAboutToStart(juce::AudioIODevice*) override {}
    void audioDeviceStopped() override {}

private:
    juce::TimeSliceThread writerThread;
    std::unique_ptr<juce::AudioFormatWriter::ThreadedWriter> threadedWriter;
    juce::File recordingFile;
    std::mutex writerMutex;
    std::atomic<bool> recording { false };
    std::atomic<float> level { 0.0f };
    std::atomic<float> gainReduction { 0.0f };   // limiter GR meter (positive dB)
    std::atomic<juce::int64> samplesWritten { 0 };
    std::atomic<double> recordingSampleRate { 44100.0 };
    std::atomic<int> channel { 0 };
    std::atomic<int> channelCount { 1 };
    std::atomic<float> inputGain { 1.0f };
    float currentInputGain = 1.0f; // audio callback thread only; ramp start
    bool monitoring = false;
    bool limiterOn = true;
    static constexpr int peakCapacity = 4096;
    std::array<PeakPoint, peakCapacity> peakRing {};
    std::atomic<unsigned int> peakWrite { 0 };
    std::atomic<unsigned int> peakRead { 0 };
};
#endif

struct TrackInfo
{
    std::string id;
    std::string filePath;
    float volume = 1.0f;
    float pan = 0.0f;
    bool mute = false;
    bool solo = false;
    // Loads are asynchronous, so params/automation can arrive while the file is
    // still decoding. They are kept here and applied when the JUCE track is built.
    float reverbSend = 0.0f;
    float echoSend = 0.0f;
    bool autoOn = false;
    bool autoCurved = false;
    std::vector<float> autoPoints; // interleaved [t0,v0,t1,v1,...], t normalized 0..1
};

// Ambience (Sound Environment / room type) spec — mirrors the web engine's
// ROOM_PRESETS / roomParams. Drives a procedurally generated room impulse response
// (see MasterEffectsAudioSource::generateRoomIR, a port of audio-engine.js makeRoomIR).
struct RoomSpec
{
    float decay = 0.001f;   // tail length (seconds)
    float shape = 2.0f;     // decay-curve exponent
    float preDelay = 0.0f;  // pre-delay (milliseconds)
    float wet = 0.0f;       // send level 0..1
    float damp = 20000.0f;  // HF damping cutoff (Hz)
    float width = 1.0f;     // stereo width (0..1.5)
    float echo = 0.0f;      // discrete slap-echo level 0..1
    float size = 0.5f;      // room size 0..1 (scales ER / echo spacing)
    float erGain = 1.0f;    // early-reflection prominence
};

#if USE_JUCE

// Circular buffer feedback delay class for track/master echo
class FeedbackDelay
{
public:
    FeedbackDelay() {}
    
    void prepare(double sampleRate, int maxDelaySeconds)
    {
        this->sampleRate = sampleRate;
        int bufferSize = (int)(sampleRate * maxDelaySeconds);
        delayBuffer.setSize(2, bufferSize);
        delayBuffer.clear();
        writeIndex = 0;
    }
    
    void reset()
    {
        delayBuffer.clear();
        writeIndex = 0;
    }
    
    void process(juce::AudioBuffer<float>& buffer, int startSample, int numSamples, float wetLevel, float feedback)
    {
        if (wetLevel <= 0.001f) return;
        
        int delaySamples = (int)(sampleRate * 0.3); // 300ms delay time
        int delayBufferSize = delayBuffer.getNumSamples();
        if (delayBufferSize <= 0) return;
        int numChannels = std::min(buffer.getNumChannels(), delayBuffer.getNumChannels());
        
        for (int channel = 0; channel < numChannels; ++channel)
        {
            float* channelData = buffer.getWritePointer(channel, startSample);
            float* delayData = delayBuffer.getWritePointer(channel);
            int localWriteIndex = writeIndex;
            
            for (int s = 0; s < numSamples; ++s)
            {
                float drySample = channelData[s];
                
                int readIndex = localWriteIndex - delaySamples;
                if (readIndex < 0) readIndex += delayBufferSize;
                float delaySample = delayData[readIndex];
                
                delayData[localWriteIndex] = drySample + delaySample * feedback;
                localWriteIndex = (localWriteIndex + 1) % delayBufferSize;
                
                channelData[s] = drySample + delaySample * wetLevel;
            }
            
            if (channel == numChannels - 1)
            {
                writeIndex = localWriteIndex;
            }
        }
    }
    
private:
    double sampleRate = 44100.0;
    juce::AudioBuffer<float> delayBuffer;
    int writeIndex = 0;
};

// 1st order High-Pass filter for Exciter/Enhancer high-frequency generation
class HighPassFilter
{
public:
    void prepare(double sampleRate, float cutoffFreq)
    {
        double dt = 1.0 / sampleRate;
        double RC = 1.0 / (2.0 * 3.141592653589793 * cutoffFreq);
        alpha = (float)(RC / (RC + dt));
        lastInput[0] = lastInput[1] = 0.0f;
        lastOutput[0] = lastOutput[1] = 0.0f;
    }
    
    void reset()
    {
        lastInput[0] = lastInput[1] = 0.0f;
        lastOutput[0] = lastOutput[1] = 0.0f;
    }
    
    float processSample(int channel, float x)
    {
        if (channel >= 2) return x;
        float y = alpha * (lastOutput[channel] + x - lastInput[channel]);
        lastInput[channel] = x;
        lastOutput[channel] = y;
        return y;
    }
    
private:
    float alpha = 0.5f;
    float lastInput[2] = { 0.0f, 0.0f };
    float lastOutput[2] = { 0.0f, 0.0f };
};

// Helper AudioSource to apply global volume (gain)
class GainAudioSource : public juce::AudioSource
{
public:
    GainAudioSource(juce::AudioSource* inputSource, bool deleteInputWhenDeleted)
        : source(inputSource), deleteInput(deleteInputWhenDeleted)
    {
    }

    void prepareToPlay(int samplesPerBlockExpected, double sampleRate) override {
        if (source) source->prepareToPlay(samplesPerBlockExpected, sampleRate);
    }

    void releaseResources() override {
        if (source) source->releaseResources();
    }

    void getNextAudioBlock(const juce::AudioSourceChannelInfo& bufferToFill) override {
        if (!source) {
            bufferToFill.clearActiveBufferRegion();
            return;
        }
        source->getNextAudioBlock(bufferToFill);
        
        float gain = masterGain.load();
        if (gain != 1.0f) {
            bufferToFill.buffer->applyGain(bufferToFill.startSample, bufferToFill.numSamples, gain);
        }
    }

    juce::AudioSource* source;
    bool deleteInput;
    std::atomic<float> masterGain { 1.0f };
};

// Sample-accurate loop range (the Repeat region) for realtime playback.
//
// Sits between the track mixer and the master chain:
//   mixerSource -> LoopAudioSource -> GainAudioSource -> MasterEffectsAudioSource
//
// Repeat used to be driven entirely from JS (audio-bridge.js polled the playhead on a
// 30ms setInterval and sent `seek` once it had already passed the loop end), so every
// iteration came out a different length and the error accumulated. Phase 6 records one
// Take per iteration, so the boundary must be exact. This source splits the audio block
// AT the loop end and rewinds the tracks from inside the audio callback, which makes
// every iteration exactly floor((end - start) * outputRate) samples: the split is
// computed from the absolute distance to the boundary, never from where the block
// happens to fall, so the length cannot drift between iterations.
//
// Positions here are PROJECT TIMELINE seconds (what the UI calls the playhead), which is
// what the JS side sends. `timelineRate` converts them to output samples: with Vari BPM
// the timeline advances faster than real time by playbackBpm/projectBpm, exactly the
// ratio SoundTouch is stretching by (it is 1.0 — and therefore exact — whenever Vari BPM
// is off, which is the case that has to be sample-accurate for recording).
class LoopAudioSource : public juce::AudioSource
{
public:
    // Called ON THE AUDIO THREAD at each loop boundary with (timelineSeconds,
    // outputSampleRate). It must reposition the tracks without blocking — see
    // AudioEngine::rewindTracksForLoop.
    using RewindFn = std::function<void(double, double)>;

    LoopAudioSource(juce::AudioSource* inputSource, RewindFn rewind)
        : source(inputSource), rewindTracks(std::move(rewind)) {}

    void prepareToPlay(int samplesPerBlockExpected, double sampleRate) override
    {
        deviceRate.store(sampleRate > 0.0 ? sampleRate : 44100.0);
        if (source) source->prepareToPlay(samplesPerBlockExpected, sampleRate);
    }

    void releaseResources() override
    {
        if (source) source->releaseResources();
    }

    void getNextAudioBlock(const juce::AudioSourceChannelInfo& bufferToFill) override
    {
        if (source == nullptr) { bufferToFill.clearActiveBufferRegion(); return; }

        const double startS = loopStart.load();
        const double endS = loopEnd.load();
        const double sr = deviceRate.load();
        const double rate = timelineRate.load();
        const bool wrap = loopActive.load() && running.load() && !bypassed.load()
            && (endS - startS) >= kMinLoopSeconds && sr > 0.0 && rate > 0.0;

        if (!wrap)
        {
            source->getNextAudioBlock(bufferToFill);
            return;
        }

        double pos = posSeconds.load();
        int done = 0;
        // Bound the iterations defensively: kMinLoopSeconds already guarantees progress,
        // but the audio thread must never spin on a pathological range.
        int guard = 64;

        while (done < bufferToFill.numSamples && guard-- > 0)
        {
            int segment = bufferToFill.numSamples - done;
            const double untilEnd = endS - pos;
            if (untilEnd <= 0.0)
            {
                segment = 0;
            }
            else
            {
                const double outSamplesLeft = untilEnd * sr / rate;
                if (outSamplesLeft < (double)segment)
                    segment = (int)std::floor(outSamplesLeft);
            }

            if (segment > 0)
            {
                juce::AudioSourceChannelInfo sub(bufferToFill.buffer,
                                                 bufferToFill.startSample + done, segment);
                source->getNextAudioBlock(sub);
                pos += (double)segment * rate / sr;
                done += segment;
            }

            if (done < bufferToFill.numSamples)
            {
                // The boundary lands inside this block: rewind every track to the loop
                // start and keep filling the rest of the block from there.
                if (rewindTracks) rewindTracks(startS, sr);
                pos = startS;
            }
        }

        if (done < bufferToFill.numSamples)
            bufferToFill.buffer->clear(bufferToFill.startSample + done,
                                       bufferToFill.numSamples - done);

        posSeconds.store(pos);
    }

    // --- Called from the message/command thread ------------------------------
    void setRange(double startSeconds, double endSeconds, bool enabled)
    {
        loopStart.store(startSeconds);
        loopEnd.store(endSeconds);
        loopActive.store(enabled);
    }
    void setPosition(double timelineSeconds) { posSeconds.store(timelineSeconds); }
    void setRunning(bool on) { running.store(on); }
    // Offline export renders through this same chain; the loop must not wrap there.
    void setBypassed(bool on) { bypassed.store(on); }
    void setTimelineRate(double rate) { timelineRate.store(rate > 0.0 ? rate : 1.0); }
    bool isRangeActive() const { return loopActive.load(); }
    double getLoopStart() const { return loopStart.load(); }

private:
    static constexpr double kMinLoopSeconds = 0.05;

    juce::AudioSource* source; // non-owning (the engine's mixerSource)
    RewindFn rewindTracks;

    std::atomic<bool> loopActive { false };
    std::atomic<bool> running { false };
    std::atomic<bool> bypassed { false };
    std::atomic<double> loopStart { 0.0 };
    std::atomic<double> loopEnd { 0.0 };
    std::atomic<double> posSeconds { 0.0 };
    std::atomic<double> deviceRate { 44100.0 };
    std::atomic<double> timelineRate { 1.0 };
};

class SoundTouchAudioSource : public juce::PositionableAudioSource
{
public:
    SoundTouchAudioSource(juce::PositionableAudioSource* inputSource, bool deleteInputWhenDeleted)
        : source(inputSource), deleteInput(deleteInputWhenDeleted)
    {
        soundTouch.setSampleRate(44100);
        soundTouch.setChannels(2);
        soundTouch.setTempo(1.0);
        soundTouch.setRate(1.0);
        soundTouch.setPitchSemiTones(0.0);
        
        soundTouch.setSetting(SETTING_USE_AA_FILTER, 1);
        soundTouch.setSetting(SETTING_SEQUENCE_MS, 40);
        soundTouch.setSetting(SETTING_SEEKWINDOW_MS, 15);
        soundTouch.setSetting(SETTING_OVERLAP_MS, 8);
    }

    ~SoundTouchAudioSource() override
    {
        // `source` is NON-owning by default (deleteInput=false): the caller — e.g.
        // TrackAudioSource — keeps its own unique_ptr to the same object. Only delete
        // it here when we were explicitly asked to own it, otherwise it double-frees.
        if (deleteInput)
            delete source;
    }

    void prepareToPlay(int samplesPerBlockExpected, double sampleRate) override
    {
        source->prepareToPlay(samplesPerBlockExpected, sampleRate);
        soundTouch.setSampleRate((uint)sampleRate);
        soundTouch.setChannels(2);
        soundTouch.clear();

        int maxSamples = samplesPerBlockExpected * 4;
        tempPlanarBuffer.setSize(2, maxSamples);
        interleavedInput.resize(maxSamples * 2);
        interleavedOutput.resize(maxSamples * 2);
    }

    void releaseResources() override
    {
        source->releaseResources();
    }

    void getNextAudioBlock(const juce::AudioSourceChannelInfo& bufferToFill) override
    {
        float currentTempo = targetTempo.load();
        float currentPitch = targetPitch.load();
        bool currentPreserve = preservePitch.load();

        // Bypass SoundTouch when no time-stretch/pitch-shift is active (tempo==1,
        // pitch==0 — the normal case with Vari BPM/Key off). SoundTouch's frame
        // pipeline only adds latency here, so pass the source straight through;
        // sample-exact and matches the web-audio path.
        if (currentTempo > 0.99999f && currentTempo < 1.00001f &&
            currentPitch > -0.00001f && currentPitch < 0.00001f)
        {
            if (soundTouch.numSamples() > 0) soundTouch.clear(); // drop stale residual
            source->getNextAudioBlock(bufferToFill);
            return;
        }

        if (currentPreserve)
        {
            soundTouch.setRate(1.0f);
            soundTouch.setTempo(currentTempo);
            soundTouch.setPitchSemiTones(currentPitch);
        }
        else
        {
            // Rate mode: tempo follows playback speed (pitch moves with it). The
            // user's Vari Key offset is an independent musical transposition that
            // must still be summed on top — previously this branch reset it to 0,
            // silently dropping the key change during tempo+pitch-linked export.
            soundTouch.setTempo(1.0f);
            soundTouch.setRate(currentTempo);
            soundTouch.setPitchSemiTones(currentPitch);
        }

        int numSamplesNeeded = bufferToFill.numSamples;
        int numChannels = bufferToFill.buffer->getNumChannels();
        soundTouch.setChannels(numChannels);

        int available = soundTouch.numSamples();
        int maxReadLoops = 32;

        while (available < numSamplesNeeded && maxReadLoops > 0)
        {
            --maxReadLoops;
            int readChunkSize = bufferToFill.numSamples;
            if (tempPlanarBuffer.getNumSamples() < readChunkSize) {
                tempPlanarBuffer.setSize(numChannels, readChunkSize * 2);
            }
            
            juce::AudioSourceChannelInfo tempInfo(&tempPlanarBuffer, 0, readChunkSize);
            tempInfo.clearActiveBufferRegion();
            source->getNextAudioBlock(tempInfo);
            
            int totalInputSamples = readChunkSize * numChannels;
            if (interleavedInput.size() < (size_t)totalInputSamples)
                interleavedInput.resize(totalInputSamples * 2);
                
            for (int s = 0; s < readChunkSize; ++s)
            {
                for (int c = 0; c < numChannels; ++c)
                {
                    interleavedInput[s * numChannels + c] = tempPlanarBuffer.getSample(c, s);
                }
            }
            
            soundTouch.putSamples(interleavedInput.data(), readChunkSize);
            available = soundTouch.numSamples();
        }

        int samplesToRetrieve = std::min(numSamplesNeeded, (int)soundTouch.numSamples());
        if (samplesToRetrieve > 0)
        {
            int totalOutputSamples = samplesToRetrieve * numChannels;
            if (interleavedOutput.size() < (size_t)totalOutputSamples)
                interleavedOutput.resize(totalOutputSamples * 2);
                
            uint retrieved = soundTouch.receiveSamples(interleavedOutput.data(), samplesToRetrieve);
            for (int s = 0; s < (int)retrieved; ++s)
            {
                for (int c = 0; c < numChannels; ++c)
                {
                    bufferToFill.buffer->setSample(c, bufferToFill.startSample + s, interleavedOutput[s * numChannels + c]);
                }
            }
            
            if (retrieved < (uint)numSamplesNeeded)
            {
                bufferToFill.buffer->clear(bufferToFill.startSample + retrieved, numSamplesNeeded - retrieved);
            }
        }
        else
        {
            bufferToFill.clearActiveBufferRegion();
        }
    }

    void setNextReadPosition(juce::int64 newPosition) override
    {
        source->setNextReadPosition(newPosition);
        soundTouch.clear();
    }

    juce::int64 getNextReadPosition() const override
    {
        return source->getNextReadPosition();
    }

    juce::int64 getTotalLength() const override
    {
        return source->getTotalLength();
    }

    bool isLooping() const override
    {
        return source->isLooping();
    }

    void setLooping(bool shouldLoop) override
    {
        source->setLooping(shouldLoop);
    }

    void setTempo(float tempo) { targetTempo.store(tempo); }
    void setPitchShift(float pitchSemiTones) { targetPitch.store(pitchSemiTones); }
    void setPreservePitch(bool on) { preservePitch.store(on); }

private:
    juce::PositionableAudioSource* source; // NON-owning unless deleteInput (see destructor)
    bool deleteInput;
    soundtouch::SoundTouch soundTouch;
    
    juce::AudioBuffer<float> tempPlanarBuffer;
    std::vector<float> interleavedInput;
    std::vector<float> interleavedOutput;
    
    std::atomic<float> targetTempo { 1.0f };
    std::atomic<float> targetPitch { 0.0f };
    std::atomic<bool> preservePitch { true };
};

// Immutable volume-automation snapshot for a track. Built on the command thread
// and read on the audio/export thread via a ref-counted pointer, so concurrent
// edits never mutate data that is being read. Mirrors the Web Audio engine's
// automation: linear, or Fritsch–Carlson monotone cubic when `curved`.
struct TrackAutomation
{
    bool on = false;
    bool curved = false;
    std::vector<float> t;    // normalized times 0..1 (sorted)
    std::vector<float> v;    // gains 0..1
    std::vector<float> tan;  // monotone-cubic tangents (when curved)

    // Evaluate the automation gain at normalized phase (0..1). Returns [0.0001, 1].
    float sample(double phase) const
    {
        const size_t m = t.size();
        if (m == 0) return 1.0f;
        if (m == 1) return juce::jlimit(0.0001f, 1.0f, v[0]);
        size_t seg = 0;
        while (seg < m - 2 && phase > t[seg + 1]) ++seg;
        double x0 = t[seg];
        double h = (double)t[seg + 1] - x0; if (h <= 0) h = 1e-6;
        double u = juce::jlimit(0.0, 1.0, (phase - x0) / h);
        double out;
        if (curved && tan.size() == m) {
            double u2 = u * u, u3 = u2 * u;
            out = (2 * u3 - 3 * u2 + 1) * v[seg]
                + (u3 - 2 * u2 + u) * h * tan[seg]
                + (-2 * u3 + 3 * u2) * v[seg + 1]
                + (u3 - u2) * h * tan[seg + 1];
        } else {
            out = v[seg] + ((double)v[seg + 1] - v[seg]) * u;
        }
        return (float)juce::jlimit(0.0001, 1.0, out);
    }

    // Build from interleaved [t0,v0,t1,v1,...]; sorts points and precomputes tangents.
    static std::shared_ptr<const TrackAutomation> build(bool on, bool curved, const std::vector<float>& flat)
    {
        auto d = std::make_shared<TrackAutomation>();
        d->on = on;
        d->curved = curved;
        const size_t m = flat.size() / 2;
        std::vector<std::pair<float, float>> pts;
        pts.reserve(m);
        for (size_t i = 0; i < m; ++i) pts.emplace_back(flat[2 * i], flat[2 * i + 1]);
        std::sort(pts.begin(), pts.end(), [](const auto& a, const auto& b) { return a.first < b.first; });
        for (auto& p : pts) { d->t.push_back(p.first); d->v.push_back(p.second); }

        if (curved && m >= 2) {
            std::vector<double> slope(m - 1);
            for (size_t i = 0; i < m - 1; ++i) {
                double dx = (double)d->t[i + 1] - d->t[i]; if (dx == 0) dx = 1e-6;
                slope[i] = ((double)d->v[i + 1] - d->v[i]) / dx;
            }
            d->tan.assign(m, 0.0f);
            d->tan[0] = (float)slope[0];
            d->tan[m - 1] = (float)slope[m - 2];
            for (size_t i = 1; i < m - 1; ++i)
                d->tan[i] = (slope[i - 1] * slope[i] <= 0) ? 0.0f : (float)((slope[i - 1] + slope[i]) / 2.0);
            for (size_t i = 0; i < m - 1; ++i) {
                if (slope[i] == 0) { d->tan[i] = 0; d->tan[i + 1] = 0; continue; }
                double a = d->tan[i] / slope[i], b = d->tan[i + 1] / slope[i], s = a * a + b * b;
                if (s > 9.0) { double k = 3.0 / std::sqrt(s); d->tan[i] = (float)(k * a * slope[i]); d->tan[i + 1] = (float)(k * b * slope[i]); }
            }
        }
        return d;
    }
};

// TrackAudioSource manages reader source, transport control, volume, pan, mute, and solo
class TrackAudioSource : public juce::PositionableAudioSource
{
public:
    // `source` is a fully-decoded, in-memory PCM source (MemoryAudioSource) so seeks
    // are sample-exact. `sourceSampleRate` is the original file rate, used for the
    // transport's rate correction (the reader no longer carries it).
    TrackAudioSource(std::unique_ptr<juce::PositionableAudioSource> source, double sourceSampleRate, double deviceSampleRate)
    {
        readerSource = std::move(source);
        fileSampleRate = sourceSampleRate;
#if USE_JUCE
        soundTouchSource = std::make_unique<SoundTouchAudioSource>(readerSource.get(), false);
        transportSource = std::make_unique<juce::AudioTransportSource>();
        transportSource->setSource(soundTouchSource.get(), 0, nullptr, fileSampleRate);
#else
        transportSource = std::make_unique<juce::AudioTransportSource>();
        transportSource->setSource(readerSource.get(), 0, nullptr, fileSampleRate);
#endif
        reverbSend.store(0.0f);
        echoSend.store(0.0f);
    }

    ~TrackAudioSource() override
    {
        transportSource->setSource(nullptr);
#if USE_JUCE
        soundTouchSource.reset();
#endif
    }

    void prepareToPlay(int samplesPerBlockExpected, double sampleRate) override {
        transportSource->prepareToPlay(samplesPerBlockExpected, sampleRate);
        preparedSampleRate.store(sampleRate > 0.0 ? sampleRate : 44100.0);
        echoDelay.prepare(sampleRate, 2);
    }

    void releaseResources() override {
        transportSource->releaseResources();
    }

    void reset()
    {
        echoDelay.reset();
        if (soundTouchSource) soundTouchSource->setNextReadPosition(0);
    }

    void getNextAudioBlock(const juce::AudioSourceChannelInfo& bufferToFill) override {
        // ALWAYS advance the transport — even for muted / solo-excluded tracks.
        // JUCE's AudioTransportSource only moves its read position when its
        // getNextAudioBlock is pulled. An early-return on gating would FREEZE this
        // track's position, which caused two bugs: (1) the playhead is read from
        // track[0], so muting/un-soloing track[0] stalled the playbar; (2) a gated
        // track resumed from its frozen sample when re-enabled, so tracks drifted
        // permanently out of sync. We pull first to keep every transport in lockstep,
        // then silence this track's output below if it is gated.
        // (Offline export reuses this same transportSource path; the realtime device
        // callback is suspended during export, so there is no contention here.)
        // Capture the transport position around the pull. Offline export drives the
        // automation phase externally (offlineAutoPhase*), but for REALTIME playback we
        // derive it here from the track's own read position so volume automation is
        // heard live — not only in the exported file. posBefore/posAfter are in source
        // samples, so the phase stays correct under the transport's resampling at 96 kHz.
        const juce::int64 totalLength = transportSource->getTotalLength();
        const juce::int64 beforeReadPosition = transportSource->getNextReadPosition();
        transportSource->getNextAudioBlock(bufferToFill);
        const juce::int64 afterReadPosition = transportSource->getNextReadPosition();

        if (mute || (soloActive && !solo)) {
            bufferToFill.clearActiveBufferRegion();
            currentMagnitude.store(0.0f);
            if (offlineRendering.load() && !offlineDebugLogged.exchange(true)) {
                LOG_DBG << "[AudioEngine] Offline track muted: id=" << id
                          << ", mute=" << (mute ? 1 : 0)
                          << ", solo=" << (solo ? 1 : 0)
                          << ", soloActive=" << (soloActive ? 1 : 0)
                          << ", volume=" << volume
                          << std::endl;
            }
            return;
        }
        float sourceMagnitude = bufferToFill.buffer->getMagnitude(bufferToFill.startSample, bufferToFill.numSamples);

        // Apply track individual echo/delay
        float currentEcho = echoSend.load();
        if (currentEcho > 0.001f)
        {
            echoDelay.process(*bufferToFill.buffer, bufferToFill.startSample, bufferToFill.numSamples, currentEcho * 0.45f, 0.34f);
        }

        // Add to shared reverb send buffer if it exists
        float currentRev = reverbSend.load();
        if (reverbSendBuffer != nullptr && currentRev > 0.001f)
        {
            int numChannels = std::min(bufferToFill.buffer->getNumChannels(), reverbSendBuffer->getNumChannels());
            // Never write past the send buffer: if the device delivers a bigger block
            // than the buffer was prepared for, writing numSamples would corrupt the
            // heap. The master grows the buffer each block, but this is the safety net.
            int sendSamples = std::min(bufferToFill.numSamples, reverbSendBuffer->getNumSamples());
            for (int channel = 0; channel < numChannels; ++channel)
            {
                const float* src = bufferToFill.buffer->getReadPointer(channel, bufferToFill.startSample);
                float* dst = reverbSendBuffer->getWritePointer(channel);
                for (int s = 0; s < sendSamples; ++s)
                {
                    dst[s] += src[s] * currentRev;
                }
            }
        }

        // Apply volume (× volume automation) and pan. Automation gain is evaluated at
        // the block's start/end normalized phase and applied as a smooth ramp so it
        // matches the Web Audio engine's sample-accurate `setValueCurveAtTime`.
        // The phase is the global render position offline, or the track's own
        // play position (0..1 over the song) in realtime — so automation is now heard
        // during live native playback, not only in the exported file.
        // Take an immutable snapshot under the lock, then use it lock-free.
        // setAutomation() swaps in a NEW object, so a concurrent edit can never realloc
        // the data we're reading — avoids the heap corruption (0xC0000374) a plain
        // unlocked vector read would risk. The lock is held only for a shared_ptr copy.
        double phaseStart = 0.0, phaseEnd = 0.0;
        float autoGainStart = 1.0f, autoGainEnd = 1.0f;
        std::shared_ptr<const TrackAutomation> autoSnap = automationSnapshot();
        const bool autoActive = autoSnap && autoSnap->on && !autoSnap->t.empty();
        const bool realtimeLooping = !offlineRendering.load()
            && totalLength > 0 && readerSource && readerSource->isLooping();
        if (autoActive) {
            if (offlineRendering.load()) {
                phaseStart = offlineAutoPhaseStart;
                phaseEnd   = offlineAutoPhaseEnd;
            } else if (totalLength > 0) {
                const auto wrappedBefore = realtimeLooping
                    ? beforeReadPosition % totalLength : beforeReadPosition;
                const auto wrappedAfter = realtimeLooping
                    ? afterReadPosition % totalLength : afterReadPosition;
                phaseStart = (double)wrappedBefore / (double)totalLength;
                phaseEnd   = (double)wrappedAfter  / (double)totalLength;
            } else {
                phaseStart = phaseEnd = 0.0;
            }
            autoGainStart = autoSnap->sample(phaseStart);
            autoGainEnd   = autoSnap->sample(phaseEnd);
        }
        if (volume != 1.0f || pan != 0.0f || autoActive) {
            for (int channel = 0; channel < bufferToFill.buffer->getNumChannels(); ++channel) {
                float panFactor = 1.0f;
                if (pan != 0.0f) {
                    if (channel == 0 && pan > 0.0f) panFactor = (1.0f - pan);
                    else if (channel == 1 && pan < 0.0f) panFactor = (1.0f + pan);
                }
                const auto applyGainRange = [&](int startSample, int numSamples,
                                                float rangeGainStart, float rangeGainEnd) {
                    const float gStart = volume * rangeGainStart * panFactor;
                    const float gEnd   = volume * rangeGainEnd   * panFactor;
                    if (gStart == gEnd)
                        bufferToFill.buffer->applyGain(channel, startSample, numSamples, gStart);
                    else
                        bufferToFill.buffer->applyGainRamp(channel, startSample, numSamples, gStart, gEnd);
                };

                const juce::int64 sourceAdvance = afterReadPosition - beforeReadPosition;
                if (autoActive && realtimeLooping && sourceAdvance > 0
                    && bufferToFill.numSamples > 0) {
                    // MemoryAudioSource exposes a monotonic counter while looping.
                    // Split a block at each loop boundary so automation restarts at
                    // phase zero instead of ramping from the song end to its start.
                    const double sourcePerOutputSample =
                        (double)sourceAdvance / (double)bufferToFill.numSamples;
                    double wrappedSourcePosition =
                        (double)(beforeReadPosition % totalLength);
                    int outputOffset = 0;

                    while (outputOffset < bufferToFill.numSamples) {
                        const double sourceUntilBoundary =
                            (double)totalLength - wrappedSourcePosition;
                        int segmentSamples = (int)std::ceil(
                            sourceUntilBoundary / sourcePerOutputSample);
                        segmentSamples = juce::jlimit(
                            1, bufferToFill.numSamples - outputOffset, segmentSamples);

                        const double segmentSourceEnd = juce::jmin(
                            (double)totalLength,
                            wrappedSourcePosition + sourcePerOutputSample * segmentSamples);
                        const float segmentGainStart =
                            autoSnap->sample(wrappedSourcePosition / (double)totalLength);
                        const float segmentGainEnd =
                            autoSnap->sample(segmentSourceEnd / (double)totalLength);
                        applyGainRange(bufferToFill.startSample + outputOffset,
                                       segmentSamples, segmentGainStart, segmentGainEnd);

                        outputOffset += segmentSamples;
                        wrappedSourcePosition += sourcePerOutputSample * segmentSamples;
                        if (wrappedSourcePosition >= (double)totalLength)
                            wrappedSourcePosition =
                                std::fmod(wrappedSourcePosition, (double)totalLength);
                    }
                } else {
                    applyGainRange(bufferToFill.startSample, bufferToFill.numSamples,
                                   autoGainStart, autoGainEnd);
                }
            }
        }

        // A track decoded while transport is already running joins at an arbitrary
        // waveform phase. Ramp it in briefly to avoid a discontinuity/click without
        // changing its transport position or the other tracks.
        int fadeRemaining = joinFadeSamplesRemaining.load();
        const int fadeTotal = joinFadeTotalSamples.load();
        if (fadeRemaining > 0 && fadeTotal > 0 && bufferToFill.numSamples > 0) {
            const int used = juce::jmin(fadeRemaining, bufferToFill.numSamples);
            const float startGain = 1.0f - (float)fadeRemaining / (float)fadeTotal;
            const float endGain = 1.0f - (float)(fadeRemaining - used) / (float)fadeTotal;
            for (int channel = 0; channel < bufferToFill.buffer->getNumChannels(); ++channel) {
                bufferToFill.buffer->applyGainRamp(
                    channel, bufferToFill.startSample, used, startGain, endGain);
            }
            if (used < bufferToFill.numSamples) {
                // The fade completed inside this block; the remainder stays at unity.
            }
            joinFadeSamplesRemaining.store(fadeRemaining - used);
        }

        float mag = bufferToFill.buffer->getMagnitude(bufferToFill.startSample, bufferToFill.numSamples);
        currentMagnitude.store(mag);
        if (offlineRendering.load() && !offlineDebugLogged.exchange(true)) {
            LOG_DBG << "[AudioEngine] Offline track probe: id=" << id
                      << ", sourcePeak=" << sourceMagnitude
                      << ", postPeak=" << mag
                      << ", volume=" << volume
                      << ", pan=" << pan
                      << ", mute=" << (mute ? 1 : 0)
                      << ", solo=" << (solo ? 1 : 0)
                      << ", soloActive=" << (soloActive ? 1 : 0)
                      << ", readPos=" << beforeReadPosition
                      << ", totalLength=" << totalLength
                      << ", soundTouch=" << (offlineUseSoundTouch.load() ? 1 : 0)
                      << std::endl;
        }
    }

    void setNextReadPosition(juce::int64 newPosition) override {
        transportSource->setNextReadPosition(newPosition);
    }

    juce::int64 getNextReadPosition() const override {
        return transportSource->getNextReadPosition();
    }

    juce::int64 getTotalLength() const override {
        return transportSource->getTotalLength();
    }

    bool isLooping() const override {
        return transportSource->isLooping();
    }

    void setLooping(bool shouldLoop) override {
        if (! readerSource) return;
        // MemoryAudioSource keeps a monotonic read counter that is NOT wrapped — while
        // looping, getNextReadPosition() returns a value that grows past the buffer
        // length after each loop. Disabling looping then makes hasStreamFinished()
        // (position >= totalLength) instantly true, so turning repeat OFF after the song
        // had looped once would stop playback dead. Rebase the counter into [0,length)
        // when leaving loop mode; the audible read offset (position % length) is
        // identical, so playback continues seamlessly from the current spot to the end.
        if (! shouldLoop && readerSource->isLooping()) {
            const auto len = readerSource->getTotalLength();
            if (len > 0) {
                const auto wrapped = readerSource->getNextReadPosition() % len;
                readerSource->setLooping(false);
                readerSource->setNextReadPosition(wrapped);
                return;
            }
        }
        readerSource->setLooping(shouldLoop);
    }

    bool hasFinished() const {
        return transportSource && transportSource->hasStreamFinished();
    }

    double getCurrentPositionSeconds() const {
        return transportSource ? transportSource->getCurrentPosition() : 0.0;
    }

    double getLengthSeconds() const {
        return transportSource ? transportSource->getLengthInSeconds() : 0.0;
    }

    void beginJoinFade(double milliseconds = 8.0) {
        const double sr = preparedSampleRate.load();
        const int samples = juce::jmax(1, (int)std::round(sr * milliseconds / 1000.0));
        joinFadeTotalSamples.store(samples);
        joinFadeSamplesRemaining.store(samples);
    }

    void setTempo(float tempo) {
#if USE_JUCE
        if (soundTouchSource) soundTouchSource->setTempo(tempo);
#endif
    }

    void setPitchShift(float pitchSemiTones) {
#if USE_JUCE
        if (soundTouchSource) soundTouchSource->setPitchShift(pitchSemiTones);
#endif
    }

    void setPreservePitch(bool on) {
#if USE_JUCE
        if (soundTouchSource) soundTouchSource->setPreservePitch(on);
#endif
    }

    void setOfflineRendering(bool on, bool useSoundTouch = false) {
        // Offline export reads through transportSource (see getNextAudioBlock), so
        // the read position is reset by the caller via transportSource->setPosition(0).
        // This flag now only drives the one-shot probe logging below.
        offlineRendering.store(on);
        offlineUseSoundTouch.store(on && useSoundTouch);
        offlineDebugLogged.store(false);
    }

    // --- Volume automation (applied during offline export) -------------------
    // Points are {t, v} with t normalized 0..1 over the whole render and v a gain
    // in [0,1]. `flat` is interleaved [t0,v0,t1,v1,...]. Mirrors the Web Audio
    // engine's automation (linear, or Fritsch–Carlson monotone cubic when curved).
    // The data is held as an immutable, ref-counted snapshot and swapped under a
    // lock, so the audio/export thread can read it without risking a use-after-free
    // if automation is edited concurrently.
    void setAutomation(bool on, bool curved, const std::vector<float>& flat) {
        auto d = TrackAutomation::build(on, curved, flat);
        std::lock_guard<std::mutex> lk(autoMutex);
        autoData = d;
    }

    std::shared_ptr<const TrackAutomation> automationSnapshot() const {
        std::lock_guard<std::mutex> lk(autoMutex);
        return autoData; // copies the shared_ptr; the data stays alive while in use
    }

    void setOfflineAutomationPhase(double startPhase, double endPhase) {
        offlineAutoPhaseStart = startPhase;
        offlineAutoPhaseEnd = endPhase;
    }

    std::string id;
    std::unique_ptr<juce::PositionableAudioSource> readerSource; // in-memory PCM (MemoryAudioSource)
    double fileSampleRate = 44100.0; // original file rate, for transport rate correction
#if USE_JUCE
    std::unique_ptr<SoundTouchAudioSource> soundTouchSource;
#endif
    std::unique_ptr<juce::AudioTransportSource> transportSource;
    float volume = 1.0f;
    float pan = 0.0f;
    // Written from the WebSocket/message thread while the audio thread reads them
    // every block in getNextAudioBlock — plain bools were a data race (UB); atomics
    // guarantee the gate always sees a coherent value.
    std::atomic<bool> mute { false };
    std::atomic<bool> solo { false };
    std::atomic<bool> soloActive { false };
    std::atomic<bool> offlineRendering { false };
    std::atomic<bool> offlineUseSoundTouch { false };
    std::atomic<bool> offlineDebugLogged { false };

    std::atomic<float> reverbSend { 0.0f };
    std::atomic<float> echoSend { 0.0f };
    std::atomic<float> currentMagnitude { 0.0f };
    std::atomic<double> preparedSampleRate { 44100.0 };
    std::atomic<int> joinFadeTotalSamples { 0 };
    std::atomic<int> joinFadeSamplesRemaining { 0 };
    juce::AudioBuffer<float>* reverbSendBuffer = nullptr;
    FeedbackDelay echoDelay;

    // Volume automation (offline export only). Immutable snapshot + atomic swap
    // (guarded by autoMutex). Phase is set/read only on the export thread.
    std::shared_ptr<const TrackAutomation> autoData;
    mutable std::mutex autoMutex;
    double offlineAutoPhaseStart = 0.0;
    double offlineAutoPhaseEnd = 0.0;
};

// Master effects pipeline: EQ, Reverb, Delay, Stereo Widener, Saturation, Exciter, Soft Clipper
class MasterEffectsAudioSource : public juce::AudioSource
{
public:
    MasterEffectsAudioSource(juce::AudioSource* inputSource)
        : source(inputSource)
    {
        for (int i = 0; i < 9; ++i)
        {
            eqBands[i].store(0.0f);
            bandLevels[i].store(0.0f);
        }
        reverbLevel.store(0.0f);
        echoLevel.store(0.0f);
        widenerLevel.store(0.0f);
        saturationLevel.store(0.0f);
        exciterLevel.store(0.0f);
    }

    void prepareToPlay(int samplesPerBlockExpected, double sampleRate) override
    {
        currentSampleRate = sampleRate;
        if (source) source->prepareToPlay(samplesPerBlockExpected, sampleRate);

        reverbSendBuffer.setSize(2, samplesPerBlockExpected);
        reverbSendBuffer.clear();

        juce::dsp::ProcessSpec spec;
        spec.sampleRate = sampleRate;
        spec.maximumBlockSize = samplesPerBlockExpected;
        spec.numChannels = 2;

        for (int i = 0; i < 9; ++i)
        {
            eqFilters[i].prepare(spec);
        }
        updateEQCoefficients();

        // Band-level analysis filter bank (spectrum meter). One bandpass per
        // EQ_FREQS band; keep the centre safely below Nyquist at low sample rates.
        for (int i = 0; i < 9; ++i)
        {
            float freq = std::min(kBandFreqs[i], (float)(sampleRate * 0.45));
            bandAnalysisFilters[i].coefficients =
                juce::dsp::IIR::Coefficients<float>::makeBandPass(sampleRate, freq, 1.1f);
            bandAnalysisFilters[i].reset();
        }
        bandScratch.setSize(1, samplesPerBlockExpected);

        // Per-band dB offset so whole-band RMS lands on the web AnalyserNode's
        // PER-BIN dB scale. The analyser reports one windowed, 1/N-normalised FFT
        // bin, so band energy is spread over the band's bins (−10·log10(binCount))
        // and attenuated by the Blackman window power (10·log10(W₂/2) ≈ −8.2 dB).
        // Without this, any band above −30 dB RMS clamps to 1.0 and the meter
        // paints a full wall. Bin bounds mirror audio-engine.js getMasterBandLevels
        // with the web's masterAnalyser fftSize of 1024 (512 bins).
        {
            const double nyquist = sampleRate * 0.5;
            const int numBins = 512;
            for (int i = 0; i < 9; ++i)
            {
                const double lo = (i == 0) ? 30.0 : std::sqrt((double)kBandFreqs[i - 1] * kBandFreqs[i]);
                const double hi = (i == 8) ? nyquist : std::sqrt((double)kBandFreqs[i] * kBandFreqs[i + 1]);
                const int a = std::max(0, (int)std::floor(lo / nyquist * numBins));
                const int b = std::min(numBins - 1, (int)std::ceil(hi / nyquist * numBins));
                const int count = std::max(1, b - a + 1);
                bandDbOffset[i] = 8.2f + 10.0f * std::log10((float)count);
            }
        }

        juce::Reverb::Parameters revParams;
        revParams.roomSize = 0.75f;
        revParams.damping = 0.4f;
        revParams.width = 1.0f;
        revParams.wetLevel = reverbLevel.load() * 0.4f;
        revParams.dryLevel = 1.0f;
        reverb.setParameters(revParams);

        delay.prepare(sampleRate, 2);
        
        for (int i = 0; i < 2; ++i)
        {
            exciterHpf[i].prepare(sampleRate, 3000.0f);
        }

        // Ambience (room) convolution — prepare and (re)build the IR at this sample rate.
        juce::dsp::ProcessSpec convSpec;
        convSpec.sampleRate = sampleRate;
        convSpec.maximumBlockSize = (juce::uint32)samplesPerBlockExpected;
        convSpec.numChannels = 2;
        roomConvolution.prepare(convSpec);
        roomConvPrepared = true;
        roomBuffer.setSize(2, samplesPerBlockExpected);
        roomBuffer.clear();
        if (roomSpec.wet > 0.0f) loadRoomIR(); // rebuild for the new sample rate if a room is active
    }

    void releaseResources() override
    {
        if (source) source->releaseResources();
    }

    void getNextAudioBlock(const juce::AudioSourceChannelInfo& bufferToFill) override
    {
        // 0. Rebuild EQ coefficients here (audio thread) if a band changed, so the
        //    ref-counted coefficient pointers are never reassigned concurrently with
        //    the eqFilters[i].process() reads below.
        if (eqDirty.exchange(false))
            updateEQCoefficients();

        // 1. Clear reverb send buffer. Grow it first if the device delivered a bigger
        //    block than prepareToPlay promised (device/driver changes can do this) —
        //    the per-sample loops below and every track's send write assume the buffer
        //    holds at least numSamples. Same guard roomBuffer uses in step 4.5.
        if (reverbSendBuffer.getNumSamples() < bufferToFill.numSamples)
            reverbSendBuffer.setSize(2, bufferToFill.numSamples, false, false, true);
        reverbSendBuffer.clear();

        // 2. Pull audio from dry mix
        if (source) source->getNextAudioBlock(bufferToFill);

        // 3. Process Reverb (sum of track reverb sends + master reverb send)
        float currentRev = reverbLevel.load();
        if (currentRev > 0.001f)
        {
            // Add master's own contribution to the reverb send buffer
            int numChannels = std::min(bufferToFill.buffer->getNumChannels(), reverbSendBuffer.getNumChannels());
            for (int channel = 0; channel < numChannels; ++channel)
            {
                const float* src = bufferToFill.buffer->getReadPointer(channel, bufferToFill.startSample);
                float* dst = reverbSendBuffer.getWritePointer(channel);
                for (int s = 0; s < bufferToFill.numSamples; ++s)
                {
                    dst[s] += src[s] * currentRev;
                }
            }
        }

        // Run reverb on reverbSendBuffer (100% wet since dry is already in output)
        juce::Reverb::Parameters revParams = reverb.getParameters();
        revParams.wetLevel = 0.4f; // Scale reverb output to match web engine convolver
        revParams.dryLevel = 0.0f;
        reverb.setParameters(revParams);

        if (reverbSendBuffer.getNumChannels() >= 2)
        {
            reverb.processStereo(reverbSendBuffer.getWritePointer(0),
                                 reverbSendBuffer.getWritePointer(1),
                                 bufferToFill.numSamples);
        }
        else
        {
            reverb.processMono(reverbSendBuffer.getWritePointer(0), bufferToFill.numSamples);
        }

        // Add wet reverb back to main buffer
        int numChannels = std::min(bufferToFill.buffer->getNumChannels(), reverbSendBuffer.getNumChannels());
        for (int channel = 0; channel < numChannels; ++channel)
        {
            const float* revSrc = reverbSendBuffer.getReadPointer(channel);
            float* mainDst = bufferToFill.buffer->getWritePointer(channel, bufferToFill.startSample);
            for (int s = 0; s < bufferToFill.numSamples; ++s)
            {
                mainDst[s] += revSrc[s];
            }
        }

        // 4. Apply EQ
        juce::dsp::AudioBlock<float> block(*bufferToFill.buffer, (size_t)bufferToFill.startSample);
        juce::dsp::AudioBlock<float> subBlock = block.getSubBlock((size_t)0, (size_t)bufferToFill.numSamples);
        juce::dsp::ProcessContextReplacing<float> context(subBlock);

        for (int i = 0; i < 9; ++i)
        {
            eqFilters[i].process(context);
        }

        // 4.5 Apply Ambience (room-type convolution) — parallel wet send, matching the
        // web engine's masterVol → ambSend(wet) → convolver → mix. Convolve a copy of the
        // post-EQ signal with the room IR (normalised) and add it back scaled by wet.
        float rWet = roomWet.load();
        if (rWet > 0.001f && roomReady.load())
        {
            int n = bufferToFill.numSamples;
            int chs = std::min(bufferToFill.buffer->getNumChannels(), 2);
            if (roomBuffer.getNumSamples() < n) roomBuffer.setSize(2, n, false, false, true);
            roomBuffer.clear();
            for (int ch = 0; ch < chs; ++ch)
                roomBuffer.copyFrom(ch, 0, *bufferToFill.buffer, ch, bufferToFill.startSample, n);
            if (chs == 1) roomBuffer.copyFrom(1, 0, roomBuffer, 0, 0, n); // mono → dual for stereo IR

            juce::dsp::AudioBlock<float> rblock(roomBuffer);
            auto rsub = rblock.getSubBlock(0, (size_t)n);
            juce::dsp::ProcessContextReplacing<float> rctx(rsub);
            roomConvolution.process(rctx);

            for (int ch = 0; ch < chs; ++ch)
            {
                float* dst = bufferToFill.buffer->getWritePointer(ch, bufferToFill.startSample);
                const float* wet = roomBuffer.getReadPointer(ch);
                for (int s = 0; s < n; ++s) dst[s] += wet[s] * rWet;
            }
        }

        // 5. Apply Master Echo/Delay
        float currentEcho = echoLevel.load();
        if (currentEcho > 0.001f)
        {
            delay.process(*bufferToFill.buffer, bufferToFill.startSample, bufferToFill.numSamples, currentEcho * 0.45f, 0.36f);
        }

        // 6. Apply Stereo Imager / Widener
        float currentWidth = widenerLevel.load();
        if (currentWidth > 0.001f && bufferToFill.buffer->getNumChannels() >= 2)
        {
            // Match the web engine's widening strength (audio-engine.js setMaster:
            // w = 1.0 + val * 1.5). Native previously used 1.0 + width, so the same
            // slider value widened noticeably less than the web monitor / fallback.
            float w = 1.0f + currentWidth * 1.5f;
            float* left = bufferToFill.buffer->getWritePointer(0, bufferToFill.startSample);
            float* right = bufferToFill.buffer->getWritePointer(1, bufferToFill.startSample);
            for (int i = 0; i < bufferToFill.numSamples; ++i)
            {
                float mid = 0.5f * (left[i] + right[i]);
                float side = 0.5f * (left[i] - right[i]);
                side *= w;
                left[i] = mid + side;
                right[i] = mid - side;
            }
        }

        // 7. Apply Tape Saturation
        float currentSat = saturationLevel.load();
        if (currentSat > 0.001f)
        {
            int chs = bufferToFill.buffer->getNumChannels();
            float driveGain = 1.0f + currentSat * 2.0f;
            float compensation = 1.0f / (1.0f + currentSat * 0.5f);
            for (int channel = 0; channel < chs; ++channel)
            {
                float* data = bufferToFill.buffer->getWritePointer(channel, bufferToFill.startSample);
                for (int i = 0; i < bufferToFill.numSamples; ++i)
                {
                    data[i] = std::tanh(data[i] * driveGain) * compensation;
                }
            }
        }

        // 8. Apply Exciter / Enhancer
        float currentExciter = exciterLevel.load();
        if (currentExciter > 0.001f)
        {
            int chs = std::min(bufferToFill.buffer->getNumChannels(), 2);
            for (int channel = 0; channel < chs; ++channel)
            {
                float* data = bufferToFill.buffer->getWritePointer(channel, bufferToFill.startSample);
                for (int i = 0; i < bufferToFill.numSamples; ++i)
                {
                    // Match the web engine's exciter (audio-engine.js): a 3 kHz high-pass
                    // through a WaveShaper y = x + 0.35x², summed with the dry signal and
                    // scaled by the amount. The key term is the LINEAR `hp` (high-frequency
                    // presence/brightness); the previous native version added only the
                    // nonlinear hp·|hp| term, so it boosted no actual highs and was nearly
                    // inaudible compared with the web monitor / fallback.
                    float x = data[i];
                    float hp = exciterHpf[channel].processSample(channel, x);
                    data[i] = x + currentExciter * (hp + 0.35f * hp * hp);
                }
            }
        }

        // 9. Apply Soft-clipper to prevent clipping
        applySoftClipping(*bufferToFill.buffer, bufferToFill.startSample, bufferToFill.numSamples);

        // 9b. Master fade in/out over the song / export timeline. During realtime loop
        // playback the fade position wraps with the song. Split a block that crosses
        // the boundary so fade-out finishes before fade-in starts again.
        if (fadeActive.load())
        {
            juce::int64 total = fadeTotalSamples.load();
            if (total > 0)
            {
                juce::int64 pos = fadePosSamples.load();
                int n = bufferToFill.numSamples;
                int offset = 0;
                while (offset < n)
                {
                    const juce::int64 fadePosition = fadeLooping.load() ? pos % total : pos;
                    int segmentSamples = n - offset;
                    if (fadeLooping.load())
                        segmentSamples = (int)juce::jmin(
                            (juce::int64)segmentSamples, total - fadePosition);

                    const float gStart = fadeGainAt(fadePosition);
                    const float gEnd = fadeGainAt(fadePosition + segmentSamples);
                    if (gStart != 1.0f || gEnd != 1.0f)
                    {
                        for (int ch = 0; ch < bufferToFill.buffer->getNumChannels(); ++ch)
                            bufferToFill.buffer->applyGainRamp(
                                ch, bufferToFill.startSample + offset,
                                segmentSamples, gStart, gEnd);
                    }
                    pos += segmentSamples;
                    offset += segmentSamples;
                }
                fadePosSamples.store(pos);
            }
        }

        float magL = (bufferToFill.buffer->getNumChannels() > 0) ? bufferToFill.buffer->getMagnitude(0, bufferToFill.startSample, bufferToFill.numSamples) : 0.0f;
        float magR = (bufferToFill.buffer->getNumChannels() > 1) ? bufferToFill.buffer->getMagnitude(1, bufferToFill.startSample, bufferToFill.numSamples) : magL;
        masterMagnitudeL.store(magL);
        masterMagnitudeR.store(magR);

        // 10. Band-level analysis for the spectrum meter. The web UI used to borrow
        // the muted web engine's AnalyserNode for this, which painted the web
        // engine's reverb tail during silence; measuring the real native output
        // here and broadcasting it (WebSocketServer::timerLoop) fixes that.
        if (bufferToFill.buffer->getNumChannels() > 0)
        {
            const int n = bufferToFill.numSamples;
            if (bandScratch.getNumSamples() < n) bandScratch.setSize(1, n, false, false, true);
            float* mono = bandScratch.getWritePointer(0);
            const float* lch = bufferToFill.buffer->getReadPointer(0, bufferToFill.startSample);
            const float* rch = (bufferToFill.buffer->getNumChannels() > 1)
                                   ? bufferToFill.buffer->getReadPointer(1, bufferToFill.startSample) : lch;
            for (int s = 0; s < n; ++s) mono[s] = 0.5f * (lch[s] + rch[s]);

            for (int b = 0; b < 9; ++b)
            {
                auto& filter = bandAnalysisFilters[b];
                double sumSq = 0.0;
                for (int s = 0; s < n; ++s)
                {
                    float y = filter.processSample(mono[s]);
                    sumSq += (double)y * y;
                }
                filter.snapToZero();
                float rms = std::sqrt((float)(sumSq / std::max(1, n)));
                // Same 0..1 meter scale as the web AnalyserNode path: byte data maps
                // dB -100..-30 onto 0..255, then getMasterBandLevels shapes by ^0.72.
                // bandDbOffset converts whole-band RMS to the analyser's per-bin dB.
                float db = 20.0f * std::log10(rms + 1.0e-9f) - bandDbOffset[b];
                float norm = juce::jlimit(0.0f, 1.0f, (db + 100.0f) / 70.0f);
                float shaped = std::pow(norm, 0.72f);
                // Instant attack, smoothed release — mirrors the AnalyserNode's
                // smoothingTimeConstant so the meter falls instead of stepping.
                float prev = bandLevels[b].load();
                bandLevels[b].store(shaped >= prev ? shaped : prev * 0.75f + shaped * 0.25f);
            }
        }
    }

    void setMasterBand(int index, float db)
    {
        if (index >= 0 && index < 9)
        {
            eqBands[index].store(db);
            eqDirty.store(true); // defer coefficient rebuild to the audio thread (see eqDirty)
        }
    }

    void setReverbLevel(float val) { reverbLevel.store(val); }
    void setEchoLevel(float val) { echoLevel.store(val); }
    void setWidenerLevel(float val) { widenerLevel.store(val); }
    void setSaturationLevel(float val) { saturationLevel.store(val); }
    void setExciterLevel(float val) { exciterLevel.store(val); }

    // Master fade (in/out). Window is expressed in output samples; the engine sets it
    // for realtime playback (song length) or offline export (render length).
    void setFadeWindow(juce::int64 inSamples, juce::int64 outSamples, juce::int64 totalSamples)
    {
        fadeInSamples.store(inSamples);
        fadeOutSamples.store(outSamples);
        fadeTotalSamples.store(totalSamples);
    }
    void setFadePosition(juce::int64 posSamples) { fadePosSamples.store(posSamples); }
    void setFadeActive(bool active) { fadeActive.store(active); }
    void setFadeLooping(bool looping) { fadeLooping.store(looping); }

    // Linear fade gain at an output-sample position (matches audio-engine.js fadeVal).
    float fadeGainAt(juce::int64 p) const
    {
        juce::int64 total = fadeTotalSamples.load();
        if (total > 0 && p == total)
            return fadeOutSamples.load() > 0 ? 0.0f : 1.0f;
        if (total <= 0 || p >= total) return 1.0f;
        juce::int64 fi = fadeInSamples.load();
        juce::int64 fo = fadeOutSamples.load();
        if (fi > 0 && p < fi) return (float)((double)p / (double)fi);
        if (fo > 0 && p > total - fo)
        {
            float g = (float)((double)(total - p) / (double)fo);
            return g < 0.0f ? 0.0f : g;
        }
        return 1.0f;
    }

    // Ambience (room type). Stores the spec, sets the wet send and (re)builds the IR.
    // Called on the message thread; loadImpulseResponse swaps the IR in thread-safely.
    void setRoom(const RoomSpec& spec)
    {
        roomSpec = spec;
        roomWet.store(spec.wet);
        loadRoomIR();
    }

    float getMagnitudeL() const { return masterMagnitudeL.load(); }
    float getMagnitudeR() const { return masterMagnitudeR.load(); }
    float getBandLevel(int index) const
    {
        return (index >= 0 && index < 9) ? bandLevels[(size_t)index].load() : 0.0f;
    }

    void updateEQCoefficients()
    {
        double sr = currentSampleRate;
        if (sr <= 0) sr = 44100.0;

        const float EQ_FREQS[9] = {60.0f, 150.0f, 320.0f, 640.0f, 1200.0f, 2400.0f, 4800.0f, 9000.0f, 15000.0f};

        for (int i = 0; i < 9; ++i)
        {
            float freq = EQ_FREQS[i];
            float db = eqBands[i].load();
            float gainFactor = juce::Decibels::decibelsToGain(db);

            // Copy the new coefficients INTO the existing shared state object rather
            // than reassigning the state pointer. ProcessorDuplicator constructs each
            // per-channel filter with the state pointer at prepare() time; reassigning
            // `state` afterwards leaves those filters pointing at the OLD coefficients
            // (default/empty = b0..a2 all zero -> the EQ output silence). Mutating the
            // shared object in place is seen by every duplicated filter. This is done
            // on the audio thread (via eqDirty) so there is no concurrent reader.
            auto newCoeffs = juce::dsp::IIR::Coefficients<float>::makePeakFilter(sr, freq, 1.1f, gainFactor);
            *eqFilters[i].state = *newCoeffs;
        }
    }

    void reset()
    {
        reverbSendBuffer.clear();
        reverb.reset();
        delay.reset();
        for (int i = 0; i < 2; ++i)
        {
            exciterHpf[i].reset();
        }
        roomConvolution.reset();
    }

    juce::AudioBuffer<float>* getReverbSendBuffer() { return &reverbSendBuffer; }

private:
    // (Re)generate the room IR from roomSpec at the current sample rate and hand it to
    // the convolution. No-op until prepareToPlay has run (the convolver isn't prepared).
    void loadRoomIR()
    {
        if (!roomConvPrepared) return; // prepareToPlay will rebuild once it's ready
        double sr = currentSampleRate > 0 ? currentSampleRate : 44100.0;
        auto ir = generateRoomIR(roomSpec, sr);
        if (ir.getNumSamples() < 1) { roomReady.store(false); return; }
        roomConvolution.loadImpulseResponse(std::move(ir), sr,
            juce::dsp::Convolution::Stereo::yes,
            juce::dsp::Convolution::Trim::no,
            juce::dsp::Convolution::Normalise::yes);
        roomReady.store(true);
    }

    // Procedural room impulse response — direct port of audio-engine.js makeRoomIR:
    // pre-delay + decaying diffuse tail (shape exponent) with 1-pole HF damping and
    // stereo decorrelation, plus discrete early reflections and slap-echo taps.
    static juce::AudioBuffer<float> generateRoomIR(const RoomSpec& spec, double sr)
    {
        const double sizeScale = 0.5 + spec.size;                  // 0.5..1.5 spatial scale
        const int pre  = std::max(0, (int)std::floor((spec.preDelay / 1000.0) * sr));
        const int tail = std::max(1, (int)std::floor((spec.decay > 0 ? spec.decay : 0.001) * sr));

        // slap-echo taps (base ~45..135ms × n, decaying)
        std::vector<std::pair<double, double>> taps;
        if (spec.echo > 0.0f)
        {
            const double base = 0.09 * (0.5 + spec.size);
            for (int n = 1; n <= 3; ++n) taps.emplace_back(base * n, spec.echo * std::pow(0.55, n - 1));
        }
        const int echoSpan = taps.empty() ? 0 : (int)std::ceil((taps.back().first + 0.02) * sr);
        const int len = pre + std::max(tail, echoSpan);

        juce::AudioBuffer<float> ir(2, len);
        ir.clear();

        const double damp = std::min((double)(spec.damp > 0 ? spec.damp : 20000.0), sr / 2.0);
        const double lpCoef = std::exp(-2.0 * 3.141592653589793 * damp / sr);   // 1-pole LP retention
        const double stereo = std::max(0.0, std::min(1.0, spec.width / 1.5));     // 0=mono .. 1=decorrelated
        float* L = ir.getWritePointer(0);
        float* R = ir.getWritePointer(1);
        juce::Random rng (0x5eed);                                               // deterministic IR
        double lpM = 0, lpL = 0, lpR = 0;
        for (int i = 0; i < tail; ++i)
        {
            const double env = std::pow(1.0 - (double)i / tail, spec.shape > 0 ? spec.shape : 2.0);
            const double nM = (rng.nextDouble() * 2.0 - 1.0) * env;
            const double nL = (rng.nextDouble() * 2.0 - 1.0) * env;
            const double nR = (rng.nextDouble() * 2.0 - 1.0) * env;
            lpM = lpCoef * lpM + (1 - lpCoef) * nM;
            lpL = lpCoef * lpL + (1 - lpCoef) * nL;
            lpR = lpCoef * lpR + (1 - lpCoef) * nR;
            L[pre + i] = (float)((1 - stereo) * lpM + stereo * lpL);
            R[pre + i] = (float)((1 - stereo) * lpM + stereo * lpR);
        }

        // early reflections (discrete taps) — initial spatial signature
        const double er = spec.erGain;
        const double earlies[5][2] = {{0.007, 0.8}, {0.013, -0.6}, {0.019, 0.5}, {0.029, -0.4}, {0.041, 0.3}};
        for (auto& e : earlies)
        {
            const int idx = pre + (int)std::floor(e[0] * sizeScale * sr);
            if (idx < len) { L[idx] += (float)(e[1] * er); R[idx] += (float)(e[1] * er * (0.85 + 0.3 * stereo)); }
        }
        // discrete slap echoes
        for (auto& tap : taps)
        {
            const int idx = pre + (int)std::floor(tap.first * sr);
            if (idx < len) { L[idx] += (float)tap.second; R[idx] += (float)(tap.second * (0.9 + 0.2 * stereo)); }
        }
        return ir;
    }

    void applySoftClipping(juce::AudioBuffer<float>& buffer, int startSample, int numSamples)
    {
        float kn = 0.9f;
        int numChannels = buffer.getNumChannels();
        for (int channel = 0; channel < numChannels; ++channel)
        {
            float* channelData = buffer.getWritePointer(channel, startSample);
            for (int s = 0; s < numSamples; ++s)
            {
                float x = channelData[s];
                float a = std::abs(x);
                if (a > kn)
                {
                    float y = kn + (1.0f - kn) * std::tanh((a - kn) / (1.0f - kn));
                    channelData[s] = x >= 0.0f ? y : -y;
                }
            }
        }
    }

    juce::AudioSource* source;
    double currentSampleRate = 44100.0;

    juce::AudioBuffer<float> reverbSendBuffer;

    using FilterType = juce::dsp::IIR::Filter<float>;
    using FilterDuplicator = juce::dsp::ProcessorDuplicator<FilterType, juce::dsp::IIR::Coefficients<float>>;
    std::array<FilterDuplicator, 9> eqFilters;
    std::atomic<float> eqBands[9];
    // EQ coefficients (eqFilters[i].state, a ref-counted pointer) must only ever be
    // reassigned on the audio thread; mutating it from the message thread while the
    // audio thread reads it in process() races the coefficient object's ref-count and
    // causes use-after-free / heap corruption. Setters just flag this dirty; the audio
    // thread rebuilds the coefficients at the top of getNextAudioBlock.
    std::atomic<bool> eqDirty { true };

    juce::Reverb reverb;
    std::atomic<float> reverbLevel { 0.0f };

    FeedbackDelay delay;
    std::atomic<float> echoLevel { 0.0f };
    std::atomic<float> widenerLevel { 0.0f };
    std::atomic<float> saturationLevel { 0.0f };
    std::atomic<float> exciterLevel { 0.0f };
    std::array<HighPassFilter, 2> exciterHpf;

    // Ambience (room) convolution send — port of the web makeRoomIR + ConvolverNode.
    // IR is (re)built on the message thread in setRoom()/loadRoomIR() and swapped in via
    // Convolution::loadImpulseResponse (thread-safe); the audio thread only reads roomWet
    // / roomReady and calls process().
    juce::dsp::Convolution roomConvolution;
    juce::AudioBuffer<float> roomBuffer;
    std::atomic<float> roomWet { 0.0f };
    std::atomic<bool> roomReady { false };
    RoomSpec roomSpec;
    bool roomConvPrepared = false;

    std::atomic<float> masterMagnitudeL { 0.0f };
    std::atomic<float> masterMagnitudeR { 0.0f };

    // Spectrum-meter band analysis — 9 bandpass filters aligned to the web
    // engine's EQ_FREQS (audio-engine.js), run on a mono mix of the final output.
    // Audio thread writes bandLevels; the WebSocket broadcast thread reads them.
    static constexpr float kBandFreqs[9] = { 60.0f, 150.0f, 320.0f, 640.0f, 1200.0f,
                                             2400.0f, 4800.0f, 9000.0f, 15000.0f };
    std::array<juce::dsp::IIR::Filter<float>, 9> bandAnalysisFilters;
    std::array<std::atomic<float>, 9> bandLevels;
    float bandDbOffset[9] = { 0.0f }; // set in prepareToPlay, read on the audio thread
    juce::AudioBuffer<float> bandScratch;

    // Master fade (in/out) state. All in output samples. fadeTotalSamples == 0 disables.
    std::atomic<juce::int64> fadeInSamples { 0 };
    std::atomic<juce::int64> fadeOutSamples { 0 };
    std::atomic<juce::int64> fadeTotalSamples { 0 };
    std::atomic<juce::int64> fadePosSamples { 0 };
    std::atomic<bool> fadeActive { false };
    std::atomic<bool> fadeLooping { false };
};

#endif

class AudioEngine
#if USE_JUCE
    // Listens for device add/remove so a hot-unplugged input can be noticed. JUCE's
    // AudioDeviceManager will NOT do it for us: audioDeviceListChanged() only reopens
    // when `currentAudioDevice->getName()` vanishes from the list, and for a WASAPI
    // in+out device that name is the OUTPUT endpoint. Unplug only the mic and the
    // output is still there, so JUCE keeps the device — with a dead input inside it.
    : private juce::AudioIODeviceType::Listener
#endif
{
public:
    AudioEngine();
    ~AudioEngine();

    void init(int sampleRate);
    void play();
    void pause();
    void stop();
    void seek(double positionSeconds);
    void setLoop(bool enabled);
    // Repeat region. Positions are project-timeline seconds. While enabled, playback
    // wraps at `endSeconds` inside the audio callback (see LoopAudioSource) instead of
    // being polled and seeked from JS.
    void setLoopRange(double startSeconds, double endSeconds, bool enabled);

    void loadTrack(const std::string& trackId, const std::string& filePath,
                   double startSeconds = 0.0, double songLength = 0.0);
    void removeTrack(const std::string& trackId);
    void setTrackParam(const std::string& trackId, const std::string& key, float value);
    void setTrackAutomation(const std::string& trackId, bool autoOn, bool curved, const std::vector<float>& flatPoints);
    void clearTracks();
    void clearAllMuteSolo();
    
    void setProjectBpm(double bpm);
    void setPlaybackBpm(double bpm);
    void setVariBpm(bool on);
    void setVariKey(bool on);
    void setKey(const std::string& key);
    void setDetectedKey(const std::string& key);
    void setKeyShift(int semitones);

    void setMaster(const std::string& key, float value);
    void setMasterBand(int index, float db);
    void setMasterBands(const std::vector<float>& bands);
    void setRoom(const RoomSpec& spec);

    void exportMix(const std::string& exportId,
                   const std::string& tempOutputPath,
                   double targetSampleRate,
                   double durationSeconds,
                   bool normalize,
                   float lufsTarget,
                   bool preservePitch,
                   double fadeInSeconds,
                   double fadeOutSeconds,
                   std::function<void(float)> progressCallback,
                   std::function<void(const std::string&, const std::string&)> completionCallback);

    // Invoked from the background loader thread (WITHOUT engineMutex held) after
    // each async loadTrack finishes: (trackId, success, loads still pending).
    // The WebSocket server uses it to broadcast a "trackLoaded" event so the UI
    // bridge knows when the native engine is actually ready to play.
    // Assigned/read under loadMutex: the server clears it (nullptr) in stop() so
    // a load finishing during shutdown cannot call into a destroyed server.
    void setTrackLoadedCallback(std::function<void(const std::string&, bool, int)> cb);

    // Invoked (message thread) when the input device we had opened disappears from the
    // system — a pulled USB mic. Nothing else can tell the UI: the device object survives
    // the unplug, so an armed track simply goes quiet with no error. The server
    // broadcasts an "audioInputLost" event so the UI can drop ARM. Deliberately only a
    // NOTIFICATION: reopening here would close the output too and cut playback.
    // Assigned/read under deviceLostMutex; the server clears it on shutdown.
    void setInputDeviceLostCallback(std::function<void(const std::string&)> cb);


    // Block until the background load queue is drained (offline export must not
    // render while tracks are still decoding, or it would miss them).
    void waitForLoadsIdle(int timeoutMs = 180000);

    // Audio output device selection (settings UI). Safe to call from the WebSocket
    // client threads — the JUCE device work is marshalled to the message thread
    // (WASAPI objects are COM apartment-affine). getAudioDevicesJson returns a
    // ready-to-broadcast "audioDevices" event; setAudioDevice returns an error
    // string ("" = success). Empty type/name select the system defaults.
    std::string getAudioDevicesJson();
    std::string setAudioDevice(const std::string& typeName, const std::string& deviceName);
    // outputName sets the output endpoint in the SAME setup call so a device-type
    // switch (e.g. into Exclusive Mode) can never leave the output on a stale/wrong
    // default. Empty outputName preserves the current output.
    std::string setAudioInput(const std::string& typeName, const std::string& deviceName,
                              const std::string& outputName,
                              int channel, bool stereo, double requestedSampleRate, int requestedBufferSize);
    void setInputGain(float gain) { inputRecorder.setInputGain(gain); }
    std::string startRecording(const std::string& filePath, int channel, bool stereo,
                               float gain, bool monitor, bool limiter);
    std::string stopRecording();
    void cancelRecording();
    bool isRecording() const;
    float getInputMagnitude() const;
    float getInputGainReduction() const;
    long long getRecordedSamples() const;
    std::vector<InputRecorder::PeakPoint> drainRecordingPeaks();
    double getCurrentSampleRate() const { return sampleRate; }
    // Sample rate the active take is written at. Used to time the live recording
    // peaks so the on-screen record bar matches the finalized clip length even
    // when the input device runs at a different rate than the output device.
    double getRecordingSampleRate() const;

    // Getters for status updates
    bool isPlaying() const { return playing; }
    double getPlayhead() const;
    void updatePlayhead();
    float getTrackMagnitude(const std::string& trackId);
    std::pair<float, float> getMasterMagnitude();
    std::vector<float> getMasterBandLevels();

    std::vector<TrackInfo> getTracks() {
        std::lock_guard<std::mutex> lock(engineMutex);
        return tracks;
    }

private:
    mutable std::mutex engineMutex; // mutable so const getters (getPlayhead) can lock too
    std::atomic<bool> initialized { false };
    bool playing = false;
    bool loopEnabled = true;
    double playheadSeconds = 0.0;
    double sampleRate = 44100.0;
    
    double projectBpm = 120.0;
    double playbackBpm = 120.0;
    bool variBpm = false;
    bool variKey = false;
    std::string currentKey = "";
    std::string detectedKey = "";
    // Authoritative semitone offset from JS (−6..+6). Preferred over re-deriving
    // the shift from the currentKey/detectedKey strings.
    int keyShift = 0;
    
    float masterVolume = 1.0f;
    float fadeIn = 0.0f;   // master fade-in length (project seconds)
    float fadeOut = 0.0f;  // master fade-out length (project seconds)
    std::vector<TrackInfo> tracks;

#if USE_JUCE
    juce::AudioDeviceManager deviceManager;
    juce::AudioSourcePlayer sourcePlayer;
    InputRecorder inputRecorder;
    juce::MixerAudioSource mixerSource;
    juce::AudioFormatManager formatManager;
    std::unique_ptr<LoopAudioSource> loopSource;
    std::unique_ptr<GainAudioSource> masterGainSource;
    std::unique_ptr<MasterEffectsAudioSource> masterEffectsSource;
    std::vector<std::unique_ptr<TrackAudioSource>> juceTracks;

    // Guards the juceTracks VECTOR ITSELF (element add/replace/erase), not the engine
    // state that engineMutex covers. The audio thread walks the vector to rewind the
    // transports at a loop boundary and must never wait on a lock (work principle 5),
    // so it uses a ScopedTryLock and skips the rewind on the rare block that collides
    // with a track install; the command thread always takes this INSIDE engineMutex
    // before mutating the vector, so a track can never be destroyed under the audio
    // thread's feet.
    juce::CriticalSection tracksLock;

    // Loop-boundary rewind. AUDIO THREAD ONLY (invoked by LoopAudioSource).
    void rewindTracksForLoop(double timelineSeconds, double outputSampleRate);

    // juce::AudioIODeviceType::Listener — a device was added or removed.
    void audioDeviceListChanged() override;
    // Set on any hot-plug, cleared by the next successful full input open. It exists to
    // veto the "keep the warm device" fast path in setAudioInput: after an unplug the
    // cached setup still names the mic and the device object still reports its input
    // channels, so every field matches and the fast path would hand back the SAME dead
    // stream — even after the mic is plugged back in.
    std::atomic<bool> deviceTopologyChanged { false };
    // Input device names seen at the last setAudioInput scan. Message thread only.
    // Backs the listener-independent hot-plug check (see setAudioInput).
    juce::StringArray lastInputDeviceList;
    // The input device/type we last opened successfully — what "our mic" means when the
    // device list changes. Message thread only.
    juce::String openedInputName, openedInputType;
    bool openedInputMissing = false; // so the loss is announced once, not per event
    std::function<void(const std::string&)> onInputDeviceLost; // guarded by deviceLostMutex
    std::mutex deviceLostMutex;
    // Device types we attached the change listener to. Only logged (FOCUSDAW_VERBOSE):
    // if this is ever 0 the hot-plug detection is dead and nothing else will say so.
    int deviceListenerCount = 0;

    void updateSoloStates();
#endif
    void updateDspParams();
    // Configure the master fade window from the current fadeIn/fadeOut state for a
    // given timeline length (output seconds) and sample rate. No-op without JUCE.
    void configureMasterFade(double songLenSeconds, double sr);

    // ---- Asynchronous track loading -------------------------------------------
    // Decoding (ffmpeg + full PCM read) used to run synchronously on the WebSocket
    // receive thread while holding engineMutex, which blocked every subsequent
    // command (play!) and the position broadcasts for seconds after startup. Loads
    // are now queued to a single background worker; only the final install of the
    // decoded track takes engineMutex.
    struct LoadJob
    {
        std::string trackId;
        std::string filePath;
        double startSeconds = 0.0; // clip position on the song timeline (lead-in silence)
        double songLength = 0.0;   // pad the buffer to this length so looping wraps at the song boundary
        uint64_t generation = 0; // voided by clearTracks
        uint64_t seq = 0;        // superseded by a newer load of the same track
    };
    void loaderLoop();
    bool decodeAndInstallTrack(const LoadJob& job); // heavy work, engineMutex only for install
    int pendingLoadCount();                          // queue + in-flight (locks loadMutex)

    std::deque<LoadJob> loadQueue;      // guarded by loadMutex
    std::mutex loadMutex;
    std::function<void(const std::string&, bool, int)> onTrackLoaded; // guarded by loadMutex
    std::condition_variable loadCv;     // wakes the worker (new job / exit)
    std::condition_variable loadIdleCv; // wakes waitForLoadsIdle when drained
    bool loaderExit = false;            // guarded by loadMutex
    bool loaderBusy = false;            // guarded by loadMutex
    uint64_t loadGeneration = 0;                  // guarded by engineMutex
    uint64_t loadSeqCounter = 0;                  // guarded by engineMutex
    std::map<std::string, uint64_t> latestLoadSeq; // guarded by engineMutex
    std::thread loaderThread;
};
