/**
 * Capture data from specific location
 * @param {number} start - The position to start capturing
 * @param {number} length - Data length you want to capture
 * @return {Buffer}
 * @since 1.0.0
 */
Buffer.prototype.sf_capture = function(start, length){
    return this.subarray(start, start + length);
};