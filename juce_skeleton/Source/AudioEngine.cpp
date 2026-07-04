#include "AudioEngine.h"
#include <fstream>
#include <cmath>
#include <algorithm>
#include <cstdlib>
#include <thread>
#include <chrono>
#include <sstream>
#include <functional>

AudioEngine::AudioEngine()
{
#if USE_JUCE
    formatManager.registerBasicFormats();
    masterGainSource = std::make_unique<GainAudioSource>(&mixerSource, false);
    masterEffectsSource = std::make_unique<MasterEffectsAudioSource>(masterGainSource.get());
    sourcePlayer.setSource(masterEffectsSource.get());
#endif
    loaderThread = std::thread(&AudioEngine::loaderLoop, this);
}

AudioEngine::~AudioEngine()
{
    // Stop the loader before tearing down the JUCE graph — a job mid-install
    // touches mixerSource/juceTracks.
    {
        std::lock_guard<std::mutex> ql(loadMutex);
        loaderExit = true;
        loadQueue.clear();
    }
    loadCv.notify_all();
    if (loaderThread.joinable()) loaderThread.join();

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
    LOG_DBG << "[AudioEngine] Initialized with sample rate: " << sampleRate << std::endl;

#if USE_JUCE
    juce::String err = deviceManager.initialiseWithDefaultDevices(0, 2);
    if (err.isEmpty())
    {
        deviceManager.addAudioCallback(&sourcePlayer);
        if (auto* currentDevice = deviceManager.getCurrentAudioDevice())
        {
            sampleRate = currentDevice->getCurrentSampleRate();
            LOG_DBG << "[AudioEngine] JUCE audio device opened successfully. Sample Rate: " << sampleRate 
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

#if USE_JUCE
    if (!loopEnabled && !juceTracks.empty() && juceTracks[0]->getLengthSeconds() > 0.0
        && playheadSeconds >= juceTracks[0]->getLengthSeconds() - 0.001)
    {
        playheadSeconds = 0.0;
    }
#endif

    playing = true;
    LOG_DBG << "[AudioEngine] Playback started" << std::endl;

#if USE_JUCE
    // Re-align every track to the shared playhead before starting. Each track owns an
    // independent AudioTransportSource (+ SoundTouch), so repeated play/stop (or
    // pause/resume) can leave them at subtly different positions and drift apart over
    // time. setPosition() snaps them all to the same sample and clears each SoundTouch
    // residual (via setNextReadPosition), guaranteeing sample-aligned restarts.
    for (auto& track : juceTracks)
    {
        if (track->transportSource)
        {
            track->transportSource->setPosition(playheadSeconds);
            track->transportSource->start();
        }
    }

    // Arm the master fade for this playback pass from the current playhead.
    if (masterEffectsSource && !juceTracks.empty())
    {
        double sr = sampleRate > 0 ? sampleRate : 44100.0;
        configureMasterFade(juceTracks[0]->getLengthSeconds(), sr);
        masterEffectsSource->setFadePosition((juce::int64)(playheadSeconds * sr));
        masterEffectsSource->setFadeActive(true);
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
    if (masterEffectsSource) masterEffectsSource->setFadeActive(false);
#endif

    LOG_DBG << "[AudioEngine] Playback paused at " << playheadSeconds << "s" << std::endl;
}

void AudioEngine::stop()
{
    std::lock_guard<std::mutex> lock(engineMutex);
    playing = false;
    playheadSeconds = 0.0;
    LOG_DBG << "[AudioEngine] Playback stopped" << std::endl;

#if USE_JUCE
    for (auto& track : juceTracks)
    {
        if (track->transportSource)
        {
            track->transportSource->stop();
            track->transportSource->setPosition(0.0);
        }
    }
    if (masterEffectsSource) masterEffectsSource->setFadeActive(false);
#endif
}

void AudioEngine::seek(double positionSeconds)
{
    std::lock_guard<std::mutex> lock(engineMutex);
    playheadSeconds = positionSeconds;
    LOG_DBG << "[AudioEngine] Seek to: " << playheadSeconds << "s" << std::endl;

#if USE_JUCE
    for (auto& track : juceTracks)
    {
        if (track->transportSource)
        {
            track->transportSource->setPosition(positionSeconds);
        }
    }
    if (playing && masterEffectsSource)
    {
        double sr = sampleRate > 0 ? sampleRate : 44100.0;
        masterEffectsSource->setFadePosition((juce::int64)(positionSeconds * sr));
    }
#endif
}

void AudioEngine::setLoop(bool enabled)
{
    std::lock_guard<std::mutex> lock(engineMutex);
    loopEnabled = enabled;

#if USE_JUCE
    for (auto& track : juceTracks)
    {
        track->setLooping(loopEnabled);
    }
#endif

    LOG_DBG << "[AudioEngine] Loop " << (loopEnabled ? "enabled" : "disabled") << std::endl;
}

void AudioEngine::loadTrack(const std::string& trackId, const std::string& filePath)
{
    // Register the track metadata synchronously (params arriving right after this
    // command land in TrackInfo and are applied when the decode finishes), then
    // queue the heavy decode to the background loader. This call must return
    // immediately: it runs on the WebSocket receive thread, and blocking here is
    // what used to stall play/seek commands for seconds after startup.
    LoadJob job;
    job.trackId = trackId;
    job.filePath = filePath;
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

        job.generation = loadGeneration;
        job.seq = ++loadSeqCounter;
        latestLoadSeq[trackId] = job.seq;
    }

#if USE_JUCE
    {
        std::lock_guard<std::mutex> ql(loadMutex);
        loadQueue.push_back(std::move(job));
    }
    loadCv.notify_one();
    LOG_DBG << "[AudioEngine] Track " << trackId << " queued for background load." << std::endl;
#else
    LOG_DBG << "[AudioEngine] Mock Track " << trackId << " loaded with " << filePath << std::endl;
    if (onTrackLoaded) onTrackLoaded(trackId, true, 0);
#endif
}

void AudioEngine::loaderLoop()
{
    for (;;)
    {
        LoadJob job;
        {
            std::unique_lock<std::mutex> ql(loadMutex);
            loadCv.wait(ql, [this] { return loaderExit || !loadQueue.empty(); });
            if (loaderExit) return;
            job = std::move(loadQueue.front());
            loadQueue.pop_front();
            loaderBusy = true;
        }

        bool ok = false;
        try { ok = decodeAndInstallTrack(job); }
        catch (const std::exception& e) { std::cerr << "[AudioEngine] Track load failed: " << e.what() << std::endl; }
        catch (...) { std::cerr << "[AudioEngine] Track load failed (unknown error)" << std::endl; }

        int pending = 0;
        {
            std::lock_guard<std::mutex> ql(loadMutex);
            loaderBusy = false;
            pending = (int)loadQueue.size();
            if (pending == 0) loadIdleCv.notify_all();
        }
        if (onTrackLoaded) onTrackLoaded(job.trackId, ok, pending);
    }
}

int AudioEngine::pendingLoadCount()
{
    std::lock_guard<std::mutex> ql(loadMutex);
    return (int)loadQueue.size() + (loaderBusy ? 1 : 0);
}

void AudioEngine::waitForLoadsIdle(int timeoutMs)
{
    std::unique_lock<std::mutex> ql(loadMutex);
    loadIdleCv.wait_for(ql, std::chrono::milliseconds(timeoutMs),
                        [this] { return loadQueue.empty() && !loaderBusy; });
}

bool AudioEngine::decodeAndInstallTrack(const LoadJob& job)
{
#if !USE_JUCE
    (void)job;
    return true;
#else
    const std::string& trackId = job.trackId;
    const std::string& filePath = job.filePath;

    // Skip stale jobs before paying for a decode: the project may have been
    // cleared (generation bump) or this track re-requested (newer seq).
    {
        std::lock_guard<std::mutex> lock(engineMutex);
        if (job.generation != loadGeneration) return false;
        auto it = latestLoadSeq.find(trackId);
        if (it == latestLoadSeq.end() || it->second != job.seq) return false;
    }

    juce::File file(filePath);
    if (!file.existsAsFile())
    {
        std::cerr << "[AudioEngine] File not found: " << filePath << std::endl;
        return false;
    }

    // For compressed formats (MP3/M4A/OGG/FLAC), JUCE's reader reports unreliable
    // lengths (observed over/under by tens of seconds across stems of the SAME song),
    // which skews automation timing and loop points. Decode to PCM via the bundled
    // ffmpeg (path passed in FOCUSDAW_FFMPEG) into a temp WAV, then read that — exact
    // length and content, matching the web engine. WAV/AIFF are read directly.
    juce::File fileToRead = file;
    juce::File tempWav;
    const juce::String ext = file.getFileExtension().toLowerCase();
    const bool isUncompressed = (ext == ".wav" || ext == ".aif" || ext == ".aiff");
    const char* ffmpegEnv = std::getenv("FOCUSDAW_FFMPEG");
    if (!isUncompressed && ffmpegEnv != nullptr && juce::File(juce::String(ffmpegEnv)).existsAsFile())
    {
        tempWav = juce::File::getSpecialLocation(juce::File::tempDirectory)
                      .getChildFile("focusdaw_dec_" + juce::String(juce::Time::getHighResolutionTicks()) + ".wav");
        juce::StringArray cmd;
        cmd.add(juce::String(ffmpegEnv));
        cmd.add("-y");
        cmd.add("-i");      cmd.add(file.getFullPathName());
        cmd.add("-vn");                       // drop any cover-art video stream
        cmd.add("-ac");     cmd.add("2");      // stereo for the mixer
        cmd.add("-c:a");    cmd.add("pcm_s16le");
        cmd.add(tempWav.getFullPathName());
        juce::ChildProcess proc;
        if (proc.start(cmd, juce::ChildProcess::wantStdOut | juce::ChildProcess::wantStdErr))
        {
            proc.readAllProcessOutput();      // drain so the pipe doesn't stall
            proc.waitForProcessToFinish(120000);
        }
        if (tempWav.existsAsFile() && tempWav.getSize() > 1024)
        {
            fileToRead = tempWav;
        }
        else
        {
            std::cerr << "[AudioEngine] ffmpeg decode failed; reading original directly: " << filePath << std::endl;
            tempWav.deleteFile();
            tempWav = juce::File();
        }
    }

    std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(fileToRead));
    if (reader == nullptr)
    {
        std::cerr << "[AudioEngine] Failed to create reader for file: " << filePath << std::endl;
        if (tempWav != juce::File()) tempWav.deleteFile();
        return false;
    }

    // Decode the ENTIRE (now-PCM) file into memory and play it from a MemoryAudioSource.
    // Streaming + re-seeking compressed files on every play/stop gave frame-imprecise
    // seeks that drifted the audio (tracks desynced, song "slowed") while the transport's
    // nominal read position still looked perfect. An in-memory PCM buffer seeks
    // sample-exact, matching the web-audio engine (which also fully decodes up front).
    const double fileSampleRate = reader->sampleRate > 0 ? reader->sampleRate : 44100.0;
    const int numChannels = juce::jmax(1, (int)reader->numChannels);
    const juce::int64 totalLen = reader->lengthInSamples;

    juce::AudioBuffer<float> decoded(numChannels, (int)juce::jmax((juce::int64)1, totalLen));
    reader->read(&decoded, 0, (int)totalLen, 0, true, true);
    reader.reset();
    if (tempWav != juce::File()) tempWav.deleteFile(); // PCM is now in `decoded`

    double deviceSampleRate = 44100.0;
    if (auto* currentDevice = deviceManager.getCurrentAudioDevice())
    {
        deviceSampleRate = currentDevice->getCurrentSampleRate();
    }

    // copyMemory=true → the source owns its own copy, so `decoded` can go out of scope.
    auto memSource = std::make_unique<juce::MemoryAudioSource>(decoded, true, false);
    auto trackSource = std::make_unique<TrackAudioSource>(std::move(memSource), fileSampleRate, deviceSampleRate);
    trackSource->id = trackId;

    // Install into the live graph. Only this final phase takes engineMutex, so
    // play/seek/param commands stay responsive while files decode.
    std::lock_guard<std::mutex> lock(engineMutex);

    // Re-check staleness: the project may have been cleared, the track removed,
    // or a newer load of the same track requested while we were decoding.
    if (job.generation != loadGeneration) return false;
    {
        auto it = latestLoadSeq.find(trackId);
        if (it == latestLoadSeq.end() || it->second != job.seq) return false;
    }

    // Sync parameters (incl. any that arrived while the file was decoding)
    bool stillRegistered = false;
    for (const auto& t : tracks)
    {
        if (t.id == trackId)
        {
            trackSource->volume = t.volume;
            trackSource->pan = t.pan;
            trackSource->mute = t.mute;
            trackSource->solo = t.solo;
            trackSource->reverbSend.store(t.reverbSend);
            trackSource->echoSend.store(t.echoSend);
            if (t.autoOn || !t.autoPoints.empty())
                trackSource->setAutomation(t.autoOn, t.autoCurved, t.autoPoints);
            stillRegistered = true;
            break;
        }
    }
    if (!stillRegistered) return false; // removed while decoding

    trackSource->setLooping(loopEnabled);

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
            LOG_DBG << "[AudioEngine] Track " << trackId << " reloaded and replaced in JUCE engine." << std::endl;
            return true;
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
    LOG_DBG << "[AudioEngine] Track " << trackId << " loaded in JUCE engine." << std::endl;
    return true;
#endif
}

void AudioEngine::setTrackParam(const std::string& trackId, const std::string& key, float value)
{
    std::lock_guard<std::mutex> lock(engineMutex);
    for (auto& t : tracks)
    {
        if (t.id == trackId)
        {
            // Solo/Mute are mutually exclusive on the same track (mirror the web engine):
            // enabling one clears the other, so soloing a muted track makes it audible.
            if (key == "volume") t.volume = value;
            else if (key == "pan") t.pan = value;
            else if (key == "mute") { t.mute = (value > 0.5f); if (t.mute) t.solo = false; }
            else if (key == "solo") { t.solo = (value > 0.5f); if (t.solo) t.mute = false; }
            else if (key == "reverb") t.reverbSend = value;
            else if (key == "echo") t.echoSend = value;
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
                if (track->mute) track->solo = false; // mute clears solo (mutually exclusive)
                updateSoloStates();
            }
            else if (key == "solo")
            {
                track->solo = (value > 0.5f);
                if (track->solo) track->mute = false; // solo clears mute (mutually exclusive)
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

    LOG_DBG << "[AudioEngine] Parameter " << key << " set to " << value << " for track " << trackId << std::endl;
}

void AudioEngine::setTrackAutomation(const std::string& trackId, bool autoOn, bool curved, const std::vector<float>& flatPoints)
{
    std::lock_guard<std::mutex> lock(engineMutex);

    // Keep a copy in TrackInfo: with async loads the JUCE track may not exist yet
    // when the automation command arrives, and it's applied on install.
    for (auto& t : tracks)
    {
        if (t.id == trackId)
        {
            t.autoOn = autoOn;
            t.autoCurved = curved;
            t.autoPoints = flatPoints;
            break;
        }
    }

#if USE_JUCE
    for (auto& track : juceTracks)
    {
        if (track->id == trackId)
        {
            track->setAutomation(autoOn, curved, flatPoints);
            LOG_DBG << "[AudioEngine] Track automation set: id=" << trackId
                      << ", autoOn=" << (autoOn ? 1 : 0)
                      << ", curved=" << (curved ? 1 : 0)
                      << ", points=" << (flatPoints.size() / 2) << std::endl;
            break;
        }
    }
#else
    juce::ignoreUnused(trackId, autoOn, curved, flatPoints);
#endif
}

void AudioEngine::removeTrack(const std::string& trackId)
{
    std::lock_guard<std::mutex> lock(engineMutex);

    for (auto it = tracks.begin(); it != tracks.end(); ++it)
    {
        if (it->id == trackId) { tracks.erase(it); break; }
    }
    latestLoadSeq.erase(trackId); // void any in-flight background load of this track

#if USE_JUCE
    for (size_t i = 0; i < juceTracks.size(); ++i)
    {
        if (juceTracks[i]->id == trackId)
        {
            // Pull it out of the mixer before destroying the source so the audio
            // thread never reads a freed TrackAudioSource.
            mixerSource.removeInputSource(juceTracks[i].get());
            juceTracks.erase(juceTracks.begin() + i);
            break;
        }
    }
    updateSoloStates();
#endif

    // Removing the LAST track must stop the transport. Otherwise `playing` stays
    // true with a frozen playheadSeconds (updatePlayhead needs a track to advance),
    // the broadcasts keep jittering the UI playbar at the stale position, and the
    // next track load would install into "playing" state and resume from there.
    if (tracks.empty())
    {
        playing = false;
        playheadSeconds = 0.0;
#if USE_JUCE
        if (masterEffectsSource) masterEffectsSource->setFadeActive(false);
#endif
    }

    LOG_DBG << "[AudioEngine] Track " << trackId << " removed from JUCE engine." << std::endl;
}

void AudioEngine::clearTracks()
{
    std::lock_guard<std::mutex> lock(engineMutex);
    tracks.clear();
    playheadSeconds = 0.0;
    playing = false;

    // Void every queued/in-flight background load so a track decoded for the OLD
    // project can't be installed into the new one.
    loadGeneration++;
    latestLoadSeq.clear();
    {
        std::lock_guard<std::mutex> ql(loadMutex);
        loadQueue.clear();
        if (!loaderBusy) loadIdleCv.notify_all();
    }

    // A New Project must not inherit the previous project's transpose / time-stretch
    // state. The JS engine already resets tempo on clearTracks, but the native DSP
    // state lived on independently — so a fresh project kept playing the old key.
    variKey = false;
    keyShift = 0;
    currentKey = "";
    detectedKey = "";
    variBpm = false;

#if USE_JUCE
    mixerSource.removeAllInputs();
    juceTracks.clear();
#endif

    LOG_DBG << "[AudioEngine] All tracks cleared (transpose/tempo DSP reset)." << std::endl;
}

void AudioEngine::clearAllMuteSolo()
{
    std::lock_guard<std::mutex> lock(engineMutex);
    for (auto& t : tracks)
    {
        t.mute = false;
        t.solo = false;
    }

#if USE_JUCE
    for (auto& track : juceTracks)
    {
        track->mute = false;
        track->solo = false;
    }
    updateSoloStates();
#endif

    LOG_DBG << "[AudioEngine] All mute/solo cleared." << std::endl;
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
    LOG_DBG << "[AudioEngine] Project BPM set to " << projectBpm << std::endl;
    updateDspParams();
}

void AudioEngine::setPlaybackBpm(double bpm)
{
    std::lock_guard<std::mutex> lock(engineMutex);
    playbackBpm = bpm;
    LOG_DBG << "[AudioEngine] Playback BPM set to " << playbackBpm << std::endl;
    updateDspParams();
}

void AudioEngine::setVariBpm(bool on)
{
    std::lock_guard<std::mutex> lock(engineMutex);
    variBpm = on;
    LOG_DBG << "[AudioEngine] Vari BPM: " << (variBpm ? "ON" : "OFF") << std::endl;
    updateDspParams();
}

void AudioEngine::setVariKey(bool on)
{
    std::lock_guard<std::mutex> lock(engineMutex);
    variKey = on;
    LOG_DBG << "[AudioEngine] Vari Key: " << (variKey ? "ON" : "OFF") << std::endl;
    updateDspParams();
}

void AudioEngine::setKey(const std::string& key)
{
    std::lock_guard<std::mutex> lock(engineMutex);
    currentKey = key;
    LOG_DBG << "[AudioEngine] Key set to " << currentKey << std::endl;
    updateDspParams();
}

void AudioEngine::setDetectedKey(const std::string& key)
{
    std::lock_guard<std::mutex> lock(engineMutex);
    detectedKey = key;
    LOG_DBG << "[AudioEngine] Detected reference Key set to " << detectedKey << std::endl;
    updateDspParams();
}

void AudioEngine::setKeyShift(int semitones)
{
    std::lock_guard<std::mutex> lock(engineMutex);
    if (semitones < -6) semitones = -6;
    if (semitones > 6) semitones = 6;
    keyShift = semitones;
    LOG_DBG << "[AudioEngine] Key shift set to " << keyShift << " semitones" << std::endl;
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
    else if (key == "fadeIn" || key == "fadeOut")
    {
        if (key == "fadeIn") fadeIn = value; else fadeOut = value;
#if USE_JUCE
        // Live-update the active fade window if currently playing.
        if (playing && masterEffectsSource && !juceTracks.empty())
        {
            double sr = sampleRate > 0 ? sampleRate : 44100.0;
            configureMasterFade(juceTracks[0]->getLengthSeconds(), sr);
        }
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
    LOG_DBG << "[AudioEngine] Master parameter " << key << " set to " << value << std::endl;
}

void AudioEngine::configureMasterFade(double songLenSeconds, double sr)
{
#if USE_JUCE
    if (!masterEffectsSource) return;
    if (songLenSeconds <= 0.0 || sr <= 0.0)
    {
        masterEffectsSource->setFadeWindow(0, 0, 0);
        return;
    }
    double fi = fadeIn, fo = fadeOut;
    double half = songLenSeconds / 2.0;
    if (fi > half) fi = half;
    if (fo > half) fo = half;
    if (fi < 0.0) fi = 0.0;
    if (fo < 0.0) fo = 0.0;
    masterEffectsSource->setFadeWindow(
        (juce::int64)(fi * sr),
        (juce::int64)(fo * sr),
        (juce::int64)(songLenSeconds * sr));
#else
    (void)songLenSeconds; (void)sr;
#endif
}

void AudioEngine::setMasterBand(int index, float db)
{
#if USE_JUCE
    if (masterEffectsSource) masterEffectsSource->setMasterBand(index, db);
#endif
    LOG_DBG << "[AudioEngine] Master EQ band " << index << " set to " << db << " dB" << std::endl;
}

void AudioEngine::setRoom(const RoomSpec& spec)
{
#if USE_JUCE
    if (masterEffectsSource) masterEffectsSource->setRoom(spec);
#endif
    LOG_DBG << "[AudioEngine] Ambience room set: wet=" << spec.wet
              << ", decay=" << spec.decay << ", preDelay=" << spec.preDelay
              << ", damp=" << spec.damp << ", width=" << spec.width
              << ", echo=" << spec.echo << ", size=" << spec.size
              << ", erGain=" << spec.erGain << std::endl;
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
    LOG_DBG << "[AudioEngine] Master EQ bands updated" << std::endl;
}

double AudioEngine::getPlayhead() const
{
    // Lock: the status timer thread calls this while the client thread may be
    // mutating juceTracks (loadTrack/clearTracks). Reading juceTracks[0] without
    // the lock races the vector's reallocation/clear → use-after-free / heap corruption.
    std::lock_guard<std::mutex> lock(engineMutex);
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
        playheadSeconds = juceTracks[0]->getCurrentPositionSeconds();

        if (!loopEnabled && juceTracks[0]->hasFinished())
        {
            playing = false;
            playheadSeconds = 0.0;
            for (auto& track : juceTracks)
            {
                if (track->transportSource)
                {
                    track->transportSource->stop();
                    track->transportSource->setPosition(0.0);
                }
            }
            LOG_DBG << "[AudioEngine] Playback completed" << std::endl;
        }
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

    // Pitch shift comes straight from the JS-supplied integer offset (clamped to
    // −6..+6). Only applied when Vari Key is on. We no longer re-derive the shift
    // from key strings, which avoids enharmonic/major-minor parsing ambiguity.
    float targetPitchShift = 0.0f;
    if (variKey)
    {
        int s = keyShift;
        if (s < -6) s = -6;
        if (s > 6) s = 6;
        targetPitchShift = (float)s;
    }

#if USE_JUCE
    for (auto& track : juceTracks)
    {
        track->setTempo(targetTempo);
        track->setPitchShift(targetPitchShift);
    }
#endif
    
    LOG_DBG << "[AudioEngine] DSP parameters updated: Tempo=" << targetTempo 
              << ", PitchShift=" << targetPitchShift << " semitones" << std::endl;
}

void AudioEngine::exportMix(const std::string& exportId,
                            const std::string& tempOutputPath,
                            double targetSampleRate,
                            double durationSeconds,
                            bool normalize,
                            float lufsTarget,
                            bool preservePitch,
                            double fadeInSeconds,
                            double fadeOutSeconds,
                            std::function<void(float)> progressCallback,
                            std::function<void(const std::string&, const std::string&)> completionCallback)
{
#if !USE_JUCE
    // ==========================================
    // Mock Mode Implementation (USE_JUCE=0)
    // ==========================================
    LOG_DBG << "[AudioEngine] Mock Export started: id=" << exportId 
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

    LOG_DBG << "[AudioEngine] Mock Export completed: " << tempOutputPath << std::endl;
    completionCallback(tempOutputPath, "");

#else
    // ==========================================
    // JUCE Engine Implementation (USE_JUCE=1)
    // ==========================================
    LOG_DBG << "[AudioEngine] JUCE Offline Export started: id=" << exportId
              << ", path=" << tempOutputPath << ", sampleRate=" << targetSampleRate
              << ", duration=" << durationSeconds << ", normalize=" << normalize
              << ", target=" << lufsTarget << ", preservePitch=" << preservePitch << std::endl;

    // Tracks may still be decoding in the background (async loadTrack); rendering
    // now would silently miss them. This runs on the detached export thread, so
    // blocking here is fine.
    waitForLoadsIdle();

    bool wasPlaying = false;
    std::vector<TrackAudioSource*> activeTracks;

    // Offline export reuses the same master source graph as realtime playback.
    // Detach the device callback during export so the audio device cannot pull
    // from the same transports/effects while the offline pass is rendering.
    bool realtimeCallbackSuspended = true;
    deviceManager.removeAudioCallback(&sourcePlayer);
    sourcePlayer.setSource(nullptr);
    LOG_DBG << "[AudioEngine] Realtime audio callback suspended for offline export." << std::endl;
    auto restoreRealtimeCallback = [&]() {
        if (!realtimeCallbackSuspended)
            return;
        sourcePlayer.setSource(masterEffectsSource.get());
        deviceManager.addAudioCallback(&sourcePlayer);
        realtimeCallbackSuspended = false;
        LOG_DBG << "[AudioEngine] Realtime audio callback restored after offline export." << std::endl;
    };
    
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

    if (activeTracks.empty()) {
        std::cerr << "[AudioEngine] JUCE Offline Export aborted: no tracks are loaded in the native engine." << std::endl;

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

        restoreRealtimeCallback();
        completionCallback("", "Native export has no loaded tracks. Falling back to Web Audio export.");
        return;
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
    double rawSumSq = 0.0;
    double rawPeak = 0.0;
    juce::int64 rawSamplesMeasured = 0;

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
        track->setOfflineRendering(true, preservePitch);
        track->setLooping(false);
        track->transportSource->setPosition(0.0);
        track->transportSource->start();
    }

    // Push the latest tempo/pitch into each track's SoundTouch before rendering.
    // Realtime playback normally does this via setters, but a fresh project that is
    // exported without ever pressing Play would otherwise render at the wrong
    // key/tempo (Bug②). Runs after the per-track setOfflineRendering above so the
    // pitch shift is not overwritten.
    {
        std::lock_guard<std::mutex> lock(engineMutex);
        updateDspParams();
    }

    LOG_DBG << "[AudioEngine] Offline track rendering enabled (via transportSource): tracks=" << activeTracks.size()
              << ", soundTouch=" << (preservePitch ? 1 : 0) << std::endl;

    // Master fade in/out over the export timeline. The bridge already converts the
    // project fade seconds to output seconds (mirrors web renderMix fadeIn/graphRate).
    {
        juce::int64 fadeInS = (juce::int64)(fadeInSeconds * targetSampleRate);
        juce::int64 fadeOutS = (juce::int64)(fadeOutSeconds * targetSampleRate);
        if (fadeInS < 0) fadeInS = 0;
        if (fadeOutS < 0) fadeOutS = 0;
        if (fadeInS > totalSamplesToRender / 2) fadeInS = totalSamplesToRender / 2;
        if (fadeOutS > totalSamplesToRender / 2) fadeOutS = totalSamplesToRender / 2;
        if (masterEffectsSource)
        {
            masterEffectsSource->setFadeWindow(fadeInS, fadeOutS, totalSamplesToRender);
            masterEffectsSource->setFadePosition(0);
            masterEffectsSource->setFadeActive(true);
        }
        LOG_DBG << "[AudioEngine] Export fade: inSamples=" << fadeInS << ", outSamples=" << fadeOutS
                  << ", total=" << totalSamplesToRender << std::endl;
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

            {
                double phaseStart = (double)samplesRendered / (double)totalSamplesToRender;
                double phaseEnd = (double)(samplesRendered + currentBlockSize) / (double)totalSamplesToRender;
                for (auto* t : activeTracks) t->setOfflineAutomationPhase(phaseStart, phaseEnd);
            }

            if (masterEffectsSource) {
                masterEffectsSource->getNextAudioBlock(info);
            }

            const float* srcL = blockBuffer.getReadPointer(0);
            const float* srcR = blockBuffer.getReadPointer(1);
            for (int i = 0; i < currentBlockSize; ++i) {
                double rawL = srcL[i];
                double rawR = srcR[i];
                rawSumSq += rawL * rawL + rawR * rawR;
                rawPeak = std::max(rawPeak, std::max(std::abs(rawL), std::abs(rawR)));
                rawSamplesMeasured += 2;

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

        if (measuredLufs <= -69.99 && rawSamplesMeasured > 0 && rawPeak > 1.0e-6) {
            double rawMeanSquarePerChannel = rawSumSq / (double)rawSamplesMeasured;
            double rawStereoSumMS = rawMeanSquarePerChannel * 2.0;
            measuredLufs = -0.691 + 10.0 * std::log10(std::max(rawStereoSumMS, 1.0e-12));
            LOG_DBG << "[AudioEngine] LUFS gate fallback used: rawPeak=" << rawPeak
                      << ", rawRms=" << std::sqrt(rawMeanSquarePerChannel)
                      << ", fallbackLufs=" << measuredLufs << std::endl;
        }

        LOG_DBG << "[AudioEngine] Measured LUFS: " << measuredLufs << std::endl;
        
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
        track->setOfflineRendering(true, preservePitch);
        track->setLooping(false);
        track->transportSource->setPosition(0.0);
        track->transportSource->start();
    }
    samplesRendered = 0;
    // Re-arm the master fade from the start for the write pass (PASS 1 advanced it).
    if (masterEffectsSource) masterEffectsSource->setFadePosition(0);

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

                {
                    double phaseStart = (double)samplesRendered / (double)totalSamplesToRender;
                    double phaseEnd = (double)(samplesRendered + currentBlockSize) / (double)totalSamplesToRender;
                    for (auto* t : activeTracks) t->setOfflineAutomationPhase(phaseStart, phaseEnd);
                }

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
        track->setOfflineRendering(false);
        track->setLooping(true);
        track->transportSource->stop();
        track->transportSource->setPosition(0.0);
    }
    // Disable the export fade window; realtime resume (below) re-arms it if needed.
    if (masterEffectsSource) masterEffectsSource->setFadeActive(false);

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
            // Re-arm the realtime master fade for resumed playback.
            if (masterEffectsSource && !juceTracks.empty()) {
                configureMasterFade(juceTracks[0]->getLengthSeconds(), originalSampleRate);
                masterEffectsSource->setFadePosition((juce::int64)(playheadSeconds * originalSampleRate));
                masterEffectsSource->setFadeActive(true);
            }
        }
    }

    restoreRealtimeCallback();

    if (success) {
        LOG_DBG << "[AudioEngine] JUCE Offline Export completed successfully: " << tempOutputPath << std::endl;
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
    // When stopped/paused no audio is produced, so the cached per-track magnitude is
    // stale (frozen at the last played block). Report silence so meters fall to zero.
    if (!playing) return 0.0f;
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
    if (!playing) return { 0.0f, 0.0f }; // silence when stopped/paused (see getTrackMagnitude)
    if (masterEffectsSource)
    {
        return { masterEffectsSource->getMagnitudeL(), masterEffectsSource->getMagnitudeR() };
    }
#endif
    return { 0.0f, 0.0f };
}

static std::string jsonEscapeString(const std::string& s)
{
    std::string out;
    out.reserve(s.size());
    for (char c : s)
    {
        if (c == '"' || c == '\\') { out += '\\'; out += c; }
        else if ((unsigned char)c < 0x20) { out += ' '; } // control chars can't appear raw in JSON
        else out += c;
    }
    return out;
}

#if USE_JUCE
// Run fn on the JUCE message thread and hand its string back to the calling
// (WebSocket) thread. AudioDeviceManager/WASAPI work must not run on arbitrary
// threads — the COM objects live in the message thread's apartment. The shared
// state keeps the lambda's storage alive even if the caller times out.
static std::string runOnMessageThread(std::function<std::string()> fn, const std::string& timeoutResult)
{
    if (juce::MessageManager::getInstance()->isThisTheMessageThread())
        return fn();

    struct State { std::string result; juce::WaitableEvent done; };
    auto state = std::make_shared<State>();
    juce::MessageManager::callAsync([state, fn]
    {
        state->result = fn();
        state->done.signal();
    });
    if (!state->done.wait(8000))
        return timeoutResult;
    return state->result;
}
#endif

std::string AudioEngine::getAudioDevicesJson()
{
#if USE_JUCE
    return runOnMessageThread([this]() -> std::string
    {
        std::ostringstream json;
        juce::AudioDeviceManager::AudioDeviceSetup setup = deviceManager.getAudioDeviceSetup();
        double sr = 0.0;
        int buf = 0;
        if (auto* dev = deviceManager.getCurrentAudioDevice())
        {
            sr = dev->getCurrentSampleRate();
            buf = dev->getCurrentBufferSizeSamples();
        }
        json << "{\"event\":\"audioDevices\",\"current\":{"
             << "\"type\":\"" << jsonEscapeString(deviceManager.getCurrentAudioDeviceType().toStdString()) << "\","
             << "\"name\":\"" << jsonEscapeString(setup.outputDeviceName.toStdString()) << "\","
             << "\"sampleRate\":" << sr << ",\"bufferSize\":" << buf << "},\"types\":[";

        const auto& types = deviceManager.getAvailableDeviceTypes();
        for (int i = 0; i < types.size(); ++i)
        {
            auto* type = types.getUnchecked(i);
            type->scanForDevices();
            juce::StringArray names = type->getDeviceNames(false); // output devices
            json << "{\"type\":\"" << jsonEscapeString(type->getTypeName().toStdString()) << "\",\"devices\":[";
            for (int d = 0; d < names.size(); ++d)
            {
                json << "\"" << jsonEscapeString(names[d].toStdString()) << "\"";
                if (d + 1 < names.size()) json << ",";
            }
            json << "]}";
            if (i + 1 < types.size()) json << ",";
        }
        json << "]}";
        return json.str();
    }, "{\"event\":\"audioDevices\",\"error\":\"timeout\",\"types\":[]}");
#else
    return "{\"event\":\"audioDevices\",\"types\":[]}";
#endif
}

std::string AudioEngine::setAudioDevice(const std::string& typeName, const std::string& deviceName)
{
#if USE_JUCE
    return runOnMessageThread([this, typeName, deviceName]() -> std::string
    {
        const auto& types = deviceManager.getAvailableDeviceTypes();
        if (types.isEmpty()) return "no audio device types available";

        // Empty type = the platform default type (JUCE lists it first: WASAPI shared).
        juce::String wantedType = typeName.empty() ? types.getUnchecked(0)->getTypeName()
                                                   : juce::String::fromUTF8(typeName.c_str());
        juce::AudioIODeviceType* typeObj = nullptr;
        for (int i = 0; i < types.size(); ++i)
            if (types.getUnchecked(i)->getTypeName() == wantedType) { typeObj = types.getUnchecked(i); break; }
        if (typeObj == nullptr) return "unknown device type: " + typeName;

        typeObj->scanForDevices();
        juce::StringArray names = typeObj->getDeviceNames(false);
        if (names.isEmpty()) return "no output devices for type: " + wantedType.toStdString();

        // Empty name = the type's default output device.
        juce::String wantedName = deviceName.empty()
            ? names[juce::jlimit(0, names.size() - 1, typeObj->getDefaultDeviceIndex(false))]
            : juce::String::fromUTF8(deviceName.c_str());
        if (!names.contains(wantedName)) return "unknown device: " + deviceName;

        if (deviceManager.getCurrentAudioDeviceType() != wantedType)
            deviceManager.setCurrentAudioDeviceType(wantedType, true);

        juce::AudioDeviceManager::AudioDeviceSetup setup = deviceManager.getAudioDeviceSetup();
        setup.outputDeviceName = wantedName;
        setup.inputDeviceName = juce::String();
        setup.useDefaultOutputChannels = true;
        juce::String err = deviceManager.setAudioDeviceSetup(setup, true);
        if (err.isNotEmpty()) return err.toStdString();

        {
            std::lock_guard<std::mutex> lock(engineMutex);
            if (auto* dev = deviceManager.getCurrentAudioDevice())
                sampleRate = dev->getCurrentSampleRate();
        }
        LOG_DBG << "[AudioEngine] Audio device switched: type=" << wantedType.toStdString()
                << ", name=" << wantedName.toStdString() << ", sr=" << sampleRate << std::endl;
        return std::string();
    }, "device switch timed out");
#else
    (void)typeName; (void)deviceName;
    return "native engine not available";
#endif
}

std::vector<float> AudioEngine::getMasterBandLevels()
{
    std::vector<float> bands(9, 0.0f);
#if USE_JUCE
    std::lock_guard<std::mutex> lock(engineMutex);
    if (!playing) return bands; // silence when stopped/paused (see getTrackMagnitude)
    if (masterEffectsSource)
    {
        for (int i = 0; i < 9; ++i)
            bands[(size_t)i] = masterEffectsSource->getBandLevel(i);
    }
#endif
    return bands;
}

