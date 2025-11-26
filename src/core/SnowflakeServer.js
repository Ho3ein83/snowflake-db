const {v4: uuid4} = require("uuid");
const Snowflake = require("./Snowflake");
const SnowflakeEvents = require("./SnowflakeEvents");
const SnowflakeCLI = require("./SnowflakeCLI");

const express = require("express");
const app = express();
const http = require("http");
const httpServer = http.createServer(app);
const { server: WebSocketServer, request: WebSocketRequest} = require("websocket");
const appConfig = require("../../app.json");
const { isArray } = require("msgpack-lite/lib/bufferish");
const SnowflakeAol = require("./SnowflakeAol");
const path = require("path");
const fs = require("fs");

// noinspection JSValidateJSDoc
/**
 * @class SnowflakeServer
 * @description Server class for Snowflake
 * @since 1.0.0
 */
class SnowflakeServer {

    /**
     * Whether the server is started
     * @type {boolean}
     * @since 1.0.0
     */
    #started = false;

    /**
     * Websocket object
     * @type {WebSocketServer}
     * @since 1.0.0
     */
    #socket;

    /**
     * SnowflakeCLI instance or null if CLI is not initialized
     * @type {import("./SnowflakeCLI")|null}
     * @since 1.0.0
     */
    #cli = null;

    /**
     * Websocket login attempts
     * @type {{[ip: string]: {firstAttempt: number, lastAttempt: number, attempts: number}}}
     * @since 1.0.0
     */
    #attempts = {};

    /**
     * Max login attempts allowed for websocket authorization
     * @type {number}
     * @since 1.0.0
     */
    #maxLoginAttempt = 0;

    /**
     * Login attempt cooldown
     * @type {number}
     * @since 1.0.0
     */
    #loginAttemptCooldown = 0;

    /**
     * The list of connected clients to the websocket
     * @type {Map<string, WebSocketConnection>}
     * @since 1.0.0
     */
    #connections = new Map();

    /**
     * The list of clients IP with their UUID connected to websocket
     * @type {{[uuid: string]: {ip: string, uuid: string, access: AccessToken}}}
     * @since 1.0.0
     */
    #clients = {};

    constructor() {}

    /**
     * Handle HTTP requests from everywhere
     * @param {*,IncomingMessage} req
     * @param {*,ServerResponse} res
     * @since 1.0.0
     */
    handleAll(req, res){
        if(!Snowflake.yaml.isTrue("server.home_page"))
            res.sendStatus(404);
        else
            res.sendFile(process.env.PWD + "/src/view/index.html");
    }

    /**
     * Handle 404 pages
     * @param {*,IncomingMessage} req
     * @param {*,ServerResponse} res
     * @since 1.0.0
     */
    handle404(req, res){
        res.sendStatus(404);
    }

    /**
     * Initialize GUI application
     * @since 1.0.0
     */
    #initGuiApp(){

        // Resolve absolute path to dist/gui
        const guiPath = path.join(process.env.PWD, "src/view/gui");

        // Serve index.html for /gui route
        function serveGui(req, res){
            const indexPath = path.join(guiPath, "index.html");
            fs.readFile(indexPath, "utf8", (err, html) => {
                if (err)
                    return res.status(500).send("Error loading app");

                const guiHost = Snowflake.yaml.get("server.gui_host");
                const guiSecured = Snowflake.yaml.isTrue("server.secure_gui");

                // Replace host & port dynamically
                const replaced = html.replace(
                    /("host":\s*).*(,)/,
                    `$1${guiHost === "auto" ? "window.location.hostname" : `"${guiHost}"`}$2`
                ).replace(
                    /("port":\s*)\d+/,
                    `$1${Snowflake.yaml.getInt("server.port")}`
                ).replace(
                    /("secure":\s*).*(,)/,
                    `$1${guiSecured ? "true" : "false"}$2`
                );

                res.send(replaced);
            });
        }


        // 1) Serve static assets (JS, CSS, images) at /gui/*
        this.app.use("/gui", express.static(guiPath, {
            index: false // <-- don’t auto-serve index.html
        }));

        // 2) Serve modified index.html for /gui and /gui/index.html
        this.app.get("/gui", serveGui);
        this.app.get("/gui/index.html", serveGui);

        // 3) Catch-all for React Router routes inside /gui
        this.app.get("/gui/*", serveGui);

    }

    /**
     * Verify websocket request origin, protocol and authentication keys
     * @param {WebSocketRequest} request
     * @since 1.0.0
     */
    verifySocketRequest(request) {

        // The IP of the client trying to connect to websocket
        const ip = request.httpRequest.socket.remoteAddress;

        if(typeof this.#attempts[ip] === "object"){
            const { attempts, firstAttempt } = this.#attempts[ip];

            if (firstAttempt + this.#loginAttemptCooldown * 1000 <= Date.now()) {
                delete this.#attempts[ip];
            }
            else {
                // If login attempts reached
                if (attempts >= this.#maxLoginAttempt) {

                    // Reject the connection
                    request.reject(4001, "Unauthorized");

                    SnowflakeEvents.emit("socket_origin_reject", null);

                    SnowflakeEvents.emit("socket_login_attempt", {
                        success: false,
                        cause: "attempts_reached",
                        client: ip,
                        attempts: attempts
                    });

                    return;

                }
            }

        }

        // Check if origin is allowed
        if(!Snowflake.core.originIsAllowed(request.origin, null)) {

            // Reject the connection
            request.reject(4001, "Unauthorized");

            Snowflake.logger.warning(`Origin '${request.origin}' was rejected.`, "socket");

            SnowflakeEvents.emit("socket_origin_reject", request.origin);

            // Record login attempt
            SnowflakeEvents.emit("socket_login_attempt", {
                success: false,
                origin: request.origin,
                cause: "origin",
                client: ip
            });

            return;

        }

        const params = new URLSearchParams(request.resourceURL.search);

        if(!params.has("token")){

            // Reject the connection
            request.reject(4001, "Unauthorized");

            Snowflake.logger.warning(`Websocket connection rejected because no token was given.`, "socket");

            SnowflakeEvents.emit("socket_token_reject", null);

            SnowflakeEvents.emit("socket_login_attempt", {
                success: false,
                token: "",
                cause: "credential",
                client: ip
            });

            return;

        }

        // Check if the given token is valid
        const token = params.get("token");
        const authentication = Snowflake.authenticateToken(token);

        if(!authentication){

            // Reject the connection
            request.reject(4001, "Unauthorized");

            Snowflake.logger.warning(`Websocket connection rejected because the given token was invalid.`, "socket");

            SnowflakeEvents.emit("socket_token_reject", token);

            SnowflakeEvents.emit("socket_login_attempt", {
                success: false,
                token: token,
                cause: "credential",
                client: ip
            });

            return;

        }

        // Can't use the websocket if no permission was given to the token
        if(!authentication.hasAccess("control_panel")){

            // Reject the connection
            request.reject(4001, "Unauthorized");

            Snowflake.logger.warning(`Websocket connection rejected because the given token doesn't have enough permission to web interface.`, "socket");

            SnowflakeEvents.emit("socket_token_reject", token);

            return;

        }

        // Accept the connection
        const connection = request.accept(null, request.origin);

        // Create a UUID for the new client
        const uuid = uuid4();

        // Add the connection to the list
        this.#connections.set(uuid, connection);

        // Add the client to the list
        this.#clients[uuid] = {
            uuid: uuid,
            ip: ip,
            access: authentication
        };

        // Remove the connection when it disconnects
        connection.on("close", () => {

            Snowflake.logger.info(`Connection with %underline%${uuid}%no_underline% UUID was closed.`, "socket");

            // Remove from connections list
            this.#connections.delete(uuid);

            // Remove from clients list
            this.#clients[uuid] = null;
            delete this.#clients[uuid];

        });

        // Handle messages
        connection.on("message", message => this.#handleClientMessage(uuid, message));

        // Send application information
        this.sendSuccessResponse(connection, ":accepted", {
            msgId: "request_accepted",
            msg: "Connection request accepted",
            info: Snowflake.core.getInfo(),
            access: authentication.export()
        });

        Snowflake.logger.info(`New connection accepted using %underline%${request.origin}%no_underline% origin with UUID: %underline%${uuid}%no_underline%`, "socket");

        SnowflakeEvents.emit("socket_origin_accept", connection);

        // Record login attempt
        SnowflakeEvents.emit("socket_login_attempt", {
            success: true,
            token: token,
            cause: "credential",
            client: ip
        });

    }

    /**
     * Initialize websocket
     * @since 1.0.0
     */
    #initSocket(){

        SnowflakeEvents.on("socket_login_attempt", data => {

            // If client IP is set
            if(typeof data.client === "string"){

                // Deconstruct the data
                const { success, token, cause, client, origin, attempts } = data;

                // Failed login attempt
                if(!success){
                    const now = Date.now();

                    // If this is the first attempt
                    if(typeof this.#attempts[client] !== "object"){

                        // Create the first attempt object
                        this.#attempts[client] = {
                            attempts: 1,
                            firstAttempt: now,
                            lastAttempt: now
                        }

                    }
                    else{

                        // Update attempts count
                        this.#attempts[client].attempts++;

                        // Update the last attempt time
                        this.#attempts[client].lastAttempt = now;

                    }
                }

                let log = null;
                if(cause === "credential"){
                    log = `[${Snowflake.logger.getTime()}] ${success ? "Successful login to websocket" : "Websocket login failed"}, Token: ${token || "(empty)"}, IP: ${client || "N/A"}`;
                }
                else if(cause === "origin" && !success){
                    log = `[${Snowflake.logger.getTime()}] Websocket login failed, cause: origin '${origin}' is not acceptable.`;
                }
                else if(cause === "attempts_reached"){

                    if(attempts <= 10)
                        log = `[${Snowflake.logger.getTime()}] Websocket login failed, cause: max login attempt is reached, ip: ${client || "N/A"}`;

                    if(attempts === 10)
                        log += `, a client attempted to login with an invalid token more than 10 times, disabling logs for this client.`;

                    if(log)
                        log += ".";

                }

                if(log) {
                    // Report login attempt (both successful and failed attempts)
                    Snowflake.logger.logFile(log + "\n", "logins", true);
                }

            }

        });

        this.#socket.on("request", this.verifySocketRequest.bind(this));

    }

    /**
     * Handle client messages and respond with appropriate message
     * @param {string} uuid - The UUID of the client
     * @param {{ type: string, utf8Data: string }} message
     * @since 1.0.0
     */
    #handleClientMessage(uuid, message){

        if(!this.#connections.has(uuid) || typeof this.#clients[uuid] !== "object")
            return;

        const connection = this.#connections.get(uuid);

        const access = this.#clients[uuid].access;

        try{

            // TODO: Cleanup this shit, add it to another method or function with better permission management

            if(message.type === "utf8") {

                const json = JSON.parse(message.utf8Data);

                const { endpoint, data, requestId, ...rest } = json;

                let accessDenied = !access.hasAccess("control_panel");

                if(!accessDenied) {

                    if (endpoint === "ping") {
                        this.sendSuccessResponse(connection, requestId, {
                            pinged: Date.now()
                        });
                        return;
                    }
                    else if (endpoint === "dbStats") {
                        if(access.hasAccess("db_stats")){

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

                            this.sendSuccessResponse(connection, requestId, collection);
                            return;

                        }
                        else{
                            accessDenied = true;
                        }
                    }
                    else if(endpoint === "dataTypeAnalyze"){

                        if(access.hasAccess("db_stats")) {

                            const analyzed = {};

                            Snowflake.core.analyzeValues((key, data) => {
                                const { value } = data;
                                let type = Snowflake.typeof(value);
                                if (typeof analyzed[type] !== "number")
                                    analyzed[type] = 0;
                                analyzed[type]++;
                            });

                            this.sendSuccessResponse(connection, requestId, {
                                analyzed
                            });

                            return;

                        }
                        else{
                            accessDenied = true;
                        }

                    }
                    else if(endpoint === "benchmark"){

                        if(access.hasAccess("db_stats")) {

                            const benchmark = {};

                            const { tests } = data;

                            if(!Array.isArray(tests)){
                                this.sendErrorResponse(connection, requestId, { msgId: "bad_request", msg: "Failed to handle your request" });
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

                            this.sendSuccessResponse(connection, requestId, {
                                benchmark
                            });

                            return;

                        }
                        else{
                            accessDenied = true;
                        }

                    }
                    else if(endpoint === "persistent"){

                        if(Snowflake.core.lastPersistent + 10 * 1000 > Date.now()){
                            this.sendErrorResponse(connection, requestId, {});
                            return;
                        }

                        (async () => {
                            const startTime = performance.now();
                            await Snowflake.core.persistent();
                            const endedIn = (performance.now() - startTime).toFixed(2);
                            this.sendSuccessResponse(connection, requestId, {
                                finished: endedIn
                            })
                        })()

                        return;

                    }
                    else if(endpoint === "reload"){

                        if(Snowflake.core.lastReload > 0 && Snowflake.core.lastReload + 10 * 1000 > Date.now()){
                            this.sendErrorResponse(connection, requestId, {});
                            return;
                        }

                        const startTime = performance.now();

                        Snowflake.core.reloadDatabase(1);

                        const endedIn = (performance.now() - startTime).toFixed(2);

                        this.sendSuccessResponse(connection, requestId, {
                            finished: endedIn
                        })

                        return;

                    }
                    else if(endpoint === "read"){

                        if(access.hasAccess("db_read")) {

                            let perPage = Snowflake.rangeNumber(data?.perPage, 1, 100, 10);
                            let currentPage = Snowflake.rangeNumber(data?.currentPage, 0, null, 0);

                            const posStart = currentPage * perPage,
                                posEnd = posStart + perPage;

                            const list = Snowflake.core.analyzeValues((keyHash, data, index) => {

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

                            this.sendSuccessResponse(connection, requestId, {
                                list,
                                entriesCount: Snowflake.core.getEntriesCount()
                            });

                            return;

                        }
                        else{
                            accessDenied = true;
                        }
                    }
                    else if(endpoint === "set"){

                        if(access.hasAccess("db_write")){

                            let { key, value } = data;
                            const stringified = typeof data.stringified !== "undefined" && Boolean(data.stringified);

                            if(stringified)
                                value = SnowflakeAol.parse(value);

                            if(typeof key === "string" && typeof value !== "undefined"){

                                // Will be sanitized
                                const state = Snowflake.core.set(key, value);
                                if(state > 0){
                                    this.sendSuccessResponse(connection, requestId, { state });
                                    return;
                                }

                            }

                        }
                        else{
                            accessDenied = true;
                        }

                    }
                    else if(endpoint === "get"){

                        if(access.hasAccess("db_read")){

                            const key = data.key;

                            if(typeof key === "string"){

                                let value = Snowflake.core.get(key, Snowflake.DUMMY.UNDEF);

                                if (value === Snowflake.DUMMY.UNDEF) {
                                    this.sendErrorResponse(connection, requestId, {
                                        msgId: "not_found",
                                        msg: "The given key doesn't exist"
                                    });
                                    return;
                                }

                                this.sendSuccessResponse(connection, requestId, {
                                    value,
                                    type: Snowflake.typeof(value)
                                });
                                return;

                            }

                        }
                        else{
                            accessDenied = true;
                        }

                    }
                    else if(endpoint === "remove"){

                        if(access.hasAccess("db_write")){

                            const key = data.key;

                            if(typeof key === "string"){
                                if(Snowflake.core.remove(key)){
                                    this.sendSuccessResponse(connection, requestId);
                                    return;
                                }
                            }

                        }
                        else{
                            accessDenied = true;
                        }

                    }

                }

                if(accessDenied){

                    // Do not handle the request of doesn't have enough permission
                    this.sendErrorResponse(connection, requestId, {
                        msgId: "forbidden",
                        msg: "Access denied"
                    });

                    return;

                }

                this.sendErrorResponse(connection, requestId, {
                    msgId: "bad_request",
                    msg: "Failed to handle your request"
                });

            }

        } catch (e){
            if(appConfig.is_development)
                 console.log("Client message was invalid or not a JSON string:", e);
        }

        this.sendErrorResponse(connection, "_" + Math.random().toString().substring(3));

    }

    /**
     * Initialize Express app
     * @since 1.0.0
     */
    #initApp(){

        // Handle HTTP server requests
        if(Snowflake.yaml.isTrue("server.http_server")) {

            this.#initGuiApp();

            this.app.get("/", this.handleAll);

            this.app.get("*", this.handle404);

        }

    }

    /**
     * Start CLI server
     * @param {number} cli_port - The port of TCP server for CLI
     * @return {boolean} - True on success, false otherwise
     * @since 1.0.0
     */
    #startCLI(cli_port){
        if(this.#cli !== null)
            return false;
        this.#cli = SnowflakeCLI.start(cli_port);
        return true;
    }

    /**
     * Start and initialize server
     * @param {number|null} port - Server port
     * @return {SnowflakeServer}
     * @since 1.0.0
     */
    start(port=null){

        // Set login attempt values
        this.#maxLoginAttempt = Math.max(Snowflake.yaml.getInt("server.max_cli_login_attempt"), 0);
        this.#loginAttemptCooldown = Math.max(Snowflake.yaml.getInt("server.cli_cooldown"), 5);

        // Prevent from initializing again
        if(this.#started){
            Snowflake.logger.info("Server already started, no need to restart.");
            return this;
        }

        // Use default port if needed
        if(port === null)
            port = Snowflake.yaml.getInt("server.port");

        // Terminate the process if the port hasn't been given
        if(!port)
            Snowflake.logger.assert("You haven't assigned any port in configuration file or the port is invalid.");

        Snowflake.logger.log("%cyan%[SERVER] Initializing HTTP server and websocket...");

        // Make a new HTTP server
        const httpServer = http.createServer(app);

        this.#socket = new WebSocketServer({
            httpServer: httpServer,
            autoAcceptConnections: false
        });

        if(typeof httpServer !== "object" || httpServer.constructor.name !== "Server") {
            Snowflake.logger.assert("An error has occurred while trying to start the HTTP server, the 'httpServer' " +
                "object is not an instance of 'Server' class.");
        }

        httpServer.on("error", (e) => {
            Snowflake.logger.assert(e.toString(), 1, "server");
        });

        httpServer.listen(port, () => {
            let {address, family} = httpServer.address();
            if(address === "::")
                address = "0.0.0.0";
            Snowflake.logger.logln(`%cyan%[SERVER] Webserver is available on ${address}:${port}${family ? `, IP family: ${family}.` : ""}`);
            Snowflake.logger.logln(`%cyan%[GUI] GUI is available on %underline%127.0.0.1:${port}/gui%no_underline%`);
            SnowflakeEvents.emit("server_start", httpServer);

        });

        this.#initApp();

        this.#initSocket();

        this.#started = true;

        const cli_port = Snowflake.yaml.getInt("server.cli_port");

        if(cli_port)
            SnowflakeEvents.on("core_after_start", () => this.#startCLI(cli_port));

        return this;

    }

    /**
     * Send response to a client
     * @param {WebSocketConnection} connection
     * @param {string} requestId
     * @param {object} data
     * @param {boolean} success
     * @return SnowflakeServer
     * @since 1.0.0
     */
    sendResponse(connection, requestId, data    , success){
        connection.send(JSON.stringify({
            data, requestId, success
        }));
        return this;
    }

    /**
     * Send response to a client with success status
     * @param {WebSocketConnection} connection
     * @param {string} requestId
     * @param {object} data
     * @return SnowflakeServer
     * @since 1.0.0
     */
    sendSuccessResponse(connection, requestId, data = {}){
        return this.sendResponse(connection, requestId, data, true);
    }

    /**
     * Send response to a client with error status
     * @param {WebSocketConnection} connection
     * @param {string} requestId
     * @param {object} data
     * @return SnowflakeServer
     * @since 1.0.0
     */
    sendErrorResponse(connection, requestId, data = {}){
        return this.sendResponse(connection, requestId, data, false);
    }

    /**
     * Get websocket server instance
     * @return {WebSocketServer}
     * @since 1.0.0
     */
    get socket(){
        return this.#socket;
    }

    /**
     * Get Express app instance
     * @return {*|Express}
     * @since 1.0.0
     */
    get app(){
        return app;
    }

    /**
     * Get HTTP server instance
     * @return {Server<typeof IncomingMessage, typeof ServerResponse>}
     * @since 1.0.0
     */
    get httpServer(){
        return httpServer;
    }

}

module.exports = new SnowflakeServer();