/**
 * Logger used throughout the application to allow configuration of
 * the log level required for the messages.
 */
class Logger {
    static _CheckLimit(message, limit) {
        let entry = Logger._LogLimitOutputs[message];
        if (!entry) {
            entry = { limit, current: 1 };
            Logger._LogLimitOutputs[message] = entry;
        }
        else {
            entry.current++;
        }
        return entry.current <= entry.limit;
    }
    static _GenerateLimitMessage(message, messageType) {
        let entry = Logger._LogLimitOutputs[message];
        if (!entry || !Logger.MessageLimitReached) {
            return;
        }
        if (entry.current === entry.limit) {
            switch (messageType) {
                case 0:
                    Logger.Log(Logger.MessageLimitReached.replace(/%LIMIT%/g, "" + entry.limit).replace(/%TYPE%/g, "log"));
                    break;
                case 1:
                    Logger.Warn(Logger.MessageLimitReached.replace(/%LIMIT%/g, "" + entry.limit).replace(/%TYPE%/g, "warning"));
                    break;
                case 2:
                    Logger.Error(Logger.MessageLimitReached.replace(/%LIMIT%/g, "" + entry.limit).replace(/%TYPE%/g, "error"));
                    break;
            }
        }
    }
    static _AddLogEntry(entry) {
        Logger._LogCache = entry + Logger._LogCache;
        if (Logger.OnNewCacheEntry) {
            Logger.OnNewCacheEntry(entry);
        }
    }
    static _FormatMessage(message) {
        var padStr = (i) => (i < 10) ? "0" + i : "" + i;
        var date = new Date();
        return "[" + padStr(date.getHours()) + ":" + padStr(date.getMinutes()) + ":" + padStr(date.getSeconds()) + "]: " + message;
    }
    static _LogDisabled(message, limit) {
        // nothing to do
    }
    static _LogEnabled(message, limit) {
        if (limit !== undefined && !Logger._CheckLimit(message, limit)) {
            return;
        }
        var formattedMessage = Logger._FormatMessage(message);
        console.log("BJS - " + formattedMessage);
        var entry = "<div style='color:white'>" + formattedMessage + "</div><br>";
        Logger._AddLogEntry(entry);
        Logger._GenerateLimitMessage(message, 0);
    }
    static _WarnDisabled(message, limit) {
        // nothing to do
    }
    static _WarnEnabled(message, limit) {
        if (limit !== undefined && !Logger._CheckLimit(message, limit)) {
            return;
        }
        var formattedMessage = Logger._FormatMessage(message);
        console.warn("BJS - " + formattedMessage);
        var entry = "<div style='color:orange'>" + message + "</div><br>";
        Logger._AddLogEntry(entry);
        Logger._GenerateLimitMessage(message, 1);
    }
    static _ErrorDisabled(message, limit) {
        // nothing to do
    }
    static _ErrorEnabled(message, limit) {
        if (limit !== undefined && !Logger._CheckLimit(message, limit)) {
            return;
        }
        var formattedMessage = Logger._FormatMessage(message);
        Logger.errorsCount++;
        console.error("BJS - " + formattedMessage);
        var entry = "<div style='color:red'>" + formattedMessage + "</div><br>";
        Logger._AddLogEntry(entry);
        Logger._GenerateLimitMessage(message, 2);
    }
    /**
     * Gets current log cache (list of logs)
     */
    static get LogCache() {
        return Logger._LogCache;
    }
    /**
     * Clears the log cache
     */
    static ClearLogCache() {
        Logger._LogCache = "";
        Logger._LogLimitOutputs = {};
        Logger.errorsCount = 0;
    }
    /**
     * Sets the current log level (MessageLogLevel / WarningLogLevel / ErrorLogLevel)
     */
    static set LogLevels(level) {
        if ((level & Logger.MessageLogLevel) === Logger.MessageLogLevel) {
            Logger.Log = Logger._LogEnabled;
        }
        else {
            Logger.Log = Logger._LogDisabled;
        }
        if ((level & Logger.WarningLogLevel) === Logger.WarningLogLevel) {
            Logger.Warn = Logger._WarnEnabled;
        }
        else {
            Logger.Warn = Logger._WarnDisabled;
        }
        if ((level & Logger.ErrorLogLevel) === Logger.ErrorLogLevel) {
            Logger.Error = Logger._ErrorEnabled;
        }
        else {
            Logger.Error = Logger._ErrorDisabled;
        }
    }
}
/**
 * No log
 */
Logger.NoneLogLevel = 0;
/**
 * Only message logs
 */
Logger.MessageLogLevel = 1;
/**
 * Only warning logs
 */
Logger.WarningLogLevel = 2;
/**
 * Only error logs
 */
Logger.ErrorLogLevel = 4;
/**
 * All logs
 */
Logger.AllLogLevel = 7;
/**
 * Message to display when a message has been logged too many times
 */
Logger.MessageLimitReached = "Too many %TYPE%s (%LIMIT%), no more %TYPE%s will be reported for this message.";
Logger._LogCache = "";
Logger._LogLimitOutputs = {};
/**
 * Gets a value indicating the number of loading errors
 * @ignorenaming
 */
Logger.errorsCount = 0;
/**
 * Log a message to the console
 */
Logger.Log = Logger._LogEnabled;
/**
 * Write a warning message to the console
 */
Logger.Warn = Logger._WarnEnabled;
/**
 * Write an error message to the console
 */
Logger.Error = Logger._ErrorEnabled;

export { Logger };
