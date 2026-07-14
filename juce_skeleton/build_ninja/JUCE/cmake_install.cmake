# Install script for directory: E:/programmings/FocusDAW-Studio/third_party/JUCE

# Set the install prefix
if(NOT DEFINED CMAKE_INSTALL_PREFIX)
  set(CMAKE_INSTALL_PREFIX "C:/Program Files (x86)/FocusDAW-AudioEngine")
endif()
string(REGEX REPLACE "/$" "" CMAKE_INSTALL_PREFIX "${CMAKE_INSTALL_PREFIX}")

# Set the install configuration name.
if(NOT DEFINED CMAKE_INSTALL_CONFIG_NAME)
  if(BUILD_TYPE)
    string(REGEX REPLACE "^[^A-Za-z0-9_]+" ""
           CMAKE_INSTALL_CONFIG_NAME "${BUILD_TYPE}")
  else()
    set(CMAKE_INSTALL_CONFIG_NAME "Release")
  endif()
  message(STATUS "Install configuration: \"${CMAKE_INSTALL_CONFIG_NAME}\"")
endif()

# Set the component getting installed.
if(NOT CMAKE_INSTALL_COMPONENT)
  if(COMPONENT)
    message(STATUS "Install component: \"${COMPONENT}\"")
    set(CMAKE_INSTALL_COMPONENT "${COMPONENT}")
  else()
    set(CMAKE_INSTALL_COMPONENT)
  endif()
endif()

# Is this installation the result of a crosscompile?
if(NOT DEFINED CMAKE_CROSSCOMPILING)
  set(CMAKE_CROSSCOMPILING "FALSE")
endif()

if(NOT CMAKE_INSTALL_LOCAL_ONLY)
  # Include the install script for the subdirectory.
  include("E:/programmings/FocusDAW-Studio/juce_skeleton/build_ninja/JUCE/modules/cmake_install.cmake")
endif()

if(NOT CMAKE_INSTALL_LOCAL_ONLY)
  # Include the install script for the subdirectory.
  include("E:/programmings/FocusDAW-Studio/juce_skeleton/build_ninja/JUCE/extras/Build/cmake_install.cmake")
endif()

if(CMAKE_INSTALL_COMPONENT STREQUAL "Unspecified" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/lib/cmake/JUCE-8.0.13" TYPE FILE FILES
    "E:/programmings/FocusDAW-Studio/juce_skeleton/build_ninja/JUCE/JUCEConfigVersion.cmake"
    "E:/programmings/FocusDAW-Studio/juce_skeleton/build_ninja/JUCE/JUCEConfig.cmake"
    "E:/programmings/FocusDAW-Studio/third_party/JUCE/extras/Build/CMake/JUCECheckAtomic.cmake"
    "E:/programmings/FocusDAW-Studio/third_party/JUCE/extras/Build/CMake/JUCEHelperTargets.cmake"
    "E:/programmings/FocusDAW-Studio/third_party/JUCE/extras/Build/CMake/JUCEModuleSupport.cmake"
    "E:/programmings/FocusDAW-Studio/third_party/JUCE/extras/Build/CMake/JUCEUtils.cmake"
    "E:/programmings/FocusDAW-Studio/third_party/JUCE/extras/Build/CMake/JuceLV2Defines.h.in"
    "E:/programmings/FocusDAW-Studio/third_party/JUCE/extras/Build/CMake/LaunchScreen.storyboard"
    "E:/programmings/FocusDAW-Studio/third_party/JUCE/extras/Build/CMake/PIPAudioProcessor.cpp.in"
    "E:/programmings/FocusDAW-Studio/third_party/JUCE/extras/Build/CMake/PIPAudioProcessorWithARA.cpp.in"
    "E:/programmings/FocusDAW-Studio/third_party/JUCE/extras/Build/CMake/PIPComponent.cpp.in"
    "E:/programmings/FocusDAW-Studio/third_party/JUCE/extras/Build/CMake/PIPConsole.cpp.in"
    "E:/programmings/FocusDAW-Studio/third_party/JUCE/extras/Build/CMake/RecentFilesMenuTemplate.nib"
    "E:/programmings/FocusDAW-Studio/third_party/JUCE/extras/Build/CMake/UnityPluginGUIScript.cs.in"
    "E:/programmings/FocusDAW-Studio/third_party/JUCE/extras/Build/CMake/checkBundleSigning.cmake"
    "E:/programmings/FocusDAW-Studio/third_party/JUCE/extras/Build/CMake/copyDir.cmake"
    "E:/programmings/FocusDAW-Studio/third_party/JUCE/extras/Build/CMake/juce_runtime_arch_detection.cpp"
    "E:/programmings/FocusDAW-Studio/third_party/JUCE/extras/Build/CMake/juce_LinuxSubprocessHelper.cpp"
    )
endif()

if(CMAKE_INSTALL_COMPONENT STREQUAL "Unspecified" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/lib/cmake/JUCE-8.0.13" TYPE DIRECTORY FILES "E:/programmings/FocusDAW-Studio/third_party/JUCE/extras/Build/CMake/juce_vst3_helper")
endif()

string(REPLACE ";" "\n" CMAKE_INSTALL_MANIFEST_CONTENT
       "${CMAKE_INSTALL_MANIFEST_FILES}")
if(CMAKE_INSTALL_LOCAL_ONLY)
  file(WRITE "E:/programmings/FocusDAW-Studio/juce_skeleton/build_ninja/JUCE/install_local_manifest.txt"
     "${CMAKE_INSTALL_MANIFEST_CONTENT}")
endif()
