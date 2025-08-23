const fs = require("fs");
const path = require("path");
const Snowflake = require("./Snowflake");

/**
 * @class SnowflakeAol
 * @description Handle append only backup files
 * @since 1.0.0
 */
class SnowflakeAol {

    /**
     * AOL queue waiting to get written to the last backup file.
     * @type {[action: string, key: string, value?: any][]}
     * @since 1.0.0
     */
    #queue = [];

    /**
     * Backup interval in milliseconds.
     * @type {null|number}
     * @since 1.0.0
     */
    #backupInterval = null;

    /**
     * The timeout of the backup operation
     * @type {null|NodeJS.Timeout}
     * @since 1.0.0
     */
    #backupTimeout = null;

    /**
     * The limit for each backup file size.
     * @type {null|number}
     * @since 1.0.0
     */
    fileSizeLimit = null;

    /**
     * Current backup file name, it will be changed when the backup file get removed or exceed the file size limit.
     * @type {null|string}
     * @since 1.0.0
     */
    currentFilename = null;

    /**
     * The write stream of current backup file, it's null when not writing to the backup file.
     * @type {null|fs.WriteStream}
     * @since 1.0.0
     */
    writeStream = null;

    /**
     * Current backup file size, used to track the backup’s size and trigger rotation when it reaches the size limit.
     * @type {number}
     * @since 1.0.0
     */
    fileSize = 0;

    /**
     * File path of the current backup.
     * @type {string}
     * @since 1.0.0
     */
    filePath = "";

    /**
     * Last error of the backup process, or empty string when no error has occurred.
     * @type {string}
     * @since 1.0.0
     */
    lastError = "";

    /**
     * Backup files permission
     * @type {null|string|number}
     * @see fs.chmodSync
     * @since 1.0.0
     */
    filePermission = null;

    /**
     * Whether the instructions changed after the last backup.
     * @type {boolean}
     * @since 1.0.0
     */
    instructionsChanged = false;

    /**
     * Whether to use mega-binary for displaying file sizes.
     * @type {boolean}
     * @since 1.0.0
     */
    mbMode = false;

    /**
     * @param {string} databasePath - Database directory path that backup files will be stored
     * @param {null|string|number} permission - Backup files permission, see `fs.chmodSync` second parameter
     * @param {null|number} maxFileSize - The max allowed file size for backup files, if a file gets to this limit,
     * all remaining backups will be written to another backup file, set it to 0 for no limit
     * @param {null|number} backupInterval - Set the backup interval, pass null to never get a backup automatically
     * @param {boolean} megaBinaryMode - Whether to use mega-binary mode for displaying file sizes
     * @see fs.chmodSync
     * @since 1.0.0
     */
    constructor({ databasePath,permission = null,maxFileSize = null,backupInterval = null,megaBinaryMode = false }) {

        this.path = databasePath;

        if(backupInterval !== null)
            this.#backupInterval = backupInterval;

        if(maxFileSize !== null)
            this.fileSizeLimit = maxFileSize > 0 ? maxFileSize : null;

        if(permission)
            this.filePermission = permission;

        this.mbMode = megaBinaryMode;

    }

    /**
     * Serializes various data types into a string representation for backup instructions.
     *
     * @param {*} input - The input value to be converted. This can be an array, string, object, or a primitive type
     *     (number, boolean, null).
     * @return {string} - A string representation of the input:
     *  - Arrays, strings, and objects are converted to JSON strings.
     *  - For `null`, returns 'N'.
     *  - For `true`, returns 'T'.
     *  - For `false`, returns 'F'.
     *  - Buffers are converted to hex codes (as string)
     *  - Other types are converted using `toString()`.
     *  @since 1.0.0
     */
    static stringify(input) {

        // Encode the single buffer
        if (Buffer.isBuffer(input))
            return "0x" + input.toString("hex");

        // Handle objects
        if (typeof input === "object" && input !== null && !Array.isArray(input)) {

            // Traverse into the object
            const newObject = Snowflake.traverseObject(input, (key, value) => {

                // Mark buffers as string to convert them back to buffer
                if(Buffer.isBuffer(value))
                    return "Buffer#0x" + value.toString("hex");

                // Not a buffer, return itself
                return value;

            });

            // Encode the object using JSON
            return JSON.stringify(newObject);

        }

        // Encode arrays and strings using JSON
        if (Array.isArray(input) || typeof input === "string")
            return JSON.stringify(input);

        // Handle literals
        if (input === null)
            return "N";
        if (input === true)
            return "T";
        if (input === false)
            return "F";

        // Anything else, let them handle the conversion
        return input.toString();

    }

    /**
     * Deserializes a string representation back into its original data type or structured format.
     *
     * @param {string} input - The string input to be parsed.
     * @return {*} - The original data type or structure:
     *  - Returns `null` for 'N' or 'n'.
     *  - Returns `true` for 'T' or 't'.
     *  - Returns `false` for 'F' or 'f'.
     *  - Attempts to parse as JSON, if parsing fails and the input is numeric, converts to `Number`, otherwise returns
     *     as string.
     *  @since 1.0.0
     */
    static parse(input) {
        if (input === "N" || input === "n")
            return null;
        if (input === "T" || input === "t")
            return true;
        if (input === "F" || input === "f")
            return false;

        if (typeof input.startsWith === "function" && input.startsWith("0x"))
            return Buffer.from(input.replace("0x", ""), "hex");

        try {

            const json = JSON.parse(input);

            // If it starts with buffer
            if(input.indexOf("Buffer#0x") === 0){
                return Snowflake.traverseObject(json, (key, value) => {
                    if (typeof value === "string" && value.startsWith("Buffer#0x"))
                        return this.parse(value.replace("Buffer#", ""));
                    return value;
                });
            }

            return json;

        } catch (error) {

            // If JSON.parse fails, treat it as a primitive value
            if (!isNaN(input))
                return Number(input);

            // Return as string if not a number
            return input;

        }
    }

    /**
     * Encodes an object of key-value pairs into a custom format for representation.
     *
     * @param {Object} data - An object representing key-value pairs to be encoded.
     * @param {boolean} getLines - Whether to return the content joined with break lines (\n) or the list of lines
     * @return {string|string[]} - A formatted string where lines represent keys sharing the same value in the format
     *     `key1<key2<...<value`.
     * @since 1.0.0
     */
    static encodeSets(data, getLines = false) {
        const entries = Object.entries(data);
        const encoded = [];
        const valueToKeysMap = new Map();

        entries.forEach(([key, value]) => {
            const stringValue = SnowflakeAol.stringify(value);
            if(!valueToKeysMap.has(stringValue)) {
                valueToKeysMap.set(stringValue, []);
            }
            valueToKeysMap.get(stringValue).push(key);
        });

        valueToKeysMap.forEach((keys, value) => {
            encoded.push(keys.join('<') + '<' + value);
        });

        return getLines ? encoded : encoded.join('\n');
    }

    /**
     * Encode queue list into instructions list
     * @param {[action: string, key: string, value?: any][]} queue - Queue data to be encoded
     * @param {boolean} getLines - Whether to get the lines list or join them as a string with break lines
     * @return {string[]|string}
     * @since 1.0.0
     */
    static encodeQueue(queue, getLines = false){

        let lines = [];

        let addList = {};

        for(let i = 0; i < queue.length; i++){

            const item = queue[i];
            const isLastOne = i === queue.length-1;

            const action = item[0],
                key = item[1],
                value = item[2] ?? null;

            if(action === "set"){
                addList[key] = value;
            }

            if(isLastOne || action !== "set"){
                if(Object.keys(addList).length){
                    lines = [...lines, ...this.encodeSets(addList, true)];
                    addList = {};
                }
            }

            if(action === "remove")
                lines.push(this.encodeRemoval([key]));

        }

        return getLines ? lines : lines.join("\n");

    }

    /**
     * Encodes a list of keys into a removal instruction format.
     *
     * @param {string[]} keys - An array of keys (strings) to be encoded as removal instructions.
     * @return {string} - A formatted string with each key prefixed by `#` representing removal operations, separated
     *     by new lines.
     * @since 1.0.0
     */
    static encodeRemoval(keys) {
        return keys.map(key => `#${key}`).join('\n');
    }

    /**
     * Parses a string of mixed set and remove instructions into an ordered array of operations.
     *
     * @param {string} input - A string containing lines of instructions, which may include set operations (using `<`)
     *     and remove operations (prefixed with `#`).
     * @return {Array} - An array of instructions:
     *  - Each `set` operation is stored as an array with `"set"` followed by an object mapping keys to their common
     *     value.
     *  - Each `remove` operation is stored as an array with `"remove"` followed by an array of keys to be removed.
     *  @since 1.0.0
     */
    static parseInstructions(input) {
        const lines = input.split('\n').map(line => line.trim()).filter(line => line !== '');
        const instructions = [];

        lines.forEach(line => {

            // Ignore comments and empty lines
            if (line.startsWith(';'))
                return;

            if (line.startsWith('#')) {
                // Remove instruction, handle multiple removals in a single line
                const keysToRemove = line.split(' ').filter(Boolean).map(key => key.slice(1));
                instructions.push("remove", keysToRemove);
            }
            else {
                // Set instruction
                const parts = line.split('<');
                const value = SnowflakeAol.parse(parts.pop());
                const currentSet = {};

                parts.forEach(key => currentSet[key] = value);

                instructions.push("set", currentSet);
            }

        });

        return instructions;
    }

    /**
     * Add a new entry to the AOL list
     * @param {string} key
     * @param {any} value
     * @return {SnowflakeAol}
     * @since 1.0.0
     */
    add(key, value) {
        this.#queue.push(["set", key, value]);
        this.instructionsChanged = true;
        return this;
    }

    /**
     * Add remove instruction to the queue
     * @param {string} key
     * @return {SnowflakeAol}
     * @since 1.0.0
     */
    remove(key) {
        this.#queue.push(["remove", key]);
        this.instructionsChanged = true;
        return this;
    }

    /**
     * Remove an existing backup file
     * @param {string} backupFile - Backup file name (not full path)
     * @since 1.0.0
     */
    removeFile(backupFile){
        fs.unlinkSync(path.join(this.path, backupFile));
    }

    /**
     * Switch to the next backup file
     * @return {SnowflakeAol} - Current instance for method chaining
     * @since 1.0.0
     */
    rotate() {
        this.currentFilename = Math.floor(Date.now() / 1000) + "." + Math.ceil(Math.random() * 9999) + ".sfb";
        this.writeStream = null;
        return this;
    }

    /**
     * Close any previous write streams and create a new one
     * @param {string} flags - Flags of the write stream
     * @return {Promise<void>}
     * @see fs.createWriteStream
     * @since 1.0.0
     */
    async makeWriteStream(flags) {

        // End previous write stream (if there is one)
        await this.endWriteStream();

        // Get the backup file path
        this.filePath = path.join(this.path, this.currentFilename);

        // Create write stream with specific flags
        this.writeStream = fs.createWriteStream(this.filePath, {flags});

    }

    /**
     * Close any existing write stream for backup file
     * @return {Promise<unknown>}
     * @since 1.0.0
     */
    endWriteStream(){

        return new Promise(resolve => {
            if(this.writeStream && typeof this.writeStream.end === "function") {
                // Finalize (close the write stream)
                this.writeStream.end(resolve);
            }
            else{
                resolve();
            }
        });

    }

    /**
     * Start AOL worker
     * @since 1.0.0
     */
    worker() {
        this.rotate();
        this.#make();

        if (this.currentFilename)
            this.#jobs();
    }

    /**
     * Initialize backup files and generate them
     * @return {SnowflakeAol} - Current instance for method chaining
     * @since 1.0.0
     */
    #make() {
        try {

            // Get current backup file path
            this.filePath = path.join(this.path, this.currentFilename);

            // Create a file descriptor with append mode
            // this.fileDescriptor = fs.openSync(this.filePath, "a");

            // Create the file if it doesn't exist
            if(!fs.existsSync(this.filePath))
                fs.writeFileSync(this.filePath, "");

            // Get the size of current backup file
            this.fileSize = fs.statSync(this.filePath).size;

            // Change the file permissions to desired value in `configs.yaml`
            if (this.filePermission)
                fs.chmodSync(this.filePath, this.filePermission);

        } catch (e) {
            this.lastError = e.toString();
        }
        return this;
    }

    /**
     * Start the worker jobs and schedule them if needed
     * @since 1.0.0
     */
    #jobs() {

        const handleJobs = async () => {

            // Renew the timeout
            const renew = () => this.#backupTimeout = setTimeout(handleJobs, this.#backupInterval)

            // Prevent vain write attempts when no changes are made
            // Skip empty queue
            if (!this.instructionsChanged || !Object.keys(this.#queue).length) {
                renew();
                return;
            }

            // Keep queue before clearing it
            const queue = this.#queue;

            // Clear queue to prevent new changes while writing the file
            this.#queue = [];

            // Data to write
            const lines = SnowflakeAol.encodeQueue(queue, true);

            const limit = Snowflake.formatBytes(this.fileSizeLimit, this.mbMode, this.fileSizeLimit > 1000 ? 2 : 0);

            await this.makeWriteStream("a");

            let blockSize = this.fileSize;

            for (let line of lines) {

                if (this.writeStream) {

                    blockSize += line.length + 1; // Line size + break line

                    if (this.fileSizeLimit > 0 && blockSize > this.fileSizeLimit) {
                        const written = Snowflake.formatBytes(blockSize, this.mbMode, blockSize > 1000 ? 2 : 0);
                        console.log(`\x1b[38;5;220m[BACKUP] Backup file size limit (${limit}) exceeded, rotating to the next file. ${written} was written to the file.\x1b[0m`);
                        this.rotate();
                        this.#make();
                        await this.makeWriteStream("a");
                        blockSize = this.fileSize;
                    }

                    const canWrite = this.writeStream.write(line + "\n");

                    if (!canWrite) {

                        await new Promise(resolve => {
                            const drained = () => {
                                this.writeStream.off("drain", drained);
                                resolve();
                            };
                            this.writeStream.on("drain", drained);
                        });

                    }

                }

            }

            this.endWriteStream().then(() => renew());

        }

        this.#backupTimeout = setTimeout(handleJobs, this.#backupInterval);

    }

}

module.exports = SnowflakeAol;