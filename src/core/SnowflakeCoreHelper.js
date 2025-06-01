const SnowflakeCore = require("./SnowflakeCore");
const SnowflakeCLI = require("./SnowflakeCLI");
const Snowflake = require("./Snowflake");
const SnowflakeRangeQuery = require("./SnowflakeRangeQuery");
const SnowflakeAol = require("./SnowflakeAol");
const appConfig = require("../../app.json");
const fs = require("fs");

class SnowflakeCoreHelper extends SnowflakeCore {

    /**
     * Initialize the main core
     * @return {SnowflakeCoreHelper}
     * @since 1.0.0
     */
    init() {
        super.init();

        SnowflakeCLI.command("get", {
            help: `Get existing entries from memory.
Usage: get [KEYS] [?OPTIONS]
    [KEYS]:
    * Required
    * Description: single key or space separated key list.
    [OPTIONS]:
    * Optional
    * Options: -j or --json: force it to return JSON even for single
                             values.

Examples: get key_1
          get -j key_1
          get key_1 key_2
          get "key 1" "key 2"
          get "key 1" -j`,
            usage: "get [KEYS]",
            validate: params => {
                const { args } = params;
                return Object.keys(args).length > 0;
            },
            exec: params => {
                const { args, options } = params;
                const values = {};
                const useJson = options.hasOwnProperty("j") || options.hasOwnProperty("json");

                if (args.length <= 1) {
                    const key = this.sanitizeKey(args[0]);
                    const value = this.get(key, Snowflake.DUMMY.UNDEF);
                    if (value === Snowflake.DUMMY.UNDEF) {
                        return ["key doesn't exist", null, 6];
                    }
                    return ["", useJson ? { key: value } : value, 0, true];
                }

                for (let k of args) {
                    const key = this.sanitizeKey(k);
                    const value = this.get(key, Snowflake.DUMMY.UNDEF);
                    if (value !== Snowflake.DUMMY.UNDEF)
                        values[key] = value;
                }

                const entries = Object.keys(values).length;

                if (entries === 0)
                    return ["keys don't exist", null, 6];

                return [`found ${entries} entr${entries > 1 ? "ies" : "y"}`, values, 0, true];
            }
        });

        SnowflakeCLI.command("set", {
            help: `Change an existing value inside memory or set a new one.
Usage: set [KEY_PAIRS] [?OPTIONS]
    [KEY_PAIRS]:
    * Required
    * Description: a key name followed by target value.
    [OPTIONS]:
    * Optional
    * Options: -j or --json: by passing this option, you can set
                             entries using JSON. By passing this
                             option you must provide a valid JSON set
                             with a valid key and value.

Examples: set key1 value1
          set key1 "value 1"
          set key1 value1 key2 value2
          set -j '{"key": "value"}'
          set '{"key1": "value1"}' '{"key2": "value2"}' -j
          set '{"item1": 1, "item2": 2}' --json`,
            usage: "set [KEY_PAIRS] [?OPTIONS]",
            validate: params => {
                const { args } = params;
                return Object.keys(args).length > 0;
            },
            exec: params => {
                const { args, options } = params;

                if(args.length <= 1)
                    return [`value missing${args.length === 1 ? ` for key: '${args[0]}'` : ""}`, 0, true];

                const isJson = options.hasOwnProperty("j") || options.hasOwnProperty("json");
                let updates = 0, news = 0;

                const setItem = (key, value) => {
                    const result = this.set(key, value); // Assuming `this.set` is a function that returns 1 for updates, 2 for new entries
                    if (result === 1) updates++;
                    else if (result === 2) news++;
                };

                if (isJson) {
                    // JSON mode: Each argument is expected to be a JSON string
                    for (let item of args) {
                        try {
                            const parsedItem = JSON.parse(item);
                            for (let [key, value] of Object.entries(parsedItem)) {
                                setItem(key, value);
                            }
                        } catch (e) {
                            // Handle JSON parse error (optional)
                            console.error(`Invalid JSON: ${item}`);
                        }
                    }
                } else {
                    // Key-value pair mode: Process arguments in pairs
                    for (let i = 0; i < args.length; i += 2) {
                        const key = args[i];
                        const value = args[i + 1];
                        if (value !== undefined) {
                            setItem(key, value);
                        }
                    }
                }

                let msg = '';
                if (updates > 0) msg += `${updates} entr${updates > 1 ? "ies" : "y"} updated\n`;
                if (news > 0) msg += `${news} entr${news > 1 ? "ies" : "y"} inserted`;

                return [msg.trim(), updates + news, 0];
            },
            _exec: params => {
                const { args, options } = params;
                const isJson = options.hasOwnProperty("j") || options.hasOwnProperty("json");
                let updates = 0, news = 0;

                const setItem = (key, value) => {
                    const result = this.set(key, value);
                    if (result === 1) updates++;
                    else if (result === 2) news++;
                };

                let i = 0;
                for (let item of args) {
                    if (isJson) {
                        try {
                            const parsedItem = JSON.parse(item);
                            for (let [key, value] of Object.entries(parsedItem)) {
                                setItem(key, value);
                            }
                        } catch (e) {
                            console.error(`Invalid JSON: ${item}`);
                        }
                    } else {
                        const nextItem = args[++i];
                        if (nextItem !== undefined)
                            setItem(item, nextItem);
                    }
                }

                let msg = '';
                if (updates > 0)
                    msg += `${updates} entr${updates > 1 ? "ies" : "y"} updated\n`;
                if (news > 0)
                    msg += `${news} entr${news > 1 ? "ies" : "y"} inserted`;

                return [msg.trim(), updates + news, 0];
            }
        });

        SnowflakeCLI.command("delete", {
            help: `Remove an existing value from memory or set a new one.
Usage: delete [KEYS]
    [KEYS]:
    * Required
    * Description: single key or space separated key list.

Examples: delete key1
          remove key1
          delete key1 key2
          delete "Key 1" "Key 2"`,
            usage: "delete [KEYS]",
            validate: params => {
                const { args } = params;
                return Object.keys(args).length > 0;
            },
            exec: params => {
                const { args, options } = params;
                if (args.length <= 1) {
                    const success = this.remove(args[0]);
                    return [success ? "1 item deleted" : "Deletion failed", success, success ? 0 : 5];
                }
                let removed = 0, failed = 0;
                for(let item of args){
                    if(this.remove(item))
                        removed++;
                    else
                        failed++;
                }
                let msg = [];
                if(removed)
                    msg.push(`${removed} item${removed > 1 ? "s" : ""} deleted`);
                if(failed)
                    msg.push(`${failed} item${failed > 1 ? "s" : ""} failed`);
                if(msg.length <= 0)
                    msg.push("completed");
                return [msg.join(", "), removed, 0];
            }
        });

        SnowflakeCLI.alias("remove", "delete");

        SnowflakeCLI.command("sanitize", {
            help: `Sanitize a key or value.
Usage: sanitize [TYPE] [INPUT] [?OPTIONS]
    [TYPE]:
    * Required
    * Description: Case insensitive type, it can be either 'key' or
                   'value'
    [INPUT]:
    * Required
    * Description: The input string
    
    [OPTIONS]:
    * Optional
    * Options: -t or --trim: by passing this option, you can trim
                             every underscore (_) from the key

Examples: sanitize key my_key
          sanitize KEY My key
          sanitize Key "My key"
          sanitize value "My value"
          sanitize Value value`,
            usage: "sanitize [TYPE] [INPUT]",
            validate: d => {
                const { args } = d;
                return Object.entries(args).length > 1;
            },
            exec: d => {
                const { args, options } = d;
                const type = String(args.shift()).toLowerCase();
                let value = "";
                if (type === "key")
                    value = this.sanitizeKey(args.join(" "), options.hasOwnProperty("t") || options.hasOwnProperty("trim"));
                else if (type === "value")
                    value = this.sanitizeValue(args.join(" "));
                return ["", value, 0, true];
            }
        });

        return this;
    }

    /**
     * Retrieves the current valid header as a Buffer.
     *
     * This method constructs a 256-byte buffer header containing:
     * - The database version
     * - The current timestamp
     * - A signature for identifying and verifying the header
     * - Other meta data
     *
     * @return {Buffer} - A Buffer containing the constructed header data.
     * @since 1.0.0
     */
    getHeader() {
        // Make an empty buffer with 256 bytes long
        const buffer = Buffer.alloc(256);

        // Write the database version to the first 2 bytes of header
        buffer.writeUInt16BE(Math.max(appConfig.meid_version, 1), Snowflake.HDR_POS.VERSION_CODE);

        // Write the current time to the data chunk of header
        // Data chunk starts at 128th byte and it can store any meta-data without invalidating the header
        const t = new Date().getTime().toString();
        buffer.writeBigUInt64BE(BigInt(t.substring(0, t.length - 3)), Snowflake.HDR_POS.TIME);

        // Write the signature to the header, signatures can prevent a database file from being parsed in other places
        // Note that the signature isn't encrypted and can be extracted from key files, you may want to consider
        // encryption for that
        buffer.write(appConfig.signature, Snowflake.HDR_POS.SIGNATURE);

        return buffer;
    }

    /**
     * Checks if the given buffer header matches the specified or default valid header.
     * This method compares the first 256 bytes of the provided buffer against either a specified header or the default header.
     *
     * @param {Buffer} buffer - The buffer containing the target header to be compared.
     * @param {Buffer|null} [header=null] - The original header to compare against. If `null`, the method uses the default header.
     * @return {boolean} - Returns `true` if the headers match, otherwise `false`.
     * @since 1.0.0
     */
    matchHeaders(buffer, header = null) {
        // Get default header
        if (header === null)
            header = this.getHeader();

        // Compare the first 256 bytes of both headers and check for a match
        return Buffer.compare(buffer.subarray(0, Snowflake.HDR_POS.DATA), header.subarray(0, Snowflake.HDR_POS.DATA)) === 0;
    }

    loadDatabase() {

        super.loadDatabase();

        const files = this.backupFiles;

        if(files.length > 0) {

            Snowflake.logger.log(`%cyan%[BACKUP] Recovering ${files.length} backup${files.length > 1 ? "s" : ""}...`);

            const aol = new SnowflakeAol(this.dbPath);

            const restore_backup = file => {
                try {
                    const file_path = Snowflake.resolvePath(file, this.dbPath);
                    if(!fs.existsSync(file_path))
                        return false;
                    const content = fs.readFileSync(file_path).toString("utf-8");
                    const instructions = SnowflakeAol.parseInstructions(content);
                    for(let i = 0; i < instructions.length; i += 2) {
                        const action = instructions[i];
                        const data = instructions[i + 1];
                        if(action === "set") {
                            for(let [k, v] of Object.entries(data))
                                this.setUnsafe(this.sanitizeKey(k), this.sanitizeValue(v));
                        }
                        else if(action === "remove"){
                            for(let k of data)
                                this.remove(k);
                        }
                    }
                } catch(e){
                    Snowflake.logger.log(`%orange%[BACKUP] Cannot restore '${file}' backup file.`);
                }
                return false;
            }

            for(let file of files) {
                restore_backup(file);
            }

        }

        const range_query = new SnowflakeRangeQuery(this.lookupData.trash);
        range_query.sortBy("size");
        //range_query.findSmallestFit("size", 5);
    }

}

module.exports = new SnowflakeCoreHelper;
