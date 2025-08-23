const { createHash } = require('node:crypto');
const msgpack = require("msgpack-lite");
const appConfig = require("../../app.json");

require("./SnowflakeExtend");
const path = require("path");
const fs = require("fs");
const AccessToken = require("./objects/AccessToken").default;

/**
 * Snowflake object
 * @since 1.0.0
 */
let Snowflake = {
    /**
     * The logger core
     * @type {SnowflakeLogger|null}
     * @since 1.0.0
     */
    logger: null,
    /**
     * The configuration core
     * @type {SnowflakeYaml|null}
     * @since 1.0.0
     */
    yaml: null,
    /**
     * The main core
     * @type {SnowflakeCore|null}
     * @since 1.0.0
     */
    core: null,
    /**
     * The server core
     * @type {SnowflakeServer|null}
     * @since 1.0.0
     */
    server: null,
    /**
     * The cypher core
     * @type {import("./SnowflakeCypher")|null}
     * @since 1.0.0
     */
    cypher: null,
    /**
     * The absolute path of core directory
     * @type string
     * @since 1.0.0
     */
    core_path: "",
    /**
     * Whether the app is running in development or production environment
     * @since 1.0.0
     */
    isDevelopment: false,
    /**
     * Determines if a value is considered true, these values are considered true: 'yes', 'true', '1', 1
     * It is also both case and type insensitive, which means you can pass 'True' or '1' and still get true
     * Also any non-string value will be casted using Boolean(value)
     * @param {any} value - Object to get the logical value of
     * @return {boolean}
     * @since 1.0.0
     */
    isTrue: value => {
        if(typeof value === "string")
            return ["true", "1", "yes", "on", "y"].includes(value.toLowerCase());
        return Boolean(value);
    },
    stringify: (value, maxLength = null, ellipsis = "...", showType = false) => {
        let type, data;

        if(value === null) {
            type = "null";
            data = "";
        }
        else if(typeof value === "undefined") {
            type = "undefined";
            data = "";
        }
        else if(typeof value === "boolean") {
            type = "bool";
            data = value ? "True" : "False";
        }
        else if(typeof value === "number") {
            type = "number";
            data = value;
        }
        else if(typeof value === "string") {
            type = "string";
            data = value;
        }
        else if(Buffer.isBuffer(value)) {
            type = "buffer";
            data = value.toString("hex");
        }
        else if(Array.isArray(value)) {
            type = "List";
            data = JSON.stringify(value);
        }
        else{
            type = typeof value;
            data = JSON.stringify(value).trimChar("'").trimChar('"');
        }

        const padding = 10;
        const dataLength = data.length;
        if(maxLength !== null && dataLength > maxLength && dataLength - maxLength >= padding * 2){
            data = data.substring(0, maxLength - 10) + ` ${ellipsis}[${dataLength - maxLength}]${ellipsis} ` + data.slice(dataLength - 10);
        }

        return (showType ? `[${type.toUcFirst()}] ` : "") + data;
    },
    /**
     * Guess the type of variable
     * @param {any} value
     * @return {"undefined"|"object"|"boolean"|"number"|"string"|"function"|"symbol"|"bigint"}
     * @since 10.0
     */
    typeof: value => {
        let type = typeof value;
        if (Array.isArray(value))
            type = "array";
        else if (value === null)
            type = "null";
        else if (Buffer.isBuffer(value))
            type = "buffer";
        return type;
    },
    /**
     * Converts a size from one unit to another.
     * @param {string} input - The input size with unit (e.g., "1MB").
     * @param {"B"|"KB"|"MB"|"GB"} outputFormat - The target size unit (e.g., "KB").
     * @param {boolean} mbMode - If true, use binary conversion (1024), otherwise standard (1000).
     * @return {number} - The converted size in the target unit or 0 for invalid input.
     * @since 1.0.0
     */
    convertSize: function (input, outputFormat = "B", mbMode = false, max = null) {
        const EXP = { "": 0, K: 1, M: 2, G: 3, T: 4, P: 5, E: 6 };

        const toStr = (v) => (typeof v === "number" ? `${v}B` : String(v)).trim();

        // Matches: 123, 123.45 + optional prefix + optional 'i' + 'B'
        // Examples: 4GiB, 512MB, 1024B, 1tb, 2PiB
        const sizePattern = /^\s*(\d+(?:\.\d+)?)\s*([KMGTPE]?)(I)?B\s*$/i;

        const inputStr = toStr(input);
        const im = inputStr.match(sizePattern);
        if (!im) return 0;

        const value = parseFloat(im[1]);
        const inPrefix = (im[2] || "").toUpperCase(); // K, M, G, ...
        const inBinary = !!im[3];                      // presence of 'i'
        const inExp = EXP[inPrefix] ?? 0;

        const bytes = value * Math.pow(inBinary ? 1024 : 1000, inExp);

        if (typeof max === "number")
            return Math.min(bytes, max);

        const outStr = String(outputFormat).trim().toUpperCase();
        const om = outStr.match(/^([KMGTPE]?)(I)?B$/);
        if (!om) return 0;

        const outPrefix = (om[1] || "").toUpperCase();
        const outBinary = om[2] ? true : mbMode; // if user explicitly gave KiB/MiB/... prefer that
        const outExp = EXP[outPrefix] ?? 0;

        const denom = Math.pow(outBinary ? 1024 : 1000, outExp);
        return bytes / denom || 0;
    },
    /**
     * Converts a size in bytes to the largest possible unit.
     * @param {number} bytes - The size in bytes.
     * @param {boolean} binaryMode - Whether to use binary mode (1024) or decimal mode (1000).
     * @param {null|number} decimals - The number of decimals, pass null to switch between 2 and 0 decimals
     *     automatically
     * @param {string} spacer - The spacer between output size and unit. Default is space " "
     * @return {string} - The size with the largest possible unit (e.g., "1KB", "1MiB").
     * @since 1.0.0
     */
    formatBytes: (bytes, binaryMode = false, decimals=2, spacer=" ") => {

        // Negative bytes?
        if (bytes < 0)
            return "N/A";

        // Set the base
        const base = binaryMode ? 1024 : 1000;

        // Set the units based on the size base
        const units = binaryMode
            ? ["B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB"]
            : ["B", "KB", "MB", "GB", "TB", "PB", "EB"];


        let unitIndex = 0;

        // As long as 'bytes' is dividable by the base and there are more units to check for
        while (bytes >= base && unitIndex < units.length - 1) {
            bytes /= base;
            unitIndex++;
        }

        const format = `${bytes.toFixed(decimals)}${spacer}${units[unitIndex]}`;

        return decimals === null ? format.replace(".00", "") : format;

    },
    /**
     * Estimate the size of an object
     * @param {any} object - Any type of primitive data
     * @return {number}
     * @since 1.0.0
     */
    roughSizeOf: object => {
        const data = msgpack.encode(object);
        return data.length;
    },
    /**
     * Zerofill a number
     * @param {number|string} number - Input number
     * @return {string} - Zero filled number, e.g: "01", "09", "00"
     * @since 1.0.0
     */
    zeroFill: number => {
        let num = parseInt(number);
        if(isNaN(num))
            return "00";
        return num <= 9 ? "0" + num : `${num}`;
    },
    /**
     * Inject a string into another
     * @param {string} str - Input string
     * @param {number} offset - Position to inject, pass a negative number to start from the end.
     * @param {string} text - String you want to inject
     * @param {number} removeCount - The number of characters you want to remove after the injected string.
     * @return {string}
     * @since 1.0.0
     */
    inject: (str, offset, text, removeCount = 0) => {
        let calculatedOffset = offset < 0 ? str.length + offset : offset;
        return str.substring(0, calculatedOffset) + text + str.substring(calculatedOffset + removeCount);
    },
    /**
     * Make a `SHA-256` hash from any type of data
     * @param {any} data - The data you want to hash
     * @param {null|true|BinaryToTextEncoding} digest - Calculates the digest of all the data passed to be hashed.
     * If `encoding` is provided a string will be returned; otherwise a `Buffer` is returned.
     * Pass null to get `Hash` instance, true to get Buffer, other `BinaryToTextEncoding` values to get string hash.
     * @return {string|Buffer|Hash} - SHA-256 hash
     * @since 1.0.0
     */
    sha256: (data, digest=null) => {
        const hash = createHash("sha256").update(Snowflake.toBuffer(data));
        if(digest === true)
            return hash.digest();
        return digest ? hash.digest(digest) : hash;
    },
    /**
     * Encode any type of data to buffer
     * @param {any} data
     * @return {Buffer}
     * @since 1.0.0
     */
    toBuffer: data => msgpack.encode(data),
    /**
     * Decode a buffer created using `Snowflake.toBuffer`
     * @param {Buffer} buffer
     * @return {any}
     * @since 1.0.0
     */
    fromBuffer: buffer => msgpack.decode(buffer),
    /**
     * Get status data by its status code
     * @param {number|string} status_code - Numeric value
     * @return {{success: boolean, id: string}}
     * @since 1.0.0
     */
    getStatus: (status_code) => {
        switch(parseInt(status_code)){
            case -3:
                // Echo mode changed
                return {id: "mode_changed", success: true};
            case -2:
                // After authorization completed
                return {id: "authorized", success: true};
            case -1:
                // Asking for access token
                return {id: "not_authorized", success: true};
            case 0:
                // Default state
                return {id: "response", success: true};
            case 1:
                // Connection timed out
                return {id: "timeout", success: false};
            case 2:
                // Asking for access token again / the given access token was invalid / Session expired
                return {id: "authorize_again", success: false};
            case 3:
                // Command doesn't exist / currently isn't available
                return {id: "command_not_found", success: false};
            case 4:
                // Command wasn't executed correctly / parameters missing
                return {id: "command_mismatch", success: false};
            case 5:
                // An unexpected error has occurred
                return {id: "unexpected_error", success: false};
            case 6:
                // Key value doesn't exist
                return {id: "key_not_exist", success: false};
            case 7:
                // Exit signal
                return {id: "exit", success: true};
            case 8:
                // Cannot authorize or join the room because it's full
                return {id: "full_room", success: false};
            case 9:
                // Input size limit exceeded
                return {id: "size_limit", success: false};
            default:
                // Unknown state
                return {id: "unknown", success: false};
        }
    },
    /**
     * Convert seconds to clock time
     * @param {number|string} seconds - The number of seconds passed
     * @param {string} sp - Clock separator, default is ":"
     * @return {string}
     * @since 1.0.0
     */
    secondsToClockTime: (seconds, sp = ":") => {
        seconds = parseInt(seconds);
        const mins = Math.floor(seconds / 60),
            secs = seconds % 60,
            paddedMins = String(mins).padStart(2, '0'),
            paddedSecs = String(secs).padStart(2, '0');
        return `${paddedMins}${sp}${paddedSecs}`;
    },
    /**
     * Resolve relative paths based on current working directory and normalize absolute paths.
     * @param {string} input_path - Relative (e.g: "dir", "./dir", "../dir") or absolute (e.g: "/var/log") path
     * @param {string|null} base_path - Working directory, or pass null to use current's
     * @return {string} - Normalized path
     * @since 1.0.0
     */
    resolvePath: (input_path, base_path = null) => {
        if(path.isAbsolute(input_path))
            return path.normalize(input_path);
        if(base_path === null)
            base_path = process.cwd();
        return path.resolve(base_path, input_path);
    },
    /**
     * Generates an array of hash values for a given item using multiple hash functions.
     * You can use this function for Bloom filters.
     * @param {string} item - The item to hash.
     * @param {number} hashCount - The number of hashes you want to make
     * @param {number} size - The size of the hash array
     * @return {number[]} An array of hash values.
     */
    bloomHash: (item, hashCount, size)  => {
        const hashes = [];
        for (let i = 0; i < hashCount; i++) {
            const hash = (item + i).split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % this.size;
            hashes.push(hash);
        }
        return hashes;
    },
    /**
     * Traverse into an object and overwrite its data if needed
     * @param {object} object - Input object
     * @param {function} callback - Callback
     * @return {object}
     * @since 1.0.0
     */
    traverseObject: (object, callback) => {

        let newObject = {};

        for(const key in object){

            // Ensure the property belongs to the object itself, not its prototype chain
            if(Object.prototype.hasOwnProperty.call(object, key)){
                let value = object[key];

                // Apply the callback function to the current key-value pair
                const overwrite = callback(key, value, object);
                if(typeof overwrite !== "undefined")
                    value = overwrite;

                // If the value is an object, not null and not an array
                if(typeof value === "object" && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value)){
                    // Recursively call the function for nested objects
                    newObject[key] =  Snowflake.traverseObject(value, callback);
                }
                else{
                    newObject[key] = value;
                }

            }

        }

        return newObject;

    },
    /**
     * Check if a file has enough permissions to read and write data
     * @param {string} filePath - File path
     * @return {boolean}
     * @since 1.0.0
     */
    canReadWrite: (filePath) => {
        try {
            // Check existence + read + write
            fs.accessSync(filePath, fs.constants.F_OK | fs.constants.R_OK | fs.constants.W_OK);
            return true;
        } catch (err) {
            return false;
        }
    },
    /**
     * Get current timestamp (divided by 1000)
     * @param {boolean} micro_time
     * @return {number}
     * @since 1.0.0
     */
    now: (micro_time=true) => {
        return Math.floor(micro_time ? Date.now() : Date.now() / 1000);
    },
    /**
     * Get the passed time since specified time
     * @param {number} time - Timestamp in microsecond
     * @return {string}
     * @since 1.0.0
     */
    sinceDate: time => {
        if(time === null)
            return "Never";

        const diff = time > 0 ? Math.floor((Date.now() - time) / 1000) : 0;
        if(diff < 0)
            return "Unknown";

        const days = Math.floor(diff / 86400);

        if(days >= 365){
            const year = Math.floor(days / 365);
            return `${year} year${year > 1 ? "s" : ""} ago`;
        }
        else if(days >= 30){
            const month = Math.floor(days / 30);
            return `${month} month${month > 1 ? "s" : ""} ago`;
        }
        else if(days >= 7){
            const weeks = Math.floor(days / 7);
            return `${weeks} week${weeks > 1 ? "s" : ""} ago`;
        }
        else if(days >= 1){
            return `${days} day${days > 1 ? "s" : ""} ago`;
        }
        else if(diff >= 3600){
            const hours = Math.floor(diff / 3600);
            return `${hours} hour${hours > 1 ? "s" : ""} ago`;
        }
        else if(diff >= 60){
            const minutes = Math.floor(diff / 60);
            return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
        }
        else if(diff >= 1){
            return `${diff} second${diff > 1 ? "s" : ""} ago`;
        }
        else{
            return "Now";
        }

    },
    /**
     * Generate random string<br>
     * Key table:
     * - `lower` (Lowercase letters)
     * - `upper` (Uppercase letters)
     * - `letters` (Lowercase and uppercase letters)
     * - `numbers` (Numbers from 0 to 9)
     * - `*` or `all` (Numbers from 0 to 9)
     * - Anything else would use that key as reference key, e.g: `abcABC`
     * @param {number} len - The length of string you want to generate
     * @param {"lower"|"upper"|"letters"|"numbers"|"all"|"*"|string} key - The key you want to make string from, or the
     *     string reference
     * @return {string} - Randomly generated string from the reference
     * @since 1.0.0
     */
    generate: (len, key = "*") => {
        switch(key) {
            case "lower":
                key = "ksmprzgbjcnltofydhiweaqvxu"; // Lowercase
                break;
            case "upper":
                key = "HYBWDXTURCAZPQOMFKGESJLVIN"; // Uppercase
                break;
            case "letters":
                key = "BRxuPvymLbwCKThesXWUtjSNQOgkdrlpqAVMYcfGioznZJHaDIFE"; // Lower and Uppercase
                break;
            case "numbers":
                key = "4765291380"; // Numbers
                break;
            case "*":
            case "all":
                key = "BRxuPvymLbwCKThesXWUtjSNQOgkdrlpqAVMYcfGioznZJHaDIFE4765291380"; // Lowercase, uppercase and numbers
                break;
        }

        let string = '';

        for(let i = 0; i < len; i++)
            string = string + key[Math.floor(Math.random() * key.length)];

        return string;
    },
    /**
     * Validate the token and make access object if the token is valid
     * @param {string} accessToken
     * @return {AccessToken|boolean}
     * @since 1.0.0
     */
    authenticateToken: accessToken => {
        const data = (appConfig.access_keys ?? {})[accessToken] ?? false;
        if(typeof data !== "object")
            return false;
        return new AccessToken(data);
    },
    rangeNumber: (number, min = null, max = null, defaultNumber = null) => {
        let num = parseInt(number);

        if(isNaN(num)) {
            if(defaultNumber !== null)
                return defaultNumber;
            return min === null ? 0 : min;
        }

        if(min !== null)
            num = Math.max(num, min);

        if(max !== null)
            num = Math.min(num, max);

        return num;

    },
    help: {
        "invalid": [
            "1. Your files may be corrupted and they cannot be recovered.",
            "2. You may want to enable recovery option in 'configs.yaml' file.",
            "3. Your files may be encrypted and your encryption key is incorrect.",
            "4. Your files may be for an older (or newer) version of Snowflake, try updating or rolling back for recovery.",
            "5. Try contacting the support for help."
        ]
    },
    /**
     * Header full size (in bytes)
     * @type {Object}
     * @since 1.0.0
     */
    HDR_FULL_SIZE: 32,
    /**
     * Header fields size (in bytes)
     * @type {{DATA: number, VERSION_CODE: number, TIME: number, SIGNATURE: number}}
     * @since 1.0.0
     */
    HDR_SIZE: {
        VERSION_CODE: 2,
        SIGNATURE: 8,
        DATA: 16,
        TIME: 8,
        ENCRYPTION: 1
    },
    /**
     * Header fields position
     * @type {{DATA: number, VERSION_CODE: number, TIME: number, SIGNATURE: number}}
     * @since 1.0.0
     */
    HDR_POS: {
        VERSION_CODE: 0,
        SIGNATURE: 2,
        DATA: 16,
        TIME: 16,
        ENCRYPTION: 24
    },
    /**
     * Database file states
     * @type {{READY: number, NEW: number, FAINT: number}}
     * @since 1.0.0
     */
    FILE_STATES: {
        READY: 0,
        NEW: 1,
        FAINT: 2,
        /**
         * Check if a database file is ready by its state
         * @param {number} state - State number, see `Snowflake.FILE_STATES`
         * @return {boolean}
         * @since 1.0.0
         */
        isReady: state => [Snowflake.FILE_STATES.READY, Snowflake.FILE_STATES.NEW].includes(state)
    },
    /**
     * Dummy flags for comparison
     * @type {{UNDEF: symbol}}
     * @since 1.0.0
     */
    DUMMY: {
        UNDEF: Symbol("SnowflakeUndefined"),
        BREAK: Symbol("SnowflakeBreak")
    }
};

module.exports = Snowflake;