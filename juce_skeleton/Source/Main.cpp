#if defined(STANDALONE)
#define USE_JUCE 0
#elif defined(JUCE_GLOBAL_MODULE_SETTINGS_INCLUDED) || __has_include(<JuceHeader.h>)
#include <JuceHeader.h>
#define USE_JUCE 1
#else
#define USE_JUCE 0
#endif

#include <iostream>
#include <string>
#include <vector>
#include <memory>
#include "AudioEngine.h"
#include "WebSocketServer.h"

#if USE_JUCE

class AudioEngineApplication : public juce::JUCEApplicationBase
{
public:
    AudioEngineApplication() {}

    const juce::String getApplicationName() override       { return "FocusDAW-AudioEngine"; }
    const juce::String getApplicationVersion() override    { return "1.0.0"; }
    bool moreThanOneInstanceAllowed() override             { return true; }

    void initialise(const juce::String& commandLine) override
    {
        int port = 8082;
        juce::StringArray args;
        args.addTokens(commandLine, " ", "");
        for (int i = 0; i < args.size() - 1; ++i)
        {
            if (args[i] == "--port" || args[i] == "-p")
            {
                port = args[i + 1].getIntValue();
            }
        }

        std::cout << "[FocusDAW AudioEngine] Initializing JUCE daemon on port " << port << "..." << std::endl;

        audioEngine = std::make_unique<AudioEngine>();
        audioEngine->init(44100);
        webSocketServer = std::make_unique<WebSocketServer>(port, *audioEngine);
        webSocketServer->start();
    }

    void shutdown() override
    {
        webSocketServer->stop();
        webSocketServer.reset();
        audioEngine.reset();
        std::cout << "[FocusDAW AudioEngine] Shutdown complete." << std::endl;
    }

    void anotherInstanceStarted(const juce::String&) override {}

    void systemRequestedQuit() override { quit(); }
    void suspended() override {}
    void resumed() override {}
    void unhandledException(const std::exception*, const juce::String&, int) override {}

private:
    std::unique_ptr<AudioEngine> audioEngine;
    std::unique_ptr<WebSocketServer> webSocketServer;
};

START_JUCE_APPLICATION (AudioEngineApplication)

#else

#include <thread>
#include <chrono>

// Standalone standard C++ fallback main for testing without JUCE
int main(int argc, char* argv[])
{
    int port = 8082;
    for (int i = 1; i < argc - 1; ++i)
    {
        std::string arg = argv[i];
        if (arg == "--port" || arg == "-p")
        {
            port = std::stoi(argv[i + 1]);
        }
    }

    std::cout << "[FocusDAW AudioEngine] Running standalone mock daemon on port " << port << "..." << std::endl;

    auto audioEngine = std::make_unique<AudioEngine>();
    audioEngine->init(44100);
    auto webSocketServer = std::make_unique<WebSocketServer>(port, *audioEngine);
    webSocketServer->start();

    std::cout << "Daemon running. Press Ctrl+C in standalone console or let Electron terminate the process..." << std::endl;
    
    // Keep process alive. Electron main process will terminate this daemon via process kill.
    while (true)
    {
        std::this_thread::sleep_for(std::chrono::seconds(1));
    }

    webSocketServer->stop();
    return 0;
}

#endif
