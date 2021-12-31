/**
 * Converts a half float to a number
 * @param value half float to convert
 * @returns converted half float
 */
function FromHalfFloat(value) {
    const s = (value & 0x8000) >> 15;
    const e = (value & 0x7C00) >> 10;
    const f = value & 0x03FF;
    if (e === 0) {
        return (s ? -1 : 1) * Math.pow(2, -14) * (f / Math.pow(2, 10));
    }
    else if (e == 0x1F) {
        return f ? NaN : ((s ? -1 : 1) * Infinity);
    }
    return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + (f / Math.pow(2, 10)));
}

export { FromHalfFloat };
