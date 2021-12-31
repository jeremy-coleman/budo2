/**
 * Checks for a matching suffix at the end of a string (for ES5 and lower)
 * @param str Source string
 * @param suffix Suffix to search for in the source string
 * @returns Boolean indicating whether the suffix was found (true) or not (false)
 */
const EndsWith = (str, suffix) => {
    return str.indexOf(suffix, str.length - suffix.length) !== -1;
};
/**
 * Checks for a matching suffix at the beginning of a string (for ES5 and lower)
 * @param str Source string
 * @param suffix Suffix to search for in the source string
 * @returns Boolean indicating whether the suffix was found (true) or not (false)
 */
const StartsWith = (str, suffix) => {
    if (!str) {
        return false;
    }
    return str.indexOf(suffix) === 0;
};
/**
 * Encode a buffer to a base64 string
 * @param buffer defines the buffer to encode
 * @returns the encoded string
 */
const EncodeArrayBufferToBase64 = (buffer) => {
    var keyStr = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    var output = "";
    var chr1, chr2, chr3, enc1, enc2, enc3, enc4;
    var i = 0;
    var bytes = ArrayBuffer.isView(buffer) ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) : new Uint8Array(buffer);
    while (i < bytes.length) {
        chr1 = bytes[i++];
        chr2 = i < bytes.length ? bytes[i++] : Number.NaN;
        chr3 = i < bytes.length ? bytes[i++] : Number.NaN;
        enc1 = chr1 >> 2;
        enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
        enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
        enc4 = chr3 & 63;
        if (isNaN(chr2)) {
            enc3 = enc4 = 64;
        }
        else if (isNaN(chr3)) {
            enc4 = 64;
        }
        output += keyStr.charAt(enc1) + keyStr.charAt(enc2) +
            keyStr.charAt(enc3) + keyStr.charAt(enc4);
    }
    return output;
};
/**
 * Converts a given base64 string as an ASCII encoded stream of data
 * @param base64Data The base64 encoded string to decode
 * @returns Decoded ASCII string
 */
const DecodeBase64ToString = (base64Data) => {
    return atob(base64Data);
};
/**
 * Converts a given base64 string into an ArrayBuffer of raw byte data
 * @param base64Data The base64 encoded string to decode
 * @returns ArrayBuffer of byte data
 */
const DecodeBase64ToBinary = (base64Data) => {
    const decodedString = DecodeBase64ToString(base64Data);
    const bufferLength = decodedString.length;
    const bufferView = new Uint8Array(new ArrayBuffer(bufferLength));
    for (let i = 0; i < bufferLength; i++) {
        bufferView[i] = decodedString.charCodeAt(i);
    }
    return bufferView.buffer;
};

export { DecodeBase64ToBinary, DecodeBase64ToString, EncodeArrayBufferToBase64, EndsWith, StartsWith };
