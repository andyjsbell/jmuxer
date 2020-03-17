let logger;
let errorLogger;

module.exports = function setLogger() {
    /*eslint-disable */
    logger = console.log;
    errorLogger = console.error;
    /*eslint-enable */
}

module.exports = function isEnable() {
    return logger != null;
}

module.exports = function log(message, ...optionalParams) {
    if (logger) {
        logger(message, ...optionalParams);
    }
}

module.exports = function error(message, ...optionalParams) {
    if (errorLogger) {
        errorLogger(message, ...optionalParams);
    }
}
