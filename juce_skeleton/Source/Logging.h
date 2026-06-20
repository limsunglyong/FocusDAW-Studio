#pragma once

#include <iostream>
#include <cstdlib>

namespace focusdaw {

// Verbose diagnostic logging is OFF by default so release builds stay quiet.
// Set the environment variable FOCUSDAW_VERBOSE=1 to re-enable the [AudioEngine]
// / [WebSocketServer] stdout chatter for debugging.
inline bool verboseLogging()
{
    static const bool enabled = []
    {
        const char* v = std::getenv("FOCUSDAW_VERBOSE");
        return v != nullptr && v[0] != '\0' && v[0] != '0';
    }();
    return enabled;
}

} // namespace focusdaw

// Drop-in replacement for `std::cout` on debug lines. When verbose logging is
// disabled the streamed expression is never evaluated. The for-loop form keeps
// the macro safe to use as a brace-less if/else body (no dangling-else trap).
#define LOG_DBG \
    for (bool focusdaw_log_once = ::focusdaw::verboseLogging(); focusdaw_log_once; focusdaw_log_once = false) std::cout
