const {v4: uuid4} = require("uuid");
const Snowflake = require("./Snowflake");
const snowflakeEvents = require("./SnowflakeEvents");

class SnowflakeShell {

    /**
     * Shell configuration
     * @type {{timeout?: number, mode?: "echo"|"json", max_input_size?: number, timing?: boolean}} Config
     * @since 1.0.0
     */
    #configs = {};

    /**
     * TCP socket object
     * @type {import("net").Socket}
     * @since 1.0.0
     */
    #socket;

    /**
     * CLI object
     * @type {SnowflakeCLI}
     * @since 1.0.0
     */
    #cli;

    /**
     * Current UUID
     * @type {string}
     * @since 1.0.0
     */
    #uuid;

    /**
     * Current prompt string
     * @type {string}
     * @since 1.0.0
     */
    #prompt = "> ";

    /**
     * Current access object or false if not authorized
     * @type {{alias: string, permissions: Array, max_connections: number}|false}
     * @since 1.0
     */
    #access = false;

    /**
     * The alias of the current access token (if authorized)
     * @type {string}
     * @since 1.0
     */
    #userAlias = "";

    /**
     * The current access token of this session, or null if not authorized
     * @type {string|null}
     * @since 1.0
     */
    #token = null;

    /**
     * States of the current shell
     * @type {{restartPrompt: boolean}}
     * @since 1.0.0
     */
    #states = {
        restartPrompt: false
    };

    /**
     * @param {SnowflakeCLI} cli - CLI object
     * @param {import("net").Socket} socket
     * @param {{timeout?: number, mode?: "echo"|"json", max_input_size?: number, timing?: boolean}} configs
     */
    constructor(cli, socket, configs) {

        this.#socket = socket;

        this.#cli = cli;

        this.#prompt = "%green%{USER}%reset%> ";

        this.#configs = Object.assign({
            timeout: 0,
            mode: "echo",
            max_input_size: 0,
            timing: false
        }, configs);

        this.#uuid = uuid4();

        this.connectionTimeout = null;

        if(configs.timeout > 0){
            this.connectionTimeout = setTimeout(() => {
                this.destroy("Connection timed out before completing the authentication.", "timeout");
            }, configs.timeout);
        }

        this.#init();
    }

    /**
     * Check if access token exists inside app.json
     * @param {string} accessToken - Access token to authorize
     * @return {{alias: string, permissions: Array, max_connections: number}|boolean}
     * @since 1.0.0
     */
    authenticate(accessToken){
        return (Snowflake.config.access_keys ?? {})[accessToken] ?? false;
    }

    /**
     * Initialize the shell
     * @return {SnowflakeShell}
     * @since 1.0.0
     */
    #init(){

        this.#access = false;
        this.send(
            "not_authorized",
            "Access token: ",
            null,
            -1
        );

        const uuid = this.#uuid;

        let lockdownReported = false;

        this.#socket.on("data", (data) => {

            // Received data (command)
            // Parse them after and extract environment variables, for example this would run 'ls' command:
            // auth:my-token; ls
            // The line above will authorize as 'my-token', and then runs 'ls' command
            // nonce:1234; ls
            // The line above will use '1234' as response nonce, and then runs 'ls' command
            // Multiple variables can be passed:
            // key1:value1; key2:value2; key3:value3; ls
            let { pairs: environment, rest: command } = Snowflake.parseColonPairs(data.toString("utf-8").trim());

            // The nonce of the current request
            // It is useful in JSON mode as you can track the response of each request, despite the order of receiving.
            let currentNonce = null;

            // Input data limit size, your host TCP may have its own limit
            const sizeLimit = this.#configs.max_input_size;

            // Do not execute the command if exceeded the size limit
            if(sizeLimit > 0 && command.length > sizeLimit){
                this.send(
                    "size_limit", `Size limit of ${Snowflake.formatBytes(sizeLimit, true, 0, "")} exceeded.`,
                    sizeLimit,
                    9
                );
                this.writePrompt(1);
                return;
            }

            // Retrieve remote IP address, used for restrictions and lockdown
            const remoteIP = this.#socket.remoteAddress;

            // Check if the client is locked down
            let isLockedDown = false;
            if(remoteIP && this.#cli.lockedDown(remoteIP))
                isLockedDown = true;
            else
                lockdownReported = false;

            // Request to report lockdown
            const reportLockdown = () => {
                if(!lockdownReported) {
                    // [SnowflakeEventEmit]: cli_server_login_attempt @ {shell:SnowflakeShell,success:boolean,token:string,cause:string}
                    snowflakeEvents.emit("cli_server_login_attempt", {
                        shell: this,
                        success: false,
                        token: command,
                        cause: "lockdown"
                    });
                    lockdownReported = true;
                }
            }

            // Fetch nonce from environment variables
            if(typeof environment.nonce !== "undefined")
                currentNonce = parseInt(environment.nonce) || 0;

            // Whether to send successful authentication messages
            let silentAuth = false;

            // Fetch credentials from environment variables
            if (typeof environment.auth !== "undefined") {

                // When authenticating using environment variables and not sending any command, there is no need for
                // sending authentication ACK if authentication was successful.
                silentAuth = command.length > 0;

                // Logout first
                this.#access = false;
                this.#token = null;

                // Extract access token
                command = environment.auth;
            }

            if(this.#states.restartPrompt){

                const answer = command.toLowerCase();

                if(["yes", "y"].includes(answer)){
                    if(snowflakeEvents.getListenerCounts("request_restart")) {

                        this.send("response", "Restarting - Connection closed");

                        // [SnowflakeEventEmit]: request_restart
                        snowflakeEvents.emit("request_restart");

                    }
                    else {
                        this.send("response", "No restart event found, try restarting manually.");
                        this.#states.restartPrompt = false;
                        this.writePrompt(2);
                    }
                    return;
                }

                else if(["no", "n"].includes(answer)){
                    this.#states.restartPrompt = false;
                    this.writePrompt();
                    return;
                }

                this.writePrompt();

                return;

            }

            // Printing attributes
            if(command === "@json" || command === "@echo"){
                const m = command.replace("@", "");
                this.#configs.mode = m;
                this.#socket.write("\n");
                this.sendState("mode_changed", m, -3, currentNonce);
                if(m === "json" && !this.#access){
                    this.sendState("authenticate", "token", -1, currentNonce);
                }
                this.writePrompt(1);
                return;
            }

            // Timing attribute
            else if(command.startsWith("@timing")){
                const m = command.replace("@timing", "").trim();
                this.#configs.timing = Snowflake.isTrue(m);
                this.send("response", `Timing ${this.#configs.timing ? "enabled" : "disabled"}`, null, 0, false, currentNonce);
                this.writePrompt(1);
                return;
            }

            // Clear command (internal)
            else if(command === "clear" || command === "cls"){
                this.clear();
                this.writePrompt();
                return;
            }

            // Logout command (internal)
            else if(command === "logout"){
                this.#access = false;
                this.#token = null;
                this.send("authenticate", "Logged out\nAccess token: ", 2, 0, false, currentNonce);
                return;
            }

            // Restart command (internal)
            if(command === "restart"){
                this.#states.restartPrompt = true;
                this.writePrompt(0);
                return;
            }

            // If not authorized
            if(!this.#access){

                // Assume the given command is access token
                let auth = this.authenticate(command);

                // If access token exists the client IP address isn't locked down
                if(auth && !isLockedDown){

                    // Check if the token itself is locked down or not
                    if(this.#cli.lockedDown(command)){
                        // If the token was locked down, report it
                        reportLockdown();
                        return;
                    }

                    // Maximum connections allowed per token
                    const maxConnections = auth.max_connections || -1;

                    // If the connection count is limited (-1 means no limit)
                    if(maxConnections !== -1){

                        // Get active sessions count for the given access token
                        const sessions = this.#cli.tokenSessions(command);

                        // If the sessions count reached its limit
                        if(sessions >= maxConnections){
                            this.sendState("full_room", command, -2, currentNonce);
                            this.destroy("Connection limit for this token exceeded.", "connection_limit");
                            // [SnowflakeEventEmit]: cli_server_login_attempt @ {shell:SnowflakeShell,success:boolean,token:string,cause:string}
                            snowflakeEvents.emit("cli_server_login_attempt", {shell: this, success: false, token: command, cause: "full_room"});
                            return;
                        }

                    }

                    // Authenticated, now the client can stay connected
                    clearTimeout(this.connectionTimeout);

                    // If using echo mode, clear the terminal first
                    if(this.mode === "echo")
                        this.clear();

                    // Get the alias of the current session
                    this.#userAlias = auth.alias || "user";
                    Snowflake.logger.log(`%magenta%[CLI]%reset% Client ${uuid} authorized as '${this.#userAlias}' using access token.`, null, "shell");

                    // [SnowflakeEventEmit]: cli_server_shell_authorized @ {uuid:string,token:string}
                    snowflakeEvents.emit("cli_server_shell_authorized", {uuid, token: command});

                    // Successful login attempt
                    // [SnowflakeEventEmit]: cli_server_login_attempt @ {shell:SnowflakeShell,token:string,cause:string}
                    snowflakeEvents.emit("cli_server_login_attempt", {shell: this, success: true, token: command, cause: ""});

                    if(!silentAuth)
                        this.sendState("authorized", this.#userAlias, -2, currentNonce);

                    // Send prompt characters if using echo mode
                    if(this.mode === "echo"){
                        this.#socket.write(this.header);
                        this.writePrompt();
                    }

                    // Update current session
                    // Note: each client has their own SnowflakeShell instance, so each property on this class belongs
                    // to a separate client
                    this.#access = auth;
                    this.#token = command;
                }
                else{

                    // Authorization failed, retry
                    this.send("authorize_again", "Access token: ", null, 2, false, currentNonce);

                    if(isLockedDown){

                        // If the client (or token) is locked down, report it so admins can be notified who tried to
                        // authenticate during a lockdown
                        reportLockdown();

                    }

                    // Unsuccessful login attempt
                    else{

                        // [SnowflakeEventEmit]: cli_server_login_attempt @ {shell:SnowflakeShell,success:boolean,token:string,cause:string}
                        snowflakeEvents.emit("cli_server_login_attempt", {shell: this, success: false, token: command, cause: "credential"});

                    }

                }

                return;

            }

            // Empty command, nothing to do
            else if(command === "") {
                this.writePrompt();
                return;
            }

            // Start measuring the execution time
            let start = this.#configs.timing ? performance.now() : 0;

            // The message to display at the end of the command output
            let after = "";

            // Execute the command and catch its response
            const [message, value, status, output] = this.#cli.exec(command, this);

            // If timing was enabled (can be enabled by timing attribute: @timing on)
            if(this.#configs.timing){
                let end = performance.now();
                after = `\nTook ${(end - start).toFixed(4)}ms to execute.`;
            }

            // Done
            this.send("response", message + after, value, status, output, currentNonce);
            this.writePrompt(1);

            // [SnowflakeEventEmit]: cli_server_connection_data @ {data:object,shell:SnowflakeShell}
            snowflakeEvents.emit("cli_server_connection_data", { data: data, shell: this });

        });

        this.#socket.on("end", () => {
            // [SnowflakeEventEmit]: cli_server_connection_end {data:null|object,shell:SnowflakeShell}
            snowflakeEvents.emit("cli_server_connection_end", { data: null, shell: this });
        });

        this.#socket.on("error", (err) => {
            Snowflake.logger.error(`SocketError: ${err.message}`, false, "_server");
            // [SnowflakeEventEmit]: cli_server_connection_error @ {data:string,shell:SnowflakeShell}
            snowflakeEvents.emit("cli_server_connection_error", { data: String(err), shell: this });
        });

        return this;
    }

    /**
     * Destroy the session
     * @param {string|null} error_message - Error message or pass null to use default message
     * @param {string|null} cause - The cause of the error (short and descriptive string, e.g: "access_denied").
     * Pass null to ignore it
     * @since 1.0.0
     */
    destroy(error_message=null, cause = null){

        // Default message
        if(error_message === null)
            error_message = "Disconnected";

        // Use ANSI colors for echo mode and print text-only message in JSON mode
        const message = Snowflake.logger.formatColor(`\n%red%${error_message}\n`, this.mode === "json");

        // If JSON mode is enabled, respond with JSON
        if(this.mode === "json"){
            this.#socket.write(JSON.stringify({
                action: cause,
                message_text: String(message).trim(),
            }));
        }
        else{
            this.#socket.write(message);
        }

        // Destroy the connection
        this.#socket.destroy(new Error(error_message));

        // [SnowflakeEventEmit]: cli_server_connection_end @ {shell:SnowflakeShell}
        snowflakeEvents.emit("cli_server_connection_end", { shell: this });

        // For method chaining
        return this;

    }

    /**
     * Send a message to the client
     * @param {string} action - Action name
     * @param {string} messageText - Message text
     * @param {any} value - The value to send, default is null
     * @param {number} statusCode - The status code to send
     * @param {boolean} printValue - Whether to print the value in echo-mode when `status_code` is 0
     * @param {number|null} nonce - The nonce assigned to current response
     * @return {SnowflakeShell}
     * @since 1.0.0
     */
    send(action, messageText, value = null, statusCode = 0, printValue=false, nonce = null) {

        // Get status ID and status from status code
        const status = Snowflake.getStatus(statusCode);

        // Standard snowflake output
        let data = {
            action,
            message_text: this.mode === "json" ? Snowflake.logger.stripAnsiCodes(messageText) : messageText,
            value,
            status_code: statusCode,
            status: status.id,
            success: status.success
        };

        // Include the nonce in the response object (if provided)
        if(nonce !== null)
            data["nonce"] = nonce;

        // Prepare and respond with appropriate format based on current mode
        switch(this.mode){
            case "echo":
                let after = "";
                if(printValue && statusCode === 0)
                    after = "\n" + (Snowflake.stringify(value, 60, "...", true));
                this.#socket.write((messageText + after).trim());
                break;
            case "json":
                this.#socket.write(JSON.stringify(data) + "\n");
                break;
        }

        // For method chaining
        return this;

    }

    /**
     * Send state code to the client
     * @param {string} state - State or action name
     * @param {any} value - The value to send, default is null
     * @param {number} statusCode - The status code to send
     * @param {number|null} nonce - The nonce assigned to current response
     * @return {SnowflakeShell}
     * @since 1.0.0
     */
    sendState(state, value = null, statusCode = 0, nonce = null) {

        // States are only meant to be used in JSON mode
        if(this.mode === "echo")
            return this;

        return this.send(state, "", value, statusCode, false, nonce);

    }

    /**
     * Sends the request to clear the terminal
     * @return {SnowflakeShell}
     * @since 1.0.0
     */
    clear(){
        // In echo mode, it sends ANSI clear code.
        // In JSON mode, it must be handled by the client
        this.send("clear", Snowflake.logger.clear);
        return this;
    }

    /**
     * Write prompt string to the shell
     * @param {number} br - The number of starting break lines (before prompt string)
     * @return {SnowflakeShell}
     * @since 1.0.0
     */
    writePrompt(br=0){

        // Prompts are only usable in echo mode
        if(this.mode !== "echo")
            return this;

        // Add break lines before the message if needed
        if(br > 0)
            this.#socket.write("\n".repeat(br));

        // Prompt text
        let _prompt = this.prompt.replaceAll("{USER}", this.#userAlias);

        if(this.#states.restartPrompt)
            _prompt = Snowflake.logger.formatColor("Restart the app %green%y%reset%es/%green%n%reset%o: ");

        // Insert the alias of the current session in prompt
        this.#socket.write(_prompt)

        return this;

    }

    /**
     * Check if current shell is authorized or not
     * @return {boolean}
     * @since 1.0.0
     */
    isAuthorized(){
        return typeof this.#access === "object";
    }

    /**
     * Exit the shell
     * @param {number} exitCode - Exit code
     * @since 1.0.0
     */
    exit(exitCode = 0) {
        this.#access = false;
        this.sendState("exit", exitCode, 7);
        this.#socket.end();
        this.#socket.destroySoon();
    }

    /**
     * @since 1.0.0
     */
    get mode(){
        return this.#configs.mode;
    }

    /**
     * @param {"json"|"echo"} mode
     * @since 1.0.0
     */
    set mode(mode){
        this.#configs.mode = mode;
    }

    /**
     * Get UUID of current connection
     * @return {string}
     * @since 1.0.0
     */
    get uuid(){
        return this.#uuid;
    }

    /**
     * Get TCP socket connection
     * @return {import("net").Socket}
     * @since 1.0.0
     */
    get socket(){
        return this.#socket;
    }

    get header(){
        return Snowflake.logger.formatColor(`
  ____                       __ _       _        
 / ___| _ __   _____      __/ _| | __ _| | _____ 
 \\___ \\| '_ \\ / _ \\ \\ /\\ / / |_| |/ _\` | |/ / _ \\
  ___) | | | | (_) \\ V  V /|  _| | (_| |   <  __/
 |____/|_| |_|\\___/ \\_/\\_/ |_| |_|\\__,_|_|\\_\\___|
                                                 

Welcome to Snowflake command line!
Enter your command or enter 'help' for more info.\n\n`);
    }

    get prompt(){
        return Snowflake.logger.formatColor(this.#prompt);
    }

    get token(){
        return this.#token;
    }

}

module.exports = SnowflakeShell;