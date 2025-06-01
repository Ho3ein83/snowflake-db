const {v4: uuid4} = require("uuid");
const Snowflake = require("./Snowflake");
const SnowflakeEvents = require("./SnowflakeEvents");
const appConfig = require("../../app.json");

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

    #access = "";

    #user_alias = "";

    #token = null;

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

        this.connection_timeout = null;

        if(configs.timeout > 0){
            this.connection_timeout = setTimeout(() => {
                this.destroy("Connection timed out before completing the authentication.");
            }, configs.timeout);
        }

        this.#init();
    }

    /**
     * Check if access token exists inside app.json
     * @param {string} access_token - Access token to authorize
     * @return {{alias: string, permissions: Array, max_connections: number}|boolean}
     * @since 1.0.0
     */
    authenticate(access_token){
        return (appConfig.access_keys ?? {})[access_token] ?? false;
    }

    /**
     * Initialize the shell
     * @return {SnowflakeShell}
     * @since 1.0.0
     */
    #init(){

        this.#access = "";
        this.send("not_authorized", "Access token: ", null, -1);

        const uuid = this.#uuid;

        let lockdown_reported = false;
        this.#socket.on("data", (data) => {
            const command = data.toString("utf-8").trim();
            const size_limit = this.#configs.max_input_size;
            if(size_limit > 0 && command.length > size_limit){
                this.send("size_limit", `Size limit of ${Snowflake.formatBytes(size_limit, true, 0, "")} exceeded.`, size_limit, 9);
                this.writePrompt(1);
                return;
            }
            const remote_ip = this.#socket.remoteAddress;
            let is_locked_down = false;
            if(remote_ip && this.#cli.lockedDown(remote_ip))
                is_locked_down = true;
            else
                lockdown_reported = false;
            const report_lockdown = () => {
                if(!lockdown_reported) {
                    SnowflakeEvents.emit("cli_server_login_attempt", {
                        shell: this,
                        success: false,
                        token: command,
                        cause: "lockdown"
                    });
                    lockdown_reported = true;
                }
            }
            if(command === "@json" || command === "@echo"){
                const m = command.replace("@", "");
                this.#configs.mode = m;
                this.sendState("mode_changed", m, -3);
                this.writePrompt(1);
                return;
            }
            else if(command.startsWith("@timing")){
                const m = command.replace("@timing", "").trim();
                this.#configs.timing = Snowflake.isTrue(m);
                this.send("response", `Timing ${this.#configs.timing ? "enabled" : "disabled"}`, null);
                this.writePrompt(1);
                return;
            }
            else if(command === "clear" || command === "cls"){
                this.clear();
                this.writePrompt();
                return;
            }
            if(!this.#access){
                let auth = this.authenticate(command);
                if(auth && !is_locked_down){
                    if(this.#cli.lockedDown(command)){
                        report_lockdown();
                        return;
                    }
                    const max_connections = auth.max_connections || -1;
                    if(max_connections !== -1){
                        const sessions = this.#cli.tokenSessions(command);
                        if(sessions >= max_connections){
                            this.sendState("full_room", command, -2);
                            this.destroy("Connection limit for this token exceeded.");
                            SnowflakeEvents.emit("cli_server_login_attempt", {shell: this, success: false, token: command, cause: "full_room"});
                            return;
                        }
                    }
                    clearTimeout(this.connection_timeout);
                    this.clear();
                    this.#user_alias = auth.alias || "user";
                    Snowflake.logger.log(`%magenta%[CLI]%reset% Client ${uuid} authorized as '${this.#user_alias}' using access token.`);
                    SnowflakeEvents.emit("cli_server_shell_authorized", {uuid, token: command});
                    SnowflakeEvents.emit("cli_server_login_attempt", {shell: this, success: true, token: command, cause: ""});
                    this.sendState("authorized", this.#user_alias, -2);
                    if(this.mode === "echo"){
                        this.#socket.write(this.header);
                        this.writePrompt();
                    }
                    this.#access = auth;
                    this.#token = command;
                }
                else{
                    this.send("authorize_again", "Access token: ", null, 2);
                    if(is_locked_down){
                        report_lockdown();
                    }
                    else{
                        SnowflakeEvents.emit("cli_server_login_attempt", {shell: this, success: false, token: command, cause: "credential"});
                    }
                }
                return;
            }
            else if(command === "") {
                this.writePrompt();
                return;
            }
            let start = this.#configs.timing ? performance.now() : 0;
            let after = "";

            const [message, value, status, output] = this.#cli.exec(command, this);
            if(this.#configs.timing){
                let end = performance.now();
                after = `\nTook ${(end - start).toFixed(4)}ms to execute.`;
            }
            this.send("response", message + after, value, status, output);
            this.writePrompt(1);
            SnowflakeEvents.emit("cli_server_connection_data", { data: data, shell: this });
        });

        this.#socket.on("end", () => {
            SnowflakeEvents.emit("cli_server_connection_end", { data: null, shell: this });
        });

        this.#socket.on("error", (err) => {
            console.error(`Error: ${err.message}`);
            SnowflakeEvents.emit("cli_server_connection_error", { data: err, shell: this });
        });

        return this;
    }

    /**
     * Destroy the session
     * @param {string|null} error_message - Error message or pass null to use default message
     * @since 1.0.0
     */
    destroy(error_message=null){
        if(error_message === null)
            error_message = "Disconnected";
        this.#socket.write(Snowflake.logger.format_color(`\n%red%${error_message}\n`, this.mode === "json"));
        this.#socket.destroy(new Error(error_message));
        SnowflakeEvents.emit("cli_server_connection_end", { shell: this });
        return this;
    }

    /**
     * Send a message to the client
     * @param {string} action - Action name
     * @param {string} message_text - Message text
     * @param {any} value - The value to send, default is null
     * @param {number} status_code - The status code to send
     * @param {boolean} print_value - Whether to print the value in echo-mode when `status_code` is 0
     * @return {SnowflakeShell}
     * @since 1.0.0
     */
    send(action, message_text, value = null, status_code = 0, print_value=false) {
        const status = Snowflake.getStatus(status_code);
        const data = {action, message_text, value, status_code, status: status.id, success: status.success};
        switch(this.mode){
            case "echo":
                let after = "";
                if(print_value && status_code === 0)
                    after = "\n" + JSON.stringify(value, null, 1);
                this.socket.write((message_text + after).trim());
                break;
            case "json":
                this.socket.write(JSON.stringify(data) + "\n");
                break;
        }
        return this;
    }

    /**
     * Send state code to the client
     * @param {string} state - State or action name
     * @param {any} value - The value to send, default is null
     * @param {number} status_code - The status code to send
     * @return {SnowflakeShell}
     * @since 1.0.0
     */
    sendState(state, value = null, status_code = 0) {
        if(this.mode === "echo")
            return this;
        return this.send(state, "", value, status_code);
    }

    /**
     * Send clear signal
     * @return {SnowflakeShell}
     * @since 1.0.0
     */
    clear(){
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
        if(this.mode !== "echo")
            return this;
        if(br > 0)
            this.#socket.write("\n".repeat(br));
        this.#socket.write(this.prompt.replaceAll("{USER}", this.#user_alias))
        return this;
    }

    /**
     * Check if current shell is authorized or not
     * @return {boolean}
     * @since 1.0.0
     */
    isAuthorized(){
        return this.#access && this.#access.length > 0;
    }

    /**
     * Exit the shell
     * @param {number} exit_code - Exit code
     * @since 1.0.0
     */
    exit(exit_code = 0) {
        this.#access = false;
        this.sendState("exit", exit_code, 7);
        this.socket.end();
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
        return Snowflake.logger.format_color(`
  ____                       __ _       _        
 / ___| _ __   _____      __/ _| | __ _| | _____ 
 \\___ \\| '_ \\ / _ \\ \\ /\\ / / |_| |/ _\` | |/ / _ \\
  ___) | | | | (_) \\ V  V /|  _| | (_| |   <  __/
 |____/|_| |_|\\___/ \\_/\\_/ |_| |_|\\__,_|_|\\_\\___|
                                                 

Welcome to Snowflake command line!
Enter your command or enter 'help' for more info.\n\n`);
    }

    get prompt(){
        return Snowflake.logger.format_color(this.#prompt);
    }

    get token(){
        return this.#token;
    }

}

module.exports = SnowflakeShell;