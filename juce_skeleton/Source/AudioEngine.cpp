#include "AudioEngine.h"
#include <fstream>
#include <cmath>
#include <algorithm>
#include <cstdlib>
#include <thread>
#include <chrono>

AudioEngine::AudioEngine()
{
#if USE_JUCE
    formatManager.registerBasicFormats();
    masterGainSource = std::make_unique<GainAudioSource>(&mixerSource, false);
    masterEffectsSource = std::make_unique<MasterEffectsAudioSource>(masterGainSource.get());
    sourcePlayer.setSource(masterEffectsSource.get());
#endif
}

AudioEngine::~AudioEngine()
{
#if USE_JUCE
    deviceManager.removeAudioCallback(&sourcePlayer);
    sourcePlayer.setSource(nullptr);
    masterEffectsSource.reset();
    masterGainSource.reset();
    mixerSource.removeAllInputs();
    juceTracks.clear();
#endif
}

void AudioEngine::init(int sr)
{
    std::lock_guard<std::mutex> lock(engineMutex);
    sampleRate = sr;
    std::cout << "[AudioEngine] Initialized with sample rate: " << sampleRate << std::endl;

#if USE_JUCE
    juce::String err = deviceManager.initialiseWithDefaultDevices(0, 2);
    if (err.isEmpty())
    {
        deviceManager.addAudioCallback(&sourcePlayer);
        if (auto* currentDevice = deviceManager.getCurrentAudioDevice())
        {
            sampleRate = currentDevice->getCurrentSampleRate();
            std::cout << "[AudioEngine] JUCE audio device opened successfully. Sample Rate: " << sampleRate 
                      << ", Buffer Size: " << currentDevice->getCurrentBufferSizeSamples() << std::endl;
        }
    }
    else
    {
        std::cerr << "[AudioEngine] Failed to open audio device: " << err.toStdString() << std::endl;
    }
#endif
}

void AudioEngine::play()
{
    std::lock_guard<std::mutex> lock(engineMutex);
    playing = true;
    std::cout << "[AudioEngine] Playback started" << std::endl;

#if USE_JUCE
    for (auto& track : juceTracks)
    {
        if (track->transportSource) track->transportSource->start();
    }
#endif
}

void AudioEngine::pause()
{
    std::lock_guard<std::mutex> lock(engineMutex);
    playing = false;

#if USE_JUCE
    if (!juceTracks.empty() && juceTracks[0]->transportSource)
    {
        playheadSeconds = juceTracks[0]->transportSource->getCurrentPosition();
    }
    for (auto& track : juceTracks)
    {
        if (track->transportSource) track->transportSource->stop();
    }
#endif

    std::cout << "[AudioEngine] Playback paused at " << playheadSeconds << "s" << std::endl;
}

void AudioEngine::stop()
{
    std::lock_guard<std::mutex> lock(engineMutex);
    playing = false;
    playheadSeconds = 0.0;
    std::cout << "[AudioEngine] Playback stopped" << std::endl;

#if USE_JUCE
    for (auto& track : juceTracks)
    {
        if (track->transportSource)
        {
            track->transportSource->stop();
            track->transportSource->setPosition(0.0);
        }
    }
#endif
}

void AudioEngine::seek(double positionSeconds)
{
    std::lock_guard<std::mutex> lock(engineMutex);
    playheadSeconds = positionSeconds;
    std::cout << "[AudioEngine] Seek to: " << playheadSeconds << "s" << std::endl;

#if USE_JUCE
    for (auto& track : juceTracks)
    {
        if (track->transportSource)
        {
            track->transportSource->setPosition(positionSeconds);
        }
    }
#endif
}

void AudioEngine::loadTrack(const std::string& trackId, const std::string& filePath)
{
    std::lock_guard<std::mutex> lock(engineMutex);

    bool found = false;
    for (auto& t : tracks)
    {
        if (t.id == trackId)
        {
            t.filePath = filePath;
            found = true;
            break;
        }
    }
    if (!found)
    {
        TrackInfo nt;
        nt.id = trackId;
        nt.filePath = filePath;
        tracks.push_back(nt);
    }

#if USE_JUCE
    juce::File file(filePath);
    if (!file.existsAsFile())
    {
        std::cerr << "[AudioEngine] File not found: " << filePath << std::endl;
        return;
    }

    auto* reader = formatManager.createReaderFor(file);
    if (reader == nullptr)
    {
        std::cerr << "[AudioEngine] Failed to create reader for file: " << filePath << std::endl;
        return;
    }

    auto readerSource = std::make_unique<juce::AudioFormatReaderSource>(reader, true);
    double deviceSampleRate = 44100.0;
    if (auto* currentDevice = deviceManager.getCurrentAudioDevice())
    {
        deviceSampleRate = currentDevice->getCurrentSampleRate();
    }

    auto trackSource = std::make_unique<TrackAudioSource>(std::move(readerSource), deviceSampleRate);

    // Sync parameters
    for (const auto& t : tracks)
    {
        if (t.id == trackId)
        {
            trackSource->volume = t.volume;
            trackSource->pan = t.pan;
            trackSource->mute = t.mute;
            trackSource->solo = t.solo;
            break;
        }
    }

    trackSource->setLooping(true);
    trackSource->id = trackId;

    for (size_t i = 0; i < juceTracks.size(); ++i)
    {
        if (juceTracks[i]->id == trackId)
        {
            mixerSource.removeInputSource(juceTracks[i].get());
            juceTracks[i] = std::move(trackSource);
            juceTracks[i]->reverbSendBuffer = masterEffectsSource ? masterEffectsSource->getReverbSendBuffer() : nullptr;
            mixerSource.addInputSource(juceTracks[i].get(), false);

            if (playing)
            {
                juceTracks[i]->transportSource->start();
                juceTracks[i]->transportSource->setPosition(playheadSeconds);
            }

            updateSoloStates();
            updateDspParams();
            std::cout << "[AudioEngine] Track " << trackId << " reloaded and replaced in JUCE engine." << std::endl;
            return;
        }
    }

    trackSource->reverbSendBuffer = masterEffectsSource ? masterEffectsSource->getReverbSendBuffer() : nullptr;
    mixerSource.addInputSource(trackSource.get(), false);
    if (playing)
    {
        trackSource->transportSource->start();
        trackSource->transportSource->setPosition(playheadSeconds);
    }

    juceTracks.push_back(std::move(trackSource));
    updateSoloStates();
    updateDspParams();
    std::cout << "[AudioEngine] Track " << trackId << " loaded in JUCE engine." << std::endl;
#else
    std::cout << "[AudioEngine] Mock Track " << trackId << " loaded with " << filePath << std::endl;
#endif
}

void AudioEngine::setTrackParam(const std::string& trackId, const std::string& key, float value)
{
    std::lock_guard<std::mutex> lock(engineMutex);
    for (auto& t : tracks)
    {
        if (t.id == trackId)
        {
            if (key == "volume") t.volume = value;
            else if (key == "pan") t.pan = value;
            else if (key == "mute") t.mute = (value > 0.5f);
            else if (key == "solo") t.solo = (value > 0.5f);
            break;
        }
    }

#if USE_JUCE
    for (auto& track : juceTracks)
    {
        if (track->id == trackId)
        {
            if (key == "volume")
            {
                track->volume = value;
            }
            else if (key == "pan")
            {
                track->pan = value;
            }
            else if (key == "mute")
            {
                track->mute = (value > 0.5f);
            }
            else if (key == "solo")
            {
                track->solo = (value > 0.5f);
                updateSoloStates();
            }
            else if (key == "reverb")
            {
                track->reverbSend.store(value);
            }
            else if (key == "echo")
            {
                track->echoSend.store(value);
            }
            break;
        }
    }
#endif

    std::cout << "[AudioEngine] Parameter " << key << " set to " << value << " for track " << trackId << std::endl;
}

void AudioEngine::clearTracks()
{
    std::lock_guard<std::mutex> lock(engineMutex);
    tracks.clear();
    playheadSeconds = 0.0;
    playing = false;

#if USE_JUCE
    mixerSource.removeAllInputs();
    juceTracks.clear();
#endif

    std::cout << "[AudioEngine] All tracks cleared." << std::endl;
}

static int getSemitoneDifference(const std::string& origKey, const std::string& targetKey)
{
    auto getPitchClass = [](const std::string& k) -> int {
        if (k.empty()) return -1;
        std::string name = k;
        if (name.back() == 'm') name = name.substr(0, name.size() - 1);
        
        if (name == "C") return 0;
        if (name == "C#" || name == "Db") return 1;
        if (name == "D") return 2;
        if (name == "D#" || name == "Eb") return 3;
        if (name == "E") return 4;
        if (name == "F") return 5;
        if (name == "F#" || name == "Gb") return 6;
        if (name == "G") return 7;
        if (name == "G#" || name == "Ab") return 8;
        if (name == "A") return 9;
        if (name == "A#" || name == "Bb") return 10;
        if (name == "B") return 11;
        return -1;
    };
    
    int orig = getPitchClass(origKey);
    int target = getPitchClass(targetKey);
    if (orig == -1 || target == -1) return 0;
    
    int diff = target - orig;
    while (diff > 6) diff -= 12;
    while (diff < -6) diff += 12;
    return diff;
}

void AudioEngine::setProjectBpm(double bpm)
{
    std::lock_guard<std::mutex> lock(engineMutex);
    projectBpm = bpm;
    std::cout << "[AudioEngine] Project BPM set to " << projectBpm << std::endl;
    updateDspParams();
}

void AudioEngine::setPlaybackBpm(double bpm)
{
    std::lock_guard<std::mutex> lock(engineMutex);
    playbackBpm = bpm;
    std::cout << "[AudioEngine] Playback BPM set to " << playbackBpm << std::endl;
    updateDspParams();
}

void AudioEngine::setVariBpm(bool on)
{
    std::lock_guard<std::mutex> lock(engineMutex);
    variBpm = on;
    std::cout << "[AudioEngine] Vari BPM: " << (variBpm ? "ON" : "OFF") << std::endl;
    updateDspParams();
}

void AudioEngine::setVariKey(bool on)
{
    std::lock_guard<std::mutex> lock(engineMutex);
    variKey = on;
    std::cout << "[AudioEngine] Vari Key: " << (variKey ? "ON" : "OFF") << std::endl;
    updateDspParams();
}

void AudioEngine::setKey(const std::string& key)
{
    std::lock_guard<std::mutex> lock(engineMutex);
    currentKey = key;
    std::cout << "[AudioEngine] Key set to " << currentKey << std::endl;
    updateDspParams();
}

void AudioEngine::setDetectedKey(const std::string& key)
{
    std::lock_guard<std::mutex> lock(engineMutex);
    detectedKey = key;
    std::cout << "[AudioEngine] Detected reference Key set to " << detectedKey << std::endl;
    updateDspParams();
}

void AudioEngine::setMaster(const std::string& key, float value)
{
    std::lock_guard<std::mutex> lock(engineMutex);
    if (key == "volume")
    {
        masterVolume = value;
#if USE_JUCE
        if (masterGainSource) masterGainSource->masterGain.store(value);
#endif
    }
#if USE_JUCE
    else if (key == "reverb")
    {
        if (masterEffectsSource) masterEffectsSource->setReverbLevel(value);
    }
    else if (key == "echo")
    {
        if (masterEffectsSource) masterEffectsSource->setEchoLevel(value);
    }
    else if (key == "widener")
    {
        if (masterEffectsSource) masterEffectsSource->setWidenerLevel(value);
    }
    else if (key == "saturation")
    {
        if (masterEffectsSource) masterEffectsSource->setSaturationLevel(value);
    }
    else if (key == "exciter")
    {
        if (masterEffectsSource) masterEffectsSource->setExciterLevel(value);
    }
#endif
    std::cout << "[AudioEngine] Master parameter " << key << " set to " << value << std::endl;
}

void AudioEngine::setMasterBand(int index, float db)
{
#if USE_JUCE
    if (masterEffectsSource) masterEffectsSource->setMasterBand(index, db);
#endif
    std::cout << "[AudioEngine] Master EQ band " << index << " set to " << db << " dB" << std::endl;
}

void AudioEngine::setMasterBands(const std::vector<float>& bands)
{
#if USE_JUCE
    if (masterEffectsSource)
    {
        for (size_t i = 0; i < std::min(bands.size(), (size_t)9); ++i)
        {
            masterEffectsSource->setMasterBand((int)i, bands[i]);
        }
    }
#endif
    std::cout << "[AudioEngine] Master EQ bands updated" << std::endl;
}

double AudioEngine::getPlayhead() const
{
#if USE_JUCE
    if (!juceTracks.empty() && juceTracks[0]->transportSource)
    {
        return juceTracks[0]->transportSource->getCurrentPosition();
    }
#endif
    return playheadSeconds;
}

void AudioEngine::updatePlayhead()
{
    std::lock_guard<std::mutex> lock(engineMutex);
#if USE_JUCE
    if (playing && !juceTracks.empty() && juceTracks[0]->transportSource)
    {
        playheadSeconds = juceTracks[0]->transportSource->getCurrentPosition();
    }
#else
    if (playing)
    {
        double speed = playbackBpm / projectBpm;
        playheadSeconds += 0.1 * speed;
    }
#endif
}

#if USE_JUCE
void AudioEngine::updateSoloStates()
{
    bool anySolo = false;
    for (const auto& track : juceTracks)
    {
        if (track->solo)
        {
            anySolo = true;
            break;
        }
    }
    for (auto& track : juceTracks)
    {
        track->soloActive = anySolo;
    }
}
#endif

void AudioEngine::updateDspParams()
{
    float targetTempo = 1.0f;
    if (variBpm && projectBpm > 0 && playbackBpm > 0)
    {
        targetTempo = (float)(playbackBpm / projectBpm);
        if (targetTempo < 0.25f) targetTempo = 0.25f;
        if (targetTempo > 4.0f) targetTempo = 4.0f;
    }

    float targetPitchShift = 0.0f;
    if (variKey && !detectedKey.empty() && !currentKey.empty())
    {
        targetPitchShift = (float)getSemitoneDifference(detectedKey, currentKey);
    }

#if USE_JUCE
    for (auto& track : juceTracks)
    {
        track->setTempo(targetTempo);
        track->setPitchShift(targetPitchShift);
    }
#endif
    
    std::cout << "[AudioEngine] DSP parameters updated: Tempo=" << targetTempo 
              << ", PitchShift=" << targetPitchShift << " semitones" << std::endl;
}

void AudioEngine::exportMix(const std::string& exportId,
                            const std::string& tempOutputPath,
                            double targetSampleRate,
                            double durationSeconds,
                            bool normalize,
                            float lufsTarget,
                            bool preservePitch,
                            std::function<void(float)> progressCallback,
                            std::function<void(const std::string&, const std::string&)> completionCallback)
{
#if !USE_JUCE
    // ==========================================
    // Mock Mode Implementation (USE_JUCE=0)
    // ==========================================
    std::cout << "[AudioEngine] Mock Export started: id=" << exportId 
              << ", path=" << tempOutputPath << ", sampleRate=" << targetSampleRate 
              << ", duration=" << durationSeconds << ", normalize=" << normalize 
              << ", target=" << lufsTarget << ", preservePitch=" << preservePitch << std::endl;

    struct WavHeader {
        char riff[4] = {'R', 'I', 'F', 'F'};
        uint32_t fileSize = 0;
        char wave[4] = {'W', 'A', 'V', 'E'};
        char fmt[4] = {'f', 'm', 't', ' '};
        uint32_t fmtLen = 16;
        uint16_t formatType = 1; // PCM
        uint16_t channels = 2;
        uint32_t sampleRate = 44100;
        uint32_t byteRate = 44100 * 2 * 2;
        uint16_t blockAlign = 4;
        uint16_t bitsPerSample = 16;
        char data[4] = {'d', 'a', 't', 'a'};
        uint32_t dataLen = 0;
    };

    std::ofstream out(tempOutputPath, std::ios::binary);
    if (!out) {
        completionCallback("", "Failed to create output file for mock export");
        return;
    }

    WavHeader header;
    header.sampleRate = (uint32_t)targetSampleRate;
    header.byteRate = header.sampleRate * 2 * 2;
    uint32_t numSamples = (uint32_t)(targetSampleRate * durationSeconds);
    header.dataLen = numSamples * 2 * 2;
    header.fileSize = 44 + header.dataLen - 8;

    out.write(reinterpret_cast<const char*>(&header), 44);
    std::vector<char> silence(4096, 0);
    uint32_t bytesWritten = 0;
    while (bytesWritten < header.dataLen) {
        uint32_t toWrite = std::min((uint32_t)silence.size(), header.dataLen - bytesWritten);
        out.write(silence.data(), toWrite);
        bytesWritten += toWrite;
    }
    out.close();

    int steps = normalize ? 20 : 10;
    for (int i = 1; i <= steps; ++i) {
        std::this_thread::sleep_for(std::chrono::milliseconds(150));
        float p = (float)i / (float)steps;
        progressCallback(p);
    }

    std::cout << "[AudioEngine] Mock Export completed: " << tempOutputPath << std::endl;
    completionCallback(tempOutputPath, "");

#else
    // ==========================================
    // JUCE Engine Implementation (USE_JUCE=1)
    // ==========================================
    std::cout << "[AudioEngine] JUCE Offline Export started: id=" << exportId 
              << ", path=" << tempOutputPath << ", sampleRate=" << targetSampleRate 
              << ", duration=" << durationSeconds << ", normalize=" << normalize 
              << ", target=" << lufsTarget << ", preservePitch=" << preservePitch << std::endl;

    bool wasPlaying = false;
    std::vector<TrackAudioSource*> activeTracks;
    
    {
        std::lock_guard<std::mutex> lock(engineMutex);
        wasPlaying = playing;
        if (playing) {
            playing = false;
            for (auto& track : juceTracks) {
                if (track->transportSource) track->transportSource->stop();
            }
        }
        
        for (auto& track : juceTracks) {
            activeTracks.push_back(track.get());
        }
    }

    struct Biquad {
        double b0 = 1, b1 = 0, b2 = 0;
        double a1 = 0, a2 = 0;
        double x1 = 0, x2 = 0;
        double y1 = 0, y2 = 0;
        void reset() { x1 = x2 = y1 = y2 = 0; }
        inline double process(double x) {
            double y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
            x2 = x1;
            x1 = x;
            y2 = y1;
            y1 = y;
            return y;
        }
    };

    Biquad filterL1, filterL2, filterR1, filterR2;
    if (std::abs(targetSampleRate - 48000.0) < 1000.0) {
        filterL1.b0 = 1.53512485958697; filterL1.b1 = -2.69169618940638; filterL1.b2 = 1.19839281085188;
        filterL1.a1 = -1.69065929318241; filterL1.a2 = 0.73248077421538;
        filterL2.b0 = 1.0; filterL2.b1 = -2.0; filterL2.b2 = 1.0;
        filterL2.a1 = -1.99004745410009; filterL2.a2 = 0.99007225016205;
    } else {
        filterL1.b0 = 1.5306585975175342; filterL1.b1 = -2.650960341708842; filterL1.b2 = 1.1690802613271708;
        filterL1.a1 = -1.663655113276838; filterL1.a2 = 0.7124336304127003;
        filterL2.b0 = 1.0; filterL2.b1 = -2.0; filterL2.b2 = 1.0;
        filterL2.a1 = -1.9890530672685913; filterL2.a2 = 0.9890785194459522;
    }
    filterR1 = filterL1; filterR2 = filterL2;

    int samplesPer100ms = (int)(0.1 * targetSampleRate);
    std::vector<double> msL, msR;
    double sumSqL = 0, sumSqR = 0;
    int samplesAccumulated = 0;

    int blockSize = 512;
    juce::int64 totalSamplesToRender = (juce::int64)(durationSeconds * targetSampleRate);
    juce::int64 samplesRendered = 0;

    // Prepare pipeline at export sample rate
    if (masterEffectsSource) {
        masterEffectsSource->prepareToPlay(blockSize, targetSampleRate);
        masterEffectsSource->reset();
    }
    if (masterGainSource) {
        masterGainSource->prepareToPlay(blockSize, targetSampleRate);
        masterGainSource->masterGain.store(masterVolume);
    }

    for (auto* track : activeTracks) {
        track->prepareToPlay(blockSize, targetSampleRate);
        track->reverbSendBuffer = masterEffectsSource ? masterEffectsSource->getReverbSendBuffer() : nullptr;
        track->reset();
        track->setPreservePitch(preservePitch);
        track->transportSource->setPosition(0.0);
        track->transportSource->start();
    }

    bool success = true;
    std::string errorMsg = "";

    // PASS 1: Measurement (Only if normalize is true)
    if (normalize) {
        while (samplesRendered < totalSamplesToRender) {
            int currentBlockSize = (int)std::min((juce::int64)blockSize, totalSamplesToRender - samplesRendered);
            
            juce::AudioBuffer<float> blockBuffer(2, currentBlockSize);
            blockBuffer.clear();
            juce::AudioSourceChannelInfo info(&blockBuffer, 0, currentBlockSize);
            
            if (masterEffectsSource) {
                masterEffectsSource->getNextAudioBlock(info);
            }

            const float* srcL = blockBuffer.getReadPointer(0);
            const float* srcR = blockBuffer.getReadPointer(1);
            for (int i = 0; i < currentBlockSize; ++i) {
                double yL = filterL2.process(filterL1.process(srcL[i]));
                double yR = filterR2.process(filterR1.process(srcR[i]));

                sumSqL += yL * yL;
                sumSqR += yR * yR;
                samplesAccumulated++;

                if (samplesAccumulated >= samplesPer100ms) {
                    msL.push_back(sumSqL / samplesAccumulated);
                    msR.push_back(sumSqR / samplesAccumulated);
                    sumSqL = 0;
                    sumSqR = 0;
                    samplesAccumulated = 0;
                }
            }

            samplesRendered += currentBlockSize;
            progressCallback((float)samplesRendered / (float)totalSamplesToRender * 0.45f);
        }

        if (samplesAccumulated > 0) {
            msL.push_back(sumSqL / samplesAccumulated);
            msR.push_back(sumSqR / samplesAccumulated);
        }
    }

    float targetGain = masterVolume;
    if (normalize) {
        double measuredLufs = -70.0;
        size_t num100ms = msL.size();
        if (num100ms >= 4) {
            std::vector<double> blockLoudness;
            std::vector<double> blockSumMS;
            for (size_t i = 0; i <= num100ms - 4; ++i) {
                double avgL = (msL[i] + msL[i+1] + msL[i+2] + msL[i+3]) / 4.0;
                double avgR = (msR[i] + msR[i+1] + msR[i+2] + msR[i+3]) / 4.0;
                double sumMS = avgL + avgR;
                double db = -0.691 + 10.0 * std::log10(std::max(sumMS, 1e-12));
                blockLoudness.push_back(db);
                blockSumMS.push_back(sumMS);
            }
            double sumMS_Gate1 = 0;
            int count_Gate1 = 0;
            for (size_t i = 0; i < blockLoudness.size(); ++i) {
                if (blockLoudness[i] > -70.0) {
                    sumMS_Gate1 += blockSumMS[i];
                    count_Gate1++;
                }
            }
            if (count_Gate1 > 0) {
                double gamma_a = -0.691 + 10.0 * std::log10(sumMS_Gate1 / count_Gate1);
                double sumMS_Gate2 = 0;
                int count_Gate2 = 0;
                double relativeThreshold = gamma_a - 10.0;
                for (size_t i = 0; i < blockLoudness.size(); ++i) {
                    if (blockLoudness[i] > relativeThreshold) {
                        sumMS_Gate2 += blockSumMS[i];
                        count_Gate2++;
                    }
                }
                if (count_Gate2 > 0) {
                    measuredLufs = -0.691 + 10.0 * std::log10(sumMS_Gate2 / count_Gate2);
                }
            }
        }

        std::cout << "[AudioEngine] Measured LUFS: " << measuredLufs << std::endl;
        
        double gainDb = lufsTarget - measuredLufs;
        if (gainDb > 15.0) gainDb = 15.0;
        targetGain = (float)std::pow(10.0, gainDb / 20.0);
    }

    // Apply normalized gain dynamically
    if (masterGainSource) {
        masterGainSource->masterGain.store(targetGain);
    }

    // Reset pipeline for the second rendering pass
    if (masterEffectsSource) {
        masterEffectsSource->reset();
    }
    for (auto* track : activeTracks) {
        track->reset();
        track->transportSource->setPosition(0.0);
        track->transportSource->start();
    }
    samplesRendered = 0;

    juce::File outputFile (tempOutputPath);
    outputFile.deleteFile();
    
    std::unique_ptr<juce::FileOutputStream> fileStream = outputFile.createOutputStream();
    if (fileStream == nullptr) {
        success = false;
        errorMsg = "Failed to create output stream for temp file: " + tempOutputPath;
    }

    if (success) {
        juce::WavAudioFormat wavFormat;
        std::unique_ptr<juce::AudioFormatWriter> writer (
            wavFormat.createWriterFor(fileStream.get(), targetSampleRate, 2, 16, {}, 0)
        );

        if (writer == nullptr) {
            success = false;
            errorMsg = "Failed to create WAV encoder.";
        } else {
            fileStream.release();

            int limiterLookahead = (int)(0.002 * targetSampleRate);
            if (limiterLookahead < 1) limiterLookahead = 1;
            std::vector<float> limitBufferL(limiterLookahead, 0.0f);
            std::vector<float> limitBufferR(limiterLookahead, 0.0f);
            int limitWriteIdx = 0;
            float envelope = 0.0f;
            float limitThreshold = std::pow(10.0f, -1.0f / 20.0f);
            float releaseFactor = (float)std::exp(-1.0 / (0.05 * targetSampleRate));

            float baseProgress = normalize ? 0.5f : 0.0f;
            float progressScale = normalize ? 0.5f : 1.0f;

            while (samplesRendered < totalSamplesToRender && success) {
                int currentBlockSize = (int)std::min((juce::int64)blockSize, totalSamplesToRender - samplesRendered);
                
                juce::AudioBuffer<float> blockBuffer(2, currentBlockSize);
                blockBuffer.clear();
                juce::AudioSourceChannelInfo info(&blockBuffer, 0, currentBlockSize);
                
                if (masterEffectsSource) {
                    masterEffectsSource->getNextAudioBlock(info);
                }

                float* outL = blockBuffer.getWritePointer(0);
                float* outR = blockBuffer.getWritePointer(1);

                for (int i = 0; i < currentBlockSize; ++i) {
                    float xL = outL[i];
                    float xR = outR[i];

                    limitBufferL[limitWriteIdx] = xL;
                    limitBufferR[limitWriteIdx] = xR;

                    int limitReadIdx = (limitWriteIdx + 1) % limiterLookahead;
                    float delayedL = limitBufferL[limitReadIdx];
                    float delayedR = limitBufferR[limitReadIdx];

                    float peak = 0.0f;
                    for (float val : limitBufferL) peak = std::max(peak, std::abs(val));
                    for (float val : limitBufferR) peak = std::max(peak, std::abs(val));

                    float reduction = 0.0f;
                    if (peak > limitThreshold) {
                        reduction = 1.0f - (limitThreshold / peak);
                    }

                    envelope = std::max(envelope * releaseFactor, reduction);
                    float currentGain = 1.0f - envelope;

                    outL[i] = delayedL * currentGain;
                    outR[i] = delayedR * currentGain;

                    limitWriteIdx = (limitWriteIdx + 1) % limiterLookahead;
                }

                if (!writer->writeFromAudioSampleBuffer(blockBuffer, 0, currentBlockSize)) {
                    success = false;
                    errorMsg = "Disk write failed during export.";
                    break;
                }

                samplesRendered += currentBlockSize;
                progressCallback(baseProgress + ((float)samplesRendered / (float)totalSamplesToRender) * progressScale);
            }
        }
    }

    // Stop and restore track transport settings
    for (auto* track : activeTracks) {
        track->transportSource->stop();
        track->transportSource->setPosition(0.0);
    }

    // Restore real-time playback master gain
    if (masterGainSource) {
        masterGainSource->masterGain.store(masterVolume);
    }

    // Re-prepare pipeline for real-time sample rate & buffer size
    double originalSampleRate = 44100.0;
    int originalBlockSize = 512;
    if (auto* currentDevice = deviceManager.getCurrentAudioDevice()) {
        originalSampleRate = currentDevice->getCurrentSampleRate();
        originalBlockSize = currentDevice->getCurrentBufferSizeSamples();
    }
    
    if (masterEffectsSource) {
        masterEffectsSource->prepareToPlay(originalBlockSize, originalSampleRate);
        masterEffectsSource->reset();
    }
    if (masterGainSource) {
        masterGainSource->prepareToPlay(originalBlockSize, originalSampleRate);
    }
    for (auto* track : activeTracks) {
        track->prepareToPlay(originalBlockSize, originalSampleRate);
        track->reverbSendBuffer = masterEffectsSource ? masterEffectsSource->getReverbSendBuffer() : nullptr;
        track->reset();
        track->setPreservePitch(true);
    }

    {
        std::lock_guard<std::mutex> lock(engineMutex);
        if (wasPlaying) {
            playing = true;
            for (auto& track : juceTracks) {
                if (track->transportSource) {
                    track->transportSource->setPosition(playheadSeconds);
                    track->transportSource->start();
                }
            }
        }
    }

    if (success) {
        std::cout << "[AudioEngine] JUCE Offline Export completed successfully: " << tempOutputPath << std::endl;
        completionCallback(tempOutputPath, "");
    } else {
        std::cerr << "[AudioEngine] JUCE Offline Export failed: " << errorMsg << std::endl;
        completionCallback("", errorMsg);
    }
#endif
}

float AudioEngine::getTrackMagnitude(const std::string& trackId)
{
#if USE_JUCE
    std::lock_guard<std::mutex> lock(engineMutex);
    for (auto& track : juceTracks)
    {
        if (track->id == trackId)
        {
            return track->currentMagnitude.load();
        }
    }
#endif
    return 0.0f;
}

std::pair<float, float> AudioEngine::getMasterMagnitude()
{
#if USE_JUCE
    std::lock_guard<std::mutex> lock(engineMutex);
    if (masterEffectsSource)
    {
        return { masterEffectsSource->getMagnitudeL(), masterEffectsSource->getMagnitudeR() };
    }
#endif
    return { 0.0f, 0.0f };
}

