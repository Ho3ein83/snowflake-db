const Snowflake = require("./Snowflake");
const snowflakeEvents = require("./SnowflakeEvents");
const path = require("path");
const fs = require("fs");
const { Worker } = require("worker_threads");
// const appConfig = require("../../app.json");
const util = require("util");

/**
 * @class SnowflakeCore
 * @description The main core class for Snowflake
 * @since 1.0.0
 */
class SnowflakeCore {

    /**
     * Database path
     * @type {string}
     * @since 1.0.0
     */
    #dbPath = "";

    /**
     * Whether to encrypt database files
     * @type {boolean}
     * @since 1.0.0
     */
    #dbEncrypt = false;

    /**
     * Whether to recover / decrypt the encrypted databases or not
     * @type {boolean}
     * @since 1.0.0
     */
    #dbRecover = false;

    /**
     * Memory monitor status (enabled / disabled)
     * @type {boolean}
     * @since 1.0.0
     */
    #memoryMonitor = false;

    /**
     * Max memory allowed for this app
     * @type {null|number}
     * @since 1.0.0
     */
    #maxMemory = null;

    /**
     * Current size of the database loaded into memory
     * @type {number}
     * @since 1.0.0
     */
    #memorySize = 0;

    /**
     * Whether to use mega-binary mode or not
     * @type {boolean}
     * @since 1.0.0
     */
    #mbMode = false;

    /**
     * MEID files name
     * @type {Array}
     * @since 1.0.0
     */
    #meids = [];

    /**
     * Key files name
     * @type {Array}
     * @since 1.0.0
     */
    #keys = [];

    /**
     * Backup files name
     * @type {Array}
     * @since 1.0.0
     */
    #backups = [];

    /**
     * Data about existing database files (MEIDs) (e.g. file size, index number and validation data)
     * @type {Object}
     * @since 1.0.0
     */
    #meidsData = {};

    /**
     * Data about existing key files (e.g. file size, index number and validation data)
     * @type {Object}
     * @since 1.0.0
     */
    #keysData = {};

    /**
     * Key lookups for faster data fetching
     * @type {{
     *   key: {
     *     [key: string]: {
     *       name: string,
     *       hash: Buffer,
     *       size: number,
     *       position: number,
     *       length: number,
     *       bytes: number
     *     }
     *   },
     *   trash: [{
     *       index: number,
     *       name: string,
     *       hash: string,
     *       valueLookup?: {
     *           position: number,
     *           size: number
     *       }
     *       keyLookup?: {
     *           position: number,
     *           size: number,
     *           length: number
     *       }
     *   }][],
     *   value: {
     *       [key: string]: any
     *   },
     *   hashMap: {
     *       [hash: string]: string
     *   }
     * }}
     * @since 1.0.0
     */
    #lookup = {
        key: {},
        value: {},
        hashMap: {}, // Faster lookup for keys hash
        trash: [],
        temps: new Set()
    };

    /**
     * Size lookup of the database files.
     * @example
     * const MEID0_SIZE = Snowflake.core.sizeLookup.meids[0];
     * const MEID1_SIZE = Snowflake.core.sizeLookup.meids[1];
     * const KEY0_SIZE = Snowflake.core.sizeLookup.meids[0];
     * const KEY1_SIZE = Snowflake.core.sizeLookup.meids[1];
     * @type {{keys: [sizeInBytes: number], meids: [sizeInBytes: number]}}
     * @since 1.0.0
     */
    #sizeLookup = {
      keys: [],
      meids: []
    };

    /**
     * System cache object
     * @type {Object}}
     * @since 1.0.0
     */
    #cache = {};

    /**
     * Current MEID index, this can be used to find out which data should go in which MEID file/
     * This number is between 0 and the number of available MEIDs.
     * @type {number}
     * @since 1.0.0
     */
    #currentMeid = -1;

    /**
     * The maximum number of active MEIDs.
     * This number is between 1 and the number of available MEIDs.
     * @type {number}
     * @since 1.0.0
     */
    #meidsSize = 1;

    /**
     * Whether the changes were saved in database
     * @type {boolean|null}
     * @since 1.0.0
     */
    #unsaved = null;

    /**
     * The timestamp of last persistent call
     * @type {number}
     * @since 1.0.0
     */
    #lastPersistent = 0;

    /**
     * The timestamp indicating when the database was loaded
     * @type {number}
     * @since 1.0.0
     */
    #lastReload = 0;

    /**
     * The list of available workers
     * @type {{aol: Worker|null}}
     * @since 1.0.0
     */
    #workers = {
        aol: null
    };

    /**
     * Pending requests that are waiting for AOL workers to handle.
     * To prevent memory leakage, requests to AOL worker gets added to the queue and called as soon as possible.
     * @type {Map<string, {resolve: function, reject: function, timeout: NodeJS.Timeout}>}
     * @since 1.0.0
     */
    #pendingAolRequests = new Map();

    /**
     * Snapshot interval
     * @type {NodeJS.Timeout}
     * @since 1.0.0
     */
    #snapshotInterval = null;

    /**
     * Current state of snapshot operation, if a snapshot operation is in progress, it'll be `true`, otherwise `false`.
     * @type {boolean}
     * @since 1.0.0
     */
    #takingSnapshot = false;

    /**
     * Current state of backup restoration operation, if a backup restoration operation is in progress, it'll be
     * `true`, otherwise `false`.
     * @type {boolean}
     * @since 1.0.0
     */
    #restoringBackups = false;

    constructor(){}

    /**
     * Create a 256 bit hash using SHA-256 algorithm
     * @param {string} key - String or the key you want to hash
     * @param {boolean} useCache - Whether to use cache or always calculate the hash, by enabling it, you can reduce
     * your system load.
     * @return {string|Buffer|Hash|*}
     */
    #sha256(key, useCache=true){
        if(useCache && typeof this.#cache[`key_hash_${key}`] !== "undefined") {
            return this.#cache[`key_hash_${key}`];
        }
        const hash = Snowflake.sha256(key, true);
        if(useCache)
            this.#cache[`key_hash_${key}`] = hash;
        return hash;
    }

    /**
     * Set a key lookup data
     * @param {string} key - The key as a string
     * @param {number} meidIndex - The index of the MEID file that contains the data of this key
     * @param {number} size - The size of this key
     * @param {number} position - The position of the key inside the key file
     * @param {Buffer|null} keyHash - The hash of the key, pass null to hash it automatically
     * @return {Buffer} - The hash of the key
     * @since 1.0.0
     */
    #setLookupKey(key, meidIndex, size, position, keyHash=null){

        if(keyHash === null)
            keyHash = this.#sha256(key);

        const hashStr = keyHash.toString("hex");

        // Set the hash
        this.#lookup.hashMap[hashStr] = key;

        this.#lookup.key[key] = {
            meid: meidIndex,
            name: key,
            hash: keyHash,
            hash_str: hashStr,
            size,
            position,
            // 32 (SHA-256 hash size) + 4 (data length size) + size (parsed data length)
            length: 36 + size
        };
        return keyHash;
    }

    /**
     * Change a lookup value
     * @param {string|Buffer} hash - The hash of the target key in string format or a 32-byte buffer
     * @param {*} value - Entry value
     * @param {null|number?} index - Meid file index
     * @param {null|number?} size - Size of the entry
     * @param {null|number?} position - Position of the entry
     * @since 1.0.0
     */
    #setLookupValue(hash, value, index = null, size = null, position = null){

        if(Buffer.isBuffer(hash) && hash.length === 32)
            hash = hash.toString("hex");

        if(typeof hash === "string") {

            let bytes = size + 36;
            if(this.#memoryMonitor){

                if(size <= 0)
                    bytes = Snowflake.roughSizeOf(value) + 36;

                let sizeOffset = bytes;

                if(typeof this.#lookup.value[hash] !== "undefined" && typeof this.#lookup.value[hash].bytes !== "undefined"){
                    const oldSize = this.#lookup.value[hash].bytes;
                    sizeOffset = bytes - oldSize;
                }

                this.#memorySize += sizeOffset;

            }

            // Update the lookup table
            this.#lookup.value[hash] = {
                value, position, size, index, bytes: bytes
            };

        }
    }

    /**
     * Match the first 16 bytes of the headers and check if they both are shares the same signature and they both
     * are the same version.
     * @param {Buffer} buffer - The header buffer you want to validate.
     * @param {Buffer|null} header - The original header you want to match with, pass null to use default header.
     * @return {boolean} - True if both headers shares the same signature (first 16 bytes), false otherwise.
     * @since 1.0.0
     */
    matchHeaders(buffer, header=null){
        // NOTE: This method will be overridden in SnowflakeCoreHelper class
        return true;
    }

    /**
     * Validate all database files header (including MEID and key files)
     * @return {SnowflakeCore}
     * @since 1.0.0
     */
    validateHeaders(){
        Snowflake.logger.log("%blue%Validating headers...", null, "database");

        // Default header is considered a valid header and other files should match this
        const validHeader = this.getHeader();

        let table = [], is_valid = true;

        const checkSignature = Snowflake.yaml.isTrue("meids.check_signature");

        // Iterate every MEID and key file
        for(let [, file_name] of Object.entries([...this.#meids, ...this.#keys])){

            // Read the state of MEID file, 0 means the file is ready, 1 means it was created in the
            // initialization steps (and is ready), 2 means the file is fainted (exists but not used)
            const {state} = this.#meidsData[file_name] || {};

            // Validate the file only if it's not fainted
            if(state !== 2){

                // Generate a new header buffer
                let header = Buffer.alloc(256);

                // Read the header from database file
                let fd = fs.openSync(path.join(this.#dbPath, file_name), "r");
                fs.readSync(fd, header, 0, 256, 0);

                // Track the main problem for more clarity
                let problems = [];

                // Capture time and version fragments from the file header
                const time = header.sfCapture(Snowflake.HDR_POS.TIME, Snowflake.HDR_SIZE.TIME);
                const date = new Date(Number(time.readBigUInt64BE()) * 1000);
                const version = header.sfCapture(Snowflake.HDR_POS.VERSION_CODE, Snowflake.HDR_SIZE.VERSION_CODE);
                const versionNumber = version.readUint16BE();

                // Get valid data from header template
                const validVersion = validHeader.sfCapture(Snowflake.HDR_POS.VERSION_CODE, Snowflake.HDR_SIZE.VERSION_CODE).readUint16BE(),
                    validSignature = validHeader.sfCapture(Snowflake.HDR_POS.SIGNATURE, Snowflake.HDR_SIZE.SIGNATURE);

                // Get the actual data from MEID header
                const signature = header.sfCapture(Snowflake.HDR_POS.SIGNATURE, Snowflake.HDR_SIZE.SIGNATURE);

                // Validate the signature
                if(checkSignature && !signature.equals(validSignature))
                    problems.push(`Database signature (${signature.toString()}) doesn't match the core signature (${validSignature.toString()})`);

                // Check version compatibility
                if(validVersion < versionNumber)
                    problems.push(`Database version (${versionNumber}) is not compatible with this core version (${validVersion})`);

                // If there is no problem, then it's valid
                const valid = problems.length === 0;

                // If one of the database files isn't valid, it won't start the app
                if(!valid && Snowflake.FILE_STATES.isReady(state))
                    is_valid = false;

                // Log file states as a table
                const problemsStr = problems.length ? `\n      • ${problems.join("\n      • ")}` : "";
                table.push({
                    key: file_name,
                    value: (valid ? "Valid" : "Invalid") + ` (v${versionNumber}) - ${date.toUTCString()}` + problemsStr + "%reset%",
                    color: (valid ? "green" : "red")
                });

            }
            else{

                // Log file states as a table
                table.push({
                    key: `%faint%${file_name}`,
                    value: "Skipped%reset%",
                    color: "green"
                });

            }

        }
        Snowflake.logger.table(table, 3, "clear", "-", 3);

        if(!is_valid) {
            Snowflake.logger.log("", null, "database");
            Snowflake.logger.assert("Your database files are invalid, check your configuration file or read the documentation for more details.\n" + Snowflake.help.invalid.join("\n"), 1, false, "_database");
        }
        return this;
    }

    /**
     * Get database files (MEIDs and keys)
     * @return {{meidFiles: array, keyFiles: array, backupFiles: array}}
     * @since 1.0.0
     */
    getDatabaseFiles(){
        let meidFiles = [], keyFiles = [], backupFiles = [];

        // MEIDs file format is .sfd and keys file format is .sfk
        // const file_pattern = new RegExp(/^(key|meid)-\d+\.(sfd|sfk)$/);
        const filePattern = new RegExp(/^(meid-\d+\.sfd|key-\d+\.sfk|(\d+\.\d+\.sfb))$/);

        // Iterate every file in the database directory
        for(let fileName of fs.readdirSync(this.#dbPath)){
            // If the file is either a key file or a MEID
            if(filePattern.test(fileName)) {
                if(fileName.startsWith("meid-"))
                    meidFiles.push(fileName);
                else if(fileName.startsWith("key-"))
                    keyFiles.push(fileName);
                else
                    backupFiles.push(fileName);
            }
        }
        return { meidFiles, keyFiles, backupFiles };
    }

    /**
     * Get database file absolute path
     * @param {string} filename
     * @return {string}
     * @since 1.0.0
     */
    getFilePath(filename){
        return path.join(this.#dbPath, filename);
    }

    /**
     * Load a single key or database file into memory
     * @param {string} filePath - The file path of the key or MEID file
     * @param {boolean} isMeid - Whether the file is a database (MEID) file or a key file
     * @return number - The size of the buffer that was loaded into memory
     * @since 1.0.0
     */
    loadDatabaseFile(filePath, isMeid){

        const index = parseInt(path.basename(filePath).replace("meid-", "").replace("key-", ""));

        const timerId = Snowflake.logger.timeStart();
        const buffer = fs.readFileSync(filePath);
        Snowflake.logger.benchmark("--- Read " + (isMeid ? `meid-${index}.sfd` : `key-${index}.sfk`) + " file", timerId);

        const totalSize = buffer.length;
        // let parsedSize = Number(0);

        // If the file isn't empty (the first 32 bytes are header data)
        if(totalSize >= 32) {

            // Start after the header
            let pos = 32;

            const header = buffer.subarray(0, 32);

            // Check if the file is encrypted
            const isEncrypted = header.subarray(Snowflake.HDR_POS.ENCRYPTION, Snowflake.HDR_POS.ENCRYPTION + Snowflake.HDR_SIZE.ENCRYPTION).readUint8(0) > 0;

            if(isEncrypted && !this.#dbEncrypt){
                Snowflake.logger.assert("Some or all of your database files are encrypted, but encryption is disabled in 'configs.yaml' file.\n" +
                    "To disable encryption you need to set both 'meids.encrypt' and 'meids.recover' to 'true' and then restart the app.");
            }

            if (isMeid) {

                // Iterate each block
                while (pos < buffer.length) {

                    // Start position of the entry
                    const position = pos;

                    // The first 32-byte of the block is the hash
                    const hash = buffer.subarray(pos, pos + 32);
                    pos += 32;

                    // The next 4-byte is key size (in bytes)
                    const size = buffer.subarray(pos, pos + 4).readUInt32BE();
                    pos += 4;

                    // Get the value based on its size
                    let valueBuffer = buffer.subarray(pos, pos + size);

                    // Decrypt data based on the given key and salt
                    if(isEncrypted)
                        valueBuffer = Snowflake.cypher.decrypt(valueBuffer, pos);

                    // Decode the key
                    const value = Snowflake.fromBuffer(valueBuffer);

                    pos += size;

                    // Set the value into lookup table
                    this.#setLookupValue(hash, value, index, size, position);

                }

            }
            else {

                // Iterate each block
                while (pos < buffer.length) {

                    // Start position of the entry
                    const position = pos;

                    // The first 32-byte of the block is the hash
                    const hash = buffer.subarray(pos, pos + 32);
                    pos += 32;

                    // The next 4-byte is key size (in bytes)
                    const size = buffer.subarray(pos, pos + 4).readUInt32BE();
                    pos += 4;

                    // Get the key based on its size
                    let keyBuffer = buffer.subarray(pos, pos + size);

                    // Decrypt data based on the given key and salt
                    if(isEncrypted)
                        keyBuffer = Snowflake.cypher.decrypt(keyBuffer, pos);

                    // Decode the key
                    const key = Snowflake.fromBuffer(keyBuffer);
                    pos += size;

                    // Double-check the hash to check if the key is valid
                    if (Snowflake.sha256(this.sanitizeKey(key), true).compare(hash) === 0) {

                        // Add it to the lookup table
                        this.#setLookupKey(key, index, size, position, hash);

                    }

                }

            }

        }

        return buffer.length;

    }

    /**
     * Unload database from memory and reset to initial states
     * @since 1.0.0
     */
    unloadDatabase(){

        // Clear the lookup table
        this.#lookup = {
            key: {},
            value: {},
            trash: [],
            hashMap: {}
        };

        // Clear the cache table
        this.#cache = {};

        // Clear pending requests that are waiting to stored in backup files
        this.#pendingAolRequests = new Map();

        // Database is truncated, so no persistent has occurred at this point
        this.#lastPersistent = 0;

        // Database is empty, no changes to be saved
        this.#unsaved = false;

        // Reset the memory size
        this.#memorySize = 0;

    }

    /**
     * Reload the database
     * @param {boolean|number} restoreBackups - Whether to restore backup files (false) or skip them (1 or true) or
     *     delete them (2)
     * @since 1.0.0
     */
    reloadDatabase(restoreBackups = true){

        // [SnowflakeEventEmit]: before_database_reload
        snowflakeEvents.emit("before_database_reload");

        // Remove database info from memory first
        this.unloadDatabase();

        // Initialize database and key files and find new backup files
        this.initMeidsAndKeys();

        // Reload the database files
        this.loadDatabase(restoreBackups);

        // [SnowflakeEventEmit]: after_database_reload
        snowflakeEvents.emit("after_database_reload");

    }

    /**
     * Make memory data persistent by dumping the entries from memory to MEID files
     * @returns {Promise<never>}
     * @since 1.0.0
     */
    async persistent(){

        if(this.#takingSnapshot)
            return Promise.reject("Another snapshot is in progress");

        // [SnowflakeEventEmit]: before_snapshot
        snowflakeEvents.emit("before_snapshot");

        this.#takingSnapshot = true;

        let maxMeids = this.meidsCount,
            maxMeidSize = this.maxMeidSize;

        let limitReached = false, maximumReached = false;

        const maxAllowedFileSize = this.filesystemMaxSize;

        const pendingList = new Map(Object.entries(this.#lookup.key).map(([key, value]) => [key, value !== undefined]));

        function setByteSync(filePath, position, value) {
            const fd = fs.openSync(filePath, "r+");
            const buffer = Buffer.from([value]);
            fs.writeSync(fd, buffer, 0, 1, position);
            fs.closeSync(fd);
        }

        let shouldEncrypt = this.#dbEncrypt && !this.#dbRecover;

        for (let i = 0; i < maxMeids + 1; i++) {

            let databaseCursor = 32,
                keyCursor = 32;

            if (limitReached || maximumReached) {

                if(limitReached) {
                    Snowflake.logger.log("%yellow%Warning: data size is bigger than allowed size, " + ((i < maxMeids) ? "skipping to the next database file." : `${pendingList.size} entries were left without saving since there is no other database file.`), null, "_database");
                }
                else if(maximumReached) {
                    Snowflake.logger.log("%yellow%Warning: data size is bigger than allowed files size in your filesystem, " + (i < maxMeids ? "skipping to the next database file." : `${pendingList.size} entries were left without saving since there is no other database file.`), null, "_database");
                }

                limitReached = false;
                maximumReached = false;

                if(i >= maxMeids)
                    break;

                if(maxMeids <= 1)
                    continue;

            }

            if (i >= maxMeids)
                break;

            const databaseFilePath = this.getFilePath(`meid-${i}.sfd`),
                keyFilePath = this.getFilePath(`key-${i}.sfk`);

            // Check the write permissions
            if (!Snowflake.canReadWrite(databaseFilePath)) {
                Snowflake.logger.error(`Data persistence operation failed: the database file (meid-${i}.sfd) is missing or lacks required write permissions.`, false, "_database");
                continue;
            }

            if (!Snowflake.canReadWrite(keyFilePath)) {
                Snowflake.logger.error(`Data persistence operation failed: the database key file (key-${i}.sfk) is missing or lacks required write permissions.`, false, "_database");
                continue;
            }

            // If there are no remaining entry to set, truncate the database file
            if(pendingList.size <= 0){
                this.truncate(i);
                continue;
            }

            // Open write streams starting at offset 32 (to skip header)
            const databaseStream = fs.createWriteStream(databaseFilePath, {flags: 'r+', start: databaseCursor});
            const keyStream = fs.createWriteStream(keyFilePath, {flags: 'r+', start: keyCursor});

            // Track file sizes to prevent exceeding maxMeidSize, starts after the first 32-byte which is the header
            let databaseFileSize = 32;
            let keyFileSize = 32;

            // for (let [key, keyData] of Object.entries(this.#lookup.key)) {

            // Just to estimate the position of the cursor for key and value write streams
            let valuePosition = 32,
                keyPosition = 32

            function waitForDrain(...streams) {
                return new Promise(resolve => {
                    let pending = 0;

                    for (const stream of streams) {
                        if (!stream || !stream.writableNeedDrain) continue;
                        pending++;

                        const onDrain = () => {
                            stream.off("drain", onDrain);
                            if (--pending === 0) resolve();
                        };

                        stream.on("drain", onDrain);
                    }

                    if (pending === 0) resolve();
                });
            }

            for (let [key, keyData] of pendingList) {

                // If this key was removed (when it's undefined) or it's a temporary entry
                if (typeof keyData === "undefined" || this.isInTrash(key) || this.isTemporary(key))
                    continue;

                // Get value of the current key
                const value = this.get(key);

                // Get the hash of the key
                const hash = this.#sha256(key);

                // Make key and data entry buffers
                let dataBuffer = Snowflake.toBuffer(value),
                    keyBuffer = Snowflake.toBuffer(key);

                // Assign 4 bytes for data length
                const dataSize = Buffer.alloc(4),
                    keySize = Buffer.alloc(4);

                // Measure the data and the key size
                dataSize.writeUint32BE(dataBuffer.length);
                keySize.writeUint32BE(keyBuffer.length);

                valuePosition += 36;
                keyPosition += 36;

                // Encrypt the data before writing (if enabled)
                if(shouldEncrypt){
                    dataBuffer = Snowflake.cypher.encrypt(dataBuffer, valuePosition);
                    keyBuffer = Snowflake.cypher.encrypt(keyBuffer, keyPosition);
                }

                // Keep the track of the data position
                valuePosition += dataBuffer.length;
                keyPosition += keyBuffer.length;

                // Generate the chunk and update the file size
                const dataChunk = Buffer.concat([hash, dataSize, dataBuffer]),
                    keyChunk = Buffer.concat([hash, keySize, keyBuffer]);

                // Update the database files size as they go
                databaseFileSize += dataChunk.length;
                keyFileSize += keyChunk.length;

                // If the maximum file size limit exceeded, switch to the next entry
                if (databaseFileSize > maxMeidSize || keyFileSize > maxMeidSize) {
                    limitReached = true;
                    break;
                }

                // If the maximum file size allowed in
                if (databaseFileSize > maxAllowedFileSize || keyFileSize > maxAllowedFileSize) {
                    maximumReached = true;
                    break;
                }

                // Write the data
                const canWriteData = databaseStream.write(dataChunk);
                const canWriteKey = keyStream.write(keyChunk);

                // Update the cursor position
                databaseCursor += dataChunk.length;
                keyCursor += keyChunk.length;

                // Backpressure handling (pauses loop until drain)
                if (!canWriteData || !canWriteKey)
                    await waitForDrain(databaseStream, keyStream);

                pendingList.delete(key);

            }

            // Finalize (close the write stream)
            await Promise.all([
                new Promise(resolve => databaseStream.end(resolve)),
                new Promise(resolve => keyStream.end(resolve))
            ]);

            fs.truncateSync(databaseFilePath, databaseCursor);
            fs.truncateSync(keyFilePath, keyCursor);

            setByteSync(databaseFilePath, Snowflake.HDR_POS.ENCRYPTION, shouldEncrypt ? 0x01 : 0x00);
            setByteSync(keyFilePath, Snowflake.HDR_POS.ENCRYPTION, shouldEncrypt ? 0x01 : 0x00);

            if (limitReached || maximumReached)
                continue;

            // Mark it as saved after everything was saved
            this.#unsaved = false;

            // Change the last persistent call
            this.#lastPersistent = Date.now();

        }

        this.#takingSnapshot = false;

        // [SnowflakeEventEmit]: snapshot
        snowflakeEvents.emit("snapshot");

    }

    /**
     * Take a snapshot, the difference between this and `persistent` method is that by requesting a snapshot you
     * restore backup files and take a snapshot after, but `persistent` only dumps current memory into database files
     * @returns {Promise<unknown>}
     * @since 1.0.0
     */
    async requestSnapshot(){
        try {
            await this.restoreAllBackupFiles();
            return await this.persistent();
        } catch(e){
            return Promise.reject("Snapshot failed");
        }
    }

    /**
     * Retrieve database files size, you can read them later from `this.#sizeLookup.meids`
     * @since 1.0.0
     */
    checkFilesSize(){

        for(let i = 0; i < this.meidsCount; i++){

            const databaseFilePath = this.getFilePath(`meid-${i}.sfd`);
            if(Snowflake.canReadWrite(databaseFilePath)) {
                const {size: databaseFileSize} = fs.statSync(databaseFilePath);
                this.#sizeLookup.meids[i] = databaseFileSize;
            }

            const keyFilePath = this.getFilePath(`key-${i}.sfk`);
            if(Snowflake.canReadWrite(keyFilePath)) {
                const {size: keyFileSize} = fs.statSync(keyFilePath);
                this.#sizeLookup.keys[i] = keyFileSize;
            }

        }

    }

    /**
     * Default method to restore backup files. See `SnowflakeCoreHelper::restoreBackupFile` for the actual instructions.
     * @param {string} backupFilePath - Backup file absolute path
     * @param {boolean} deleteAfter - Whether to delete the backup file after restoration completed
     * @returns {number|boolean} - `true` on success, `false` on failure, `1` if the file was empty
     * @see SnowflakeCoreHelper
     * @since 1.0.0
     */
    restoreBackupFile(backupFilePath, deleteAfter = false){
        return 1;
    }

    /**
     * Default method to restore backup files. See `SnowflakeCoreHelper::restoreAllBackupFiles` for the actual
     * instructions.
     * @returns {Promise<unknown>}
     * @see SnowflakeCoreHelper
     * @since 1.0.0
     */
    restoreAllBackupFiles(){}

    /**
     * Load database keys and data into the memory
     * @param {boolean|number} restoreBackups - Whether to restore backup files (true) or skip them (false) or remove
     *     them (2).
     * @since 1.0.0
     */
    loadDatabase(restoreBackups = true) {

        // [SnowflakeEventEmit]: before_db_load
        snowflakeEvents.emit("before_db_load");

        const start = performance.now();

        Snowflake.logger.log("%cyan%[DATABASE] Loading database files into memory...", null, "database");

        let totalSize = 0;
        for(let [filename, data] of Object.entries({...this.#meidsData, ...this.#keysData})) {
            const { state } = data;
            if (Snowflake.FILE_STATES.isReady(state)) {
                try {
                    Snowflake.logger.benchmarkCode(() => {
                        totalSize += this.loadDatabaseFile(this.getFilePath(filename), filename.startsWith("meid-"));
                    }, `-- ${filename} was loaded`);
                } catch (e){
                    Snowflake.logger.assert(
                        "Could not load your database files, these are a some possibilities:" +
                        "\n   - Your database files are corrupted" +
                        "\n   - Your database files are encrypted and your encryption key doesn't match" +
                        `\n   - Check your encryption key file located in %underline%${Snowflake.yaml.get("meids.encryption_cypher")}%no_underline%` +
                        `\n   - If the key file is missing or corrupted, try creating a new file with the same name and write your encryption key into it and try restarting the app` +
                        `\n Error: ${e}`, 1, false, "_database"
                    );

                }
            }
        }

        this.checkFilesSize();

        this.#lastReload = Date.now();

        // [SnowflakeEventEmit]: db_load
        snowflakeEvents.emit("db_load");

        Snowflake.logger.log(`%green%[DATABASE] ${Snowflake.formatBytes(totalSize, this.mbMode, totalSize > 1000 ? 2 : 0  )} of data was loaded into memory in ${(performance.now() - start).toFixed(2)}ms.`, null, "database");

    }

    /**
     * Initialize database MEID and key files
     * @return {SnowflakeCore}
     * @since 1.0.0
     */
    initMeidsAndKeys() {

        // [SnowflakeEventEmit]: before_meids_init
        snowflakeEvents.emit("before_meids_init");

        Snowflake.logger.log("%blue%Validating database configuration...", null, "database");

        // Scan the database files and store them into necessarily properties
        ({meidFiles: this.#meids, keyFiles: this.#keys, backupFiles: this.#backups} = this.getDatabaseFiles());

        // Load configurations
        let meidsSize = Snowflake.yaml.get("meids.size", "0");

        // The number of MEIDs in use
        let meidsCount = this.meidsCount;

        this.#meidsSize = meidsCount;

        let meids = {}, keys = {},
            meidsName = [], keysName = [],
            allGenerated = true;

        // If you need to change the database files permission, you can change it from configuration file
        const chmod = Snowflake.yaml.get("meids.permission");

        // Default header buffer, whether to check and validate the headers
        let header = null, headerCheck = true;

        // Iterate every MEID (there will be one key file for each database file)
        for(let i = 0; i < meidsCount; i++){

            const meidName = `meid-${i}.sfd`, keyName = `key-${i}.sfk`,
                meidPath = path.join(this.#dbPath, meidName), keyPath = path.join(this.#dbPath, keyName),
                meidExists = fs.existsSync(meidPath), keyExists = fs.existsSync(keyPath);

            // If key file and meid file don't exist, it will give a warning message by marking 'allGenerated' as false
            if(!keyExists || !meidExists)
                allGenerated = false;

            // Get the default header if database files need to be generated, in that case,
            // it won't check the headers as they are fresh and newly generated
            if(!meidExists || !keyExists){
                if(header === null) {
                    header = this.getHeader();
                    headerCheck = false;
                }
            }

            // Generate MEID file and set its permission if it doesn't exist
            if(!meidExists) {
                fs.writeFileSync(meidPath, header);
                if(chmod)
                    fs.chmodSync(meidPath, chmod);
            }

            // Generate key file and set its permission if it doesn't exist
            if(!keyExists) {
                fs.writeFileSync(keyPath, header);
                if(chmod)
                    fs.chmodSync(keyPath, chmod);
            }

            // Set MEID file data
            meids[meidName] = {
                index: i,
                name: meidName,
                exists: meidExists,
                state: meidExists ? Snowflake.FILE_STATES.READY : Snowflake.FILE_STATES.NEW
            }

            // Set key file data
            keys[keyName] = {
                index: i,
                name: keyName,
                exists: keyExists,
                state: meidExists ? Snowflake.FILE_STATES.READY : Snowflake.FILE_STATES.NEW
            }
        }

        // Iterate every MEID and key file
        for(let file of [...this.#meids, ...this.#keys]){

            // Whether the file is MEID or key file
            const isMeid = file.startsWith("meid-");

            // Get the numeric index number for the file
            const index = parseInt(file.replaceAll(/^(meid|key)-/g, ""));

            // If the index number is outside the range (defined in configs.yaml file as 'meids.count')
            if(index > meidsCount-1){

                // Mark the file as faint (by setting its state to Snowflake.FILE_STATES.FAINT)
                const data = {
                    index: index,
                    name: file,
                    exists: true,
                    state: Snowflake.FILE_STATES.FAINT
                }

                // Push file data into the appropriate object
                if(isMeid)
                    meids[file] = data;
                else
                    keys[file] = data;
            }
        }

        // Some files that are not included in memory will be marked as faint files.
        // They will neither be validated nor loaded into memory.
        // For example, if your database directory contains 3 MEID files but you set the MEID count to 1,
        // only the first MEID file will be included, and the other two will be marked as faint.

        let hasFaint = false;

        // Iterate every database file
        for(let [key, value] of Object.entries(Object.assign(meids, keys))){

            // Whether the file is MEID or key file
            const isMeid = key.startsWith("meid-");

            // New files will be marked as warning, unused files as faint, and others will remain unmarked
            const format = ["", "%warning%", "%faint%"][value.state] || "";

            // Push the file name into the appropriate array to report them in logs
            if(isMeid)
                meidsName.push(format + key + "%clear%%green%");
            else
                keysName.push(format + key + "%clear%%green%");

            // If any file has marked as faint, then it'll display a warning in the console or log file
            if(value.state === Snowflake.FILE_STATES.FAINT)
                hasFaint = true;
        }

        // Store MEIDs and keys data into the appropriate object
        this.#meidsData = meids;
        this.#keysData = keys;

        // Backup size limit
        let backupSizeLimit = Snowflake.yaml.get("persistent.backup_size_limit");
        backupSizeLimit = Snowflake.formatBytes(Snowflake.convertSize(backupSizeLimit, "B", this.#mbMode), this.#mbMode);

        let isMegaBinary = meidsSize.toString().endsWith("iB");

        let maxMeidSize = Snowflake.formatBytes(Snowflake.convertSize(meidsSize, "B", isMegaBinary, 4e9), this.#mbMode)

        // Create a table to report the database information
        Snowflake.logger.table([
            {key: "Path", value: `%underline%${this.#dbPath}%reset%`},
            {key: "Version", value: `${Snowflake.meidVersion}`},
            {key: "Encryption", value: `${this.#dbEncrypt ? "Yes" : "No"}`},
            {key: "Max size", value: `${meidsSize === 0 ? "Not limited (4GB)" : maxMeidSize}`},
            {key: "Count", value: `${meidsCount} MEID` + (meidsCount > 1 ? "s" : "")},
            {key: "MEID files", value: meidsName.join("\n%padding%")},
            {key: "Key files", value: keysName.join("\n%padding%")},
            {key: "Persistent", value: Snowflake.yaml.isTrue("persistent.enabled") ? "Enabled" : "Disabled"},
            {key: "Backup size", value: backupSizeLimit},
        ], 3, "green", "-");

        // Faint warning
        if(hasFaint)
            Snowflake.logger.log(`%yellow%   Some database files are not usable because they are out of MEIDs range (meids.count).`, null, "_database");

        // New files generation warning
        if(!allGenerated)
            Snowflake.logger.log(`%warning%   The database files highlighted were created due to their absence.`, null, "_database");

        // Validate headers if needed
        if(headerCheck) {
            Snowflake.logger.log("%clear%", false);
            this.validateHeaders();

            // Faint warning for headers
            if(hasFaint)
                Snowflake.logger.log(`%yellow%   Some database files were fainted, therefor weren't validated`, null, "_database");

        }

        Snowflake.logger.log("", false);

        // [SnowflakeEventEmit]: after_meids_init
        snowflakeEvents.emit("after_meids_init");

        return this;
    }

    /**
     * Initialize database settings and files
     * @return {SnowflakeCore}
     * @since 1.0.0
     */
    init() {

        // [SnowflakeEventEmit]: before_init
        snowflakeEvents.emit("before_core_init");

        // Initialize configs
        this.#dbPath = Snowflake.resolvePath(Snowflake.yaml.get("dir.database"));

        // Make database directory if it doesn't exist
        Snowflake.logger.logln("%cyan%[DATABASE] Initializing database", "database");
        if (!fs.existsSync(this.#dbPath)) {
            Snowflake.logger.log(`%blue%   - Creating database directory`, null, "database");
            fs.mkdirSync(this.#dbPath);
        }

        // [SnowflakeEventEmit]: after_core_init
        snowflakeEvents.emit("after_core_init");

        return this;
    }

    /**
     * Initialize memory monitor. This method will be called only if `memory.monitor` is true in the config file.
     * However, you can call it separately with your own risk
     * @return {SnowflakeCore}
     * @since 1.0.0
     */
    initMemoryMonitor() {

        // [SnowflakeEventEmit]: before_memory_init
        snowflakeEvents.emit("before_memory_init");

        // Initialize values
        this.#memoryMonitor = true;
        this.#maxMemory = Snowflake.convertSize(Snowflake.yaml.get("memory.max_size"), "B", this.#mbMode);

        // [SnowflakeEventEmit]: after_memory_init
        snowflakeEvents.emit("after_memory_init");

        return this;
    }

    /**
     * Initialize AOL worker for taking backups
     * @since 1.0.0
     */
    initAolWorker(){

        if(this.#workers.aol && this.#workers.aol instanceof Worker){

            this.#workers.aol.on("message", response => {
                const requestId = response?.requestId;
                const requestName = response?.requestName;
                if(requestId && this.#pendingAolRequests.has(requestId)){
                    const { resolve, timeout } = this.#pendingAolRequests.get(requestId);
                    clearTimeout(timeout);
                    this.#pendingAolRequests.delete(requestId);
                    resolve(response.data);
                }
                else if(requestName){
                    if(requestName === "persistent") {
                        Snowflake.logger.info("Taking snapshot (requested by worker thread)", false, "snapshot");
                        const startId = Snowflake.logger.timeStart();
                        this.requestSnapshot().then(() => {
                            Snowflake.logger.benchmark("Took snapshot", startId, "snapshot");
                        }).catch(() => {});
                    }
                }
            });

            this.#workers.aol.on("error", error => {
                for (const { reject, timeout } of this.#pendingAolRequests.values()) {
                    clearTimeout(timeout);
                    reject(error);
                }
                this.#pendingAolRequests.clear();
            });

            this.#workers.aol.on("exit", (code) => {
                if (code !== 0) {
                    for (const { reject, timeout } of this.#pendingAolRequests.values()) {
                        clearTimeout(timeout);
                        reject(new Error(`Worker exited with status code ${code}`));
                    }
                    this.#pendingAolRequests.clear();
                }
            });

        }

    }

    /**
     * Start the main core
     * @return {SnowflakeCore}
     * @since 1.0.0
     */
    start() {

        // [SnowflakeEventEmit]: before_core_start
        snowflakeEvents.emit("before_core_start");

        // Initialize values
        this.#mbMode = Snowflake.yaml.isTrue("memory.mb_mode");
        this.#dbEncrypt = Snowflake.yaml.isTrue("meids.encrypt");
        this.#dbRecover = Snowflake.yaml.isTrue("meids.recover");
        this.#memoryMonitor = Snowflake.yaml.isTrue("memory.monitor");

        // Initialize the database
        Snowflake.logger.benchmarkCode(() => {
            this.init().initMeidsAndKeys();
        }, "- Database files validated");

        // [SnowflakeEventEmit]: before_db_read
        snowflakeEvents.emit("before_db_read");

        // [SnowflakeEventEmit]: before_db_workers_init
        snowflakeEvents.emit("before_db_workers_init");

        // Initialize backup worker
        this.#workers.aol = new Worker(Snowflake.resolvePath("workers/worker_aol.js", Snowflake.corePath), {
            workerData: {
                database_path: this.#dbPath,
                permission: Snowflake.yaml.get("meids.permission"),
                maxBackupSize: Snowflake.convertSize(Snowflake.yaml.get("persistent.backup_size_limit", "10MB")),
                backupInterval: Snowflake.yaml.getInt("persistent.backup_interval", 5000),
                megaBinary: Snowflake.yaml.isTrue("memory.mb_mode"),
                snapshotSizeTrigger: Snowflake.yaml.getBytes("persistent.snapshot_size_trigger")
            }
        });

        // Initialize AOL worker event handler
        Snowflake.logger.benchmarkCode(() => {
            this.initAolWorker();
        }, "- Backup worker threads started");

        // [SnowflakeEventEmit]: db_workers_init
        snowflakeEvents.emit("db_workers_init");

        // Handle worker errors
        this.#workers.aol.on("error", msg => {
            Snowflake.logger.log(`%red%worker_aol.js: ${msg}`, null, "_system");

            // If the AOL worker stops working or throws a fatal error, the process must be stopped as the database
            // will lose the ability to take backups and data loss can happen.
            process.exit(1);
        });

        // Load all database content into memory
        Snowflake.logger.benchmarkCode(() => {
            this.loadDatabase();
        }, "- Database keys and data were loaded");

        // If encryption was enabled previously, the data will be decrypted and another snapshot will be taken
        if(this.#dbRecover){
            Snowflake.logger.log("%blue%[DATABASE] Recovering database...", null, "_database");
            this.persistent().then(() => {
                Snowflake.logger.log("%magenta%[DATABASE] Database files were recovered, you should now disable 'meids.recover' by setting it to 'false' in 'configs.yaml' file.", null, "_database");
                process.exit(0);
            });
            return this;

        }

        // [SnowflakeEventEmit]: after_db_read
        snowflakeEvents.emit("after_db_read");

        // Initialize the memory monitor if needed
        if(this.#memoryMonitor)
            this.initMemoryMonitor();

        // Initialize automatic snapshot (if enabled)
        this.#initializeAutomaticSnapshot();

        // [SnowflakeEventEmit]: after_core_start
        snowflakeEvents.emit("after_core_start");

        return this;
    }

    /**
     * Get default header
     * @return {Buffer}
     * @since 1.0.0
     */
    getHeader(){
        // Making a new empty buffer for header, the actual header will be overwritten in 'SnowflakeCoreHelper'
        return Buffer.alloc(32);
    }

    /**
     * Check if an origin is allowed or not
     * @param {string} origin - The origin URL, e.g: "https://example.com"
     * @param {string|null} allowedOrigins - Allowed origins regex, pass null to get it from configuration file.
     * @return {boolean} - True if the origin is allowed, false otherwise
     * @since 1.0.0
     */
    originIsAllowed(origin, allowedOrigins=null) {
        try {

            // Get allowed origins from configuration if needed
            if(allowedOrigins === null)
                allowedOrigins = Snowflake.yaml.get("server.allowed_origins");

            if(!allowedOrigins)
                return false;

            // Check if origin is allowed
            const pattern = new RegExp(allowedOrigins);
            return pattern.test(origin);

        } catch(e){
            Snowflake.logger.error(`Couldn't verify the origin '${origin}', ` + e.toString(), "socket", "server");
            return false;
        }
    }

    /**
     * Sanitize the key. Allowed characters for a key are: `A-Z`, `a-z`, `0-9`, `-` and `_`
     * @param {string} key - Input key
     * @param {boolean} trim - Whether to trim underline (_) from the key
     * @return {string} - Sanitized string of the key
     * @since 1.0.0
     */
    sanitizeKey(key, trim = false){
        key = String(key);
        key = key.replaceAll(/\s/g, "_");
        key = key.replaceAll(/[^a-zA-Z0-9\-_]/g, "");
        if(trim)
            key = key.replace(/^_+|_+$/g, "");
        return key;
    }

    /**
     * Sanitize the value before adding it to memory
     * @param {any} value - Input value to sanitize
     * @return {string|number|boolean|buffer|array|object|null}
     * @since 1.0.0
     */
    sanitizeValue(value){
        if(["string", "boolean", "number", "object"].includes(typeof value))
            return value;
        return null;
    }

    /**
     * Select the next database file to add a new entry.
     * When you add a new entry it starts from `meid-0.sfd` file, the next entry will be added to `meid-1.sfd` and so
     * on. However, if you don't have more than 1 MEID in your configuration, all the entries get added to the first
     * file.
     * @return {number} - The current index of MEID files starting from 0
     * @since 1.0.0
     */
    nextMeid(){
        if(this.#meidsSize <= 1)
            return 0;
        if(++this.#currentMeid >= this.#meidsSize)
            this.#currentMeid = -1
        return Math.max(this.#currentMeid, 0);
    }

    /**
     * Find a key data from lookup table.
     * @param {string} key - The key to search
     * @return {{}|{name: string, hash: Buffer, size: number, position: number, length: number}} - Key data on success,
     * empty object if didn't exist
     * @since 1.0.0
     */
    lookupKey(key){
        return this.#lookup.key[key] || {};
    }

    /**
     * Find a value by its key hash from database
     * @param {string} hash - Hash of the key in string format
     * @return {*|undefined} - The value of the entry (if exists), otherwise `undefined`
     * @since 1.0.0
     */
    lookupValue(hash){
        const value = this.#lookup?.value[hash]?.value;
        if(typeof value === "undefined")
            return undefined;
        return value;
    }

    /**
     * Check if specific key exists in the database or not
     * @param {string} key - The key you want to check
     * @return {boolean} - True if exists, false otherwise
     * @since 1.0.0
     */
    exists(key){
        return this.lookupKey(key).length > 0;
    }

    /**
     * Ask the worker and wait for a response
     * @example
     * const response = Snowflake.core.askWorker("aol", {
     *     action: "set",
     *     key: "key1",
     *     value: "value1"
     * });
     *
     * @param {string} workerName - The name of the worker to send the request to. Must exist in `this.#workers` and
     * be an instance of `Worker`.
     * @param {Object} request - The request payload to send to the worker. A `requestId` will be automatically assigned
     * to this object before sending.
     * @param {number} [timeoutMs=30000] - The maximum time (in milliseconds) to wait for a worker response before
     * rejecting the promise. Default is 30 seconds.
     * @return {Promise<any>|null} A promise that resolves with the worker's response,
     * rejects if the response times out, or returns `null` if the worker does not exist.
     * @since 1.0.0
     */
    askWorker(workerName, request, timeoutMs = 30000) {

        const worker = this.#workers[workerName];
        if (!worker || !(worker instanceof Worker))
            return null;

        // Generate a unique ID
        const requestId = `${Date.now()}-${Math.random()}`;
        request.requestId = requestId;

        return new Promise((resolve, reject) => {

            const timeout = setTimeout(() => {
                this.#pendingAolRequests.delete(requestId);
                reject(new Error("Worker response timed out"));
            }, timeoutMs);

            if(workerName === "aol")
                this.#pendingAolRequests.set(requestId, { resolve, reject, timeout });

            worker.postMessage(request);

        });
    }

    /**
     * Sets a value directly without sanitization or confirmation.
     *
     * **Warning:** Use this method with caution. Unlike `set()`, this method does not sanitize the key
     * or send confirmation request to the backup thread. Data set using this method is stored in memory only and will
     * be lost when the process terminates, unless you explicitly invoke the `persistent` method to save it
     * permanently.
     * **Also, memory monitor will be ignored in this method**
     *
     * @param {string} key - The key of entry you want to change
     * @param {SnowflakeEntryType} value - The value to set, can be a `number`, `string`, `boolean`, `array`, `object`
     *     or a `buffer`
     * @return {number} - Returns `0` on failure, `1` if the value was updated, or `2` if a new entry was inserted.
     * @since 1.0.0
     */
    setUnsafe(key, value){

        if(!key.length)
            return 0;

        const hash = this.#sha256(key);

        if (this.exists(key)) {
            this.#setLookupValue(hash, value);
            return 1;
        }
        else {
            const data = Snowflake.toBuffer(value);
            const index = this.nextMeid();
            this.#setLookupKey(key, index, data.length, -1, hash);
            this.#setLookupValue(hash, value);
            return 2;
        }

    }

    /**
     * Set a value by its key
     * @param {string} key - The key of entry you want to change
     * @param {SnowflakeEntryType} value - The value to set, can be a `number`, `string`, `boolean`, `array`, `object`
     *     or a `buffer`
     * @return {number} - Returns `0` on failure, `1` if the value was updated, or `2` if a new entry was inserted,
     * `-1` when memory limit exceeded or `-2` when the new value is the same as it is now (no change).
     * @since 1.0.0
     */
    set(key, value){

        if(this.#memoryMonitor){
            const bytes = Snowflake.roughSizeOf(value) + 36;
            if(this.#memoryMonitor && this.#maxMemory > 0 && this.#memorySize + bytes > this.#maxMemory)
                return -1;
        }

        const confirm = (k, v) => {

            this.askWorker("aol", {
                action: "set",
                key: k,
                value: v
            }).then(ignore => {}).catch(() => {});

            return true;
        }

        key = this.sanitizeKey(key);

        // No change
        if(this.matchValue(key, value))
            return -2;

        if(key.length) {

            const workerConfirmed = confirm(key, value);

            if(workerConfirmed) {

                // Mark it as unsaved after the change was confirmed
                this.#unsaved = true;

                return this.setUnsafe(key, value);

            }

        }

        return 0;
    }

    /**
     * Sets a value temporarily.
     * When using this method, data will be added to the database temporarily, without getting a backup from the entry.
     * That means, as soon as you restart or terminate the program, your data will be lost. Good for temporarily
     * caching. When you call persistent temporary entries will be ignored (not included in snapshots).
     *
     * @param {string} key - The key of entry you want to change
     * @param {SnowflakeEntryType} value - The value to set, can be a `number`, `string`, `boolean`, `array`, `object`
     *     or a `buffer`
     * @return {number} - Returns `0` on failure, `1` if the value was updated, or `2` if a new entry was inserted.
     * @since 1.0.0
     */
    setTemp(key, value){

        // Memory monitor will be ignored in `setUnsafe` method
        if(this.#memoryMonitor){
            const bytes = Snowflake.roughSizeOf(value) + 36;
            if(this.#memoryMonitor && this.#maxMemory > 0 && this.#memorySize + bytes > this.#maxMemory)
                return -1;
        }

        // `setUnsafe` method won't sanitize keys
        key = this.sanitizeKey(key);

        const status = this.setUnsafe(key, value);

        // Add the key to temporary lookup table if it was newly inserted to the database
        // We can later check a key existence in this table to distinct temporary entries from permanent ones
        if(status === 2)
            this.#lookup.temps.add(key);

        return status;

    }

    /**
     * Check if an entry is strictly equal to a value, it checks both type and logical value, for example if the entry
     * value is "1" as string, and the `compareValue` is 1 as integer, it'll return false.
     * Also list orders matters, for example [1,2,3] isn't the same as [2,3,1] and returns false.
     * @param {string} entryKey - Key of the entry you want to compare
     * @param {any} compareValue - Value to be compared with the entry's
     * @return {boolean}
     * @since 1.0.0
     */
    matchValue(entryKey, compareValue){

        // Check if the entry exists
        if(this.exists(entryKey)) {

            // Get the value of the entry
            const current = this.get(entryKey);

            // Compare current value with the target value
            return util.isDeepStrictEqual(current, compareValue);

        }

        return false;

    }

    /**
     * Get a value from database
     * @param {string} key - The key you want to read from database
     * @param {SnowflakeEntryType} defaultValue - The default value if it didn't exist
     * @return {SnowflakeEntryType} - Can be either `string`, `number`, `boolean`, `object`, `array`, `buffer` or `null`
     * @since 1.0.0
     */
    get(key, defaultValue = null){
        const hash = this.#sha256(key, true);
        const value = this.lookupValue(hash.toString("hex"));
        return value === undefined ? defaultValue : value;
    }

    /**
     * Truncating a specific MEID file (if it's already loaded) with its keys
     * @param {number} index - The index of your database file, starting from `0`.
     * For example to remove `meid-1.sfd` and `meid-1.sfk` files pass `1`.
     * @return {string} - Result message string that you can directly print.
     * @since 1.0.0
     */
    truncate(index){

        if(typeof index !== "number" && isNaN(Number(index)))
            return `🗴 index ${index}: The index must be a number`;

        const meidsCount = this.meidsCount;

        // Check if we are truncating a MEID file in MEID size range (which is already loaded into memory)
        if(index < meidsCount){

            const headerBuffer = this.getHeader();

            // The database files
            const databasePath = this.getFilePath(`meid-${index}.sfd`);
            const keyPath = this.getFilePath(`key-${index}.sfk`);

            if(!Snowflake.canReadWrite(databasePath))
                return `🗴 The database file (meid-${index}.sfd) is missing or lacks required write permissions.`;

            if(!Snowflake.canReadWrite(keyPath))
                return `🗴 The database key file (key-${index}.sfk) is missing or lacks required write permissions.`;

            // Open the file and truncate it immediately
            const databaseDescriptor = fs.openSync(databasePath, "w");
            const keyDescriptor = fs.openSync(keyPath, "w");

            // Write the 32-byte header at offset 0
            fs.writeSync(databaseDescriptor, headerBuffer, 0, headerBuffer.length, 0);
            fs.writeSync(keyDescriptor, headerBuffer, 0, headerBuffer.length, 0);

            // Close the file when done
            fs.closeSync(databaseDescriptor);
            fs.closeSync(keyDescriptor);

            // [SnowflakeEventEmit]: truncate @ number
            snowflakeEvents.emit("truncate", index);

            return `✓ index ${index}: Both database and key files were truncated`;

        }

        if(meidsCount > 1)
            return `🗴 index ${index}: Database index must be between 0 and ${meidsCount-1}`;
        else
            return `🗴 index ${index}: Database index can be only 0 (MEIDs size is 1)`;

    }

    /**
     * Truncating all the loaded MEID files with their keys
     * @return {string[]} - The list of result messages that you can directly print.
     * @since 1.0.0
     */
    truncateAll(){

        let messages = [];

        for(let i = 0; i < this.meidsCount; i++){
            const message = this.truncate(i);
            messages.push(message);
        }

        // [SnowflakeEventEmit]: truncate_all
        snowflakeEvents.emit("truncate_all");

        return messages;

    }

    /**
     * Check if a specific key is in trash or not
     * @param key - Entry key
     * @return boolean - `true` if it's in trash, `false` otherwise
     * @since 1.0.0
     */
    isInTrash(key){
        return this.#lookup.trash.some(item => item.name === key);
    }

    /**
     * Check if a specific key is a temporary entry
     * @param key - Entry key
     * @return boolean - `true` if it's temporary, `false` otherwise
     * @since 1.0.0
     */
    isTemporary(key){
        return this.#lookup.temps.has(key);
    }

    /**
     * List existing entries in memory
     * @param {"pair"|"key"|"value"|"trash"} scope - Which lookup table to look for the data
     * @param {number} limit - The amount of items to lookup, -1 for unlimited
     * @param {number} page - The number of current page (for paginated lists)
     * @param {["all"|"*"|"number"|"boolean"|"bool"|"string"|"object"|"array"|"buffer"|"bin"]} types - Filter out by
     *     type
     * @return {array}
     * @since 1.0.0
     */
    list(scope = "pair", limit = 30, page = 1, types = ["*"]) {

        let list = [];

        const { key, value, trash } = this.#lookup;

        // Slice indexes for pagination
        const startOffset = (page - 1) * limit;
        const endOffset = startOffset + limit;

        if(["pair", "key", "value"].includes(scope)){

            // Key entries for the lookup
            const entries = Object.entries(key);

            for(let [currentKey, ] of entries.slice(startOffset, endOffset)){

                // Entry hash key for value lookup
                const hash = this.#sha256(currentKey, true).toString("hex");

                if(typeof value[hash] !== "undefined") {

                    // Current entry value
                    const currentValue = value[hash];

                    // If type filter was requested
                    if(!types.includes("all") && !types.includes("*")){
                        let type = typeof currentValue;
                        if(type === "object"){
                            if(Array.isArray(currentValue))
                                type = "array";
                            else if(Buffer.isBuffer(currentValue))
                                type = "buffer";
                        }
                        if(type === "boolean") {
                            if(!types.includes("boolean") && !types.includes("bool"))
                                continue;
                        }
                        else if(type === "buffer") {
                            if(!types.includes("buffer") && !types.includes("bin"))
                                continue;
                        }
                        else if(!types.includes(type)) {
                            continue;
                        }
                    }

                    // Add the entry to the list
                    if(scope === "pair")
                        list.push({ [currentKey]: currentValue });
                    else if(scope === "key")
                        list.push(currentKey);
                    else if(scope === "value")
                        list.push(currentValue);

                }

            }

        }
        /*else if(scope === "key"){

            // Key entries for the lookup
            const entries = Object.entries(key);

            for(let [currentKey, ] of entries.slice(startOffset, endOffset)) {

                // Entry hash key for value lookup
                const hash = this.#sha256(currentKey, true).toString("hex");

                // Add the entry to the list
                list.push({ [hash]: currentKey });

            }

        }*/
        else if(scope === "trash"){
            for(let [, currentData] of Object.entries(trash)){
                list.push({ [currentData.hash]: currentData.name });
            }
        }

        return list;
    }

    /**
     * Remove specific entry from database
     * @param {string} key - The key you want to remove
     * @param {boolean} askWorker - Whether to ask worker thread to add the remove instruction to the backup file. If
     * set to false, the entry won't be removed forever and will be restored at the next reload.
     * @return {boolean} - True on success, false on failure
     * @since 1.0.0
     */
    remove(key, askWorker = true){

        // Fast lookup to ignore deletion if the key doesn't exist
        if(!this.exists(key))
            return false;

        const workerConfirmed = k => {
            if(!askWorker)
                return;
            this.askWorker("aol", {
                action: "remove",
                key: k
            }).then(ignore => {}).catch(() => {});
        }

        // Make the key hash for lookup
        const hash = this.#sha256(key).toString("hex");

        // Lookup for the key and data
        const keyLookup = this.#lookup.key[key];
        const meidLookup = this.#lookup.value[hash];

        workerConfirmed(key);

        if(this.#memoryMonitor){
            const bytes = Snowflake.roughSizeOf(meidLookup.value) + 36;
            this.#memorySize = Math.max(this.#memorySize - bytes, 0);
        }

        // Add the key to trash
        this.#lookup.trash.push({
            index: keyLookup.meid,
            name: keyLookup.name,
            hash: keyLookup.hash_str,
            // size: keyLookup.size,
            // position: keyLookup.position,
            // length: keyLookup.length,
            valueLookup: {
                position: meidLookup.position,
                size: meidLookup.size
            },
            keyLookup: {
                position: keyLookup.position,
                size: keyLookup.size,
                length: keyLookup.length
            }
        });

        // Mark the data with its key as undefined (removed)
        this.#lookup.key[key] = undefined;
        this.#lookup.value[hash] = undefined;

        // Remove the hash from lookup table
        this.#lookup.hashMap[hash] = null;
        delete this.#lookup.hashMap[hash];

        // Delete the key hash from cache table
        // When calculating the hash of a key,
        // it adds them to this table for faster calculation in the future
        this.#cache[`key_hash_${key}`] = null;
        delete this.#cache[`key_hash_${key}`];

        // We must remove temporary entries from lookup table to free up memory and prevent conflictions
        // if a permanent entry with the same key gets inserted later
        this.#lookup.temps.delete(key);

        // Mark it as unsaved after a change was made
        this.#unsaved = true;

        return true;
    }

    /**
     * Get application info
     * @return {{version: string, name: string, encryption: boolean, monitor: boolean, cliPort: number}}
     * @since 1.0.0
     */
    getInfo(){

        return {
            version: Snowflake.config.version,
            name: Snowflake.config.name,
            encryption: this.#dbEncrypt,
            monitor: this.#memoryMonitor,
            cliPort: Snowflake.yaml.getInt("server.cli_port")
        };

    }

    /**
     * Iterates over stored values in the database and applies a callback function
     * to each entry within the given index range.
     *
     * The callback receives `(key, value, index)` and can control the flow:
     * - If it returns `Snowflake.DUMMY.BREAK`, iteration stops early.
     * - If it returns `undefined`, nothing is added to the result array.
     * - If it returns any other value, that value is collected in the result array.
     *
     * `index` is just a counter and not the actual entry index in memory.
     * @example
     * // Collect all values that are greater than 10
     * const results = Snowflake.core.analyzeValues((key, value, index) => {
     *   if (value > 10) return { key, value };
     * });
     *
     * // Stop after finding the first value greater than 100
     * const firstBig = Snowflake.core.analyzeValues((key, value) => {
     *   if (value > 100) return Snowflake.DUMMY.BREAK;
     *   return key;
     * });
     *
     * @param {function} callback - A function applied to each `(key, value, index)`. Must return either:
     *   - `Snowflake.DUMMY.BREAK` to break out of the loop,
     *   - `undefined` to skip adding a result,
     *   - or any value to include it in the results.
     * @param {number} [start=0] - The starting index (inclusive) of entries to analyze.
     * @param {number|null} [end=null] - The ending index (exclusive). If `null`,
     * all entries from `start` to the last item are included.
     * @return {Array<any>} A list of values returned by the callback for each analyzed entry.
     * @since 1.0.0
     */
    analyzeValues(callback, start = 0, end = null) {

        // No function, no analyze
        if (typeof callback !== "function")
            return [];

        // Output data
        const analyzed = [];

        // Key list of all data in database
        const keys = Object.keys(this.#lookup.value);

        // Go to the last entry if `end` is null
        const total = keys.length;
        end = end === null ? total : Math.min(end, total);

        let index = 0;
        for (let key of keys) {

            // stop at end
            if (index >= end)
                break;

            if (index >= start) {
                const data = this.#lookup.value[key];
                if(typeof data === "undefined")
                    continue;
                const returned = callback(key, data, index + start);
                if (returned === Snowflake.DUMMY.BREAK)
                    break;
                if (typeof returned !== "undefined")
                    analyzed.push(returned);
            }

            index++;

        }

        return analyzed;
    }

    /**
     * Get the key of an entry from its hash
     * @param {string} keyHash - Key hash of the entry
     * @return {string|null} Key string if exists, `null` otherwise
     * @since 1.0.0
     */
    getKeyFromHash(keyHash){
        return this.#lookup.hashMap[keyHash] ?? null;
    }

    /**
     * Get the total number of existing entries in the database
     * @returns {number}
     * @since 1.0.0
     */
    getEntriesCount(){
        return Object.keys(this.#lookup.hashMap).length;
    }

    /**
     * Stop all the database workers, this function is used for restarting process
     * and should not be used manually unless you know what you are doing.
     * @since 1.0.0
     */
    stopWorkers(){

        for(let [workerName, worker] of Object.entries(this.#workers)){
            if(worker instanceof Worker){
                // [SnowflakeEventEmit]: worker_aol_stopped
                snowflakeEvents.emit(`worker_${workerName}_stopped`);
                worker.terminate();
                Snowflake.logger.log(`%orange%[WORKER]%reset% '${workerName}' terminated`);
            }
        }

        // [SnowflakeEventEmit]: workers_stopped
        snowflakeEvents.emit("workers_stopped");

    }

    /**
     * Initialize automatic snapshot
     * @since 1.0.0
     */
    #initializeAutomaticSnapshot(){

        const intervalTime = Snowflake.yaml.getInt("persistent.snapshot_interval", 0);

        if(this.#snapshotInterval)
            clearInterval(this.#snapshotInterval);

        if(intervalTime > 0){

            Snowflake.logger.info(`Automatic snapshot has been enabled and set to every ${intervalTime/1000} seconds`, false, "snapshot");

            this.#snapshotInterval = setInterval(() => {

                if(this.isTakingSnapshot){
                    if(Snowflake.isDevelopment)
                        Snowflake.logger.info(`Snapshot delayed for another ${intervalTime/1000} seconds since a snapshot is already in progress.`, false, "snapshot");
                    return;
                }

                if(!this.isUnsaved){
                    if(Snowflake.isDevelopment)
                        Snowflake.logger.info(`Snapshot delayed for another ${intervalTime/1000} seconds no change was made.`, false, "snapshot");
                    return;
                }

                Snowflake.logger.info("Time to take a snapshot...", false, "snapshot");

                const startId = Snowflake.logger.timeStart();
                this.requestSnapshot().then(() => {
                    Snowflake.logger.benchmark("Took snapshot", startId, "snapshot");
                }).catch(() => {});

            }, intervalTime);

        }

        else{
            Snowflake.logger.log("%yellow%[WARNING] Automatic snapshot is disabled and you have to take it manually if you want." +
                "\nTo enable it, update 'persistent.snapshot_interval' value in configuration file.", null, "_snapshot");
        }

    }

    /**
     * Get the amount of MEID files currently using for database
     * @return {number}
     * @since 1.0.0
     */
    get meidsCount(){

        // Get configurations
        let meidsCount = Math.max(Snowflake.yaml.getInt("meids.count"), -1)

        // If the MEIDs count is equal or less than 0, measures MEIDs count based on available files
        if(meidsCount <= 0)
            meidsCount = Math.max(this.#meids.length, 1);

        const maxAllowedCount = Snowflake.yaml.getInt("meids.max_count", 32);

        return Math.min(meidsCount, maxAllowedCount);

    }

    /**
     * Get the max size allowed for each MEID file
     * @return {number} MEID file size limit in bytes
     * @since 1.0.0
     */
    get maxMeidSize(){

        let meidsSize = Snowflake.yaml.get("meids.size");

        let isMegaBinary = meidsSize.toString().endsWith("iB");

        return Snowflake.convertSize(meidsSize, "B", isMegaBinary, 4e9);

    }

    /**
     * Get database path
     * @return {string}
     * @since 1.0.0
     */
    get dbPath(){
        return this.#dbPath;
    }

    /**
     * Get mega-binary mode state
     * @return {boolean}
     * @since 1.0.0
     */
    get mbMode(){
        return this.#mbMode;
    }

    /**
     * Get database encryption state (enabled or disabled)
     * @return {boolean}
     * @since 1.0.0
     */
    get dbEncrypt(){
        return this.#dbEncrypt;
    }

    /**
     * Whether the memory monitor is enabled
     * @return {boolean}
     * @since 1.0.0
     */
    get monitorEnabled(){
        return this.#memoryMonitor;
    }

    /**
     * Max memory allowed for this app
     * @type {null|number}
     * @since 1.0.0
     */
    get maxMemory(){
        return this.#maxMemory;
    }

    /**
     * Get backup files list.
     * Note: this property is only used for initialization and after that it'll return an empty array.
     * @return {Array}
     * @since 1.0.0
     */
    get backupFiles(){
        return [...new Set(this.#backups)];
    }

    /**
     * Get lookup data
     * @return SnowflakeLookupData
     * @since 1.0.0
     */
    get lookupData(){
        return this.#lookup;
    }

    /**
     * Get unsaved state, if returns true, some data were added without calling 'persistent' method
     * @return {boolean}
     * @since 1.0.0
     */
    get isUnsaved(){
        return this.#unsaved;
    }

    /**
     * The last timestamp when persistent was called
     * @return {number}
     * @since 1.0.0
     */
    get lastPersistent(){
        return this.#lastPersistent;
    }

    /**
     * The timestamp that database was loaded
     * @return {number}
     * @since 1.0.0
     */
    get lastReload(){
        return this.#lastReload;
    }

    /**
     * The filesystem you are using on your computer.
     * **(Read from `configs.yaml`, won't find it automatically)**
     * @return {string}
     * @since 1.0.0
     */
    get filesystem(){
        const filesystem = String(Snowflake.yaml.get("filesystem.name")).toUpperCase();
        if(!["FAT32", "EXT4", "NTFS"].includes(filesystem))
            return "FAT32";
        return filesystem;
    }

    /**
     * The maximum allowed size that a file can be
     * @return {string}
     * @since 1.0.0
     */
    get filesystemMaxSize(){
        const maxSize = Snowflake.yaml.get("filesystem.max_size", "4GiB");
        return Snowflake.formatBytes(Snowflake.convertSize(maxSize, "B", maxSize.endsWith("iB")));
    }

    /**
     * The size of used memory calculated by memory monitor
     * @return {number} Used memory size in bytes
     * @since 1.0.0
     */
    get usedMemory(){
        return this.#memorySize;
    }

    /**
     * The size of used memory in percent calculated by memory monitor
     * @return {number|string} Used memory size in percent
     */
    get usedMemoryPercent(){
        if(!this.#memoryMonitor)
            return 0;
        return Math.min(this.#memorySize * 100 / this.#maxMemory, 100).toFixed(2);
    }

    /**
     * Size lookup for database files
     * @returns {{keys: [sizeInBytes: number], meids: [sizeInBytes: number]}}
     * @since 1.0.0
     */
    get sizeLookup(){
        return this.#sizeLookup;
    }

    /**
     * Check if there is currently a snapshot process is progress.
     * @returns {boolean}
     * @since 1.0.0
     */
    get isTakingSnapshot(){
        return this.#takingSnapshot;
    }

    /**
     * Check if there is currently a backup restoration process is progress.
     * @returns {boolean}
     * @since 1.0.0
     */
    get isRestoringBackup(){
        return this.#restoringBackups;
    }
    /**
     * Update backup restoration state
     * @since 1.0.0
     */
    set isRestoringBackup(state){
        this.#restoringBackups = state;
    }

}

module.exports = SnowflakeCore;