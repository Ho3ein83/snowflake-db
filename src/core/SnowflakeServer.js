const Snowflake = require("./Snowflake");
const SnowflakeEvents = require("./SnowflakeEvents");
const SnowflakeCLI = require("./SnowflakeCLI");

const express = require("express");
const app = express();
const http = require("http");
const httpServer = http.createServer(app);
const WebSocket = require("websocket").server;

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
     * @type {import("websocket").server}
     * @since 1.0.0
     */
    #socket;

    /**
     * SnowflakeCLI instance or null if CLI is not initialized
     * @type {import("./SnowflakeCLI")|null}
     * @since 1.0.0
     */
    #cli = null;

    constructor() {

    }

    /**
     * Handle HTTP requests from everywhere
     * @param {*,IncomingMessage} req
     * @param {*,ServerResponse} res
     * @since 1.0.0
     */
    handleAll(req, res){
        if(!Snowflake.yaml.isTrue("server.homePage"))
            res.sendStatus(404);
        else
            res.sendFile(process.env.PWD + "/view/index.html");
    }

    /**
     * Verify websocket request origin and protocol.
     * @param request
     * @since 1.0.0
     */
    verifySocketRequest(request) {

        // Check if origin is allowed
        if(!Snowflake.core.originIsAllowed(request.origin, null)) {
            // Reject the connection
            request.reject();
            Snowflake.logger.warning(`Origin '${request.origin}' was rejected.`, "socket");
            SnowflakeEvents.emit("socket_origin_reject", request.origin);
            return;
        }

        // Accept the connection
        const connection = request.accept(null, request.origin);
        Snowflake.logger.info(`Origin '${request.origin}' was accepted.`, "socket");
        SnowflakeEvents.emit("socket_origin_accept", connection);

    }

    /**
     * Initialize websocket
     * @since 1.0.0
     */
    #initSocket(){
        // Check requests before letting them connect to the socket
        this.socket.addEventListener("request", this.verifySocketRequest);
    }

    /**
     * Initialize Express app
     * @since 1.0.0
     */
    #initApp(){
        // Handle all requests from HTTP server
        if(Snowflake.yaml.isTrue("server.http_server"))
            this.app.get("*", this.handleAll);
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

        this.#socket = new WebSocket({
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
            SnowflakeEvents.emit("server_start", httpServer);
        });

        this.#initApp();

        // this.#initSocket();

        this.#started = true;

        const cli_port = Snowflake.yaml.getInt("server.cli_port");
        if(cli_port)
            SnowflakeEvents.on("core_after_start", () => this.#startCLI(cli_port));

        return this;

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