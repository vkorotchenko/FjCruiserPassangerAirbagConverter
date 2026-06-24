/*
 * Logger.cpp
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

#include "Logger.h"
#include "control_protocol.h"   // CONTROL_LINE_MAX

// Default to Info so routine DEBUG chatter stays off the serial/web log. Raise
// to Debug here (or via a future control) when diagnosing.
Logger::LogLevel Logger::logLevel = Logger::Info;
uint32_t Logger::lastLogTime = 0;
LogSink *Logger::sink = nullptr;

/*
 * A fixed-size Print target that accumulates characters into a buffer so a log
 * line can be rendered once and then fanned out to several destinations (USB
 * serial console and the optional LogSink) without re-running the formatter.
 */
class LineBuffer : public Print {
public:
    LineBuffer() : len(0) {}
    size_t write(uint8_t c) override {
        if (len < CONTROL_LINE_MAX - 1) {
            buf[len++] = (char) c;
        }
        return 1;
    }
    size_t write(const uint8_t *b, size_t n) override {
        for (size_t i = 0; i < n; i++) write(b[i]);
        return n;
    }
    const char *c_str() { buf[len] = '\0'; return buf; }
private:
    char buf[CONTROL_LINE_MAX];
    size_t len;
};

void Logger::setSink(LogSink *s) {
    sink = s;
}

/*
 * Output a debug message with a variable amount of parameters.
 * printf() style, see Logger::log()
 *
 */
void Logger::debug(const char *message, ...) {
    if (logLevel != Debug)
        return;
    va_list args;
    va_start(args, message);
    Logger::log(Debug, message, args);
    va_end(args);
}

/*
 * Output a info message with a variable amount of parameters
 * printf() style, see Logger::log()
 */
void Logger::info(const char *message, ...) {
    va_list args;
    va_start(args, message);
    Logger::log(Info, message, args);
    va_end(args);
}

/*
 * Output a comnsole message with a variable amount of parameters
 * printf() style, see Logger::logMessage()
 */
void Logger::console(const char *message, ...) {
    LineBuffer lb;
    va_list args;
    va_start(args, message);
    Logger::logMessage(lb, message, args);
    va_end(args);

    SERIAL_PORT_MONITOR.println(lb.c_str());
    if (sink) sink->writeLine(Info, lb.c_str());
}

/*
 * Retrieve the current log level.
 */
Logger::LogLevel Logger::getLogLevel() {
    return logLevel;
}

/*
 * Return a timestamp when the last log entry was made.
 */
uint32_t Logger::getLastLogTime() {
    return lastLogTime;
}

/*
 * Returns if debug log level is enabled. This can be used in time critical
 * situations to prevent unnecessary string concatenation (if the message won't
 * be logged in the end).
 *
 * Example:
 * if (Logger::isDebug()) {
 *    Logger::debug("current time: %d", millis());
 * }
 */
boolean Logger::isDebug() {
    return logLevel == Debug;
}

/*
 * Output a log message (called by debug(), info(), warn(), error(), console())
 *
 * Supports printf() like syntax:
 *
 * %% - outputs a '%' character
 * %s - prints the next parameter as string
 * %d - prints the next parameter as decimal
 * %f - prints the next parameter as double float
 * %x - prints the next parameter as hex value
 * %X - prints the next parameter as hex value with '0x' added before
 * %b - prints the next parameter as binary value
 * %B - prints the next parameter as binary value with '0b' added before
 * %l - prints the next parameter as long
 * %c - prints the next parameter as a character
 * %t - prints the next parameter as boolean ('T' or 'F')
 * %T - prints the next parameter as boolean ('true' or 'false')
 */
void Logger::log(LogLevel level, const char *format, va_list args) {
    lastLogTime = millis();

    // Render the whole line once into a buffer, then fan out to the USB console
    // and (if registered) the sink. Keeps formatting in one place.
    LineBuffer lb;
    lb.print(lastLogTime);
    lb.print(" - ");

    switch (level) {
    case Debug:
        lb.print("DEBUG: ");
        break;
    case Info:
        lb.print("INFO: ");
        break;
    }

    logMessage(lb, format, args);

    SERIAL_PORT_MONITOR.println(lb.c_str());
    if (sink) sink->writeLine(level, lb.c_str());
}

/*
 * Output a log message (called by log(), console())
 *
 * Supports printf() like syntax:
 *
 * %% - outputs a '%' character
 * %s - prints the next parameter as string
 * %d - prints the next parameter as decimal
 * %f - prints the next parameter as double float
 * %x - prints the next parameter as hex value
 * %X - prints the next parameter as hex value with '0x' added before
 * %b - prints the next parameter as binary value
 * %B - prints the next parameter as binary value with '0b' added before
 * %l - prints the next parameter as long
 * %c - prints the next parameter as a character
 * %t - prints the next parameter as boolean ('T' or 'F')
 * %T - prints the next parameter as boolean ('true' or 'false')
 */
void Logger::logMessage(Print &out, const char *format, va_list args) {
    for (; *format != 0; ++format) {
        if (*format == '%') {
            ++format;
            if (*format == '\0')
                break;
            if (*format == '%') {
                out.print(*format);
                continue;
            }
            if (*format == 's') {
                register char *s = (char *) va_arg( args, int );
                out.print(s);
                continue;
            }
            if (*format == 'd' || *format == 'i') {
                out.print(va_arg( args, int ), DEC);
                continue;
            }
            if (*format == 'f') {
                out.print(va_arg( args, double ), 2);
                continue;
            }
            if (*format == 'x') {
                out.print(va_arg( args, int ), HEX);
                continue;
            }
            if (*format == 'X') {
                out.print("0x");
                out.print(va_arg( args, int ), HEX);
                continue;
            }
            if (*format == 'b') {
                out.print(va_arg( args, int ), BIN);
                continue;
            }
            if (*format == 'B') {
                out.print("0b");
                out.print(va_arg( args, int ), BIN);
                continue;
            }
            if (*format == 'l') {
                out.print(va_arg( args, long ), DEC);
                continue;
            }

            if (*format == 'c') {
                out.print(va_arg( args, int ));
                continue;
            }
            if (*format == 't') {
                if (va_arg( args, int ) == 1) {
                    out.print("T");
                } else {
                    out.print("F");
                }
                continue;
            }
            if (*format == 'T') {
                if (va_arg( args, int ) == 1) {
                    out.print("true");
                } else {
                    out.print("false");
                }
                continue;
            }

        }
        out.print(*format);
    }
}


