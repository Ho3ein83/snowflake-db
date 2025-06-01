const { createHash } = require('node:crypto');
const msgpack = require("msgpack-lite");

require("./SnowflakeExtend");
const path = require("path");

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
     * The absolute path of core directory
     * @type string
     * @since 1.0.0
     */
    core_path: "",
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
    /**
     * Converts a size from one unit to another.
     * @param {string} input - The input size with unit (e.g., "1MB").
     * @param {string} outputFormat - The target size unit (e.g., "KB").
     * @param {boolean} mbMode - If true, use binary conversion (1024), otherwise standard (1000).
     * @returns {number} - The converted size in the target unit or 0 for invalid input.
     * @since 1.0.0
     */
    convertSize: function (input, outputFormat, mbMode = false) {
        const mode = mbMode ? "binary" : "standard";
        const conversionFactors = {
            standard: {
                B: 1,
                    KB: 1000,
                    MB: 1000 ** 2,
                    GB: 1000 ** 3,
            },
            binary: {
                B: 1,
                    KB: 1024,
                    MB: 1024 ** 2,
                    GB: 1024 ** 3,
            }
        }

        input = typeof input === "number" ? `${input}B` : input.toString();

        const sizePattern = /^(\d+(\.\d+)?)\s*(B|KB|MB|GB)$/i;
        const match = input.match(sizePattern);
        if (!match)
            return 0;

        const [_, sizeValue, , inputUnit] = match;
        const size = parseFloat(sizeValue);
        const inputUnitUpper = inputUnit.toUpperCase();
        const outputFormatUpper = outputFormat.toUpperCase();

        if (!conversionFactors[mode][inputUnitUpper] || !conversionFactors[mode][outputFormatUpper])
            return 0;

        const sizeInBytes = size * conversionFactors[mode][inputUnitUpper];
        return sizeInBytes / conversionFactors[mode][outputFormatUpper] || 0;
    },
    /**
     * Converts a size in bytes to the largest possible unit.
     * @param {number} bytes - The size in bytes.
     * @param {boolean} binaryMode - Whether to use binary mode (1024) or decimal mode (1000).
     * @param {number} decimals - The number of decimals
     * @param {string} spacer - The spacer between output size and unit. Default is space " "
     * @returns {string} - The size with the largest possible unit (e.g., "1KB", "1MiB").
     * @since 1.0.0
     */
    formatBytes: (bytes, binaryMode = false, decimals=2, spacer=" ") => {
        if (bytes < 0)
            return "N/A";

        const base = binaryMode ? 1024 : 1000;
        const units = binaryMode
            ? ["B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB"]
            : ["B", "KB", "MB", "GB", "TB", "PB", "EB"];

        let unitIndex = 0;

        while (bytes >= base && unitIndex < units.length - 1) {
            bytes /= base;
            unitIndex++;
        }

        return `${bytes.toFixed(decimals)}${spacer}${units[unitIndex]}`;
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
     * @returns {number[]} An array of hash values.
     */
    bloomHash: (item, hashCount, size)  => {
        const hashes = [];
        for (let i = 0; i < hashCount; i++) {
            const hash = (item + i).split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % this.size;
            hashes.push(hash);
        }
        return hashes;
    },
    now: (micro_time=true) => {
        return Math.floor(micro_time ? Date.now() : Date.now() / 1000);
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
     * @param {string} key - The key you want to make string from, or the string reference
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
    HDR_FULL_SIZE: 256,
    /**
     * Header fields size (in bytes)
     * @type {{DATA: number, VERSION_CODE: number, TIME: number, SIGNATURE: number}}
     * @since 1.0.0
     */
    HDR_SIZE: {
        VERSION_CODE: 2,
        SIGNATURE: 8,
        DATA: 128,
        TIME: 8
    },
    /**
     * Header fields position
     * @type {{DATA: number, VERSION_CODE: number, TIME: number, SIGNATURE: number}}
     * @since 1.0.0
     */
    HDR_POS: {
        VERSION_CODE: 0,
        SIGNATURE: 2,
        DATA: 128,
        TIME: 128,
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
        UNDEF: Symbol("SnowflakeUndefined")
    }
};

module.exports = Snowflake;