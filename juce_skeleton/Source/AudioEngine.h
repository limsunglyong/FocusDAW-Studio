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
#include <mutex>
#include <atomic>
#include <functional>

#if USE_JUCE
#include "SoundTouch.h"
#include <juce_dsp/juce_dsp.h>
#endif

struct TrackInfo
{
    std::string id;
    std::string filePath;
    float volume = 1.0f;
    float pan = 0.0f;
    bool mute = false;
    bool solo = false;
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

class SoundTouchAudioSource : public juce::PositionableAudioSource
{
public:
    SoundTouchAudioSource(juce::PositionableAudioSource* inputSource, bool deleteInputWhenDeleted)
        : source(inputSource), deleteInput(deleteInputWhenDeleted)
    {
        soundTouch.setSampleRate(44100);
        soundTouch.setChannels(2);
        soundTouch.setTempo(1.0);
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
        
        if (currentPreserve)
        {
            soundTouch.setTempo(currentTempo);
            soundTouch.setPitchSemiTones(currentPitch);
        }
        else
        {
            soundTouch.setRate(currentTempo);
            soundTouch.setPitchSemiTones(0.0f);
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

// TrackAudioSource manages reader source, transport control, volume, pan, mute, and solo
class TrackAudioSource : public juce::PositionableAudioSource
{
public:
    TrackAudioSource(std::unique_ptr<juce::AudioFormatReaderSource> reader, double deviceSampleRate)
    {
        readerSource = std::move(reader);
#if USE_JUCE
        soundTouchSource = std::make_unique<SoundTouchAudioSource>(readerSource.get(), false);
        transportSource = std::make_unique<juce::AudioTransportSource>();
        transportSource->setSource(soundTouchSource.get(), 0, nullptr, readerSource->getAudioFormatReader()->sampleRate);
#else
        transportSource = std::make_unique<juce::AudioTransportSource>();
        transportSource->setSource(readerSource.get(), 0, nullptr, readerSource->getAudioFormatReader()->sampleRate);
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
        if (mute || (soloActive && !solo)) {
            bufferToFill.clearActiveBufferRegion();
            currentMagnitude.store(0.0f);
            return;
        }
        transportSource->getNextAudioBlock(bufferToFill);

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
            for (int channel = 0; channel < numChannels; ++channel)
            {
                const float* src = bufferToFill.buffer->getReadPointer(channel, bufferToFill.startSample);
                float* dst = reverbSendBuffer->getWritePointer(channel);
                for (int s = 0; s < bufferToFill.numSamples; ++s)
                {
                    dst[s] += src[s] * currentRev;
                }
            }
        }

        // Apply volume and pan
        float currentGain = volume;
        if (currentGain != 1.0f || pan != 0.0f) {
            for (int channel = 0; channel < bufferToFill.buffer->getNumChannels(); ++channel) {
                float channelGain = currentGain;
                if (pan != 0.0f) {
                    if (channel == 0 && pan > 0.0f) channelGain *= (1.0f - pan);
                    else if (channel == 1 && pan < 0.0f) channelGain *= (1.0f + pan);
                }
                bufferToFill.buffer->applyGain(channel, bufferToFill.startSample, bufferToFill.numSamples, channelGain);
            }
        }

        float mag = bufferToFill.buffer->getMagnitude(bufferToFill.startSample, bufferToFill.numSamples);
        currentMagnitude.store(mag);
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
        if (readerSource) readerSource->setLooping(shouldLoop);
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

    std::string id;
    std::unique_ptr<juce::AudioFormatReaderSource> readerSource;
#if USE_JUCE
    std::unique_ptr<SoundTouchAudioSource> soundTouchSource;
#endif
    std::unique_ptr<juce::AudioTransportSource> transportSource;
    float volume = 1.0f;
    float pan = 0.0f;
    bool mute = false;
    bool solo = false;
    bool soloActive = false;

    std::atomic<float> reverbSend { 0.0f };
    std::atomic<float> echoSend { 0.0f };
    std::atomic<float> currentMagnitude { 0.0f };
    juce::AudioBuffer<float>* reverbSendBuffer = nullptr;
    FeedbackDelay echoDelay;
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

        // 1. Clear reverb send buffer
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
            float w = 1.0f + currentWidth;
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
                    float x = data[i];
                    float hp = exciterHpf[channel].processSample(channel, x);
                    float harmonics = hp * std::abs(hp) * 1.5f;
                    data[i] = x + harmonics * currentExciter * 0.35f;
                }
            }
        }

        // 9. Apply Soft-clipper to prevent clipping
        applySoftClipping(*bufferToFill.buffer, bufferToFill.startSample, bufferToFill.numSamples);

        float magL = (bufferToFill.buffer->getNumChannels() > 0) ? bufferToFill.buffer->getMagnitude(0, bufferToFill.startSample, bufferToFill.numSamples) : 0.0f;
        float magR = (bufferToFill.buffer->getNumChannels() > 1) ? bufferToFill.buffer->getMagnitude(1, bufferToFill.startSample, bufferToFill.numSamples) : magL;
        masterMagnitudeL.store(magL);
        masterMagnitudeR.store(magR);
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

    float getMagnitudeL() const { return masterMagnitudeL.load(); }
    float getMagnitudeR() const { return masterMagnitudeR.load(); }

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

            eqFilters[i].state = juce::dsp::IIR::Coefficients<float>::makePeakFilter(sr, freq, 1.1f, gainFactor);
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
    }

    juce::AudioBuffer<float>* getReverbSendBuffer() { return &reverbSendBuffer; }

private:
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

    std::atomic<float> masterMagnitudeL { 0.0f };
    std::atomic<float> masterMagnitudeR { 0.0f };
};

#endif

class AudioEngine
{
public:
    AudioEngine();
    ~AudioEngine();

    void init(int sampleRate);
    void play();
    void pause();
    void stop();
    void seek(double positionSeconds);
    
    void loadTrack(const std::string& trackId, const std::string& filePath);
    void setTrackParam(const std::string& trackId, const std::string& key, float value);
    void clearTracks();
    
    void setProjectBpm(double bpm);
    void setPlaybackBpm(double bpm);
    void setVariBpm(bool on);
    void setVariKey(bool on);
    void setKey(const std::string& key);
    void setDetectedKey(const std::string& key);
    
    void setMaster(const std::string& key, float value);
    void setMasterBand(int index, float db);
    void setMasterBands(const std::vector<float>& bands);

    void exportMix(const std::string& exportId,
                   const std::string& tempOutputPath,
                   double targetSampleRate,
                   double durationSeconds,
                   bool normalize,
                   float lufsTarget,
                   bool preservePitch,
                   std::function<void(float)> progressCallback,
                   std::function<void(const std::string&, const std::string&)> completionCallback);

    // Getters for status updates
    bool isPlaying() const { return playing; }
    double getPlayhead() const;
    void updatePlayhead();
    float getTrackMagnitude(const std::string& trackId);
    std::pair<float, float> getMasterMagnitude();

    std::vector<TrackInfo> getTracks() {
        std::lock_guard<std::mutex> lock(engineMutex);
        return tracks;
    }

private:
    mutable std::mutex engineMutex; // mutable so const getters (getPlayhead) can lock too
    bool playing = false;
    double playheadSeconds = 0.0;
    double sampleRate = 44100.0;
    
    double projectBpm = 120.0;
    double playbackBpm = 120.0;
    bool variBpm = false;
    bool variKey = false;
    std::string currentKey = "";
    std::string detectedKey = "";
    
    float masterVolume = 1.0f;
    std::vector<TrackInfo> tracks;

#if USE_JUCE
    juce::AudioDeviceManager deviceManager;
    juce::AudioSourcePlayer sourcePlayer;
    juce::MixerAudioSource mixerSource;
    juce::AudioFormatManager formatManager;
    std::unique_ptr<GainAudioSource> masterGainSource;
    std::unique_ptr<MasterEffectsAudioSource> masterEffectsSource;
    std::vector<std::unique_ptr<TrackAudioSource>> juceTracks;

    void updateSoloStates();
#endif
    void updateDspParams();
};
