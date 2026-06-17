const Snowflake = require("./Snowflake");
const SnowflakeAol = require("./SnowflakeAol");
const snowflakeEvents = require("./SnowflakeEvents");

/**
 * @class SnowflakeApi
 * @description Snowflake API handler
 * @since 1.0.0
 */
class SnowflakeApi {

    static STATUS_CODE_SUCCESS = 0;
    static STATUS_CODE_ERROR = 1;
    static STATUS_CODE_ACCESS_DENIED = 2;

    #endpoints = {};

    constructor() {

        this.addEndpoint("ping", () => {
            return this.makeResponse(true, {
                pinged: Date.now()
            })
        });

        this.addEndpoint("dbStats", data => {

            const parts = typeof data === "object" ? (data?.parts || []) : [];
            let collection = {};

            if(parts.includes("memory_monitor"))
                collection["memory_monitor"] = Snowflake.core.monitorEnabled;

            if(parts.includes("usage_percent"))
                collection["usage_percent"] = Snowflake.core.usedMemoryPercent;

            if(parts.includes("usage_bytes"))
                collection["usage_bytes"] = Snowflake.core.usedMemory;

            if(parts.includes("usage_formatted"))
                collection["usage_formatted"] = Snowflake.formatBytes(Snowflake.core.usedMemory, Snowflake.core.mbMode).replace(".00", "");

            if(parts.includes("max_db_size"))
                collection["max_db_size"] = Snowflake.core.maxMemory;

            if(parts.includes("max_db_size_formatted"))
                collection["max_db_size_formatted"] = Snowflake.formatBytes(Snowflake.core.maxMemory, Snowflake.core.mbMode).replace(".00", "");

            if(parts.includes("is_encrypted"))
                collection["is_encrypted"] = Snowflake.core.dbEncrypt;

            const memoryUsage = process.memoryUsage();

            if(parts.includes("total_heap"))
                collection["total_heap"] = memoryUsage.heapTotal;

            if(parts.includes("total_heap_formatted"))
                collection["total_heap_formatted"] = Snowflake.formatBytes(memoryUsage.heapTotal, Snowflake.core.mbMode);

            if(parts.includes("used_heap"))
                collection["used_heap"] = memoryUsage.heapUsed;

            if(parts.includes("used_heap_formatted"))
                collection["used_heap_formatted"] = Snowflake.formatBytes(memoryUsage.heapUsed, Snowflake.core.mbMode);

            if(parts.includes("meids_count"))
                collection["meids_count"] = Snowflake.core.meidsCount;

            if(parts.includes("entries_count"))
                collection["entries_count"] = Snowflake.core.getEntriesCount();

            if(parts.includes("stats")) {
                collection["stats"] = {
                    persistentStatus: Snowflake.core.isUnsaved === null ? "no_change" : Snowflake.core.isUnsaved ? "unsaved" : "saved",
                    lastPersistent: Snowflake.core.lastPersistent,
                    lastReload: Snowflake.core.lastReload
                }
            }

            return this.makeResponse(true, collection);

        }, ["db_stats"]);

        this.addEndpoint("dataTypeAnalyze", () => {

            const analyzed = {};

            Snowflake.core.analyzeValues((key, data) => {
                const { value } = data;
                let type = Snowflake.typeof(value);
                if (typeof analyzed[type] !== "number")
                    analyzed[type] = 0;
                analyzed[type]++;
            });

            return this.makeResponse(true, { analyzed });

        }, ["db_stats"]);

        this.addEndpoint("benchmark", (data, requestId) => {

            const benchmark = {};

            const { tests } = data;

            if(!Array.isArray(tests)){
                this.makeResponse(false, { msgId: "bad_request", msg: "Failed to handle your request" });
                return;
            }

            if(tests.includes("entries")){

                // Create empty list for test results
                benchmark["entries_write"] = [];
                benchmark["entries_read"] = [];
                benchmark["entries_delete"] = [];

                // Test for set/get/remove operations
                for(let entriesCount of [1, 10, 100, 1000]){

                    // ID for timing
                    const id = `${requestId}_${entriesCount}`;

                    // Set
                    Snowflake.logger.timeStart(id);
                    for(let i = 0; i < entriesCount; i++){
                        Snowflake.core.setUnsafe(id + `_${i}`, i);
                    }
                    let end = Snowflake.logger.timeEnd(id);
                    if(end){
                        benchmark["entries_write"].push({
                            entries: entriesCount,
                            time: Number(end).toFixed(4)
                        });
                    }

                    // Get
                    Snowflake.logger.timeStart(id);
                    for(let i = 0; i < entriesCount; i++){
                        Snowflake.core.get(id + `_${i}`);
                    }
                    end = Snowflake.logger.timeEnd(id);
                    if(end){
                        benchmark["entries_read"].push({
                            entries: entriesCount,
                            time: Number(end).toFixed(4)
                        });
                    }

                    // Remove
                    Snowflake.logger.timeStart(id);
                    for(let i = 0; i < entriesCount; i++){
                        Snowflake.core.remove(id + `_${i}`, false);
                    }
                    end = Snowflake.logger.timeEnd(id);
                    if(end){
                        benchmark["entries_delete"].push({
                            entries: entriesCount,
                            time: Number(end).toFixed(4)
                        });
                    }
                }

            }

            return this.makeResponse(true, { benchmark });

        }, ["db_stats"]);

        this.addEndpoint("persistent", async () => {

            if (Snowflake.core.lastPersistent + 10 * 1000 > Date.now())
                return this.makeResponse(false, {});

            const startTime = performance.now();

            try {
                await Snowflake.core.restoreAllBackupFiles();
            } catch (e){
                return this.makeResponse(false, {});
            }

            await Snowflake.core.persistent();

            const endedIn = (performance.now() - startTime).toFixed(2);

            return this.makeResponse(true, { finished: endedIn })

        }, ["db_write"]);

        this.addEndpoint("reload", () => {

            // The cooldown after each reload request is 10 seconds
            if(Snowflake.core.lastReload > 0 && Snowflake.core.lastReload + 10 * 1000 > Date.now())
                return this.makeResponse(false, {});

            const startTime = performance.now();

            Snowflake.core.reloadDatabase(1);

            const endedIn = (performance.now() - startTime).toFixed(2);

            return this.makeResponse(true, {
                finished: endedIn
            });

        }, ["db_read"]);

        this.addEndpoint("read", data => {

            let perPage = Snowflake.rangeNumber(data?.perPage, 1, 100, 10);
            let currentPage = Snowflake.rangeNumber(data?.currentPage, 0, null, 0);

            const posStart = currentPage * perPage,
                posEnd = posStart + perPage;

            const list = Snowflake.core.analyzeValues((keyHash, data) => {

                const key = Snowflake.core.getKeyFromHash(keyHash);

                if (key) {

                    const { value, index } = data;
                    const size = typeof data.bytes === "number"
                                 ? data.bytes
                                 : (Snowflake.roughSizeOf(value) + 36); // The size of the address bits (4 bytes) and the hash (32 bytes)

                    return {
                        key,
                        keyHash,
                        size,
                        index: index + 1,
                        value: SnowflakeAol.stringify(value),
                        type: Snowflake.typeof(value),
                        location: index,
                        totalSize: size + Snowflake.roughSizeOf(key) + 36, // The size of the address bits (4 bytes) and the hash (32 bytes)
                    }

                }

            }, posStart, posEnd);

            return this.makeResponse(true, {
                list,
                entriesCount: Snowflake.core.getEntriesCount()
            });

        }, ["db_read"]);

        this.addEndpoint("set", data => {

            let { key, value } = data;
            const stringified = typeof data.stringified !== "undefined" && Boolean(data.stringified);

            if(stringified)
                value = SnowflakeAol.parse(value);

            if(typeof key === "string" && typeof value !== "undefined"){

                // Will be sanitized
                const state = Snowflake.core.set(key, value);
                if(state > 0)
                    return this.makeResponse(true, { state });

            }

        }, ["db_write"]);

        this.addEndpoint("get", data => {

            const key = data.key;

            if(typeof key === "string"){

                let value = Snowflake.core.get(key, Snowflake.DUMMY.UNDEF);

                if (value === Snowflake.DUMMY.UNDEF) {

                    return this.makeResponse(false, {
                        msgId: "not_found",
                        msg: "The given key doesn't exist"
                    });

                }

                return this.makeResponse(true, {
                    value,
                    type: Snowflake.typeof(value)
                });

            }

        }, ["db_read"]);

        this.addEndpoint("remove", data => {

            const key = data.key;

            if(typeof key === "string"){
                if(Snowflake.core.remove(key))
                    return this.makeResponse(true, {});
                else
                    return this.makeResponse(false, { msgId: "failed", msg: "Failed" });
            }

        }, ["db_write"]);

        this.addEndpoint("getConfig", () => {

            return this.makeResponse(true, { config: Snowflake.yaml.yaml, changed: Snowflake.yaml.changed });

        }, ["change_config"]);

        this.addEndpoint("updateConfigs", data => {

            const userConfig = Snowflake.sanitizeConfiguration(data);

            Snowflake.yaml.merge(userConfig).save();

            return this.makeResponse(true, {});

        }, ["change_config"]);

        this.addEndpoint("restart", () => {

            // [SnowflakeEventEmit]: request_restart
            snowflakeEvents.emit("request_restart");

            return this.makeResponse(true, {});

        }, ["manage"]);

    }

    /**
     * Add a new endpoint to API handler
     * @param {string} endpointName - Endpoint name
     * @param {(data: object, requestId: string, payload: object, access: AccessToken) => object} callback - Endpoint
     *     callback (must return an object like `{ success: true, response: {...} }`)
     * @param {array} permissions - The list of permissions required for this endpoint
     * @return {SnowflakeApi} - For method chaining
     * @since 1.0.0
     */
    addEndpoint(endpointName, callback, permissions = []){

        // Endpoint already exists
        if(typeof this.#endpoints[endpointName] !== "undefined")
            return this;

        if(!Array.isArray(permissions))
            permissions = [];

        this.#endpoints[endpointName] = {
            callback, permissions
        };

        return this;
    }

    /**
     * Create response object
     * @param {boolean} success - Whether the task was successful
     * @param {any} data - Response data, preferably an object
     * @param {number|null} statusCode - The status code, pass null to set it based on `success` state
     * @return {{success, response, statusCode: (number)}}
     * @since 1.0.0
     */
    makeResponse(success, data, statusCode = null){
        if(statusCode === null)
            statusCode = success ? SnowflakeApi.STATUS_CODE_SUCCESS : SnowflakeApi.STATUS_CODE_ERROR;
        return { success, response: data, statusCode };
    }

    /**
     * Create the response object for access denial
     * @return {{success, response, statusCode: number}}
     * @since 1.0.0
     */
    accessDenied(){
        return this.makeResponse(false, {}, SnowflakeApi.STATUS_CODE_ACCESS_DENIED);
    }

    /**
     * Call an endpoint and wait for response
     * @param {object} payload - Received data from user (request object)
     * @param {AccessToken} access - Access token object for authorization
     * @return {Promise<*|{success, response, statusCode: number}>}
     * @since 1.0.0
     */
    async call(payload, access) {

        const { endpoint, data, requestId, ...rest } = payload;

        if(typeof this.#endpoints[endpoint] === "object"){

            const { callback, permissions } = this.#endpoints[endpoint];

            if(permissions.length > 0){
                for(let permission of permissions){
                    if(!access.hasAccess(permission))
                        return this.accessDenied();
                }
            }

            if(typeof callback === "function"){
                const response = await callback(data, requestId, payload, access);
                if(typeof response === "object" && response)
                    return response;
            }

        }

        // No response was sent before this point
        return this.makeResponse(false, {
            msgId: "bad_request",
            msg: "Failed to handle your request"
        });

    }

    // TODO: Remove this
    async oldCall(payload, access){

        const { endpoint, data, requestId, ...rest } = payload;

        if (endpoint === "ping") {
            return this.makeResponse(true, {
                pinged: Date.now()
            });
        }

        else if (endpoint === "dbStats") {

            if(!access.hasAccess("db_stats"))
                return this.accessDenied();

            const parts = typeof data === "object" ? (data?.parts || []) : [];
            let collection = {};

            if(parts.includes("memory_monitor"))
                collection["memory_monitor"] = Snowflake.core.monitorEnabled;

            if(parts.includes("usage_percent"))
                collection["usage_percent"] = Snowflake.core.usedMemoryPercent;

            if(parts.includes("usage_bytes"))
                collection["usage_bytes"] = Snowflake.core.usedMemory;

            if(parts.includes("usage_formatted"))
                collection["usage_formatted"] = Snowflake.formatBytes(Snowflake.core.usedMemory, Snowflake.core.mbMode).replace(".00", "");

            if(parts.includes("max_db_size"))
                collection["max_db_size"] = Snowflake.core.maxMemory;

            if(parts.includes("max_db_size_formatted"))
                collection["max_db_size_formatted"] = Snowflake.formatBytes(Snowflake.core.maxMemory, Snowflake.core.mbMode).replace(".00", "");

            if(parts.includes("is_encrypted"))
                collection["is_encrypted"] = Snowflake.core.dbEncrypt;

            const memoryUsage = process.memoryUsage();

            if(parts.includes("total_heap"))
                collection["total_heap"] = memoryUsage.heapTotal;

            if(parts.includes("total_heap_formatted"))
                collection["total_heap_formatted"] = Snowflake.formatBytes(memoryUsage.heapTotal, Snowflake.core.mbMode);

            if(parts.includes("used_heap"))
                collection["used_heap"] = memoryUsage.heapUsed;

            if(parts.includes("used_heap_formatted"))
                collection["used_heap_formatted"] = Snowflake.formatBytes(memoryUsage.heapUsed, Snowflake.core.mbMode);

            if(parts.includes("meids_count"))
                collection["meids_count"] = Snowflake.core.meidsCount;

            if(parts.includes("entries_count"))
                collection["entries_count"] = Snowflake.core.getEntriesCount();

            if(parts.includes("stats")) {
                collection["stats"] = {
                    persistentStatus: Snowflake.core.isUnsaved === null ? "no_change" : Snowflake.core.isUnsaved ? "unsaved" : "saved",
                    lastPersistent: Snowflake.core.lastPersistent,
                    lastReload: Snowflake.core.lastReload
                }
            }

            return this.makeResponse(true, collection);
        }

        else if(endpoint === "dataTypeAnalyze"){

            if(!access.hasAccess("db_stats"))
                return this.accessDenied();

            const analyzed = {};

            Snowflake.core.analyzeValues((key, data) => {
                const { value } = data;
                let type = Snowflake.typeof(value);
                if (typeof analyzed[type] !== "number")
                    analyzed[type] = 0;
                analyzed[type]++;
            });

            return this.makeResponse(true, { analyzed });

        }

        else if(endpoint === "benchmark"){

            if(!access.hasAccess("db_stats"))
                return this.accessDenied();

            const benchmark = {};

            const { tests } = data;

            if(!Array.isArray(tests)){
                this.makeResponse(false, { msgId: "bad_request", msg: "Failed to handle your request" });
                return;
            }

            if(tests.includes("entries")){

                // Create empty list for test results
                benchmark["entries_write"] = [];
                benchmark["entries_read"] = [];
                benchmark["entries_delete"] = [];

                // Test for set/get/remove operations
                for(let entriesCount of [1, 10, 100, 1000]){

                    // ID for timing
                    const id = `${requestId}_${entriesCount}`;

                    // Set
                    Snowflake.logger.timeStart(id);
                    for(let i = 0; i < entriesCount; i++){
                        Snowflake.core.setUnsafe(id + `_${i}`, i);
                    }
                    let end = Snowflake.logger.timeEnd(id);
                    if(end){
                        benchmark["entries_write"].push({
                            entries: entriesCount,
                            time: Number(end).toFixed(4)
                        });
                    }

                    // Get
                    Snowflake.logger.timeStart(id);
                    for(let i = 0; i < entriesCount; i++){
                        Snowflake.core.get(id + `_${i}`);
                    }
                    end = Snowflake.logger.timeEnd(id);
                    if(end){
                        benchmark["entries_read"].push({
                            entries: entriesCount,
                            time: Number(end).toFixed(4)
                        });
                    }

                    // Remove
                    Snowflake.logger.timeStart(id);
                    for(let i = 0; i < entriesCount; i++){
                        Snowflake.core.remove(id + `_${i}`, false);
                    }
                    end = Snowflake.logger.timeEnd(id);
                    if(end){
                        benchmark["entries_delete"].push({
                            entries: entriesCount,
                            time: Number(end).toFixed(4)
                        });
                    }
                }

            }

            return this.makeResponse(true, { benchmark });

        }

        else if(endpoint === "persistent"){

            if(!access.hasAccess("db_write"))
                return this.accessDenied();

            if(Snowflake.core.lastPersistent + 10 * 1000 > Date.now())
                return this.makeResponse(false, {});

            const startTime = performance.now();

            await Snowflake.core.persistent();

            const endedIn = (performance.now() - startTime).toFixed(2);

            return this.makeResponse(true, { finished: endedIn })

        }

        else if(endpoint === "reload"){

            if(!access.hasAccess("db_read"))
                return this.accessDenied();

            if(Snowflake.core.lastReload > 0 && Snowflake.core.lastReload + 10 * 1000 > Date.now())
                return this.makeResponse(false, {});

            const startTime = performance.now();

            Snowflake.core.reloadDatabase(1);

            const endedIn = (performance.now() - startTime).toFixed(2);

            return this.makeResponse(true, {
                finished: endedIn
            })

        }

        else if(endpoint === "read"){

            if(!access.hasAccess("db_read"))
                return this.accessDenied();

            let perPage = Snowflake.rangeNumber(data?.perPage, 1, 100, 10);
            let currentPage = Snowflake.rangeNumber(data?.currentPage, 0, null, 0);

            const posStart = currentPage * perPage,
                posEnd = posStart + perPage;

            const list = Snowflake.core.analyzeValues((keyHash, data) => {

                const key = Snowflake.core.getKeyFromHash(keyHash);

                if (key) {

                    const { value, index } = data;
                    const size = typeof data.bytes === "number"
                                 ? data.bytes
                                 : (Snowflake.roughSizeOf(value) + 36); // The size of the address bits (4 bytes) and the hash (32 bytes)

                    return {
                        key,
                        keyHash,
                        size,
                        index: index + 1,
                        value: SnowflakeAol.stringify(value),
                        type: Snowflake.typeof(value),
                        location: index,
                        totalSize: size + Snowflake.roughSizeOf(key) + 36, // The size of the address bits (4 bytes) and the hash (32 bytes)
                    }

                }

            }, posStart, posEnd);

            return this.makeResponse(true, {
                list,
                entriesCount: Snowflake.core.getEntriesCount()
            });

        }

        else if(endpoint === "set"){

            if(!access.hasAccess("db_write"))
                return this.accessDenied();

            let { key, value } = data;
            const stringified = typeof data.stringified !== "undefined" && Boolean(data.stringified);

            if(stringified)
                value = SnowflakeAol.parse(value);

            if(typeof key === "string" && typeof value !== "undefined"){

                // Will be sanitized
                const state = Snowflake.core.set(key, value);
                if(state > 0)
                    return this.makeResponse(true, { state });

            }

        }

        else if(endpoint === "get"){

            if(!access.hasAccess("db_read"))
                return this.accessDenied();

            const key = data.key;

            if(typeof key === "string"){

                let value = Snowflake.core.get(key, Snowflake.DUMMY.UNDEF);

                if (value === Snowflake.DUMMY.UNDEF) {

                    return this.makeResponse(false, {
                        msgId: "not_found",
                        msg: "The given key doesn't exist"
                    });

                }

                return this.makeResponse(true, {
                    value,
                    type: Snowflake.typeof(value)
                });

            }

        }

        else if(endpoint === "remove"){

            if(!access.hasAccess("db_write"))
                return this.accessDenied();

            const key = data.key;

            if(typeof key === "string"){
                if(Snowflake.core.remove(key))
                    return this.makeResponse(true, {});
                else
                    return this.makeResponse(false, { msgId: "failed", msg: "Failed" });
            }

        }

        else if(endpoint === "getConfig"){

            if(!access.hasAccess("change_config"))
                return this.accessDenied();

            return this.makeResponse(true, { config: Snowflake.yaml.yaml, changed: Snowflake.yaml.changed });

        }

        else if(endpoint === "updateConfigs"){

            if(!access.hasAccess("change_config"))
                return this.accessDenied();

            const userConfig = Snowflake.sanitizeConfiguration(data);

            Snowflake.yaml.merge(userConfig).save();

            return this.makeResponse(true, {});

        }

        else if(endpoint === "restart"){

            if(!access.hasAccess("manage"))
                return this.accessDenied();

            // [SnowflakeEventEmit]: request_restart
            snowflakeEvents.emit("request_restart");

            return this.makeResponse(true, {});

        }

        // No response was sent before this point
        return this.makeResponse(false, {
            msgId: "bad_request",
            msg: "Failed to handle your request"
        });

    }


}

module.exports = SnowflakeApi;