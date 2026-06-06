/*
 * Logger.h
 *
 Copyright (c) 2013 Collin Kidder, Michael Neuweiler, Charles Galpin

 Permission is hereby granted, free of charge, to any person obtaining
 a copy of this software and associated documentation files (the
 "Software"), to deal in the Software without restriction, including
 without limitation the rights to use, copy, modify, merge, publish,
 distribute, sublicense, and/or sell copies of the Software, and to
 permit persons to whom the Software is furnished to do so, subject to
 the following conditions:

 The above copyright notice and this permission notice shall be included
 in all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
 CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

 */

#ifndef LOGGER_H_
#define LOGGER_H_

#include <Arduino.h>
#include "config.h"

/**
 * Optional second destination for fully-formatted log lines (no trailing
 * newline). Implemented by EspLink so log output can also be streamed to the
 * web UI alongside the USB serial console. Implementations must be non-blocking.
 */
class LogSink {
public:
    virtual ~LogSink() {}
    virtual void writeLine(int level, const char *line) = 0;
};

class Logger {
public:
    enum LogLevel {
        Debug = 2, Info = 1
    };
    static void debug(const char *, ...);

    static void info(const char *, ...);

    static void console(const char *, ...);
    static LogLevel getLogLevel();
    static uint32_t getLastLogTime();
    static boolean isDebug();

    // Register (or clear, with nullptr) an additional log destination.
    static void setSink(LogSink *s);
private:
    static LogLevel logLevel;
    static uint32_t lastLogTime;
    static LogSink *sink;

    static void log(LogLevel, const char *format, va_list);
    // Renders the printf-style message into `out` (a Print sink) without a
    // trailing newline, so callers can fan it out to multiple destinations.
    static void logMessage(Print &out, const char *format, va_list args);

};

#endif /* LOGGER_H_ */


