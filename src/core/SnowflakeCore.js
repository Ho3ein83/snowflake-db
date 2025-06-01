const Snowflake = require("./Snowflake");
const SnowflakeEvents = require("./SnowflakeEvents");
const path = require("path");
const fs = require("fs");
const { Worker } = require("worker_threads");
const appConfig = require("../../app.json");

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
    #db_path = "";

    /**
     * Whether to encrypt database files
     * @type {boolean}
     * @since 1.0.0
     */
    #db_encrypt = false;

    /**
     * Memory monitor status (enabled / disabled)
     * @type {boolean}
     * @since 1.0.0
     */
    #memory_monitor = false;

    /**
     * Max memory allowed for this app
     * @type {null|number}
     * @since 1.0.0
     */
    #max_memory = null;

    /**
     * Whether to use mega-binary mode or not
     * @type {boolean}
     * @since 1.0.0
     */
    #mb_mode = false;

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
     * MEID files data
     * @type {Object}
     * @since 1.0.0
     */
    #meids_data = {};

    /**
     * key files data
     * @type {Object}
     * @since 1.0.0
     */
    #keys_data = {};

    /**
     * The raw data of database files, this will be emptied after operations
     * @type {Object<number, Buffer>}
     * @since 1.0.0
     */
    #data_buffers = {};

    /**
     * The raw data of database key files, this will be emptied after operations
     * @type {Object<number, Buffer>}
     * @since 1.0.0
     */
    #key_buffers = {};

    /**
     * Key lookups for faster data fetching
     * @type {{
     *   key: {
     *     [key: string]: {
     *       name: string,
     *       hash: Buffer,
     *       size: number,
     *       position: number,
     *       length: number
     *     }
     *   },
     *   trash: [
     *     {
     *       size: number,
     *       position: number,
     *       length: number
     *     }
     *   ],
     *   value: {
     *       [key: string]: any
     *   }
     * }}
     * @since 1.0.0
     */
    #lookup = {
        key: {},
        value: {},
        trash: []
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
    #current_meid = -1;

    /**
     * The maximum number of active MEIDs.
     * This number is between 1 and the number of available MEIDs.
     * @type {number}
     * @since 1.0.0
     */
    #meids_size = 1;

    /**
     * The list of available workers
     * @type {{aol: import("worker_threads").Worker|null}}
     * @since 1.0.0
     */
    #workers = {
        aol: null
    };

    constructor(){}

    /**
     * Create a 256 bit hash using SHA-256 algorithm
     * @param {string} key - String or the key you want to hash
     * @param {boolean} use_cache - Whether to use cache or always calculate the hash, by enabling it, you can reduce
     * your system load.
     * @return {string|Buffer|Hash|*}
     */
    #sha256(key, use_cache=true){
        if(use_cache && typeof this.#cache[`key_hash_${key}`] !== "undefined")
            return this.#cache[`key_hash_${key}`];
        const hash = Snowflake.sha256(key, true);
        if(use_cache)
            this.#cache[`key_hash_${key}`] = hash;
        return hash;
    }

    /**
     * Set a key lookup data
     * @param {string} key - The key as a string
     * @param {number} meid_index - The index of the MEID file that contains the data of this key
     * @param {number} size - The size of this key
     * @param {number} position - The position of the key inside the key file
     * @param {Buffer|null} key_hash - The hash of the key, pass null to hash it automatically
     * @return {Buffer} - The hash of the key
     * @since 1.0.0
     */
    #setLookupKey(key, meid_index, size, position, key_hash=null){
        if(key_hash === null)
            key_hash = this.#sha256(key);
        const hash_str = key_hash.toString("hex");
        this.#lookup.key[key] = {
            meid: meid_index,
            name: key,
            hash: key_hash,
            hash_str,
            size,
            position,
            // 32 (SHA-256 hash size) + 4 (data length size) + size (parsed data length)
            length: 36 + size
        };
        return key_hash;
    }

    /**
     * Change a lookup value
     * @param {string|Buffer} hash - The hash of the target key in string format or a 32-byte buffer
     * @param {*} value - value to set
     * @since 1.0.0
     */
    #setLookupValue(hash, value){
        if(Buffer.isBuffer(hash) && hash.length === 32)
            hash = hash.toString("hex");
        if(typeof hash === "string")
            this.#lookup.value[hash] = value;
    }

    /**
     * Match the first 128 bytes of the headers and check if they both are shares the same signature and they both
     * are the same version.
     * @param {Buffer} buffer - The header buffer you want to validate.
     * @param {Buffer|null} header - The original header you want to match with, pass null to use default header.
     * @return {boolean} - True if both headers shares the same signature (first 128 bytes), false otherwise.
     * @since 1.0.0
     */
    matchHeaders(buffer, header=null){
        return true;
    }

    /**
     * Validate all database files header (including MEID and key files)
     * @return {SnowflakeCore}
     * @since 1.0.0
     */
    validateHeaders(){
        Snowflake.logger.log("%blue%Validating headers...");

        // Default header is considered a valid header and other files should match this
        const valid_header = this.getHeader();

        let table = [], is_valid = true;

        // Iterate every MEID and key file
        for(let [, file_name] of Object.entries([...this.#meids, ...this.#keys])){

            // Read the state of MEID file, 0 means the file is ready, 1 means it was created in the
            // initialization steps (and is ready), 2 means the file is fainted (exists but not used)
            const {state} = this.#meids_data[file_name] || {};

            // Generate a new header buffer
            let header = Buffer.alloc(256);

            // Read the header from database file
            let fd = fs.openSync(path.join(this.#db_path, file_name), "r");
            fs.readSync(fd, header, 0, 256, 0);

            // Capture time and version fragments from the file header
            const time = header.sf_capture(Snowflake.HDR_POS.TIME, Snowflake.HDR_SIZE.TIME);
            const date = new Date(Number(time.readBigUInt64BE()) * 1000);
            const version = header.sf_capture(Snowflake.HDR_POS.VERSION_CODE, Snowflake.HDR_SIZE.VERSION_CODE);

            // Check if the file header matches the valid header
            const valid = this.matchHeaders(header, valid_header);

            // If one of the database files isn't valid, it won't start the app
            if(!valid && Snowflake.FILE_STATES.isReady(state))
                is_valid = false;

            // Log file states as a table
            table.push({
                key: (state === 2 ? "%faint%" : "") + file_name,
                value: (valid ? "Valid" : "Invalid") + ` (v${version.readUint16BE()}) - ${date.toUTCString()}`,
                color: (valid ? "green" : "red")
            });
        }
        Snowflake.logger.table(table, 3, "clear", "-", 3);
        Snowflake.logger.log("");

        if(!is_valid)
            Snowflake.logger.assert("Your database files are invalid, check your configuration file or read the documentation for more details.\n" + Snowflake.help.invalid.join("\n"));
        return this;
    }

    /**
     * Get database files (MEIDs and keys)
     * @return {{meids_files: *[], keys_files: *[], backup_files: *[]}}
     * @since 1.0.0
     */
    getDatabaseFiles(){
        let meids_files = [], keys_files = [], backup_files = [];

        // MEIDs file format is .sfd and keys file format is .sfk
        // const file_pattern = new RegExp(/^(key|meid)-\d+\.(sfd|sfk)$/);
        const file_pattern = new RegExp(/^(meid-\d+\.sfd|key-\d+\.sfk|\d+\.sfb)$/);

        // Iterate every file in the database directory
        for(let file_name of fs.readdirSync(this.#db_path)){
            // If the file is either a key file or a MEID
            if(file_pattern.test(file_name)) {
                if(file_name.startsWith("meid-"))
                    meids_files.push(file_name);
                else if(file_name.startsWith("key-"))
                    keys_files.push(file_name);
                else
                    backup_files.push(file_name);
            }
        }
        return { meids_files, keys_files, backup_files };
    }

    loadMeidsAndKeys(){
        for(let [filename, data] of Object.entries({...this.#meids_data, ...this.#keys_data})){
            const {index, state} = data;
            if(!Snowflake.FILE_STATES.isReady(state))
                continue;
            if(filename.startsWith("meid-"))
                this.#data_buffers[index] = fs.readFileSync(path.join(this.#db_path, filename));
            else
                this.#key_buffers[index] = fs.readFileSync(path.join(this.#db_path, filename));
        }
    }

    unloadMeidsAndKeys(){
        this.#data_buffers = {};
        this.#key_buffers = {};
    }

    /**
     * Load a single key or database file into memory
     * @param {string} file_path - The file path of the key or MEID file
     * @param {number} index - TODO: get the index automatically based on file name
     * @param {boolean} is_meid - Whether the file is a database (MEID) file or a key file
     * @return void
     * @since 1.0.0
     */
    loadDatabaseFile(file_path, index, is_meid){
        const buffer = fs.readFileSync(file_path);

        // If the file isn't empty (the first 256 bytes are header data)
        if (buffer.length >= 256) {

            // Capture the data after file headers
            const data = buffer.sf_capture(256, buffer.length - 256);
            let pos = 0;

            if (is_meid) {

                // Iterate each block
                while (pos < data.length) {

                    // Start position of the entry
                    //const position = pos;

                    // The first 32-byte of the block is the hash
                    const hash = data.subarray(pos, pos + 32);
                    pos += 32;

                    // The next 4-byte is key size (in bytes)
                    const size = data.subarray(pos, pos + 4).readUInt32BE();
                    pos += 4;

                    // Get the value based on its size
                    const value_buffer = data.subarray(pos, pos + size);

                    // Decode the key
                    const value = Snowflake.fromBuffer(value_buffer);
                    pos += size;

                    // Set the value into lookup table
                    this.#setLookupValue(hash, value);

                }

            }
            else {

                // Iterate each block
                while (pos < data.length) {

                    // Start position of the entry
                    const position = pos;

                    // The first 32-byte of the block is the hash
                    const hash = data.subarray(pos, pos + 32);
                    pos += 32;

                    // The next 4-byte is key size (in bytes)
                    const size = data.subarray(pos, pos + 4).readUInt32BE();
                    pos += 4;

                    // Get the key based on its size
                    const key_buffer = data.subarray(pos, pos + size);

                    // Decode the key
                    const key = Snowflake.fromBuffer(key_buffer);
                    pos += size;

                    // Double-check the hash to check if the key is valid
                    if (Snowflake.sha256(this.sanitizeKey(key), true).compare(hash) === 0) {

                        // Add it to the lookup table
                        this.#setLookupKey(key, index, size, position, hash);

                    }

                }

            }

        }
    }

    /**
     * Load database keys and data into the memory
     * @since 1.0.0
     */
    loadDatabase() {

        // Load the data buffer
        // this.loadMeidsAndKeys();

        Snowflake.logger.log("%cyan%[DATABASE] Loading database files into memory...");

        for(let [filename, data] of Object.entries({...this.#meids_data, ...this.#keys_data})) {
            const {index, state} = data;
            if (Snowflake.FILE_STATES.isReady(state))
                this.loadDatabaseFile(path.join(this.#db_path, filename), index, filename.startsWith("meid-"));
        }

        Snowflake.logger.logln("%green%[DATABASE] Database contents loaded into memory.");

        // Unload the data buffer
        // this.unloadMeidsAndKeys();

    }

    /**
     * Initialize database MEID and key files
     * @return {SnowflakeCore}
     * @since 1.0.0
     */
    initMeidsAndKeys() {

        // Trigger the initialization event
        SnowflakeEvents.emit("core_before_meids_init");

        Snowflake.logger.log("%blue%Validating database configuration...");

        // Scan the database files and store them into necessarily properties
        ({meids_files: this.#meids, keys_files: this.#keys, backup_files: this.#backups} = this.getDatabaseFiles());

        // Load configurations
        let meids_count = Math.max(Snowflake.yaml.getInt("meids.count"), -1),
            meids_size = Snowflake.yaml.get("meids.size", "0");

        // If the MEIDs count is equal or less than 0, measures MEIDs count based on available files
        if(meids_count <= 0)
            meids_count = Math.max(this.#meids.length, 1);

        this.#meids_size = meids_count;

        let meids = {}, keys = {},
            meids_names = [], keys_names = [],
            all_generated = true;

        // If you need to change the database files permission, you can change it from configuration file
        const chmod = Snowflake.yaml.get("meids.permission");

        // Default header buffer, whether to check and validate the headers
        let header = null, header_check = true;

        // Iterate every MEID (there will be one key file for each database file)
        for(let i = 0; i < meids_count; i++){

            const meid_name = `meid-${i}.sfd`, key_name = `key-${i}.sfk`,
                meid_path = path.join(this.#db_path, meid_name), key_path = path.join(this.#db_path, key_name),
                meid_exists = fs.existsSync(meid_path), key_exists = fs.existsSync(key_path);

            // If key file and meid file don't exist, it will give a warning message by marking 'all_generated' as false
            if(!key_exists || !meid_exists)
                all_generated = false;

            // Get the default header if database files need to be generated, in that case,
            // it won't check the headers as they are fresh and newly generated
            if(!meid_exists || !key_exists){
                if(header === null) {
                    header = this.getHeader();
                    header_check = false;
                }
            }

            // Generate MEID file and set its permission if it doesn't exist
            if(!meid_exists) {
                fs.writeFileSync(meid_path, header);
                if(chmod)
                    fs.chmodSync(meid_path, chmod);
            }

            // Generate key file and set its permission if it doesn't exist
            if(!key_exists) {
                fs.writeFileSync(key_path, header);
                if(chmod)
                    fs.chmodSync(key_path, chmod);
            }

            // Set MEID file data
            meids[meid_name] = {
                index: i,
                name: meid_name,
                exists: meid_exists,
                state: meid_exists ? Snowflake.FILE_STATES.READY : Snowflake.FILE_STATES.NEW
            }

            // Set key file data
            keys[key_name] = {
                index: i,
                name: key_name,
                exists: key_exists,
                state: meid_exists ? Snowflake.FILE_STATES.READY : Snowflake.FILE_STATES.NEW
            }
        }

        // Iterate every MEID and key file
        for(let file of [...this.#meids, ...this.#keys]){

            // Whether the file is MEID or key file
            const is_meid = file.startsWith("meid-");

            // Get the numeric index number for the file
            const index = parseInt(file.replaceAll(/^(meid|key)-/g, ""));

            // If the index number is outside the range (defined in configs.yaml file as 'meids.count')
            if(index > meids_count-1){

                // Mark the file as faint (by setting its state to Snowflake.FILE_STATES.FAINT)
                const data = {
                    index: index,
                    name: file,
                    exists: true,
                    state: Snowflake.FILE_STATES.FAINT
                }

                // Push file data into the appropriate object
                if(is_meid)
                    meids[file] = data;
                else
                    keys[file] = data;
            }
        }

        // Some files that won't be included in memory data, will be marked as faint files,
        // they will still be validated but wouldn't load inside the memory
        let has_faint = false;

        // Iterate every database file
        for(let [key, value] of Object.entries(Object.assign(meids, keys))){

            // Whether the file is MEID or key file
            const is_meid = key.startsWith("meid-");

            // New files will be marked as warning, unused files as faint, and others will remain unmarked
            const format = ["", "%warning%", "%faint%"][value.state] || "";

            // Push the file name into the appropriate array to report them in logs
            if(is_meid)
                meids_names.push(format + key);
            else
                keys_names.push(format + key);

            // If any file has marked as faint, then it'll display a warning in the console or log file
            if(value.state === Snowflake.FILE_STATES.FAINT)
                has_faint = true;
        }

        // Store MEIDs and keys data into the appropriate object
        this.#meids_data = meids;
        this.#keys_data = keys;

        // Backup size limit
        let backup_size_limit = Snowflake.yaml.get("persistent.backup_size_limit");
        backup_size_limit = Snowflake.formatBytes(Snowflake.convertSize(backup_size_limit, "B", this.#mb_mode), this.#mb_mode);

        // Create a table to report the database information
        Snowflake.logger.table([
            {key: "Path", value: `%underline%${this.#db_path}%reset%`},
            {key: "Version", value: `${appConfig.meid_version}`},
            {key: "Encryption", value: `${this.#db_encrypt ? "Yes" : "No"}`},
            {key: "Size", value: `${meids_size === 0 ? "Unlimited" : Snowflake.formatBytes(Snowflake.convertSize(meids_size, "B", this.#mb_mode), this.#mb_mode)}`},
            {key: "Count", value: `${meids_count} MEID` + (meids_count > 1 ? "s" : "")},
            {key: "MEID files", value: meids_names.join("\n%padding%")},
            {key: "Key files", value: keys_names.join("\n%padding%")},
            {key: "Persistent", value: Snowflake.yaml.isTrue("persistent.enabled") ? "Enabled" : "Disabled"},
            {key: "Backup size", value: backup_size_limit},
        ], 3, "green", "-");

        // Fain warning
        if(has_faint)
            Snowflake.logger.log(`%yellow%   Some database files are not usable because they are out of MEIDs range (meids.count).`);

        // New files generation warning
        if(!all_generated)
            Snowflake.logger.log(`%warning%   The database files highlighted were created due to their absence.`);

        // Validate headers if needed
        if(header_check) {
            Snowflake.logger.log("%clear%");
            this.validateHeaders();
        }

        // Trigger the finalization event
        SnowflakeEvents.emit("core_after_meids_init");

        return this;
    }

    /**
     * Initialize database settings and files
     * @return {SnowflakeCore}
     * @since 1.0.0
     */
    init() {

        // Trigger the initialization event
        SnowflakeEvents.emit("core_before_init");

        // Initialize values
        // const dbPath = Snowflake.yaml.get("dir.database_path");
        // this.#db_path = path.join(dbPath === null ? process.env.PWD : dbPath, Snowflake.yaml.get("dir.database"))
        this.#db_path = Snowflake.resolvePath(Snowflake.yaml.get("dir.database"));

        // Make database directory if it doesn't exist
        Snowflake.logger.logln("%cyan%[DATABASE] Initializing database");
        if (!fs.existsSync(this.#db_path)) {
            Snowflake.logger.log(`%blue%   - Creating database directory`);
            fs.mkdirSync(this.#db_path);
        }

        // Trigger the finalization event
        SnowflakeEvents.emit("core_after_init");
        return this;
    }

    /**
     * Initialize memory monitor. This method will be called only if memory.monitor is true in the config file.
     * However you can call it separately with your own risk
     * @return {SnowflakeCore}
     * @since 1.0.0
     */
    initMemoryMonitor() {

        // Trigger the initialization event
        SnowflakeEvents.emit("core_before_memory_init");

        // Initialize values
        this.#memory_monitor = true;
        this.#max_memory = Snowflake.convertSize(Snowflake.yaml.get("memory.max_size"), "B", this.#mb_mode);

        // Trigger the finalization event
        SnowflakeEvents.emit("core_after_memory_init");
        return this;
    }

    /**
     * Start the main core
     * @return {SnowflakeCore}
     * @since 1.0.0
     */
    start() {

        // Trigger the starting event
        SnowflakeEvents.emit("core_before_start");

        // Initialize values
        this.#mb_mode = Snowflake.yaml.isTrue("memory.mb_mode");
        this.#db_encrypt = Snowflake.yaml.isTrue("meids.encrypt");

        // Initialize the database
        this.init().initMeidsAndKeys();

        // Trigger the initialization event
        SnowflakeEvents.emit("core_before_database_read");

        // Initialize workers
        this.#workers.aol = new Worker(Snowflake.resolvePath("workers/worker_aol.js", Snowflake.core_path), {
            workerData: {
                database_path: this.#db_path,
                permission: Snowflake.yaml.get("meids.permission")
            }
        });

        // Handle worker errors
        this.#workers.aol.on("error", msg => {
            Snowflake.logger.log(`%red%worker_aol.js: ${msg}`);
            process.exit(1);
        });

        // Load all database content into memory
        this.loadDatabase();

        // Trigger the finalization event
        SnowflakeEvents.emit("core_after_database_read");

        // Initialize the memory monitor if needed
        if (Snowflake.yaml.isTrue("memory.monitor"))
            this.initMemoryMonitor();

        // Trigger the ending event
        SnowflakeEvents.emit("core_after_start");

        return this;
    }

    /**
     * Get default header
     * @return {Buffer}
     * @since 1.0.0
     */
    getHeader(){
        // Making a new empty buffer for header, the actual header will be overwritten in 'SnowflakeCoreHelper'
        return Buffer.alloc(256);
    }

    /**
     * Check if an origin is allowed or not
     * @param {string} origin - The origin URL, e.g: "https://example.com"
     * @param {string|null} allowed_origins - Allowed origins regex, pass null to get it from configuration file.
     * @return {boolean} - True if the origin is allowed, false otherwise
     * @since 1.0.0
     */
    originIsAllowed(origin, allowed_origins=null) {
        try {

            // Get allowed origins from configuration if needed
            if(allowed_origins === null)
                allowed_origins = Snowflake.yaml.get("server.allowedOrigins");

            if(!allowed_origins)
                return false;

            // Check if origin is allowed
            const pattern = new RegExp(allowed_origins);
            return pattern.test(origin);

        } catch(e){
            Snowflake.logger.error(`Couldn't verify the origin '${origin}', ` + e.toString(), "socket");
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
        key = key.replaceAll(/\s/g, "_");
        key = key.replaceAll(/[^a-zA-Z0-9\-_]/g, "");
        if(trim)
            key = key.replace(/^_+|_+$/g, "");
        return key;
    }

    /**
     * Sanitize the value before adding it to memory
     * @param {any} value
     * @return {*}
     * @since 1.0.0
     */
    sanitizeValue(value){
        return value;
    }

    /**
     * Select the next database file to add a new entry.
     * When you add a new entry it starts from `meid-0.sfd` file, the next entry will be added to `meid-1.sfd` and so on.
     * However if you don't have more than 1 MEID in your configuration, all of the entries get added to the first file.
     * @return {number} - The current index of MEID files starting from 0
     * @since 1.0.0
     */
    nextMeid(){
        if(this.#meids_size <= 1)
            return 0;
        if(++this.#current_meid >= this.#meids_size)
            this.#current_meid = -1
        return Math.max(this.#current_meid, 0);
    }

    /**
     * Find a ket data from lookup table.
     * @param {string} key - The key to search
     * @return {{}|{name: string, hash: Buffer, size: number, position: number, length: number}} - Key data on succes,
     * empty object if didn't exist
     * @since 1.0.0
     */
    lookupKey(key){
        return this.#lookup.key[key] || {};
    }

    /**
     * Find a value by its key hash from database
     * @param {string} hash - Hash of the key in string format
     * @return {*|undefined} - The value of the entry if exist, otherwise `undefined`
     * @since 1.0.0
     */
    lookupValue(hash){
        return this.#lookup.value[hash] || undefined;
    }

    /**
     * Check if specific key exists in the database or not
     * @param {string} key - The key you want to check
     * @return {boolean} - True if exists, false otherwise
     * @since 1.0.0
     */
    exist(key){
        return this.lookupKey(key).length > 0;
    }

    askWorker(worker_name, request){
        /**
         * @type import("worker_threads").Worker|null
         */
        const worker = this.#workers[worker_name];
        if(!worker || (!worker instanceof Worker))
            return null;
        return new Promise((resolve, reject) => {
            worker.once("message", response => {
                resolve(response);
            });
            worker.once("error", error => {
                reject(error);
            });
            worker.postMessage(request);
        });
    }

    /**
     * Sets a value directly without sanitization or confirmation.
     *
     * **Warning:** Use this method with caution. Unlike `set()`, this method does not sanitize the key
     * or request confirmation from backup threads. Data set using this method will not
     * be stored permanently and will be lost upon process termination.
     *
     * @param {string} key - The key for the entry to be modified.
     * @param {*} value - The value to assign.
     * @returns {number} - Returns `0` on failure, `1` if the value was updated, or `2` if a new entry was inserted.
     * @since 1.0.0
     */
    setUnsafe(key, value){

        if(!key.length)
            return 0;

        const hash = this.#sha256(key);

        if (this.exist(key)) {
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
     * @param {*} value - The value to set, can be any simple object like number, string, boolean, array, object, etc.
     * @return {number} - 0 on failure, 1 on update, 2 on insert
     * @since 1.0.0
     */
    set(key, value){

        const confirm = (k, v) => {
            this.askWorker("aol", {
                action: "set",
                key: k,
                value: v
            }).then(ignore => {});
            return true;
        }

        key = this.sanitizeKey(key);

        if(key.length) {

            const confirmed = confirm(key, value);

            if(confirmed)
                return this.setUnsafe(key, value);

        }

        return 0;
    }

    /**
     * Get a value from database
     * @param {string} key - The key you want to get
     * @param {*} def - The default value if the key didn't exist
     * @return {*}
     * @since 1.0.0
     */
    get(key, def=null){
        const hash = this.#sha256(key, true);
        const value = this.lookupValue(hash.toString("hex"));
        return value === undefined ? def : value;
    }

    /**
     * Remove specific entry from database without checking its existence.
     * This can be unsafe since it'll be added to trash even if it's not in the database, and it might overwrite a
     *
     * @param {string} key - The key you want to remove
     * @return {boolean} - True on success, false on failure
     * @since 1.0.0
     */
    //removeUnsafe(key){}

    /**
     * Remove specific entry from database
     * @param {string} key - The key you want to remove
     * @return {boolean} - True on success, false on failure
     * @since 1.0.0
     */
    remove(key){
        if(!this.exist(key))
            return false;
        const hash = this.#sha256(key).toString("hex");
        const lookup = this.#lookup.key[key];
        this.#lookup.trash.push({
            size: lookup.size,
            position: lookup.position,
            length: lookup.length,
        });
        this.#lookup.key[key] = undefined;
        this.#lookup.value[hash] = undefined;
        return true;
    }

    /**
     * Get database path
     * @return {string}
     * @since 1.0.0
     */
    get dbPath(){
        return this.#db_path;
    }

    /**
     * Get mega-binary mode state
     * @return {boolean}
     * @since 1.0.0
     */
    get mbMode(){
        return this.#mb_mode;
    }

    /**
     * Get database encryption state (enabled or disabled)
     * @return {boolean}
     * @since 1.0.0
     */
    get dbEncrypt(){
        return this.#db_encrypt;
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
     * @return {{
     *   key: {
     *     [key: string]: {
     *       name: string,
     *       hash: Buffer,
     *       size: number,
     *       position: number,
     *       length: number
     *     }
     *   },
     *   trash: [
     *     {
     *       size: number,
     *       position: number,
     *       length: number
     *     }
     *   ],
     *   value: {
     *       [key: string]: any
     *   }
     * }}
     * @since 1.0.0
     */
    get lookupData(){
        return this.#lookup;
    }

}

module.exports = SnowflakeCore;