const fs = require("fs");
const Snowflake = require("./Snowflake");
const crypto = require("crypto");
const snowflakeEvents = require("./SnowflakeEvents");
const path = require("node:path");

const HEADER_LENGTH = 32;
const KEY_LENGTH = 32;
const TOTAL_LENGTH = HEADER_LENGTH + KEY_LENGTH;

const MAGIC_BYTES = Buffer.from([0x00, 0x01, 0x02]);
const ALGORITHMS = ["AES-256-CTR"];
const DEFAULT_ALGORITHM = 0;

class SnowflakeCypher {

    /**
     * Cypher key file path, you can change it in `configs.yaml` file from `meids.encryption_cypher` property.
     * The cypher key default file format is `.sfx`.
     * @type {null|string}
     * @since 1.0.0
     */
    #cypherPath = null;

    /**
     * The cypher key buffer used later for encryption / decryption
     * @type {null|Buffer}
     * @since 1.0.0
     */
    #cypherKey = null;

    /**
     * Salt value for more secure encryption
     * @type {null|string}
     * @since 1.0.0
     */
    #cypherSalt = null;

    /**
     * Selected cypher algorithm, it can be in range of `ALGORITHM` list
     * @type {number}
     * @since 1.0.0
     */
    #cypherAlgorithm = 0;

    /**
     * Information about current version of the encryption system
     * @type {Readonly<{version: number, signature: *|Buffer<ArrayBuffer>}>}
     * @since 1.0.0
     */
    #options = Object.freeze({
        version: 1,
        signature: Buffer.from("9de0e69e"),
    });

    constructor(cypherPath) {

        this.#cypherPath = cypherPath;

        this.#cypherSalt = Snowflake.config.encryption_salt;

    }

    /**
     * Initialize the key and algorithm
     * @since 1.0.0
     */
    init() {

        const errors = this.makeCypherKeyFromFile(this.#cypherPath);

        if(errors !== true) {

            const help = `Check theses for fix:\n- You can delete the key file from %underline%${this.#cypherPath}%no_underline% to regenerate\n` +
                "- If you need your own key, edit the key file as text and place your key in it.\n" +
                "- Make sure the key is at least 32 characters long when editing as text";

            Snowflake.logger.assert(errors + "\n" + help, 1, "ENCRYPT", "cypher");

        }

        // [SnowflakeEventEmit]: cypher_initialized
        snowflakeEvents.emit("cypher_initialized");

    }

    /**
     * Create a binary file for desired key
     * @param {string} filePath - The file path of the key file
     * @return {boolean}
     * @since 1.0.0
     */
    #createCypherKeyBinary(filePath) {

        const buffer = Buffer.alloc(TOTAL_LENGTH);

        // 1-3 bytes magic bytes
        MAGIC_BYTES.copy(buffer, 0);

        // 4-11 bytes signature (8 bytes)
        Buffer.from(this.#options.signature).copy(buffer, 3);

        // 12-15 bytes algorithm number (4 bytes)
        const algoBuffer = Buffer.alloc(4);
        algoBuffer.writeUint16BE(DEFAULT_ALGORITHM);
        algoBuffer.copy(buffer, 11);

        // 16-32 bytes zero padding (remaining of header)
        // Already zeroed by Buffer.alloc

        // Generate key (32 bytes)
        const keyString = Snowflake.generate(KEY_LENGTH, "all");
        const keyBuffer = Buffer.from(keyString, "utf8");
        keyBuffer.copy(buffer, HEADER_LENGTH);

        // Create directories recursively
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });

        // Write buffer to file
        fs.writeFileSync(filePath, buffer);
        Snowflake.logger.log("%green%[ENCRYPT] Cypher key file generated.", null, "cypher");

        return true;
    }

    /**
     * Check if there is any error in key file
     * @param {Buffer} buffer - The content of the key file
     * @return {boolean|string} - True if no errors exists, error message string on error
     * @since 1.0.0
     */
    #checkBinaryFileErrors(buffer) {

        // The key file must exactly contain 64 bytes
        if (buffer.length !== TOTAL_LENGTH)
            return `Cypher key file size is not ${TOTAL_LENGTH} bytes.`;

        // Check magic bytes
        if (!buffer.subarray(0, 3).equals(MAGIC_BYTES))
            return "Magic bytes do not match.";

        // Check signature
        if (!buffer.subarray(3, 11).equals(this.#options.signature))
            return "Signature mismatch.";

        // Algorithm bytes (4 bytes)
        // Could validate or just read for now
        const algoNum = buffer.readUInt32BE(11);
        if (algoNum < 0 || algoNum > ALGORITHMS.length)
            return "The algorithm inside the cypher key is invalid or not available.";

        this.#cypherAlgorithm = algoNum;
        if (Snowflake.isDevelopment)
            Snowflake.logger.log(`%magenta%[ENCRYPT] Using ${ALGORITHMS[algoNum]} algorithm for encryption`, null, "cypher");

        // Check key length (should be 32 bytes)
        const key = buffer.subarray(HEADER_LENGTH, HEADER_LENGTH + KEY_LENGTH);
        if (key.length !== KEY_LENGTH)
            return "Key length is not 32 bytes.";

        // Valid binary file
        return true;
    }

    /**
     * Auto generate a key file if it doesn't exist or validate the existing one
     * @param {string} filePath - Target path to the key file
     * @return {boolean|boolean|string|void}
     * @since 1.0.0
     */
    makeCypherKeyFromFile(filePath) {

        // Create a new binary file with a random key
        if (!fs.existsSync(filePath))
            this.#createCypherKeyBinary(filePath);

        // File exists, read content
        const content = fs.readFileSync(filePath);

        // Check if binary or string by first 3 bytes
        if (content.length >= 3 && content[0] === 0x00 && content[1] === 0x01 && content[2] === 0x02) {

            // Validate the binary file
            let errors = this.#checkBinaryFileErrors(content);
            if (errors !== true)
                return errors;

            Snowflake.logger.log("%green%[ENCRYPT] Cypher key binary file validated.", null, "cypher");

            // Extract the key
            this.#cypherKey = content.subarray(HEADER_LENGTH, TOTAL_LENGTH);

        }
        else {

            // Treat it as a string file
            const textContent = content.toString("utf8").trim();
            if (textContent.length < KEY_LENGTH)
                return `Text file content is less than ${KEY_LENGTH} characters.`;

            Snowflake.logger.log("%green%[ENCRYPT] Cypher key text file validated.", null, "cypher");

            // Generate binary file with first 32 bytes of the string as key
            const keyString = textContent.slice(0, KEY_LENGTH);

            // Create binary buffer with this key
            const buffer = Buffer.alloc(TOTAL_LENGTH);

            // Magic bytes
            MAGIC_BYTES.copy(buffer, 0);

            // Signature
            Buffer.from(this.#options.signature).copy(buffer, 3);

            // Algorithm number (4 bytes) - you write 2 bytes currently, fix to 4 bytes for consistency
            const algoBuffer = Buffer.alloc(4);
            algoBuffer.writeUInt32BE(DEFAULT_ALGORITHM);
            algoBuffer.copy(buffer, 11);

            // Copy the key (32 bytes)
            Buffer.from(keyString, "utf8").copy(buffer, HEADER_LENGTH);

            // Overwrite file with binary content
            fs.writeFileSync(filePath, buffer);
            Snowflake.logger.log("%blue%[ENCRYPT] Converted text file to binary cypher key file.", null, "cypher");

            this.#cypherKey = Buffer.from(keyString);
        }

        return true;
    }

    /**
     * Get encryption algorithm that is being used
     * @return {string} Encryption algorithm
     * @since 1.0.0
     */
    getAlgorithm(){
        if(typeof ALGORITHMS[this.#cypherAlgorithm] === "string")
            return ALGORITHMS[this.#cypherAlgorithm];
        return ALGORITHMS[0];
    }

    /**
     * Get the vector for encryption based on entry offset, it adds another layer of security as you need to know the
     * exact position of each entry to decrypt
     * @param {number} offset - Offset of the entry in database file
     * @return {Buffer} Vector buffer
     * @since 1.0.0
     */
    #getIv(offset){
        const buf = Buffer.allocUnsafe(8);
        buf.writeBigUInt64BE(BigInt(offset), 0);
        return crypto.createHmac("sha256", this.#cypherSalt).update(buf).digest().subarray(0, 16);
    }

    /**
     * Encrypt data using the chosen algorithm
     * @param {BinaryLike} data - Entry data
     * @param {number} offset - Entry position in the database
     * @return {Buffer} Encrypted block for data
     * @since 1.0.0
     */
    encrypt(data, offset){
        const iv = this.#getIv(offset);
        const cipher = crypto.createCipheriv(this.getAlgorithm().toLowerCase(), this.#cypherKey, iv);
        return Buffer.concat([cipher.update(data), cipher.final()]);
    }

    /**
     * Decrypt data using the chosen algorithm
     * @param {NodeJS.ArrayBufferView} data - Entry data buffer
     * @param {number} offset - Entry position in the database
     * @return {Buffer} Decrypted block for data
     * @since 1.0.0
     */
    decrypt(data, offset){
        const iv = this.#getIv(offset);
        const decipher = crypto.createDecipheriv(this.getAlgorithm().toLowerCase(), this.#cypherKey, iv);
        return Buffer.concat([decipher.update(data), decipher.final()]);
    }

}

module.exports = SnowflakeCypher;