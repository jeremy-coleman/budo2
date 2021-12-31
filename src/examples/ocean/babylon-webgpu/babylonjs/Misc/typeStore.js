/** @hidden */
const _RegisteredTypes = {};
/** @hidden */
function RegisterClass(className, type) {
    _RegisteredTypes[className] = type;
}
/** @hidden */
function GetClass(fqdn) {
    return _RegisteredTypes[fqdn];
}

export { GetClass, RegisterClass };
