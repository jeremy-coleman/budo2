/**
 * Class used to define a retry strategy when error happens while loading assets
 */
class RetryStrategy {
    /**
     * Function used to defines an exponential back off strategy
     * @param maxRetries defines the maximum number of retries (3 by default)
     * @param baseInterval defines the interval between retries
     * @returns the strategy function to use
     */
    static ExponentialBackoff(maxRetries = 3, baseInterval = 500) {
        return (url, request, retryIndex) => {
            if (request.status !== 0 || retryIndex >= maxRetries || url.indexOf("file:") !== -1) {
                return -1;
            }
            return Math.pow(2, retryIndex) * baseInterval;
        };
    }
}

export { RetryStrategy };