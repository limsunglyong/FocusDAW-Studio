#pragma once

#include <iostream>
#include <string>
#include <thread>
#include <atomic>
#include <vector>
#include <mutex>

class AudioEngine;

class WebSocketServer
{
public:
    WebSocketServer(int port, AudioEngine& engine);
    ~WebSocketServer();

    void start();
    void stop();

private:
    void listenLoop();
    void clientLoop(void* socketHandle);
    
    // Tiny WebSocket helper methods
    bool handleHandshake(void* socketHandle);
    void sendFrame(void* socketHandle, const std::string& text);
    std::string readFrame(void* socketHandle, bool& error);
    void broadcast(const std::string& text);

    int serverPort;
    AudioEngine& audioEngine;
    std::atomic<bool> shouldExit { false };
    std::thread serverThread;
    
    std::mutex clientsMutex;
    std::vector<void*> activeClients;

    // Client threads are joined in stop() (they used to be detached, which let a
    // live client thread outlive the server object during shutdown — a
    // use-after-free window when sockets drop exactly as the app quits).
    std::mutex clientThreadsMutex;
    std::vector<std::thread> clientThreads;

    std::thread timerThread;
    void timerLoop();
};
