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

        // Get existing value(s)
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
                    let value = this.get(key, Snowflake.DUMMY.UNDEF);
                    if (value === Snowflake.DUMMY.UNDEF) {
                        return ["key doesn't exist", null, 6];
                    }
                    /*if(Buffer.isBuffer(value))
                        value = "Buffer#0x" + value.toString("hex");*/
                    return ["", useJson ? { key: value } : value, 0, true];
                }

                for (let k of args) {
                    const key = this.sanitizeKey(k);
                    const value = this.get(key, Snowflake.DUMMY.UNDEF);
                    if (value !== Snowflake.DUMMY.UNDEF) {
                        /*if(Buffer.isBuffer(value))
                            values[key] = "Buffer#0x" + value.toString("hex");
                        else*/
                            values[key] = value;
                    }
                }

                const entries = Object.keys(values).length;

                if (entries === 0)
                    return ["keys don't exist", null, 6];

                return [`found ${entries} entr${entries > 1 ? "ies" : "y"}`, values, 0, true];
            }
        });

        // Set (upsert) a value inside the lookup table
        SnowflakeCLI.command("set", {
            help: `Change an existing value inside memory or set a new one.
Alias: add
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
          set '{"item1": 1, "item2": 2}' --json
          set item ~T %green%<- true%reset%
          set item ~F %green%<- false%reset%
          set item ~N %green%<- null%reset%
          set item ~0xff %green%<- buffer%reset%
          set item ~0xdeadbeef %green%<- buffer%reset%
          set item ~20 %green%<- number%reset%
          set item 20 %green%<- string%reset%`,
            usage: "set [KEY_PAIRS] [?OPTIONS]",
            validate: params => {
                const { args } = params;
                return Object.keys(args).length > 0;
            },
            exec: params => {
                const { args, options } = params;

                const isJson = options.hasOwnProperty("j") || options.hasOwnProperty("json");

                if(args.length <= 1 && !isJson)
                    return [`value missing${args.length === 1 ? ` for key: '${args[0]}'` : ""}`, 0, true];

                let updates = 0, news = 0, limited = 0, notChanged = 0;

                const setItem = (key, value) => {
                    const result = this.set(key, value); // Assuming `this.set` is a function that returns 1 for updates, 2 for new entries
                    if (result === 1) updates++;
                    else if (result === 2) news++;
                    else if (result === -1) limited++;
                    else if (result === -2) notChanged++;
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
                            if(Snowflake.isDevelopment)
                                console.error(`Invalid JSON: ${item}`, e);
                            else
                                console.error("Tried to parse invalid JSON in datasets");
                        }
                    }
                } else {
                    // Key-value pair mode: Process arguments in pairs
                    for (let i = 0; i < args.length; i += 2) {
                        const key = args[i];
                        const value = args[i + 1];
                        if (value !== undefined) {
                            setItem(key, String(value).charAt(0) === "~" ? SnowflakeAol.parse(value.substring(1)) : value);
                        }
                    }
                }

                let msg = '';
                if(updates > 0) msg += ` ${updates} entr${updates > 1 ? "ies" : "y"} updated\n`;
                if(news > 0) msg += ` ${news} entr${news > 1 ? "ies" : "y"} inserted`;
                if(limited > 0) msg += ` ${limited} entr${limited > 1 ? "ies" : "y"} exceeded the memory limit`;
                if(notChanged > 0) msg += ` ${notChanged} entr${notChanged > 1 ? "ies" : "y"} didn't change`;

                return [msg.trim(), updates + news, 0];
            },
        });

        // Delete an existing entry
        SnowflakeCLI.command("delete", {
            help: `Remove an existing value from memory.
Aliases: remove | rm
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

        // Sanitize a key or value
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

        // List the lookup table
        SnowflakeCLI.command("list", {
            help: `List existing entries in memory. The list is
paginated and shows a limited amount of entries.
Alias: ls
Usage: list [?PAGE] [?OPTIONS]
    [PAGE]:
    * Optional
    * Description: The number of current page (default is 1)
    
    [OPTIONS]:
    * Optional
    * Options: --limit: The amount of entry limit of each page,
                        default is 30. Pass -1 for unlimited.
               --type: Filter out the entries by their type.
                       The allowed types are: "number", "string",
                       "bool" / "boolean", "object", "array",
                       "buffer" / "bin", "all" / "*" (default).
                       You can also pass multiple types by
                       separating them with comma.
               --scope: Set the scope for data lookup, the
                        allowed values are: "key", "value", "trash",   
                        "pair" (default, both key and value)

Examples: list
          list 2
          list --limit=10
          list 2 --limit=10
          list --type=string
          list --scope=key
          list --type=buffer,string,array`,
            usage: "list [?PAGE] [?OPTIONS]",
            validate: () => true,
            exec: d => {
                const { args, options } = d;

                // Current page
                const page = Math.max(parseInt(args[0] ?? 1), 1);

                // Entries per page
                const limit = parseInt(options.limit ?? 30);

                // Scopes
                const scope = (options.scope ?? "pair").toLowerCase();

                // Filter by type
                const type = (options.type ?? "all").toLowerCase();
                const types = type.split(",");

                const list = this.list(scope, limit, page, types);

                if(list.length === 0)
                    return [scope === "trash" ? "The trash is empty" : "No item found", null, 0, false];

                const total = Snowflake.core.getEntriesCount();
                const totalPages = Math.ceil(total / limit);

                let msg = "Found " + list.length + ` item${list.length > 1 ? "s" : ""} (total ${total} entr${total > 1 ? "ies" : "y"} in ${totalPages} page${totalPages > 1 ? "s" : ""}):`;

                for (const listElement of list) {
                    if(typeof listElement === "object"){
                        for(let [key, value] of Object.entries(listElement)){
                            const finalValue = typeof value.value !== "undefined" ? value.value : undefined;
                            msg += `\n${key}: ` + Snowflake.stringify(finalValue, 60, "...", scope !== "trash");
                        }
                    }
                    else{
                        if(scope === "trash")
                            msg += `\n${listElement}`;
                        else
                            msg += "\n" + Snowflake.stringify(listElement, null, "...", true);
                    }
                }

                return [msg, null, 0, false]; // message, value, statusCode, outputValue

            }
        });

        // Truncate the database
        SnowflakeCLI.command("truncate", {
            help: `Truncate the database or just a specific one.
Note that it will regenerate the headers for each file after
truncating. Also you need to reload the database after truncating
to keep it up to date.
If the database index is not loaded, won't be truncated.
Usage: truncate [INDEX] [CONFIRM]
    [INDEX]:
    * Required
    * Description: The index of the database file to be truncated,
                   starting from 0.
                   Also you can set it to "all" to truncate all the
                   database files that was loaded.
                   Can be a comma separated string, for example
                   "0,4" will truncate 0 and 4 database files.
   
   [INDEX]:
    * Required
    * Description: The confirmation of the truncation, must be
                   either "1" or "confirm" string.

Examples: truncate 0 confirm
          truncate all confirm
          truncate 1,2,3 confirm
          truncate "1, 2, 3" confirm`,
            usage: "truncate [INDEX] [CONFIRM]",
            validate: () => true,
            exec: d => {
                const { args } = d;

                let msg = "";

                const index = args[0] ?? null;
                const confirm = args[1] ?? null;

                if(index === null){
                    return [Snowflake.logger.formatChars("%char:coloredX%", true) + " Index is not assigned, read the usage for more details", false, 4, false]
                }

                if(confirm !== "confirm" && confirm !== "1"){
                    return [Snowflake.logger.formatChars("%char:warningColored%", true) + " You must enter 'confirm' keyword after the index list", false, 4, false]
                }

                let success = false;
                let targetIndex = Number(index);
                if (isNaN(targetIndex)) {
                    if (index.indexOf(",") !== false)
                        targetIndex = index.split(",").map(i => i.trim());
                }
                if (index === "all") {
                    const messages = this.truncateAll();
                    if (messages) {
                        for (let message of messages) {
                            msg += message + "\n";
                        }
                    }
                }
                else if (Array.isArray(targetIndex)) {
                    for (let i of targetIndex) {
                        const message = this.truncate(i);
                        if (message)
                            msg += message + "\n";
                    }
                }
                else {
                    if (isNaN(targetIndex)) {
                        msg += `🗴 index ${index} must be a number` + "\n";
                    }
                    else {
                        const message = this.truncate(targetIndex);
                        if (message)
                            msg += message + "\n";
                    }
                }

                msg += "%char:infoColored% Note that you need to run 'reload' command to reload the database.\n";
                return [Snowflake.logger.formatChars(msg.replaceAll("🗴", "%char:coloredX%").replaceAll("✓", "%char:coloredCheck%"), true), success, success ? 0 : 5, false]; // message, value, statusCode, outputValue

            }
        });

        // Reload the database
        SnowflakeCLI.command("reload", {
            help: `Reload the database files.
Run this command after truncating or changing the
database files.
Usage: reload [?OPTIONS]
    [OPTIONS]:
    * Optional
    * Options: --no-backup: Omit the backup files restoration and
                            just reload the database files. If not
                            present, backups will be restored first.
               --delete-backups: Delete every unhandled backup files.

Examples: reload
          reload --no-backup
          reload --delete-backups`,
            usage: "reload [?OPTIONS]",
            validate: () => true,
            exec: d => {

                const { options } = d;

                new Promise(resolve => {
                    Snowflake.core.reloadDatabase(typeof options["delete-backups"] !== "undefined" ? 2 : (typeof options["no-backup"] !== "undefined" ? 1 : true));
                    resolve();
                }).then(() => null);

                return [Snowflake.logger.formatChars("%char:infoColored%", true) + " Database reloading process started, see program logs for more details.", true, 0, false]; // message, value, statusCode, outputValue

            }
        });

        // Persistent the database
        SnowflakeCLI.command("persistent", {
            help: `Takes a snapshot from the current database
and stores it in the database files.
Alias: persist
Usage: persistent

Examples: persistent`,
            usage: "persistent",
            validate: () => true,
            exec: () => {

                this.persistent().then(r => {});

                return [Snowflake.logger.formatColor("%green%✓%reset% Persistent workers were called, it might take seconds to complete or might be already finished.\n") + "Run 'info persistent' to see if it was saved.", true, 0, false]; // message, value, statusCode, outputValue

            }
        });

        // Persistent the database
        SnowflakeCLI.command("shutdown", {
            help: `Shutdown the process and offload
the database from memory.
Usage: shutdown [?EXIT_CODE]
    [EXIT_CODE]:
    * Optional
    * Description: The exit code of the process, the default is 0

Examples: shutdown
          shutdown 1`,
            usage: "shutdown [?EXIT_CODE]",
            validate: () => true,
            exec: d => {

                const { args } = d;

                const exitCode = Math.max(parseInt(args[0] ?? 0) || 0);

                process.exit(exitCode);

                return ["Finished", true, 0, false]; // message, value, statusCode, outputValue

            }
        });

        // Aliases
        SnowflakeCLI.alias("add", "set");
        SnowflakeCLI.alias("remove", "delete");
        SnowflakeCLI.alias("rm", "delete");
        SnowflakeCLI.alias("ls", "list");
        SnowflakeCLI.alias("persist", "persistent");

        // Shortcuts
        SnowflakeCLI.shortcut("trash", "list --scope=trash");

        return this;
    }

    /**
     * Retrieves the current valid header as a Buffer.
     *
     * This method constructs a 256-byte buffer header containing:
     * - The database version
     * - The current timestamp
     * - A signature for identifying and verifying the header
     * - Other metadata
     *
     * @return {Buffer} - A Buffer containing the constructed header data.
     * @since 1.0.0
     */
    getHeader() {
        // Make an empty buffer with 256 bytes long
        const buffer = Buffer.alloc(32);

        // Write the database version to the first 2 bytes of header
        buffer.writeUInt16BE(Math.max(Snowflake.meidVersion, 1), Snowflake.HDR_POS.VERSION_CODE);

        // Write the current time to the data chunk of header
        // Data chunk starts at 128th bit, and it can store any meta-data without invalidating the header
        const time = BigInt(Math.floor(Date.now() / 1000));
        buffer.writeBigUInt64BE(time, Snowflake.HDR_POS.TIME);

        // const t = new Date().getTime().toString();
        // buffer.writeBigUInt64BE(BigInt(t.substring(0, t.length - 3)), Snowflake.HDR_POS.TIME);

        // Write the signature to the header, signatures can prevent a database file from being parsed in other places
        // Note that the signature isn't encrypted and can be extracted from key files, you may want to consider
        // encryption for that
        buffer.write(appConfig.signature, Snowflake.HDR_POS.SIGNATURE);

        return buffer;
    }

    /**
     * Checks if the given buffer header matches the specified or default valid header.
     * This method compares the first 256 bytes of the provided buffer against either a specified header or the default
     * header.
     *
     * @param {Buffer} buffer - The buffer containing the target header to be compared.
     * @param {Buffer|null} [header=null] - The original header to compare against. If `null`, the method uses the
     *     default header.
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

    /**
     * @param {boolean|number} restoreBackups - Whether to restore backup files (false) or skip them (1 or true) or
     *     remove them (2).
     */
    loadDatabase(restoreBackups = true) {

        super.loadDatabase(restoreBackups);

        const files = this.backupFiles;

        if(files.length > 0) {

            Snowflake.logger.timeStart("backup_recover");

            Snowflake.logger.log(`%cyan%[BACKUP] Recovering ${files.length} backup${files.length > 1 ? "s" : ""}...`);

            const maxBackupSize = Snowflake.convertSize(Snowflake.yaml.get("persistent.backup_size_limit", "10MB"));
            const backupInterval = Snowflake.yaml.getInt("persistent.backup_interval", 5000);
            const megaBinary = Snowflake.yaml.isTrue("memory.mb_mode")
            const aol = new SnowflakeAol({
                databasePath: this.dbPath,
                permission: null,
                maxFileSize: maxBackupSize,
                backupInterval: backupInterval,
                megaBinaryMode: megaBinary
            });

            const restoreBackup = file => {
                try {
                    const file_path = Snowflake.resolvePath(file, this.dbPath);
                    if(!fs.existsSync(file_path))
                        return false;
                    const content = fs.readFileSync(file_path).toString("utf-8");
                    if(content.trim().length === 0)
                        return 1;
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
                    return true;
                } catch(e){
                    Snowflake.logger.log(`%orange%[BACKUP] Cannot restore '${file}' backup file.`);
                }
                return false;
            }

            let backupsRestored = 0;

            for(let file of files) {
                // If restoreBackups equals to 2 it'll remove the file without restoring it
                let success = restoreBackups === 2 || restoreBackup(file);
                if(success) {
                    aol.removeFile(file);

                    // When restoring an empty backup file, no data will be restored therefor no need for persisting it
                    if(success !== 1)
                        backupsRestored++;
                }
            }

            // If any backup file was restored
            if(backupsRestored){

                // If backup files weren't deleted without restoring them
                if(restoreBackups !== 2){
                    Snowflake.logger.benchmark("Backup restored", "backup_recover");
                    Snowflake.logger.logln(`%green%[BACKUP] ${files.length} backup file${files.length > 1 ? "s" : ""} restored successfully.`);
                    Snowflake.logger.logln(`%cyan%[PERSIST] Persisting the data after backups restoration...`);

                    const startTime = performance.now();
                    this.persistent().then(r => {
                        Snowflake.logger.logln(`%green%\n[PERSIST] Persistent completed in ${(performance.now() - startTime).toFixed(2)}ms.`);
                    });
                }
                else{
                    Snowflake.logger.logln(`%magenta%[BACKUP] ${files.length} backup file${files.length > 1 ? "s were" : " was"} removed since backup was omitted.`);
                }
            }
            else{
                Snowflake.logger.logln(`%blue%[BACKUP] Nothing to restore, moving on.`);
            }

        }

        const rangeQuery = new SnowflakeRangeQuery(this.lookupData.trash);
        rangeQuery.sortBy("size");

    }

}

module.exports = new SnowflakeCoreHelper;
