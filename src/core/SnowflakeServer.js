const {v4: uuid4} = require("uuid");
const Snowflake = require("./Snowflake");
const snowflakeEvents = require("./SnowflakeEvents");
const snowflakeCLI = require("./SnowflakeCLI");
const SnowflakeApi = require("./SnowflakeApi");

const express = require("express");
const app = express();
const http = require("http");
const httpServer = http.createServer(app);
const { server: WebSocketServer, request: WebSocketRequest} = require("websocket");
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
     * HTTP server object
     * @type {Server}
     * @since 1.0.0
     */
    #http;

    /**
     * SnowflakeCLI instance or null if CLI is not initialized
     * @type {SnowflakeCLI}
     * @since 1.0.0
     */
    #cli;

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
            res.sendFile(Snowflake.path + "/src/view/index.html");
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
        const guiPath = path.join(Snowflake.path, "src/view/gui");

        // Serve index.html for /gui route
        function serveGui(req, res){
            const indexPath = path.join(guiPath, "index.html");
            fs.readFile(indexPath, "utf8", (err, html) => {
                if (err)
                    return res.status(500).send(`Error loading app:<br><pre><code>${err}</code></pre>`);

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

                    // [SnowflakeEventEmit]: socket_origin_reject @ null|string
                    snowflakeEvents.emit("socket_origin_reject", null); // Request origin = null

                    // [SnowflakeEventEmit]: socket_login_attempt
                    snowflakeEvents.emit("socket_login_attempt", {
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

            Snowflake.logger.warning(`Origin '${request.origin}' was rejected.`, "socket", "server");

            // [SnowflakeEventEmit]: socket_origin_reject @ null|string
            snowflakeEvents.emit("socket_origin_reject", request.origin);

            // [SnowflakeEventEmit]: socket_login_attempt @ {success:false,origin:string|null,cause:string,client:string}
            snowflakeEvents.emit("socket_login_attempt", {
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

            Snowflake.logger.warning(`Websocket connection rejected because no token was given.`, "socket", "server");

            // [SnowflakeEventEmit]: socket_token_reject @ null|string
            snowflakeEvents.emit("socket_token_reject", null);

            // [SnowflakeEventEmit]: socket_login_attempt @ {success:false,token:string,cause:string,client:string}
            snowflakeEvents.emit("socket_login_attempt", {
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

            Snowflake.logger.warning(`Websocket connection rejected because the given token was invalid.`, "socket", "server");

            // [SnowflakeEventEmit]: socket_token_reject @ string
            snowflakeEvents.emit("socket_token_reject", token);

            // [SnowflakeEventEmit]: socket_login_attempt @ {success:false,token:string,cause:string,client:string}
            snowflakeEvents.emit("socket_login_attempt", {
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

            Snowflake.logger.warning(`Websocket connection rejected because the given token doesn't have enough permission to web interface.`, "socket", "server");

            // [SnowflakeEventEmit]: socket_token_reject @ string
            snowflakeEvents.emit("socket_token_reject", token);

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

            Snowflake.logger.info(`Connection with %underline%${uuid}%no_underline% UUID was closed.`, "socket", "server");

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

        Snowflake.logger.info(`New connection accepted using %underline%${request.origin}%no_underline% origin with UUID: %underline%${uuid}%no_underline%`, "socket", "server");

        // [SnowflakeEventEmit]: socket_origin_accept @ WebSocketConnection
        snowflakeEvents.emit("socket_origin_accept", connection);

        // [SnowflakeEventEmit]: socket_login_attempt @ {success:false,token:string,cause:string,client:string}
        snowflakeEvents.emit("socket_login_attempt", {
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

        snowflakeEvents.on("socket_login_attempt", data => {

            // If client IP is set
            if(typeof data.client === "string"){

                // Deconstruct the data
                const { success, token, cause, client, origin, attempts } = data;

                // Fetch the access token from application configuration
                const authentication = Snowflake.authenticateToken(token);

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
                    log = `[${Snowflake.logger.getTime()}] ${success ? "Successful login to websocket" : "Websocket login failed"}, Token: ${authentication ? authentication.alias : token}, IP: ${client || "N/A"}`;
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

            if(message.type === "utf8") {

                const json = JSON.parse(message.utf8Data);

                const { endpoint, data, requestId, ...rest } = json;

                let accessDenied = !access.hasAccess("control_panel");

                if(!accessDenied) {

                    const apiHandler = new SnowflakeApi();

                    apiHandler.call(json, access).then(resp => {

                        const { success, response, statusCode } = resp;

                        if(statusCode === SnowflakeApi.STATUS_CODE_ACCESS_DENIED){

                            // The client doesn't have enough permission for this endpoint
                            return this.sendErrorResponse(connection, requestId, {
                                msgId: "forbidden",
                                msg: "Access denied"
                            });

                        }

                        return this.sendResponse(connection, requestId, response, success);

                    });

                }

                else {

                    // Do not handle the request if the client doesn't have enough permission
                    return this.sendErrorResponse(connection, requestId, {
                        msgId: "forbidden",
                        msg: "Access denied"
                    });

                }

                return;

            }

        } catch (e){
            if(Snowflake.config.is_development)
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

            // [SnowflakeEventEmit]: http_app_init @ Express
            snowflakeEvents.emit("http_app_init", this.app);

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
        if(this.#cli) {
            Snowflake.logger.warning("Couldn't restart the CLI (it's already running)");
            return false;
        }
        this.#cli = snowflakeCLI.start(cli_port);
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

        // Prevent from running the initialization again, just updating the configs
        if(this.#started){
            Snowflake.logger.info("Server already started, no need to restart.", false, "server");
            return this;
        }

        // Use default port if needed
        if(port === null)
            port = Snowflake.yaml.getInt("server.port");

        // Terminate the process if the port hasn't been given
        if(!port)
            Snowflake.logger.assert("You haven't assigned any port in configuration file or the port is invalid.", 1, false, "_server");

        Snowflake.logger.log("%cyan%[SERVER] Initializing HTTP server and websocket...", null, "server");

        // Make a new HTTP server
        const httpServer = http.createServer(app);

        this.#socket = new WebSocketServer({
            httpServer: httpServer,
            autoAcceptConnections: false
        });

        /*if(typeof httpServer !== "object" || httpServer.constructor.name !== "Server") {
            Snowflake.logger.assert("An error has occurred while trying to start the HTTP server, 'httpServer' " +
                "object is not an instance of 'Server'.", 1, false, "_server");
        }*/

        httpServer.on("error", (e) => {
            Snowflake.logger.assert(e.toString(), 1, "_server");
        });

        httpServer.listen(port, () => {

            let {address} = httpServer.address();

            if(address === "::")
                address = "0.0.0.0";

            Snowflake.logger.log(`%cyan%[SERVER] Webserver is available on ${address}:${port}`, null, "server");
            Snowflake.logger.log(`%cyan%[GUI] GUI is available on %underline%http://127.0.0.1:${port}/gui%no_underline%`, null, "server");

            // [SnowflakeEventEmit]: server_start @ Server
            snowflakeEvents.emit("server_start", httpServer);

        });

        httpServer.on("close", () => {

            Snowflake.logger.log("%orange%[SERVER]%reset% HTTP server stopped");

            // [SnowflakeEventEmit]: server_stop
            snowflakeEvents.emit("server_stop");

        });

        this.#http = httpServer;

        this.#initApp();

        this.#initSocket();

        this.#started = true;

        const cliPort = Snowflake.yaml.getInt("server.cli_port");

        if(cliPort)
            snowflakeEvents.on("after_core_start", () => this.#startCLI(cliPort));

        return this;

    }

    stop() {
        return this.stopHttpServer();
    }

    stopHttpServer(){

        return new Promise((resolve, reject) => {

            const timeout = setTimeout(() => reject("Could not stop the HTTP server (timed-out)"), 15000);

            this.#cli.terminate().then(() => {

                Snowflake.logger.log("%orange%[SERVER]%reset% TCP socket terminated");

                this.#socket.shutDown();

                Snowflake.logger.log("%orange%[SERVER]%reset% WebSocket terminated");

                this.#http.close(err => {

                    clearTimeout(timeout);

                    if(err) {
                        reject(err);
                    }
                    else {
                        this.#started = false;
                        this.#cli = null;
                        resolve();
                    }

                });

            });

        });

    }

    /**
     * Send response to a client
     * @param {WebSocketConnection} connection
     * @param {string} requestId
     * @param {object} data
     * @param {boolean} success
     * @since 1.0.0
     */
    sendResponse(connection, requestId, data    , success){
        connection.send(JSON.stringify({
            data, requestId, success
        }));
    }

    /**
     * Send response to a client with success status
     * @param {WebSocketConnection} connection
     * @param {string} requestId
     * @param {object} data
     * @since 1.0.0
     */
    sendSuccessResponse(connection, requestId, data = {}){
        this.sendResponse(connection, requestId, data, true);
    }

    /**
     * Send response to a client with error status
     * @param {WebSocketConnection} connection
     * @param {string} requestId
     * @param {object} data
     * @since 1.0.0
     */
    sendErrorResponse(connection, requestId, data = {}){
        this.sendResponse(connection, requestId, data, false);
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