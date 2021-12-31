var PromiseStates;
(function (PromiseStates) {
    PromiseStates[PromiseStates["Pending"] = 0] = "Pending";
    PromiseStates[PromiseStates["Fulfilled"] = 1] = "Fulfilled";
    PromiseStates[PromiseStates["Rejected"] = 2] = "Rejected";
})(PromiseStates || (PromiseStates = {}));
class FulFillmentAgregator {
    constructor() {
        this.count = 0;
        this.target = 0;
        this.results = [];
    }
}
class InternalPromise {
    constructor(resolver) {
        this._state = PromiseStates.Pending;
        this._children = new Array();
        this._rejectWasConsumed = false;
        if (!resolver) {
            return;
        }
        try {
            resolver((value) => {
                this._resolve(value);
            }, (reason) => {
                this._reject(reason);
            });
        }
        catch (e) {
            this._reject(e);
        }
    }
    get _result() {
        return this._resultValue;
    }
    set _result(value) {
        this._resultValue = value;
        if (this._parent && this._parent._result === undefined) {
            this._parent._result = value;
        }
    }
    catch(onRejected) {
        return this.then(undefined, onRejected);
    }
    then(onFulfilled, onRejected) {
        let newPromise = new InternalPromise();
        newPromise._onFulfilled = onFulfilled;
        newPromise._onRejected = onRejected;
        // Composition
        this._children.push(newPromise);
        newPromise._parent = this;
        if (this._state !== PromiseStates.Pending) {
            setTimeout(() => {
                if (this._state === PromiseStates.Fulfilled || this._rejectWasConsumed) {
                    newPromise._resolve(this._result);
                }
                else {
                    newPromise._reject(this._reason);
                }
            });
        }
        return newPromise;
    }
    _moveChildren(children) {
        this._children.push(...children.splice(0, children.length));
        this._children.forEach((child) => {
            child._parent = this;
        });
        if (this._state === PromiseStates.Fulfilled) {
            for (var child of this._children) {
                child._resolve(this._result);
            }
        }
        else if (this._state === PromiseStates.Rejected) {
            for (var child of this._children) {
                child._reject(this._reason);
            }
        }
    }
    _resolve(value) {
        try {
            this._state = PromiseStates.Fulfilled;
            let returnedValue = null;
            if (this._onFulfilled) {
                returnedValue = this._onFulfilled(value);
            }
            if (returnedValue !== undefined && returnedValue !== null) {
                if (returnedValue._state !== undefined) {
                    // Transmit children
                    let returnedPromise = returnedValue;
                    returnedPromise._parent = this;
                    returnedPromise._moveChildren(this._children);
                    value = returnedPromise._result;
                }
                else {
                    value = returnedValue;
                }
            }
            this._result = value;
            for (var child of this._children) {
                child._resolve(value);
            }
            this._children.length = 0;
            delete this._onFulfilled;
            delete this._onRejected;
        }
        catch (e) {
            this._reject(e, true);
        }
    }
    _reject(reason, onLocalThrow = false) {
        this._state = PromiseStates.Rejected;
        this._reason = reason;
        if (this._onRejected && !onLocalThrow) {
            try {
                this._onRejected(reason);
                this._rejectWasConsumed = true;
            }
            catch (e) {
                reason = e;
            }
        }
        for (var child of this._children) {
            if (this._rejectWasConsumed) {
                child._resolve(null);
            }
            else {
                child._reject(reason);
            }
        }
        this._children.length = 0;
        delete this._onFulfilled;
        delete this._onRejected;
    }
    static resolve(value) {
        let newPromise = new InternalPromise();
        newPromise._resolve(value);
        return newPromise;
    }
    static _RegisterForFulfillment(promise, agregator, index) {
        promise.then((value) => {
            agregator.results[index] = value;
            agregator.count++;
            if (agregator.count === agregator.target) {
                agregator.rootPromise._resolve(agregator.results);
            }
            return null;
        }, (reason) => {
            if (agregator.rootPromise._state !== PromiseStates.Rejected) {
                agregator.rootPromise._reject(reason);
            }
        });
    }
    static all(promises) {
        let newPromise = new InternalPromise();
        let agregator = new FulFillmentAgregator();
        agregator.target = promises.length;
        agregator.rootPromise = newPromise;
        if (promises.length) {
            for (var index = 0; index < promises.length; index++) {
                InternalPromise._RegisterForFulfillment(promises[index], agregator, index);
            }
        }
        else {
            newPromise._resolve([]);
        }
        return newPromise;
    }
    static race(promises) {
        let newPromise = new InternalPromise();
        if (promises.length) {
            for (const promise of promises) {
                promise.then((value) => {
                    if (newPromise) {
                        newPromise._resolve(value);
                        newPromise = null;
                    }
                    return null;
                }, (reason) => {
                    if (newPromise) {
                        newPromise._reject(reason);
                        newPromise = null;
                    }
                });
            }
        }
        return newPromise;
    }
}
/**
 * Helper class that provides a small promise polyfill
 */
class PromisePolyfill {
    /**
     * Static function used to check if the polyfill is required
     * If this is the case then the function will inject the polyfill to window.Promise
     * @param force defines a boolean used to force the injection (mostly for testing purposes)
     */
    static Apply(force = false) {
        if (force || typeof Promise === 'undefined') {
            let root = window;
            root.Promise = InternalPromise;
        }
    }
}

export { PromisePolyfill };
