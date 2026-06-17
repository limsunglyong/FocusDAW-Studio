cmake_minimum_required(VERSION 3.15)
project(FocusDAW-AudioEngine VERSION 1.0.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Source files
file(GLOB SOUNDTOUCH_SOURCES "Source/soundtouch/*.cpp")

set(SOURCE_FILES
    Source/Main.cpp
    Source/AudioEngine.h
    Source/AudioEngine.cpp
    Source/WebSocketServer.h
    Source/WebSocketServer.cpp
    ${SOUNDTOUCH_SOURCES}
)

# If JUCE is available as a subdirectory, we can build it with full JUCE features
if (NOT JUCE_PATH)
    set(JUCE_PATH "${CMAKE_CURRENT_LIST_DIR}/../third_party/JUCE" CACHE PATH "Path to JUCE directory")
endif()

if (EXISTS "${JUCE_PATH}")
    add_subdirectory("${JUCE_PATH}" JUCE)
endif()

if (TARGET juce::juce_audio_devices)
    juce_add_console_app(FocusDAW-AudioEngine
        PRODUCT_NAME "FocusDAW-AudioEngine")
    target_sources(FocusDAW-AudioEngine PRIVATE ${SOURCE_FILES})
else()
    add_executable(FocusDAW-AudioEngine ${SOURCE_FILES})
endif()
target_include_directories(FocusDAW-AudioEngine PRIVATE Source/soundtouch)

# Windows Socket library linking
if (WIN32)
    target_link_libraries(FocusDAW-AudioEngine PRIVATE ws2_32)
endif()

# JUCE framework linking if module target is resolved
if (TARGET juce::juce_audio_devices)
    target_link_libraries(FocusDAW-AudioEngine PRIVATE
        juce::juce_audio_basics
        juce::juce_audio_devices
        juce::juce_audio_formats
        juce::juce_audio_processors
        juce::juce_dsp
        juce::juce_core
        juce::juce_events
    )
    juce_generate_juce_header(FocusDAW-AudioEngine)
endif()
