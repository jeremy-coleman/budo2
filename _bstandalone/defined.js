

/**
 var defined: {
    <T>(...args: T[]): T;
    (...args: any[]): any;
}
 */
//


module.exports = function defined(...args) {
    for (var i = 0; i < args.length; i++) {
        if (args[i] !== undefined) return args[i];
    }
};