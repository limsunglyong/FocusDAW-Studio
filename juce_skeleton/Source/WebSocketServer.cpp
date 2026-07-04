#include "WebSocketServer.h"
#include "AudioEngine.h"
#include <winsock2.h>
#include <ws2tcpip.h>
#include <chrono>
#include <sstream>
#include <iomanip>
#include <algorithm>

#pragma comment(lib, "Ws2_32.lib")

// SHA1 implementation for WebSocket Handshake
class SHA1 {
public:
    SHA1() { reset(); }
    void update(const std::string& s) {
        for (char c : s) {
            update((uint8_t)c);
        }
    }
    void update(uint8_t octet) {
        buffer[buffer_idx++] = octet;
        if (buffer_idx == 64) {
            transform();
            buffer_idx = 0;
        }
        total_bytes++;
    }
    void final(uint8_t digest[20]) {
        uint64_t total_bits = total_bytes * 8;
        update(0x80);
        while (buffer_idx != 56) {
            update(0x00);
        }
        for (int i = 7; i >= 0; --i) {
            update((uint8_t)(total_bits >> (i * 8)));
        }
        for (int i = 0; i < 5; ++i) {
            digest[i*4 + 0] = (uint8_t)(state[i] >> 24);
            digest[i*4 + 1] = (uint8_t)(state[i] >> 16);
            digest[i*4 + 2] = (uint8_t)(state[i] >> 8);
            digest[i*4 + 3] = (uint8_t)(state[i] >> 0);
        }
        reset();
    }
private:
    void reset() {
        state[0] = 0x67452301;
        state[1] = 0xEFCDAB89;
        state[2] = 0x98BADCFE;
        state[3] = 0x10325476;
        state[4] = 0xC3D2E1F0;
        total_bytes = 0;
        buffer_idx = 0;
    }
    void transform() {
        uint32_t w[80];
        for (int i = 0; i < 16; ++i) {
            w[i] = ((uint32_t)buffer[i*4 + 0] << 24) |
                   ((uint32_t)buffer[i*4 + 1] << 16) |
                   ((uint32_t)buffer[i*4 + 2] << 8)  |
                   ((uint32_t)buffer[i*4 + 3]);
        }
        for (int i = 16; i < 80; ++i) {
            w[i] = rol(w[i-3] ^ w[i-8] ^ w[i-14] ^ w[i-16], 1);
        }
        uint32_t a = state[0], b = state[1], c = state[2], d = state[3], e = state[4];
        for (int i = 0; i < 80; ++i) {
            uint32_t f, k;
            if (i < 20) {
                f = (b & c) | (~b & d); k = 0x5A827999;
            } else if (i < 40) {
                f = b ^ c ^ d; k = 0x6ED9EBA1;
            } else if (i < 60) {
                f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC;
            } else {
                f = b ^ c ^ d; k = 0xCA62C1D6;
            }
            uint32_t temp = rol(a, 5) + f + e + k + w[i];
            e = d; d = c; c = rol(b, 30); b = a; a = temp;
        }
        state[0] += a; state[1] += b; state[2] += c; state[3] += d; state[4] += e;
    }
    uint32_t rol(uint32_t value, size_t bits) {
        return (value << bits) | (value >> (32 - bits));
    }
    uint32_t state[5];
    uint8_t buffer[64];
    size_t buffer_idx;
    uint64_t total_bytes;
};

// Base64 helper
static const std::string base64_chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
std::string base64_encode(const uint8_t* bytes_to_encode, unsigned int in_len) {
    std::string ret;
    int i = 0, j = 0;
    uint8_t char_array_3[3], char_array_4[4];
    while (in_len--) {
        char_array_3[i++] = *(bytes_to_encode++);
        if (i == 3) {
            char_array_4[0] = (char_array_3[0] & 0xfc) >> 2;
            char_array_4[1] = ((char_array_3[0] & 0x03) << 4) + ((char_array_3[1] & 0xf0) >> 4);
            char_array_4[2] = ((char_array_3[1] & 0x0f) << 2) + ((char_array_3[2] & 0xc0) >> 6);
            char_array_4[3] = char_array_3[2] & 0x3f;
            for(i = 0; (i <4) ; i++) ret += base64_chars[char_array_4[i]];
            i = 0;
        }
    }
    if (i) {
        for(j = i; j < 3; j++) char_array_3[j] = '\0';
        char_array_4[0] = (char_array_3[0] & 0xfc) >> 2;
        char_array_4[1] = ((char_array_3[0] & 0x03) << 4) + ((char_array_3[1] & 0xf0) >> 4);
        char_array_4[2] = ((char_array_3[1] & 0x0f) << 2) + ((char_array_3[2] & 0xc0) >> 6);
        char_array_4[3] = char_array_3[2] & 0x3f;
        for (j = 0; (j < i + 1); j++) ret += base64_chars[char_array_4[j]];
        while((i++ < 3)) ret += '=';
    }
    return ret;
}

// Simple JSON extraction helper for key-value (without external json parser)
std::string getJsonStringVal(const std::string& json, const std::string& key) {
    size_t pos = json.find("\"" + key + "\"");
    if (pos == std::string::npos) return "";
    pos = json.find(":", pos);
    if (pos == std::string::npos) return "";
    pos = json.find("\"", pos);
    if (pos == std::string::npos) return "";
    size_t end = json.find("\"", pos + 1);
    if (end == std::string::npos) return "";
    return json.substr(pos + 1, end - pos - 1);
}

double getJsonDoubleVal(const std::string& json, const std::string& key) {
    size_t pos = json.find("\"" + key + "\"");
    if (pos == std::string::npos) return 0.0;
    pos = json.find(":", pos);
    if (pos == std::string::npos) return 0.0;
    
    // Check for boolean literal
    size_t nextCharPos = json.find_first_not_of(" \t\r\n", pos + 1);
    if (nextCharPos != std::string::npos) {
        if (json.compare(nextCharPos, 4, "true") == 0) return 1.0;
        if (json.compare(nextCharPos, 5, "false") == 0) return 0.0;
    }
    
    size_t start = json.find_first_of("0123456789.-", pos);
    if (start == std::string::npos) return 0.0;
    size_t end = json.find_first_not_of("0123456789.eE+-", start);
    return std::stod(json.substr(start, end - start));
}

bool getJsonBoolVal(const std::string& json, const std::string& key) {
    size_t pos = json.find("\"" + key + "\"");
    if (pos == std::string::npos) return false;
    pos = json.find(":", pos);
    if (pos == std::string::npos) return false;
    size_t start = json.find_first_not_of(" \t\r\n", pos + 1);
    if (start == std::string::npos) return false;
    if (json.compare(start, 4, "true") == 0) return true;
    if (json.compare(start, 5, "false") == 0) return false;
    if (json[start] == '1') return true;
    return false;
}

std::vector<float> getJsonFloatArrayVal(const std::string& json, const std::string& key) {
    std::vector<float> result;
    size_t pos = json.find("\"" + key + "\"");
    if (pos == std::string::npos) return result;
    pos = json.find("[", pos);
    if (pos == std::string::npos) return result;
    size_t end = json.find("]", pos);
    if (end == std::string::npos) return result;
    
    std::string arrayStr = json.substr(pos + 1, end - pos - 1);
    size_t startIdx = 0;
    while (true) {
        size_t nextComma = arrayStr.find(",", startIdx);
        std::string numStr = arrayStr.substr(startIdx, nextComma == std::string::npos ? std::string::npos : nextComma - startIdx);
        size_t first = numStr.find_first_not_of(" \t\r\n");
        if (first != std::string::npos) {
            size_t last = numStr.find_last_not_of(" \t\r\n");
            numStr = numStr.substr(first, last - first + 1);
            if (!numStr.empty()) {
                result.push_back((float)std::stod(numStr));
            }
        }
        if (nextComma == std::string::npos) break;
        startIdx = nextComma + 1;
    }
    return result;
}


WebSocketServer::WebSocketServer(int port, AudioEngine& engine)
    : serverPort(port), audioEngine(engine)
{
    WSADATA wsaData;
    WSAStartup(MAKEWORD(2, 2), &wsaData);
}

WebSocketServer::~WebSocketServer()
{
    stop();
    WSACleanup();
}

void WebSocketServer::start()
{
    shouldExit = false;

    // Announce every finished background track load so the UI bridge knows when
    // the native engine is actually ready to take over playback (it defers the
    // web→native output handover until all pending loads report in).
    audioEngine.onTrackLoaded = [this](const std::string& trackId, bool ok, int pending) {
        std::ostringstream json;
        json << "{\"event\":\"trackLoaded\",\"trackId\":\"" << trackId
             << "\",\"ok\":" << (ok ? "true" : "false")
             << ",\"pending\":" << pending << "}";
        broadcast(json.str());
    };

    serverThread = std::thread(&WebSocketServer::listenLoop, this);
    timerThread = std::thread(&WebSocketServer::timerLoop, this);
}

void WebSocketServer::stop()
{
    shouldExit = true;
    
    // Close the listen socket to break the accept block if needed
    // (In full production we use non-blocking or select)
    
    if (serverThread.joinable()) serverThread.join();
    if (timerThread.joinable()) timerThread.join();
    
    std::lock_guard<std::mutex> lock(clientsMutex);
    for (void* client : activeClients)
    {
        SOCKET s = (SOCKET)client;
        closesocket(s);
    }
    activeClients.clear();
}

void WebSocketServer::listenLoop()
{
    SOCKET listenSocket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listenSocket == INVALID_SOCKET) return;

    sockaddr_in service;
    service.sin_family = AF_INET;
    service.sin_addr.s_addr = htonl(INADDR_ANY);
    service.sin_port = htons(serverPort);

    // Reuse addr
    int optVal = 1;
    setsockopt(listenSocket, SOL_SOCKET, SO_REUSEADDR, (char*)&optVal, sizeof(optVal));

    if (bind(listenSocket, (SOCKADDR*)&service, sizeof(service)) == SOCKET_ERROR)
    {
        closesocket(listenSocket);
        return;
    }

    if (listen(listenSocket, SOMAXCONN) == SOCKET_ERROR)
    {
        closesocket(listenSocket);
        return;
    }

    LOG_DBG << "[WebSocketServer] Listening on port " << serverPort << std::endl;

    while (!shouldExit)
    {
        fd_set readSet;
        FD_ZERO(&readSet);
        FD_SET(listenSocket, &readSet);
        timeval timeout { 1, 0 }; // 1s select timeout

        int sel = select(0, &readSet, nullptr, nullptr, &timeout);
        if (sel > 0 && FD_ISSET(listenSocket, &readSet))
        {
            SOCKET clientSocket = accept(listenSocket, nullptr, nullptr);
            if (clientSocket != INVALID_SOCKET)
            {
                std::lock_guard<std::mutex> lock(clientsMutex);
                activeClients.push_back((void*)clientSocket);
                std::thread(&WebSocketServer::clientLoop, this, (void*)clientSocket).detach();
            }
        }
    }

    closesocket(listenSocket);
}

bool WebSocketServer::handleHandshake(void* socketHandle)
{
    SOCKET s = (SOCKET)socketHandle;
    char buffer[2048];
    int bytesReceived = recv(s, buffer, sizeof(buffer) - 1, 0);
    if (bytesReceived <= 0) return false;
    buffer[bytesReceived] = '\0';

    std::string req(buffer);
    size_t keyPos = req.find("Sec-WebSocket-Key: ");
    if (keyPos == std::string::npos) return false;

    keyPos += 19;
    size_t keyEnd = req.find("\r\n", keyPos);
    if (keyEnd == std::string::npos) return false;

    std::string key = req.substr(keyPos, keyEnd - keyPos);
    std::string magic = key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    uint8_t digest[20];
    SHA1 sha1;
    sha1.update(magic);
    sha1.final(digest);

    std::string acceptKey = base64_encode(digest, 20);

    std::ostringstream response;
    response << "HTTP/1.1 101 Switching Protocols\r\n"
             << "Upgrade: websocket\r\n"
             << "Connection: Upgrade\r\n"
             << "Sec-WebSocket-Accept: " << acceptKey << "\r\n\r\n";

    send(s, response.str().c_str(), (int)response.str().length(), 0);
    return true;
}

void WebSocketServer::sendFrame(void* socketHandle, const std::string& text)
{
    SOCKET s = (SOCKET)socketHandle;
    std::vector<uint8_t> frame;
    frame.push_back(0x81); // Fin bit + text frame

    size_t len = text.length();
    if (len <= 125)
    {
        frame.push_back((uint8_t)len);
    }
    else if (len <= 65535)
    {
        frame.push_back(126);
        frame.push_back((uint8_t)(len >> 8));
        frame.push_back((uint8_t)(len & 0xFF));
    }
    else
    {
        frame.push_back(127);
        for (int i = 7; i >= 0; --i)
        {
            frame.push_back((uint8_t)(len >> (i * 8)));
        }
    }

    frame.insert(frame.end(), text.begin(), text.end());
    send(s, (char*)frame.data(), (int)frame.size(), 0);
}

std::string WebSocketServer::readFrame(void* socketHandle, bool& error)
{
    SOCKET s = (SOCKET)socketHandle;
    uint8_t header[2];
    int r = recv(s, (char*)header, 2, 0);
    if (r <= 0) { error = true; return ""; }

    uint8_t opcode = header[0] & 0x0F;
    bool masked = (header[1] & 0x80) != 0;
    uint64_t payloadLen = header[1] & 0x7F;

    if (opcode == 0x08) { // Close frame
        error = true;
        return "";
    }

    if (payloadLen == 126)
    {
        uint8_t extendedLen[2];
        r = recv(s, (char*)extendedLen, 2, 0);
        if (r <= 0) { error = true; return ""; }
        payloadLen = ((uint64_t)extendedLen[0] << 8) | extendedLen[1];
    }
    else if (payloadLen == 127)
    {
        uint8_t extendedLen[8];
        r = recv(s, (char*)extendedLen, 8, 0);
        if (r <= 0) { error = true; return ""; }
        payloadLen = 0;
        for (int i = 0; i < 8; ++i)
        {
            payloadLen = (payloadLen << 8) | extendedLen[i];
        }
    }

    uint8_t maskKey[4] = {0};
    if (masked)
    {
        r = recv(s, (char*)maskKey, 4, 0);
        if (r <= 0) { error = true; return ""; }
    }

    std::vector<char> payload(payloadLen);
    if (payloadLen > 0)
    {
        uint64_t totalReceived = 0;
        while (totalReceived < payloadLen)
        {
            int chunk = recv(s, payload.data() + totalReceived, (int)(payloadLen - totalReceived), 0);
            if (chunk <= 0) { error = true; return ""; }
            totalReceived += chunk;
        }

        if (masked)
        {
            for (uint64_t i = 0; i < payloadLen; ++i)
            {
                payload[i] ^= maskKey[i % 4];
            }
        }
    }

    return std::string(payload.begin(), payload.end());
}

void WebSocketServer::broadcast(const std::string& text)
{
    std::lock_guard<std::mutex> lock(clientsMutex);
    for (void* client : activeClients)
    {
        sendFrame(client, text);
    }
}

void WebSocketServer::clientLoop(void* socketHandle)
{
    SOCKET s = (SOCKET)socketHandle;
    
    if (!handleHandshake(socketHandle))
    {
        closesocket(s);
        std::lock_guard<std::mutex> lock(clientsMutex);
        activeClients.erase(std::remove(activeClients.begin(), activeClients.end(), socketHandle), activeClients.end());
        return;
    }

    LOG_DBG << "[WebSocketServer] Client connected and handshaked successfully." << std::endl;

    while (!shouldExit)
    {
        bool err = false;
        std::string frameText = readFrame(socketHandle, err);
        if (err) break;

        if (frameText.empty()) continue;

        LOG_DBG << "[Received Command] " << frameText << std::endl;

        // Parse very basic commands
        std::string cmd = getJsonStringVal(frameText, "command");
        if (cmd == "init")
        {
            double sr = getJsonDoubleVal(frameText, "sampleRate");
            audioEngine.init((int)sr);
        }
        else if (cmd == "play")
        {
            audioEngine.play();
        }
        else if (cmd == "pause")
        {
            audioEngine.pause();
        }
        else if (cmd == "stop")
        {
            audioEngine.stop();
        }
        else if (cmd == "seek")
        {
            double pos = getJsonDoubleVal(frameText, "positionSeconds");
            audioEngine.seek(pos);
        }
        else if (cmd == "setLoop")
        {
            bool enabled = getJsonBoolVal(frameText, "enabled");
            audioEngine.setLoop(enabled);
        }
        else if (cmd == "loadTrack")
        {
            std::string trackId = getJsonStringVal(frameText, "trackId");
            std::string filePath = getJsonStringVal(frameText, "filePath");
            audioEngine.loadTrack(trackId, filePath);
        }
        else if (cmd == "removeTrack")
        {
            std::string trackId = getJsonStringVal(frameText, "trackId");
            audioEngine.removeTrack(trackId);
        }
        else if (cmd == "setTrackParam")
        {
            std::string trackId = getJsonStringVal(frameText, "trackId");
            std::string key = getJsonStringVal(frameText, "key");
            double val = getJsonDoubleVal(frameText, "value");
            audioEngine.setTrackParam(trackId, key, (float)val);
        }
        else if (cmd == "setTrackAutomation")
        {
            std::string trackId = getJsonStringVal(frameText, "trackId");
            bool autoOn = getJsonBoolVal(frameText, "autoOn");
            bool curved = getJsonBoolVal(frameText, "curved");
            std::vector<float> pts = getJsonFloatArrayVal(frameText, "points"); // interleaved [t0,v0,t1,v1,...]
            audioEngine.setTrackAutomation(trackId, autoOn, curved, pts);
        }
        else if (cmd == "clearTracks")
        {
            audioEngine.clearTracks();
        }
        else if (cmd == "clearAllMuteSolo")
        {
            audioEngine.clearAllMuteSolo();
        }
        else if (cmd == "setProjectBpm")
        {
            double bpm = getJsonDoubleVal(frameText, "bpm");
            audioEngine.setProjectBpm(bpm);
        }
        else if (cmd == "setPlaybackBpm")
        {
            double bpm = getJsonDoubleVal(frameText, "bpm");
            audioEngine.setPlaybackBpm(bpm);
        }
        else if (cmd == "setVariBpm")
        {
            bool on = getJsonBoolVal(frameText, "on");
            audioEngine.setVariBpm(on);
        }
        else if (cmd == "setVariKey")
        {
            bool on = getJsonBoolVal(frameText, "on");
            audioEngine.setVariKey(on);
        }
        else if (cmd == "setKey")
        {
            std::string key = getJsonStringVal(frameText, "key");
            audioEngine.setKey(key);
        }
        else if (cmd == "setDetectedKey")
        {
            std::string key = getJsonStringVal(frameText, "key");
            audioEngine.setDetectedKey(key);
        }
        else if (cmd == "setKeyShift")
        {
            double v = getJsonDoubleVal(frameText, "semitones");
            int semitones = (int)(v < 0 ? v - 0.5 : v + 0.5);
            audioEngine.setKeyShift(semitones);
        }
        else if (cmd == "setMaster")
        {
            std::string key = getJsonStringVal(frameText, "key");
            double val = getJsonDoubleVal(frameText, "value");
            audioEngine.setMaster(key, (float)val);
        }
        else if (cmd == "setMasterBand")
        {
            double index = getJsonDoubleVal(frameText, "index");
            double db = getJsonDoubleVal(frameText, "db");
            audioEngine.setMasterBand((int)index, (float)db);
        }
        else if (cmd == "setMasterBands")
        {
            std::vector<float> bands = getJsonFloatArrayVal(frameText, "bands");
            audioEngine.setMasterBands(bands);
        }
        else if (cmd == "setMasterRoom")
        {
            RoomSpec spec;
            spec.decay    = (float)getJsonDoubleVal(frameText, "decay");
            spec.shape    = (float)getJsonDoubleVal(frameText, "shape");
            spec.preDelay = (float)getJsonDoubleVal(frameText, "preDelay");
            spec.wet      = (float)getJsonDoubleVal(frameText, "wet");
            spec.damp     = (float)getJsonDoubleVal(frameText, "damp");
            spec.width    = (float)getJsonDoubleVal(frameText, "width");
            spec.echo     = (float)getJsonDoubleVal(frameText, "echo");
            spec.size     = (float)getJsonDoubleVal(frameText, "size");
            spec.erGain   = (float)getJsonDoubleVal(frameText, "erGain");
            audioEngine.setRoom(spec);
        }
        else if (cmd == "setMasterGroup")
        {
            double group = getJsonDoubleVal(frameText, "group");
            double db = getJsonDoubleVal(frameText, "db");
            int g = (int)group;
            for (int i = g * 3; i < g * 3 + 3; ++i)
            {
                audioEngine.setMasterBand(i, (float)db);
            }
        }
        else if (cmd == "export")
        {
            std::string exportId = getJsonStringVal(frameText, "exportId");
            double sampleRate = getJsonDoubleVal(frameText, "sampleRate");
            bool normalize = getJsonBoolVal(frameText, "normalize");
            double lufsTarget = getJsonDoubleVal(frameText, "lufsTarget");
            bool preservePitch = getJsonBoolVal(frameText, "preservePitch");
            double duration = getJsonDoubleVal(frameText, "duration");
            double fadeIn = getJsonDoubleVal(frameText, "fadeIn");
            double fadeOut = getJsonDoubleVal(frameText, "fadeOut");

            const char* tempEnv = std::getenv("TEMP");
            std::string tempDir = tempEnv != nullptr ? std::string(tempEnv) : ".";
            std::string tempPath = tempDir + "\\" + exportId + ".wav";

            std::thread([this, exportId, tempPath, sampleRate, duration, normalize, lufsTarget, preservePitch, fadeIn, fadeOut]() {
                audioEngine.exportMix(
                    exportId,
                    tempPath,
                    sampleRate,
                    duration,
                    normalize,
                    (float)lufsTarget,
                    preservePitch,
                    fadeIn,
                    fadeOut,
                    [this, exportId](float progress) {
                        std::ostringstream json;
                        json << "{\"event\":\"exportProgress\",\"exportId\":\"" << exportId << "\",\"progress\":" << progress << "}";
                        broadcast(json.str());
                    },
                    [this, exportId](const std::string& finalPath, const std::string& err) {
                        std::ostringstream json;
                        if (err.empty()) {
                            std::string escapedPath = finalPath;
                            size_t start_pos = 0;
                            while((start_pos = escapedPath.find("\\", start_pos)) != std::string::npos) {
                                escapedPath.replace(start_pos, 1, "\\\\");
                                start_pos += 2;
                            }
                            json << "{\"event\":\"exportDone\",\"exportId\":\"" << exportId << "\",\"tempFilePath\":\"" << escapedPath << "\"}";
                        } else {
                            json << "{\"event\":\"exportError\",\"exportId\":\"" << exportId << "\",\"error\":\"" << err << "\"}";
                        }
                        broadcast(json.str());
                    }
                );
            }).detach();
        }

        // Acknowledge transport commands immediately with the post-command state.
        // The 100ms timer can broadcast a frame captured BEFORE the command was
        // processed; this ack supersedes it so the UI playhead never sticks on a
        // stale stopped/position-0 snapshot after pressing play.
        if (cmd == "play" || cmd == "pause" || cmd == "stop" || cmd == "seek")
        {
            audioEngine.updatePlayhead();
            const bool playingNow = audioEngine.isPlaying();
            std::ostringstream ackJson;
            ackJson << "{\"event\":\"playbackPosition\",\"positionSeconds\":" << audioEngine.getPlayhead()
                    << ",\"isPlaying\":" << (playingNow ? "true" : "false") << ",\"ack\":true}";
            broadcast(ackJson.str());
        }
    }

    closesocket(s);
    LOG_DBG << "[WebSocketServer] Client disconnected." << std::endl;
    
    std::lock_guard<std::mutex> lock(clientsMutex);
    activeClients.erase(std::remove(activeClients.begin(), activeClients.end(), socketHandle), activeClients.end());
}

void WebSocketServer::timerLoop()
{
    while (!shouldExit)
    {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        
        audioEngine.updatePlayhead();

        const bool playing = audioEngine.isPlaying();

        std::ostringstream posJson;
        posJson << "{\"event\":\"playbackPosition\",\"positionSeconds\":" << audioEngine.getPlayhead()
                << ",\"isPlaying\":" << (playing ? "true" : "false") << "}";
        broadcast(posJson.str());

        // Always broadcast level meters. When stopped/paused the magnitude getters
        // return 0, so the meters fall to silence instead of freezing at the last
        // played level (which they did when we only broadcast while playing).
        {
            std::ostringstream lvJson;
            auto masterMag = audioEngine.getMasterMagnitude();
            lvJson << "{\"event\":\"levels\",\"master\":{\"l\":" << masterMag.first << ",\"r\":" << masterMag.second << "}";

            // Master band levels for the spectrum meter — without these the web UI
            // borrows the muted web engine's analyser, which shows its reverb tail.
            {
                auto bands = audioEngine.getMasterBandLevels();
                lvJson << ",\"masterBands\":[";
                for (size_t i = 0; i < bands.size(); ++i)
                {
                    lvJson << bands[i];
                    if (i + 1 < bands.size()) lvJson << ",";
                }
                lvJson << "]";
            }

            auto tracks = audioEngine.getTracks();
            if (!tracks.empty())
            {
                lvJson << ",\"tracks\":{";
                for (size_t i = 0; i < tracks.size(); ++i)
                {
                    float val = audioEngine.getTrackMagnitude(tracks[i].id);
                    lvJson << "\"" << tracks[i].id << "\":" << val;
                    if (i < tracks.size() - 1) lvJson << ",";
                }
                lvJson << "}";
            }
            lvJson << "}";
            broadcast(lvJson.str());
        }
    }
}
