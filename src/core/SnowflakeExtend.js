/**
 * Capture data from specific location
 * @param {number} start - The position to start capturing
 * @param {number} length - Data length you want to capture
 * @return {Buffer}
 * @since 1.0.0
 */
Buffer.prototype.sfCapture = function(start, length){
    return this.subarray(start, start + length);
};

/**
 * Trim specific character from the string
 * @param {string} charToTrim - The character to trim
 * @return {string}
 * @since 1.0.0
 */
String.prototype.trimChar = function(charToTrim){
    const regex = new RegExp(`^${charToTrim}+|${charToTrim}+$`, 'g')
    return this.replace(regex, '');
}

/**
 * Uppercase the first letter of the string
 * @return {string}
 * @since 1.0.0
 */
String.prototype.toUcFirst = function(){
    if(!this)
        return "";
    return this.charAt(0).toUpperCase() + this.slice(1);
}